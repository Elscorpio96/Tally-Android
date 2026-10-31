// Turns a change in the app's own data into upload operations for the outbox.
// Pure: no network, no storage. `ctx` = { shopId, userId, deviceId } and `uuid()` makes IDs.
import { saleToPayload, creditPaymentToPayload, purchaseToPayload } from "./mappers.js";
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const byId = (arr) => new Map((arr || []).map((x) => [x.id, x]));
const rpc = (id, fn, args) => ({ id, op: { t: "rpc", fn, args } });
const db = (id, m, table, extra) => ({ id, op: { t: "db", m, table, ...extra } });

export function branchCode(name, takenCodes = []) {
  let base = String(name || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4); if (base.length < 2) base = "BR";
  let code = base; let n = 1; while (takenCodes.includes(code)) { n += 1; code = base.slice(0, 4) + n; }
  return code;
}
const productRow = (p, shopId) => ({ id: p.id, shop_id: shopId, name: p.name, sku: p.sku, barcode: p.barcode || "", category: p.category || "", cost: num(p.cost), price: num(p.price), low_stock: num(p.lowStock), quick: !!p.quick });

export function deriveOps(name, prev, next, ctx, uuid, tag) {
  const out = []; const P = byId(Array.isArray(prev) ? prev : []), N = byId(Array.isArray(next) ? next : []);
  switch (name) {
    case "sales":
      for (const s of next) {
        const old = P.get(s.id);
        if (!old) out.push(rpc("sale:" + s.id, "record_sale", { p: saleToPayload(s, ctx) }));
        else if ((s.returns || []).length > ((old.returns || []).length)) {
          const known = new Set((old.returns || []).map((r) => r.id));
          for (const r of s.returns) if (!known.has(r.id)) out.push(rpc("refund:" + r.id, "refund_sale", { p_sale: s.id, p_items: r.items.map((i) => ({ product_id: i.productId, qty: num(i.qty) })), p_restock: !!r.restock, p_reason: r.reason || "Customer return", p_request: r.id }));
        }
        else if (s.edited && s.editedAt !== old.editedAt && (s.items || []).map((i) => i.productId).sort().join() !== (old.items || []).map((i) => i.productId).sort().join()) out.push(rpc(`revise:${s.id}:${s.editedAt}`, "revise_sale", { p_sale: s.id, p_lines: (s.items || []).map((i) => ({ product_id: i.productId, qty: num(i.qty), unit_price: num(i.price), discount: num(i.discount) })), p_reason: "Items added or removed on the phone" }));
        else if (s.edited && s.editedAt !== old.editedAt) out.push(rpc(`edit:${s.id}:${s.editedAt}`, "edit_sale_prices", { p_sale: s.id, p_prices: (s.items || []).map((i) => ({ product_id: i.productId, qty: num(i.qty), unit_price: num(i.price), discount: num(i.discount) })), p_reason: "Quantity, price or discount corrected on the phone" }));
      }
      break;
    case "creditPayments": for (const p of next) if (!P.has(p.id)) out.push(rpc("pay:" + p.id, "record_credit_payment", { p: creditPaymentToPayload(p, ctx) })); break;
    case "purchases": for (const p of next) if (!P.has(p.id)) out.push(rpc("po:" + p.id, "receive_purchase", { p: purchaseToPayload(p) })); break;
    case "expenses":
      for (const e of next) if (!P.has(e.id)) {
        out.push(db("exp:" + e.id, "insert", "expenses", { row: { id: e.id, shop_id: ctx.shopId, branch_id: e.branchId, expense_date: e.date, category: e.category, amount: num(e.amount), note: e.note || "", created_by: ctx.userId }, ignoreDuplicates: true }));
        out.push(db("expun:" + e.id + ":" + uuid(), "update", "expenses", { patch: { voided_at: null }, match: { id: e.id } }));        // Undo of a removal
      }
      for (const e of prev) if (!N.has(e.id)) out.push(db("expvoid:" + e.id, "update", "expenses", { patch: { voided_at: "@now" }, match: { id: e.id } }));
      break;
    case "customers":
      for (const c of next) {
        const old = P.get(c.id);
        if (!old) out.push(db("cust:" + c.id, "insert", "customers", { row: { id: c.id, shop_id: ctx.shopId, name: c.name, phone: c.phone || "", discount_pct: num(c.discountPct) }, ignoreDuplicates: true }));
        else if (old.name !== c.name || old.phone !== c.phone || old.remindedAt !== c.remindedAt || num(old.discountPct) !== num(c.discountPct)) out.push(db("custu:" + uuid(), "update", "customers", { patch: { name: c.name, phone: c.phone || "", reminded_at: c.remindedAt || null, discount_pct: num(c.discountPct) }, match: { id: c.id } }));
      }
      break;
    case "products":
      for (const p of next) {
        const old = P.get(p.id);
        if (!old) {
          out.push(db("prod:" + p.id, "insert", "products", { row: productRow(p, ctx.shopId), ignoreDuplicates: true }));
          out.push(db("produn:" + p.id + ":" + uuid(), "update", "products", { patch: { archived_at: null }, match: { id: p.id } }));      // brings back a product that was removed a moment ago (Undo)
          if (!tag) for (const [b, q] of Object.entries(p.stock || {})) if (num(q) !== 0) out.push(rpc("open:" + p.id + ":" + b, "adjust_stock_by", { p_request: uuid(), p_branch: b, p_product: p.id, p_delta: num(q), p_reason: "Opening stock" }));
          continue;
        }
        const f = ["name", "sku", "barcode", "category", "cost", "price", "lowStock", "quick"];
        if (f.some((k) => (old[k] ?? "") !== (p[k] ?? ""))) out.push(db("produ:" + uuid(), "update", "products", { patch: { name: p.name, sku: p.sku, barcode: p.barcode || "", category: p.category || "", cost: num(p.cost), price: num(p.price), low_stock: num(p.lowStock), quick: !!p.quick }, match: { id: p.id } }));
        if (tag !== "server-stock") for (const b of new Set([...Object.keys(old.stock || {}), ...Object.keys(p.stock || {})])) {
          const d = num((p.stock || {})[b]) - num((old.stock || {})[b]);
          if (Math.abs(d) > 1e-9) out.push(rpc("adj:" + uuid(), "adjust_stock_by", { p_request: uuid(), p_branch: b, p_product: p.id, p_delta: Math.round(d * 1000) / 1000, p_reason: "Stock edited on the phone" }));
        }
      }
      for (const p of prev) if (!N.has(p.id)) out.push(db("prodx:" + p.id, "update", "products", { patch: { archived_at: "@now" }, match: { id: p.id } }));
      break;
    case "branches": {
      const codes = (next || []).map((b) => b.code).filter(Boolean);
      for (const b of next) {
        const old = P.get(b.id);
        if (!old) { const code = branchCode(b.name, codes); codes.push(code); out.push(db("br:" + b.id, "insert", "branches", { row: { id: b.id, shop_id: ctx.shopId, code, name: b.name, address: b.address || "", phone: b.phone || "" }, ignoreDuplicates: true })); }
        else if (old.name !== b.name || old.address !== b.address || old.phone !== b.phone) out.push(db("bru:" + uuid(), "update", "branches", { patch: { name: b.name, address: b.address || "", phone: b.phone || "" }, match: { id: b.id } }));
      }
      for (const b of prev) if (!N.has(b.id)) out.push(db("brx:" + b.id, "update", "branches", { patch: { archived_at: "@now" }, match: { id: b.id } }));
      break;
    }
    case "dayCloses":
      for (const [k, d] of Object.entries(next || {})) {
        const old = (prev || {})[k]; if (old && JSON.stringify(old) === JSON.stringify(d)) continue;
        const [branch, date] = k.split("|");
        out.push(db("dc:" + k + ":" + uuid(), "upsert", "day_closes", { row: { shop_id: ctx.shopId, branch_id: branch, close_date: date, float_amount: num(d.float), counted: d.counted === undefined || d.counted === "" ? null : num(d.counted), expected: num(d.expected), difference: d.difference === undefined ? null : num(d.difference), note: d.note || "", closed_by: ctx.userId, closed_by_name: d.closedBy || "", closed_at: d.closedAt || "@now" }, keys: ["branch_id", "close_date"] }));
      }
      break;
    case "settings":
      if (!prev || ["shopName", "tagline", "address", "phone"].some((k) => (prev[k] || "") !== (next[k] || ""))) out.push(db("shop:" + uuid(), "update", "shops", { patch: { name: next.shopName, tagline: next.tagline || "", address: next.address || "", phone: next.phone || "" }, match: { id: ctx.shopId } }));
      break;
    default: break;
  }
  return out;
}
