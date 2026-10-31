// The only place that talks to Supabase for Cloud mode. A test double with the same shape is used in tests.
import { getClient } from "./client.js";
const ok = ({ data, error, status }) => { if (error) { if (status && error.status === undefined) error.status = status; throw error; } return data; };
export const supabaseTransport = {
  rpc: async (fn, args) => ok(await getClient().rpc(fn, args)),
  async write(op) {
    const c = getClient(); const stamp = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) r[k] = v === "@now" ? new Date().toISOString() : v; return r; };
    if (op.m === "insert") return ok(await c.from(op.table).upsert(stamp(op.row), { onConflict: "id", ignoreDuplicates: !!op.ignoreDuplicates }));
    if (op.m === "upsert") {           // insert if new, otherwise update only the editable columns (keys and shop never change)
      const row = stamp(op.row);
      ok(await c.from(op.table).upsert(row, { onConflict: op.keys.join(","), ignoreDuplicates: true }));
      const patch = {}; for (const [k, v] of Object.entries(row)) if (!op.keys.includes(k) && k !== "shop_id") patch[k] = v;
      let q = c.from(op.table).update(patch); for (const k of op.keys) q = q.eq(k, row[k]); return ok(await q);
    }
    if (op.m === "update") { let q = c.from(op.table).update(stamp(op.patch)); for (const [k, v] of Object.entries(op.match)) q = q.eq(k, v); return ok(await q); }
    throw new Error("unknown write " + op.m);
  },
  // sel = { table, cols, eq:{}, gt:{}, isNull:[], in:{col:[...]}, order, from, to }
  async select(sel) {
    let q = getClient().from(sel.table).select(sel.cols || "*");
    for (const [k, v] of Object.entries(sel.eq || {})) q = q.eq(k, v);
    for (const [k, v] of Object.entries(sel.gt || {})) q = q.gt(k, v);
    for (const k of sel.isNull || []) q = q.is(k, null);
    for (const [k, v] of Object.entries(sel.in || {})) q = q.in(k, v);
    if (sel.order) q = q.order(sel.order);
    return ok(await q.range(sel.from ?? 0, sel.to ?? 999));
  },
};
