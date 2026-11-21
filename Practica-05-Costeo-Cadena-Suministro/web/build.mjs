// Construcción reproducible del HTML único offline (ENT-12) y del recurso que incrusta el EXE (ENT-11).
// Uso: node build.mjs <version>
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const version = process.argv[2] || "0.1.0-dev";
const wasm = readFileSync("node_modules/sql.js/dist/sql-wasm.wasm");
const demo = readFileSync("../datos/Datos_Empresa_Gran_Escala.xlsx").toString("base64");
const r = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100", "edge100", "firefox100"],
  minify: true,
  write: false,
  external: ["fs", "path", "crypto"],
  define: { __SQL_WASM_B64__: JSON.stringify(wasm.toString("base64")), __APP_VERSION__: JSON.stringify(version) },
  legalComments: "eof",
  logLevel: "warning",
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync("src/ui/styles.css", "utf8");
const csp = "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="generator" content="build ${version}">
<title>Costeo de la Cadena de Suministro</title>
<style>${css}</style>
</head>
<body>
<div id="boot" style="padding:40px;font-family:Segoe UI,sans-serif;color:#1D2E50">Iniciando base de datos local…</div>
<div id="app"></div>
<noscript>Esta aplicación necesita JavaScript habilitado.</noscript>
<script type="application/octet-stream" id="demo-xlsx">${demo}</script>
<script>${js}</script>
</body>
</html>`;
mkdirSync("dist", { recursive: true });
writeFileSync("dist/12_Aplicacion_Offline.html", html);
const sha = createHash("sha256").update(html).digest("hex");
console.log(JSON.stringify({ version, bytes: html.length, sha256: sha }));
