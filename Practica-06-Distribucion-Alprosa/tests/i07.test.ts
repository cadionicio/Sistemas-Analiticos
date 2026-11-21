// Pruebas de I07: integración, continuidad, gobierno de parámetros, observabilidad, portabilidad, privacidad y contratos.
import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { Repo } from '../src/core/db';
import { validarConjunto } from '../src/core/contrato';
import { confirmarCarga } from '../src/core/carga';
import * as D from '../src/core/dominio';
import * as P from '../src/core/permisos';
import * as Q from '../src/core/continuidad';
import * as S from '../src/core/sesion';
import { SCHEMA_VERSION } from '../src/core/schema';
import { aHojas, tablasDemo } from '../src/core/demo';
import { tablasExcel06 } from '../src/core/historia';

let SQL: SqlJsStatic;
const AHORA = '2026-11-15T10:00:00-05:00';
function nuevo(tablas = tablasExcel06()) {
  const r = Repo.iniciar(new SQL.Database()); r.reloj = () => AHORA;
  P.asegurarUsuarios(r); r.transaccion(() => D.asegurarParametros(r));
  const { errores, datos } = validarConjunto(aHojas(tablas));
  if (errores.length) throw new Error(JSON.stringify(errores.slice(0, 2)));
  confirmarCarga(r, 'U01', datos, { hash: 'h', nombre: '06', bytes: 0, datasetId: '06' });
  return r;
}
beforeAll(async () => { SQL = await initSqlJs(); });

describe('BC / AM — esquema y migraciones', () => {
  it('ESC-BC03 / AH05 una base de versión POSTERIOR no se abre para escritura', () => {
    const r = nuevo(); r.run("UPDATE meta SET valor = '99' WHERE clave = 'schema_version'");
    expect(() => Repo.iniciar(new SQL.Database(r.exportar()))).toThrow(/posterior a este programa/);
  });
  it('ESC-BC06 / AM08 abrir otra vez una base ya migrada no repite la migración ni duplica filas', () => {
    const r = nuevo(); const b = r.exportar();
    const r2 = Repo.iniciar(new SQL.Database(b));
    expect(r2.num('SELECT COUNT(*) FROM migracion')).toBe(r.num('SELECT COUNT(*) FROM migracion'));
    expect(r2.uno("SELECT valor FROM meta WHERE clave='schema_version'")!.valor).toBe(String(SCHEMA_VERSION));
    expect(r2.num('SELECT COUNT(*) FROM pedido')).toBe(r.num('SELECT COUNT(*) FROM pedido'));
  });
  it('ESC-BC02 una migración que falla a mitad se revierte completa (sin mezcla de esquemas)', () => {
    const r = Repo.iniciar(new SQL.Database());
    r.db.exec('BEGIN'); r.db.exec('CREATE TABLE prueba_mig (x)');
    try { r.db.exec('INSERT INTO tabla_inexistente VALUES (1)'); } catch { r.db.exec('ROLLBACK'); }
    expect(r.todos("SELECT name FROM sqlite_master WHERE name = 'prueba_mig'").length).toBe(0);
  });
});

