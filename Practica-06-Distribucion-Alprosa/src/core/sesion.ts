// Ingreso por PIN en una sola computadora con perfiles por función (DEC-I01-D7, DEC-I04-USUARIOS).
// El PIN nunca se guarda en claro: SHA-256(sal + usuario + PIN). Tras 5 intentos fallidos el usuario queda bloqueado 5 minutos.
import type { Repo } from './db';
import { exigir, rolesVigentes, type Rol } from './permisos';
import { sha256Hex, nuevoId, aLima } from './util';

export const DDL_CREDENCIAL = `CREATE TABLE IF NOT EXISTS credencial (
  usuario_id TEXT PRIMARY KEY, sal TEXT NOT NULL, pin_hash TEXT NOT NULL, debe_cambiar INTEGER NOT NULL DEFAULT 0,
  intentos INTEGER NOT NULL DEFAULT 0, bloqueado_hasta TEXT, actualizado_en TEXT NOT NULL);`;

/** Usuario de evaluación: todos los roles operativos y sin PIN, solo para revisión y pruebas; queda auditado como cualquier otro (DEC-I04-EVALUACION). */
export const EVAL_ID = 'U00';
export const EVAL_NOMBRE = 'Evaluación (acceso total)';
const EVAL_ROLES: Rol[] = ['ADMINISTRADOR', 'RESPONSABLE_DATOS', 'ENCARGADO_PEDIDOS', 'ENCARGADO_ALMACEN', 'PLANIFICADOR', 'SUPERVISOR', 'ANALISTA'];
export function asegurarUsuarioEvaluacion(repo: Repo) {
  const t = repo.reloj();
  if (!repo.uno('SELECT 1 FROM usuario WHERE usuario_id = ?', [EVAL_ID])) repo.run('INSERT INTO usuario(usuario_id, nombre_ficticio, activo, compartida) VALUES (?,?,1,0)', [EVAL_ID, EVAL_NOMBRE]);
  const tiene = rolesVigentes(repo, EVAL_ID, t);
  for (const r of EVAL_ROLES) if (!tiene.includes(r)) repo.run('INSERT INTO rol_asignacion VALUES (?,?,?,?,NULL,?,?)', [nuevoId('ROL'), EVAL_ID, r, '2026-01-01T00:00:00-05:00', 'SISTEMA', t]);
}

/** PIN de demostración de los usuarios sintéticos (se documentan en el manual para el profesor). */
export const PIN_DEMO: Record<string, string> = { U01: '1111', U02: '2222', U03: '3333', U04: '4444', U05: '5555', U06: '6666', U07: '7777', U08: '8888' };
const MAX_INTENTOS = 5, BLOQUEO_MIN = 5;

const hash = (sal: string, usuarioId: string, pin: string) => sha256Hex(new TextEncoder().encode(`${sal}|${usuarioId}|${pin}`));
function validarFormato(pin: string) { if (!/^\d{4,8}$/.test(pin)) throw new Error('El PIN debe tener de 4 a 8 dígitos.'); }
function guardar(repo: Repo, usuarioId: string, pin: string, debeCambiar: boolean) {
  const sal = nuevoId('SAL');
  repo.run(`INSERT INTO credencial VALUES (?,?,?,?,0,NULL,?) ON CONFLICT(usuario_id) DO UPDATE SET sal = excluded.sal, pin_hash = excluded.pin_hash,
    debe_cambiar = excluded.debe_cambiar, intentos = 0, bloqueado_hasta = NULL, actualizado_en = excluded.actualizado_en`, [usuarioId, sal, hash(sal, usuarioId, pin), debeCambiar ? 1 : 0, repo.reloj()]);
}

/** Crea la tabla si falta y da PIN inicial a quien no tenga: el de demostración o «0000» con cambio obligatorio. */
export function asegurarCredenciales(repo: Repo) {
  repo.db.exec(DDL_CREDENCIAL);
  asegurarUsuarioEvaluacion(repo);
  if (!repo.uno('SELECT 1 FROM credencial WHERE usuario_id = ?', [EVAL_ID])) guardar(repo, EVAL_ID, '', false); // sin PIN
  const sin = repo.todos("SELECT usuario_id FROM usuario WHERE usuario_id <> 'LEGADO' AND usuario_id NOT IN (SELECT usuario_id FROM credencial)");
  for (const u of sin) { const id = String(u.usuario_id); guardar(repo, id, PIN_DEMO[id] ?? '0000', !PIN_DEMO[id]); }
}

