-- 0006: what the phone app needs once a shop runs in Cloud mode.

-- 1. Client-made IDs for expenses and branches, so a retried upload can never create a second row.
grant insert (id) on expenses to authenticated;
grant insert (id) on branches to authenticated;

-- 2. Any change to a sale (void, refund, price edit) bumps synced_at, so phones that pull "everything
--    changed since last time" also pick up corrections.
create function app.touch_sale_synced() returns trigger language plpgsql as $$
begin new.synced_at := now(); return new; end $$;
create trigger sales_touch_synced before update on sales for each row execute function app.touch_sale_synced();

-- 3. Manual stock correction as a DIFFERENCE, safe to retry (the request id is remembered in the stock ledger).
--    Using a difference (not "set to X") means two phones selling while one is offline never overwrite each other.
create function adjust_stock_by(p_request uuid, p_branch uuid, p_product uuid, p_delta numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop(); v_new numeric;
begin
  perform app.require_member();
  if not app.is_manager_up() then raise exception 'manager_required' using errcode = '42501'; end if;
  if not app.can_branch(p_branch) then raise exception 'branch_not_allowed' using errcode = '42501'; end if;
  if p_delta is null or p_delta = 0 then raise exception 'invalid_quantity'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  if not exists (select 1 from products where id = p_product and shop_id = v_shop) then raise exception 'unknown_product'; end if;
  perform pg_advisory_xact_lock(hashtextextended('adjust:' || p_request::text, 0));      -- two copies of the same request arriving together: the second waits, then sees the first
  if exists (select 1 from stock_movements where shop_id = v_shop and ref_type = 'adjustment' and ref_id = p_request) then
    return jsonb_build_object('status', 'duplicate');
  end if;
  v_new := app.apply_stock(v_shop, p_branch, p_product, p_delta, 'adjustment', 'adjustment', p_request, true, p_reason);
  perform app.audit(v_shop, 'stock.adjust', 'product', p_product::text, null,
                    jsonb_build_object('branch_id', p_branch, 'delta', p_delta, 'new_qty', v_new), p_reason);
  return jsonb_build_object('status', 'created', 'new_qty', v_new);
end $$;

-- 4. Price edits can name a line by product (the phone does not know the server's line ids).
create or replace function edit_sale_prices(p_sale uuid, p_prices jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop(); s sales%rowtype; v_before jsonb; v_total numeric; v_paid numeric; v_bal numeric;
begin
  perform app.require_member();
  if not app.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into s from sales where id = p_sale and shop_id = v_shop for update;
  if not found then raise exception 'unknown_sale'; end if;
  if s.status <> 'completed' then raise exception 'sale_not_editable'; end if;
  v_before := (select jsonb_build_object('total', s.total, 'amount_paid', s.amount_paid, 'balance_due', s.balance_due,
                'items', jsonb_agg(jsonb_build_object('id', id, 'unit_price', unit_price))) from sale_items where sale_id = p_sale);
  update sale_items si set unit_price = app.round2((x.unit_price)::numeric), line_total = app.round2(si.qty * x.unit_price - si.discount)
    from jsonb_to_recordset(p_prices) as x(sale_item_id uuid, product_id uuid, unit_price numeric)
    where si.sale_id = p_sale and si.shop_id = v_shop and x.unit_price >= 0
      and ((x.sale_item_id is not null and si.id = x.sale_item_id) or (x.sale_item_id is null and si.product_id = x.product_id));
  select sum(line_total) into v_total from sale_items where sale_id = p_sale;
  if s.payment_method = 'credit' then v_paid := least(s.amount_paid, v_total); v_bal := v_total - v_paid;
  else v_paid := greatest(s.amount_paid, v_total); v_bal := 0; end if;
  update sales set subtotal = (select sum(qty * unit_price) from sale_items where sale_id = p_sale), total = v_total,
         amount_paid = v_paid, balance_due = v_bal, edited_at = now(), edited_by = auth.uid() where id = p_sale;
  perform app.audit(v_shop, 'sale.edit_prices', 'sale', p_sale::text, v_before,
    jsonb_build_object('total', v_total, 'amount_paid', v_paid, 'balance_due', v_bal, 'prices', p_prices), p_reason);
  return jsonb_build_object('total', v_total, 'amount_paid', v_paid, 'balance_due', v_bal);
end $$;

-- 5. Totals for the "does the cloud match this phone?" check. Same keys the phone computes itself.
create function cloud_totals() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop();
begin
  perform app.require_member();
  if not app.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'products', (select count(*) from products where shop_id = v_shop and archived_at is null),
    'customers', (select count(*) from customers where shop_id = v_shop and archived_at is null and coalesce(legacy_id, '') not like 'auto-%'),
    'customers_all', (select count(*) from customers where shop_id = v_shop and archived_at is null),
    'sales', (select count(*) from sales where shop_id = v_shop and status <> 'voided'),
    'sales_total', (select coalesce(sum(total), 0) from sales where shop_id = v_shop and status <> 'voided'),
    'credit_outstanding', (select coalesce(sum(balance_due), 0) from sales where shop_id = v_shop and status <> 'voided' and payment_method = 'credit')
                          - (select coalesce(sum(amount), 0) from credit_payments where shop_id = v_shop),
    'stock_units', (select coalesce(sum(l.qty), 0) from stock_levels l join products p on p.id = l.product_id and p.shop_id = l.shop_id where l.shop_id = v_shop and p.archived_at is null),
    'repayments_total', (select coalesce(sum(amount), 0) from credit_payments where shop_id = v_shop),
    'expenses_total', (select coalesce(sum(amount), 0) from expenses where shop_id = v_shop and voided_at is null),
    'purchases_total', (select coalesce(sum(total), 0) from purchases where shop_id = v_shop));
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('adjust_stock_by', 'cloud_totals', 'edit_sale_prices') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- day closes are written by the phone with its own closing time
grant insert (closed_at) on day_closes to authenticated;

-- FIX for projects that already ran 0003: register_device used gen_random_bytes(), which is not on the function's search_path on Supabase.
create or replace function register_device(p_branch uuid, p_name text default '') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop(); v_code text; v_id uuid; v_bcode text; i int := 0;
begin
  perform app.require_member();
  if not app.can_branch(p_branch) then raise exception 'branch_not_allowed' using errcode = '42501'; end if;
  loop
    v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 3));   -- no extension needed (pgcrypto lives in the "extensions" schema on Supabase)
    exit when not exists (select 1 from devices where shop_id = v_shop and code = v_code);
    i := i + 1; if i > 50 then raise exception 'device_code_exhausted'; end if;
  end loop;
  insert into devices(shop_id, branch_id, code, name, registered_by) values (v_shop, p_branch, v_code, coalesce(p_name, ''), auth.uid())
    returning id into v_id;
  select code into v_bcode from branches where id = p_branch;
  return jsonb_build_object('device_id', v_id, 'code', v_code, 'invoice_prefix', v_bcode || '-' || v_code);
