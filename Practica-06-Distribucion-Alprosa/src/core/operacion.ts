// I04-b: incidencias en ruta, retornos y devoluciones, calidad (cuarentena), retiro y bloqueo de lotes, conteos y ensayos de continuidad.
// Todas las operaciones son transaccionales e idempotentes por command_id; el inventario se mueve solo con movimientos balanceados.
import type { Repo } from './db';
import { exigir, actor } from './permisos';
import { nuevoId, aLima } from './util';
import { verificarInvariantes, solicitarAjuste, pedidos } from './dominio';
import { enTransitoEtapa, bloqueoActivo, planificar, origenesPlanificables, itinerariosAfectados, registrarCondicion } from './transporte';

const MOV = 'INSERT INTO movimiento VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)';
const transito = (repo: Repo) => String(repo.uno("SELECT nodo_id FROM nodo WHERE tipo = 'TRANSITO' AND activo = 1 ORDER BY nodo_id LIMIT 1")!.nodo_id);
const saldo = (repo: Repo, lote: string, nodo: string, cond: string) => repo.num(`SELECT COALESCE(SUM(CASE WHEN nodo_destino_id = ? THEN q_mil ELSE -q_mil END),0) FROM movimiento
  WHERE lote_id = ? AND condicion = ? AND (nodo_destino_id = ? OR nodo_origen_id = ?)`, [nodo, lote, cond, nodo, nodo]);
/** Reclasificación en un nodo: par de movimientos que cambia la condición sin alterar el balance del lote. */
function reclasificar(repo: Repo, lote: string, nodo: string, de: string, a: string, q: number, t: string, ref: string, motivo: string, usuario: string, cmd: string) {
  repo.run(MOV, [nuevoId('MOV'), lote, nodo, null, de, q, t, t, 'RECLASIFICACION', ref, motivo, usuario, cmd]);
  repo.run(MOV, [nuevoId('MOV'), lote, null, nodo, a, q, t, t, 'RECLASIFICACION', ref, motivo, usuario, cmd]);
}

// ================================================================== Incidencias en ruta (H04, H06, W05, AC05, AJ05)
export type TipoIncidencia = 'AVERIA' | 'DETENCION' | 'PERDIDA' | 'DANO' | 'RETRASO' | 'SOBRECOSTO' | 'OTRO';
export function registrarIncidencia(repo: Repo, usuario: string, p: { tipo: TipoIncidencia; etapa_id: string; descripcion: string; lote_id?: string; q_mil?: number; retraso_min?: number; costo_cent?: number; ubicacion?: string; custodio?: string; ocurrido_en?: string; documento?: string }, commandId = nuevoId('CMD')) {
  return repo.comando(commandId, 'REGISTRAR_INCIDENCIA', actor(repo, usuario), () => {
    exigir(repo, usuario, 'DESPACHAR');
    if (!p.descripcion?.trim()) throw new Error('Describa la incidencia.');
    const e = repo.uno('SELECT * FROM etapa WHERE etapa_id = ?', [p.etapa_id]);
    if (!e) throw new Error('Etapa inexistente.');
    const t = repo.reloj(), ocurrido = p.ocurrido_en || t;
    if (['PERDIDA', 'DANO', 'DETENCION', 'AVERIA'].includes(p.tipo) && e.estado !== 'DESPACHADA') throw new Error('Esta incidencia exige carga en camino: la etapa no está despachada.');
    let q = 0;
    if (['PERDIDA', 'DANO'].includes(p.tipo)) {
      if (!p.lote_id || !p.q_mil || p.q_mil <= 0) throw new Error('Indique lote y cantidad afectados.');
      const viaja = enTransitoEtapa(repo, p.etapa_id).find((x) => x.lote_id === p.lote_id)?.q_mil ?? 0;
      if (p.q_mil > viaja) throw new Error(`La cantidad supera lo que viaja del lote (${viaja / 1000}).`);
      q = p.q_mil;
    }
    const id = nuevoId('INC');
    if (p.tipo === 'PERDIDA') // la pérdida sale del tránsito con causa; no se completa el pedido (AJ05)
      repo.run(MOV, [nuevoId('MOV'), p.lote_id ?? null, transito(repo), null, 'APTO', q, ocurrido, t, 'PERDIDA', p.etapa_id, `Incidencia ${id}: ${p.descripcion}`, usuario, commandId]);
    repo.run('INSERT INTO incidencia VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, p.tipo, p.etapa_id, e.servicio_id, p.lote_id ?? null, q, p.retraso_min ?? 0, p.costo_cent ?? 0,
      p.ubicacion ?? null, p.custodio ?? null, p.descripcion.trim(), ocurrido, t, p.tipo === 'PERDIDA' ? 'CERRADA' : 'ABIERTA', p.tipo === 'PERDIDA' ? t : null, p.tipo === 'PERDIDA' ? 'Pérdida registrada con movimiento' : null, usuario, commandId]);
    if (p.costo_cent && p.costo_cent > 0) // sobrecosto real distinguido del estimado (H07)
      repo.run("INSERT INTO cargo_transporte VALUES (?,?,'RECARGO',?,?,?,'PEN',1000000,?,0,0,?,?,NULL,?)", [nuevoId('CAR'), p.documento || id, e.servicio_id, p.etapa_id, p.costo_cent, p.costo_cent, ocurrido, t, usuario]);
    verificarInvariantes(repo);
    return { incidencia_id: id, tipo: p.tipo, q_mil: q, custodia: p.tipo === 'PERDIDA' ? 'Salió del inventario por pérdida' : `La carga sigue en tránsito bajo custodia${p.custodio ? ' de ' + p.custodio : ''}${p.ubicacion ? ' en ' + p.ubicacion : ''}` };
  });
}

