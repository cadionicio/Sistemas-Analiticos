// Operaciones de negocio. La pantalla y cualquier importador usan estas mismas validaciones.
// Cada operación: revalida el permiso del usuario, valida reglas, ejecuta en una transacción
// y, si trae op_id ya registrado, devuelve el resultado anterior sin repetir el efecto.
import { transaccion, filas, valor, ejecutar, hashPin } from './bd.js';
import { ahoraIso, isoAMs, msAIso, textoLocalAIso } from './fechas.js';
import { TIPOS_TRAMO, NOMBRE_TRAMO } from './tiempo.js';

export const ROLES = {
  PRODUCCION: 'Producción', MANTENIMIENTO: 'Mantenimiento', ALMACEN: 'Almacén',
  RESP_MANTENIMIENTO: 'Responsable de mantenimiento', EVALUACION: 'Evaluación',
};
const PERMISOS = {
  registrar_parada: ['PRODUCCION'],
  verificar_retorno: ['PRODUCCION'],
  cambiar_tramo: ['MANTENIMIENTO', 'RESP_MANTENIMIENTO'],
  diagnosticar: ['MANTENIMIENTO', 'RESP_MANTENIMIENTO'],
  reclasificar_tramo: ['MANTENIMIENTO', 'RESP_MANTENIMIENTO'],
  resolver_reincidencia: ['MANTENIMIENTO', 'RESP_MANTENIMIENTO'],
  abrir_orden: ['MANTENIMIENTO', 'RESP_MANTENIMIENTO'],
  registrar_intervencion: ['MANTENIMIENTO', 'RESP_MANTENIMIENTO'],
  cerrar_orden: ['MANTENIMIENTO', 'RESP_MANTENIMIENTO'],
  ejecutar_preventivo: ['MANTENIMIENTO', 'RESP_MANTENIMIENTO'],
  reservar: ['ALMACEN'],
  consumir: ['ALMACEN'],
  liberar_reserva: ['ALMACEN'],
  registrar_ingreso: ['ALMACEN'],
  gestionar_acciones: ['RESP_MANTENIMIENTO'],
  gestionar_usuarios: ['RESP_MANTENIMIENTO'],
};
export function puede(usuario, permiso) {
  return !!usuario && (usuario.rol === 'EVALUACION' || (PERMISOS[permiso] || []).includes(usuario.rol));
}
export function quienPuede(permiso) { return (PERMISOS[permiso] || []).map(r => ROLES[r]).join(' o '); }

export class ErrorNegocio extends Error {}
const falla = m => { throw new ErrorNegocio(m); };
function exigir(usuario, permiso) {
  if (!usuario) falla('Identifíquese antes de operar.');
  const u = filas('SELECT * FROM usuario WHERE codigo=? AND activo=1', [usuario.codigo])[0];
  if (!u || u.rol !== usuario.rol) falla('El usuario no es válido.');
  if (!puede(u, permiso)) falla(`Esta acción corresponde a ${quienPuede(permiso)}.`);
  return u;
}
const firma = u => u.rol === 'EVALUACION' ? 'Evaluación' : u.nombre;
function siguiente(tabla, campo, prefijo) {
  const n = Number(valor(`SELECT coalesce(max(CAST(substr(${campo}, ${prefijo.length + 1}) AS INTEGER)), 0) FROM ${tabla} WHERE ${campo} LIKE ? AND substr(${campo}, ${prefijo.length + 1}) GLOB '[0-9]*'`, [prefijo + '%'])) + 1;
  return prefijo + String(n).padStart(4, '0');
}
function instanteValido(txt, nombre) {
  const iso = /T.*-05:00$/.test(txt || '') ? txt : textoLocalAIso(txt || '');
  if (!iso) falla(`«${nombre}» no es una fecha y hora válida.`);
  if (isoAMs(iso) > Date.now() + 5 * 60000) falla(`«${nombre}» no puede ser posterior a la hora actual.`);
  return iso;
}
const parametro = (clave, def) => { const v = valor('SELECT valor FROM parametro WHERE clave=?', [clave]); return v === null ? def : Number(v); };
// Idempotencia: si el op_id ya existe en la tabla indicada, se devuelve el registro previo.
function previo(tabla, opId) { return opId ? filas(`SELECT * FROM ${tabla} WHERE op_id=?`, [opId])[0] : null; }

export const tramoAbierto = parada => filas('SELECT * FROM tramo WHERE parada_codigo=? AND fin IS NULL', [parada])[0];
export const paradaAbierta = equipo => filas("SELECT * FROM parada WHERE equipo_codigo=? AND estado='ABIERTA'", [equipo])[0];

