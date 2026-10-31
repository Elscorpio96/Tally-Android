import React, { useState, useEffect, useCallback } from "react";
import { Cloud, UserPlus, LogOut, KeyRound, Copy } from "lucide-react";
import { shareText } from "../native.js";
import { AppCtx } from "../appctx.js";
import { styles } from "../styles.js";
import { colors } from "../theme.js";
import { Badge, Button, Field, Modal, Row, List, SectionHeader, Segmented } from "../ui.jsx";
import { cloudConfigured } from "./config.js";
import { cloud } from "./api.js";
import { buildImportPayload } from "./legacy-export.js";
import { money } from "../theme.js";
import { runtime } from "./session.js";
import * as SW from "./switch.js";
import { describeAuthError, validShopCode, validUsername, normUsername, normShopCode } from "./identity.js";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", manager: "Manager", cashier: "Cashier" };

// Shown in Settings. Renders nothing at all in builds that have no cloud project configured,
// so shops that stay in Local mode see no change.
export function CloudPanel({ showToast, fullState, onBackup }) {
  const app = React.useContext(AppCtx);
  const [me, setMe] = useState(undefined);        // undefined = checking, null = signed out
  const [dialog, setDialog] = useState(null);     // "signin" | "signup" | "staff"
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ shop: "", id: "", pw: "", email: "", shopName: "", name: "" });
  const [staff, setStaff] = useState([]);
  const [shopCode, setShopCode] = useState("");
  const [member, setMember] = useState(null);        // staff row opened for actions
  const [pw, setPw] = useState({ value: "", done: "" });
  const [branches, setBranches] = useState([]);
  const [imp, setImp] = useState(null);       // { payload, saved, result, error }
  const [sw, setSw] = useState(null);         // switch-to-Cloud wizard: { step, branchId, backedUp, rows, match, limited, typed, error, progress }
  const [sf, setSf] = useState({ username: "", name: "", password: "", role: "cashier", branchId: "" });

  const refresh = useCallback(async () => {
    try {
      const s = await cloud.session();
      setMe(s ? await cloud.whoami() : null);
    } catch (e) {
      const r = runtime(); const c = r && r.isCloud() ? r.ctx() : null;
      setMe(c && c.me ? c.me : null);                 // offline in Cloud mode: show the account this phone is signed in with
    }
  }, []);
  useEffect(() => { if (cloudConfigured()) refresh(); }, [refresh]);

  const isAdmin = me && (me.role === "owner" || me.role === "admin");
  const loadStaff = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setBranches(await cloud.list("branches", "id,name,code", (q) => q.is("archived_at", null).order("name")));
      try { const sh = await cloud.list("shops", "code"); if (sh && sh[0]) { setShopCode(sh[0].code); const r = runtime(); if (r && r.ctx()) r.setCtx({ ...r.ctx(), shopCode: sh[0].code }); } } catch (e) {}
      setStaff(await cloud.list("memberships", "user_id,role,branch_id,active,profiles(display_name,username)", (q) => q.order("created_at")));
    } catch (e) { showToast(describeAuthError(e), "err"); }
  }, [isAdmin, showToast]);
  useEffect(() => { loadStaff(); }, [loadStaff]);

  if (!cloudConfigured()) return null;

  const run = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); if (okMsg) showToast(okMsg); return true; }
    catch (e) { showToast(describeAuthError(e), "err"); return false; }
    finally { setBusy(false); }
  };
  const signIn = () => run(async () => { setMe(await cloud.signIn(f.id, f.pw, f.shop)); setDialog(null); setF({ ...f, pw: "" }); }, "Signed in.");
  const signUp = () => run(async () => {
    if (!validShopCode(f.shop)) throw new Error("Shop code must be 3-12 letters or numbers.");
    if (f.pw.length < 8) throw new Error("Password must be at least 8 characters.");
    setMe(await cloud.signUpOwner(f.email.trim(), f.pw, f.shopName.trim(), normShopCode(f.shop), f.name.trim() || "Owner"));
    setDialog(null); setF({ ...f, pw: "" });
  }, "Shop account created.");
  const signOut = () => run(async () => { await cloud.signOut(); setMe(null); setStaff([]); }, "Signed out.");
  const openImport = () => setImp({ payload: buildImportPayload(fullState || {}), saved: false, result: null, error: "" });
  const runImport = async () => {
    setBusy(true);
    try { const r = await cloud.importLegacy(imp.payload); setImp((x) => ({ ...x, result: r, error: "" })); }
    catch (e) { setImp((x) => ({ ...x, error: String((e && e.message) || e) })); }
    finally { setBusy(false); }
  };
  const addStaff = () => run(async () => {
    if (!validUsername(sf.username)) throw new Error("Username: 3-24 letters, numbers, dot, dash or underscore.");
    await cloud.createStaff({ username: normUsername(sf.username), password: sf.password, name: sf.name.trim(), role: sf.role, branchId: sf.role === "admin" ? null : sf.branchId || null });
    setDialog(null); setSf({ username: "", name: "", password: "", role: "cashier", branchId: "" }); await loadStaff();
  }, "Staff account created.");
  const toggleActive = (m) => run(async () => {
    await cloud.setMember(m.user_id, m.role, m.branch_id, !m.active, m.active ? "Disabled from Settings" : "Re-enabled from Settings");
    await loadStaff();
  }, m.active ? "Access removed." : "Access restored.");

  const genPw = () => { const a = "abcdefghjkmnpqrstuvwxyz23456789"; let o = ""; const r = new Uint32Array(8); (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(r) : r.forEach((_, i) => (r[i] = Math.random() * 4e9)); r.forEach((v) => { o += a[v % a.length]; }); setPw({ value: o, done: "" }); };
  const doReset = () => run(async () => {
    await cloud.resetStaffPassword(member.user_id, pw.value);
    setPw((x) => ({ ...x, done: x.value }));
  }, "Password changed.");
  const closeMember = () => { setMember(null); setPw({ value: "", done: "" }); };
  const canReset = (m) => m && m.role !== "owner" && !(m.role === "admin" && me && me.role !== "owner") && m.user_id !== (me && me.user_id);

  const rt = runtime(); const inCloudMode = !!rt && rt.isCloud();
  const isAdminRole = (m) => m && (m.role === "owner" || m.role === "admin");
  const openSwitch = () => setSw({ step: "intro", branchId: me.branch_id || "", backedUp: false, rows: [], match: false, limited: false, typed: "", error: "", progress: "" });
  const patch = (o) => setSw((x) => ({ ...x, ...o }));
  const doBackup = async () => {
    patch({ error: "" });
    try { await onBackup(); SW.takeSnapshot(window.localStorage); patch({ backedUp: true }); }
    catch (e) { patch({ error: e && e.message === "backup" ? "The backup file could not be saved, so nothing was changed." : "This phone has no room to keep a safety copy, so nothing was changed. Free up space or remove old data, then try again." }); }
  };
  const doCompare = async () => {
    patch({ step: "working", progress: "Comparing this phone with the cloud…", error: "" });
    try {
      let bl = sw.branchId;
      if (isAdminRole(me) && !bl) { const b = await cloud.list("branches", "id,name,code", (q) => q.is("archived_at", null).order("name")); setBranches(b); bl = b[0] && b[0].id; }
      const r = await SW.prepare({ rt, storage: window.localStorage, me, onProgress: (t) => patch({ progress: t }) });
      patch({ step: "compare", rows: r.rows, match: r.match, limited: !!r.limited, cloudHadData: r.cloudHadData, copied: r.copied, branchId: bl || sw.branchId });
    } catch (e) { patch({ step: "intro", error: describeAuthError(e) }); }
  };
  const doSwitch = async () => {
    patch({ step: "working", progress: "Starting…", error: "" });
    try {
      const r = await SW.switchNow({ rt, storage: window.localStorage, me, branchId: sw.branchId, onProgress: (t) => patch({ progress: t }) });
      patch({ step: "done", rows: r.rows });
    } catch (e) {
      patch({ step: "failed", error: String(e.message).startsWith("verify_failed") ? "After copying, these totals did not match: " + String(e.message).split(":")[1] + "." : describeAuthError(e), restored: !!e.restored });
    }
  };
  const restore = async () => {
    const n = rt ? rt.pendingCount() + rt.failedCount() : 0;
    if (!(await app.confirm({ title: "Restore the earlier records?", text: (n ? `${n} change(s) on this phone have not reached the cloud and will be lost. ` : "") + "Put back the records saved just before you switched, and return to Local mode?", okLabel: "Restore", danger: true }))) return;
    try { SW.restoreSnapshot(window.localStorage); window.location.reload(); } catch (e) { showToast("Could not restore: " + e.message, "err"); }
  };
  const leave = async () => {
    const n = rt ? rt.pendingCount() + rt.failedCount() : 0;
    if (n) { showToast(`${n} change(s) have not reached the cloud yet. Open the sync status (top bar) to send or discard them first.`, "err", 4500); return; }
    if (!(await app.confirm({ title: "Go back to Local mode?", text: "Stop syncing. The records stay on this phone, but new sales will no longer reach the cloud or other phones.", okLabel: "Stop syncing", danger: true }))) return;
    SW.leaveCloud(window.localStorage); window.location.reload();
  };

  return (
    <div>
      <SectionHeader title="Cloud account" />
      <div className="card">
        {me === undefined ? <div style={styles.emptyNote}>Checking…</div> : me ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <strong>{me.shop_name}</strong><Badge kind="ok" icon={Cloud}>{ROLE_LABEL[me.role]}</Badge>
            </div>
            <div style={{ ...styles.emptyNote, paddingTop: 0 }}>
              Signed in as {me.display_name}. Your account and permissions are checked by the server. {inCloudMode ? "This phone is in Cloud mode: every change is saved here first and sent to the cloud when there is a connection." : "This phone is still in Local mode: all shop data stays on this phone until you choose to switch, so keep saving backups."}
            </div>
            {isAdmin && shopCode ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: colors.surface2, borderRadius: 12, padding: "10px 12px", marginTop: 10 }}>
                <div><div style={{ fontSize: 12, color: colors.inkSoft }}>Shop code (staff type this to sign in)</div><div className="num" style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1 }}>{shopCode}</div></div>
                <Button small variant="secondary" icon={Copy} onClick={() => { shareText(shopCode); showToast("Shop code copied."); }}>Copy</Button>
              </div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {!inCloudMode ? <Button full icon={Cloud} onClick={openSwitch}>Switch this phone to Cloud mode</Button> : null}
              {inCloudMode ? <Button full variant="secondary" onClick={leave}>Leave Cloud mode (keep records on this phone)</Button> : null}
              {inCloudMode && SW.hasSnapshot(window.localStorage) ? <Button full variant="danger" onClick={restore}>Restore the backup taken before switching</Button> : null}
              {isAdmin ? <Button full variant="secondary" icon={UserPlus} onClick={() => setDialog("staff")}>Add staff login</Button> : null}
              {!inCloudMode ? <Button full variant="secondary" icon={LogOut} loading={busy} onClick={signOut}>Sign out of cloud</Button> : null}
            </div>
            {isAdmin && staff.length ? (
              <div style={{ marginTop: 14 }}>
                <List>
                  {staff.map((m) => (
                    <Row key={m.user_id} title={(m.profiles && m.profiles.display_name) || "—"}
                      sub={`${ROLE_LABEL[m.role]}${m.profiles && m.profiles.username ? " · " + m.profiles.username : ""}${m.active ? "" : " · disabled"}`}
                      onClick={m.role === "owner" ? undefined : () => setMember(m)}
                      value={m.role === "owner" ? "" : "Manage"} valueColor={colors.primary} />
                  ))}
                </List>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div style={{ ...styles.emptyNote, paddingTop: 0 }}>Optional. Connect this phone to your online shop account so owners can see sales from anywhere and staff get their own secure logins. Without it the app keeps working exactly as before.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              <Button full icon={Cloud} onClick={() => setDialog("signin")}>Sign in</Button>
              <Button full variant="secondary" onClick={() => setDialog("signup")}>Create a new shop account (owner)</Button>
            </div>
          </>
        )}
      </div>

      {dialog === "signin" && (
        <Modal title="Sign in to the cloud" onClose={() => setDialog(null)}>
          <div style={styles.stack}>
            <Field label="Username or e-mail" hint="Staff use their username. Owners use their e-mail."><input style={styles.input} autoCapitalize="none" autoCorrect="off" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} /></Field>
            {!f.id.includes("@") && <Field label="Shop code"><input style={styles.input} autoCapitalize="none" autoCorrect="off" value={f.shop} onChange={(e) => setF({ ...f, shop: e.target.value })} placeholder="given by your owner" /></Field>}
            <Field label="Password"><input style={styles.input} type="password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} /></Field>
            <div className="sheet-actions"><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy} disabled={!f.id || !f.pw} onClick={signIn}>Sign in</Button></div>
          </div>
        </Modal>
      )}
      {dialog === "signup" && (
        <Modal title="Create shop account" onClose={() => setDialog(null)}>
          <div style={styles.stack}>
            <Field label="Shop name"><input style={styles.input} value={f.shopName} onChange={(e) => setF({ ...f, shopName: e.target.value })} /></Field>
            <Field label="Shop code" hint="3-12 letters or numbers. Staff type this when they sign in."><input style={styles.input} autoCapitalize="none" autoCorrect="off" value={f.shop} onChange={(e) => setF({ ...f, shop: e.target.value })} /></Field>
            <Field label="Your name"><input style={styles.input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Your e-mail"><input style={styles.input} type="email" autoCapitalize="none" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Password" hint="At least 8 characters."><input style={styles.input} type="password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} /></Field>
            <div className="sheet-actions"><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy} disabled={!f.shopName || !f.shop || !f.email || !f.pw} onClick={signUp}>Create</Button></div>
          </div>
        </Modal>
      )}
      {imp && (
        <Modal title="Copy shop data to the cloud" onClose={() => setImp(null)}>
          {imp.result ? (
            <div style={styles.stack}>
              <Badge kind="ok">{imp.result.status === "already_imported" ? "Already copied earlier" : "Copied and verified"}</Badge>
              {imp.result.counts ? <div style={styles.emptyNote}>The cloud now holds {imp.result.counts.products} products, {imp.result.counts.sales} sales ({money(imp.result.counts.sales_total)}), {imp.result.counts.customers} customers. Every total matched this phone exactly. <strong>Nothing on this phone was changed or removed.</strong></div> : <div style={styles.emptyNote}>This backup was already copied. Nothing was added twice.</div>}
              <div className="sheet-actions"><Button onClick={() => setImp(null)}>Done</Button></div>
            </div>
          ) : (
            <div style={styles.stack}>
              <div style={styles.emptyNote}>This sends a copy of this phone's shop records to your cloud account. The phone's own data is not changed or deleted. If any total in the cloud differs from this phone, the whole copy is cancelled and nothing is saved.</div>
              <List>
                <Row title="Products" value={String(imp.payload.expected.products)} />
                <Row title="Sales" value={String(imp.payload.expected.sales)} valueSub={money(imp.payload.expected.sales_total)} />
                <Row title="Customers" value={String(imp.payload.expected.customers)} />
                <Row title="Credit still owed" value={money(imp.payload.expected.credit_outstanding)} />
                <Row title="Purchases / expenses" value={`${money(imp.payload.expected.purchases_total)} / ${money(imp.payload.expected.expenses_total)}`} />
              </List>
              <div style={styles.emptyNote}>Staff accounts are not copied (their old passwords are not kept). Create them above as cloud logins.</div>
              {imp.error ? <div style={{ color: colors.red, fontSize: 13.5 }}>{imp.error.includes("import_verification_failed") ? "Totals did not match, so nothing was copied. " : ""}{imp.error}</div> : null}
              <Button full variant="secondary" icon={Cloud} onClick={() => onBackup && onBackup().then(() => setImp((x) => ({ ...x, saved: true })))}>{imp.saved ? "Backup saved ✓" : "1. Save a backup first"}</Button>
              <div className="sheet-actions"><Button variant="secondary" onClick={() => setImp(null)}>Cancel</Button><Button loading={busy} disabled={!imp.saved} onClick={runImport}>2. Copy to cloud</Button></div>
            </div>
          )}
        </Modal>
      )}
      {sw && (
        <Modal title="Switch to Cloud mode" onClose={sw.step === "working" ? () => {} : () => { if (sw.step === "done") window.location.reload(); else setSw(null); }}>
          {sw.step === "intro" && (
            <div style={styles.stack}>
              <div style={styles.emptyNote}>Nothing changes until you have saved a backup and the totals have been checked. If anything looks wrong you can put everything back.</div>
              {isAdminRole(me) && (
                <Field label="Which branch is this phone for?"><select style={styles.input} value={sw.branchId} onChange={(e) => patch({ branchId: e.target.value })} onFocus={async () => { if (!branches.length) { try { setBranches(await cloud.list("branches", "id,name,code", (q) => q.is("archived_at", null).order("name"))); } catch (_) {} } }}><option value="">First branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
              )}
              {sw.error ? <div style={{ color: colors.red, fontSize: 13.5 }}>{sw.error}</div> : null}
              <Button full variant="secondary" icon={Cloud} onClick={doBackup}>{sw.backedUp ? "Backup created ✓" : "1. Save a backup"}</Button>
              {sw.backedUp ? (
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5, lineHeight: 1.45 }}>
                  <input type="checkbox" checked={!!sw.savedFile} onChange={(e) => patch({ savedFile: e.target.checked })} style={{ marginTop: 3 }} />
                  <span>I saved the backup file somewhere safe (Drive, WhatsApp, e-mail or Files). A second copy is also kept inside this app.</span>
                </label>
              ) : null}
              <div className="sheet-actions"><Button variant="secondary" onClick={() => setSw(null)}>Cancel</Button><Button disabled={!sw.backedUp || !sw.savedFile} onClick={doCompare}>2. Compare with cloud</Button></div>
            </div>
          )}
          {sw.step === "working" && <div style={styles.stack}><div style={styles.emptyNote}>{sw.progress}</div><div style={styles.emptyNote}>Please keep the app open.</div></div>}
          {sw.step === "compare" && (
            <div style={styles.stack}>
              {sw.limited ? (
                <div style={styles.emptyNote}>This login can only see its own branch in the cloud, so shop-wide totals cannot be compared here. If you continue, <strong>the records on this phone are replaced</strong> with the cloud copy. Your backup stays on the phone so you can put it back.</div>
              ) : (
                <>
                  {sw.copied ? <Badge kind="ok">Your records were copied to the cloud and verified</Badge> : null}
                  <List>
                    {sw.rows.map((r) => (
                      <Row key={r.key} title={r.label} sub={r.ok ? "Matches" : "Different"} value={r.ok ? "✓" : "✗"} valueColor={r.ok ? colors.green : colors.red}
                        valueSub={r.ok ? undefined : `phone ${r.money ? money(r.local) : r.local} · cloud ${r.money ? money(r.cloud) : r.cloud}`} />
                    ))}
                  </List>
                </>
              )}
              {!sw.match ? (
                <>
                  <div style={{ color: colors.amber, fontSize: 13.5 }}>{sw.limited ? "" : "The cloud already holds records that are not the same as this phone's. Nothing was copied. "}Switching will replace this phone's records with the cloud copy (the backup you just saved is kept). Type <strong>REPLACE</strong> to continue.</div>
                  <input style={styles.input} autoCapitalize="characters" value={sw.typed} onChange={(e) => patch({ typed: e.target.value })} placeholder="REPLACE" />
                </>
              ) : <div style={styles.emptyNote}>Everything matches. The phone's records will now be replaced by the cloud copy and checked again.</div>}
              <div className="sheet-actions"><Button variant="secondary" onClick={() => setSw(null)}>Cancel</Button><Button disabled={!sw.match && sw.typed.trim() !== "REPLACE"} onClick={doSwitch}>3. Switch to Cloud mode</Button></div>
            </div>
          )}
          {sw.step === "done" && (
            <div style={styles.stack}>
              <Badge kind="ok">This phone is now in Cloud mode</Badge>
              <List>{sw.rows.map((r) => <Row key={r.key} title={r.label} value={r.ok ? "✓" : "✗"} valueColor={r.ok ? colors.green : colors.red} />)}</List>
              <div style={styles.emptyNote}>The records were checked after the switch and match the cloud. Staff now sign in with their cloud logins.</div>
              <div className="sheet-actions"><Button onClick={() => window.location.reload()}>Open the app</Button></div>
            </div>
          )}
          {sw.step === "failed" && (
            <div style={styles.stack}>
              <div style={{ color: colors.red, fontSize: 14 }}>{sw.error}</div>
              <div style={styles.emptyNote}>{sw.restored ? "Your records were put back exactly as they were. This phone is still in Local mode." : "Could not put the records back automatically. Use “Restore the backup taken before switching”, or restore the backup file in Settings."}</div>
              <div className="sheet-actions"><Button onClick={() => window.location.reload()}>OK</Button></div>
            </div>
          )}
        </Modal>
      )}
      {member && (
        <Modal title={(member.profiles && member.profiles.display_name) || "Staff"} onClose={closeMember}>
          <div style={styles.stack}>
            <div style={{ fontSize: 13, color: colors.inkSoft }}>{ROLE_LABEL[member.role]}{member.profiles && member.profiles.username ? " · username " + member.profiles.username : ""}{shopCode ? " · shop code " + shopCode : ""}</div>
            {pw.done ? (
              <div style={{ background: colors.greenSoft, borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 600, color: colors.green }}>New password set</div>
                <div className="num" style={{ fontSize: 22, fontWeight: 700, margin: "6px 0" }}>{pw.done}</div>
                <div style={{ fontSize: 12.5, color: colors.inkSoft }}>Give it to them now. It is not stored anywhere you can look it up later, and they should keep it private.</div>
                <Button small variant="secondary" icon={Copy} style={{ marginTop: 8 }} onClick={() => { shareText(`Shop code: ${shopCode}\nUsername: ${(member.profiles || {}).username || ""}\nPassword: ${pw.done}`); }}>Share login details</Button>
              </div>
            ) : canReset(member) ? (
              <>
                <Field label="New password" hint="At least 8 characters. Passwords can never be viewed, only replaced."><input style={styles.input} autoCapitalize="none" autoCorrect="off" value={pw.value} onChange={(e) => setPw({ value: e.target.value, done: "" })} /></Field>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="secondary" onClick={genPw} style={{ flex: 1 }}>Make one for me</Button>
                  <Button icon={KeyRound} loading={busy} disabled={pw.value.length < 8} onClick={doReset} style={{ flex: 1 }}>Reset password</Button>
                </div>
              </>
            ) : null}
            <Button variant={member.active ? "danger" : "secondary"} onClick={async () => { await toggleActive(member); closeMember(); }}>{member.active ? "Disable this login" : "Enable this login"}</Button>
          </div>
        </Modal>
      )}
      {dialog === "staff" && (
        <Modal title="Add staff login" onClose={() => setDialog(null)}>
          <div style={styles.stack}>
            <Field label="Full name"><input style={styles.input} value={sf.name} onChange={(e) => setSf({ ...sf, name: e.target.value })} /></Field>
            <Field label="Username" hint={`They sign in with this and the shop code.`}><input style={styles.input} autoCapitalize="none" autoCorrect="off" value={sf.username} onChange={(e) => setSf({ ...sf, username: e.target.value })} /></Field>
            <Field label="Password" hint="At least 8 characters."><input style={styles.input} type="text" autoCapitalize="none" value={sf.password} onChange={(e) => setSf({ ...sf, password: e.target.value })} /></Field>
            <Field label="Role">
              <Segmented value={sf.role} onChange={(v) => setSf({ ...sf, role: v })} options={[["cashier", "Cashier"], ["manager", "Manager"], ...(me && me.role === "owner" ? [["admin", "Admin"]] : [])]} />
            </Field>
            {sf.role !== "admin" && (
              <Field label="Branch"><select style={styles.input} value={sf.branchId} onChange={(e) => setSf({ ...sf, branchId: e.target.value })}><option value="">Choose…</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
            )}
            <div className="sheet-actions"><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button loading={busy} disabled={!sf.username || !sf.name || sf.password.length < 8 || (sf.role !== "admin" && !sf.branchId)} onClick={addStaff}>Create login</Button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
