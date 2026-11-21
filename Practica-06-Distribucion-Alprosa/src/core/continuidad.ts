// I07: continuidad, observabilidad local, portabilidad y privacidad (BD, BH, BK, BI09).
import type { Repo } from './db';
import { nuevoId, sha256Hex } from './util';
import { parametro } from './dominio';
import { SCHEMA_VERSION } from './schema';

// ------------------------------------------------------------------ Observabilidad (BH01, BH04, BH05, BH08)
/** Minimización: se ocultan DNI/teléfonos (secuencias largas de dígitos), correos y nombres declarados de receptores. */
export function redactar(texto: string, nombres: string[] = []) {
  let t = texto.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[correo oculto]').replace(/\b\d{8,}\b/g, '[número oculto]');
  for (const n of nombres.filter((x) => x && x.length >= 3)) t = t.split(n).join('[persona oculta]');
  return t;
}
/**
 * Registra un evento técnico. Si ya hay un episodio ABIERTO con la misma etapa y código, solo suma una ocurrencia (BH04: sin tormenta de avisos).
 * Si la escritura del diagnóstico falla, la operación de negocio NO se interrumpe (BH08): se devuelve false para avisar la pérdida.
 */
export function registrarEvento(repo: Repo, e: { nivel: 'INFO' | 'AVISO' | 'ERROR'; etapa: string; codigo: string; mensaje: string; run_id?: string | null }) {
  try {
    const nombres = repo.todos('SELECT DISTINCT receptor_nombre n FROM entrega WHERE receptor_nombre IS NOT NULL').map((r) => String(r.n));
    const msg = redactar(e.mensaje, nombres);
    const t = repo.reloj();
    const abierto = repo.uno("SELECT evento_id FROM evento_tecnico WHERE etapa = ? AND codigo = ? AND estado = 'ABIERTO'", [e.etapa, e.codigo]);
    if (abierto) repo.run('UPDATE evento_tecnico SET ocurrencias = ocurrencias + 1, ultimo_instante = ?, mensaje = ?, run_id = COALESCE(?, run_id) WHERE evento_id = ?', [t, msg, e.run_id ?? null, abierto.evento_id]);
    else repo.run('INSERT INTO evento_tecnico VALUES (?,?,?,?,?,?,?,?,1,\'ABIERTO\')', [nuevoId('EVT'), t, t, e.nivel, e.etapa, e.codigo, msg, e.run_id ?? null]);
    return true;
  } catch { return false; }
}
export const resolverEvento = (repo: Repo, id: string) => repo.run("UPDATE evento_tecnico SET estado = 'RESUELTO' WHERE evento_id = ?", [id]);
export const eventosTecnicos = (repo: Repo) => repo.todos('SELECT * FROM evento_tecnico ORDER BY ultimo_instante DESC');

// ------------------------------------------------------------------ Salud separada por dimensión (BH09, BD08, BI09, O02, AH02)
export interface Salud { dimension: string; estado: 'OK' | 'AVISO' | 'FALLA'; detalle: string }
export function salud(repo: Repo, o: { persistente: boolean; ultimoGuardado?: { guardado: boolean; respaldo: string; detalle: string }; fallosCopia: number; ultimaCopiaVerificada: string | null; bytes: number }): Salud[] {
  const integ = repo.uno('PRAGMA integrity_check')?.integrity_check === 'ok' && repo.todos('PRAGMA foreign_key_check').length === 0;
  const mb = o.bytes / 1048576;
  const limite = Number(parametro(repo, 'almacenamiento_alerta_mb'));
  const primera = repo.uno('SELECT MIN(aplicada_en) t FROM migracion')?.t as string | undefined;
  const dias = primera ? Math.max(1, (Date.parse(repo.reloj()) - Date.parse(primera)) / 86400000) : 1;
  const ritmo = mb / dias;
  const rpo = Number(parametro(repo, 'rpo_meta_h'));
  const edad = o.ultimaCopiaVerificada ? (Date.parse(repo.reloj()) - Date.parse(o.ultimaCopiaVerificada)) / 3600000 : null;
  return [
    { dimension: 'Aplicación', estado: 'OK', detalle: `Funcionando · esquema ${SCHEMA_VERSION}` },
    { dimension: 'Integridad de la base', estado: integ ? 'OK' : 'FALLA', detalle: integ ? 'integrity_check = ok y sin referencias huérfanas' : 'Hay daños o referencias huérfanas: no confíe en los saldos; restaure una copia verificada.' },
    { dimension: 'Persistencia', estado: o.persistente ? (o.ultimoGuardado && !o.ultimoGuardado.guardado ? 'FALLA' : 'OK') : 'FALLA',
      detalle: !o.persistente ? 'Modo temporal: los cambios NO se guardan; use «Respaldar».' : o.ultimoGuardado ? o.ultimoGuardado.detalle : 'Sin cambios en esta sesión.' },
    { dimension: 'Recuperabilidad (copias)', estado: o.fallosCopia > 0 ? 'FALLA' : edad === null ? 'AVISO' : edad > rpo ? 'AVISO' : 'OK',
      detalle: o.fallosCopia > 0 ? `${o.fallosCopia} copia(s) automática(s) fallida(s) seguidas. Última copia verificada: ${o.ultimaCopiaVerificada ?? 'ninguna'}. La protección NO está vigente hasta que una copia se verifique.`
        : edad === null ? 'Aún no hay copia verificada en esta sesión.' : `Última copia verificada hace ${edad.toFixed(1)} h (meta RPO ${rpo} h).` },
    { dimension: 'Almacenamiento', estado: mb > limite ? 'AVISO' : 'OK', detalle: `${mb.toFixed(2)} MB; ritmo observado ≈ ${ritmo.toFixed(3)} MB/día; ${ritmo > 0 ? `llegaría a ${limite} MB en ≈ ${Math.max(0, Math.round((limite - mb) / ritmo))} días` : 'sin crecimiento medible'}. No se borra historia automáticamente.` },
  ];
}

