import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./native.js";
import { saveAndShare, shareText } from "./native.js";
import { startScanner, feedback } from "./scanner.js";
import { TEMPLATE_CSV, readFileToRows, buildPlan, applyPlan, inventoryToCsv, parseDelimited } from "./bulk.js";
import { LICENSE_CONFIG } from "./license-config.js";
import { getDeviceId, checkStoredLicense, activate, describeExpiry } from "./license.js";





const CURRENCY = "₦";
const uid = () => Math.random().toString(36).slice(2, 10);
const money = (n) => CURRENCY + (Number(n) || 0).toFixed(2);
const todayStr = () => new Date().toISOString().slice(0, 10);

// ---------- local storage layer ----------
// Everything lives in this browser's localStorage. There is no server and
// no internet dependency for the app's data — it works fully offline once
// the page itself has loaded. See the Settings tab for backup/restore,
// since clearing browser data would otherwise lose everything.
function loadLS(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}
function saveLS(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("Could not save " + key, e);
  }
}
function nextSeq(name) {
  const key = "tally:seq:" + name;
  const n = (loadLS(key, 0) || 0) + 1;
  saveLS(key, n);
  return n;
}

const EXPENSE_CATEGORIES = ["Rent", "Utilities", "Wages", "Maintenance", "Supplies", "Other"];

const DEFAULT_SETTINGS = {
  shopName: "My Supermarket",
  tagline: "Wholesale and Retail of General Provision",
  address: "",
  phone: "",
};

function seedIfEmpty() {
  let branches = loadLS("tally:branches", null);
  if (!branches || branches.length === 0) {
    branches = [{ id: "br-" + uid(), name: "Main Branch", address: "", phone: "" }];
    saveLS("tally:branches", branches);
  }
  let users = loadLS("tally:users", null);
  if (!users || users.length === 0) {
    users = [{ id: "u-" + uid(), username: "admin", password: "admin123", name: "Owner", role: "admin", branchId: branches[0].id }];
    saveLS("tally:users", users);
  }
  if (loadLS("tally:settings", null) === null) saveLS("tally:settings", DEFAULT_SETTINGS);
  if (loadLS("tally:products", null) === null) saveLS("tally:products", []);
  if (loadLS("tally:sales", null) === null) saveLS("tally:sales", []);
  if (loadLS("tally:purchases", null) === null) saveLS("tally:purchases", []);
  if (loadLS("tally:expenses", null) === null) saveLS("tally:expenses", []);
  if (loadLS("tally:customers", null) === null) saveLS("tally:customers", []);
  if (loadLS("tally:creditPayments", null) === null) saveLS("tally:creditPayments", []);
}

function getStock(product, branchId) {
  return Number((product.stock || {})[branchId] || 0);
}
function totalStock(product) {
  return Object.values(product.stock || {}).reduce((a, n) => a + (Number(n) || 0), 0);
}

// ---------- icon shims (standalone build has no lucide-react) ----------
function makeIcon(glyph) {
  return function Icon({ size = 16, color = "currentColor", style, ...rest }) {
    return <span style={{ fontSize: size, color, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", ...style }} {...rest}>{glyph}</span>;
  };
}
const Search = makeIcon("🔍");
const Plus = makeIcon("➕");
const Trash2 = makeIcon("🗑");
const Pencil = makeIcon("✏️");
const X = makeIcon("✕");
const ShoppingCart = makeIcon("🛒");
const Package = makeIcon("📦");
const Truck = makeIcon("🚚");
const LayoutGrid = makeIcon("▦");
const AlertTriangle = makeIcon("⚠️");
const Check = makeIcon("✔");
const ScanLine = makeIcon("📶");
const Receipt = makeIcon("🧾");
const Users = makeIcon("👥");
const LogOut = makeIcon("⏻");
const Lock = makeIcon("🔒");
const UserIcon = makeIcon("👤");
const SettingsIcon = makeIcon("⚙️");
const CreditIcon = makeIcon("💳");
const BranchIcon = makeIcon("🏬");
const DownloadIcon = makeIcon("⬇️");
const UploadIcon = makeIcon("⬆️");
const CameraIcon = makeIcon("📷");

// ---------- dependency-free sparkline chart (standalone build has no recharts) ----------
function Sparkline({ data }) {
  const w = 600, h = 200, padL = 40, padR = 12, padT = 10, padB = 24;
  const values = data.map((d) => d.profit);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values, 1);
  const xStep = (w - padL - padR) / Math.max(1, data.length - 1);
  const yFor = (v) => padT + (1 - (v - min) / (max - min || 1)) * (h - padT - padB);
  const xFor = (i) => padL + i * xStep;
  const points = data.map((d, i) => `${xFor(i)},${yFor(d.profit)}`).join(" ");
  const zeroY = yFor(0);
  const [hover, setHover] = useState(null);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "100%" }}>
      <line x1={padL} y1={zeroY} x2={w - padR} y2={zeroY} stroke="#E4E1D8" strokeWidth={1} />
      <line x1={padL} y1={padT} x2={padL} y2={h - padB} stroke="#E4E1D8" strokeWidth={1} />
      <polyline points={points} fill="none" stroke={colors.teal} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <circle
          key={i}
          cx={xFor(i)}
          cy={yFor(d.profit)}
          r={hover === i ? 5 : 3}
          fill={colors.teal}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
        />
      ))}
      {data.map((d, i) => (
        i % 2 === 0 && (
          <text key={i} x={xFor(i)} y={h - 6} fontSize={9} fill={colors.inkSoft} textAnchor="middle" fontFamily="Inter, sans-serif">{d.label}</text>
        )
      ))}
      {hover !== null && (
        <g>
          <rect x={Math.min(Math.max(xFor(hover) - 45, 0), w - 90)} y={yFor(data[hover].profit) - 34} width={90} height={22} rx={5} fill={colors.ink} />
          <text x={Math.min(Math.max(xFor(hover) - 45, 0), w - 90) + 45} y={yFor(data[hover].profit) - 19} fontSize={11} fill="#fff" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace">{money(data[hover].profit)}</text>
        </g>
      )}
    </svg>
  );
}