export function iniciarSesion(repo: Repo, usuarioId: string, pin: string) {
  return repo.transaccion(() => {
    const t = repo.reloj();
    const u = repo.uno('SELECT activo FROM usuario WHERE usuario_id = ?', [usuarioId]);
    const c = repo.uno('SELECT * FROM credencial WHERE usuario_id = ?', [usuarioId]);
    if (!u || u.activo !== 1 || !c) throw new Error('Usuario inexistente o desactivado.');
    const roles = rolesVigentes(repo, usuarioId, t);
    if (!roles.length) throw new Error('Este usuario no tiene roles vigentes hoy. Pida al administrador que revise su asignación.');
    if (c.bloqueado_hasta && String(c.bloqueado_hasta) > t) throw new Error(`Usuario bloqueado por intentos fallidos hasta las ${String(c.bloqueado_hasta).slice(11, 16)}.`);
    if (hash(String(c.sal), usuarioId, pin) !== c.pin_hash) {
      const n = Number(c.intentos) + 1;
      const hasta = n >= MAX_INTENTOS ? aLima(Date.parse(t) + BLOQUEO_MIN * 60000) : null;
      repo.run('UPDATE credencial SET intentos = ?, bloqueado_hasta = ? WHERE usuario_id = ?', [n >= MAX_INTENTOS ? 0 : n, hasta, usuarioId]);
      repo.auditar({ usuario_id: usuarioId, roles }, 'INICIO_SESION_FALLIDO', null, { intento: n });
      return { ok: false as const, mensaje: hasta ? `PIN incorrecto. Usuario bloqueado ${BLOQUEO_MIN} minutos.` : `PIN incorrecto (intento ${n} de ${MAX_INTENTOS}).` };
    }
    repo.run('UPDATE credencial SET intentos = 0, bloqueado_hasta = NULL WHERE usuario_id = ?', [usuarioId]);
    repo.auditar({ usuario_id: usuarioId, roles }, 'INICIO_SESION', null, {});
    return { ok: true as const, debe_cambiar: c.debe_cambiar === 1, roles };
  });
}

export function cambiarPin(repo: Repo, usuarioId: string, actual: string, nuevo: string) {
  return repo.transaccion(() => {
    const c = repo.uno('SELECT * FROM credencial WHERE usuario_id = ?', [usuarioId]);
    if (!c || hash(String(c.sal), usuarioId, actual) !== c.pin_hash) throw new Error('El PIN actual no es correcto.');
    validarFormato(nuevo);
    if (nuevo === actual) throw new Error('El PIN nuevo debe ser distinto del actual.');
    guardar(repo, usuarioId, nuevo, false);
    repo.auditar({ usuario_id: usuarioId, roles: rolesVigentes(repo, usuarioId) }, 'CAMBIAR_PIN', null, {});
  });
}

/** El administrador asigna un PIN temporal; el usuario deberá cambiarlo al ingresar. */
export function restablecerPin(repo: Repo, por: string, usuarioId: string, temporal: string) {
  return repo.transaccion(() => {
    const a = exigir(repo, por, 'GESTIONAR_USUARIOS');
    validarFormato(temporal);
    if (!repo.uno('SELECT 1 FROM usuario WHERE usuario_id = ?', [usuarioId])) throw new Error('Usuario inexistente.');
    guardar(repo, usuarioId, temporal, true);
    repo.auditar(a, 'RESTABLECER_PIN', null, { usuarioId });
  });
}