// 1. Producción registra la pérdida de disponibilidad
export function registrarParada(d, usuario) {
  const u = exigir(usuario, 'registrar_parada');
  const ya = previo('parada', d.op_id);
  if (ya) return { repetida: true, codigo: ya.codigo };
  if (!filas('SELECT 1 FROM equipo WHERE codigo=?', [d.equipo]).length) falla('Elija un equipo válido.');
  const inicio = instanteValido(d.inicio, 'Hora del hecho');
  if (!(d.sintoma || '').trim()) falla('Describa el síntoma observado.');
  const ab = paradaAbierta(d.equipo);
  if (ab) falla(`El equipo ${d.equipo} ya tiene la parada ${ab.codigo} abierta desde ${ab.inicio.slice(0, 16).replace('T', ' ')}. Una falla adicional se registra dentro de esa parada.`);
  const choque = filas('SELECT codigo FROM parada WHERE equipo_codigo=? AND inicio <= ? AND fin > ?', [d.equipo, inicio, inicio])[0]
    || filas('SELECT codigo FROM parada WHERE equipo_codigo=? AND inicio > ?', [d.equipo, inicio])[0];
  if (choque) falla(`La hora del hecho se superpone con la parada ${choque.codigo}: un equipo solo puede tener una parada en un mismo instante.`);
  const choqueMp = filas('SELECT codigo FROM mant_programado WHERE equipo_codigo=? AND inicio <= ? AND fin > ?', [d.equipo, inicio, inicio])[0];
  if (choqueMp) falla(`A esa hora el equipo estaba en mantenimiento programado (${choqueMp.codigo}); no es una parada no planificada.`);
  return transaccion(() => {
    const codigo = siguiente('parada', 'codigo', 'PAR-');
    const ahora = ahoraIso();
    ejecutar(`INSERT INTO parada(codigo, equipo_codigo, inicio, registro, sintoma, estado_causa, reportado_por, estado, op_id)
      VALUES (?,?,?,?,?, 'PENDIENTE', ?, 'ABIERTA', ?)`, [codigo, d.equipo, inicio, ahora, d.sintoma.trim(), firma(u), d.op_id || null]);
    ejecutar('INSERT INTO tramo(parada_codigo, secuencia, tipo, inicio, evidencia, autor, registro) VALUES (?,1,?,?,?,?,?)',
      [codigo, 'ESPERA_ATENCION', inicio, 'Aviso de Producción', firma(u), ahora]);
    return { codigo };
  }, { tipo: 'REGISTRAR_PARADA', referencia: d.equipo, detalle: d.sintoma, usuario: firma(u) });
}

// 2. Mantenimiento cambia el tramo en curso (cada minuto pertenece a un tramo)
export function cambiarTramo(d, usuario) {
  const u = exigir(usuario, 'cambiar_tramo');
  const p = filas('SELECT * FROM parada WHERE codigo=?', [d.parada])[0];
  if (!p) falla('Parada no encontrada.');
  if (p.estado !== 'ABIERTA') falla('La parada ya está cerrada; use «Reclasificar tramo» con evidencia para corregir.');
  if (!TIPOS_TRAMO.includes(d.tipo)) falla('Elija un tipo de tramo válido.');
  const inst = instanteValido(d.instante, 'Desde');
  const t = tramoAbierto(p.codigo);
  if (inst < t.inicio) falla(`El nuevo tramo no puede empezar antes del tramo actual (${t.inicio.slice(11, 16)}).`);
  if (t.tipo === d.tipo) falla(`La parada ya está en «${NOMBRE_TRAMO[d.tipo]}».`);
  if (d.tipo === 'ESPERA_REPUESTO' && !(d.evidencia || '').trim()) falla('Indique la evidencia de que la falta de la pieza impide continuar (por ejemplo, el pedido o la pieza faltante).');
  if (d.tipo === 'VERIFICACION' && !filas("SELECT 1 FROM tramo WHERE parada_codigo=? AND tipo='REPARACION'", [p.codigo]).length && t.tipo !== 'REPARACION')
    falla('Antes de la verificación debe registrarse la reparación.');
  return transaccion(() => {
    const ahora = ahoraIso();
    if (inst === t.inicio) {
      // Sin minutos transcurridos: el tramo en curso cambia de tipo (no es una reclasificación)
      ejecutar('UPDATE tramo SET tipo=?, evidencia=?, autor=?, registro=? WHERE id=?', [d.tipo, (d.evidencia || '').trim(), firma(u), ahora, t.id]);
    } else {
      ejecutar('UPDATE tramo SET fin=? WHERE id=?', [inst, t.id]);
      ejecutar('INSERT INTO tramo(parada_codigo, secuencia, tipo, inicio, evidencia, autor, registro) VALUES (?,?,?,?,?,?,?)',
        [p.codigo, t.secuencia + 1, d.tipo, inst, (d.evidencia || '').trim(), firma(u), ahora]);
    }
  }, { tipo: 'CAMBIAR_TRAMO', referencia: p.codigo, detalle: `${NOMBRE_TRAMO[d.tipo]} desde ${inst}`, usuario: firma(u) });
}

