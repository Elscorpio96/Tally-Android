// End-to-end: phone data -> import -> compare -> pull -> cloud-mode edits -> queue -> server state, using real SQL.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
import { buildImportPayload } from "../../src/cloud/legacy-export.js";
import { createRuntime, compareTotals, mergeById } from "../../src/cloud/runtime.js";
import { deriveOps } from "../../src/cloud/ops.js";
import { planPull, applyStockRows, FULL_REFRESH_MS } from "../../src/cloud/sync.js";
const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "../migrations/");
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`create extension if not exists pgcrypto; create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role; grant usage on schema public to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role; alter default privileges in schema public grant all on functions to anon,authenticated,service_role;`);
for (const f of fs.readdirSync(MIG).sort()) await db.exec(fs.readFileSync(MIG + f, "utf8"));
let pass = 0, fail = 0; const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass++ : (fail++, console.log("FAIL", l, JSON.stringify(a), "!=", JSON.stringify(b))));
const U = { owner: crypto.randomUUID(), cash: crypto.randomUUID() }; for (const k of Object.values(U)) await db.query("insert into auth.users(id) values($1)", [k]);
let who = "owner"; let online = true; let netCalls = 0;
async function run(sql, params = []) { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [U[who]]); await db.exec("set role authenticated"); try { return await db.query(sql, params); } finally { await db.exec("reset role"); } }
const val = (v) => (v === "@now" ? new Date().toISOString() : v);
// stand-in for supabaseTransport, executing the same operations as SQL under the signed-in user's rights
const transport = {
  async rpc(fn, args) { if (!online) throw new Error("Failed to fetch"); netCalls++; const names = Object.keys(args); const r = await run(`select ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(",")}) r`, names.map((n) => typeof args[n] === "object" && args[n] !== null ? JSON.stringify(args[n]) : args[n])); return r.rows[0].r; },
  async write(op) {
    if (!online) throw new Error("Failed to fetch"); netCalls++;
    const row = op.row && Object.fromEntries(Object.entries(op.row).map(([k, v]) => [k, val(v)]));
    const wrap = (e) => { if (!e.code) e.code = "42501"; e.status = 403; throw e; };
    try {
      if (op.m === "insert" || op.m === "upsert") {
        const cols = Object.keys(row); const keys = op.m === "insert" ? ["id"] : op.keys;
        await run(`insert into ${op.table}(${cols.join(",")}) values (${cols.map((_, i) => "$" + (i + 1)).join(",")}) on conflict (${keys.join(",")}) do nothing`, cols.map((c) => row[c]));
        if (op.m === "upsert") { const patch = Object.entries(row).filter(([k]) => !keys.includes(k) && k !== "shop_id"); await run(`update ${op.table} set ${patch.map(([k], i) => `${k} = $${i + 1}`).join(",")} where ${keys.map((k, i) => `${k} = $${patch.length + i + 1}`).join(" and ")}`, [...patch.map(([, v]) => v), ...keys.map((k) => row[k])]); }
      } else {
        const patch = Object.entries(op.patch).map(([k, v]) => [k, val(v)]); const m = Object.entries(op.match);
        await run(`update ${op.table} set ${patch.map(([k], i) => `${k} = $${i + 1}`).join(",")} where ${m.map(([k], i) => `${k} = $${patch.length + i + 1}`).join(" and ")}`, [...patch.map(([, v]) => v), ...m.map(([, v]) => v)]);
      }
    } catch (e) { wrap(e); }
  },
  async select(s) {
    if (!online) throw new Error("Failed to fetch");
    const where = []; const params = [];
    for (const [k, v] of Object.entries(s.in || {})) { params.push(v); where.push(`${k} = any($${params.length}::uuid[])`); }
    for (const [k, v] of Object.entries(s.gt || {})) { params.push(v); where.push(`${k} > $${params.length}`); }
    for (const k of s.isNull || []) where.push(`${k} is null`);
    const cols = s.cols.replace(/,\s*/g, ",");
    const r = await run(`select to_jsonb(x) j from (select ${cols} from ${s.table} ${where.length ? "where " + where.join(" and ") : ""} ${s.order ? "order by " + s.order : ""} offset ${s.from} limit ${s.to - s.from + 1}) x`, params);
    return r.rows.map((x) => x.j);
  },
};
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const store = mem(); let ids = 0;
const rt = createRuntime({ storage: store, transport, uuid: () => crypto.randomUUID() });

