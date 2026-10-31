// Pure helpers: reports, end-of-day cash maths, debt reminders, quick-sale tiles, below-cost checks, Excel export.
import * as XLSX from "xlsx";
import { lineTotal, lineDiscount, saleDiscount, saleNet, saleNetCost, saleCollectedAtSale, saleCashBack, saleRefunded, saleReturns } from "./lines.js";

const num = (v) => Number(v) || 0;
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;

export const PAYMENT_LABELS = { cash: "Cash", credit: "On credit", transfer: "Bank transfer", pos: "POS" };
export const payLabel = (t) => PAYMENT_LABELS[t] || (t ? t[0].toUpperCase() + t.slice(1) : "Other");
// Money actually received at the till for a sale (credit sales: only the deposit).
export const collected = (s) => saleCollectedAtSale(s);                // at the time of sale (day-close drawer maths)
export const collectedNet = (s) => round2(saleCollectedAtSale(s) - saleCashBack(s));   // what the shop kept after cash returns

// ---------- below cost ----------
export const isBelowCost = (p) => num(p.cost) > 0 && num(p.price) > 0 && num(p.price) < num(p.cost);
export const marginPct = (price, cost) => (num(price) > 0 ? ((num(price) - num(cost)) / num(price)) * 100 : 0);

// ---------- aggregates ----------
export function byProduct(sales) {
  const m = new Map();
  for (const s of sales) for (const i of s.items || []) {
    const k = i.productId || i.name;
    const r = m.get(k) || { productId: i.productId, name: i.name, qty: 0, revenue: 0, cost: 0, discount: 0 };
    r.qty += num(i.qty); r.revenue += lineTotal(i); r.discount += lineDiscount(i); r.cost += num(i.qty) * num(i.cost);
    m.set(k, r);
  }
  for (const s of sales) for (const ret of saleReturns(s)) for (const x of ret.items || []) {   // returned goods come off quantity and revenue
    const r = m.get(x.productId || x.name); if (!r) continue;
    r.qty -= num(x.qty); r.revenue -= num(x.amount); if (ret.restock) r.cost -= num(x.qty) * num(x.cost);
  }
  return [...m.values()].map((r) => ({ ...r, profit: r.revenue - r.cost, margin: r.revenue ? ((r.revenue - r.cost) / r.revenue) * 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}
function groupBy(sales, keyFn, init) {
  const m = new Map();
  for (const s of sales) {
    const k = keyFn(s); const r = m.get(k) || { key: k, count: 0, revenue: 0, cost: 0, collected: 0, outstanding: 0, ...(init || {}) };
    r.count++; r.revenue += saleNet(s); r.refunded = (r.refunded || 0) + saleRefunded(s); r.discount = (r.discount || 0) + saleDiscount(s.items); r.cost += saleNetCost(s); r.collected += collectedNet(s); r.outstanding += num(s.balanceDue);
    m.set(k, r);
  }
  return [...m.values()].map((r) => ({ ...r, profit: r.revenue - r.cost }));
}
export const byCashier = (sales) => groupBy(sales, (s) => s.cashierName || "Unknown").sort((a, b) => b.revenue - a.revenue);
export const byPayment = (sales) => groupBy(sales, (s) => s.paymentType || "cash").sort((a, b) => b.revenue - a.revenue);
export const byDay = (sales) => groupBy(sales, (s) => s.date).sort((a, b) => (a.key < b.key ? -1 : 1));

export function profitSummary(sales, expenses) {
  const revenue = sum(sales, saleNet), cost = sum(sales, saleNetCost);
  const expensesTotal = sum(expenses, (e) => num(e.amount));
  const gross = revenue - cost;
  const byCat = {};
  for (const e of expenses) byCat[e.category || "Other"] = (byCat[e.category || "Other"] || 0) + num(e.amount);
  return { count: sales.length, refunds: sum(sales, saleRefunded), discounts: sum(sales, (s) => saleDiscount(s.items)), revenue, cost, gross, margin: revenue ? (gross / revenue) * 100 : 0, expensesTotal,
    expenseCategories: Object.entries(byCat).sort((a, b) => b[1] - a[1]), net: gross - expensesTotal };
}

// ---------- end of day ----------
export function dayClose({ sales, creditPayments, expenses, purchases = [], date, branchId, floatAmount = 0, counted = null }) {
  const ss = sales.filter((s) => s.date === date && s.branchId === branchId);
  const cashSales = sum(ss.filter((s) => s.paymentType === "cash"), collected);
  const deposits = sum(ss.filter((s) => s.paymentType === "credit"), collected);
  const otherMethods = sum(ss.filter((s) => s.paymentType !== "cash" && s.paymentType !== "credit"), collected);
  const repayments = sum(creditPayments.filter((p) => p.date === date && p.branchId === branchId), (p) => num(p.amount));
  const ex = expenses.filter((e) => e.date === date && e.branchId === branchId);
  const expensesTotal = sum(ex, (e) => num(e.amount));
  const purchasesTotal = sum(purchases.filter((p) => p.date === date && p.branchId === branchId), (p) => num(p.total));
  const revenue = sum(ss, saleNet), cost = sum(ss, saleNetCost);
  const refundsPaid = round2(sum(sales.filter((x) => x.branchId === branchId), (x) => sum(saleReturns(x).filter((r) => r.date === date), (r) => num(r.cashBack))));
  const creditGiven = sum(ss.filter((s) => s.paymentType === "credit"), (s) => num(s.balanceDue));
  const expected = round2(num(floatAmount) + cashSales + deposits + repayments - expensesTotal - refundsPaid);
  const hasCount = counted !== null && counted !== "" && !isNaN(Number(counted));
  const difference = hasCount ? round2(Number(counted) - expected) : null;
  return { salesCount: ss.length, revenue, cost, gross: revenue - cost, expensesTotal, net: revenue - cost - expensesTotal,
    cashSales, deposits, otherMethods, repayments, refundsPaid, creditGiven, purchasesTotal, expected, difference,
    topItems: byProduct(ss).slice(0, 5), cashiers: byCashier(ss), expenseList: ex };
}

export function dayCloseText({ shopName, branchName, date, d, floatAmount, counted, note, money }) {
  const L = [];
  L.push(`${String(shopName || "Shop").toUpperCase()} - DAILY SUMMARY`);
  if (branchName) L.push(`Branch: ${branchName}`);
  L.push(`Date: ${date}`, "");
  L.push(`Sales: ${d.salesCount}   Revenue: ${money(d.revenue)}`);
  L.push(`Gross profit: ${money(d.gross)}`);
  L.push(`Expenses: ${money(d.expensesTotal)}`);
  L.push(`Net profit: ${money(d.net)}`, "");
  L.push("CASH IN DRAWER");
  L.push(`Opening cash: ${money(floatAmount)}`);
  L.push(`+ Cash sales: ${money(d.cashSales)}`);
  if (d.deposits) L.push(`+ Credit deposits: ${money(d.deposits)}`);
  if (d.repayments) L.push(`+ Credit repayments: ${money(d.repayments)}`);
  if (d.expensesTotal) L.push(`- Expenses paid: ${money(d.expensesTotal)}`);
  if (d.refundsPaid) L.push(`- Refunds paid out: ${money(d.refundsPaid)}`);
  L.push(`= Expected cash: ${money(d.expected)}`);
  if (d.difference !== null) {
    L.push(`Counted cash: ${money(counted)}`);
    L.push(d.difference === 0 ? "Balanced" : d.difference > 0 ? `OVER by ${money(d.difference)}` : `SHORT by ${money(Math.abs(d.difference))}`);
  }
  if (d.otherMethods) L.push("", `Paid by transfer/POS (not cash): ${money(d.otherMethods)}`);
  if (d.creditGiven) L.push("", `Credit given today: ${money(d.creditGiven)}`);
  if (d.topItems.length) { L.push("", "TOP ITEMS"); d.topItems.forEach((t) => L.push(`${t.name} x${t.qty} = ${money(t.revenue)}`)); }
  if (note && note.trim()) L.push("", `Note: ${note.trim()}`);
  return L.join("\n");
}

// ---------- debt reminders ----------
export function normalizePhone(raw, countryCode = "234") {
  let d = String(raw || "").replace(/[^0-9]/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = countryCode + d.slice(1);
  else if (d.length === 10 && !d.startsWith(countryCode)) d = countryCode + d;
  return d.length >= 11 && d.length <= 15 ? d : "";
}
export function reminderMessage({ name, amount, shop, pastDue }) {
  return `Hello ${name}, this is a friendly reminder from ${shop}. Your outstanding balance is ${amount}${pastDue ? `, which was due on ${pastDue}` : ""}. Kindly settle at your earliest convenience. Thank you for your patronage.`;
}
export const waLink = (phone, text) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
export const smsLink = (phone, text) => `sms:+${phone}?body=${encodeURIComponent(text)}`;

// ---------- quick-sale tiles ----------
export function pickQuickProducts(products, sales, today, limit = 12) {
  const pinned = products.filter((p) => p.quick).sort((a, b) => a.name.localeCompare(b.name));
  const start = new Date(today + "T00:00:00Z"); start.setUTCDate(start.getUTCDate() - 30);
  const since = start.toISOString().slice(0, 10);
  const sold = new Map();
  for (const s of sales) if (s.date >= since) for (const i of s.items || []) sold.set(i.productId, (sold.get(i.productId) || 0) + num(i.qty));
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const rest = products.filter((p) => !pinnedIds.has(p.id))
    .sort((a, b) => (sold.get(b.id) || 0) - (sold.get(a.id) || 0) || a.name.localeCompare(b.name));
  return { tiles: [...pinned, ...rest].slice(0, limit), pinnedCount: pinned.length, total: products.length };
}

// ---------- Excel export ----------
export function buildReportWorkbook({ shopName, rangeLabel, branchLabel, sales, expenses, money = (v) => v }) {
  const wb = XLSX.utils.book_new();
  const add = (name, rows, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  const ps = profitSummary(sales, expenses);
  add("Summary", [
    [shopName || "Ilelah Business Suite", ""], ["Report period", rangeLabel], ["Branch", branchLabel], [],
    ["Sales (count)", ps.count], ["Discounts given", round2(ps.discounts)], ["Refunds / returns", round2(ps.refunds)], ["Revenue (after discounts and returns)", round2(ps.revenue)], ["Cost of goods", round2(ps.cost)],
    ["Gross profit", round2(ps.gross)], ["Gross margin %", round2(ps.margin)], ["Expenses", round2(ps.expensesTotal)], ["Net profit", round2(ps.net)],
    [], ["Expenses by category", ""], ...ps.expenseCategories.map(([c, v]) => [c, round2(v)]),
  ], [26, 24]);
  add("Sales", [["Invoice", "Date", "Branch", "Customer", "Cashier", "Payment", "Discount", "Total", "Refunded", "Paid at sale", "Balance due", "Cost", "Profit"],
    ...[...sales].sort((a, b) => (a.time < b.time ? -1 : 1)).map((s) => [s.invoiceNo, s.date, s.branchName || s.branchId || "", s.customerName || "Walk-in", s.cashierName || "", payLabel(s.paymentType),
      round2(saleDiscount(s.items)), round2(s.total), round2(saleRefunded(s)), round2(collectedNet(s)), round2(s.balanceDue), round2(saleNetCost(s)), round2(saleNet(s) - saleNetCost(s))])],
    [9, 12, 16, 22, 16, 12, 12, 12, 12, 12, 12, 12, 12]);
  const itemRows = [];
  for (const s of sales) for (const i of s.items || []) itemRows.push([s.invoiceNo, s.date, i.name, num(i.qty), round2(i.price), round2(lineDiscount(i)), round2(i.cost), round2(lineTotal(i)), round2(lineTotal(i) - num(i.qty) * num(i.cost))]);
  add("Items sold", [["Invoice", "Date", "Product", "Qty", "Unit price", "Discount", "Unit cost", "Line total", "Line profit"], ...itemRows], [9, 12, 30, 8, 12, 12, 12, 12, 12]);
  add("By product", [["Product", "Qty sold", "Revenue", "Cost", "Profit", "Margin %"],
    ...byProduct(sales).map((r) => [r.name, r.qty, round2(r.revenue), round2(r.cost), round2(r.profit), round2(r.margin)])], [30, 10, 14, 14, 14, 10]);
  add("By cashier", [["Cashier", "Sales", "Revenue", "Profit"], ...byCashier(sales).map((r) => [r.key, r.count, round2(r.revenue), round2(r.profit)])], [20, 8, 14, 14]);
  add("By payment type", [["Payment type", "Sales", "Revenue", "Paid at sale", "Outstanding"],
    ...byPayment(sales).map((r) => [payLabel(r.key), r.count, round2(r.revenue), round2(r.collected), round2(r.outstanding)])], [18, 8, 14, 14, 14]);
  add("By day", [["Date", "Sales", "Revenue", "Profit"], ...byDay(sales).map((r) => [r.key, r.count, round2(r.revenue), round2(r.profit)])], [12, 8, 14, 14]);
  add("Expenses", [["Date", "Category", "Amount", "Note"], ...[...expenses].sort((a, b) => (a.date < b.date ? -1 : 1)).map((e) => [e.date, e.category || "", round2(e.amount), e.note || ""])], [12, 18, 12, 36]);
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}
