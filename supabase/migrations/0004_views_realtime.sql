-- 0004: reporting views (security_invoker => RLS of the caller applies) + realtime publication
create or replace view v_daily_sales with (security_invoker = true) as
select shop_id, branch_id, business_date,
       count(*) filter (where status <> 'voided')                       as sale_count,
       coalesce(sum(total)       filter (where status <> 'voided'),0)   as revenue,
       coalesce(sum(cost_total)  filter (where status <> 'voided'),0)   as cost,
       coalesce(sum(amount_paid) filter (where status <> 'voided'),0)   as collected,
       coalesce(sum(balance_due) filter (where status <> 'voided'),0)   as credit_outstanding,
       coalesce(sum(refunded_total),0)                                  as refunded
from sales group by shop_id, branch_id, business_date;

create or replace view v_sales_by_cashier with (security_invoker = true) as
select shop_id, branch_id, business_date, cashier_id,
       count(*) as sale_count, coalesce(sum(total),0) as revenue
from sales where status <> 'voided'
group by shop_id, branch_id, business_date, cashier_id;

create or replace view v_product_sales with (security_invoker = true) as
select s.shop_id, s.branch_id, s.business_date, i.product_id,
       sum(i.qty) as qty, sum(i.line_total) as revenue
from sale_items i join sales s on s.id = i.sale_id and s.shop_id = i.shop_id
where s.status <> 'voided'
group by s.shop_id, s.branch_id, s.business_date, i.product_id;

revoke all on v_daily_sales, v_sales_by_cashier, v_product_sales from public, anon, authenticated;
grant select on v_daily_sales, v_sales_by_cashier, v_product_sales to authenticated;

-- Realtime: only the tables the dashboard watches (free plan: 2M messages/month budget).
-- Realtime respects RLS, so a user only receives rows they could SELECT.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['sales','stock_levels','credit_payments','expenses','products','stock_discrepancies'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
