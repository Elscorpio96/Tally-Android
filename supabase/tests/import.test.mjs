// Tests the one-time import of on-phone data. Run: node import.test.mjs
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "../migrations/");
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`create extension if not exists pgcrypto;
 create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;
 grant usage on schema public to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant all on functions to anon,authenticated,service_role;`);
for (const f of fs.readdirSync(MIG).sort()) await db.exec(fs.readFileSync(MIG + f, "utf8"));
let pass = 0, fail = 0; const U = {};
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass++ : (fail++, console.log("FAIL", l, JSON.stringify(a), "!=", JSON.stringify(b))));
async function as(who, sql, params = []) {
  await db.exec("reset role"); if (who === "super") return db.query(sql, params);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [U[who] || ""]); await db.exec(`set role ${who === "service" ? "service_role" : "authenticated"}`);
  try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
}
const rpc = async (who, fn, ...a) => (await as(who, `select ${fn}(${a.map((_, i) => `$${i + 1}`).join(",")}) r`, a)).rows[0].r;
const bad = async (l, fn, re) => { try { await fn(); fail++; console.log("FAIL (allowed)", l); } catch (e) { re.test(e.message) ? pass++ : (fail++, console.log("FAIL", l, e.message)); } };
for (const n of ["owner", "mgr", "owner2"]) { U[n] = crypto.randomUUID(); await db.query("insert into auth.users(id) values($1)", [U[n]]); }
const shop = await rpc("owner", "create_shop", "Ade Stores", "adestore", "Ade");
const shop2 = await rpc("owner2", "create_shop", "Other", "other", "O");
await as("service", "select add_member($1,$2,$3,'m','Mgr','manager',$4)", [U.owner, shop.shop_id, U.mgr, shop.branch_id]);

// ---- a realistic phone backup (shapes taken from the real localStorage model)
const phone = {
  branches: [{ id: "b1", name: "Main Shop", address: "Bauchi Rd", phone: "0816" }, { id: "b2", name: "Lekki", address: "", phone: "" }],
  products: [
    { id: "p1", name: "Rice 5kg", sku: "RICE", barcode: "111", category: "Grain", cost: 3000, price: 4000, lowStock: 5, quick: true, stock: { b1: 40, b2: 10 } },
    { id: "p2", name: "Oil 1L", sku: "", barcode: "", category: "", cost: 1500, price: 2000, lowStock: 0, stock: { b1: -3 } },          // empty SKU, negative stock
    { id: "p3", name: "Rice Big", sku: "rice", barcode: "111", cost: 100, price: 150, stock: { b1: 7.5 } },                              // duplicate SKU (case) + barcode
  ],
  customers: [{ id: "c1", name: "Ade", phone: "0801", remindedAt: "2026-09-01" }],
  sales: [
    { id: "s-1", invoiceNo: 1, date: "2026-09-01", time: "2026-09-01T08:10:00.000Z", branchId: "b1", cashierName: "Joy", paymentType: "cash", amountTendered: 8000, balanceDue: 0, total: 8000, cost: 6000, items: [{ productId: "p1", name: "Rice 5kg", qty: 2, price: 4000, cost: 3000 }] },
    { id: "s-2", invoiceNo: 2, date: "2026-09-01", time: "2026-09-01T23:30:00.000Z", branchId: "b1", cashierName: "Joy", customerId: "c1", customerName: "Ade", paymentType: "credit", amountTendered: 1000, balanceDue: 3000, total: 4000, cost: 3000, edited: true, items: [{ productId: "p1", name: "Rice 5kg", qty: 1, price: 4000, cost: 3000 }] },
    { id: "s-3", invoiceNo: 1, date: "2026-09-02", time: "2026-09-02T09:00:00.000Z", branchId: "b2", cashierName: "Bola", customerName: "Walk-in Tunde", paymentType: "credit", amountTendered: 0, balanceDue: 2000, total: 2000, cost: 1500, items: [{ productId: "p2", name: "Oil 1L", qty: 1, price: 2000, cost: 1500 }] }, // credit with no customer id, invoice number repeated
  ],
  creditPayments: [{ id: "cp1", receiptNo: 1, customerId: "c1", amount: 1200, date: "2026-09-03", branchId: "b1", cashierName: "Joy", note: "part" }],
  purchases: [{ id: "pu1", supplier: "Dangote", date: "2026-08-30", branchId: "b1", total: 60000, items: [{ productId: "p1", name: "Rice 5kg", qty: 20, cost: 3000 }] }],
  expenses: [{ id: "e1", date: "2026-09-01", branchId: "b1", category: "Rent", amount: 15000, note: "" }],
  dayCloses: { "b1|2026-09-01": { float: 5000, counted: 13000, expected: 13000, difference: 0, note: "", closedBy: "Joy", closedAt: "2026-09-01T18:00:00.000Z" } },
};
// ---- client-side export builder (this is the logic the app will use; kept here so it is tested)
const { buildImportPayload } = await import("../../src/cloud/legacy-export.js");
const payload = buildImportPayload(phone);
console.log("expected:", JSON.stringify(payload.expected));

