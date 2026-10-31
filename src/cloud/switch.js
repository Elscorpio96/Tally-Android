// The guided move from Local mode to Cloud mode, as plain functions so every step can be tested.
// Order matters and nothing on the phone is changed until the backup exists and the totals have been checked:
//   1 backup  ->  2 compare  ->  3 confirm  ->  4 replace  ->  5 verify  ->  (6 restore if anything is wrong)
import { MODE_KEY, CTX_KEY, SNAP_KEY, CURSOR_KEY, STAMP_KEY, STOCK_CURSOR_KEY, compareTotals } from "./runtime.js";
import { buildImportPayload } from "./legacy-export.js";
import { refreshBalances, BAL_KEY } from "./balances.js";

export const DATA_NAMES = ["products", "sales", "purchases", "expenses", "customers", "creditPayments", "users", "branches", "settings", "dayCloses"];
const DATA_KEYS = [...DATA_NAMES.map((n) => "tally:" + n), "tally:seq:invoice", "tally:seq:payment", "tally:sessionUserId", "tally:workingBranchId"];
export const OUTBOX_KEY = "ilelah:outbox";
const parse = (v, d) => { try { return v === null || v === undefined ? d : JSON.parse(v); } catch (_) { return d; } };

export function readState(storage) {
  const s = {}; for (const n of DATA_NAMES) s[n] = parse(storage.getItem("tally:" + n), n === "settings" || n === "dayCloses" ? {} : []); return s;
}
export function hasSnapshot(storage) { return !!storage.getItem(SNAP_KEY); }
export function snapshotInfo(storage) { const s = parse(storage.getItem(SNAP_KEY), null); return s ? { at: s.at } : null; }

// Step 1b: an exact copy of every record, kept on the phone in addition to the backup file.
export function takeSnapshot(storage, now = () => new Date().toISOString()) {
  const data = {}; for (const k of DATA_KEYS) { const v = storage.getItem(k); if (v !== null) data[k] = v; }
  const text = JSON.stringify({ at: now(), data });
  storage.setItem(SNAP_KEY, text);                                   // throws if the phone has no room: nothing has changed yet
  if (storage.getItem(SNAP_KEY) !== text) throw new Error("snapshot_not_saved");
}
// Step 6: put everything back exactly as it was and return to Local mode.
export function restoreSnapshot(storage) {
  const snap = parse(storage.getItem(SNAP_KEY), null); if (!snap) throw new Error("no_snapshot");
  for (const k of DATA_KEYS) { if (k in snap.data) storage.setItem(k, snap.data[k]); else storage.removeItem(k); }
  storage.setItem(MODE_KEY, "local"); storage.removeItem(BAL_KEY); storage.removeItem(CTX_KEY); storage.removeItem(CURSOR_KEY); storage.removeItem(STAMP_KEY); storage.removeItem(STOCK_CURSOR_KEY); storage.removeItem("tally:cloud:lastfull"); storage.removeItem(OUTBOX_KEY);
}

export const cloudIsEmpty = (t) => !["products", "customers", "sales", "expenses_total", "purchases_total", "repayments_total"].some((k) => Number(t[k] || 0) > 0);

// Step 2: how the phone's records compare with the cloud's. Copies the phone's data to an EMPTY cloud shop first
// (owner only, verified by the server); a shop that already holds data is never written to here.
const isAdminRole = (me) => me.role === "owner" || me.role === "admin";
export async function prepare({ rt, storage, me, onProgress = () => {} }) {
  // Branch staff can only see their own branch in the cloud, so shop-wide totals are not available to them.
  if (!isAdminRole(me)) return { rows: [], match: false, limited: true, cloudHadData: true, copied: false };
  const state = readState(storage); let cloudTotals = await rt.totals(); let copied = false;
  if (cloudIsEmpty(cloudTotals) && me.role === "owner") {
    onProgress("Copying this phone's records to the cloud…");
    await rt.transport.rpc("import_legacy", { p: buildImportPayload(state) });
    // regular-customer discounts are not part of the verified import; carry them over by the old customer id
    for (const c of state.customers || []) if (Number(c.discountPct) > 0) await rt.transport.write({ t: "db", m: "update", table: "customers", patch: { discount_pct: Number(c.discountPct) }, match: { legacy_id: String(c.id) } });
    cloudTotals = await rt.totals(); copied = true;
  }
  const rows = compareTotals(rt.localTotals(state), cloudTotals);
  return { rows, match: rows.every((r) => r.ok), cloudHadData: !copied && !cloudIsEmpty(cloudTotals), copied, cloudTotals };
}

