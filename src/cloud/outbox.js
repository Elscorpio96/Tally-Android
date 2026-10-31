// Durable upload queue. Rules:
//  - a record is saved here BEFORE any network call, with a client-made unique ID;
//  - it becomes "synced" only after the server answers success (created or duplicate);
//  - network trouble => stays pending and is retried with back-off, nothing is lost or doubled
//    (the server treats a repeated ID as already done);
//  - a business refusal (e.g. total mismatch) => "failed" with the reason, shown to the owner, never retried blindly.
const KEY = "ilelah:outbox";
export const STATUS = { pending: "pending", syncing: "syncing", synced: "synced", failed: "failed" };

export function classifyError(e) {
  const msg = String((e && (e.message || e.error)) || e || "");
  const status = e && e.status;
  if (/jwt|not signed in|auth session missing|refresh token/i.test(msg) || status === 401) return "auth";
  if (!status && /fetch|network|timeout|timed out|offline|load failed|abort/i.test(msg)) return "network";
  if (!status && !(e && e.code)) return "network";
  if (status === 0 || status === 408 || status === 429 || status >= 500) return "network";
  return "business";
}
export const backoffMs = (attempts) => Math.min(5000 * 2 ** Math.max(0, attempts - 1), 15 * 60 * 1000);

export function createOutbox({ storage, send, now = () => Date.now(), keep = 500 }) {
  let items = [];
  let running = false; let paused = false; let holdUntil = 0; const subs = new Set();
  const load = () => {
    try { items = JSON.parse(storage.getItem(KEY) || "[]"); } catch (_) { items = []; }
    // a crash while sending leaves "syncing": safe to resend because the server de-duplicates by ID
    for (const it of items) { if (it.status === STATUS.syncing) it.status = STATUS.pending; if (it.status === STATUS.pending) it.nextAt = 0; }   // after a restart, try straight away
  };
  const persist = () => {
    // keep every unsent/failed item; trim only old synced receipts
    const open = items.filter((i) => i.status !== STATUS.synced);
    const done = items.filter((i) => i.status === STATUS.synced).slice(-keep);
    items = [...items.filter((i) => open.includes(i) || done.includes(i))];
    storage.setItem(KEY, JSON.stringify(items));   // throws if storage is full: callers must treat that as "not queued"
    subs.forEach((f) => f(stats()));
  };
  const stats = () => items.reduce((a, i) => ({ ...a, [i.status]: (a[i.status] || 0) + 1 }), { pending: 0, syncing: 0, synced: 0, failed: 0 });
  load();

  return {
    enqueue(kind, id, payload) {
      if (items.some((i) => i.id === id)) return false;                    // already queued: never a second copy
      items.push({ id, kind, payload, status: STATUS.pending, attempts: 0, nextAt: 0, error: "", createdAt: now() });
      try { persist(); } catch (e) { items.pop(); throw new Error("Could not save the sale queue (phone storage is full)."); }
      return true;
    },
    statusOf: (id) => (items.find((i) => i.id === id) || {}).status || null,
    errorOf: (id) => (items.find((i) => i.id === id) || {}).error || "",
    list: () => items.map(({ payload, ...rest }) => rest),
    stats, subscribe(f) { subs.add(f); return () => subs.delete(f); },
    retry(id) { const it = items.find((i) => i.id === id); if (it && it.status === STATUS.failed) { it.status = STATUS.pending; it.nextAt = 0; it.error = ""; persist(); } },
    discard(id) { const i = items.findIndex((x) => x.id === id && x.status === STATUS.failed); if (i >= 0) { items.splice(i, 1); persist(); return true; } return false; },
    // connection is back (or the user pressed Sync now): stop waiting and try everything straight away
    resume() { holdUntil = 0; for (const i of items) if (i.status === STATUS.pending) i.nextAt = 0; },
    pause(v) { paused = !!v; },
    // send everything that is due, oldest first. Single-flight.
    async run() {
      if (running || paused || holdUntil > now()) return stats();
      running = true;
      try {
        for (const it of items.filter((i) => i.status === STATUS.pending).sort((a, b) => a.createdAt - b.createdAt)) {
          if (paused || it.nextAt > now()) continue;
          it.status = STATUS.syncing; it.attempts += 1; persist();
          try {
            const res = await send(it.kind, it.payload);
            holdUntil = 0; it.status = STATUS.synced; it.syncedAt = now(); it.error = ""; it.result = res && res.status ? { status: res.status } : undefined; persist();
          } catch (e) {
            const kind = classifyError(e);
            it.error = String((e && e.message) || e).slice(0, 300);
            if (kind === "business") { it.status = STATUS.failed; }
            else { it.status = STATUS.pending; it.nextAt = now() + (kind === "auth" ? 30000 : backoffMs(it.attempts)); if (kind === "auth") it.attempts -= 1; }
            persist();
            if (kind === "network" || kind === "auth") { holdUntil = it.nextAt; break; }   // offline: pause the whole queue, try again later
          }
        }
      } finally { running = false; }
      return stats();
    },
  };
}
