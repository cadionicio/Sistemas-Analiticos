// E2E: fórmulas en notación LaTeX → ecuaciones nativas de Word (OMML) y fórmulas tipografiadas en el PDF.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';
const OUT = 'tests/e2e/formulas_latex'; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch(); const p = await (await b.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 768 } })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('file://' + process.cwd() + '/dist/index.html'); await p.click('#d-practica');
await p.waitForFunction(() => !document.querySelector('.velo') && document.querySelector('#kpi-ventas'), null, { timeout: 120000 });
await p.click('#btn-1clic'); await p.waitForTimeout(800); await p.waitForFunction(() => !document.querySelector('.velo'), null, { timeout: 300000 });
await p.evaluate(() => { location.hash = '#/informes'; }); await p.waitForTimeout(800);
for (const f of ['docx', 'pdf']) {
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.click(`button[data-acc=gen][data-tipo=tecnico][data-fmt=${f}]`)]);
  await d.saveAs(`${OUT}/${d.suggestedFilename()}`); await p.waitForTimeout(900);
}
console.log(JSON.stringify({ errs })); console.log(errs.length ? 'FALLA' : 'OK'); await b.close();
