// Per-phone look: theme (light / dark / follow phone) and text size. Stored on the phone only.
const KEY = "tally:ui";
export const THEMES = [["light", "Light"], ["dark", "Dark"], ["system", "Auto"]];
export const TEXT_SIZES = [["normal", "Normal", 1], ["large", "Large", 1.12], ["xl", "Extra large", 1.25]];
const DEFAULTS = { theme: "light", textSize: "normal", autoLock: 0 };
export function getUi() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || "{}") || {}) }; } catch (e) { return { ...DEFAULTS }; }
}
export function applyUi(ui = getUi()) {
  try {
    const root = document.documentElement;
    root.setAttribute("data-theme", ["light", "dark", "system"].includes(ui.theme) ? ui.theme : "light");
    const z = (TEXT_SIZES.find((t) => t[0] === ui.textSize) || TEXT_SIZES[0])[2];
    root.style.zoom = z === 1 ? "" : String(z);
    const dark = ui.theme === "dark" || (ui.theme === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", dark ? "#0B1220" : "#FFFFFF");
  } catch (e) {}
}
export function setUi(patch) {
  const next = { ...getUi(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
  applyUi(next); return next;
}
