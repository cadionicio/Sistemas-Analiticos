// Prueba integral del contenedor Electron (mismo main.js/preload.js/HTML del EXE) en Linux con Xvfb.
// No sustituye la apertura del EXE en Windows.
const { _electron: electron } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const res = [];
const anota = (caso, ok, obs) => { res.push({ caso, resultado: ok ? 'PASA' : 'FALLA', observado: obs }); console.log((ok ? 'PASA ' : 'FALLA') + ' · ' + caso + ' · ' + obs); };
const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpr-exe-'));
const lanzar = () => electron.launch({ executablePath: require.resolve('electron/dist/electron'), args: [path.resolve('electron'), '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: appData, HOME: appData } });
const conteos = async pg => pg.$$eval('#conteos [data-hoja]', cs => cs.length ? Object.fromEntries(cs.map(c => [c.dataset.hoja, c.dataset.n])) : null);
(async () => {
  let app = await lanzar(); let pg = await app.firstWindow(); await pg.waitForSelector('#b-ingresar'); await pg.click('#b-ingresar'); await pg.waitForSelector('#vista .tarjeta');
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  anota('EXE: apertura sin datos', await pg.isVisible('text=Bienvenido'), (await pg.textContent('.pie')).trim());
  await pg.click('#b-demo'); await pg.click('.dialogo button:has-text("Confirmar carga")'); await pg.waitForSelector('.capa-progreso', { state: 'detached' }); await pg.waitForTimeout(150); await pg.waitForSelector('text=Totales de control');
  const c1 = await conteos(pg);
  const ruta = await pg.textContent('.ficha dd:last-child');
  const est1 = (await pg.textContent('#estado-guardado')).trim();
  await app.close();
  const dirDatos = path.join(appData, 'ControlParadasP01', 'datos');
  anota('EXE: archivo de datos en disco', fs.existsSync(path.join(dirDatos, 'control_paradas_p01.sqlite')), ruta);
  app = await lanzar(); pg = await app.firstWindow(); await pg.waitForSelector('#b-ingresar'); await pg.click('#b-ingresar'); await pg.waitForSelector('text=Totales de control');
  const c2 = await conteos(pg);
  anota('EXE: persistencia al cerrar y reabrir', JSON.stringify(c1) === JSON.stringify(c2) && c2.Paradas === '20', `${est1} → ${(await pg.textContent('#estado-guardado')).trim()}`);
  // segunda instancia: se lanza como proceso aparte y debe terminar sola, sin abrir otra ventana
  const { spawn } = require('child_process');
  const t0 = Date.now();
  const codigo = await new Promise(r => {
    const pr = spawn(require.resolve('electron/dist/electron'), [path.resolve('electron'), '--no-sandbox'], { env: { ...process.env, XDG_CONFIG_HOME: appData, HOME: appData }, stdio: 'ignore' });
    const t = setTimeout(() => { pr.kill(); r('no terminó en 15 s'); }, 15000);
    pr.on('exit', c => { clearTimeout(t); r(c); });
  });
  anota('EXE: una sola instancia', codigo === 0, `la segunda instancia terminó con código ${codigo} en ${Date.now() - t0} ms; la primera sigue abierta: ${await pg.isVisible('#vista')}`);
  // recarga repetida → respaldo automático en disco
  await pg.click('#b-demo'); await pg.click('.dialogo button:has-text("Confirmar carga")'); await pg.waitForSelector('.capa-progreso', { state: 'detached' }); await pg.waitForTimeout(150); await pg.waitForSelector('text=Totales de control');
  const resp = fs.readdirSync(path.join(dirDatos, 'respaldos'));
  anota('EXE: respaldo automático en disco antes de reemplazar', resp.some(f => f.endsWith('.sqlite')), resp.join(', '));
  await pg.click('text=Datos y respaldos'); await pg.waitForSelector('[data-resp]');
  await pg.click('[data-resp="0"]'); await pg.click('.dialogo button:has-text("Restaurar")'); await pg.waitForSelector('text=Totales de control');
  anota('EXE: restaurar respaldo automático', JSON.stringify(await conteos(pg)) === JSON.stringify(c1), 'Mismos conteos tras restaurar');
  anota('EXE: sin errores de página', errs.length === 0, errs.join(';') || 'ninguno');
  await pg.screenshot({ path: 'pruebas/i11_exe.png' });
  await app.close();
  fs.writeFileSync('pruebas/resultado_i11_exe_linux.json', JSON.stringify({ fecha: new Date().toISOString(), plataforma: 'Linux + Xvfb (Electron 33.2.1)', casos: res }, null, 1));
  process.exit(res.some(r => r.resultado === 'FALLA') ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
