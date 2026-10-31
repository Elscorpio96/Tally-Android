// node supabase/tests/outbox.test.mjs
import { createOutbox, classifyError, backoffMs } from "../../src/cloud/outbox.js";
let pass = 0, fail = 0; const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass++ : (fail++, console.log("FAIL", l, JSON.stringify(a), "!=", JSON.stringify(b))));
const mkStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
let t = 1000; const now = () => t;
const net = Object.assign(new Error("Failed to fetch"), {});
const biz = Object.assign(new Error("total_mismatch"), { code: "P0001", status: 400 });
const ok = (status = "created") => ({ status });

// classification
eq("fetch failure = network", classifyError(net), "network"); eq("500 = network", classifyError({ status: 503, message: "x" }), "network");
eq("429 = network", classifyError({ status: 429, message: "x" }), "network"); eq("400 pg error = business", classifyError(biz), "business");
eq("401 = auth", classifyError({ status: 401, message: "JWT expired" }), "auth"); eq("backoff grows then caps", [backoffMs(1), backoffMs(2), backoffMs(20)], [5000, 10000, 900000]);

// happy path + never "synced" before the server answers
let store = mkStore(); let sent = []; let release;
let ob = createOutbox({ storage: store, now, send: (k, p) => new Promise((res) => { sent.push(p.id); release = () => res(ok()); }) });
ob.enqueue("sale", "a", { id: "a" }); eq("queued = pending", ob.statusOf("a"), "pending");
const run1 = ob.run(); await Promise.resolve(); eq("in flight is syncing, NOT synced", ob.statusOf("a"), "syncing"); release(); await run1; eq("synced after answer", ob.statusOf("a"), "synced");

// duplicate enqueue ignored
eq("duplicate enqueue ignored", [ob.enqueue("sale", "a", {}), ob.list().length], [false, 1]);

// offline: stays pending, nothing lost, backoff respected, then recovers
store = mkStore(); let online = false; let calls = 0;
ob = createOutbox({ storage: store, now, send: async (k, p) => { calls++; if (!online) throw net; return ok(); } });
ob.enqueue("sale", "s1", { id: "s1" }); ob.enqueue("sale", "s2", { id: "s2" });
await ob.run(); eq("offline: both pending", [ob.statusOf("s1"), ob.statusOf("s2")], ["pending", "pending"]); eq("offline: stops after first failure", calls, 1);
await ob.run(); eq("backoff: no immediate retry", calls, 1);
t += 6000; online = true; await ob.run(); eq("online: both synced", [ob.statusOf("s1"), ob.statusOf("s2")], ["synced", "synced"]);

// business refusal = failed with reason; others continue; manual retry
store = mkStore(); ob = createOutbox({ storage: store, now, send: async (k, p) => { if (p.id === "bad") throw biz; return ok(); } });
ob.enqueue("sale", "bad", { id: "bad" }); t++; ob.enqueue("sale", "good", { id: "good" });
await ob.run(); eq("bad failed", ob.statusOf("bad"), "failed"); eq("reason kept", ob.errorOf("bad"), "total_mismatch"); eq("good still synced", ob.statusOf("good"), "synced");
await ob.run(); eq("failed is not retried automatically", ob.list().find((i) => i.id === "bad").attempts, 1);
ob.retry("bad"); eq("manual retry -> pending", ob.statusOf("bad"), "pending");

// crash while syncing: reload, item resent, server duplicate => synced exactly once on server
store = mkStore(); const serverSeen = new Set(); let serverCreates = 0;
const server = async (k, p) => { if (serverSeen.has(p.id)) return { status: "duplicate" }; serverSeen.add(p.id); serverCreates++; return ok(); };
ob = createOutbox({ storage: store, now, send: async (k, p) => { await server(k, p); throw net; } });     // server saved it, phone lost the answer
ob.enqueue("sale", "x", { id: "x" }); await ob.run(); eq("answer lost -> pending", ob.statusOf("x"), "pending");
const raw = JSON.parse(store.getItem("ilelah:outbox")); raw[0].status = "syncing"; store.setItem("ilelah:outbox", JSON.stringify(raw));   // simulate app kill mid-send
ob = createOutbox({ storage: store, now, send: server }); eq("restart: syncing becomes pending", ob.statusOf("x"), "pending");
await ob.run(); eq("resend ok", ob.statusOf("x"), "synced"); eq("server created exactly one", serverCreates, 1);

// signed out: auth errors don't burn attempts
store = mkStore(); ob = createOutbox({ storage: store, now, send: async () => { throw { status: 401, message: "JWT expired" }; } });
ob.enqueue("sale", "q", { id: "q" }); await ob.run(); eq("auth: pending, 0 attempts used", [ob.statusOf("q"), ob.list()[0].attempts], ["pending", 0]);

// storage full: enqueue must fail loudly, not pretend
const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
ob = createOutbox({ storage: full, now, send: async () => ok() });
let threw = false; try { ob.enqueue("sale", "z", {}); } catch (e) { threw = true; } eq("full storage throws", threw, true); eq("nothing queued", ob.list().length, 0);

// survives restart with order kept
store = mkStore(); ob = createOutbox({ storage: store, now, send: async () => { throw net; } });
ob.enqueue("sale", "o1", {}); t++; ob.enqueue("payment", "o2", {}); const order = []; 
ob = createOutbox({ storage: store, now, send: async (k, p) => { order.push(k); return ok(); } }); t += 999999; await ob.run(); eq("order kept across restart", order, ["sale", "payment"]);

// resume(): connection is back -> retry straight away instead of waiting out the back-off
{ const st = mkStore(); let up = false; const sent = []; const o = createOutbox({ storage: st, now, send: async (k, p) => { if (!up) throw net; sent.push(k); return ok(); } });
  o.enqueue("sale", "r1", {}); await o.run(); eq("offline: waiting", o.stats().pending, 1); up = true; await o.run(); eq("still holding off during back-off", sent.length, 0);
  o.resume(); await o.run(); eq("resume() sends at once", [sent.length, o.stats().synced], [1, 1]); }
// discard(): only failed items can be removed; waiting ones can never be dropped by accident
{ const st = mkStore(); const o = createOutbox({ storage: st, now, send: async (k) => { if (k === "bad") throw biz; throw net; } });
  o.enqueue("bad", "d1", {}); o.enqueue("ok", "d2", {}); await o.run();
  eq("business refusal is failed", o.statusOf("d1"), "failed"); eq("discard refuses a waiting item", o.discard("d2"), false); eq("discard removes a failed item", [o.discard("d1"), o.statusOf("d1")], [true, null]); }
console.log(`${pass} passed, ${fail} failed`); if (fail) process.exit(1);