// 3. Producción verifica el retorno. APTO cierra la parada; NO APTO la mantiene abierta y retoma la reparación.
export function verificarRetorno(d, usuario) {
  const u = exigir(usuario, 'verificar_retorno');
  const p = filas('SELECT * FROM parada WHERE codigo=?', [d.parada])[0];
  if (!p) falla('Parada no encontrada.');
  if (p.estado !== 'ABIERTA') falla('La parada ya fue cerrada.');
  const inst = instanteValido(d.instante, 'Hora de la verificación');
  const t = tramoAbierto(p.codigo);
  if (t.tipo !== 'VERIFICACION') falla('Mantenimiento debe pasar la parada a «Verificación» antes de la prueba de retorno.');
  if (inst <= t.inicio) falla('La verificación debe ser posterior al inicio del tramo de verificación.');
  if (!['APTO', 'NO_APTO'].includes(d.resultado)) falla('Indique el resultado de la prueba.');
  return transaccion(() => {
    const codigo = siguiente('verificacion', 'codigo', 'VER-');
    ejecutar('INSERT INTO verificacion VALUES (?,?,?,?,?,?)', [codigo, p.codigo, inst, d.resultado, firma(u), (d.observacion || '').trim()]);
    ejecutar('UPDATE tramo SET fin=? WHERE id=?', [inst, t.id]);
    if (d.resultado === 'APTO') {
      ejecutar("UPDATE parada SET fin=?, estado='CERRADA', verificado_por=? WHERE codigo=?", [inst, firma(u), p.codigo]);
    } else {
      ejecutar('INSERT INTO tramo(parada_codigo, secuencia, tipo, inicio, evidencia, autor, registro) VALUES (?,?,?,?,?,?,?)',
        [p.codigo, t.secuencia + 1, 'REPARACION', inst, 'Prueba de retorno no apta: ' + (d.observacion || ''), firma(u), ahoraIso()]);
    }
    return { codigo };
  }, { tipo: d.resultado === 'APTO' ? 'RETORNO_APTO' : 'RETORNO_NO_APTO', referencia: p.codigo, detalle: d.observacion || '', usuario: firma(u) });
}

// 4. Diagnóstico: modo de falla, hipótesis o causa confirmada con evidencia; alerta de posible reincidencia
export function registrarDiagnostico(d, usuario) {
  const u = exigir(usuario, 'diagnosticar');
  const p = filas('SELECT * FROM parada WHERE codigo=?', [d.parada])[0];
  if (!p) falla('Parada no encontrada.');
  if (!filas('SELECT 1 FROM modo_falla m JOIN equipo e ON e.tipo_codigo = m.tipo_codigo WHERE m.codigo=? AND e.codigo=?', [d.modo, p.equipo_codigo]).length) falla('Elija un modo de falla del tipo de este equipo.');
  if (!['PENDIENTE', 'HIPOTESIS', 'CONFIRMADA'].includes(d.estado_causa)) falla('Elija el estado de la causa.');
  if (d.estado_causa !== 'PENDIENTE' && !(d.causa || '').trim()) falla('Describa la hipótesis o la causa.');
  if (d.estado_causa === 'CONFIRMADA' && !(d.evidencia || '').trim()) falla('Una causa solo se confirma con observación documentada: indique la evidencia.');
  const ventana = parametro('ventana_reincidencia_dias', 30);
  const desde = msAIso(isoAMs(p.inicio) - ventana * 86400000);
  const ante = filas('SELECT codigo, inicio FROM parada WHERE equipo_codigo=? AND modo_codigo=? AND codigo<>? AND inicio>=? AND inicio<? ORDER BY inicio DESC LIMIT 1',
    [p.equipo_codigo, d.modo, p.codigo, desde, p.inicio])[0];
  return transaccion(() => {
    ejecutar('UPDATE parada SET modo_codigo=?, estado_causa=?, causa=?, evidencia_causa=? WHERE codigo=?',
      [d.modo, d.estado_causa, (d.causa || '').trim(), (d.evidencia || '').trim(), p.codigo]);
    if (ante && (p.reincidencia_de !== ante.codigo)) ejecutar("UPDATE parada SET reincidencia_de=?, estado_reincidencia='PENDIENTE' WHERE codigo=?", [ante.codigo, p.codigo]);
    if (!ante && p.estado_reincidencia === 'PENDIENTE') ejecutar("UPDATE parada SET reincidencia_de=NULL, estado_reincidencia='' WHERE codigo=?", [p.codigo]);
    return { antecedente: ante ? ante.codigo : null, ventana };
  }, { tipo: 'DIAGNOSTICO', referencia: p.codigo, detalle: `${d.modo} · ${d.estado_causa}`, usuario: firma(u) });
}

export function resolverReincidencia(d, usuario) {
  const u = exigir(usuario, 'resolver_reincidencia');
  const p = filas('SELECT * FROM parada WHERE codigo=?', [d.parada])[0];
  if (!p || !p.reincidencia_de) falla('La parada no tiene una posible reincidencia.');
  if (!['CONFIRMADA', 'DESCARTADA'].includes(d.decision)) falla('Elija confirmar o descartar.');
  if (!(d.motivo || '').trim()) falla('Indique el motivo de la decisión.');
  return transaccion(() => ejecutar('UPDATE parada SET estado_reincidencia=? WHERE codigo=?', [d.decision, p.codigo]),
    { tipo: 'REINCIDENCIA_' + d.decision, referencia: p.codigo, detalle: `Antecedente ${p.reincidencia_de}: ${d.motivo}`, usuario: firma(u) });
}