export function cerrarIncidencia(repo: Repo, usuario: string, incidenciaId: string, resolucion: string) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'DESPACHAR');
    const i = repo.uno('SELECT i.*, e.estado eest FROM incidencia i LEFT JOIN etapa e USING (etapa_id) WHERE incidencia_id = ?', [incidenciaId]);
    if (!i || i.estado !== 'ABIERTA') throw new Error('La incidencia no está abierta.');
    if (!resolucion?.trim()) throw new Error('Indique la resolución.');
    if (['AVERIA', 'DETENCION'].includes(String(i.tipo)) && i.eest === 'DESPACHADA') throw new Error('La carga sigue en custodia en ruta: registre su recepción (en el destino previsto o en un nodo de contingencia), su retorno o su pérdida antes de cerrar (H08).');
    repo.run("UPDATE incidencia SET estado = 'CERRADA', cerrada_en = ?, resolucion = ? WHERE incidencia_id = ?", [repo.reloj(), resolucion.trim(), incidenciaId]);
    repo.auditar(a, 'CERRAR_INCIDENCIA', null, { incidenciaId, resolucion });
  });
}

// ================================================================== Retornos de lo no entregado y devoluciones (G04, V07, AB07, H01, AA08, BM07, AJ03, AJ04, AR08)
/** Lo rechazado o no entregado vuelve físicamente a un almacén: llega en CUARENTENA (o DAÑADO) y nunca como apto (AA08, BM07). */
export function registrarRetorno(repo: Repo, usuario: string, p: { etapa_id: string; lote_id: string; q_mil: number; nodo_destino_id: string; condicion?: 'CUARENTENA' | 'DANADO'; motivo: string; documento?: string; solo_anuncio?: boolean }, commandId = nuevoId('CMD')) {
  return repo.comando(commandId, 'REGISTRAR_RETORNO', actor(repo, usuario), () => {
    exigir(repo, usuario, 'DESPACHAR');
    if (!p.motivo?.trim()) throw new Error('Indique el motivo del retorno.');
    const e = repo.uno('SELECT * FROM etapa WHERE etapa_id = ?', [p.etapa_id]);
    if (!e) throw new Error('Etapa inexistente.');
    const n = repo.uno('SELECT tipo FROM nodo WHERE nodo_id = ? AND activo = 1', [p.nodo_destino_id]);
    if (!n || n.tipo !== 'ALMACEN') throw new Error('El retorno se recibe en un almacén activo.');
    const viaja = enTransitoEtapa(repo, p.etapa_id).find((x) => x.lote_id === p.lote_id)?.q_mil ?? 0;
    const anunciado = repo.num("SELECT COALESCE(SUM(q_mil),0) FROM retorno WHERE etapa_id = ? AND lote_id = ? AND estado = 'ANUNCIADO'", [p.etapa_id, p.lote_id]);
    if (p.q_mil <= 0 || p.q_mil > viaja - (p.solo_anuncio ? anunciado : 0)) throw new Error(`Solo hay ${viaja / 1000} del lote en camino para esa etapa; un retorno no crea existencias.`);
    const linea = repo.uno('SELECT pedido_linea_id FROM etapa_carga WHERE etapa_id = ? AND lote_id = ?', [p.etapa_id, p.lote_id])?.pedido_linea_id ?? null;
    const rechazo = repo.num('SELECT COALESCE(SUM(d.rechazado_mil),0) FROM entrega_detalle d JOIN entrega en USING (entrega_id) WHERE en.etapa_id = ? AND d.lote_id = ?', [p.etapa_id, p.lote_id]) > 0;
    const t = repo.reloj(), cond = p.condicion ?? 'CUARENTENA', id = nuevoId('RET');
    if (p.solo_anuncio) { // un aviso o documento no incrementa el saldo físico (AR08)
      repo.run("INSERT INTO retorno VALUES (?,?,?,?,?,?,?,?,?,'ANUNCIADO',?,NULL,?,?,?)", [id, rechazo ? 'RECHAZO' : 'NO_ENTREGADO', p.etapa_id, linea, p.lote_id, p.q_mil, p.nodo_destino_id, cond, p.motivo.trim(), t, p.documento ?? null, usuario, commandId]);
      return { retorno_id: id, estado: 'ANUNCIADO' };
    }
    repo.run(MOV, [nuevoId('MOV'), p.lote_id, transito(repo), p.nodo_destino_id, 'APTO', p.q_mil, t, t, 'RETORNO', p.etapa_id, `Retorno: ${p.motivo}`, usuario, commandId]);
    reclasificar(repo, p.lote_id, p.nodo_destino_id, 'APTO', cond, p.q_mil, t, p.etapa_id, `Retorno a ${cond.toLowerCase()}`, usuario, commandId);
    // concilia anuncios previos de la misma etapa/lote
    let porConciliar = p.q_mil;
    for (const r of repo.todos("SELECT * FROM retorno WHERE etapa_id = ? AND lote_id = ? AND estado = 'ANUNCIADO' ORDER BY anunciado_en", [p.etapa_id, p.lote_id])) {
      if (porConciliar < Number(r.q_mil)) break;
      repo.run("UPDATE retorno SET estado = 'RECIBIDO', recibido_en = ? WHERE retorno_id = ?", [t, r.retorno_id]); porConciliar -= Number(r.q_mil);
    }
    if (porConciliar > 0) repo.run("INSERT INTO retorno VALUES (?,?,?,?,?,?,?,?,?,'RECIBIDO',?,?,?,?,?)", [id, rechazo ? 'RECHAZO' : 'NO_ENTREGADO', p.etapa_id, linea, p.lote_id, porConciliar, p.nodo_destino_id, cond, p.motivo.trim(), t, t, p.documento ?? null, usuario, commandId]);
    if (!enTransitoEtapa(repo, p.etapa_id).some((x) => x.q_mil > 0) && e.final === 1) repo.run("UPDATE etapa SET estado = 'ENTREGADA' WHERE etapa_id = ? AND estado = 'DESPACHADA'", [p.etapa_id]);
    verificarInvariantes(repo);
    return { retorno_id: id, estado: 'RECIBIDO', condicion: cond };
  });
}

