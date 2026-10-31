// Turns the phone's localStorage data (the shape the app uses today) into the payload that the
// server function import_legacy() expects, plus the totals the server must reproduce exactly.
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const s = (v) => (v === undefined || v === null ? "" : String(v));
const r2 = (v) => Math.round(v * 100) / 100;

// Fingerprint of the data, so importing the same backup twice is recognised (cyrb53).
export function fingerprint(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0") + "-" + str.length;
}

export function buildImportPayload(state) {
  const branches = (state.branches || []).map((b) => ({ legacy_id: s(b.id), name: s(b.name), address: s(b.address), phone: s(b.phone) }));
  const branchIds = new Set(branches.map((b) => b.legacy_id));
  const products = (state.products || []).map((p) => ({
    legacy_id: s(p.id), name: s(p.name), sku: s(p.sku), barcode: s(p.barcode), category: s(p.category),
    cost: Math.max(0, n(p.cost)), price: Math.max(0, n(p.price)), low_stock: n(p.lowStock), quick: !!p.quick,
  }));
  const stock = [];
  for (const p of state.products || []) for (const [b, q] of Object.entries(p.stock || {})) if (branchIds.has(b) && n(q) !== 0) stock.push({ product: s(p.id), branch: b, qty: n(q) });
  const customers = (state.customers || []).map((c) => ({ legacy_id: s(c.id), name: s(c.name), phone: s(c.phone), reminded_at: s(c.remindedAt) }));
  const sales = (state.sales || []).map((x) => ({
    legacy_id: s(x.id), invoice: s(x.invoiceNo), date: s(x.date), time: s(x.time), branch: s(x.branchId), cashier_name: s(x.cashierName),
    customer: s(x.customerId), customer_name: s(x.customerName), customer_phone: s(x.customerPhone),
    payment_method: x.paymentType === "credit" ? "credit" : "cash", due_date: s(x.dueDate),
    amount_paid: Math.max(0, n(x.amountTendered)), balance_due: x.paymentType === "credit" ? Math.max(0, n(x.balanceDue)) : 0,
    total: r2(n(x.total)), cost_total: Math.max(0, n(x.cost)),
    items: (x.items || []).map((i) => ({ product: s(i.productId), name: s(i.name), qty: n(i.qty), price: Math.max(0, n(i.price)), cost: Math.max(0, n(i.cost)), discount: Math.max(0, n(i.discount)) })),
    returns: (Array.isArray(x.returns) ? x.returns : []).map((r) => ({ time: s(r.time), date: s(r.date), reason: s(r.reason), restock: r.restock !== false, amount: r2(n(r.amount)), cash_back: r2(n(r.cashBack)), items: (r.items || []).map((i) => ({ product: s(i.productId), qty: n(i.qty), amount: r2(n(i.amount)) })) })),
  }));
  const credit_payments = (state.creditPayments || []).map((c) => ({
    legacy_id: s(c.id), receipt_no: s(c.receiptNo), customer: s(c.customerId), branch: s(c.branchId), amount: n(c.amount),
    date: s(c.date), time: s(c.time), note: s(c.note), cashier_name: s(c.cashierName),
  }));
  const purchases = (state.purchases || []).map((x) => ({
    legacy_id: s(x.id), supplier: s(x.supplier), date: s(x.date), branch: s(x.branchId), total: n(x.total),
    items: (x.items || []).map((i) => ({ product: s(i.productId), name: s(i.name), qty: n(i.qty), cost: n(i.cost) })),
  }));
  const expenses = (state.expenses || []).map((e) => ({ legacy_id: s(e.id), branch: s(e.branchId), date: s(e.date), category: s(e.category), amount: n(e.amount), note: s(e.note) }));
  const day_closes = Object.entries(state.dayCloses || {}).map(([k, d]) => {
    const [branch, date] = k.split("|");
    return { branch, date, float: n(d.float), counted: d.counted === undefined || d.counted === null || d.counted === "" ? null : n(d.counted), expected: n(d.expected), difference: d.difference === undefined || d.difference === null ? null : n(d.difference), note: s(d.note), closed_by_name: s(d.closedBy), closed_at: s(d.closedAt) };
  });
  const sum = (arr, f) => r2(arr.reduce((a, x) => a + f(x), 0));
  const expected = {
    products: products.length, customers: customers.length, sales: sales.length,
    sales_total: sum(sales, (x) => x.total),
    credit_outstanding: r2(sum(sales.filter((x) => x.payment_method === "credit"), (x) => x.balance_due) - sum(credit_payments, (c) => c.amount)),
    stock_units: sum(stock, (x) => x.qty), repayments_total: sum(credit_payments, (c) => c.amount),
    expenses_total: sum(expenses, (e) => e.amount), purchases_total: sum(purchases, (x) => x.total),
  };
  const body = { branches, products, stock, customers, sales, credit_payments, purchases, expenses, day_closes };
  return { source_hash: fingerprint(JSON.stringify(body)), expected, ...body };
}
