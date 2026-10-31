import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import { cloud } from "../src/cloud/api.js";
import { cloudConfigured } from "../src/cloud/config.js";
import { describeAuthError } from "../src/cloud/identity.js";
import { money } from "../src/theme.js";
import { localDateStr } from "../src/dates.js";
import * as C from "./calc.js";
import * as D from "./data.js";
import { css } from "./style.js";

const ROLE = { owner: "Owner", admin: "Admin", manager: "Manager", cashier: "Cashier" };
const NAV = [["overview", "Overview", "▦"], ["sales", "Sales", "🧾"], ["stock", "Stock", "📦"], ["credit", "Credit", "💳"], ["team", "Team", "👥"], ["activity", "Activity", "🔔"]];
const fmtDate = (s) => (s ? new Date(s).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

function Login({ onDone }) {
  const [f, setF] = useState({ id: "", shop: "", pw: "" }); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const go = async (e) => { e.preventDefault(); setBusy(true); setErr(""); try { onDone(await cloud.signIn(f.id, f.pw, f.shop)); } catch (x) { setErr(describeAuthError(x)); } finally { setBusy(false); } };
  return (
    <form className="login" onSubmit={go}>
      <div className="brand" style={{ justifyContent: "center", paddingBottom: 18 }}><div className="logo">I</div>Ilelah Business Suite</div>
      <div className="card">
        <h2 style={{ fontSize: 18 }}>Owner dashboard</h2>
        <label className="field"><span>E-mail or username</span><input className="inp" autoCapitalize="none" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} /></label>
        {!f.id.includes("@") && <label className="field"><span>Shop code</span><input className="inp" autoCapitalize="none" value={f.shop} onChange={(e) => setF({ ...f, shop: e.target.value })} /></label>}
        <label className="field"><span>Password</span><input className="inp" type="password" value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn p" style={{ width: "100%" }} disabled={busy || !f.id || !f.pw}>{busy ? "Signing in…" : "Sign in"}</button>
      </div>
    </form>
  );
}

function Tile({ l, v, s, color }) { return <div className="tile"><div className="l">{l}</div><div className="v" style={color ? { color } : null}>{v}</div>{s ? <div className="s">{s}</div> : null}</div>; }
function Empty({ t }) { return <div className="empty">{t}</div>; }

