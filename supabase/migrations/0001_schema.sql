-- Ilelah Business Suite: cloud schema (Phase 2)
-- Multi-tenant: every business table carries shop_id. Cross-tenant references are blocked by
-- composite foreign keys (child.parent_id, child.shop_id) -> parent(id, shop_id).
-- Money is numeric(14,2); quantities numeric(12,3); all timestamps are timestamptz (UTC).

create schema if not exists app;   -- private helpers, NOT exposed through the API

-- ---------------------------------------------------------------- tenants & people
create table shops (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9]{3,12}$'),
  name text not null check (length(trim(name)) > 0),
  tagline text not null default '',
  address text not null default '',
  phone text not null default '',
  timezone text not null default 'Africa/Lagos',
  currency text not null default 'NGN',
  negative_stock_policy text not null default 'allow_flag' check (negative_stock_policy in ('allow_flag','reject')),
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

create table profiles (                      -- one row per signed-in person (auth.users.id)
  id uuid primary key,
  display_name text not null default '',
  username text,                              -- staff login name (owners may leave empty)
  created_at timestamptz not null default now()
);

create table memberships (                   -- a person belongs to exactly one shop
  user_id uuid primary key references profiles(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','cashier')),
  branch_id uuid,                             -- home branch (required for manager/cashier)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, shop_id)
);
create index memberships_shop_idx on memberships(shop_id);

create table branches (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{2,6}$'),
  name text not null,
  address text not null default '',
  phone text not null default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  legacy_id text,
  unique (id, shop_id),
  unique (shop_id, code),
  unique (shop_id, legacy_id)
);
alter table memberships add constraint memberships_branch_fk foreign key (branch_id, shop_id) references branches(id, shop_id);

create table branch_access (                 -- extra branches a manager/cashier may work in
  user_id uuid not null,
  shop_id uuid not null,
  branch_id uuid not null,
  primary key (user_id, branch_id),
  foreign key (user_id, shop_id) references memberships(user_id, shop_id) on delete cascade,
  foreign key (branch_id, shop_id) references branches(id, shop_id) on delete cascade
);

create table devices (                       -- each phone that sells; its code prefixes invoice numbers
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  branch_id uuid not null,
  code text not null check (code ~ '^[A-Z0-9]{3}$'),
  name text not null default '',
  registered_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (id, shop_id),
  unique (shop_id, code),
  foreign key (branch_id, shop_id) references branches(id, shop_id)
);

-- ---------------------------------------------------------------- catalogue & stock
create table products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sku text not null,
  barcode text not null default '',
  category text not null default '',
  cost numeric(14,2) not null default 0 check (cost >= 0),
  price numeric(14,2) not null default 0 check (price >= 0),
  low_stock numeric(12,3) not null default 0,
  quick boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_id text,
  unique (id, shop_id),
  unique (shop_id, legacy_id)
);
create unique index products_sku_idx on products(shop_id, lower(sku)) where archived_at is null;
create unique index products_barcode_idx on products(shop_id, barcode) where barcode <> '' and archived_at is null;
create index products_name_idx on products(shop_id, lower(name));

create table stock_levels (                  -- changed ONLY by server functions
  product_id uuid not null,
  branch_id uuid not null,
  shop_id uuid not null,
  qty numeric(12,3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (product_id, branch_id),
  foreign key (product_id, shop_id) references products(id, shop_id) on delete cascade,
  foreign key (branch_id, shop_id) references branches(id, shop_id)
);
create index stock_levels_shop_branch_idx on stock_levels(shop_id, branch_id);

create table stock_movements (               -- append-only ledger behind stock_levels
  id bigint generated always as identity primary key,
  shop_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  delta numeric(12,3) not null,
  reason text not null check (reason in ('sale','void','refund','purchase','adjustment','migration')),
  ref_type text,
  ref_id uuid,
  note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (product_id, shop_id) references products(id, shop_id),
  foreign key (branch_id, shop_id) references branches(id, shop_id)
);
create index stock_movements_product_idx on stock_movements(shop_id, product_id, created_at desc);
create index stock_movements_ref_idx on stock_movements(ref_id);

create table stock_discrepancies (           -- sale accepted while stock was short (offline conflict)
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  sale_id uuid,
  shortfall numeric(12,3) not null check (shortfall > 0),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  foreign key (product_id, shop_id) references products(id, shop_id),
  foreign key (branch_id, shop_id) references branches(id, shop_id)
);
create index stock_discrepancies_open_idx on stock_discrepancies(shop_id) where resolved_at is null;

-- ---------------------------------------------------------------- customers & sales
create table customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text not null default '',
  reminded_at date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  legacy_id text,
  unique (id, shop_id),
  unique (shop_id, legacy_id)
);
create index customers_name_idx on customers(shop_id, lower(name));