// ------------------------------------------------------------------ Restauración (BD02–BD04, BD09, BD10)
const TABLAS_CLAVE = ['pedido', 'movimiento', 'reserva', 'itinerario', 'entrega', 'incidencia', 'conteo', 'corrida_simulacion', 'corrida_economica', 'hist_pedido'];
const cuenta = (r: Repo, t: string) => { try { return r.num(`SELECT COUNT(*) FROM ${t}`); } catch { return 0; } };
export function ultimoHecho(r: Repo): string | null {
  const xs = ['SELECT MAX(registrado_en) t FROM movimiento', 'SELECT MAX(registrado_en) t FROM auditoria', 'SELECT MAX(aplicado_en) t FROM comando'].map((q) => { try { return r.uno(q)?.t as string | null; } catch { return null; } }).filter(Boolean) as string[];
  return xs.length ? xs.sort().at(-1)! : null;
}
/** BD04: antes de reemplazar, muestra qué se perdería (conteos y movimientos posteriores a la copia). */
export function vistaPreviaRestauracion(actual: Repo, copia: Repo) {
  const filas = TABLAS_CLAVE.map((t) => ({ tabla: t, actual: cuenta(actual, t), copia: cuenta(copia, t) }));
  const corteCopia = ultimoHecho(copia);
  let posteriores = 0;
  try { posteriores = corteCopia ? actual.num('SELECT COUNT(*) FROM movimiento WHERE registrado_en > ?', [corteCopia]) : actual.num('SELECT COUNT(*) FROM movimiento'); } catch { /* sin tabla */ }
  return { filas, corteCopia, posteriores, perdida: filas.some((f) => f.actual > f.copia) || posteriores > 0 };
}
/** BD09/BD10: ensayo de restauración en espacio aislado. Mide la duración real y la antigüedad de la copia contra las metas configuradas. */
export function registrarEnsayo(repo: Repo, usuario: string, e: { hash: string; ok: boolean; duracion_ms: number; corteCopia: string | null; detalle: string }) {
  const rto = Number(parametro(repo, 'rto_meta_s')), rpoMeta = Number(parametro(repo, 'rpo_meta_h'));
  const rpo = e.corteCopia ? (Date.parse(repo.reloj()) - Date.parse(e.corteCopia)) / 3600000 : null;
  const r = { ensayo_id: nuevoId('ENS'), cumple_rto: e.ok && e.duracion_ms / 1000 <= rto, cumple_rpo: rpo === null ? null : rpo <= rpoMeta, rpo_h: rpo, rto_meta_s: rto, rpo_meta_h: rpoMeta };
  repo.run('INSERT INTO ensayo_restauracion VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [r.ensayo_id, repo.reloj(), usuario, e.hash, e.ok ? 'VALIDA' : 'RECHAZADA', Math.round(e.duracion_ms), rpo, rto, rpoMeta, r.cumple_rto ? 1 : 0, r.cumple_rpo === null ? null : r.cumple_rpo ? 1 : 0, e.detalle]);
  return r;
}
export const ensayos = (repo: Repo) => repo.todos('SELECT * FROM ensayo_restauracion ORDER BY instante DESC');

// ------------------------------------------------------------------ Portabilidad y privacidad (BK03, BK04, BK10, BH10)
const EXCLUIDAS = ['credencial', 'sqlite_sequence'];
/** Exportación portable documentada: esquema (DDL), unidades, zona horaria, IDs y relaciones, con manifiesto de conteos y huella. Sin credenciales. */
export function exportacionPortable(repo: Repo, build: string) {
  const tablas = repo.todos("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").filter((t) => !EXCLUIDAS.includes(String(t.name)));
  const datos: Record<string, Record<string, unknown>[]> = {};
  const conteos: Record<string, number> = {};
  for (const t of tablas) { datos[String(t.name)] = repo.todos(`SELECT * FROM "${t.name}"`); conteos[String(t.name)] = datos[String(t.name)].length; }
  const fks: { tabla: string; columna: string; referencia: string }[] = [];
  for (const t of tablas) for (const f of repo.todos(`PRAGMA foreign_key_list("${t.name}")`)) fks.push({ tabla: String(t.name), columna: String(f.from), referencia: `${f.table}.${f.to}` });
  const cuerpo = { formato: 'ALPROSA-PORTABLE', version_formato: 1, esquema_version: SCHEMA_VERSION, build, generado_en: repo.reloj(),
    convenciones: { zona_horaria: 'America/Lima (UTC−05:00), instantes ISO 8601 con desfase explícito', cantidades: 'columnas *_mil = milésimas de la unidad base del producto', importes: 'columnas *_cent = céntimos de PEN', tasas: 'columnas *_p4 = diezmilésimas', excluido: 'credenciales (PIN) no se exportan' },
    esquema: tablas.map((t) => ({ tabla: String(t.name), ddl: String(t.sql) })), relaciones: fks, conteos, datos };
  const texto = JSON.stringify(cuerpo);
  return { texto, sha256: sha256Hex(new TextEncoder().encode(texto)), conteos };
}
/** Verificación de ida y vuelta: crea una base vacía con el esquema exportado, inserta todo y compara conteos. */
export function verificarPortable(texto: string, vacia: { exec: (sql: string) => unknown; run: (sql: string, p?: never[]) => unknown; prepare: (sql: string) => { step: () => boolean; get: () => unknown[]; free: () => void } }) {
  const j = JSON.parse(texto) as { esquema: { tabla: string; ddl: string }[]; datos: Record<string, Record<string, unknown>[]>; conteos: Record<string, number> };
  vacia.exec('PRAGMA foreign_keys = OFF');
  for (const t of j.esquema) vacia.exec(t.ddl);
  for (const [t, filas] of Object.entries(j.datos)) for (const f of filas) { const cols = Object.keys(f); vacia.run(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => f[c] as never)); }
  const contar = (t: string) => { const st = vacia.prepare(`SELECT COUNT(*) FROM "${t}"`); st.step(); const n = Number(st.get()[0]); st.free(); return n; };
  const diferencias = Object.entries(j.conteos).filter(([t, n]) => contar(t) !== n).map(([t]) => t);
  return { ok: diferencias.length === 0, diferencias };
}
/** BK04/BK08: copia para soporte con la misma estructura, sin credenciales y con datos personales reemplazados por seudónimos estables. */
export function anonimizar(copia: Repo) {
  copia.db.exec('PRAGMA foreign_keys = OFF');
  const tablas = new Set(copia.todos("SELECT name FROM sqlite_master WHERE type='table'").map((t) => String(t.name)));
  if (tablas.has('credencial')) copia.run('DELETE FROM credencial');
  const cols = (t: string) => copia.todos(`PRAGMA table_info("${t}")`).map((c) => String(c.name));
  let n = 0;
  for (const t of tablas) for (const c of cols(t)) {
    if (/receptor_nombre|receptor_doc|telefono|correo|firma|contacto/i.test(c)) { copia.run(`UPDATE "${t}" SET "${c}" = CASE WHEN "${c}" IS NULL THEN NULL ELSE 'ANON-' || substr(hex(randomblob(3)),1,6) END`); n++; }
    if (/evidencia_ref|foto/i.test(c)) { copia.run(`UPDATE "${t}" SET "${c}" = CASE WHEN "${c}" IS NULL THEN NULL ELSE 'RETIRADA' END`); n++; }
  }
  if (tablas.has('usuario')) copia.run("UPDATE usuario SET nombre_ficticio = 'Usuario ' || usuario_id");
  copia.run("INSERT OR REPLACE INTO meta(clave, valor) VALUES ('anonimizada', 'sí')");
  return { columnas: n };
}
/** BH10: paquete de diagnóstico para otro mantenedor: versiones, configuración no secreta, conteos y eventos técnicos (sin credenciales ni datos personales). */
export function paqueteDiagnostico(repo: Repo, build: string, salud: Salud[]) {
  return JSON.stringify({
    build, esquema: SCHEMA_VERSION, generado_en: repo.reloj(), dataset: repo.uno("SELECT valor FROM meta WHERE clave='dataset_id'")?.valor ?? null,
    migraciones: repo.todos('SELECT * FROM migracion ORDER BY version'),
    parametros: repo.todos('SELECT clave, version, valor, unidad, vigente_desde FROM parametro ORDER BY clave, version'),
    conteos: Object.fromEntries(TABLAS_CLAVE.map((t) => [t, cuenta(repo, t)])), salud,
    eventos_tecnicos: eventosTecnicos(repo), ensayos_restauracion: ensayos(repo),
    nota: 'Sin credenciales, sin PIN, sin nombres de receptores ni evidencias.',
  }, null, 2);
}
