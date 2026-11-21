// Regresión DEFECTO-G3-01 en Excel 06: con la verificación I1 cargada antes, Resumen_por_Periodo debe ir de 2024-11 a 2026-10.
const { chromium } = require("playwright"); const path = require("path"); const fs = require("fs");
const [, , html, datos, out] = process.argv; fs.mkdirSync(out, { recursive: true });
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync("/tmp/claude-0/pw9-"), { viewport: { width: 1600, height: 900 }, offline: true, acceptDownloads: true });
  const page = await ctx.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("file://" + path.resolve(html)); await page.waitForSelector(".topnav");
  await page.click('[data-act="seed"]'); await page.waitForTimeout(800);
  await page.click('[data-tab="modelo"]'); const g = await page.$('[data-sub="gestion"]'); if (g) await g.click();
  await page.setInputFiles('input[data-edit="m2-import-pc05"]', path.resolve(datos)); await page.waitForTimeout(3000);
  await page.click('[data-tab="reportes"]'); await page.click('[data-act="run-abc-todos"]'); await page.waitForTimeout(2500);
  const per = await page.$eval('select[data-edit="ctx-periodo"]', (e) => [...e.options].map((o) => o.text));
  await page.selectOption('select[data-edit="ctx-periodo"]', { label: "Octubre 2026" }); await page.waitForTimeout(400);
  await page.click('[data-tab="reportes"]'); await page.click('[data-key="reportes"][data-sub="excel06"]').catch(() => {});
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="exp-06"]')]);
  const f = path.join(out, dl.suggestedFilename()); await dl.saveAs(f);
  console.log(JSON.stringify({ selectorPrimero: per[0], selectorUltimo: per.at(-1), nSelector: per.length, archivo: f, errores: errors }));
  await ctx.close();
})();
