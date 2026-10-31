import { reviseSale, stockDiffs } from "../../src/saleedit.js";
import { round2, lineTotal, saleTotal, saleDiscount, saleSubtotal, discountAmount, priceCart, canEditSale, effectiveUnit } from "../../src/lines.js";
let pass = 0, fail = 0; const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass++ : (fail++, console.log("FAIL", l, JSON.stringify(a), "!=", JSON.stringify(b))));
eq("line total with discount", lineTotal({ qty: 3, price: 1000, discount: 250 }), 2750);
eq("discount cannot exceed the line", lineTotal({ qty: 1, price: 100, discount: 500 }), 0);
eq("negative discount ignored", lineTotal({ qty: 2, price: 100, discount: -5 }), 200);
eq("percent of base", discountAmount({ mode: "pct", text: "10" }, 2500), 250); eq("amount capped at base", discountAmount({ mode: "amt", text: "9999" }, 2500), 2500);
eq("percent over 100 capped", discountAmount({ mode: "pct", text: "150" }, 200), 200); eq("blank is zero", discountAmount({ mode: "pct", text: "" }, 200), 0);
const cart = [{ id: "a", qty: 2, price: 1000 }, { id: "b", qty: 1, price: 3000, discEntry: { mode: "pct", text: "10" } }];
let r = priceCart(cart, null); eq("line % only", [r.subtotal, r.discount, r.total], [5000, 300, 4700]);
r = priceCart(cart, { mode: "pct", text: "5" }); eq("plus 5% on the rest", [r.subtotal, r.discount, r.total], [5000, 300 + 235, 4465]);
eq("shares add up to the sale discount exactly", saleDiscount(r.lines), r.discount);
r = priceCart([{ qty: 3, price: 33.33 }, { qty: 1, price: 10 }, { qty: 7, price: 1.01 }], { mode: "amt", text: "7.77" });
eq("odd amounts: total = subtotal - discount, no lost kobo", [round2(r.subtotal - r.discount), r.total, r.discount], [r.total, r.total, 7.77]);
eq("subtotal helper", saleSubtotal([{ qty: 2, price: 5 }]), 10); eq("effective unit price", effectiveUnit({ qty: 2, price: 100, discount: 50 }), 75);
eq("100% discount gives a free sale, not negative", priceCart([{ qty: 1, price: 50 }], { mode: "pct", text: "100" }).total, 0);
const admin = { id: "a", role: "admin" }, joy = { id: "j", role: "staff", name: "Joy" };
eq("admin edits anything", canEditSale(admin, { cashierId: "x", date: "2020-01-01" }, "2026-10-14"), true);
eq("cashier edits own sale today", canEditSale(joy, { cashierId: "j", date: "2026-10-14" }, "2026-10-14"), true);
eq("cashier cannot edit yesterday's", canEditSale(joy, { cashierId: "j", date: "2026-10-13" }, "2026-10-14"), false);
eq("cashier cannot edit someone else's", canEditSale(joy, { cashierId: "k", date: "2026-10-14" }, "2026-10-14"), false);
eq("old sale without cashierId matches by name", canEditSale(joy, { cashierName: "Joy", date: "2026-10-14" }, "2026-10-14"), true);

// ---- owner adds / deletes items on a finished sale
{
  const sale = { id: "s", total: 4000, cost: 2500, amountTendered: 4000, balanceDue: 0, paymentType: "cash", branchId: "b",
    items: [{ productId: "A", name: "A", qty: 2, price: 1000, cost: 500, discount: 0 }, { productId: "B", name: "B", qty: 4, price: 500, cost: 300, discount: 0 }] };
  const gone = reviseSale(sale, { kept: [{ index: 0, qty: 2, price: 1000, discount: 0 }], added: [] });
  eq("delete a line: total and cost follow", [gone.total, gone.cost, gone.items.length], [2000, 1000, 1]);
  eq("cash sale, lower total: payment stays so change shows", [gone.amountTendered, gone.balanceDue], [4000, 0]);
  eq("stock goes back for the deleted line", stockDiffs(sale, gone), { B: 4 });
  const more = reviseSale(sale, { kept: [{ index: 0, qty: 2, price: 1000, discount: 0 }, { index: 1, qty: 4, price: 500, discount: 0 }], added: [{ productId: "C", name: "C", qty: 3, price: 700, discount: 100, cost: 400 }] });
  eq("add a line: total follows", more.total, 6000);
  eq("cash sale, higher total: payment raised so the customer pays the difference", more.amountTendered, 6000);
  eq("stock comes off for the added line", stockDiffs(sale, more), { C: -3 });
  eq("revision is remembered", more.revisions.map((r) => [r.delta, r.added, r.removed]), [[2000, ["C"], []]]);
  const credit = reviseSale({ ...sale, paymentType: "credit", amountTendered: 1000, balanceDue: 3000 }, { kept: [{ index: 0, qty: 2, price: 1000, discount: 0 }], added: [] });
  eq("credit sale: the amount owed follows the total", [credit.total, credit.amountTendered, credit.balanceDue], [2000, 1000, 1000]);
  let threw = false; try { reviseSale(sale, { kept: [], added: [] }); } catch (e) { threw = /sale_needs_a_line/.test(e.message); }
  eq("a sale cannot lose every line", threw, true);
  eq("quantity change only: stock difference by product", stockDiffs(sale, reviseSale(sale, { kept: [{ index: 0, qty: 5, price: 1000, discount: 0 }, { index: 1, qty: 4, price: 500, discount: 0 }], added: [] })), { A: -3 });
}
console.log(`${pass} passed, ${fail} failed`); if (fail) process.exit(1);
