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

// 1. a cashier gives a discount at checkout
const s1 = mk([{ product_id: A, qty: 3, unit_price: 1000, discount: 250 }, { product_id: B, qty: 2, unit_price: 500 }]);
eq("cashier sale with a discount is created", (await rpc("joy", "record_sale", { ...s1, client_total: 3750 })).status, "created");
let r = await row(s1.id); eq("subtotal, discount and total stored", [num(r.subtotal), num(r.discount_total), num(r.total)], [4000, 250, 3750]);
eq("line total stored net of discount", (await as("super", "select line_total from sale_items where sale_id=$1 and product_id=$2", [s1.id, A])).rows[0].line_total.toString(), "2750.00");
await denied("discount larger than the line is refused", () => rpc("joy", "record_sale", mk([{ product_id: B, qty: 1, unit_price: 500, discount: 600 }])), /discount_exceeds_line/);
await denied("client total that ignores the discount is refused", () => rpc("joy", "record_sale", { ...mk([{ product_id: B, qty: 1, unit_price: 500, discount: 100 }]), client_total: 500 }), /total_mismatch/);

// 2. correcting after checkout
const own = (await as("super", "select id from sale_items where sale_id=$1 and product_id=$2", [s1.id, A])).rows[0].id;
const out = await rpc("joy", "edit_sale_prices", s1.id, [{ sale_item_id: own, unit_price: 900, discount: 100 }], "customer negotiated");
r = await row(s1.id); eq("cashier edits own sale today: price and discount recomputed", [num(out.total), num(r.total), num(r.discount_total), num(r.subtotal)], [3600, 3600, 100, 3700]);
eq("edit is audited with before and after", (await as("super", "select before->>'total' b, after->>'total' a, reason from audit_log where action='sale.edit_prices' order by id desc limit 1")).rows[0], { b: "3750.00", a: "3600.00", reason: "customer negotiated" });
await denied("edit needs a reason", () => rpc("joy", "edit_sale_prices", s1.id, [{ sale_item_id: own, unit_price: 900 }], " "), /reason_required/);
await denied("edit that makes the discount exceed the line is refused", () => rpc("joy", "edit_sale_prices", s1.id, [{ sale_item_id: own, unit_price: 10, discount: 5000 }], "x"), /discount_exceeds_line/);
r = await row(s1.id); eq("...and left the sale untouched", num(r.total), 3600);
await denied("another cashier cannot edit it", () => rpc("kemi", "edit_sale_prices", s1.id, [{ sale_item_id: own, unit_price: 1 }], "x"), /edit_not_allowed/);
await as("super", "update sales set business_date = business_date - 1 where id=$1", [s1.id]);
await denied("the cashier cannot edit it the next day", () => rpc("joy", "edit_sale_prices", s1.id, [{ sale_item_id: own, unit_price: 1 }], "x"), /edit_not_allowed/);
await rpc("mgr", "edit_sale_prices", s1.id, [{ sale_item_id: own, unit_price: 950 }], "manager fix"); r = await row(s1.id);
eq("a manager can still correct it (discount kept when only price is sent)", [num(r.total), num(r.discount_total)], [3750, 100]);
await rpc("owner", "edit_sale_prices", s1.id, [{ product_id: B, unit_price: 400 }], "owner fix by product"); eq("owner can name a line by product", num((await row(s1.id)).total), 3550);
// credit sale: balance follows
const cust = (await as("joy", "insert into customers(shop_id,name) values ($1,'Ade') returning id", [shop.shop_id])).rows[0].id;
const s2 = mk([{ product_id: A, qty: 2, unit_price: 1000 }], { payment_method: "credit", amount_paid: 500, customer: { id: cust, name: "Ade" } }); await rpc("joy", "record_sale", s2);
const it2 = (await as("super", "select id from sale_items where sale_id=$1", [s2.id])).rows[0].id;
await rpc("joy", "edit_sale_prices", s2.id, [{ sale_item_id: it2, unit_price: 1000, discount: 400 }], "regular customer discount"); r = await row(s2.id);
eq("credit sale: total drops, amount owed follows", [num(r.total), num(r.amount_paid), num(r.balance_due)], [1600, 500, 1100]);
await rpc("joy", "edit_sale_prices", s2.id, [{ sale_item_id: it2, unit_price: 1000, discount: 1900 }], "big discount"); r = await row(s2.id);
eq("a discount that covers more than the deposit never leaves a negative balance", [num(r.total), num(r.amount_paid), num(r.balance_due)], [100, 100, 0]);

