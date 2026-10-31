// Shared UI components for the whole app: one icon set, one set of building blocks.
import React, { useEffect, useRef } from "react";
import {
  Search, Plus, Pencil, X, ShoppingCart, Package, Truck, LayoutGrid, TriangleAlert as AlertTriangle, Check, ScanLine, Receipt,
  Users, LogOut, Lock, User as UserIcon, Settings as SettingsIcon, CreditCard as CreditIcon, Store as BranchIcon,
  Download as DownloadIcon, Upload as UploadIcon, Camera as CameraIcon, CalendarCheck as DayIcon, Ellipsis as MoreIcon,
  House, ChartColumn, Wallet, Printer as PrinterIcon, MessageCircle, MessageSquare, Star, ChevronRight, ChevronLeft, ArrowLeft,
  Eye, EyeOff, Trash2, Minus, ScanBarcode, Flashlight, Banknote, TrendingUp, TrendingDown, Boxes, FileSpreadsheet, ShieldCheck,
  Info, CircleCheck, CircleAlert, Phone, Calendar, ChevronDown, Tag, Clock, Inbox, PackageOpen, ArrowUpRight, ArrowDownRight,
  Bluetooth, KeyRound, Share2, Copy, RefreshCw, Save, Building2, UserPlus, HandCoins, ReceiptText, CalendarDays, CircleX,
  Pause, History, ListFilter, Layers, Image as ImageIcon, Zap, BadgeCheck, Smartphone, FileText, ShoppingBag, Wifi, Bell,
} from "lucide-react";
import { colors, CURRENCY } from "./theme.js";
import { styles } from "./styles.js";

export {
  Search, Plus, Pencil, X, ShoppingCart, Package, Truck, LayoutGrid, AlertTriangle, Check, ScanLine, Receipt,
  Users, LogOut, Lock, UserIcon, SettingsIcon, CreditIcon, BranchIcon, DownloadIcon, UploadIcon, CameraIcon, DayIcon, MoreIcon,
  House, ChartColumn, Wallet, PrinterIcon, MessageCircle, MessageSquare, Star, ChevronRight, ChevronLeft, ArrowLeft,
  Eye, EyeOff, Trash2, Minus, ScanBarcode, Flashlight, Banknote, TrendingUp, TrendingDown, Boxes, FileSpreadsheet, ShieldCheck,
  Info, CircleCheck, CircleAlert, Phone, Calendar, ChevronDown, Tag, Clock, Inbox, PackageOpen, ArrowUpRight, ArrowDownRight,
  Bluetooth, KeyRound, Share2, Copy, RefreshCw, Save, Building2, UserPlus, HandCoins, ReceiptText, CalendarDays, CircleX,
  Pause, History, ListFilter, Layers, ImageIcon, Zap, BadgeCheck, Smartphone, FileText, ShoppingBag, Wifi, Bell,
};

// ---------- Android back button support ----------
// Open sheets/dialogs register themselves; the native back button closes the top-most one first.
const backStack = [];
export function useBackClose(onClose) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const fn = () => ref.current && ref.current();
    backStack.push(fn);
    return () => { const i = backStack.lastIndexOf(fn); if (i >= 0) backStack.splice(i, 1); };
  }, []);
}
// Mount this while some inline panel is open so the Android back button closes it.
export function BackClose({ onClose }) { useBackClose(onClose); return null; }
export function handleBack() {
  const fn = backStack[backStack.length - 1];
  if (fn) { fn(); return true; }
  return false;
}

// ---------- small primitives ----------
const AVATAR_TONES = [
  ["#E4F4F1", "#0F766E"], ["#E8F0FE", "#2563EB"], ["#FEF3E0", "#B45309"], ["#F3E8FF", "#7E22CE"], ["#FDECEC", "#DC2626"], ["#E3F5E9", "#15803D"],
];
export function Avatar({ name = "?", size = 40 }) {
  const initials = String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATAR_TONES[h % AVATAR_TONES.length];
  return <span className="avatar" style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.38) }}>{initials}</span>;
}

export function Badge({ kind = "neutral", icon: Icon, children }) {
  return <span className={`badge badge-${kind}`}>{Icon ? <Icon size={12} strokeWidth={2.4} /> : null}{children}</span>;
}

export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />;
}

const BTN = { primary: styles.primaryBtn, secondary: styles.ghostBtn, danger: styles.dangerBtn };
export function Button({ variant = "primary", icon: Icon, loading, full, small, style, children, ...rest }) {
  const base = variant === "tonal"
    ? { ...styles.primaryBtn, background: colors.primarySoft, color: colors.primary, boxShadow: "none" }
    : variant === "whatsapp" ? styles.waBtnWide : BTN[variant] || styles.primaryBtn;
  return (
    <button type="button" {...rest} disabled={rest.disabled || loading}
      style={{ ...base, ...(full ? { width: "100%" } : null), ...(small ? { height: 36, padding: "0 12px", fontSize: 13.5, borderRadius: 10 } : null), ...style }}>
      {loading ? <Spinner size={16} /> : Icon ? <Icon size={small ? 15 : 18} strokeWidth={2.1} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, danger, onClick, size = 18, style, ...rest }) {
  return (
    <button type="button" className={danger ? "icon-btn icon-btn-danger" : "icon-btn"} aria-label={label} title={label} onClick={onClick} style={style} {...rest}>
      <Icon size={size} strokeWidth={2.1} />
    </button>
  );
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="switch-row">
      <span>{label}{hint ? <span style={{ display: "block", fontSize: 12.5, color: colors.inkSoft, fontWeight: 400, marginTop: 2 }}>{hint}</span> : null}</span>
      <input type="checkbox" role="switch" className="switch" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function Segmented({ value, onChange, options, scroll }) {
  return (
    <div className={"seg" + (scroll ? " seg-scroll" : "")} role="tablist">
      {options.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} className={value === id ? "on" : ""} onClick={() => onChange(id)}>{label}</button>
      ))}
    </div>
  );
}

