-- 0007: discounts, regular-customer discounts, and who may correct a sale after checkout.
-- Safe to run once after 0006.

-- 1. A standing discount on a customer (percent), set by managers/owners, filled in automatically at checkout.
alter table customers add column if not exists discount_pct numeric(5,2) not null default 0 check (discount_pct >= 0 and discount_pct <= 100);
grant insert (discount_pct) on customers to authenticated;
grant update (discount_pct) on customers to authenticated;
create or replace function app.customers_discount_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if ((tg_op = 'INSERT' and new.discount_pct <> 0) or (tg_op = 'UPDATE' and new.discount_pct is distinct from old.discount_pct))
     and auth.uid() is not null and not app.is_manager_up() then
    raise exception 'manager_required' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists customers_discount_guard on customers;
create trigger customers_discount_guard before insert or update on customers for each row execute function app.customers_discount_guard();

-- 2. Cashiers may give discounts (line by line). The discount is stored on the sale and the line; a line can never go below zero.
create or replace function record_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_shop uuid := app.my_shop(); v_role text := app.my_role(); v_uid uuid := auth.uid();
  v_id uuid := (p->>'id')::uuid; v_branch uuid := (p->>'branch_id')::uuid;
  v_sold timestamptz := coalesce((p->>'sold_at')::timestamptz, now());
  v_method text := coalesce(p->>'payment_method', 'cash');
  v_cust uuid := nullif(p#>>'{customer,id}', '')::uuid;
  v_tz text; v_policy text; v_existing uuid; v_name text;
  v_nitems int; v_nfound int; v_subtotal numeric; v_disc numeric; v_total numeric; v_cost numeric;
  v_paid numeric; v_balance numeric; v_bdate date; v_new numeric; v_short numeric;
  v_shorts jsonb := '[]'::jsonb; v_below int; r record;
begin
  perform app.require_member();
  if not app.can_branch(v_branch) then raise exception 'branch_not_allowed' using errcode = '42501'; end if;
  if v_id is null then raise exception 'missing_sale_id'; end if;

  -- idempotency: the same sale id again returns the original result
  select shop_id into v_existing from sales where id = v_id;
  if found then
    if v_existing <> v_shop then raise exception 'id_conflict' using errcode = '23505'; end if;
    return (select jsonb_build_object('status', 'duplicate', 'sale_id', id, 'invoice_no', invoice_no, 'total', total, 'balance_due', balance_due) from sales where id = v_id);
  end if;

  if v_method not in ('cash','credit','transfer','pos') then raise exception 'invalid_payment_method'; end if;
  if v_sold > now() + interval '1 day' then raise exception 'sold_at_in_future'; end if;
  if coalesce(trim(p->>'invoice_no'), '') = '' then raise exception 'missing_invoice_no'; end if;

  select timezone, negative_stock_policy into v_tz, v_policy from shops where id = v_shop;
  v_bdate := (v_sold at time zone v_tz)::date;
  select display_name into v_name from profiles where id = v_uid;

  -- price the lines on the server
  select count(*) into v_nitems from jsonb_array_elements(p->'items');
  if v_nitems = 0 then raise exception 'empty_sale'; end if;
  create temp table if not exists _sale_lines (product_id uuid, qty numeric, unit_price numeric, discount numeric, name text, unit_cost numeric, list_price numeric) on commit drop;
  truncate _sale_lines;
  insert into _sale_lines
    select x.product_id, x.qty, x.unit_price, coalesce(x.discount, 0), pr.name, pr.cost, pr.price
    from jsonb_to_recordset(p->'items') as x(product_id uuid, qty numeric, unit_price numeric, discount numeric)
    join products pr on pr.id = x.product_id and pr.shop_id = v_shop;
  select count(*) into v_nfound from _sale_lines;
  if v_nfound <> v_nitems then raise exception 'unknown_product'; end if;
  if exists (select 1 from _sale_lines where qty is null or qty <= 0 or unit_price is null or unit_price < 0 or discount < 0) then raise exception 'invalid_line'; end if;
  if exists (select 1 from _sale_lines where discount > qty * unit_price) then raise exception 'discount_exceeds_line'; end if;     -- cashiers may give discounts; every one is stored on the sale and shown in reports

  select app.round2(sum(qty * unit_price)), app.round2(sum(discount)), app.round2(sum(qty * unit_price - discount)), app.round2(sum(qty * unit_cost))
    into v_subtotal, v_disc, v_total, v_cost from _sale_lines;
  if v_total < 0 then raise exception 'invalid_total'; end if;
  if p ? 'client_total' and abs((p->>'client_total')::numeric - v_total) > 0.01 then raise exception 'total_mismatch'; end if;

  if v_method = 'credit' then
    if v_cust is null then raise exception 'customer_required'; end if;
    v_paid := coalesce((p->>'amount_paid')::numeric, 0);
    if v_paid < 0 or v_paid > v_total then raise exception 'invalid_deposit'; end if;
    v_balance := v_total - v_paid;
  else
    v_paid := coalesce((p->>'amount_paid')::numeric, v_total);
    if v_paid < v_total then raise exception 'underpaid'; end if;
    v_balance := 0;
  end if;

  if v_cust is not null then
    insert into customers(id, shop_id, name, phone) values (v_cust, v_shop, coalesce(nullif(trim(p#>>'{customer,name}'), ''), 'Customer'), coalesce(p#>>'{customer,phone}', ''))
      on conflict (id) do nothing;
    if not exists (select 1 from customers where id = v_cust and shop_id = v_shop) then raise exception 'customer_not_in_shop' using errcode = '42501'; end if;
  end if;

  begin
    insert into sales(id, shop_id, branch_id, device_id, cashier_id, cashier_name, invoice_no, sold_at, business_date, customer_id,
                      customer_name, customer_phone, payment_method, due_date, subtotal, discount_total, total, cost_total, amount_paid,
                      balance_due, client_created_at)
    values (v_id, v_shop, v_branch, nullif(p->>'device_id', '')::uuid, v_uid, coalesce(v_name, ''), trim(p->>'invoice_no'), v_sold, v_bdate, v_cust,
            coalesce(p#>>'{customer,name}', ''), coalesce(p#>>'{customer,phone}', ''), v_method, nullif(p->>'due_date', '')::date,
            v_subtotal, v_disc, v_total, v_cost, v_paid, v_balance, nullif(p->>'client_created_at', '')::timestamptz);
  exception when unique_violation then
    if exists (select 1 from sales where id = v_id and shop_id = v_shop) then
      return (select jsonb_build_object('status', 'duplicate', 'sale_id', id, 'invoice_no', invoice_no, 'total', total, 'balance_due', balance_due) from sales where id = v_id);
    end if;
    raise exception 'invoice_conflict' using errcode = '23505';
  end;

  insert into sale_items(sale_id, shop_id, product_id, name, qty, unit_price, unit_cost, list_price, discount, line_total)
    select v_id, v_shop, product_id, name, qty, unit_price, unit_cost, list_price, discount, app.round2(qty * unit_price - discount) from _sale_lines;

  -- stock: lock rows in a fixed order so two phones selling the same products cannot deadlock
  for r in select product_id as pid, sum(qty) as q from _sale_lines group by product_id order by product_id loop
    v_new := app.apply_stock(v_shop, v_branch, r.pid, -r.q, 'sale', 'sale', v_id, v_policy = 'allow_flag');
    if v_new < 0 then
      v_short := least(r.q, -v_new);
      insert into stock_discrepancies(shop_id, branch_id, product_id, sale_id, shortfall) values (v_shop, v_branch, r.pid, v_id, v_short);
      v_shorts := v_shorts || jsonb_build_object('product_id', r.pid, 'shortfall', v_short);
    end if;
  end loop;

  select count(*) into v_below from _sale_lines where unit_price < list_price;
  if v_below > 0 and v_role = 'cashier' then
    perform app.audit(v_shop, 'sale.below_list_price', 'sale', v_id::text, null,
      (select jsonb_agg(jsonb_build_object('product_id', product_id, 'unit_price', unit_price, 'list_price', list_price)) from _sale_lines where unit_price < list_price));
  end if;

  return jsonb_build_object('status', 'created', 'sale_id', v_id, 'invoice_no', trim(p->>'invoice_no'), 'total', v_total,
                            'balance_due', v_balance, 'business_date', v_bdate, 'shortfalls', v_shorts);
end $$;
grant execute on function record_sale(jsonb) to authenticated;

-- 3. Correcting a sale after checkout: price and discount per line.
--    owner/admin: any sale. manager: sales in their branches. cashier: only their OWN sales from TODAY (shop time).
--    Every change is audited with who, why, before and after.
create or replace function edit_sale_prices(p_sale uuid, p_prices jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop(); s sales%rowtype; v_before jsonb; v_total numeric; v_paid numeric; v_bal numeric; v_tz text; v_today date;
begin
  perform app.require_member();
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into s from sales where id = p_sale and shop_id = v_shop for update;
  if not found then raise exception 'unknown_sale'; end if;
  select timezone into v_tz from shops where id = v_shop; v_today := (now() at time zone v_tz)::date;
  if app.is_admin() then null;
  elsif app.is_manager_up() then
    if not app.can_branch(s.branch_id) then raise exception 'branch_not_allowed' using errcode = '42501'; end if;
  elsif s.cashier_id = auth.uid() and s.business_date = v_today then null;
  else raise exception 'edit_not_allowed' using errcode = '42501'; end if;
  if s.status <> 'completed' then raise exception 'sale_not_editable'; end if;
  v_before := (select jsonb_build_object('total', s.total, 'discount_total', s.discount_total, 'amount_paid', s.amount_paid, 'balance_due', s.balance_due,
                'items', jsonb_agg(jsonb_build_object('id', id, 'unit_price', unit_price, 'discount', discount))) from sale_items where sale_id = p_sale);
  update sale_items si set unit_price = coalesce(app.round2(x.unit_price), si.unit_price), discount = coalesce(app.round2(x.discount), si.discount)
    from jsonb_to_recordset(p_prices) as x(sale_item_id uuid, product_id uuid, unit_price numeric, discount numeric)
    where si.sale_id = p_sale and si.shop_id = v_shop and coalesce(x.unit_price, 0) >= 0 and coalesce(x.discount, 0) >= 0
      and ((x.sale_item_id is not null and si.id = x.sale_item_id) or (x.sale_item_id is null and si.product_id = x.product_id));
  if exists (select 1 from sale_items where sale_id = p_sale and discount > qty * unit_price) then raise exception 'discount_exceeds_line'; end if;
  update sale_items set line_total = app.round2(qty * unit_price - discount) where sale_id = p_sale;
  select sum(line_total) into v_total from sale_items where sale_id = p_sale;
  if s.payment_method = 'credit' then v_paid := least(s.amount_paid, v_total); v_bal := v_total - v_paid;
  else v_paid := greatest(s.amount_paid, v_total); v_bal := 0; end if;
  update sales set subtotal = (select sum(qty * unit_price) from sale_items where sale_id = p_sale),
         discount_total = (select sum(discount) from sale_items where sale_id = p_sale), total = v_total,
         amount_paid = v_paid, balance_due = v_bal, edited_at = now(), edited_by = auth.uid() where id = p_sale;
  perform app.audit(v_shop, 'sale.edit_prices', 'sale', p_sale::text, v_before,
    jsonb_build_object('total', v_total, 'amount_paid', v_paid, 'balance_due', v_bal, 'prices', p_prices), p_reason);
  return jsonb_build_object('total', v_total, 'amount_paid', v_paid, 'balance_due', v_bal);
end $$;
grant execute on function edit_sale_prices(uuid, jsonb, text) to authenticated;

-- 4. Change stamp now also notices discount changes on customers.
create or replace function shop_stamp() returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'sales',   (select md5(concat(count(*), max(synced_at))) from sales),
    'pay',     (select md5(concat(count(*), max(synced_at))) from credit_payments),
    'stock',   (select md5(concat(count(*), max(updated_at))) from stock_levels),
    'catalog', md5(concat(
                 (select concat(count(*), max(updated_at)) from products),
                 (select coalesce(md5(string_agg(id::text || name || coalesce(phone, '') || coalesce(reminded_at::text, '') || discount_pct::text, '|' order by id)), '') from customers where archived_at is null),
                 (select coalesce(md5(string_agg(id::text || name || code || coalesce(address, '') || coalesce(phone, ''), '|' order by id)), '') from branches where archived_at is null),
                 (select concat(name, tagline, address, phone) from shops limit 1))),
    'books',   md5(concat(
                 (select concat(count(*), coalesce(sum(amount), 0), max(created_at), count(voided_at)) from expenses),
                 (select concat(count(*), coalesce(sum(total), 0), max(created_at)) from purchases),
                 (select concat(count(*), coalesce(sum(counted), 0), coalesce(sum(expected), 0), max(closed_at)) from day_closes))))
$$;
revoke all on function shop_stamp() from public, anon;
grant execute on function shop_stamp() to authenticated;