// 3. regular-customer discount
await denied("a cashier cannot set a customer's standing discount", () => as("joy", "update customers set discount_pct=10 where id=$1", [cust]), /manager_required/);
await denied("...nor create a customer with one", () => as("joy", "insert into customers(shop_id,name,discount_pct) values ($1,'Zed',20)", [shop.shop_id]), /manager_required/);
await as("owner", "update customers set discount_pct=7.5 where id=$1", [cust]);
eq("owner sets it", num((await as("owner", "select discount_pct from customers where id=$1", [cust])).rows[0].discount_pct), 7.5);
await as("joy", "update customers set phone='0801' where id=$1", [cust]); eq("a cashier can still edit the phone without touching the discount", num((await as("owner", "select discount_pct from customers where id=$1", [cust])).rows[0].discount_pct), 7.5);
await denied("discount over 100% is refused", () => as("owner", "update customers set discount_pct=150 where id=$1", [cust]), /check|violates/);
const st1 = await rpc("owner", "shop_stamp"); await as("owner", "update customers set discount_pct=5 where id=$1", [cust]); const st2 = await rpc("owner", "shop_stamp");
eq("changing a discount changes the catalog stamp only", [st1.catalog !== st2.catalog, st1.sales === st2.sales, st1.books === st2.books], [true, true, true]);

// 4. quantity correction (0009)
const stock = async (p) => num((await as("super", "select qty from stock_levels where product_id=$1 and branch_id=$2", [p, br])).rows[0].qty);
const s3 = mk([{ product_id: A, qty: 5, unit_price: 1000 }, { product_id: B, qty: 2, unit_price: 500 }]); await rpc("joy", "record_sale", s3);
const sA0 = await stock(A), sB0 = await stock(B);
await rpc("joy", "edit_sale_prices", s3.id, [{ product_id: A, qty: 3 }], "customer took only 3"); r = await row(s3.id);
eq("fewer sold: total follows and stock is put back", [num(r.total), await stock(A), await stock(B)], [4000, sA0 + 2, sB0]);
eq("sale cost follows the new quantity", num((await as("super", "select cost_total from sales where id=$1", [s3.id])).rows[0].cost_total), 250);
await rpc("owner", "edit_sale_prices", s3.id, [{ product_id: B, qty: 6, unit_price: 500 }], "owner fix"); r = await row(s3.id);
eq("more sold: total grows and stock goes down", [num(r.total), await stock(B)], [6000, sB0 - 4]);
await denied("quantity 0 is refused", () => rpc("owner", "edit_sale_prices", s3.id, [{ product_id: A, qty: 0 }], "x"), /invalid_qty/);
await denied("another cashier cannot change quantity", () => rpc("kemi", "edit_sale_prices", s3.id, [{ product_id: A, qty: 1 }], "x"), /edit_not_allowed/);
const mv = (await as("super", "select count(*)::int c, sum(delta) d from stock_movements where ref_id=$1 and ref_type='sale_edit'", [s3.id])).rows[0];
eq("every stock change is in the ledger", [mv.c, num(mv.d)], [2, -2]);
const s4 = mk([{ product_id: A, qty: 4, unit_price: 1000 }]); await rpc("joy", "record_sale", s4);
await rpc("owner", "refund_sale", s4.id, [{ product_id: A, qty: 1 }], true, "bad", null);
await denied("quantity cannot change once a return exists", () => rpc("owner", "edit_sale_prices", s4.id, [{ product_id: A, qty: 2 }], "x"), /sale_not_editable|sale_has_returns/);

