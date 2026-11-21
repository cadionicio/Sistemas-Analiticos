// Función con internet del EXE (tipo de cambio BCRP): respuesta simulada por un servidor local y caso sin conexión.
const { _electron: electron } = require('/opt/npm-tools/node_modules/playwright');
const http = require('http'); const path = require('path'); const fs = require('fs'); const os = require('os');
const res = [];
const anota = (caso, ok, obs) => { res.push({ caso, resultado: ok ? 'PASA' : 'FALLA', observado: obs }); console.log((ok ? 'PASA ' : 'FALLA') + ' · ' + caso + ' · ' + obs); };
async function correr(url, etiqueta) {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpr-tc-'));
  const app = await electron.launch({ executablePath: require.resolve('electron/dist/electron'), args: [path.resolve('electron'), '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: appData, HOME: appData, CPR_TC_URL: url } });
  const pg = await app.firstWindow();
  await pg.waitForSelector('#b-ingresar'); await pg.click('#b-ingresar');
  await pg.click('#b-demo'); await pg.click('.dialogo button:has-text("Confirmar carga")'); await pg.waitForSelector('.capa-progreso', { state: 'detached' });
  await pg.click('.pestana:has-text("Simulación")'); await pg.waitForSelector('#b-tc');
  const t0 = Date.now(); await pg.click('#b-tc'); await pg.waitForSelector('.capa-progreso', { state: 'detached', timeout: 20000 }); await pg.waitForTimeout(400);
  const ms = Date.now() - t0;
  const estado = (await pg.textContent('#tc-estado')).trim(); const av = (await pg.textContent('#avisos')).replace(/\s+/g, ' ').trim();
  await pg.click('#b-simular'); await pg.waitForSelector('#sim-res');
  const costo = (await pg.textContent('[data-costo="A"] + small')).trim();
  await app.close();
  return { estado, av, ms, costo };
}
(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ config: { title: 'Tipo de cambio' }, periods: [{ name: '17.Nov.26', values: ['3.771'] }, { name: '18.Nov.26', values: ['3.768'] }] })); }).listen(18777);
  const ok = await correr('http://127.0.0.1:18777/api', 'ok');
  anota('EXE con internet: consulta del tipo de cambio (respuesta del servicio simulada en local)', /3\.768/.test(ok.estado) && /US\$/.test(ok.costo), `${ok.estado} · ${ok.costo} · ${ok.ms} ms`);
  srv.close();
  const mal = await correr('http://127.0.0.1:9/api', 'sin red');
  anota('EXE sin conexión: la consulta falla sin bloquear y la simulación sigue', /No se pudo consultar/.test(mal.av) && /Sin consulta/.test(mal.estado), `${mal.av.slice(0, 160)} · ${mal.ms} ms`);
  fs.writeFileSync('pruebas/resultado_internet_exe.json', JSON.stringify({ fecha: new Date().toISOString(), plataforma: 'Electron 33.2.1 Linux + Xvfb; servicio BCRP sustituido por servidor local (el contenedor no tiene acceso a internet)', casos: res }, null, 1));
  process.exit(res.some(r => r.resultado === 'FALLA') ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
