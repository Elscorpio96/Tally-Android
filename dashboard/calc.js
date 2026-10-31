// Pure calculations for the owner dashboard (no network, easy to test).
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v) => Math.round(v * 100) / 100;
export const live = (s) => s.status !== "voided";
// money actually kept from a sale: revenue minus refunds; cost reduced in the same proportion
export const netRevenue = (s) => (live(s) ? n(s.total) - n(s.refunded_total) : 0);
export const netCost = (s) => (live(s) && n(s.total) > 0 ? n(s.cost_total) * (1 - Math.min(1, n(s.refunded_total) / n(s.total))) : 0);

export function summarize(sales, expenses = [], payments = []) {
  const ls = sales.filter(live);
  const revenue = r2(ls.reduce((a, s) => a + netRevenue(s), 0));
  const cost = r2(ls.reduce((a, s) => a + netCost(s), 0));
  const exp = r2(expenses.filter((e) => !e.voided_at).reduce((a, e) => a + n(e.amount), 0));
  return {
    count: ls.length, revenue, cost, gross: r2(revenue - cost), expenses: exp, net: r2(revenue - cost - exp),
    creditIssued: r2(ls.filter((s) => s.payment_method === "credit").reduce((a, s) => a + n(s.balance_due), 0)),
    repayments: r2(payments.reduce((a, p) => a + n(p.amount), 0)),
    cashIn: r2(ls.reduce((a, s) => a + Math.min(n(s.amount_paid), n(s.total)), 0) + payments.reduce((a, p) => a + n(p.amount), 0)),
    voided: sales.length - ls.length,
  };
}
const group = (rows, keyFn) => { const m = new Map(); for (const r of rows) { const k = keyFn(r); (m.get(k) || m.set(k, []).get(k)).push(r); } return m; };
export function byDay(sales, from, to) {
  const m = group(sales.filter(live), (s) => s.business_date); const out = [];
  for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10); const rows = m.get(k) || [];
    out.push({ date: k, revenue: r2(rows.reduce((a, s) => a + netRevenue(s), 0)), count: rows.length });
  }
  return out;
}
export const byCashier = (sales) => [...group(sales.filter(live), (s) => s.cashier_id).entries()].map(([id, rows]) => ({ id, name: rows[0].cashier_name || "—", count: rows.length, revenue: r2(rows.reduce((a, s) => a + netRevenue(s), 0)) })).sort((a, b) => b.revenue - a.revenue);
export const byBranch = (sales, branches) => [...group(sales.filter(live), (s) => s.branch_id).entries()].map(([id, rows]) => ({ id, name: (branches.find((b) => b.id === id) || {}).name || "—", count: rows.length, revenue: r2(rows.reduce((a, s) => a + netRevenue(s), 0)), profit: r2(rows.reduce((a, s) => a + netRevenue(s) - netCost(s), 0)) })).sort((a, b) => b.revenue - a.revenue);
export const byPayment = (sales) => [...group(sales.filter(live), (s) => s.payment_method).entries()].map(([k, rows]) => ({ method: k, count: rows.length, revenue: r2(rows.reduce((a, s) => a + netRevenue(s), 0)) })).sort((a, b) => b.revenue - a.revenue);
// product rows come from the v_product_sales view (per day/branch/product)
export function topProducts(rows, products) {
  const m = group(rows, (r) => r.product_id);
  return [...m.entries()].map(([id, rs]) => ({ id, name: (products.find((p) => p.id === id) || {}).name || "(deleted item)", qty: r2(rs.reduce((a, r) => a + n(r.qty), 0)), revenue: r2(rs.reduce((a, r) => a + n(r.revenue), 0)) })).sort((a, b) => b.revenue - a.revenue);
}
export function stockRows(products, levels, branchId) {
  return products.filter((p) => !p.archived_at).map((p) => {
    const ls = levels.filter((l) => l.product_id === p.id && (!branchId || l.branch_id === branchId));
    const qty = r2(ls.reduce((a, l) => a + n(l.qty), 0));
    return { id: p.id, name: p.name, sku: p.sku, qty, low: n(p.low_stock) > 0 && qty <= n(p.low_stock), out: qty <= 0, value: r2(qty * n(p.cost)), retail: r2(qty * n(p.price)) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
export const presetRange = (preset, today) => {
  const d = (back) => { const x = new Date(today + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() - back); return x.toISOString().slice(0, 10); };
  if (preset === "today") return [today, today]; if (preset === "yesterday") return [d(1), d(1)];
  if (preset === "7d") return [d(6), today]; if (preset === "30d") return [d(29), today];
  if (preset === "month") return [today.slice(0, 8) + "01", today];
  return [today, today];
};