// single-series daily bars: thin, rounded data end, hover tooltip, table alternative lives in Sales tab
function DayBars({ days }) {
  const [tip, setTip] = useState(null); const W = 640, H = 170, pad = 24;
  const max = Math.max(1, ...days.map((d) => d.revenue)); const bw = Math.min(28, (W - pad) / days.length - 3);
  if (!days.length) return <Empty t="No days in this range." />;
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H + 22}`} width="100%" role="img" aria-label="Daily revenue">
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" />
        {days.map((d, i) => {
          const x = pad / 2 + i * ((W - pad) / days.length) + ((W - pad) / days.length - bw) / 2; const h = Math.max(d.revenue > 0 ? 3 : 0, (d.revenue / max) * (H - 14));
          return (<g key={d.date} onMouseEnter={() => setTip({ x: ((x + bw / 2) / W) * 100, y: ((H - h) / (H + 22)) * 100, d })} onMouseLeave={() => setTip(null)} onClick={() => setTip({ x: ((x + bw / 2) / W) * 100, y: ((H - h) / (H + 22)) * 100, d })}>
            <rect x={x - 3} y={0} width={bw + 6} height={H} fill="transparent" />
            <path d={`M${x},${H} V${H - h + 4} Q${x},${H - h} ${x + 4},${H - h} H${x + bw - 4} Q${x + bw},${H - h} ${x + bw},${H - h + 4} V${H} Z`} fill="var(--primary)" opacity={d.revenue ? 1 : 0.15} />
            {(days.length <= 10 || i % Math.ceil(days.length / 8) === 0) && <text x={x + bw / 2} y={H + 15} fontSize="11" textAnchor="middle" fill="var(--soft)">{d.date.slice(8)}/{d.date.slice(5, 7)}</text>}
          </g>);
        })}
      </svg>
      {tip && <div className="tip" style={{ left: tip.x + "%", top: tip.y + "%" }}>{tip.d.date} · {money(tip.d.revenue)} · {tip.d.count} sales</div>}
    </div>
  );
}
function Rank({ rows, label, value, sub }) {
  const max = Math.max(1, ...rows.map(value));
  if (!rows.length) return <Empty t="Nothing in this range." />;
  return rows.map((r, i) => (<div className="rank" key={r.id || i}><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(r)}</div><div className="bar"><i style={{ width: (value(r) / max) * 100 + "%" }} /></div><div className="num"><strong>{money(value(r))}</strong>{sub ? <div style={{ fontSize: 12, color: "var(--soft)" }}>{sub(r)}</div> : null}</div></div>));
}

function SaleModal({ sale, me, onClose, onChanged }) {
  const [items, setItems] = useState(null); const [reason, setReason] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false);
  useEffect(() => { D.loadSaleItems(sale.id).then(setItems).catch((e) => setErr(describeAuthError(e))); }, [sale.id]);
  const canVoid = (me.role === "owner" || me.role === "admin") && sale.status === "completed";
  const doVoid = async () => { setBusy(true); setErr(""); try { await cloud.voidSale(sale.id, reason); onChanged(); onClose(); } catch (e) { setErr(String(e.message || e)); } finally { setBusy(false); } };
  return (
    <div className="modal" onClick={onClose}><div className="sheet" onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>{sale.invoice_no}</h2><button className="btn" onClick={onClose}>Close</button></div>
      <div style={{ color: "var(--soft)", margin: "4px 0 12px" }}>{fmtDate(sale.sold_at)} · {sale.cashier_name} · {sale.payment_method}{sale.customer_name ? " · " + sale.customer_name : ""} {sale.status !== "completed" && <span className="badge red">{sale.status}</span>}</div>
      {!items ? <Empty t="Loading…" /> : <table className="tbl"><tbody>{items.map((i) => <tr key={i.id}><td>{i.name}</td><td className="num">{Number(i.qty)} × {money(i.unit_price)}</td><td className="num">{money(i.line_total)}</td></tr>)}
        <tr><td colSpan={2}><strong>Total</strong></td><td className="num"><strong>{money(sale.total)}</strong></td></tr>
        {Number(sale.balance_due) > 0 && <tr><td colSpan={2}>Still owed</td><td className="num">{money(sale.balance_due)}</td></tr>}
        {Number(sale.refunded_total) > 0 && <tr><td colSpan={2}>Refunded</td><td className="num">{money(sale.refunded_total)}</td></tr>}</tbody></table>}
      {err && <div className="err">{err}</div>}
      {canVoid && (!confirm ? <button className="btn d" style={{ marginTop: 12 }} onClick={() => setConfirm(true)}>Void this sale…</button> : (
        <div style={{ marginTop: 12 }}><label className="field"><span>Reason (required, saved in the activity log)</span><input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          <button className="btn d" disabled={busy || !reason.trim()} onClick={doVoid}>{busy ? "Voiding…" : "Void and return items to stock"}</button></div>))}
    </div></div>
  );
}

function TeamAdd({ branches, me, onClose, onDone }) {
  const [f, setF] = useState({ username: "", name: "", password: "", role: "cashier", branchId: branches[0]?.id || "" }); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(""); try { await cloud.createStaff({ username: f.username, password: f.password, name: f.name, role: f.role, branchId: f.role === "admin" ? null : f.branchId }); onDone(); onClose(); } catch (e) { setErr(String(e.message || e)); } finally { setBusy(false); } };
  return (<div className="modal" onClick={onClose}><div className="sheet" onClick={(e) => e.stopPropagation()}><h2 style={{ marginTop: 0 }}>Add staff login</h2>
    {["name", "username", "password"].map((k) => <label className="field" key={k}><span>{k[0].toUpperCase() + k.slice(1)}</span><input className="inp" type={k === "password" ? "text" : "text"} autoCapitalize="none" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
    <label className="field"><span>Role</span><select className="inp" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="cashier">Cashier</option><option value="manager">Manager</option>{me.role === "owner" && <option value="admin">Admin</option>}</select></label>
    {f.role !== "admin" && <label className="field"><span>Branch</span><select className="inp" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
    {err && <div className="err">{err}</div>}<div style={{ display: "flex", gap: 8 }}><button className="btn" onClick={onClose}>Cancel</button><button className="btn p" disabled={busy || !f.name || !f.username || f.password.length < 8} onClick={go}>Create login</button></div></div></div>);
}

function Dashboard({ me, onSignOut }) {
  const today = localDateStr();
  const [tab, setTab] = useState("overview"); const [preset, setPreset] = useState("7d");
  const [range, setRange] = useState(C.presetRange("7d", today)); const [branch, setBranch] = useState(""); const [cashier, setCashier] = useState("");
  const [data, setData] = useState(null); const [err, setErr] = useState(""); const [live, setLive] = useState(false); const [team, setTeam] = useState([]); const [audit, setAudit] = useState([]);
  const [open, setOpen] = useState(null); const [adding, setAdding] = useState(false); const [q, setQ] = useState(""); const [stockBranch, setStockBranch] = useState("");
  const isAdmin = me.role === "owner" || me.role === "admin"; const seq = useRef(0);

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    try { const d = await D.loadAll({ from: range[0], to: range[1], branch, cashier }); if (my === seq.current) { setData(d); setErr(""); } } catch (e) { if (my === seq.current) setErr(describeAuthError(e)); }
  }, [range, branch, cashier]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { let off; try { off = D.subscribeLive(refresh); setLive(true); } catch (_) { setLive(false); } return () => off && off(); }, [refresh]);
  const loadTeam = useCallback(() => { if (isAdmin) D.loadTeam().then(setTeam).catch(() => {}); }, [isAdmin]);
  useEffect(() => { loadTeam(); }, [loadTeam]);
  useEffect(() => { if (tab === "activity" && isAdmin) D.loadAudit().then(setAudit); }, [tab, isAdmin, data]);

  const pick = (p) => { setPreset(p); if (p !== "custom") setRange(C.presetRange(p, today)); };
  const sum = useMemo(() => data && C.summarize(data.sales, data.expenses, data.payments), [data]);
  const cashiers = useMemo(() => { const m = new Map(); (data?.sales || []).forEach((s) => m.set(s.cashier_id, s.cashier_name)); team.forEach((t) => m.set(t.user_id, t.profiles?.display_name || "")); return [...m.entries()].filter(([, n]) => n); }, [data, team]);
  const branchName = (id) => (data?.branches.find((b) => b.id === id) || {}).name || "—";
  const days = useMemo(() => data ? C.byDay(data.sales, range[0], range[1]) : [], [data, range]);
  const exportCsv = () => { const rows = data.sales.map((s) => ({ ...s, branch: branchName(s.branch_id) })); const blob = new Blob([D.toCsv(rows, [["invoice_no", "Invoice"], ["business_date", "Date"], ["branch", "Branch"], ["cashier_name", "Cashier"], ["customer_name", "Customer"], ["payment_method", "Payment"], ["total", "Total"], ["amount_paid", "Paid"], ["balance_due", "Owed"], ["status", "Status"]])], { type: "text/csv" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `sales-${range[0]}-to-${range[1]}.csv`; a.click(); };
  if (!["owner", "admin", "manager"].includes(me.role)) return <div className="login"><div className="card"><h2>Not available</h2><p style={{ color: "var(--soft)" }}>The dashboard is for owners, admins and managers. Cashiers use the phone app.</p><button className="btn" onClick={onSignOut}>Sign out</button></div></div>;

  const filters = (
    <div className="filters">
      {[["today", "Today"], ["yesterday", "Yesterday"], ["7d", "7 days"], ["30d", "30 days"], ["month", "This month"]].map(([k, l]) => <button key={k} className={"chip" + (preset === k ? " on" : "")} onClick={() => pick(k)}>{l}</button>)}
      <input className="inp" type="date" value={range[0]} max={range[1]} onChange={(e) => { setPreset("custom"); e.target.value && setRange([e.target.value, range[1]]); }} aria-label="From" />
      <input className="inp" type="date" value={range[1]} min={range[0]} max={today} onChange={(e) => { setPreset("custom"); e.target.value && setRange([range[0], e.target.value]); }} aria-label="To" />
      <select className="inp" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch"><option value="">All branches</option>{data?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
      <select className="inp" value={cashier} onChange={(e) => setCashier(e.target.value)} aria-label="Salesman"><option value="">All salesmen</option>{cashiers.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
    </div>
  );
  const filtered = data ? data.sales.filter((s) => !q || (s.invoice_no + s.customer_name + s.cashier_name).toLowerCase().includes(q.toLowerCase())) : [];
  const stock = data ? C.stockRows(data.products, data.levels, stockBranch) : [];
  const pending = data ? data.discrepancies.length : 0;

  return (
    <div className="shell">
      <aside className="side"><div className="brand"><div className="logo">I</div><div>{me.shop_name}<div style={{ fontWeight: 400, fontSize: 12, color: "var(--soft)" }}>{ROLE[me.role]} · {me.display_name}</div></div></div>
        {NAV.filter(([k]) => isAdmin || !["team", "activity"].includes(k)).map(([k, l, ic]) => <button key={k} className={"nav" + (tab === k ? " on" : "")} onClick={() => setTab(k)}><span>{ic}</span>{l}{k === "stock" && pending ? <span className="badge red" style={{ marginLeft: "auto" }}>{pending}</span> : null}</button>)}
        <div style={{ flex: 1 }} /><button className="nav" onClick={onSignOut}>↪ Sign out</button></aside>
      <main className="main">
        <div className="top"><h1>{NAV.find((n) => n[0] === tab)[1]}</h1><span className="live"><span className={"dot" + (live ? "" : " off")} />{live ? "Live" : "Offline"} · <button className="btn" style={{ padding: "4px 10px" }} onClick={refresh}>Refresh</button></span></div>
        {err && <div className="err">{err}</div>}
        {(tab === "overview" || tab === "sales" || tab === "credit") && filters}
        {!data ? <Empty t="Loading…" /> : (<>
          {tab === "overview" && (<>
            <div className="grid"><Tile l="Sales" v={money(sum.revenue)} s={`${sum.count} sales${sum.voided ? ` · ${sum.voided} voided` : ""}`} /><Tile l="Gross profit" v={money(sum.gross)} s={`cost ${money(sum.cost)}`} /><Tile l="Expenses" v={money(sum.expenses)} /><Tile l="Net profit" v={money(sum.net)} color={sum.net < 0 ? "var(--red)" : null} /><Tile l="Credit given" v={money(sum.creditIssued)} s={`repaid ${money(sum.repayments)}`} /></div>
            <div className="card"><h2>Sales per day</h2><DayBars days={days} /></div>
            <div className="two"><div className="card"><h2>By salesman</h2><Rank rows={C.byCashier(data.sales)} label={(r) => r.name} value={(r) => r.revenue} sub={(r) => `${r.count} sales`} /></div>
              <div className="card"><h2>By branch</h2><Rank rows={C.byBranch(data.sales, data.branches)} label={(r) => r.name} value={(r) => r.revenue} sub={(r) => `profit ${money(r.profit)}`} /></div></div>
            <div className="two"><div className="card"><h2>Best-selling items</h2><Rank rows={C.topProducts(data.productSales, data.products).slice(0, 8)} label={(r) => r.name} value={(r) => r.revenue} sub={(r) => `${r.qty} sold`} />{cashier && <div className="s" style={{ color: "var(--soft)", fontSize: 12, marginTop: 6 }}>Items are not split by salesman.</div>}</div>
              <div className="card"><h2>How customers paid</h2><Rank rows={C.byPayment(data.sales).map((r) => ({ ...r, id: r.method }))} label={(r) => r.method} value={(r) => r.revenue} sub={(r) => `${r.count} sales`} /></div></div>
            {pending > 0 && <div className="card"><span className="badge red">Attention</span> {pending} sale(s) sold more than the recorded stock. Check the Stock tab.</div>}
          </>)}
          {tab === "sales" && (<div className="card">
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}><input className="inp" style={{ flex: 1, minWidth: 160 }} placeholder="Search invoice, customer, salesman" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn" onClick={exportCsv}>Download CSV</button></div>
            {!filtered.length ? <Empty t="No sales in this range." /> : <div className="scroll"><table className="tbl"><thead><tr><th>Invoice</th><th>When</th><th className="hm">Branch</th><th className="hm">Salesman</th><th>Payment</th><th className="num">Total</th><th>Status</th></tr></thead><tbody>
              {filtered.slice(0, 300).map((s) => <tr className="click" key={s.id} onClick={() => setOpen(s)}><td style={{ whiteSpace: "nowrap" }}>{s.invoice_no}<div className="sub">{s.cashier_name} · {branchName(s.branch_id)}</div></td><td style={{ whiteSpace: "nowrap" }}>{fmtDate(s.sold_at)}</td><td className="hm">{branchName(s.branch_id)}</td><td className="hm">{s.cashier_name}</td><td>{s.payment_method}{Number(s.balance_due) > 0 ? <span className="badge amber" style={{ marginLeft: 6 }}>owes {money(s.balance_due)}</span> : null}</td><td className="num">{money(s.total)}</td><td><span className={"badge" + (s.status === "completed" ? "" : " red")}>{s.status}</span></td></tr>)}</tbody></table></div>}
            {filtered.length > 300 && <div className="empty">Showing the latest 300 of {filtered.length}. Narrow the dates or download the CSV.</div>}</div>)}
          {tab === "stock" && (<>
            <div className="grid"><Tile l="Stock at cost" v={money(stock.reduce((a, r) => a + Math.max(0, r.value), 0))} /><Tile l="Stock at selling price" v={money(stock.reduce((a, r) => a + Math.max(0, r.retail), 0))} /><Tile l="Low or out" v={String(stock.filter((r) => r.low || r.out).length)} /></div>
            {pending > 0 && <div className="card"><h2>Oversold items to check</h2><table className="tbl"><tbody>{data.discrepancies.map((d) => <tr key={d.id}><td>{(data.products.find((p) => p.id === d.product_id) || {}).name || "Item"}</td><td>{branchName(d.branch_id)}</td><td className="num">short by {Number(d.shortfall)}</td><td>{fmtDate(d.created_at)}</td>{isAdmin && <td><button className="btn" onClick={() => D.resolveDiscrepancy(d.id, me.user_id).then(refresh)}>Mark checked</button></td>}</tr>)}</tbody></table></div>}
            <div className="card"><div style={{ marginBottom: 10 }}><select className="inp" value={stockBranch} onChange={(e) => setStockBranch(e.target.value)}><option value="">All branches</option>{data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
              <div className="scroll"><table className="tbl"><thead><tr><th>Item</th><th>Code</th><th className="num">In stock</th><th className="num">Value (cost)</th><th /></tr></thead><tbody>{stock.map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.sku}</td><td className="num">{r.qty}</td><td className="num">{money(r.value)}</td><td>{r.out ? <span className="badge red">Out</span> : r.low ? <span className="badge amber">Low</span> : null}</td></tr>)}</tbody></table></div></div></>)}
          {tab === "credit" && (<>
            <div className="grid"><Tile l="Owed by customers (all time)" v={money(data.balances.reduce((a, b) => a + Math.max(0, Number(b.balance)), 0))} /><Tile l="Repayments in range" v={money(sum.repayments)} s={`${data.payments.length} payments`} /><Tile l="Credit given in range" v={money(sum.creditIssued)} /></div>
            <div className="two"><div className="card"><h2>Who owes</h2>{!data.balances.filter((b) => Number(b.balance) > 0).length ? <Empty t="No one owes anything." /> : <table className="tbl"><tbody>{data.balances.filter((b) => Number(b.balance) > 0).map((b) => <tr key={b.customer_id}><td>{b.name}<div style={{ fontSize: 12, color: "var(--soft)" }}>{b.phone}</div></td><td>{b.last_credit_date ? "last credit " + b.last_credit_date : ""}</td><td className="num"><strong>{money(b.balance)}</strong></td></tr>)}</tbody></table>}</div>
              <div className="card"><h2>Repayments</h2>{!data.payments.length ? <Empty t="None in this range." /> : <table className="tbl"><tbody>{data.payments.slice(0, 50).map((p) => <tr key={p.id}><td>{p.business_date}</td><td>{(data.balances.find((b) => b.customer_id === p.customer_id) || {}).name || "Customer"}</td><td>{p.received_by_name}</td><td className="num">{money(p.amount)}</td></tr>)}</tbody></table>}</div></div></>)}
          {tab === "team" && isAdmin && (<div className="card"><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><h2>People with access</h2><button className="btn p" onClick={() => setAdding(true)}>Add staff login</button></div>
            <table className="tbl"><tbody>{team.map((m) => <tr key={m.user_id}><td>{m.profiles?.display_name}<div style={{ fontSize: 12, color: "var(--soft)" }}>{m.profiles?.username}</div></td><td>{ROLE[m.role]}</td><td>{branchName(m.branch_id)}</td><td>{m.active ? <span className="badge">Active</span> : <span className="badge gray">Disabled</span>}</td><td>{m.role !== "owner" && m.user_id !== me.user_id && (me.role === "owner" || m.role !== "admin") && <button className="btn" onClick={() => cloud.setMember(m.user_id, m.role, m.branch_id, !m.active, "From dashboard").then(loadTeam).catch((e) => setErr(String(e.message)))}>{m.active ? "Disable" : "Enable"}</button>}</td></tr>)}</tbody></table></div>)}
          {tab === "activity" && isAdmin && (<div className="card"><h2>Recent activity</h2>{!audit.length ? <Empty t="Nothing yet." /> : <div className="scroll"><table className="tbl"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Reason</th></tr></thead><tbody>{audit.map((a) => <tr key={a.id}><td>{fmtDate(a.created_at)}</td><td>{a.actor_name}</td><td>{a.action.replace(/[._]/g, " ")}</td><td>{a.reason}</td></tr>)}</tbody></table></div>}</div>)}
        </>)}
      </main>
      <nav className="tabs">{NAV.filter(([k]) => isAdmin || !["team", "activity"].includes(k)).map(([k, l, ic]) => <button key={k} className={"nav" + (tab === k ? " on" : "")} onClick={() => setTab(k)}><span>{ic}</span>{l}</button>)}</nav>
      {open && <SaleModal sale={open} me={me} onClose={() => setOpen(null)} onChanged={refresh} />}
      {adding && data && <TeamAdd branches={data.branches.filter((b) => !b.archived_at)} me={me} onClose={() => setAdding(false)} onDone={loadTeam} />}
    </div>
  );
}

function Root() {
  const [me, setMe] = useState(undefined);
  useEffect(() => { (async () => { try { setMe((await cloud.session()) ? await cloud.whoami() : null); } catch (_) { setMe(null); } })(); }, []);
  if (!cloudConfigured()) return <div className="login"><div className="card"><h2>Not configured</h2><p>Add your project details to cloud.config.json and rebuild the dashboard.</p></div></div>;
  if (me === undefined) return <div className="empty" style={{ paddingTop: 80 }}>Loading…</div>;
  if (!me) return <Login onDone={setMe} />;
  return <Dashboard me={me} onSignOut={async () => { await cloud.signOut(); setMe(null); }} />;
}
const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
createRoot(document.getElementById("root")).render(<Root />);
