// E2E I3: importar 05, costear 24 períodos, recorrer Resultados (6 subpestañas), editar supuesto, exportar Excel 07.
const { chromium } = require("playwright"); const path = require("path"); const fs = require("fs");
const [, , html, datos, out, modo] = process.argv; // modo "conI1": reproduce el recorrido real (verificación I1 antes de importar 05) fs.mkdirSync(out, { recursive: true });
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync("/tmp/claude-0/pw4-"), { viewport: { width: 1600, height: 900 }, offline: true, acceptDownloads: true });
  const page = await ctx.newPage(); const errors = []; const R = { pasos: [] };
  page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("file://" + path.resolve(html)); await page.waitForSelector(".topnav");
  if (modo === "conI1") { await page.click('[data-tab="inicio"]'); await page.click('[data-act="seed"]'); await page.waitForTimeout(800); R.conI1 = true; }
  await page.click('[data-tab="modelo"]'); const g = await page.$('[data-sub="gestion"]'); if (g) await g.click();
  await page.setInputFiles('input[data-edit="m2-import-pc05"]', path.resolve(datos)); await page.waitForTimeout(3000);
  // Resultados sin corridas: debe pedir ejecutar
  await page.click('[data-tab="resultados"]'); await page.waitForTimeout(300);
  R.sinCorridas = (await page.textContent("main")).includes("Aún no hay corridas guardadas");
  await page.screenshot({ path: out + "/R00_sin_corridas.png" });
  let t0 = Date.now(); await page.click('[data-act="run-abc-todos"]'); R.toastRun = await (await page.waitForFunction(() => { const t = document.querySelector(".toast")?.textContent || ""; return t.includes("Costeo ejecutado") ? t : null; }, null, { timeout: 15000 })).jsonValue(); R.msRun = Date.now() - t0;
  await page.waitForTimeout(300);
  // orden cronológico (defecto detectado por el estudiante en G3: oct-26 al inicio de la serie)
  R.periodoCtx = await page.$eval('select[data-edit="ctx-periodo"]', (e) => e.options[e.selectedIndex].text);
  R.periodoActual = await page.$eval("main p.muted b", (e) => e.textContent);
  R.primerEje = await page.$eval("main svg.viz-svg text.viz-ax:not([text-anchor='end'])", (e) => e.textContent);
  R.ordenOK = R.periodoActual === "Octubre 2026" && R.primerEje === "nov-24" && R.periodoCtx === "Octubre 2026";
  for (const sub of ["dashboard", "descriptivo", "diagnostico", "predictivo", "prescriptivo", "relevancia"]) {
    t0 = Date.now(); await page.click(`[data-key="resultados"][data-sub="${sub}"]`); await page.waitForTimeout(250);
    const txt = await page.textContent("main");
    R.pasos.push({ sub, ms: Date.now() - t0, svgs: await page.$$eval("main svg.viz-svg", (x) => x.length), nan: /NaN|undefined|Infinity/.test(txt) });
    await page.screenshot({ path: `${out}/R_${sub}.png`, fullPage: true });
  }
  // hover sobre el gráfico del dashboard → tooltip
  await page.click('[data-key="resultados"][data-sub="dashboard"]'); await page.waitForTimeout(200);
  const hit = (await page.$$("main .viz-hit"))[20]; const bb = await hit.boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(150);
  R.tooltip = await page.textContent(".viz-tip"); await page.screenshot({ path: out + "/R_dashboard_hover.png" });
  // predictivo: cambiar serie
  await page.click('[data-key="resultados"][data-sub="predictivo"]'); await page.selectOption('select[data-edit="res-serie"]', "1"); await page.waitForTimeout(250);
  R.predictivoSerie1 = (await page.$eval("main figcaption", (e) => e.textContent));
  await page.screenshot({ path: out + "/R_predictivo_volumen.png", fullPage: true });
  // prescriptivo: editar supuesto de la primera propuesta a 50 %
  await page.click('[data-key="resultados"][data-sub="prescriptivo"]'); await page.waitForTimeout(200);
  const inp = await page.$('input[data-edit="prop-pct"]'); R.propAntes = await inp.inputValue(); await inp.fill("50"); await inp.press("Tab"); await page.waitForTimeout(250);
  R.propDespues = await page.$eval('input[data-edit="prop-pct"]', (e) => e.value);
  // export 07
  await page.click('[data-tab="reportes"]'); await page.click('[data-key="reportes"][data-sub="excel07"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: out + "/R_reportes_07.png" });
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="exp-07"]')]);
  const f = path.join(out, dl.suggestedFilename()); await dl.saveAs(f); R.archivo07 = f; await page.waitForTimeout(300); R.toast07 = await page.textContent(".toast");
  R.errores = errors; console.log(JSON.stringify(R, null, 1)); await ctx.close();
})();
