// node --experimental-strip-types tests/create_staff.test.mjs
import { handle } from "../functions/create-staff/handler.ts";
let pass = 0, fail = 0; const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass++ : (fail++, console.log("FAIL", l, a, b)));
const mk = (over = {}) => { const log = { created: [], deleted: [], added: [] }; return { log, deps: {
  getCaller: async j => j === "good" ? { id: "u1" } : null,
  callerShop: async () => ({ shop_id: "S", shop_code: "shopa", role: "owner", active: true }),
  createAuthUser: async (e) => { if (e.startsWith("taken")) throw new Error("User already registered"); log.created.push(e); return { id: "new1" }; },
  deleteAuthUser: async id => { log.deleted.push(id); },
  addMember: async a => { log.added.push(a); },
  ...over } }; };
const req = (body, jwt = "good", method = "POST") => new Request("http://x", { method, headers: { authorization: jwt ? "Bearer " + jwt : "" }, body: method === "POST" ? JSON.stringify(body) : undefined });
const ok = { username: "Ada ", password: "longpassword", name: "Ada", role: "cashier", branch_id: "B1" };
let t = mk(); let r = await handle(req(ok), t.deps); eq("happy status", r.status, 200); eq("email built server-side", t.log.created, ["ada@shopa.ilelah.app"]); eq("actor passed", t.log.added[0].actor, "u1");
t = mk(); eq("no token", (await handle(req(ok, ""), t.deps)).status, 401);
t = mk(); eq("bad token", (await handle(req(ok, "bad"), t.deps)).status, 401); eq("nothing created", t.log.created, []);
t = mk({ callerShop: async () => ({ shop_id: "S", shop_code: "shopa", role: "cashier", active: true }) }); eq("cashier denied", (await handle(req(ok), t.deps)).status, 403); eq("no account made", t.log.created, []);
t = mk({ callerShop: async () => ({ shop_id: "S", shop_code: "shopa", role: "manager", active: true }) }); eq("manager denied", (await handle(req(ok), t.deps)).status, 403);
t = mk({ callerShop: async () => ({ shop_id: "S", shop_code: "shopa", role: "owner", active: false }) }); eq("deactivated owner denied", (await handle(req(ok), t.deps)).status, 403);
t = mk({ callerShop: async () => null }); eq("non-member denied", (await handle(req(ok), t.deps)).status, 403);
t = mk({ callerShop: async () => ({ shop_id: "S", shop_code: "shopa", role: "admin", active: true }) }); eq("admin can't make admin", (await handle(req({ ...ok, role: "admin" }), t.deps)).status, 403); eq("admin makes cashier", (await handle(req(ok), t.deps)).status, 200);
t = mk(); eq("owner makes admin (no branch needed)", (await handle(req({ ...ok, role: "admin", branch_id: null }), t.deps)).status, 200);
t = mk(); eq("owner role refused", (await handle(req({ ...ok, role: "owner" }), t.deps)).status, 400);
t = mk(); eq("short password", (await handle(req({ ...ok, password: "short" }), t.deps)).status, 400);
t = mk(); eq("bad username", (await handle(req({ ...ok, username: "a@b" }), t.deps)).status, 400);
t = mk(); eq("cashier needs branch", (await handle(req({ ...ok, branch_id: "" }), t.deps)).status, 400);
t = mk(); eq("duplicate username", (await handle(req({ ...ok, username: "taken1" }), t.deps)).status, 409);
t = mk({ addMember: async () => { throw new Error("boom"); } }); r = await handle(req(ok), t.deps); eq("db failure -> 400", r.status, 400); eq("orphan login removed", t.log.deleted, ["new1"]);
t = mk(); eq("GET refused", (await handle(req(null, "good", "GET"), t.deps)).status, 405);
t = mk(); eq("shop code can't be forged from body", (await handle(req({ ...ok, shop_code: "other", shop: "X" }), t.deps)).status === 200 && t.log.created[0], "ada@shopa.ilelah.app");

// ---- password reset
const rp = (o = {}) => ({ action: "reset_password", user_id: "t1", password: "newpassword1", ...o });
const mkR = (member, over = {}) => { const t = mk({ getMember: async (shop, id) => (shop === "S" && id === "t1" ? member : null), setPassword: async (id, pw) => { t.log.pw = [id, pw]; }, auditReset: async (a) => { t.log.audit = a; }, ...over }); return t; };
t = mkR({ role: "cashier", active: true }); r = await handle(req(rp()), t.deps); eq("owner resets cashier", r.status, 200); eq("password set for target", t.log.pw, ["t1", "newpassword1"]); eq("reset audited", t.log.audit, { shop: "S", actor: "u1", target: "t1" });
t = mkR({ role: "cashier", active: true }); eq("short password refused", (await handle(req(rp({ password: "short" })), t.deps)).status, 400); eq("nothing changed", t.log.pw, undefined);
t = mkR({ role: "cashier", active: true }); eq("someone from another shop is not found", (await handle(req(rp({ user_id: "zz" })), t.deps)).status, 404);
t = mkR({ role: "owner", active: true }); eq("owner password cannot be reset", (await handle(req(rp()), t.deps)).status, 403);
t = mkR({ role: "admin", active: true }, { callerShop: async () => ({ shop_id: "S", shop_code: "shopa", role: "admin", active: true }) }); eq("admin cannot reset another admin", (await handle(req(rp()), t.deps)).status, 403);
t = mkR({ role: "admin", active: true }); eq("owner can reset an admin", (await handle(req(rp()), t.deps)).status, 200);
t = mkR({ role: "cashier", active: true }, { callerShop: async () => ({ shop_id: "S", shop_code: "shopa", role: "cashier", active: true }) }); eq("cashier cannot reset anyone", (await handle(req(rp()), t.deps)).status, 403); eq("no change made", t.log.pw, undefined);
t = mkR({ role: "cashier", active: true }, { callerShop: async () => ({ shop_id: "S", shop_code: "shopa", role: "manager", active: true }) }); eq("manager cannot reset", (await handle(req(rp()), t.deps)).status, 403);
t = mkR({ role: "cashier", active: true }); eq("not signed in", (await handle(req(rp(), ""), t.deps)).status, 401);
t = mkR({ role: "cashier", active: true }); eq("cannot reset yourself here", (await handle(req(rp({ user_id: "u1" })), t.deps)).status, 400);
t = mkR({ role: "cashier", active: true }, { setPassword: async () => { throw new Error("x"); } }); eq("auth failure reported", (await handle(req(rp()), t.deps)).status, 400);
t = mkR({ role: "cashier", active: true }, { auditReset: async () => { throw new Error("x"); } }); eq("audit failure does not undo the reset", (await handle(req(rp()), t.deps)).status, 200);
console.log(`${pass} passed, ${fail} failed`); if (fail) process.exit(1);
