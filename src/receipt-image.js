import { lineGross, lineDiscount, saleDiscount, saleSubtotal, saleQty, saleRefunded, saleNet } from "./lines.js";
// Draws a receipt onto a canvas and returns it as a PNG (base64), so it can be shared as a picture (WhatsApp etc.).
const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/); const lines = []; let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

// rows: [{ t: "text", style?: "title|bold|small|center|divider|gap|pair|item", ... }]
export function buildReceiptRows(sale, settings, branch, money) {
  const credit = sale.paymentType === "credit";
  const rows = [];
  rows.push({ k: "title", t: settings.shopName });
  if (settings.tagline) rows.push({ k: "small", t: `(${settings.tagline})`, center: true });
  if (branch && branch.name) rows.push({ k: "bold", t: `Branch: ${branch.name}`, center: true, color: "#0F766E" });
  if (branch && branch.address) rows.push({ k: "small", t: branch.address, center: true });
  if (branch && branch.phone) rows.push({ k: "small", t: branch.phone, center: true });
  rows.push({ k: "divider" });
  rows.push({ k: "bold", t: credit ? "CREDIT INVOICE: GOODS ON CREDIT" : "CASH INVOICE", center: true, color: credit ? "#DC2626" : "#0F172A" });
  rows.push({ k: "small", t: `Invoice No.: ${sale.invoiceNo}` });
  rows.push({ k: "small", t: `Date: ${sale.date}   Time: ${new Date(sale.time).toLocaleTimeString()}` });
  rows.push({ k: "small", t: `Name: ${sale.customerName || "Walk-in Customer"}` });
  if (credit && sale.customerPhone) rows.push({ k: "small", t: `Phone: ${sale.customerPhone}` });
  if (credit && sale.dueDate) rows.push({ k: "small", t: `Payment due by: ${sale.dueDate}` });
  rows.push({ k: "divider" });
  rows.push({ k: "head" });
  sale.items.forEach((i, idx) => { rows.push({ k: "item", sn: idx + 1, qty: i.qty, name: i.name, price: money(i.price), amount: money(lineGross(i)) }); if (lineDiscount(i) > 0) rows.push({ k: "pair", l: "   Discount", r: "-" + money(lineDiscount(i)), small: true }); });
  rows.push({ k: "divider" });
  rows.push({ k: "pair", l: `Items: ${sale.items.length}`, r: `Total qty: ${saleQty(sale.items)}`, boldRow: true });
  if (saleDiscount(sale.items) > 0) { rows.push({ k: "pair", l: "Subtotal", r: money(saleSubtotal(sale.items)) }); rows.push({ k: "pair", l: "Discount", r: "-" + money(saleDiscount(sale.items)) }); }
  rows.push({ k: "pair", l: "Amount Due", r: money(sale.total), big: true });
  if (saleRefunded(sale) > 0) { rows.push({ k: "pair", l: "Returned by customer", r: "-" + money(saleRefunded(sale)), color: "#DC2626" }); rows.push({ k: "pair", l: "Net after returns", r: money(saleNet(sale)), boldRow: true }); }
  rows.push({ k: "pair", l: credit ? "Deposit Paid" : "Payment: Cash", r: money(sale.amountTendered) });
  if (!credit && sale.amountTendered > sale.total) rows.push({ k: "pair", l: "Change", r: money(sale.amountTendered - sale.total) });
  rows.push({ k: "pair", l: credit ? "AMOUNT OWED" : "Balance", r: money(sale.balanceDue), color: credit ? "#DC2626" : null, boldRow: credit });
  rows.push({ k: "divider" });
  rows.push({ k: "small", t: credit ? "Goods released on credit. Balance must be settled as agreed. No refund of money after payment." : "Received the above goods in good condition. No refund of money after payment.", center: true });
  rows.push({ k: "gap", h: 14 });
  rows.push({ k: "pair", l: "Customer Sign: ________", r: "Date: ________", small: true });
  rows.push({ k: "pair", l: `Cashier: ${sale.cashierName}`, r: "Manager: ________", small: true });
  rows.push({ k: "small", t: `Printed on ${new Date().toLocaleString()}`, center: true, color: "#94A0B2" });
  return rows;
}

