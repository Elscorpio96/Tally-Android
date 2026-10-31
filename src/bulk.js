// Bulk inventory import: CSV / TSV / pasted text / Excel (.xlsx, .xls) -> validated plan -> products.
import * as XLSX from "xlsx";

export const TEMPLATE_HEADERS = ["name", "sku", "barcode", "category", "cost", "price", "stock", "low_stock"];
export const TEMPLATE_CSV =
  TEMPLATE_HEADERS.join(",") + "\n" +
  'Whole Milk 1L,DRY-001,6001234567899,Dairy,850,1200,24,5\n' +
  'Basmati Rice 5kg,GRN-014,,Grains,"4,200","5,500",10,3\n' +
  'Bottled Water 75cl,BEV-007,6009876543219,Drinks,120,200,100,20\n';

const SYNONYMS = {
  name: ["name", "productname", "product", "item", "itemname", "description", "title"],
  sku: ["sku", "code", "itemcode", "productcode", "ref", "reference"],
  barcode: ["barcode", "upc", "ean", "gtin", "barcodeupc"],
  category: ["category", "group", "type", "department"],
  cost: ["cost", "costprice", "buyingprice", "purchaseprice", "buyprice", "unitcost"],
  price: ["price", "sellingprice", "sellprice", "saleprice", "unitprice", "retailprice"],
  stock: ["stock", "quantity", "qty", "openingstock", "instock", "onhand", "stockqty"],
  lowStock: ["lowstock", "lowstockalert", "reorderlevel", "reorder", "minstock", "minimum", "alertlevel", "reorderpoint"],
};
const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");

// ---------- reading ----------
export function parseDelimited(text) {
  text = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || "";
  let inQ = false; const counts = { ",": 0, "\t": 0, ";": 0 };
  for (const ch of firstLine) { if (ch === '"') inQ = !inQ; else if (!inQ && ch in counts) counts[ch]++; }
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function readFileToRows(file) {
  return new Promise((resolve, reject) => {
    const isExcel = /\.(xlsx|xls|xlsm)$/i.test(file.name || "");
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      try {
        if (isExcel) {
          const wb = XLSX.read(reader.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (!ws) return resolve([]);
          resolve(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "", blankrows: false }));
        } else resolve(parseDelimited(String(reader.result)));
      } catch (e) { reject(new Error("That file couldn't be read as a spreadsheet.")); }
    };
    if (isExcel) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  });
}

// ---------- planning ----------
function toNumber(v) {
  if (typeof v === "number") return isFinite(v) ? v : NaN;
  const s = String(v == null ? "" : v).trim();
  if (s === "") return null;
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "." || (cleaned.match(/\./g) || []).length > 1) return NaN;
  return Number(cleaned);
}
const idText = (v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(v)) : String(v == null ? "" : v).trim());
const SCI = /^\d(\.\d+)?e\+?\d+$/i;