await bad("manager can't import", () => rpc("mgr", "import_legacy", payload), /owner_required/);
await bad("anon-like stranger can't import", () => rpc("service", "import_legacy", payload), /not_a_member|permission denied/);
const r1 = await rpc("owner", "import_legacy", payload);
eq("first import", r1.status, "imported");
const q = async (sql) => (await as("super", sql)).rows;
eq("sales imported", (await q("select count(*)::int c from sales where shop_id='" + shop.shop_id + "'"))[0].c, 3);
eq("repeated invoice numbers kept distinct", (await q("select count(distinct invoice_no)::int c from sales"))[0].c, 3);
eq("credit sale with no customer id got a customer", (await q("select count(*)::int c from sales s join customers c on c.id=s.customer_id where s.legacy_id='s-3'"))[0].c, 1);
eq("old business date preserved (not re-derived)", (await q("select business_date::text d from sales where legacy_id='s-2'"))[0].d, "2026-09-01");
eq("customer balance ada = 3000-1200", Number((await q(`select app.customer_balance('${shop.shop_id}', id) b from customers where legacy_id='c1'`))[0].b), 1800);
eq("stock b1 rice", Number((await q("select qty from stock_levels sl join products p on p.id=sl.product_id join branches b on b.id=sl.branch_id where p.legacy_id='p1' and b.legacy_id='b1'"))[0].qty), 40);
eq("negative stock preserved", Number((await q("select qty from stock_levels sl join products p on p.id=sl.product_id where p.legacy_id='p2'"))[0].qty), -3);
eq("fractional stock preserved", Number((await q("select qty from stock_levels sl join products p on p.id=sl.product_id where p.legacy_id='p3'"))[0].qty), 7.5);
eq("empty/duplicate SKUs made unique", (await q("select count(distinct lower(sku))::int c from products"))[0].c, 3);
eq("duplicate barcode blanked, not failed", (await q("select count(*)::int c from products where barcode='111'"))[0].c, 1);
eq("main branch reused, no stray MAIN", (await q("select string_agg(code, ',' order by code) s from branches where shop_id='" + shop.shop_id + "'"))[0].s, "LEKK,MAIN");
eq("sold_at kept", (await q("select to_char(sold_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI') t from sales where legacy_id='s-2'"))[0].t, "2026-09-01T23:30");
eq("audit row", (await as("owner", "select count(*)::int c from audit_log where action='migration.import'")).rows[0].c, 1);
eq("no stock movement for historical sales", (await q("select count(*)::int c from stock_movements where reason='sale'"))[0].c, 0);

// ---- repeat safety
eq("same backup again is a no-op", (await rpc("owner", "import_legacy", payload)).status, "already_imported");
eq("no duplicates after repeat", (await q("select (select count(*) from sales)::int s, (select count(*) from products)::int p, (select count(*) from stock_movements)::int m")), [{ s: 3, p: 3, m: 4 }]);

// ---- a newer backup (more sales, live stock must NOT be overwritten)
await as("super", "update stock_levels set qty = 5 where product_id=(select id from products where legacy_id='p1') and branch_id=(select id from branches where legacy_id='b1')");
const phone2 = JSON.parse(JSON.stringify(phone));
phone2.sales.push({ id: "s-4", invoiceNo: 3, date: "2026-09-04", time: "2026-09-04T10:00:00.000Z", branchId: "b1", cashierName: "Joy", paymentType: "cash", amountTendered: 4000, balanceDue: 0, total: 4000, cost: 3000, items: [{ productId: "p1", name: "Rice 5kg", qty: 1, price: 4000, cost: 3000 }] });
const r2 = await rpc("owner", "import_legacy", buildImportPayload(phone2));
eq("newer backup imports only the new sale", [r2.status, (await q("select count(*)::int c from sales"))[0].c], ["imported", 4]);
eq("live stock untouched by 2nd import", Number((await q("select qty from stock_levels where qty=5 limit 1"))[0].qty), 5);