export async function renderReceiptPng(sale, settings, branch, money) {
  try { if (document.fonts && document.fonts.load) { await document.fonts.load("400 14px Inter"); await document.fonts.load("700 14px Inter"); } } catch (e) {}
  const W = 440, PAD = 24, S = 2, inner = W - PAD * 2;
  const rows = buildReceiptRows(sale, settings, branch, money);
  const measure = document.createElement("canvas").getContext("2d");
  const font = (w, px) => `${w} ${px}px ${FONT}`;
  const sizes = { title: [700, 18], bold: [700, 12], small: [400, 11] };
  // pass 1: layout heights
  let y = PAD; const laid = [];
  for (const r of rows) {
    let h = 0, lines = null;
    if (r.k === "divider") h = 14;
    else if (r.k === "gap") h = r.h;
    else if (r.k === "head") h = 20;
    else if (r.k === "pair") h = r.big ? 26 : r.small ? 17 : 20;
    else if (r.k === "item") { measure.font = font(400, 12); lines = wrap(measure, r.name, inner * 0.78 - 130); h = lines.length * 16 + 6; }
    else { const [w, px] = sizes[r.k]; measure.font = font(w, px); lines = wrap(measure, r.t, inner); h = lines.length * (px + 5) + 3; }
    laid.push({ r, y, h, lines }); y += h;
  }
  const H = y + PAD;
  const c = document.createElement("canvas"); c.width = W * S; c.height = H * S;
  const ctx = c.getContext("2d"); ctx.scale(S, S);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  const credit = sale.paymentType === "credit";
  ctx.strokeStyle = credit ? "#DC2626" : "#D3DAE3"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
  ctx.strokeRect(8, 8, W - 16, H - 16); ctx.setLineDash([]);
  for (const { r, y: ty, h, lines } of laid) {
    if (r.k === "divider") { ctx.strokeStyle = "#D3DAE3"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(PAD, ty + 9); ctx.lineTo(W - PAD, ty + 9); ctx.stroke(); ctx.setLineDash([]); continue; }
    if (r.k === "gap") continue;
    if (r.k === "head") {
      ctx.font = font(600, 10.5); ctx.fillStyle = "#5B6678";
      ctx.textAlign = "left"; ctx.fillText("S/N", PAD, ty + 14); ctx.fillText("Qty", PAD + 26, ty + 14);
      ctx.fillText("Description", PAD + 54, ty + 14);
      ctx.textAlign = "right"; ctx.fillText("Price", PAD + inner * 0.78, ty + 14); ctx.fillText("Amount", W - PAD, ty + 14);
      continue;
    }
    if (r.k === "item") {
      ctx.fillStyle = "#0F172A"; ctx.font = font(400, 12);
      ctx.textAlign = "left"; ctx.fillText(String(r.sn), PAD, ty + 14); ctx.fillText(String(r.qty), PAD + 26, ty + 14);
      lines.forEach((ln, i) => ctx.fillText(ln, PAD + 54, ty + 14 + i * 16));
      ctx.textAlign = "right"; ctx.fillText(r.price, PAD + inner * 0.78, ty + 14); ctx.font = font(600, 12); ctx.fillText(r.amount, W - PAD, ty + 14);
      continue;
    }
    if (r.k === "pair") {
      const px = r.big ? 15 : r.small ? 11 : 12;
      ctx.font = font(r.big || r.boldRow ? 700 : 400, px); ctx.fillStyle = r.color || (r.small ? "#5B6678" : "#0F172A");
      ctx.textAlign = "left"; ctx.fillText(r.l, PAD, ty + h - 6);
      ctx.textAlign = "right"; ctx.fillText(r.r, W - PAD, ty + h - 6);
      continue;
    }
    const [w, px] = sizes[r.k];
    ctx.font = font(w, px); ctx.fillStyle = r.color || (r.k === "small" ? "#5B6678" : "#0F172A");
    ctx.textAlign = r.k === "title" || r.center ? "center" : "left";
    const x = ctx.textAlign === "center" ? W / 2 : PAD;
    lines.forEach((ln, i) => ctx.fillText(ln, x, ty + px + 2 + i * (px + 5)));
  }
  const dataUrl = c.toDataURL("image/png");
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}
