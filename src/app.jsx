import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./native.js";
import { saveAndShare, shareText, saveAndShareBase64, openExternal } from "./native.js";
import { isBelowCost, marginPct, byProduct, byCashier, byPayment, byDay, profitSummary, dayClose, dayCloseText, normalizePhone, reminderMessage, waLink, smsLink, pickQuickProducts, buildReportWorkbook, payLabel, collectedNet } from "./finance.js";
import { startScanner, feedback } from "./scanner.js";
import { printerAvailable, listPairedDevices, bluetoothStatus, openBluetoothSettings } from "./printer-bridge.js";
import { getPrinter, setPrinter, printBytes, buildSale, buildPayment, buildText, buildTest } from "./printer.js";
import { TEMPLATE_CSV, readFileToRows, buildPlan, applyPlan, inventoryToCsv, parseDelimited } from "./bulk.js";
import { renderReceiptPng } from "./receipt-image.js";
import { repriceSale, reviseSale, stockDiffs } from "./saleedit.js";
import { getUi, setUi, applyUi, THEMES, TEXT_SIZES } from "./appearance.js";
import { LOGO_MARK } from "./logo.js";
import { hasPin, setPin, clearPin, isLockedFlag, setLockedFlag } from "./security.js";
import { LockScreen, OwnerApproval, PinSetup } from "./security.jsx";
import { lineGross, lineDiscount, lineTotal, saleSubtotal, saleDiscount, saleQty, saleNet, saleNetCost, saleRefunded, saleReturns, buildReturn, returnableQty, discountAmount, priceCart, canEditSale, effectiveUnit, round2 } from "./lines.js";
import { LICENSE_CONFIG } from "./license-config.js";
import { localDateStr } from "./dates.js";
import { CloudPanel } from "./cloud/CloudPanel.jsx";
import { SyncChip, SyncCenter, CloudLoginScreen, SyncBadge } from "./cloud/SyncUI.jsx";
import { runtime, makeId, numberLabel, cloudUserFrom } from "./cloud/session.js";
import { deriveOps } from "./cloud/ops.js";
import { mergeById, CURSOR_KEY, STAMP_KEY, STOCK_CURSOR_KEY } from "./cloud/runtime.js";
import { planPull, applyStockRows } from "./cloud/sync.js";
import { loadBalances, refreshBalances, balanceFrom, BAL_KEY } from "./cloud/balances.js";
import { cloud as cloudApi } from "./cloud/api.js";
import { describeAuthError } from "./cloud/identity.js";
import { getDeviceId, checkStoredLicense, activate, describeExpiry } from "./license.js";
import { App as CapApp } from "@capacitor/app";
import { colors, money, moneyShort, CURRENCY } from "./theme.js";
import { styles, globalCss } from "./styles.js";
import {
  Search, Plus, Pencil, X, ShoppingCart, Package, Truck, LayoutGrid, AlertTriangle, Check, ScanLine, Receipt,
  Users, LogOut, Lock, UserIcon, SettingsIcon, CreditIcon, BranchIcon, DownloadIcon, UploadIcon, CameraIcon, DayIcon, MoreIcon,
  House, ChartColumn, Wallet, PrinterIcon, MessageCircle, MessageSquare, Star, ChevronRight, ChevronLeft, ArrowLeft,
  Eye, EyeOff, Trash2, Minus, ScanBarcode, Flashlight, Banknote, TrendingUp, TrendingDown, Boxes, FileSpreadsheet, ShieldCheck,
  Info, CircleCheck, CircleAlert, Phone, Calendar, ChevronDown, Tag, Clock, Inbox, PackageOpen, ArrowUpRight, ArrowDownRight,
  Bluetooth, KeyRound, Share2, Copy, RefreshCw, Save, Building2, UserPlus, HandCoins, ReceiptText, History, Pause, CalendarDays, CircleX,
  ListFilter, Layers, ImageIcon, Zap, BadgeCheck, Smartphone, FileText, ShoppingBag, Wifi, Bell,
  Avatar, Badge, Spinner, Button, IconButton, Toggle, Segmented, Chips, SectionHeader, EmptyState, List, Row, StatTile, Field, Modal, Toast, ConfirmModal,
  useBackClose, BackClose, handleBack,
} from "./ui.jsx";





applyUi();                                     // theme + text size are applied before the first screen is drawn
import { AppCtx } from "./appctx.js";
const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = () => localDateStr();

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

// ---------- dependency-free sparkline chart (standalone build has no recharts) ----------
function ProfitBars({ data }) {
  const [sel, setSel] = useState(null);
  const max = Math.max(1, ...data.map((d) => Math.abs(d.profit)));
  const shown = sel !== null ? data[sel] : data[data.length - 1];
  const total = data.reduce((a, d) => a + d.profit, 0);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, gap: 8 }}>
        <div>
          <div style={{ fontSize: 12.5, color: colors.inkSoft }}>{shown.label}</div>
          <div className="num" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: shown.profit < 0 ? colors.red : colors.ink }}>{money(shown.profit)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12.5, color: colors.inkSoft }}>14-day total</div>
          <div className="num" style={{ fontSize: 14, fontWeight: 700, color: total < 0 ? colors.red : colors.green }}>{money(total)}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120 }} role="img" aria-label="Net profit for the last 14 days">
        {data.map((d, i) => {
          const h = Math.max(4, Math.round((Math.abs(d.profit) / max) * 112));
          const active = (sel === null ? i === data.length - 1 : sel === i);
          return (
            <button key={i} type="button" aria-label={`${d.label}: ${money(d.profit)}`} onClick={() => setSel(sel === i ? null : i)}
              style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end", background: "none", border: "none", padding: 0 }}>
              <span style={{ width: "100%", height: h, borderRadius: 6, background: d.profit < 0 ? colors.red : colors.primary, opacity: active ? 1 : 0.28, transition: "opacity .15s, height .3s" }} />
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: colors.inkFaint, marginTop: 6 }}>
        <span>{data[0].label}</span><span>{data[data.length - 1].label}</span>
      </div>
    </div>
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
  const [dayCloses, setDayClosesRaw] = useState(() => loadLS("tally:dayCloses", {}));
  const [currentUserId, setCurrentUserId] = useState(() => loadLS("tally:sessionUserId", null));
  const [workingBranchId, setWorkingBranchIdRaw] = useState(() => loadLS("tally:workingBranchId", null));
  const [toast, setToast] = useState(null);
  const [loginError, setLoginError] = useState("");

  // Every change goes through here. In Local mode this just saves. In Cloud mode the change is also turned into
  // upload operations and put in the durable queue BEFORE any network call (tag "pull" = came from the cloud, "server-stock" =
  // the server adjusts stock itself for sales and purchases).
  const rt = runtime(); const cloudOn = !!rt && rt.isCloud();
  const latest = useRef(null);
  if (latest.current === null) latest.current = { products, sales, purchases, expenses, customers, creditPayments, users, branches, settings, dayCloses };
  const dirty = useRef(0);
  const notify = useRef(() => {});
  const mk = (key, setter) => (updater, tag) => {
    const name = key.slice(6);
    const prev = latest.current[name];
    const next = typeof updater === "function" ? updater(prev) : updater;
    latest.current[name] = next;
    saveLS(key, next);
    setter(next);
    if (cloudOn && tag !== "pull" && name !== "users") {
      dirty.current += 1;
      try {
        const ops = deriveOps(name, prev, next, rt.ctx(), () => crypto.randomUUID(), tag);
        if (ops.length) { rt.enqueue(ops); rt.flush().catch(() => {}); }
      } catch (e) { notify.current("This change could not be queued for the cloud: " + ((e && e.message) || e)); }
    }
  };
  const setProducts = mk("tally:products", setProductsRaw);
  const setSales = mk("tally:sales", setSalesRaw);
  const setPurchases = mk("tally:purchases", setPurchasesRaw);
  const setExpenses = mk("tally:expenses", setExpensesRaw);
  const setCustomers = mk("tally:customers", setCustomersRaw);
  const setCreditPayments = mk("tally:creditPayments", setCreditPaymentsRaw);
  const setUsers = mk("tally:users", setUsersRaw);
  const setBranches = mk("tally:branches", setBranchesRaw);
  const setSettings = mk("tally:settings", setSettingsRaw);
  const setDayCloses = mk("tally:dayCloses", setDayClosesRaw);

  const showToast = useCallback((msg, kind = "ok", ms = 2200, action) => {
    const id = uid();
    setToast({ msg, kind, id, action });
    setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), action ? Math.max(ms, 7000) : ms);
  }, []);
  // little dialogs that answer with a promise: await ctx.confirm({...}) / await ctx.askOwner()
  const [dlg, setDlg] = useState(null);
  const askConfirm = useCallback((o) => new Promise((res) => setDlg({ kind: "confirm", ...o, res })), []);
  const askOwnerRaw = useCallback(() => new Promise((res) => setDlg({ kind: "owner", res })), []);
  const closeDlg = (v) => setDlg((d) => { if (d) d.res(v); return null; });
  // lock screen
  const [locked, setLocked] = useState(() => isLockedFlag());
  const [uiPrefs, setUiPrefs] = useState(getUi);
  const changeUi = (patch) => setUiPrefs(setUi(patch));
  const [pendingAction, setPendingAction] = useState(null);
  const goAction = (tabId, action) => { setPendingAction(action); setTab(tabId); };

  // Android back button: close the top-most sheet, else go Home, else exit
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    let h;
    try {
      const p = CapApp.addListener("backButton", () => {
        if (handleBack()) return;
        if (tabRef.current !== "dashboard") { setTab("dashboard"); return; }
        try { CapApp.exitApp(); } catch (e) {}
      });
      Promise.resolve(p).then((x) => { h = x; }).catch(() => {});
    } catch (e) {}
    return () => { try { h && h.remove(); } catch (e) {} };
  }, []);

  // ---- Cloud mode: who is signed in, and keeping the phone and the cloud in step ----
  const [cloudMe, setCloudMe] = useState(() => (cloudOn ? ((rt.ctx() || {}).me || null) : null));
  const effUsers = useMemo(() => (cloudOn ? (cloudMe ? [cloudUserFrom(cloudMe)] : []) : users), [cloudOn, cloudMe, users]);
  const currentUser = useMemo(() => effUsers.find((u) => u.id === currentUserId) || null, [effUsers, currentUserId]);
  notify.current = (m) => showToast(m, "err", 6000);
  const curRef = useRef(null); curRef.current = currentUser;
  const lockedRef = useRef(locked); lockedRef.current = locked;
  const doLock = useCallback(() => { const u = curRef.current; if (u && hasPin(u.id) && !lockedRef.current) { setLockedFlag(true); setLocked(true); } }, []);
  const lockNow = () => { if (currentUser && hasPin(currentUser.id)) doLock(); else showToast("Set a PIN first: Account, then PIN lock.", "err"); };
  useEffect(() => {
    let last = Date.now(), hiddenAt = 0;
    const mins = () => Number(getUi().autoLock) || 0;
    const bump = () => { last = Date.now(); };
    const tick = () => { const m = mins(); if (m > 0 && Date.now() - last > m * 60000) doLock(); };
    const vis = () => { if (document.visibilityState === "hidden") hiddenAt = Date.now(); else { const m = mins(); if (hiddenAt && m > 0 && Date.now() - hiddenAt > m * 60000) doLock(); hiddenAt = 0; last = Date.now(); } };
    const evs = ["pointerdown", "keydown", "touchstart"]; evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    document.addEventListener("visibilitychange", vis); const t = setInterval(tick, 10000);
    return () => { evs.forEach((e) => window.removeEventListener(e, bump)); document.removeEventListener("visibilitychange", vis); clearInterval(t); };
  }, [doLock]);
  const [sync, setSync] = useState({ stats: rt ? rt.outbox.stats() : {}, busy: false, lastAt: null, error: "", online: true });
  const [syncOpen, setSyncOpen] = useState(false);
  const syncing = useRef(false);
  useEffect(() => (cloudOn ? rt.outbox.subscribe((st) => setSync((x) => ({ ...x, stats: st }))) : undefined), []);
  const applyPull = (c) => {
    if (c.products) setProducts(c.products, "pull");
    else if (c.stockRows) setProducts((prev) => applyStockRows(prev, c.stockRows), "pull");
    if (c.customers) setCustomers(c.customers, "pull");
    if (c.branches) setBranches(c.branches, "pull");
    if (c.expenses) setExpenses(c.expenses, "pull");
    if (c.purchases) setPurchases(c.purchases, "pull");
    if (c.dayCloses) setDayCloses(c.dayCloses, "pull");
    if (c.settings) setSettings((prev) => ({ ...prev, ...c.settings }), "pull");
    if (c.sales) setSales((prev) => mergeById(prev, c.sales, c.voidedSaleIds), "pull");
    if (c.creditPayments) setCreditPayments((prev) => mergeById(prev, c.creditPayments, []), "pull");
  };
  // 1) send what is waiting, 2) only if nothing is waiting or failed, ask the server "has anything changed?" and download just that
  const syncNow = async (eager) => {
    if (!cloudOn || syncing.current) return;
    if (eager) rt.outbox.resume();
    syncing.current = true; setSync((x) => ({ ...x, busy: true, error: "" }));
    try {
      await rt.flush();
      let error = "", online = true; const ls = window.localStorage;
      if (rt.pendingCount() === 0 && rt.failedCount() === 0) {
        const d0 = dirty.current;
        const cur = await rt.stamp().catch((e) => { if (/failed to fetch|network|timeout|load failed/i.test(String((e && e.message) || e))) throw e; return null; });
        let old = null; try { old = JSON.parse(ls.getItem(STAMP_KEY) || "null"); } catch (_) {}
        const parts = planPull(old, cur, Number(ls.getItem("tally:cloud:lastfull") || 0), Date.now());
        if (parts) {
          const c = await rt.pull({ since: ls.getItem(CURSOR_KEY) || undefined, parts, stockSince: ls.getItem(STOCK_CURSOR_KEY) || undefined });
          if (dirty.current === d0) {                       // nothing was changed on the phone while downloading
            applyPull(c);
            if (c.cursor) ls.setItem(CURSOR_KEY, c.cursor);
            if (c.stockCursor) ls.setItem(STOCK_CURSOR_KEY, c.stockCursor);
            if (cur) ls.setItem(STAMP_KEY, JSON.stringify(cur)); else ls.removeItem(STAMP_KEY);
            if (parts.catalog && parts.books && parts.sales) ls.setItem("tally:cloud:lastfull", String(Date.now()));
            const me = (rt.ctx() || {}).me;
            if (parts.sales && me && me.role !== "owner" && me.role !== "admin") { try { await refreshBalances(rt, ls, latest.current); cloudBalances = loadBalances(ls); } catch (_) {} }
          }
        }
      } else if (rt.failedCount()) error = "Some changes were refused by the server. Open this panel to review them.";
      else if (rt.pendingCount()) online = !rt.outbox.list().some((i) => i.status === "pending" && i.error);
      setSync((x) => ({ ...x, busy: false, lastAt: Date.now(), error, online }));
    } catch (e) {
      const offline = /failed to fetch|network|timeout|load failed/i.test(String((e && e.message) || e));
      setSync((x) => ({ ...x, busy: false, lastAt: Date.now(), online: !offline, error: offline ? "" : describeAuthError(e) }));
    } finally { syncing.current = false; }
  };
  const syncRef = useRef(syncNow); syncRef.current = syncNow;
  useEffect(() => {
    if (!cloudOn) return undefined;
    cloudBalances = loadBalances(window.localStorage);
    const go = () => syncRef.current();
    const goNow = () => syncRef.current(true);
    goNow();
    const t = setInterval(go, 60000);
    window.addEventListener("online", goNow);
    const vis = () => { if (document.visibilityState === "visible") goNow(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); window.removeEventListener("online", goNow); document.removeEventListener("visibilitychange", vis); };
  }, []);
  const cloudSignedIn = async (me, offline) => {
    const c = rt.ctx() || {};
    if (me.shop_id !== c.shopId) { if (!offline) await cloudApi.signOut().catch(() => {}); throw new Error("This login belongs to a different shop than this phone."); }
    if (c.userId !== me.user_id && rt.pendingCount() + rt.failedCount() > 0) {
      if (!offline) { /* keep the previous session so its queued records are still sent as that person */ }
      throw new Error("Records from the previous user are still waiting to be sent from this phone. Connect to the internet and let them finish (or have that user sign in again), then sign in.");
    }
    rt.setCtx({ ...c, userId: me.user_id, me });
    setCloudMe(me); setCurrentUserId(me.user_id); saveLS("tally:sessionUserId", me.user_id);
    if ((me.role === "cashier" || me.role === "manager") && me.branch_id) setWorkingBranchId(me.branch_id);
    setTimeout(() => syncRef.current(), 50);
  };

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
  const switchUser = (id) => {
    const u = users.find((x) => x.id === id); if (!u) return;
    setCurrentUserId(u.id); saveLS("tally:sessionUserId", u.id);
    if (u.role !== "admin" && u.branchId) setWorkingBranchId(u.branchId);
    setLockedFlag(false); setLocked(false); setTab(u.role === "admin" ? "dashboard" : "checkout");
  };
  const logout = () => {
    setLockedFlag(false); setLocked(false);
    setCurrentUserId(null);
    saveLS("tally:sessionUserId", null);
    // Cloud mode: the session is kept so anything still waiting can be sent as the person who made it
  };

  if (!booted) {
    return (
      <div style={styles.app}>
        <style>{globalCss}</style>
        <div style={{ ...styles.loading, display: "flex", justifyContent: "center", paddingTop: "40vh" }}><Spinner size={26} /></div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div style={styles.app}>
        <style>{globalCss}</style>
        {cloudOn ? <CloudLoginScreen onSignedIn={cloudSignedIn} shopCodeHint={(rt.ctx() || {}).shopCode} license={license} /> : <LoginScreen onLogin={login} errorMessage={loginError} license={license} />}
      </div>
    );
  }

  const isAdmin = currentUser.role === "admin";
  const activeBranchId = isAdmin ? workingBranchId : currentUser.branchId;
  const multiBranch = branches.length > 1;
  const lowStockCount = products.filter((p) => getStock(p, activeBranchId) <= p.lowStock).length;

  const syncProps = cloudOn ? { cloudOn: true, rt, stats: sync.stats, busy: sync.busy, online: sync.online, lastAt: sync.lastAt, error: sync.error, openCenter: () => setSyncOpen(true), syncNow: () => syncNow(true), refresh: () => setSync((x) => ({ ...x, stats: rt.outbox.stats() })) } : null;
  const onResetTransactions = () => {
    setSales([]);
    setPurchases([]);
    setExpenses([]);
    setCreditPayments([]);
    setDayCloses({});
  };
  const onResetEverything = () => {
    setProducts([]);
    setSales([]);
    setPurchases([]);
    setExpenses([]);
    setCustomers([]);
    setCreditPayments([]);
    setDayCloses({});
  };

  const admins = users.filter((u) => u.role === "admin");
  const wizardDue = isAdmin && !cloudOn && settings.setupDone !== true && sales.length === 0;
  const finishSetup = () => setSettings((prev) => ({ ...prev, setupDone: true }));
  const doReturn = (saleId, qtys, opts) => {
    const sale = latest.current.sales.find((x) => x.id === saleId); if (!sale) throw new Error("unknown_sale");
    const { ret, balanceDue } = buildReturn(sale, qtys, { ...opts, id: makeId("r-", uid), by: currentUser.name, date: todayStr() });
    const updated = { ...sale, returns: [...saleReturns(sale), ret], balanceDue };
    setSales((prev) => prev.map((x) => (x.id === saleId ? updated : x)));
    if (opts.restock) setProducts((prev) => prev.map((p) => { const q = ret.items.find((i) => i.productId === p.id); return q ? { ...p, stock: { ...p.stock, [sale.branchId]: getStock(p, sale.branchId) + q.qty } } : p; }), "server-stock");
    return updated;
  };
  // After a recorded sale's quantities are corrected: put back / take off the difference in stock.
  const applyQtyEdit = (oldSale, newSale) => {
    const diffs = {}; (newSale.items || []).forEach((it, i) => { const o = oldSale.items[i]; if (o && it.productId) diffs[it.productId] = (diffs[it.productId] || 0) + (Number(o.qty) - Number(it.qty)); });
    if (Object.values(diffs).every((d) => !d)) return;
    setProducts((prev) => prev.map((p) => (diffs[p.id] ? { ...p, stock: { ...p.stock, [oldSale.branchId]: Math.round((getStock(p, oldSale.branchId) + diffs[p.id]) * 1000) / 1000 } } : p)), "server-stock");
  };
  // After a sale's lines are changed (quantity, item added, item deleted): stock follows, by product.
  const applyLineChanges = (oldSale, newSale) => {
    const diffs = stockDiffs(oldSale, newSale);
    if (!Object.keys(diffs).length) return;
    setProducts((prev) => prev.map((p) => (diffs[p.id] ? { ...p, stock: { ...p.stock, [oldSale.branchId]: Math.round((getStock(p, oldSale.branchId) + diffs[p.id]) * 1000) / 1000 } } : p)), "server-stock");
  };
  // Returns: the owner does them. In Local mode a cashier can too, once the owner types their PIN. In Cloud mode the server only accepts the owner.
  const canReturn = (sale) => !!sale && (sale.items || []).some((i) => returnableQty(sale, i) > 0) && (isAdmin || (!cloudOn && admins.some((a) => hasPin(a.id))));
  const needsOwner = !isAdmin;
  const ctxValue = { confirm: askConfirm, askOwner: () => (needsOwner ? askOwnerRaw() : Promise.resolve(true)), doReturn, canReturn, applyQtyEdit, applyLineChanges, products, ui: uiPrefs, changeUi, lockNow, cloudOn, switchUser, users, currentUser, showToast,
    pinSet: hasPin(currentUser.id), setMyPin: async (pin) => { await setPin(currentUser.id, pin); setUiPrefs(getUi()); }, clearMyPin: () => { clearPin(currentUser.id); changeUi({ autoLock: 0 }); } };

  return (
    <AppCtx.Provider value={ctxValue}>
    <div style={styles.app}>
      <style>{globalCss}</style>
      {locked && hasPin(currentUser.id) && <LockScreen user={currentUser} others={cloudOn ? [] : users} cloudOn={cloudOn} onUnlock={() => { setLockedFlag(false); setLocked(false); }} onSwitch={switchUser} onSignOut={logout} />}
      {wizardDue && <SetupWizard settings={settings} setSettings={setSettings} setProducts={setProducts} setUsers={setUsers} currentUser={currentUser} activeBranchId={activeBranchId} showToast={showToast} onDone={finishSetup} />}
      <TopBar
        tab={tab} setTab={setTab} lowStockCount={lowStockCount} currentUser={currentUser} onLogout={logout} isAdmin={isAdmin}
        branches={branches} workingBranchId={workingBranchId} setWorkingBranchId={setWorkingBranchId} multiBranch={multiBranch}
        settings={settings} license={license} sync={syncProps}
      />
      {syncOpen && syncProps && <SyncCenter sync={syncProps} onClose={() => setSyncOpen(false)} />}
      <main className="page" key={tab}>
        {tab === "dashboard" && isAdmin && (
          <AdminDashboard products={products} sales={sales} purchases={purchases} expenses={expenses} customers={customers} creditPayments={creditPayments} branches={branches} multiBranch={multiBranch} setTab={setTab} goAction={goAction} currentUser={currentUser} />
        )}
        {tab === "dashboard" && !isAdmin && (
          <StaffDashboard products={products} sales={sales} currentUser={currentUser} activeBranchId={activeBranchId} setTab={setTab} />
        )}
        {tab === "inventory" && (
          <Inventory products={products} setProducts={setProducts} showToast={showToast} readOnly={!isAdmin} activeBranchId={activeBranchId} branches={branches} multiBranch={multiBranch} pendingAction={pendingAction} clearPending={() => setPendingAction(null)} />
        )}
        {tab === "checkout" && (
          <Checkout
            products={products} setProducts={setProducts} sales={sales} setSales={setSales}
            customers={customers} setCustomers={setCustomers}
            showToast={showToast} currentUser={currentUser} settings={settings}
            activeBranchId={activeBranchId} branches={branches}
          />
        )}
        {tab === "dayclose" && (
          <DayClose sales={sales} creditPayments={creditPayments} expenses={expenses} purchases={purchases} branches={branches} multiBranch={multiBranch}
            activeBranchId={activeBranchId} settings={settings} dayCloses={dayCloses} setDayCloses={setDayCloses} currentUser={currentUser} showToast={showToast} />
        )}
        {tab === "purchases" && isAdmin && (
          <Purchases products={products} setProducts={setProducts} purchases={purchases} setPurchases={setPurchases} showToast={showToast} activeBranchId={activeBranchId} />
        )}
        {tab === "expenses" && isAdmin && (
          <Expenses expenses={expenses} setExpenses={setExpenses} showToast={showToast} activeBranchId={activeBranchId} branches={branches} multiBranch={multiBranch} pendingAction={pendingAction} clearPending={() => setPendingAction(null)} />
        )}
        {tab === "credit" && (
          <CreditBook
            customers={customers} setCustomers={setCustomers} sales={sales} creditPayments={creditPayments} setCreditPayments={setCreditPayments}
            showToast={showToast} currentUser={currentUser} settings={settings} branches={branches} activeBranchId={activeBranchId}
          />
        )}
        {tab === "history" && (
          <SalesHistory sales={sales} setSales={setSales} currentUser={currentUser} isAdmin={isAdmin} branches={branches} multiBranch={multiBranch} settings={settings} showToast={showToast} activeBranchId={activeBranchId} />
        )}
        {tab === "reports" && isAdmin && (
          <Reports currentUser={currentUser} setSales={setSales} sales={sales} expenses={expenses} branches={branches} multiBranch={multiBranch} settings={settings} showToast={showToast} />
        )}
        {tab === "team" && isAdmin && cloudOn && (
          <div className="card"><div style={styles.emptyNote}>In Cloud mode staff logins are managed in <strong>Settings → Cloud account</strong>, where each person gets their own secure login and role.</div></div>
        )}
        {tab === "team" && isAdmin && !cloudOn && (
          <Team users={users} setUsers={setUsers} currentUser={currentUser} showToast={showToast} branches={branches} multiBranch={multiBranch} />
        )}
        {tab === "settings" && isAdmin && (
          <ShopSettings
            settings={settings} setSettings={setSettings} showToast={showToast}
            branches={branches} setBranches={setBranches}
            onResetTransactions={onResetTransactions} onResetEverything={onResetEverything} cloudOn={cloudOn}
            fullState={{ products, sales, purchases, expenses, customers, creditPayments, users, branches, settings, dayCloses }}
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
              if (data.dayCloses) setDayCloses(data.dayCloses);
            }}
          />
        )}
      </main>
      <div>{/* dialogs last, so they sit on top of any sheet that asked for them */}
      {dlg && dlg.kind === "confirm" && <ConfirmModal title={dlg.title} text={dlg.text} okLabel={dlg.okLabel} danger={dlg.danger} onYes={() => closeDlg(true)} onNo={() => closeDlg(false)} />}
      {dlg && dlg.kind === "owner" && <OwnerApproval admins={admins} onResult={closeDlg} />}
      </div>
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
    </AppCtx.Provider>
  );
}


