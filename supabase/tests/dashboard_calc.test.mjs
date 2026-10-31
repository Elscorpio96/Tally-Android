import * as C from "../../dashboard/calc.js";
let pass = 0, fail = 0; const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass++ : (fail++, console.log("FAIL", l, JSON.stringify(a), "!=", JSON.stringify(b))));
const S = [
  { id: 1, business_date: "2026-10-01", branch_id: "b1", cashier_id: "u1", cashier_name: "Joy", payment_method: "cash", total: 1000, cost_total: 600, amount_paid: 1000, balance_due: 0, refunded_total: 0, status: "completed" },
  { id: 2, business_date: "2026-10-01", branch_id: "b1", cashier_id: "u2", cashier_name: "Bola", payment_method: "credit", total: 500, cost_total: 300, amount_paid: 100, balance_due: 400, refunded_total: 0, status: "completed" },
  { id: 3, business_date: "2026-10-02", branch_id: "b2", cashier_id: "u1", cashier_name: "Joy", payment_method: "cash", total: 2000, cost_total: 1200, amount_paid: 2000, balance_due: 0, refunded_total: 500, status: "partially_refunded" },
  { id: 4, business_date: "2026-10-02", branch_id: "b1", cashier_id: "u1", cashier_name: "Joy", payment_method: "cash", total: 9999, cost_total: 1, amount_paid: 9999, balance_due: 0, refunded_total: 0, status: "voided" },
];
const E = [{ amount: 200 }, { amount: 50, voided_at: "x" }]; const P = [{ amount: 150 }];
const s = C.summarize(S, E, P);
eq("count excludes voided", s.count, 3); eq("revenue net of refund", s.revenue, 1000 + 500 + 1500);
eq("cost reduced in proportion to refund", s.cost, 600 + 300 + 900); eq("gross", s.gross, 3000 - 1800); eq("voided expense ignored", s.expenses, 200); eq("net", s.net, 1000);
eq("credit issued", s.creditIssued, 400); eq("cash in = paid + repayments", s.cashIn, 1000 + 100 + 2000 + 150); eq("voided count", s.voided, 1);
eq("byDay fills empty days", C.byDay(S, "2026-09-30", "2026-10-02").map((d) => [d.date, d.revenue]), [["2026-09-30", 0], ["2026-10-01", 1500], ["2026-10-02", 1500]]);
eq("by cashier", C.byCashier(S).map((c) => [c.name, c.revenue]), [["Joy", 2500], ["Bola", 500]]);
eq("by branch w/ profit", C.byBranch(S, [{ id: "b1", name: "Main" }, { id: "b2", name: "Lekki" }]).map((b) => [b.name, b.revenue, b.profit]), [["Main", 1500, 600], ["Lekki", 1500, 600]]);
eq("top products", C.topProducts([{ product_id: "p", qty: 2, revenue: 10 }, { product_id: "p", qty: 1, revenue: 5 }], [{ id: "p", name: "Rice" }]), [{ id: "p", name: "Rice", qty: 3, revenue: 15 }]);
const st = C.stockRows([{ id: "p", name: "Rice", sku: "R", low_stock: 5, cost: 10, price: 15 }, { id: "q", name: "Old", archived_at: "x" }], [{ product_id: "p", branch_id: "b1", qty: 3 }, { product_id: "p", branch_id: "b2", qty: 4 }]);
eq("stock sums branches & flags low", [st.length, st[0].qty, st[0].low, st[0].value], [1, 7, false, 70]); eq("branch stock low", C.stockRows([{ id: "p", name: "Rice", sku: "R", low_stock: 5, cost: 10, price: 15 }], [{ product_id: "p", branch_id: "b1", qty: 3 }], "b1")[0].low, true);
eq("presets", [C.presetRange("7d", "2026-10-14"), C.presetRange("month", "2026-10-14"), C.presetRange("yesterday", "2026-10-01")], [["2026-10-08", "2026-10-14"], ["2026-10-01", "2026-10-14"], ["2026-09-30", "2026-09-30"]]);
console.log(`${pass} passed, ${fail} failed`); if (fail) process.exit(1);
