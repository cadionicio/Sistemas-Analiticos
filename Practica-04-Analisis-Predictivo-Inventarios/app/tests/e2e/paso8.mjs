// E2E del Paso 8: prescriptivo + Monte Carlo (10 000 iteraciones) en el HTML único.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('file://' + process.cwd() + '/dist/index.html'); await p.waitForSelector('#tablas');
await p.setInputFiles('#archivo', ['tests/fixtures/ventas.xlsx', 'tests/fixtures/kardex.xls']);
await p.waitForSelector('#msg[data-listo="1"]', { timeout: 90000 });
const t0 = Date.now(); await p.click('#prescribir'); await p.waitForSelector('#prescriptivo[data-listo="1"]', { timeout: 300000 });
const r = { ms: Date.now() - t0, pr: await p.textContent('#st-pr'), sm: await p.textContent('#st-sm'), recs: await p.locator('#recs tr').count(), caso: await p.textContent('#caso'), errores: errs };
await p.locator('#prescriptivo').screenshot({ path: 'tests/e2e/paso8_prescriptivo.png' });
console.log(JSON.stringify(r));
const ok = ['OK', 'PROVISIONAL'].includes(r.pr) && r.sm === 'OK' && r.recs >= 7 && errs.length === 0;
console.log(ok ? 'E2E PASO 8: OK' : 'E2E PASO 8: FALLA'); await b.close(); process.exit(ok ? 0 : 1);
