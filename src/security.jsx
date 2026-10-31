import React, { useState, useEffect, useRef } from "react";
import { Delete, Lock, LogOut, Users as UsersIcon } from "lucide-react";
import { colors } from "./theme.js";
import { verifyPin, waitSeconds, hasPin } from "./security.js";
import { Avatar, Button, Modal } from "./ui.jsx";

// Four dots and a keypad. onDone(pin) returns true (accepted) or false (wrong) or throws "wait".
export function PinPad({ title, subtitle, onDone, onCancel, busyText }) {
  const [pin, setPin] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [wait, setWait] = useState(waitSeconds());
  const alive = useRef(true); useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { if (wait <= 0) return undefined; const t = setInterval(() => { const w = waitSeconds(); setWait(w); if (w <= 0) setErr(""); }, 500); return () => clearInterval(t); }, [wait]);
  const press = async (d) => {
    if (busy || wait > 0) return;
    const next = (pin + d).slice(0, 4); setPin(next); setErr("");
    if (next.length === 4) {
      setBusy(true);
      try { const ok = await onDone(next); if (!ok && alive.current) { setErr("Wrong PIN"); setPin(""); } }
      catch (e) { if (alive.current) { setWait(waitSeconds() || 30); setErr("Too many wrong tries"); setPin(""); } }
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    const k = (e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === "Backspace") setPin((p) => p.slice(0, -1)); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  });
  return (
    <div style={{ textAlign: "center", maxWidth: 320, margin: "0 auto" }}>
      <div style={{ fontWeight: 700, fontSize: 18 }}>{title}</div>
      {subtitle && <div style={{ color: colors.inkSoft, fontSize: 13.5, marginTop: 2 }}>{subtitle}</div>}
      <div aria-label={`${pin.length} of 4 digits entered`} style={{ display: "flex", gap: 14, justifyContent: "center", margin: "18px 0 8px" }}>
        {[0, 1, 2, 3].map((i) => <span key={i} style={{ width: 16, height: 16, borderRadius: "50%", border: `2px solid ${err ? colors.red : colors.primary}`, background: i < pin.length ? (err ? colors.red : colors.primary) : "transparent", transition: "background .1s" }} />)}
      </div>
      <div style={{ minHeight: 20, fontSize: 13.5, color: colors.red, fontWeight: 600 }} role="alert">{wait > 0 ? `Try again in ${wait}s` : err}{busy && busyText ? busyText : ""}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 10 }}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <button key={d} type="button" aria-label={d} onClick={() => press(d)} style={keyStyle}>{d}</button>)}
        <span />
        <button type="button" aria-label="0" onClick={() => press("0")} style={keyStyle}>0</button>
        <button type="button" aria-label="Delete" onClick={() => setPin((p) => p.slice(0, -1))} style={{ ...keyStyle, background: "transparent", boxShadow: "none" }}><Delete size={22} /></button>
      </div>
      {onCancel && <Button variant="secondary" full onClick={onCancel} style={{ marginTop: 14 }}>Cancel</Button>}
    </div>
  );
}
const keyStyle = { height: 58, borderRadius: 16, border: "none", background: colors.surface2, color: colors.ink, fontSize: 24, fontWeight: 600 };

// Full-screen lock. Local mode can also hand the phone to another person who has a PIN.
export function LockScreen({ user, others, cloudOn, onUnlock, onSwitch, onSignOut }) {
  const [who, setWho] = useState(user);        // whose PIN is being asked
  const [picking, setPicking] = useState(false);
  const candidates = (others || []).filter((u) => u.id !== user.id && hasPin(u.id));
  return (
    <div role="dialog" aria-modal="true" aria-label="Locked" style={{ position: "fixed", inset: 0, zIndex: 3000, background: colors.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 20px calc(var(--sab) + 20px)", overflowY: "auto" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Avatar name={who.name} size={64} />
        <div style={{ fontWeight: 700, fontSize: 19 }}>{who.name}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: colors.inkSoft, fontSize: 13.5 }}><Lock size={15} /> Enter your PIN to continue</div>
      </div>
      {picking ? (
        <div style={{ width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 8 }}>
          {[user, ...candidates].map((u) => <Button key={u.id} variant="secondary" full onClick={() => { setWho(u); setPicking(false); }}>{u.name}</Button>)}
          <Button variant="secondary" full onClick={() => setPicking(false)}>Back</Button>
        </div>
      ) : (
        <PinPad title="" onDone={async (pin) => { const ok = await verifyPin(who.id, pin); if (ok) { who.id === user.id ? onUnlock() : onSwitch(who.id); } return ok; }} />
      )}
      {!picking && (
        <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap", justifyContent: "center" }}>
          {!cloudOn && candidates.length > 0 && <Button variant="secondary" icon={UsersIcon} onClick={() => setPicking(true)}>Switch user</Button>}
          <Button variant="secondary" icon={LogOut} onClick={onSignOut}>Forgot PIN? Sign out</Button>
        </div>
      )}
    </div>
  );
}

// Owner approval for something a cashier cannot do alone (a return). Resolves through onResult(true|false).
export function OwnerApproval({ admins, onResult }) {
  const [who, setWho] = useState((admins.find((a) => hasPin(a.id)) || admins[0]) || null);
  const withPin = admins.filter((a) => hasPin(a.id));
  if (!who || withPin.length === 0) return (
    <Modal title="Owner approval needed" onClose={() => onResult(false)}>
      <p style={{ color: colors.inkSoft, lineHeight: 1.5 }}>Returns must be approved by the owner. The owner has not set a PIN yet, so ask them to do this return, or to set a PIN under their account.</p>
      <div className="sheet-actions"><Button onClick={() => onResult(false)}>OK</Button></div>
    </Modal>
  );
  return (
    <Modal title="Owner approval" onClose={() => onResult(false)}>
      <PinPad title={`${who.name}, enter your PIN`} subtitle="Approving this return" onDone={async (pin) => { const ok = await verifyPin(who.id, pin); if (ok) onResult(true); return ok; }} onCancel={() => onResult(false)} />
      {withPin.length > 1 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 12 }}>{withPin.map((a) => <button key={a.id} type="button" className={"chip" + (a.id === who.id ? " on" : "")} onClick={() => setWho(a)}>{a.name}</button>)}</div>}
    </Modal>
  );
}

// Set or change your own PIN: type it twice.
export function PinSetup({ onSave, onClose }) {
  const [first, setFirst] = useState(null);
  return (
    <Modal title={first ? "Confirm your PIN" : "Choose a 4-digit PIN"} onClose={onClose}>
      <PinPad key={first ? "b" : "a"} title={first ? "Type it again" : "New PIN"} subtitle={first ? "" : "You will use it to unlock the app and to switch cashiers."}
        onDone={async (pin) => { if (!first) { setFirst(pin); return true; } if (pin !== first) { setFirst(null); return false; } await onSave(pin); return true; }} />
    </Modal>
  );
}
