// E2E del Paso 5: HTML de un solo archivo → carga los 2 Excel reales, muestra calidad y registra movimientos manuales.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto('file://' + process.cwd() + '/dist/index.html');
await p.waitForSelector('#tablas');
const t0 = Date.now();
await p.setInputFiles('#archivo', ['tests/fixtures/ventas.xlsx', 'tests/fixtures/kardex.xls']);
await p.waitForSelector('#msg[data-listo="1"]', { timeout: 90000 });
const tCarga = Date.now() - t0;
await p.click('#k-guardar'); await p.waitForTimeout(300);
const kRes = await p.textContent('#k-res');
await p.click('#v-guardar'); await p.waitForTimeout(300);
const vRes = await p.textContent('#v-res');
const r = { filasVentas: await p.textContent('#filas-ventas'), filasKardex: await p.textContent('#filas-kardex'),
  k01: await p.locator('#calidad-kardex tr', { hasText: 'K01' }).count(), kRes, vRes, tCargaMs: tCarga, errores: errs };
await p.screenshot({ path: 'tests/e2e/paso5_ingesta_calidad.png', fullPage: true });
console.log(JSON.stringify(r));
const ok = r.filasVentas === '20,001' && r.filasKardex === '6,135' && r.k01 === 1 && /Registrado/.test(kRes) && /registrada/.test(vRes) && errs.length === 0;
console.log(ok ? 'E2E PASO 5: OK' : 'E2E PASO 5: FALLA'); await b.close(); process.exit(ok ? 0 : 1);