// Steps 4-5: replace the phone's records with the cloud copy, then check the result. Any failure restores the snapshot.
export async function switchNow({ rt, storage, me, branchId, deviceName = "Phone", onProgress = () => {} }) {
  if (!hasSnapshot(storage)) throw new Error("Make the backup first.");
  try {
    const existing = rt.ctx();
    onProgress("Registering this phone…");
    const dev = existing && existing.shopId === me.shop_id && existing.branchId === branchId && existing.deviceId ? existing : await (async () => {
      const d = await rt.transport.rpc("register_device", { p_branch: branchId, p_name: deviceName });
      return { shopId: me.shop_id, userId: me.user_id, deviceId: d.device_id, devicePrefix: d.code, invoicePrefix: d.invoice_prefix, branchId };
    })();
    onProgress("Downloading the cloud copy…");
    const stamp = await rt.stamp().catch(() => null);            // taken BEFORE the download so nothing changed during it is missed
    const cloud = await rt.pull();
    onProgress("Replacing this phone's records…");
    const put = (k, v) => storage.setItem("tally:" + k, JSON.stringify(v));
    for (const n of ["products", "sales", "purchases", "expenses", "customers", "creditPayments", "branches", "dayCloses"]) put(n, cloud[n]);
    if (cloud.settings) put("settings", { ...parse(storage.getItem("tally:settings"), {}), ...cloud.settings });
    storage.setItem("tally:workingBranchId", JSON.stringify(branchId));
    storage.setItem("tally:sessionUserId", JSON.stringify(me.user_id));
    storage.removeItem(OUTBOX_KEY);
    rt.setCtx({ ...dev, userId: me.user_id, me }); storage.setItem(CURSOR_KEY, cloud.cursor || ""); storage.setItem(STOCK_CURSOR_KEY, cloud.stockCursor || ""); if (stamp) storage.setItem(STAMP_KEY, JSON.stringify(stamp)); else storage.removeItem(STAMP_KEY); storage.setItem("tally:cloud:lastfull", String(Date.now())); storage.setItem(MODE_KEY, "cloud");
    if (!isAdminRole(me)) await refreshBalances(rt, storage, cloud); else storage.removeItem(BAL_KEY);
    onProgress("Checking the records and totals…");
    // owners/admins: shop-wide totals from the server; branch staff: what is stored must equal what was downloaded
    const rows = isAdminRole(me)
      ? compareTotals(rt.localTotals(readState(storage)), await rt.totals(), { customers: "customers_all" })
      : compareTotals(rt.localTotals(readState(storage)), rt.localTotals(cloud));
    if (!rows.every((r) => r.ok)) throw new Error("verify_failed:" + rows.filter((r) => !r.ok).map((r) => r.label).join(", "));
    return { ok: true, rows };
  } catch (e) {
    let restored = false; try { restoreSnapshot(storage); restored = true; } catch (_) {}
    const err = new Error(String((e && e.message) || e)); err.restored = restored; throw err;
  }
}

// Leaving Cloud mode keeps the records on the phone as they are; the phone simply stops syncing.
export function leaveCloud(storage) { storage.setItem(MODE_KEY, "local"); }