// ---------- the phone's data before switching
const phone = {
  branches: [{ id: "b1", name: "Main Shop", address: "Bauchi Rd", phone: "0816" }],
  products: [{ id: "p1", name: "Rice 5kg", sku: "RICE", barcode: "", cost: 3000, price: 4000, lowStock: 5, quick: true, stock: { b1: 40 } }, { id: "p2", name: "Oil 1L", sku: "OIL", cost: 1500, price: 2000, lowStock: 0, stock: { b1: 12 } }],
  customers: [{ id: "c1", name: "Ade", phone: "0801" }],
  sales: [
    { id: "s-1", invoiceNo: 1, date: "2026-09-01", time: "2026-09-01T08:10:00.000Z", branchId: "b1", cashierName: "Joy", paymentType: "cash", amountTendered: 8000, balanceDue: 0, total: 8000, cost: 6000, items: [{ productId: "p1", name: "Rice 5kg", qty: 2, price: 4000, cost: 3000 }] },
    { id: "s-2", invoiceNo: 2, date: "2026-09-02", time: "2026-09-02T09:00:00.000Z", branchId: "b1", cashierName: "Joy", customerId: "c1", customerName: "Ade", paymentType: "credit", amountTendered: 1000, balanceDue: 3000, total: 4000, cost: 3000, items: [{ productId: "p1", name: "Rice 5kg", qty: 1, price: 4000, cost: 3000 }] }],
  creditPayments: [{ id: "cp1", receiptNo: 1, customerId: "c1", amount: 500, date: "2026-09-03", branchId: "b1", cashierName: "Joy" }],
  purchases: [{ id: "pu1", supplier: "D", date: "2026-08-30", branchId: "b1", total: 30000, items: [{ productId: "p2", name: "Oil 1L", qty: 20, cost: 1500 }] }],
  expenses: [{ id: "e1", date: "2026-09-01", branchId: "b1", category: "Rent", amount: 700, note: "" }],
  dayCloses: { "b1|2026-09-01": { float: 100, counted: 8100, expected: 8100, difference: 0, note: "", closedBy: "Joy", closedAt: "2026-09-01T18:00:00.000Z" } },
  settings: { shopName: "Ade Stores", tagline: "", address: "", phone: "" },
};
const shop = (await run("select create_shop('Ade Stores','ade','Ade') r")).rows[0].r;
await db.query("select add_member($1,$2,$3,'cash1','Cash','cashier',$4)", [U.owner, shop.shop_id, U.cash, shop.branch_id]);

// ---------- steps 2-3: import (verified server-side), then compare phone vs cloud
await transport.rpc("import_legacy", { p: buildImportPayload(phone) });
const before = compareTotals(rt.localTotals(phone), await rt.totals());
eq("compare phone vs cloud: every row matches", before.filter((r) => !r.ok).map((r) => r.key), []);
// a phone that does NOT match must be caught
const drift = compareTotals(rt.localTotals({ ...phone, expenses: [...phone.expenses, { id: "e2", date: "2026-09-04", branchId: "b1", category: "X", amount: 5 }] }), await rt.totals());
eq("a phone with an extra expense is flagged", drift.filter((r) => !r.ok).map((r) => r.key), ["expenses_total"]);

// ---------- steps 4-5: replace with the cloud copy and verify
const cloud = await rt.pull();
const after = compareTotals(rt.localTotals(cloud), await rt.totals(), { customers: "customers_all" });
eq("after replacing: every total still matches", after.filter((r) => !r.ok).map((r) => r.key), []);
eq("pulled settings", cloud.settings.shopName, "Ade Stores");
const br = cloud.branches[0].id; const rice = cloud.products.find((p) => p.name === "Rice 5kg"); const oil = cloud.products.find((p) => p.name === "Oil 1L");
eq("stock follows cloud branch id", rice.stock, { [br]: 40 }); eq("cursor captured", typeof cloud.cursor, "string");

