// Perfiles funcionales con vigencia, revalidados al confirmar cada comando (DEC-I01-D7, RN-67, BG01–BG10).
// Es una simulación local de responsabilidades: NO es autenticación empresarial ni protege frente al administrador del equipo.
import type { Repo } from './db';
import { nuevoId } from './util';

export const ROLES = ['ADMINISTRADOR', 'RESPONSABLE_DATOS', 'ENCARGADO_PEDIDOS', 'ENCARGADO_ALMACEN', 'PLANIFICADOR', 'SUPERVISOR', 'ANALISTA', 'SOPORTE'] as const;
export type Rol = (typeof ROLES)[number];
export const NOMBRE_ROL: Record<Rol, string> = {
  ADMINISTRADOR: 'Administración', RESPONSABLE_DATOS: 'Responsable de datos', ENCARGADO_PEDIDOS: 'Encargado de pedidos', ENCARGADO_ALMACEN: 'Encargado de almacén',
  PLANIFICADOR: 'Planificación', SUPERVISOR: 'Supervisión', ANALISTA: 'Análisis', SOPORTE: 'Soporte técnico',
};

export const ACCIONES = {
  CARGAR_DATOS: ['RESPONSABLE_DATOS', 'ADMINISTRADOR'],
  EDITAR_MAESTROS: ['RESPONSABLE_DATOS'],
  GESTIONAR_USUARIOS: ['ADMINISTRADOR'],
  GESTIONAR_PEDIDOS: ['ENCARGADO_PEDIDOS'],
  RESERVAR: ['ENCARGADO_ALMACEN', 'ENCARGADO_PEDIDOS'],
  MOVER_INVENTARIO: ['ENCARGADO_ALMACEN'],
  SOLICITAR_AJUSTE: ['ENCARGADO_ALMACEN'],
  APROBAR_AJUSTE: ['SUPERVISOR'],
  PROPONER_FECHA: ['ENCARGADO_PEDIDOS', 'PLANIFICADOR'],
  GESTIONAR_SUMINISTRO: ['PLANIFICADOR', 'ENCARGADO_ALMACEN'],
  EDITAR_PARAMETROS: ['SUPERVISOR', 'ADMINISTRADOR'],
  PLANIFICAR: ['PLANIFICADOR'],
  DESPACHAR: ['ENCARGADO_ALMACEN', 'PLANIFICADOR'],
  RESPALDAR: ['ADMINISTRADOR', 'RESPONSABLE_DATOS'],
  VER_NEGOCIO: ['ADMINISTRADOR', 'RESPONSABLE_DATOS', 'ENCARGADO_PEDIDOS', 'ENCARGADO_ALMACEN', 'PLANIFICADOR', 'SUPERVISOR', 'ANALISTA'],
  SIMULAR: ['PLANIFICADOR', 'SUPERVISOR', 'ANALISTA'],
  EVALUAR_ECONOMIA: ['SUPERVISOR', 'ANALISTA'],
  EXPORTAR: ['ADMINISTRADOR', 'RESPONSABLE_DATOS', 'ENCARGADO_PEDIDOS', 'ENCARGADO_ALMACEN', 'PLANIFICADOR', 'SUPERVISOR', 'ANALISTA'],
} as const satisfies Record<string, readonly Rol[]>;
export type Accion = keyof typeof ACCIONES;
/** Acciones que modifican datos: bloqueadas para cuentas compartidas (BG07). */
const SENSIBLES: Accion[] = ['CARGAR_DATOS', 'EDITAR_MAESTROS', 'GESTIONAR_USUARIOS', 'GESTIONAR_PEDIDOS', 'RESERVAR', 'MOVER_INVENTARIO', 'SOLICITAR_AJUSTE', 'APROBAR_AJUSTE', 'PROPONER_FECHA', 'GESTIONAR_SUMINISTRO', 'EDITAR_PARAMETROS', 'PLANIFICAR', 'DESPACHAR'];

export interface Actor { usuario_id: string; roles: Rol[] }

