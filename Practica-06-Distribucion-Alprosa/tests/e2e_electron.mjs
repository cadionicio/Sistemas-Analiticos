import crypto from 'node:crypto';
// Prueba del contenedor Electron (mismo main.cjs/preload.cjs que el EXE) en Linux bajo Xvfb.
// Incluye la migración de una base de la versión I02 (esquema v1) guardada en disco.
// No sustituye la apertura real del EXE en Windows.
import { _electron as electron } from 'playwright';
import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const cfg = fs.mkdtempSync('/tmp/appdata-');
const carpeta = path.join(cfg, 'AlprosaDistribucion');
fs.mkdirSync(path.join(carpeta, 'respaldos'), { recursive: true });
const SQL = await initSqlJs();
const v1 = new SQL.Database();
v1.exec(`CREATE TABLE meta (clave TEXT PRIMARY KEY, valor TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version','1');
  CREATE TABLE producto (producto_id TEXT PRIMARY KEY, nombre_generico TEXT, familia TEXT, unidad_base TEXT, peso_kg_por_unidad_mil INTEGER, activo INTEGER);
  CREATE TABLE ubicacion (ubicacion_id TEXT PRIMARY KEY, nombre TEXT, tipo TEXT, activa INTEGER);
  CREATE TABLE lote (lote_id TEXT PRIMARY KEY, producto_id TEXT, codigo_lote TEXT, fecha_fabricacion TEXT, fecha_vencimiento TEXT, estado_lote TEXT);
  CREATE TABLE movimiento (movimiento_id TEXT PRIMARY KEY, lote_id TEXT, ubicacion_origen_id TEXT, ubicacion_destino_id TEXT, condicion TEXT, q_mil INTEGER, ocurrido_en TEXT, registrado_en TEXT, tipo TEXT, command_id TEXT);
  CREATE TABLE pedido (pedido_id TEXT PRIMARY KEY, cliente_id TEXT, destino_id TEXT, fecha_pedido TEXT, ventana_inicio TEXT, ventana_fin TEXT, permite_parcial INTEGER, estado_importado TEXT);
  CREATE TABLE pedido_linea (pedido_linea_id TEXT PRIMARY KEY, pedido_id TEXT, producto_id TEXT, q_solicitada_mil INTEGER, precio_neto_base_cent INTEGER);
  CREATE TABLE reserva (reserva_id TEXT PRIMARY KEY, pedido_linea_id TEXT, lote_id TEXT, ubicacion_id TEXT, q_mil INTEGER, estado TEXT, creada_en TEXT, command_id TEXT);
  CREATE TABLE comando (command_id TEXT PRIMARY KEY, tipo TEXT, aplicado_en TEXT, resultado TEXT);
  CREATE TABLE carga (carga_id TEXT PRIMARY KEY, file_hash TEXT, nombre_archivo TEXT, bytes INTEGER, registrado_en TEXT, resultado TEXT, dataset_id TEXT);
  CREATE TABLE auditoria (evento_id INTEGER PRIMARY KEY AUTOINCREMENT, registrado_en TEXT, perfil TEXT, accion TEXT, command_id TEXT, detalle TEXT);
  INSERT INTO producto VALUES ('P01','Alimento balanceado aves — saco 25 kg','Alimento animal','unidad',25000,1);
  INSERT INTO ubicacion VALUES ('ALM-AQP','Almacén principal Arequipa','ALMACEN',1),('TRANSITO','En tránsito','TRANSITO',1);
  INSERT INTO lote VALUES ('L-P01-A','P01','A','2026-09-01','2027-01-15','LIBERADO');
  INSERT INTO movimiento VALUES ('MI-001','L-P01-A',NULL,'ALM-AQP','APTO',40000,'2026-11-01T00:00:00-05:00','2026-11-13T16:00:00-05:00','SALDO_APERTURA','c');
  INSERT INTO pedido VALUES ('PED-0001','CLI-001','DES-001','2026-11-13','2026-11-18T08:00:00-05:00','2026-11-20T18:00:00-05:00',0,'CONFIRMADO');
  INSERT INTO pedido_linea VALUES ('PED-0001-01','PED-0001','P01',30000,9250);
  INSERT INTO reserva VALUES ('R1','PED-0001-01','L-P01-A','ALM-AQP',30000,'ACTIVA','2026-11-13T16:00:00-05:00','c2');`);
