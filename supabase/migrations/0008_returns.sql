-- 0008: customer returns (refunds) from the phone. Safe to run once after 0007.
-- Changes to refund_sale: (1) a retry of the same request is applied once (p_request), (2) lines can be named by
-- product_id as well as sale_item_id (the phone does not know the server's line ids for a sale it just made).
alter table refunds add column if not exists request_id uuid;
create unique index if not exists refunds_request_idx on refunds(shop_id, request_id) where request_id is not null;

drop function if exists refund_sale(uuid, jsonb, boolean, text);
create function refund_sale(p_sale uuid, p_items jsonb, p_restock boolean, p_reason text, p_request uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_shop uuid := app.my_shop(); s sales%rowtype; v_refund uuid := gen_random_uuid(); v_amount numeric := 0; v_line numeric;
        v_back numeric; v_cash numeric; r record; v_open numeric; v_prev refunds%rowtype;
begin
  perform app.require_member();
  if not app.is_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into s from sales where id = p_sale and shop_id = v_shop for update;     -- serialises retries of the same sale
  if not found then raise exception 'unknown_sale'; end if;
  if p_request is not null then
    select * into v_prev from refunds where shop_id = v_shop and request_id = p_request;
    if found then return jsonb_build_object('status', 'duplicate', 'refund_id', v_prev.id, 'amount', v_prev.amount, 'cash_back', v_prev.cash_back); end if;
  end if;
  if s.status in ('voided','refunded') then raise exception 'sale_not_refundable'; end if;
  insert into refunds(id, shop_id, sale_id, branch_id, amount, cash_back, restock, reason, created_by, request_id)
    values (v_refund, v_shop, p_sale, s.branch_id, 0.01, 0, coalesce(p_restock, true), p_reason, auth.uid(), p_request);  -- amounts set below
  for r in select si.id as sale_item_id, x.qty, si.qty as sold, si.line_total, si.product_id,
                  coalesce((select sum(ri.qty) from refund_items ri where ri.sale_item_id = si.id), 0) as already
           from jsonb_to_recordset(p_items) as x(sale_item_id uuid, product_id uuid, qty numeric)
           join sale_items si on si.sale_id = p_sale and si.shop_id = v_shop
                and ((x.sale_item_id is not null and si.id = x.sale_item_id) or (x.sale_item_id is null and si.product_id = x.product_id)) loop
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
  return jsonb_build_object('status', 'created', 'refund_id', v_refund, 'amount', v_amount, 'cash_back', v_cash, 'balance_due', s.balance_due - v_back);
end $$;
revoke all on function refund_sale(uuid, jsonb, boolean, text, uuid) from public, anon;
grant execute on function refund_sale(uuid, jsonb, boolean, text, uuid) to authenticated;