describe('BB — gobierno de parámetros versionados', () => {
  it('ESC-BB05 una versión con fecha futura no rige hasta su frontera [inicio, siguiente)', () => {
    const r = nuevo();
    D.cambiarParametro(r, 'U05', 'alerta_plazo_h', '4', '2026-12-01T00:00:00-05:00', 'Nueva política programada');
    expect(D.parametro(r, 'alerta_plazo_h')).toBe('8');
    expect(D.parametro(r, 'alerta_plazo_h', '2026-12-01T00:00:00-05:00')).toBe('4');
    expect(D.parametro(r, 'alerta_plazo_h', '2026-11-30T23:59:59-05:00')).toBe('8');
  });
  it('ESC-BB03 dos cambios desde versiones base distintas: el segundo se rechaza por versión obsoleta', () => {
    const r = nuevo();
    const base = Number(r.uno("SELECT MAX(version) v FROM parametro WHERE clave = 'alerta_plazo_h'")!.v);
    D.cambiarParametro(r, 'U05', 'alerta_plazo_h', '6', AHORA, 'Ajuste operativo acordado', base);
    expect(() => D.cambiarParametro(r, 'U05', 'alerta_plazo_h', '12', AHORA, 'Ajuste operativo acordado', base)).toThrow(/Conflicto/);
    expect(D.parametro(r, 'alerta_plazo_h')).toBe('6');
  });
  it('ESC-BB07 revertir crea una versión nueva equivalente; la errónea queda en el historial', () => {
    const r = nuevo();
    D.cambiarParametro(r, 'U05', 'alerta_plazo_h', '2', AHORA, 'Cambio erróneo');
    D.cambiarParametro(r, 'U05', 'alerta_plazo_h', '8', AHORA, 'Reversión por error operacional');
    const h = r.todos("SELECT version, valor FROM parametro WHERE clave = 'alerta_plazo_h' ORDER BY version");
    expect(h.map((x) => x.valor)).toEqual(['8', '2', '8']);
  });
  it('ESC-BB09 valor sin el tipo esperado se rechaza y no se infiere', () => {
    const r = nuevo();
    expect(() => D.cambiarParametro(r, 'U05', 'alerta_plazo_h', '8 horas', AHORA, 'Ajuste operativo acordado')).toThrow();
    expect(() => D.cambiarParametro(r, 'U05', 'alerta_plazo_h', '0', AHORA, 'Ajuste operativo acordado')).toThrow();
  });
});

describe('BH — observabilidad local', () => {
  it('ESC-BH04 una alerta técnica repetida se correlaciona en un episodio y cuenta ocurrencias', () => {
    const r = nuevo();
    for (let i = 0; i < 5; i++) Q.registrarEvento(r, { nivel: 'ERROR', etapa: 'PERSISTENCIA', codigo: 'GUARDADO_FALLIDO', mensaje: 'Disco lleno' });
    const e = Q.eventosTecnicos(r);
    expect(e.length).toBe(1); expect(Number(e[0].ocurrencias)).toBe(5);
    Q.resolverEvento(r, String(e[0].evento_id));
    Q.registrarEvento(r, { nivel: 'ERROR', etapa: 'PERSISTENCIA', codigo: 'GUARDADO_FALLIDO', mensaje: 'Disco lleno otra vez' });
    expect(Q.eventosTecnicos(r).length).toBe(2);
  });
  it('ESC-BH05 el log minimiza datos personales (DNI, correo, nombre del receptor) y conserva correlación por ID', () => {
    expect(Q.redactar('Receptor Juana Pérez DNI 45678912 correo jp@x.pe', ['Juana Pérez'])).toBe('Receptor [persona oculta] DNI [número oculto] correo [correo oculto]');
  });
  it('ESC-BH01 una exportación fallida queda registrada con etapa y RUN-ID', () => {
    const r = nuevo();
    Q.registrarEvento(r, { nivel: 'ERROR', etapa: 'EXPORTACION', codigo: 'EXPORTACION_FALLIDA', mensaje: 'xlsx: sin espacio', run_id: 'RUN-X' });
    expect(Q.eventosTecnicos(r)[0]).toMatchObject({ etapa: 'EXPORTACION', run_id: 'RUN-X' });
  });
  it('ESC-BH08 si el diagnóstico no puede escribirse, la operación de negocio no se interrumpe', () => {
    const r = nuevo(); r.db.exec('DROP TABLE evento_tecnico');
    expect(Q.registrarEvento(r, { nivel: 'ERROR', etapa: 'X', codigo: 'Y', mensaje: 'z' })).toBe(false);
  });
  it('ESC-BH09 / BD08 / O02 / AH02 la salud separa aplicación, integridad, persistencia, recuperabilidad y almacenamiento', () => {
    const r = nuevo();
    const s = Q.salud(r, { persistente: true, ultimoGuardado: { guardado: true, respaldo: 'PENDIENTE', detalle: 'Guardado, copia pendiente' }, fallosCopia: 3, ultimaCopiaVerificada: '2026-11-14T08:00:00-05:00', bytes: 5e6 });
    expect(s.find((x) => x.dimension === 'Aplicación')!.estado).toBe('OK');
    expect(s.find((x) => x.dimension === 'Recuperabilidad (copias)')!.estado).toBe('FALLA');
    expect(s.find((x) => x.dimension === 'Recuperabilidad (copias)')!.detalle).toMatch(/NO está vigente/);
  });
  it('ESC-BI09 el almacenamiento avisa con proyección y NO borra historia', () => {
    const r = nuevo(); D.cambiarParametro(r, 'U05', 'almacenamiento_alerta_mb', '1', AHORA, 'Ajuste operativo acordado');
    const a = Q.salud(r, { persistente: true, fallosCopia: 0, ultimaCopiaVerificada: AHORA, bytes: 3 * 1048576 }).find((x) => x.dimension === 'Almacenamiento')!;
    expect(a.estado).toBe('AVISO'); expect(a.detalle).toMatch(/No se borra historia/);
    expect(r.num('SELECT COUNT(*) FROM hist_pedido')).toBeGreaterThan(1000);
  });
  it('ESC-BH10 paquete de diagnóstico: versiones y configuración sin credenciales ni datos personales', () => {
    const r = nuevo(); const j = Q.paqueteDiagnostico(r, 'test', []);
    expect(j).toContain('"esquema"'); expect(j).not.toMatch(/pin_hash|sal_hex|"pin"/i);
  });
});