// 5. Reclasificación de un tramo con evidencia (se conserva autor, hora y motivo)
export function reclasificarTramo(d, usuario) {
  const u = exigir(usuario, 'reclasificar_tramo');
  const t = filas('SELECT * FROM tramo WHERE id=?', [d.tramo])[0];
  if (!t) falla('Tramo no encontrado.');
  if (!TIPOS_TRAMO.includes(d.tipo) || d.tipo === t.tipo) falla('Elija un tipo distinto al actual.');
  if (!(d.motivo || '').trim() || !(d.evidencia || '').trim()) falla('La reclasificación exige motivo y evidencia.');
  return transaccion(() => {
    ejecutar('INSERT INTO correccion_tramo(tramo_id, tipo_anterior, tipo_nuevo, autor, instante, motivo, evidencia) VALUES (?,?,?,?,?,?,?)',
      [t.id, t.tipo, d.tipo, firma(u), ahoraIso(), d.motivo.trim(), d.evidencia.trim()]);
    ejecutar('UPDATE tramo SET tipo=? WHERE id=?', [d.tipo, t.id]);
  }, { tipo: 'RECLASIFICAR_TRAMO', referencia: t.parada_codigo, detalle: `${NOMBRE_TRAMO[t.tipo]} → ${NOMBRE_TRAMO[d.tipo]}: ${d.motivo}`, usuario: firma(u) });
}

// 6. Órdenes
export function abrirOrdenCorrectiva(d, usuario) {
  const u = exigir(usuario, 'abrir_orden');
  const ya = previo('orden', d.op_id);
  if (ya) return { repetida: true, codigo: ya.codigo };
  const p = filas('SELECT * FROM parada WHERE codigo=?', [d.parada])[0];
  if (!p) falla('Parada no encontrada.');
  const ab = filas("SELECT codigo FROM orden WHERE parada_codigo=? AND estado='ABIERTA'", [p.codigo])[0];
  if (ab) falla(`La parada ya tiene la orden ${ab.codigo} abierta.`);
  return transaccion(() => {
    const codigo = siguiente('orden', 'codigo', 'OT-');
    ejecutar(`INSERT INTO orden(codigo, tipo, equipo_codigo, parada_codigo, apertura, estado, responsable, descripcion, op_id)
      VALUES (?, 'CORRECTIVA', ?, ?, ?, 'ABIERTA', ?, ?, ?)`, [codigo, p.equipo_codigo, p.codigo, ahoraIso(), firma(u), (d.descripcion || 'Correctivo: ' + p.sintoma).trim(), d.op_id || null]);
    return { codigo };
  }, { tipo: 'ABRIR_ORDEN', referencia: p.codigo, usuario: firma(u) });
}

export function registrarIntervencion(d, usuario) {
  const u = exigir(usuario, 'registrar_intervencion');
  const o = filas('SELECT * FROM orden WHERE codigo=?', [d.orden])[0];
  if (!o || o.estado !== 'ABIERTA') falla('La orden debe estar abierta.');
  const ini = instanteValido(d.inicio, 'Inicio');
  const fin = d.fin ? instanteValido(d.fin, 'Fin') : null;
  if (fin && fin <= ini) falla('El fin debe ser posterior al inicio.');
  if (d.requirio_pieza && !d.pieza) falla('Indique la pieza que requirió la intervención.');
  return transaccion(() => {
    const codigo = siguiente('intervencion', 'codigo', 'INT-');
    ejecutar('INSERT INTO intervencion VALUES (?,?,?,?,?,?,?,?)', [codigo, o.codigo, ini, fin, firma(u), (d.descripcion || '').trim() || 'Intervención', d.requirio_pieza ? 1 : 0, d.requirio_pieza ? d.pieza : null]);
    return { codigo };
  }, { tipo: 'REGISTRAR_INTERVENCION', referencia: o.codigo, usuario: firma(u) });
}

export function cerrarOrden(d, usuario) {
  const u = exigir(usuario, 'cerrar_orden');
  const o = filas('SELECT * FROM orden WHERE codigo=?', [d.orden])[0];
  if (!o || o.estado !== 'ABIERTA') falla('La orden no está abierta.');
  if (o.parada_codigo && filas("SELECT 1 FROM parada WHERE codigo=? AND estado='ABIERTA'", [o.parada_codigo]).length) falla('La parada sigue abierta: Producción debe verificar el retorno antes de cerrar la orden.');
  if (filas("SELECT 1 FROM reserva WHERE orden_codigo=? AND estado='VIGENTE'", [o.codigo]).length) falla('La orden tiene reservas vigentes: Almacén debe entregarlas o liberarlas.');
  return transaccion(() => ejecutar("UPDATE orden SET estado='CERRADA', cierre=? WHERE codigo=?", [ahoraIso(), o.codigo]),
    { tipo: 'CERRAR_ORDEN', referencia: o.codigo, usuario: firma(u) });
}