// ---------- app ----------
function App({ license }) {
  useEffect(() => { seedIfEmpty(); }, []);
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    seedIfEmpty();
    setBooted(true);
  }, []);

  const [tab, setTab] = useState("dashboard");
  const [products, setProductsRaw] = useState(() => loadLS("tally:products", []));
  const [sales, setSalesRaw] = useState(() => loadLS("tally:sales", []));
  const [purchases, setPurchasesRaw] = useState(() => loadLS("tally:purchases", []));
  const [expenses, setExpensesRaw] = useState(() => loadLS("tally:expenses", []));
  const [customers, setCustomersRaw] = useState(() => loadLS("tally:customers", []));
  const [creditPayments, setCreditPaymentsRaw] = useState(() => loadLS("tally:creditPayments", []));
  const [users, setUsersRaw] = useState(() => loadLS("tally:users", []));
  const [branches, setBranchesRaw] = useState(() => loadLS("tally:branches", []));
  const [settings, setSettingsRaw] = useState(() => loadLS("tally:settings", DEFAULT_SETTINGS));
  const [currentUserId, setCurrentUserId] = useState(() => loadLS("tally:sessionUserId", null));
  const [workingBranchId, setWorkingBranchIdRaw] = useState(() => loadLS("tally:workingBranchId", null));
  const [toast, setToast] = useState(null);
  const [loginError, setLoginError] = useState("");

  const mk = (key, setter) => (updater) => setter((prev) => {
    const next = typeof updater === "function" ? updater(prev) : updater;
    saveLS(key, next);
    return next;
  });
  const setProducts = mk("tally:products", setProductsRaw);
  const setSales = mk("tally:sales", setSalesRaw);
  const setPurchases = mk("tally:purchases", setPurchasesRaw);
  const setExpenses = mk("tally:expenses", setExpensesRaw);
  const setCustomers = mk("tally:customers", setCustomersRaw);
  const setCreditPayments = mk("tally:creditPayments", setCreditPaymentsRaw);
  const setUsers = mk("tally:users", setUsersRaw);
  const setBranches = mk("tally:branches", setBranchesRaw);
  const setSettings = mk("tally:settings", setSettingsRaw);

  const showToast = useCallback((msg, kind = "ok") => {
    setToast({ msg, kind, id: uid() });
    setTimeout(() => setToast(null), 2200);
  }, []);

  const currentUser = useMemo(() => users.find((u) => u.id === currentUserId) || null, [users, currentUserId]);

  // keep a valid working branch selected at all times
  useEffect(() => {
    if (branches.length === 0) return;
    if (!workingBranchId || !branches.some((b) => b.id === workingBranchId)) {
      const fallback = (currentUser && branches.some((b) => b.id === currentUser.branchId)) ? currentUser.branchId : branches[0].id;
      setWorkingBranchIdRaw(fallback);
      saveLS("tally:workingBranchId", fallback);
    }
  }, [branches, workingBranchId, currentUser]);

  const setWorkingBranchId = (id) => {
    setWorkingBranchIdRaw(id);
    saveLS("tally:workingBranchId", id);
  };

  const login = (usernameInput, password) => {
    const u = users.find((x) => x.username.toLowerCase() === usernameInput.trim().toLowerCase());
    if (!u || u.password !== password) {
      setLoginError("Incorrect username or password.");
      return;
    }
    setLoginError("");
    setCurrentUserId(u.id);
    saveLS("tally:sessionUserId", u.id);
    if (u.role !== "admin" && u.branchId) setWorkingBranchId(u.branchId);
  };
  const logout = () => {
    setCurrentUserId(null);
    saveLS("tally:sessionUserId", null);
  };

  if (!booted) {
    return (
      <div style={styles.app}>
        <style>{globalCss}</style>
        <div style={styles.loading}>Loading Tally…</div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div style={styles.app}>
        <style>{globalCss}</style>
        <LoginScreen onLogin={login} errorMessage={loginError} license={license} />
      </div>
    );
  }

  const isAdmin = currentUser.role === "admin";
  const activeBranchId = isAdmin ? workingBranchId : currentUser.branchId;
  const multiBranch = branches.length > 1;
  const lowStockCount = products.filter((p) => getStock(p, activeBranchId) <= p.lowStock).length;

  const onResetTransactions = () => {
    setSales([]);
    setPurchases([]);
    setExpenses([]);
    setCreditPayments([]);
  };
  const onResetEverything = () => {
    setProducts([]);
    setSales([]);
    setPurchases([]);
    setExpenses([]);
    setCustomers([]);
    setCreditPayments([]);
  };

  return (
    <div style={styles.app}>
      <style>{globalCss}</style>
      <TopBar
        tab={tab} setTab={setTab} lowStockCount={lowStockCount} currentUser={currentUser} onLogout={logout} isAdmin={isAdmin}
        branches={branches} workingBranchId={workingBranchId} setWorkingBranchId={setWorkingBranchId} multiBranch={multiBranch}
      />
      <main style={styles.main}>
        {tab === "dashboard" && isAdmin && (
          <AdminDashboard products={products} sales={sales} purchases={purchases} expenses={expenses} customers={customers} creditPayments={creditPayments} branches={branches} multiBranch={multiBranch} />
        )}
        {tab === "dashboard" && !isAdmin && (
          <StaffDashboard products={products} sales={sales} currentUser={currentUser} activeBranchId={activeBranchId} />
        )}
        {tab === "inventory" && (
          <Inventory products={products} setProducts={setProducts} showToast={showToast} readOnly={!isAdmin} activeBranchId={activeBranchId} branches={branches} multiBranch={multiBranch} />
        )}
        {tab === "checkout" && (
          <Checkout
            products={products} setProducts={setProducts} sales={sales} setSales={setSales}
            customers={customers} setCustomers={setCustomers}
            showToast={showToast} currentUser={currentUser} settings={settings}
            activeBranchId={activeBranchId} branches={branches}
          />
        )}
        {tab === "purchases" && isAdmin && (
          <Purchases products={products} setProducts={setProducts} purchases={purchases} setPurchases={setPurchases} showToast={showToast} activeBranchId={activeBranchId} />
        )}
        {tab === "expenses" && isAdmin && (
          <Expenses expenses={expenses} setExpenses={setExpenses} showToast={showToast} activeBranchId={activeBranchId} branches={branches} multiBranch={multiBranch} />
        )}
        {tab === "credit" && (
          <CreditBook
            customers={customers} setCustomers={setCustomers} sales={sales} creditPayments={creditPayments} setCreditPayments={setCreditPayments}
            showToast={showToast} currentUser={currentUser} settings={settings} branches={branches} activeBranchId={activeBranchId}
          />
        )}
        {tab === "reports" && isAdmin && (
          <Reports sales={sales} branches={branches} multiBranch={multiBranch} />
        )}
        {tab === "team" && isAdmin && (
          <Team users={users} setUsers={setUsers} currentUser={currentUser} showToast={showToast} branches={branches} multiBranch={multiBranch} />
        )}
        {tab === "settings" && isAdmin && (
          <ShopSettings
            settings={settings} setSettings={setSettings} showToast={showToast}
            branches={branches} setBranches={setBranches}
            onResetTransactions={onResetTransactions} onResetEverything={onResetEverything}
            fullState={{ products, sales, purchases, expenses, customers, creditPayments, users, branches, settings }}
            restoreAll={(data) => {
              if (data.products) setProducts(data.products);
              if (data.sales) setSales(data.sales);
              if (data.purchases) setPurchases(data.purchases);
              if (data.expenses) setExpenses(data.expenses);
              if (data.customers) setCustomers(data.customers);
              if (data.creditPayments) setCreditPayments(data.creditPayments);
              if (data.users) setUsers(data.users);
              if (data.branches) setBranches(data.branches);
              if (data.settings) setSettings(data.settings);
            }}
          />
        )}
      </main>
      {toast && (
        <div style={{ ...styles.toast, ...(toast.kind === "err" ? styles.toastErr : {}) }}>
          {toast.kind === "err" ? <AlertTriangle size={16} /> : <Check size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}


// ---------- activation (license) ----------
function ActivationScreen({ reason, onActivated }) {
  const deviceId = useMemo(() => getDeviceId(), []);
  const [code, setCode] = useState("");
  const [err, setErr] = useState(reason === "expired" ? "Your license has expired. Send your Device ID to get a new code." : "");
  const [copied, setCopied] = useState(false);
  const contact = LICENSE_CONFIG.contact;

  const submit = () => {
    if (!code.trim()) return;
    const r = activate(LICENSE_CONFIG.publicKey, code);
    if (r.ok) { onActivated(r); return; }
    setErr(r.reason === "expired"
      ? "That code has already expired."
      : "That code isn't valid for this phone. Make sure you copied the whole code, and that it was made for the Device ID shown above.");
  };
  const copyId = async () => {
    try { await navigator.clipboard.writeText(deviceId); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {}
  };
  const sendId = () => shareText(`My ${LICENSE_CONFIG.productName} Device ID: ${deviceId}`);

  return (
    <div style={styles.app}>
      <style>{globalCss}</style>
      <div style={styles.loginWrap}>
        <div style={styles.loginCard}>
          <div style={styles.loginBrandRow}>
            <div style={styles.brandMark}>T</div>
            <div>
              <div style={styles.brandName}>{LICENSE_CONFIG.productName}</div>
              <div style={styles.brandSub}>Activation</div>
            </div>
          </div>
          <div style={styles.loginHeading}>Activate this app</div>
          <div style={styles.stack}>
            <div style={{ fontSize: 13, color: colors.inkSoft, lineHeight: 1.5 }}>
              Send this Device ID to the seller to receive your activation code.
            </div>
            <div style={{ background: "#F7F6F1", border: `1px solid ${colors.line}`, borderRadius: 9, padding: "12px 14px", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Device ID</div>
              <div style={{ ...styles.mono, fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>{deviceId}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={{ ...styles.ghostBtn, flex: 1 }} onClick={copyId}>{copied ? "Copied" : "Copy"}</button>
              <button type="button" style={{ ...styles.ghostBtn, flex: 1 }} onClick={sendId}>Send ID…</button>
            </div>
            <Field label="Activation code">
              <textarea
                style={{ ...styles.input, ...styles.mono, fontSize: 12, minHeight: 96, resize: "vertical" }}
                value={code} onChange={(e) => { setCode(e.target.value); setErr(""); }}
                placeholder="Paste your code here" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              />
            </Field>
            {err && <div style={styles.loginError}>{err}</div>}
            <button type="button" style={styles.checkoutBtn} onClick={submit}>Activate</button>
          </div>
          {contact && <div style={styles.loginHint}>Need a code? {contact}</div>}
        </div>
      </div>
    </div>
  );
}

function Root() {
  const [lic, setLic] = useState(() => checkStoredLicense(LICENSE_CONFIG.publicKey));
  if (!lic.ok) return <ActivationScreen reason={lic.reason} onActivated={setLic} />;
  return <App license={lic} />;
}

// ---------- login ----------
function LoginScreen({ onLogin, errorMessage, license }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (!username.trim() || !password) return;
    setBusy(true);
    onLogin(username, password);
    setBusy(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div style={styles.loginWrap}>
      <div style={styles.loginCard}>
        <div style={styles.loginBrandRow}>
          <div style={styles.brandMark}>T</div>
          <div>
            <div style={styles.brandName}>Tally</div>
            <div style={styles.brandSub}>Shop ledger</div>
          </div>
        </div>
        <div style={styles.loginHeading}>Sign in to the till</div>
        <div style={styles.stack}>
          <Field label="Username">
            <div style={styles.inputIconRow}>
              <UserIcon size={15} color={colors.inkSoft} />
              <input style={styles.inputBare} value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={handleKey} autoFocus placeholder="e.g. admin" />
            </div>
          </Field>
          <Field label="Password">
            <div style={styles.inputIconRow}>
              <Lock size={15} color={colors.inkSoft} />
              <input style={styles.inputBare} type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={handleKey} placeholder="••••••••" />
            </div>
          </Field>
          {errorMessage && <div style={styles.loginError}>{errorMessage}</div>}
          <button type="button" style={styles.checkoutBtn} onClick={submit} disabled={busy}>Sign in</button>
        </div>
        <div style={styles.loginHint}>
          First time here? Use <b>admin</b> / <b>admin123</b>, then change it under Team.<br />
          Accounts are created by the shop owner under Team.
        </div>
        {license && license.ok && (
          <div style={styles.loginHint}>Licensed{license.name ? ` to ${license.name}` : ""} · {describeExpiry(license.expiryDay)}</div>
        )}
      </div>
    </div>
  );
}

// ---------- top bar ----------
function TopBar({ tab, setTab, lowStockCount, currentUser, onLogout, isAdmin, branches, workingBranchId, setWorkingBranchId, multiBranch }) {
  const items = isAdmin
    ? [
        { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
        { id: "inventory", label: "Inventory", icon: Package, badge: lowStockCount },
        { id: "checkout", label: "Checkout", icon: ShoppingCart },
        { id: "purchases", label: "Purchases", icon: Truck },
        { id: "expenses", label: "Expenses", icon: Receipt },
        { id: "credit", label: "Credit", icon: CreditIcon },
        { id: "reports", label: "Reports", icon: Search },
        { id: "team", label: "Team", icon: Users },
        { id: "settings", label: "Settings", icon: SettingsIcon },
      ]
    : [
        { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
        { id: "checkout", label: "Checkout", icon: ShoppingCart },
        { id: "credit", label: "Credit", icon: CreditIcon },
        { id: "inventory", label: "Stock levels", icon: Package, badge: lowStockCount },
      ];
  return (
    <header className="tb" style={styles.topbar}>
      <div style={styles.brand}>
        <div style={styles.brandMark}>T</div>
        <div>
          <div style={styles.brandName}>Tally</div>
          <div style={styles.brandSub}>Shop ledger</div>
        </div>
      </div>
      <nav className="tb-nav" style={styles.nav}>
        {items.map((it) => {
          const Icon = it.icon;
          const active = tab === it.id;
          return (
            <button key={it.id} onClick={() => setTab(it.id)} style={{ ...styles.navBtn, ...(active ? styles.navBtnActive : {}) }}>
              <Icon size={16} />
              {it.label}
              {!!it.badge && <span style={styles.navBadge}>{it.badge}</span>}
            </button>
          );
        })}
      </nav>
      <div className="tb-user" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {isAdmin && multiBranch && (
          <div style={styles.branchSwitch} title="Branch you are currently working from">
            <BranchIcon size={13} color={colors.teal} />
            <select style={styles.branchSelect} value={workingBranchId || ""} onChange={(e) => setWorkingBranchId(e.target.value)}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div style={styles.userChip}>
          <div style={styles.userChipInfo}>
            <div style={styles.userChipName}>{currentUser.name}</div>
            <div style={styles.userChipRole}>
              {currentUser.role === "admin" ? "Owner / Admin" : "Staff"}
              {!isAdmin && multiBranch && branches.find((b) => b.id === currentUser.branchId) ? ` · ${branches.find((b) => b.id === currentUser.branchId).name}` : ""}
            </div>
          </div>
          <button style={styles.iconBtn} onClick={onLogout} aria-label="Log out">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}

// ---------- admin dashboard ----------
function AdminDashboard({ products, sales, purchases, expenses, customers, creditPayments, branches, multiBranch }) {
  const [branchFilter, setBranchFilter] = useState("all");
  const scopedSales = branchFilter === "all" ? sales : sales.filter((s) => s.branchId === branchFilter);
  const scopedExpenses = branchFilter === "all" ? expenses : expenses.filter((e) => e.branchId === branchFilter);
  const scopedPurchases = branchFilter === "all" ? purchases : purchases.filter((p) => p.branchId === branchFilter);

  const todaysSales = scopedSales.filter((s) => s.date === todayStr());
  const revenueToday = todaysSales.reduce((a, s) => a + s.total, 0);
  const costToday = todaysSales.reduce((a, s) => a + s.cost, 0);
  const expensesToday = scopedExpenses.filter((e) => e.date === todayStr()).reduce((a, e) => a + e.amount, 0);
  const netProfitToday = revenueToday - costToday - expensesToday;

  const allRevenue = scopedSales.reduce((a, s) => a + s.total, 0);
  const allCost = scopedSales.reduce((a, s) => a + s.cost, 0);
  const allExpenses = scopedExpenses.reduce((a, e) => a + e.amount, 0);
  const netProfitAll = allRevenue - allCost - allExpenses;
  const totalSpentOnStock = scopedPurchases.reduce((a, p) => a + p.total, 0);

  const outstandingCredit = useMemo(() => {
    const owed = {};
    sales.filter((s) => s.paymentType === "credit" && s.customerId).forEach((s) => {
      owed[s.customerId] = (owed[s.customerId] || 0) + s.balanceDue;
    });
    creditPayments.forEach((p) => { owed[p.customerId] = (owed[p.customerId] || 0) - p.amount; });
    return Object.values(owed).reduce((a, n) => a + Math.max(0, n), 0);
  }, [sales, creditPayments]);

  const last14 = useMemo(() => {
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const daySales = scopedSales.filter((s) => s.date === key);
      const dayExpenses = scopedExpenses.filter((e) => e.date === key).reduce((a, e) => a + e.amount, 0);
      const revenue = daySales.reduce((a, s) => a + s.total, 0);
      const cost = daySales.reduce((a, s) => a + s.cost, 0);
      days.push({ label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), profit: Number((revenue - cost - dayExpenses).toFixed(2)) });
    }
    return days;
  }, [scopedSales, scopedExpenses]);

  const lowStock = useMemo(() => {
    const rows = [];
    products.forEach((p) => {
      if (branchFilter === "all") {
        branches.forEach((b) => {
          const s = getStock(p, b.id);
          if (s <= p.lowStock) rows.push({ product: p, branch: b, stock: s });
        });
      } else {
        const s = getStock(p, branchFilter);
        if (s <= p.lowStock) rows.push({ product: p, branch: branches.find((b) => b.id === branchFilter), stock: s });
      }
    });
    return rows.sort((a, b) => a.stock - b.stock);
  }, [products, branches, branchFilter]);

  const inventoryValue = products.reduce((a, p) => {
    if (branchFilter === "all") return a + p.cost * totalStock(p);
    return a + p.cost * getStock(p, branchFilter);
  }, 0);

  const topSellers = useMemo(() => {
    const map = {};
    scopedSales.forEach((s) => s.items.forEach((it) => { map[it.name] = (map[it.name] || 0) + it.qty; }));
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [scopedSales]);

  return (
    <div style={styles.stack}>
      {multiBranch && (
        <div style={styles.toolbar}>
          <div style={styles.panelTitle}>Dashboard</div>
          <select style={styles.input} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="all">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
      <div style={styles.cardsRow}>
        <StatCard label="Today's revenue" value={`${money(revenueToday)}`} accent={colors.amber} />
        <StatCard label="Today's net profit" value={`${money(netProfitToday)}`} accent={colors.teal} />
        <StatCard label="All-time net profit" value={`${money(netProfitAll)}`} accent={colors.teal} />
        <StatCard label="Inventory value" value={`${money(inventoryValue)}`} accent={colors.ink} />
      </div>
      <div style={styles.cardsRow3}>
        <StatCard label="Outstanding credit (all branches)" value={`${money(outstandingCredit)}`} accent={colors.red} />
        <StatCard label="Customers owing" value={new Set(sales.filter((s) => s.paymentType === "credit").map((s) => s.customerId)).size} accent={colors.amber} />
        <StatCard label="Stock purchases (scoped)" value={`${money(totalSpentOnStock)}`} accent={colors.ink} />
      </div>

      <div style={styles.gridTwo}>
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Net profit, last 14 days</div>
          <div style={{ width: "100%", height: 220 }}>
            <Sparkline data={last14} />
          </div>
        </div>

        <div style={styles.panel}>
          <div style={styles.panelTitle}>Low stock alerts</div>
          {lowStock.length === 0 ? (
            <div style={styles.emptyNote}>Everything is stocked above threshold. Nice work.</div>
          ) : (
            <div style={styles.stack8}>
              {lowStock.map((row, i) => (
                <div key={row.product.id + "-" + row.branch.id} style={styles.lowStockRow}>
                  <div>
                    <div style={styles.lowStockName}>{row.product.name}</div>
                    <div style={styles.lowStockSku}>{row.product.sku}{branchFilter === "all" && multiBranch ? ` · ${row.branch.name}` : ""}</div>
                  </div>
                  <div style={styles.lowStockQty}>{row.stock} left</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={styles.gridTwo}>
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Top sellers (scoped)</div>
          {topSellers.length === 0 ? (
            <div style={styles.emptyNote}>No sales recorded yet.</div>
          ) : (
            <div style={styles.stack8}>
              {topSellers.map(([name, qty], i) => (
                <div key={name} style={styles.rankRow}>
                  <span style={styles.rankNum}>{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ flex: 1 }}>{name}</span>
                  <span style={styles.rankQty}>{qty} sold</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Spending breakdown (scoped)</div>
          <div style={styles.stack8}>
            <div style={styles.rankRow}><span style={{ flex: 1 }}>Stock purchases</span><span style={styles.mono}>{money(totalSpentOnStock)}</span></div>
            <div style={styles.rankRow}><span style={{ flex: 1 }}>Operating expenses</span><span style={styles.mono}>{money(allExpenses)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- staff dashboard ----------
function StaffDashboard({ products, sales, currentUser, activeBranchId }) {
  const todaysSales = sales.filter((s) => s.date === todayStr() && s.branchId === activeBranchId);
  const mySales = todaysSales.filter((s) => s.cashierId === currentUser.id);
  const myTotal = mySales.reduce((a, s) => a + s.total, 0);
  const shopTxCount = todaysSales.length;
  const lowStock = products.filter((p) => getStock(p, activeBranchId) <= p.lowStock).sort((a, b) => getStock(a, activeBranchId) - getStock(b, activeBranchId));

  return (
    <div style={styles.stack}>
      <div style={styles.cardsRow3}>
        <StatCard label="Your sales today" value={`${money(myTotal)}`} accent={colors.teal} />
        <StatCard label="Your transactions today" value={mySales.length} accent={colors.amber} />
        <StatCard label="Shop transactions today" value={shopTxCount} accent={colors.ink} />
      </div>
      <div style={styles.panel}>
        <div style={styles.panelTitle}>Low stock — worth flagging to the owner</div>
        {lowStock.length === 0 ? (
          <div style={styles.emptyNote}>Everything is stocked above threshold.</div>
        ) : (
          <div style={styles.stack8}>
            {lowStock.map((p) => (
              <div key={p.id} style={styles.lowStockRow}>
                <div>
                  <div style={styles.lowStockName}>{p.name}</div>
                  <div style={styles.lowStockSku}>{p.sku}</div>
                </div>
                <div style={styles.lowStockQty}>{getStock(p, activeBranchId)} left</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statAccent, background: accent }} />
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  );
}

// ---------- inventory ----------
function emptyProduct() {
  return { id: null, name: "", sku: "", barcode: "", category: "", cost: "", price: "", stock: "", lowStock: "" };
}

function Inventory({ products, setProducts, showToast, readOnly, activeBranchId, branches, multiBranch }) {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(null);
  const [importing, setImporting] = useState(false);
  const [scanTarget, setScanTarget] = useState(null); // "form" | "search"
  const branchName = (branches.find((b) => b.id === activeBranchId) || {}).name || "";

  const filtered = products.filter((p) => {
    const q = query.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode || "").includes(q) || p.category.toLowerCase().includes(q);
  });

  const openAdd = () => setForm(emptyProduct());
  const openEdit = (p) => setForm({ ...p, stock: getStock(p, activeBranchId) });
  const close = () => setForm(null);

  const save = () => {
    if (!form.name.trim() || !form.sku.trim()) {
      showToast("Name and SKU are required.", "err");
      return;
    }
    const dupe = products.find((p) => p.sku.toLowerCase() === form.sku.trim().toLowerCase() && p.id !== form.id);
    if (dupe) { showToast("A product with this SKU already exists.", "err"); return; }

    if (form.id) {
      setProducts((prev) => prev.map((p) => p.id === form.id ? {
        ...p,
        name: form.name.trim(), sku: form.sku.trim(), barcode: form.barcode || "", category: form.category || "",
        cost: Number(form.cost) || 0, price: Number(form.price) || 0, lowStock: Number(form.lowStock) || 0,
        stock: { ...p.stock, [activeBranchId]: Number(form.stock) || 0 },
      } : p));
      showToast("Product updated.");
    } else {
      const newProduct = {
        id: "p-" + uid(), name: form.name.trim(), sku: form.sku.trim(), barcode: form.barcode || "", category: form.category || "",
        cost: Number(form.cost) || 0, price: Number(form.price) || 0, lowStock: Number(form.lowStock) || 0,
        stock: { [activeBranchId]: Number(form.stock) || 0 },
      };
      setProducts((prev) => [...prev, newProduct]);
      showToast("Product added.");
    }
    close();
  };

  const remove = (id) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    showToast("Product removed.");
  };

  return (
    <div style={styles.stack}>
      <div style={styles.toolbar}>
        <div style={styles.searchBox}>
          <Search size={16} color={colors.inkSoft} />
          <input placeholder="Search by name, SKU, barcode, or category" value={query} onChange={(e) => setQuery(e.target.value)} style={styles.searchInput} />
          <button type="button" style={styles.camBtn} onClick={() => setScanTarget("search")} aria-label="Scan barcode"><CameraIcon size={16} /></button>
        </div>
        {!readOnly && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={styles.ghostBtn} onClick={() => setImporting(true)}><UploadIcon size={14} /> Import / export</button>
            <button style={styles.primaryBtn} onClick={openAdd}><Plus size={16} /> Add product</button>
          </div>
        )}
      </div>
      {scanTarget && (
        <ScannerModal
          title={scanTarget === "form" ? "Scan product barcode" : "Find product by barcode"}
          onClose={() => setScanTarget(null)}
          onDetect={(code) => {
            if (scanTarget === "form") {
              const other = products.find((p) => p.barcode === code && p.id !== (form && form.id));
              if (other) return { ok: false, text: `Already used by "${other.name}"` };
              setForm((f) => ({ ...f, barcode: code }));
              return { ok: true, text: `Barcode ${code} saved to the form` };
            }
            setQuery(code);
            const n = products.filter((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase()).length;
            return { ok: true, text: n ? `Found ${n} product${n > 1 ? "s" : ""}` : `No product has barcode ${code}` };
          }}
        />
      )}
      {importing && !readOnly && (
        <BulkImportModal products={products} setProducts={setProducts} showToast={showToast}
          activeBranchId={activeBranchId} branchName={branchName} multiBranch={multiBranch} onClose={() => setImporting(false)} />
      )}
      {multiBranch && <div style={styles.emptyNote}>Showing stock for <b>{branchName}</b>. Switch branch from the top bar to manage another location.</div>}

      <div style={{ ...styles.panel, overflowX: "auto" }}>
        <div style={styles.tableHead}>
          <div style={{ flex: 2.2 }}>Product</div>
          <div style={{ flex: 1 }}>SKU</div>
          <div style={{ flex: 1.1 }}>Barcode</div>
          {!readOnly && <div style={{ flex: 0.8, textAlign: "right" }}>Cost</div>}
          <div style={{ flex: 0.8, textAlign: "right" }}>Price</div>
          <div style={{ flex: 0.8, textAlign: "right" }}>Stock</div>
          {!readOnly && <div style={{ flex: 0.7 }}></div>}
        </div>
        {filtered.length === 0 ? (
          <div style={styles.emptyNote}>No products match your search.</div>
        ) : (
          filtered.map((p) => {
            const stock = getStock(p, activeBranchId);
            const low = stock <= p.lowStock;
            return (
              <div key={p.id} style={styles.tableRow}>
                <div style={{ flex: 2.2, fontWeight: 600 }}>{p.name}</div>
                <div style={{ flex: 1, ...styles.mono, color: colors.inkSoft }}>{p.sku}</div>
                <div style={{ flex: 1.1, ...styles.mono, color: colors.inkSoft, fontSize: 12 }}>{p.barcode || "—"}</div>
                {!readOnly && <div style={{ flex: 0.8, textAlign: "right", ...styles.mono }}>{money(p.cost)}</div>}
                <div style={{ flex: 0.8, textAlign: "right", ...styles.mono }}>{money(p.price)}</div>
                <div style={{ flex: 0.8, textAlign: "right" }}>
                  <div style={{ ...styles.mono, color: low ? colors.red : colors.ink, fontWeight: low ? 700 : 400 }}>{stock}</div>
                  {multiBranch && <div style={{ fontSize: 10, color: colors.inkSoft }}>Σ {totalStock(p)} all branches</div>}
                </div>
                {!readOnly && (
                  <div style={{ flex: 0.7, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button style={styles.iconBtn} onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}><Pencil size={14} /></button>
                    <button style={styles.iconBtnDanger} onClick={() => remove(p.id)} aria-label={`Delete ${p.name}`}><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {form && !readOnly && (
        <Modal onClose={close} title={form.id ? "Edit product" : "Add product"}>
          <div style={styles.formGrid}>
            <Field label="Product name" span={2}>
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Whole Milk 1L" />
            </Field>
            <Field label="SKU">
              <input style={styles.input} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. DRY-014" />
            </Field>
            <Field label="Barcode">
              <div style={{ display: "flex", gap: 6 }}>
                <input style={{ ...styles.input, flex: 1, minWidth: 0 }} value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Scan or type UPC/EAN" />
                <button type="button" style={styles.camBtn} onClick={() => setScanTarget("form")} aria-label="Scan barcode with camera"><CameraIcon size={16} /></button>
              </div>
            </Field>
            <Field label="Category">
              <input style={styles.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Dairy" />
            </Field>
            <Field label={`Cost price (${CURRENCY})`}>
              <input style={styles.input} type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            </Field>
            <Field label={`Sell price (${CURRENCY})`}>
              <input style={styles.input} type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </Field>
            <Field label={multiBranch ? `Stock at ${branchName}` : "Current stock"}>
              <input style={styles.input} type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
            </Field>
            <Field label="Low stock alert at">
              <input style={styles.input} type="number" value={form.lowStock} onChange={(e) => setForm({ ...form, lowStock: e.target.value })} />
            </Field>
          </div>
          {multiBranch && !form.id && <div style={styles.emptyNote}>New products start with 0 stock in your other branches — use Purchases to stock them there.</div>}
          <div style={styles.modalActions}>
            <button style={styles.ghostBtn} onClick={close}>Cancel</button>
            <button style={styles.primaryBtn} onClick={save}>{form.id ? "Save changes" : "Add product"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- receipts ----------
function resolveBranch(branches, branchId, settings) {
  const b = branches.find((x) => x.id === branchId);
  return {
    name: (b && b.name) || settings.shopName,
    address: (b && b.address) || settings.address,
    phone: (b && b.phone) || settings.phone,
  };
}

function receiptText(sale, settings, branch) {
  const lines = [];
  const pad = (s, n) => (s.length >= n ? s : s + " ".repeat(n - s.length));
  const isCredit = sale.paymentType === "credit";
  lines.push(settings.shopName.toUpperCase());
  if (settings.tagline) lines.push(`(${settings.tagline})`);
  if (branch && branch.name) lines.push(`Branch: ${branch.name}`);
  if (branch && branch.address) lines.push(branch.address);
  if (branch && branch.phone) lines.push(branch.phone);
  lines.push("----------------------------------------");
  lines.push(isCredit ? "CREDIT INVOICE — GOODS ON CREDIT" : "CASH INVOICE");
  lines.push(`Invoice No.: ${sale.invoiceNo}`);
  lines.push(`Date: ${sale.date}    Time: ${new Date(sale.time).toLocaleTimeString()}`);
  lines.push(`Name: ${sale.customerName || "Walk-in Customer"}`);
  if (isCredit && sale.customerPhone) lines.push(`Phone: ${sale.customerPhone}`);
  if (isCredit && sale.dueDate) lines.push(`Payment due by: ${sale.dueDate}`);
  lines.push("----------------------------------------");
  lines.push(pad("Qty  Description", 26) + "Price   Amount");
  sale.items.forEach((i) => {
    lines.push(pad(`${i.qty}    ${i.name}`, 26) + `${money(i.price)}  ${money(i.price * i.qty)}`);
  });
  lines.push("----------------------------------------");
  lines.push(`Amount Due: ${money(sale.total)}`);
  lines.push(isCredit ? `Deposit Paid: ${money(sale.amountTendered)}` : `Payment: Cash ${money(sale.amountTendered)}`);
  lines.push(isCredit ? `AMOUNT OWED (CREDIT): ${money(sale.balanceDue)}` : `Balance: ${money(sale.balanceDue)}`);
  lines.push("----------------------------------------");
  lines.push("Customer Sign: ____________  Date: _______");
  lines.push(isCredit ? "Goods released on credit. Balance must be settled as agreed." : "Received the above goods in good condition.");
  lines.push("No refund of money after payment.");
  lines.push(`Cashier: ${sale.cashierName} | Manager: ____________`);
  lines.push(`Printed on ${new Date().toLocaleString()}`);
  return lines.join("\n");
}

function downloadReceipt(sale, settings, branch) {
  const text = receiptText(sale, settings, branch);
  saveAndShare(`invoice-${sale.invoiceNo}.txt`, text, "text/plain");
}

function ReceiptModal({ sale, settings, branch, onClose }) {
  const isCredit = sale.paymentType === "credit";
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHead}>
          <div style={styles.modalTitle}>Sale complete</div>
          <button style={styles.iconBtn} onClick={onClose}><X size={16} /></button>
        </div>
        <div id="printable-receipt" style={{ ...styles.receiptPrintArea, ...(isCredit ? styles.creditPrintArea : {}) }}>
          <div style={styles.invoiceShopName}>{settings.shopName}</div>
          {settings.tagline && <div style={styles.invoiceTagline}>({settings.tagline})</div>}
          {branch && branch.name && <div style={styles.invoiceBranchLine}>Branch: {branch.name}</div>}
          {branch && branch.address && <div style={styles.invoiceMetaLine}>{branch.address}</div>}
          {branch && branch.phone && <div style={styles.invoiceMetaLine}>{branch.phone}</div>}
          <div style={styles.receiptDivider} />
          <div style={{ ...styles.invoiceLabel, ...(isCredit ? { color: colors.red } : {}) }}>{isCredit ? "CREDIT INVOICE — GOODS ON CREDIT" : "CASH INVOICE"}</div>
          <div style={styles.receiptMeta}>
            <div>Invoice No.: <span style={styles.mono}>{sale.invoiceNo}</span></div>
            <div>Date: {sale.date} &nbsp; Time: {new Date(sale.time).toLocaleTimeString()}</div>
            <div>Name: {sale.customerName || "Walk-in Customer"}</div>
            {isCredit && sale.customerPhone && <div>Phone: {sale.customerPhone}</div>}
            {isCredit && sale.dueDate && <div>Payment due by: <b>{sale.dueDate}</b></div>}
          </div>
          <div style={styles.receiptDivider} />
          <div style={styles.invoiceTableHead}>
            <span style={{ flex: 0.5 }}>Qty</span>
            <span style={{ flex: 2 }}>Description</span>
            <span style={{ flex: 0.8, textAlign: "right" }}>Price</span>
            <span style={{ flex: 0.9, textAlign: "right" }}>Amount</span>
          </div>
          <div style={styles.receiptLines}>
            {sale.items.map((i, idx) => (
              <div key={idx} style={styles.invoiceTableRow}>
                <span style={{ ...styles.mono, flex: 0.5 }}>{i.qty}</span>
                <span style={{ flex: 2 }}>{i.name}</span>
                <span style={{ ...styles.mono, flex: 0.8, textAlign: "right" }}>{money(i.price)}</span>
                <span style={{ ...styles.mono, flex: 0.9, textAlign: "right" }}>{money(i.price * i.qty)}</span>
              </div>
            ))}
          </div>
          <div style={styles.receiptDivider} />
          <div style={styles.receiptTotalRow}><span>Amount Due</span><span style={styles.mono}>{money(sale.total)}</span></div>
          <div style={styles.receiptSubRow}><span>{isCredit ? "Deposit Paid" : "Payment — Cash"}</span><span style={styles.mono}>{money(sale.amountTendered)}</span></div>
          <div style={{ ...styles.receiptSubRow, ...(isCredit ? { color: colors.red, fontWeight: 700 } : {}) }}><span>{isCredit ? "AMOUNT OWED" : "Balance"}</span><span style={styles.mono}>{money(sale.balanceDue)}</span></div>
          <div style={styles.receiptDivider} />
          <div style={styles.signatureRow}>
            <span>Customer Sign: __________</span>
            <span>Date: __________</span>
          </div>
          <div style={styles.receiptFooter}>{isCredit ? "Goods released on credit. Balance must be settled as agreed. No refund of money after payment." : "Received the above goods in good condition. No refund of money after payment."}</div>
          <div style={styles.signatureRow}>
            <span>Cashier: {sale.cashierName}</span>
            <span>Manager: __________</span>
          </div>
          <div style={styles.receiptPrintedOn}>Printed on {new Date().toLocaleString()}</div>
        </div>
        <div style={styles.modalActions}>
          <button style={styles.ghostBtn} onClick={() => downloadReceipt(sale, settings, branch)}>Share / save .txt</button>
          <button style={styles.primaryBtn} onClick={() => window.print()}>Print receipt</button>
        </div>
      </div>
    </div>
  );
}

function PaymentReceiptModal({ payment, customer, settings, branch, onClose }) {
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHead}>
          <div style={styles.modalTitle}>Payment recorded</div>
          <button style={styles.iconBtn} onClick={onClose}><X size={16} /></button>
        </div>
        <div id="printable-receipt" style={styles.receiptPrintArea}>
          <div style={styles.invoiceShopName}>{settings.shopName}</div>
          {branch && branch.name && <div style={styles.invoiceBranchLine}>Branch: {branch.name}</div>}
          <div style={styles.receiptDivider} />
          <div style={styles.invoiceLabel}>CREDIT PAYMENT RECEIPT</div>
          <div style={styles.receiptMeta}>
            <div>Receipt No.: <span style={styles.mono}>{payment.receiptNo}</span></div>
            <div>Date: {payment.date}</div>
            <div>Customer: {customer ? customer.name : "—"}{customer && customer.phone ? ` (${customer.phone})` : ""}</div>
          </div>
          <div style={styles.receiptDivider} />
          <div style={styles.receiptTotalRow}><span>Amount Paid</span><span style={styles.mono}>{money(payment.amount)}</span></div>
          <div style={styles.receiptSubRow}><span>Remaining balance owed</span><span style={styles.mono}>{money(payment.remainingAfter)}</span></div>
          {payment.note && <div style={styles.receiptSubRow}><span>Note</span><span>{payment.note}</span></div>}
          <div style={styles.receiptDivider} />
          <div style={styles.signatureRow}>
            <span>Received by: {payment.cashierName}</span>
            <span>Date: __________</span>
          </div>
          <div style={styles.receiptPrintedOn}>Printed on {new Date().toLocaleString()}</div>
        </div>
        <div style={styles.modalActions}>
          <button style={styles.primaryBtn} onClick={() => window.print()}>Print receipt</button>
        </div>
      </div>
    </div>
  );
}

// ---------- checkout ----------
function Checkout({ products, setProducts, sales, setSales, customers, setCustomers, showToast, currentUser, settings, activeBranchId, branches }) {
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState([]);
  const [lastAdded, setLastAdded] = useState(null);
  const [receiptSale, setReceiptSale] = useState(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [amountTendered, setAmountTendered] = useState("");
  const [paymentType, setPaymentType] = useState("cash");
  const [dueDate, setDueDate] = useState("");
  const scanRef = useRef(null);
  const [camScanning, setCamScanning] = useState(false);
  const cartRef = useRef(cart);
  cartRef.current = cart;

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  const results = query.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()) || p.sku.toLowerCase().includes(query.toLowerCase()) || (p.barcode || "").includes(query)).slice(0, 8)
    : [];

  const flashAdded = (name) => {
    setLastAdded(name);
    setTimeout(() => setLastAdded(null), 1400);
  };

  const addToCart = (p) => {
    const stock = getStock(p, activeBranchId);
    setCart((c) => {
      const existing = c.find((i) => i.id === p.id);
      if (existing) {
        if (existing.qty + 1 > stock) { showToast(`Only ${stock} of ${p.name} in stock.`, "err"); return c; }
        return c.map((i) => (i.id === p.id ? { ...i, qty: i.qty + 1 } : i));
      }
      if (stock < 1) { showToast(`${p.name} is out of stock.`, "err"); return c; }
      return [...c, { id: p.id, name: p.name, price: p.price, cost: p.cost, qty: 1, stock }];
    });
    flashAdded(p.name);
    setQuery("");
  };

  const scanAdd = (raw) => {
    const code = String(raw).trim();
    const match = products.find((p) => (p.barcode && p.barcode === code) || p.sku.toLowerCase() === code.toLowerCase());
    if (!match) return { ok: false, text: `No product matches ${code}` };
    const stock = getStock(match, activeBranchId);
    const inCart = (cartRef.current.find((i) => i.id === match.id) || {}).qty || 0;
    if (inCart + 1 > stock) return { ok: false, text: stock < 1 ? `${match.name}: out of stock` : `${match.name}: only ${stock} in stock` };
    addToCart(match);
    return { ok: true, text: `${match.name} · ${money(match.price)}  (x${inCart + 1})` };
  };

  const handleScanKey = (e) => {
    if (e.key !== "Enter") return;
    const code = query.trim();
    if (!code) return;
    const match = products.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase());
    if (match) {
      addToCart(match);
    } else if (results.length === 1) {
      addToCart(results[0]);
    } else {
      showToast(`No product matches "${code}".`, "err");
      setQuery("");
    }
  };

  const updateQty = (id, qty) => {
    const product = products.find((p) => p.id === id);
    const stock = getStock(product, activeBranchId);
    if (qty > stock) { showToast(`Only ${stock} in stock.`, "err"); return; }
    if (qty <= 0) { setCart(cart.filter((i) => i.id !== id)); return; }
    setCart(cart.map((i) => (i.id === id ? { ...i, qty } : i)));
  };

  const removeLine = (id) => setCart(cart.filter((i) => i.id !== id));

  const total = cart.reduce((a, i) => a + i.price * i.qty, 0);
  const totalCost = cart.reduce((a, i) => a + i.cost * i.qty, 0);
  const profit = total - totalCost;

  const findOrCreateCustomer = (name, phone) => {
    const nName = name.trim().toLowerCase();
    const nPhone = phone.trim();
    let existing = customers.find((c) => c.name.trim().toLowerCase() === nName && (nPhone ? c.phone === nPhone : true));
    if (existing) return existing.id;
    const newCustomer = { id: "c-" + uid(), name: name.trim(), phone: nPhone };
    setCustomers((prev) => [...prev, newCustomer]);
    return newCustomer.id;
  };

  const completeSale = () => {
    if (cart.length === 0) return;
    if (paymentType === "credit" && !customerName.trim()) {
      showToast("A customer name is required for credit sales.", "err");
      return;
    }
    const tendered = paymentType === "credit"
      ? (amountTendered === "" ? 0 : Number(amountTendered) || 0)
      : (amountTendered === "" ? total : Number(amountTendered) || 0);
    const balanceDue = Math.max(0, total - tendered);
    const customerId = paymentType === "credit" ? findOrCreateCustomer(customerName, customerPhone) : null;

    const sale = {
      id: "s-" + uid(),
      invoiceNo: nextSeq("invoice"),
      date: todayStr(),
      time: new Date().toISOString(),
      branchId: activeBranchId,
      cashierId: currentUser.id,
      cashierName: currentUser.name,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerId,
      paymentType,
      dueDate: paymentType === "credit" ? dueDate : "",
      amountTendered: tendered,
      balanceDue,
      items: cart.map((i) => ({ productId: i.id, name: i.name, qty: i.qty, price: i.price, cost: i.cost })),
      total,
      cost: totalCost,
    };

    setProducts((prev) => prev.map((p) => {
      const line = cart.find((i) => i.id === p.id);
      if (!line) return p;
      return { ...p, stock: { ...p.stock, [activeBranchId]: getStock(p, activeBranchId) - line.qty } };
    }));
    setSales((prev) => [...prev, sale]);
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setAmountTendered("");
    setDueDate("");
    setPaymentType("cash");
    setReceiptSale(sale);
    showToast(paymentType === "credit" ? `Credit sale recorded — ${money(balanceDue)} owed` : `Sale recorded — ${money(total)}`);
  };

  const branch = resolveBranch(branches, activeBranchId, settings);

  return (
    <div style={styles.checkoutGrid}>
      {receiptSale && <ReceiptModal sale={receiptSale} settings={settings} branch={branch} onClose={() => setReceiptSale(null)} />}
      <div style={styles.stack}>
        <div style={styles.scanBox}>
          <ScanLine size={18} color={colors.teal} />
          <input
            ref={scanRef}
            placeholder="Scan a barcode, or type a name/SKU and press Enter"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleScanKey}
            style={styles.searchInput}
          />
          {lastAdded && <span style={styles.scanFlash}><Check size={13} /> {lastAdded}</span>}
          <button type="button" style={styles.scanCamBtn} onClick={() => setCamScanning(true)}><CameraIcon size={15} /> Scan</button>
        </div>
        {camScanning && (
          <ScannerModal title="Scan items" continuous onClose={() => { setCamScanning(false); }} onDetect={scanAdd}
            summary={`${cart.reduce((a, i) => a + i.qty, 0)} items · ${money(total)}`} />
        )}
        {results.length > 0 && (
          <div style={styles.panel}>
            {results.map((p) => (
              <button key={p.id} style={styles.resultRow} onClick={() => addToCart(p)}>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ ...styles.mono, fontSize: 12, color: colors.inkSoft }}>{p.sku} · {getStock(p, activeBranchId)} in stock</div>
                </div>
                <div style={styles.mono}>{money(p.price)}</div>
              </button>
            ))}
          </div>
        )}
        {results.length === 0 && (
          <div style={styles.panel}>
            <div style={styles.panelTitle}>Quick add</div>
            <div style={styles.quickGrid}>
              {products.slice(0, 8).map((p) => (
                <button key={p.id} style={styles.quickTile} onClick={() => addToCart(p)}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                  <div style={{ ...styles.mono, fontSize: 12, color: colors.inkSoft, marginTop: 4 }}>{money(p.price)}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={styles.receipt}>
        <div style={styles.receiptTitle}>TODAY'S SALE — {currentUser.name.toUpperCase()}</div>
        <div style={styles.receiptDivider} />
        {cart.length === 0 ? (
          <div style={styles.emptyNote}>Cart is empty. Scan or add products from the left.</div>
        ) : (
          <div style={styles.receiptLines}>
            {cart.map((i) => (
              <div key={i.id} style={styles.receiptLine}>
                <div style={{ flex: 1 }}>
                  <div style={styles.receiptItemName}>{i.name}</div>
                  <div style={styles.qtyControls}>
                    <button style={styles.qtyBtn} onClick={() => updateQty(i.id, i.qty - 1)}>−</button>
                    <span style={styles.mono}>{i.qty}</span>
                    <button style={styles.qtyBtn} onClick={() => updateQty(i.id, i.qty + 1)}>+</button>
                    <button style={styles.removeLink} onClick={() => removeLine(i.id)}>remove</button>
                  </div>
                </div>
                <div style={{ ...styles.mono, fontWeight: 600 }}>{money(i.price * i.qty)}</div>
              </div>
            ))}
          </div>
        )}
        <div style={styles.receiptDivider} />
        <div style={styles.receiptTotalRow}><span>Total</span><span style={styles.mono}>{money(total)}</span></div>
        <div style={styles.receiptSubRow}><span>Profit on this sale</span><span style={styles.mono}>{money(profit)}</span></div>

        <div style={styles.paymentToggleRow}>
          <button style={{ ...styles.paymentToggleBtn, ...(paymentType === "cash" ? styles.paymentToggleBtnActive : {}) }} onClick={() => setPaymentType("cash")}>Cash</button>
          <button style={{ ...styles.paymentToggleBtn, ...(paymentType === "credit" ? styles.paymentToggleBtnActiveCredit : {}) }} onClick={() => setPaymentType("credit")}>On Credit</button>
        </div>

        <div style={styles.checkoutFields}>
          <input style={styles.input} placeholder={paymentType === "credit" ? "Customer name (required)" : "Customer name (optional)"} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          {paymentType === "credit" && (
            <>
              <input style={styles.input} placeholder="Customer phone (optional, helps avoid mix-ups)" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
              <input style={styles.input} type="number" step="0.01" placeholder="Deposit paid now (optional, default 0)" value={amountTendered} onChange={(e) => setAmountTendered(e.target.value)} />
              <Field label="Payment due by (optional)">
                <input style={styles.input} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            </>
          )}
          {paymentType === "cash" && (
            <input style={styles.input} type="number" step="0.01" placeholder={`Cash tendered (default ${money(total)})`} value={amountTendered} onChange={(e) => setAmountTendered(e.target.value)} />
          )}
        </div>
        <button style={{ ...styles.checkoutBtn, ...(paymentType === "credit" ? { background: colors.red } : {}) }} disabled={cart.length === 0} onClick={completeSale}>
          {paymentType === "credit" ? "Record credit sale" : "Complete sale"}
        </button>
      </div>
    </div>
  );
}

// ---------- purchases ----------
function Purchases({ products, setProducts, purchases, setPurchases, showToast, activeBranchId }) {
  const [form, setForm] = useState(null);
  const [scanning, setScanning] = useState(false);
  const formRef = useRef(null);
  formRef.current = form;

  // Scan items as they come off the delivery: each scan adds 1 to that product's line.
  const scanLine = (raw) => {
    const code = String(raw).trim();
    const match = products.find((p) => (p.barcode && p.barcode === code) || p.sku.toLowerCase() === code.toLowerCase());
    if (!match) return { ok: false, text: `No product matches ${code}` };
    const cur = formRef.current; if (!cur) return { ok: false, text: "Form closed" };
    const existing = cur.lines.find((l) => l.productId === match.id && l.qty !== "");
    const newQty = existing ? (Number(existing.qty) || 0) + 1 : 1;
    setForm((f) => {
      const ex = f.lines.findIndex((l) => l.productId === match.id && l.qty !== "");
      if (ex >= 0) return { ...f, lines: f.lines.map((l, i) => (i === ex ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l)) };
      const blank = f.lines.findIndex((l) => l.qty === "" && l.cost === "");
      const line = { productId: match.id, qty: "1", cost: String(match.cost || "") };
      if (blank >= 0) return { ...f, lines: f.lines.map((l, i) => (i === blank ? line : l)) };
      return { ...f, lines: [...f.lines, line] };
    });
    return { ok: true, text: `${match.name}  (x${newQty})` };
  };

  const openAdd = () => setForm({ supplier: "", date: todayStr(), lines: [{ productId: products[0]?.id || "", qty: "", cost: "" }] });
  const close = () => setForm(null);
  const addLine = () => setForm({ ...form, lines: [...form.lines, { productId: products[0]?.id || "", qty: "", cost: "" }] });
  const updateLine = (idx, patch) => setForm({ ...form, lines: form.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) });
  const removeLine = (idx) => setForm({ ...form, lines: form.lines.filter((_, i) => i !== idx) });
  const total = (form?.lines || []).reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);

  const save = () => {
    if (!form.supplier.trim()) { showToast("Supplier name is required.", "err"); return; }
    const validLines = form.lines.filter((l) => l.productId && Number(l.qty) > 0);
    if (validLines.length === 0) { showToast("Add at least one product with a quantity.", "err"); return; }

    setProducts((prev) => prev.map((p) => {
      const line = validLines.find((l) => l.productId === p.id);
      if (!line) return p;
      return { ...p, stock: { ...p.stock, [activeBranchId]: getStock(p, activeBranchId) + Number(line.qty) }, cost: Number(line.cost) || p.cost };
    }));

    const po = {
      id: "po-" + uid(),
      supplier: form.supplier.trim(),
      date: form.date,
      branchId: activeBranchId,
      total,
      items: validLines.map((l) => {
        const p = products.find((pp) => pp.id === l.productId);
        return { productId: l.productId, name: p?.name || "Unknown", qty: Number(l.qty), cost: Number(l.cost) || 0 };
      }),
    };
    setPurchases((prev) => [...prev, po]);
    showToast("Purchase order received into stock.");
    close();
  };

  const sorted = [...purchases].filter((po) => po.branchId === activeBranchId).sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div style={styles.stack}>
      <div style={styles.toolbar}>
        <div style={styles.panelTitle}>Supplier orders</div>
        <button style={styles.primaryBtn} onClick={openAdd}><Plus size={16} /> New purchase order</button>
      </div>
      <div style={styles.panel}>
        {sorted.length === 0 ? (
          <div style={styles.emptyNote}>No purchases logged yet. Record a delivery to stock up your shelves.</div>
        ) : (
          <div style={styles.stack8}>
            {sorted.map((po) => (
              <div key={po.id} style={styles.poCard}>
                <div style={styles.poHead}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{po.supplier}</div>
                    <div style={{ ...styles.mono, fontSize: 12, color: colors.inkSoft }}>{po.date}</div>
                  </div>
                  <div style={{ ...styles.mono, fontWeight: 700 }}>{money(po.total)}</div>
                </div>
                <div style={styles.poItems}>
                  {po.items.map((it, i) => (
                    <div key={i} style={styles.poItemRow}><span>{it.name}</span><span style={styles.mono}>{it.qty} × {money(it.cost)}</span></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {form && (
        <Modal onClose={close} title="New purchase order">
          <div style={styles.formGrid}>
            <Field label="Supplier">
              <input style={styles.input} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="e.g. Green Valley Foods" />
            </Field>
            <Field label="Date">
              <input style={styles.input} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
          </div>
          <div style={styles.poLines}>
            {form.lines.map((l, idx) => (
              <div key={idx} style={styles.poLineRow}>
                <select style={{ ...styles.input, flex: 2 }} value={l.productId} onChange={(e) => updateLine(idx, { productId: e.target.value })}>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input style={{ ...styles.input, flex: 0.8 }} type="number" placeholder="Qty" value={l.qty} onChange={(e) => updateLine(idx, { qty: e.target.value })} />
                <input style={{ ...styles.input, flex: 0.8 }} type="number" step="0.01" placeholder="Cost/unit" value={l.cost} onChange={(e) => updateLine(idx, { cost: e.target.value })} />
                <button style={styles.iconBtnDanger} onClick={() => removeLine(idx)}><X size={14} /></button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={styles.ghostBtn} onClick={addLine}><Plus size={14} /> Add line</button>
              <button style={styles.ghostBtn} onClick={() => setScanning(true)}><CameraIcon size={14} /> Scan items</button>
            </div>
          </div>
          {scanning && <ScannerModal title="Scan delivery" continuous onDetect={scanLine} onClose={() => setScanning(false)} summary={`${(form.lines || []).filter((l) => l.qty !== "").length} products`} />}
          <div style={styles.poTotal}><span>Order total</span><span style={styles.mono}>{money(total)}</span></div>
          <div style={styles.modalActions}>
            <button style={styles.ghostBtn} onClick={close}>Cancel</button>
            <button style={styles.primaryBtn} onClick={save}>Receive into stock</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- expenses ----------
function emptyExpense() {
  return { id: null, date: todayStr(), category: EXPENSE_CATEGORIES[0], amount: "", note: "" };
}

function Expenses({ expenses, setExpenses, showToast, activeBranchId, branches, multiBranch }) {
  const [form, setForm] = useState(null);
  const openAdd = () => setForm(emptyExpense());
  const close = () => setForm(null);
  const branchName = (branches.find((b) => b.id === activeBranchId) || {}).name || "";

  const save = () => {
    const amount = Number(form.amount);
    if (!amount || amount <= 0) { showToast("Enter a valid amount.", "err"); return; }
    const expense = { id: "e-" + uid(), date: form.date, branchId: activeBranchId, category: form.category, amount, note: form.note || "" };
    setExpenses((prev) => [...prev, expense]);
    showToast("Expense logged.");
    close();
  };

  const remove = (id) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    showToast("Expense removed.");
  };

  const scoped = expenses.filter((e) => e.branchId === activeBranchId);
  const sorted = [...scoped].sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = scoped.reduce((a, e) => a + e.amount, 0);
  const byCategory = useMemo(() => {
    const map = {};
    scoped.forEach((e) => { map[e.category] = (map[e.category] || 0) + e.amount; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [scoped]);

  return (
    <div style={styles.stack}>
      <div style={styles.toolbar}>
        <div style={styles.panelTitle}>Operating expenses{multiBranch ? ` — ${branchName}` : ""}</div>
        <button style={styles.primaryBtn} onClick={openAdd}><Plus size={16} /> Log expense</button>
      </div>

      <div style={styles.gridTwo}>
        <div style={styles.panel}>
          {sorted.length === 0 ? (
            <div style={styles.emptyNote}>No expenses logged yet — rent, utilities, wages, and other non-stock costs go here.</div>
          ) : (
            <div style={styles.stack8}>
              {sorted.map((e) => (
                <div key={e.id} style={styles.expenseRow}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{e.category}{e.note ? ` — ${e.note}` : ""}</div>
                    <div style={{ ...styles.mono, fontSize: 11, color: colors.inkSoft }}>{e.date}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ ...styles.mono, fontWeight: 700 }}>{money(e.amount)}</span>
                    <button style={styles.iconBtnDanger} onClick={() => remove(e.id)}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={styles.panel}>
          <div style={styles.panelTitle}>By category</div>
          <div style={styles.bigNumber}>{money(total)}</div>
          <div style={styles.stack8}>
            {byCategory.map(([cat, amt]) => (
              <div key={cat} style={styles.rankRow}><span style={{ flex: 1 }}>{cat}</span><span style={styles.mono}>{money(amt)}</span></div>
            ))}
          </div>
        </div>
      </div>

      {form && (
        <Modal onClose={close} title="Log expense">
          <div style={styles.formGrid}>
            <Field label="Category">
              <select style={styles.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Date">
              <input style={styles.input} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label={`Amount (${CURRENCY})`}>
              <input style={styles.input} type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Note (optional)">
              <input style={styles.input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. July electricity" />
            </Field>
          </div>
          <div style={styles.modalActions}>
            <button style={styles.ghostBtn} onClick={close}>Cancel</button>
            <button style={styles.primaryBtn} onClick={save}>Save expense</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- credit book ----------
function creditBalance(customerId, sales, creditPayments) {
  const owed = sales.filter((s) => s.paymentType === "credit" && s.customerId === customerId).reduce((a, s) => a + s.balanceDue, 0);
  const paid = creditPayments.filter((p) => p.customerId === customerId).reduce((a, p) => a + p.amount, 0);
  return Math.max(0, owed - paid);
}

function CreditBook({ customers, setCustomers, sales, creditPayments, setCreditPayments, showToast, currentUser, settings, branches, activeBranchId }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [payForm, setPayForm] = useState(null);
  const [paymentReceipt, setPaymentReceipt] = useState(null);

  const withBalances = useMemo(() => {
    return customers.map((c) => ({ ...c, balance: creditBalance(c.id, sales, creditPayments) }));
  }, [customers, sales, creditPayments]);

  const owing = withBalances.filter((c) => c.balance > 0);
  const filtered = owing.filter((c) => {
    const q = query.toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || (c.phone || "").includes(q);
  }).sort((a, b) => b.balance - a.balance);

  const totalOwed = owing.reduce((a, c) => a + c.balance, 0);
  const selected = selectedId ? withBalances.find((c) => c.id === selectedId) : null;
  const selectedSales = selected ? sales.filter((s) => s.paymentType === "credit" && s.customerId === selected.id).sort((a, b) => (a.time < b.time ? 1 : -1)) : [];
  const selectedPayments = selected ? creditPayments.filter((p) => p.customerId === selected.id).sort((a, b) => (a.date < b.date ? 1 : -1)) : [];

  const openPay = (c) => setPayForm({ amount: "", note: "", date: todayStr() });
  const closePay = () => setPayForm(null);

  const savePayment = () => {
    const amount = Number(payForm.amount);
    if (!amount || amount <= 0) { showToast("Enter a valid amount.", "err"); return; }
    if (amount > selected.balance) { showToast(`That's more than the ${money(selected.balance)} owed. Enter an amount up to that.`, "err"); return; }
    const payment = {
      id: "cp-" + uid(),
      receiptNo: nextSeq("payment"),
      customerId: selected.id,
      amount,
      date: payForm.date,
      note: payForm.note || "",
      branchId: activeBranchId,
      cashierName: currentUser.name,
    };
    setCreditPayments((prev) => [...prev, payment]);
    showToast(`Payment of ${money(amount)} recorded.`);
    closePay();
    setPaymentReceipt({ ...payment, remainingAfter: selected.balance - amount });
  };

  const branch = resolveBranch(branches, activeBranchId, settings);

  return (
    <div style={styles.stack}>
      {paymentReceipt && (
        <PaymentReceiptModal payment={paymentReceipt} customer={customers.find((c) => c.id === paymentReceipt.customerId)} settings={settings} branch={branch} onClose={() => setPaymentReceipt(null)} />
      )}
      <div style={styles.cardsRow3}>
        <StatCard label="Total outstanding credit" value={money(totalOwed)} accent={colors.red} />
        <StatCard label="Customers owing" value={owing.length} accent={colors.amber} />
        <StatCard label="Credit sales (all time)" value={sales.filter((s) => s.paymentType === "credit").length} accent={colors.ink} />
      </div>

      <div style={styles.gridTwo}>
        <div style={styles.panel}>
          <div style={{ ...styles.searchBox, marginBottom: 12 }}>
            <Search size={16} color={colors.inkSoft} />
            <input placeholder="Search customers by name or phone" value={query} onChange={(e) => setQuery(e.target.value)} style={styles.searchInput} />
          </div>
          {filtered.length === 0 ? (
            <div style={styles.emptyNote}>{owing.length === 0 ? "No one currently owes the shop money." : "No match for that search."}</div>
          ) : (
            <div style={styles.stack8}>
              {filtered.map((c) => (
                <button key={c.id} style={{ ...styles.creditCustomerRow, ...(selectedId === c.id ? styles.creditCustomerRowActive : {}) }} onClick={() => setSelectedId(c.id)}>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: colors.inkSoft }}>{c.phone || "No phone on file"}</div>
                  </div>
                  <div style={{ ...styles.mono, fontWeight: 700, color: colors.red }}>{money(c.balance)}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={styles.panel}>
          {!selected ? (
            <div style={styles.emptyNote}>Select a customer on the left to see their credit history and record a repayment.</div>
          ) : (
            <div style={styles.stack}>
              <div style={styles.toolbar}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{selected.name}</div>
                  <div style={{ fontSize: 12, color: colors.inkSoft }}>{selected.phone || "No phone on file"}</div>
                </div>
                <button style={styles.primaryBtn} onClick={() => openPay(selected)} disabled={selected.balance <= 0}><Plus size={14} /> Record payment</button>
              </div>
              <div style={styles.bigNumber}>{money(selected.balance)} <span style={{ fontSize: 13, fontWeight: 400, color: colors.inkSoft }}>owed</span></div>

              <div style={styles.panelTitle}>Credit sales</div>
              <div style={styles.stack8}>
                {selectedSales.map((s) => (
                  <div key={s.id} style={styles.rankRow}>
                    <span style={{ flex: 1 }}>Invoice {s.invoiceNo} · {s.date}{s.dueDate ? ` · due ${s.dueDate}` : ""}</span>
                    <span style={styles.mono}>{money(s.balanceDue)}</span>
                  </div>
                ))}
              </div>

              <div style={styles.panelTitle}>Payments received</div>
              {selectedPayments.length === 0 ? (
                <div style={styles.emptyNote}>No repayments recorded yet.</div>
              ) : (
                <div style={styles.stack8}>
                  {selectedPayments.map((p) => (
                    <div key={p.id} style={styles.rankRow}>
                      <span style={{ flex: 1 }}>{p.date}{p.note ? ` — ${p.note}` : ""}</span>
                      <span style={styles.mono}>{money(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {payForm && selected && (
        <Modal onClose={closePay} title={`Record payment — ${selected.name}`}>
          <div style={styles.emptyNote}>Currently owes {money(selected.balance)}.</div>
          <div style={{ ...styles.formGrid, marginTop: 12 }}>
            <Field label={`Amount paid (${CURRENCY})`}>
              <input style={styles.input} type="number" step="0.01" autoFocus value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
            </Field>
            <Field label="Date">
              <input style={styles.input} type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
            </Field>
            <Field label="Note (optional)" span={2}>
              <input style={styles.input} value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} placeholder="e.g. Part payment, balance next week" />
            </Field>
          </div>
          <div style={styles.modalActions}>
            <button style={styles.ghostBtn} onClick={closePay}>Cancel</button>
            <button style={styles.primaryBtn} onClick={savePayment}>Save payment</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- sales history / reports ----------
function Reports({ sales, branches, multiBranch }) {
  const today = todayStr();
  const monthStart = today.slice(0, 8) + "01";
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(today);
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");

  const setQuickRange = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setFromDate(start.toISOString().slice(0, 10));
    setToDate(end.toISOString().slice(0, 10));
  };
  const setThisMonth = () => { setFromDate(monthStart); setToDate(today); };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sales
      .filter((s) => s.date >= fromDate && s.date <= toDate)
      .filter((s) => branchFilter === "all" || s.branchId === branchFilter)
      .filter((s) => {
        if (!q) return true;
        return (
          (s.customerName || "").toLowerCase().includes(q) ||
          String(s.invoiceNo).includes(q) ||
          (s.cashierName || "").toLowerCase().includes(q) ||
          s.items.some((i) => i.name.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => (a.time < b.time ? 1 : -1));
  }, [sales, fromDate, toDate, query, branchFilter]);

  const revenue = filtered.reduce((a, s) => a + s.total, 0);
  const cost = filtered.reduce((a, s) => a + s.cost, 0);
  const profit = revenue - cost;
  const creditCount = filtered.filter((s) => s.paymentType === "credit").length;

  return (
    <div style={styles.stack}>
      <div style={styles.panel}>
        <div style={styles.reportFilterRow}>
          <Field label="From">
            <input style={styles.input} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </Field>
          <Field label="To">
            <input style={styles.input} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </Field>
          {multiBranch && (
            <Field label="Branch">
              <select style={styles.input} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                <option value="all">All branches</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          )}
          <div style={styles.reportQuickBtns}>
            <button style={styles.ghostBtn} onClick={() => setQuickRange(7)}>Last 7 days</button>
            <button style={styles.ghostBtn} onClick={() => setQuickRange(30)}>Last 30 days</button>
            <button style={styles.ghostBtn} onClick={setThisMonth}>This month</button>
          </div>
        </div>
        <div style={{ ...styles.searchBox, marginTop: 12 }}>
          <Search size={16} color={colors.inkSoft} />
          <input placeholder="Search by customer, invoice #, cashier, or item" value={query} onChange={(e) => setQuery(e.target.value)} style={styles.searchInput} />
        </div>
      </div>

      <div style={styles.cardsRow}>
        <StatCard label={`Revenue (${filtered.length} sale${filtered.length === 1 ? "" : "s"})`} value={money(revenue)} accent={colors.amber} />
        <StatCard label="Cost of goods" value={money(cost)} accent={colors.ink} />
        <StatCard label="Profit" value={money(profit)} accent={colors.teal} />
        <StatCard label="Of which on credit" value={creditCount} accent={colors.red} />
      </div>

      <div style={{ ...styles.panel, overflowX: "auto" }}>
        <div style={styles.tableHead}>
          <div style={{ flex: 0.7 }}>Invoice</div>
          <div style={{ flex: 0.9 }}>Date</div>
          {multiBranch && <div style={{ flex: 1 }}>Branch</div>}
          <div style={{ flex: 1.2 }}>Customer</div>
          <div style={{ flex: 1 }}>Cashier</div>
          <div style={{ flex: 0.7 }}>Type</div>
          <div style={{ flex: 0.9, textAlign: "right" }}>Total</div>
          <div style={{ flex: 0.9, textAlign: "right" }}>Profit</div>
        </div>
        {filtered.length === 0 ? (
          <div style={styles.emptyNote}>No sales match this date range/search.</div>
        ) : (
          filtered.map((s) => (
            <div key={s.id} style={styles.tableRow}>
              <div style={{ flex: 0.7, ...styles.mono }}>{s.invoiceNo}</div>
              <div style={{ flex: 0.9, ...styles.mono, fontSize: 12 }}>{s.date}</div>
              {multiBranch && <div style={{ flex: 1, fontSize: 12, color: colors.inkSoft }}>{(branches.find((b) => b.id === s.branchId) || {}).name || "—"}</div>}
              <div style={{ flex: 1.2 }}>{s.customerName || "Walk-in Customer"}</div>
              <div style={{ flex: 1, color: colors.inkSoft }}>{s.cashierName}</div>
              <div style={{ flex: 0.7 }}>{s.paymentType === "credit" ? <span style={styles.creditTag}>Credit</span> : <span style={styles.cashTag}>Cash</span>}</div>
              <div style={{ flex: 0.9, textAlign: "right", ...styles.mono, fontWeight: 600 }}>{money(s.total)}</div>
              <div style={{ flex: 0.9, textAlign: "right", ...styles.mono, color: colors.teal }}>{money(s.total - s.cost)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}



// ---------- camera barcode scanner ----------
// onDetect(code) may return { ok, text } to show feedback. continuous=true keeps the camera open
// (checkout, receiving stock); otherwise it closes after the first successful scan.
function ScannerModal({ title, continuous, onDetect, onClose, summary }) {
  const videoRef = useRef(null);
  const ctrlRef = useRef(null);
  const lastRef = useRef({ code: "", at: 0 });
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [torchOk, setTorchOk] = useState(false);
  const [result, setResult] = useState(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const handle = (raw) => {
      const code = String(raw || "").trim();
      if (!code) return;
      const now = Date.now();
      if (lastRef.current.code === code && now - lastRef.current.at < 1500) { lastRef.current.at = now; return; }
      lastRef.current = { code, at: now };
      const r = onDetectRef.current(code) || { ok: true, text: code };
      feedback(r.ok !== false);
      setResult(r);
      if (r.ok !== false) {
        setCount((n) => n + 1);
        if (!continuous) setTimeout(onClose, 450);
      }
    };
    startScanner(videoRef.current, handle)
      .then((c) => { if (cancelled) { c.stop(); return; } ctrlRef.current = c; setTorchOk(c.torchSupported); setReady(true); })
      .catch((e) => {
        const n = (e && e.name) || "";
        setErr(n === "NotAllowedError" || n === "SecurityError"
          ? "Camera permission was denied. Allow Camera for this app in your phone's Settings > Apps, then try again."
          : n === "NotFoundError" || n === "NoMediaDevices" || n === "OverconstrainedError"
            ? "No usable camera was found on this device."
            : "Could not start the camera. Close other apps that use the camera and try again.");
      });
    return () => { cancelled = true; if (ctrlRef.current) ctrlRef.current.stop(); };
  }, []);

  const toggleTorch = async () => {
    try { await ctrlRef.current.setTorch(!torch); setTorch(!torch); } catch (e) {}
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#000", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "calc(env(safe-area-inset-top, 0px) + 12px) 14px 10px", color: "#fff" }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{title}</div>
        <button type="button" onClick={onClose} style={{ background: "rgba(255,255,255,0.16)", color: "#fff", border: "none", borderRadius: 9, padding: "9px 16px", fontWeight: 700, fontSize: 14 }}>Done</button>
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <video ref={videoRef} playsInline muted autoPlay style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        {!err && (
          <div style={{ position: "absolute", left: "50%", top: "42%", transform: "translate(-50%,-50%)", width: "82%", maxWidth: 420, aspectRatio: "16 / 8", border: `3px solid ${ready ? "#4FD1B5" : "rgba(255,255,255,0.4)"}`, borderRadius: 14, boxShadow: "0 0 0 100vmax rgba(0,0,0,0.38)", pointerEvents: "none" }}>
            <div style={{ position: "absolute", left: 10, right: 10, top: "50%", height: 2, background: "rgba(255,80,80,0.85)" }} />
          </div>
        )}
        {!ready && !err && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14 }}>Starting camera…</div>}
        {err && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, textAlign: "center", padding: 28, lineHeight: 1.5 }}>{err}</div>}
      </div>
      <div style={{ padding: "12px 14px calc(env(safe-area-inset-bottom, 0px) + 14px)", color: "#fff", background: "#111" }}>
        <div style={{ minHeight: 40, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: result ? (result.ok === false ? "#FF9A8B" : "#7BE0C3") : "rgba(255,255,255,0.7)" }}>
            {result ? result.text : "Hold the barcode flat (horizontal) inside the box"}
          </div>
          {torchOk && <button type="button" onClick={toggleTorch} style={{ background: torch ? "#F2C14E" : "rgba(255,255,255,0.16)", color: torch ? "#000" : "#fff", border: "none", borderRadius: 9, padding: "9px 12px", fontWeight: 700, fontSize: 13 }}>🔦 {torch ? "On" : "Light"}</button>}
        </div>
        {continuous && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>{count} scanned{summary ? ` · ${summary}` : ""}</div>}
      </div>
    </div>
  );
}

// ---------- bulk import ----------
function BulkImportModal({ products, setProducts, showToast, activeBranchId, branchName, multiBranch, onClose }) {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [paste, setPaste] = useState("");
  const [mode, setMode] = useState("update");
  const [loadErr, setLoadErr] = useState("");
  const fileRef = useRef(null);

  const plan = useMemo(() => (rows ? buildPlan(rows, products, mode) : null), [rows, products, mode]);

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setLoadErr(""); setFileName(f.name);
    readFileToRows(f).then(setRows).catch((err) => { setRows(null); setLoadErr(err.message); });
    e.target.value = "";
  };
  const usePaste = () => {
    if (!paste.trim()) return;
    setLoadErr(""); setFileName("pasted data"); setRows(parseDelimited(paste));
  };
  const reset = () => { setRows(null); setFileName(""); setPaste(""); setLoadErr(""); };

  const doImport = () => {
    const actionable = plan.rows.filter((r) => r.action !== "skip").length;
    if (!actionable) return;
    setProducts((prev) => applyPlan(prev, plan, activeBranchId, uid));
    const c = plan.counts;
    showToast(`Imported: ${c.add} added, ${c.update} updated${plan.errors.length ? `, ${plan.errors.length} row(s) skipped` : ""}.`);
    onClose();
  };
  const actionable = plan ? plan.rows.filter((r) => r.action !== "skip").length : 0;
  const tag = (a) => a === "add" ? "New" : a === "skip" ? "Skip" : a === "addstock" ? "+Stock" : "Update";

  return (
    <Modal onClose={onClose} title="Import / export inventory">
      <div style={styles.stack}>
        {!rows && (
          <>
            <div style={styles.emptyNote}>
              Upload a spreadsheet (<b>.xlsx</b>, <b>.xls</b> or <b>.csv</b>) or paste rows copied from Excel. The first row must be headers:
              <span style={styles.mono}> name, sku, barcode, category, cost, price, stock, low_stock</span>. Only <b>name</b> and <b>price</b> are required. Stock is counted for <b>{multiBranch ? branchName : "this shop"}</b>.
            </div>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={onFile} style={{ display: "none" }} />
            <button style={styles.primaryBtn} onClick={() => fileRef.current && fileRef.current.click()}><UploadIcon size={14} /> Choose file</button>
            <Field label="…or paste rows here (copy from Excel / Google Sheets, include the header row)">
              <textarea style={{ ...styles.input, ...styles.mono, fontSize: 12, minHeight: 90 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"name\tprice\tstock\nWhole Milk 1L\t1200\t24"} spellCheck={false} />
            </Field>
            {paste.trim() && <button style={styles.ghostBtn} onClick={usePaste}>Read pasted rows</button>}
            {loadErr && <div style={styles.loginError}>{loadErr}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={styles.ghostBtn} onClick={() => saveAndShare("tally-inventory-template.csv", TEMPLATE_CSV, "text/csv")}><DownloadIcon size={14} /> Download template</button>
              <button style={styles.ghostBtn} onClick={() => saveAndShare(`tally-inventory-${todayStr()}.csv`, inventoryToCsv(products, activeBranchId), "text/csv").then(() => showToast("Inventory file ready.")).catch(() => showToast("Could not create the file.", "err"))}><DownloadIcon size={14} /> Export current stock</button>
            </div>
            <div style={{ ...styles.emptyNote, paddingTop: 0 }}>Tip: export your current stock, edit it in Excel, then import it back to update many products at once.</div>
          </>
        )}

        {rows && plan && (
          <>
            <div style={{ fontSize: 13, color: colors.inkSoft }}>File: <b style={{ color: colors.ink }}>{fileName}</b></div>
            {plan.fatal ? (
              <div style={styles.loginError}>{plan.fatal}</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={styles.statCard}><div style={styles.statLabel}>New products</div><div style={{ ...styles.mono, fontSize: 20, fontWeight: 700, paddingLeft: 6 }}>{plan.counts.add}</div></div>
                  <div style={styles.statCard}><div style={styles.statLabel}>Existing (matched by SKU)</div><div style={{ ...styles.mono, fontSize: 20, fontWeight: 700, paddingLeft: 6 }}>{plan.counts.update + plan.counts.skip}</div></div>
                </div>
                {(plan.counts.update + plan.counts.skip) > 0 && (
                  <Field label="For products that already exist">
                    <select style={styles.input} value={mode} onChange={(e) => setMode(e.target.value)}>
                      <option value="update">Update details and set stock to the file's number</option>
                      <option value="addstock">Add the file's stock number to current stock</option>
                      <option value="skip">Leave existing products alone</option>
                    </select>
                  </Field>
                )}
                {plan.missingColumns.includes("price") && <div style={styles.emptyNote}>No "price" column found, so new products can't be added (existing ones can still be updated).</div>}
                <div style={{ border: `1px solid ${colors.line}`, borderRadius: 9, maxHeight: 190, overflowY: "auto" }}>
                  {plan.rows.slice(0, 8).map((r) => (
                    <div key={r.line} style={{ display: "flex", gap: 8, padding: "7px 10px", borderBottom: `1px solid ${colors.line}`, fontSize: 12, alignItems: "center" }}>
                      <span style={{ ...styles.mono, width: 52, color: r.action === "add" ? colors.teal : r.action === "skip" ? colors.inkSoft : colors.amber, fontWeight: 700 }}>{tag(r.action)}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.data.name}</span>
                      <span style={styles.mono}>{r.data.price != null ? money(r.data.price) : ""}</span>
                      <span style={{ ...styles.mono, color: colors.inkSoft, width: 40, textAlign: "right" }}>{r.data.stock != null ? r.data.stock : ""}</span>
                    </div>
                  ))}
                  {plan.rows.length > 8 && <div style={{ padding: "7px 10px", fontSize: 12, color: colors.inkSoft }}>…and {plan.rows.length - 8} more</div>}
                </div>
                {plan.errors.length > 0 && (
                  <div style={styles.loginError}>
                    <b>{plan.errors.length} row(s) have problems and will be skipped:</b>
                    <div style={{ marginTop: 4, maxHeight: 110, overflowY: "auto", fontWeight: 500 }}>
                      {plan.errors.slice(0, 20).map((e, i) => <div key={i}>Row {e.line}: {e.msg}</div>)}
                      {plan.errors.length > 20 && <div>…and {plan.errors.length - 20} more</div>}
                    </div>
                  </div>
                )}
              </>
            )}
            <div style={styles.modalActions}>
              <button style={styles.ghostBtn} onClick={reset}>Choose another file</button>
              {!plan.fatal && <button style={{ ...styles.primaryBtn, opacity: actionable ? 1 : 0.5 }} disabled={!actionable} onClick={doImport}>Import {actionable} product{actionable === 1 ? "" : "s"}</button>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------- team (user accounts) ----------
function emptyUser(branches) {
  return { mode: "add", username: "", password: "", role: "staff", name: "", branchId: branches[0] ? branches[0].id : "" };
}

function Team({ users, setUsers, currentUser, showToast, branches, multiBranch }) {
  const [form, setForm] = useState(null);
  const openAdd = () => setForm(emptyUser(branches));
  const openEdit = (u) => setForm({ mode: "edit", id: u.id, name: u.name, role: u.role, branchId: u.branchId || (branches[0] && branches[0].id) });
  const close = () => setForm(null);

  const saveNew = () => {
    if (!form.username.trim() || !form.password || !form.name.trim()) {
      showToast("Name, username, and password are all required.", "err");
      return;
    }
    if (form.password.length < 4) {
      showToast("Password must be at least 4 characters.", "err");
      return;
    }
    const dupe = users.find((u) => u.username.toLowerCase() === form.username.trim().toLowerCase());
    if (dupe) { showToast("That username is already taken — pick another.", "err"); return; }
    const newUser = { id: "u-" + uid(), username: form.username.trim(), password: form.password, name: form.name.trim(), role: form.role, branchId: form.branchId };
    setUsers((prev) => [...prev, newUser]);
    showToast(`${form.name} can now sign in with that username and password.`);
    close();
  };

  const saveEdit = () => {
    if (!form.name.trim()) { showToast("Name is required.", "err"); return; }
    if (form.id === currentUser.id && form.role !== "admin") {
      showToast("You can't remove your own admin access while signed in.", "err");
      return;
    }
    if (form.role !== "admin") {
      const original = users.find((u) => u.id === form.id);
      const otherAdmins = users.filter((x) => x.role === "admin" && x.id !== form.id);
      if (original && original.role === "admin" && otherAdmins.length === 0) {
        showToast("At least one admin account is required.", "err");
        return;
      }
    }
    setUsers((prev) => prev.map((u) => u.id === form.id ? { ...u, name: form.name.trim(), role: form.role, branchId: form.branchId } : u));
    showToast("Account updated.");
    close();
  };

  const save = () => (form.mode === "edit" ? saveEdit() : saveNew());

  const resetPassword = (u) => {
    const next = window.prompt(`New password for ${u.name} (at least 4 characters):`);
    if (next === null) return;
    if (next.length < 4) { showToast("Password must be at least 4 characters.", "err"); return; }
    setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, password: next } : x));
    showToast("Password updated.");
  };

  const remove = (u) => {
    if (u.id === currentUser.id) { showToast("You can't remove your own account while signed in.", "err"); return; }
    const admins = users.filter((x) => x.role === "admin");
    if (u.role === "admin" && admins.length <= 1) { showToast("At least one admin account is required.", "err"); return; }
    setUsers((prev) => prev.filter((x) => x.id !== u.id));
    showToast("Staff account removed.");
  };

  return (
    <div style={styles.stack}>
      <div style={styles.toolbar}>
        <div style={styles.panelTitle}>Team accounts</div>
        <button style={styles.primaryBtn} onClick={openAdd}><Plus size={16} /> Add staff account</button>
      </div>
      <div style={styles.panel}>
        <div style={styles.stack8}>
          {users.map((u) => (
            <div key={u.id} style={styles.userRow}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{u.name} {u.id === currentUser.id && <span style={styles.youTag}>you</span>}</div>
                <div style={{ ...styles.mono, fontSize: 11, color: colors.inkSoft }}>@{u.username} · {u.role === "admin" ? "Owner / Admin" : "Staff"}{multiBranch ? ` · ${(branches.find((b) => b.id === u.branchId) || {}).name || "No branch"}` : ""}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={styles.iconBtn} onClick={() => openEdit(u)}><Pencil size={14} /></button>
                <button style={styles.iconBtn} onClick={() => resetPassword(u)} title="Reset password"><Lock size={13} /></button>
                <button style={styles.iconBtnDanger} onClick={() => remove(u)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {form && form.mode === "add" && (
        <Modal onClose={close} title="Add a staff account">
          <div style={styles.formGrid}>
            <Field label="Full name" span={2}>
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Priya Nair" />
            </Field>
            <Field label="Username" span={2}>
              <input style={styles.input} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. musa" />
            </Field>
            <Field label="Password" span={2}>
              <input style={styles.input} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 4 characters" />
            </Field>
            <Field label="Role">
              <select style={styles.input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">Staff — till access only</option>
                <option value="admin">Admin — full access</option>
              </select>
            </Field>
            {branches.length > 1 && (
              <Field label="Branch">
                <select style={styles.input} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <div style={styles.modalActions}>
            <button style={styles.ghostBtn} onClick={close}>Cancel</button>
            <button style={styles.primaryBtn} onClick={save}>Create account</button>
          </div>
        </Modal>
      )}

      {form && form.mode === "edit" && (
        <Modal onClose={close} title="Edit staff account">
          <div style={styles.formGrid}>
            <Field label="Full name" span={2}>
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Priya Nair" />
            </Field>
            <Field label="Role">
              <select style={styles.input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">Staff — till access only</option>
                <option value="admin">Admin — full access</option>
              </select>
            </Field>
            {branches.length > 1 && (
              <Field label="Branch">
                <select style={styles.input} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
          </div>
          <div style={styles.emptyNote}>Use the lock icon on the list to reset this person's password.</div>
          <div style={styles.modalActions}>
            <button style={styles.ghostBtn} onClick={close}>Cancel</button>
            <button style={styles.primaryBtn} onClick={save}>Save changes</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- branches management ----------
function emptyBranch() {
  return { id: null, name: "", address: "", phone: "" };
}

function BranchManager({ branches, setBranches, products, sales, purchases, expenses, users, showToast }) {
  const [form, setForm] = useState(null);
  const openAdd = () => setForm(emptyBranch());
  const openEdit = (b) => setForm({ ...b });
  const close = () => setForm(null);

  const save = () => {
    if (!form.name.trim()) { showToast("Branch name is required.", "err"); return; }
    if (form.id) {
      setBranches((prev) => prev.map((b) => b.id === form.id ? { ...b, name: form.name.trim(), address: form.address, phone: form.phone } : b));
      showToast("Branch updated.");
    } else {
      setBranches((prev) => [...prev, { id: "br-" + uid(), name: form.name.trim(), address: form.address, phone: form.phone }]);
      showToast("Branch added.");
    }
    close();
  };

  const inUse = (id) => {
    return sales.some((s) => s.branchId === id) || purchases.some((p) => p.branchId === id) || expenses.some((e) => e.branchId === id) || users.some((u) => u.branchId === id);
  };

  const remove = (b) => {
    if (branches.length <= 1) { showToast("At least one branch is required.", "err"); return; }
    if (inUse(b.id)) { showToast("This branch has sales, purchases, expenses, or staff tied to it — can't remove it.", "err"); return; }
    setBranches((prev) => prev.filter((x) => x.id !== b.id));
    showToast("Branch removed.");
  };

  return (
    <div style={styles.panel}>
      <div style={styles.toolbar}>
        <div style={styles.panelTitle}>Branches</div>
        <button style={styles.primaryBtn} onClick={openAdd}><Plus size={16} /> Add branch</button>
      </div>
      <div style={styles.stack8}>
        {branches.map((b) => (
          <div key={b.id} style={styles.userRow}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{b.name}</div>
              <div style={{ fontSize: 11, color: colors.inkSoft }}>{b.address || "No address set"}{b.phone ? ` · ${b.phone}` : ""}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={styles.iconBtn} onClick={() => openEdit(b)}><Pencil size={14} /></button>
              <button style={styles.iconBtnDanger} onClick={() => remove(b)}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      {form && (
        <Modal onClose={close} title={form.id ? "Edit branch" : "Add branch"}>
          <div style={styles.formGrid}>
            <Field label="Branch name" span={2}>
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Tarauni Branch" />
            </Field>
            <Field label="Address" span={2}>
              <input style={styles.input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Leave blank to use the main shop address" />
            </Field>
            <Field label="Phone" span={2}>
              <input style={styles.input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Leave blank to use the main shop phone" />
            </Field>
          </div>
          <div style={styles.modalActions}>
            <button style={styles.ghostBtn} onClick={close}>Cancel</button>
            <button style={styles.primaryBtn} onClick={save}>{form.id ? "Save changes" : "Add branch"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- shop settings ----------
function ShopSettings({ settings, setSettings, showToast, branches, setBranches, onResetTransactions, onResetEverything, fullState, restoreAll }) {
  const [form, setForm] = useState(settings);
  const [confirmMode, setConfirmMode] = useState(null); // null | "figures" | "everything" | "restore"
  const [confirmText, setConfirmText] = useState("");
  const [restoreData, setRestoreData] = useState(null);
  const fileInputRef = useRef(null);

  const save = () => {
    if (!form.shopName.trim()) { showToast("Shop name is required.", "err"); return; }
    setSettings(form);
    showToast("Shop details saved — they'll appear on your next receipt.");
  };

  const closeConfirm = () => { setConfirmMode(null); setConfirmText(""); setRestoreData(null); };

  const doResetFigures = () => {
    onResetTransactions();
    closeConfirm();
    showToast("Figures reset to zero. Your product list and stock levels were kept.");
  };
  const doResetFiguresWithStock = () => {
    onResetTransactions();
    closeConfirm();
    showToast("Figures reset to zero and product list kept.");
  };

  const doResetEverything = () => {
    onResetEverything();
    closeConfirm();
    showToast("All shop data has been erased. Staff accounts, branches, and shop details were kept.");
  };

  const downloadBackup = () => {
    saveAndShare(`tally-backup-${todayStr()}.json`, JSON.stringify(fullState, null, 2), "application/json")
      .then(() => showToast("Backup ready."))
      .catch(() => showToast("Could not create the backup.", "err"));
  };

  const onFilePicked = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        setRestoreData(data);
        setConfirmMode("restore");
      } catch (err) {
        showToast("That doesn't look like a valid Tally backup file.", "err");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const doRestore = () => {
    restoreAll(restoreData);
    closeConfirm();
    showToast("Backup restored.");
  };

  return (
    <div style={styles.stack}>
      <div style={styles.panelTitle}>Shop details</div>
      <div style={styles.panel}>
        <div style={styles.emptyNote}>This is the default info used on receipts when a branch doesn't set its own address/phone.</div>
        <div style={{ ...styles.formGrid, marginTop: 12 }}>
          <Field label="Shop name" span={2}>
            <input style={styles.input} value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} placeholder="e.g. Almaruf Global Concept" />
          </Field>
          <Field label="Tagline" span={2}>
            <input style={styles.input} value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="e.g. Wholesale and Retail of General Provision" />
          </Field>
          <Field label="Address" span={2}>
            <input style={styles.input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="e.g. Opposite specialist hospital, Bauchi Road" />
          </Field>
          <Field label="Phone number(s)">
            <input style={styles.input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 08169500844" />
          </Field>
        </div>
        <div style={styles.modalActions}>
          <button style={styles.primaryBtn} onClick={save}>Save shop details</button>
        </div>
      </div>

      <BranchManager
        branches={branches} setBranches={setBranches} showToast={showToast}
        products={fullState.products} sales={fullState.sales} purchases={fullState.purchases} expenses={fullState.expenses} users={fullState.users}
      />

      <div style={styles.panelTitle}>Backup & restore</div>
      <div style={styles.panel}>
        <div style={styles.emptyNote}>
          Tally now runs fully offline — all your data lives only in this browser. There is no cloud
          copy, so if this browser's data is ever cleared, it's gone unless you've backed it up. Download
          a backup regularly, especially before clearing browser data or switching computers.
        </div>
        <div style={styles.modalActions}>
          <input ref={fileInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={onFilePicked} />
          <button style={styles.ghostBtn} onClick={() => fileInputRef.current.click()}><UploadIcon size={14} /> Restore from backup…</button>
          <button style={styles.primaryBtn} onClick={downloadBackup}><DownloadIcon size={14} /> Save / share backup (.json)</button>
        </div>
      </div>

      <div style={styles.panelTitle}>Danger zone</div>
      <div style={{ ...styles.panel, borderColor: colors.red }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Reset figures (keep product list & stock)</div>
        <div style={styles.emptyNote}>
          Clears all sales history, purchases, expenses, and credit payments — so Today's revenue, Today's
          net profit, All-time net profit, and outstanding credit all go back to zero. Your product names,
          SKUs, prices, costs, and current stock levels stay exactly as they are. This cannot be undone.
        </div>
        <div style={styles.modalActions}>
          <button style={styles.dangerBtn} onClick={() => setConfirmMode("figures")}>Reset figures…</button>
        </div>
      </div>

      <div style={{ ...styles.panel, borderColor: colors.red }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Reset everything</div>
        <div style={styles.emptyNote}>
          Permanently deletes every product, sale, purchase order, expense, customer, and credit payment.
          Staff accounts, branches, and your shop details above are kept. This cannot be undone.
        </div>
        <div style={styles.modalActions}>
          <button style={styles.dangerBtn} onClick={() => setConfirmMode("everything")}>Reset all data…</button>
        </div>
      </div>

      {confirmMode === "figures" && (
        <Modal onClose={closeConfirm} title="Reset figures to zero?">
          <div style={styles.emptyNote}>
            This will permanently delete <b>all sales, purchase orders, expenses, and credit payments</b>.
            Your product list and current stock levels will NOT be touched. This cannot be undone.
          </div>
          <div style={{ marginTop: 14 }}>
            <Field label='Type "RESET" to confirm'>
              <input style={styles.input} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESET" />
            </Field>
          </div>
          <div style={styles.modalActions}>
            <button style={styles.ghostBtn} onClick={closeConfirm}>Cancel</button>
            <button style={styles.dangerBtn} disabled={confirmText !== "RESET"} onClick={doResetFigures}>Yes, reset figures</button>
          </div>
        </Modal>
      )}

      {confirmMode === "everything" && (
        <Modal onClose={closeConfirm} title="Reset all shop data?">
          <div style={styles.emptyNote}>
            This will permanently delete <b>all products, sales, purchase orders, expenses, customers, and credit payments</b>.
            Staff accounts, branches, and your shop name/address/phone will NOT be deleted. This cannot be undone.
          </div>
          <div style={{ marginTop: 14 }}>
            <Field label='Type "DELETE" to confirm'>
              <input style={styles.input} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
            </Field>
          </div>
          <div style={styles.modalActions}>
            <button style={styles.ghostBtn} onClick={closeConfirm}>Cancel</button>
            <button style={styles.dangerBtn} disabled={confirmText !== "DELETE"} onClick={doResetEverything}>Yes, delete everything</button>
          </div>
        </Modal>
      )}

      {confirmMode === "restore" && restoreData && (
        <Modal onClose={closeConfirm} title="Restore this backup?">
          <div style={styles.emptyNote}>
            This will replace your current shop data with the contents of the backup file you picked.
            Anything entered since that backup was made will be lost. This cannot be undone.
          </div>
          <div style={styles.modalActions}>
            <button style={styles.ghostBtn} onClick={closeConfirm}>Cancel</button>
            <button style={styles.dangerBtn} onClick={doRestore}>Yes, restore from backup</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- shared bits ----------
function Modal({ title, onClose, children }) {
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHead}>
          <div style={styles.modalTitle}>{title}</div>
          <button style={styles.iconBtn} onClick={onClose}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, span }) {
  return (
    <label style={{ ...styles.field, gridColumn: span ? `span ${span}` : undefined }}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

// ---------- design tokens ----------
const colors = {
  bg: "#F4F3EE",
  panel: "#FFFFFF",
  ink: "#20241F",
  inkSoft: "#6B6F63",
  line: "#E4E1D8",
  teal: "#2F6B5E",
  amber: "#C98A2E",
  red: "#B44432",
};

const globalCss = `
  * { box-sizing: border-box; }
  input, select { font-family: 'Inter', sans-serif; }
  input:focus, select:focus { outline: 2px solid ${colors.teal}; outline-offset: 1px; }
  button:focus-visible { outline: 2px solid ${colors.teal}; outline-offset: 2px; }
  button { cursor: pointer; font-family: 'Inter', sans-serif; }
  ::placeholder { color: #A9AC9F; }

  html, body { margin: 0; background: ${colors.bg}; -webkit-tap-highlight-color: transparent; overscroll-behavior: none; }
  body { padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
  button { touch-action: manipulation; }
  @media (max-width: 760px) {
    .tb { flex-wrap: wrap !important; padding: 10px 12px !important; gap: 8px !important; }
    .tb-nav { order: 3; flex: 1 1 100% !important; }
    .tb-user { margin-left: auto; }
    .tb-user [style*="text-align: right"] { max-width: 110px; }
    main { padding: 14px 12px 80px !important; }
    [style*="grid-template-columns: 1.3fr 1fr"],
    [style*="grid-template-columns: 1.2fr 0.9fr"] { grid-template-columns: 1fr !important; }
    [style*="repeat(4, 1fr)"], [style*="repeat(3, 1fr)"] { grid-template-columns: 1fr 1fr !important; }
    [style*="position: sticky"][style*="top: 90px"] { position: static !important; }
    [style*="width: 28px"][style*="height: 28px"] { width: 38px !important; height: 38px !important; }
    input, select { font-size: 16px !important; }
    button { min-height: 38px; }
  }
  @media (max-width: 420px) {
    [style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
    [style*="grid-column: span 2"] { grid-column: auto !important; }
  }
  @media print {
    body * { visibility: hidden; }
    #printable-receipt, #printable-receipt * { visibility: visible; }
    #printable-receipt {
      position: absolute; top: 0; left: 0;
      width: 72mm; max-width: 72mm;
      padding: 4mm !important;
      font-size: 11px;
    }
  }
`;

const styles = {
  app: { minHeight: "100vh", background: colors.bg, fontFamily: "'Inter', sans-serif", color: colors.ink },
  main: { maxWidth: 1180, margin: "0 auto", padding: "24px 20px 60px" },
  loading: { padding: 60, textAlign: "center", color: colors.inkSoft, fontFamily: "IBM Plex Mono, monospace" },

  loginWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  loginCard: { background: colors.panel, borderRadius: 14, border: `1px solid ${colors.line}`, padding: 28, width: "100%", maxWidth: 360, boxShadow: "0 6px 24px rgba(0,0,0,0.06)" },
  loginBrandRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 22 },
  loginHeading: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 14 },
  loginError: { background: "#FBF1EC", color: colors.red, fontSize: 12, padding: "8px 10px", borderRadius: 7, fontWeight: 600 },
  loginHint: { marginTop: 18, fontSize: 11, color: colors.inkSoft, textAlign: "center", lineHeight: 1.6 },
  inputIconRow: { display: "flex", alignItems: "center", gap: 8, border: `1px solid ${colors.line}`, borderRadius: 8, padding: "9px 10px" },
  inputBare: { border: "none", outline: "none", flex: 1, fontSize: 14, background: "transparent" },

  topbar: { position: "sticky", top: 0, zIndex: 10, background: colors.bg, borderBottom: `1px solid ${colors.line}`, padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "nowrap", gap: 12 },
  brand: { display: "flex", alignItems: "center", gap: 10 },
  brandMark: { width: 34, height: 34, borderRadius: 8, background: colors.ink, color: colors.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16 },
  brandName: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17, lineHeight: 1.1 },
  brandSub: { fontSize: 11, color: colors.inkSoft, letterSpacing: 0.3, textTransform: "uppercase" },
  nav: { display: "flex", gap: 4, background: "#EAE8E0", padding: 4, borderRadius: 10, flexWrap: "nowrap", overflowX: "auto", flex: "1 1 auto", minWidth: 0, scrollbarWidth: "thin" },
  navBtn: { display: "flex", alignItems: "center", gap: 5, padding: "7px 10px", borderRadius: 8, border: "none", background: "transparent", color: colors.inkSoft, fontSize: 12.5, fontWeight: 600, position: "relative", whiteSpace: "nowrap", flexShrink: 0 },
  navBtnActive: { background: colors.panel, color: colors.ink, boxShadow: "0 1px 2px rgba(0,0,0,0.08)" },
  navBadge: { background: colors.red, color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 6px", marginLeft: 2 },
  userChip: { display: "flex", alignItems: "center", gap: 10, background: "#EAE8E0", padding: "6px 8px 6px 12px", borderRadius: 10 },
  userChipInfo: { textAlign: "right" },
  userChipName: { fontSize: 12, fontWeight: 700 },
  userChipRole: { fontSize: 10, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: 0.3 },
  branchSwitch: { display: "flex", alignItems: "center", gap: 6, background: "#EAF2EF", border: `1px solid ${colors.teal}`, borderRadius: 9, padding: "5px 9px" },
  branchSelect: { border: "none", background: "transparent", outline: "none", fontSize: 12, fontWeight: 700, color: colors.teal },

  stack: { display: "flex", flexDirection: "column", gap: 16 },
  stack8: { display: "flex", flexDirection: "column", gap: 8 },
  gridTwo: { display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 },
  cardsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 },
  cardsRow3: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 },

  statCard: { background: colors.panel, borderRadius: 12, padding: "16px 18px", border: `1px solid ${colors.line}`, position: "relative", overflow: "hidden" },
  statAccent: { position: "absolute", top: 0, left: 0, width: 4, height: "100%" },
  statLabel: { fontSize: 12, color: colors.inkSoft, marginBottom: 6, paddingLeft: 6 },
  statValue: { fontSize: 24, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, paddingLeft: 6 },

  panel: { background: colors.panel, borderRadius: 12, padding: 18, border: `1px solid ${colors.line}` },
  panelTitle: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 12 },
  emptyNote: { color: colors.inkSoft, fontSize: 13, padding: "8px 0" },
  bigNumber: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 30, fontWeight: 700, margin: "6px 0" },

  lowStockRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#FBF1EC", borderRadius: 8 },
  lowStockName: { fontWeight: 600, fontSize: 13 },
  lowStockSku: { fontSize: 11, color: colors.inkSoft, fontFamily: "'IBM Plex Mono', monospace" },
  lowStockQty: { fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, color: colors.red, fontSize: 13 },

  rankRow: { display: "flex", alignItems: "center", gap: 10, fontSize: 13, padding: "6px 0" },
  rankNum: { fontFamily: "'IBM Plex Mono', monospace", color: colors.inkSoft, fontSize: 12 },
  rankQty: { fontFamily: "'IBM Plex Mono', monospace", color: colors.inkSoft, fontSize: 12 },

  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  searchBox: { display: "flex", alignItems: "center", gap: 8, background: colors.panel, border: `1px solid ${colors.line}`, borderRadius: 10, padding: "10px 12px", flex: 1 },
  searchInput: { border: "none", outline: "none", flex: 1, fontSize: 14, background: "transparent" },
  scanBox: { display: "flex", alignItems: "center", gap: 8, background: "#EAF2EF", border: `1.5px solid ${colors.teal}`, borderRadius: 10, padding: "12px 14px", position: "relative" },
  camBtn: { background: "#EAF2EF", border: `1px solid ${colors.teal}`, borderRadius: 9, padding: "6px 10px", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  scanCamBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: colors.teal, color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", flexShrink: 0 },
  scanFlash: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: colors.teal, whiteSpace: "nowrap" },

  primaryBtn: { display: "flex", alignItems: "center", gap: 6, background: colors.ink, color: colors.bg, border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 600, fontSize: 13 },
  dangerBtn: { display: "flex", alignItems: "center", gap: 6, background: colors.red, color: "#fff", border: "none", borderRadius: 9, padding: "10px 16px", fontWeight: 600, fontSize: 13 },
  ghostBtn: { display: "flex", alignItems: "center", gap: 6, background: "transparent", color: colors.ink, border: `1px solid ${colors.line}`, borderRadius: 9, padding: "10px 16px", fontWeight: 600, fontSize: 13 },
  iconBtn: { background: "#F0EEE6", border: "none", borderRadius: 7, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", color: colors.ink },
  iconBtnDanger: { background: "#FBF1EC", border: "none", borderRadius: 7, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", color: colors.red },

  tableHead: { minWidth: 640, display: "flex", padding: "0 10px 10px", borderBottom: `1px solid ${colors.line}`, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, color: colors.inkSoft, fontWeight: 700 },
  tableRow: { minWidth: 640, display: "flex", alignItems: "center", padding: "12px 10px", borderBottom: `1px solid ${colors.line}`, fontSize: 13 },
  mono: { fontFamily: "'IBM Plex Mono', monospace" },

  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: 0.3 },
  input: { border: `1px solid ${colors.line}`, borderRadius: 8, padding: "9px 10px", fontSize: 14, width: "100%" },

  modalOverlay: { position: "fixed", inset: 0, background: "rgba(32,36,31,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 },
  modal: { background: colors.panel, borderRadius: 14, padding: 22, width: "100%", maxWidth: 460, maxHeight: "88vh", overflowY: "auto" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17 },
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6, flexWrap: "wrap" },

  checkoutGrid: { display: "grid", gridTemplateColumns: "1.2fr 0.9fr", gap: 18, alignItems: "start" },
  resultRow: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${colors.line}`, padding: "10px 4px", fontSize: 14 },
  quickGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  quickTile: { textAlign: "left", background: "#F7F6F1", border: `1px solid ${colors.line}`, borderRadius: 9, padding: "10px 12px" },

  receipt: { background: colors.panel, border: `1px solid ${colors.line}`, borderRadius: 4, padding: "20px 20px 22px", position: "sticky", top: 90, boxShadow: "0 2px 10px rgba(0,0,0,0.04)" },
  receiptTitle: { fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 12, letterSpacing: 1.2, textAlign: "center" },
  receiptDivider: { borderTop: `1.5px dashed ${colors.line}`, margin: "12px 0" },
  receiptLines: { display: "flex", flexDirection: "column", gap: 12 },
  receiptLine: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" },
  receiptItemName: { fontSize: 13, fontWeight: 600 },
  qtyControls: { display: "flex", alignItems: "center", gap: 8, marginTop: 4 },
  qtyBtn: { width: 20, height: 20, borderRadius: 5, border: `1px solid ${colors.line}`, background: "#F7F6F1", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" },
  removeLink: { background: "none", border: "none", color: colors.inkSoft, fontSize: 11, textDecoration: "underline", padding: 0 },
  receiptTotalRow: { display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" },
  receiptSubRow: { display: "flex", justifyContent: "space-between", fontSize: 12, color: colors.inkSoft, marginTop: 4 },
  checkoutBtn: { width: "100%", marginTop: 16, background: colors.teal, color: "#fff", border: "none", borderRadius: 9, padding: "13px", fontWeight: 700, fontSize: 14 },
  receiptPrintArea: { border: `1.5px dashed ${colors.line}`, borderRadius: 4, padding: "18px 16px", marginBottom: 4 },
  creditPrintArea: { borderColor: colors.red },
  receiptMeta: { fontSize: 12, color: colors.inkSoft, display: "flex", flexDirection: "column", gap: 2 },
  receiptFooter: { textAlign: "center", fontSize: 11, color: colors.inkSoft, marginTop: 10, fontStyle: "italic" },
  invoiceShopName: { fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 16, textAlign: "center" },
  invoiceTagline: { fontSize: 11, color: colors.inkSoft, textAlign: "center" },
  invoiceBranchLine: { fontSize: 12, fontWeight: 700, color: colors.teal, textAlign: "center", marginTop: 2 },
  invoiceMetaLine: { fontSize: 11, color: colors.inkSoft, textAlign: "center" },
  invoiceLabel: { fontWeight: 700, fontSize: 12, letterSpacing: 1, textAlign: "center", marginBottom: 8 },
  invoiceTableHead: { display: "flex", fontSize: 11, fontWeight: 700, color: colors.inkSoft, textTransform: "uppercase", borderBottom: `1px solid ${colors.line}`, paddingBottom: 6, marginBottom: 6 },
  invoiceTableRow: { display: "flex", fontSize: 12, padding: "4px 0" },
  signatureRow: { display: "flex", justifyContent: "space-between", fontSize: 11, color: colors.inkSoft, marginTop: 10 },
  receiptPrintedOn: { fontSize: 10, color: colors.inkSoft, textAlign: "center", marginTop: 10 },
  checkoutFields: { display: "flex", flexDirection: "column", gap: 8, marginTop: 12 },
  paymentToggleRow: { display: "flex", gap: 6, marginTop: 14 },
  paymentToggleBtn: { flex: 1, padding: "9px 10px", borderRadius: 8, border: `1px solid ${colors.line}`, background: "#F7F6F1", fontWeight: 700, fontSize: 12.5, color: colors.inkSoft },
  paymentToggleBtnActive: { background: colors.teal, color: "#fff", border: `1px solid ${colors.teal}` },
  paymentToggleBtnActiveCredit: { background: colors.red, color: "#fff", border: `1px solid ${colors.red}` },

  poCard: { border: `1px solid ${colors.line}`, borderRadius: 10, padding: 14 },
  poHead: { display: "flex", justifyContent: "space-between", marginBottom: 8 },
  poItems: { display: "flex", flexDirection: "column", gap: 4 },
  poItemRow: { display: "flex", justifyContent: "space-between", fontSize: 12, color: colors.inkSoft },
  poLines: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 },
  poLineRow: { display: "flex", gap: 8, alignItems: "center" },
  poTotal: { display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 15, padding: "10px 0", borderTop: `1px solid ${colors.line}` },

  expenseRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderBottom: `1px solid ${colors.line}` },
  userRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", border: `1px solid ${colors.line}`, borderRadius: 9 },
  youTag: { fontSize: 10, fontWeight: 700, color: colors.teal, marginLeft: 6, textTransform: "uppercase" },

  creditCustomerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "#F7F6F1", border: `1px solid ${colors.line}`, borderRadius: 9, padding: "10px 12px", textAlign: "left" },
  creditCustomerRowActive: { background: "#FBF1EC", borderColor: colors.red },
  creditTag: { background: "#FBF1EC", color: colors.red, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, textTransform: "uppercase" },
  cashTag: { background: "#EAF2EF", color: colors.teal, fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, textTransform: "uppercase" },

  toast: { position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: colors.ink, color: colors.bg, padding: "10px 16px", borderRadius: 9, display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, boxShadow: "0 4px 14px rgba(0,0,0,0.2)", zIndex: 100 },
  toastErr: { background: colors.red },
  reportFilterRow: { display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" },
  reportQuickBtns: { display: "flex", gap: 8, flexWrap: "wrap" },
};

// Seed default data BEFORE the first render so the admin account exists on a fresh install.
seedIfEmpty();
createRoot(document.getElementById("root")).render(<Root />);