// ---------- cloud mode: the app edits state, ops are derived and queued, queue is sent
const dev = (await transport.rpc("register_device", { p_branch: br, p_name: "t" })); const C = { shopId: shop.shop_id, userId: U.owner, deviceId: dev.device_id };
rt.setCtx(C); store.setItem("tally:mode", "cloud"); eq("mode is cloud", rt.mode(), "cloud");
const U4 = () => crypto.randomUUID(); let state = JSON.parse(JSON.stringify(cloud));
const apply = (name, next, tag) => { const ops = deriveOps(name, state[name], next, C, U4, tag); state[name] = next; return rt.enqueue(ops); };
const custId = state.customers[0].id;
const sale = { id: U4(), invoiceNo: dev.invoice_prefix + "-0001", date: "2026-10-13", time: new Date().toISOString(), branchId: br, cashierName: "Ade", paymentType: "cash", amountTendered: 9000, total: 8000, cost: 6000, items: [{ productId: rice.id, name: "Rice 5kg", qty: 2, price: 4000, cost: 3000 }] };
eq("sale -> 1 op", apply("sales", [...state.sales, sale]), 1);
eq("sale's stock change (server-owned) -> no extra op", apply("products", state.products.map((p) => p.id === rice.id ? { ...p, stock: { ...p.stock, [br]: 38 } } : p), "server-stock"), 0);
const credit = { id: U4(), invoiceNo: dev.invoice_prefix + "-0002", date: "2026-10-13", time: new Date().toISOString(), branchId: br, cashierName: "Ade", customerId: custId, customerName: "Ade", paymentType: "credit", amountTendered: 0, balanceDue: 2000, total: 2000, cost: 1500, dueDate: "2026-11-01", items: [{ productId: oil.id, name: "Oil 1L", qty: 1, price: 2000, cost: 1500 }] };
apply("sales", [...state.sales, credit]); apply("products", state.products.map((p) => p.id === oil.id ? { ...p, stock: { ...p.stock, [br]: 11 } } : p), "server-stock");
apply("creditPayments", [...state.creditPayments, { id: U4(), receiptNo: dev.invoice_prefix + "-R1", customerId: custId, amount: 700, date: "2026-10-13", time: new Date().toISOString(), branchId: br }]);
apply("purchases", [...state.purchases, { id: U4(), supplier: "S", date: "2026-10-13", branchId: br, total: 15500, items: [{ productId: rice.id, name: "Rice 5kg", qty: 5, cost: 3100 }] }]);
apply("products", state.products.map((p) => p.id === rice.id ? { ...p, stock: { ...p.stock, [br]: 43 }, cost: 3100 } : p), "server-stock");
const exp = { id: U4(), date: "2026-10-13", branchId: br, category: "Rent", amount: 1000, note: "" }; apply("expenses", [...state.expenses, exp]);
const exp2 = { id: U4(), date: "2026-10-13", branchId: br, category: "Other", amount: 50, note: "oops" }; apply("expenses", [...state.expenses, exp2]); apply("expenses", state.expenses.filter((e) => e.id !== exp2.id));
const newP = { id: U4(), name: "Sugar", sku: "SUG", barcode: "", category: "", cost: 900, price: 1200, lowStock: 3, quick: false, stock: { [br]: 25 } }; apply("products", [...state.products, newP]);
apply("products", state.products.map((p) => p.id === oil.id ? { ...p, price: 2100, stock: { ...p.stock, [br]: 10 } } : p));           // manual: price change + stock recount (11 -> 10)
apply("customers", state.customers.map((c) => c.id === custId ? { ...c, phone: "0802" } : c));
apply("dayCloses", { ...state.dayCloses, [`${br}|2026-10-13`]: { float: 0, counted: 10000, expected: 10000, difference: 0, note: "", closedBy: "Ade", closedAt: new Date().toISOString() } });
apply("settings", { ...state.settings, phone: "0999" });
const edited = { ...sale, items: [{ ...sale.items[0], price: 3800 }], total: 7600, amountTendered: 9000, edited: true, editedAt: new Date().toISOString() }; apply("sales", state.sales.map((s) => s.id === sale.id ? edited : s));
const queued = rt.outbox.stats().pending; console.log("queued ops:", queued);

