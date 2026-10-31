// PIN storage for the lock screen. Per phone, never synced and not part of backups.
// A PIN is 4 digits, kept only as a salted SHA-256 hash. Five wrong tries lock it for 30 seconds.
const KEY = "tally:pins", FAIL = "tally:pinfail", LOCKED = "tally:locked";
const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v === null ? d : v; } catch (e) { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha(text) {
  if (window.crypto && window.crypto.subtle) return hex(await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let h = 5381; for (const c of text) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return "x" + h.toString(16);      // very old WebView: weaker, still not plain text
}
export const validPin = (p) => /^\d{4}$/.test(String(p || ""));
export const hasPin = (userId) => !!read(KEY, {})[userId];
export const anyPin = (ids) => ids.some(hasPin);
export async function setPin(userId, pin) {
  if (!validPin(pin)) throw new Error("A PIN is exactly 4 digits.");
  const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const all = read(KEY, {}); all[userId] = { s: salt, h: await sha(salt + ":" + userId + ":" + pin) }; write(KEY, all);
}
export function clearPin(userId) { const all = read(KEY, {}); delete all[userId]; write(KEY, all); }
export const waitSeconds = () => { const f = read(FAIL, { n: 0, until: 0 }); return Math.max(0, Math.ceil((f.until - Date.now()) / 1000)); };
// true = correct. false = wrong. Throws "wait" while locked out.
export async function verifyPin(userId, pin) {
  if (waitSeconds() > 0) throw new Error("wait");
  const e = read(KEY, {})[userId]; if (!e) return false;
  const ok = (await sha(e.s + ":" + userId + ":" + pin)) === e.h;
  if (ok) write(FAIL, { n: 0, until: 0 });
  else { const f = read(FAIL, { n: 0, until: 0 }); const n = f.n + 1; write(FAIL, n >= 5 ? { n: 0, until: Date.now() + 30000 } : { n, until: 0 }); }
  return ok;
}
export const isLockedFlag = () => read(LOCKED, false) === true;
export const setLockedFlag = (v) => write(LOCKED, !!v);