// 7. Almacén. Físico = saldo inicial + movimientos confirmados. Disponible = físico − reservado vigente.
export function existencia(pieza, corte) {
  const p = filas('SELECT * FROM pieza WHERE codigo=?', [pieza])[0];
  if (!p) return null;
  const si = filas("SELECT fecha_efectiva FROM movimiento WHERE pieza_codigo=? AND tipo='SALDO_INICIAL'", [pieza])[0];
  if (corte && (!si || si.fecha_efectiva > corte)) return { ...p, fisico: null, reservado: null, disponible: null, noDisponible: true };
  const fisico = Number(valor(`SELECT coalesce(sum(cantidad * signo), 0) FROM movimiento WHERE pieza_codigo=?${corte ? ' AND fecha_efectiva <= ?' : ''}`, corte ? [pieza, corte] : [pieza]));
  const reservado = corte
    ? Number(valor("SELECT coalesce(sum(cantidad), 0) FROM reserva WHERE pieza_codigo=? AND fecha <= ? AND (estado='VIGENTE' OR cierre > ?)", [pieza, corte, corte]))
    : Number(valor("SELECT coalesce(sum(cantidad), 0) FROM reserva WHERE pieza_codigo=? AND estado='VIGENTE'", [pieza]));
  return { ...p, fisico, reservado, disponible: fisico - reservado };
}

export function reservarPieza(d, usuario) {
  const u = exigir(usuario, 'reservar');
  const o = filas('SELECT * FROM orden WHERE codigo=?', [d.orden])[0];
  if (!o || o.estado !== 'ABIERTA') falla('Solo se reserva para una orden abierta.');
  const cant = Number(d.cantidad);
  if (!Number.isInteger(cant) || cant <= 0) falla('La cantidad debe ser un entero mayor que 0.');
  return transaccion(() => {
    const e = existencia(d.pieza);
    if (!e) falla('Pieza no encontrada.');
    if (cant > e.disponible) falla(`Solo hay ${e.disponible} ${e.unidad} disponibles de ${e.codigo}.`);
    const codigo = siguiente('reserva', 'codigo', 'RES-');
    ejecutar("INSERT INTO reserva(codigo, orden_codigo, pieza_codigo, cantidad, fecha, estado) VALUES (?,?,?,?,?, 'VIGENTE')", [codigo, o.codigo, d.pieza, cant, ahoraIso()]);
    return { codigo };
  }, { tipo: 'RESERVAR', referencia: o.codigo, detalle: `${d.pieza} × ${cant}`, usuario: firma(u) });
}

export function liberarReserva(d, usuario) {
  const u = exigir(usuario, 'liberar_reserva');
  const r = filas("SELECT * FROM reserva WHERE codigo=? AND estado='VIGENTE'", [d.reserva])[0];
  if (!r) falla('La reserva no está vigente.');
  return transaccion(() => ejecutar("UPDATE reserva SET estado='LIBERADA', cierre=? WHERE codigo=?", [ahoraIso(), r.codigo]),
    { tipo: 'LIBERAR_RESERVA', referencia: r.codigo, usuario: firma(u) });
}