// ---------- activation (license) ----------
function ActivationScreen({ reason, onActivated }) {
  const deviceId = useMemo(() => getDeviceId(), []);
  const [code, setCode] = useState("");
  const [err, setErr] = useState(reason === "expired" ? "Your license has expired. Send your Device ID to get a new code." : "");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const contact = LICENSE_CONFIG.contact;

  const submit = () => {
    if (!code.trim()) { setErr("Paste your activation code first."); return; }
    setBusy(true);
    const r = activate(LICENSE_CONFIG.publicKey, code);
    setBusy(false);
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
            <img src={LOGO_MARK} alt="" style={styles.brandMark} />
            <div>
              <div style={styles.brandName}>{LICENSE_CONFIG.productName}</div>
              <div style={styles.brandSub}>Activation</div>
            </div>
          </div>
          <div style={styles.loginHeading}>Activate this app</div>
          <div style={styles.stack}>
            <div style={{ fontSize: 14, color: colors.inkSoft, lineHeight: 1.5, textAlign: "center" }}>
              Send this Device ID to the seller to receive your activation code.
            </div>
            <div style={{ background: colors.primarySoft, borderRadius: 14, padding: "14px", textAlign: "center" }}>
              <div style={{ fontSize: 11.5, color: colors.primary, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>Device ID</div>
              <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: 2, color: colors.primaryDark }}>{deviceId}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" full icon={copied ? Check : Copy} onClick={copyId}>{copied ? "Copied" : "Copy"}</Button>
              <Button variant="secondary" full icon={Share2} onClick={sendId}>Send ID</Button>
            </div>
            <Field label="Activation code">
              <textarea
                style={{ ...styles.input, ...styles.mono, fontSize: 13, minHeight: 96, height: "auto", padding: 12, resize: "vertical" }}
                value={code} onChange={(e) => { setCode(e.target.value); setErr(""); }}
                placeholder="Paste your code here" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              />
            </Field>
            {err && <div style={styles.loginError} role="alert">{err}</div>}
            <Button full icon={KeyRound} loading={busy} onClick={submit} style={{ height: 50 }}>Activate</Button>
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
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (!username.trim() || !password) return;
    setBusy(true);
    onLogin(username, password);
    setBusy(false);
  };
  const handleKey = (e) => { if (e.key === "Enter") submit(); };

  return (
    <div style={styles.loginWrap}>
      <div style={styles.loginCard}>
        <div style={styles.loginBrandRow}>
          <img src={LOGO_MARK} alt="" style={styles.brandMark} />
          <div>
            <div style={styles.brandName}>Ilelah Business Suite</div>
            <div style={styles.brandSub}>Sales, stock and credit</div>
          </div>
        </div>
        <div style={styles.loginHeading}>Sign in to the till</div>
        <div style={styles.stack}>
          <Field label="Username">
            <div className="input-row">
              <UserIcon size={18} />
              <input value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={handleKey} placeholder="e.g. admin" autoCapitalize="none" autoCorrect="off" />
            </div>
          </Field>
          <Field label="Password">
            <div className="input-row">
              <Lock size={18} />
              <input type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={handleKey} placeholder="Your password" />
              <button type="button" className="icon-btn" style={{ background: "none", width: 32, height: 32 }} aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((v) => !v)}>
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Field>
          {errorMessage && <div style={styles.loginError} role="alert">{errorMessage}</div>}
          <Button full loading={busy} onClick={submit} style={{ height: 50 }}>Sign in</Button>
        </div>
        <div style={styles.loginHint}>
          First time here? Use <b>admin</b> / <b>admin123</b>, then change it under Team.<br />
          Accounts are created by the shop owner under Team.
        </div>
        {license && license.ok && (
          <div style={{ ...styles.loginHint, marginTop: 10 }}><BadgeCheck size={13} style={{ verticalAlign: -2 }} /> Licensed{license.name ? ` to ${license.name}` : ""} · {describeExpiry(license.expiryDay)}</div>
        )}
      </div>
    </div>
  );
}

// ---------- first-time setup ----------
function SetupWizard({ settings, setSettings, setProducts, setUsers, currentUser, activeBranchId, showToast, onDone }) {
  const ctx = React.useContext(AppCtx);
  const [step, setStep] = useState(0);
  const [shop, setShop] = useState({ shopName: settings.shopName === DEFAULT_SETTINGS.shopName ? "" : settings.shopName, tagline: settings.tagline === DEFAULT_SETTINGS.tagline ? "" : settings.tagline, address: settings.address || "", phone: settings.phone || "" });
  const [pw, setPw] = useState(""); const [pinDlg, setPinDlg] = useState(false);
  const [rows, setRows] = useState([{ name: "", price: "", cost: "", qty: "" }, { name: "", price: "", cost: "", qty: "" }, { name: "", price: "", cost: "", qty: "" }]);
  const [added, setAdded] = useState(0);
  const names = ["Your shop", "Keep it safe", "First products", "All set"];
  const saveShop = () => {
    if (!shop.shopName.trim()) { showToast("Type your shop's name. It prints on every receipt.", "err"); return; }
    setSettings((prev) => ({ ...prev, shopName: shop.shopName.trim(), tagline: shop.tagline.trim(), address: shop.address.trim(), phone: shop.phone.trim() })); setStep(1);
  };
  const savePw = () => {
    if (pw) {
      if (pw.length < 4) { showToast("A password needs at least 4 characters.", "err"); return; }
      if (pw === "admin123") { showToast("Choose a different password from the starting one.", "err"); return; }
      setUsers((prev) => prev.map((u) => (u.id === currentUser.id ? { ...u, password: pw } : u))); showToast("Password changed.");
    }
    setStep(2);
  };
  const saveProducts = () => {
    const good = rows.filter((r) => r.name.trim() && Number(r.price) > 0);
    if (good.length) {
      const made = good.map((r, i) => ({ id: makeId("p-", uid), name: r.name.trim(), sku: "P" + String(Date.now()).slice(-6) + i, barcode: "", category: "", cost: Number(r.cost) || 0, price: Number(r.price), lowStock: 5, quick: true, stock: { [activeBranchId]: Number(r.qty) || 0 } }));
      setProducts((prev) => [...prev, ...made]);
    }
    setAdded(good.length); setStep(3);
  };
  const setRow = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div role="dialog" aria-modal="true" aria-label="Set up your shop" style={{ position: "fixed", inset: 0, zIndex: 40, background: colors.bg, overflowY: "auto", padding: "calc(var(--sat) + 18px) 18px calc(var(--sab) + 24px)" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>{names.map((n, i) => <span key={n} style={{ flex: 1, height: 5, borderRadius: 3, background: i <= step ? colors.primary : colors.line }} />)}</div>
        <div style={{ fontSize: 12.5, color: colors.inkSoft, fontWeight: 600 }}>Step {step + 1} of 4 · {names[step]}</div>
        {step === 0 && (
          <div style={styles.stack}>
            <h2 style={{ fontSize: 24, margin: "6px 0 0", letterSpacing: "-0.02em" }}>Welcome! Let's set up your shop</h2>
            <div style={{ color: colors.inkSoft }}>This takes about two minutes. It appears on your receipts, and you can change it any time in Settings.</div>
            <Field label="Shop name"><input style={styles.input} autoFocus value={shop.shopName} onChange={(e) => setShop({ ...shop, shopName: e.target.value })} placeholder="e.g. Ade Supermarket" /></Field>
            <Field label="Tagline (optional)"><input style={styles.input} value={shop.tagline} onChange={(e) => setShop({ ...shop, tagline: e.target.value })} placeholder="e.g. Quality provisions, fair prices" /></Field>
            <Field label="Address (optional)"><input style={styles.input} value={shop.address} onChange={(e) => setShop({ ...shop, address: e.target.value })} /></Field>
            <Field label="Phone number(s) (optional)"><input style={styles.input} inputMode="tel" value={shop.phone} onChange={(e) => setShop({ ...shop, phone: e.target.value })} /></Field>
            <Button full onClick={saveShop}>Next</Button>
          </div>
        )}
        {step === 1 && (
          <div style={styles.stack}>
            <h2 style={{ fontSize: 24, margin: "6px 0 0", letterSpacing: "-0.02em" }}>Protect your account</h2>
            <div style={{ color: colors.inkSoft }}>The app starts with a public password ("admin123"). Choose your own so nobody else can open your sales and profit.</div>
            <Field label="New owner password"><input style={styles.input} type="text" autoCapitalize="none" autoCorrect="off" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 4 characters" /></Field>
            <Field label="PIN lock (optional)" hint="A 4-digit PIN locks the app when you step away and lets cashiers share one phone."><Button variant="secondary" icon={KeyRound} onClick={() => setPinDlg(true)}>{ctx.pinSet ? "PIN is set. Change it" : "Set a PIN"}</Button></Field>
            <div style={{ display: "flex", gap: 8 }}><Button variant="secondary" onClick={() => setStep(0)} style={{ flex: 1 }}>Back</Button><Button onClick={savePw} style={{ flex: 2 }}>{pw ? "Save and continue" : "Skip for now"}</Button></div>
          </div>
        )}
        {step === 2 && (
          <div style={styles.stack}>
            <h2 style={{ fontSize: 24, margin: "6px 0 0", letterSpacing: "-0.02em" }}>Add your first products</h2>
            <div style={{ color: colors.inkSoft }}>Add a few now to try a sale. For a long list, use <b>Inventory → Import</b> to bring in a spreadsheet later.</div>
            {rows.map((r, i) => (
              <div key={i} className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
                <input style={styles.input} placeholder={`Product ${i + 1} name`} aria-label={`Product ${i + 1} name`} value={r.name} onChange={(e) => setRow(i, "name", e.target.value)} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <input style={styles.input} type="number" inputMode="decimal" placeholder="Price" aria-label={`Product ${i + 1} price`} value={r.price} onChange={(e) => setRow(i, "price", e.target.value)} />
                  <input style={styles.input} type="number" inputMode="decimal" placeholder="Cost" aria-label={`Product ${i + 1} cost`} value={r.cost} onChange={(e) => setRow(i, "cost", e.target.value)} />
                  <input style={styles.input} type="number" inputMode="numeric" placeholder="In stock" aria-label={`Product ${i + 1} quantity`} value={r.qty} onChange={(e) => setRow(i, "qty", e.target.value)} />
                </div>
              </div>
            ))}
            <Button variant="secondary" icon={Plus} onClick={() => setRows([...rows, { name: "", price: "", cost: "", qty: "" }])}>Another product</Button>
            <div style={{ display: "flex", gap: 8 }}><Button variant="secondary" onClick={() => setStep(1)} style={{ flex: 1 }}>Back</Button><Button onClick={saveProducts} style={{ flex: 2 }}>{rows.some((r) => r.name.trim() && Number(r.price) > 0) ? "Save products" : "Skip for now"}</Button></div>
          </div>
        )}
        {step === 3 && (
          <div style={styles.stack}>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 10, color: colors.green }}><CircleCheck size={56} /></div>
            <h2 style={{ fontSize: 24, margin: 0, textAlign: "center", letterSpacing: "-0.02em" }}>You're ready to sell</h2>
            <div style={{ color: colors.inkSoft, textAlign: "center" }}>{added ? `${added} product${added === 1 ? "" : "s"} added. ` : ""}Tap <b>Sell</b>, pick items, and complete the sale. A few things worth knowing:</div>
            <List>
              <Row lead={<Pause size={19} />} title="Hold a sale" sub="Park a cart while you serve someone else" />
              <Row lead={<History size={19} />} title="Sales history" sub="Reopen, reprint or correct a past sale" />
              <Row lead={<Users size={19} />} title="Team" sub="Add cashiers, each with their own login" />
            </List>
            <Button full onClick={onDone}>Start selling</Button>
          </div>
        )}
        {step < 3 && <button type="button" onClick={onDone} style={{ display: "block", margin: "18px auto 0", background: "none", border: "none", color: colors.inkSoft, textDecoration: "underline", fontSize: 13.5 }}>Skip setup, I'll do it later</button>}
      </div>
      {pinDlg && <PinSetup onClose={() => setPinDlg(false)} onSave={async (pin) => { await ctx.setMyPin(pin); setPinDlg(false); showToast("PIN saved."); }} />}
    </div>
  );
}

