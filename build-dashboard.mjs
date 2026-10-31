// Builds the owner dashboard (static files) into dashboard/dist. Uses the same cloud.config.json as the app.
import { build } from "esbuild";
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
let cfg = {}; if (existsSync("cloud.config.json")) cfg = JSON.parse(readFileSync("cloud.config.json", "utf8"));
const url = process.env.SUPABASE_URL || cfg.url || ""; const anonKey = process.env.SUPABASE_ANON_KEY || cfg.anonKey || "";
if (anonKey) {
  try { const role = JSON.parse(Buffer.from(anonKey.split(".")[1], "base64url").toString()).role; if (role && role !== "anon") { console.error(`\nREFUSING TO BUILD: key has role "${role}". Use only the public anon key.\n`); process.exit(1); } } catch (_) {}
  if (/^sb_secret_/.test(anonKey)) { console.error("\nREFUSING TO BUILD: that is a secret key.\n"); process.exit(1); }
}
const CLOUD = url && anonKey ? { url: url.replace(/\/+$/, ""), anonKey } : null;
rmSync("dashboard/dist", { recursive: true, force: true }); mkdirSync("dashboard/dist", { recursive: true });
await build({ entryPoints: ["dashboard/app.jsx"], bundle: true, minify: true, outfile: "dashboard/dist/app.js", jsx: "transform", target: ["chrome90"], define: { "process.env.NODE_ENV": '"production"', __CLOUD__: JSON.stringify(CLOUD) }, logLevel: "info" });
writeFileSync("dashboard/dist/index.html", `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="color-scheme" content="light dark"/><title>Ilelah Dashboard</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet"/></head><body><div id="root"></div><script src="app.js"></script></body></html>`);
console.log("Dashboard built in dashboard/dist");
