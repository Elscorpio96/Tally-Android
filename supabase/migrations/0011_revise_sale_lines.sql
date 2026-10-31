-- 0011: the OWNER can add an item to, or delete an item from, a recorded sale. Safe to run once after 0010.
-- p_lines is the sale's FINAL list of lines: [{ product_id, qty, unit_price, discount }].
--   a product no longer listed  -> its line is deleted and its quantity goes back into stock
--   a new product               -> a line is added (cost and list price taken from the catalogue) and stock goes down
--   a product still listed      -> quantity / price / discount updated, stock moves by the difference
-- Rules: owner/admin only; the sale must be completed with no returns; at least one line must remain
-- (to cancel everything use a return). Every change is written to the stock ledger and the audit log, with a reason.
create or replace function revise_sale(p_sale uuid, p_lines jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop(); s sales%rowtype; v_before jsonb; v_total numeric; v_paid numeric; v_bal numeric; r record; v_new numeric; v_n int;
begin
  perform app.require_member();
  if not app.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into s from sales where id = p_sale and shop_id = v_shop for update;
  if not found then raise exception 'unknown_sale'; end if;
  if s.status <> 'completed' or exists (select 1 from refunds where sale_id = p_sale) then raise exception 'sale_not_editable'; end if;

  create temp table if not exists _rev_lines (product_id uuid, qty numeric, unit_price numeric, discount numeric) on commit drop;
  delete from _rev_lines;
  insert into _rev_lines select x.product_id, x.qty, x.unit_price, coalesce(x.discount, 0)
    from jsonb_to_recordset(p_lines) as x(product_id uuid, qty numeric, unit_price numeric, discount numeric);
  select count(*) into v_n from _rev_lines;
  if v_n = 0 then raise exception 'sale_needs_a_line'; end if;
  if exists (select 1 from _rev_lines where product_id is null or qty is null or qty <= 0 or unit_price is null or unit_price < 0 or discount < 0) then raise exception 'invalid_line'; end if;
  if exists (select 1 from _rev_lines group by product_id having count(*) > 1) then raise exception 'duplicate_line'; end if;
  if exists (select 1 from _rev_lines where discount > round(qty * unit_price, 2)) then raise exception 'discount_exceeds_line'; end if;
  if exists (select 1 from _rev_lines l where not exists (select 1 from products pr where pr.id = l.product_id and pr.shop_id = v_shop)) then raise exception 'unknown_product'; end if;

  v_before := (select jsonb_build_object('total', s.total, 'amount_paid', s.amount_paid, 'balance_due', s.balance_due,
                'items', jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty, 'unit_price', unit_price, 'discount', discount))) from sale_items where sale_id = p_sale);

  -- stock: put back what was removed, take off what was added, move by the difference for the rest
  for r in
    select coalesce(l.product_id, si.product_id) as pid, coalesce(l.qty, 0) - coalesce(si.qty, 0) as d
      from _rev_lines l full join (select product_id, sum(qty) as qty from sale_items where sale_id = p_sale and product_id is not null group by product_id) si on si.product_id = l.product_id
     where coalesce(l.qty, 0) <> coalesce(si.qty, 0)
     order by 1
  loop
    v_new := app.apply_stock(v_shop, s.branch_id, r.pid, -r.d, 'adjustment', 'sale_edit', p_sale, true, 'Items changed on sale ' || s.invoice_no);
    if v_new < 0 and r.d > 0 then
      insert into stock_discrepancies(shop_id, branch_id, product_id, sale_id, shortfall) values (v_shop, s.branch_id, r.pid, p_sale, least(r.d, -v_new));
    end if;
  end loop;

  delete from sale_items where sale_id = p_sale and shop_id = v_shop and (product_id is null or product_id not in (select product_id from _rev_lines));
  update sale_items si set qty = l.qty, unit_price = app.round2(l.unit_price), discount = app.round2(l.discount), line_total = app.round2(l.qty * l.unit_price - l.discount)
    from _rev_lines l where si.sale_id = p_sale and si.shop_id = v_shop and si.product_id = l.product_id;
  insert into sale_items(sale_id, shop_id, product_id, name, qty, unit_price, unit_cost, list_price, discount, line_total)
    select p_sale, v_shop, l.product_id, pr.name, l.qty, app.round2(l.unit_price), pr.cost, pr.price, app.round2(l.discount), app.round2(l.qty * l.unit_price - l.discount)
      from _rev_lines l join products pr on pr.id = l.product_id and pr.shop_id = v_shop
     where not exists (select 1 from sale_items si where si.sale_id = p_sale and si.product_id = l.product_id);

  select sum(line_total) into v_total from sale_items where sale_id = p_sale;
  if s.payment_method = 'credit' then v_paid := least(s.amount_paid, v_total); v_bal := v_total - v_paid;
  else v_paid := greatest(s.amount_paid, v_total); v_bal := 0; end if;
  update sales set subtotal = (select sum(qty * unit_price) from sale_items where sale_id = p_sale),
         discount_total = (select sum(discount) from sale_items where sale_id = p_sale), total = v_total,
         cost_total = (select app.round2(sum(qty * unit_cost)) from sale_items where sale_id = p_sale),
         amount_paid = v_paid, balance_due = v_bal, edited_at = now(), edited_by = auth.uid() where id = p_sale;
  perform app.audit(v_shop, 'sale.revise_lines', 'sale', p_sale::text, v_before,
    jsonb_build_object('total', v_total, 'amount_paid', v_paid, 'balance_due', v_bal, 'lines', p_lines), p_reason);
  return jsonb_build_object('total', v_total, 'amount_paid', v_paid, 'balance_due', v_bal);
end $$;
revoke all on function revise_sale(uuid, jsonb, text) from public, anon;
grant execute on function revise_sale(uuid, jsonb, text) to authenticated;