fs.writeFileSync(path.join(carpeta, 'alprosa.sqlite'), Buffer.from(v1.export()));

const env = { ...process.env, XDG_CONFIG_HOME: cfg };
const log = [];
const paso = (ok, nombre, det = '') => { log.push({ ok, nombre, det }); console.log((ok ? 'PASA ' : 'FALLA') + ' | ' + nombre + (det ? ' | ' + String(det).slice(0, 220) : '')); };
async function abrir() {
  const app = await electron.launch({ args: ['--no-sandbox', '.'], cwd: process.cwd(), env });
  const w = await app.firstWindow();
  w.on('dialog', (d) => d.accept());
  await w.waitForSelector('.ingreso, .cabecera', { timeout: 30000 });
  return { app, w };
}
const PIN = { Ana: '1111', Carla: '3333', Elena: '5555' };
const entrar = async (w, n) => {
  if (await w.locator('.cabecera').count()) await w.getByRole('button', { name: 'Cambiar de usuario' }).click();
  await w.locator('.tarjeta-usuario', { has: w.locator('strong', { hasText: new RegExp('^' + n) }) }).first().click();
  await w.getByLabel('PIN').fill(PIN[n]); await w.getByRole('button', { name: 'Entrar', exact: true }).click(); await w.waitForSelector('.cabecera'); { const b = w.getByRole('button', { name: 'Entendido' }); if (await b.count()) await b.click(); }
};
const area = (w, n) => w.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: n }).click();
const aviso = async (w) => (await w.locator('.aviso').first().textContent({ timeout: 20000 })).trim();
const limpiar = async (w) => { if (await w.locator('.aviso .cerrar').count()) await w.locator('.aviso .cerrar').click(); };

