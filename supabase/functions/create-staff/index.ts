// Supabase Edge Function (Deno). Deploy:  supabase functions deploy create-staff
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
// The service-role key stays inside this function and is never sent to the app.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handle, Deps } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

const deps: Deps = {
  async getCaller(jwt) { const { data, error } = await admin.auth.getUser(jwt); return error || !data.user ? null : { id: data.user.id }; },
  async callerShop(userId) {
    const { data } = await admin.from("memberships").select("shop_id, role, active, shops(code)").eq("user_id", userId).maybeSingle();
    if (!data) return null;
    return { shop_id: data.shop_id, role: data.role, active: data.active, shop_code: (data as any).shops.code };
  },
  async createAuthUser(email, password, meta) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta });
    if (error || !data.user) throw error ?? new Error("create failed");
    return { id: data.user.id };
  },
  async getMember(shop, userId) {
    const { data } = await admin.from("memberships").select("role, active").eq("shop_id", shop).eq("user_id", userId).maybeSingle();
    return data ? { role: data.role, active: data.active } : null;
  },
  async setPassword(userId, password) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) throw error;
  },
  async auditReset(a) {
    await admin.from("audit_log").insert({ shop_id: a.shop, actor_id: a.actor, action: "member.password_reset", entity: "member", entity_id: a.target, reason: "Password reset by owner/admin" });
  },
  async deleteAuthUser(id) { await admin.auth.admin.deleteUser(id); },
  async addMember(a) {
    const { error } = await admin.rpc("add_member", { p_actor: a.actor, p_shop: a.shop, p_user: a.user, p_username: a.username, p_name: a.name, p_role: a.role, p_branch: a.branch });
    if (error) throw error;
  },
};
Deno.serve((req) => handle(req, deps));