// ------------------------------------------------------------------ Pantallas visibles por rol
const NEGOCIO: Rol[] = ['ADMINISTRADOR', 'RESPONSABLE_DATOS', 'ENCARGADO_PEDIDOS', 'ENCARGADO_ALMACEN', 'PLANIFICADOR', 'SUPERVISOR', 'ANALISTA'];
/** Qué pantalla ve cada rol. Ver una pantalla no da permiso para actuar: los botones siguen sujetos a ACCIONES. */
export const VISTAS = {
  inicio: NEGOCIO,
  operacion: ['ENCARGADO_PEDIDOS', 'ENCARGADO_ALMACEN', 'PLANIFICADOR', 'SUPERVISOR', 'ANALISTA'],
  'operacion.pedidos': ['ENCARGADO_PEDIDOS', 'ENCARGADO_ALMACEN', 'PLANIFICADOR', 'SUPERVISOR', 'ANALISTA'],
  'operacion.inventario': ['ENCARGADO_ALMACEN', 'PLANIFICADOR', 'SUPERVISOR', 'ANALISTA'],
  'operacion.disponibilidad': ['ENCARGADO_PEDIDOS', 'PLANIFICADOR', 'SUPERVISOR', 'ANALISTA'],
  'operacion.ajustes': ['ENCARGADO_ALMACEN', 'SUPERVISOR'],
  planificacion: ['PLANIFICADOR', 'ENCARGADO_ALMACEN', 'SUPERVISOR', 'ANALISTA'],
  'planificacion.rutas': ['PLANIFICADOR', 'SUPERVISOR', 'ANALISTA'],
  'planificacion.itinerarios': ['PLANIFICADOR', 'ENCARGADO_ALMACEN', 'SUPERVISOR', 'ANALISTA'],
  'planificacion.red': ['PLANIFICADOR', 'ENCARGADO_ALMACEN', 'SUPERVISOR', 'ANALISTA'],
  control: NEGOCIO,
  'control.alertas': NEGOCIO,
  'control.calidad': ['SUPERVISOR', 'ENCARGADO_ALMACEN', 'ANALISTA'],
  'control.conteos': ['ENCARGADO_ALMACEN', 'SUPERVISOR'],
  'control.costos': ['PLANIFICADOR', 'SUPERVISOR', 'ANALISTA'],
  'control.retornables': ['ENCARGADO_ALMACEN', 'SUPERVISOR'],
  analitica: ['SUPERVISOR', 'ANALISTA', 'PLANIFICADOR', 'ADMINISTRADOR', 'ENCARGADO_PEDIDOS'],
  'analitica.panel': ['SUPERVISOR', 'ANALISTA', 'PLANIFICADOR', 'ADMINISTRADOR', 'ENCARGADO_PEDIDOS'],
  'analitica.diagnostico': ['SUPERVISOR', 'ANALISTA', 'PLANIFICADOR'],
  'analitica.pronostico': ['SUPERVISOR', 'ANALISTA', 'PLANIFICADOR'],
  'analitica.recomendaciones': ['SUPERVISOR', 'ANALISTA', 'PLANIFICADOR'],
  'analitica.simulacion': ['SUPERVISOR', 'ANALISTA', 'PLANIFICADOR'],
  'analitica.alternativas': ['SUPERVISOR', 'ANALISTA', 'PLANIFICADOR'],
  resultados: ['SUPERVISOR', 'ANALISTA', 'ADMINISTRADOR', 'RESPONSABLE_DATOS', 'PLANIFICADOR'],
  datos: ['RESPONSABLE_DATOS', 'ADMINISTRADOR', 'SUPERVISOR', 'PLANIFICADOR', 'SOPORTE'],
  'datos.carga': ['RESPONSABLE_DATOS', 'ADMINISTRADOR'],
  'datos.maestros': ['RESPONSABLE_DATOS'],
  'datos.usuarios': ['ADMINISTRADOR'],
  'datos.parametros': ['SUPERVISOR', 'ADMINISTRADOR'],
  'datos.respaldo': ['ADMINISTRADOR', 'RESPONSABLE_DATOS'],
  'datos.clima': ['PLANIFICADOR', 'ADMINISTRADOR', 'SUPERVISOR'],
  'datos.diagnostico': ['ADMINISTRADOR', 'RESPONSABLE_DATOS', 'SOPORTE'],
  'datos.estado': ['ADMINISTRADOR', 'RESPONSABLE_DATOS', 'SOPORTE', 'SUPERVISOR'],
} as const satisfies Record<string, readonly Rol[]>;
export type Vista = keyof typeof VISTAS;
export const puedeVer = (roles: readonly string[], v: Vista) => (VISTAS[v] as readonly string[]).some((r) => roles.includes(r));
