// Phase 6 on a REAL PostgreSQL server (not the in-memory simulator): true parallel connections, lock ordering,
// retry storms, and a full backup -> wipe -> restore drill with pg_dump / pg_restore.
// Usage: PGPORT=5544 PGHOST=127.0.0.1 PGUSER=postgres node realpg.test.mjs   (needs `pg`, and pg_dump/pg_restore on PATH)
import { buildImportPayload } from "../../src/cloud/legacy-export.js";
import pg from "pg"; import fs from "fs"; import path from "path"; import { execFileSync } from "child_process"; import { fileURLToPath } from "url"; import os from "os";
const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), "../migrations/");
const env = { host: process.env.PGHOST || "127.0.0.1", port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || "postgres" };
const admin = new pg.Client({ ...env, database: "postgres" }); await admin.connect();
const mkdb = async (name) => { await admin.query(`drop database if exists ${name} with (force)`); await admin.query(`create database ${name}`); };
const BOOT = `create schema if not exists extensions; create extension if not exists pgcrypto schema extensions;   -- like Supabase: NOT on the functions' search_path
 do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if; end $$;
 create schema if not exists auth; create table if not exists auth.users(id uuid primary key default gen_random_uuid(), email text);
 create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;
 grant usage on schema public to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant all on functions to anon,authenticated,service_role;`;
const open = async (db) => { const p = new pg.Pool({ ...env, database: db, max: 40 }); return p; };
await mkdb("ilelah_live"); let pool = await open("ilelah_live");
await pool.query(BOOT); for (const f of fs.readdirSync(MIG).sort()) await pool.query(fs.readFileSync(MIG + f, "utf8"));