// offline first: nothing lost, nothing marked synced
online = false; await rt.flush(); eq("offline: nothing synced", rt.outbox.stats().synced || 0, 0); eq("offline: all still pending", rt.outbox.stats().pending, queued);
online = true; const t0 = Date.now(); rt.outbox.list().forEach(() => {}); 
// (backoff clock is real time here; reload the queue to retry immediately, as an app restart does)
const rt2 = createRuntime({ storage: store, transport, uuid: () => crypto.randomUUID() });
for (let i = 0; i < 4 && rt2.pendingCount(); i++) await rt2.flush();
for (const e of rt2.outbox.list()) if (e.status!=="synced") console.log("NOTSYNCED", e.id, e.status, JSON.stringify(rt2.outbox.errorOf?.(e.id)||e.error));
eq("online: all synced", [rt2.outbox.stats().synced, rt2.outbox.stats().failed || 0, rt2.pendingCount()], [queued, 0, 0]);
const n1 = netCalls; await rt2.flush(); eq("flushing again sends nothing", netCalls, n1);

// the cloud now equals the phone's own idea of the state
const local2 = rt2.localTotals(state); const server2 = await rt2.totals();
eq("phone and cloud totals agree after sync", compareTotals(local2, server2, { customers: "customers_all" }).filter((r) => !r.ok).map((r) => [r.key, r.local, r.cloud]), []);
const q1 = async (sql) => (await db.query(sql)).rows;
eq("stock oil on server = 10 (12, sold 1, recount -1)", Number((await q1(`select qty from stock_levels where product_id='${oil.id}'`))[0].qty), 10);
eq("rice on server = 43 and cost 3100", [Number((await q1(`select qty from stock_levels where product_id='${rice.id}'`))[0].qty), Number((await q1(`select cost from products where id='${rice.id}'`))[0].cost)], [43, 3100]);
eq("sugar created with opening stock", Number((await q1(`select qty from stock_levels where product_id='${newP.id}'`))[0].qty), 25);
eq("price edit reached the server (7600)", Number((await q1(`select total from sales where id='${sale.id}'`))[0].total), 7600);
eq("voided-by-removal expense not counted", Number((await q1("select coalesce(sum(amount),0) s from expenses where voided_at is null and expense_date='2026-10-13'"))[0].s), 1000);
eq("customer phone updated", (await q1(`select phone from customers where id='${custId}'`))[0].phone, "0802");
eq("day close stored", (await q1("select count(*)::int c from day_closes"))[0].c, 2);
eq("shop phone updated", (await q1("select phone from shops"))[0].phone, "0999");
eq("oil price updated", Number((await q1(`select price from products where id='${oil.id}'`))[0].price), 2100);
const dayClose2 = { ...state.dayCloses[`${br}|2026-10-13`], counted: 9990 }; rt2.enqueue(deriveOps("dayCloses", state.dayCloses, { ...state.dayCloses, [`${br}|2026-10-13`]: dayClose2 }, C, U4)); await rt2.flush();
eq("day close edit overwrites same day", [(await q1("select count(*)::int c from day_closes"))[0].c, Number((await q1(`select counted from day_closes where close_date='2026-10-13'`))[0].counted)], [2, 9990]);

