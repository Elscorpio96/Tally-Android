// Decides what to download so phones stay cheap on data (free plan: 5 GB a month) and applies stock-only updates.
export const FULL_REFRESH_MS = 15 * 60 * 1000;
export const ALL_PARTS = { catalog: true, books: true, stock: true, sales: true };
// old/cur = the server's change stamps (see shop_stamp() in 0006). Returns what to fetch, or null when nothing changed.
export function planPull(old, cur, lastFullAt, now) {
  if (!cur) return { ...ALL_PARTS };
  if (!old || !lastFullAt || now - lastFullAt > FULL_REFRESH_MS) return { ...ALL_PARTS };       // regular safety net
  const parts = { catalog: cur.catalog !== old.catalog, books: cur.books !== old.books, stock: cur.stock !== old.stock, sales: cur.sales !== old.sales || cur.pay !== old.pay };
  return Object.values(parts).some(Boolean) ? parts : null;
}
// put changed stock rows into the product list, leaving everything else as it is
export function applyStockRows(products, rows) {
  if (!rows || !rows.length) return products;
  const by = new Map(); for (const r of rows) { if (!by.has(r.product_id)) by.set(r.product_id, {}); by.get(r.product_id)[r.branch_id] = r.qty; }
  return products.map((p) => (by.has(p.id) ? { ...p, stock: { ...p.stock, ...by.get(p.id) } } : p));
}