/** Roles vigentes en el instante dado: intervalo [desde, hasta) y usuario activo (BG02, BG05, BG06). */
export function rolesVigentes(repo: Repo, usuarioId: string, instante = repo.reloj()): Rol[] {
  const u = repo.uno('SELECT activo FROM usuario WHERE usuario_id = ?', [usuarioId]);
  if (!u || u.activo !== 1) return [];
  return repo.todos(`SELECT DISTINCT rol FROM rol_asignacion WHERE usuario_id = ? AND vigente_desde <= ? AND (vigente_hasta IS NULL OR vigente_hasta > ?)`,
    [usuarioId, instante, instante]).map((f) => f.rol as Rol);
}

export function actor(repo: Repo, usuarioId: string): Actor { return { usuario_id: usuarioId, roles: rolesVigentes(repo, usuarioId) }; }

export function puede(repo: Repo, usuarioId: string, accion: Accion): boolean {
  const roles = rolesVigentes(repo, usuarioId);
  return roles.some((r) => (ACCIONES[accion] as readonly Rol[]).includes(r));
}

/** Se llama DENTRO de la transacción del comando: el permiso se comprueba al confirmar, no al abrir la pantalla. */
export function exigir(repo: Repo, usuarioId: string, accion: Accion): Actor {
  const u = repo.uno('SELECT activo, compartida, nombre_ficticio FROM usuario WHERE usuario_id = ?', [usuarioId]);
  if (!u) throw new Error('Usuario inexistente.');
  if (u.activo !== 1) throw new Error(`El usuario «${u.nombre_ficticio}» está desactivado; sus acciones anteriores se conservan, pero no puede operar.`);
  if (u.compartida === 1 && SENSIBLES.includes(accion)) throw new Error('Esta cuenta está marcada como compartida: no se puede atribuir la acción a una persona. Use una identidad individual.');
  const a = actor(repo, usuarioId);
  const permitidos = ACCIONES[accion] as readonly Rol[];
  if (!a.roles.some((r) => permitidos.includes(r)))
    throw new Error(`Su perfil vigente (${a.roles.map((r) => NOMBRE_ROL[r]).join(', ') || 'sin roles vigentes'}) no permite esta acción. Perfiles autorizados: ${permitidos.map((r) => NOMBRE_ROL[r]).join(', ')}.`);
  return a;
}

export const USUARIOS_INICIALES: { id: string; nombre: string; roles: Rol[] }[] = [
  { id: 'U01', nombre: 'Ana (Datos y administración)', roles: ['RESPONSABLE_DATOS', 'ADMINISTRADOR'] },
  { id: 'U02', nombre: 'Bruno (Pedidos)', roles: ['ENCARGADO_PEDIDOS'] },
  { id: 'U03', nombre: 'Carla (Almacén)', roles: ['ENCARGADO_ALMACEN'] },
  { id: 'U04', nombre: 'Diego (Planificación)', roles: ['PLANIFICADOR'] },
  { id: 'U05', nombre: 'Elena (Supervisión)', roles: ['SUPERVISOR'] },
  { id: 'U06', nombre: 'Fabio (Análisis)', roles: ['ANALISTA'] },
  { id: 'U07', nombre: 'Soporte técnico', roles: ['SOPORTE'] },
];

/** Crea usuarios ficticios iniciales si la base no tiene ninguno operativo. */
export function asegurarUsuarios(repo: Repo) {
  if (repo.num("SELECT COUNT(*) FROM usuario WHERE usuario_id <> 'LEGADO'") > 0) return;
  const t = repo.reloj();
  repo.transaccion(() => {
    for (const u of USUARIOS_INICIALES) {
      repo.run('INSERT INTO usuario(usuario_id, nombre_ficticio, activo, compartida) VALUES (?,?,1,0)', [u.id, u.nombre]);
      for (const r of u.roles) repo.run('INSERT INTO rol_asignacion VALUES (?,?,?,?,NULL,?,?)', [nuevoId('ROL'), u.id, r, '2026-01-01T00:00:00-05:00', 'SISTEMA', t]);
    }
  });
}

export function otorgarRol(repo: Repo, por: string, usuarioId: string, rol: Rol, desde: string, hasta: string | null) {
  return repo.transaccion(() => {
    const a = exigir(repo, por, 'GESTIONAR_USUARIOS');
    if (hasta !== null && hasta <= desde) throw new Error('La vigencia debe terminar después de empezar.');
    const id = nuevoId('ROL');
    repo.run('INSERT INTO rol_asignacion VALUES (?,?,?,?,?,?,?)', [id, usuarioId, rol, desde, hasta, por, repo.reloj()]);
    repo.auditar(a, 'OTORGAR_ROL', null, { usuarioId, rol, desde, hasta });
    return id;
  });
}