// incremental pull picks up another phone's sale and a void, and removes the voided one
who = "cash"; const dev2 = await transport.rpc("register_device", { p_branch: br, p_name: "p2" });
await transport.rpc("record_sale", { p: { id: crypto.randomUUID(), branch_id: br, device_id: dev2.device_id, invoice_no: dev2.invoice_prefix + "-1", sold_at: new Date().toISOString(), payment_method: "cash", items: [{ product_id: oil.id, qty: 1, unit_price: 2100 }] } });
who = "owner"; await transport.rpc("void_sale", { p_sale: credit.id, p_reason: "wrong customer" });
const inc = await rt2.pull({ since: cloud.cursor });
eq("incremental: sees the other phone's sale and the void", [inc.sales.some((s) => s.invoiceNo.startsWith(dev2.invoice_prefix)), inc.voidedSaleIds], [true, [credit.id]]);
const merged = mergeById(state.sales, inc.sales, inc.voidedSaleIds);
eq("merge: voided sale gone, new one present, own sales kept", [merged.some((s) => s.id === credit.id), merged.some((s) => s.id === sale.id), merged.length], [false, true, state.sales.length]);


// ---------- cheap polling: only download what changed
who = "owner"; const nowT = Date.now();
const st1 = await rt2.stamp(); eq("nothing changed -> nothing to download", planPull(st1, await rt2.stamp(), nowT, nowT + 1000), null);
eq("old safety-net refresh forces a full download", planPull(st1, st1, nowT, nowT + FULL_REFRESH_MS + 1).catalog, true);
const stockBefore = await transport.select({ table: "stock_levels", cols: "product_id,branch_id,qty,updated_at", from: 0, to: 999 }); const cur0 = stockBefore.map((r) => r.updated_at).sort().pop();
who = "cash"; await transport.rpc("record_sale", { p: { id: crypto.randomUUID(), branch_id: br, device_id: dev2.device_id, invoice_no: dev2.invoice_prefix + "-77", sold_at: new Date().toISOString(), payment_method: "cash", items: [{ product_id: oil.id, qty: 2, unit_price: 2100 }] } });
who = "owner"; const st2 = await rt2.stamp(); const plan = planPull(st1, st2, nowT, nowT + 1000);
eq("another phone's sale: sales + stock change, catalog and books do not", plan, { catalog: false, books: false, stock: true, sales: true });
const part = await rt2.pull({ since: rt2.outbox ? cloud.cursor : undefined, parts: plan, stockSince: cur0 });
eq("stock-only download returns just the changed row", [part.stockRows.length, part.products, part.expenses], [1, undefined, undefined]);
const mergedStock = applyStockRows(state.products, part.stockRows);
eq("applying it matches the server", Number(mergedStock.find((p) => p.id === oil.id).stock[br]), Number((await q1(`select qty from stock_levels where product_id='${oil.id}'`))[0].qty));
eq("other products untouched", mergedStock.find((p) => p.id === rice.id), state.products.find((p) => p.id === rice.id));
await transport.write({ t: "db", m: "insert", table: "expenses", row: { id: crypto.randomUUID(), shop_id: shop.shop_id, branch_id: br, expense_date: "2026-10-14", category: "Rent", amount: 5, note: "", created_by: U.owner }, ignoreDuplicates: true });
eq("a new expense changes only the books stamp", planPull(st2, await rt2.stamp(), nowT, nowT + 1000), { catalog: false, books: true, stock: false, sales: false });
await transport.write({ t: "db", m: "update", table: "customers", patch: { phone: "0803" }, match: { id: custId } });
eq("a customer edit changes the catalog stamp", (planPull(st2, await rt2.stamp(), nowT, nowT + 1000) || {}).catalog, true);
who = "cash"; eq("a cashier gets a stamp too (limited to what they can see)", typeof (await rt2.stamp()).sales, "string"); who = "owner";

// a cashier's forbidden edit fails visibly and is not retried
who = "cash"; const rt3 = createRuntime({ storage: mem(), transport, uuid: () => crypto.randomUUID() });
rt3.enqueue(deriveOps("products", [], [{ id: U4(), name: "Hack", sku: "H", cost: 1, price: 2, stock: {} }], C, U4)); await rt3.flush();
eq("cashier cannot create products: failed, not pending", [rt3.outbox.stats().failed, rt3.pendingCount()], [1, 0]);
console.log(`${pass} passed, ${fail} failed`); if (fail) process.exit(1);