create table sales (
  id uuid primary key,                       -- generated on the phone: this is the idempotency key
  shop_id uuid not null references shops(id) on delete cascade,
  branch_id uuid not null,
  device_id uuid,
  cashier_id uuid not null references profiles(id),
  cashier_name text not null default '',
  invoice_no text not null,
  sold_at timestamptz not null,
  business_date date not null,               -- derived on the server in the shop's time zone
  customer_id uuid,
  customer_name text not null default '',
  customer_phone text not null default '',
  payment_method text not null check (payment_method in ('cash','credit','transfer','pos')),
  due_date date,
  subtotal numeric(14,2) not null check (subtotal >= 0),
  discount_total numeric(14,2) not null default 0 check (discount_total >= 0),
  total numeric(14,2) not null check (total >= 0),
  cost_total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  balance_due numeric(14,2) not null default 0 check (balance_due >= 0),
  refunded_total numeric(14,2) not null default 0 check (refunded_total >= 0),
  status text not null default 'completed' check (status in ('completed','partially_refunded','refunded','voided')),
  edited_at timestamptz,
  edited_by uuid,
  client_created_at timestamptz,
  synced_at timestamptz not null default now(),
  legacy_id text,
  unique (id, shop_id),
  unique (shop_id, invoice_no),
  unique (shop_id, legacy_id),
  foreign key (branch_id, shop_id) references branches(id, shop_id),
  foreign key (device_id, shop_id) references devices(id, shop_id),
  foreign key (customer_id, shop_id) references customers(id, shop_id),
  check (payment_method <> 'credit' or customer_id is not null)
);
create index sales_shop_date_idx on sales(shop_id, business_date desc, branch_id);
create index sales_cashier_idx on sales(shop_id, cashier_id, sold_at desc);
create index sales_customer_idx on sales(shop_id, customer_id) where payment_method = 'credit';
create index sales_synced_idx on sales(shop_id, synced_at desc);

create table sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null,
  shop_id uuid not null,
  product_id uuid,
  name text not null,
  qty numeric(12,3) not null check (qty > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  list_price numeric(14,2),                   -- catalogue price at sync time, for exception reports
  discount numeric(14,2) not null default 0 check (discount >= 0),
  line_total numeric(14,2) not null,
  foreign key (sale_id, shop_id) references sales(id, shop_id) on delete cascade,
  foreign key (product_id, shop_id) references products(id, shop_id),
  unique (id, shop_id)
);
create index sale_items_sale_idx on sale_items(sale_id);
create index sale_items_product_idx on sale_items(shop_id, product_id);