export function Chips({ value, onChange, options }) {
  return (
    <div className="chips">
      {options.map(([id, label, count]) => (
        <button key={id} type="button" className={"chip" + (value === id ? " on" : "")} onClick={() => onChange(id)}>
          {label}{count !== undefined && count !== null ? <span style={{ opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>{count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function SectionHeader({ title, action, onAction, actionLabel }) {
  return (
    <div className="section-head">
      <h2 className="section-title">{title}</h2>
      {action || (onAction ? <button type="button" className="link-btn" onClick={onAction}>{actionLabel}<ChevronRight size={15} /></button> : null)}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, text, action }) {
  return (
    <div className="empty">
      <div className="empty-ic"><Icon size={28} strokeWidth={1.8} /></div>
      <div className="empty-title">{title}</div>
      {text ? <div className="empty-text">{text}</div> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

export function List({ children, style, wide }) { return <div className={"list" + (wide ? " list-wide" : "")} style={style}>{children}</div>; }

export function Row({ lead, leadTone, title, sub, value, valueSub, valueColor, onClick, chevron, children }) {
  const inner = (
    <>
      {lead ? <span className="row-lead" style={leadTone || null}>{lead}</span> : null}
      <span className="row-main">
        <div className="row-title">{title}</div>
        {sub ? <div className="row-sub">{sub}</div> : null}
      </span>
      {(value !== undefined || valueSub || children) ? (
        <span className="row-end">
          {value !== undefined ? <div className="row-value" style={valueColor ? { color: valueColor } : null}>{value}</div> : null}
          {valueSub ? <div className="row-sub" style={{ marginTop: 2 }}>{valueSub}</div> : null}
          {children}
        </span>
      ) : null}
      {chevron ? <ChevronRight size={18} color={colors.inkFaint} /> : null}
    </>
  );
  return onClick ? <button type="button" className="row" onClick={onClick}>{inner}</button> : <div className="row">{inner}</div>;
}

export function StatTile({ icon: Icon, tone = "primary", label, value, sub, onClick }) {
  const tones = { primary: [colors.primarySoft, colors.primary], amber: [colors.amberSoft, colors.amber], red: [colors.redSoft, colors.red], blue: [colors.blueSoft, colors.blue], green: [colors.greenSoft, colors.green], ink: [colors.surface2, colors.ink] };
  const [bg, fg] = tones[tone] || tones.primary;
  const body = (
    <>
      <span style={{ width: 36, height: 36, borderRadius: 11, background: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Icon size={19} strokeWidth={2} /></span>
      <div style={{ fontSize: 12.5, color: colors.inkSoft, fontWeight: 500, marginTop: 10 }}>{label}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 2, wordBreak: "break-word" }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: colors.inkSoft, marginTop: 2 }}>{sub}</div> : null}
    </>
  );
  const st = { ...styles.statCard, textAlign: "left", border: "none", display: "block", width: "100%", font: "inherit", color: "inherit" };
  return onClick ? <button type="button" onClick={onClick} style={st}>{body}</button> : <div style={st}>{body}</div>;
}

// ---------- form field ----------
export function Field({ label, children, span, hint }) {
  return (
    <label style={{ ...styles.field, gridColumn: span ? `span ${span}` : undefined }}>
      <span style={styles.fieldLabel}>{label}</span>
      {children}
      {hint ? <span style={{ fontSize: 12.5, color: colors.inkSoft }}>{hint}</span> : null}
    </label>
  );
}

// ---------- sheet / dialog ----------
// Bottom sheet on phones, centred dialog on larger screens. Same API as the old Modal.
export function Modal({ title, onClose, children }) {
  useBackClose(onClose);
  const ovRef = React.useRef(null);
  // Esc closes the window on top (PC keyboards)
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const all = document.querySelectorAll(".sheet-overlay");
      if (all.length && all[all.length - 1] !== ovRef.current) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sheet-overlay" ref={ovRef} onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <h2 className="sheet-title">{title}</h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Toast({ toast, onDismiss }) {
  if (!toast) return null;
  const err = toast.kind === "err";
  return (
    <div className={"toast " + (err ? "toast-err" : "toast-ok")} role="status" aria-live="polite" key={toast.id}>
      {err ? <CircleAlert className="toast-ic" size={18} /> : <CircleCheck className="toast-ic" size={18} />}
      <span>{toast.msg}</span>
      {toast.action && <button type="button" onClick={() => { try { toast.action.run(); } finally { onDismiss && onDismiss(); } }} style={{ marginLeft: 6, background: "rgba(255,255,255,0.16)", color: "#fff", border: "none", borderRadius: 9, padding: "4px 12px", fontWeight: 700, fontSize: 13.5 }}>{toast.action.label}</button>}
    </div>
  );
}

// A yes/no question in the app's own style (replaces the browser's confirm box).
export function ConfirmModal({ title, text, okLabel = "Yes", cancelLabel = "Cancel", danger, onYes, onNo }) {
  return (
    <Modal title={title} onClose={onNo}>
      {text && <p style={{ color: "var(--ink-soft)", lineHeight: 1.5, margin: "4px 0 0" }}>{text}</p>}
      <div className="sheet-actions">
        <Button variant="secondary" onClick={onNo}>{cancelLabel}</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onYes}>{okLabel}</Button>
      </div>
    </Modal>
  );
}

export { CURRENCY };
