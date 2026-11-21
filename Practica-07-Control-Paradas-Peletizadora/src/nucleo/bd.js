// Acceso a SQLite (sql.js/WASM). Una transacción confirma todo o revierte todo.
import { DDL, VERSION_ESQUEMA } from './esquema.js';
import { ahoraIso } from './fechas.js';
import { sha256Hex } from './sha256.js';

// Responsables de demostración (PIN de 4 dígitos guardado como hash con sal). Simulación local de responsabilidades.
export const USUARIOS_DEMO = [
  ['PRD-01', 'Supervisor de producción', 'PRODUCCION', '1111'],
  ['MNT-01', 'Técnico mecánico', 'MANTENIMIENTO', '2222'],
  ['ALM-01', 'Jefe de almacén', 'ALMACEN', '3333'],
  ['JMT-01', 'Jefe de mantenimiento', 'RESP_MANTENIMIENTO', '4444'],
  ['EVA', 'Evaluación', 'EVALUACION', ''],
];
export const hashPin = (sal, pin) => sha256Hex(new TextEncoder().encode(sal + ':' + pin));

let SQL = null;
let db = null;
const oyentes = new Set(); // vistas suscritas a cambios confirmados

export async function iniciarMotor() {
  if (!SQL) SQL = await globalThis.initSqlJs({});
  return SQL;
}
export function abrir(bytes) {
  const nueva = bytes ? new SQL.Database(bytes) : new SQL.Database();
  nueva.exec(DDL);
  const v = valorEn(nueva, "SELECT valor FROM meta WHERE clave='version_esquema'");
  if (v === null) {
    nueva.run("INSERT INTO meta(clave, valor) VALUES ('version_esquema', ?), ('revision', '0'), ('creada', ?)", [String(VERSION_ESQUEMA), ahoraIso()]);
  } else if (Number(v) !== VERSION_ESQUEMA) {
    nueva.close();
    throw new Error(`La base tiene versión de esquema ${v} y esta aplicación usa ${VERSION_ESQUEMA}.`);
  }
  if (!valorEn(nueva, 'SELECT count(*) FROM usuario')) {
    USUARIOS_DEMO.forEach(([c, n, r, pin]) => {
      const sal = sha256Hex(new TextEncoder().encode(c + ':sal')).slice(0, 16);
      nueva.run('INSERT INTO usuario(codigo, nombre, rol, sal, pin_hash) VALUES (?,?,?,?,?)', [c, n, r, sal, pin ? hashPin(sal, pin) : '']);
    });
  }
  const fk = nueva.exec('PRAGMA foreign_key_check');
  if (fk.length) { nueva.close(); throw new Error('La base contiene referencias rotas.'); }
  if (db) db.close();
  db = nueva;
  return db;
}
export function validarBytesBase(bytes) {
  // Comprueba que un archivo de respaldo sea una base de esta aplicación sin reemplazar la actual
  const prueba = new SQL.Database(bytes);
  try {
    const v = valorEn(prueba, "SELECT valor FROM meta WHERE clave='version_esquema'");
    if (v === null) throw new Error('El archivo no es un respaldo de esta aplicación.');
    if (Number(v) !== VERSION_ESQUEMA) throw new Error(`El respaldo tiene versión de esquema ${v}; se esperaba ${VERSION_ESQUEMA}.`);
    const ok = prueba.exec('PRAGMA integrity_check')[0].values[0][0];
    if (ok !== 'ok') throw new Error('El respaldo está dañado: ' + ok);
    return { revision: Number(valorEn(prueba, "SELECT valor FROM meta WHERE clave='revision'") || 0) };
  } finally { prueba.close(); }
}
function valorEn(d, sql, p = []) {
  try {
    const st = d.prepare(sql); st.bind(p);
    const r = st.step() ? st.get()[0] : null; st.free(); return r;
  } catch { return null; }
}
export function bd() { if (!db) throw new Error('Base no iniciada'); return db; }
export function valor(sql, p = []) { return valorEn(bd(), sql, p); }
export function filas(sql, p = []) {
  const st = bd().prepare(sql); st.bind(p);
  const out = [];
  while (st.step()) out.push(st.getAsObject());
  st.free();
  return out;
}
export function ejecutar(sql, p = []) { bd().run(sql, p); }
// sql.js reabre la base al exportar y restablece los PRAGMA: se vuelven a activar las claves foráneas.
export function exportar() { const b = bd().export(); bd().exec('PRAGMA foreign_keys = ON'); return b; }
export function revision() { return Number(valor("SELECT valor FROM meta WHERE clave='revision'") || 0); }

// Ejecuta fn dentro de BEGIN/COMMIT; ante error hace ROLLBACK y relanza.
// Tras confirmar incrementa la revisión, registra el evento y avisa a las vistas.
export function transaccion(fn, evento) {
  const d = bd();
  d.exec('BEGIN IMMEDIATE');
  try {
    d.exec('PRAGMA defer_foreign_keys = ON');
    const r = fn();
    const fk = d.exec('PRAGMA foreign_key_check');
    if (fk.length) throw new Error('Referencia inválida en ' + fk[0].values[0][0]);
    const rev = revision() + 1;
    d.run("UPDATE meta SET valor=? WHERE clave='revision'", [String(rev)]);
    if (evento) d.run('INSERT INTO evento(instante, tipo, referencia, detalle, usuario) VALUES (?,?,?,?,?)',
      [ahoraIso(), evento.tipo, evento.referencia || '', evento.detalle || '', evento.usuario || '']);
    d.exec('COMMIT');
    const ev = { id: valor('SELECT max(id) FROM evento'), rev, tipo: evento?.tipo, instante: ahoraIso() };
    oyentes.forEach(f => { try { f(ev); } catch (e) { console.error(e); } });
    return r;
  } catch (e) {
    try { d.exec('ROLLBACK'); } catch { /* ya revertida */ }
    throw e;
  }
}
export function alConfirmar(f) { oyentes.add(f); return () => oyentes.delete(f); }
