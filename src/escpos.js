import { lineDiscount, saleDiscount, saleSubtotal, saleQty, saleRefunded, saleNet } from "./lines.js";
// ESC/POS receipt builder for 58 mm (32 chars) and 80 mm (48 chars) thermal printers.
// Pure functions: no Android code in here, so it can be tested anywhere.
const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

// Cheap thermal printers only reliably print plain ASCII, so naira becomes "N", accents are dropped, etc.
export function asciiSafe(s) {
  return String(s == null ? "" : s)
    .replace(/₦/g, "N").replace(/[–—−]/g, "-").replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"')
    .replace(/×/g, "x").replace(/[·•]/g, "-").replace(/…/g, "...")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e\n]/g, "?");
}

export function wrapText(str, width) {
  const out = [];
  for (const para of asciiSafe(str).split("\n")) {
    let line = "";
    for (let word of para.split(" ")) {
      while (word.length > width) {
        if (line) { out.push(line); line = ""; }
        out.push(word.slice(0, width)); word = word.slice(width);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += " " + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

export class Escpos {
  constructor(width = 32) { this.w = width; this.buf = []; this.raw(ESC, 0x40); }
  raw(...b) { for (const x of b) this.buf.push(x); return this; }
  align(a) { return this.raw(ESC, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0); }
  bold(on) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  big(on) { return this.raw(GS, 0x21, on ? 0x11 : 0x00); }
  text(str) { for (const ch of asciiSafe(str)) this.buf.push(ch.charCodeAt(0)); return this; }
  line(str = "") { return this.text(str).raw(LF); }
  wrap(str) { wrapText(str, this.w).forEach((l) => this.line(l)); return this; }
  hr(ch = "-") { return this.line(ch.repeat(this.w)); }
  lr(left, right) {
    const r = asciiSafe(right);
    const ls = wrapText(left, Math.max(8, this.w - r.length - 1));
    ls.forEach((ln, i) => {
      if (i < ls.length - 1) this.line(ln);
      else this.line(ln + " ".repeat(Math.max(1, this.w - ln.length - r.length)) + r);
    });
    return this;
  }
  feed(n = 4) { return this.raw(ESC, 0x64, n); }
  bytes() { return Uint8Array.from(this.buf); }
}

export function toBase64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

const pad2 = (n) => String(n).padStart(2, "0");
const hhmm = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

function header(e, settings, branch) {
  const name = String(settings.shopName || "Shop").toUpperCase();
  e.align("center");
  if (name.length <= Math.floor(e.w / 2)) e.big(true).bold(true).line(asciiSafe(name)).big(false).bold(false);
  else e.bold(true).wrap(name).bold(false);
  if (settings.tagline) e.wrap(`(${settings.tagline})`);
  if (branch && branch.name) e.wrap(branch.name);
  if (branch && branch.address) e.wrap(branch.address);
  if (branch && branch.phone) e.wrap(branch.phone);
  e.align("left").hr();
}

export function saleReceipt(sale, settings, branch, { width = 32, money }) {
  const e = new Escpos(width); const m = (v) => asciiSafe(money(v));
  const credit = sale.paymentType === "credit";
  header(e, settings, branch);
  e.align("center").bold(true).line(credit ? "CREDIT INVOICE" : "CASH INVOICE").bold(false).align("left");
  e.line(`Invoice No: ${sale.invoiceNo}`);
  e.line(`Date: ${sale.date}  ${hhmm(sale.time)}`);
  e.wrap(`Customer: ${sale.customerName || "Walk-in Customer"}`);
  if (credit && sale.customerPhone) e.wrap(`Phone: ${sale.customerPhone}`);
  if (credit && sale.dueDate) e.wrap(`Payment due by: ${sale.dueDate}`);
  e.hr();
  let sn = 0;
  for (const i of sale.items || []) {
    sn += 1;
    e.wrap(`${sn}. ${i.name}`);
    e.lr(`  ${i.qty} x ${m(i.price)}`, m(i.price * i.qty));
    if (lineDiscount(i) > 0) e.lr("  discount", "-" + m(lineDiscount(i)));
  }
  e.hr();
  e.lr(`Items: ${(sale.items || []).length}`, `Total qty: ${saleQty(sale.items)}`);
  if (saleDiscount(sale.items) > 0) { e.lr("Subtotal", m(saleSubtotal(sale.items))); e.lr("Discount", "-" + m(saleDiscount(sale.items))); }
  e.hr();
  e.bold(true).lr("TOTAL", m(sale.total)).bold(false);
  if (saleRefunded(sale) > 0) { e.lr("Returned", "-" + m(saleRefunded(sale))); e.bold(true).lr("NET", m(saleNet(sale))).bold(false); }
  if (credit) {
    e.lr("Deposit paid", m(sale.amountTendered));
    e.bold(true).lr("AMOUNT OWED", m(sale.balanceDue)).bold(false);
  } else {
    e.lr("Cash received", m(sale.amountTendered));
    if (Number(sale.amountTendered) > Number(sale.total)) e.lr("Change", m(Number(sale.amountTendered) - Number(sale.total)));
    else if (Number(sale.balanceDue) > 0) e.lr("Balance", m(sale.balanceDue));
  }
  e.hr();
  e.wrap(credit ? "Goods released on credit. Balance must be settled as agreed." : "Received the above goods in good condition.");
  e.wrap("No refund of money after payment.");
  e.line(`Cashier: ${sale.cashierName || ""}`);
  if (credit) { e.line(); e.line("Customer sign: " + "_".repeat(Math.max(8, width - 15))); }
  e.line().align("center").line("Thank you for your patronage!").align("left");
  return e.feed(4).bytes();
}

export function paymentReceipt(payment, customer, settings, branch, { width = 32, money }) {
  const e = new Escpos(width); const m = (v) => asciiSafe(money(v));
  header(e, settings, branch);
  e.align("center").bold(true).line("CREDIT PAYMENT RECEIPT").bold(false).align("left");
  e.line(`Receipt No: ${payment.receiptNo}`);
  e.line(`Date: ${payment.date}`);
  e.wrap(`Customer: ${customer ? customer.name : "-"}`);
  e.hr();
  e.bold(true).lr("AMOUNT PAID", m(payment.amount)).bold(false);
  e.lr("Balance still owed", m(payment.remainingAfter));
  if (payment.note) e.wrap(`Note: ${payment.note}`);
  e.hr();
  e.line(`Received by: ${payment.cashierName || ""}`);
  e.line().align("center").line("Thank you!").align("left");
  return e.feed(4).bytes();
}

export function textDoc(title, text, { width = 32 }) {
  const e = new Escpos(width);
  e.align("center").bold(true).wrap(title).bold(false).align("left").hr();
  e.wrap(text);
  return e.feed(4).bytes();
}

export function testPage(settings, { width = 32 }) {
  const e = new Escpos(width);
  e.align("center").big(true).bold(true).line("TEST PRINT").big(false).bold(false);
  e.wrap(String(settings.shopName || "Ilelah Business Suite")).align("left").hr();
  e.line("1234567890".repeat(6).slice(0, width));
  e.line("Naira sign prints as N: N1,250.00");
  e.wrap("If you can read this clearly, your printer is ready.");
  return e.feed(4).bytes();
}
