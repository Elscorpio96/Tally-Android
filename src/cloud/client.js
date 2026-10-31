import { createClient } from "@supabase/supabase-js";
import { CLOUD } from "./config.js";

let client = null;
export function getClient() {
  if (!CLOUD) return null;
  if (!client) {
    client = createClient(CLOUD.url, CLOUD.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "ilelah:cloud-session" },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}
