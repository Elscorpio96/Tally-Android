import { build } from "esbuild";
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

// ---- cloud settings (public URL + public anon key only) ----
function loadCloud() {
  let cfg = {};
  if (existsSync("cloud.config.json")) cfg = JSON.parse(readFileSync("cloud.config.json", "utf8"));
  const url = process.env.SUPABASE_URL || cfg.url || "";
  const anonKey = process.env.SUPABASE_ANON_KEY || cfg.anonKey || "";
  if (!url || !anonKey) return null;
  // Refuse the secret key: it must never be shipped inside an app.
  try {
    const part = anonKey.split(".")[1];
    const role = JSON.parse(Buffer.from(part, "base64url").toString()).role;
    if (role && role !== "anon") throw new Error(`cloud key has role "${role}" (only the public anon key may be used)`);
  } catch (e) { if (/cloud key has role/.test(e.message)) { console.error("\nREFUSING TO BUILD: " + e.message + "\n"); process.exit(1); } }
  if (/^sb_secret_/.test(anonKey)) { console.error("\nREFUSING TO BUILD: that is a secret key.\n"); process.exit(1); }
  return { url: url.replace(/\/+$/, ""), anonKey };
}
const CLOUD_CFG = loadCloud();

rmSync("www", { recursive: true, force: true });
mkdirSync("www", { recursive: true });

await build({
  entryPoints: ["src/entry.js"],
  bundle: true,
  minify: true,
  outdir: "www",
  entryNames: "app",
  loader: { ".woff2": "file", ".woff": "file" },
  assetNames: "fonts/[name]-[hash]",
  jsx: "transform",
  define: { "process.env.NODE_ENV": '"production"', __CLOUD__: JSON.stringify(CLOUD_CFG) },
  target: ["chrome90"],
  logLevel: "info",
});

writeFileSync("www/index.html", `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#FFFFFF" />
<title>Ilelah Business Suite</title>
<link rel="stylesheet" href="app.css" />
</head>
<body>
<style>html,body{margin:0;background:#F5F7FA}@keyframes sp{to{transform:rotate(360deg)}}</style>
<div id="root"><div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font-family:system-ui,sans-serif;color:#5B6678"><div style="width:56px;height:56px;border-radius:18px;background:#0F766E;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:28px">I</div><div style="width:22px;height:22px;border:3px solid #0F766E;border-right-color:transparent;border-radius:50%;animation:sp .7s linear infinite"></div></div></div>
<script src="app.js"></script>
</body>
</html>
`);
