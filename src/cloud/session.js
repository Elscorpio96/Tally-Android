// The single cloud runtime for this phone, plus the few helpers the screens use to stay compatible with Local mode.
// In Local mode (the default) none of this does anything: ids, invoice numbers and saving are exactly as before.
import { createRuntime } from "./runtime.js";
import { supabaseTransport } from "./transport.js";
import { cloudConfigured } from "./config.js";

let rt = null;
export function runtime() {
  if (!cloudConfigured() || typeof window === "undefined") return null;
  if (!rt) rt = createRuntime({ storage: window.localStorage, transport: supabaseTransport });
  return rt;
}
export const inCloud = () => { const r = runtime(); return !!r && r.isCloud(); };
export const newUuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));
// Local mode keeps the old short ids ("s-ab12cd34"); Cloud mode needs real UUIDs.
export const makeId = (prefix, localId) => (inCloud() ? newUuid() : prefix + localId());
// Cloud mode numbers invoices per phone ("MAIN-K7Q-12"), so two phones can never clash.
export function numberLabel(kind, n) {
  const r = runtime(); if (!r || !r.isCloud()) return n;
  const c = r.ctx(); const prefix = c && c.invoicePrefix; if (!prefix) return n;
  return kind === "payment" ? `${prefix}-R${n}` : `${prefix}-${n}`;
}
export const appRoleOf = (cloudRole) => (cloudRole === "owner" || cloudRole === "admin" ? "admin" : "staff");
export function cloudUserFrom(me) {
  return { id: me.user_id, username: me.username || String(me.display_name || "user").toLowerCase().replace(/\s+/g, ""), name: me.display_name || "User", role: appRoleOf(me.role), cloudRole: me.role, branchId: me.branch_id || null };
}