// ---- verification failure rolls EVERYTHING back (separate shop)
const U2shop = shop2;
const p3 = buildImportPayload(phone); p3.source_hash = "different"; p3.expected.sales_total += 1;   // phone says a different total
await bad("totals mismatch is refused", () => rpc("owner2", "import_legacy", p3), /import_verification_failed: sales_total/);
eq("nothing left behind after refusal", (await q(`select (select count(*) from sales where shop_id='${U2shop.shop_id}')::int s, (select count(*) from products where shop_id='${U2shop.shop_id}')::int p, (select count(*) from migration_runs where shop_id='${U2shop.shop_id}' and status='completed')::int m`)), [{ s: 0, p: 0, m: 0 }]);
const p4 = buildImportPayload(phone); p4.source_hash = "bad-sale"; p4.sales[0].total = 1;
await bad("sale whose items don't add up is refused", () => rpc("owner2", "import_legacy", p4), /import_sale_total_mismatch/);
eq("shop 2 still empty", (await q(`select count(*)::int c from products where shop_id='${U2shop.shop_id}'`))[0].c, 0);
const p5 = buildImportPayload(phone); p5.source_hash = "ok2";
eq("shop 2 can import the same data (separate tenant)", (await rpc("owner2", "import_legacy", p5)).status, "imported");
eq("shops stay separate", (await q(`select count(*)::int c from sales where shop_id='${shop.shop_id}'`))[0].c, 4);
eq("owner of shop 1 sees none of shop 2's imported rows", (await as("owner", `select count(*)::int c from sales where shop_id='${shop2.shop_id}'`)).rows[0].c, 0);

// ---- v1.13+ data: line discounts and customer returns (this used to fail with import_sale_total_mismatch)
U.owner3 = crypto.randomUUID(); await db.query("insert into auth.users(id) values($1)", [U.owner3]);
const shop3 = await rpc("owner3", "create_shop", "Mai Agogo", "maiagogo", "Haruna");
const phoneD = {
  branches: [{ id: "b1", name: "Main Branch" }],
  products: [{ id: "p1", name: "Item A", sku: "A", cost: 90000, price: 100000, stock: { b1: 5 } }, { id: "p2", name: "Item B", sku: "B", cost: 20000, price: 23500, stock: { b1: 9 } }],
  customers: [],
  sales: [
    { id: "s-d1", invoiceNo: 1, date: "2026-10-01", time: "2026-10-01T09:00:00.000Z", branchId: "b1", cashierName: "Haruna", paymentType: "cash", amountTendered: 244800, balanceDue: 0, total: 244800, cost: 200000,
      items: [{ productId: "p1", name: "Item A", qty: 2, price: 100000, cost: 90000, discount: 2200 }, { productId: "p2", name: "Item B", qty: 2, price: 23500, cost: 20000 }],
      returns: [{ id: "r1", time: "2026-10-02T10:00:00.000Z", date: "2026-10-02", reason: "Faulty", restock: true, amount: 23500, cashBack: 23500, items: [{ productId: "p2", name: "Item B", qty: 1, amount: 23500, cost: 20000 }] }] },
    { id: "s-d2", invoiceNo: 2, date: "2026-10-03", time: "2026-10-03T09:00:00.000Z", branchId: "b1", cashierName: "Haruna", paymentType: "cash", amountTendered: 3000, balanceDue: 0, total: 3000, cost: 2000,
      items: [{ productId: "p2", name: "Item B", qty: 1, price: 3000, cost: 2000, discount: 0 }] },
  ],
  creditPayments: [], purchases: [], expenses: [], dayCloses: {},
};
const pd = buildImportPayload(phoneD);
const rd = await rpc("owner3", "import_legacy", pd);
eq("discounted sale + return imports", rd.status, "imported");
const q3 = async (sql) => (await as("super", sql)).rows;
eq("sale subtotal / discount / total", (await q3(`select subtotal::float s, discount_total::float d, total::float t, refunded_total::float r, status from sales where shop_id='${shop3.shop_id}' and legacy_id='s-d1'`))[0], { s: 247000, d: 2200, t: 244800, r: 23500, status: "partially_refunded" });
eq("line discount stored", (await q3(`select discount::float d, line_total::float t from sale_items where shop_id='${shop3.shop_id}' and name='Item A'`))[0], { d: 2200, t: 197800 });
eq("return stored as history, stock untouched", (await q3(`select (select count(*) from refunds where shop_id='${shop3.shop_id}')::int r, (select sum(qty)::float from stock_levels where shop_id='${shop3.shop_id}') s`))[0], { r: 1, s: 14 });
const phoneDisc = JSON.parse(JSON.stringify(phoneD)); phoneDisc.sales[1].id = "s-d3"; phoneDisc.sales[1].items[0].discount = 500;
const pd2 = buildImportPayload(phoneDisc); pd2.source_hash = "d2"; pd2.sales[1].total = 3000;
await bad("a discount that does not add up is still refused", () => rpc("owner3", "import_legacy", pd2), /import_sale_total_mismatch/);
console.log(`${pass} passed, ${fail} failed`); if (fail) process.exit(1);
