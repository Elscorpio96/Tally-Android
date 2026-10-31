-- 0005: one-time, repeat-safe import of a shop's existing on-phone data.
-- Atomic: any error (including a failed totals check) undoes the WHOLE import.
-- Repeat-safe: same backup (source_hash) => 'already_imported'; rows carry legacy_id so a newer backup
-- only adds what is missing. Stock is a snapshot and is applied ONLY to products created by this run, so a
-- second import can never overwrite live stock. Historical sales do not move stock.
--
-- p = { source_hash, expected: {products, customers, sales, sales_total, credit_outstanding, stock_units,
--         repayments_total, expenses_total, purchases_total},
--       branches:[{legacy_id,name,address,phone}], products:[{legacy_id,name,sku,barcode,category,cost,price,low_stock,quick}],
--       stock:[{product,branch,qty}], customers:[{legacy_id,name,phone,reminded_at}],
--       sales:[{legacy_id,invoice,date,time,branch,cashier_name,customer,customer_name,customer_phone,payment_method,
--               due_date,amount_paid,balance_due,total,cost_total,items:[{product,name,qty,price,cost}]}],
--       credit_payments:[{legacy_id,receipt_no,customer,branch,amount,date,time,note,cashier_name}],
--       purchases:[{legacy_id,supplier,date,branch,total,items:[{product,name,qty,cost}]}],
--       expenses:[{legacy_id,branch,date,category,amount,note}],
--       day_closes:[{branch,date,float,counted,expected,difference,note,closed_by_name,closed_at}] }
create function import_legacy(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_shop uuid := app.my_shop(); v_uid uuid := auth.uid(); v_hash text := p->>'source_hash'; v_run uuid;
  v_main uuid; v_first boolean := true; r record; v_bid uuid; v_pid uuid; v_cid uuid; v_sid uuid; v_code text; v_n int;
  v_sku text; v_inv text; v_tz text; v_sold timestamptz; v_calc numeric; v_cnt jsonb := '{}'::jsonb;
  v_new_products uuid[] := '{}'; v_got numeric; v_exp jsonb := coalesce(p->'expected', '{}'::jsonb);
  v_branch_map jsonb := '{}'::jsonb;
begin
  perform app.require_member();
  if app.my_role() <> 'owner' then raise exception 'owner_required' using errcode = '42501'; end if;
  if coalesce(v_hash, '') = '' then raise exception 'missing_source_hash'; end if;
  if exists (select 1 from migration_runs where shop_id = v_shop and source_hash = v_hash and status = 'completed') then
    return jsonb_build_object('status', 'already_imported');
  end if;
  delete from migration_runs where shop_id = v_shop and source_hash = v_hash and status <> 'completed';
  insert into migration_runs(shop_id, source_hash, started_by) values (v_shop, v_hash, v_uid) returning id into v_run;
  select timezone into v_tz from shops where id = v_shop;

  -- ---- branches (first one re-uses the untouched MAIN branch created at sign-up)
  select id into v_main from branches where shop_id = v_shop and code = 'MAIN' and legacy_id is null
     and not exists (select 1 from sales s where s.branch_id = branches.id) limit 1;
  for r in select * from jsonb_to_recordset(coalesce(p->'branches', '[]')) as x(legacy_id text, name text, address text, phone text) loop
    select id into v_bid from branches where shop_id = v_shop and legacy_id = r.legacy_id;
    if v_bid is null then
      if v_first and v_main is not null then
        update branches set name = coalesce(nullif(trim(r.name), ''), name), address = coalesce(r.address, ''), phone = coalesce(r.phone, ''), legacy_id = r.legacy_id
          where id = v_main returning id into v_bid;
      else
        v_code := upper(left(regexp_replace(coalesce(r.name, ''), '[^A-Za-z0-9]', '', 'g'), 4)); if length(v_code) < 2 then v_code := 'BR'; end if;
        v_n := 1; while exists (select 1 from branches where shop_id = v_shop and code = v_code) loop v_n := v_n + 1; v_code := left(v_code, 4) || v_n::text; end loop;
        insert into branches(shop_id, code, name, address, phone, legacy_id)
          values (v_shop, v_code, coalesce(nullif(trim(r.name), ''), 'Branch'), coalesce(r.address, ''), coalesce(r.phone, ''), r.legacy_id) returning id into v_bid;
      end if;
    end if;
    v_first := false;
  end loop;
  v_cnt := v_cnt || jsonb_build_object('branches', (select count(*) from branches where shop_id = v_shop and legacy_id is not null));

  -- ---- products (stock is applied below, for new products only)
  for r in select * from jsonb_to_recordset(coalesce(p->'products', '[]')) as x(legacy_id text, name text, sku text, barcode text, category text, cost numeric, price numeric, low_stock numeric, quick boolean) loop
    continue when exists (select 1 from products where shop_id = v_shop and legacy_id = r.legacy_id);
    v_sku := coalesce(nullif(trim(r.sku), ''), 'L' || r.legacy_id);
    if exists (select 1 from products where shop_id = v_shop and lower(sku) = lower(v_sku) and archived_at is null) then v_sku := v_sku || '-' || r.legacy_id; end if;
    insert into products(shop_id, name, sku, barcode, category, cost, price, low_stock, quick, legacy_id)
      values (v_shop, coalesce(nullif(trim(r.name), ''), 'Item ' || r.legacy_id), v_sku,
              case when coalesce(r.barcode, '') <> '' and not exists (select 1 from products where shop_id = v_shop and barcode = r.barcode and archived_at is null) then r.barcode else '' end,
              coalesce(r.category, ''), greatest(coalesce(r.cost, 0), 0), greatest(coalesce(r.price, 0), 0), coalesce(r.low_stock, 0), coalesce(r.quick, false), r.legacy_id)
      returning id into v_pid;
    v_new_products := v_new_products || v_pid;
  end loop;
  for r in select pr.id as pid, b.id as bid, x.qty from jsonb_to_recordset(coalesce(p->'stock', '[]')) as x(product text, branch text, qty numeric)
           join products pr on pr.shop_id = v_shop and pr.legacy_id = x.product and pr.id = any(v_new_products)
           join branches b on b.shop_id = v_shop and b.legacy_id = x.branch loop
    perform app.apply_stock(v_shop, r.bid, r.pid, coalesce(r.qty, 0), 'migration', 'migration', v_run, true, 'opening balance from phone');
  end loop;

  -- ---- customers
  insert into customers(shop_id, name, phone, reminded_at, legacy_id)
    select v_shop, coalesce(nullif(trim(x.name), ''), 'Customer'), coalesce(x.phone, ''), nullif(x.reminded_at, '')::date, x.legacy_id
    from jsonb_to_recordset(coalesce(p->'customers', '[]')) as x(legacy_id text, name text, phone text, reminded_at text)
    on conflict (shop_id, legacy_id) do nothing;

  -- ---- sales (history only: no stock movement)
  for r in select * from jsonb_to_recordset(coalesce(p->'sales', '[]')) as x(legacy_id text, invoice text, date text, time text, branch text, cashier_name text,
             customer text, customer_name text, customer_phone text, payment_method text, due_date text, amount_paid numeric, balance_due numeric, total numeric,
             cost_total numeric, items jsonb) loop
    continue when exists (select 1 from sales where shop_id = v_shop and legacy_id = r.legacy_id);
    select id into v_bid from branches where shop_id = v_shop and legacy_id = r.branch;
    if v_bid is null then raise exception 'import_unknown_branch: sale %', r.legacy_id; end if;
    v_cid := null;
    if r.customer is not null and r.customer <> '' then select id into v_cid from customers where shop_id = v_shop and legacy_id = r.customer; end if;
    if r.payment_method = 'credit' and v_cid is null then
      insert into customers(shop_id, name, phone, legacy_id) values (v_shop, coalesce(nullif(trim(r.customer_name), ''), 'Customer'), coalesce(r.customer_phone, ''), 'auto-' || r.legacy_id)
        on conflict (shop_id, legacy_id) do nothing;
      select id into v_cid from customers where shop_id = v_shop and legacy_id = 'auto-' || r.legacy_id;
    end if;
    select sum(round(i.qty * i.price, 2)) into v_calc from jsonb_to_recordset(r.items) as i(qty numeric, price numeric);
    if abs(coalesce(v_calc, 0) - coalesce(r.total, 0)) > 0.011 then raise exception 'import_sale_total_mismatch: sale % (items %, total %)', r.legacy_id, v_calc, r.total; end if;
    v_inv := 'OLD-' || coalesce(nullif(trim(r.invoice), ''), r.legacy_id);
    if exists (select 1 from sales where shop_id = v_shop and invoice_no = v_inv) then v_inv := v_inv || '-' || r.legacy_id; end if;
    v_sold := coalesce(nullif(r.time, '')::timestamptz, (r.date || ' 12:00')::timestamp at time zone v_tz);
    v_sid := gen_random_uuid();
    insert into sales(id, shop_id, branch_id, cashier_id, cashier_name, invoice_no, sold_at, business_date, customer_id, customer_name, customer_phone,
                      payment_method, due_date, subtotal, discount_total, total, cost_total, amount_paid, balance_due, legacy_id)
      values (v_sid, v_shop, v_bid, v_uid, coalesce(r.cashier_name, ''), v_inv, v_sold, r.date::date, v_cid, coalesce(r.customer_name, ''), coalesce(r.customer_phone, ''),
              case when r.payment_method in ('cash','credit','transfer','pos') then r.payment_method else 'cash' end, nullif(r.due_date, '')::date,
              round(r.total, 2), 0, round(r.total, 2), greatest(coalesce(r.cost_total, 0), 0), greatest(coalesce(r.amount_paid, 0), 0),
              case when r.payment_method = 'credit' then greatest(coalesce(r.balance_due, 0), 0) else 0 end, r.legacy_id);
    insert into sale_items(sale_id, shop_id, product_id, name, qty, unit_price, unit_cost, line_total)
      select v_sid, v_shop, (select id from products where shop_id = v_shop and legacy_id = i.product), coalesce(i.name, 'Item'), i.qty, greatest(i.price, 0), greatest(coalesce(i.cost, 0), 0), round(i.qty * i.price, 2)
      from jsonb_to_recordset(r.items) as i(product text, name text, qty numeric, price numeric, cost numeric) where i.qty > 0;
  end loop;

  -- ---- repayments
  for r in select * from jsonb_to_recordset(coalesce(p->'credit_payments', '[]')) as x(legacy_id text, receipt_no text, customer text, branch text, amount numeric, date text, time text, note text, cashier_name text) loop
    continue when exists (select 1 from credit_payments where shop_id = v_shop and legacy_id = r.legacy_id);
    select id into v_bid from branches where shop_id = v_shop and legacy_id = r.branch;
    select id into v_cid from customers where shop_id = v_shop and legacy_id = r.customer;
    if v_bid is null or v_cid is null then raise exception 'import_unknown_reference: repayment %', r.legacy_id; end if;
    v_inv := 'OLD-' || coalesce(nullif(trim(r.receipt_no), ''), r.legacy_id);
    if exists (select 1 from credit_payments where shop_id = v_shop and receipt_no = v_inv) then v_inv := v_inv || '-' || r.legacy_id; end if;
    v_sold := coalesce(nullif(r.time, '')::timestamptz, (r.date || ' 12:00')::timestamp at time zone v_tz);
    insert into credit_payments(id, shop_id, branch_id, customer_id, receipt_no, amount, paid_at, business_date, note, received_by, received_by_name, legacy_id)
      values (gen_random_uuid(), v_shop, v_bid, v_cid, v_inv, r.amount, v_sold, r.date::date, coalesce(r.note, ''), v_uid, coalesce(r.cashier_name, ''), r.legacy_id);
  end loop;

  -- ---- purchases, expenses, day closes (history only)
  for r in select * from jsonb_to_recordset(coalesce(p->'purchases', '[]')) as x(legacy_id text, supplier text, date text, branch text, total numeric, items jsonb) loop
    continue when exists (select 1 from purchases where shop_id = v_shop and legacy_id = r.legacy_id);
    select id into v_bid from branches where shop_id = v_shop and legacy_id = r.branch;
    if v_bid is null then raise exception 'import_unknown_branch: purchase %', r.legacy_id; end if;
    v_sid := gen_random_uuid();
    insert into purchases(id, shop_id, branch_id, supplier, purchase_date, total, created_by, legacy_id)
      values (v_sid, v_shop, v_bid, coalesce(nullif(trim(r.supplier), ''), 'Supplier'), r.date::date, round(coalesce(r.total, 0), 2), v_uid, r.legacy_id);
    insert into purchase_items(purchase_id, shop_id, product_id, name, qty, unit_cost)
      select v_sid, v_shop, pr.id, coalesce(i.name, pr.name), i.qty, greatest(coalesce(i.cost, 0), 0)
      from jsonb_to_recordset(r.items) as i(product text, name text, qty numeric, cost numeric)
      join products pr on pr.shop_id = v_shop and pr.legacy_id = i.product where i.qty > 0;
  end loop;
  for r in select * from jsonb_to_recordset(coalesce(p->'expenses', '[]')) as x(legacy_id text, branch text, date text, category text, amount numeric, note text) loop
    continue when exists (select 1 from expenses where shop_id = v_shop and legacy_id = r.legacy_id);
    select id into v_bid from branches where shop_id = v_shop and legacy_id = r.branch;
    if v_bid is null then raise exception 'import_unknown_branch: expense %', r.legacy_id; end if;
    insert into expenses(shop_id, branch_id, expense_date, category, amount, note, created_by, legacy_id)
      values (v_shop, v_bid, r.date::date, coalesce(nullif(trim(r.category), ''), 'Other'), r.amount, coalesce(r.note, ''), v_uid, r.legacy_id);
  end loop;
  for r in select * from jsonb_to_recordset(coalesce(p->'day_closes', '[]')) as x(branch text, date text, float numeric, counted numeric, expected numeric, difference numeric, note text, closed_by_name text, closed_at text) loop
    select id into v_bid from branches where shop_id = v_shop and legacy_id = r.branch;
    continue when v_bid is null;
    insert into day_closes(shop_id, branch_id, close_date, float_amount, counted, expected, difference, note, closed_by, closed_by_name, closed_at)
      values (v_shop, v_bid, r.date::date, coalesce(r.float, 0), r.counted, coalesce(r.expected, 0), r.difference, coalesce(r.note, ''), v_uid, coalesce(r.closed_by_name, ''), coalesce(nullif(r.closed_at, '')::timestamptz, now()))
      on conflict (branch_id, close_date) do nothing;
  end loop;

  -- ---- verification: every figure must equal what the phone reported, or everything is undone
  v_cnt := jsonb_build_object(
    'products',  (select count(*) from products where shop_id = v_shop and legacy_id is not null),
    'customers', (select count(*) from customers where shop_id = v_shop and legacy_id is not null and legacy_id not like 'auto-%'),
    'sales',     (select count(*) from sales where shop_id = v_shop and legacy_id is not null),
    'sales_total', (select coalesce(sum(total), 0) from sales where shop_id = v_shop and legacy_id is not null),
    'credit_outstanding', (select coalesce(sum(balance_due), 0) from sales where shop_id = v_shop and legacy_id is not null and payment_method = 'credit')
                          - (select coalesce(sum(amount), 0) from credit_payments where shop_id = v_shop and legacy_id is not null),
    'stock_units', (select coalesce(sum(m.delta), 0) from stock_movements m where m.shop_id = v_shop and m.ref_id = v_run),
    'repayments_total', (select coalesce(sum(amount), 0) from credit_payments where shop_id = v_shop and legacy_id is not null),
    'expenses_total', (select coalesce(sum(amount), 0) from expenses where shop_id = v_shop and legacy_id is not null),
    'purchases_total', (select coalesce(sum(total), 0) from purchases where shop_id = v_shop and legacy_id is not null));
  for r in select key from jsonb_object_keys(v_exp) as key loop
    -- stock is a snapshot applied only to products created in THIS run, so it can only be checked on a first import
    continue when r.key = 'stock_units' and coalesce(cardinality(v_new_products), 0) <> coalesce((v_exp->>'products')::int, -1);
    v_got := (v_cnt->>r.key)::numeric;
    if v_got is null or abs(v_got - (v_exp->>r.key)::numeric) > 0.011 then
      raise exception 'import_verification_failed: % (phone %, cloud %)', r.key, v_exp->>r.key, v_got;
    end if;
  end loop;

  update migration_runs set status = 'completed', counts = v_cnt, finished_at = now() where id = v_run;
  perform app.audit(v_shop, 'migration.import', 'migration_run', v_run::text, null, v_cnt, 'import from phone backup');
  return jsonb_build_object('status', 'imported', 'run_id', v_run, 'counts', v_cnt);
end $$;

do $$ begin
  revoke all on function import_legacy(jsonb) from public, anon, authenticated;
  grant execute on function import_legacy(jsonb) to authenticated;
end $$;
