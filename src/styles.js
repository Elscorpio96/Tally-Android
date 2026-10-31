// Global CSS + shared inline style objects (themed from ./theme.js).
import { colors, lightColors, darkColors, shadow, FONT } from "./theme.js";
const kebab = (k) => k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
const varsOf = (pal) => Object.entries(pal).filter(([k]) => !["panel", "teal", "tealSoft"].includes(k)).map(([k, v]) => `--${kebab(k)}: ${v};`).join(" ");
const DARK_EXTRA = "--on-primary: #04201C; --shadow-sm: 0 1px 2px rgba(0,0,0,0.4); --shadow-md: 0 1px 3px rgba(0,0,0,0.45), 0 4px 14px rgba(0,0,0,0.35); --shadow-lg: 0 18px 44px rgba(0,0,0,0.6);";

export const globalCss = `
  :root {
    --bg: ${lightColors.bg}; --surface: ${lightColors.surface}; --surface2: ${lightColors.surface2};
    --ink: ${lightColors.ink}; --ink-soft: ${lightColors.inkSoft}; --ink-faint: ${lightColors.inkFaint};
    --line: ${lightColors.line}; --line-strong: ${lightColors.lineStrong};
    --primary: ${lightColors.primary}; --primary-dark: ${lightColors.primaryDark}; --primary-soft: ${lightColors.primarySoft};
    --red: ${lightColors.red}; --red-soft: ${lightColors.redSoft}; --amber: ${lightColors.amber}; --amber-soft: ${lightColors.amberSoft};
    --green: ${lightColors.green}; --green-soft: ${lightColors.greenSoft}; --blue: ${lightColors.blue}; --blue-soft: ${lightColors.blueSoft}; --whatsapp: ${lightColors.whatsapp}; --whatsapp-soft: ${lightColors.whatsappSoft};;
    --shadow-sm: ${shadow.sm}; --shadow-md: ${shadow.md}; --shadow-lg: ${shadow.lg};
    --sat: max(env(safe-area-inset-top, 0px), var(--safe-area-inset-top, 0px));
    --sab: max(env(safe-area-inset-bottom, 0px), var(--safe-area-inset-bottom, 0px));
    --nav-h: 70px;
    --on-primary: #FFFFFF;
  }
  html[data-theme="dark"] { color-scheme: dark; ${varsOf(darkColors)} ${DARK_EXTRA} }
  @media (prefers-color-scheme: dark) { html[data-theme="system"] { color-scheme: dark; ${varsOf(darkColors)} ${DARK_EXTRA} } }
  .force-light { ${varsOf(lightColors)} --on-primary: #FFFFFF; color: var(--ink); }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  html, body { margin: 0; background: var(--bg); color: var(--ink); -webkit-tap-highlight-color: transparent; overscroll-behavior: none; }
  body { font-family: ${FONT}; font-size: 15px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
  h1, h2, h3, p { margin: 0; }
  button { font-family: inherit; cursor: pointer; touch-action: manipulation; transition: transform .1s ease, background-color .15s ease, opacity .15s ease, box-shadow .15s ease, border-color .15s ease; }
  button:active:not(:disabled) { transform: scale(0.97); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  input, select, textarea { font-family: inherit; color: var(--ink); }
  input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea { background-color: var(--surface); }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--primary) !important; box-shadow: 0 0 0 3px rgba(15,118,110,0.16); }
  ::placeholder { color: var(--ink-faint); }
  select { appearance: none; -webkit-appearance: none; background-color: var(--surface); background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%235B6678' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>"); background-repeat: no-repeat; background-position: right 12px center; background-size: 16px; padding-right: 36px !important; }
  textarea { resize: vertical; }
  input[type=number] { -moz-appearance: textfield; }
  .num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { transform: translateY(32px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes toastIn { from { transform: translate(-50%, 14px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes rise { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }

  /* ---------- app bar ---------- */
  .appbar { position: sticky; top: 0; z-index: 20; background: var(--surface); background: color-mix(in srgb, var(--surface) 94%, transparent); -webkit-backdrop-filter: saturate(1.4) blur(10px); backdrop-filter: saturate(1.4) blur(10px); border-bottom: 1px solid var(--line); padding: calc(var(--sat) + 10px) 16px 10px; display: flex; align-items: center; gap: 12px; }
  .appbar-brand { display: none; align-items: center; gap: 10px; flex-shrink: 0; }
  .appbar-titles { flex: 1; min-width: 0; }
  .appbar-title { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .appbar-sub { font-size: 12.5px; color: var(--ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
  .appbar-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: auto; }
  .avatar-btn { width: 40px; height: 40px; border-radius: 50%; border: none; background: var(--primary-soft); color: var(--primary); font-weight: 700; font-size: 15px; display: flex; align-items: center; justify-content: center; }
  .branch-chip { display: inline-flex; align-items: center; gap: 6px; background: var(--surface2); border: none; border-radius: 999px; padding: 0 10px 0 12px; height: 36px; font-size: 13px; font-weight: 600; color: var(--ink); max-width: 150px; }
  .branch-chip select { border: none !important; background-color: transparent; background-image: none; padding: 0 !important; font-size: 13px; font-weight: 600; color: var(--ink); outline: none; min-width: 0; max-width: 110px; box-shadow: none !important; }
  .tb-nav { display: none; }
  .page { max-width: 980px; margin: 0 auto; padding: 16px 16px 40px; animation: rise .22s ease; }
  .bottom-nav { display: none; }

  /* ---------- sheets & dialogs ---------- */
  .sheet-overlay { position: fixed; inset: 0; z-index: 50; background: rgba(15,23,42,0.5); display: flex; align-items: flex-end; justify-content: center; animation: fadeIn .18s ease; }
  .sheet { background: var(--surface); width: 100%; max-height: calc(100dvh - var(--sat) - 16px); display: flex; flex-direction: column; border-radius: 24px 24px 0 0; box-shadow: var(--shadow-lg); animation: slideUp .26s cubic-bezier(.2,.8,.2,1); }
  .sheet-grab { width: 40px; height: 4px; border-radius: 2px; background: var(--line-strong); margin: 8px auto 0; flex-shrink: 0; }
  .sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px 6px; flex-shrink: 0; }
  .sheet-title { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
  .sheet-body { overflow-y: auto; padding: 8px 20px 0; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
  .sheet-body:not(:has(.sheet-actions))::after { content: ""; display: block; height: calc(var(--sab) + 20px); }
  .sheet-actions { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; position: sticky; bottom: 0; background: var(--surface); padding: 14px 0 calc(var(--sab) + 16px); margin-top: 8px; z-index: 2; }
  .sheet-actions > button { flex: 1 1 120px; justify-content: center; }
  .icon-btn { width: 36px; height: 36px; border-radius: 10px; border: none; background: var(--surface2); color: var(--ink); display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .icon-btn-danger { background: var(--red-soft); color: var(--red); }

  /* ---------- toast ---------- */
  .toast { position: fixed; left: 50%; bottom: calc(var(--sab) + 24px); transform: translateX(-50%); z-index: 80; width: max-content; max-width: min(92vw, 440px); background: #0F172A; color: #fff; border: 1px solid rgba(255,255,255,0.12); padding: 12px 16px; border-radius: 14px; display: flex; align-items: flex-start; gap: 10px; font-size: 14px; font-weight: 500; line-height: 1.35; box-shadow: var(--shadow-lg); animation: toastIn .24s cubic-bezier(.2,.8,.2,1); }
  .toast-ic { flex-shrink: 0; margin-top: 1px; }
  .toast-ok .toast-ic { color: #4ADE80; } .toast-err .toast-ic { color: #FCA5A5; }

  /* ---------- building blocks ---------- */
  .card { background: var(--surface); border-radius: 16px; box-shadow: 0 0 0 1px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.04); padding: 16px; }
  .section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 2px 2px 10px; }
  .section-title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
  .link-btn { background: none; border: none; color: var(--primary); font-weight: 600; font-size: 13.5px; padding: 6px 2px; display: inline-flex; align-items: center; gap: 2px; }
  .list { background: var(--surface); border-radius: 16px; box-shadow: 0 0 0 1px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.04); overflow: hidden; }
  .list > *:not(:first-child) { border-top: 1px solid var(--line); }
  .row { display: flex; align-items: center; gap: 12px; padding: 12px 16px; min-height: 60px; width: 100%; background: none; border: none; text-align: left; color: inherit; font-size: inherit; }
  button.row:active { background: var(--surface2); transform: none; }
  .row-main { flex: 1; min-width: 0; }
  .row-title { font-size: 15px; font-weight: 600; line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }
  .row-sub { font-size: 12.5px; color: var(--ink-soft); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-end { text-align: right; flex-shrink: 0; }
  .row-value { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .row-lead { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: var(--primary-soft); color: var(--primary); }
  .row-split { display: flex; align-items: stretch; }
  .row-split > .row { flex: 1; min-width: 0; }
  .star-btn { width: 50px; flex-shrink: 0; border: none; background: none; color: var(--ink-faint); display: flex; align-items: center; justify-content: center; }
  .star-btn.on { color: #F59E0B; }
  .badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600; padding: 3px 9px; border-radius: 999px; line-height: 1.3; white-space: nowrap; }
  .badge-ok { background: var(--green-soft); color: var(--green); } .badge-warn { background: var(--amber-soft); color: var(--amber); }
  .badge-danger { background: var(--red-soft); color: var(--red); } .badge-neutral { background: var(--surface2); color: var(--ink-soft); }
  .badge-primary { background: var(--primary-soft); color: var(--primary); }
  .chips { display: flex; gap: 8px; overflow-x: auto; padding: 2px 0 4px; scrollbar-width: none; margin: 0 -16px; padding-left: 16px; padding-right: 16px; }
  .chips::-webkit-scrollbar { display: none; }
  .chip { flex-shrink: 0; height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--ink-soft); font-size: 13.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
  .chip.on { background: var(--ink); border-color: var(--ink); color: var(--bg); }
  .seg { display: flex; background: var(--surface2); border-radius: 12px; padding: 4px; gap: 4px; }
  .seg button { flex: 1; border: none; background: transparent; border-radius: 9px; padding: 9px 10px; font-size: 13.5px; font-weight: 600; color: var(--ink-soft); white-space: nowrap; }
  .seg button.on { background: var(--surface); color: var(--ink); box-shadow: var(--shadow-sm); }
  .seg-scroll { overflow-x: auto; scrollbar-width: none; } .seg-scroll::-webkit-scrollbar { display: none; } .seg-scroll button { flex: 0 0 auto; }
  .avatar { border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
  .empty { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 36px 24px; gap: 6px; }
  .empty-ic { width: 60px; height: 60px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
  .empty-title { font-size: 16px; font-weight: 700; } .empty-text { font-size: 14px; color: var(--ink-soft); max-width: 320px; line-height: 1.5; }
  .spinner { width: 18px; height: 18px; border: 2.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; display: inline-block; flex-shrink: 0; }
  .switch-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 8px 0; font-size: 14.5px; font-weight: 500; line-height: 1.35; }
  .switch { appearance: none; -webkit-appearance: none; width: 48px; height: 28px; border-radius: 14px; background: var(--line-strong); position: relative; flex-shrink: 0; transition: background-color .2s; border: none; outline: none; margin: 0; cursor: pointer; }
  .switch::after { content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .2s; }
  .switch:checked { background: var(--primary); } .switch:checked::after { transform: translateX(20px); }
  .input-row { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line-strong); border-radius: 12px; padding: 0 14px; height: 48px; background: var(--surface); color: var(--ink-soft); transition: border-color .15s, box-shadow .15s; }
  .input-row:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(15,118,110,0.16); }
  .input-row input { border: none !important; outline: none; box-shadow: none !important; flex: 1; min-width: 0; height: 100%; background: transparent; font-size: 15px; padding: 0 !important; }

  /* ---------- More sheet ---------- */
  .more-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding-bottom: 8px; }
  .more-item { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px 6px 12px; border-radius: 16px; background: var(--surface2); border: none; font-size: 13px; font-weight: 600; color: var(--ink); }
  .more-item .mi-ic { width: 46px; height: 46px; border-radius: 14px; background: var(--surface); display: flex; align-items: center; justify-content: center; color: var(--primary); box-shadow: var(--shadow-sm); }
  .more-active { background: var(--primary-soft); color: var(--primary); }

  /* ---------- dashboard ---------- */
  .hero { background: var(--primary); color: var(--on-primary); border-radius: 22px; padding: 20px 20px 18px; position: relative; overflow: hidden; box-shadow: 0 8px 22px rgba(15,118,110,0.28); }
  .hero::before { content: ""; position: absolute; right: -50px; top: -60px; width: 190px; height: 190px; border-radius: 50%; background: rgba(255,255,255,0.09); }
  .hero::after { content: ""; position: absolute; right: 40px; bottom: -70px; width: 130px; height: 130px; border-radius: 50%; background: rgba(255,255,255,0.06); }
  .hero > * { position: relative; z-index: 1; }
  .hero-label { font-size: 13.5px; opacity: 0.88; font-weight: 500; }
  .hero-amount { font-size: 38px; font-weight: 700; letter-spacing: -0.035em; margin-top: 2px; font-variant-numeric: tabular-nums; line-height: 1.15; }
  .hero-row { display: flex; gap: 10px; margin-top: 16px; }
  .hero-pill { flex: 1; min-width: 0; background: rgba(255,255,255,0.14); border-radius: 14px; padding: 10px 12px; }
  .hero-pill .k { font-size: 12px; opacity: 0.88; }
  .hero-pill .v { font-size: 16px; font-weight: 700; margin-top: 2px; letter-spacing: -0.01em; }
  .qa-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .qa { display: flex; flex-direction: column; align-items: center; gap: 8px; background: var(--surface); border: none; border-radius: 16px; padding: 14px 4px 12px; box-shadow: 0 0 0 1px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.04); font-size: 12.5px; font-weight: 600; color: var(--ink); line-height: 1.2; text-align: center; }
  .qa-ic { width: 46px; height: 46px; border-radius: 15px; display: flex; align-items: center; justify-content: center; }
  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .dash-cols { display: grid; grid-template-columns: 1fr; gap: 16px; }
  @media (min-width: 900px) { .dash-cols { grid-template-columns: 1fr 1fr; align-items: start; } .stat-grid { grid-template-columns: repeat(4, 1fr); } }

  /* ---------- checkout ---------- */
  .co { display: grid; grid-template-columns: 1fr; gap: 16px; }
  .co-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .co-cart-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .co-cart-close { display: none; }
  .cart-bar { display: none; }
  .cart-lines { display: flex; flex-direction: column; margin-top: 8px; }
  .cart-line { display: flex; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--line); }
  .cart-line:last-child { border-bottom: none; }
  .cart-line-name { font-size: 14.5px; font-weight: 600; line-height: 1.3; }
  .cart-line-sub { font-size: 12.5px; color: var(--ink-soft); margin-top: 2px; }
  .stepper { display: inline-flex; align-items: center; background: var(--surface2); border-radius: 12px; }
  .stepper button { width: 38px; height: 36px; border: none; background: transparent; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: var(--ink); }
  .stepper span { min-width: 30px; text-align: center; font-weight: 700; font-size: 15px; }
  .stepper input { width: 52px; height: 36px; border: none !important; background: transparent; text-align: center; font-weight: 700; font-size: 16px; padding: 0 !important; box-shadow: none !important; -moz-appearance: textfield; }
  .stepper input::-webkit-outer-spin-button, .stepper input::-webkit-inner-spin-button, .cart-line-sub input::-webkit-outer-spin-button, .cart-line-sub input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .co-cta { position: sticky; bottom: 0; background: var(--surface); padding: 12px 0 calc(var(--sab) + 16px); margin-top: 10px; z-index: 2; }
  .cart-total { margin-top: 6px; padding-top: 14px; border-top: 1px dashed var(--line-strong); }

  /* ---------- desktop / tablet ---------- */
  @media (min-width: 761px) {
    .appbar { padding: 10px 24px; }
    .appbar-brand { display: flex; }
    .appbar-titles { display: none; }
    .tb-nav { display: flex; gap: 4px; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; padding: 2px; }
    .tb-nav::-webkit-scrollbar { display: none; }
    .tn-btn { display: inline-flex; align-items: center; gap: 7px; padding: 0 14px; height: 38px; border-radius: 999px; border: none; background: transparent; color: var(--ink-soft); font-size: 13.5px; font-weight: 600; white-space: nowrap; position: relative; flex-shrink: 0; }
    .tn-btn:hover { background: var(--surface2); }
    .tn-active, .tn-active:hover { background: var(--primary-soft); color: var(--primary); }
    .tn-badge { background: var(--red); color: #fff; font-size: 10.5px; font-weight: 700; border-radius: 9px; padding: 0 6px; min-width: 18px; height: 18px; line-height: 18px; text-align: center; }
    .page { padding: 24px 24px 56px; }
    .sheet-overlay { align-items: center; padding: 24px; }
    .sheet { max-width: 520px; border-radius: 22px; max-height: calc(100dvh - 48px); }
    .sheet-grab { display: none; }
    .co { grid-template-columns: 1.15fr 0.95fr; align-items: start; }
    .co-cart { position: sticky; top: 84px; background: var(--surface); border-radius: 18px; padding: 18px 18px 0; box-shadow: var(--shadow-md); max-height: calc(100dvh - 110px); overflow-y: auto; }
    .co-cart .sheet-grab { display: none; }
    .cart-bar-count { display: none; }
  }

  /* ---------- phones ---------- */
  @media (max-width: 760px) {
    .page { padding-bottom: calc(var(--nav-h) + var(--sab) + 28px); }
    .bottom-nav { display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; background: var(--surface); border-top: 1px solid var(--line); padding: 6px 8px calc(var(--sab) + 6px); gap: 2px; }
    .bn-btn { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; background: none; border: none; color: var(--ink-soft); font-size: 11px; font-weight: 600; padding: 3px 0 2px; position: relative; }
    .bn-ic { width: 58px; height: 30px; border-radius: 15px; display: flex; align-items: center; justify-content: center; transition: background-color .2s; }
    .bn-active { color: var(--primary); } .bn-active .bn-ic { background: var(--primary-soft); }
    .bn-badge { position: absolute; top: -1px; left: calc(50% + 6px); background: var(--red); color: #fff; font-size: 10px; font-weight: 700; border-radius: 9px; padding: 0 5px; min-width: 17px; height: 17px; line-height: 13px; text-align: center; border: 2px solid var(--surface); }
    body.kbd .bottom-nav { display: none; }
    .toast { bottom: calc(var(--sab) + var(--nav-h) + 14px); }
    body.kbd .toast { bottom: 16px; }
    .co-cart { position: fixed; left: 0; right: 0; bottom: 0; z-index: 45; background: var(--surface); border-radius: 24px 24px 0 0; max-height: calc(100dvh - var(--sat) - 12px); overflow-y: auto; padding: 0 18px 0; transform: translateY(105%); visibility: hidden; transition: transform .3s cubic-bezier(.2,.8,.2,1), visibility 0s linear .3s; box-shadow: var(--shadow-lg); -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
    .co-cart.open { transform: translateY(0); visibility: visible; transition: transform .3s cubic-bezier(.2,.8,.2,1); }
    .co-cart-close { display: inline-flex; }
    .co-backdrop { position: fixed; inset: 0; z-index: 44; background: rgba(15,23,42,0.5); animation: fadeIn .18s ease; }
    .cart-bar { display: flex; position: fixed; left: 12px; right: 12px; bottom: calc(var(--nav-h) + var(--sab) + 10px); z-index: 25; background: var(--ink); color: var(--bg); border: none; border-radius: 18px; padding: 10px 14px 10px 10px; align-items: center; justify-content: space-between; gap: 10px; box-shadow: var(--shadow-lg); animation: rise .2s ease; }
    .cart-bar-count { width: 38px; height: 38px; border-radius: 12px; background: var(--primary); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; flex-shrink: 0; }
    body.kbd .cart-bar { bottom: 12px; }
    .co { padding-bottom: 76px; }
    /* screens not yet moved to the new layout classes */
    [style*="grid-template-columns: 1.3fr 1fr"], [style*="grid-template-columns: 1.2fr 0.9fr"] { grid-template-columns: 1fr !important; }
    [style*="repeat(4, 1fr)"], [style*="repeat(3, 1fr)"] { grid-template-columns: 1fr 1fr !important; }
    [style*="position: sticky"][style*="top: 90px"] { position: static !important; }
  }

  /* ---------- big screens (Windows PC / laptop): sidebar + top bar ---------- */
  @media (min-width: 1024px) {
    :root { --side-w: 256px; --top-h: 76px; }
    .appbar { position: fixed; left: 0; top: 0; bottom: 0; width: var(--side-w); flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 6px; padding: 20px 14px 14px; border-bottom: none; border-right: 1px solid var(--line); background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; z-index: 40; overflow: hidden; }
    .appbar-brand { padding: 0 6px 16px; border-bottom: 1px solid var(--line); margin-bottom: 8px; }
    .appbar-titles { display: block; position: fixed; left: var(--side-w); right: 0; top: 0; height: var(--top-h); padding: 15px 36px 0; background: var(--bg); border-bottom: 1px solid var(--line); z-index: 35; box-sizing: border-box; }
    .appbar-title { font-size: 24px; }
    .appbar-sub { font-size: 13.5px; }
    .appbar-actions { position: fixed; right: 28px; top: 18px; z-index: 41; margin: 0; }
    .tb-nav { flex-direction: column; flex: 1; gap: 3px; overflow-y: auto; padding: 0; }
    .tn-btn { width: 100%; height: 46px; padding: 0 14px; font-size: 15px; border-radius: 12px; justify-content: flex-start; gap: 12px; }
    .tn-btn svg { flex-shrink: 0; }
    .tn-active, .tn-active:hover { background: var(--primary); color: var(--on-primary, #fff); }
    .tn-badge { margin-left: auto; }
    .tn-key { margin-left: auto; font: 600 10.5px/1 var(--font, inherit); opacity: .0; border: 1px solid currentColor; border-radius: 5px; padding: 3px 5px; }
    .tn-btn:hover .tn-key { opacity: .55; } .tn-active .tn-key { opacity: .5; }
    .tn-btn .tn-badge + .tn-key { margin-left: 6px; }
    .side-foot { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; border-top: 1px solid var(--line); }
    .side-foot button { display: flex; align-items: center; gap: 10px; width: 100%; border: none; background: var(--surface2); color: var(--ink-soft); border-radius: 12px; height: 40px; padding: 0 12px; font-size: 13px; font-weight: 600; }
    .side-foot button:hover { color: var(--ink); }
    .side-foot .ver { font-size: 11.5px; color: var(--ink-soft); text-align: center; opacity: .8; }
    .page { margin: 0 0 0 var(--side-w); max-width: none; padding: calc(var(--top-h) + 26px) 36px 60px; }
    .page > * { max-width: 1320px; margin-left: auto; margin-right: auto; }
    .co-cart { top: calc(var(--top-h) + 20px); max-height: calc(100dvh - var(--top-h) - 40px); }
    .co { grid-template-columns: minmax(0, 1.5fr) minmax(360px, 0.9fr); gap: 24px; }
    .toast { left: calc(50% + var(--side-w) / 2); }
    .list > button.row:hover, .list > .row:hover { background: var(--surface2); cursor: pointer; }
    .qa-grid { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
    .qa:hover { box-shadow: 0 0 0 1px var(--primary), 0 4px 14px rgba(15,23,42,.08); }
    .card { padding: 20px; }
    .stat-grid { gap: 16px; } .dash-cols { gap: 24px; }
    button, .row { cursor: pointer; }
    .co-grab { display: none !important; }
    .dash-root { display: grid !important; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
    .dash-root > * { grid-column: 1 / -1; }
    .dash-root > .hero { grid-column: 1; height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 28px; }
    .dash-root > .hero + div { grid-column: 2; }
    .hero-amount { font-size: 44px; }
    .kbd-grid { display: grid; grid-template-columns: auto 1fr; gap: 10px 16px; align-items: center; font-size: 14px; }
    .kbd-grid kbd { background: var(--surface2); border: 1px solid var(--line-strong); border-bottom-width: 2px; border-radius: 7px; padding: 3px 8px; font: 700 12.5px/1.2 inherit; justify-self: start; }
  }
  @media (min-width: 1180px) {
    .list-wide { display: grid; grid-template-columns: 1fr 1fr; }
    .list-wide > * { border-top: 1px solid var(--line) !important; }
    .list-wide > *:nth-child(-n+2) { border-top: none !important; }
    .list-wide > *:nth-child(odd) { border-right: 1px solid var(--line); }
  }
  @media (min-width: 1024px) and (max-width: 1180px) { .appbar { --side-w: 220px; } :root { --side-w: 220px; } .page { padding-left: 24px; padding-right: 24px; } .appbar-titles { padding-left: 24px; } }
  @media (max-width: 1023px) { .side-foot, .tn-key { display: none; } }

  @media print {
    .sheet-overlay, .sheet, .sheet-body { position: static !important; display: block !important; overflow: visible !important; max-height: none !important; background: none !important; animation: none !important; transform: none !important; box-shadow: none !important; padding: 0 !important; }
    .appbar, .bottom-nav, .toast { display: none !important; }
    body * { visibility: hidden; }
    #printable-receipt, #printable-receipt * { visibility: visible; }
    #printable-receipt { position: absolute; top: 0; left: 0; width: 72mm; max-width: 72mm; padding: 4mm !important; font-size: 11px; }
  }
`;

