import React, { useState, useEffect } from "react";
import { Cloud, RefreshCw } from "lucide-react";
import { styles } from "../styles.js";
import { colors } from "../theme.js";
import { Badge, Button, Field, Modal, Row, List, Spinner } from "../ui.jsx";
import { cloud } from "./api.js";
import { describeAuthError, loginEmail } from "./identity.js";
import { remember, verify } from "./offlineauth.js";
import { runtime } from "./session.js";
import { AppCtx } from "../appctx.js";

const LABELS = { sale: "Sale", pay: "Credit repayment", po: "Purchase", exp: "Expense", expvoid: "Expense removed", cust: "New customer", custu: "Customer change", prod: "New product", produ: "Product change", prodx: "Product removed", open: "Opening stock", adj: "Stock change", br: "New branch", bru: "Branch change", dc: "Day close", shop: "Shop details", edit: "Price edit", refund: "Customer return" };
export const labelFor = (id) => LABELS[String(id).split(":")[0]] || "Change";

// small status button in the top bar (Cloud mode only)
export function SyncChip({ sync }) {
  if (!sync || !sync.cloudOn) return null;
  const { stats, busy, online } = sync; const open = (stats.pending || 0) + (stats.syncing || 0); const bad = stats.failed || 0;
  const kind = bad ? "danger" : open ? "warn" : "ok";
  const text = bad ? `${bad} failed` : open ? `${open} waiting` : online === false ? "Offline" : "Synced";
  const color = kind === "danger" ? colors.red : kind === "warn" ? colors.amber : colors.green;
  const bg = kind === "danger" ? colors.redSoft : kind === "warn" ? colors.amberSoft : colors.greenSoft;
  return (
    <button type="button" onClick={sync.openCenter} aria-label={"Cloud sync: " + text} style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px", border: "none", borderRadius: 999, background: bg, color, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
      {busy ? <Spinner size={14} /> : <Cloud size={14} />}{text}
    </button>
  );
}