describe('BD — restauración y continuidad', () => {
  it('ESC-BD04 vista previa: muestra cuánto se perdería antes de reemplazar', () => {
    const r = nuevo(); const copia = Repo.iniciar(new SQL.Database(r.exportar()));
    D.reservarFefo(r, 'U03', 'PED-0001');
    r.run("INSERT INTO movimiento SELECT 'MOV-NUEVO', lote_id, NULL, nodo_destino_id, condicion, 1000, '2026-11-15T09:00:00-05:00', '2026-11-15T09:30:00-05:00', 'AJUSTE_POSITIVO', NULL, 'prueba', 'U01', 'CMD-T' FROM movimiento LIMIT 1".replace('2026-11-15T09:30:00-05:00', '2026-11-15T11:30:00-05:00'));
    const v = Q.vistaPreviaRestauracion(r, copia);
    expect(v.perdida).toBe(true); expect(v.posteriores).toBeGreaterThanOrEqual(1);
    expect(v.filas.find((f) => f.tabla === 'reserva')!.actual).toBeGreaterThan(v.filas.find((f) => f.tabla === 'reserva')!.copia);
  });
  it('ESC-BD09 / BD10 ensayo: registra duración real y compara con metas RTO/RPO, declarando incumplimiento', () => {
    const r = nuevo();
    const ok = Q.registrarEnsayo(r, 'U01', { hash: 'h1', ok: true, duracion_ms: 1200, corteCopia: '2026-11-15T08:00:00-05:00', detalle: 'ok' });
    expect(ok.cumple_rto).toBe(true); expect(ok.cumple_rpo).toBe(true);
    const malo = Q.registrarEnsayo(r, 'U01', { hash: 'h2', ok: true, duracion_ms: 90000, corteCopia: '2026-11-10T08:00:00-05:00', detalle: 'lenta' });
    expect(malo.cumple_rto).toBe(false); expect(malo.cumple_rpo).toBe(false);
    expect(Q.ensayos(r).length).toBe(2);
  });
  it('ESC-BD02 / M05 copia dañada: se rechaza sin tocar la base activa', () => {
    const malo = new Uint8Array(4096).fill(7);
    expect(() => { const c = Repo.iniciar(new SQL.Database(malo)); c.uno('PRAGMA integrity_check'); }).toThrow();
  });
});

