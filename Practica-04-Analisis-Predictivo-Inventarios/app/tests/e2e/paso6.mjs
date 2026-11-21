// E2E del Paso 6: carga los 2 Excel y ejecuta descriptivo + diagnóstico + Evaluador en el HTML único.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('file://' + process.cwd() + '/dist/index.html'); await p.waitForSelector('#tablas');
await p.setInputFiles('#archivo', ['tests/fixtures/ventas.xlsx', 'tests/fixtures/kardex.xls']);
await p.waitForSelector('#msg[data-listo="1"]', { timeout: 90000 });
const t0 = Date.now(); await p.click('#analizar'); await p.waitForSelector('#analisis[data-listo="1"]', { timeout: 60000 });
const r = { ms: Date.now() - t0, kpi: await p.textContent('#kpi-ventas'), pvm: await p.textContent('#pvm'), dv: await p.textContent('#st-dv'), gv: await p.textContent('#st-gv'), kk: await p.textContent('#kpi-kardex'), errores: errs };
await p.locator('#analisis').screenshot({ path: 'tests/e2e/paso6_analisis.png' });
console.log(JSON.stringify(r));
const ok = /S\/ 1,045.6 M/.test(r.kpi) && r.dv === 'OK/EVALUADO' && r.gv === 'OK/EVALUADO' && errs.length === 0;
console.log(ok ? 'E2E PASO 6: OK' : 'E2E PASO 6: FALLA'); await b.close(); process.exit(ok ? 0 : 1);
