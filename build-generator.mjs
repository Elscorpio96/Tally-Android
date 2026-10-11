import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
const r = await build({ entryPoints: ["tools/generator-src.js"], bundle: true, minify: true, write: false, format: "iife", target: ["chrome90"] });
const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
writeFileSync("tools/license-generator.html", readFileSync("tools/generator-template.html", "utf8").replace("/*BUNDLE*/", () => js));
console.log("tools/license-generator.html written");
