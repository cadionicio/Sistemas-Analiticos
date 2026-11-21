// Prueba E2E del Paso 4: el HTML de un solo archivo abre por file://, crea la BD (sql.js WASM embebido)
// e importa el Excel real de ventas en Chromium.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const t0 = Date.now();
await p.goto('file://' + process.cwd() + '/dist/index.html');
await p.waitForSelector('#tablas', { timeout: 20000 });
const tablas = await p.textContent('#tablas');
await p.setInputFiles('#archivo', 'tests/fixtures/ventas.xlsx');
await p.waitForSelector('#resumen', { timeout: 60000 });
const r = { tablas, estado: await p.textContent('#estado'), filas: await p.textContent('#filas'), ultimo: await p.textContent('#ultimo'), calidad: await p.textContent('#calidad'), ms: Date.now() - t0, errores: errs };
await p.screenshot({ path: 'tests/e2e/paso4_importacion.png', fullPage: true });
console.log(JSON.stringify(r));
const ok = r.tablas === '24' && r.estado === 'DATOS_VALIDADOS' && r.filas === '20,000 / 20,000' && r.ultimo === '2019-03' && errs.length === 0;
console.log(ok ? 'E2E PASO 4: OK' : 'E2E PASO 4: FALLA');
await b.close(); process.exit(ok ? 0 : 1);
