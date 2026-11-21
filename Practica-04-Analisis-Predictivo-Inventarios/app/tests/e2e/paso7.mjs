// E2E del Paso 7: pronóstico a 6 meses de ventas y Kardex en el HTML único.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('file://' + process.cwd() + '/dist/index.html'); await p.waitForSelector('#tablas');
await p.setInputFiles('#archivo', ['tests/fixtures/ventas.xlsx', 'tests/fixtures/kardex.xls']);
await p.waitForSelector('#msg[data-listo="1"]', { timeout: 90000 });
const t0 = Date.now(); await p.click('#pronosticar'); await p.waitForSelector('#pronostico[data-listo="1"]', { timeout: 180000 });
const r = { ms: Date.now() - t0, pv: await p.textContent('#st-pv'), pk: await p.textContent('#st-pk'), prob: await p.textContent('#prob'), errores: errs };
await p.locator('#pronostico').screenshot({ path: 'tests/e2e/paso7_pronostico.png' });
console.log(JSON.stringify(r));
const ok = ['OK', 'PROVISIONAL'].includes(r.pv) && ['OK', 'PROVISIONAL'].includes(r.pk) && errs.length === 0;
console.log(ok ? 'E2E PASO 7: OK' : 'E2E PASO 7: FALLA'); await b.close(); process.exit(ok ? 0 : 1);
