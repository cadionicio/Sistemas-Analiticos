// E2E del Paso 12 (lado web del EXE): se emula el anfitrión de Go (http://sadpgi.localhost/ con /__host/*) y se prueba:
// servir la página en memoria, persistencia de la BD y de los resultados al "cerrar y reabrir", «Guardar como» nativo,
// cierre ordenado, modo sin rastro y aviso de solo lectura (EXE dentro del ZIP).
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const OUT = 'tests/e2e/paso12'; mkdirSync(OUT, { recursive: true });
const html = readFileSync('dist/index.html');
const disco = { bd: null, config: null, guardados: [], cerrar: 0 }; // "carpeta oculta" simulada
const r = {};
async function abrir(soloLectura = false) {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.route('http://sadpgi.localhost/**', async (route) => {
    const q = route.request(), u = new URL(q.url()), m = q.method();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/' ) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (u.pathname === '/__host/info') return json({ modo: 'EXE', version: '1.0.0', soloLectura, carpetaDatos: 'C:\\...\\07_Sistema_Analisis_Predictivo_Inventarios_datos', sinRastro: !!disco.config?.sinRastro });
    if (u.pathname === '/__host/bd' && m === 'GET') return disco.bd && !soloLectura ? route.fulfill({ status: 200, contentType: 'application/octet-stream', body: disco.bd }) : route.fulfill({ status: 204, body: '' });
    if (u.pathname === '/__host/bd' && m === 'POST') { if (soloLectura) return json({ ok: false, error: 'solo_lectura' }); disco.bd = q.postDataBuffer(); return json({ ok: true, bytes: disco.bd.length }); }
    if (u.pathname === '/__host/config') { disco.config = JSON.parse(q.postData()); return json({ ok: true }); }
    if (u.pathname === '/__host/guardar') { const nombre = u.searchParams.get('nombre'); const buf = q.postDataBuffer(); disco.guardados.push({ nombre, bytes: buf.length }); writeFileSync(`${OUT}/${nombre}`, buf); return json({ ok: true, ruta: `C:\\Users\\VICTUS\\Documents\\${nombre}` }); }
    if (u.pathname === '/__host/cerrar') { disco.cerrar++; return json({ ok: true }); }
    return route.fulfill({ status: 404, body: 'No encontrado' });
  });
  await p.goto('http://sadpgi.localhost/'); await p.waitForSelector('.menu a');
  return { b, p, errs };
}
// 1) Primera ejecución: cargar datos, analizar, cambiar tema, exportar un Excel y un informe con "Guardar como", cerrar.
let { b, p, errs } = await abrir();
r.modo = await p.evaluate(() => location.origin);
await p.click('#d-practica'); await p.waitForFunction(() => !document.querySelector('.velo') && document.querySelector('#kpi-ventas'), null, { timeout: 120000 });
await p.click('#btn-1clic'); await p.waitForTimeout(800); await p.waitForFunction(() => !document.querySelector('.velo'), null, { timeout: 300000 });
await p.evaluate(() => { location.hash = '#/configuracion'; }); await p.waitForSelector('#sin-rastro');
r.textoUbicacion = (await p.textContent('#contenido')).includes('Carpeta oculta');
await p.check('#sin-rastro'); await p.waitForTimeout(400);
await p.evaluate(() => { location.hash = '#/informes'; }); await p.waitForTimeout(800);
await p.click('button[data-acc=gen][data-tipo=ejecutivo][data-fmt=docx]'); await p.waitForFunction(() => document.querySelectorAll('#inf-raiz table.t tbody tr').length > 0, null, { timeout: 60000 });
await p.evaluate(() => { location.hash = '#/descriptivo'; }); await p.waitForTimeout(800);
await p.click('.exportar'); await p.waitForTimeout(1200);
await p.evaluate(() => document.querySelector('.avisos')?.remove());
await p.screenshot({ path: `${OUT}/01_exe_primera_ejecucion.png` });
const ventasAntes = await p.evaluate(async () => { location.hash = '#/dashboard'; await new Promise((ok) => setTimeout(ok, 900)); return document.querySelector('#kpi-ventas .v')?.textContent; });
await p.evaluate(() => window.__sadpgiAntesDeCerrar()); // lo que hace el EXE al recibir WM_CLOSE
r.bdGuardadaBytes = disco.bd?.length ?? 0; r.cerrarConfirmado = disco.cerrar; r.config = disco.config; r.guardados = disco.guardados.map((g) => g.nombre);
r.errores1 = errs; await b.close();
// 2) Segunda ejecución: los datos y resultados deben seguir ahí sin recalcular.
({ b, p, errs } = await abrir());
await p.waitForSelector('#kpi-ventas', { timeout: 30000 }); await p.waitForTimeout(1200);
r.ventasDespues = await p.textContent('#kpi-ventas .v'); r.ventasAntes = ventasAntes;
r.selloTrasReabrir = await p.textContent('#chip-sello');
r.proyeccionTrasReabrir = (await p.textContent('#contenido')).includes('P50 6 meses');
await p.evaluate(() => { location.hash = '#/informes'; }); await p.waitForTimeout(900);
r.versionesTrasReabrir = await p.locator('#inf-raiz table.t tbody tr').count();
await p.evaluate(() => document.querySelector('.avisos')?.remove());
await p.screenshot({ path: `${OUT}/02_exe_reabierto_persistencia.png` });
r.errores2 = errs; await b.close();
// 3) EXE ejecutado desde dentro del ZIP: aviso de solo lectura, sin escribir la BD.
const antes = disco.bd?.length;
({ b, p, errs } = await abrir(true));
await p.waitForTimeout(1500);
r.avisoSoloLectura = await p.evaluate(() => [...document.querySelectorAll('.chip.aviso')].some((x) => /extraiga el ZIP/i.test(x.textContent)));
await p.screenshot({ path: `${OUT}/03_exe_desde_zip.png` });
r.bdNoModificadaEnZip = disco.bd?.length === antes; r.errores3 = errs; await b.close();
console.log(JSON.stringify(r, null, 1));
const ok = r.bdGuardadaBytes > 100000 && r.cerrarConfirmado >= 1 && r.config?.sinRastro === true && r.guardados.length >= 2 && r.ventasDespues === r.ventasAntes && r.proyeccionTrasReabrir && r.versionesTrasReabrir >= 1 && r.avisoSoloLectura && r.bdNoModificadaEnZip && !r.errores1.length && !r.errores2.length && !r.errores3.length;
console.log(ok ? 'E2E PASO 12 (anfitrión EXE): OK' : 'E2E PASO 12 (anfitrión EXE): FALLA'); process.exit(ok ? 0 : 1);