// ---------- top bar ----------
function TopBar({ tab, setTab, lowStockCount, currentUser, onLogout, isAdmin, branches, workingBranchId, setWorkingBranchId, multiBranch, settings, license, sync }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const ctx = React.useContext(AppCtx);
  const [pinDlg, setPinDlg] = useState(false);
  const items = isAdmin
    ? [
        { id: "dashboard", label: "Dashboard", short: "Home", icon: House },
        { id: "checkout", label: "Sell", short: "Sell", icon: ShoppingCart },
        { id: "inventory", label: "Inventory", short: "Stock", icon: Package, badge: lowStockCount },
        { id: "credit", label: "Credit", short: "Credit", icon: HandCoins },
        { id: "history", label: "Sales history", short: "History", icon: History },
        { id: "purchases", label: "Purchases", short: "Purchases", icon: Truck },
        { id: "expenses", label: "Expenses", short: "Expenses", icon: ReceiptText },
        { id: "dayclose", label: "Day close", short: "Day close", icon: DayIcon },
        { id: "reports", label: "Reports", short: "Reports", icon: ChartColumn },
        { id: "team", label: "Team", short: "Team", icon: Users },
        { id: "settings", label: "Settings", short: "Settings", icon: SettingsIcon },
      ]
    : [
        { id: "dashboard", label: "Dashboard", short: "Home", icon: House },
        { id: "checkout", label: "Sell", short: "Sell", icon: ShoppingCart },
        { id: "history", label: "Sales history", short: "History", icon: History },
        { id: "credit", label: "Credit", short: "Credit", icon: HandCoins },
        { id: "inventory", label: "Stock levels", short: "Stock", icon: Package, badge: lowStockCount },
        { id: "dayclose", label: "Day close", short: "Day close", icon: DayIcon },
      ];
  const primaryIds = isAdmin ? ["dashboard", "checkout", "inventory", "credit"] : ["dashboard", "checkout", "history", "credit", "inventory"];
  const primary = primaryIds.map((id) => items.find((i) => i.id === id));
  const more = items.filter((i) => !primaryIds.includes(i.id));
  const moreActive = more.some((i) => i.id === tab);
  const go = (id) => { setTab(id); setMoreOpen(false); };
  const cur = items.find((i) => i.id === tab) || items[0];
  const myBranch = branches.find((b) => b.id === (isAdmin ? workingBranchId : currentUser.branchId));
  const sub = tab === "dashboard"
    ? `${settings && settings.shopName ? settings.shopName : "Ilelah Business Suite"}`
    : (multiBranch && myBranch ? myBranch.name : settings && settings.shopName) || "";
  const title = tab === "dashboard" ? `Hi, ${String(currentUser.name || "there").split(" ")[0]}` : cur.label;

  // hide the bottom bar while the on-screen keyboard is up
  useEffect(() => {
    const isField = (el) => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !["checkbox", "radio", "button", "file"].includes(el.type);
    const update = () => document.body.classList.toggle("kbd", !!isField(document.activeElement));
    const onOut = () => setTimeout(update, 60);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", onOut);
    return () => { document.removeEventListener("focusin", update); document.removeEventListener("focusout", onOut); document.body.classList.remove("kbd"); };
  }, []);

  // ---- keyboard shortcuts (PC) ----
  const [keysOpen, setKeysOpen] = useState(false);
  const itemsRef = useRef(items); itemsRef.current = items;
  useEffect(() => {
    const inField = (el) => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    const focusSearch = () => { setTimeout(() => { const el = document.querySelector('main input[type="search"], main input[placeholder*="earch"], main input[placeholder*="can"]'); if (el) { el.focus(); el.select && el.select(); } }, 80); };
    const onKey = (e) => {
      if (document.querySelector(".sheet-overlay, .lock-screen")) { if (e.key === "?" && !inField(e.target)) setKeysOpen(false); return; }
      const list = itemsRef.current;
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) { const it = list[Number(e.key) - 1]; if (it) { e.preventDefault(); setTab(it.id); } return; }
      if (e.key === "F1" || (e.key === "?" && !inField(e.target))) { e.preventDefault(); setKeysOpen(true); return; }
      if (e.key === "F2" || (e.ctrlKey && (e.key === "n" || e.key === "N"))) { e.preventDefault(); const co = list.find((i) => i.id === "checkout"); if (co) { setTab("checkout"); focusSearch(); } return; }
      if ((e.ctrlKey && (e.key === "k" || e.key === "K" || e.key === "f" || e.key === "F")) || (e.key === "/" && !inField(e.target))) { e.preventDefault(); focusSearch(); return; }
      if (e.key === "F9" || (e.ctrlKey && e.key === "Enter")) { const b = [...document.querySelectorAll("main button")].find((x) => /^(Complete sale|Record credit sale)/.test(x.textContent.trim()) && !x.disabled); if (b) { e.preventDefault(); b.click(); } return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTab]);

  return (
    <>
      <header className="appbar">
        <div className="appbar-brand">
          <img src={LOGO_MARK} alt="" style={{ ...styles.brandMark, width: 36, height: 36, borderRadius: 11 }} />
          <div style={{ ...styles.brandName, fontSize: 16 }}>Ilelah Business Suite</div>
        </div>
        <div className="appbar-titles">
          <div className="appbar-title">{title}</div>
          {sub ? <div className="appbar-sub">{sub}</div> : null}
        </div>
        <nav className="tb-nav" aria-label="Sections">
          {items.map((it, ix) => {
            const Icon = it.icon;
            return (
              <button key={it.id} className={"tn-btn" + (tab === it.id ? " tn-active" : "")} onClick={() => setTab(it.id)} aria-current={tab === it.id ? "page" : undefined} title={ix < 9 ? `Alt+${ix + 1}` : undefined}>
                <Icon size={19} strokeWidth={2.1} />{it.label}
                {!!it.badge && <span className="tn-badge">{it.badge}</span>}
                {ix < 9 && <kbd className="tn-key">Alt+{ix + 1}</kbd>}
              </button>
            );
          })}
        </nav>
        <div className="appbar-actions">
          {isAdmin && multiBranch && (
            <label className="branch-chip" title="Branch you are working from">
              <BranchIcon size={15} color={colors.primary} />
              <select value={workingBranchId || ""} onChange={(e) => setWorkingBranchId(e.target.value)} aria-label="Working branch">
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
          )}
          <SyncChip sync={sync} />
          <button type="button" className="avatar-btn" aria-label="Account" onClick={() => setAcctOpen(true)}>
            {(currentUser.name || "?").trim().charAt(0).toUpperCase()}
          </button>
        </div>
        <div className="side-foot">
          <button type="button" onClick={() => setKeysOpen(true)}><Info size={17} /> Keyboard shortcuts<span style={{ marginLeft: "auto", opacity: .6 }}>F1</span></button>
          <div className="ver">{LICENSE_CONFIG.productName} · v1.17 for Windows</div>
        </div>
      </header>

      {keysOpen && (
        <Modal title="Keyboard shortcuts" onClose={() => setKeysOpen(false)}>
          <div className="kbd-grid" style={{ paddingBottom: 18 }}>
            <kbd>F2</kbd><span>New sale (jumps to Sell and the search box)</span>
            <kbd>F9</kbd><span>Complete the sale (same as Ctrl+Enter)</span>
            <kbd>Ctrl + K</kbd><span>Search (press / on any screen)</span>
            <kbd>Alt + 1 … 9</kbd><span>Go to a section in the left menu</span>
            <kbd>Enter</kbd><span>In the search box: add the scanned or matched item</span>
            <kbd>Esc</kbd><span>Close a window</span>
            <kbd>F1</kbd><span>Show this list (or press ?)</span>
          </div>
        </Modal>
      )}

      <nav className="bottom-nav" aria-label="Main navigation">
        {primary.map((it) => {
          const Icon = it.icon;
          const on = tab === it.id;
          return (
            <button key={it.id} className={"bn-btn" + (on ? " bn-active" : "")} onClick={() => go(it.id)} aria-current={on ? "page" : undefined}>
              <span className="bn-ic"><Icon size={22} strokeWidth={on ? 2.3 : 1.9} /></span>
              <span>{it.short}</span>
              {!!it.badge && <span className="bn-badge">{it.badge}</span>}
            </button>
          );
        })}
        {more.length > 0 && (
          <button className={"bn-btn" + (moreActive ? " bn-active" : "")} onClick={() => setMoreOpen(true)}>
            <span className="bn-ic"><MoreIcon size={22} strokeWidth={moreActive ? 2.3 : 1.9} /></span>
            <span>More</span>
          </button>
        )}
      </nav>

      {moreOpen && (
        <Modal title="More" onClose={() => setMoreOpen(false)}>
          <div className="more-grid">
            {more.map((it) => {
              const Icon = it.icon;
              return (
                <button key={it.id} className={"more-item" + (tab === it.id ? " more-active" : "")} onClick={() => go(it.id)}>
                  <span className="mi-ic"><Icon size={22} strokeWidth={2} /></span>
                  <span>{it.label}</span>
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      {acctOpen && (
        <Modal title="Account" onClose={() => setAcctOpen(false)}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "6px 0 16px" }}>
            <Avatar name={currentUser.name} size={52} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{currentUser.name}</div>
              <div style={{ color: colors.inkSoft, fontSize: 13.5 }}>
                {isAdmin ? "Owner / Admin" : "Staff"}{!isAdmin && multiBranch && myBranch ? ` · ${myBranch.name}` : ""}
              </div>
            </div>
          </div>
          {license && license.ok && (
            <div style={{ background: colors.primarySoft, color: colors.primaryDark, borderRadius: 12, padding: "10px 12px", fontSize: 13.5, display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}>
              <BadgeCheck size={18} />
              <span>Licensed{license.name ? ` to ${license.name}` : ""} · {describeExpiry(license.expiryDay)}</span>
            </div>
          )}
          <div style={styles.stack}>
            <Field label="Appearance"><Segmented value={ctx.ui.theme} onChange={(v) => ctx.changeUi({ theme: v })} options={THEMES} /></Field>
            <Field label="Text size"><Segmented value={ctx.ui.textSize} onChange={(v) => ctx.changeUi({ textSize: v })} options={TEXT_SIZES.map((t) => [t[0], t[1]])} /></Field>
            <Field label="PIN lock" hint={ctx.pinSet ? "Your 4-digit PIN unlocks the app and lets cashiers share one phone." : "Set a 4-digit PIN to lock the app when you step away."}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Button small variant="secondary" icon={KeyRound} onClick={() => setPinDlg(true)}>{ctx.pinSet ? "Change PIN" : "Set PIN"}</Button>
                {ctx.pinSet && <Button small icon={Lock} onClick={() => { setAcctOpen(false); ctx.lockNow(); }}>Lock now</Button>}
                {ctx.pinSet && <Button small variant="secondary" onClick={async () => { if (await ctx.confirm({ title: "Remove your PIN?", text: "The app will no longer lock.", okLabel: "Remove", danger: true })) { ctx.clearMyPin(); ctx.showToast("PIN removed."); } }}>Remove PIN</Button>}
              </div>
            </Field>
            {ctx.pinSet && (
              <Field label="Lock automatically after"><Segmented value={String(ctx.ui.autoLock || 0)} onChange={(v) => ctx.changeUi({ autoLock: Number(v) })} options={[["0", "Never"], ["1", "1 min"], ["5", "5 min"], ["15", "15 min"]]} /></Field>
            )}
            {ctx.pinSet && !ctx.cloudOn && (ctx.users || []).some((u) => u.id !== currentUser.id && hasPin(u.id)) && (
              <Button variant="secondary" icon={Users} onClick={() => { setAcctOpen(false); ctx.lockNow(); }}>Switch user (cashier hand-over)</Button>
            )}
          </div>
          <div className="sheet-actions" style={{ position: "static" }}>
            <Button variant="danger" icon={LogOut} onClick={() => { setAcctOpen(false); onLogout(); }}>Sign out</Button>
          </div>
        </Modal>
      )}
      {pinDlg && <PinSetup onClose={() => setPinDlg(false)} onSave={async (pin) => { await ctx.setMyPin(pin); setPinDlg(false); ctx.showToast("PIN saved."); }} />}
    </>
  );
}

// ---------- admin dashboard ----------
function QuickActions({ items }) {
  return (
    <div className="qa-grid">
      {items.map((q) => {
        const Icon = q.icon;
        return (
          <button key={q.label} type="button" className="qa" onClick={q.onClick}>
            <span className="qa-ic" style={{ background: q.bg, color: q.fg }}><Icon size={22} strokeWidth={2} /></span>
            {q.label}
          </button>
        );
      })}
    </div>
  );
}

function AdminDashboard({ products, sales, purchases, expenses, customers, creditPayments, branches, multiBranch, setTab, goAction, currentUser }) {
  const [branchFilter, setBranchFilter] = useState("all");
  const scopedSales = branchFilter === "all" ? sales : sales.filter((s) => s.branchId === branchFilter);
  const scopedExpenses = branchFilter === "all" ? expenses : expenses.filter((e) => e.branchId === branchFilter);
  const scopedPurchases = branchFilter === "all" ? purchases : purchases.filter((p) => p.branchId === branchFilter);

  const todaysSales = scopedSales.filter((s) => s.date === todayStr());
  const revenueToday = todaysSales.reduce((a, s) => a + saleNet(s), 0);
  const costToday = todaysSales.reduce((a, s) => a + saleNetCost(s), 0);
  const expensesToday = scopedExpenses.filter((e) => e.date === todayStr()).reduce((a, e) => a + e.amount, 0);
  const netProfitToday = revenueToday - costToday - expensesToday;
  const todayCount = todaysSales.length;
  const todayKept = todaysSales.reduce((a, s) => a + collectedNet(s), 0);
  const todayCredit = todaysSales.filter((s) => s.paymentType === "credit").reduce((a, s) => a + s.balanceDue, 0);
  const todayDiscounts = todaysSales.reduce((a, s) => a + saleDiscount(s.items), 0);
  const todayReturns = scopedSales.reduce((a, s) => a + saleReturns(s).filter((r) => r.date === todayStr()).reduce((b, r) => b + r.amount, 0), 0);
  const todayCashiers = useMemo(() => byCashier(todaysSales), [todaysSales]);
  const yKey = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return localDateStr(d); })();
  const revenueYesterday = scopedSales.filter((s) => s.date === yKey).reduce((a, s) => a + saleNet(s), 0);
  const vsYesterday = revenueYesterday > 0 ? ((revenueToday - revenueYesterday) / revenueYesterday) * 100 : null;

  const allRevenue = scopedSales.reduce((a, s) => a + saleNet(s), 0);
  const allCost = scopedSales.reduce((a, s) => a + saleNetCost(s), 0);
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
      const key = localDateStr(d);
      const daySales = scopedSales.filter((s) => s.date === key);
      const dayExpenses = scopedExpenses.filter((e) => e.date === key).reduce((a, e) => a + e.amount, 0);
      const revenue = daySales.reduce((a, s) => a + saleNet(s), 0);
      const cost = daySales.reduce((a, s) => a + saleNetCost(s), 0);
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
    const pool = todaysSales.length ? todaysSales : scopedSales;
    pool.forEach((s) => s.items.forEach((it) => { map[it.name] = (map[it.name] || 0) + it.qty; }));
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [scopedSales, todaysSales]);

  const owingCount = new Set(sales.filter((s) => s.paymentType === "credit").map((s) => s.customerId)).size;

  return (
    <div style={styles.stack} className="dash-root">
      {multiBranch && (
        <Chips value={branchFilter} onChange={setBranchFilter} options={[["all", "All branches"], ...branches.map((b) => [b.id, b.name])]} />
      )}

      <div className="hero">
        <div className="hero-label">Today's sales</div>
        <div className="hero-amount">{money(revenueToday)}</div>
        <div style={{ fontSize: 13, marginTop: 4, display: "flex", alignItems: "center", gap: 4, opacity: 0.92 }}>
          {vsYesterday === null
            ? <span>{todaysSales.length} sale{todaysSales.length === 1 ? "" : "s"} so far today</span>
            : <>{vsYesterday >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}<span>{Math.abs(vsYesterday).toFixed(0)}% {vsYesterday >= 0 ? "up" : "down"} vs yesterday · {todaysSales.length} sale{todaysSales.length === 1 ? "" : "s"}</span></>}
        </div>
        <div className="hero-row">
          <div className="hero-pill"><div className="k">Net profit</div><div className="v num">{money(netProfitToday)}</div></div>
          <div className="hero-pill"><div className="k">Expenses</div><div className="v num">{money(expensesToday)}</div></div>
        </div>
      </div>

      <div>
        <SectionHeader title="Today at a glance" onAction={() => setTab("history")} actionLabel="All sales" />
        <div className="card" style={{ padding: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)" }}>
            {[
              ["Sales made", todayCount, null],
              ["Cash & transfers kept", money(todayKept), colors.green],
              ["Given on credit", money(todayCredit), todayCredit > 0 ? colors.red : null],
              ["Discounts given", money(todayDiscounts), todayDiscounts > 0 ? colors.amber : null],
              ["Returned by customers", money(todayReturns), todayReturns > 0 ? colors.red : null],
              ["Gross profit", money(revenueToday - costToday), (revenueToday - costToday) < 0 ? colors.red : null],
            ].map(([k, v, c], i) => (
              <div key={k} style={{ padding: "12px 14px", borderTop: i > 1 ? `1px solid ${colors.line}` : "none", borderLeft: i % 2 ? `1px solid ${colors.line}` : "none" }}>
                <div style={{ fontSize: 12, color: colors.inkSoft }}>{k}</div>
                <div className="num" style={{ fontSize: 17, fontWeight: 700, color: c || colors.ink }}>{v}</div>
              </div>
            ))}
          </div>
          {todayCashiers.length > 0 && (
            <div style={{ borderTop: `1px solid ${colors.line}`, padding: "10px 14px", fontSize: 13, color: colors.inkSoft }}>
              {todayCashiers.map((c) => <div key={c.key} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span>{c.key} · {c.count} sale{c.count === 1 ? "" : "s"}</span><span className="num" style={{ color: colors.ink, fontWeight: 600 }}>{money(c.revenue)}</span></div>)}
            </div>
          )}
        </div>
      </div>

      <QuickActions items={[
        { label: "New sale", icon: ShoppingCart, bg: colors.primarySoft, fg: colors.primary, onClick: () => setTab("checkout") },
        { label: "Add product", icon: PackageOpen, bg: colors.blueSoft, fg: colors.blue, onClick: () => goAction("inventory", "add-product") },
        { label: "Log expense", icon: ReceiptText, bg: colors.amberSoft, fg: colors.amber, onClick: () => goAction("expenses", "add-expense") },
        { label: "Day close", icon: DayIcon, bg: "#F3E8FF", fg: "#7E22CE", onClick: () => setTab("dayclose") },
      ]} />

      <div className="stat-grid">
        <StatTile icon={TrendingUp} tone="green" label="All-time profit" value={money(netProfitAll)} />
        <StatTile icon={Boxes} tone="blue" label="Inventory value" value={money(inventoryValue)} onClick={() => setTab("inventory")} />
        <StatTile icon={HandCoins} tone="red" label="Owed by customers" value={money(outstandingCredit)} sub={`${owingCount} customer${owingCount === 1 ? "" : "s"}`} onClick={() => setTab("credit")} />
        <StatTile icon={Truck} tone="amber" label="Stock purchases" value={money(totalSpentOnStock)} onClick={() => setTab("purchases")} />
      </div>

      <div className="dash-cols">
        <div>
          <SectionHeader title="Net profit, last 14 days" />
          <div className="card"><ProfitBars data={last14} /></div>
        </div>

        <div>
          <SectionHeader title={`Low stock${lowStock.length ? ` (${lowStock.length})` : ""}`} onAction={lowStock.length ? () => setTab("inventory") : null} actionLabel="View stock" />
          {lowStock.length === 0 ? (
            <div className="card"><EmptyState icon={BadgeCheck} title="All stocked up" text="Nothing is below its low-stock level." /></div>
          ) : (
            <List>
              {lowStock.slice(0, 6).map((row) => (
                <Row key={row.product.id + "-" + row.branch.id}
                  lead={<AlertTriangle size={20} />} leadTone={{ background: colors.amberSoft, color: colors.amber }}
                  title={row.product.name}
                  sub={`${row.product.sku || "No SKU"}${branchFilter === "all" && multiBranch ? ` · ${row.branch.name}` : ""}`}
                  value={<Badge kind={row.stock <= 0 ? "danger" : "warn"}>{row.stock <= 0 ? "Out" : `${row.stock} left`}</Badge>} />
              ))}
            </List>
          )}
        </div>

        <div>
          <SectionHeader title={todaysSales.length ? "Top sellers today" : "Top sellers"} />
          {topSellers.length === 0 ? (
            <div className="card"><EmptyState icon={ShoppingBag} title="No sales yet" text="Your best sellers will show up here after the first sales." /></div>
          ) : (
            <List>
              {topSellers.map(([name, qty], i) => (
                <Row key={name} lead={<b>{i + 1}</b>} title={name} value={`${qty} sold`} />
              ))}
            </List>
          )}
        </div>

        <div>
          <SectionHeader title="Money overview" />
          <List>
            <Row lead={<Truck size={20} />} title="Stock purchases" value={money(totalSpentOnStock)} />
            <Row lead={<ReceiptText size={20} />} title="Operating expenses" value={money(allExpenses)} />
            <Row lead={<TrendingUp size={20} />} title="Revenue, all time" value={money(allRevenue)} />
          </List>
        </div>
      </div>
    </div>
  );
}

// ---------- staff dashboard ----------
function StaffDashboard({ products, sales, currentUser, activeBranchId, setTab }) {
  const todaysSales = sales.filter((s) => s.date === todayStr() && s.branchId === activeBranchId);
  const mySales = todaysSales.filter((s) => s.cashierId === currentUser.id);
  const myTotal = mySales.reduce((a, s) => a + saleNet(s), 0);
  const shopTxCount = todaysSales.length;
  const lowStock = products.filter((p) => getStock(p, activeBranchId) <= p.lowStock).sort((a, b) => getStock(a, activeBranchId) - getStock(b, activeBranchId));

  return (
    <div style={styles.stack}>
      <div className="hero">
        <div className="hero-label">Your sales today</div>
        <div className="hero-amount">{money(myTotal)}</div>
        <div className="hero-row">
          <div className="hero-pill"><div className="k">Your transactions</div><div className="v num">{mySales.length}</div></div>
          <div className="hero-pill"><div className="k">Shop transactions</div><div className="v num">{shopTxCount}</div></div>
        </div>
      </div>
      <QuickActions items={[
        { label: "New sale", icon: ShoppingCart, bg: colors.primarySoft, fg: colors.primary, onClick: () => setTab("checkout") },
        { label: "Credit", icon: HandCoins, bg: colors.redSoft, fg: colors.red, onClick: () => setTab("credit") },
        { label: "Stock", icon: Package, bg: colors.blueSoft, fg: colors.blue, onClick: () => setTab("inventory") },
        { label: "Day close", icon: DayIcon, bg: "#F3E8FF", fg: "#7E22CE", onClick: () => setTab("dayclose") },
      ]} />
      <div>
        <SectionHeader title="Low stock: worth flagging to the owner" />
        {lowStock.length === 0 ? (
          <div className="card"><EmptyState icon={BadgeCheck} title="All stocked up" text="Nothing is below its low-stock level." /></div>
        ) : (
          <List>
            {lowStock.map((p) => (
              <Row key={p.id} lead={<AlertTriangle size={20} />} leadTone={{ background: colors.amberSoft, color: colors.amber }}
                title={p.name} sub={p.sku || "No SKU"}
                value={<Badge kind={getStock(p, activeBranchId) <= 0 ? "danger" : "warn"}>{getStock(p, activeBranchId) <= 0 ? "Out" : `${getStock(p, activeBranchId)} left`}</Badge>} />
            ))}
          </List>
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
  return { id: null, name: "", sku: "", barcode: "", category: "", cost: "", price: "", stock: "", lowStock: "", quick: false };
}

function Inventory({ products, setProducts, showToast, readOnly, activeBranchId, branches, multiBranch, pendingAction, clearPending }) {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(null);
  const [importing, setImporting] = useState(false);
  const [scanTarget, setScanTarget] = useState(null); // "form" | "search"
  const [filter, setFilter] = useState("all");
  const [toDelete, setToDelete] = useState(null);
  const belowCount = !readOnly ? products.filter(isBelowCost).length : 0;
  const branchName = (branches.find((b) => b.id === activeBranchId) || {}).name || "";

  useEffect(() => {
    if (pendingAction === "add-product" && !readOnly) { setForm(emptyProduct()); }
    if (pendingAction) clearPending && clearPending();
  }, [pendingAction]);

  const stockOf = (p) => getStock(p, activeBranchId);
  const lowCount = products.filter((p) => stockOf(p) <= p.lowStock && stockOf(p) > 0).length;
  const outCount = products.filter((p) => stockOf(p) <= 0).length;
  const pinCount = products.filter((p) => p.quick).length;

  const filtered = products.filter((p) => {
    const q = query.toLowerCase();
    const match = p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode || "").includes(q) || p.category.toLowerCase().includes(q);
    if (!match) return false;
    if (filter === "low") return stockOf(p) <= p.lowStock && stockOf(p) > 0;
    if (filter === "out") return stockOf(p) <= 0;
    if (filter === "below") return isBelowCost(p);
    if (filter === "pinned") return !!p.quick;
    return true;
  });
  const toggleQuick = (p) => setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, quick: !x.quick } : x)));

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
        cost: Number(form.cost) || 0, price: Number(form.price) || 0, lowStock: Number(form.lowStock) || 0, quick: !!form.quick,
        stock: { ...p.stock, [activeBranchId]: Number(form.stock) || 0 },
      } : p));
      showToast("Product updated.");
    } else {
      const newProduct = {
        id: makeId("p-", uid), name: form.name.trim(), sku: form.sku.trim(), barcode: form.barcode || "", category: form.category || "",
        cost: Number(form.cost) || 0, price: Number(form.price) || 0, lowStock: Number(form.lowStock) || 0, quick: !!form.quick,
        stock: { [activeBranchId]: Number(form.stock) || 0 },
      };
      setProducts((prev) => [...prev, newProduct]);
      showToast("Product added.");
    }
    close();
  };

  const remove = (id) => {
    const gone = products.find((p) => p.id === id);
    setProducts((prev) => prev.filter((p) => p.id !== id));
    showToast("Product removed.", "ok", 7000, gone ? { label: "Undo", run: () => { setProducts((prev) => (prev.some((p) => p.id === gone.id) ? prev : [...prev, gone]), "server-stock"); showToast("Product restored."); } } : undefined);
  };

  const chipOptions = [["all", "All", products.length], ["low", "Low stock", lowCount], ["out", "Out of stock", outCount]];
  if (!readOnly) chipOptions.push(["below", "Below cost", belowCount], ["pinned", "Pinned", pinCount]);

  return (
    <div style={styles.stack}>
      <div style={styles.searchBox}>
        <Search size={18} />
        <input placeholder="Search products" value={query} onChange={(e) => setQuery(e.target.value)} style={styles.searchInput} />
        {query ? <IconButton icon={X} label="Clear search" size={16} onClick={() => setQuery("")} /> : null}
        <button type="button" style={styles.camBtn} onClick={() => setScanTarget("search")} aria-label="Scan barcode"><ScanBarcode size={20} /></button>
      </div>
      {!readOnly && (
        <div style={{ display: "flex", gap: 10 }}>
          <Button icon={Plus} onClick={openAdd} style={{ flex: 1 }}>Add product</Button>
          <Button variant="secondary" icon={UploadIcon} onClick={() => setImporting(true)} style={{ flex: 1 }}>Import / export</Button>
        </div>
      )}
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

      <Chips value={filter} onChange={setFilter} options={chipOptions} />

      {belowCount > 0 && filter !== "below" && (
        <div style={{ ...styles.warnNote, display: "flex", alignItems: "center", gap: 10 }}>
          <AlertTriangle size={20} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{belowCount} product{belowCount === 1 ? " is" : "s are"} priced below cost, so each sale loses money.</span>
          <button type="button" className="link-btn" style={{ color: colors.red }} onClick={() => setFilter("below")}>Show</button>
        </div>
      )}
      {multiBranch && <div style={{ fontSize: 13, color: colors.inkSoft, display: "flex", alignItems: "center", gap: 6 }}><BranchIcon size={15} />Showing stock for <b>{branchName}</b>. Switch branch from the top bar.</div>}

      {filtered.length === 0 ? (
        <div className="card">
          {products.length === 0
            ? <EmptyState icon={PackageOpen} title="No products yet" text={readOnly ? "The owner hasn't added any products." : "Add your first product, or import your whole stock list from a spreadsheet."}
                action={!readOnly ? <Button icon={Plus} onClick={openAdd}>Add product</Button> : null} />
            : <EmptyState icon={Search} title="No products match" text="Try a different search or filter." />}
        </div>
      ) : (
        <List wide>
          {filtered.map((p) => {
            const stock = stockOf(p);
            const out = stock <= 0;
            const low = !out && stock <= p.lowStock;
            const below = !readOnly && isBelowCost(p);
            const content = (
              <>
                <Avatar name={p.name} size={42} />
                <span className="row-main">
                  <div className="row-title">{p.name}</div>
                  <div className="row-sub">{[p.sku, p.category].filter(Boolean).join(" · ")}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                    <Badge kind={out ? "danger" : low ? "warn" : "ok"}>{out ? "Out of stock" : `${stock} in stock`}</Badge>
                    {below && <Badge kind="danger" icon={AlertTriangle}>Below cost</Badge>}
                    {multiBranch && <Badge kind="neutral">{totalStock(p)} total</Badge>}
                  </div>
                </span>
                <span className="row-end">
                  <div className="row-value">{money(p.price)}</div>
                  {!readOnly && <div className="row-sub" style={{ marginTop: 2 }}>Cost {money(p.cost)}</div>}
                </span>
              </>
            );
            if (readOnly) return <div key={p.id} className="row">{content}</div>;
            return (
              <div key={p.id} className="row-split">
                <button type="button" className="row" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>{content}</button>
                <button type="button" className={"star-btn" + (p.quick ? " on" : "")} onClick={() => toggleQuick(p)}
                  aria-label={p.quick ? `Unpin ${p.name} from quick sale` : `Pin ${p.name} to quick sale`} title="Pin to Sell quick-sale tiles">
                  <Star size={20} fill={p.quick ? "currentColor" : "none"} />
                </button>
              </div>
            );
          })}
        </List>
      )}

      {form && !readOnly && (
        <Modal onClose={close} title={form.id ? "Edit product" : "Add product"}>
          <div style={styles.stack}>
            <Field label="Product name">
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Whole Milk 1L" autoFocus={!form.id && !("ontouchstart" in window)} />
            </Field>
            <div style={styles.formGrid2}>
              <Field label="SKU">
                <input style={styles.input} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. DRY-014" />
              </Field>
              <Field label="Category">
                <input style={styles.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Dairy" />
              </Field>
            </div>
            <Field label="Barcode">
              <div style={{ display: "flex", gap: 8 }}>
                <input style={{ ...styles.input, flex: 1, minWidth: 0 }} value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Scan or type UPC/EAN" inputMode="numeric" />
                <button type="button" style={{ ...styles.camBtn, width: 46, height: 46 }} onClick={() => setScanTarget("form")} aria-label="Scan barcode with camera"><ScanBarcode size={20} /></button>
              </div>
            </Field>
            <div style={styles.formGrid2}>
              <Field label={`Cost price (${CURRENCY})`}>
                <input style={styles.input} type="number" inputMode="decimal" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
              </Field>
              <Field label={`Sell price (${CURRENCY})`}>
                <input style={styles.input} type="number" inputMode="decimal" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </Field>
              <Field label={multiBranch ? `Stock at ${branchName}` : "Current stock"}>
                <input style={styles.input} type="number" inputMode="numeric" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
              </Field>
              <Field label="Low stock alert at">
                <input style={styles.input} type="number" inputMode="numeric" value={form.lowStock} onChange={(e) => setForm({ ...form, lowStock: e.target.value })} />
              </Field>
            </div>
            {Number(form.cost) > 0 && Number(form.price) > 0 && (
              Number(form.price) < Number(form.cost)
                ? <div style={{ ...styles.warnNote, display: "flex", gap: 8, alignItems: "flex-start" }}><AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />Selling below cost: you lose {money(Number(form.cost) - Number(form.price))} on every unit.</div>
                : <div style={{ ...styles.changeDue, display: "flex", gap: 8, alignItems: "center" }}><TrendingUp size={18} />Profit per unit {money(Number(form.price) - Number(form.cost))} · {marginPct(form.price, form.cost).toFixed(0)}% margin</div>
            )}
            <Toggle checked={!!form.quick} onChange={(v) => setForm({ ...form, quick: v })} label="Pin to quick-sale tiles" hint="One-tap button on the Sell screen, good for items with no barcode" />
            {multiBranch && !form.id && <div style={styles.emptyNote}>New products start with 0 stock in your other branches. Use Purchases to stock them there.</div>}
          </div>
          <div className="sheet-actions">
            {form.id && <Button variant="danger" icon={Trash2} onClick={() => { setToDelete(form); close(); }} style={{ flex: "0 0 auto" }}>Delete</Button>}
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button icon={Check} onClick={save}>{form.id ? "Save changes" : "Add product"}</Button>
          </div>
        </Modal>
      )}

      {toDelete && (
        <Modal title="Delete product?" onClose={() => setToDelete(null)}>
          <p style={{ color: colors.inkSoft, lineHeight: 1.5, margin: "4px 0 0" }}>
            <b style={{ color: colors.ink }}>{toDelete.name}</b> will be removed from your stock list. Past sales that include it are kept.
          </p>
          <div className="sheet-actions">
            <Button variant="secondary" onClick={() => setToDelete(null)}>Cancel</Button>
            <Button variant="danger" icon={Trash2} onClick={() => { remove(toDelete.id); setToDelete(null); }}>Delete</Button>
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


// ---------- Bluetooth thermal printer ----------
function usePrinter() {
  const [cfg, setCfg] = useState(getPrinter);
  useEffect(() => {
    const h = () => setCfg(getPrinter());
    window.addEventListener("tally-printer", h);
    return () => window.removeEventListener("tally-printer", h);
  }, []);
  return cfg;
}

// Builds the receipt bytes for the saved printer and sends them. quiet = only report failures (used for auto-print).
async function thermalPrint(makeBytes, showToast, { quiet = false } = {}) {
  const cfg = getPrinter();
  if (!cfg.address) { showToast("No printer set up yet. Go to Settings > Receipt printer.", "err"); return false; }
  try {
    if (!quiet) showToast("Sending to printer…", "ok", 1800);
    await printBytes(cfg, makeBytes(cfg));
    if (!quiet) showToast("Sent to printer.");
    return true;
  } catch (e) {
    showToast((e && e.message) || "Could not reach the printer.", "err", 5000);
    return false;
  }
}

function PrinterSetupModal({ settings, showToast, onClose }) {
  const saved = getPrinter();
  const [sel, setSel] = useState({ address: saved.address, name: saved.name });
  const [width, setWidth] = useState(saved.width);
  const [auto, setAuto] = useState(saved.auto);
  const [devices, setDevices] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setErr(""); setBusy(true);
    try {
      const list = await listPairedDevices();
      list.sort((a, b) => (b.printer ? 1 : 0) - (a.printer ? 1 : 0) || (a.name || "").localeCompare(b.name || ""));
      setDevices(list);
    } catch (e) { setDevices([]); setErr((e && e.message) || "Could not read the paired Bluetooth devices."); }
    setBusy(false);
  };
  useEffect(() => { load(); }, []);

  const draft = { address: sel.address, name: sel.name, width: Number(width), auto };
  const test = async () => {
    if (!sel.address) { setErr("Pick your printer from the list first."); return; }
    setErr(""); setBusy(true);
    try { await printBytes(draft, buildTest(draft, settings)); showToast("Test page sent."); }
    catch (e) { setErr((e && e.message) || "Could not reach the printer."); }
    setBusy(false);
  };
  const save = () => { setPrinter(draft); showToast(sel.address ? `Printer saved: ${sel.name || sel.address}` : "Printer removed."); onClose(); };
  const remove = () => { setPrinter({ address: "", name: "", width: Number(width), auto: false }); showToast("Printer removed."); onClose(); };

  return (
    <Modal onClose={onClose} title="Receipt printer">
      <div style={styles.stack}>
        <div style={{ background: colors.blueSoft, color: colors.blue, borderRadius: 12, padding: "10px 12px", fontSize: 13.5, lineHeight: 1.5, display: "flex", gap: 10 }}>
          <Info size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Switch the printer on, pair it once in Android's Bluetooth settings (PIN is usually <b>0000</b> or <b>1234</b>), then come back and tap it below.</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" icon={Bluetooth} small onClick={() => openBluetoothSettings().catch(() => {})} style={{ flex: 1 }}>Bluetooth settings</Button>
          <Button variant="secondary" icon={RefreshCw} small loading={busy} onClick={load} style={{ flex: 1 }}>Refresh</Button>
        </div>
        {err && <div style={styles.loginError} role="alert">{err}</div>}
        {devices === null && <div style={{ display: "flex", justifyContent: "center", padding: 16, color: colors.primary }}><Spinner size={22} /></div>}
        {devices && devices.length === 0 && !err && <EmptyState icon={Bluetooth} title="No paired devices" text="Pair your printer in Bluetooth settings, then tap Refresh." />}
        {devices && devices.length > 0 && (
          <List>
            {devices.map((d) => (
              <Row key={d.address} onClick={() => setSel({ address: d.address, name: d.name })}
                lead={<PrinterIcon size={19} />} leadTone={sel.address === d.address ? { background: colors.primary, color: "var(--on-primary)" } : null}
                title={d.name || "Unnamed device"} sub={d.address}
                value={sel.address === d.address ? <Badge kind="ok" icon={Check}>Selected</Badge> : d.printer ? <Badge kind="primary">Printer</Badge> : undefined} />
            ))}
          </List>
        )}
        <Field label="Paper width">
          <select style={styles.input} value={width} onChange={(e) => setWidth(e.target.value)}>
            <option value={32}>58 mm paper (32 characters per line)</option>
            <option value={48}>80 mm paper (48 characters per line)</option>
          </select>
        </Field>
        <Toggle checked={auto} onChange={setAuto} label="Print automatically after every sale" />
      </div>
      <div className="sheet-actions">
        {saved.address && <Button variant="danger" onClick={remove} style={{ flex: "0 0 auto" }}>Remove</Button>}
        <Button variant="secondary" icon={PrinterIcon} disabled={busy || !sel.address} onClick={test}>Test print</Button>
        <Button icon={Check} onClick={save} disabled={!sel.address}>Save</Button>
      </div>
    </Modal>
  );
}

const isAdminLike = (ctx) => !!ctx.currentUser && ctx.currentUser.role === "admin";
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
  lines.push(pad("S/N Qty Description", 26) + "Price   Amount");
  sale.items.forEach((i, idx) => {
    lines.push(pad(`${String(idx + 1).padEnd(3)} ${String(i.qty).padEnd(3)} ${i.name}`, 26) + `${money(i.price)}  ${money(lineGross(i))}`);
    if (lineDiscount(i) > 0) lines.push(`     Discount: -${money(lineDiscount(i))}`);
  });
  lines.push("----------------------------------------");
  lines.push(`Items: ${sale.items.length}    Total qty: ${saleQty(sale.items)}`);
  if (saleDiscount(sale.items) > 0) { lines.push(`Subtotal: ${money(saleSubtotal(sale.items))}`); lines.push(`Discount: -${money(saleDiscount(sale.items))}`); }
  lines.push(`Amount Due: ${money(sale.total)}`);
  if (saleRefunded(sale) > 0) { lines.push(`Returned: -${money(saleRefunded(sale))}`); lines.push(`Net after returns: ${money(saleNet(sale))}`); }
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

const RETURN_REASONS = ["Wrong item", "Damaged / faulty", "Customer changed mind", "Expired"];
function ReceiptModal({ sale: saleProp, settings, branch, onClose, showToast, onEdit, viewing }) {
  const ctx = React.useContext(AppCtx);
  const [override, setOverride] = useState(null);       // shows the sale straight after a return, even where the parent keeps an older copy
  const sale = override && override.id === saleProp.id && saleReturns(override).length > saleReturns(saleProp).length ? override : saleProp;
  const [returning, setReturning] = useState(false);
  const [rq, setRq] = useState({});                     // productId -> qty to take back
  const [rRestock, setRRestock] = useState(true);
  const [rReason, setRReason] = useState(""); const [rOther, setROther] = useState("");
  const [rBusy, setRBusy] = useState(false);
  const startReturn = () => { setRq({}); setRRestock(true); setRReason(""); setROther(""); setReturning(true); };
  const retPreview = (() => { try { return Object.values(rq).some((q) => Number(q) > 0) ? buildReturn(sale, rq, { restock: rRestock }) : null; } catch (e) { return null; } })();
  const confirmReturn = async () => {
    const reason = (rReason === "Other" ? rOther : rReason).trim();
    if (!retPreview) { showToast("Choose at least one item to take back.", "err"); return; }
    if (!reason) { showToast("Pick or type a reason.", "err"); return; }
    setRBusy(true);
    try {
      if (!(await ctx.askOwner())) return;
      const updated = ctx.doReturn(sale.id, rq, { restock: rRestock, reason });
      setOverride(updated); setReturning(false);
      showToast(retPreview.ret.cashBack > 0 ? `Return recorded. Give back ${money(retPreview.ret.cashBack)}.` : "Return recorded. It was taken off what the customer owes.");
    } catch (e) { showToast(e && e.message === "return_qty_too_high" ? "That is more than was bought." : "Could not record the return.", "err"); }
    finally { setRBusy(false); }
  };
  const isCredit = sale.paymentType === "credit";
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [imgBusy, setImgBusy] = useState(false);
  const [discDrafts, setDiscDrafts] = useState([]);
  const [qtyDrafts, setQtyDrafts] = useState([]);
  const [gone, setGone] = useState([]);                 // lines the owner has marked for deletion
  const [extra, setExtra] = useState([]);               // items the owner is adding: { productId, name, cost, listPrice, qty, price, disc }
  const [addQ, setAddQ] = useState(""); const [addOpen, setAddOpen] = useState(false);
  const canReshape = isAdminLike(ctx) && saleReturns(sale).length === 0 && !(saleRefunded(sale) > 0) && (sale.status || "completed") === "completed";
  const startEdit = () => { setGone(sale.items.map(() => false)); setExtra([]); setAddQ(""); setAddOpen(false); setQtyDrafts(sale.items.map((i) => String(i.qty))); setDrafts(sale.items.map((i) => String(i.price))); setDiscDrafts(sale.items.map((i) => (lineDiscount(i) ? String(lineDiscount(i)) : ""))); setEditing(true); };
  const keptIdx = sale.items.map((_, i) => i).filter((i) => !gone[i]);
  const saveEdit = () => {
    if (keptIdx.some((i) => drafts[i] === "" || !(Number(drafts[i]) >= 0))) { showToast("Enter a valid price for every item.", "err"); return; }
    if (keptIdx.some((i) => qtyDrafts[i] === "" || !(Number(qtyDrafts[i]) > 0))) { showToast("Quantity must be more than 0. To take an item off, use the bin button.", "err"); return; }
    if (extra.some((e) => !(Number(e.qty) > 0) || e.price === "" || !(Number(e.price) >= 0))) { showToast("Enter a quantity and price for the item you added.", "err"); return; }
    if (keptIdx.some((i) => discDrafts[i] !== "" && (!(Number(discDrafts[i]) >= 0) || Number(discDrafts[i]) > Number(drafts[i]) * Number(qtyDrafts[i]))) || extra.some((e) => e.disc !== "" && (!(Number(e.disc) >= 0) || Number(e.disc) > Number(e.price) * Number(e.qty)))) { showToast("A discount cannot be negative or more than the line.", "err"); return; }
    if (keptIdx.length + extra.length === 0) { showToast("A receipt must keep at least one item. To cancel the whole sale use Return items.", "err"); return; }
    const changedShape = keptIdx.length !== sale.items.length || extra.length > 0;
    if (changedShape && !canReshape) { showToast("Only the owner can add or delete items, and not after a return.", "err"); return; }
    const updated = reviseSale(sale, {
      kept: keptIdx.map((i) => ({ index: i, qty: Number(qtyDrafts[i]), price: Number(drafts[i]), discount: Number(discDrafts[i]) || 0 })),
      added: extra.map((e) => ({ productId: e.productId, name: e.name, qty: Number(e.qty), price: Number(e.price), discount: Number(e.disc) || 0, cost: e.cost, listPrice: e.listPrice })),
    });
    if (!ctx.cloudOn) {
      const diffs = stockDiffs(sale, updated);
      const short = Object.entries(diffs).find(([id, d]) => { const p = (ctx.products || []).find((x) => x.id === id); return d < 0 && p && -d > getStock(p, sale.branchId); });
      if (short) { const p = (ctx.products || []).find((x) => x.id === short[0]); showToast(`Not enough ${p ? p.name : "stock"} in stock for that quantity.`, "err"); return; }
    }
    if (ctx.applyLineChanges) ctx.applyLineChanges(sale, updated);
    onEdit(updated);
    setEditing(false);
    showToast(changedShape ? "Receipt updated. Stock was adjusted." : "Receipt updated.");
  };
  const addable = (() => { const q = addQ.trim().toLowerCase(); if (!q) return []; const inUse = new Set([...sale.items.filter((_, i) => !gone[i]).map((i) => i.productId), ...extra.map((e) => e.productId)]); return (ctx.products || []).filter((p) => !inUse.has(p.id) && (p.name.toLowerCase().includes(q) || String(p.sku || "").toLowerCase().includes(q))).slice(0, 6); })();
  const addExtra = (p) => { setExtra([...extra, { productId: p.id, name: p.name, cost: p.cost, listPrice: p.price, qty: "1", price: String(p.price), disc: "" }]); setAddQ(""); setAddOpen(false); };
  const draftTotal = keptIdx.reduce((a, i) => a + Math.max(0, (Number(drafts[i]) || 0) * (Number(qtyDrafts[i]) || 0) - (Number(discDrafts[i]) || 0)), 0)
    + extra.reduce((a, e) => a + Math.max(0, (Number(e.price) || 0) * (Number(e.qty) || 0) - (Number(e.disc) || 0)), 0);
  const draftDelta = Math.round((draftTotal - sale.total) * 100) / 100;
  const shareImage = async () => {
    setImgBusy(true);
    try {
      const b64 = await renderReceiptPng(sale, settings, branch, money);
      await saveAndShareBase64(`receipt-${sale.invoiceNo}.png`, b64, "image/png");
    } catch (e) { showToast("Could not create the receipt image.", "err"); }
    setImgBusy(false);
  };
  const printer = usePrinter();
  const [setup, setSetup] = useState(false);
  const native = printerAvailable();
  const printBt = () => (printer.address ? thermalPrint((cfg) => buildSale(cfg, sale, settings, branch, money), showToast) : setSetup(true));
  return (
    <>
      <Modal onClose={editing ? () => setEditing(false) : returning ? () => setReturning(false) : onClose} title={returning ? "Take items back" : editing ? "Edit quantity, price & discount" : viewing ? `Receipt #${sale.invoiceNo}` : isCredit ? "Credit sale recorded" : "Sale complete"}>
        {returning ? (
          <>
            <div style={{ fontSize: 13.5, color: colors.inkSoft, marginBottom: 12, lineHeight: 1.5 }}>Choose what the customer is bringing back. The refund is worked out from what they really paid, discounts included.</div>
            <div style={styles.stack8}>
              {sale.items.filter((it) => returnableQty(sale, it) > 0).map((it) => {
                const max = returnableQty(sale, it); const q = Number(rq[it.productId]) || 0;
                return (
                  <div key={it.productId} style={{ background: colors.surface2, borderRadius: 14, padding: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{it.name}</div>
                    <div style={{ fontSize: 12.5, color: colors.inkSoft }}>Bought {it.qty}{max < it.qty ? `, ${max} can still come back` : ""} · {money(lineTotal(it) / it.qty)} each</div>
                    <div className="stepper" style={{ marginTop: 8 }}>
                      <button type="button" aria-label={`Fewer ${it.name}`} onClick={() => setRq({ ...rq, [it.productId]: Math.max(0, q - 1) })}><Minus size={16} /></button>
                      <input className="num" type="number" inputMode="numeric" min="0" max={max} aria-label={`Quantity to return of ${it.name}`} value={q} onChange={(e) => setRq({ ...rq, [it.productId]: Math.min(max, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} onFocus={(e) => e.target.select()} />
                      <button type="button" aria-label={`More ${it.name}`} onClick={() => setRq({ ...rq, [it.productId]: Math.min(max, q + 1) })}><Plus size={16} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 12 }}><Segmented value={rRestock ? "yes" : "no"} onChange={(v) => setRRestock(v === "yes")} options={[["yes", "Put back in stock"], ["no", "Damaged: don't restock"]]} /></div>
            <div className="chips" style={{ margin: "12px 0 0", padding: 0 }}>
              {[...RETURN_REASONS, "Other"].map((r) => <button key={r} type="button" className={"chip" + (rReason === r ? " on" : "")} onClick={() => setRReason(r)}>{r}</button>)}
            </div>
            {rReason === "Other" && <input style={{ ...styles.input, marginTop: 8 }} placeholder="What happened?" aria-label="Reason" value={rOther} onChange={(e) => setROther(e.target.value)} />}
            <div style={{ ...styles.poTotal, marginTop: 14 }}><span>Refund</span><span className="num">{money(retPreview ? retPreview.ret.amount : 0)}</span></div>
            {retPreview && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 6 }}>{retPreview.ret.cashBack > 0 ? <>Give the customer <b className="num">{money(retPreview.ret.cashBack)}</b> in cash{retPreview.ret.amount - retPreview.ret.cashBack > 0 ? <>; <b className="num">{money(retPreview.ret.amount - retPreview.ret.cashBack)}</b> comes off what they owe.</> : "."}</> : <>No cash goes back: <b className="num">{money(retPreview.ret.amount)}</b> comes off what the customer owes.</>}</div>}
            {!isAdminLike(ctx) && <div style={{ fontSize: 12.5, color: colors.amber, marginTop: 8 }}>The owner will be asked to type their PIN.</div>}
            <div className="sheet-actions">
              <Button variant="secondary" onClick={() => setReturning(false)}>Cancel</Button>
              <Button icon={Check} loading={rBusy} disabled={!retPreview} onClick={confirmReturn}>Confirm return</Button>
            </div>
          </>
        ) : editing ? (
          <>
            <div style={{ fontSize: 13.5, color: colors.inkSoft, marginBottom: 12, lineHeight: 1.5 }}>Change the quantity, selling price or discount (₦ off the line) of each item. The owner can also delete an item or add one. Totals and any amount owed are recalculated, and stock follows.</div>
            <div style={styles.stack8}>
              {sale.items.map((it, i) => (
                <div key={i} style={{ background: colors.surface2, borderRadius: 14, padding: 12, opacity: gone[i] ? 0.55 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5, textDecoration: gone[i] ? "line-through" : "none" }}>{it.name}</div>
                    {canReshape && <button type="button" className="icon-btn icon-btn-danger" aria-label={gone[i] ? `Keep ${it.name}` : `Delete ${it.name} from this receipt`} title={gone[i] ? "Keep this item" : "Delete this item"} onClick={() => setGone(gone.map((g, j) => (j === i ? !g : g)))}>{gone[i] ? <RefreshCw size={16} /> : <Trash2 size={16} />}</button>}
                  </div>
                  {gone[i] ? <div style={{ fontSize: 12.5, color: colors.red, marginTop: 6 }}>Will be deleted. {it.qty} go back into stock.</div> : (<>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                    <input style={{ ...styles.input, width: 74, flex: "0 0 74px" }} type="number" inputMode="decimal" step="any" min="0" aria-label={`Quantity for ${it.name}`} value={qtyDrafts[i] ?? ""} onChange={(e) => setQtyDrafts(qtyDrafts.map((d, j) => (j === i ? e.target.value : d)))} />
                    <span style={{ color: colors.inkSoft, fontSize: 13.5 }}>×</span>
                    <input style={styles.input} type="number" inputMode="decimal" step="0.01" aria-label={`Price for ${it.name}`} value={drafts[i]} onChange={(e) => setDrafts(drafts.map((d, j) => (j === i ? e.target.value : d)))} />
                    <span className="num" style={{ fontWeight: 700, minWidth: 84, textAlign: "right" }}>{money(Math.max(0, (Number(drafts[i]) || 0) * (Number(qtyDrafts[i]) || 0) - (Number(discDrafts[i]) || 0)))}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                    <span style={{ color: colors.inkSoft, fontSize: 13.5, whiteSpace: "nowrap" }}>Discount ₦</span>
                    <input style={styles.input} type="number" inputMode="decimal" step="0.01" placeholder="0" aria-label={`Discount for ${it.name}`} value={discDrafts[i] ?? ""} onChange={(e) => setDiscDrafts(discDrafts.map((d, j) => (j === i ? e.target.value : d)))} />
                  </div>
                  {Number(drafts[i]) > 0 && (Number(drafts[i]) * (Number(qtyDrafts[i]) || 1) - (Number(discDrafts[i]) || 0)) / (Number(qtyDrafts[i]) || 1) < it.cost && <div style={{ fontSize: 12.5, color: colors.red, marginTop: 6, display: "flex", gap: 4, alignItems: "center" }}><AlertTriangle size={13} /> Below cost ({money(it.cost)})</div>}
                  </>)}
                </div>
              ))}
            </div>
            {extra.map((e, k) => (
              <div key={e.productId} style={{ background: colors.primarySoft, borderRadius: 14, padding: 12, marginTop: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{e.name} <Badge kind="ok">New item</Badge></div>
                  <button type="button" className="icon-btn icon-btn-danger" aria-label={`Remove ${e.name}`} onClick={() => setExtra(extra.filter((_, j) => j !== k))}><Trash2 size={16} /></button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                  <input style={{ ...styles.input, width: 74, flex: "0 0 74px" }} type="number" inputMode="decimal" step="any" min="0" aria-label={`Quantity for ${e.name}`} value={e.qty} onChange={(ev) => setExtra(extra.map((x, j) => (j === k ? { ...x, qty: ev.target.value } : x)))} />
                  <span style={{ color: colors.inkSoft, fontSize: 13.5 }}>×</span>
                  <input style={styles.input} type="number" inputMode="decimal" step="0.01" aria-label={`Price for ${e.name}`} value={e.price} onChange={(ev) => setExtra(extra.map((x, j) => (j === k ? { ...x, price: ev.target.value } : x)))} />
                  <span className="num" style={{ fontWeight: 700, minWidth: 84, textAlign: "right" }}>{money(Math.max(0, (Number(e.price) || 0) * (Number(e.qty) || 0) - (Number(e.disc) || 0)))}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                  <span style={{ color: colors.inkSoft, fontSize: 13.5, whiteSpace: "nowrap" }}>Discount ₦</span>
                  <input style={styles.input} type="number" inputMode="decimal" step="0.01" placeholder="0" aria-label={`Discount for ${e.name}`} value={e.disc} onChange={(ev) => setExtra(extra.map((x, j) => (j === k ? { ...x, disc: ev.target.value } : x)))} />
                </div>
              </div>
            ))}
            {canReshape && (addOpen ? (
              <div style={{ marginTop: 10 }}>
                <input autoFocus style={styles.input} placeholder="Search the item to add" aria-label="Search item to add" value={addQ} onChange={(ev) => setAddQ(ev.target.value)} />
                {addable.length > 0 && <div style={{ marginTop: 6 }}><List>{addable.map((p) => <Row key={p.id} onClick={() => addExtra(p)} lead={<Plus size={20} />} title={p.name} sub={`${getStock(p, sale.branchId)} in stock`} value={money(p.price)} />)}</List></div>}
                {addQ.trim() && addable.length === 0 && <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 6 }}>No other item matches.</div>}
              </div>
            ) : <div style={{ marginTop: 10 }}><Button variant="secondary" icon={Plus} onClick={() => setAddOpen(true)}>Add an item</Button></div>)}
            <div style={{ ...styles.poTotal, marginTop: 14 }}><span>New total</span><span className="num">{money(draftTotal)}</span></div>
            {draftDelta !== 0 && (
              <div style={{ fontSize: 13.5, marginTop: 8, lineHeight: 1.5, color: draftDelta > 0 ? colors.red : colors.green, fontWeight: 600 }}>
                {isCredit
                  ? <>Was {money(sale.total)}. The customer's debt on this receipt {draftDelta > 0 ? "goes up" : "comes down"} by {money(Math.abs(draftDelta))}.</>
                  : draftDelta > 0
                    ? <>Was {money(sale.total)}. The customer must pay {money(draftDelta)} more.</>
                    : <>Was {money(sale.total)}. Give the customer back {money(Math.abs(draftDelta))}.</>}
              </div>
            )}
            {!canReshape && isAdminLike(ctx) && <div style={{ fontSize: 12.5, color: colors.inkSoft, marginTop: 8 }}>Items cannot be added or deleted after a return.</div>}
            <div className="sheet-actions">
              <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
              <Button icon={Check} onClick={saveEdit}>Save changes</Button>
            </div>
          </>
        ) : (<>
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: isCredit ? colors.redSoft : colors.greenSoft, color: isCredit ? colors.red : colors.green, borderRadius: 14, padding: "12px 14px", marginBottom: 14 }}>
          <CircleCheck size={26} />
          <div>
            <div className="num" style={{ fontWeight: 700, fontSize: 20, letterSpacing: "-0.02em" }}>{money(sale.total)}{sale.edited && <span style={{ marginLeft: 8, verticalAlign: 3 }}><Badge kind="warn">Edited</Badge></span>}{saleRefunded(sale) > 0 && <span style={{ marginLeft: 8, verticalAlign: 3 }}><Badge kind="danger">Returned −{money(saleRefunded(sale))}</Badge></span>}</div>
            <div style={{ fontSize: 13 }}>{isCredit ? `${money(sale.balanceDue)} still owed` : sale.amountTendered > sale.total ? `Change due ${money(sale.amountTendered - sale.total)}` : "Paid in cash"}</div>
          </div>
        </div>
        <div id="printable-receipt" className="force-light" style={{ ...styles.receiptPrintArea, ...(isCredit ? styles.creditPrintArea : {}) }}>
          <div style={styles.invoiceShopName}>{settings.shopName}</div>
          {settings.tagline && <div style={styles.invoiceTagline}>({settings.tagline})</div>}
          {branch && branch.name && <div style={styles.invoiceBranchLine}>Branch: {branch.name}</div>}
          {branch && branch.address && <div style={styles.invoiceMetaLine}>{branch.address}</div>}
          {branch && branch.phone && <div style={styles.invoiceMetaLine}>{branch.phone}</div>}
          <div style={styles.receiptDivider} />
          <div style={{ ...styles.invoiceLabel, ...(isCredit ? { color: colors.red } : {}) }}>{isCredit ? "CREDIT INVOICE: GOODS ON CREDIT" : "CASH INVOICE"}</div>
          <div style={styles.receiptMeta}>
            <div>Invoice No.: <span style={styles.mono}>{sale.invoiceNo}</span></div>
            <div className="no-print"><SyncBadge id={"sale:" + sale.id} /></div>
            <div>Date: {sale.date} &nbsp; Time: {new Date(sale.time).toLocaleTimeString()}</div>
            <div>Name: {sale.customerName || "Walk-in Customer"}</div>
            {isCredit && sale.customerPhone && <div>Phone: {sale.customerPhone}</div>}
            {isCredit && sale.dueDate && <div>Payment due by: <b>{sale.dueDate}</b></div>}
          </div>
          <div style={styles.receiptDivider} />
          <div style={styles.invoiceTableHead}>
            <span style={{ flex: "0 0 24px" }}>S/N</span>
            <span style={{ flex: "0 0 30px" }}>Qty</span>
            <span style={{ flex: 1, minWidth: 0 }}>Description</span>
            <span style={{ flex: "0 0 66px", textAlign: "right" }}>Price</span>
            <span style={{ flex: "0 0 78px", textAlign: "right" }}>Amount</span>
          </div>
          <div style={styles.receiptLines}>
            {sale.items.map((i, idx) => (
              <div key={idx} style={styles.invoiceTableRow}>
                <span style={{ ...styles.mono, flex: "0 0 24px" }}>{idx + 1}</span>
                <span style={{ ...styles.mono, flex: "0 0 30px" }}>{i.qty}</span>
                <span style={{ flex: 1, minWidth: 0, paddingRight: 6 }}>{i.name}</span>
                <span style={{ ...styles.mono, flex: "0 0 66px", textAlign: "right", fontSize: 11 }}>{money(i.price)}</span>
                <span style={{ ...styles.mono, flex: "0 0 78px", textAlign: "right", fontWeight: 600 }}>{money(lineGross(i))}</span>
                {lineDiscount(i) > 0 && <span style={{ flex: "0 0 100%", textAlign: "right", fontSize: 12, color: colors.green }}>Discount −{money(lineDiscount(i))}</span>}
              </div>
            ))}
          </div>
          <div style={styles.receiptDivider} />
          <div style={{ ...styles.receiptSubRow, marginTop: 0, fontWeight: 600, fontSize: 11.5 }}><span>Items: {sale.items.length}</span><span>Total qty: {saleQty(sale.items)}</span></div>
          {saleDiscount(sale.items) > 0 && <><div style={{ ...styles.receiptSubRow, fontSize: 11.5 }}><span>Subtotal</span><span style={styles.mono}>{money(saleSubtotal(sale.items))}</span></div><div style={{ ...styles.receiptSubRow, color: colors.green }}><span>Discount</span><span style={styles.mono}>−{money(saleDiscount(sale.items))}</span></div></>}
          <div style={{ ...styles.receiptTotalRow, fontSize: 15 }}><span>Amount Due</span><span style={styles.mono}>{money(sale.total)}</span></div>
          {saleRefunded(sale) > 0 && <><div style={{ ...styles.receiptSubRow, fontSize: 11.5, color: colors.red }}><span>Returned by customer</span><span style={styles.mono}>−{money(saleRefunded(sale))}</span></div><div style={{ ...styles.receiptSubRow, fontSize: 12, fontWeight: 700 }}><span>Net after returns</span><span style={styles.mono}>{money(saleNet(sale))}</span></div>{saleReturns(sale).map((r) => <div key={r.id} style={{ fontSize: 10.5, color: colors.inkSoft, marginTop: 2 }}>{r.date}: {r.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}{r.reason ? ` (${r.reason})` : ""}</div>)}</>}
          <div style={{ ...styles.receiptSubRow, fontSize: 11.5 }}><span>{isCredit ? "Deposit Paid" : "Payment: Cash"}</span><span style={styles.mono}>{money(sale.amountTendered)}</span></div>
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
        <div className="sheet-actions" style={{ flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="tonal" icon={ImageIcon} loading={imgBusy} onClick={shareImage} style={{ flex: "1 1 140px" }}>Share as image</Button>
            {onEdit && saleRefunded(sale) === 0 && <Button variant="secondary" icon={Pencil} onClick={startEdit} style={{ flex: "1 1 120px" }}>Edit sale</Button>}
            {ctx.canReturn && ctx.canReturn(sale) && <Button variant="secondary" icon={RefreshCw} onClick={startReturn} style={{ flex: "1 1 120px" }}>Return items</Button>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" icon={Share2} onClick={() => downloadReceipt(sale, settings, branch)} style={{ flex: 1 }}>Text</Button>
            {native ? (
              <>
                <Button variant="secondary" icon={FileText} onClick={() => window.print()} style={{ flex: 1 }}>PDF</Button>
                <Button icon={PrinterIcon} onClick={printBt} style={{ flex: 1.3 }}>{printer.address ? "Print" : "Set up printer"}</Button>
              </>
            ) : (
              <Button icon={PrinterIcon} onClick={() => window.print()} style={{ flex: 2 }}>Print receipt</Button>
            )}
          </div>
        </div>
        </>)}
      </Modal>
      {setup && <PrinterSetupModal settings={settings} showToast={showToast} onClose={() => setSetup(false)} />}
    </>
  );
}

function PaymentReceiptModal({ payment, customer, settings, branch, onClose, showToast }) {
  const printer = usePrinter();
  const [setup, setSetup] = useState(false);
  const native = printerAvailable();
  const printBt = () => (printer.address ? thermalPrint((cfg) => buildPayment(cfg, payment, customer, settings, branch, money), showToast) : setSetup(true));
  return (
    <>
      <Modal onClose={onClose} title="Payment recorded">
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: colors.greenSoft, color: colors.green, borderRadius: 14, padding: "12px 14px", marginBottom: 14 }}>
          <CircleCheck size={26} />
          <div>
            <div className="num" style={{ fontWeight: 700, fontSize: 20, letterSpacing: "-0.02em" }}>{money(payment.amount)}</div>
            <div style={{ fontSize: 13 }}>{payment.remainingAfter > 0 ? `${money(payment.remainingAfter)} still owed` : "Fully paid"}</div>
          </div>
        </div>
        <div id="printable-receipt" className="force-light" style={styles.receiptPrintArea}>
          <div style={styles.invoiceShopName}>{settings.shopName}</div>
          {branch && branch.name && <div style={styles.invoiceBranchLine}>Branch: {branch.name}</div>}
          <div style={styles.receiptDivider} />
          <div style={styles.invoiceLabel}>CREDIT PAYMENT RECEIPT</div>
          <div style={styles.receiptMeta}>
            <div>Receipt No.: <span style={styles.mono}>{payment.receiptNo}</span></div>
            <div>Date: {payment.date}</div>
            <div>Customer: {customer ? customer.name : "-"}{customer && customer.phone ? ` (${customer.phone})` : ""}</div>
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
        <div className="sheet-actions">
          {native ? (
            <>
              <Button variant="secondary" icon={FileText} onClick={() => window.print()}>PDF</Button>
              <Button icon={PrinterIcon} onClick={printBt}>{printer.address ? "Print" : "Set up printer"}</Button>
            </>
          ) : (
            <Button icon={PrinterIcon} onClick={() => window.print()}>Print receipt</Button>
          )}
        </div>
      </Modal>
      {setup && <PrinterSetupModal settings={settings} showToast={showToast} onClose={() => setSetup(false)} />}
    </>
  );
}

// ---------- checkout ----------
function Checkout({ products, setProducts, sales, setSales, customers, setCustomers, showToast, currentUser, settings, activeBranchId, branches }) {
  const ctx = React.useContext(AppCtx);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState([]);
  const [lastAdded, setLastAdded] = useState(null);
  const [receiptSale, setReceiptSale] = useState(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [amountTendered, setAmountTendered] = useState("");
  const [paymentType, setPaymentType] = useState("cash");
  const [dueDate, setDueDate] = useState("");
  const [saleDisc, setSaleDisc] = useState({ mode: "pct", text: "" });
  // Held sales: park the current cart to serve someone else, then bring it back. Kept on this phone only; stock is not reserved.
  const HELD_KEY = "tally:held";
  const readHeld = () => { try { const a = JSON.parse(localStorage.getItem(HELD_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const [held, setHeldState] = useState(readHeld);
  const [heldOpen, setHeldOpen] = useState(false);
  const setHeld = (next) => { setHeldState(next); try { localStorage.setItem(HELD_KEY, JSON.stringify(next)); } catch (e) {} };
  const autoDisc = useRef(null);          // customer id whose standing discount was filled in automatically
  const [cartOpen, setCartOpen] = useState(false);
  const scanRef = useRef(null);
  const [camScanning, setCamScanning] = useState(false);
  const cartRef = useRef(cart);
  cartRef.current = cart;

  const [quickMore, setQuickMore] = useState(false);
  const [browse, setBrowse] = useState("quick");
  const [qtyDraft, setQtyDraft] = useState({});
  const isOwner = currentUser.role === "admin";
  const allSorted = useMemo(() => [...products].sort((a, b) => a.name.localeCompare(b.name)), [products]);
  const quick = useMemo(() => pickQuickProducts(products, sales, todayStr(), quickMore ? 60 : 12), [products, sales, quickMore]);

  useEffect(() => {
    // Only auto-focus the scan box when a physical keyboard/scanner is likely (not on touch phones, where it pops the keyboard).
    if (window.matchMedia && window.matchMedia("(pointer: fine)").matches) scanRef.current?.focus();
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

  const typeQty = (id, text) => {
    setQtyDraft((d) => ({ ...d, [id]: text }));
    const n = Math.floor(Number(text));
    if (text === "" || !(n > 0)) return;
    const product = products.find((p) => p.id === id);
    const stock = product ? getStock(product, activeBranchId) : n;
    if (n > stock) { showToast(`Only ${stock} in stock.`, "err"); setQtyDraft((d) => ({ ...d, [id]: String(stock) })); setCart((c) => c.map((i) => (i.id === id ? { ...i, qty: stock } : i))); return; }
    setCart((c) => c.map((i) => (i.id === id ? { ...i, qty: n } : i)));
  };
  const endQty = (id) => setQtyDraft((d) => { const x = { ...d }; delete x[id]; return x; });
  const setLinePrice = (id, text) => setCart((c) => c.map((i) => (i.id === id ? { ...i, price: text === "" ? 0 : Number(text) || 0, priceText: text } : i)));
  const removeLine = (id) => {
    const idx = cart.findIndex((i) => i.id === id); if (idx < 0) return; const gone = cart[idx];
    setCart(cart.filter((i) => i.id !== id));
    showToast(`${gone.name} removed.`, "ok", 5000, { label: "Undo", run: () => setCart((c) => (c.some((i) => i.id === gone.id) ? c : [...c.slice(0, idx), gone, ...c.slice(idx)])) });
  };

  const priced = useMemo(() => priceCart(cart, saleDisc), [cart, saleDisc]);
  const total = priced.total;
  const totalCost = cart.reduce((a, i) => a + i.cost * i.qty, 0);
  const profit = round2(total - totalCost);
  const setLineDisc = (id, patch) => setCart((c) => c.map((i) => (i.id === id ? { ...i, discEntry: { mode: "amt", text: "", ...(i.discEntry || {}), ...patch } } : i)));
  const matchedCustomer = useMemo(() => { const n = customerName.trim().toLowerCase(); return n ? customers.find((c) => c.name.trim().toLowerCase() === n && (!customerPhone.trim() || !c.phone || c.phone === customerPhone.trim())) || null : null; }, [customers, customerName, customerPhone]);
  // A customer with a standing discount gets it filled in automatically; the cashier can still change or clear it.
  useEffect(() => {
    const id = matchedCustomer ? matchedCustomer.id : null;
    if (autoDisc.current === id) return;
    if (autoDisc.current && !id) setSaleDisc({ mode: "pct", text: "" });
    autoDisc.current = id;
    if (matchedCustomer && Number(matchedCustomer.discountPct) > 0) setSaleDisc({ mode: "pct", text: String(matchedCustomer.discountPct) });
  }, [matchedCustomer]);
  const heldHere = held.filter((h) => h.branchId === activeBranchId);
  const holdSale = () => {
    if (cart.length === 0) return;
    const n = heldHere.length + 1;
    const entry = { id: uid(), branchId: activeBranchId, by: currentUser.name, at: new Date().toISOString(), label: customerName.trim() || `Customer ${n}`,
      cart, customerName, customerPhone, amountTendered, paymentType, dueDate, saleDisc };
    setHeld([...held, entry]);
    setCart([]); setCustomerName(""); setCustomerPhone(""); setAmountTendered(""); setDueDate(""); setPaymentType("cash");
    setSaleDisc({ mode: "pct", text: "" }); autoDisc.current = null; setCartOpen(false);
    showToast(`"${entry.label}" is on hold. Serve the next customer.`);
  };
  const resumeHeld = (h) => {
    if (cart.length > 0) { showToast("Hold or finish the sale on screen first.", "err"); return; }
    let trimmed = 0;
    const back = h.cart.map((i) => { const pr = products.find((x) => x.id === i.id); if (!pr) { trimmed++; return null; } const st = getStock(pr, activeBranchId); const q = Math.min(i.qty, st); if (q < i.qty) trimmed++; return q > 0 ? { ...i, qty: q, stock: st, cost: pr.cost } : null; }).filter(Boolean);
    setCart(back); setCustomerName(h.customerName || ""); setCustomerPhone(h.customerPhone || ""); setAmountTendered(h.amountTendered || ""); setPaymentType(h.paymentType || "cash"); setDueDate(h.dueDate || "");
    autoDisc.current = null; setSaleDisc(h.saleDisc || { mode: "pct", text: "" });
    setHeld(held.filter((x) => x.id !== h.id)); setHeldOpen(false); setCartOpen(true);
    showToast(trimmed ? "Resumed. Some items were reduced or removed because stock changed." : `Resumed "${h.label}".`, trimmed ? "err" : undefined);
  };
  const makeRegular = () => {
    const pct = Math.min(100, Math.max(0, Number(saleDisc.text) || 0));
    if (saleDisc.mode !== "pct" || !customerName.trim()) { showToast("Enter the customer's name and a percent discount first.", "err"); return; }
    if (matchedCustomer) setCustomers((prev) => prev.map((c) => (c.id === matchedCustomer.id ? { ...c, discountPct: pct } : c)));
    else setCustomers((prev) => [...prev, { id: makeId("c-", uid), name: customerName.trim(), phone: customerPhone.trim(), discountPct: pct }]);
    showToast(pct ? `${customerName.trim()} now gets ${pct}% off every sale.` : `${customerName.trim()} no longer has a standing discount.`);
  };

  const findOrCreateCustomer = (name, phone) => {
    const nName = name.trim().toLowerCase();
    const nPhone = phone.trim();
    let existing = customers.find((c) => c.name.trim().toLowerCase() === nName && (nPhone ? c.phone === nPhone : true));
    if (existing) return existing.id;
    const newCustomer = { id: makeId("c-", uid), name: name.trim(), phone: nPhone, discountPct: 0 };
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
    const customerId = paymentType === "credit" ? findOrCreateCustomer(customerName, customerPhone) : (matchedCustomer ? matchedCustomer.id : null);

    const sale = {
      id: makeId("s-", uid),
      invoiceNo: numberLabel("invoice", nextSeq("invoice")),
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
      items: priced.lines.map((i) => ({ productId: i.id, name: i.name, qty: i.qty, price: i.price, discount: i.discount, cost: i.cost })),
      total,
      cost: totalCost,
    };

    setProducts((prev) => prev.map((p) => {
      const line = cart.find((i) => i.id === p.id);
      if (!line) return p;
      return { ...p, stock: { ...p.stock, [activeBranchId]: getStock(p, activeBranchId) - line.qty } };
    }), "server-stock");      // the server takes this stock off itself when it records the sale
    setSales((prev) => [...prev, sale]);
    setCart([]);
    setCustomerName("");
    setCustomerPhone("");
    setAmountTendered("");
    setDueDate("");
    setSaleDisc({ mode: "pct", text: "" }); autoDisc.current = null;
    setPaymentType("cash");
    setReceiptSale(sale);
    setCartOpen(false);
    showToast(paymentType === "credit" ? `Credit sale recorded: ${money(balanceDue)} owed` : `Sale recorded: ${money(total)}`);
    const pc = getPrinter();
    if (printerAvailable() && pc.address && pc.auto) {
      thermalPrint((cfg) => buildSale(cfg, sale, settings, resolveBranch(branches, activeBranchId, settings), money), showToast, { quiet: true });
    }
  };

  const branch = resolveBranch(branches, activeBranchId, settings);
  const itemCount = cart.reduce((a, i) => a + i.qty, 0);
  const anyBelow = priced.lines.some((i) => effectiveUnit(i) < i.cost);
  const isCredit = paymentType === "credit";
  const roundUps = [...new Set([Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000])].filter((v) => v > total).slice(0, 3);

  return (
    <div className="co">
      {receiptSale && <ReceiptModal sale={receiptSale} settings={settings} branch={branch} showToast={showToast} onClose={() => setReceiptSale(null)}
        onEdit={canEditSale(currentUser, receiptSale, todayStr()) ? (u) => { setSales((prev) => prev.map((x) => (x.id === u.id ? u : x))); setReceiptSale(u); } : undefined} />}
      {heldOpen && (
        <Modal onClose={() => setHeldOpen(false)} title="Sales on hold">
          {heldHere.length === 0 ? <EmptyState icon={Clock} title="Nothing on hold" text="Tap Hold in the cart to park a sale while you serve someone else." /> : (
            <div style={styles.stack8}>
              {heldHere.map((h) => (
                <div key={h.id} className="card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{h.label}</div>
                      <div style={{ fontSize: 12.5, color: colors.inkSoft }}>{h.cart.reduce((a, i) => a + i.qty, 0)} item(s) · {new Date(h.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {h.by}</div>
                      <div style={{ fontSize: 12.5, color: colors.inkSoft, marginTop: 2 }}>{h.cart.map((i) => `${i.qty}× ${i.name}`).join(", ").slice(0, 90)}</div>
                    </div>
                    <div className="num" style={{ fontWeight: 700 }}>{money(priceCart(h.cart, h.saleDisc).total)}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Button small style={{ flex: 1 }} onClick={() => resumeHeld(h)}>Resume</Button>
                    <Button small variant="secondary" icon={Trash2} onClick={async () => { if (await ctx.confirm({ title: "Discard this held sale?", text: `${h.label}'s items will be cleared.`, okLabel: "Discard", danger: true })) { setHeld(held.filter((x) => x.id !== h.id)); showToast("Held sale discarded.", "ok", 7000, { label: "Undo", run: () => setHeld([...readHeld().filter((x) => x.id !== h.id), h]) }); } }}>Discard</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
      <div className="co-main">
        {heldHere.length > 0 && <button type="button" className="chip on" style={{ alignSelf: "flex-start", marginBottom: 8 }} onClick={() => setHeldOpen(true)}><Clock size={14} /> On hold ({heldHere.length})</button>}
        <div style={styles.scanBox}>
          <Search size={18} />
          <input
            ref={scanRef}
            placeholder="Scan, or search name / SKU"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleScanKey}
            style={styles.searchInput}
          />
          {lastAdded && <span style={styles.scanFlash}><Check size={14} /> Added</span>}
          {query ? <IconButton icon={X} label="Clear" size={16} onClick={() => setQuery("")} /> : null}
          <button type="button" style={styles.scanCamBtn} onClick={() => setCamScanning(true)}><ScanBarcode size={18} /> Scan</button>
        </div>
        {camScanning && (
          <ScannerModal title="Scan items" continuous onClose={() => { setCamScanning(false); }} onDetect={scanAdd}
            summary={`${itemCount} items · ${money(total)}`} />
        )}
        {query.trim() && results.length === 0 && (
          <div className="card"><EmptyState icon={Search} title="No match" text={`Nothing found for "${query}". Check the spelling or scan the barcode.`} /></div>
        )}
        {results.length > 0 && (
          <List>
            {results.map((p) => {
              const st = getStock(p, activeBranchId);
              return (
                <Row key={p.id} onClick={() => addToCart(p)} lead={<Plus size={20} />}
                  title={p.name} sub={`${p.sku} · ${st} in stock`} value={money(p.price)} />
              );
            })}
          </List>
        )}
        {results.length === 0 && !query.trim() && (
          <div>
            <SectionHeader title={browse === "quick" ? "Quick sale" : "All items"} action={products.length > 0 ? <div style={{ width: 190 }}><Segmented value={browse} onChange={setBrowse} options={[["quick", "Quick"], ["all", `All (${products.length})`]]} /></div> : null} />
            {products.length > 0 && browse === "all" ? (
              <List wide>
                {allSorted.map((p) => {
                  const st = getStock(p, activeBranchId);
                  const inCart = (cart.find((i) => i.id === p.id) || {}).qty || 0;
                  return (
                    <Row key={p.id} onClick={() => addToCart(p)} lead={inCart ? <b>{inCart}</b> : <Plus size={20} />}
                      leadTone={inCart ? { background: colors.primary, color: "var(--on-primary)" } : null}
                      title={p.name} sub={st <= 0 ? "Out of stock" : `${st} in stock${p.sku ? " · " + p.sku : ""}`} value={money(p.price)} />
                  );
                })}
              </List>
            ) : products.length === 0 ? (
              <div className="card"><EmptyState icon={PackageOpen} title="No products yet" text="Add products in Inventory, or import a spreadsheet." /></div>
            ) : (
              <>
                <div style={styles.quickGrid}>
                  {quick.tiles.map((p) => {
                    const stock = getStock(p, activeBranchId);
                    const inCart = (cart.find((i) => i.id === p.id) || {}).qty || 0;
                    const out = stock <= 0;
                    return (
                      <button key={p.id} disabled={out} onClick={() => addToCart(p)}
                        style={{ ...styles.quickTile, position: "relative", opacity: out ? 0.5 : 1, ...(inCart ? { boxShadow: `0 0 0 2px ${colors.primary}`, background: colors.primarySoft } : {}) }}>
                        {inCart > 0 && <span style={styles.tileBadge}>×{inCart}</span>}
                        <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.25, paddingRight: inCart ? 34 : 0, flex: 1 }}>{p.name}</div>
                        <div className="num" style={{ fontSize: 14.5, fontWeight: 700, marginTop: 8 }}>{money(p.price)}</div>
                        <div style={{ fontSize: 11.5, marginTop: 2, fontWeight: 500, color: out ? colors.red : stock <= p.lowStock ? colors.amber : colors.inkSoft }}>{out ? "Out of stock" : `${stock} left`}</div>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12.5, color: colors.inkSoft, flex: 1, minWidth: 160 }}>
                    {quick.pinnedCount === 0 ? "Showing your best sellers. The owner can pin items with the star in Inventory." : `${quick.pinnedCount} pinned item${quick.pinnedCount === 1 ? "" : "s"} shown first.`}
                  </div>
                  {(quickMore || quick.total > quick.tiles.length) && (
                    <Button variant="secondary" small onClick={() => setQuickMore(!quickMore)}>{quickMore ? "Show fewer" : "Show more"}</Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {cartOpen && <div className="co-backdrop" onClick={() => setCartOpen(false)} />}
      {cartOpen && <BackClose onClose={() => setCartOpen(false)} />}
      <div className={"co-cart" + (cartOpen ? " open" : "")}>
        <div className="sheet-grab co-grab" style={{ display: "block" }} />
        <div className="co-cart-head" style={{ padding: "12px 0 4px" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>Current sale</div>
            <div style={{ fontSize: 12.5, color: colors.inkSoft }}>{currentUser.name} · {itemCount} item{itemCount === 1 ? "" : "s"}</div>
          </div>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {heldHere.length > 0 && <Button small variant="secondary" icon={Clock} onClick={() => setHeldOpen(true)}>{heldHere.length}</Button>}
            {cart.length > 0 && <Button small variant="secondary" icon={Pause} onClick={holdSale}>Hold</Button>}
            <span className="co-cart-close"><IconButton icon={X} label="Close cart" onClick={() => setCartOpen(false)} /></span>
          </span>
        </div>
        {cart.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="Cart is empty" text="Scan an item or tap a quick-sale tile to start." />
        ) : (
          <div className="cart-lines">
            {cart.map((i) => (
              <div key={i.id} className="cart-line">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cart-line-name">{i.name}</div>
                  {isOwner ? (
                    <div className="cart-line-sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span>{CURRENCY}</span>
                      <input className="num" type="number" inputMode="decimal" step="0.01" aria-label={`Price of ${i.name}`} value={i.priceText !== undefined ? i.priceText : i.price}
                        onChange={(e) => setLinePrice(i.id, e.target.value)} onFocus={(e) => e.target.select()}
                        style={{ width: 96, height: 32, border: `1px solid ${colors.lineStrong}`, borderRadius: 8, padding: "0 8px", fontSize: 13.5, fontWeight: 600 }} />
                      <span>each</span>
                    </div>
                  ) : <div className="cart-line-sub num">{money(i.price)} each</div>}
                  {(() => { const pl = priced.lines.find((x) => x.id === i.id) || i; const de = i.discEntry || { mode: "amt", text: "" }; return (<>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                      <span style={{ fontSize: 12.5, color: colors.inkSoft }}>Discount</span>
                      <input className="num" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0" aria-label={`Discount on ${i.name}`} value={de.text} onChange={(e) => setLineDisc(i.id, { text: e.target.value })} onFocus={(e) => e.target.select()} style={{ width: 70, height: 30, border: `1px solid ${colors.lineStrong}`, borderRadius: 8, padding: "0 8px", fontSize: 13 }} />
                      <button type="button" aria-label={`Discount type for ${i.name}`} onClick={() => setLineDisc(i.id, { mode: de.mode === "pct" ? "amt" : "pct" })} style={{ height: 30, minWidth: 34, borderRadius: 8, border: `1px solid ${colors.lineStrong}`, background: colors.surface2, fontWeight: 700, fontSize: 13 }}>{de.mode === "pct" ? "%" : CURRENCY}</button>
                      {pl.discount > 0 && <span className="num" style={{ fontSize: 12.5, color: colors.green }}>−{money(pl.discount)}</span>}
                    </div></>); })()}
                  {effectiveUnit(priced.lines.find((x) => x.id === i.id) || i) < i.cost && <div style={{ fontSize: 12, color: colors.red, fontWeight: 600, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}><AlertTriangle size={13} /> Priced below cost</div>}
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <div className="stepper">
                      <button type="button" aria-label={`Decrease ${i.name}`} onClick={() => updateQty(i.id, i.qty - 1)}><Minus size={16} /></button>
                      <input className="num" type="number" inputMode="numeric" min="1" aria-label={`Quantity of ${i.name}`} value={qtyDraft[i.id] !== undefined ? qtyDraft[i.id] : i.qty}
                        onChange={(e) => typeQty(i.id, e.target.value)} onBlur={() => endQty(i.id)} onFocus={(e) => e.target.select()} />
                      <button type="button" aria-label={`Increase ${i.name}`} onClick={() => updateQty(i.id, i.qty + 1)}><Plus size={16} /></button>
                    </div>
                    <IconButton icon={Trash2} danger label={`Remove ${i.name}`} size={16} onClick={() => removeLine(i.id)} />
                  </div>
                </div>
                <div className="num" style={{ fontWeight: 700, fontSize: 15 }}>{money(lineTotal(priced.lines.find((x) => x.id === i.id) || i))}</div>
              </div>
            ))}
          </div>
        )}

        {cart.length > 0 && (
          <>
            <div className="cart-total">
              {priced.discount > 0 && <div style={styles.receiptSubRow}><span>Subtotal</span><span className="num">{money(priced.subtotal)}</span></div>}
              {priced.discount > 0 && <div style={{ ...styles.receiptSubRow, color: colors.green }}><span>Discounts</span><span className="num">−{money(priced.discount)}</span></div>}
              <div style={styles.receiptTotalRow}><span>Total</span><span className="num">{money(total)}</span></div>
              <div style={styles.receiptSubRow}><span>Profit on this sale</span><span className="num" style={{ color: profit < 0 ? colors.red : undefined, fontWeight: profit < 0 ? 700 : undefined }}>{money(profit)}</span></div>
            </div>
            {anyBelow && <div style={{ ...styles.warnNote, marginTop: 10, display: "flex", gap: 8 }}><AlertTriangle size={18} style={{ flexShrink: 0 }} />Some items are priced below cost, so this sale loses money. Check the price in Inventory.</div>}

            <div style={{ marginTop: 14 }}>
              <Segmented value={paymentType} onChange={setPaymentType} options={[["cash", "Cash"], ["credit", "On credit"]]} />
            </div>

            <div style={{ ...styles.checkoutFields, marginTop: 12 }}>
              <input style={styles.input} list="co-customers" autoComplete="off" placeholder={isCredit ? "Customer name (required)" : "Customer name (optional)"} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              <datalist id="co-customers">{customers.slice(0, 200).map((c) => <option key={c.id} value={c.name}>{Number(c.discountPct) > 0 ? `${c.discountPct}% regular discount` : c.phone || ""}</option>)}</datalist>
              {matchedCustomer && Number(matchedCustomer.discountPct) > 0 && <div style={{ fontSize: 13, color: colors.green, fontWeight: 600 }}>Regular customer: {matchedCustomer.discountPct}% discount applied (you can change it below).</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap" }}>Whole-sale discount</span>
                <input className="num" type="number" inputMode="decimal" min="0" step="0.01" placeholder="0" aria-label="Discount on the whole sale" value={saleDisc.text} onChange={(e) => setSaleDisc({ ...saleDisc, text: e.target.value })} style={{ ...styles.input, width: 90 }} />
                <button type="button" aria-label="Whole-sale discount type" onClick={() => setSaleDisc({ ...saleDisc, mode: saleDisc.mode === "pct" ? "amt" : "pct" })} style={{ height: 42, minWidth: 42, borderRadius: 10, border: `1px solid ${colors.lineStrong}`, background: colors.surface2, fontWeight: 700 }}>{saleDisc.mode === "pct" ? "%" : CURRENCY}</button>
              </div>
              {isOwner && customerName.trim() && saleDisc.mode === "pct" && Number(saleDisc.text) !== Number(matchedCustomer?.discountPct || 0) && <Button variant="secondary" small onClick={makeRegular}>Make {Number(saleDisc.text) || 0}% this customer's regular discount</Button>}
              {isCredit && (
                <>
                  <input style={styles.input} inputMode="tel" placeholder="Customer phone (optional)" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                  <input style={styles.input} type="number" inputMode="decimal" step="0.01" placeholder="Deposit paid now (optional)" value={amountTendered} onChange={(e) => setAmountTendered(e.target.value)} />
                  <Field label="Payment due by (optional)">
                    <input style={styles.input} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </Field>
                </>
              )}
              {!isCredit && (
                <>
                  <input style={styles.input} type="number" inputMode="decimal" step="0.01" placeholder={`Cash received (default ${money(total)})`} value={amountTendered} onChange={(e) => setAmountTendered(e.target.value)} />
                  <div className="chips" style={{ margin: 0, padding: 0 }}>
                    <button type="button" className={"chip" + (amountTendered === "" ? " on" : "")} onClick={() => setAmountTendered("")}>Exact</button>
                    {roundUps.map((v) => (
                      <button key={v} type="button" className={"chip" + (Number(amountTendered) === v ? " on" : "")} onClick={() => setAmountTendered(String(v))}>{money(v)}</button>
                    ))}
                  </div>
                </>
              )}
              {!isCredit && amountTendered !== "" && Number(amountTendered) > total && (
                <div style={styles.changeDue}>Change to give back: <b className="num">{money(Number(amountTendered) - total)}</b></div>
              )}
              {!isCredit && amountTendered !== "" && Number(amountTendered) < total && (
                <div style={{ fontSize: 13, color: colors.red }}>That is less than the total. For part payments, use "On credit" so the balance is tracked.</div>
              )}
            </div>
          </>
        )}
        <div className="co-cta">
          <Button full variant={isCredit ? "danger" : "primary"} icon={isCredit ? HandCoins : Check} disabled={cart.length === 0} onClick={completeSale} style={{ height: 54, fontSize: 16, fontWeight: 700, borderRadius: 14 }}>
            {isCredit ? "Record credit sale" : `Complete sale${cart.length ? " · " + money(total) : ""}`}
          </Button>
        </div>
      </div>

      {cart.length > 0 && !cartOpen && (
        <button type="button" className="cart-bar" onClick={() => setCartOpen(true)}>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="cart-bar-count">{itemCount}</span>
            <span style={{ textAlign: "left" }}>
              <span style={{ display: "block", fontSize: 12, opacity: 0.75 }}>View cart</span>
              <span className="num" style={{ fontWeight: 700, fontSize: 16 }}>{money(total)}</span>
            </span>
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 600, fontSize: 14 }}>Checkout <ChevronRight size={18} /></span>
        </button>
      )}
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
    }), "server-stock");      // the server adds this stock itself when it records the purchase

    const po = {
      id: makeId("po-", uid),
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
    const nowBelow = validLines.filter((l) => { const pr = products.find((pp) => pp.id === l.productId); return pr && Number(l.cost) > 0 && pr.price > 0 && Number(l.cost) > pr.price; }).length;
    if (nowBelow) showToast(`Received into stock. Warning: ${nowBelow} item${nowBelow === 1 ? " now costs" : "s now cost"} more than ${nowBelow === 1 ? "its" : "their"} selling price. Update the price in Inventory.`, "err", 5500);
    else showToast("Purchase order received into stock.");
    close();
  };

  const sorted = [...purchases].filter((po) => po.branchId === activeBranchId).sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div style={styles.stack}>
      <Button icon={Plus} full onClick={openAdd}>New purchase order</Button>
      {sorted.length === 0 ? (
        <div className="card"><EmptyState icon={Truck} title="No purchases yet" text="Record a supplier delivery to stock up your shelves." /></div>
      ) : (
        <div style={styles.stack8}>
          {sorted.map((po) => (
            <div key={po.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                  <span className="row-lead"><Truck size={20} /></span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{po.supplier}</div>
                    <div className="num" style={{ fontSize: 12.5, color: colors.inkSoft }}>{po.date}</div>
                  </div>
                </div>
                <div className="num" style={{ fontWeight: 700, fontSize: 16 }}>{money(po.total)}</div>
              </div>
              <div style={{ ...styles.poItems, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${colors.line}` }}>
                {po.items.map((it, i) => (
                  <div key={i} style={styles.poItemRow}><span>{it.name}</span><span className="num">{it.qty} × {money(it.cost)}</span></div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <Modal onClose={close} title="New purchase order">
          <div style={styles.formGrid2}>
            <Field label="Supplier">
              <input style={styles.input} value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="e.g. Green Valley Foods" />
            </Field>
            <Field label="Date">
              <input style={styles.input} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
          </div>
          <div style={{ ...styles.fieldLabel, margin: "18px 0 8px" }}>Items received</div>
          <div style={styles.stack8}>
            {form.lines.map((l, idx) => (
              <div key={idx} style={{ background: colors.surface2, borderRadius: 14, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <select style={{ ...styles.input, flex: 1 }} value={l.productId} onChange={(e) => updateLine(idx, { productId: e.target.value })} aria-label="Product">
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  {form.lines.length > 1 && <IconButton icon={Trash2} danger label="Remove line" style={{ width: 46, height: 46 }} onClick={() => removeLine(idx)} />}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={styles.input} type="number" inputMode="numeric" placeholder="Qty" aria-label="Quantity" value={l.qty} onChange={(e) => updateLine(idx, { qty: e.target.value })} />
                  <input style={styles.input} type="number" inputMode="decimal" step="0.01" placeholder="Cost per unit" aria-label="Cost per unit" value={l.cost} onChange={(e) => updateLine(idx, { cost: e.target.value })} />
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" icon={Plus} small onClick={addLine} style={{ flex: 1 }}>Add line</Button>
              <Button variant="secondary" icon={ScanBarcode} small onClick={() => setScanning(true)} style={{ flex: 1 }}>Scan items</Button>
            </div>
          </div>
          {scanning && <ScannerModal title="Scan delivery" continuous onDetect={scanLine} onClose={() => setScanning(false)} summary={`${(form.lines || []).filter((l) => l.qty !== "").length} products`} />}
          <div style={{ ...styles.poTotal, marginTop: 14 }}><span>Order total</span><span className="num">{money(total)}</span></div>
          <div className="sheet-actions">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button icon={Check} onClick={save}>Receive into stock</Button>
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

function Expenses({ expenses, setExpenses, showToast, activeBranchId, branches, multiBranch, pendingAction, clearPending }) {
  const [form, setForm] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  useEffect(() => {
    if (pendingAction === "add-expense") setForm(emptyExpense());
    if (pendingAction) clearPending && clearPending();
  }, [pendingAction]);
  const openAdd = () => setForm(emptyExpense());
  const close = () => setForm(null);
  const branchName = (branches.find((b) => b.id === activeBranchId) || {}).name || "";

  const save = () => {
    const amount = Number(form.amount);
    if (!amount || amount <= 0) { showToast("Enter a valid amount.", "err"); return; }
    const expense = { id: makeId("e-", uid), date: form.date, branchId: activeBranchId, category: form.category, amount, note: form.note || "" };
    setExpenses((prev) => [...prev, expense]);
    showToast("Expense logged.");
    close();
  };

  const remove = (id) => {
    const gone = expenses.find((e) => e.id === id);
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    showToast("Expense removed.", "ok", 7000, gone ? { label: "Undo", run: () => { setExpenses((prev) => (prev.some((e) => e.id === gone.id) ? prev : [...prev, gone])); showToast("Expense restored."); } } : undefined);
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
      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12.5, color: colors.inkSoft }}>Total expenses{multiBranch ? ` · ${branchName}` : ""}</div>
          <div className="num" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em" }}>{money(total)}</div>
        </div>
        <Button icon={Plus} onClick={openAdd}>Log expense</Button>
      </div>

      {byCategory.length > 0 && (
        <div>
          <SectionHeader title="By category" />
          <List>
            {byCategory.map(([cat, amt]) => (
              <Row key={cat} lead={<Tag size={19} />} title={cat} value={money(amt)}
                valueSub={`${Math.round((amt / (total || 1)) * 100)}%`} />
            ))}
          </List>
        </div>
      )}

      <div>
        <SectionHeader title="History" />
        {sorted.length === 0 ? (
          <div className="card"><EmptyState icon={ReceiptText} title="No expenses yet" text="Rent, utilities, wages and other non-stock costs go here." action={<Button icon={Plus} onClick={openAdd}>Log expense</Button>} /></div>
        ) : (
          <List>
            {sorted.map((e) => (
              <Row key={e.id} lead={<ReceiptText size={19} />} leadTone={{ background: colors.amberSoft, color: colors.amber }}
                title={e.category} sub={`${e.date}${e.note ? " · " + e.note : ""}`}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="row-value num">{money(e.amount)}</span>
                  <IconButton icon={Trash2} danger label={`Delete ${e.category} expense`} size={16} onClick={() => setToDelete(e)} />
                </div>
              </Row>
            ))}
          </List>
        )}
      </div>

      {form && (
        <Modal onClose={close} title="Log expense">
          <div style={styles.stack}>
            <div style={styles.formGrid2}>
              <Field label="Category">
                <select style={styles.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Date">
                <input style={styles.input} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </Field>
            </div>
            <Field label={`Amount (${CURRENCY})`}>
              <input style={styles.input} type="number" inputMode="decimal" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Note (optional)">
              <input style={styles.input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. July electricity" />
            </Field>
          </div>
          <div className="sheet-actions">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button icon={Check} onClick={save}>Save expense</Button>
          </div>
        </Modal>
      )}

      {toDelete && (
        <Modal title="Delete expense?" onClose={() => setToDelete(null)}>
          <p style={{ color: colors.inkSoft, lineHeight: 1.5, margin: "4px 0 0" }}>
            {toDelete.category} · <b style={{ color: colors.ink }}>{money(toDelete.amount)}</b> on {toDelete.date} will be removed. Profit figures will change.
          </p>
          <div className="sheet-actions">
            <Button variant="secondary" onClick={() => setToDelete(null)}>Cancel</Button>
            <Button variant="danger" icon={Trash2} onClick={() => { remove(toDelete.id); setToDelete(null); }}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- credit book ----------
let cloudBalances = null;       // set for branch staff in Cloud mode (see cloud/balances.js)
function creditBalance(customerId, sales, creditPayments) {
  if (cloudBalances) return balanceFrom(cloudBalances, customerId, sales, creditPayments);
  const owed = sales.filter((s) => s.paymentType === "credit" && s.customerId === customerId).reduce((a, s) => a + s.balanceDue, 0);
  const paid = creditPayments.filter((p) => p.customerId === customerId).reduce((a, p) => a + p.amount, 0);
  return Math.max(0, owed - paid);
}

function CreditBook({ customers, setCustomers, sales, creditPayments, setCreditPayments, showToast, currentUser, settings, branches, activeBranchId }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [payForm, setPayForm] = useState(null);
  const [paymentReceipt, setPaymentReceipt] = useState(null);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [discDraft, setDiscDraft] = useState(null);

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

  const remind = async (c, via) => {
    const phone = normalizePhone(c.phone);
    if (!phone) { showToast(`No valid phone number for ${c.name}. Add one first.`, "err"); setSelectedId(c.id); return; }
    const dues = sales.filter((x) => x.paymentType === "credit" && x.customerId === c.id && x.balanceDue > 0 && x.dueDate).map((x) => x.dueDate).sort();
    const pastDue = dues.length && dues[0] < todayStr() ? dues[0] : "";
    const text = reminderMessage({ name: c.name, amount: money(c.balance), shop: settings.shopName, pastDue });
    const ok = await openExternal(via === "sms" ? smsLink(phone, text) : waLink(phone, text));
    if (!ok) { showToast("Could not open " + (via === "sms" ? "the SMS app." : "WhatsApp."), "err"); return; }
    setCustomers((prev) => prev.map((x) => (x.id === c.id ? { ...x, remindedAt: todayStr() } : x)));
  };
  const savePhone = () => {
    if (!normalizePhone(phoneDraft)) { showToast("Enter a valid phone number, e.g. 0803 123 4567.", "err"); return; }
    setCustomers((prev) => prev.map((x) => (x.id === selected.id ? { ...x, phone: phoneDraft.trim() } : x)));
    setPhoneDraft("");
    showToast("Phone number saved.");
  };

  const openPay = (c) => setPayForm({ amount: "", note: "", date: todayStr() });
  const closePay = () => setPayForm(null);

  const savePayment = () => {
    const amount = Number(payForm.amount);
    if (!amount || amount <= 0) { showToast("Enter a valid amount.", "err"); return; }
    if (amount > selected.balance) { showToast(`That's more than the ${money(selected.balance)} owed. Enter an amount up to that.`, "err"); return; }
    const payment = {
      id: makeId("cp-", uid),
      receiptNo: numberLabel("payment", nextSeq("payment")),
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
        <PaymentReceiptModal payment={paymentReceipt} customer={customers.find((c) => c.id === paymentReceipt.customerId)} settings={settings} branch={branch} showToast={showToast} onClose={() => setPaymentReceipt(null)} />
      )}
      <div className="stat-grid">
        <StatTile icon={HandCoins} tone="red" label="Total owed to you" value={money(totalOwed)} />
        <StatTile icon={Users} tone="amber" label="Customers owing" value={owing.length} sub={`${sales.filter((s) => s.paymentType === "credit").length} credit sales all time`} />
      </div>

      <div style={styles.searchBox}>
        <Search size={18} />
        <input placeholder="Search by name or phone" value={query} onChange={(e) => setQuery(e.target.value)} style={styles.searchInput} />
        {query ? <IconButton icon={X} label="Clear search" size={16} onClick={() => setQuery("")} /> : null}
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState icon={owing.length === 0 ? BadgeCheck : Search} title={owing.length === 0 ? "Nobody owes you" : "No match"}
            text={owing.length === 0 ? "Credit sales will show up here until they are paid." : "Try a different name or phone number."} />
        </div>
      ) : (
        <List>
          {filtered.map((c) => (
            <div key={c.id} className="row-split">
              <button type="button" className="row" onClick={() => setSelectedId(c.id)}>
                <Avatar name={c.name} size={42} />
                <span className="row-main">
                  <div className="row-title">{c.name}</div>
                  <div className="row-sub">{c.phone || "No phone on file"}{c.remindedAt ? ` · reminded ${c.remindedAt}` : ""}</div>
                </span>
                <span className="row-end"><div className="row-value" style={{ color: colors.red }}>{money(c.balance)}</div></span>
              </button>
              <button type="button" className="star-btn" style={{ color: colors.whatsapp }} onClick={() => remind(c, "wa")} aria-label={`Send WhatsApp reminder to ${c.name}`} title="Send WhatsApp reminder">
                <MessageCircle size={22} />
              </button>
            </div>
          ))}
        </List>
      )}

      {selected && (
        <Modal onClose={() => { setSelectedId(null); setPhoneDraft(""); setDiscDraft(null); }} title="Customer">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar name={selected.name} size={52} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{selected.name}</div>
              <div style={{ fontSize: 13, color: colors.inkSoft }}>{selected.phone || "No phone on file"}</div>
            </div>
          </div>
          <div style={{ background: selected.balance > 0 ? colors.redSoft : colors.greenSoft, borderRadius: 16, padding: "14px 16px", margin: "16px 0 12px" }}>
            <div style={{ fontSize: 12.5, color: selected.balance > 0 ? colors.red : colors.green, fontWeight: 600 }}>{selected.balance > 0 ? "Currently owes" : "Fully paid"}</div>
            <div className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", color: selected.balance > 0 ? colors.red : colors.green }}>{money(selected.balance)}</div>
          </div>
          {currentUser.role === "admin" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap" }}>Regular discount %</span>
              <input style={{ ...styles.input, width: 90 }} className="num" type="number" inputMode="decimal" min="0" max="100" step="0.5" aria-label="Regular discount percent" placeholder="0"
                value={discDraft !== null ? discDraft : (Number((customers.find((c) => c.id === selected.id) || {}).discountPct) || "")} onChange={(e) => setDiscDraft(e.target.value)} />
              <Button small variant="secondary" onClick={() => { const v = Math.min(100, Math.max(0, Number(discDraft) || 0)); setCustomers((prev) => prev.map((x) => (x.id === selected.id ? { ...x, discountPct: v } : x))); setDiscDraft(null); showToast(v ? `${selected.name} gets ${v}% off every sale.` : "Regular discount removed."); }}>Save</Button>
            </div>
          )}
          {selected.balance > 0 && (
            <div style={styles.stack8}>
              <Button full icon={Plus} onClick={() => openPay(selected)}>Record payment</Button>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="whatsapp" icon={MessageCircle} onClick={() => remind(selected, "wa")} style={{ flex: 1 }}>WhatsApp</Button>
                <Button variant="secondary" icon={MessageSquare} onClick={() => remind(selected, "sms")} style={{ flex: 1 }}>SMS</Button>
              </div>
              {selected.remindedAt && <div style={{ fontSize: 12.5, color: colors.inkSoft }}>Last reminded on {selected.remindedAt}</div>}
              {!normalizePhone(selected.phone) && (
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={{ ...styles.input, flex: 1, minWidth: 0 }} type="tel" placeholder="Add phone, e.g. 0803 123 4567" value={phoneDraft} onChange={(e) => setPhoneDraft(e.target.value)} />
                  <Button onClick={savePhone}>Save</Button>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 18 }}>
            <SectionHeader title="Credit sales" />
            <List>
              {selectedSales.map((s) => (
                <Row key={s.id} lead={<Receipt size={19} />} title={`Invoice ${s.invoiceNo}`} sub={s.date} value={money(s.balanceDue)} valueSub={s.dueDate ? `due ${s.dueDate}` : "balance at sale"} />
              ))}
            </List>
          </div>
          <div style={{ marginTop: 18, paddingBottom: 8 }}>
            <SectionHeader title="Payments received" />
            {selectedPayments.length === 0 ? (
              <div style={styles.emptyNote}>No repayments recorded yet.</div>
            ) : (
              <List>
                {selectedPayments.map((p) => (
                  <Row key={p.id} lead={<Banknote size={19} />} leadTone={{ background: colors.greenSoft, color: colors.green }} title={p.date} sub={p.note || undefined} value={money(p.amount)} valueColor={colors.green} />
                ))}
              </List>
            )}
          </div>
        </Modal>
      )}

      {payForm && selected && (
        <Modal onClose={closePay} title="Record payment">
          <div style={{ ...styles.emptyNote, marginBottom: 12 }}>{selected.name} currently owes <b>{money(selected.balance)}</b>.</div>
          <div style={styles.stack}>
            <Field label={`Amount paid (${CURRENCY})`}>
              <input style={styles.input} type="number" inputMode="decimal" step="0.01" autoFocus={!("ontouchstart" in window)} value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
            </Field>
            <div className="chips" style={{ margin: 0, padding: 0 }}>
              <button type="button" className="chip" onClick={() => setPayForm({ ...payForm, amount: String(selected.balance) })}>Pay in full</button>
              {selected.balance > 1000 && <button type="button" className="chip" onClick={() => setPayForm({ ...payForm, amount: String(Math.round(selected.balance / 2)) })}>Half</button>}
            </div>
            <Field label="Date">
              <input style={styles.input} type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
            </Field>
            <Field label="Note (optional)">
              <input style={styles.input} value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} placeholder="e.g. Part payment, balance next week" />
            </Field>
          </div>
          <div className="sheet-actions">
            <Button variant="secondary" onClick={closePay}>Cancel</Button>
            <Button icon={Check} onClick={savePayment}>Save payment</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- sales history / reports ----------
// ---------- sales history: look at, reprint and (within the rules) correct past sales ----------
function SalesHistory({ sales, setSales, currentUser, isAdmin, branches, multiBranch, settings, showToast, activeBranchId }) {
  const today = todayStr();
  const dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localDateStr(d); };
  const [range, setRange] = useState("today");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [q, setQ] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [viewId, setViewId] = useState(null);
  const pick = (r) => {
    setRange(r);
    if (r === "today") { setFrom(today); setTo(today); }
    else if (r === "yesterday") { setFrom(dayOffset(1)); setTo(dayOffset(1)); }
    else if (r === "week") { setFrom(dayOffset(6)); setTo(today); }
  };
  const mine = (s) => (s.cashierId ? s.cashierId === currentUser.id : s.cashierName === currentUser.name);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sales.filter((s) => (isAdmin || mine(s)) && s.date >= from && s.date <= to && (branchFilter === "all" || s.branchId === branchFilter)
      && (!needle || (s.customerName || "").toLowerCase().includes(needle) || String(s.invoiceNo).toLowerCase().includes(needle) || (s.items || []).some((i) => i.name.toLowerCase().includes(needle))))
      .sort((a, b) => (a.time < b.time ? 1 : -1));
  }, [sales, from, to, q, branchFilter, isAdmin, currentUser]);
  const sum = rows.reduce((a, s) => a + saleNet(s), 0);
  const disc = rows.reduce((a, s) => a + saleDiscount(s.items), 0);
  const viewSale = viewId ? sales.find((s) => s.id === viewId) : null;
  return (
    <div style={styles.stack}>
      <div className="chips" style={{ margin: 0, padding: 0 }}>
        {[["today", "Today"], ["yesterday", "Yesterday"], ["week", "7 days"], ["custom", "Pick dates"]].map(([k, l]) => <button key={k} type="button" className={"chip" + (range === k ? " on" : "")} onClick={() => pick(k)}>{l}</button>)}
      </div>
      {range === "custom" && (
        <div style={styles.formGrid2}>
          <Field label="From"><input style={styles.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input style={styles.input} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      )}
      <div style={styles.searchBox}><Search size={18} /><input style={styles.searchInput} placeholder="Search customer, invoice no. or item" aria-label="Search sales history" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {isAdmin && multiBranch && (
        <select style={styles.input} aria-label="Branch" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
          <option value="all">All branches</option>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      <div className="stat-grid">
        <StatTile icon={ReceiptText} tone="ink" label="Sales" value={rows.length} />
        <StatTile icon={Banknote} tone="green" label="Total" value={money(sum)} />
        <StatTile icon={Tag} tone="amber" label="Discounts given" value={money(disc)} />
      </div>
      {!isAdmin && <div style={{ fontSize: 12.5, color: colors.inkSoft }}>You see the sales you made. Tap one to reprint it{" "}or correct its prices/discounts (today's sales only).</div>}
      {viewSale && (
        <ReceiptModal viewing sale={viewSale} settings={settings} showToast={showToast} onClose={() => setViewId(null)}
          branch={resolveBranch(branches, viewSale.branchId, settings)}
          onEdit={canEditSale(currentUser, viewSale, today) ? (u) => setSales((prev) => prev.map((x) => (x.id === u.id ? u : x))) : undefined} />
      )}
      {rows.length === 0 ? (
        <div className="card"><EmptyState icon={History} title="No sales found" text="Nothing matches these dates or this search." /></div>
      ) : (
        <List>
          {rows.map((s) => (
            <Row key={s.id} onClick={() => setViewId(s.id)} lead={<ReceiptText size={19} />}
              leadTone={s.paymentType === "credit" ? { background: colors.redSoft, color: colors.red } : null}
              title={s.customerName || "Walk-in customer"}
              sub={`#${s.invoiceNo} · ${s.date} ${new Date(s.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${isAdmin ? " · " + s.cashierName : ""}`}
              value={money(s.total)}>
              <div style={{ marginTop: 3, display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
                <Badge kind={s.paymentType === "credit" ? "danger" : "primary"}>{s.paymentType === "credit" ? "Credit" : "Cash"}</Badge>
                {saleDiscount(s.items) > 0 && <Badge kind="ok">−{money(saleDiscount(s.items))}</Badge>}
                {s.edited && <Badge kind="warn">Edited</Badge>}
                {saleRefunded(s) > 0 && <Badge kind="danger">Returned</Badge>}
              </div>
            </Row>
          ))}
        </List>
      )}
    </div>
  );
}

function Reports({ currentUser, setSales, sales, expenses, branches, multiBranch, settings, showToast }) {
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
    setFromDate(localDateStr(start));
    setToDate(localDateStr(end));
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

  const revenue = filtered.reduce((a, s) => a + saleNet(s), 0);
  const cost = filtered.reduce((a, s) => a + saleNetCost(s), 0);
  const profit = revenue - cost;
  const creditCount = filtered.filter((s) => s.paymentType === "credit").length;

  const [view, setView] = useState("sales");
  const [viewId, setViewId] = useState(null);
  const viewSale = viewId ? sales.find((x) => x.id === viewId) : null;
  const fExpenses = useMemo(
    () => expenses.filter((e) => e.date >= fromDate && e.date <= toDate && (branchFilter === "all" || e.branchId === branchFilter)),
    [expenses, fromDate, toDate, branchFilter]
  );
  const ps = useMemo(() => profitSummary(filtered, fExpenses), [filtered, fExpenses]);
  const prodRows = useMemo(() => byProduct(filtered), [filtered]);
  const cashierRows = useMemo(() => byCashier(filtered), [filtered]);
  const payRows = useMemo(() => byPayment(filtered), [filtered]);
  const dayRows = useMemo(() => byDay(filtered), [filtered]);

  const exportXlsx = async () => {
    try {
      const branchLabel = branchFilter === "all" ? "All branches" : (branches.find((b) => b.id === branchFilter) || {}).name || "";
      const b64 = buildReportWorkbook({
        shopName: settings.shopName, rangeLabel: `${fromDate} to ${toDate}`, branchLabel,
        sales: filtered.map((s) => ({ ...s, branchName: (branches.find((b) => b.id === s.branchId) || {}).name || "" })),
        expenses: fExpenses,
      });
      await saveAndShareBase64(`ilayla-report-${fromDate}_to_${toDate}.xlsx`, b64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      showToast("Excel report ready.");
    } catch (e) { showToast("Could not create the Excel file.", "err"); }
  };
  const VIEWS = [["sales", "Sales"], ["profit", "Profit"], ["product", "By product"], ["cashier", "By cashier"], ["payment", "By payment"]];

  const rangeLabel = fromDate === toDate ? fromDate : `${fromDate} to ${toDate}`;
  const nothing = (txt) => <div className="card"><EmptyState icon={Inbox} title="Nothing here" text={txt} /></div>;
  const PL = ({ label, value, strong, color }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 0", borderBottom: `1px solid ${colors.line}`, fontWeight: strong ? 700 : 400, color }}>
      <span>{label}</span><span className="num">{value}</span>
    </div>
  );

  return (
    <div style={styles.stack}>
      <div className="card" style={styles.stack8}>
        <div style={styles.formGrid2}>
          <Field label="From">
            <input style={styles.input} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </Field>
          <Field label="To">
            <input style={styles.input} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </Field>
        </div>
        <div className="chips" style={{ margin: 0, padding: 0 }}>
          <button type="button" className="chip" onClick={() => setQuickRange(1)}>Today</button>
          <button type="button" className="chip" onClick={() => setQuickRange(7)}>Last 7 days</button>
          <button type="button" className="chip" onClick={() => setQuickRange(30)}>Last 30 days</button>
          <button type="button" className="chip" onClick={setThisMonth}>This month</button>
        </div>
        {multiBranch && (
          <Field label="Branch">
            <select style={styles.input} value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="all">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        )}
        <div style={styles.searchBox}>
          <Search size={18} />
          <input placeholder="Customer, invoice #, cashier or item" value={query} onChange={(e) => setQuery(e.target.value)} style={styles.searchInput} />
          {query ? <IconButton icon={X} label="Clear search" size={16} onClick={() => setQuery("")} /> : null}
        </div>
        <Button variant="tonal" icon={FileSpreadsheet} full onClick={exportXlsx}>Export to Excel</Button>
      </div>

      <div className="stat-grid">
        <StatTile icon={Banknote} tone="amber" label={`Revenue · ${filtered.length} sale${filtered.length === 1 ? "" : "s"}`} value={money(revenue)} />
        <StatTile icon={TrendingUp} tone="green" label="Profit" value={money(profit)} />
        <StatTile icon={Boxes} tone="ink" label="Cost of goods" value={money(cost)} />
        <StatTile icon={HandCoins} tone="red" label="Credit sales" value={creditCount} />
      </div>

      <Segmented scroll value={view} onChange={setView} options={VIEWS} />
      {viewSale && (
        <ReceiptModal viewing sale={viewSale} settings={settings} showToast={showToast} onClose={() => setViewId(null)}
          branch={resolveBranch(branches, viewSale.branchId, settings)}
          onEdit={canEditSale(currentUser, viewSale, todayStr()) ? (u) => setSales((prev) => prev.map((x) => (x.id === u.id ? u : x))) : undefined} />
      )}

      {view === "sales" && (
        filtered.length === 0 ? nothing("No sales match this date range or search.") : (
          <List>
            {filtered.map((s) => (
              <Row key={s.id} onClick={() => setViewId(s.id)}
                lead={<ReceiptText size={19} />}
                leadTone={s.paymentType === "credit" ? { background: colors.redSoft, color: colors.red } : null}
                title={s.customerName || "Walk-in customer"}
                sub={`#${s.invoiceNo} · ${s.date} · ${s.cashierName}${multiBranch ? " · " + ((branches.find((b) => b.id === s.branchId) || {}).name || "") : ""}`}
                value={money(s.total)}>
                <div style={{ marginTop: 3, display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                  <Badge kind={s.paymentType === "credit" ? "danger" : "primary"}>{s.paymentType === "credit" ? "Credit" : "Cash"}</Badge>
                  {saleRefunded(s) > 0 && <Badge kind="danger">Returned</Badge>}
                  <span className="num" style={{ fontSize: 12.5, color: colors.green, fontWeight: 600 }}>+{money(saleNet(s) - saleNetCost(s))}</span>
                </div>
              </Row>
            ))}
          </List>
        )
      )}

      {view === "profit" && (
        <div style={styles.stack}>
          <div className="card">
            <div style={styles.panelTitle}>Profit and loss</div>
            <PL label="Revenue" value={money(ps.revenue)} />
            <PL label="Cost of goods sold" value={"- " + money(ps.cost)} />
            <PL strong label={`Gross profit (${ps.margin.toFixed(0)}% margin)`} value={money(ps.gross)} />
            <PL label="Expenses" value={"- " + money(ps.expensesTotal)} />
            <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 0 2px", fontWeight: 700, fontSize: 18, color: ps.net < 0 ? colors.red : colors.primary }}>
              <span>Net profit</span><span className="num">{money(ps.net)}</span>
            </div>
            <div style={{ fontSize: 12.5, color: colors.inkSoft }}>{rangeLabel}</div>
          </div>
          {ps.expenseCategories.length > 0 && (
            <div>
              <SectionHeader title="Expenses by category" />
              <List>{ps.expenseCategories.map(([c, v]) => <Row key={c} lead={<Tag size={19} />} title={c} value={money(v)} />)}</List>
            </div>
          )}
          <div>
            <SectionHeader title="Day by day" />
            {dayRows.length === 0 ? nothing("No sales in this range.") : (
              <List>
                {[...dayRows].reverse().map((r) => (
                  <Row key={r.key} lead={<CalendarDays size={19} />} title={r.key} sub={`${r.count} sale${r.count === 1 ? "" : "s"}`} value={money(r.revenue)} valueSub={<span style={{ color: colors.green, fontWeight: 600 }}>+{money(r.profit)}</span>} />
                ))}
              </List>
            )}
          </div>
        </div>
      )}

      {view === "product" && (
        prodRows.length === 0 ? nothing("No sales in this range.") : (
          <List>
            {prodRows.map((r) => (
              <Row key={r.productId || r.name} lead={<Avatar name={r.name} size={40} />} leadTone={{ background: "none" }}
                title={r.name} sub={`${r.qty} sold · ${r.margin.toFixed(0)}% margin`} value={money(r.revenue)}
                valueSub={<span style={{ color: r.profit < 0 ? colors.red : colors.green, fontWeight: 600 }}>{r.profit < 0 ? "" : "+"}{money(r.profit)}</span>} />
            ))}
          </List>
        )
      )}

      {view === "cashier" && (
        cashierRows.length === 0 ? nothing("No sales in this range.") : (
          <List>
            {cashierRows.map((r) => (
              <Row key={r.key} lead={<Avatar name={r.key} size={40} />} leadTone={{ background: "none" }}
                title={r.key} sub={`${r.count} sale${r.count === 1 ? "" : "s"}`} value={money(r.revenue)}
                valueSub={<span style={{ color: colors.green, fontWeight: 600 }}>+{money(r.profit)}</span>} />
            ))}
          </List>
        )
      )}

      {view === "payment" && (
        payRows.length === 0 ? nothing("No sales in this range.") : (
          <List>
            {payRows.map((r) => (
              <Row key={r.key} lead={r.key === "credit" ? <HandCoins size={19} /> : <Banknote size={19} />}
                leadTone={r.key === "credit" ? { background: colors.redSoft, color: colors.red } : null}
                title={payLabel(r.key)} sub={`${r.count} sale${r.count === 1 ? "" : "s"} · paid ${money(r.collected)}`} value={money(r.revenue)}
                valueSub={r.outstanding > 0 ? <span style={{ color: colors.red, fontWeight: 600 }}>{money(r.outstanding)} owed</span> : null} />
            ))}
          </List>
        )
      )}
    </div>
  );
}




// ---------- end-of-day close ----------
function DayClose({ sales, creditPayments, expenses, purchases, branches, multiBranch, activeBranchId, settings, dayCloses, setDayCloses, currentUser, showToast }) {
  const [date, setDate] = useState(todayStr());
  const key = `${activeBranchId}|${date}`;
  const [floatAmt, setFloatAmt] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    const sv = (dayCloses || {})[key];
    setFloatAmt(sv ? String(sv.float) : "");
    setCounted(sv && sv.counted !== null && sv.counted !== undefined ? String(sv.counted) : "");
    setNote(sv ? sv.note || "" : "");
  }, [key]);

  const d = useMemo(
    () => dayClose({ sales, creditPayments, expenses, purchases, date, branchId: activeBranchId, floatAmount: Number(floatAmt) || 0, counted: counted === "" ? null : counted }),
    [sales, creditPayments, expenses, purchases, date, activeBranchId, floatAmt, counted]
  );
  const branch = resolveBranch(branches, activeBranchId, settings);
  const savedNow = (dayCloses || {})[key];

  const save = () => {
    setDayCloses((prev) => ({ ...prev, [key]: {
      date, branchId: activeBranchId, float: Number(floatAmt) || 0, counted: counted === "" ? null : Number(counted),
      expected: d.expected, difference: d.difference, note, closedBy: currentUser.name, closedAt: new Date().toISOString(),
    } }));
    showToast("Day close saved.");
  };
  const share = () => shareText(dayCloseText({ shopName: settings.shopName, branchName: multiBranch ? branch.name : "", date, d, floatAmount: Number(floatAmt) || 0, counted, note, money }));

  const history = Object.values(dayCloses || {}).filter((x) => x.branchId === activeBranchId).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7);
  const Line = ({ label, value, strong, color, sign }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: `1px solid ${colors.line}`, fontWeight: strong ? 700 : 400, color }}>
      <span>{sign ? <span style={{ ...styles.mono, display: "inline-block", width: 18 }}>{sign}</span> : null}{label}</span><span className="num">{value}</span>
    </div>
  );
  const diffBox = d.difference === null
    ? <div style={{ fontSize: 13, color: colors.inkSoft }}>Count the cash in the drawer and enter it above to see if the till balances.</div>
    : d.difference === 0
      ? <div style={{ ...styles.changeDue, display: "flex", gap: 8, alignItems: "center" }}><CircleCheck size={18} />Balanced. The drawer matches the records.</div>
      : d.difference > 0
        ? <div style={{ ...styles.changeDue, color: colors.amber, background: colors.amberSoft }}>Over by <b style={styles.mono}>{money(d.difference)}</b>. There is more cash than the records show.</div>
        : <div style={styles.warnNote}>Short by <b style={styles.mono}>{money(Math.abs(d.difference))}</b>. There is less cash than the records show.</div>;

  return (
    <div style={styles.stack}>
      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{multiBranch ? branch.name : "End of day"}</div>
          <div style={{ marginTop: 4 }}>{savedNow ? <Badge kind="ok" icon={Check}>Saved by {savedNow.closedBy}</Badge> : <Badge kind="neutral">Not saved yet</Badge>}</div>
        </div>
        <input style={{ ...styles.input, width: "auto" }} type="date" value={date} max={todayStr()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
      </div>

      <div className="stat-grid">
        <StatTile icon={Banknote} tone="amber" label={`Sales · ${d.salesCount}`} value={money(d.revenue)} />
        <StatTile icon={TrendingUp} tone="green" label="Gross profit" value={money(d.gross)} />
        <StatTile icon={ReceiptText} tone="ink" label="Expenses" value={money(d.expensesTotal)} />
        <StatTile icon={Wallet} tone={d.net < 0 ? "red" : "primary"} label="Net profit" value={money(d.net)} />
      </div>

      <div className="dash-cols">
        <div>
          <SectionHeader title="Cash in the drawer" />
          <div className="card">
            <Field label={`Opening cash / float (${CURRENCY})`}>
              <input style={styles.input} type="number" step="0.01" inputMode="decimal" value={floatAmt} onChange={(e) => setFloatAmt(e.target.value)} placeholder="0" />
            </Field>
            <div style={{ marginTop: 8 }}>
              <Line sign="+" label="Cash sales" value={money(d.cashSales)} />
              {d.deposits > 0 && <Line sign="+" label="Deposits on credit sales" value={money(d.deposits)} />}
              {d.repayments > 0 && <Line sign="+" label="Credit repayments received" value={money(d.repayments)} />}
              {d.expensesTotal > 0 && <Line sign="-" label="Expenses paid" value={money(d.expensesTotal)} />}
              {d.refundsPaid > 0 && <Line sign="-" label="Refunds paid out" value={money(d.refundsPaid)} />}
              <Line strong label="Expected cash" value={money(d.expected)} />
            </div>
            <div style={{ marginTop: 14 }}>
              <Field label={`Cash you counted (${CURRENCY})`}>
                <input style={styles.input} type="number" step="0.01" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="Enter the counted total" />
              </Field>
            </div>
            <div style={{ marginTop: 12 }}>{diffBox}</div>
            <div style={{ marginTop: 14 }}>
              <Field label="Note (optional)">
                <input style={styles.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid driver from the till" />
              </Field>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
              <Button full icon={Save} onClick={save}>Save day close</Button>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="secondary" icon={Share2} onClick={share} style={{ flex: 1 }}>Share</Button>
                {printerAvailable() && getPrinter().address && (
                  <Button variant="secondary" icon={PrinterIcon} style={{ flex: 1 }} onClick={() => thermalPrint((cfg) => buildText(cfg, `${String(settings.shopName || "").toUpperCase()} DAY CLOSE`, dayCloseText({ shopName: settings.shopName, branchName: multiBranch ? branch.name : "", date, d, floatAmount: Number(floatAmt) || 0, counted, note, money })), showToast)}>Print</Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div style={styles.stack}>
          <div>
            <SectionHeader title="Also today" />
            <div className="card">
              <Line label="Credit given (not yet paid)" value={money(d.creditGiven)} color={d.creditGiven > 0 ? colors.red : undefined} />
              {d.otherMethods > 0 && <Line label="Paid by transfer / POS (not cash)" value={money(d.otherMethods)} />}
              {d.purchasesTotal > 0 && <Line label="Stock purchases received" value={money(d.purchasesTotal)} />}
              {d.expenseList.length > 0 && d.expenseList.map((e) => <Line key={e.id} label={`${e.category}${e.note ? " · " + e.note : ""}`} value={money(e.amount)} />)}
            </div>
          </div>
          <div>
            <SectionHeader title="Top items" />
            {d.topItems.length === 0 ? <div className="card"><EmptyState icon={ShoppingBag} title="No sales" text="Nothing was sold on this date." /></div> : (
              <List>{d.topItems.map((t) => <Row key={t.name} title={t.name} sub={`×${t.qty}`} value={money(t.revenue)} />)}</List>
            )}
            {d.cashiers.length > 1 && (
              <div style={{ marginTop: 16 }}>
                <SectionHeader title="By cashier" />
                <List>{d.cashiers.map((c) => <Row key={c.key} lead={<Avatar name={c.key} size={40} />} leadTone={{ background: "none" }} title={c.key} sub={`${c.count} sale${c.count === 1 ? "" : "s"}`} value={money(c.revenue)} />)}</List>
              </div>
            )}
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <div>
          <SectionHeader title="Recent closes" />
          <List>
            {history.map((h) => {
              const none = h.difference === null || h.difference === undefined;
              return (
                <Row key={h.date} lead={<DayIcon size={19} />} title={h.date} sub={h.closedBy}
                  value={<Badge kind={none ? "neutral" : h.difference === 0 ? "ok" : h.difference > 0 ? "warn" : "danger"}>
                    {none ? "Not counted" : h.difference === 0 ? "Balanced" : h.difference > 0 ? `Over ${money(h.difference)}` : `Short ${money(Math.abs(h.difference))}`}
                  </Badge>} />
              );
            })}
          </List>
        </div>
      )}
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
  useBackClose(onClose);

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "calc(var(--sat) + 12px) 14px 10px", color: "#fff", gap: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>{title}</div>
        <button type="button" onClick={onClose} aria-label="Close scanner" style={{ background: "rgba(255,255,255,0.16)", color: "#fff", border: "none", borderRadius: 12, height: 40, padding: "0 16px", fontWeight: 600, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 6 }}><X size={18} /> Done</button>
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <video ref={videoRef} playsInline muted autoPlay style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        {!err && (
          <div style={{ position: "absolute", left: "50%", top: "42%", transform: "translate(-50%,-50%)", width: "82%", maxWidth: 420, aspectRatio: "16 / 8", border: `3px solid ${ready ? "#4FD1B5" : "rgba(255,255,255,0.4)"}`, borderRadius: 14, boxShadow: "0 0 0 100vmax rgba(0,0,0,0.38)", pointerEvents: "none" }}>
            <div style={{ position: "absolute", left: 10, right: 10, top: "50%", height: 2, background: "rgba(255,80,80,0.85)" }} />
          </div>
        )}
        {!ready && !err && <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14 }}><Spinner size={26} />Starting camera</div>}
        {err && <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 12, alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14.5, textAlign: "center", padding: 28, lineHeight: 1.5 }}><CameraIcon size={34} />{err}</div>}
      </div>
      <div style={{ padding: "12px 14px calc(var(--sab) + 14px)", color: "#fff", background: "#111" }}>
        <div style={{ minHeight: 40, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, display: "flex", gap: 8, alignItems: "center", color: result ? (result.ok === false ? "#FF9A8B" : "#7BE0C3") : "rgba(255,255,255,0.7)" }}>
            {result ? (result.ok === false ? <CircleAlert size={18} style={{ flexShrink: 0 }} /> : <CircleCheck size={18} style={{ flexShrink: 0 }} />) : null}
            {result ? result.text : "Hold the barcode flat (horizontal) inside the box"}
          </div>
          {torchOk && <button type="button" onClick={toggleTorch} style={{ background: torch ? "#F2C14E" : "rgba(255,255,255,0.16)", color: torch ? "#000" : "#fff", border: "none", borderRadius: 12, height: 40, padding: "0 14px", fontWeight: 600, fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 6 }}><Flashlight size={17} /> {torch ? "On" : "Light"}</button>}
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
    setProducts((prev) => applyPlan(prev, plan, activeBranchId, uid, () => makeId("p-", uid)));
    const c = plan.counts;
    showToast(`Imported: ${c.add} added, ${c.update} updated${plan.errors.length ? `, ${plan.errors.length} row(s) skipped` : ""}.`);
    onClose();
  };
  const actionable = plan ? plan.rows.filter((r) => r.action !== "skip").length : 0;
  const belowCost = plan ? plan.rows.filter((r) => r.action !== "skip" && r.data.cost > 0 && r.data.price > 0 && r.data.price < r.data.cost).length : 0;
  const tag = (a) => a === "add" ? "New" : a === "skip" ? "Skip" : a === "addstock" ? "+Stock" : "Update";

  return (
    <Modal onClose={onClose} title="Import / export stock">
      <div style={styles.stack}>
        {!rows && (
          <>
            <div style={{ background: colors.blueSoft, color: colors.blue, borderRadius: 12, padding: "10px 12px", fontSize: 13.5, lineHeight: 1.55, display: "flex", gap: 10 }}>
              <Info size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Upload a spreadsheet (<b>.xlsx</b>, <b>.xls</b> or <b>.csv</b>) or paste rows copied from Excel. The first row must be headers: <span style={styles.mono}>name, sku, barcode, category, cost, price, stock, low_stock</span>. Only <b>name</b> and <b>price</b> are required. Stock is counted for <b>{multiBranch ? branchName : "this shop"}</b>.</span>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={onFile} style={{ display: "none" }} />
            <Button full icon={FileSpreadsheet} onClick={() => fileRef.current && fileRef.current.click()}>Choose a file</Button>
            <Field label="Or paste rows (include the header row)">
              <textarea style={{ ...styles.input, ...styles.mono, fontSize: 13, minHeight: 90, height: "auto", padding: 12 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"name\tprice\tstock\nWhole Milk 1L\t1200\t24"} spellCheck={false} />
            </Field>
            {paste.trim() && <Button variant="secondary" onClick={usePaste}>Read pasted rows</Button>}
            {loadErr && <div style={styles.loginError} role="alert">{loadErr}</div>}
            <div>
              <SectionHeader title="Export" />
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="secondary" icon={DownloadIcon} small style={{ flex: 1 }} onClick={() => saveAndShare("ilayla-inventory-template.csv", TEMPLATE_CSV, "text/csv")}>Template</Button>
                <Button variant="secondary" icon={DownloadIcon} small style={{ flex: 1 }} onClick={() => saveAndShare(`ilayla-inventory-${todayStr()}.csv`, inventoryToCsv(products, activeBranchId), "text/csv").then(() => showToast("Inventory file ready.")).catch(() => showToast("Could not create the file.", "err"))}>Current stock</Button>
              </div>
              <div style={{ ...styles.emptyNote, marginTop: 8 }}>Tip: export your current stock, edit it in Excel, then import it back to update many products at once.</div>
            </div>
          </>
        )}

        {rows && plan && (
          <>
            <div style={{ fontSize: 13.5, color: colors.inkSoft, display: "flex", alignItems: "center", gap: 6 }}><FileText size={16} /> <b style={{ color: colors.ink }}>{fileName}</b></div>
            {plan.fatal ? (
              <div style={styles.loginError} role="alert">{plan.fatal}</div>
            ) : (
              <>
                <div className="stat-grid" style={{ gap: 10 }}>
                  <StatTile icon={PackageOpen} tone="green" label="New products" value={plan.counts.add} />
                  <StatTile icon={RefreshCw} tone="blue" label="Existing (by SKU)" value={plan.counts.update + plan.counts.skip} />
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
                <List style={{ maxHeight: 220, overflowY: "auto" }}>
                  {plan.rows.slice(0, 8).map((r) => (
                    <Row key={r.line} title={r.data.name} sub={r.data.stock != null ? `Stock ${r.data.stock}` : undefined}
                      value={r.data.price != null ? money(r.data.price) : ""}>
                      <Badge kind={r.action === "add" ? "ok" : r.action === "skip" ? "neutral" : "warn"}>{tag(r.action)}</Badge>
                    </Row>
                  ))}
                  {plan.rows.length > 8 && <div style={{ padding: "10px 16px", fontSize: 13, color: colors.inkSoft }}>and {plan.rows.length - 8} more</div>}
                </List>
                {belowCost > 0 && <div style={{ ...styles.warnNote, display: "flex", gap: 8 }}><AlertTriangle size={18} style={{ flexShrink: 0 }} />{belowCost} row{belowCost === 1 ? " has" : "s have"} a selling price below cost. {belowCost === 1 ? "It is" : "They are"} still imported, but check {belowCost === 1 ? "it" : "them"}.</div>}
                {plan.errors.length > 0 && (
                  <div style={styles.loginError} role="alert">
                    <b>{plan.errors.length} row(s) have problems and will be skipped:</b>
                    <div style={{ marginTop: 4, maxHeight: 110, overflowY: "auto", fontWeight: 500 }}>
                      {plan.errors.slice(0, 20).map((e, i) => <div key={i}>Row {e.line}: {e.msg}</div>)}
                      {plan.errors.length > 20 && <div>and {plan.errors.length - 20} more</div>}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
      {rows && plan && (
        <div className="sheet-actions">
          <Button variant="secondary" onClick={reset}>Choose another file</Button>
          {!plan.fatal && <Button icon={Check} disabled={!actionable} onClick={doImport}>Import {actionable} product{actionable === 1 ? "" : "s"}</Button>}
        </div>
      )}
    </Modal>
  );
}

// ---------- team (user accounts) ----------
function emptyUser(branches) {
  return { mode: "add", username: "", password: "", role: "staff", name: "", branchId: branches[0] ? branches[0].id : "" };
}

function Team({ users, setUsers, currentUser, showToast, branches, multiBranch }) {
  const [form, setForm] = useState(null);
  const [pwUser, setPwUser] = useState(null);
  const [pwValue, setPwValue] = useState("");
  const [toRemove, setToRemove] = useState(null);
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
    if (dupe) { showToast("That username is already taken. Pick another.", "err"); return; }
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

  const resetPassword = (u, next) => {
    if (next.length < 4) { showToast("Password must be at least 4 characters.", "err"); return false; }
    setUsers((prev) => prev.map((x) => x.id === u.id ? { ...x, password: next } : x));
    showToast("Password updated.");
    return true;
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
      <Button icon={UserPlus} full onClick={openAdd}>Add staff account</Button>
      <List>
        {users.map((u) => (
          <Row key={u.id} lead={<Avatar name={u.name} size={42} />} leadTone={{ background: "none" }}
            title={<>{u.name} {u.id === currentUser.id && <Badge kind="primary">You</Badge>}</>}
            sub={`@${u.username} · ${u.role === "admin" ? "Admin" : "Staff"}${multiBranch ? ` · ${(branches.find((b) => b.id === u.branchId) || {}).name || "No branch"}` : ""}`}>
            <div style={{ display: "flex", gap: 6 }}>
              <IconButton icon={Pencil} label={`Edit ${u.name}`} size={16} onClick={() => openEdit(u)} />
              <IconButton icon={KeyRound} label={`Reset password for ${u.name}`} size={16} onClick={() => { setPwUser(u); setPwValue(""); }} />
              <IconButton icon={Trash2} danger label={`Remove ${u.name}`} size={16} onClick={() => setToRemove(u)} />
            </div>
          </Row>
        ))}
      </List>

      {form && form.mode === "add" && (
        <Modal onClose={close} title="Add a staff account">
          <div style={styles.stack}>
            <Field label="Full name">
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Priya Nair" />
            </Field>
            <Field label="Username">
              <input style={styles.input} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. musa" autoCapitalize="none" autoCorrect="off" />
            </Field>
            <Field label="Password" hint="At least 4 characters">
              <input style={styles.input} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Choose a password" />
            </Field>
            <Field label="Role">
              <select style={styles.input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">Staff: till access only</option>
                <option value="admin">Admin: full access</option>
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
          <div className="sheet-actions">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button icon={Check} onClick={save}>Create account</Button>
          </div>
        </Modal>
      )}

      {form && form.mode === "edit" && (
        <Modal onClose={close} title="Edit staff account">
          <div style={styles.stack}>
            <Field label="Full name">
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Priya Nair" />
            </Field>
            <Field label="Role">
              <select style={styles.input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="staff">Staff: till access only</option>
                <option value="admin">Admin: full access</option>
              </select>
            </Field>
            {branches.length > 1 && (
              <Field label="Branch">
                <select style={styles.input} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
            <div style={styles.emptyNote}>Use the key icon in the list to reset this person's password.</div>
          </div>
          <div className="sheet-actions">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button icon={Check} onClick={save}>Save changes</Button>
          </div>
        </Modal>
      )}

      {pwUser && (
        <Modal onClose={() => setPwUser(null)} title="Reset password">
          <Field label={`New password for ${pwUser.name}`} hint="At least 4 characters">
            <input style={styles.input} value={pwValue} onChange={(e) => setPwValue(e.target.value)} placeholder="New password" autoCapitalize="none" autoCorrect="off" />
          </Field>
          <div className="sheet-actions">
            <Button variant="secondary" onClick={() => setPwUser(null)}>Cancel</Button>
            <Button icon={KeyRound} onClick={() => { if (resetPassword(pwUser, pwValue)) setPwUser(null); }}>Update password</Button>
          </div>
        </Modal>
      )}

      {toRemove && (
        <Modal onClose={() => setToRemove(null)} title="Remove account?">
          <p style={{ color: colors.inkSoft, lineHeight: 1.5, margin: "4px 0 0" }}>
            <b style={{ color: colors.ink }}>{toRemove.name}</b> will no longer be able to sign in. Their past sales stay in your records.
          </p>
          <div className="sheet-actions">
            <Button variant="secondary" onClick={() => setToRemove(null)}>Cancel</Button>
            <Button variant="danger" icon={Trash2} onClick={() => { remove(toRemove); setToRemove(null); }}>Remove</Button>
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
  const [toRemove, setToRemove] = useState(null);
  const openAdd = () => setForm(emptyBranch());
  const openEdit = (b) => setForm({ ...b });
  const close = () => setForm(null);

  const save = () => {
    if (!form.name.trim()) { showToast("Branch name is required.", "err"); return; }
    if (form.id) {
      setBranches((prev) => prev.map((b) => b.id === form.id ? { ...b, name: form.name.trim(), address: form.address, phone: form.phone } : b));
      showToast("Branch updated.");
    } else {
      setBranches((prev) => [...prev, { id: makeId("br-", uid), name: form.name.trim(), address: form.address, phone: form.phone }]);
      showToast("Branch added.");
    }
    close();
  };

  const inUse = (id) => {
    return sales.some((s) => s.branchId === id) || purchases.some((p) => p.branchId === id) || expenses.some((e) => e.branchId === id) || users.some((u) => u.branchId === id);
  };

  const remove = (b) => {
    if (branches.length <= 1) { showToast("At least one branch is required.", "err"); return; }
    if (inUse(b.id)) { showToast("This branch has sales, purchases, expenses or staff tied to it, so it can't be removed.", "err"); return; }
    setBranches((prev) => prev.filter((x) => x.id !== b.id));
    showToast("Branch removed.");
  };

  return (
    <div>
      <SectionHeader title="Branches" action={<Button small variant="tonal" icon={Plus} onClick={openAdd}>Add</Button>} />
      <List>
        {branches.map((b) => (
          <Row key={b.id} lead={<BranchIcon size={20} />} title={b.name} sub={`${b.address || "No address set"}${b.phone ? ` · ${b.phone}` : ""}`}>
            <div style={{ display: "flex", gap: 6 }}>
              <IconButton icon={Pencil} label={`Edit ${b.name}`} size={16} onClick={() => openEdit(b)} />
              <IconButton icon={Trash2} danger label={`Remove ${b.name}`} size={16} onClick={() => setToRemove(b)} />
            </div>
          </Row>
        ))}
      </List>

      {form && (
        <Modal onClose={close} title={form.id ? "Edit branch" : "Add branch"}>
          <div style={styles.stack}>
            <Field label="Branch name">
              <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Tarauni Branch" />
            </Field>
            <Field label="Address">
              <input style={styles.input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Leave blank to use the main shop address" />
            </Field>
            <Field label="Phone">
              <input style={styles.input} inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Leave blank to use the main shop phone" />
            </Field>
          </div>
          <div className="sheet-actions">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button icon={Check} onClick={save}>{form.id ? "Save changes" : "Add branch"}</Button>
          </div>
        </Modal>
      )}

      {toRemove && (
        <Modal onClose={() => setToRemove(null)} title="Remove branch?">
          <p style={{ color: colors.inkSoft, lineHeight: 1.5, margin: "4px 0 0" }}><b style={{ color: colors.ink }}>{toRemove.name}</b> will be removed. This only works if nothing is tied to it.</p>
          <div className="sheet-actions">
            <Button variant="secondary" onClick={() => setToRemove(null)}>Cancel</Button>
            <Button variant="danger" icon={Trash2} onClick={() => { remove(toRemove); setToRemove(null); }}>Remove</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- shop settings ----------

function PrinterPanel({ settings, showToast }) {
  const printer = usePrinter();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <SectionHeader title="Receipt printer" />
      <div className="card">
        {!printerAvailable() ? (
          <div style={{ display: "flex", gap: 10, color: colors.inkSoft, fontSize: 14, lineHeight: 1.5 }}>
            <Info size={20} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Bluetooth receipt printing works in the Android app. You can still use PDF or share receipts as text.</span>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
              <span className="row-lead"><PrinterIcon size={20} /></span>
              <div style={{ minWidth: 0 }}>
                {printer.address ? (
                  <>
                    <div style={{ fontWeight: 600 }}>{printer.name || printer.address}</div>
                    <div style={{ fontSize: 12.5, color: colors.inkSoft }}>{printer.width === 48 ? "80 mm" : "58 mm"} paper · auto-print {printer.auto ? "on" : "off"}</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 600 }}>No printer set up</div>
                    <div style={{ fontSize: 12.5, color: colors.inkSoft }}>Works with Bluetooth thermal printers (58 mm and 80 mm)</div>
                  </>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button icon={Bluetooth} onClick={() => setOpen(true)} style={{ flex: 1 }}>{printer.address ? "Change" : "Set up printer"}</Button>
              {printer.address && <Button variant="secondary" icon={PrinterIcon} onClick={() => thermalPrint((cfg) => buildTest(cfg, settings), showToast)} style={{ flex: 1 }}>Test print</Button>}
            </div>
          </>
        )}
      </div>
      {open && <PrinterSetupModal settings={settings} showToast={showToast} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ShopSettings({ settings, setSettings, showToast, branches, setBranches, onResetTransactions, onResetEverything, fullState, restoreAll, cloudOn }) {
  const [form, setForm] = useState(settings);
  const [confirmMode, setConfirmMode] = useState(null); // null | "figures" | "everything" | "restore"
  const [confirmText, setConfirmText] = useState("");
  const [restoreData, setRestoreData] = useState(null);
  const fileInputRef = useRef(null);

  const save = () => {
    if (!form.shopName.trim()) { showToast("Shop name is required.", "err"); return; }
    setSettings(form);
    showToast("Shop details saved. They'll appear on your next receipt.");
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
    saveAndShare(`ilayla-backup-${todayStr()}.json`, JSON.stringify(fullState, null, 2), "application/json")
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
        showToast("That doesn't look like a valid Ilelah Business Suite backup file.", "err");
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

  const confirmShell = (title, text, phrase, onGo, goLabel) => (
    <Modal onClose={closeConfirm} title={title}>
      <div style={{ background: colors.redSoft, color: colors.red, borderRadius: 12, padding: "10px 12px", fontSize: 13.5, lineHeight: 1.5, display: "flex", gap: 10, marginBottom: 14 }}>
        <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{text}</span>
      </div>
      <Field label={`Type "${phrase}" to confirm`}>
        <input style={styles.input} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={phrase} autoCapitalize="characters" autoCorrect="off" />
      </Field>
      <div className="sheet-actions">
        <Button variant="secondary" onClick={closeConfirm}>Cancel</Button>
        <Button variant="danger" icon={Trash2} disabled={confirmText !== phrase} onClick={onGo}>{goLabel}</Button>
      </div>
    </Modal>
  );

  return (
    <div style={styles.stack}>
      <div>
        <SectionHeader title="Shop details" />
        <div className="card">
          <div style={{ ...styles.emptyNote, paddingTop: 0, marginBottom: 12 }}>Used on receipts when a branch doesn't set its own address or phone.</div>
          <div style={styles.stack}>
            <Field label="Shop name">
              <input style={styles.input} value={form.shopName} onChange={(e) => setForm({ ...form, shopName: e.target.value })} placeholder="e.g. Almaruf Global Concept" />
            </Field>
            <Field label="Tagline">
              <input style={styles.input} value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="e.g. Wholesale and Retail of General Provision" />
            </Field>
            <Field label="Address">
              <input style={styles.input} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="e.g. Opposite specialist hospital, Bauchi Road" />
            </Field>
            <Field label="Phone number(s)">
              <input style={styles.input} inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 08169500844" />
            </Field>
            <Button full icon={Save} onClick={save}>Save shop details</Button>
          </div>
        </div>
      </div>

      <BranchManager
        branches={branches} setBranches={setBranches} showToast={showToast}
        products={fullState.products} sales={fullState.sales} purchases={fullState.purchases} expenses={fullState.expenses} users={fullState.users}
      />

      <PrinterPanel settings={settings} showToast={showToast} />

      <CloudPanel showToast={showToast} fullState={fullState} onBackup={() => saveAndShare(`ilayla-backup-${todayStr()}.json`, JSON.stringify(fullState, null, 2), "application/json").then(() => showToast("Backup ready.")).catch(() => { showToast("Could not save the backup.", "err"); throw new Error("backup"); })} />

      <div>
        <SectionHeader title="Backup and restore" />
        <div className="card">
          <div style={{ ...styles.emptyNote, paddingTop: 0 }}>
            {cloudOn
              ? "This phone is in Cloud mode: your records are also kept in your cloud account. A backup file is still a good safety copy. Restoring a backup file is switched off here so it cannot overwrite the cloud copy."
              : "Ilelah Business Suite runs fully offline, so all your data lives only on this phone. There is no cloud copy unless you switch to Cloud mode below. If the app's data is ever cleared, it is gone unless you have a backup. Save one regularly."}
          </div>
          <input ref={fileInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={onFilePicked} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            <Button full icon={DownloadIcon} onClick={downloadBackup}>Save / share backup</Button>
            {!cloudOn && <Button full variant="secondary" icon={UploadIcon} onClick={() => fileInputRef.current.click()}>Restore from backup</Button>}
          </div>
        </div>
      </div>

      {!cloudOn && <div>
        <SectionHeader title="Danger zone" />
        <List>
          <Row lead={<RefreshCw size={19} />} leadTone={{ background: colors.redSoft, color: colors.red }} onClick={() => setConfirmMode("figures")} chevron
            title="Reset figures" sub="Clear sales, purchases, expenses and payments. Products and stock stay." />
          <Row lead={<Trash2 size={19} />} leadTone={{ background: colors.redSoft, color: colors.red }} onClick={() => setConfirmMode("everything")} chevron
            title="Reset everything" sub="Delete all products, sales, customers and records." />
        </List>
      </div>}

      {confirmMode === "figures" && confirmShell(
        "Reset figures to zero?",
        "This permanently deletes all sales, purchase orders, expenses and credit payments. Your product list and current stock levels are not touched. This cannot be undone.",
        "RESET", doResetFigures, "Reset figures")}

      {confirmMode === "everything" && confirmShell(
        "Reset all shop data?",
        "This permanently deletes all products, sales, purchase orders, expenses, customers and credit payments. Staff accounts, branches and shop details are kept. This cannot be undone.",
        "DELETE", doResetEverything, "Delete everything")}

      {confirmMode === "restore" && restoreData && (
        <Modal onClose={closeConfirm} title="Restore this backup?">
          <div style={{ background: colors.amberSoft, color: colors.amber, borderRadius: 12, padding: "10px 12px", fontSize: 13.5, lineHeight: 1.5, display: "flex", gap: 10 }}>
            <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>This replaces your current shop data with the backup file you picked. Anything entered since that backup was made will be lost. This cannot be undone.</span>
          </div>
          <div className="sheet-actions">
            <Button variant="secondary" onClick={closeConfirm}>Cancel</Button>
            <Button variant="danger" icon={UploadIcon} onClick={doRestore}>Restore backup</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Seed default data BEFORE the first render so the admin account exists on a fresh install.
seedIfEmpty();
createRoot(document.getElementById("root")).render(<Root />);


