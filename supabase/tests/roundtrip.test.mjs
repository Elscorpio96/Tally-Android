// Proves: phone data -> import -> cloud -> pulled back into app shape gives the SAME totals,
// and that app-shaped sales mapped by saleToPayload are accepted by the real record_sale().
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
import { buildImportPayload } from "../../src/cloud/legacy-export.js";
import * as M from "../../src/cloud/mappers.js";
const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "../migrations/");
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`create extension if not exists pgcrypto; create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role; grant usage on schema public to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role; alter default privileges in schema public grant all on functions to anon,authenticated,service_role;`);
for (const f of fs.readdirSync(MIG).sort()) await db.exec(fs.readFileSync(MIG + f, "utf8"));
let pass = 0, fail = 0; const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass++ : (fail++, console.log("FAIL", l, JSON.stringify(a), "!=", JSON.stringify(b))));
const owner = crypto.randomUUID(), cash = crypto.randomUUID(); await db.query("insert into auth.users(id) values ($1),($2)", [owner, cash]);
let who = owner;
const as = async (sql, params = []) => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who]); await db.exec("set role authenticated"); try { return await db.query(sql, params); } finally { await db.exec("reset role"); } };
const rpc = async (fn, ...a) => (await as(`select ${fn}(${a.map((_, i) => `$${i + 1}`).join(",")}) r`, a)).rows[0].r;
// PostgREST-like JSON rows (dates as text, numerics as numbers)
const rows = async (t, where = "true") => (await as(`select to_jsonb(x) j from ${t} x where ${where}`)).rows.map((r) => r.j);

const shop = await rpc("create_shop", "Ade", "ade", "Ade");
await db.query("select add_member($1,$2,$3,'c1','Cash','cashier',$4)", [owner, shop.shop_id, cash, shop.branch_id]);
const phone = {
  branches: [{ id: "b1", name: "Main", address: "x", phone: "1" }],
  products: [{ id: "p1", name: "Rice", sku: "R", cost: 3000, price: 4000, lowStock: 2, quick: true, stock: { b1: 30 } }, { id: "p2", name: "Oil", sku: "O", cost: 1500, price: 2000, stock: { b1: 12 } }],
  customers: [{ id: "c1", name: "Ade", phone: "0801" }],
  sales: [
    { id: "s1", invoiceNo: 1, date: "2026-09-01", time: "2026-09-01T08:00:00.000Z", branchId: "b1", cashierName: "J", paymentType: "cash", amountTendered: 8000, balanceDue: 0, total: 8000, cost: 6000, items: [{ productId: "p1", name: "Rice", qty: 2, price: 4000, cost: 3000 }] },
    { id: "s2", invoiceNo: 2, date: "2026-09-02", time: "2026-09-02T08:00:00.000Z", branchId: "b1", cashierName: "J", customerId: "c1", customerName: "Ade", paymentType: "credit", amountTendered: 1000, balanceDue: 3000, total: 4000, cost: 3000, items: [{ productId: "p1", name: "Rice", qty: 1, price: 4000, cost: 3000 }] }],
  creditPayments: [{ id: "cp1", receiptNo: 1, customerId: "c1", amount: 500, date: "2026-09-03", branchId: "b1", cashierName: "J" }],
  purchases: [{ id: "pu", supplier: "D", date: "2026-08-30", branchId: "b1", total: 6000, items: [{ productId: "p2", name: "Oil", qty: 4, cost: 1500 }] }],
  expenses: [{ id: "e1", date: "2026-09-01", branchId: "b1", category: "Rent", amount: 700, note: "" }],
  dayCloses: { "b1|2026-09-01": { float: 100, counted: 8100, expected: 8100, difference: 0, note: "", closedBy: "J", closedAt: "2026-09-01T18:00:00.000Z" } },
};
const sent = buildImportPayload(phone);
eq("import ok", (await rpc("import_legacy", sent)).status, "imported");

// pull everything back into the app's shapes
const pulled = {
  branches: (await rows("branches")).map(M.branchFromCloud),
  products: (await rows("products")).map((p) => M.productFromCloud(p, [])),
};
const stockRows = await rows("stock_levels"); pulled.products = (await rows("products")).map((p) => M.productFromCloud(p, stockRows));
pulled.customers = (await rows("customers")).map(M.customerFromCloud);
const saleItems = await rows("sale_items"); pulled.sales = (await rows("sales")).map((s) => M.saleFromCloud(s, saleItems));
pulled.creditPayments = (await rows("credit_payments")).map(M.creditPaymentFromCloud);
const pItems = await rows("purchase_items"); pulled.purchases = (await rows("purchases")).map((p) => M.purchaseFromCloud(p, pItems));
pulled.expenses = (await rows("expenses")).map(M.expenseFromCloud); pulled.dayCloses = M.dayClosesFromCloud(await rows("day_closes"));
const back = buildImportPayload(pulled);
eq("totals identical after round trip", back.expected, sent.expected);
eq("sale dates unchanged", pulled.sales.map((s) => s.date).sort(), ["2026-09-01", "2026-09-02"]);
eq("day close key rebuilt with cloud branch id", Object.keys(pulled.dayCloses), [`${pulled.branches[0].id}|2026-09-01`]);
eq("product stock map keyed by cloud branch id", pulled.products.find((p) => p.name === "Rice").stock, { [pulled.branches[0].id]: 30 });

// now sell from the app's shape, as a cashier, using only mapper output
const rice = pulled.products.find((p) => p.name === "Rice"); const br = pulled.branches[0].id; const custId = pulled.customers[0].id;
const dev = await (async () => { who = cash; return rpc("register_device", br, "phone"); })();
const sale = { id: crypto.randomUUID(), invoiceNo: dev.invoice_prefix + "-1", date: "2026-10-13", time: new Date().toISOString(), branchId: br, paymentType: "cash", amountTendered: 10000, total: 8000, items: [{ productId: rice.id, qty: 2, price: 4000 }] };
const r = await rpc("record_sale", M.saleToPayload(sale, { deviceId: dev.device_id }));
eq("mapped cash sale accepted, change not stored as revenue", [r.status, Number(r.total)], ["created", 8000]);
const cs = { id: crypto.randomUUID(), invoiceNo: dev.invoice_prefix + "-2", time: new Date().toISOString(), branchId: br, paymentType: "credit", customerId: custId, customerName: "Ade", amountTendered: 0, total: 4000, dueDate: "2026-11-01", items: [{ productId: rice.id, qty: 1, price: 4000 }] };
eq("mapped credit sale accepted", Number((await rpc("record_sale", M.saleToPayload(cs, { deviceId: dev.device_id }))).balance_due), 4000);
const pay = { id: crypto.randomUUID(), receiptNo: dev.invoice_prefix + "-R1", customerId: custId, amount: 1000, time: new Date().toISOString(), branchId: br };
eq("mapped repayment accepted", Number((await rpc("record_credit_payment", M.creditPaymentToPayload(pay, { deviceId: dev.device_id }))).balance_after), 3000 - 500 + 4000 - 1000);
who = owner; eq("mapped purchase accepted (owner)", (await rpc("receive_purchase", M.purchaseToPayload({ id: crypto.randomUUID(), branchId: br, supplier: "S", date: "2026-10-13", items: [{ productId: rice.id, qty: 5, cost: 3100 }] }))).status, "created");
console.log(`${pass} passed, ${fail} failed`); if (fail) process.exit(1);
