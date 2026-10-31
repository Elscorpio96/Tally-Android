// A cashier's phone only holds that cashier's own sales, so it cannot add up what a customer owes shop-wide.
// For them the server's figure is used, plus anything done on this phone since it was fetched.
export const BAL_KEY = "tally:cloud:balances";
export async function refreshBalances(rt, storage, state) {
  const rows = await rt.transport.rpc("get_customer_balances", {});
  const map = {}; for (const r of rows || []) map[r.customer_id] = Number(r.balance) || 0;
  const known = [...(state.sales || []).map((s) => s.id), ...(state.creditPayments || []).map((p) => p.id)];
  storage.setItem(BAL_KEY, JSON.stringify({ map, known }));
}
export const loadBalances = (storage) => { try { const v = storage.getItem(BAL_KEY); return v ? JSON.parse(v) : null; } catch (_) { return null; } };
export function balanceFrom(cb, customerId, sales, payments) {
  const known = new Set(cb.known);
  const more = sales.filter((s) => s.paymentType === "credit" && s.customerId === customerId && !known.has(s.id)).reduce((a, s) => a + (Number(s.balanceDue) || 0), 0);
  const less = payments.filter((p) => p.customerId === customerId && !known.has(p.id)).reduce((a, p) => a + (Number(p.amount) || 0), 0);
  return Math.max(0, (cb.map[customerId] || 0) + more - less);
}
