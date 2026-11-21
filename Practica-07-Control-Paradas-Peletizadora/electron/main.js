// Proceso principal del EXE: ventana segura, una sola instancia y guardado atómico en disco.
const { app, BrowserWindow, ipcMain, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('lang', 'es-PE');
app.setPath('userData', path.join(app.getPath('appData'), 'ControlParadasP01'));
const DIR = path.join(app.getPath('userData'), 'datos');
const ARCH = path.join(DIR, 'control_paradas_p01.sqlite');
const META = path.join(DIR, 'control_paradas_p01.json');
const RESP = path.join(DIR, 'respaldos');
const MAX_RESPALDOS = 10;

if (!app.requestSingleInstanceLock()) { app.quit(); }
let ventana = null;
app.on('second-instance', () => { if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); } });

const leerMeta = () => { try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch { return null; } };
function escribirAtomico(destino, datos) {
  const tmp = destino + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, datos); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, destino);
}
const selloArchivo = () => new Date(Date.now() - 5 * 3600e3).toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);

ipcMain.handle('cpr:info', () => ({ ruta: ARCH }));
ipcMain.handle('cpr:cargar', () => {
  if (!fs.existsSync(ARCH)) return null;
  const m = leerMeta() || {};
  return { bytes: fs.readFileSync(ARCH), rev: m.rev || 0, instante: m.instante || fs.statSync(ARCH).mtime.toISOString() };
});
ipcMain.handle('cpr:guardar', (_e, bytes, rev, motivo) => {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length < 100 || !Number.isInteger(rev)) throw new Error('Datos de guardado inválidos');
    fs.mkdirSync(RESP, { recursive: true });
    if (fs.existsSync(ARCH)) {
      const m = leerMeta() || {};
      const base = `${selloArchivo()}_rev${m.rev || 0}`;
      fs.copyFileSync(ARCH, path.join(RESP, base + '.sqlite'));
      fs.writeFileSync(path.join(RESP, base + '.json'), JSON.stringify({ instante: m.instante || new Date().toISOString(), rev: m.rev || 0, motivo: 'Antes de: ' + motivo.slice(0, 200) }));
      const lista = fs.readdirSync(RESP).filter(f => f.endsWith('.sqlite')).sort();
      lista.slice(0, Math.max(0, lista.length - MAX_RESPALDOS)).forEach(f => {
        try { fs.unlinkSync(path.join(RESP, f)); fs.unlinkSync(path.join(RESP, f.replace(/\.sqlite$/, '.json'))); } catch { /* sin acción */ }
      });
    }
    const instante = new Date().toISOString();
    escribirAtomico(ARCH, Buffer.from(bytes));
    escribirAtomico(META, JSON.stringify({ rev, instante, motivo: motivo.slice(0, 200) }));
    return { ok: true, instante, ruta: ARCH };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('cpr:listar', () => {
  if (!fs.existsSync(RESP)) return [];
  return fs.readdirSync(RESP).filter(f => f.endsWith('.sqlite')).sort().reverse().map(f => {
    let m = {};
    try { m = JSON.parse(fs.readFileSync(path.join(RESP, f.replace(/\.sqlite$/, '.json')), 'utf8')); } catch { /* sin meta */ }
    return { id: f, instante: m.instante || fs.statSync(path.join(RESP, f)).mtime.toISOString(), rev: m.rev || 0, motivo: m.motivo || '' };
  });
});
ipcMain.handle('cpr:obtener', (_e, id) => {
  if (!/^[0-9_]+_rev\d+\.sqlite$/.test(id)) throw new Error('Nombre de respaldo inválido');
  return fs.readFileSync(path.join(RESP, id));
});

// Función con internet (solo EXE): tipo de cambio venta del BCRP para valorizar repuestos importados.
// Serie PD04640PD (tipo de cambio interbancario, venta). Límite de espera 8 s; si falla, la aplicación sigue igual.
const URL_BCRP = process.env.CPR_TC_URL || 'https://estadisticas.bcrp.gob.pe/estadisticas/series/api/PD04640PD/json';
ipcMain.handle('cpr:tipocambio', async () => {
  const hoy = new Date(Date.now() - 5 * 3600e3);
  const ini = new Date(hoy.getTime() - 15 * 86400e3);
  const f = d => d.toISOString().slice(0, 10);
  const url = `${URL_BCRP}/${f(ini)}/${f(hoy)}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await net.fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('El servicio respondió ' + r.status);
    const j = JSON.parse(await r.text());
    const val = (j.periods || []).map(p => ({ fecha: p.name, valor: Number(String((p.values || [])[0]).replace(',', '.')) })).filter(p => Number.isFinite(p.valor) && p.valor > 0);
    if (!val.length) throw new Error('El servicio no devolvió valores');
    const u = val[val.length - 1];
    return { ok: true, valor: u.valor, fecha: u.fecha, serie: 'PD04640PD', fuente: 'BCRP · tipo de cambio interbancario venta', url, consultado: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'Tiempo de espera agotado (8 s)' : e.message, url };
  } finally { clearTimeout(t); }
});

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1366, height: 768, minWidth: 1024, minHeight: 640, show: false, autoHideMenuBar: true,
    title: 'Control de Paradas y Repuestos',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  ventana.webContents.on('will-navigate', e => e.preventDefault());
  ventana.once('ready-to-show', () => ventana.show());
  ventana.loadFile(path.join(__dirname, 'app', 'index.html'));
}
app.whenReady().then(() => { Menu.setApplicationMenu(null); crearVentana(); });
app.on('window-all-closed', () => app.quit());
