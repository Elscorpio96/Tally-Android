// Thin, typed wrapper over Supabase. Every business write goes through a server function (RPC);
// the tables themselves refuse direct writes (see supabase/migrations/0002_rls.sql).
import { getClient } from "./client.js";
import { loginEmail } from "./identity.js";

const c = () => { const x = getClient(); if (!x) throw new Error("Cloud is not configured in this build."); return x; };
const unwrap = ({ data, error, status }) => { if (error) { if (status && error.status === undefined) error.status = status; throw error; } return data; };
const rpc = async (fn, args) => unwrap(await c().rpc(fn, args));

export const cloud = {
  async signIn(identifier, password, shopCode) {
    const email = loginEmail(identifier, shopCode);
    if (!email) throw new Error("Enter your username and shop code, or your e-mail address.");
    unwrap(await c().auth.signInWithPassword({ email, password }));
    const me = await rpc("whoami", {});
    if (!me) { await c().auth.signOut(); throw new Error("not_a_member"); }
    return me;
  },
  async signUpOwner(email, password, shopName, shopCode, displayName, timezone = "Africa/Lagos") {
    const r = unwrap(await c().auth.signUp({ email, password }));
    if (!r.session) throw new Error("Check your e-mail to confirm the address, then sign in.");
    await rpc("create_shop", { p_name: shopName, p_code: shopCode, p_display_name: displayName, p_timezone: timezone });
    return rpc("whoami", {});
  },
  signOut: async () => { await c().auth.signOut(); },
  whoami: () => rpc("whoami", {}),
  session: async () => (await c().auth.getSession()).data.session,
  registerDevice: (branchId, name) => rpc("register_device", { p_branch: branchId, p_name: name || "" }),
  recordSale: (payload) => rpc("record_sale", { p: payload }),
  recordCreditPayment: (payload) => rpc("record_credit_payment", { p: payload }),
  receivePurchase: (payload) => rpc("receive_purchase", { p: payload }),
  adjustStock: (branch, product, qty, reason) => rpc("adjust_stock", { p_branch: branch, p_product: product, p_new_qty: qty, p_reason: reason }),
  editSalePrices: (sale, prices, reason) => rpc("edit_sale_prices", { p_sale: sale, p_prices: prices, p_reason: reason }),
  voidSale: (sale, reason) => rpc("void_sale", { p_sale: sale, p_reason: reason }),
  refundSale: (sale, items, restock, reason) => rpc("refund_sale", { p_sale: sale, p_items: items, p_restock: restock, p_reason: reason }),
  setMember: (user, role, branch, active, reason) => rpc("set_member", { p_user: user, p_role: role, p_branch: branch, p_active: active, p_reason: reason || "" }),
  importLegacy: (payload) => rpc("import_legacy", { p: payload }),
  customerBalances: () => rpc("get_customer_balances", {}),
  customerLedger: (id) => rpc("get_customer_ledger", { p_customer: id }),
  // staff accounts are created by a server-side function that holds the service key
  async createStaff({ username, password, name, role, branchId }) {
    const { data, error } = await c().functions.invoke("create-staff", { body: { username, password, name, role, branch_id: branchId } });
    if (error) { let msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (_) {} throw new Error(msg); }
    return data;
  },
  async resetStaffPassword(userId, password) {
    const { data, error } = await c().functions.invoke("create-staff", { body: { action: "reset_password", user_id: userId, password } });
    if (error) { let msg = error.message; try { const j = await error.context.json(); msg = j.error || msg; } catch (_) {} throw new Error(msg); }
    return data;
  },
  // simple reads (RLS filters everything to the caller's shop)
  async list(table, columns = "*", build) {
    let q = c().from(table).select(columns);
    if (build) q = build(q);
    return unwrap(await q);
  },
};
