// Discounts, regular-customer discounts and post-checkout corrections (who may change what).
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

let pass = 0, fail = 0; const failures = [];
const U = {}; // name -> uuid
const uuid = () => crypto.randomUUID();
async function as(who, sql, params = []) {            // who: user name | 'anon' | 'service' | 'super'
  await db.exec("reset role");
  if (who === "super") return db.query(sql, params);
  const role = who === "anon" ? "anon" : who === "service" ? "service_role" : "authenticated";
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [U[who] || ""]);
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
}
const rpc = async (who, fn, ...args) => (await as(who, `select ${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args.map((a) => (a && typeof a === "object" ? JSON.stringify(a) : a)))).rows[0].r;
async function denied(label, p, re) { try { await p(); fail++; console.log("FAIL", label, "(allowed!)"); } catch (e) { if (re.test(e.message)) pass++; else { fail++; console.log("FAIL", label, e.message); } } }
function eq(l, a, b) { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.log("FAIL", l, JSON.stringify(a), "!=", JSON.stringify(b)); } }
for (const n of ["owner", "mgr", "joy", "kemi"]) { U[n] = uuid(); await db.query("insert into auth.users(id,email) values ($1,$2)", [U[n], n + "@x.invalid"]); }
const shop = await rpc("owner", "create_shop", "Shop", "shopx", "Owner"); const br = shop.branch_id;
for (const [k, role] of [["mgr", "manager"], ["joy", "cashier"], ["kemi", "cashier"]]) await as("service", "select add_member($1,$2,$3,$4,$4,$5,$6)", [U.owner, shop.shop_id, U[k], k, role, br]);
const prod = async (sku, price) => (await as("owner", "insert into products(shop_id,name,sku,cost,price) values ($1,$2,$2,50,$3) returning id", [shop.shop_id, sku, price])).rows[0].id;
const A = await prod("A", 1000), B = await prod("B", 500); await rpc("owner", "adjust_stock", br, A, 100, "r"); await rpc("owner", "adjust_stock", br, B, 100, "r");
const dev = await rpc("joy", "register_device", br, "d");
const mk = (items, extra = {}) => ({ id: uuid(), branch_id: br, device_id: dev.device_id, invoice_no: "I-" + uuid().slice(0, 8), sold_at: new Date().toISOString(), payment_method: "cash", items, ...extra });
const row = async (id) => (await as("super", "select total, subtotal, discount_total, amount_paid, balance_due, edited_by from sales where id=$1", [id])).rows[0];
const num = (x) => Number(x);


const stock = async (p) => num((await as("super", "select coalesce(sum(qty),0) q from stock_levels where product_id=$1 and branch_id=$2", [p, br])).rows[0].q);
// a cash sale of 3 x A (1000, 250 off) + 2 x B (500)
const s1 = mk([{ product_id: A, qty: 3, unit_price: 1000, discount: 300 }, { product_id: B, qty: 2, unit_price: 500 }]); await rpc("joy", "record_sale", s1);
const stA = await stock(A);
const rq = uuid();
const r1 = await rpc("owner", "refund_sale", s1.id, [{ product_id: A, qty: 1 }], true, "customer returned one", rq);
eq("owner return by product: pro-rata of the discounted line", [r1.status, num(r1.amount), num(r1.cash_back)], ["created", 900, 900]);
eq("restocked", await stock(A), stA + 1);
const r1b = await rpc("owner", "refund_sale", s1.id, [{ product_id: A, qty: 1 }], true, "customer returned one", rq);
eq("the same request again is applied once", [r1b.status, r1b.refund_id === r1.refund_id], ["duplicate", true]);
eq("...no second restock", await stock(A), stA + 1);
eq("sale shows refunded total and partial status", (await as("super", "select refunded_total::text r, status from sales where id=$1", [s1.id])).rows[0], { r: "900.00", status: "partially_refunded" });
await denied("cannot return more than was sold", () => rpc("owner", "refund_sale", s1.id, [{ product_id: A, qty: 3 }], true, "too many", uuid()), /refund_qty_too_high/);
await denied("a cashier cannot do a return on the server", () => rpc("joy", "refund_sale", s1.id, [{ product_id: B, qty: 1 }], true, "x", uuid()), /admin_required/);
await denied("a manager cannot either", () => rpc("mgr", "refund_sale", s1.id, [{ product_id: B, qty: 1 }], true, "x", uuid()), /admin_required/);
await denied("a reason is required", () => rpc("owner", "refund_sale", s1.id, [{ product_id: B, qty: 1 }], true, " ", uuid()), /reason_required/);
const stB = await stock(B);
const r2 = await rpc("owner", "refund_sale", s1.id, [{ product_id: B, qty: 1 }], false, "damaged, not resellable", uuid());
eq("not-restocked return leaves stock alone", await stock(B), stB);
// credit sale: return first reduces what is owed
const cust = (await as("joy", "insert into customers(shop_id,name) values ($1,'Ade') returning id", [shop.shop_id])).rows[0].id;
const s2 = mk([{ product_id: A, qty: 2, unit_price: 1000 }], { payment_method: "credit", amount_paid: 500, customer: { id: cust, name: "Ade" } }); await rpc("joy", "record_sale", s2);
const r3 = await rpc("owner", "refund_sale", s2.id, [{ product_id: A, qty: 1 }], true, "wrong item", uuid());
const q = (await as("super", "select balance_due::text b, refunded_total::text r from sales where id=$1", [s2.id])).rows[0];
eq("credit return: balance falls, no cash out until the debt is cleared", [num(r3.cash_back), q.b, q.r], [0, "500.00", "1000.00"]);
const r4 = await rpc("owner", "refund_sale", s2.id, [{ product_id: A, qty: 1 }], true, "other one too", uuid());
eq("second return: debt cleared first, rest is cash back", [num(r4.amount), num(r4.cash_back)], [1000, 500]);
eq("fully returned sale is marked refunded", (await as("super", "select status from sales where id=$1", [s2.id])).rows[0].status, "refunded");
await denied("a fully returned sale cannot be returned again", () => rpc("owner", "refund_sale", s2.id, [{ product_id: A, qty: 1 }], true, "x", uuid()), /sale_not_refundable|refund_qty_too_high/);
// concurrency: the same request 8 times at once
const s3 = mk([{ product_id: B, qty: 4, unit_price: 500 }]); await rpc("joy", "record_sale", s3); const rq3 = uuid(); const st3 = await stock(B);
const res = await Promise.allSettled(Array.from({ length: 8 }, () => rpc("owner", "refund_sale", s3.id, [{ product_id: B, qty: 1 }], true, "race", rq3)));
eq("8 simultaneous copies refund one unit once", [(await as("super", "select count(*)::int c from refunds where request_id=$1", [rq3])).rows[0].c, await stock(B)], [1, st3 + 1]);
const acts = (await as("owner", "select action from audit_log")).rows.map((x) => x.action); eq("returns are audited", acts.includes("sale.refund"), true);
console.log(`${pass} passed, ${fail} failed`); if (fail) process.exit(1);
