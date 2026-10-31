// Sale-line arithmetic shared by checkout, receipts, reports and sync.
// A sale line is { qty, price (unit price before discount), discount (₦ off this whole line, default 0), cost }.
// Everything is rounded to kobo (2 decimals) the same way the server does.
export const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
export const lineGross = (i) => round2(n(i.qty) * n(i.price));
export const lineDiscount = (i) => Math.min(lineGross(i), Math.max(0, round2(n(i.discount))));
export const lineTotal = (i) => round2(lineGross(i) - lineDiscount(i));
export const saleSubtotal = (items) => round2((items || []).reduce((a, i) => a + lineGross(i), 0));
export const saleDiscount = (items) => round2((items || []).reduce((a, i) => a + lineDiscount(i), 0));
export const saleTotal = (items) => round2((items || []).reduce((a, i) => a + lineTotal(i), 0));
// what one unit really sold for, after discount (used for "below cost" checks)
export const effectiveUnit = (i) => (n(i.qty) > 0 ? lineTotal(i) / n(i.qty) : n(i.price));

// An amount entered as { mode: "amt" | "pct", text } against a base amount -> ₦ off (never more than the base, never negative)
export function discountAmount(entry, base) {
  if (!entry || entry.text === "" || entry.text === undefined) return 0;
  const v = Math.max(0, n(entry.text));
  const raw = entry.mode === "pct" ? (Math.min(v, 100) / 100) * base : v;
  return Math.min(round2(base), round2(raw));
}
// Turns the cart + the discounts typed at checkout into final lines.
//  cart items: { ..., qty, price, discEntry?: {mode,text} }   saleEntry: {mode,text} applied to what is left after line discounts.
export function priceCart(cart, saleEntry) {
  const lines = cart.map((i) => ({ ...i, discount: discountAmount(i.discEntry, lineGross(i)) }));
  const afterLines = lines.map((i) => lineTotal(i));
  const base = round2(afterLines.reduce((a, v) => a + v, 0));
  const extra = discountAmount(saleEntry, base);
  if (extra > 0 && base > 0) {          // share the sale-wide discount across lines in proportion to their value; the last line absorbs rounding
    let left = extra; const idx = lines.map((_, k) => k).filter((k) => afterLines[k] > 0);
    idx.forEach((k, pos) => {
      const share = pos === idx.length - 1 ? left : Math.min(left, round2((extra * afterLines[k]) / base));
      lines[k] = { ...lines[k], discount: round2(lines[k].discount + share) }; left = round2(left - share);
    });
  }
  return { lines, subtotal: saleSubtotal(lines), discount: saleDiscount(lines), total: saleTotal(lines) };
}
// Who may change a recorded sale: admins always; staff only their own sales from today.
export function canEditSale(user, sale, today) {
  if (!user || !sale) return false;
  if (user.role === "admin") return true;
  const mine = sale.cashierId ? sale.cashierId === user.id : sale.cashierName === user.name;
  return mine && sale.date === today;
}

// total number of units on a sale (sum of line quantities)
export const saleQty = (items) => Math.round((items || []).reduce((a, i) => a + n(i.qty), 0) * 1000) / 1000;

// ---------- customer returns ----------
// sale.returns = [{ id, time, date, by, reason, restock, amount, cashBack, items: [{ productId, name, qty, amount, cost }] }]
// (In Cloud mode a cashier cannot read the detail, only sale.refundedTotal, so that is the fallback.)
export const saleReturns = (s) => (s && Array.isArray(s.returns) ? s.returns : []);
export const saleRefunded = (s) => { const r = saleReturns(s); return r.length ? round2(r.reduce((a, x) => a + n(x.amount), 0)) : round2(n(s && s.refundedTotal)); };
export const saleCashBack = (s) => round2(saleReturns(s).reduce((a, x) => a + n(x.cashBack), 0));
export const saleNet = (s) => round2(n(s.total) - saleRefunded(s));
// cost of goods that went back on the shelf no longer counts as cost; damaged goods stay a cost
export const saleReturnedCost = (s) => round2(saleReturns(s).filter((r) => r.restock).reduce((a, r) => a + (r.items || []).reduce((b, i) => b + n(i.qty) * n(i.cost), 0), 0));
export const saleNetCost = (s) => round2(n(s.cost) - saleReturnedCost(s));
// money received at the till when the sale was made (balanceDue has since been reduced by returns that cleared debt)
export const saleCollectedAtSale = (s) => round2(n(s.total) - (n(s.balanceDue) + saleReturns(s).reduce((a, r) => a + n(r.amount) - n(r.cashBack), 0)));
// how many of one product have already come back from this sale
export const returnedQty = (s, productId) => saleReturns(s).reduce((a, r) => a + (r.items || []).filter((i) => i.productId === productId).reduce((b, i) => b + n(i.qty), 0), 0);
export const returnableQty = (s, i) => Math.max(0, round2(n(i.qty) - returnedQty(s, i.productId)));

// Works out a return of { productId: qty } from a sale. Pure; the caller applies stock and saves.
// amount per unit = what that line really cost after discounts. Credit sales: the debt is cleared before any cash goes back.
export function buildReturn(sale, qtys, { restock = true, reason = "", by = "", id, now = new Date(), date } = {}) {
  const items = []; let amount = 0;
  for (const it of sale.items || []) {
    const q = n(qtys[it.productId]); if (!(q > 0)) continue;
    if (q > returnableQty(sale, it) + 1e-9) throw new Error("return_qty_too_high");
    const amt = round2(lineTotal(it) * q / n(it.qty));
    items.push({ productId: it.productId, name: it.name, qty: q, amount: amt, cost: n(it.cost) }); amount = round2(amount + amt);
  }
  if (!items.length || amount <= 0) throw new Error("nothing_to_return");
  const back = Math.min(Math.max(0, n(sale.balanceDue)), amount);
  const cashBack = round2(amount - back);
  const ret = { id, time: now.toISOString(), date, by, reason, restock: !!restock, amount, cashBack, items };
  return { ret, balanceDue: round2(n(sale.balanceDue) - back) };
}