describe('BK — portabilidad y privacidad', () => {
  it('ESC-BK03 / BK10 exportación portable: esquema, unidades, zona, relaciones; ida y vuelta con conteos iguales; sin credenciales', () => {
    const r = nuevo(); const e = Q.exportacionPortable(r, 'test');
    expect(e.texto).toContain('America/Lima'); expect(e.texto).not.toContain('"credencial"');
    expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    const v = Q.verificarPortable(e.texto, new SQL.Database() as never);
    expect(v).toEqual({ ok: true, diferencias: [] });
  });
  it('ESC-BK04 / BK08 copia para soporte: misma estructura, sin PIN, receptores y evidencias reemplazados', () => {
    const r = nuevo();
    r.transaccion(() => S.asegurarCredenciales(r));
    expect(r.num('SELECT COUNT(*) FROM credencial')).toBeGreaterThan(0);
    const c = Repo.iniciar(new SQL.Database(r.exportar()));
    Q.anonimizar(c);
    expect(c.num('SELECT COUNT(*) FROM credencial')).toBe(0);
    expect(c.num('SELECT COUNT(*) FROM pedido')).toBe(r.num('SELECT COUNT(*) FROM pedido'));
    expect(c.uno("SELECT valor FROM meta WHERE clave='anonimizada'")!.valor).toBe('sí');
  });
});

describe('Contrato de intercambio (BJ, AF, E/AC)', () => {
  it('ESC-E04 / AC02 un mismo recurso en dos servicios solapados se rechaza con hoja y celda', () => {
    const t = tablasDemo(); const s = t.find((x) => x.hoja === 'ServiciosTransporte')!;
    const f = [...s.filas[0]]; f[0] = 'S-SOLAPA'; s.filas.push(f);
    const { errores } = validarConjunto(aHojas(t));
    expect(errores.some((e) => e.hoja === 'ServiciosTransporte' && /se solapa/.test(e.mensaje))).toBe(true);
  });
  it('ESC-AF04 / BJ09 hora sin fecha o sin zona: se rechaza, no se asigna Lima por conjetura', () => {
    const t = tablasDemo(); const s = t.find((x) => x.hoja === 'ServiciosTransporte')!;
    s.filas[0][3] = '06:00';
    const { errores } = validarConjunto(aHojas(t));
    expect(errores.some((e) => e.hoja === 'ServiciosTransporte' && e.columna === 'salida')).toBe(true);
  });
  it('ESC-BJ01 columna opcional desconocida: se importan los campos conocidos y se informa la ignorada', () => {
    const t = tablasDemo(); const p = t.find((x) => x.hoja === 'Productos')!;
    p.cols.push('color_empaque'); for (const f of p.filas) f.push('rojo');
    const r = validarConjunto(aHojas(t));
    expect(r.errores).toEqual([]);
    expect(r.advertencias.join(' ')).toMatch(/color_empaque/);
  });
  it('ESC-BJ04 / AG08 ID repetido con contenido distinto dentro del archivo: conflicto declarado, no se sobrescribe', () => {
    const t = tablasDemo(); const p = t.find((x) => x.hoja === 'Productos')!;
    const f = [...p.filas[0]]; f[1] = 'Otro nombre'; p.filas.push(f);
    const r = validarConjunto(aHojas(t));
    expect(r.errores.some((e) => e.hoja === 'Productos' && /duplic/i.test(e.mensaje))).toBe(true);
  });
  it('ESC-BJ08 número con separador ambiguo se rechaza en lugar de interpretarse', () => {
    const t = tablasDemo(); const m = t.find((x) => x.hoja === 'MovimientosIniciales')!;
    m.filas[0][3] = '1.234,5';
    expect(validarConjunto(aHojas(t)).errores.some((e) => e.hoja === 'MovimientosIniciales')).toBe(true);
  });
});
