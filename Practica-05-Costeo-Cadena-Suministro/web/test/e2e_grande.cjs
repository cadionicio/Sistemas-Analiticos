// E2E de volumen (T41): importar el conjunto de gran escala, costear 24 períodos, recorrer todas las pestañas y
// subpestañas midiendo tiempos, simular Monte Carlo y exportar todos los archivos.
const { chromium } = require("playwright"); const path = require("path"); const fs = require("fs");
const [, , html, datos, out, iter = "2000"] = process.argv; fs.mkdirSync(out, { recursive: true });
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync("/tmp/claude-0/pwg-"), { viewport: { width: 1600, height: 900 }, offline: true, acceptDownloads: true });
  const page = await ctx.newPage(); const errors = []; const R = { tiempos: {}, pantallas: [] };
  page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("file://" + path.resolve(html)); await page.waitForSelector(".topnav");
  await page.click('[data-tab="modelo"]'); const g = await page.$('[data-sub="gestion"]'); if (g) await g.click();
  let t0 = Date.now();
  await page.setInputFiles('input[data-edit="m2-import-pc05"]', path.resolve(datos));
  await page.waitForFunction(() => /importado/.test(document.querySelector(".toast")?.textContent || "") || /rechazada/.test(document.querySelector(".toast")?.textContent || ""), null, { timeout: 180000 });
  R.tiempos.importar_ms = Date.now() - t0; R.toastImportar = await page.textContent(".toast");
  await page.click('[data-tab="resultados"]'); await page.waitForTimeout(300);
  t0 = Date.now(); await page.click('[data-act="run-abc-todos"]');
  R.toastRun = await (await page.waitForFunction(() => { const t = document.querySelector(".toast")?.textContent || ""; return t.includes("Costeo ejecutado") ? t : null; }, null, { timeout: 300000 })).jsonValue();
  R.tiempos.costear_24_periodos_ms = Date.now() - t0;
  R.base = await page.evaluate(() => { const s = window.__pc05.store; return { bytes: s.export().length, corridas: s.one("SELECT COUNT(*) n FROM corrida").n, asignaciones: s.one("SELECT COUNT(*) n FROM asignacion").n, personas: s.one("SELECT COUNT(*) n FROM persona").n, valores_base: s.one("SELECT COUNT(*) n FROM valor_base").n }; });
  // todas las pestañas y subpestañas
  const tabs = await page.$$eval(".topnav [data-tab]", (xs) => xs.map((x) => x.getAttribute("data-tab")));
  for (const t of tabs) {
    t0 = Date.now(); await page.click(`.topnav [data-tab="${t}"]`); await page.waitForTimeout(50);
    const subs = await page.$$eval('main .subtabs [data-act="sub"]', (xs) => xs.map((x) => [x.getAttribute("data-key"), x.getAttribute("data-sub")]));
    R.pantallas.push({ tab: t, sub: "(inicial)", ms: Date.now() - t0 });
    for (const [k, s] of subs) {
      t0 = Date.now(); await page.click(`main [data-key="${k}"][data-sub="${s}"]`); await page.waitForTimeout(50);
      const txt = await page.textContent("main");
      const celdas = await page.$$eval("main td", (x) => x.length);
      R.pantallas.push({ tab: t, sub: s, ms: Date.now() - t0, celdas, nan: /NaN|undefined|Infinity/.test(txt) });
      if (["p4c", "resumen", "validacion", "horas", "dashboard", "registro", "montecarlo", "catalogo", "diagrama"].includes(s)) await page.screenshot({ path: `${out}/G_${t}_${s}.png` });
    }
  }
  // Monte Carlo
  await page.click('[data-tab="simulacion"]'); await page.click('[data-key="simulacion"][data-sub="montecarlo"]');
  await page.selectOption('select[data-edit="sim-esc"]', "Base"); await page.waitForTimeout(150);
  await page.fill("#sim-semilla", "20261105"); await page.fill("#sim-iter", iter);
  t0 = Date.now(); await page.click('[data-act="sim-correr"]');
  await page.waitForFunction(() => window.__pc05.store.one("SELECT COUNT(*) n FROM simulacion").n > 0 && !window.__pc05.app.simEstado, null, { timeout: 600000 });
  R.tiempos[`montecarlo_${iter}_ms`] = Date.now() - t0;
  R.mc = await page.evaluate(() => { const x = window.__pc05.store.one("SELECT resultado FROM simulacion ORDER BY rowid DESC LIMIT 1"); const r = JSON.parse(x.resultado); return { p5: r.costo?.p5, p50: r.costo?.p50, p95: r.costo?.p95, prob: r.costo?.probSupera, bloq: r.bloqueadas }; });
  await page.waitForTimeout(300); await page.screenshot({ path: `${out}/G_montecarlo_resultado.png`, fullPage: true });
  // exportaciones
  for (const [sub, act] of [["excel06", "exp-06"], ["excel07", "exp-07"], ["excel08", "exp-08"], ["informe", "exp-informe"], ["ppt", "exp-ppt"]]) {
    await page.click('[data-tab="reportes"]'); await page.click(`[data-key="reportes"][data-sub="${sub}"]`); await page.waitForTimeout(200);
    t0 = Date.now();
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 300000 }), page.click(`[data-act="${act}"]`)]);
    const f = path.join(out, dl.suggestedFilename()); await dl.saveAs(f);
    R.tiempos[act + "_ms"] = Date.now() - t0; R["archivo_" + sub] = { f, bytes: fs.statSync(f).size };
  }
  // persistencia: recargar
  t0 = Date.now(); await page.reload(); await page.waitForSelector(".topnav"); await page.waitForTimeout(500);
  R.tiempos.reabrir_ms = Date.now() - t0;
  R.trasRecargar = await page.evaluate(() => window.__pc05.store.one("SELECT COUNT(*) n FROM corrida").n);
  R.errores = errors; console.log(JSON.stringify(R, null, 1)); await ctx.close();
})();
