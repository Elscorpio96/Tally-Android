-- Row Level Security + privileges (Phase 2)
-- Principles
--   * Deny by default: RLS is enabled on every table and `anon` gets nothing.
--   * The only way to learn "which shop am I in" is the signed-in user's membership (auth.uid()),
--     never a value sent by the client.
--   * Tables that carry money or stock (sales, stock_levels, credit_payments, ...) have NO write
--     policies: they change only through SECURITY DEFINER functions (0003_functions.sql).
--   * Helper functions live in the private `app` schema, which the API does not expose.

-- ---------------------------------------------------------------- helpers
create function app.my_shop() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.shop_id from memberships m join shops s on s.id = m.shop_id
  where m.user_id = auth.uid() and m.active and s.status = 'active'
$$;

create function app.my_role() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select m.role from memberships m join shops s on s.id = m.shop_id
  where m.user_id = auth.uid() and m.active and s.status = 'active'
$$;

create function app.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.my_role() in ('owner','admin'), false)
$$;

create function app.is_manager_up() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.my_role() in ('owner','admin','manager'), false)
$$;

-- may the caller work in / see data of this branch?
create function app.can_branch(b uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.my_shop() is not null
     and exists (select 1 from branches br where br.id = b and br.shop_id = app.my_shop())
     and ( app.is_admin()
        or exists (select 1 from memberships m where m.user_id = auth.uid() and m.branch_id = b)
        or exists (select 1 from branch_access a where a.user_id = auth.uid() and a.branch_id = b) )
$$;

revoke all on function app.my_shop(), app.my_role(), app.is_admin(), app.is_manager_up(), app.can_branch(uuid) from public;
grant usage on schema app to authenticated, service_role;
grant execute on function app.my_shop(), app.my_role(), app.is_admin(), app.is_manager_up(), app.can_branch(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- enable RLS everywhere
alter table shops enable row level security;
alter table profiles enable row level security;
alter table memberships enable row level security;
alter table branches enable row level security;
alter table branch_access enable row level security;
alter table devices enable row level security;
alter table products enable row level security;
alter table stock_levels enable row level security;
alter table stock_movements enable row level security;
alter table stock_discrepancies enable row level security;
alter table customers enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table credit_payments enable row level security;
alter table refunds enable row level security;
alter table refund_items enable row level security;
alter table purchases enable row level security;
alter table purchase_items enable row level security;
alter table expenses enable row level security;
alter table day_closes enable row level security;
alter table audit_log enable row level security;
alter table migration_runs enable row level security;

-- ---------------------------------------------------------------- privileges (least privilege)
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on shops, profiles, memberships, branches, branch_access, devices, products, stock_levels,
  stock_movements, stock_discrepancies, customers, sales, sale_items, credit_payments, refunds, refund_items,
  purchases, purchase_items, expenses, day_closes, audit_log, migration_runs to authenticated;

-- column-level write grants: sensitive columns (status, code, role...) can never be edited directly
grant update (name, tagline, address, phone, timezone, negative_stock_policy) on shops to authenticated;
grant update (display_name) on profiles to authenticated;
grant insert (shop_id, code, name, address, phone) on branches to authenticated;
grant update (name, address, phone, archived_at) on branches to authenticated;
grant insert, update, delete on branch_access to authenticated;
grant insert (id, shop_id, name, sku, barcode, category, cost, price, low_stock, quick) on products to authenticated;
grant update (name, sku, barcode, category, cost, price, low_stock, quick, archived_at) on products to authenticated;
grant insert (id, shop_id, name, phone, legacy_id) on customers to authenticated;
grant update (name, phone, reminded_at, archived_at) on customers to authenticated;
grant insert (shop_id, branch_id, expense_date, category, amount, note, created_by) on expenses to authenticated;
grant update (voided_at) on expenses to authenticated;
grant insert (shop_id, branch_id, close_date, float_amount, counted, expected, difference, note, closed_by, closed_by_name) on day_closes to authenticated;
grant update (float_amount, counted, expected, difference, note, closed_by, closed_by_name, closed_at) on day_closes to authenticated;
grant update (resolved_at, resolved_by) on stock_discrepancies to authenticated;
-- (stock, sales, payments, refunds, purchases, audit and memberships: no direct writes at all)

-- service_role (server-side only: Edge Functions / migration script) keeps full access
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------- policies
-- shops
create policy shops_select on shops for select to authenticated using (id = (select app.my_shop()));
create policy shops_update on shops for update to authenticated
  using (id = (select app.my_shop()) and (select app.is_admin()))
  with check (id = (select app.my_shop()));

-- profiles: myself, and people in my shop
create policy profiles_select on profiles for select to authenticated using (
  id = auth.uid() or exists (select 1 from memberships m where m.user_id = profiles.id and m.shop_id = (select app.my_shop())));
create policy profiles_update on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- memberships: admins see everyone in the shop, others only themselves. No write policies.
create policy memberships_select on memberships for select to authenticated using (
  shop_id = (select app.my_shop()) and ((select app.is_admin()) or user_id = auth.uid()));

-- branches
create policy branches_select on branches for select to authenticated using (
  shop_id = (select app.my_shop()) and ((select app.is_admin()) or app.can_branch(id)));
create policy branches_insert on branches for insert to authenticated with check (
  shop_id = (select app.my_shop()) and (select app.is_admin()));
create policy branches_update on branches for update to authenticated
  using (shop_id = (select app.my_shop()) and (select app.is_admin()))
  with check (shop_id = (select app.my_shop()));

-- branch_access
create policy branch_access_select on branch_access for select to authenticated using (
  shop_id = (select app.my_shop()) and ((select app.is_admin()) or user_id = auth.uid()));
create policy branch_access_write on branch_access for all to authenticated
  using (shop_id = (select app.my_shop()) and (select app.is_admin()))
  with check (shop_id = (select app.my_shop()) and (select app.is_admin()));

-- devices (created by register_device())
create policy devices_select on devices for select to authenticated using (shop_id = (select app.my_shop()) and app.can_branch(branch_id));

-- products: everyone in the shop can read; manager and above can create/edit (archive, never delete)
create policy products_select on products for select to authenticated using (shop_id = (select app.my_shop()));
create policy products_insert on products for insert to authenticated with check (shop_id = (select app.my_shop()) and (select app.is_manager_up()));
create policy products_update on products for update to authenticated
  using (shop_id = (select app.my_shop()) and (select app.is_manager_up()))
  with check (shop_id = (select app.my_shop()));

-- stock: read only, and only for branches the caller may work in
create policy stock_levels_select on stock_levels for select to authenticated using (shop_id = (select app.my_shop()) and app.can_branch(branch_id));
create policy stock_movements_select on stock_movements for select to authenticated using (shop_id = (select app.my_shop()) and (select app.is_manager_up()) and app.can_branch(branch_id));
create policy stock_discrepancies_select on stock_discrepancies for select to authenticated using (shop_id = (select app.my_shop()) and (select app.is_manager_up()) and app.can_branch(branch_id));
create policy stock_discrepancies_update on stock_discrepancies for update to authenticated
  using (shop_id = (select app.my_shop()) and (select app.is_admin())) with check (shop_id = (select app.my_shop()));

-- customers: any member can read/add/edit (cashiers add credit customers); no delete
create policy customers_select on customers for select to authenticated using (shop_id = (select app.my_shop()));
create policy customers_insert on customers for insert to authenticated with check (shop_id = (select app.my_shop()));
create policy customers_update on customers for update to authenticated using (shop_id = (select app.my_shop())) with check (shop_id = (select app.my_shop()));

-- sales: admins see the whole shop, managers their branches, cashiers only their own sales
create policy sales_select on sales for select to authenticated using (
  shop_id = (select app.my_shop()) and app.can_branch(branch_id)
  and ((select app.is_manager_up()) or cashier_id = auth.uid()));
create policy sale_items_select on sale_items for select to authenticated using (
  shop_id = (select app.my_shop()) and exists (select 1 from sales s where s.id = sale_items.sale_id));  -- inherits sales policy

-- credit payments
create policy credit_payments_select on credit_payments for select to authenticated using (
  shop_id = (select app.my_shop()) and app.can_branch(branch_id)
  and ((select app.is_manager_up()) or received_by = auth.uid()));

-- refunds
create policy refunds_select on refunds for select to authenticated using (shop_id = (select app.my_shop()) and (select app.is_manager_up()) and app.can_branch(branch_id));
create policy refund_items_select on refund_items for select to authenticated using (shop_id = (select app.my_shop()) and (select app.is_manager_up()));

-- purchases (manager and above)
create policy purchases_select on purchases for select to authenticated using (shop_id = (select app.my_shop()) and (select app.is_manager_up()) and app.can_branch(branch_id));
create policy purchase_items_select on purchase_items for select to authenticated using (shop_id = (select app.my_shop()) and exists (select 1 from purchases p where p.id = purchase_items.purchase_id));

-- expenses: manager and above add; only admins void
create policy expenses_select on expenses for select to authenticated using (shop_id = (select app.my_shop()) and (select app.is_manager_up()) and app.can_branch(branch_id));
create policy expenses_insert on expenses for insert to authenticated with check (
  shop_id = (select app.my_shop()) and (select app.is_manager_up()) and app.can_branch(branch_id) and created_by = auth.uid());
create policy expenses_void on expenses for update to authenticated
  using (shop_id = (select app.my_shop()) and (select app.is_admin())) with check (shop_id = (select app.my_shop()));

-- day close: anyone working in the branch
create policy day_closes_select on day_closes for select to authenticated using (shop_id = (select app.my_shop()) and app.can_branch(branch_id));
create policy day_closes_insert on day_closes for insert to authenticated with check (
  shop_id = (select app.my_shop()) and app.can_branch(branch_id) and closed_by = auth.uid());
create policy day_closes_update on day_closes for update to authenticated
  using (shop_id = (select app.my_shop()) and app.can_branch(branch_id))
  with check (shop_id = (select app.my_shop()) and app.can_branch(branch_id) and closed_by = auth.uid());

-- audit + migration history: owners/admins read; nobody writes directly
create policy audit_select on audit_log for select to authenticated using (shop_id = (select app.my_shop()) and (select app.is_admin()));
create policy migration_runs_select on migration_runs for select to authenticated using (shop_id = (select app.my_shop()) and (select app.is_admin()));
