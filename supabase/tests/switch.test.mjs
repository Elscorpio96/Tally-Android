// The guided switch to Cloud mode: backup, compare, replace, verify, restore. Real SQL underneath.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
import { buildImportPayload } from "../../src/cloud/legacy-export.js";
import * as SW from "../../src/cloud/switch.js";
import { createRuntime, compareTotals, mergeById } from "../../src/cloud/runtime.js";
import { deriveOps } from "../../src/cloud/ops.js";
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
const mkRt = (store) => createRuntime({ storage: store, transport, uuid: () => crypto.randomUUID() });
const phoneData = {
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
  users: [{ id: "u-1", username: "admin", password: "admin123", name: "Owner", role: "admin", branchId: "b1" }],
};
const seedPhone = (store, d) => { for (const [k, v] of Object.entries(d)) store.setItem("tally:" + k, JSON.stringify(v)); store.setItem("tally:seq:invoice", "2"); store.setItem("tally:sessionUserId", JSON.stringify("u-1")); store.setItem("tally:license", "KEEP-ME"); };
const dump = (store) => JSON.stringify(Object.fromEntries(["products", "sales", "purchases", "expenses", "customers", "creditPayments", "users", "branches", "settings", "dayCloses", "seq:invoice", "sessionUserId"].map((k) => [k, store.getItem("tally:" + k)])));

const shop = (await run("select create_shop('Ade Stores','ade','Ade') r")).rows[0].r;
await db.query("select add_member($1,$2,$3,'cash1','Cash','cashier',$4)", [U.owner, shop.shop_id, U.cash, shop.branch_id]);
const meOwner = await transport.rpc("whoami", {});

// ---- A: owner, empty cloud
const sA = mem(); seedPhone(sA, phoneData); const rtA = mkRt(sA); const original = dump(sA);
let refused = false; try { await SW.switchNow({ rt: rtA, storage: sA, me: meOwner, branchId: shop.branch_id }); } catch (e) { refused = true; }
eq("A: cannot switch without a backup snapshot", [refused, sA.getItem("tally:mode")], [true, null]);
SW.takeSnapshot(sA); eq("A: snapshot taken", SW.hasSnapshot(sA), true);
const prepA = await SW.prepare({ rt: rtA, storage: sA, me: meOwner });
eq("A: records copied to the empty cloud and every row matches", [prepA.copied, prepA.match, prepA.rows.length], [true, true, 9]);
eq("A: phone untouched by compare", dump(sA), original);
const resA = await SW.switchNow({ rt: rtA, storage: sA, me: meOwner, branchId: shop.branch_id });
eq("A: switched and verified", [resA.ok, rtA.mode(), resA.rows.every((r) => r.ok)], [true, "cloud", true]);
const stA = SW.readState(sA);
eq("A: phone now holds the cloud copy (uuid ids, same totals)", [stA.products.length, stA.sales.length, /^[0-9a-f-]{36}$/.test(stA.sales[0].id), stA.branches[0].id === shop.branch_id], [2, 2, true, true]);
eq("A: license and device keys untouched", sA.getItem("tally:license"), "KEEP-ME");
eq("A: ctx has device prefix", /^[A-Z0-9]+-[A-Z0-9]{3}$/.test(rtA.ctx().invoicePrefix), true);
const devA = rtA.ctx().deviceId; SW.restoreSnapshot(sA);
eq("A: restore gives back exactly the original records and Local mode", [dump(sA), rtA.mode()], [original, "local"]);
eq("A: restore keeps the license key", sA.getItem("tally:license"), "KEEP-ME");

// ---- B: something goes wrong after the records were replaced -> automatic restore
const sB = mem(); seedPhone(sB, phoneData); const rtB = mkRt(sB); const origB = dump(sB); SW.takeSnapshot(sB);
const realTotals = rtB.totals; let calls = 0; rtB.totals = async () => { calls++; const t = await realTotals(); return calls >= 1 ? { ...t, sales_total: Number(t.sales_total) + 1 } : t; };
const prepB = await SW.prepare({ rt: rtB, storage: sB, me: meOwner });
eq("B: cloud already holds this shop (no second copy made)", [prepB.copied, prepB.cloudHadData], [false, true]);
let errB = null; try { await SW.switchNow({ rt: rtB, storage: sB, me: meOwner, branchId: shop.branch_id }); } catch (e) { errB = e; }
eq("B: verification mismatch is reported and the backup is restored automatically", [!!errB && /verify_failed/.test(errB.message), errB && errB.restored, dump(sB), rtB.mode()], [true, true, origB, "local"]);

// ---- C: a second phone with different records joins the existing cloud shop
const sC = mem(); seedPhone(sC, { ...phoneData, products: [{ id: "q1", name: "Other", sku: "OTH", cost: 1, price: 2, lowStock: 0, stock: { b1: 3 } }], sales: [], creditPayments: [], purchases: [], expenses: [], customers: [], dayCloses: {} });
const rtC = mkRt(sC); SW.takeSnapshot(sC);
const prepC = await SW.prepare({ rt: rtC, storage: sC, me: meOwner });
eq("C: differences are shown, nothing copied", [prepC.copied, prepC.match, prepC.cloudHadData, prepC.rows.filter((r) => !r.ok).length > 0], [false, false, true, true]);
const resC = await SW.switchNow({ rt: rtC, storage: sC, me: meOwner, branchId: shop.branch_id });
eq("C: after the owner confirms, phone holds the cloud copy", [resC.ok, SW.readState(sC).products.map((p) => p.name).sort()], [true, ["Oil 1L", "Rice 5kg"]]);
eq("C: second phone gets its own device code", rtC.ctx().deviceId !== devA, true);

// ---- D: a cashier never copies anything to the cloud
who = "cash"; const meCash = await transport.rpc("whoami", {});
const sD = mem(); seedPhone(sD, { ...phoneData, products: [] }); const rtD = mkRt(sD); SW.takeSnapshot(sD);
const prepD = await SW.prepare({ rt: rtD, storage: sD, me: meCash });
eq("D: cashier: no import attempted", prepD.copied, false);
const resD = await SW.switchNow({ rt: rtD, storage: sD, me: meCash, branchId: shop.branch_id });
eq("D: cashier joins and receives the shop's products", [resD.ok, SW.readState(sD).products.length], [true, 2]);
SW.leaveCloud(sD); eq("D: leaving Cloud mode keeps the data", [rtD.mode(), SW.readState(sD).products.length], ["local", 2]);
console.log(`${pass} passed, ${fail} failed`); if (fail) process.exit(1);