export function buildPlan(rows, products, mode /* skip | update | addstock */) {
  const out = { rows: [], errors: [], counts: { add: 0, update: 0, skip: 0 }, missingColumns: [], columns: [] };
  const headerIdx = rows.findIndex((r) => r.some((c) => String(c).trim() !== ""));
  if (headerIdx < 0) { out.fatal = "The file is empty."; return out; }
  const headers = rows[headerIdx].map(norm);
  const col = {};
  for (const [field, names] of Object.entries(SYNONYMS)) {
    const i = headers.findIndex((h) => names.includes(h));
    if (i >= 0) col[field] = i;
  }
  out.columns = Object.keys(col);
  if (col.name === undefined) { out.fatal = 'No "name" column found. The first row must be a header row, e.g. name, sku, price, stock. Use "Download template" to see the format.'; return out; }
  if (col.price === undefined) out.missingColumns.push("price");

  const bySku = new Map(), byBarcode = new Map();
  for (const p of products) { bySku.set(String(p.sku).toLowerCase(), p); if (p.barcode) byBarcode.set(String(p.barcode), p); }
  const seenSku = new Map(), seenBarcode = new Map(); const usedSkus = new Set(bySku.keys());
  let auto = 0;
  const nextSku = () => { let s; do { auto++; s = "IMP-" + String(auto).padStart(4, "0"); } while (usedSkus.has(s.toLowerCase())); usedSkus.add(s.toLowerCase()); return s; };

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const raw = rows[r]; if (!raw || raw.every((c) => String(c).trim() === "")) continue;
    const line = r + 1;
    const cell = (f) => (col[f] === undefined ? undefined : raw[col[f]]);
    const err = (msg) => out.errors.push({ line, msg });

    const name = String(cell("name") == null ? "" : cell("name")).trim();
    if (!name) { err("Missing product name."); continue; }
    let sku = col.sku === undefined ? "" : idText(cell("sku"));
    let barcode = col.barcode === undefined ? "" : idText(cell("barcode"));
    if (barcode && SCI.test(barcode)) { err(`Barcode "${barcode}" was damaged by Excel (scientific notation). Format the barcode column as Text and try again.`); continue; }
    const category = col.category === undefined ? "" : String(cell("category") == null ? "" : cell("category")).trim();

    const nums = {}; let bad = false;
    for (const f of ["cost", "price", "stock", "lowStock"]) {
      if (col[f] === undefined) continue;
      const n = toNumber(cell(f));
      if (n !== null && (isNaN(n) || n < 0)) { err(`"${f === "lowStock" ? "low stock" : f}" is not a valid number: "${cell(f)}".`); bad = true; break; }
      nums[f] = n; // null = blank
    }
    if (bad) continue;

    // match existing product
    let existing = null;
    if (sku) existing = bySku.get(sku.toLowerCase()) || null;
    if (!existing && !sku && barcode) existing = byBarcode.get(barcode) || null;
    if (!sku && existing) sku = existing.sku;

    if (sku) {
      const k = sku.toLowerCase();
      if (seenSku.has(k)) { err(`Duplicate SKU "${sku}" (already used on row ${seenSku.get(k)}).`); continue; }
      seenSku.set(k, line);
    }
    if (barcode) {
      if (seenBarcode.has(barcode)) { err(`Duplicate barcode "${barcode}" (already used on row ${seenBarcode.get(barcode)}).`); continue; }
      seenBarcode.set(barcode, line);
      const other = byBarcode.get(barcode);
      if (other && (!existing || other.id !== existing.id)) { err(`Barcode "${barcode}" already belongs to "${other.name}".`); continue; }
    }

    if (existing) {
      const action = mode === "skip" ? "skip" : mode;
      out.counts[action === "skip" ? "skip" : "update"]++;
      out.rows.push({ line, action, existing, data: { name, sku: existing.sku, barcode, category, ...nums } });
    } else {
      if (nums.price === undefined || nums.price === null) { err("Missing selling price."); continue; }
      if (!sku) sku = nextSku(); else usedSkus.add(sku.toLowerCase());
      out.counts.add++;
      out.rows.push({ line, action: "add", data: { name, sku, barcode, category, cost: nums.cost || 0, price: nums.price, stock: nums.stock || 0, lowStock: nums.lowStock || 0 } });
    }
  }
  if (out.rows.length === 0 && out.errors.length === 0) out.fatal = "No product rows found under the header.";
  return out;
}

export function applyPlan(products, plan, branchId, makeId, newProductId) {
  const updates = new Map(); const additions = [];
  for (const r of plan.rows) {
    if (r.action === "add") {
      additions.push({ id: newProductId ? newProductId() : "p-" + makeId(), name: r.data.name, sku: r.data.sku, barcode: r.data.barcode || "", category: r.data.category || "", cost: r.data.cost, price: r.data.price, lowStock: r.data.lowStock, stock: { [branchId]: r.data.stock } });
    } else if (r.action === "update" || r.action === "addstock") updates.set(r.existing.id, r);
  }
  const next = products.map((p) => {
    const r = updates.get(p.id); if (!r) return p;
    const d = r.data; const cur = Number((p.stock || {})[branchId] || 0);
    if (r.action === "addstock") return { ...p, stock: { ...p.stock, [branchId]: cur + (d.stock || 0) } };
    return {
      ...p, name: d.name || p.name,
      barcode: d.barcode || p.barcode || "", category: d.category || p.category || "",
      cost: d.cost == null ? p.cost : d.cost, price: d.price == null ? p.price : d.price,
      lowStock: d.lowStock == null ? p.lowStock : d.lowStock,
      stock: d.stock == null ? p.stock : { ...p.stock, [branchId]: d.stock },
    };
  });
  return [...next, ...additions];
}

export function inventoryToCsv(products, branchId) {
  const esc = (v) => { const s = String(v == null ? "" : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [TEMPLATE_HEADERS.join(",")];
  for (const p of products) lines.push([p.name, p.sku, p.barcode || "", p.category || "", p.cost, p.price, Number((p.stock || {})[branchId] || 0), p.lowStock].map(esc).join(","));
  return lines.join("\n") + "\n";
}