/** Devolución del cliente después de aceptar: entra en cuarentena; REPOSICIÓN reabre el pendiente una vez, ANULACIÓN reduce lo pedido sin demanda nueva (AJ03, AJ04). */
export function registrarDevolucion(repo: Repo, usuario: string, p: { pedido_linea_id: string; lote_id: string; q_mil: number; nodo_destino_id: string; tipo: 'REPOSICION' | 'ANULACION'; motivo: string; documento?: string }, commandId = nuevoId('CMD')) {
  return repo.comando(commandId, 'REGISTRAR_DEVOLUCION', actor(repo, usuario), () => {
    exigir(repo, usuario, 'DESPACHAR');
    if (!p.motivo?.trim()) throw new Error('Indique el motivo de la devolución.');
    const l = pedidos(repo).flatMap((x) => x.lineas).find((x) => x.pedido_linea_id === p.pedido_linea_id);
    if (!l) throw new Error('Línea inexistente.');
    const aceptadoLote = repo.num('SELECT COALESCE(SUM(aceptado_mil),0) FROM entrega_detalle WHERE pedido_linea_id = ? AND lote_id = ?', [p.pedido_linea_id, p.lote_id])
      - repo.num("SELECT COALESCE(SUM(q_mil),0) FROM retorno WHERE pedido_linea_id = ? AND lote_id = ? AND tipo LIKE 'DEVOLUCION%'", [p.pedido_linea_id, p.lote_id]);
    if (p.q_mil <= 0 || p.q_mil > aceptadoLote) throw new Error(`Solo se puede devolver lo aceptado de ese lote (${aceptadoLote / 1000}).`);
    const n = repo.uno('SELECT tipo FROM nodo WHERE nodo_id = ?', [p.nodo_destino_id]);
    if (!n || n.tipo !== 'ALMACEN') throw new Error('La devolución se recibe en un almacén.');
    const t = repo.reloj(), id = nuevoId('RET');
    repo.run(MOV, [nuevoId('MOV'), p.lote_id, null, p.nodo_destino_id, 'CUARENTENA', p.q_mil, t, t, 'DEVOLUCION', id, `Devolución ${p.tipo.toLowerCase()}: ${p.motivo}`, usuario, commandId]);
    repo.run("INSERT INTO retorno VALUES (?,?,NULL,?,?,?,?,'CUARENTENA',?,'RECIBIDO',?,?,?,?,?)", [id, `DEVOLUCION_${p.tipo}`, p.pedido_linea_id, p.lote_id, p.q_mil, p.nodo_destino_id, p.motivo.trim(), t, t, p.documento ?? null, usuario, commandId]);
    if (p.tipo === 'ANULACION') repo.run('UPDATE pedido_linea SET q_cancelada_mil = q_cancelada_mil + ? WHERE pedido_linea_id = ?', [p.q_mil, p.pedido_linea_id]);
    verificarInvariantes(repo);
    return { retorno_id: id, tipo: p.tipo };
  });
}

