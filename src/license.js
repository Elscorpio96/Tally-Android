// Offline, device-bound activation codes (Ed25519 signatures).
// The app only holds the PUBLIC key, so codes cannot be forged from the app.
import nacl from "tweetnacl";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const EPOCH = Date.UTC(2020, 0, 1);
const DAY = 86400000;

export function b32encode(bytes) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function b32decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of str) {
    const i = B32.indexOf(ch); if (i < 0) return null;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(out);
}
export const toB64 = (u8) => btoa(String.fromCharCode(...u8));
export const fromB64 = (s) => Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0));

export const dayNumber = (d = new Date()) => Math.floor((d.getTime() - EPOCH) / DAY);
export const normalizeDeviceId = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const msg = (deviceId, expiryDay, name) =>
  new TextEncoder().encode(`TALLY1|${normalizeDeviceId(deviceId)}|${expiryDay}|${name}`);

// ----- used by the generator tool (needs the private key) -----
export function makeCode(secretKeyB64, deviceId, name, expiryDay /* 0 = lifetime */) {
  const secret = fromB64(secretKeyB64);
  if (secret.length !== 64) throw new Error("Private key is not valid.");
  const cleanName = String(name || "").replace(/[|\n\r]/g, " ").trim();
  let nameBytes = new TextEncoder().encode(cleanName);
  if (nameBytes.length > 60) nameBytes = nameBytes.slice(0, 60);
  const finalName = new TextDecoder().decode(nameBytes);
  const sig = nacl.sign.detached(msg(deviceId, expiryDay, finalName), secret);
  const payload = new Uint8Array(4 + nameBytes.length + 64);
  payload[0] = 1; payload[1] = (expiryDay >> 8) & 255; payload[2] = expiryDay & 255; payload[3] = nameBytes.length;
  payload.set(nameBytes, 4); payload.set(sig, 4 + nameBytes.length);
  const body = b32encode(payload).match(/.{1,5}/g).join("-");
  return "TL1-" + body;
}
export function newKeyPair() {
  const kp = nacl.sign.keyPair();
  return { secret: toB64(kp.secretKey), public: toB64(kp.publicKey) };
}
export const publicFromSecret = (secretB64) => toB64(fromB64(secretB64).slice(32));

// ----- used by the app -----
export function verifyCode(pubKeyB64, code, deviceId, today = dayNumber()) {
  try {
    const s = String(code || "").trim().toUpperCase().replace(/^TL1[-\s]*/, "").replace(/[^A-Z2-7]/g, "");
    const bytes = b32decode(s);
    if (!bytes || bytes.length < 68 || bytes[0] !== 1) return { ok: false, reason: "invalid" };
    const expiryDay = (bytes[1] << 8) | bytes[2];
    const nameLen = bytes[3];
    if (bytes.length < 4 + nameLen + 64) return { ok: false, reason: "invalid" };
    const name = new TextDecoder().decode(bytes.slice(4, 4 + nameLen));
    const sig = bytes.slice(4 + nameLen, 4 + nameLen + 64);
    if (!nacl.sign.detached.verify(msg(deviceId, expiryDay, name), sig, fromB64(pubKeyB64))) return { ok: false, reason: "invalid" };
    if (expiryDay !== 0 && today > expiryDay) return { ok: false, reason: "expired", name, expiryDay };
    return { ok: true, name, expiryDay };
  } catch (e) {
    return { ok: false, reason: "invalid" };
  }
}

// ----- device id + storage -----
const K_DEVICE = "tally:deviceId", K_LICENSE = "tally:license", K_SEEN = "tally:lastSeenDay";
const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

export function getDeviceId() {
  let id = get(K_DEVICE);
  if (!id || normalizeDeviceId(id).length !== 10) {
    const r = nacl.randomBytes(10);
    id = Array.from(r, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
    id = id.slice(0, 5) + "-" + id.slice(5);
    set(K_DEVICE, id);
  }
  return id;
}

export function checkStoredLicense(pubKeyB64) {
  const code = get(K_LICENSE);
  if (!code) return { ok: false, reason: "none" };
  // guard against winding the phone clock back to extend a time-limited license
  const today = Math.max(dayNumber(), parseInt(get(K_SEEN) || "0", 10));
  const r = verifyCode(pubKeyB64, code, getDeviceId(), today);
  if (r.ok) set(K_SEEN, String(today));
  return r;
}

export function activate(pubKeyB64, code) {
  const r = verifyCode(pubKeyB64, code, getDeviceId(), Math.max(dayNumber(), parseInt(get(K_SEEN) || "0", 10)));
  if (r.ok) { set(K_LICENSE, String(code).trim()); set(K_SEEN, String(Math.max(dayNumber(), parseInt(get(K_SEEN) || "0", 10)))); }
  return r;
}
export function describeExpiry(expiryDay) {
  if (!expiryDay) return "lifetime";
  const d = new Date(EPOCH + expiryDay * DAY);
  return "valid until " + d.toISOString().slice(0, 10);
}
