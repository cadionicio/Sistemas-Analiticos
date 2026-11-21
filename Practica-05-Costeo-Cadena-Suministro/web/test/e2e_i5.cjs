// E2E I5: informe técnico (.docx) y presentación ejecutiva (.pptx) generados por el sistema + pantallas corregidas.
const { chromium } = require("playwright"); const path = require("path"); const fs = require("fs");
const [, , html, datos, out] = process.argv; fs.mkdirSync(out, { recursive: true });
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync("/tmp/claude-0/pw11-"), { viewport: { width: 1600, height: 900 }, offline: true, acceptDownloads: true });
  const page = await ctx.newPage(); const errors = []; const R = {};
  page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("file://" + path.resolve(html)); await page.waitForSelector(".topnav");
  R.sucioAlAbrir = await page.evaluate(() => window.__pc05.store.dirty);
  await page.click('[data-tab="modelo"]'); const g = await page.$('[data-sub="gestion"]'); if (g) await g.click();
  await page.setInputFiles('input[data-edit="m2-import-pc05"]', path.resolve(datos)); await page.waitForTimeout(3000);
  await page.click('[data-tab="resultados"]'); await page.click('[data-act="run-abc-todos"]');
  await page.waitForFunction(() => (document.querySelector(".toast")?.textContent || "").includes("Costeo ejecutado"), null, { timeout: 20000 });
  for (const esc of ["Base", "Optimista", "Pesimista"]) {
    await page.click('[data-tab="simulacion"]'); await page.click('[data-key="simulacion"][data-sub="montecarlo"]');
    await page.selectOption('select[data-edit="sim-esc"]', esc); await page.fill("#sim-semilla", "20261105"); await page.fill("#sim-iter", "2000");
    const n0 = await page.evaluate(() => window.__pc05.store.one("SELECT COUNT(*) n FROM simulacion").n);
    await page.click('[data-act="sim-correr"]');
    await page.waitForFunction((n) => window.__pc05.store.one("SELECT COUNT(*) n FROM simulacion").n > n && !window.__pc05.app.simEstado, n0, { timeout: 60000 });
  }
  await page.click('[data-tab="inicio"]'); await page.waitForTimeout(300); await page.screenshot({ path: out + "/I5_inicio.png", fullPage: true });
  R.inicioTexto = (await page.textContent("main")).includes("Funciones de esta versión");
  await page.click('[data-tab="personas"]'); await page.click('[data-key="personas"][data-sub="historial"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: out + "/I5_personas_historial.png" });
  R.historialFilas = await page.$$eval("main table.matrix tbody tr", (x) => x.length);
  for (const [sub, act] of [["informe", "exp-informe"], ["ppt", "exp-ppt"]]) {
    await page.click('[data-tab="reportes"]'); await page.click(`[data-key="reportes"][data-sub="${sub}"]`); await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/I5_reportes_${sub}.png` });
    const t0 = Date.now();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click(`[data-act="${act}"]`)]);
    const f = path.join(out, dl.suggestedFilename()); await dl.saveAs(f); R[sub] = { archivo: f, ms: Date.now() - t0, bytes: fs.statSync(f).size };
  }
  R.errores = errors; console.log(JSON.stringify(R, null, 1)); await ctx.close();
})();