const C = colors;
const ring = "0 0 0 1px rgba(15,23,42,0.05), 0 1px 2px rgba(15,23,42,0.04)";
const btnBase = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, height: 44, padding: "0 18px", borderRadius: 12, fontWeight: 600, fontSize: 14.5, border: "none", whiteSpace: "nowrap", lineHeight: 1 };

export const styles = {
  app: { minHeight: "100dvh", background: C.bg, fontFamily: FONT, color: C.ink },
  main: { maxWidth: 980, margin: "0 auto", padding: "16px" },
  loading: { padding: 60, textAlign: "center", color: C.inkSoft },

  // ----- login / activation
  loginWrap: { minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "calc(var(--sat) + 24px) 20px calc(var(--sab) + 24px)", background: C.bg },
  loginCard: { background: C.surface, borderRadius: 24, padding: "30px 24px 26px", width: "100%", maxWidth: 400, boxShadow: shadow.md, animation: "rise .3s ease" },
  loginBrandRow: { display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginBottom: 22, textAlign: "center" },
  loginHeading: { fontWeight: 700, fontSize: 21, marginBottom: 14, letterSpacing: "-0.02em", textAlign: "center" },
  loginError: { background: C.redSoft, color: C.red, fontSize: 13.5, padding: "10px 12px", borderRadius: 10, fontWeight: 500, lineHeight: 1.45 },
  loginHint: { marginTop: 18, fontSize: 12.5, color: C.inkSoft, textAlign: "center", lineHeight: 1.6 },

  // ----- brand
  brand: { display: "flex", alignItems: "center", gap: 10 },
  brandMark: { width: 44, height: 44, borderRadius: 14, background: "#081A42", objectFit: "cover", display: "block", flexShrink: 0 },
  brandName: { fontWeight: 700, fontSize: 18, lineHeight: 1.15, letterSpacing: "-0.02em" },
  brandSub: { fontSize: 12.5, color: C.inkSoft, marginTop: 2 },

  // ----- layout helpers
  stack: { display: "flex", flexDirection: "column", gap: 16 },
  stack8: { display: "flex", flexDirection: "column", gap: 10 },
  gridTwo: { display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 },
  cardsRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 },
  cardsRow3: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 },

  // ----- cards / text
  statCard: { background: C.surface, borderRadius: 16, padding: "14px 16px", boxShadow: ring },
  statAccent: { display: "none" },
  statLabel: { fontSize: 12.5, color: C.inkSoft, marginBottom: 4, fontWeight: 500 },
  statValue: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" },
  panel: { background: C.surface, borderRadius: 16, padding: 16, boxShadow: ring },
  panelTitle: { fontWeight: 700, fontSize: 15, marginBottom: 12, letterSpacing: "-0.01em" },
  emptyNote: { color: C.inkSoft, fontSize: 13.5, lineHeight: 1.5, padding: "4px 0" },
  bigNumber: { fontSize: 30, fontWeight: 700, margin: "4px 0", letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" },
  mono: { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum"' },

  lowStockRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: C.amberSoft, borderRadius: 12 },
  lowStockName: { fontWeight: 600, fontSize: 14 },
  lowStockSku: { fontSize: 12, color: C.inkSoft },
  lowStockQty: { fontWeight: 700, color: C.amber, fontSize: 13.5, fontVariantNumeric: "tabular-nums" },
  rankRow: { display: "flex", alignItems: "center", gap: 10, fontSize: 14, padding: "8px 0" },
  rankNum: { color: C.inkFaint, fontSize: 12.5, fontWeight: 700, width: 22, fontVariantNumeric: "tabular-nums" },
  rankQty: { color: C.inkSoft, fontSize: 13, fontVariantNumeric: "tabular-nums" },

  // ----- toolbars / inputs
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  searchBox: { display: "flex", alignItems: "center", gap: 10, background: C.surface, borderRadius: 14, padding: "0 6px 0 14px", height: 48, flex: "1 1 auto", flexShrink: 0, boxShadow: ring, color: C.inkSoft },
  searchInput: { border: "none", outline: "none", flex: 1, fontSize: 15, background: "transparent", minWidth: 0, height: "100%" },
  scanBox: { display: "flex", alignItems: "center", gap: 10, background: C.surface, borderRadius: 14, padding: "0 6px 0 14px", height: 52, flexShrink: 0, position: "relative", boxShadow: ring, color: C.inkSoft },
  camBtn: { background: C.primarySoft, color: C.primary, border: "none", borderRadius: 11, width: 40, height: 40, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  scanCamBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: C.primary, color: "var(--on-primary)", border: "none", borderRadius: 11, height: 40, padding: "0 14px", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", flexShrink: 0 },
  tileBadge: { position: "absolute", top: 8, right: 8, background: C.primary, color: "var(--on-primary)", borderRadius: 10, fontSize: 11.5, fontWeight: 700, padding: "1px 8px" },
  warnNote: { background: C.redSoft, color: C.red, borderRadius: 12, padding: "10px 12px", fontSize: 13.5, fontWeight: 500, lineHeight: 1.45 },
  changeDue: { background: C.greenSoft, color: C.green, borderRadius: 12, padding: "10px 12px", fontSize: 14, fontWeight: 600 },
  waBtn: { background: C.whatsappSoft, color: C.whatsapp, border: "none", borderRadius: 12, width: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  waBtnWide: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, height: 44, padding: "0 18px", borderRadius: 12, fontWeight: 600, fontSize: 14.5, border: "none", whiteSpace: "nowrap", lineHeight: 1, background: C.whatsapp, color: "#fff" },
  segRow: { display: "flex", gap: 4, overflowX: "auto", padding: 4, background: C.surface2, borderRadius: 12, scrollbarWidth: "none" },
  segBtn: { background: "transparent", border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 13.5, fontWeight: 600, color: C.inkSoft, whiteSpace: "nowrap", flexShrink: 0 },
  segBtnActive: { background: C.surface, color: C.ink, boxShadow: shadow.sm },
  scanFlash: { display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: C.primary, whiteSpace: "nowrap" },

  // ----- buttons
  primaryBtn: { ...btnBase, background: C.primary, color: "var(--on-primary)", boxShadow: "0 1px 2px rgba(15,118,110,0.35)" },
  dangerBtn: { ...btnBase, background: C.red, color: "#fff" },
  ghostBtn: { ...btnBase, background: C.surface, color: C.ink, boxShadow: `inset 0 0 0 1px ${C.lineStrong}` },
  iconBtn: { background: C.surface2, border: "none", borderRadius: 10, width: 36, height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", color: C.ink, flexShrink: 0 },
  iconBtnDanger: { background: C.redSoft, border: "none", borderRadius: 10, width: 36, height: 36, display: "inline-flex", alignItems: "center", justifyContent: "center", color: C.red, flexShrink: 0 },

  // ----- tables (legacy; replaced by lists screen by screen)
  tableHead: { minWidth: 560, display: "flex", padding: "0 4px 10px", borderBottom: `1px solid ${C.line}`, fontSize: 11.5, color: C.inkSoft, fontWeight: 600 },
  tableRow: { minWidth: 560, display: "flex", alignItems: "center", padding: "12px 4px", borderBottom: `1px solid ${C.line}`, fontSize: 13.5 },

  // ----- forms
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 },
  formGrid2: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: 600, color: C.inkSoft },
  input: { border: `1px solid ${C.lineStrong}`, borderRadius: 12, padding: "0 14px", fontSize: 15, width: "100%", height: 46, background: C.surface, minWidth: 0 },

  modalOverlay: {}, modal: {}, modalHead: {}, modalTitle: {},
  modalActions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8, flexWrap: "wrap" },

  // ----- checkout
  checkoutGrid: { display: "grid", gridTemplateColumns: "1.2fr 0.9fr", gap: 18, alignItems: "start" },
  resultRow: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${C.line}`, padding: "12px 4px", fontSize: 14.5, textAlign: "left" },
  quickGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 },
  quickTile: { textAlign: "left", background: C.surface, border: "none", boxShadow: ring, borderRadius: 14, padding: "12px 12px 10px", minHeight: 88, display: "flex", flexDirection: "column" },

  receipt: { background: C.surface, borderRadius: 16, padding: 18, position: "sticky", top: 84, boxShadow: shadow.md },
  receiptTitle: { fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" },
  receiptDivider: { borderTop: `1px dashed ${C.lineStrong}`, margin: "12px 0" },
  receiptLines: { display: "flex", flexDirection: "column", gap: 14 },
  receiptLine: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" },
  receiptItemName: { fontSize: 14, fontWeight: 600 },
  qtyControls: { display: "flex", alignItems: "center", gap: 10, marginTop: 6 },
  qtyBtn: { width: 30, height: 30, borderRadius: 9, border: "none", background: C.surface2, fontSize: 16, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", color: C.ink },
  removeLink: { background: "none", border: "none", color: C.inkSoft, fontSize: 12.5, textDecoration: "underline", padding: "4px 0" },
  receiptTotalRow: { display: "flex", justifyContent: "space-between", fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" },
  receiptSubRow: { display: "flex", justifyContent: "space-between", fontSize: 13, color: C.inkSoft, marginTop: 6 },
  checkoutBtn: { ...btnBase, width: "100%", height: 52, marginTop: 16, background: C.primary, color: "var(--on-primary)", fontSize: 16, fontWeight: 700, borderRadius: 14, boxShadow: "0 2px 6px rgba(15,118,110,0.35)" },
  checkoutFields: { display: "flex", flexDirection: "column", gap: 10, marginTop: 12 },
  paymentToggleRow: { display: "flex", gap: 4, marginTop: 14, background: C.surface2, borderRadius: 12, padding: 4 },
  paymentToggleBtn: { flex: 1, height: 40, borderRadius: 9, border: "none", background: "transparent", fontWeight: 600, fontSize: 14, color: C.inkSoft },
  paymentToggleBtnActive: { background: C.surface, color: C.ink, boxShadow: shadow.sm },
  paymentToggleBtnActiveCredit: { background: C.surface, color: C.red, boxShadow: shadow.sm },

  // ----- invoice (on-screen copy of the printed receipt)
  receiptPrintArea: { background: "#fff", color: "#0F172A", border: `1px dashed ${C.lineStrong}`, borderRadius: 12, padding: "16px 14px", marginBottom: 4 },
  creditPrintArea: { borderColor: C.red },
  receiptMeta: { fontSize: 11.5, color: C.inkSoft, display: "flex", flexDirection: "column", gap: 3 },
  receiptFooter: { textAlign: "center", fontSize: 10.5, color: C.inkSoft, marginTop: 12 },
  invoiceShopName: { fontWeight: 700, fontSize: 15, textAlign: "center", letterSpacing: "-0.01em" },
  invoiceTagline: { fontSize: 10.5, color: C.inkSoft, textAlign: "center" },
  invoiceBranchLine: { fontSize: 11.5, fontWeight: 600, color: C.primary, textAlign: "center", marginTop: 2 },
  invoiceMetaLine: { fontSize: 10.5, color: C.inkSoft, textAlign: "center" },
  invoiceLabel: { fontWeight: 700, fontSize: 11, letterSpacing: 1.2, textAlign: "center", marginBottom: 10, marginTop: 6 },
  invoiceTableHead: { display: "flex", fontSize: 10, fontWeight: 600, color: C.inkSoft, borderBottom: `1px solid ${C.line}`, paddingBottom: 6, marginBottom: 6 },
  invoiceTableRow: { display: "flex", flexWrap: "wrap", fontSize: 11.5, padding: "3px 0" },
  signatureRow: { display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.inkSoft, marginTop: 12 },
  receiptPrintedOn: { fontSize: 10, color: C.inkFaint, textAlign: "center", marginTop: 10 },

  // ----- purchases / expenses / team / credit (legacy rows)
  poCard: { borderRadius: 14, padding: 14, boxShadow: ring, background: C.surface },
  poHead: { display: "flex", justifyContent: "space-between", marginBottom: 8 },
  poItems: { display: "flex", flexDirection: "column", gap: 4 },
  poItemRow: { display: "flex", justifyContent: "space-between", fontSize: 13, color: C.inkSoft },
  poLines: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 },
  poLineRow: { display: "flex", gap: 8, alignItems: "center" },
  poTotal: { display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 16, padding: "12px 0", borderTop: `1px solid ${C.line}` },
  expenseRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 4px", borderBottom: `1px solid ${C.line}` },
  userRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", boxShadow: ring, borderRadius: 14, background: C.surface },
  youTag: { fontSize: 11, fontWeight: 700, color: C.primary, marginLeft: 6 },
  creditCustomerRow: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: C.surface, border: "none", boxShadow: ring, borderRadius: 14, padding: "12px 14px", textAlign: "left" },
  creditCustomerRowActive: { background: C.redSoft },
  creditTag: { background: C.redSoft, color: C.red, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999 },
  cashTag: { background: C.primarySoft, color: C.primary, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999 },

  toast: {}, toastErr: {},
  reportFilterRow: { display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" },
  reportQuickBtns: { display: "flex", gap: 8, flexWrap: "wrap" },
};
