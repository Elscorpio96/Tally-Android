// Lets the same person sign back in without internet. Only a salted, slow hash of the password is kept on the phone
// (never the password itself), and only after a successful online sign-in.
const KEY = "tally:cloud:offlineauth";
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function derive(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 120000 }, key, 256));
}
const read = (storage) => { try { return JSON.parse(storage.getItem(KEY) || "{}"); } catch (_) { return {}; } };
export async function remember(storage, email, password, me) {
  try {
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    const all = read(storage); all[email] = { salt, hash: await derive(password, salt), me };
    storage.setItem(KEY, JSON.stringify(all));
  } catch (_) { /* optional convenience */ }
}
export async function verify(storage, email, password) {
  const r = read(storage)[email]; if (!r) return null;
  return (await derive(password, r.salt)) === r.hash ? r.me : null;
}
export function forget(storage) { storage.removeItem(KEY); }