// ================================================================== Calidad: cuarentena → apto / dañado / baja (H01, H02, BM06)
export function decidirCalidad(repo: Repo, usuario: string, p: { lote_id: string; nodo_id: string; q_mil: number; desde?: 'CUARENTENA' | 'DANADO'; hacia: 'APTO' | 'DANADO' | 'BAJA'; evidencia: string }, commandId = nuevoId('CMD')) {
  return repo.comando(commandId, 'DECIDIR_CALIDAD', actor(repo, usuario), () => {
    exigir(repo, usuario, 'APROBAR_AJUSTE'); // la liberación de calidad la decide supervisión, no quien recibió
    if (!p.evidencia?.trim()) throw new Error('La decisión de calidad exige evidencia (informe, análisis o acta).');
    const desde = p.desde ?? 'CUARENTENA', hay = saldo(repo, p.lote_id, p.nodo_id, desde);
    if (p.q_mil <= 0 || p.q_mil > hay) throw new Error(`En ${p.nodo_id} hay ${hay / 1000} del lote en ${desde.toLowerCase()}.`);
    const t = repo.reloj(), b = bloqueoActivo(repo, p.lote_id);
    if (p.hacia === 'BAJA') repo.run(MOV, [nuevoId('MOV'), p.lote_id, p.nodo_id, null, desde, p.q_mil, t, t, 'PERDIDA', null, `Baja por calidad: ${p.evidencia}`, usuario, commandId]);
    else reclasificar(repo, p.lote_id, p.nodo_id, desde, p.hacia, p.q_mil, t, b ? String(b.bloqueo_id) : '', `Decisión de calidad: ${p.evidencia}`, usuario, commandId);
    repo.run('INSERT INTO decision_calidad VALUES (?,?,?,?,?,?,?,?,?,?,?)', [nuevoId('DCA'), p.lote_id, p.nodo_id, p.q_mil, desde, p.hacia, p.evidencia.trim(), b?.bloqueo_id ?? null, t, usuario, commandId]);
    verificarInvariantes(repo);
    return { hacia: p.hacia, q_mil: p.q_mil, retiro_activo: !!b };
  });
}

