// Staff have no e-mail address, so a login name is mapped to a private e-mail-style ID.
// Owners sign in with their real e-mail address instead.
export const normUsername = (u) => String(u || "").trim().toLowerCase().replace(/\s+/g, "");
export const validUsername = (u) => /^[a-z0-9._-]{3,24}$/.test(normUsername(u));
export const normShopCode = (c) => String(c || "").trim().toLowerCase();
export const validShopCode = (c) => /^[a-z0-9]{3,12}$/.test(normShopCode(c));
export const STAFF_DOMAIN = "ilelah.app";
export const staffEmail = (username, shopCode) => `${normUsername(username)}@${normShopCode(shopCode)}.${STAFF_DOMAIN}`;
// What the person typed: an e-mail address (owner) or a username (staff, needs the shop code).
export function loginEmail(identifier, shopCode) {
  const id = String(identifier || "").trim();
  if (id.includes("@")) return id.toLowerCase();
  if (!validUsername(id) || !validShopCode(shopCode)) return null;
  return staffEmail(id, shopCode);
}
export function describeAuthError(e) {
  const m = String((e && e.message) || e || "");
  if (/invalid login credentials/i.test(m)) return "Wrong username, shop code or password.";
  if (/failed to fetch|network|timeout/i.test(m)) return "No internet connection. Try again when online.";
  if (/rate limit|too many/i.test(m)) return "Too many attempts. Wait a minute and try again.";
  if (/not_a_member/.test(m)) return "This account is not linked to a shop.";
  return m || "Something went wrong.";
}
