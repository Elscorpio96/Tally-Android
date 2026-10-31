-- Server-side business functions (Phase 2).
-- All money/stock changes go through these SECURITY DEFINER functions. Each one:
--   1. resolves the caller's shop/role from auth.uid() (never from client input),
--   2. checks the role and branch access,
--   3. is idempotent where the phone may retry (client-generated UUIDs),
--   4. writes everything in one transaction (a failure rolls the whole thing back).
-- Error codes are the exception messages (e.g. 'insufficient_stock') so the app can react to them.

-- ---------------------------------------------------------------- private helpers
create function app.round2(n numeric) returns numeric language sql immutable as $$ select round(n, 2) $$;

create function app.audit(p_shop uuid, p_action text, p_entity text, p_entity_id text,
                          p_before jsonb, p_after jsonb, p_reason text default '', p_actor uuid default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into audit_log(shop_id, actor_id, actor_name, action, entity, entity_id, before, after, reason)
  values (p_shop, coalesce(p_actor, auth.uid()),
          coalesce((select display_name from profiles where id = coalesce(p_actor, auth.uid())), ''),
          p_action, p_entity, p_entity_id, p_before, p_after, coalesce(p_reason, ''))
$$;

-- Changes stock for one product in one branch under a row lock; writes the ledger row.
-- Returns the new quantity. Raises 'insufficient_stock' when negative is not allowed.
create function app.apply_stock(p_shop uuid, p_branch uuid, p_product uuid, p_delta numeric, p_reason text,
                                p_ref_type text, p_ref_id uuid, p_allow_negative boolean, p_note text default '')
returns numeric language plpgsql security definer set search_path = public, pg_temp as $$
declare v_new numeric;
begin
  insert into stock_levels(product_id, branch_id, shop_id, qty) values (p_product, p_branch, p_shop, 0)
    on conflict (product_id, branch_id) do nothing;
  perform 1 from stock_levels where product_id = p_product and branch_id = p_branch and shop_id = p_shop for update;
  update stock_levels set qty = qty + p_delta, updated_at = now()
    where product_id = p_product and branch_id = p_branch and shop_id = p_shop
    returning qty into v_new;
  if v_new is null then raise exception 'unknown_stock_row'; end if;
  if v_new < 0 and p_delta < 0 and not p_allow_negative then raise exception 'insufficient_stock'; end if;
  insert into stock_movements(shop_id, branch_id, product_id, delta, reason, ref_type, ref_id, note, created_by)
    values (p_shop, p_branch, p_product, p_delta, p_reason, p_ref_type, p_ref_id, coalesce(p_note, ''), auth.uid());
  return v_new;
end $$;

create function app.customer_balance(p_shop uuid, p_customer uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select sum(balance_due) from sales
                    where shop_id = p_shop and customer_id = p_customer and payment_method = 'credit' and status <> 'voided'), 0)
       - coalesce((select sum(amount) from credit_payments where shop_id = p_shop and customer_id = p_customer), 0)
$$;

create function app.require_member() returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin if app.my_shop() is null then raise exception 'not_a_member' using errcode = '42501'; end if; end $$;

-- ---------------------------------------------------------------- onboarding
create function create_shop(p_name text, p_code text, p_display_name text, p_timezone text default 'Africa/Lagos')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_shop uuid; v_branch uuid;
begin
  if v_uid is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if exists (select 1 from memberships where user_id = v_uid) then raise exception 'already_member'; end if;
  if p_code !~ '^[a-z0-9]{3,12}$' then raise exception 'invalid_shop_code'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then raise exception 'invalid_timezone'; end if;
  insert into profiles(id, display_name) values (v_uid, coalesce(nullif(trim(p_display_name), ''), 'Owner'))
    on conflict (id) do update set display_name = excluded.display_name;
  insert into shops(code, name, timezone) values (p_code, trim(p_name), p_timezone) returning id into v_shop;
  insert into branches(shop_id, code, name) values (v_shop, 'MAIN', 'Main Branch') returning id into v_branch;
  insert into memberships(user_id, shop_id, role, branch_id) values (v_uid, v_shop, 'owner', v_branch);
  perform app.audit(v_shop, 'shop.create', 'shop', v_shop::text, null, jsonb_build_object('name', p_name, 'code', p_code));
  return jsonb_build_object('shop_id', v_shop, 'branch_id', v_branch);