// ================================================================== Retiro y bloqueo de lotes (BM01–BM10, AA07, H03)
/** Localiza cada cantidad de un lote: almacenes por condición, en camino por etapa/custodio, entregado a clientes, reservado y planificado (H03, BM02, BM03, BM08). */
export function trazabilidadLote(repo: Repo, loteId: string, desde?: string) {
  const ubic = repo.todos(`WITH s AS (SELECT nodo_destino_id n, condicion c, q_mil q FROM movimiento WHERE lote_id = ? AND nodo_destino_id IS NOT NULL
      UNION ALL SELECT nodo_origen_id, condicion, -q_mil FROM movimiento WHERE lote_id = ? AND nodo_origen_id IS NOT NULL)
    SELECT s.n nodo_id, n.tipo, s.c condicion, SUM(q) q_mil FROM s JOIN nodo n ON n.nodo_id = s.n GROUP BY 1,2,3 HAVING SUM(q) <> 0 ORDER BY 1,3`, [loteId, loteId]);
  const enCamino = repo.todos(`SELECT e.etapa_id, i.pedido_id, e.nodo_origen_id, e.nodo_destino_id, e.despachada_en, s.recurso_id FROM etapa e JOIN itinerario i USING (itinerario_id) JOIN servicio s USING (servicio_id)
    WHERE e.estado IN ('DESPACHADA','ENTREGADA') AND EXISTS (SELECT 1 FROM etapa_carga ec WHERE ec.etapa_id = e.etapa_id AND ec.lote_id = ?)`, [loteId])
    .map((e) => Object.assign({}, e, { q_mil: enTransitoEtapa(repo, String(e.etapa_id)).find((x) => x.lote_id === loteId)?.q_mil ?? 0 }) as Record<string, any> & { q_mil: number }).filter((e) => e.q_mil > 0);
  const aceptado = repo.todos(`SELECT p.pedido_id, p.cliente_id, p.destino_id, SUM(d.aceptado_mil) q_mil, MIN(en.ocurrido_en) primera, MAX(en.ocurrido_en) ultima
    FROM entrega_detalle d JOIN entrega en USING (entrega_id) JOIN pedido p ON p.pedido_id = en.pedido_id WHERE d.lote_id = ? AND d.aceptado_mil > 0 GROUP BY 1,2,3 ORDER BY 1`, [loteId]);
  const enVerificacion = repo.todos(`SELECT en.pedido_id, SUM(d.en_verificacion_mil) q_mil FROM entrega_detalle d JOIN entrega en USING (entrega_id) WHERE d.lote_id = ? AND d.en_verificacion_mil > 0 AND en.estado = 'EN_VERIFICACION' GROUP BY 1`, [loteId]);
  const reservado = repo.todos(`SELECT pl.pedido_id, r.nodo_id, SUM(r.q_mil) q_mil FROM reserva r JOIN pedido_linea pl USING (pedido_linea_id) WHERE r.lote_id = ? AND r.estado = 'ACTIVA' GROUP BY 1,2`, [loteId]);
  const planificado = repo.todos(`SELECT i.pedido_id, e.etapa_id, SUM(ec.q_mil) q_mil FROM etapa_carga ec JOIN etapa e USING (etapa_id) JOIN itinerario i USING (itinerario_id)
    WHERE ec.lote_id = ? AND e.estado = 'PLANIFICADA' AND i.estado IN ('CONFIRMADO','EN_EJECUCION') GROUP BY 1,2`, [loteId]);
  const despachosEnIntervalo = desde ? repo.todos(`SELECT transfer_id etapa_id, ocurrido_en, registrado_en, q_mil FROM movimiento WHERE lote_id = ? AND tipo = 'DESPACHO' AND ocurrido_en >= ? ORDER BY ocurrido_en`, [loteId, desde]) : [];
  const devuelto = repo.num("SELECT COALESCE(SUM(q_mil),0) FROM retorno WHERE lote_id = ? AND tipo LIKE 'DEVOLUCION%' AND estado = 'RECIBIDO'", [loteId]);
  const enAlmacen = ubic.filter((u) => u.tipo !== 'TRANSITO' && u.tipo !== 'DESTINO');
  return {
    lote_id: loteId, ubicaciones: enAlmacen, en_camino: enCamino, aceptado_por_clientes: aceptado, en_verificacion: enVerificacion, reservado, planificado, despachos_en_intervalo: despachosEnIntervalo,
    resumen: {
      fisico_apto_mil: enAlmacen.filter((u) => u.condicion === 'APTO').reduce((a, u) => a + Number(u.q_mil), 0),
      fisico_retenido_mil: enAlmacen.filter((u) => u.condicion !== 'APTO').reduce((a, u) => a + Number(u.q_mil), 0),
      en_camino_mil: enCamino.reduce((a, e) => a + e.q_mil, 0),
      en_cliente_mil: aceptado.reduce((a, x) => a + Number(x.q_mil), 0) - devuelto,
    },
  };
}

