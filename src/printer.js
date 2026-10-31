// Printer settings (stored on THIS phone only, not in backups) and high-level print helpers.
import { sendToPrinter } from "./printer-bridge.js";
import { toBase64, saleReceipt, paymentReceipt, textDoc, testPage } from "./escpos.js";

const KEY = "tally:printer";
const DEFAULTS = { address: "", name: "", width: 32, auto: false };

export function getPrinter() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch (e) { return { ...DEFAULTS }; }
}
export function setPrinter(cfg) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, ...cfg })); } catch (e) {}
  window.dispatchEvent(new Event("tally-printer"));
}
export const hasPrinter = () => !!getPrinter().address;

export async function printBytes(cfg, bytes) {
  if (!cfg.address) throw new Error("No printer chosen yet. Set one up first.");
  await sendToPrinter(cfg.address, toBase64(bytes));
}

export const buildSale = (cfg, sale, settings, branch, money) => saleReceipt(sale, settings, branch, { width: cfg.width, money });
export const buildPayment = (cfg, payment, customer, settings, branch, money) => paymentReceipt(payment, customer, settings, branch, { width: cfg.width, money });
export const buildText = (cfg, title, text) => textDoc(title, text, { width: cfg.width });
export const buildTest = (cfg, settings) => testPage(settings, { width: cfg.width });