end $$;

create function whoami() returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object('user_id', m.user_id, 'shop_id', m.shop_id, 'role', m.role, 'branch_id', m.branch_id,
                          'display_name', p.display_name, 'shop_name', s.name, 'timezone', s.timezone,
                          'negative_stock_policy', s.negative_stock_policy)
     from memberships m join shops s on s.id = m.shop_id join profiles p on p.id = m.user_id
     where m.user_id = auth.uid() and m.active and s.status = 'active'), 'null'::jsonb)
$$;

create function register_device(p_branch uuid, p_name text default '') returns jsonb
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

-- ---------------------------------------------------------------- people (Edge Function creates the auth user first)
create function add_member(p_actor uuid, p_shop uuid, p_user uuid, p_username text, p_name text, p_role text, p_branch uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_role not in ('admin','manager','cashier') then raise exception 'invalid_role'; end if;
  if not exists (select 1 from memberships where user_id = p_actor and shop_id = p_shop and active and role in ('owner','admin')) then
    raise exception 'actor_not_admin' using errcode = '42501'; end if;
  if p_role = 'admin' and not exists (select 1 from memberships where user_id = p_actor and shop_id = p_shop and role = 'owner') then
    raise exception 'only_owner_can_add_admin' using errcode = '42501'; end if;
  insert into profiles(id, display_name, username) values (p_user, p_name, lower(p_username));
  insert into memberships(user_id, shop_id, role, branch_id) values (p_user, p_shop, p_role, p_branch);
  perform app.audit(p_shop, 'member.add', 'member', p_user::text, null, jsonb_build_object('role', p_role, 'branch_id', p_branch, 'username', p_username), '', p_actor);
end $$;

create function set_member(p_user uuid, p_role text, p_branch uuid, p_active boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop(); v_me text := app.my_role(); t memberships%rowtype;
begin
  perform app.require_member();
  if not app.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  select * into t from memberships where user_id = p_user and shop_id = v_shop;
  if not found then raise exception 'unknown_member'; end if;
  if p_user = auth.uid() then raise exception 'cannot_change_self' using errcode = '42501'; end if;
  if t.role = 'owner' then raise exception 'cannot_change_owner' using errcode = '42501'; end if;
  if t.role = 'admin' and v_me <> 'owner' then raise exception 'only_owner_can_change_admin' using errcode = '42501'; end if;
  if p_role not in ('admin','manager','cashier') then raise exception 'invalid_role'; end if;
  if p_role = 'admin' and v_me <> 'owner' then raise exception 'only_owner_can_add_admin' using errcode = '42501'; end if;
  update memberships set role = p_role, branch_id = p_branch, active = p_active where user_id = p_user;
  perform app.audit(v_shop, 'member.update', 'member', p_user::text,
    jsonb_build_object('role', t.role, 'branch_id', t.branch_id, 'active', t.active),
    jsonb_build_object('role', p_role, 'branch_id', p_branch, 'active', p_active), p_reason);
end $$;

-- ---------------------------------------------------------------- selling
-- p = { id, branch_id, device_id?, invoice_no, sold_at, payment_method, due_date?, amount_paid?, client_total?,
--       customer?: {id,name,phone}, items: [ {product_id, qty, unit_price, discount?} ] }
create function record_sale(p jsonb) returns jsonb
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
  if v_role = 'cashier' and exists (select 1 from _sale_lines where discount > 0) then raise exception 'discount_not_allowed' using errcode = '42501'; end if;

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

-- Re-price a recorded sale (owner/admin only), audited with before/after.
create function edit_sale_prices(p_sale uuid, p_prices jsonb, p_reason text) returns jsonb
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
    from jsonb_to_recordset(p_prices) as x(sale_item_id uuid, unit_price numeric)
    where si.id = x.sale_item_id and si.sale_id = p_sale and si.shop_id = v_shop and x.unit_price >= 0;
  select sum(line_total) into v_total from sale_items where sale_id = p_sale;
  if s.payment_method = 'credit' then v_paid := least(s.amount_paid, v_total); v_bal := v_total - v_paid;
  else v_paid := greatest(s.amount_paid, v_total); v_bal := 0; end if;
  update sales set subtotal = (select sum(qty * unit_price) from sale_items where sale_id = p_sale), total = v_total,
         amount_paid = v_paid, balance_due = v_bal, edited_at = now(), edited_by = auth.uid() where id = p_sale;
  perform app.audit(v_shop, 'sale.edit_prices', 'sale', p_sale::text, v_before,
    jsonb_build_object('total', v_total, 'amount_paid', v_paid, 'balance_due', v_bal, 'prices', p_prices), p_reason);
  return jsonb_build_object('total', v_total, 'amount_paid', v_paid, 'balance_due', v_bal);
end $$;

create function void_sale(p_sale uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop(); s sales%rowtype; r record;
begin
  perform app.require_member();
  if not app.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into s from sales where id = p_sale and shop_id = v_shop for update;
  if not found then raise exception 'unknown_sale'; end if;
  if s.status <> 'completed' then raise exception 'sale_not_voidable'; end if;
  for r in select product_id as pid, sum(qty) as q from sale_items where sale_id = p_sale and product_id is not null group by product_id order by product_id loop
    perform app.apply_stock(v_shop, s.branch_id, r.pid, r.q, 'void', 'sale', p_sale, true);
  end loop;
  update sales set status = 'voided' where id = p_sale;
  perform app.audit(v_shop, 'sale.void', 'sale', p_sale::text,
    jsonb_build_object('status', s.status, 'total', s.total, 'balance_due', s.balance_due), jsonb_build_object('status', 'voided'), p_reason);
  return jsonb_build_object('status', 'voided');
end $$;

-- p_items = [ {sale_item_id, qty} ]
create function refund_sale(p_sale uuid, p_items jsonb, p_restock boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop(); s sales%rowtype; v_refund uuid := gen_random_uuid(); v_amount numeric := 0; v_line numeric;
        v_back numeric; v_cash numeric; r record; v_open numeric;
begin
  perform app.require_member();
  if not app.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into s from sales where id = p_sale and shop_id = v_shop for update;
  if not found then raise exception 'unknown_sale'; end if;
  if s.status in ('voided','refunded') then raise exception 'sale_not_refundable'; end if;
  insert into refunds(id, shop_id, sale_id, branch_id, amount, cash_back, restock, reason, created_by)
    values (v_refund, v_shop, p_sale, s.branch_id, 0.01, 0, coalesce(p_restock, true), p_reason, auth.uid());  -- amounts set below
  for r in select x.sale_item_id, x.qty, si.qty as sold, si.line_total, si.product_id,
                  coalesce((select sum(ri.qty) from refund_items ri where ri.sale_item_id = si.id), 0) as already
           from jsonb_to_recordset(p_items) as x(sale_item_id uuid, qty numeric)
           join sale_items si on si.id = x.sale_item_id and si.sale_id = p_sale and si.shop_id = v_shop loop
    if r.qty <= 0 or r.qty > r.sold - r.already then raise exception 'refund_qty_too_high'; end if;
    v_line := app.round2(r.line_total * r.qty / r.sold);
    insert into refund_items(refund_id, sale_item_id, shop_id, qty, amount) values (v_refund, r.sale_item_id, v_shop, r.qty, v_line);
    v_amount := v_amount + v_line;
    if coalesce(p_restock, true) and r.product_id is not null then
      perform app.apply_stock(v_shop, s.branch_id, r.product_id, r.qty, 'refund', 'refund', v_refund, true);
    end if;
  end loop;
  if v_amount <= 0 then raise exception 'nothing_to_refund'; end if;
  v_back := least(s.balance_due, v_amount);      -- first reduce what the customer still owes
  v_cash := v_amount - v_back;
  update refunds set amount = v_amount, cash_back = v_cash where id = v_refund;
  select coalesce(sum(si.qty - coalesce((select sum(ri.qty) from refund_items ri where ri.sale_item_id = si.id), 0)), 0) into v_open
    from sale_items si where si.sale_id = p_sale;
  update sales set refunded_total = refunded_total + v_amount, balance_due = balance_due - v_back,
                   status = case when v_open <= 0 then 'refunded' else 'partially_refunded' end where id = p_sale;
  perform app.audit(v_shop, 'sale.refund', 'sale', p_sale::text, jsonb_build_object('refunded_total', s.refunded_total),
    jsonb_build_object('refund_id', v_refund, 'amount', v_amount, 'cash_back', v_cash, 'restock', coalesce(p_restock, true)), p_reason);
  return jsonb_build_object('refund_id', v_refund, 'amount', v_amount, 'cash_back', v_cash, 'balance_due', s.balance_due - v_back);
end $$;

-- ---------------------------------------------------------------- stock, purchases, repayments
create function adjust_stock(p_branch uuid, p_product uuid, p_new_qty numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop(); v_old numeric; v_new numeric;
begin
  perform app.require_member();
  if not app.is_manager_up() then raise exception 'manager_required' using errcode = '42501'; end if;
  if not app.can_branch(p_branch) then raise exception 'branch_not_allowed' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  if p_new_qty < 0 then raise exception 'invalid_quantity'; end if;
  if not exists (select 1 from products where id = p_product and shop_id = v_shop) then raise exception 'unknown_product'; end if;
  insert into stock_levels(product_id, branch_id, shop_id, qty) values (p_product, p_branch, v_shop, 0) on conflict do nothing;
  select qty into v_old from stock_levels where product_id = p_product and branch_id = p_branch for update;
  v_new := app.apply_stock(v_shop, p_branch, p_product, p_new_qty - v_old, 'adjustment', 'adjustment', null, true, p_reason);
  perform app.audit(v_shop, 'stock.adjust', 'product', p_product::text, jsonb_build_object('branch_id', p_branch, 'qty', v_old),
                    jsonb_build_object('branch_id', p_branch, 'qty', v_new), p_reason);
  return jsonb_build_object('old_qty', v_old, 'new_qty', v_new);
end $$;

-- p = { id, branch_id, supplier, purchase_date, items: [ {product_id, qty, unit_cost} ] }
create function receive_purchase(p jsonb) returns jsonb
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

-- p = { id, branch_id, device_id?, customer_id, receipt_no, amount, paid_at, note? }
create function record_credit_payment(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop(); v_id uuid := (p->>'id')::uuid; v_branch uuid := (p->>'branch_id')::uuid;
        v_cust uuid := (p->>'customer_id')::uuid; v_amt numeric := (p->>'amount')::numeric; v_tz text; v_paid timestamptz;
        v_ex uuid; v_before numeric; v_name text;
begin
  perform app.require_member();
  if not app.can_branch(v_branch) then raise exception 'branch_not_allowed' using errcode = '42501'; end if;
  select shop_id into v_ex from credit_payments where id = v_id;
  if found then
    if v_ex <> v_shop then raise exception 'id_conflict' using errcode = '23505'; end if;
    return jsonb_build_object('status', 'duplicate', 'balance_after', app.customer_balance(v_shop, v_cust));
  end if;
  if v_amt is null or v_amt <= 0 then raise exception 'invalid_amount'; end if;
  if not exists (select 1 from customers where id = v_cust and shop_id = v_shop) then raise exception 'unknown_customer'; end if;
  select timezone into v_tz from shops where id = v_shop;
  v_paid := coalesce((p->>'paid_at')::timestamptz, now());
  if v_paid > now() + interval '1 day' then raise exception 'paid_at_in_future'; end if;
  select display_name into v_name from profiles where id = auth.uid();
  v_before := app.customer_balance(v_shop, v_cust);
  begin
    insert into credit_payments(id, shop_id, branch_id, device_id, customer_id, receipt_no, amount, paid_at, business_date, note, received_by, received_by_name)
    values (v_id, v_shop, v_branch, nullif(p->>'device_id', '')::uuid, v_cust, trim(p->>'receipt_no'), v_amt, v_paid,
            (v_paid at time zone v_tz)::date, coalesce(p->>'note', ''), auth.uid(), coalesce(v_name, ''));
  exception when unique_violation then
    if exists (select 1 from credit_payments where id = v_id and shop_id = v_shop) then
      return jsonb_build_object('status', 'duplicate', 'balance_after', app.customer_balance(v_shop, v_cust)); end if;
    raise exception 'receipt_conflict' using errcode = '23505';
  end;
  if v_amt > v_before then   -- accepted (money was really received) but flagged
    perform app.audit(v_shop, 'payment.overpayment', 'credit_payment', v_id::text, jsonb_build_object('balance_before', v_before), jsonb_build_object('amount', v_amt));
  end if;
  return jsonb_build_object('status', 'created', 'balance_after', v_before - v_amt);
end $$;

-- ---------------------------------------------------------------- customer balances (cashiers need these to take repayments)
create function get_customer_balances() returns table (customer_id uuid, name text, phone text, balance numeric, credit_sales bigint, last_credit_date date, reminded_at date)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop();
begin
  perform app.require_member();
  return query
  select c.id, c.name, c.phone, app.customer_balance(v_shop, c.id),
         (select count(*) from sales s where s.shop_id = v_shop and s.customer_id = c.id and s.payment_method = 'credit' and s.status <> 'voided'),
         (select max(s.business_date) from sales s where s.shop_id = v_shop and s.customer_id = c.id and s.payment_method = 'credit' and s.status <> 'voided'),
         c.reminded_at
  from customers c where c.shop_id = v_shop and c.archived_at is null
    and (exists (select 1 from sales s where s.customer_id = c.id and s.payment_method = 'credit') or exists (select 1 from credit_payments cp where cp.customer_id = c.id))
  order by 4 desc;
end $$;

create function get_customer_ledger(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop();
begin
  perform app.require_member();
  if not exists (select 1 from customers where id = p_customer and shop_id = v_shop) then raise exception 'unknown_customer'; end if;
  return jsonb_build_object(
    'balance', app.customer_balance(v_shop, p_customer),
    'sales', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'invoice_no', invoice_no, 'date', business_date, 'total', total,
              'balance_due', balance_due, 'due_date', due_date, 'status', status) order by sold_at desc)
              from sales where shop_id = v_shop and customer_id = p_customer and payment_method = 'credit'), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'receipt_no', receipt_no, 'date', business_date, 'amount', amount, 'note', note) order by paid_at desc)
              from credit_payments where shop_id = v_shop and customer_id = p_customer), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- function privileges
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'app') and p.prokind = 'f' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function create_shop(text, text, text, text), whoami(), register_device(uuid, text), set_member(uuid, text, uuid, boolean, text),
  record_sale(jsonb), edit_sale_prices(uuid, jsonb, text), void_sale(uuid, text), refund_sale(uuid, jsonb, boolean, text),
  adjust_stock(uuid, uuid, numeric, text), receive_purchase(jsonb), record_credit_payment(jsonb),
  get_customer_balances(), get_customer_ledger(uuid) to authenticated;
-- add_member is for the staff-creation Edge Function only (service role key, server side)
grant execute on function add_member(uuid, uuid, uuid, text, text, text, uuid) to service_role;
-- RLS helper functions must stay callable by signed-in users
grant execute on function app.my_shop(), app.my_role(), app.is_admin(), app.is_manager_up(), app.can_branch(uuid) to authenticated, service_role;