end $$;
grant execute on function register_device(uuid, text) to authenticated;

-- FIX: a retry of the same purchase arriving at the same moment as the first copy must be answered 'duplicate', not an error.
create or replace function receive_purchase(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop(); v_id uuid := (p->>'id')::uuid; v_branch uuid := (p->>'branch_id')::uuid;
        v_total numeric; v_n int; v_found int; v_ex uuid; r record;
begin
  perform app.require_member();
  if not app.is_manager_up() then raise exception 'manager_required' using errcode = '42501'; end if;
  if not app.can_branch(v_branch) then raise exception 'branch_not_allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('purchase:' || v_id::text, 0));      -- a retry arriving while the first copy is still being saved waits for it
  select shop_id into v_ex from purchases where id = v_id;
  if found then
    if v_ex <> v_shop then raise exception 'id_conflict' using errcode = '23505'; end if;
    return jsonb_build_object('status', 'duplicate', 'purchase_id', v_id);
  end if;
  select count(*) into v_n from jsonb_array_elements(p->'items');
  select count(*), sum(x.qty * x.unit_cost) into v_found, v_total
    from jsonb_to_recordset(p->'items') as x(product_id uuid, qty numeric, unit_cost numeric)
    join products pr on pr.id = x.product_id and pr.shop_id = v_shop where x.qty > 0 and x.unit_cost >= 0;
  if v_n = 0 or v_found <> v_n then raise exception 'invalid_purchase_lines'; end if;
  insert into purchases(id, shop_id, branch_id, supplier, purchase_date, total, created_by)
    values (v_id, v_shop, v_branch, p->>'supplier', coalesce((p->>'purchase_date')::date, current_date), app.round2(v_total), auth.uid());
  insert into purchase_items(purchase_id, shop_id, product_id, name, qty, unit_cost)
    select v_id, v_shop, x.product_id, pr.name, x.qty, x.unit_cost
    from jsonb_to_recordset(p->'items') as x(product_id uuid, qty numeric, unit_cost numeric) join products pr on pr.id = x.product_id;
  for r in select x.product_id as pid, sum(x.qty) as q, max(x.unit_cost) as c
           from jsonb_to_recordset(p->'items') as x(product_id uuid, qty numeric, unit_cost numeric) group by x.product_id order by x.product_id loop
    perform app.apply_stock(v_shop, v_branch, r.pid, r.q, 'purchase', 'purchase', v_id, true);
    if r.c > 0 then update products set cost = r.c where id = r.pid and shop_id = v_shop; end if;   -- same rule as the app today
  end loop;
  return jsonb_build_object('status', 'created', 'purchase_id', v_id, 'total', app.round2(v_total));
end $$;
grant execute on function receive_purchase(jsonb) to authenticated;

-- Cheap "has anything changed?" check so phones do not re-download the whole shop every minute (free plan: 5 GB/month of downloads).
-- Runs as the caller, so each person's stamp only reflects what they are allowed to see.
create or replace function shop_stamp() returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'sales',   (select md5(concat(count(*), max(synced_at))) from sales),
    'pay',     (select md5(concat(count(*), max(synced_at))) from credit_payments),
    'stock',   (select md5(concat(count(*), max(updated_at))) from stock_levels),
    'catalog', md5(concat(
                 (select concat(count(*), max(updated_at)) from products),
                 (select coalesce(md5(string_agg(id::text || name || coalesce(phone, '') || coalesce(reminded_at::text, ''), '|' order by id)), '') from customers where archived_at is null),
                 (select coalesce(md5(string_agg(id::text || name || code || coalesce(address, '') || coalesce(phone, ''), '|' order by id)), '') from branches where archived_at is null),
                 (select concat(name, tagline, address, phone) from shops limit 1))),
    'books',   md5(concat(
                 (select concat(count(*), coalesce(sum(amount), 0), max(created_at), count(voided_at)) from expenses),
                 (select concat(count(*), coalesce(sum(total), 0), max(created_at)) from purchases),
                 (select concat(count(*), coalesce(sum(counted), 0), coalesce(sum(expected), 0), max(closed_at)) from day_closes))))
$$;
revoke all on function shop_stamp() from public, anon;
grant execute on function shop_stamp() to authenticated;