// Entrega y consumo atómicos: movimiento, consumo y liberación de la reserva en una sola transacción.
// Reintentar con el mismo op_id devuelve el consumo ya registrado (no duplica).
export function consumirPieza(d, usuario) {
  const u = exigir(usuario, 'consumir');
  if (!d.op_id) falla('Falta el identificador de la operación.');
  const ya = previo('consumo', d.op_id);
  if (ya) return { repetida: true, codigo: ya.codigo };
  const o = filas('SELECT * FROM orden WHERE codigo=?', [d.orden])[0];
  if (!o || o.estado !== 'ABIERTA') falla('Solo se consume en una orden abierta.');
  const cant = Number(d.cantidad);
  if (!Number.isInteger(cant) || cant <= 0) falla('La cantidad debe ser un entero mayor que 0.');
  const efectiva = d.fecha_efectiva ? instanteValido(d.fecha_efectiva, 'Fecha de entrega') : ahoraIso();
  return transaccion(() => {
    const e = existencia(d.pieza);
    if (!e) falla('Pieza no encontrada.');
    let r = null;
    if (d.reserva) {
      r = filas("SELECT * FROM reserva WHERE codigo=? AND estado='VIGENTE'", [d.reserva])[0];
      if (!r || r.orden_codigo !== o.codigo || r.pieza_codigo !== d.pieza) falla('La reserva no corresponde a esta orden y pieza o ya no está vigente.');
      if (cant > r.cantidad) falla(`La entrega (${cant}) supera la reserva (${r.cantidad}).`);
    } else if (cant > e.disponible) falla(`Solo hay ${e.disponible} ${e.unidad} disponibles de ${e.codigo}.`);
    if (cant > e.fisico) falla(`La existencia física de ${e.codigo} es ${e.fisico}.`);
    const mov = siguiente('movimiento', 'codigo', 'MOV-');
    const con = siguiente('consumo', 'codigo', 'CON-');
    const ahora = ahoraIso();
    ejecutar(`INSERT INTO movimiento(codigo, pieza_codigo, tipo, cantidad, signo, fecha_efectiva, fecha_registro, orden_codigo, referencia, responsable, motivo, op_id)
      VALUES (?,?, 'CONSUMO', ?, -1, ?, ?, ?, ?, ?, 'Entrega para la orden', ?)`, [mov, d.pieza, cant, efectiva, ahora, o.codigo, con, firma(u), d.op_id]);
    ejecutar('INSERT INTO consumo(codigo, orden_codigo, pieza_codigo, cantidad, fecha_efectiva, fecha_registro, responsable, movimiento_codigo, reserva_codigo, op_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [con, o.codigo, d.pieza, cant, efectiva, ahora, firma(u), mov, r ? r.codigo : null, d.op_id]);
    if (r) ejecutar("UPDATE reserva SET estado='CONSUMIDA', cierre=? WHERE codigo=?", [ahora, r.codigo]);
    const des = existencia(d.pieza);
    if (des.fisico < 0 || des.reservado < 0 || des.disponible < 0) falla('La operación dejaría existencias negativas.');
    return { codigo: con, movimiento: mov, fisico: des.fisico, reservado: des.reservado, disponible: des.disponible, liberado: r ? r.cantidad - cant : 0 };
  }, { tipo: 'CONSUMIR', referencia: o.codigo, detalle: `${d.pieza} × ${cant}${d.reserva ? ' (reserva ' + d.reserva + ')' : ''}`, usuario: firma(u) });
}

export function registrarIngreso(d, usuario) {
  const u = exigir(usuario, 'registrar_ingreso');
  const ya = previo('movimiento', d.op_id);
  if (ya) return { repetida: true, codigo: ya.codigo };
  const cant = Number(d.cantidad);
  if (!Number.isInteger(cant) || cant <= 0) falla('La cantidad debe ser un entero mayor que 0.');
  if (!filas('SELECT 1 FROM pieza WHERE codigo=?', [d.pieza]).length) falla('Pieza no encontrada.');
  const efectiva = d.fecha_efectiva ? instanteValido(d.fecha_efectiva, 'Fecha de recepción') : ahoraIso();
  return transaccion(() => {
    const codigo = siguiente('movimiento', 'codigo', 'MOV-');
    ejecutar(`INSERT INTO movimiento(codigo, pieza_codigo, tipo, cantidad, signo, fecha_efectiva, fecha_registro, referencia, responsable, motivo, op_id)
      VALUES (?,?, 'INGRESO', ?, 1, ?, ?, ?, ?, 'Recepción', ?)`, [codigo, d.pieza, cant, efectiva, ahoraIso(), (d.referencia || '').trim(), firma(u), d.op_id || null]);
    return { codigo };
  }, { tipo: 'INGRESO', referencia: d.pieza, detalle: `× ${cant} ${d.referencia || ''}`, usuario: firma(u) });
}

// 8. Preventivo: estado por tarea a partir de su último vencimiento registrado
export function estadoTareas(hoyIso = ahoraIso()) {
  const hoy = hoyIso.slice(0, 10);
  return filas('SELECT t.*, m.nombre AS modo_nombre FROM tarea_preventiva t JOIN modo_falla m ON m.codigo = t.modo_codigo ORDER BY t.codigo').map(t => {
    const ult = filas('SELECT * FROM ejecucion_preventiva WHERE tarea_codigo=? ORDER BY fecha_vencimiento DESC LIMIT 1', [t.codigo])[0];
    const base = ult ? ult.fecha_vencimiento : null;
    const suma = (f, dias) => msAIso(isoAMs(f + 'T12:00:00-05:00') + dias * 86400000).slice(0, 10);
    const proximo = base ? suma(base, t.frecuencia_dias) : t.primer_vencimiento;
    const diasPara = Math.round((isoAMs(proximo + 'T12:00:00-05:00') - isoAMs(hoy + 'T12:00:00-05:00')) / 86400000);
    const estado = diasPara < 0 ? ['error', 'Vencida'] : diasPara <= 3 ? ['alerta', 'Por vencer'] : ['ok', 'Al día'];
    return { ...t, ultima: ult, proximo, diasPara, estado };
  });
}

export function registrarEjecucionPreventiva(d, usuario) {
  const u = exigir(usuario, 'ejecutar_preventivo');
  const t = filas('SELECT * FROM tarea_preventiva WHERE codigo=?', [d.tarea])[0];
  if (!t) falla('Tarea no encontrada.');
  const ini = instanteValido(d.inicio, 'Inicio');
  const fin = instanteValido(d.fin, 'Fin');
  if (fin <= ini) falla('El fin debe ser posterior al inicio.');
  if (!['CONFORME', 'NO_CONFORME'].includes(d.resultado)) falla('Indique el resultado.');
  if (!(d.evidencia || '').trim()) falla('Indique la evidencia de ejecución.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.vencimiento || '')) falla('Indique el vencimiento que se atiende.');
  if (filas('SELECT 1 FROM ejecucion_preventiva WHERE tarea_codigo=? AND fecha_vencimiento=?', [t.codigo, d.vencimiento]).length) falla('Ese vencimiento ya tiene una ejecución registrada.');
  const choque = filas('SELECT codigo FROM parada WHERE equipo_codigo=? AND inicio < ? AND coalesce(fin, ?) > ?', [t.equipo_codigo, fin, '9999', ini])[0];
  if (choque) falla(`El período se superpone con la parada ${choque.codigo}; el mantenimiento programado se registra aparte.`);
  return transaccion(() => {
    const ot = siguiente('orden', 'codigo', 'OT-');
    ejecutar(`INSERT INTO orden(codigo, tipo, equipo_codigo, tarea_codigo, apertura, cierre, estado, responsable, descripcion)
      VALUES (?, 'PREVENTIVA', ?, ?, ?, ?, 'CERRADA', ?, ?)`, [ot, t.equipo_codigo, t.codigo, ini, fin, firma(u), t.descripcion]);
    const ej = siguiente('ejecucion_preventiva', 'codigo', 'EJ-');
    ejecutar('INSERT INTO ejecucion_preventiva VALUES (?,?,?,?,?,?,?)', [ej, t.codigo, ot, d.vencimiento, fin, d.resultado, d.evidencia.trim()]);
    const mp = siguiente('mant_programado', 'codigo', 'MP-');
    ejecutar('INSERT INTO mant_programado VALUES (?,?,?,?,?,?)', [mp, t.equipo_codigo, ini, fin, ot, t.descripcion]);
    return { orden: ot, ejecucion: ej };
  }, { tipo: 'EJECUTAR_PREVENTIVO', referencia: t.codigo, detalle: `Vencimiento ${d.vencimiento} · ${d.resultado}`, usuario: firma(u) });
}

export function nuevoOpId() {
  try { return crypto.randomUUID(); } catch { return 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
}

// 9. Gestión de usuarios: cada persona con su responsabilidad y su PIN (simulación local de responsabilidades).
const ROLES_ASIGNABLES = ['PRODUCCION', 'MANTENIMIENTO', 'ALMACEN', 'RESP_MANTENIMIENTO'];
function salAleatoria() {
  const b = new Uint8Array(8);
  try { crypto.getRandomValues(b); } catch { for (let i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256); }
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
function validarNombre(nombre, excepto) {
  const n = (nombre || '').trim().replace(/\s+/g, ' ');
  if (n.length < 3) falla('Escriba el nombre de la persona (al menos 3 letras).');
  if (filas('SELECT 1 FROM usuario WHERE lower(nombre)=lower(?) AND codigo<>?', [n, excepto || '']).length) falla(`Ya existe un usuario llamado «${n}».`);
  return n;
}
function validarPin(pin) { if (!/^\d{4}$/.test(pin || '')) falla('El PIN debe tener exactamente 4 dígitos.'); }
function quedaResponsable(codigoQueCambia, rolNuevo, activoNuevo) {
  const n = Number(valor("SELECT count(*) FROM usuario WHERE rol='RESP_MANTENIMIENTO' AND activo=1 AND codigo<>?", [codigoQueCambia]));
  return n + (rolNuevo === 'RESP_MANTENIMIENTO' && activoNuevo ? 1 : 0) > 0;
}
export function crearUsuario(d, usuario) {
  const u = exigir(usuario, 'gestionar_usuarios');
  const nombre = validarNombre(d.nombre);
  if (!ROLES_ASIGNABLES.includes(d.rol)) falla('Elija una responsabilidad válida.');
  validarPin(d.pin);
  if (d.pin !== d.pin2) falla('La confirmación del PIN no coincide.');
  return transaccion(() => {
    const codigo = siguiente('usuario', 'codigo', 'USR-');
    const sal = salAleatoria();
    ejecutar('INSERT INTO usuario(codigo, nombre, rol, sal, pin_hash, activo) VALUES (?,?,?,?,?,1)', [codigo, nombre, d.rol, sal, hashPin(sal, d.pin)]);
    return { codigo, nombre };
  }, { tipo: 'CREAR_USUARIO', referencia: nombre, detalle: ROLES[d.rol], usuario: firma(u) });
}
export function editarUsuario(d, usuario) {
  const u = exigir(usuario, 'gestionar_usuarios');
  const x = filas('SELECT * FROM usuario WHERE codigo=?', [d.codigo])[0];
  if (!x || x.rol === 'EVALUACION') falla('Este usuario no se puede modificar.');
  const nombre = validarNombre(d.nombre, x.codigo);
  if (!ROLES_ASIGNABLES.includes(d.rol)) falla('Elija una responsabilidad válida.');
  if (!quedaResponsable(x.codigo, d.rol, x.activo)) falla('Debe quedar al menos un Responsable de mantenimiento activo para administrar usuarios.');
  return transaccion(() => ejecutar('UPDATE usuario SET nombre=?, rol=? WHERE codigo=?', [nombre, d.rol, x.codigo]),
    { tipo: 'EDITAR_USUARIO', referencia: x.codigo, detalle: `${x.nombre} · ${ROLES[x.rol]} → ${nombre} · ${ROLES[d.rol]}`, usuario: firma(u) });
}
export function cambiarPin(d, usuario) {
  const u = exigir(usuario, 'gestionar_usuarios');
  const x = filas('SELECT * FROM usuario WHERE codigo=?', [d.codigo])[0];
  if (!x || x.rol === 'EVALUACION') falla('Este usuario no usa PIN.');
  validarPin(d.pin);
  if (d.pin !== d.pin2) falla('La confirmación del PIN no coincide.');
  return transaccion(() => { const sal = salAleatoria(); ejecutar('UPDATE usuario SET sal=?, pin_hash=? WHERE codigo=?', [sal, hashPin(sal, d.pin), x.codigo]); },
    { tipo: 'CAMBIAR_PIN', referencia: x.codigo, detalle: x.nombre, usuario: firma(u) });
}
export function cambiarEstadoUsuario(d, usuario) {
  const u = exigir(usuario, 'gestionar_usuarios');
  const x = filas('SELECT * FROM usuario WHERE codigo=?', [d.codigo])[0];
  if (!x || x.rol === 'EVALUACION') falla('Este usuario no se puede desactivar.');
  if (!d.activo && x.codigo === u.codigo) falla('No puede desactivar su propio usuario.');
  if (!d.activo && !quedaResponsable(x.codigo, x.rol, 0)) falla('Debe quedar al menos un Responsable de mantenimiento activo.');
  return transaccion(() => ejecutar('UPDATE usuario SET activo=? WHERE codigo=?', [d.activo ? 1 : 0, x.codigo]),
    { tipo: d.activo ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO', referencia: x.codigo, detalle: x.nombre, usuario: firma(u) });
}

// 10. Acciones y seguimiento (decide el Responsable de mantenimiento)
export function registrarAccion(d, usuario) {
  const u = exigir(usuario, 'gestionar_acciones');
  for (const k of ['problema', 'accion', 'responsable', 'objetivo', 'indicador']) if (!(d[k] || '').trim()) falla('Complete todos los campos de la acción.');
  if (!['TECNICA', 'ALMACEN'].includes(d.tipo)) falla('Elija el tipo de acción.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.revision_desde || '') || !/^\d{4}-\d{2}-\d{2}$/.test(d.revision_hasta || '') || d.revision_hasta < d.revision_desde) falla('Indique un período de revisión válido.');
  if (d.tipo === 'TECNICA' && !d.modo) falla('Una acción técnica se mide por modo de falla: elija el modo.');
  if (d.tipo === 'ALMACEN' && !d.pieza) falla('Una acción de almacén se mide por pieza: elija la pieza.');
  return transaccion(() => {
    const codigo = siguiente('accion', 'codigo', 'AC-');
    ejecutar('INSERT INTO accion VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [codigo, d.problema.trim(), d.accion.trim(), d.tipo, d.responsable.trim(), ahoraIso().slice(0, 10), d.objetivo.trim(), d.indicador.trim(), d.revision_desde, d.revision_hasta, '', d.parada || null, d.tipo === 'ALMACEN' ? d.pieza : null, d.tipo === 'TECNICA' ? d.modo : null]);
    return { codigo };
  }, { tipo: 'REGISTRAR_ACCION', referencia: d.problema, usuario: firma(u) });
}
export function registrarSeguimiento(d, usuario) {
  const u = exigir(usuario, 'gestionar_acciones');
  if (!filas('SELECT 1 FROM accion WHERE codigo=?', [d.accion]).length) falla('Acción no encontrada.');
  if (!(d.valor || '').trim()) falla('Anote el resultado observado.');
  return transaccion(() => ejecutar('INSERT INTO seguimiento_accion(accion_codigo, fecha, valor, comentario, autor) VALUES (?,?,?,?,?)', [d.accion, ahoraIso().slice(0, 10), d.valor.trim(), (d.comentario || '').trim(), firma(u)]),
    { tipo: 'SEGUIMIENTO_ACCION', referencia: d.accion, detalle: d.valor, usuario: firma(u) });
}
// Corridas de simulación: cualquier usuario puede guardar una corrida (es un registro de análisis, no una operación de planta)
export function guardarCorrida(d, usuario) {
  if (!usuario) falla('Identifíquese antes de operar.');
  if (filas('SELECT 1 FROM corrida WHERE id=?', [d.id]).length) return { repetida: true, codigo: d.id };
  return transaccion(() => {
    ejecutar('INSERT INTO corrida VALUES (?,?,?,?,?,?,?,?,?,?)', [d.id, 'SIMULACION_AB', ahoraIso(), globalThis.CPR_VERSION || '', d.parametros.semilla, d.parametros.repeticiones, d.parametros.horizonte_dias, JSON.stringify(d.parametros), d.sha06 || '', JSON.stringify({ A: d.A, B: d.B, recomendada: d.recomendada, diferencia_media: d.diferencia_media, ic95: d.diferencia_ic95 })]);
    return { codigo: d.id };
  }, { tipo: 'GUARDAR_CORRIDA', referencia: d.id, detalle: `${d.parametros.pieza} · semilla ${d.parametros.semilla}`, usuario: firma(usuario) });
}

// Tipo de cambio de referencia (consultado por internet en el EXE). Dato de referencia: lo puede guardar cualquier usuario identificado.
export function guardarTipoCambio(d, usuario) {
  if (!usuario) falla('Identifíquese antes de operar.');
  const v = Number(d.valor);
  if (!Number.isFinite(v) || v <= 0 || v > 20) falla('El tipo de cambio recibido no es válido.');
  return transaccion(() => {
    ejecutar('INSERT OR REPLACE INTO parametro VALUES (?,?,?,?)', ['tipo_cambio_usd_venta', String(v), 'S/ por US$', `${d.fuente} · serie ${d.serie} · dato del ${d.fecha} · consultado ${ahoraIso().slice(0, 16).replace('T', ' ')}`]);
    return { codigo: 'tipo_cambio_usd_venta', valor: v };
  }, { tipo: 'TIPO_CAMBIO', referencia: d.serie, detalle: `${v} (${d.fecha})`, usuario: firma(usuario) });
}