/** Bloqueo de calidad / retiro: retiene todo lo apto del lote en almacenes, suspende reservas y planes no ejecutados y localiza lo que viaja o ya se entregó. */
export function bloquearLote(repo: Repo, usuario: string, p: { lote_id: string; motivo: string; efecto_desde?: string }, commandId = nuevoId('CMD')) {
  return repo.comando(commandId, 'BLOQUEAR_LOTE', actor(repo, usuario), () => {
    exigir(repo, usuario, 'APROBAR_AJUSTE');
    if (!p.motivo?.trim()) throw new Error('Indique el motivo del bloqueo o retiro.');
    if (!repo.uno('SELECT 1 FROM lote WHERE lote_id = ?', [p.lote_id])) throw new Error('Para bloquear se necesita un lote identificado. Registre el aviso como alerta y solicite la identificación; no se bloquea por nombre de producto (BM04).');
    if (bloqueoActivo(repo, p.lote_id)) throw new Error('El lote ya tiene un retiro activo.');
    const t = repo.reloj(), id = nuevoId('BLQ');
    repo.run("INSERT INTO bloqueo_lote VALUES (?,?,?,?,?,'ACTIVO',NULL,NULL,?)", [id, p.lote_id, p.motivo.trim(), p.efecto_desde || t, t, usuario]);
    // 1) reservas activas: se liberan sin volver a «apto» (BM01)
    const reservas = repo.todos(`SELECT r.*, pl.pedido_id FROM reserva r JOIN pedido_linea pl USING (pedido_linea_id) WHERE r.lote_id = ? AND r.estado = 'ACTIVA'`, [p.lote_id]);
    repo.run("UPDATE reserva SET estado = 'LIBERADA', liberada_en = ?, motivo_liberacion = ? WHERE lote_id = ? AND estado = 'ACTIVA'", [t, `Retiro de calidad ${id}`, p.lote_id]);
    // 2) itinerarios con ese lote sin ejecutar: se cancelan sus etapas pendientes
    const planes = repo.todos(`SELECT DISTINCT i.itinerario_id, i.pedido_id FROM itinerario i JOIN etapa e USING (itinerario_id) JOIN etapa_carga ec USING (etapa_id)
      WHERE ec.lote_id = ? AND e.estado = 'PLANIFICADA' AND i.estado IN ('CONFIRMADO','EN_EJECUCION')`, [p.lote_id]);
    for (const pl of planes) {
      repo.run("UPDATE etapa SET estado = 'CANCELADA' WHERE itinerario_id = ? AND estado = 'PLANIFICADA'", [pl.itinerario_id]);
      repo.run(`UPDATE itinerario SET estado = CASE WHEN EXISTS (SELECT 1 FROM etapa WHERE itinerario_id = ? AND estado <> 'CANCELADA') THEN 'REEMPLAZADO' ELSE 'CANCELADO' END WHERE itinerario_id = ?`, [pl.itinerario_id, pl.itinerario_id]);
    }
    // 3) todo lo apto en nodos con custodia pasa a cuarentena (no se suma a prometible: BM08)
    for (const u of repo.todos(`WITH s AS (SELECT nodo_destino_id n, q_mil q FROM movimiento WHERE lote_id = ? AND condicion = 'APTO' AND nodo_destino_id IS NOT NULL
        UNION ALL SELECT nodo_origen_id, -q_mil FROM movimiento WHERE lote_id = ? AND condicion = 'APTO' AND nodo_origen_id IS NOT NULL)
      SELECT s.n, SUM(q) q FROM s JOIN nodo n ON n.nodo_id = s.n WHERE n.tipo NOT IN ('TRANSITO','DESTINO') GROUP BY 1 HAVING SUM(q) > 0`, [p.lote_id, p.lote_id]))
      reclasificar(repo, p.lote_id, String(u.n), 'APTO', 'CUARENTENA', Number(u.q), t, id, `Retiro de calidad: ${p.motivo}`, usuario, commandId);
    verificarInvariantes(repo);
    const traza = trazabilidadLote(repo, p.lote_id, p.efecto_desde && p.efecto_desde < t ? p.efecto_desde : undefined);
    return { bloqueo_id: id, pedidos_afectados: [...new Set([...reservas.map((r) => String(r.pedido_id)), ...planes.map((x) => String(x.pedido_id))])].sort(), itinerarios_detenidos: planes.length, traza,
      retroactivo: !!p.efecto_desde && p.efecto_desde < t };
  });
}

/** Cierre del episodio: cada cantidad localizada debe estar retenida, liberada con evidencia, dada de baja o declarada; nada puede seguir en camino (BM10). */
export function cerrarRetiro(repo: Repo, usuario: string, bloqueoId: string, cierre: string) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'APROBAR_AJUSTE');
    const b = repo.uno("SELECT * FROM bloqueo_lote WHERE bloqueo_id = ? AND estado = 'ACTIVO'", [bloqueoId]);
    if (!b) throw new Error('El retiro no está activo.');
    if (!cierre?.trim()) throw new Error('Describa la conciliación de cierre.');
    const tr = trazabilidadLote(repo, String(b.lote_id));
    const pend: string[] = [];
    if (tr.en_camino.length) pend.push(`${tr.en_camino.length} etapa(s) con carga en camino (${tr.resumen.en_camino_mil / 1000})`);
    if (tr.en_verificacion.length) pend.push('entregas en verificación sin resolver');
    const enCuarentena = tr.ubicaciones.filter((u) => u.condicion === 'CUARENTENA').reduce((a2, u) => a2 + Number(u.q_mil), 0);
    if (enCuarentena) pend.push(`${enCuarentena / 1000} en cuarentena sin decisión de calidad`);
    if (pend.length) throw new Error('No se puede cerrar el retiro: ' + pend.join('; ') + '.');
    repo.run("UPDATE bloqueo_lote SET estado = 'CERRADO', cerrado_en = ?, cierre = ? WHERE bloqueo_id = ?", [repo.reloj(), cierre.trim(), bloqueoId]);
    repo.auditar(a, 'CERRAR_RETIRO', null, { bloqueoId, cierre, resumen: tr.resumen });
    return tr.resumen;
  });
}

