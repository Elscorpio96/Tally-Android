import { getClient } from "../src/cloud/client.js";
import { cloud } from "../src/cloud/api.js";
const PAGE = 1000;
export async function fetchAll(table, columns, build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = await cloud.list(table, columns, (q) => (build ? build(q) : q).range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}
const SALE_COLS = "id,invoice_no,business_date,sold_at,branch_id,cashier_id,cashier_name,customer_name,payment_method,total,cost_total,amount_paid,balance_due,refunded_total,status,edited_at,synced_at";
export async function loadAll({ from, to, branch, cashier }) {
  const scoped = (q, dateCol) => { q = q.gte(dateCol, from).lte(dateCol, to); if (branch) q = q.eq("branch_id", branch); return q; };
  const [branches, sales, expenses, payments, productSales, products, levels, balances, discrepancies] = await Promise.all([
    cloud.list("branches", "id,name,code,archived_at", (q) => q.order("name")),
    fetchAll("sales", SALE_COLS, (q) => { q = scoped(q, "business_date"); if (cashier) q = q.eq("cashier_id", cashier); return q.order("sold_at", { ascending: false }); }),
    fetchAll("expenses", "id,expense_date,branch_id,category,amount,note,voided_at", (q) => scoped(q, "expense_date").is("voided_at", null)).catch(() => []),
    fetchAll("credit_payments", "id,business_date,branch_id,customer_id,amount,receipt_no,received_by_name,paid_at", (q) => scoped(q, "business_date")),
    fetchAll("v_product_sales", "business_date,branch_id,product_id,qty,revenue", (q) => scoped(q, "business_date")),
    fetchAll("products", "id,name,sku,cost,price,low_stock,archived_at", (q) => q.order("name")),
    fetchAll("stock_levels", "product_id,branch_id,qty"),
    cloud.customerBalances().catch(() => []),
    cloud.list("stock_discrepancies", "id,branch_id,product_id,sale_id,shortfall,created_at,resolved_at", (q) => q.is("resolved_at", null).order("created_at", { ascending: false })).catch(() => []),
  ]);
  return { branches, sales, expenses, payments, productSales, products, levels, balances, discrepancies };
}
export const loadSaleItems = (saleId) => cloud.list("sale_items", "id,name,qty,unit_price,line_total", (q) => q.eq("sale_id", saleId));
export const loadTeam = () => cloud.list("memberships", "user_id,role,branch_id,active,profiles(display_name,username)", (q) => q.order("created_at"));
export const loadAudit = () => cloud.list("audit_log", "id,action,entity,entity_id,actor_name,reason,created_at,after", (q) => q.order("id", { ascending: false }).limit(100)).catch(() => []);
export const resolveDiscrepancy = async (id, userId) => { const { error } = await getClient().from("stock_discrepancies").update({ resolved_at: new Date().toISOString(), resolved_by: userId }).eq("id", id); if (error) throw error; };
// live updates: the server only sends rows this user is allowed to read
export function subscribeLive(onChange) {
  const c = getClient(); let timer = null;
  const bump = () => { clearTimeout(timer); timer = setTimeout(onChange, 800); };
  const ch = c.channel("dash");
  for (const t of ["sales", "credit_payments", "expenses", "stock_levels", "stock_discrepancies", "products"]) ch.on("postgres_changes", { event: "*", schema: "public", table: t }, bump);
  ch.subscribe();
  return () => { clearTimeout(timer); c.removeChannel(ch); };
}
export function toCsv(rows, cols) {
  const esc = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.map((c) => c[1]).join(","), ...rows.map((r) => cols.map((c) => esc(r[c[0]])).join(","))].join("\n");
}