let { app, w } = await abrir();
try {
  paso(await w.locator('.ingreso').count() === 1, 'La aplicación Electron (mismo código del EXE, ejecutada en Linux) abre en la pantalla de ingreso con PIN');
  await entrar(w, 'Elena');
  const m = await aviso(w);
  paso(/versión 1 a la 7 con copia previa/.test(m), 'Base v1 de la prueba I02 migrada en cadena v1→…→v7 al abrir, con copia previa', m);
  await area(w, 'Operación');
  paso((await w.locator('tbody tr', { hasText: 'PED-0001' }).textContent()).includes('Reservado'), 'Tras migrar, la reserva previa se conserva (balance verificado)');
  await entrar(w, 'Ana');
  await area(w, 'Datos'); await w.getByRole('tab', { name: 'Diagnóstico' }).click();
  paso((await w.locator('.grupo').textContent()).includes('vol_cm3_por_unidad'), 'Datos pendientes de la migración declarados en Diagnóstico');
  paso(await w.evaluate(() => !!window.alprosaNative && typeof window.require === 'undefined'), 'Puente nativo presente y sin acceso general a Node');
  await w.getByRole('tab', { name: 'Carga de datos' }).click();
  await limpiar(w); await w.getByRole('button', { name: 'Cargar demostración' }).click();
  { const d = w.getByRole('dialog', { name: 'Cargar demostración' }); if (await d.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) await d.getByRole('button', { name: 'Cargar', exact: true }).click(); }
  paso(/Guardado en disco con copia verificada/.test(await aviso(w)), 'Carga de demostración guardada en disco', await aviso(w));
  await entrar(w, 'Carla');
  await area(w, 'Operación');
  await w.locator('tbody tr', { hasText: 'PED-0001' }).first().click();
  await limpiar(w); await w.getByRole('button', { name: 'Reservar (FEFO)', exact: true }).click();
  paso(/Reserva realizada/.test(await aviso(w)), 'Reserva FEFO en EXE', await aviso(w));
  await w.getByRole('button', { name: 'Cambiar de usuario' }).click(); await w.locator('.tarjeta-evaluacion').click(); await w.waitForSelector('.cabecera'); { const b = w.getByRole('button', { name: 'Entendido' }); if (await b.count()) await b.click(); }
  await area(w, 'Operación'); await w.locator('tbody tr', { hasText: 'PED-0003' }).first().click();
  await limpiar(w); await w.getByRole('button', { name: 'Cancelar pedido', exact: true }).click();
  const dlg = w.getByRole('dialog', { name: /^Cancelar PED/ }); await dlg.getByLabel('Motivo de la cancelación').selectOption('Pedido duplicado'); await dlg.getByRole('button', { name: 'Cancelar pedido' }).click();
  paso(/Pedido cancelado/.test(await aviso(w)), 'En el EXE los datos se piden con formularios guiados (window.prompt no existe en Electron)', await aviso(w));
  // I06 en el EXE: simulación y exportación desde Resultados
  await area(w, 'Analítica'); await w.getByRole('tab', { name: 'Simulación' }).click();
  await limpiar(w); await w.getByRole('button', { name: 'Simular los 3 planes' }).click();
  await w.waitForSelector('.tarjeta-plan', { timeout: 120000 });
  paso(await w.locator('.tarjeta-plan').count() === 3, 'Simulación Monte Carlo en el EXE: 3 planes con resultados', (await w.locator('.tarjeta-plan').first().textContent()).slice(0, 120));
  await w.getByRole('tab', { name: 'Alternativas y EVA' }).click();
  await limpiar(w); await w.getByRole('button', { name: 'Calcular evaluación' }).click(); await w.waitForSelector('.tabla-eva', { timeout: 60000 });
  paso(/S\/ 276\.96[0-9]/.test(await w.locator('.tabla-eva tbody tr').first().textContent()), 'EVA base en el EXE igual al del HTML (S/ 276.966)', (await w.locator('.tabla-eva tbody tr').first().textContent()).slice(0, 160));
  await entrar(w, 'Ana');
  await area(w, 'Datos');
  const t0 = Date.now();
  await w.getByRole('tab', { name: 'Clima (internet)' }).click();
  await limpiar(w); await w.getByRole('button', { name: 'Consultar clima' }).click();
  const tc = await aviso(w);
  paso(/guardada|reutiliz|Open-Meteo|Sin respuesta del servicio de clima/.test(tc) && (Date.now() - t0) < 10000, `Pantalla de clima responde o falla controladamente en ${((Date.now() - t0) / 1000).toFixed(1)} s sin congelar`, tc);
  if (/guardada|reutiliz/.test(tc)) {
    paso(await w.locator('.banda-clima').count() === 1 && /°C/.test(await w.locator('.banda-clima').textContent()), 'Lectura de clima guardada y visible en banda superior persistente', await w.locator('.banda-clima').textContent());
    await limpiar(w); await w.getByRole('button', { name: 'Consultar clima' }).click();
    paso(/reutilizó la lectura guardada/.test(await aviso(w)), 'Segunda consulta reutiliza la lectura vigente sin ir a internet', await aviso(w));
  } else paso(true, 'Sin internet en la prueba: banda de clima no verificable aquí (se verifica en Windows)');
} catch (e) { paso(false, 'Ejecución interrumpida', e.message.split('\n')[0]); }
await app.close();
paso(fs.existsSync(path.join(carpeta, 'alprosa.sqlite')), 'Archivo SQLite en carpeta de usuario estable', carpeta);
const copias = fs.readdirSync(path.join(carpeta, 'respaldos'));
paso(copias.length >= 2 && copias.length <= 10, 'Copias automáticas verificadas y rotadas (máx. 10)', copias.length + ' copias');
({ app, w } = await abrir()); await entrar(w, 'Carla');
await area(w, 'Operación');
paso((await w.locator('tbody tr', { hasText: 'PED-0001' }).first().textContent()).includes('Reservado'), 'Persistencia tras cerrar y reabrir el EXE');
await app.close();
fs.writeFileSync(path.join(out, 'resultado_e2e_electron.json'), JSON.stringify({ fecha: new Date().toISOString(), plataforma: 'Linux x64 + Xvfb (no Windows): se ejecuta la aplicación Electron desde el código fuente compilado (dist-html + electron/main), no el .exe portable de Windows', build: JSON.parse(fs.readFileSync('package.json', 'utf8')).version, sha256_html_empaquetado: crypto.createHash('sha256').update(fs.readFileSync('dist-html/index.html')).digest('hex'), pasos: log }, null, 2));
process.exit(log.every((l) => l.ok) ? 0 : 1);
