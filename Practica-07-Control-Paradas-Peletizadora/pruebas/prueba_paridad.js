// Paridad EXE/HTML: el mismo escenario (demostración, corte fijo, misma simulación) debe dar las mismas cifras.
// El EXE se ejecuta con su mismo main.js/preload.js/HTML en Linux (Electron 33.2.1); no sustituye la prueba en Windows.
const { chromium, _electron: electron } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const HTML = path.resolve(process.argv[2]);
async function escenario(pg) {
  await pg.waitForSelector('#b-ingresar'); await pg.click('#b-ingresar');
  await pg.click('#b-demo'); await pg.click('.dialogo button:has-text("Confirmar carga")'); await pg.waitForSelector('#conteos');
  await pg.click('.pestana:has-text("Indicadores")'); await pg.waitForSelector('#kpis-ind');
  await pg.fill('#fi-corte', '2026-11-18T12:00'); await pg.dispatchEvent('#fi-corte', 'change'); await pg.waitForTimeout(300);
  const kpis = await pg.$$eval('#kpis-ind .m-val', v => v.map(x => x.textContent.trim()));
  await pg.click('[data-a="diagnostica"]'); await pg.waitForTimeout(200);
  const pareto = await pg.$$eval('#tabla-pareto tbody tr[data-modo]', t => t.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  await pg.click('.pestana:has-text("Simulación")'); await pg.click('#b-simular'); await pg.waitForSelector('#sim-res');
  const sim = { id: await pg.textContent('#sim-id'), A: await pg.textContent('[data-costo="A"]'), B: await pg.textContent('[data-costo="B"]') };
  await pg.click('.pestana:has-text("Paradas")'); await pg.waitForSelector('#k-total');
  const paradas = await pg.textContent('#k-total');
  return { kpis, pareto, sim, paradas };
}
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
  const pgH = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  await pgH.goto('file://' + HTML);
  const H = await escenario(pgH);
  await b.close();
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpr-par-'));
  const app = await electron.launch({ executablePath: require.resolve('electron/dist/electron'), args: [path.resolve('electron'), '--no-sandbox'], env: { ...process.env, XDG_CONFIG_HOME: appData, HOME: appData } });
  const pgE = await app.firstWindow();
  const E = await escenario(pgE);
  await app.close();
  const igual = JSON.stringify(H) === JSON.stringify(E);
  const r = { caso: 'Paridad EXE/HTML con iguales entradas y parámetros', resultado: igual ? 'PASA' : 'FALLA', observado: `HTML ${JSON.stringify(H.kpis)} · simulación ${H.sim.id} A ${H.sim.A} B ${H.sim.B} · EXE idéntico: ${igual}`, html: H, exe: E };
  console.log(r.resultado + ' · ' + r.caso + ' · ' + r.observado);
  fs.writeFileSync('pruebas/resultado_paridad.json', JSON.stringify(r, null, 1));
  process.exit(igual ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
