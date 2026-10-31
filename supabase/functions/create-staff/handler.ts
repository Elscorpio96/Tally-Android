// Pure request logic for the create-staff function, with dependencies injected so it can be tested
// without Deno or a live Supabase project. The service-role key is only ever used in index.ts,
// which runs on Supabase's servers.
export interface Deps {
  getCaller(jwt: string): Promise<{ id: string } | null>;                         // validates the caller's login token
  createAuthUser(email: string, password: string, meta: Record<string, unknown>): Promise<{ id: string }>;
  deleteAuthUser(id: string): Promise<void>;
  addMember(args: { actor: string; shop: string; user: string; username: string; name: string; role: string; branch: string | null }): Promise<void>;
  callerShop(userId: string): Promise<{ shop_id: string; shop_code: string; role: string; active: boolean } | null>;
  // password reset (optional so older tests/deployments of the other action keep working)
  getMember?(shop: string, userId: string): Promise<{ role: string; active: boolean } | null>;
  setPassword?(userId: string, password: string): Promise<void>;
  auditReset?(args: { shop: string; actor: string; target: string }): Promise<void>;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey, x-client-info", "access-control-allow-methods": "POST, OPTIONS" } });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "Not signed in." });
  const caller = await deps.getCaller(jwt);
  if (!caller) return json(401, { error: "Not signed in." });
  const me = await deps.callerShop(caller.id);
  if (!me || !me.active || !["owner", "admin"].includes(me.role)) return json(403, { error: "Only the owner or an admin can add staff." });

  let b: any; try { b = await req.json(); } catch { return json(400, { error: "Bad request." }); }
  if (b && b.action === "reset_password") {
    const target = String(b.user_id || ""); const pw = String(b.password || "");
    if (!target) return json(400, { error: "Choose who to reset." });
    if (pw.length < 8) return json(400, { error: "Password must be at least 8 characters." });
    if (target === caller.id) return json(400, { error: "Use your own sign-in screen to change your own password." });
    if (!deps.getMember || !deps.setPassword) return json(501, { error: "Password reset is not available on this server." });
    const t = await deps.getMember(me.shop_id, target);       // only people in the caller's own shop are visible here
    if (!t) return json(404, { error: "That person is not in your shop." });
    if (t.role === "owner") return json(403, { error: "The owner's password cannot be reset here." });
    if (t.role === "admin" && me.role !== "owner") return json(403, { error: "Only the owner can reset an admin's password." });
    try { await deps.setPassword(target, pw); } catch { return json(400, { error: "Could not change the password." }); }
    if (deps.auditReset) await deps.auditReset({ shop: me.shop_id, actor: caller.id, target }).catch(() => {});
    return json(200, { ok: true });
  }
  const username = String(b.username || "").trim().toLowerCase().replace(/\s+/g, "");
  const name = String(b.name || "").trim();
  const role = String(b.role || "");
  const password = String(b.password || "");
  if (!/^[a-z0-9._-]{3,24}$/.test(username)) return json(400, { error: "Username must be 3-24 letters, numbers, dot, dash or underscore." });
  if (!name) return json(400, { error: "Enter the person's name." });
  if (!["admin", "manager", "cashier"].includes(role)) return json(400, { error: "Invalid role." });
  if (role === "admin" && me.role !== "owner") return json(403, { error: "Only the owner can create an admin." });
  if (password.length < 8) return json(400, { error: "Password must be at least 8 characters." });
  const branch = b.branch_id ? String(b.branch_id) : null;
  if (role !== "admin" && !branch) return json(400, { error: "Choose a branch." });

  const email = `${username}@${me.shop_code}.ilelah.app`;
  let created: { id: string };
  try { created = await deps.createAuthUser(email, password, { shop: me.shop_id }); }
  catch (e) { return json(409, { error: /already|registered|exists/i.test(String((e as Error).message)) ? "That username is already taken." : "Could not create the account." }); }
  try {
    await deps.addMember({ actor: caller.id, shop: me.shop_id, user: created.id, username, name, role, branch });
  } catch (e) {
    await deps.deleteAuthUser(created.id).catch(() => {});       // no orphan logins
    return json(400, { error: "Could not add the staff member: " + String((e as Error).message).slice(0, 120) });
  }
  return json(200, { user_id: created.id, username, role });
}
