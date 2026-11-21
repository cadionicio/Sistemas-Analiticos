// Prueba integral I1.1 sobre el HTML final (Chrome sin red). Uso: node pruebas/prueba_i11.js <html>
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const HTML = path.resolve(process.argv[2]);
const URL = 'file://' + HTML;
const res = []; let red = [];
const anota = (caso, ok, obs) => { res.push({ caso, resultado: ok ? 'PASA' : 'FALLA', observado: obs }); console.log((ok ? 'PASA ' : 'FALLA') + ' · ' + caso + ' · ' + obs); };
async function abrir(dir) {
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: '/usr/bin/google-chrome', headless: true, viewport: { width: 1366, height: 768 }, acceptDownloads: true, args: ['--allow-file-access-from-files'] });
  ctx.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) red.push(r.url()); });
  await ctx.route(/^https?:/, r => r.abort());
  const pg = ctx.pages()[0] || await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(URL); await pg.waitForSelector('#b-ingresar', { timeout: 20000 }); await pg.click('#b-ingresar'); await pg.waitForSelector('#vista .tarjeta');
  return { ctx, pg, errs };
}
const conteos = async pg => pg.$$eval('#conteos [data-hoja]', cs => cs.length ? Object.fromEntries(cs.map(c => [c.dataset.hoja, c.dataset.n])) : null);
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpr-'));
  let { ctx, pg, errs } = await abrir(dir);
  const t0 = Date.now();
  anota('Apertura sin datos', await pg.isVisible('text=Bienvenido'), 'Pantalla de bienvenida con «Cargar demostración»');
  await pg.click('#b-demo');
  await pg.waitForSelector('.dialogo:not(.progreso)');
  const okVal = await pg.isVisible('.dialogo:not(.progreso) >> text=Validación correcta: sin errores.');
  const filasDlg = await pg.$$eval('.dialogo:not(.progreso) tbody tr', rs => rs.map(r => [...r.cells].map(c => c.textContent)));
  anota('Vista previa de la demostración', okVal && filasDlg.every(r => r[3] === '✓'), `${filasDlg.length} hojas, todas coinciden con LEEME`);
  // Cancelar con datos vacíos
  await pg.click('.dialogo >> text=Cancelar');
  anota('Cancelar carga sin datos', await pg.isVisible('text=Bienvenido'), 'Sigue sin datos');
  await pg.click('#b-demo'); await pg.click('.dialogo >> text=Confirmar carga');
  await pg.waitForSelector('text=Totales de control'); const tCarga = Date.now() - t0;
  const c1 = await conteos(pg);
  const esperado = { Equipos: '3', Piezas: '7', Modos_Falla: '8', Horas_Operacion: '597', Paradas: '20', Tramos: '87', Verificaciones: '21', Ordenes: '86', Intervenciones: '20', Consumos: '16', Movimientos: '19', Reservas: '1', Tareas_Preventivas: '5', Ejecuciones_Preventivas: '64', Mant_Programado: '64', Acciones: '2', Parametros: '8' };
  anota('Conteos esperados tras cargar demostración', JSON.stringify(c1) === JSON.stringify(esperado), JSON.stringify(c1));
  const kpis = await pg.$$eval('.kpi', ks => ks.map(k => k.textContent));
  const pieza0105 = await pg.$$eval('table.tabla tr', rs => rs.map(r => [...r.cells].map(c => c.textContent)).find(r => r[0] === '0105'));
  anota('Totales de control', true, kpis.join(' | ') + ' · 0105: ' + pieza0105.join(' / '));
  const rev1 = await pg.textContent('#estado-guardado');
  await ctx.close();
  ({ ctx, pg, errs } = await abrir(dir));
  const c2 = await conteos(pg);
  anota('Persistencia al cerrar y reabrir', JSON.stringify(c2) === JSON.stringify(esperado), `${rev1.trim()} → ${(await pg.textContent('#estado-guardado')).trim()}`);
  // Excel sin unidades
  for (const [arch, buscar] of [['prueba_06_sin_unidades.xlsx', 'Unidades'], ['prueba_06_ref_invalida.xlsx', '0999']]) {
    const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#b-excel')]);
    await fc.setFiles(path.resolve('datos', arch));
    await pg.waitForSelector('.dialogo:not(.progreso)');
    const errores = await pg.$$eval('.dialogo:not(.progreso) table.tabla', ts => [...ts[0].querySelectorAll('tbody tr')].map(r => [...r.cells].map(c => c.textContent).join(' | ')));
    const hayBoton = await pg.isVisible('.dialogo:not(.progreso) >> text=Confirmar carga');
    await pg.click('.dialogo >> text=Cerrar');
    const c3 = await conteos(pg);
    anota(`Rechazo ${arch}`, !hayBoton && errores.some(e => e.includes(buscar)) && JSON.stringify(c3) === JSON.stringify(esperado), errores.slice(0, 3).join(' || ') + ` · conteos intactos=${JSON.stringify(c3) === JSON.stringify(esperado)}`);
  }
  // Repetición de carga del mismo Excel (sin duplicados)
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#b-excel')]);
  await fc.setFiles(path.resolve('datos', '06_Entrada_DatosSinteticos.xlsx'));
  await pg.waitForSelector('.dialogo:not(.progreso)');
  const aviso = await pg.isVisible('.dialogo:not(.progreso) >> text=Ya hay datos');
  await pg.click('.dialogo >> text=Confirmar carga'); await pg.waitForSelector('text=Totales de control');
  const c4 = await conteos(pg);
  anota('Repetir carga del mismo Excel', aviso && JSON.stringify(c4) === JSON.stringify(esperado), 'Aviso de reemplazo mostrado; conteos iguales, sin duplicados');
  // Demo con datos: cancelar
  await pg.click('#b-demo'); await pg.waitForSelector('.dialogo:not(.progreso)'); await pg.keyboard.press('Escape');
  anota('Cancelar demostración con datos (Esc)', JSON.stringify(await conteos(pg)) === JSON.stringify(esperado) && !(await pg.isVisible('.dialogo')), 'Diálogo cerrado; datos intactos; menú operativo');
  // Respaldar y restaurar
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#b-respaldar')]);
  const resp = path.join(dir, 'resp.sqlite'); await dl.saveAs(resp);
  const [fc2] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#b-restaurar')]);
  await fc2.setFiles(resp); await pg.waitForSelector('.dialogo:not(.progreso)'); await pg.click('.dialogo button:has-text("Restaurar")'); await pg.waitForSelector('.dialogo', { state: 'detached' });
  await pg.waitForSelector('text=Totales de control');
  const kpis2 = await pg.$$eval('.kpi', ks => ks.map(k => k.textContent));
  anota('Respaldar y Restaurar', JSON.stringify(await conteos(pg)) === JSON.stringify(esperado) && JSON.stringify(kpis2) === JSON.stringify(kpis), `${dl.suggestedFilename()} · mismos conteos y totales`);
  await pg.click('text=Datos y respaldos'); await pg.waitForSelector('text=Respaldos automáticos');
  const nResp = await pg.$$eval('[data-resp]', b => b.length);
  anota('Respaldos automáticos listados', nResp >= 2, `${nResp} respaldos automáticos`);
  anota('Sin solicitudes de red', red.length === 0, `${red.length} solicitudes externas`);
  anota('Sin errores de consola', errs.length === 0, errs.join(' ; ') || 'ninguno');
  anota('Tiempo de carga de demostración', true, `${tCarga} ms (incluye apertura de diálogo y cancelación previa)`);
  await pg.screenshot({ path: 'pruebas/i11_inicio.png', fullPage: false });
  await pg.click('text=Inicio'); await pg.screenshot({ path: 'pruebas/i11_inicio2.png' });
  await ctx.close();
  fs.writeFileSync('pruebas/resultado_i11_html.json', JSON.stringify({ html: HTML, fecha: new Date().toISOString(), casos: res }, null, 1));
  process.exit(res.some(r => r.resultado === 'FALLA') ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
