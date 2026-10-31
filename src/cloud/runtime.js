// Cloud-mode engine: remembers the mode, owns the upload queue, pulls the cloud copy, compares totals.
// Everything that touches the network goes through `transport`, so it can be tested with a stand-in.
import { createOutbox } from "./outbox.js";
import { buildImportPayload } from "./legacy-export.js";
import * as M from "./mappers.js";

export const STAMP_KEY = "tally:cloud:stamp", STOCK_CURSOR_KEY = "tally:cloud:stockcursor";
export const MODE_KEY = "tally:mode", CTX_KEY = "tally:cloud:ctx", SNAP_KEY = "tally:precloud:snapshot", CURSOR_KEY = "tally:cloud:cursor";
const readJson = (storage, k, d) => { try { const v = storage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };

export const TOTAL_KEYS = [["products", "Products"], ["customers", "Customers"], ["sales", "Sales"], ["sales_total", "Sales amount"], ["credit_outstanding", "Credit still owed"], ["stock_units", "Units in stock"], ["repayments_total", "Repayments"], ["expenses_total", "Expenses"], ["purchases_total", "Purchases"]];
const MONEY = new Set(["sales_total", "credit_outstanding", "stock_units", "repayments_total", "expenses_total", "purchases_total"]);

export function compareTotals(local, cloud, cloudKeyFor = {}) {
  return TOTAL_KEYS.map(([k, label]) => {
    const l = Number(local[k] ?? 0), c = Number(cloud[cloudKeyFor[k] || k] ?? 0);
    return { key: k, label, local: l, cloud: c, money: MONEY.has(k) && k !== "stock_units", ok: Math.abs(l - c) < 0.011 };
  });
}

export function createRuntime({ storage, transport, uuid = () => crypto.randomUUID(), now = () => Date.now() }) {
  const outbox = createOutbox({
    storage, now,
    send: async (_kind, op) => {
      if (op.t === "rpc") return transport.rpc(op.fn, op.args);
      return transport.write(op);
    },
  });
  const ctx = () => readJson(storage, CTX_KEY, null);
  const rt = {
    outbox, transport,
    mode: () => (storage.getItem(MODE_KEY) === "cloud" && ctx() ? "cloud" : "local"),
    isCloud: () => rt.mode() === "cloud",
    ctx,
    setCtx: (c) => storage.setItem(CTX_KEY, JSON.stringify(c)),
    enqueue(list) { let n = 0; for (const { id, op } of list) if (outbox.enqueue(op.t, id, op)) n++; return n; },
    flush: () => outbox.run(),
    pendingCount: () => { const s = outbox.stats(); return (s.pending || 0) + (s.syncing || 0); },
    failedCount: () => outbox.stats().failed || 0,
    totals: () => transport.rpc("cloud_totals", {}),
    localTotals: (state) => buildImportPayload(state).expected,

    // Reads the cloud copy and returns it in the app's own shapes.
    // `parts` says what to download: { catalog, books, stock, sales } (all true = everything, as at switch time).
    // `stockSince`: when only stock changed, fetch just the rows changed since then.
    async pull({ since, parts = { catalog: true, books: true, stock: true, sales: true }, stockSince } = {}) {
      const all = async (table, cols, opts = {}) => {
        const out = []; for (let from = 0; ; from += 1000) { const rows = await transport.select({ table, cols, from, to: from + 999, ...opts }); out.push(...rows); if (rows.length < 1000) return out; }
      };
      const inChunks = async (table, cols, col, ids) => { const out = []; for (let i = 0; i < ids.length; i += 80) out.push(...(await all(table, cols, { in: { [col]: ids.slice(i, i + 80) } }))); return out; };
      const out = {}; let levels = null;
      if (parts.catalog) {
        const [branches, products, customers, shopRows] = await Promise.all([
          all("branches", "id,name,code,address,phone", { isNull: ["archived_at"], order: "name" }),
          all("products", "id,name,sku,barcode,category,cost,price,low_stock,quick", { isNull: ["archived_at"], order: "name" }),
          all("customers", "id,name,phone,reminded_at,discount_pct", { isNull: ["archived_at"] }),
          all("shops", "id,name,tagline,address,phone"),
        ]);
        levels = await all("stock_levels", "product_id,branch_id,qty,updated_at");
        out.stockCursor = levels.map((l) => l.updated_at).filter(Boolean).sort().pop() || null;
        const ids = new Set(products.map((p) => p.id)); const shop = shopRows[0];
        out.branches = branches.map(M.branchFromCloud);
        out.products = products.map((p) => M.productFromCloud(p, levels.filter((l) => ids.has(l.product_id))));
        out.customers = customers.map(M.customerFromCloud);
        out.settings = shop ? { shopName: shop.name, tagline: shop.tagline || "", address: shop.address || "", phone: shop.phone || "" } : null;
      } else if (parts.stock) {
        // only stock moved: fetch the changed rows (or all of them the first time)
        const rows = await all("stock_levels", "product_id,branch_id,qty,updated_at", stockSince ? { gt: { updated_at: stockSince }, order: "updated_at" } : {});
        out.stockRows = rows.map((r) => ({ product_id: r.product_id, branch_id: r.branch_id, qty: Number(r.qty) || 0 }));
        out.stockCursor = rows.map((r) => r.updated_at).filter(Boolean).sort().pop() || stockSince || null;
      }
      if (parts.books) {
        const [expenses, daycloses, poRaw] = await Promise.all([
          all("expenses", "id,expense_date,branch_id,category,amount,note", { isNull: ["voided_at"] }).catch(() => []),
          all("day_closes", "branch_id,close_date,float_amount,counted,expected,difference,note,closed_by_name,closed_at"),
          all("purchases", "id,supplier,purchase_date,branch_id,total").catch(() => []),
        ]);
        const poItems = poRaw.length ? await all("purchase_items", "purchase_id,product_id,name,qty,unit_cost").catch(() => []) : [];
        out.expenses = expenses.map(M.expenseFromCloud); out.dayCloses = M.dayClosesFromCloud(daycloses); out.purchases = poRaw.map((p) => M.purchaseFromCloud(p, poItems));
      }
      let cursor = since || null;
      if (parts.sales) {
        const SALE = "id,invoice_no,business_date,sold_at,branch_id,cashier_id,cashier_name,customer_id,customer_name,customer_phone,payment_method,due_date,amount_paid,balance_due,total,cost_total,refunded_total,status,edited_at,synced_at";
        const salesRaw = await all("sales", SALE, since ? { gt: { synced_at: since }, order: "synced_at" } : { order: "synced_at" });
        const itemsRaw = since ? await inChunks("sale_items", "sale_id,id,product_id,name,qty,unit_price,discount,unit_cost", "sale_id", salesRaw.map((s) => s.id)) : await all("sale_items", "sale_id,id,product_id,name,qty,unit_price,discount,unit_cost");
        const refRaw = salesRaw.some((s) => Number(s.refunded_total) > 0) ? await inChunks("refunds", "id,sale_id,amount,cash_back,restock,reason,created_at", "sale_id", salesRaw.filter((s) => Number(s.refunded_total) > 0).map((s) => s.id)).catch(() => []) : [];   // managers/owners only; others keep the total
        const refItemRaw = refRaw.length ? await inChunks("refund_items", "refund_id,sale_item_id,qty,amount", "refund_id", refRaw.map((r) => r.id)).catch(() => []) : [];
        const payRaw = await all("credit_payments", "id,receipt_no,customer_id,amount,business_date,paid_at,note,branch_id,received_by_name,synced_at", since ? { gt: { synced_at: since } } : {});
        const live = salesRaw.filter((s) => s.status !== "voided");
        out.sales = live.map((s) => M.saleFromCloud(s, itemsRaw, refRaw, refItemRaw));
        out.voidedSaleIds = salesRaw.filter((s) => s.status === "voided").map((s) => s.id);
        out.creditPayments = payRaw.map(M.creditPaymentFromCloud);
        cursor = [...salesRaw.map((s) => s.synced_at), ...payRaw.map((p) => p.synced_at)].filter(Boolean).sort().pop() || since || null;
      }
      out.cursor = cursor;
      return out;
    },
    stamp: () => transport.rpc("shop_stamp", {}),
  };
  return rt;
}

// Merge an incremental pull into the sales / payments already on the phone (by id; voided ones disappear).
export function mergeById(local, incoming, removeIds = []) {
  const gone = new Set(removeIds); const m = new Map(local.filter((x) => !gone.has(x.id)).map((x) => [x.id, x]));
  for (const x of incoming) m.set(x.id, x);
  return [...m.values()];
}