export function revocarRol(repo: Repo, por: string, asignacionId: string, efectivo: string) {
  return repo.transaccion(() => {
    const a = exigir(repo, por, 'GESTIONAR_USUARIOS');
    const as = repo.uno('SELECT * FROM rol_asignacion WHERE asignacion_id = ?', [asignacionId]);
    if (!as) throw new Error('Asignación inexistente.');
    if (as.rol === 'ADMINISTRADOR') verificarOtroAdmin(repo, String(as.usuario_id), efectivo);
    repo.run('UPDATE rol_asignacion SET vigente_hasta = ? WHERE asignacion_id = ?', [efectivo, asignacionId]);
    repo.auditar(a, 'REVOCAR_ROL', null, { asignacionId, efectivo });
  });
}

function verificarOtroAdmin(repo: Repo, salvo: string, instante: string) {
  const otros = repo.todos("SELECT DISTINCT r.usuario_id FROM rol_asignacion r JOIN usuario u USING (usuario_id) WHERE r.rol='ADMINISTRADOR' AND u.activo=1 AND r.usuario_id<>? AND r.vigente_desde<=? AND (r.vigente_hasta IS NULL OR r.vigente_hasta>?)", [salvo, instante, instante]);
  if (!otros.length) throw new Error('No se puede dejar el sistema sin otra persona con rol de Administración vigente (BG10). Asigne primero otro administrador.');
}

/** Desactiva un usuario sin borrar su historia y reasigna sus pedidos abiertos (BG01, BG06). */
export function desactivarUsuario(repo: Repo, por: string, usuarioId: string, motivo: string, reasignarA: string | null) {
  return repo.transaccion(() => {
    const a = exigir(repo, por, 'GESTIONAR_USUARIOS');
    if (usuarioId === por) throw new Error('No puede desactivar su propio usuario.');
    if (!motivo || motivo.trim().length < 5) throw new Error('Indique el motivo de la desactivación.');
    const t = repo.reloj();
    if (rolesVigentes(repo, usuarioId).includes('ADMINISTRADOR')) verificarOtroAdmin(repo, usuarioId, t);
    if (reasignarA && !rolesVigentes(repo, reasignarA).length) throw new Error('La persona a quien se reasigna no tiene roles vigentes.');
    const n = repo.num("SELECT COUNT(*) FROM pedido WHERE responsable_id = ? AND estado_base <> 'CANCELADO'", [usuarioId]);
    if (reasignarA) repo.run("UPDATE pedido SET responsable_id = ?, revision = revision + 1 WHERE responsable_id = ? AND estado_base <> 'CANCELADO'", [reasignarA, usuarioId]);
    repo.run('UPDATE usuario SET activo = 0, desactivado_en = ?, motivo_desactivacion = ? WHERE usuario_id = ?', [t, motivo, usuarioId]);
    repo.run('UPDATE rol_asignacion SET vigente_hasta = ? WHERE usuario_id = ? AND (vigente_hasta IS NULL OR vigente_hasta > ?)', [t, usuarioId, t]);
    repo.auditar(a, 'DESACTIVAR_USUARIO', null, { usuarioId, motivo, reasignarA, pedidos: n });
    return { pedidosReasignados: reasignarA ? n : 0, pedidosSinResponsable: reasignarA ? 0 : n };
  });
}

export function crearUsuario(repo: Repo, por: string, nombre: string, compartida: boolean) {
  return repo.transaccion(() => {
    const a = exigir(repo, por, 'GESTIONAR_USUARIOS');
    if (!nombre.trim()) throw new Error('El nombre es obligatorio.');
    const id = 'U-' + nuevoId('X').split('-')[2].slice(0, 6).toUpperCase();
    repo.run('INSERT INTO usuario(usuario_id, nombre_ficticio, activo, compartida) VALUES (?,?,1,?)', [id, nombre.trim(), compartida ? 1 : 0]);
    repo.auditar(a, 'CREAR_USUARIO', null, { id, nombre, compartida });
    return id;
  });
}