create table credit_payments (               -- repayments of credit; deposits live on the sale
  id uuid primary key,                       -- client generated (idempotency key)
  shop_id uuid not null references shops(id) on delete cascade,
  branch_id uuid not null,
  device_id uuid,
  customer_id uuid not null,
  receipt_no text not null,
  amount numeric(14,2) not null check (amount > 0),
  paid_at timestamptz not null,
  business_date date not null,
  note text not null default '',
  received_by uuid not null references profiles(id),
  received_by_name text not null default '',
  synced_at timestamptz not null default now(),
  legacy_id text,
  unique (shop_id, receipt_no),
  unique (shop_id, legacy_id),
  foreign key (branch_id, shop_id) references branches(id, shop_id),
  foreign key (device_id, shop_id) references devices(id, shop_id),
  foreign key (customer_id, shop_id) references customers(id, shop_id)
);
create index credit_payments_customer_idx on credit_payments(shop_id, customer_id);
create index credit_payments_date_idx on credit_payments(shop_id, business_date desc, branch_id);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  sale_id uuid not null,
  branch_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  cash_back numeric(14,2) not null default 0 check (cash_back >= 0),
  restock boolean not null default true,
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (sale_id, shop_id) references sales(id, shop_id),
  foreign key (branch_id, shop_id) references branches(id, shop_id)
);
create index refunds_sale_idx on refunds(sale_id);
create table refund_items (
  refund_id uuid not null references refunds(id) on delete cascade,
  sale_item_id uuid not null,
  shop_id uuid not null,
  qty numeric(12,3) not null check (qty > 0),
  amount numeric(14,2) not null check (amount >= 0),
  primary key (refund_id, sale_item_id),
  foreign key (sale_item_id, shop_id) references sale_items(id, shop_id)
);

-- ---------------------------------------------------------------- purchases, expenses, day close
create table purchases (
  id uuid primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  branch_id uuid not null,
  supplier text not null check (length(trim(supplier)) > 0),
  purchase_date date not null,
  total numeric(14,2) not null check (total >= 0),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  legacy_id text,
  unique (id, shop_id),
  unique (shop_id, legacy_id),
  foreign key (branch_id, shop_id) references branches(id, shop_id)
);
create index purchases_date_idx on purchases(shop_id, purchase_date desc, branch_id);
create table purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null,
  shop_id uuid not null,
  product_id uuid not null,
  name text not null,
  qty numeric(12,3) not null check (qty > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  foreign key (purchase_id, shop_id) references purchases(id, shop_id) on delete cascade,
  foreign key (product_id, shop_id) references products(id, shop_id)
);
create index purchase_items_purchase_idx on purchase_items(purchase_id);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  branch_id uuid not null,
  expense_date date not null,
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  note text not null default '',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  legacy_id text,
  unique (shop_id, legacy_id),
  foreign key (branch_id, shop_id) references branches(id, shop_id)
);
create index expenses_date_idx on expenses(shop_id, expense_date desc, branch_id);

create table day_closes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  branch_id uuid not null,
  close_date date not null,
  float_amount numeric(14,2) not null default 0,
  counted numeric(14,2),
  expected numeric(14,2) not null default 0,
  difference numeric(14,2),
  note text not null default '',
  closed_by uuid not null references profiles(id),
  closed_by_name text not null default '',
  closed_at timestamptz not null default now(),
  unique (branch_id, close_date),
  foreign key (branch_id, shop_id) references branches(id, shop_id)
);

-- ---------------------------------------------------------------- audit & migration bookkeeping
create table audit_log (                     -- append-only (enforced by trigger below)
  id bigint generated always as identity primary key,
  shop_id uuid not null,
  actor_id uuid,
  actor_name text not null default '',
  action text not null,                      -- e.g. sale.void, sale.edit_prices, stock.adjust, member.role_change
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index audit_shop_time_idx on audit_log(shop_id, created_at desc);
create index audit_entity_idx on audit_log(shop_id, entity, entity_id);

create table migration_runs (                -- makes the local->cloud import repeatable and duplicate-proof
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  source_hash text not null,                 -- hash of the exported local backup
  status text not null default 'running' check (status in ('running','completed','failed','rolled_back')),
  counts jsonb not null default '{}'::jsonb,
  started_by uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (shop_id, source_hash)
);

-- ---------------------------------------------------------------- triggers
create function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger products_touch before update on products for each row execute function app.touch_updated_at();

create function app.deny_mutation() returns trigger language plpgsql as $$
begin raise exception 'append-only table % cannot be changed', tg_table_name using errcode = '42501'; end $$;
create trigger audit_log_immutable before update or delete on audit_log for each row execute function app.deny_mutation();
create trigger stock_movements_immutable before update or delete on stock_movements for each row execute function app.deny_mutation();
