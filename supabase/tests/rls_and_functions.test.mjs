// Runs the migrations in PGlite (PostgreSQL in WASM) with a stub Supabase auth schema and proves:
// tenant isolation, role limits, idempotent sales, stock rules, audit immutability.
// Usage: node rls_and_functions.test.mjs   (needs @electric-sql/pglite)
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
async function ok(label, p) { try { const r = await p(); pass++; return r; } catch (e) { fail++; failures.push(`${label}: unexpected error: ${e.message}`); console.log("  FAIL", label, "->", e.message); } }
async function denied(label, p, re = /./) {
  try { const r = await p(); if (r && r.rows && r.rows.length === 0 && r.affectedRows === 0) { pass++; return; } fail++; failures.push(`${label}: should have been denied but succeeded`); console.log("  FAIL", label, "(allowed!)", JSON.stringify(r.rows?.slice(0,2))); }
  catch (e) { if (re.test(e.message)) pass++; else { fail++; failures.push(`${label}: wrong error ${e.message}`); console.log("  FAIL", label, e.message); } }
}
function eq(label, a, b) { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; failures.push(`${label}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); console.log("  FAIL", label, JSON.stringify(a), "!=", JSON.stringify(b)); } }
const rpc = async (who, fn, ...args) => (await as(who, `select ${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args)).rows[0].r;

// ------------------------------------------------------------ users & shops
for (const n of ["ownerA", "ownerB", "mgrA", "cashA", "cashA2", "cashB", "stranger"]) { U[n] = uuid(); await db.query("insert into auth.users(id,email) values ($1,$2)", [U[n], n + "@x.invalid"]); }
const shopA = await ok("create_shop A", () => rpc("ownerA", "create_shop", "Shop A", "shopa", "Owner A"));
const shopB = await ok("create_shop B", () => rpc("ownerB", "create_shop", "Shop B", "shopb", "Owner B"));
await denied("owner can't create a 2nd shop", () => rpc("ownerA", "create_shop", "Again", "shopa2", "x"), /already_member/);
await denied("duplicate shop code", () => rpc("stranger", "create_shop", "Dup", "shopa", "x"), /duplicate|unique/i);
await denied("anon can't create_shop", () => rpc("anon", "create_shop", "x", "anonshop", "x"), /permission denied/);
const brA = shopA.branch_id, brB = shopB.branch_id;
const brA2 = (await as("ownerA", "insert into branches(shop_id,code,name) values ($1,'LEK','Lekki') returning id", [shopA.shop_id])).rows[0].id;

// staff are created by the Edge Function with service_role
await denied("authenticated can't call add_member", () => as("ownerA", "select add_member($1,$2,$3,'hack','Hack','admin',$4)", [U.ownerA, shopA.shop_id, U.stranger, brA]), /permission denied/);
await denied("anon can't call add_member", () => as("anon", "select add_member($1,$2,$3,'hack','Hack','admin',$4)", [U.ownerA, shopA.shop_id, U.stranger, brA]), /permission denied/);
await ok("service adds manager", () => as("service", "select add_member($1,$2,$3,'mgr','Manager A','manager',$4)", [U.ownerA, shopA.shop_id, U.mgrA, brA]));
await ok("service adds cashier A", () => as("service", "select add_member($1,$2,$3,'cash1','Cashier A','cashier',$4)", [U.ownerA, shopA.shop_id, U.cashA, brA]));
await ok("service adds cashier A2", () => as("service", "select add_member($1,$2,$3,'cash2','Cashier A2','cashier',$4)", [U.ownerA, shopA.shop_id, U.cashA2, brA]));
await ok("service adds cashier B", () => as("service", "select add_member($1,$2,$3,'cash1','Cashier B','cashier',$4)", [U.ownerB, shopB.shop_id, U.cashB, brB]));
await denied("actor from another shop can't add staff to A", () => as("service", "select add_member($1,$2,$3,'x','X','cashier',$4)", [U.ownerB, shopA.shop_id, U.stranger, brA]), /actor_not_admin/);
await denied("manager can't be actor to add staff", () => as("service", "select add_member($1,$2,$3,'x','X','cashier',$4)", [U.mgrA, shopA.shop_id, U.stranger, brA]), /actor_not_admin/);
eq("whoami cashier", (await rpc("cashA", "whoami")).role, "cashier");
eq("whoami stranger is null", await rpc("stranger", "whoami"), null);

// ------------------------------------------------------------ privilege surface
const tables = (await as("super", "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")).rows;
eq("RLS enabled on every public table", tables.filter(t => !t.relrowsecurity).map(t => t.relname), []);
const anonGrants = (await as("super", "select table_name from information_schema.role_table_grants where grantee='anon' and table_schema='public'")).rows;
eq("anon has no table privileges", anonGrants, []);
const anonFn = (await as("super", `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')`)).rows;
eq("anon can execute no public function", anonFn, []);
const authFn = (await as("super", `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`)).rows.map(r => r.proname);
eq("authenticated function surface", authFn, ["adjust_stock","adjust_stock_by","cloud_totals","create_shop","edit_sale_prices","get_customer_balances","get_customer_ledger","import_legacy","receive_purchase","record_credit_payment","record_sale","refund_sale","register_device","revise_sale","set_member","shop_stamp","void_sale","whoami"]);
for (const t of ["sales","sale_items","stock_levels","stock_movements","credit_payments","refunds","refund_items","audit_log","memberships","stock_discrepancies","purchases","purchase_items"])
  for (const op of ["INSERT","UPDATE","DELETE"]) eq(`authenticated lacks ${op} on ${t}`, (await as("super", `select has_table_privilege('authenticated','${t}','${op}') b`)).rows[0].b, false);
await denied("owner direct insert into sales", () => as("ownerA", `insert into sales(id,shop_id,branch_id,cashier_id,invoice_no,sold_at,business_date,payment_method,subtotal,total) values (gen_random_uuid(),$1,$2,$3,'X',now(),current_date,'cash',1,1)`, [shopA.shop_id, brA, U.ownerA]), /permission denied/);
await denied("owner direct update stock", () => as("ownerA", "update stock_levels set qty=999"), /permission denied/);
await denied("owner direct update audit_log", () => as("ownerA", "update audit_log set action='x'"), /permission denied/);
await denied("owner direct delete audit_log", () => as("ownerA", "delete from audit_log"), /permission denied/);
await denied("superuser can't rewrite audit_log either (trigger)", () => as("super", "update audit_log set action='x'"), /append-only|immutable|not allowed/i);
await denied("superuser can't delete stock_movements (trigger)", () => as("super", "delete from stock_movements"), /append-only|immutable|not allowed/i);

// ------------------------------------------------------------ catalogue
const P = {};
for (const [k, nm, cost, price, sku] of [["rice", "Rice 5kg", 3000, 4000, "RICE5"], ["oil", "Oil 1L", 1500, 2000, "OIL1"]]) {
  P[k] = (await ok("owner creates product " + k, () => as("ownerA", "insert into products(shop_id,name,sku,cost,price) values ($1,$2,$3,$4,$5) returning id", [shopA.shop_id, nm, sku, cost, price]))).rows[0].id;
}
const PB = (await as("ownerB", "insert into products(shop_id,name,sku,cost,price) values ($1,'B item','RICE5',10,20) returning id", [shopB.shop_id])).rows[0].id; // same SKU in another shop is fine
await denied("duplicate SKU in the same shop", () => as("ownerA", "insert into products(shop_id,name,sku,cost,price) values ($1,'dup','rice5',1,2)", [shopA.shop_id]), /duplicate|unique/i);
await denied("cashier can't create product", () => as("cashA", "insert into products(shop_id,name,sku,cost,price) values ($1,'x','z',1,2)", [shopA.shop_id]), /permission denied|row-level/);
await denied("owner A can't create a product in shop B", () => as("ownerA", "insert into products(shop_id,name,sku,cost,price) values ($1,'x','zz',1,2)", [shopB.shop_id]), /row-level|permission denied/);
await denied("cashier can't change a price", () => as("cashA", "update products set price=1 where id=$1", [P.rice]), /permission denied|row-level/);
await ok("owner changes price", () => as("ownerA", "update products set price=4100 where id=$1", [P.rice]));
await as("ownerA", "update products set price=4000 where id=$1", [P.rice]);

// stock via purchase
await ok("manager receives purchase", () => rpc("mgrA", "receive_purchase", { id: uuid(), branch_id: brA, supplier: "Dangote", items: [{ product_id: P.rice, qty: 10, unit_cost: 3000 }, { product_id: P.oil, qty: 5, unit_cost: 1500 }] }));
await denied("cashier can't receive purchase", () => rpc("cashA", "receive_purchase", { id: uuid(), branch_id: brA, supplier: "x", items: [{ product_id: P.rice, qty: 1, unit_cost: 1 }] }), /manager_required/);
await denied("purchase with other shop's product", () => rpc("ownerA", "receive_purchase", { id: uuid(), branch_id: brA, supplier: "x", items: [{ product_id: PB, qty: 1, unit_cost: 1 }] }), /invalid_purchase_lines/);
await denied("purchase into other shop's branch", () => rpc("ownerA", "receive_purchase", { id: uuid(), branch_id: brB, supplier: "x", items: [{ product_id: P.rice, qty: 1, unit_cost: 1 }] }), /branch_not_allowed/);
const stock = async (pid, br = brA) => Number((await as("super", "select qty from stock_levels where product_id=$1 and branch_id=$2", [pid, br])).rows[0]?.qty ?? 0);
eq("stock rice after purchase", await stock(P.rice), 10);

// ------------------------------------------------------------ tenant isolation (reads)
await as("ownerB", "insert into customers(shop_id,name) values ($1,'B customer')", [shopB.shop_id]);
for (const t of ["products", "branches", "stock_levels", "customers", "memberships", "profiles", "audit_log", "shops", "purchases"]) {
  const rowsA = (await as("ownerA", `select * from ${t}`)).rows;
  const leak = rowsA.filter(r => (r.shop_id && r.shop_id === shopB.shop_id) || (t === "shops" && r.id === shopB.shop_id));
  eq(`owner A sees none of B's ${t}`, leak.length, 0);
}
eq("owner A sees exactly shop A", (await as("ownerA", "select id from shops")).rows.map(r => r.id), [shopA.shop_id]);
eq("owner A can't read B's product by id", (await as("ownerA", "select * from products where id=$1", [PB])).rows.length, 0);
eq("stranger sees nothing", (await as("stranger", "select * from products")).rows.length, 0);
await denied("anon reads products", () => as("anon", "select * from products"), /permission denied/);
// writes
await as("ownerA", "update products set name='HACKED' where id=$1", [PB]);
eq("owner A update of B's product has no effect", (await as("super", "select name from products where id=$1", [PB])).rows[0].name, "B item");
await denied("nobody can hard-delete products (archive instead)", () => as("ownerA", "delete from products where id=$1", [PB]), /permission denied/);
await denied("move product to shop B by update", () => as("ownerA", "update products set shop_id=$1 where id=$2", [shopB.shop_id, P.rice]), /permission denied|row-level|violates/);
await denied("insert customer into shop B", () => as("ownerA", "insert into customers(shop_id,name) values ($1,'x')", [shopB.shop_id]), /row-level/);
await denied("forged membership self-promotion", () => as("cashA", "update memberships set role='owner' where user_id=$1", [U.cashA]), /permission denied/);
await denied("forged membership insert", () => as("cashA", "insert into memberships(user_id,shop_id,role) values ($1,$2,'owner')", [U.stranger, shopA.shop_id]), /permission denied/);
await denied("cashier can't change shop settings", () => as("cashA", "update shops set negative_stock_policy='reject' where id=$1", [shopA.shop_id]), /permission denied|row-level/);

// ------------------------------------------------------------ record_sale
const dev = await ok("register device", () => rpc("cashA", "register_device", brA, "Counter 1"));
const dev2 = await ok("register device 2", () => rpc("cashA2", "register_device", brA, "Counter 2"));
eq("invoice prefix shape", /^MAIN-[A-Z0-9]{3}$/.test(dev.invoice_prefix), true);
await denied("cashier can't register device for a branch not allowed", () => rpc("cashA", "register_device", brA2, "x"), /branch_not_allowed/);
const saleId = uuid();
const mk = (id, items, extra = {}) => ({ id, branch_id: brA, device_id: dev.device_id, invoice_no: `${dev.invoice_prefix}-${Math.floor(Math.random() * 1e6)}`, sold_at: new Date().toISOString(), payment_method: "cash", items, ...extra });
const s1 = mk(saleId, [{ product_id: P.rice, qty: 2, unit_price: 4000 }]);
const r1 = await ok("cashier records sale", () => rpc("cashA", "record_sale", s1));
eq("sale created", r1.status, "created"); eq("sale total", Number(r1.total), 8000);
eq("stock decremented", await stock(P.rice), 8);
const r1b = await ok("same sale retried", () => rpc("cashA", "record_sale", s1));
eq("retry is duplicate", r1b.status, "duplicate");
eq("retry did not double-decrement", await stock(P.rice), 8);
eq("only one sale row", (await as("super", "select count(*)::int c from sales where id=$1", [saleId])).rows[0].c, 1);
const bigId = uuid();
await ok("cashier A2 retrying A's sale id is still idempotent", async () => eq("dup by other cashier", (await rpc("cashA2", "record_sale", s1)).status, "duplicate"));
await denied("shop B can't replay A's sale id", () => rpc("cashB", "record_sale", { ...s1, branch_id: brB, items: [{ product_id: PB, qty: 1, unit_price: 20 }] }), /id_conflict|duplicate/);
eq("sale recorded server-side cashier", (await as("super", "select cashier_id from sales where id=$1", [saleId])).rows[0].cashier_id, U.cashA);
await denied("client lies about cashier (ignored): total mismatch", () => rpc("cashA", "record_sale", mk(uuid(), [{ product_id: P.rice, qty: 1, unit_price: 4000 }], { client_total: 1 })), /total_mismatch/);
await denied("discount larger than the line is refused", () => rpc("cashA", "record_sale", mk(uuid(), [{ product_id: P.rice, qty: 1, unit_price: 4000, discount: 5000 }])), /discount_exceeds_line/);
await ok("manager discount ok", () => rpc("mgrA", "record_sale", mk(uuid(), [{ product_id: P.oil, qty: 1, unit_price: 2000, discount: 200 }])));
await denied("sale with other shop's product", () => rpc("cashA", "record_sale", mk(uuid(), [{ product_id: PB, qty: 1, unit_price: 1 }])), /unknown_product/);
await denied("sale into other shop's branch", () => rpc("cashA", "record_sale", { ...mk(uuid(), [{ product_id: P.rice, qty: 1, unit_price: 1 }]), branch_id: brB }), /branch_not_allowed/);
await denied("sale into branch cashier isn't assigned", () => rpc("cashA", "record_sale", { ...mk(uuid(), [{ product_id: P.rice, qty: 1, unit_price: 1 }]), branch_id: brA2 }), /branch_not_allowed/);
await denied("negative qty", () => rpc("cashA", "record_sale", mk(uuid(), [{ product_id: P.rice, qty: -1, unit_price: 4000 }])), /invalid_line/);
await denied("zero qty", () => rpc("cashA", "record_sale", mk(uuid(), [{ product_id: P.rice, qty: 0, unit_price: 4000 }])), /invalid_line/);
await denied("empty sale", () => rpc("cashA", "record_sale", mk(uuid(), [])), /empty_sale/);
await denied("future-dated sale", () => rpc("cashA", "record_sale", mk(uuid(), [{ product_id: P.rice, qty: 1, unit_price: 4000 }], { sold_at: new Date(Date.now() + 5 * 864e5).toISOString() })), /sold_at_in_future/);
await denied("underpaid cash sale", () => rpc("cashA", "record_sale", mk(uuid(), [{ product_id: P.rice, qty: 1, unit_price: 4000 }], { amount_paid: 10 })), /underpaid/);
await denied("credit sale without customer", () => rpc("cashA", "record_sale", mk(uuid(), [{ product_id: P.rice, qty: 1, unit_price: 4000 }], { payment_method: "credit" })), /customer_required/);
await denied("duplicate invoice number, new id", () => rpc("cashA", "record_sale", { ...mk(uuid(), [{ product_id: P.rice, qty: 1, unit_price: 4000 }]), invoice_no: s1.invoice_no }), /invoice_conflict/);
eq("failed sales left stock untouched", await stock(P.rice), 8);

// business date is in shop time zone (Lagos = UTC+1): 23:30 UTC on 1 Jan is 00:30 on 2 Jan locally
const late = await rpc("cashA", "record_sale", mk(uuid(), [{ product_id: P.oil, qty: 1, unit_price: 2000 }], { sold_at: "2026-01-01T23:30:00Z" }));
eq("business_date uses Africa/Lagos", late.business_date, "2026-01-02");

// credit sale + repayments
const custId = uuid();
const cs = await ok("credit sale", () => rpc("cashA", "record_sale", mk(uuid(), [{ product_id: P.rice, qty: 1, unit_price: 4000 }], { payment_method: "credit", amount_paid: 1000, customer: { id: custId, name: "Ade", phone: "0801" } })));
eq("credit balance due", Number(cs.balance_due), 3000);
eq("cashier can read balances", Number((await as("cashA", "select * from get_customer_balances()")).rows[0].balance), 3000);
const pay = { id: uuid(), branch_id: brA, customer_id: custId, receipt_no: "R-1", amount: 1200, paid_at: new Date().toISOString() };
eq("repayment", Number((await rpc("cashA", "record_credit_payment", pay)).balance_after), 1800);
eq("repayment retry idempotent", (await rpc("cashA", "record_credit_payment", pay)).status, "duplicate");
eq("balance after retry", Number((await as("cashA", "select * from get_customer_balances()")).rows[0].balance), 1800);
await denied("repay unknown customer", () => rpc("cashA", "record_credit_payment", { ...pay, id: uuid(), receipt_no: "R-2", customer_id: uuid() }), /unknown_customer/);
await denied("repay with zero", () => rpc("cashA", "record_credit_payment", { ...pay, id: uuid(), receipt_no: "R-3", amount: 0 }), /invalid_amount/);
await denied("shop B can't use A's customer", () => rpc("cashB", "record_credit_payment", { ...pay, id: uuid(), receipt_no: "R-4", branch_id: brB }), /unknown_customer/);
eq("shop B sees no A balances", (await as("cashB", "select * from get_customer_balances()")).rows.length, 0);
await denied("shop B ledger of A's customer", () => rpc("cashB", "get_customer_ledger", custId), /unknown|not_found|denied/i);

// ------------------------------------------------------------ visibility inside a shop
eq("cashier A sees own sales only", (await as("cashA", "select distinct cashier_id from sales")).rows.map(r => r.cashier_id), [U.cashA]);
eq("cashier A2 sees none of A's sales", (await as("cashA2", "select * from sales")).rows.length, 0);
eq("manager sees all branch sales", (await as("mgrA", "select count(*)::int c from sales")).rows[0].c > 2, true);
eq("shop B sees no sales", (await as("ownerB", "select * from sales")).rows.length, 0);
eq("sale_items follow sale visibility", (await as("cashA2", "select * from sale_items")).rows.length, 0);
await denied("cashier can't read audit_log", () => as("cashA", "select * from audit_log"), /permission denied/);
eq("cashier sees no audit rows", (await as("cashA", "select count(*)::int c from audit_log").catch(() => ({ rows: [{ c: 0 }] }))).rows[0].c, 0);
eq("owner reads audit", (await as("ownerA", "select count(*)::int c from audit_log")).rows[0].c > 0, true);
eq("cashier can't see cost? (stock_movements none)", (await as("cashA2", "select * from stock_movements")).rows.length, 0);
eq("views obey RLS (cashier A2)", (await as("cashA2", "select * from v_daily_sales")).rows.length, 0);
eq("views show owner data", (await as("ownerA", "select sum(sale_count)::int n from v_daily_sales")).rows[0].n > 0, true);
eq("views hide other shop", (await as("ownerB", "select * from v_daily_sales")).rows.length, 0);

// ------------------------------------------------------------ void / refund / edit price (audited)
await denied("cashier can't void", () => rpc("cashA", "void_sale", saleId, "oops"), /admin_required/);
await denied("manager can't void", () => rpc("mgrA", "void_sale", saleId, "oops"), /admin_required/);
await denied("void needs reason", () => rpc("ownerA", "void_sale", saleId, ""), /reason_required/);
await denied("shop B owner can't void A's sale", () => rpc("ownerB", "void_sale", saleId, "attack"), /unknown_sale/);
await denied("another cashier can't edit this sale's prices", () => rpc("cashA2", "edit_sale_prices", saleId, [], "x"), /edit_not_allowed/);
const itemId = (await as("super", "select id from sale_items where sale_id=$1", [saleId])).rows[0].id;
const ed = await ok("owner edits price", () => rpc("ownerA", "edit_sale_prices", saleId, [{ sale_item_id: itemId, unit_price: 3500 }], "negotiated"));
eq("edited total", Number(ed.total), 7000);
const stockBeforeRefund = await stock(P.rice);
const refund = await ok("owner partial refund + restock", () => rpc("ownerA", "refund_sale", saleId, [{ sale_item_id: itemId, qty: 1 }], true, "damaged"));
eq("refund amount pro-rata", Number(refund.amount), 3500);
eq("refund restocked 1 unit", await stock(P.rice), stockBeforeRefund + 1);
await denied("over-refund", () => rpc("ownerA", "refund_sale", saleId, [{ sale_item_id: itemId, qty: 2 }], true, "again"), /refund_qty_too_high/);
await denied("can't void after refund", () => rpc("ownerA", "void_sale", saleId, "late"), /sale_not_voidable/);
const s2 = uuid(); await rpc("cashA", "record_sale", mk(s2, [{ product_id: P.oil, qty: 2, unit_price: 2000 }]));
const before = await stock(P.oil);
await ok("owner voids sale", () => rpc("ownerA", "void_sale", s2, "wrong customer"));
eq("void restores stock", await stock(P.oil), before + 2);
await denied("void twice", () => rpc("ownerA", "void_sale", s2, "again"), /sale_not_voidable/);
const acts = (await as("ownerA", "select action from audit_log order by id")).rows.map(r => r.action);
for (const a of ["shop.create", "member.add", "sale.edit_prices", "sale.refund", "sale.void"]) eq("audit has " + a, acts.includes(a), true);

// ------------------------------------------------------------ stock policies & concurrency
await ok("adjust stock", () => rpc("mgrA", "adjust_stock", brA, P.oil, 1, "recount"));
await denied("cashier can't adjust stock", () => rpc("cashA", "adjust_stock", brA, P.oil, 100, "x"), /manager_required/);
await denied("adjust needs reason", () => rpc("mgrA", "adjust_stock", brA, P.oil, 5, ""), /reason_required/);
const over = await rpc("cashA", "record_sale", mk(uuid(), [{ product_id: P.oil, qty: 3, unit_price: 2000 }]));
eq("oversell accepted under allow_flag", over.status, "created");
eq("shortfall reported", Number(over.shortfalls[0].shortfall), 2);
eq("discrepancy row written", (await as("ownerA", "select count(*)::int c from stock_discrepancies")).rows[0].c, 1);
eq("stock is negative, visible", await stock(P.oil), -2);
await as("ownerA", "update shops set negative_stock_policy='reject' where id=$1", [shopA.shop_id]);
await denied("oversell rejected under reject policy", () => rpc("cashA", "record_sale", mk(uuid(), [{ product_id: P.oil, qty: 1, unit_price: 2000 }])), /insufficient_stock|negative/i);
eq("rejected sale left no trace on stock", await stock(P.oil), -2);
await as("ownerA", "update shops set negative_stock_policy='allow_flag' where id=$1", [shopA.shop_id]);
// parallel sales of the same product from two phones: final stock must equal start - sum
await ok("restock for concurrency", () => rpc("mgrA", "adjust_stock", brA, P.rice, 20, "recount"));
const burst = Array.from({ length: 12 }, (_, i) => rpc(i % 2 ? "cashA" : "cashA2", "record_sale", { ...mk(uuid(), [{ product_id: P.rice, qty: 1, unit_price: 4000 }, { product_id: P.oil, qty: 1, unit_price: 2000 }]), device_id: i % 2 ? dev.device_id : dev2.device_id, invoice_no: `C-${i}-${Date.now()}` }));
const burstRes = await Promise.allSettled(burst);
eq("all 12 burst sales succeeded", burstRes.filter(r => r.status === "fulfilled").length, 12);
eq("stock rice after burst", await stock(P.rice), 8);
eq("stock movements reconcile to stock level", (await as("super", `select (select qty from stock_levels where product_id=$1 and branch_id=$2) - coalesce((select sum(delta) from stock_movements where product_id=$1 and branch_id=$2),0) as diff`, [P.rice, brA])).rows[0].diff.toString().replace(/\.0+$/, ""), "0");

// ------------------------------------------------------------ roles & membership management
await denied("cashier set_member", () => rpc("cashA", "set_member", U.cashA2, "admin", brA, true, "x"), /admin_required/);
await denied("manager set_member", () => rpc("mgrA", "set_member", U.cashA2, "manager", brA, true, "x"), /admin_required/);
await denied("owner can't change self", () => rpc("ownerA", "set_member", U.ownerA, "cashier", brA, true, "x"), /cannot_change_self/);
await denied("owner A can't manage B's staff", () => rpc("ownerA", "set_member", U.cashB, "admin", brA, true, "x"), /unknown_member/);
await ok("owner deactivates cashier A2", () => rpc("ownerA", "set_member", U.cashA2, "cashier", brA, false, "left the shop"));
eq("deactivated user has no profile", await rpc("cashA2", "whoami"), null);
await denied("deactivated user can't sell", () => rpc("cashA2", "record_sale", mk(uuid(), [{ product_id: P.rice, qty: 1, unit_price: 4000 }])), /not_a_member/);
eq("deactivated user sees nothing", (await as("cashA2", "select * from products")).rows.length, 0);

// ------------------------------------------------------------ storage estimate for the free plan
const size = async t => Number((await as("super", `select pg_total_relation_size('${t}') s`)).rows[0].s);
const nSales = (await as("super", "select count(*)::int c from sales")).rows[0].c;
console.log(`\nstorage sample: ${nSales} sales -> sales ${await size("sales")}B, sale_items ${await size("sale_items")}B, stock_movements ${await size("stock_movements")}B, audit_log ${await size("audit_log")}B`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join("\n")); process.exit(1); }
