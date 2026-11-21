// E2E I4: escenarios, Monte Carlo (T13 reproducible, T48 cancelación), comparativo, alternativas, EVA, T49/T77 histórico intacto, Excel 08.
const { chromium } = require("playwright"); const path = require("path"); const fs = require("fs");
const [, , html, datos, out] = process.argv; fs.mkdirSync(out, { recursive: true });
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync("/tmp/claude-0/pw10-"), { viewport: { width: 1600, height: 900 }, offline: true, acceptDownloads: true });
  const page = await ctx.newPage(); const errors = []; const R = {};
  page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("file://" + path.resolve(html)); await page.waitForSelector(".topnav");
  await page.click('[data-tab="modelo"]'); const g = await page.$('[data-sub="gestion"]'); if (g) await g.click();
  await page.setInputFiles('input[data-edit="m2-import-pc05"]', path.resolve(datos)); await page.waitForTimeout(3000);
  await page.click('[data-tab="resultados"]'); await page.click('[data-act="run-abc-todos"]');
  await page.waitForFunction(() => (document.querySelector(".toast")?.textContent || "").includes("Costeo ejecutado"), null, { timeout: 20000 });
  const huella = () => page.evaluate(() => { const s = window.__pc05.store; return JSON.stringify([s.one("SELECT COUNT(*) n, MAX(creado_en) m FROM corrida"), s.one("SELECT COUNT(*) n, ROUND(SUM(importe),2) t FROM asignacion"), s.one("SELECT COUNT(*) n, ROUND(SUM(monto),2) t FROM ec_monto"), s.one("SELECT ROUND(SUM(costo_factura),4) t FROM material")]); });
  R.huellaAntes = await huella();
  const nSim = () => page.evaluate(() => window.__pc05.store.one("SELECT COUNT(*) n FROM simulacion").n);
  const simular = async (esc, semilla, iter, nombre) => {
    await page.click('[data-tab="simulacion"]'); await page.click('[data-key="simulacion"][data-sub="montecarlo"]');
    await page.selectOption('select[data-edit="sim-esc"]', esc); await page.waitForTimeout(150);
    await page.fill("#sim-semilla", String(semilla)); await page.fill("#sim-iter", String(iter));
    const n0 = await nSim(); const t0 = Date.now(); await page.click('[data-act="sim-correr"]');
    await page.waitForFunction((n) => window.__pc05.store.one("SELECT COUNT(*) n FROM simulacion").n > n && !window.__pc05.app.simEstado, n0, { timeout: 120000 });
    const ms = Date.now() - t0; await page.waitForTimeout(300);
    if (nombre) await page.screenshot({ path: `${out}/${nombre}.png`, fullPage: true });
    return { ms, r: await page.evaluate(() => { const x = window.__pc05.store.one("SELECT id, semilla, iteraciones, resultado, ms FROM simulacion ORDER BY rowid DESC LIMIT 1"); const r = JSON.parse(x.resultado); return { id: x.id, ms: x.ms, p5: r.costo.p5, p50: r.costo.p50, p95: r.costo.p95, prob: r.costo.probSupera, eva50: r.eva && r.eva.p50, bloq: r.bloqueadas }; }) };
  };
  // escenarios importados
  await page.click('[data-tab="simulacion"]'); await page.waitForTimeout(200);
  R.escenarios = await page.$$eval("main table.matrix tbody tr td:first-child b", (xs) => xs.map((x) => x.textContent));
  await page.screenshot({ path: out + "/S01_escenarios.png", fullPage: true });
  await page.click('[data-key="simulacion"][data-sub="variables"]'); await page.selectOption('select[data-edit="sim-esc"]', "Optimista"); await page.waitForTimeout(200);
  R.variablesOptimista = await page.$$eval("main table.matrix tbody tr", (xs) => xs.map((x) => x.textContent.replace(/\s+/g, " ").slice(0, 60)));
  await page.screenshot({ path: out + "/S02_variables_optimista.png", fullPage: true });
  // desempeño 5000 iteraciones
  R.perf5000 = await simular("Base", 1, 5000, null);
  // T48 cancelación
  await page.fill("#sim-semilla", "7"); await page.fill("#sim-iter", "8000"); const nAntesCancel = await nSim();
  await page.click('[data-act="sim-correr"]'); await page.waitForTimeout(700);
  await page.screenshot({ path: out + "/S03_monte_carlo_en_curso.png" });
  await page.click('[data-act="sim-cancelar"]');
  await page.waitForFunction(() => !window.__pc05.app.simEstado, null, { timeout: 10000 }); await page.waitForTimeout(200);
  R.T48 = { toast: await page.textContent(".toast"), simulacionesAntes: nAntesCancel, simulacionesDespues: await nSim() };
  // T13 reproducibilidad
  const a = await simular("Base", 20261105, 2000, "S04_monte_carlo_base"), b = await simular("Base", 20261105, 2000, null), c = await simular("Base", 99, 2000, null);
  R.T13 = { igualSemilla: a.r.p50 === b.r.p50 && a.r.p95 === b.r.p95 && a.r.prob === b.r.prob, distintaSemilla: a.r.p50 !== c.r.p50, base: a.r, otraSemilla: c.r };
  await simular("Base", 20261105, 2000, null); // dejar la semilla estándar como última de Base
  R.optimista = (await simular("Optimista", 20261105, 2000, null)).r;
  R.pesimista = (await simular("Pesimista", 20261105, 2000, null)).r;
  R.T15 = { pesimistaMenorEVA: R.pesimista.eva50 < a.r.eva50, optimistaMayorEVA: R.optimista.eva50 > a.r.eva50 };
  for (const [sub, f] of [["comparativo", "S05_comparativo"], ["alternativas", "S06_alternativas"], ["eva", "S07_eva"]]) {
    await page.click(`[data-key="simulacion"][data-sub="${sub}"]`); await page.waitForTimeout(250); await page.screenshot({ path: `${out}/${f}.png`, fullPage: true });
    R["texto_" + sub] = (await page.textContent("main")).match(/(EVA anual base|ΔEVA del plan|Probabilidad)[^S]*S\/ ?[-\d.,]+/g)?.slice(0, 3) || null;
    R["nan_" + sub] = /NaN|undefined|Infinity/.test(await page.textContent("main"));
  }
  // T49 / T77: histórico intacto
  R.huellaDespues = await huella();
  R.T49 = R.huellaAntes === R.huellaDespues;
  await page.click('[data-tab="resultados"]'); await page.click('[data-key="resultados"][data-sub="dashboard"]'); await page.waitForTimeout(250);
  R.dashboardTrasSimular = await page.$eval("main .kpi .val", (e) => e.textContent);
  // Excel 08
  await page.click('[data-tab="reportes"]'); await page.click('[data-key="reportes"][data-sub="excel08"]'); await page.waitForTimeout(250);
  await page.screenshot({ path: out + "/S08_reportes_08.png" });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="exp-08"]')]);
  const f = path.join(out, dl.suggestedFilename()); await dl.saveAs(f); R.archivo08 = f;
  await page.waitForTimeout(300); R.toast08 = await page.textContent(".toast");
  R.errores = errors; console.log(JSON.stringify(R, null, 1)); await ctx.close();
})();