export function SyncCenter({ sync, onClose }) {
  const app = React.useContext(AppCtx);
  const [, force] = useState(0);
  useEffect(() => sync.rt.outbox.subscribe(() => force((x) => x + 1)), [sync.rt]);
  const all = sync.rt.outbox.list();
  const open = all.filter((i) => i.status !== "synced").sort((a, b) => a.createdAt - b.createdAt);
  const done = all.filter((i) => i.status === "synced").length;
  const st = (i) => (i.status === "failed" ? <Badge kind="danger">Failed</Badge> : i.status === "syncing" ? <Badge kind="primary">Sending</Badge> : <Badge kind="warn">Waiting</Badge>);
  return (
    <Modal title="Cloud sync" onClose={onClose}>
      <div style={styles.stack}>
        <div style={styles.emptyNote}>
          Every change you make is saved on this phone first, then sent to the cloud. Something is only marked <strong>Synced</strong> after the server confirms it. {sync.lastAt ? `Last checked ${new Date(sync.lastAt).toLocaleTimeString()}.` : ""}
        </div>
        {sync.error ? <div style={{ color: colors.red, fontSize: 13.5 }}>{sync.error}</div> : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge kind="ok">{done} sent</Badge>
          <Badge kind="warn">{(sync.stats.pending || 0) + (sync.stats.syncing || 0)} waiting</Badge>
          <Badge kind={sync.stats.failed ? "danger" : "neutral"}>{sync.stats.failed || 0} failed</Badge>
        </div>
        {open.length ? (
          <List>
            {open.map((i) => (
              <Row key={i.id} title={labelFor(i.id)} sub={(i.status === "failed" ? "The server refused this: " : "") + (i.error || (i.status === "pending" ? "Will send when there is a connection." : ""))} value={st(i)} />
            ))}
          </List>
        ) : <div style={styles.emptyNote}>Nothing is waiting. Everything on this phone has reached the cloud.</div>}
        {open.some((i) => i.status === "failed") ? (
          <div style={styles.stack}>
            <div style={styles.emptyNote}><strong>Failed items stay on this phone</strong> but are not in the cloud. Try again, or discard them from the queue (the record stays on the phone and is not sent). New data from other phones is not downloaded while anything is failed or waiting.</div>
            <div className="sheet-actions">
              <Button variant="danger" onClick={async () => { if (await app.confirm({ title: "Discard the failed items?", text: "They will stay on this phone but never be sent.", okLabel: "Discard", danger: true })) { open.filter((i) => i.status === "failed").forEach((i) => sync.rt.outbox.discard(i.id)); sync.refresh(); } }}>Discard failed</Button>
              <Button onClick={() => { open.filter((i) => i.status === "failed").forEach((i) => sync.rt.outbox.retry(i.id)); sync.syncNow(); }}>Try again</Button>
            </div>
          </div>
        ) : null}
        <Button full variant="secondary" icon={RefreshCw} loading={sync.busy} onClick={sync.syncNow}>Sync now</Button>
      </div>
    </Modal>
  );
}

// Sign-in for Cloud mode (replaces the local username/password screen)
export function CloudLoginScreen({ onSignedIn, shopCodeHint, license }) {
  const [f, setF] = useState({ id: "", pw: "", shop: shopCodeHint || "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const submit = async () => {
    setBusy(true); setErr("");
    const email = loginEmail(f.id, f.shop);
    try {
      let me;
      try { me = await cloud.signIn(f.id, f.pw, f.shop); await remember(window.localStorage, email, f.pw, me); await onSignedIn(me, false); }
      catch (e) {
        // no connection: the same person can still sign in with the password they used before
        if (/failed to fetch|network|timeout|load failed/i.test(String((e && e.message) || e))) {
          const known = email ? await verify(window.localStorage, email, f.pw) : null;
          if (!known) throw new Error("No internet connection, and this phone has not signed this user in before (or the password is wrong).");
          await onSignedIn(known, true);
        } else throw e;
      }
    }
    catch (e) { setErr(describeAuthError(e)); }
    finally { setBusy(false); }
  };
  return (
    <div style={styles.loginWrap}>
      <div style={styles.loginCard}>
        <div style={styles.loginBrandRow}><div style={styles.brandMark}>I</div><div><div style={styles.brandName}>Ilelah Business Suite</div><div style={styles.brandSub}>Cloud mode</div></div></div>
        <div style={styles.loginHeading}>Sign in to the till</div>
        <div style={styles.stack}>
          <Field label="Username or e-mail"><input style={styles.input} autoCapitalize="none" autoCorrect="off" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} /></Field>
          {!f.id.includes("@") && <Field label="Shop code"><input style={styles.input} autoCapitalize="none" autoCorrect="off" value={f.shop} onChange={(e) => setF({ ...f, shop: e.target.value })} /></Field>}
          <Field label="Password"><input style={styles.input} type="password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} onKeyDown={(e) => e.key === "Enter" && f.id && f.pw && submit()} /></Field>
          {err ? <div style={{ color: colors.red, fontSize: 13.5 }}>{err}</div> : null}
          <Button full loading={busy} disabled={!f.id || !f.pw} onClick={submit}>Sign in</Button>
          <div style={styles.emptyNote}>The first sign-in of each person on this phone needs internet. After that they can sign in and keep selling offline; everything is sent when the connection returns.</div>
        </div>
      </div>
    </div>
  );
}

// "Saved on this phone / Sent to cloud / Not accepted" for one record, driven by the queue (never guessed)
export function SyncBadge({ id }) {
  const [, force] = useState(0);
  const rt = runtime();
  useEffect(() => (rt && rt.isCloud() ? rt.outbox.subscribe(() => force((x) => x + 1)) : undefined), [rt]);
  if (!rt || !rt.isCloud()) return null;
  const st = rt.outbox.statusOf(id);
  if (st === null) return <Badge kind="ok" icon={Cloud}>In cloud</Badge>;            // trimmed from the queue long ago = was sent
  if (st === "synced") return <Badge kind="ok" icon={Cloud}>Sent to cloud</Badge>;
  if (st === "failed") return <Badge kind="danger">Not accepted by the cloud</Badge>;
  return <Badge kind="warn">Waiting to send</Badge>;
}
