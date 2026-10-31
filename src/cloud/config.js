// Cloud settings are baked in at build time by build.mjs from cloud.config.json
// (or SUPABASE_URL / SUPABASE_ANON_KEY environment variables).
// Only the PUBLIC anon key belongs here. build.mjs refuses a service-role key.
/* global __CLOUD__ */
const injected = typeof __CLOUD__ !== "undefined" ? __CLOUD__ : null;
export const CLOUD = injected && injected.url && injected.anonKey ? injected : null;
export const cloudConfigured = () => !!CLOUD;
