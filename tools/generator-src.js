import { makeCode, newKeyPair, publicFromSecret, normalizeDeviceId, dayNumber } from "../src/license.js";
import { LICENSE_CONFIG } from "../src/license-config.js";

const $ = (id) => document.getElementById(id);
const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; };

$("priv").value = LS("tg:priv") || "";
let history = []; try { history = JSON.parse(LS("tg:history") || "[]"); } catch (e) {}

function keyStatus() {
  const v = $("priv").value.trim(); const el = $("keystatus");
  if (!v) { el.textContent = "Paste your private key (or create a new keypair below)."; el.className = "warn"; return false; }
  try {
    const pub = publicFromSecret(v);
    if (pub === LICENSE_CONFIG.publicKey) { el.textContent = "Key matches the app. Codes will work."; el.className = "ok"; return true; }
    el.textContent = "This key does NOT match the app's public key, codes it makes will be rejected."; el.className = "bad"; return false;
  } catch (e) { el.textContent = "That doesn't look like a valid private key."; el.className = "bad"; return false; }
}
$("priv").addEventListener("input", () => { LS("tg:priv", $("priv").value.trim()); keyStatus(); });
keyStatus();

$("newkey").onclick = () => {
  if (!confirm("Create a new keypair?\n\nApps built with the OLD public key will not accept codes from the new key. Only do this before your first release.")) return;
  const kp = newKeyPair();
  $("priv").value = kp.secret; LS("tg:priv", kp.secret); keyStatus();
  $("newpub").textContent = kp.public;
  $("newpubbox").style.display = "block";
};

function expiryFor(choice, custom) {
  if (choice === "life") return 0;
  const days = choice === "custom" ? parseInt(custom, 10) : parseInt(choice, 10);
  if (!days || days < 1) throw new Error("Enter a valid number of days.");
  return dayNumber() + days;
}

$("gen").onclick = () => {
  const out = $("out"), err = $("err"); err.textContent = ""; out.value = "";
  try {
    const dev = normalizeDeviceId($("dev").value);
    if (dev.length !== 10) throw new Error("Device ID should be 10 characters, like K7QM2-X9RTP.");
    const priv = $("priv").value.trim(); if (!priv) throw new Error("Paste your private key first.");
    const exp = expiryFor($("dur").value, $("days").value);
    const code = makeCode(priv, dev, $("cust").value, exp);
    out.value = code;
    history.unshift({ at: new Date().toISOString().slice(0, 16).replace("T", " "), customer: $("cust").value.trim(), device: dev, expires: exp ? new Date(Date.UTC(2020, 0, 1) + exp * 86400000).toISOString().slice(0, 10) : "lifetime", code });
    LS("tg:history", JSON.stringify(history.slice(0, 500))); renderHistory();
  } catch (e) { err.textContent = e.message; }
};
$("dur").onchange = () => { $("days").style.display = $("dur").value === "custom" ? "block" : "none"; };
$("copy").onclick = async () => { if (!$("out").value) return; try { await navigator.clipboard.writeText($("out").value); $("copy").textContent = "Copied"; setTimeout(() => $("copy").textContent = "Copy code", 1200); } catch (e) { $("out").select(); } };

function renderHistory() {
  const body = $("hist"); body.innerHTML = "";
  for (const h of history.slice(0, 50)) {
    const tr = document.createElement("tr");
    [h.at, h.customer || "—", h.device, h.expires].forEach((t) => { const td = document.createElement("td"); td.textContent = t; tr.appendChild(td); });
    const td = document.createElement("td"); const b = document.createElement("button"); b.textContent = "Copy"; b.onclick = () => navigator.clipboard.writeText(h.code).catch(() => {}); td.appendChild(b); tr.appendChild(td);
    body.appendChild(tr);
  }
}
$("csv").onclick = () => {
  const rows = [["issued", "customer", "device_id", "expires", "code"], ...history.map((h) => [h.at, h.customer, h.device, h.expires, h.code])];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "tally-issued-codes.csv"; a.click();
};
renderHistory();