// ================================================================== Conteos y recuentos (Conteos / Recuentos / Resoluciones; H08)
/** Registra un conteo a un corte: compara con el saldo del sistema a ese corte (excluye movimientos posteriores) y, si difiere, exige recuento o ajuste con doble revisión. */
export function registrarConteo(repo: Repo, usuario: string, p: { nodo_id: string; lote_id: string; condicion?: string; contado_mil: number; corte?: string; recuento_de?: string }) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'SOLICITAR_AJUSTE');
    const t = repo.reloj(), corte = p.corte || t, cond = p.condicion ?? 'APTO';
    if (!Number.isSafeInteger(p.contado_mil) || p.contado_mil < 0) throw new Error('Cantidad contada inválida.');
    const sistema = repo.num(`SELECT COALESCE(SUM(CASE WHEN nodo_destino_id = ? THEN q_mil ELSE -q_mil END),0) FROM movimiento
      WHERE lote_id = ? AND condicion = ? AND (nodo_destino_id = ? OR nodo_origen_id = ?) AND ocurrido_en <= ?`, [p.nodo_id, p.lote_id, cond, p.nodo_id, p.nodo_id, corte]);
    // ESC-AY03: la misma ubicación/lote/condición/corte no se cuenta dos veces mientras haya un conteo abierto (salvo recuento explícito)
    if (!p.recuento_de && repo.uno("SELECT 1 FROM conteo WHERE nodo_id = ? AND lote_id = ? AND condicion = ? AND corte = ? AND estado IN ('RECUENTO','PENDIENTE')", [p.nodo_id, p.lote_id, cond, corte]))
      throw new Error('Ese lote ya tiene un conteo abierto en esta ubicación y corte: registre un RECUENTO del conteo existente en vez de otro conteo (no se duplica el ajuste).');
    // ESC-AY07: lo que viene en camino hacia el nodo no es existencia física recibida
    const enCamino = repo.num("SELECT COALESCE(SUM(c.q_mil),0) FROM etapa_carga c JOIN etapa e USING (etapa_id) WHERE e.estado = 'DESPACHADA' AND e.nodo_destino_id = ? AND c.lote_id = ?", [p.nodo_id, p.lote_id]);
    const dif = p.contado_mil - sistema, id = nuevoId('CNT');
    if (p.recuento_de) repo.run("UPDATE conteo SET estado = 'RESUELTO', resolucion = ? WHERE conteo_id = ? AND estado IN ('PENDIENTE','RECUENTO')", [`Recontado en ${id}`, p.recuento_de]);
    repo.run('INSERT INTO conteo VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?,NULL)', [id, p.nodo_id, p.lote_id, cond, corte, p.contado_mil, sistema, dif, dif === 0 ? 'SIN_DIFERENCIA' : p.recuento_de ? 'PENDIENTE' : 'RECUENTO', p.recuento_de ?? null, usuario, t]);
    const avisoCamino = enCamino > 0 && dif > 0 && dif <= enCamino ? ` Atención: hay ${enCamino / 1000} en camino hacia este nodo; si se contaron, no son existencia recibida: se concilian al registrar la recepción.` : '';
    return { conteo_id: id, sistema_mil: sistema, diferencia_mil: dif, en_camino_mil: enCamino, siguiente: (dif === 0 ? 'Sin diferencia' : p.recuento_de ? 'La diferencia se confirma: solicite el ajuste (doble revisión)' : 'Hay diferencia: realice un recuento antes de ajustar') + avisoCamino };
  });
}

/** Convierte una diferencia confirmada por recuento en una solicitud de ajuste causal separada (no se ajusta directo). */
export function solicitarAjustePorConteo(repo: Repo, usuario: string, conteoId: string, motivo: string) {
  return repo.transaccion(() => {
    const c = repo.uno("SELECT * FROM conteo WHERE conteo_id = ? AND estado = 'PENDIENTE'", [conteoId]);
    if (!c) throw new Error('Solo se ajusta una diferencia confirmada por recuento.');
    const s = solicitarAjuste(repo, usuario, { lote_id: String(c.lote_id), nodo_id: String(c.nodo_id), condicion: String(c.condicion), q_delta_mil: Number(c.diferencia_mil), motivo: `${motivo} (conteo ${conteoId})` });
    repo.run("UPDATE conteo SET estado = 'AJUSTE_SOLICITADO', solicitud_id = ? WHERE conteo_id = ?", [String(s), conteoId]);
    return s;
  });
}

