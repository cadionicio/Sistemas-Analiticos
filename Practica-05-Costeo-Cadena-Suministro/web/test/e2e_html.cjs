// Prueba E2E del HTML offline en Chromium (Playwright): T03, T08/T69, T63, T65, T02-equivalente (persistencia), T70.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const out = process.argv[3] || "/tmp/claude-0/e2e";
fs.mkdirSync(out, { recursive: true });
(async () => {
  const file = "file://" + path.resolve(process.argv[2]);
  const userDir = fs.mkdtempSync("/tmp/claude-0/pw-");
  const ctx = await chromium.launchPersistentContext(userDir, { viewport: { width: 1600, height: 900 }, offline: true });
  const page = await ctx.newPage();
  const errors = [], requests = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("request", (r) => { if (!r.url().startsWith("file:") && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) requests.push(r.url()); });
  const res = {};
  const t0 = Date.now();
  await page.goto(file);
  await page.waitForSelector(".topnav");
  res.arranque_ms = Date.now() - t0;
  res.pestanas = await page.$$eval(".topnav button.tab", (b) => b.map((x) => x.textContent.replace(/^\d+/, "").trim()));
  res.menu_lateral = await page.$$eval("aside, nav", (n) => n.filter((x) => x.getBoundingClientRect().width < 300 && x.getBoundingClientRect().height > 500).length);
  await page.screenshot({ path: out + "/01_inicio_vacio.png" });
  await page.click('[data-act="seed"]');
  await page.waitForSelector(".kpi");
  await page.click('[data-tab="asignacion"]');
  res.antes_de_ejecutar = await page.textContent(".ctxbar .pill");
  await page.click('[data-act="run-p3"]');
  await page.waitForTimeout(400);
  res.despues = await page.textContent(".ctxbar .pill");
  const cells = await page.$$eval("table.matrix tbody tr", (rows) => rows.map((r) => Array.from(r.cells).map((c) => c.textContent.trim())));
  res.p3_filas = cells.filter((r) => r[3] && r[3].startsWith("P0")).map((r) => ({ persona: r[3], horas: r[7], tasa: r[9], importe: r[10] }));
  res.p3_total = cells.find((r) => r[1] === "Total CPD del período")?.[10 - 8 + 2] || cells.find((r) => r[1] === "Total CPD del período");
  await page.screenshot({ path: out + "/02_p3_calculado.png", fullPage: true });
  // validación horas
  await page.click('[data-tab="personas"]');
  await page.click('[data-sub="validacion"]');
  const val = await page.$$eval("table.matrix tbody tr", (rows) => rows.map((r) => Array.from(r.cells).map((c) => c.textContent.trim())));
  res.validacion = val.map((r) => r.slice(0, 11).join(" | "));
  await page.screenshot({ path: out + "/03_validacion_horas.png", fullPage: true });
  // laboratorio
  await page.click('[data-tab="inductores"]');
  res.lab_magnitudes = await page.$$eval(".mag", (m) => m.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  res.lab_filas = await page.$$eval("table.matrix tbody tr", (rows) => rows.map((r) => Array.from(r.cells).map((c) => c.textContent.trim()).filter(Boolean).join(" | ")));
  await page.screenshot({ path: out + "/04_laboratorio_inductores.png", fullPage: true });
  // denominador cero T70
  await page.fill('[data-key^="b-"] >> nth=0', "0");
  await page.press('[data-key^="b-"] >> nth=0', "Tab");
  await page.fill('[data-key^="b-"] >> nth=1', "0");
  await page.press('[data-key^="b-"] >> nth=1', "Tab");
  await page.waitForTimeout(200);
  res.t70_estado = await page.textContent(".form-row .pill");
  res.t70_alerta = await page.textContent(".alert");
  await page.screenshot({ path: out + "/05_denominador_cero.png" });
  // restaurar valores
  await page.fill('[data-key^="b-"] >> nth=0', "15");
  await page.press('[data-key^="b-"] >> nth=0', "Tab");
  await page.fill('[data-key^="b-"] >> nth=1', "45");
  await page.press('[data-key^="b-"] >> nth=1', "Tab");
  await page.waitForTimeout(800);
  // sobreimputación T65
  await page.click('[data-tab="personas"]');
  await page.click('[data-sub="horas"]');
  await page.fill('input[data-edit="hours"] >> nth=0', "150");
  await page.press('input[data-edit="hours"] >> nth=0', "Tab");
  await page.waitForTimeout(300);
  res.t65_estado = await page.textContent(".ctxbar .pill");
  await page.screenshot({ path: out + "/06_sobreimputacion.png" });
  await page.fill('input[data-edit="hours"] >> nth=0', "80");
  await page.press('input[data-edit="hours"] >> nth=0', "Tab");
  await page.waitForTimeout(900);
  res.estado_tras_restaurar = await page.textContent(".ctxbar .pill");
  // persistencia: recargar
  await page.reload();
  await page.waitForSelector(".topnav");
  await page.click('[data-tab="asignacion"]');
  res.persistencia_tras_recarga = await page.textContent(".ctxbar .pill");
  const cells2 = await page.$$eval("table.matrix tbody tr", (rows) => rows.map((r) => Array.from(r.cells).map((c) => c.textContent.trim())));
  res.persistencia_total = (cells2.find((r) => r[1] === "Total CPD del período") || []).filter(Boolean).join(" | ");
  // cerrar navegador y reabrir (cierre completo)
  await ctx.close();
  const ctx2 = await chromium.launchPersistentContext(userDir, { viewport: { width: 1366, height: 768 }, offline: true });
  const p2 = await ctx2.newPage();
  await p2.goto(file);
  await p2.waitForSelector(".topnav");
  await p2.click('[data-tab="asignacion"]');
  res.persistencia_tras_cerrar_navegador = await p2.textContent(".ctxbar .pill");
  await p2.screenshot({ path: out + "/07_reabierto_1366x768.png" });
  await ctx2.close();
  res.errores_consola = errors;
  res.peticiones_red = requests;
  console.log(JSON.stringify(res, null, 1));
})();
