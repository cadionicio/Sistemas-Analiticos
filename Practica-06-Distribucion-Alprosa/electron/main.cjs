// Proceso principal del EXE (Electron). Carga el MISMO HTML único y aporta persistencia en disco y conexión a internet.
const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
// Calendario y fechas siempre en formato peruano (dd/mm/aaaa), sin depender del idioma de Windows.
app.commandLine.appendSwitch('lang', 'es-PE');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const CARPETA = path.join(app.getPath('appData'), 'AlprosaDistribucion');
const BASE = path.join(CARPETA, 'alprosa.sqlite');
const RESPALDOS = path.join(CARPETA, 'respaldos');
const CACHE_CLIMA = path.join(CARPETA, 'cache_clima.json');
const MAX_COPIAS = 10;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function asegurarCarpetas() { fs.mkdirSync(RESPALDOS, { recursive: true }); }

function escribirAtomico(destino, bytes) {
  const tmp = destino + '.tmp-' + process.pid;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, destino);
}

ipcMain.handle('alprosa:carpeta', () => CARPETA);
ipcMain.handle('alprosa:version', () => app.getVersion());
ipcMain.handle('alprosa:cargar', () => {
  asegurarCarpetas();
  return fs.existsSync(BASE) ? new Uint8Array(fs.readFileSync(BASE)) : null;
});
ipcMain.handle('alprosa:guardar', (_e, bytes, motivo) => {
  asegurarCarpetas();
  const b = Buffer.from(bytes);
  try { escribirAtomico(BASE, b); } catch (e) { return { guardado: false, respaldo: 'PENDIENTE', detalle: 'No se pudo guardar: ' + e.message }; }
  try {
    const nombre = `alprosa_${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
    const dest = path.join(RESPALDOS, nombre);
    escribirAtomico(dest, b);
    if (sha(fs.readFileSync(dest)) !== sha(b)) throw new Error('la copia no coincide');
    const copias = fs.readdirSync(RESPALDOS).filter((f) => f.endsWith('.sqlite')).sort();
    for (const f of copias.slice(0, Math.max(0, copias.length - MAX_COPIAS))) fs.unlinkSync(path.join(RESPALDOS, f));
    fs.appendFileSync(path.join(CARPETA, 'registro_guardado.log'), `${new Date().toISOString()}\t${motivo}\t${sha(b)}\n`);
    return { guardado: true, respaldo: 'VERIFICADO', detalle: `Guardado en disco con copia verificada (últimas ${MAX_COPIAS}).` };
  } catch (e) {
    return { guardado: true, respaldo: 'PENDIENTE', detalle: 'Guardado; la copia automática falló: ' + e.message };
  }
});
ipcMain.handle('alprosa:clima', async (_e, lat, lon) => {
  if (typeof lat !== 'number' || typeof lon !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { ok: false, texto: 'Coordenadas inválidas.' };
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,precipitation,wind_speed_10m&daily=precipitation_sum,precipitation_probability_max&forecast_days=1&timezone=America%2FLima`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await net.fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const c = j.current, d = j.daily || {};
    const hoyMm = Array.isArray(d.precipitation_sum) ? Number(d.precipitation_sum[0]) : null;
    const prob = Array.isArray(d.precipitation_probability_max) && d.precipitation_probability_max[0] !== null ? Number(d.precipitation_probability_max[0]) : null;
    const coma = (x) => String(x).replace('.', ',');
    const texto = `Open-Meteo (${c.time} hora Lima): ${coma(c.temperature_2m)} °C; lluvia en los últimos 15 min ${coma(c.precipitation)} mm; prevista hoy ${hoyMm === null ? 'N/D' : coma(hoyMm) + ' mm'} (probabilidad ${prob === null ? 'N/D' : prob + ' %'}); viento ${coma(c.wind_speed_10m)} km/h. Consultado ${new Date().toISOString()}.`;
    asegurarCarpetas();
    fs.writeFileSync(CACHE_CLIMA, JSON.stringify({ lat, lon, texto, consultado: new Date().toISOString() }));
    return { ok: true, texto, temperatura: Number(c.temperature_2m), precipitacion: Number(c.precipitation), lluvia_hoy: hoyMm, prob_lluvia: prob, viento: Number(c.wind_speed_10m), observado: String(c.time) };
  } catch (e) {
    let cache = '';
    try { const c = JSON.parse(fs.readFileSync(CACHE_CLIMA, 'utf8')); cache = ` Último dato en caché (${c.consultado}): ${c.texto}`; } catch { /* sin caché */ }
    return { ok: false, texto: `Sin respuesta del servicio de clima (${e.name === 'AbortError' ? 'tiempo de espera agotado' : e.message}). La operación continúa con parámetros manuales.${cache}` };
  } finally { clearTimeout(t); }
});

function crearVentana() {
  const w = new BrowserWindow({
    width: 1366, height: 768, minWidth: 1024, minHeight: 640, title: 'Sistema de Distribución — Alprosa', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.removeMenu();
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.once('ready-to-show', () => w.show());
  w.loadFile(path.join(__dirname, '..', 'dist-html', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(crearVentana);
  app.on('second-instance', () => { const [w] = BrowserWindow.getAllWindows(); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.on('window-all-closed', () => app.quit());
}