// ================================================================== Red cambiante (BN01, BN06, BN10)
/** Cierra un nodo por un período: interrumpe todos sus enlaces de entrada y salida y lista los itinerarios afectados (BN01). */
export function cerrarNodo(repo: Repo, usuario: string, nodoId: string, desde: string, hasta: string, motivo: string, fuente: string) {
  const enlaces = repo.todos('SELECT enlace_id FROM enlace WHERE nodo_origen_id = ? OR nodo_destino_id = ?', [nodoId, nodoId]);
  if (!enlaces.length) throw new Error('El nodo no tiene enlaces.');
  const afectados = new Map<string, unknown>();
  for (const e of enlaces) for (const a of registrarCondicion(repo, usuario, { enlace_id: String(e.enlace_id), estado: 'INTERRUMPIDO', motivo: `Cierre de ${nodoId}: ${motivo}`, desde, hasta, fuente }).afectados) afectados.set(String((a as { itinerario_id: string }).itinerario_id), a);
  return { enlaces: enlaces.length, afectados: [...afectados.values()] };
}

/** Suspende las salidas futuras de un enlace sin fecha de retorno: la capacidad deja de estar confirmada (BN06). */
export function suspenderServicios(repo: Repo, usuario: string, enlaceId: string, desde: string, motivo: string) {
  return repo.transaccion(() => {
    const a = exigir(repo, usuario, 'PLANIFICAR');
    const ids = repo.todos("SELECT servicio_id FROM servicio WHERE enlace_id = ? AND estado = 'PROGRAMADO' AND salida >= ? AND servicio_id NOT IN (SELECT servicio_id FROM etapa WHERE estado <> 'CANCELADA')", [enlaceId, desde]).map((x) => String(x.servicio_id));
    const comprometidas = repo.todos("SELECT DISTINCT e.servicio_id, i.pedido_id FROM etapa e JOIN itinerario i USING (itinerario_id) JOIN servicio s USING (servicio_id) WHERE s.enlace_id = ? AND s.salida >= ? AND e.estado = 'PLANIFICADA'", [enlaceId, desde]);
    for (const id of ids) repo.run("UPDATE servicio SET estado = 'CANCELADO' WHERE servicio_id = ?", [id]);
    repo.auditar(a, 'SUSPENDER_SERVICIOS', null, { enlaceId, desde, motivo, suspendidas: ids.length });
    return { suspendidas: ids.length, salidas_con_pedidos_que_requieren_decision: comprometidas };
  });
}

/** Ensayo de pérdida de un nodo: con la misma demanda, cuántos pedidos siguen alcanzables, a qué costo y atraso. No modifica datos (se revierte) (BN10). */
export function ensayoContinuidad(repo: Repo, nodoId: string, desde: string, hasta: string) {
  const base = new Map<string, { factible: boolean; entrega: string; costo: number }>();
  const pedidosIds = repo.todos("SELECT DISTINCT pl.pedido_id FROM reserva r JOIN pedido_linea pl USING (pedido_linea_id) WHERE r.estado = 'ACTIVA'").map((x) => String(x.pedido_id));
  const evaluar = () => new Map(pedidosIds.map((id) => {
    const alts = origenesPlanificables(repo, id).map((o) => planificar(repo, id, o.origen, o.items).alternativas[0]).filter(Boolean);
    const ok = alts.length > 0 && alts.every((a) => a.factible);
    return [id, { factible: ok, entrega: ok ? alts.map((a) => a.entrega_prevista).sort().at(-1)! : '', costo: alts.reduce((s, a) => s + a.costo_cent, 0) }];
  }));
  for (const [k, v] of evaluar()) base.set(k, v);
  repo.db.exec('SAVEPOINT ensayo');
  let sin: Map<string, { factible: boolean; entrega: string; costo: number }>;
  try {
    const t = repo.reloj();
    for (const e of repo.todos('SELECT enlace_id FROM enlace WHERE nodo_origen_id = ? OR nodo_destino_id = ?', [nodoId, nodoId]))
      repo.run("INSERT INTO condicion_acceso VALUES (?,?,'INTERRUMPIDO','Ensayo de continuidad',?,?,?,'Ensayo',NULL)", [nuevoId('ENS'), e.enlace_id, desde, hasta, t]);
    sin = evaluar();
  } finally { repo.db.exec('ROLLBACK TO ensayo'); repo.db.exec('RELEASE ensayo'); }
  const filas = pedidosIds.map((id) => {
    const a = base.get(id)!, b = sin.get(id)!;
    return { pedido_id: id, base_factible: a.factible, ensayo_factible: b.factible, atraso_h: a.factible && b.factible ? Math.round((Date.parse(b.entrega) - Date.parse(a.entrega)) / 360000) / 10 : null, costo_extra_cent: a.factible && b.factible ? b.costo - a.costo : null };
  });
  return { nodo_id: nodoId, pedidos: filas.length, alcanzables_base: filas.filter((f) => f.base_factible).length, alcanzables_ensayo: filas.filter((f) => f.ensayo_factible).length, detalle: filas,
    limitacion: 'Ensayo sobre pedidos con reserva activa y la red/servicios programados; no considera capacidad nueva no confirmada.' };
}

export { itinerariosAfectados, aLima };