// 5. owner adds / deletes items on a finished sale (0011)
const C = await prod("C", 200); await rpc("owner", "adjust_stock", br, C, 50, "r");
const s5 = mk([{ product_id: A, qty: 2, unit_price: 1000 }, { product_id: B, qty: 3, unit_price: 500 }]); await rpc("joy", "record_sale", s5);
const a0 = await stock(A), b0 = await stock(B), c0 = await stock(C);
await denied("a cashier cannot add or delete items", () => rpc("joy", "revise_sale", s5.id, [{ product_id: A, qty: 2, unit_price: 1000 }], "x"), /admin_required/);
await denied("a reason is required", () => rpc("owner", "revise_sale", s5.id, [{ product_id: A, qty: 2, unit_price: 1000 }], " "), /reason_required/);
await denied("the last line cannot be deleted", () => rpc("owner", "revise_sale", s5.id, [], "x"), /sale_needs_a_line/);
await denied("an unknown product is refused", () => rpc("owner", "revise_sale", s5.id, [{ product_id: uuid(), qty: 1, unit_price: 5 }], "x"), /unknown_product/);
const out5 = await rpc("owner", "revise_sale", s5.id, [{ product_id: A, qty: 2, unit_price: 1000 }, { product_id: C, qty: 4, unit_price: 200, discount: 50 }], "added C, removed B");
r = await row(s5.id);
eq("B deleted, C added: totals follow", [num(r.total), num(r.subtotal), num(r.discount_total), num(out5.total)], [2750, 2800, 50, 2750]);
eq("stock: B back on the shelf, C taken off, A untouched", [await stock(A), await stock(B), await stock(C)], [a0, b0 + 3, c0 - 4]);
eq("sale lines are now A and C only", (await as("super", "select string_agg(name, ',' order by name) n from sale_items where sale_id=$1", [s5.id])).rows[0].n, "A,C");
eq("new line took the catalogue cost and list price", (await as("super", "select unit_cost::float c, list_price::float l from sale_items where sale_id=$1 and product_id=$2", [s5.id, C])).rows[0], { c: 50, l: 200 });
eq("changes are in the ledger", num((await as("super", "select count(*) c from stock_movements where ref_id=$1 and ref_type='sale_edit'", [s5.id])).rows[0].c), 2);
eq("audit entry written", num((await as("super", "select count(*) c from audit_log where action='sale.revise_lines' and entity_id=$1", [s5.id])).rows[0].c), 1);
const s6 = mk([{ product_id: A, qty: 2, unit_price: 1000 }], { payment_method: "credit", amount_paid: 500, customer: { id: cust, name: "Ade" } }); await rpc("joy", "record_sale", s6);
await rpc("owner", "revise_sale", s6.id, [{ product_id: A, qty: 2, unit_price: 1000 }, { product_id: B, qty: 2, unit_price: 500 }], "added B"); r = await row(s6.id);
eq("credit sale: the amount owed follows the new total", [num(r.total), num(r.amount_paid), num(r.balance_due)], [3000, 500, 2500]);
const s7 = mk([{ product_id: A, qty: 3, unit_price: 1000 }, { product_id: B, qty: 1, unit_price: 500 }]); await rpc("joy", "record_sale", s7);
await rpc("owner", "refund_sale", s7.id, [{ product_id: B, qty: 1 }], true, "bad", null);
await denied("no adding or deleting after a return", () => rpc("owner", "revise_sale", s7.id, [{ product_id: A, qty: 3, unit_price: 1000 }], "x"), /sale_not_editable/);
console.log(`${pass} passed, ${fail} failed`); if (fail) process.exit(1);
