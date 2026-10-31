// Converts between the app's own record shapes (what the screens use) and the cloud's.
// In Cloud mode the app uses the cloud's UUIDs as its local IDs, so no translation table is needed after the import.
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const day = (v) => (v ? String(v).slice(0, 10) : "");
import { localDateStr } from "../dates.js";

// ---------- app -> cloud (what gets queued) ----------
export function saleToPayload(sale, { deviceId } = {}) {
  return {
    id: sale.id, branch_id: sale.branchId, device_id: deviceId || null,
    invoice_no: String(sale.invoiceNo), sold_at: sale.time, client_created_at: sale.time,
    payment_method: sale.paymentType, due_date: sale.dueDate || null,
    amount_paid: sale.paymentType === "credit" ? num(sale.amountTendered) : Math.max(num(sale.amountTendered), num(sale.total)),
    client_total: num(sale.total),
    customer: sale.customerId ? { id: sale.customerId, name: sale.customerName || "", phone: sale.customerPhone || "" } : undefined,
    items: (sale.items || []).map((i) => ({ product_id: i.productId, qty: num(i.qty), unit_price: num(i.price), discount: num(i.discount) })),
  };
}
export function creditPaymentToPayload(p, { deviceId } = {}) {
  return { id: p.id, branch_id: p.branchId, device_id: deviceId || null, customer_id: p.customerId, receipt_no: String(p.receiptNo), amount: num(p.amount), paid_at: p.time || new Date(p.date + "T12:00:00").toISOString(), note: p.note || "" };
}
export function purchaseToPayload(p) {
  return { id: p.id, branch_id: p.branchId, supplier: p.supplier, purchase_date: p.date, items: (p.items || []).map((i) => ({ product_id: i.productId, qty: num(i.qty), unit_cost: num(i.cost) })) };
}

// ---------- cloud -> app (what the screens read) ----------
export const branchFromCloud = (b) => ({ id: b.id, name: b.name, address: b.address || "", phone: b.phone || "", code: b.code });
export function productFromCloud(p, stockRows = []) {
  const stock = {};
  for (const r of stockRows) if (r.product_id === p.id) stock[r.branch_id] = num(r.qty);
  return { id: p.id, name: p.name, sku: p.sku, barcode: p.barcode || "", category: p.category || "", cost: num(p.cost), price: num(p.price), lowStock: num(p.low_stock), quick: !!p.quick, stock };
}
export const customerFromCloud = (c) => ({ id: c.id, name: c.name, phone: c.phone || "", remindedAt: c.reminded_at || undefined, discountPct: num(c.discount_pct) });
export function returnsFromCloud(saleId, saleItems, refunds = [], refundItems = []) {
  return refunds.filter((r) => r.sale_id === saleId).map((r) => ({
    id: r.id, time: r.created_at, date: r.created_at ? localDateStr(new Date(r.created_at)) : "", by: "", reason: r.reason || "", restock: !!r.restock, amount: num(r.amount), cashBack: num(r.cash_back),
    items: refundItems.filter((x) => x.refund_id === r.id).map((x) => { const si = saleItems.find((i) => i.id === x.sale_item_id) || {}; return { productId: si.product_id, name: si.name || "", qty: num(x.qty), amount: num(x.amount), cost: num(si.unit_cost) }; }),
  }));
}
export function saleFromCloud(s, items = [], refunds = [], refundItems = []) {
  const mine = items.filter((i) => i.sale_id === s.id);
  return {
    id: s.id, invoiceNo: s.invoice_no, date: day(s.business_date), time: s.sold_at, branchId: s.branch_id,
    cashierId: s.cashier_id, cashierName: s.cashier_name || "", customerId: s.customer_id || null, customerName: s.customer_name || "", customerPhone: s.customer_phone || "",
    paymentType: s.payment_method === "credit" ? "credit" : "cash", dueDate: day(s.due_date),
    amountTendered: num(s.amount_paid), balanceDue: num(s.balance_due), total: num(s.total), cost: num(s.cost_total),
    status: s.status, refundedTotal: num(s.refunded_total), returns: returnsFromCloud(s.id, mine, refunds, refundItems), edited: !!s.edited_at, editedAt: s.edited_at || undefined, synced: true,
    items: mine.map((i) => ({ productId: i.product_id, name: i.name, qty: num(i.qty), price: num(i.unit_price), discount: num(i.discount), cost: num(i.unit_cost) })),
  };
}
export const creditPaymentFromCloud = (c) => ({ id: c.id, receiptNo: c.receipt_no, customerId: c.customer_id, amount: num(c.amount), date: day(c.business_date), time: c.paid_at, note: c.note || "", branchId: c.branch_id, cashierName: c.received_by_name || "" });
export const expenseFromCloud = (e) => ({ id: e.id, date: day(e.expense_date), branchId: e.branch_id, category: e.category, amount: num(e.amount), note: e.note || "" });
export const purchaseFromCloud = (p, items = []) => ({ id: p.id, supplier: p.supplier, date: day(p.purchase_date), branchId: p.branch_id, total: num(p.total), items: items.filter((i) => i.purchase_id === p.id).map((i) => ({ productId: i.product_id, name: i.name, qty: num(i.qty), cost: num(i.unit_cost) })) });
export function dayClosesFromCloud(rows) {
  const out = {};
  for (const d of rows) out[`${d.branch_id}|${day(d.close_date)}`] = { float: num(d.float_amount), counted: d.counted === null ? undefined : num(d.counted), expected: num(d.expected), difference: d.difference === null ? undefined : num(d.difference), note: d.note || "", closedBy: d.closed_by_name || "", closedAt: d.closed_at };
  return out;
}
