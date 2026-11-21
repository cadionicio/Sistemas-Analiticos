// E2E del Paso 9: interfaz completa (14 pantallas) sobre el HTML único, abierto con file:// como lo haría el docente.
// Flujo: abrir → "Cargar datos de la práctica" → "Análisis completo en 1 clic" → visitar cada pantalla → capturas → sin errores de consola.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const W = +(process.env.ANCHO ?? 1366), H = +(process.env.ALTO ?? 768), TEMA = process.env.TEMA ?? 'claro';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: W, height: H } });
const errs = []; p.on('pageerror', (e) => errs.push('pageerror: ' + e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const dir = `tests/e2e/paso9_${TEMA}_${W}`; await import('node:fs').then((fs) => fs.mkdirSync(dir, { recursive: true }));
const r = {};
let t = Date.now();
await p.goto('file://' + process.cwd() + '/dist/index.html'); await p.waitForSelector('.menu a');
r.arranque_ms = Date.now() - t;
await p.screenshot({ path: `${dir}/00_inicio_vacio.png` });
t = Date.now(); await p.click('#d-practica'); await p.waitForFunction(() => !document.querySelector('.velo') && document.querySelector('#kpi-ventas'), null, { timeout: 120000 });
r.carga_ms = Date.now() - t;
if (TEMA === 'oscuro') { await p.goto(p.url().split('#')[0] + '#/configuracion'); await p.waitForSelector('input[value=oscuro]'); await p.check('input[value=oscuro]'); await p.waitForTimeout(400); }
t = Date.now(); await p.click('#btn-1clic'); await p.waitForSelector('.velo .pasos'); await p.waitForTimeout(1500);
await p.screenshot({ path: `${dir}/01_super_agente_en_progreso.png` });
await p.waitForFunction(() => !document.querySelector('.velo'), null, { timeout: 300000 });
r.analisis_ms = Date.now() - t;
const pantallas = ['dashboard', 'datos', 'descriptivo', 'diagnostico', 'predictivo', 'prescriptivo', 'simulacion', 'copiloto', 'informes', 'practicas', 'alertas', 'configuracion', 'bitacora', 'acerca'];
r.pantallas = {};
for (const [i, id] of pantallas.entries()) {
  const t1 = Date.now();
  await p.evaluate((h) => { location.hash = h; }, '#/' + id);
  await p.waitForFunction((h) => document.querySelector(`.menu a[data-id="${h}"]`)?.classList.contains('activo') && document.querySelector('#contenido').children.length > 0, id, { timeout: 30000 });
  await p.waitForTimeout(1100);
  await p.evaluate(() => document.querySelector('.avisos')?.remove()); // capturas limpias (los avisos se cierran solos)
  r.pantallas[id] = { ms: Date.now() - t1, graficos: await p.locator('.grafico canvas').count(), tablas: await p.locator('table.t').count(), titulo: await p.textContent('#titulo') };
  await p.screenshot({ path: `${dir}/${String(i + 2).padStart(2, '0')}_${id}.png`, fullPage: false });
  await p.locator('#contenido').evaluate((c) => c.scrollTo(0, c.scrollHeight));
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${dir}/${String(i + 2).padStart(2, '0')}_${id}_abajo.png` });
}
// Pestaña Kardex del descriptivo y del diagnóstico
for (const id of ['descriptivo', 'diagnostico']) {
  await p.evaluate((h) => { location.hash = h; }, '#/' + id); await p.waitForTimeout(600);
  await p.click('.pestanas button:nth-child(2)'); await p.waitForTimeout(700);
  await p.screenshot({ path: `${dir}/${id}_kardex.png` });
}
// RF-03: filtro de departamento en el dashboard (< 2 s)
await p.evaluate(() => { location.hash = '#/dashboard'; }); await p.waitForSelector('#f-dep');
const v0 = await p.textContent('#kpi-ventas .v');
t = Date.now(); await p.selectOption('#f-dep', 'Lima'); await p.waitForFunction((v) => document.querySelector('#kpi-ventas .v')?.textContent !== v, v0);
r.filtro_ms = Date.now() - t; r.ventas_todos = v0; r.ventas_lima = await p.textContent('#kpi-ventas .v');
await p.waitForTimeout(600); await p.screenshot({ path: `${dir}/dashboard_filtro_lima.png` });
// Tiempo real: registro manual de una venta → KPI cambia
await p.selectOption('#f-dep', '');
await p.evaluate(() => { location.hash = '#/datos'; }); await p.waitForSelector('#f-venta');
await p.fill('#f-venta [name=fecha]', '2019-03-20'); await p.fill('#f-venta [name=sku]', 'K00401'); await p.fill('#f-venta [name=soles]', '1000000'); await p.fill('#f-venta [name=utilidad]', '50000'); await p.fill('#f-venta [name=departamento]', 'Lima');
await p.click('#f-venta button'); await p.waitForTimeout(1200);
await p.evaluate(() => { location.hash = '#/dashboard'; }); await p.waitForSelector('#kpi-ventas'); await p.waitForTimeout(500);
r.ventas_tras_manual = await p.textContent('#kpi-ventas .v'); r.sello = await p.textContent('#chip-sello');
// Simulación personalizada en segundo plano
await p.evaluate(() => { location.hash = '#/simulacion'; }); await p.waitForSelector('#sm-btn');
await p.fill('#sm-iter', '3000'); t = Date.now(); await p.click('#sm-btn');
await p.waitForFunction(() => document.querySelector('#sm-esc')?.value === 'Personalizado', null, { timeout: 180000 });
r.sim_ms = Date.now() - t; await p.waitForTimeout(700); await p.screenshot({ path: `${dir}/simulacion_personalizado.png` });
// Aprobar la propuesta
await p.evaluate(() => { location.hash = '#/prescriptivo'; }); await p.waitForSelector('#ap-btn');
await p.click('#ap-btn'); await p.click('.velo button[data-r="1"]'); await p.waitForTimeout(1200);
r.aprobado = (await p.textContent('#contenido')).includes('Propuesta aprobada');
r.errores = errs;
console.log(JSON.stringify(r, null, 1));
const ok = errs.length === 0 && r.aprobado && r.filtro_ms < 2000 && Object.values(r.pantallas).every((x) => x.titulo) && r.ventas_tras_manual !== r.ventas_todos;
console.log(ok ? 'E2E PASO 9: OK' : 'E2E PASO 9: FALLA'); await b.close(); process.exit(ok ? 0 : 1);
