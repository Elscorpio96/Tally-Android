import { build } from "esbuild";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";

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
  define: { "process.env.NODE_ENV": '"production"' },
  target: ["chrome90"],
  logLevel: "info",
});

writeFileSync("www/index.html", `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#F4F3EE" />
<title>Tally</title>
<link rel="stylesheet" href="app.css" />
</head>
<body>
<div id="root"><p style="font-family:sans-serif;padding:40px;text-align:center">Loading Tally…</p></div>
<script src="app.js"></script>
</body>
</html>
`);
