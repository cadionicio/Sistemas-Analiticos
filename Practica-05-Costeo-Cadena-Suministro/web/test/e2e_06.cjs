const { chromium } = require("playwright"); const path = require("path"); const fs = require("fs");
const [, , html, datos, out] = process.argv; fs.mkdirSync(out, { recursive: true });
(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync("/tmp/claude-0/pw3-"), { viewport: { width: 1600, height: 900 }, offline: true, acceptDownloads: true });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("file://" + path.resolve(html)); await page.waitForSelector(".topnav");
  await page.click('[data-tab="modelo"]'); await page.setInputFiles('input[data-edit="m2-import-pc05"]', path.resolve(datos)); await page.waitForTimeout(3000);
  await page.click('[data-tab="reportes"]'); const t0 = Date.now(); await page.click('[data-act="run-abc-todos"]'); await page.waitForTimeout(500);
  const toastRun = await page.textContent(".toast"); const msRun = Date.now() - t0;
  await page.click('[data-tab="reportes"]');
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click('[data-act="exp-06"]')]);
  const f = path.join(out, dl.suggestedFilename()); await dl.saveAs(f);
  await page.screenshot({ path: out + "/reportes.png" });
  console.log(JSON.stringify({ toastRun, msRun, archivo: f, errores: errors }));
  await ctx.close();
})();