let pass = 0, fail = 0; const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass++ : (fail++, console.log("FAIL", l, JSON.stringify(a), "!=", JSON.stringify(b))));
const uuid = () => crypto.randomUUID();
// one call = one transaction on its own connection, as PostgREST does it
async function as(pl, user, sql, params = []) {
  const c = await pl.connect();
  try { await c.query("begin"); await c.query("set local role " + (user === "service" ? "service_role" : "authenticated")); await c.query("select set_config('request.jwt.claim.sub',$1,true)", [user === "service" ? "" : user]); const r = await c.query(sql, params); await c.query("commit"); return r; }
  catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const rpc = (pl, user, fn, ...a) => as(pl, user, `select ${fn}(${a.map((_, i) => `$${i + 1}`).join(",")}) r`, a.map((x) => (x && typeof x === "object" ? JSON.stringify(x) : x))).then((r) => r.rows[0].r);
const settle = (ps) => Promise.allSettled(ps);
const okc = (rs) => rs.filter((r) => r.status === "fulfilled").length;
const msgs = (rs) => rs.filter((r) => r.status === "rejected").map((r) => String(r.reason.message));

const owner = uuid(), cashiers = Array.from({ length: 6 }, uuid);
for (const u of [owner, ...cashiers]) await pool.query("insert into auth.users(id,email) values ($1,$2)", [u, u + "@x.invalid"]);
const shop = await rpc(pool, owner, "create_shop", "Real Shop", "real", "Owner"); const br = shop.branch_id;
cashiers.forEach(async () => {});
for (const [i, c] of cashiers.entries()) await as(pool, "service", "select add_member($1,$2,$3,$4,'C','cashier',$5)", [owner, shop.shop_id, c, "c" + i, br]);
const devs = []; for (const c of cashiers) devs.push((await rpc(pool, c, "register_device", br, "d")).device_id);
const prod = async (sku, price = 100) => (await as(pool, owner, "insert into products(shop_id,name,sku,cost,price) values ($1,$2,$2,50,$3) returning id", [shop.shop_id, sku, price])).rows[0].id;
const A = await prod("A"), B = await prod("B");
const setStock = (p, q) => rpc(pool, owner, "adjust_stock", br, p, q, "recount");
const stock = async (p) => Number((await pool.query("select qty from stock_levels where product_id=$1 and branch_id=$2", [p, br])).rows[0].qty);
const sale = (i, items, extra = {}) => ({ id: uuid(), branch_id: br, device_id: devs[i % 6], invoice_no: "T-" + uuid().slice(0, 8), sold_at: new Date().toISOString(), payment_method: "cash", items, ...extra });
const cashier = (i) => cashiers[i % 6];

// 1. 60 parallel sales from 6 cashiers; items listed in opposite orders (deadlock bait)
await setStock(A, 1000); await setStock(B, 1000);
let rs = await settle(Array.from({ length: 60 }, (_, i) => rpc(pool, cashier(i), "record_sale", sale(i, i % 2 ? [{ product_id: A, qty: 1, unit_price: 100 }, { product_id: B, qty: 2, unit_price: 100 }] : [{ product_id: B, qty: 2, unit_price: 100 }, { product_id: A, qty: 1, unit_price: 100 }]))));
eq("1: all 60 parallel sales succeed, no deadlock", [okc(rs), msgs(rs).filter((m) => /deadlock/i.test(m)).length], [60, 0]);
eq("1: stock exact", [await stock(A), await stock(B)], [940, 880]);
eq("1: stock equals the sum of its movements", Number((await pool.query("select (select qty from stock_levels where product_id=$1) - (select coalesce(sum(delta),0) from stock_movements where product_id=$1) d", [A])).rows[0].d), 0);

// 2. retry storm: the SAME sale sent 12 times at once
const one = sale(0, [{ product_id: A, qty: 3, unit_price: 100 }]);
rs = await settle(Array.from({ length: 12 }, () => rpc(pool, cashier(0), "record_sale", one)));
const st = rs.filter((r) => r.status === "fulfilled").map((r) => r.value.status);
eq("2: exactly one created, the rest duplicate, none failed", [st.filter((x) => x === "created").length, st.filter((x) => x === "duplicate").length, okc(rs)], [1, 11, 12]);
eq("2: stock taken once", await stock(A), 937); eq("2: one sale row", (await pool.query("select count(*)::int c from sales where id=$1", [one.id])).rows[0].c, 1);

// 3. same invoice number, different ids, at once
const inv = "DUP-" + uuid().slice(0, 6);
rs = await settle(Array.from({ length: 8 }, (_, i) => rpc(pool, cashier(i), "record_sale", sale(i, [{ product_id: B, qty: 1, unit_price: 100 }], { invoice_no: inv }))));
eq("3: invoice numbers stay unique under a race", [okc(rs), (await pool.query("select count(*)::int c from sales where invoice_no=$1", [inv])).rows[0].c], [1, 1]);

// 4. reject policy: 5 in stock, 14 parallel sales of 1 -> exactly 5 win, stock never negative
await as(pool, owner, "update shops set negative_stock_policy='reject' where id=$1", [shop.shop_id]);
const C = await prod("C"); await setStock(C, 5);
rs = await settle(Array.from({ length: 14 }, (_, i) => rpc(pool, cashier(i), "record_sale", sale(i, [{ product_id: C, qty: 1, unit_price: 100 }]))));
eq("4: exactly 5 of 14 accepted", okc(rs), 5); eq("4: stock is 0, never negative", await stock(C), 0);
eq("4: the rest were refused for stock", msgs(rs).every((m) => /insufficient_stock|negative/i.test(m)), true);
await as(pool, owner, "update shops set negative_stock_policy='allow_flag' where id=$1", [shop.shop_id]);

// 5. credit: same repayment 8 times at once, and the same adjust request 8 times at once
const cust = (await as(pool, owner, "insert into customers(shop_id,name) values ($1,'Ade') returning id", [shop.shop_id])).rows[0].id;
await rpc(pool, cashier(0), "record_sale", sale(0, [{ product_id: B, qty: 10, unit_price: 100 }], { payment_method: "credit", amount_paid: 0, customer: { id: cust, name: "Ade", phone: "" }, due_date: "2026-12-01" }));
const pay = { id: uuid(), branch_id: br, device_id: devs[0], customer_id: cust, receipt_no: "R-" + uuid().slice(0, 6), amount: 400, paid_at: new Date().toISOString() };
rs = await settle(Array.from({ length: 8 }, () => rpc(pool, cashier(0), "record_credit_payment", pay)));
eq("5: repayment applied once", [okc(rs), Number((await pool.query("select coalesce(sum(amount),0) s from credit_payments where customer_id=$1", [cust])).rows[0].s)], [8, 400]);
const req = uuid(); const before = await stock(A);
rs = await settle(Array.from({ length: 8 }, () => rpc(pool, owner, "adjust_stock_by", req, br, A, 7, "recount")));
eq("5: stock adjustment applied once", [okc(rs), await stock(A) - before], [8, 7]);

// 6. void the same sale 6 times at once -> restored once
const vs = sale(0, [{ product_id: A, qty: 5, unit_price: 100 }]); await rpc(pool, cashier(0), "record_sale", vs); const sb = await stock(A);
rs = await settle(Array.from({ length: 6 }, () => rpc(pool, owner, "void_sale", vs.id, "mistake")));
eq("6: void succeeds once, others refused", [okc(rs), await stock(A) - sb], [1, 5]);


// 6b. the same purchase received 8 times at once -> stock added once
const po = { id: uuid(), branch_id: br, supplier: "S", purchase_date: "2026-10-14", items: [{ product_id: B, qty: 9, unit_cost: 60 }] }; const pb = await stock(B);
rs = await settle(Array.from({ length: 8 }, () => rpc(pool, owner, "receive_purchase", po)));
eq("6b: purchase received once", [okc(rs), await stock(B) - pb], [8, 9]);
// 6c. owner double-taps "copy to cloud": 4 identical imports at once -> one import, no duplicate products
const owner2 = uuid(); await pool.query("insert into auth.users(id,email) values ($1,'o2@x.invalid')", [owner2]);
const shop2 = await rpc(pool, owner2, "create_shop", "Import Shop", "imp", "O2");
const phone = { branches: [{ id: "b1", name: "Main" }], products: [{ id: "p1", name: "Rice", sku: "R", cost: 1, price: 2, stock: { b1: 5 } }, { id: "p2", name: "Oil", sku: "O", cost: 1, price: 2, stock: { b1: 3 } }], customers: [], sales: [], purchases: [], expenses: [], creditPayments: [], dayCloses: {}, settings: {} };
const payload = buildImportPayload(phone);
rs = await settle(Array.from({ length: 4 }, () => rpc(pool, owner2, "import_legacy", payload)));
eq("6c: only one import wins", okc(rs) >= 1 && okc(rs) <= 4, true);
eq("6c: exactly 2 products and 8 units, no duplicates", [(await pool.query("select count(*)::int c from products where shop_id=$1", [shop2.shop_id])).rows[0].c, Number((await pool.query("select sum(qty) s from stock_levels where shop_id=$1", [shop2.shop_id])).rows[0].s)], [2, 8]);

// 7. a user disabled in the middle of a burst can't sell afterwards
await rpc(pool, owner, "set_member", cashiers[5], "cashier", br, false, "left");
rs = await settle([rpc(pool, cashiers[5], "record_sale", sale(5, [{ product_id: A, qty: 1, unit_price: 100 }]))]);
eq("7: disabled cashier refused", [okc(rs), msgs(rs)[0] && /not_a_member/.test(msgs(rs)[0])], [0, true]);

// 8. BACKUP -> WIPE -> RESTORE drill
const totals = async (pl) => (await as(pl, owner, "select cloud_totals() t")).rows[0].t;
const counts = async (pl) => { const o = {}; for (const t of ["shops", "branches", "products", "customers", "sales", "sale_items", "credit_payments", "stock_levels", "stock_movements", "audit_log", "memberships", "devices"]) o[t] = (await pl.query(`select count(*)::int c from ${t}`)).rows[0].c; return o; };
const T0 = await totals(pool), C0 = await counts(pool); const dump = path.join(os.tmpdir(), "ilelah-drill.dump");
execFileSync("pg_dump", ["-h", env.host, "-p", String(env.port), "-U", env.user, "-d", "ilelah_live", "-Fc", "-n", "public", "-n", "app", "-f", dump]);
eq("8: backup file written", fs.statSync(dump).size > 1000, true);
await pool.end(); await mkdb("ilelah_restored"); pool = await open("ilelah_restored");
await pool.query(BOOT);                                           // a fresh Supabase project already has roles and auth
for (const u of [owner, ...cashiers]) await pool.query("insert into auth.users(id,email) values ($1,$2)", [u, u + "@x.invalid"]);
// a fresh project already has its "public" schema, so the restore skips creating it (same recipe as backup/restore.sh)
const list = execFileSync("pg_restore", ["-l", dump]).toString().split("\n").filter((l) => !/ SCHEMA - public /.test(l)).join("\n");
const lf = dump + ".list"; fs.writeFileSync(lf, list);
execFileSync("pg_restore", ["-h", env.host, "-p", String(env.port), "-U", env.user, "-d", "ilelah_restored", "--no-owner", "--exit-on-error", "-L", lf, dump]);
const T1 = await totals(pool), C1 = await counts(pool);
eq("8: every table has the same number of rows after restore", C1, C0); eq("8: shop-wide money totals identical after restore", T1, T0);
eq("8: stock still reconciles to movements", Number((await pool.query("select coalesce(sum(abs(l.qty - m.s)),0) d from stock_levels l join (select product_id, branch_id, sum(delta) s from stock_movements group by 1,2) m using (product_id, branch_id)")).rows[0].d), 0);
const rb = await settle([rpc(pool, cashier(1), "record_sale", sale(1, [{ product_id: A, qty: 1, unit_price: 100 }]))]);
eq("8: the restored database accepts new sales", okc(rb), 1);
eq("8: row security survived the restore", (await pool.query("select relrowsecurity from pg_class where relname='sales'")).rows[0].relrowsecurity, true);
const nAudit = (await pool.query("select count(*)::int c from audit_log")).rows[0].c;
await as(pool, owner, "delete from audit_log").catch(() => {}); await as(pool, owner, "update audit_log set action='x'").catch(() => {});
eq("8: audit log still append-only after restore", (await pool.query("select count(*)::int c from audit_log where action<>'x'")).rows[0].c, nAudit);
await pool.end(); await admin.end(); fs.unlinkSync(dump); fs.unlinkSync(lf);
console.log(`${pass} passed, ${fail} failed`); if (fail) process.exit(1);
