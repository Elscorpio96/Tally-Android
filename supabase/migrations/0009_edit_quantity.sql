-- 0009: a recorded sale's quantities can be corrected as well as prices/discounts. Safe to run once after 0008.
-- Same permissions as before (owner/admin any sale; manager their branches; cashier own sales from today).
-- A line may now carry "qty" in p_prices. Stock moves by the difference (more sold = less in stock; fewer = put back),
-- recorded in the stock ledger. Quantity must stay above 0 (to remove a line use a return). Not allowed once a return exists.
create or replace function edit_sale_prices(p_sale uuid, p_prices jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop(); s sales%rowtype; v_before jsonb; v_total numeric; v_paid numeric; v_bal numeric; v_tz text; v_today date; r record; v_new numeric;
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
  if exists (select 1 from jsonb_to_recordset(p_prices) as x(qty numeric) where x.qty is not null and x.qty <= 0) then raise exception 'invalid_qty'; end if;
  v_before := (select jsonb_build_object('total', s.total, 'discount_total', s.discount_total, 'amount_paid', s.amount_paid, 'balance_due', s.balance_due,
                'items', jsonb_agg(jsonb_build_object('id', id, 'qty', qty, 'unit_price', unit_price, 'discount', discount))) from sale_items where sale_id = p_sale);
  -- quantity changes: move stock by the difference (only when the line really changes)
  if exists (select 1 from jsonb_to_recordset(p_prices) as x(qty numeric) where x.qty is not null) and exists (select 1 from refunds where sale_id = p_sale) then
    raise exception 'sale_has_returns';
  end if;
  for r in
    select si.id as item_id, si.product_id as pid, x.qty - si.qty as d
      from sale_items si
      join jsonb_to_recordset(p_prices) as x(sale_item_id uuid, product_id uuid, qty numeric)
        on ((x.sale_item_id is not null and si.id = x.sale_item_id) or (x.sale_item_id is null and si.product_id = x.product_id))
     where si.sale_id = p_sale and si.shop_id = v_shop and x.qty is not null and x.qty <> si.qty and si.product_id is not null
     order by si.product_id
  loop
    v_new := app.apply_stock(v_shop, s.branch_id, r.pid, -r.d, 'adjustment', 'sale_edit', p_sale, true, 'Quantity corrected on sale ' || s.invoice_no);
    if v_new < 0 and r.d > 0 then
      insert into stock_discrepancies(shop_id, branch_id, product_id, sale_id, shortfall) values (v_shop, s.branch_id, r.pid, p_sale, least(r.d, -v_new));
    end if;
  end loop;
  update sale_items si set unit_price = coalesce(app.round2(x.unit_price), si.unit_price), discount = coalesce(app.round2(x.discount), si.discount),
                           qty = coalesce(x.qty, si.qty)
    from jsonb_to_recordset(p_prices) as x(sale_item_id uuid, product_id uuid, unit_price numeric, discount numeric, qty numeric)
    where si.sale_id = p_sale and si.shop_id = v_shop and coalesce(x.unit_price, 0) >= 0 and coalesce(x.discount, 0) >= 0
      and ((x.sale_item_id is not null and si.id = x.sale_item_id) or (x.sale_item_id is null and si.product_id = x.product_id));
  if exists (select 1 from sale_items where sale_id = p_sale and discount > qty * unit_price) then raise exception 'discount_exceeds_line'; end if;
  update sale_items set line_total = app.round2(qty * unit_price - discount) where sale_id = p_sale;
  select sum(line_total) into v_total from sale_items where sale_id = p_sale;
  if s.payment_method = 'credit' then v_paid := least(s.amount_paid, v_total); v_bal := v_total - v_paid;
  else v_paid := greatest(s.amount_paid, v_total); v_bal := 0; end if;
  update sales set subtotal = (select sum(qty * unit_price) from sale_items where sale_id = p_sale),
         discount_total = (select sum(discount) from sale_items where sale_id = p_sale), total = v_total,
         cost_total = (select app.round2(sum(qty * unit_cost)) from sale_items where sale_id = p_sale),
         amount_paid = v_paid, balance_due = v_bal, edited_at = now(), edited_by = auth.uid() where id = p_sale;
  perform app.audit(v_shop, 'sale.edit_prices', 'sale', p_sale::text, v_before,
    jsonb_build_object('total', v_total, 'amount_paid', v_paid, 'balance_due', v_bal, 'prices', p_prices), p_reason);
  return jsonb_build_object('total', v_total, 'amount_paid', v_paid, 'balance_due', v_bal);
end $$;
grant execute on function edit_sale_prices(uuid, jsonb, text) to authenticated;
