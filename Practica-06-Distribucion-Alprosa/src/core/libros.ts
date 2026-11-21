// Libros de entregables 07/08/09: hojas armadas solo con datos y corridas del sistema (sin cifras a mano).
import type { Repo } from './db';
import * as D from './dominio';
import * as K from './kpi';
import * as F from './pronostico';
import * as G from './diagnostico';
import * as M from './simulacion';
import * as E from './economia';
import type { HojaLibro } from './exportar';

export function hojas07(repo: Repo): HojaLibro[] {
  const r = repo, q = (sql: string) => r.todos(sql) as Record<string, unknown>[];
  const lin = D.pedidos(repo).flatMap((p) => p.lineas.map((l) => ({ pedido_id: p.pedido_id, cliente_id: p.cliente_id, destino_id: p.destino_id, estado_pedido: p.estado, atrasado: p.atrasado ? 'sí' : 'no', ventana_fin: p.ventana_fin,
    linea: l.pedido_linea_id, producto_id: l.producto_id, solicitada_mil: l.solicitada_mil, cancelada_mil: l.cancelada_mil, reservada_mil: l.reservada_mil, despachada_mil: l.despachada_mil, aceptada_mil: l.aceptada_mil,
    en_verificacion_mil: l.en_verificacion_mil, rechazada_mil: l.rechazada_mil, retornada_mil: l.retornada_mil, devuelta_mil: l.devuelta_mil, perdida_mil: l.perdida_mil, pendiente_mil: l.pendiente_mil })));
  const saldoMov = q(`SELECT lote_id, nodo, condicion, SUM(q) saldo_mov_mil FROM (SELECT lote_id, nodo_destino_id nodo, condicion, q_mil q FROM movimiento WHERE nodo_destino_id IS NOT NULL UNION ALL SELECT lote_id, nodo_origen_id, condicion, -q_mil FROM movimiento WHERE nodo_origen_id IS NOT NULL) GROUP BY lote_id, nodo, condicion HAVING saldo_mov_mil <> 0 ORDER BY 1, 2, 3`);
  const ex = new Map(D.existencias(repo).map((e) => [`${e.lote_id}|${e.nodo_id}|${e.condicion}`, e.fisico_mil]));
  const conc = saldoMov.map((m) => { const fis = ex.get(`${m.lote_id}|${m.nodo}|${m.condicion}`) ?? 0; return { ...m, fisico_existencias_mil: fis, conciliado: Number(m.saldo_mov_mil) === fis ? 'sí' : 'NO' }; });
  return [
    { nombre: 'Pedidos', descripcion: 'Estado y cantidades por línea: solicitado, cancelado, reservado, despachado, aceptado, en verificación, rechazado, retornado, devuelto, perdido y pendiente.', filas: lin, totales: true },
    { nombre: 'Reservas', descripcion: 'Reservas por lote y nodo (FEFO) con su estado.', filas: q('SELECT r.reserva_id, pl.pedido_id, r.pedido_linea_id, r.lote_id, r.nodo_id, r.q_mil, r.estado FROM reserva r JOIN pedido_linea pl USING (pedido_linea_id) ORDER BY pl.pedido_id, r.reserva_id'), totales: true },
    { nombre: 'Flujos', descripcion: 'Todos los movimientos físicos (apertura, traslados, despacho, recepción, entrega, retorno, ajustes, reclasificación).', filas: q('SELECT movimiento_id, tipo, lote_id, nodo_origen_id, nodo_destino_id, condicion, q_mil, ocurrido_en, registrado_en, transfer_id, motivo, usuario_id FROM movimiento ORDER BY registrado_en, movimiento_id') },
    { nombre: 'Saldos', descripcion: 'Existencias por lote, nodo y condición: físico, reservado y disponible.', filas: D.existencias(repo).map((e) => ({ producto_id: e.producto_id, lote_id: e.lote_id, lote: e.codigo_lote, nodo_id: e.nodo_id, tipo_nodo: e.tipo_nodo, condicion: e.condicion, vencimiento: e.fecha_vencimiento, estado_lote: e.estado_lote, fisico_mil: e.fisico_mil, reservado_mil: e.reservado_mil, disponible_mil: e.disponible_mil })), totales: true },
    { nombre: 'Conciliacion', descripcion: 'Saldo reconstruido desde los movimientos frente al saldo físico por lote/nodo/condición (debe decir «sí» en todas las filas).', filas: conc },
    { nombre: 'Itinerarios', descripcion: 'Itinerarios multimodales por pedido con versión, estado y fechas previstas.', filas: q('SELECT itinerario_id, pedido_id, version, estado, nodo_origen_id, ruta, salida_prevista, llegada_prevista, entrega_prevista, origen_tipo, reemplaza_a FROM itinerario ORDER BY pedido_id, version') },
    { nombre: 'Etapas', descripcion: 'Etapas por tramo y viaje: servicio, medio, horarios, carga y estado. La cantidad de una etapa no se suma con la de otros tramos.', filas: q("SELECT e.etapa_id, i.pedido_id, e.itinerario_id, e.tramo, e.viaje, en.modo_id medio, e.nodo_origen_id, e.nodo_destino_id, e.servicio_id, s.salida salida_programada, s.llegada llegada_programada, e.kg_bruto_mil, e.bultos, CASE e.final WHEN 1 THEN 'sí' ELSE 'no' END etapa_final, e.estado FROM etapa e JOIN itinerario i USING (itinerario_id) JOIN servicio s USING (servicio_id) JOIN enlace en ON en.enlace_id = s.enlace_id ORDER BY i.pedido_id, e.tramo, e.viaje") },
    { nombre: 'Custodias', descripcion: 'Recepciones en nodos intermedios (custodia antes del siguiente tramo).', filas: q("SELECT m.movimiento_id, m.lote_id, m.nodo_destino_id nodo_custodia, n.tipo tipo_nodo, m.condicion, m.q_mil, m.ocurrido_en, m.registrado_en, m.usuario_id FROM movimiento m JOIN nodo n ON n.nodo_id = m.nodo_destino_id WHERE m.tipo IN ('RECEPCION','TRASLADO_RECEPCION') ORDER BY m.registrado_en") },
    { nombre: 'Entregas', descripcion: 'Entregas al cliente final por intento, con método de evidencia y cantidades (receptor ficticio).', filas: q('SELECT e.entrega_id, e.pedido_id, e.etapa_id, e.intento, e.estado, e.ocurrido_en, e.registrado_en, e.metodo_evidencia, e.motivo, SUM(d.aceptado_mil) aceptado_mil, SUM(d.rechazado_mil) rechazado_mil, SUM(d.en_verificacion_mil) en_verificacion_mil FROM entrega e LEFT JOIN entrega_detalle d USING (entrega_id) GROUP BY e.entrega_id ORDER BY e.pedido_id, e.intento'), totales: true },
    { nombre: 'Retornos', descripcion: 'Rechazos, no entregados y devoluciones con condición y destino del retorno.', filas: q('SELECT * FROM retorno ORDER BY 1'), totales: true },
    { nombre: 'Incidencias', descripcion: 'Incidencias de transporte y custodia con retraso y costo.', filas: q('SELECT * FROM incidencia ORDER BY 1'), totales: true },
    { nombre: 'CostosTransporte', descripcion: 'Cargos de transporte por documento y concepto (moneda, tasa e importe en soles).', filas: q('SELECT * FROM cargo_transporte ORDER BY 1'), totales: true },
    { nombre: 'Retornables', descripcion: 'Envases y pallets retornables: ubicación, condición y movimientos.', filas: [...q('SELECT activo_id, tipo, propietario, condicion, ubicacion_tipo, ubicacion_id, actualizado_en FROM activo_retornable'), ...q("SELECT activo_id, tipo tipo_movimiento, desde, hacia, pedido_id, condicion, documento, ocurrido_en actualizado_en FROM movimiento_activo ORDER BY ocurrido_en")] },
    { nombre: 'CalidadConteos', descripcion: 'Decisiones de calidad, bloqueos de lote y conteos con su diferencia.', filas: [...q("SELECT 'DECISION' registro, decision_id id, lote_id, nodo_id, q_mil, desde, hacia, decidido_en instante FROM decision_calidad"), ...q("SELECT 'BLOQUEO' registro, bloqueo_id id, lote_id, motivo, estado, efecto_desde instante FROM bloqueo_lote"), ...q("SELECT 'CONTEO' registro, conteo_id id, lote_id, nodo_id, contado_mil, sistema_mil, diferencia_mil, estado, corte instante FROM conteo")] },
  ];
}
/** Recomendaciones conocidas al corte: en vista ORIGINAL solo las creadas hasta el corte y con la decisión que tenían entonces;
 *  en REEXPRESADA, las guardadas + las que las reglas detectan hoy (marcadas «DETECTADA (sin revisar)»). */
function recomendaciones(repo: Repo, corte: string | null): Record<string, unknown>[] {
  const g = (repo.todos('SELECT regla, entidad, entidad_id, estado, valores, alternativa, impacto, restricciones, creada_en, decidida_por, decidida_en, motivo FROM recomendacion ORDER BY creada_en') as Record<string, unknown>[])
    .filter((x) => !corte || String(x.creada_en) < corte)
    .map((x) => corte && x.decidida_en && String(x.decidida_en) >= corte ? { ...x, estado: 'PROPUESTA (decisión posterior al corte)', decidida_por: '', decidida_en: '', motivo: '' } : x);
  if (corte) return g;
  const det = G.detectarRecomendaciones(repo).filter((p) => !g.some((x) => x.regla === p.regla && x.entidad_id === p.entidad_id))
    .map((p) => ({ regla: p.regla, entidad: p.entidad, entidad_id: p.entidad_id, estado: 'DETECTADA (sin revisar)', valores: p.valores, alternativa: p.alternativa, impacto: p.impacto, restricciones: p.restricciones }));
  return [...g, ...det];
}
/** Cadenas causales tal como se conocían al corte (ORIGINAL) o hoy (REEXPRESADA). En ORIGINAL nada posterior al corte se copia:
 *  estado = última transición antes del corte; validador = quien hizo esa transición de validación; conclusión = la registrada en la
 *  bitácora hasta el corte. Si no se puede reconstruir, se rotula «No disponible al corte» (nunca se usa el valor actual). */
export const NO_DISPONIBLE = 'No disponible al corte (el registro de esa fecha no lo conserva)';
function analisisAl(repo: Repo, corte: string | null) {
  return G.analisis(repo).filter((a) => !corte || String(a.creado_en) < corte).map((a) => {
    if (!corte) return a;
    const historial = a.historial.filter((x) => String(x.en) < corte), evidencias = a.evidencias.filter((x) => String(x.registrado_en) < corte);
    const ultima = historial[historial.length - 1];
    const estado = ultima ? String(ultima.a) : 'HIPOTESIS_PENDIENTE';
    const validado = ['CONFIRMADA', 'REFUTADA', 'NO_CONCLUYENTE'].includes(estado);
    const valid = [...historial].reverse().find((x) => ['CONFIRMADA', 'REFUTADA', 'NO_CONCLUYENTE'].includes(String(x.a)));
    // Conclusión vigente al corte: la última conclusión no vacía registrada en la bitácora antes del corte
    const aud = repo.todos("SELECT registrado_en, detalle FROM auditoria WHERE accion = 'CAMBIAR_ESTADO_CAUSA' AND registrado_en < ? ORDER BY registrado_en, rowid", [corte])
      .map((r) => ({ en: String(r.registrado_en), d: JSON.parse(String(r.detalle)) as { analisisId: string; a: string; conclusion?: string | null } }))
      .filter((r) => r.d.analisisId === a.analisis_id);
    const conConclusion = aud.filter((r) => r.d.conclusion);
    const huboCambiosSinRegistro = aud.some((r) => !('conclusion' in r.d));
    const posteriores = a.historial.some((x) => String(x.en) >= corte);
    const conclusion = conConclusion.length ? conConclusion[conConclusion.length - 1].d.conclusion! : (!posteriores && !huboCambiosSinRegistro ? (a.conclusion ?? null) : (a.conclusion ? NO_DISPONIBLE : null));
    return Object.assign({}, a, { historial, evidencias, estado, conclusion: validado ? conclusion : null, validado_por: validado && valid ? String(valid.usuario_id) : null });
  });
}
/** o.filtros: período [desde, hasta), vista y corte de conocimiento elegidos en Resultados; o.pronostico: corrida guardada elegida. */
export function hojas08(repo: Repo, o: { filtros: K.Filtros; pronostico?: string | null }): HojaLibro[] {
  const h = K.cargarHechos(repo), f: K.Filtros = { ...o.filtros, corte: o.filtros.corte ?? repo.reloj() };
  const vistaTxt = f.vista === 'ORIGINAL' ? `vista ORIGINAL (conocido hasta ${String(f.corte).slice(0, 10)})` : 'vista REEXPRESADA';
  const ho = { desde: f.desde, hasta: f.hasta };
  const corteK = f.vista === 'ORIGINAL' ? String(f.corte) : null; // conocimiento al corte (vista ORIGINAL)
  const cadenas = analisisAl(repo, corteK);
  const prods = repo.todos('SELECT producto_id FROM producto WHERE activo = 1 ORDER BY 1').map((x) => String(x.producto_id));
  const corteP = f.vista === 'ORIGINAL' && String(f.corte) < f.hasta ? String(f.corte) : f.hasta;
  const pr = prods.map((p) => F.pronosticar(repo, h, { producto: p, corte: corteP }));
  const sel = o.pronostico ? repo.uno('SELECT * FROM corrida_pronostico WHERE corrida_id = ?', [o.pronostico]) : undefined;
  // Puente del MISMO período elegido: informe emitido (ORIGINAL al corte elegido, o al cierre del período) frente a lo reexpresado hoy
  const emision = corteK ?? ho.hasta;
  const puente = K.puenteOTIF(h, { desde: ho.desde, hasta: ho.hasta, corte: repo.reloj() }, emision);
  return [
    { nombre: 'Indicadores', descripcion: 'DESCRIPTIVA. Doce indicadores con numerador, denominador, n, definición y universo (' + vistaTxt + ').', filas: K.indicadores(h, f).map((k) => ({ indicador: k.nombre, unidad: k.unidad, valor: k.valor ?? 'N/D', numerador: k.numerador, denominador: k.denominador, n: k.n, definicion: k.definicion, universo: k.inclusion })) },
    { nombre: 'SerieSemanal', descripcion: 'DESCRIPTIVA. OTIF y fill rate por semana (historia + operación).', filas: K.serieOTIF(h, { ...f, granularidad: 'semana' }).map((x) => ({ periodo: x.periodo, a_tiempo_completos: x.num, elegibles: x.den, otif_pct: x.otif ?? 'N/D', fill_pct: x.fill ?? 'N/D' })), totales: true },
    { nombre: 'SerieMensual', descripcion: 'DESCRIPTIVA. OTIF y fill rate por mes.', filas: K.serieOTIF(h, { ...f, granularidad: 'mes' }).map((x) => ({ periodo: x.periodo, a_tiempo_completos: x.num, elegibles: x.den, otif_pct: x.otif ?? 'N/D', fill_pct: x.fill ?? 'N/D' })), totales: true },
    { nombre: 'Pareto', descripcion: 'DIAGNÓSTICA. Causas REGISTRADAS de incumplimiento (no son causas raíz confirmadas); «Sin causa registrada» visible.', filas: K.pareto(h, f).filas.map((x) => ({ causa: x.causa, pedidos: x.n, pct: x.pct, acumulado_pct: x.acumulado })), totales: true },
    { nombre: 'Concentracion', descripcion: 'DIAGNÓSTICA. Dónde se concentran los incumplimientos: por región, remotos/no remotos y medio del último tramo.', filas: (['region', 'remoto', 'modo'] as const).flatMap((d) => K.concentracion(h, f, d).map((x) => ({ dimension: d, ...x }))) },
    { nombre: 'PuenteVistas', descripcion: `DIAGNÓSTICA. Mismo período elegido: informe emitido (ORIGINAL al ${emision.slice(0, 10)}) frente a REEXPRESADO con todo lo registrado hasta hoy: cambios y motivo.`, filas: (puente.cambios as Record<string, unknown>[]) ?? [] },
    { nombre: 'CadenasCausales', descripcion: 'DIAGNÓSTICA. Hecho → evento → causa candidata → evidencias → estado (solo CONFIRMADA por otra persona es causa raíz).', filas: cadenas.map((a) => ({ analisis_id: a.analisis_id, indicador: a.indicador, entidad: `${a.entidad} ${a.entidad_id}`, hecho: a.hecho, evento: a.evento, causa_candidata: a.causa_candidata, estado: a.estado, evidencias_a_favor: a.evidencias.filter((e) => e.sentido === 'A_FAVOR').length, evidencias_en_contra: a.evidencias.filter((e) => e.sentido === 'EN_CONTRA').length, conclusion: a.conclusion ?? '', alternativa_o_accion: a.alternativa ?? '', validado_por: a.validado_por ?? '' })) },
    { nombre: 'Evidencias', descripcion: 'DIAGNÓSTICA. Contenido de cada evidencia de las cadenas causales: sentido (a favor / en contra), descripción, fuente, quién y cuándo. Se vincula por analisis_id.', filas: cadenas.flatMap((a) => a.evidencias.map((e) => ({ analisis_id: a.analisis_id, evidencia_id: e.evidencia_id, sentido: e.sentido === 'A_FAVOR' ? 'A favor' : 'En contra', descripcion: e.descripcion, fuente: e.fuente, registrado_por: e.registrado_por, registrado_en: e.registrado_en }))).concat(cadenas.flatMap((a) => a.historial.map((x) => ({ analisis_id: a.analisis_id, evidencia_id: '(cambio de estado)', sentido: `${x.de ?? '—'} → ${x.a}`, descripcion: x.motivo ?? '', fuente: 'Historial', registrado_por: x.usuario_id, registrado_en: x.en })))) },
    ...(sel ? [{ nombre: 'Pronostico_Elegido', descripcion: `PREDICTIVA. Corrida guardada elegida en Resultados: ${sel.corrida_id} · serie ${sel.serie} · corte ${String(sel.corte).slice(0, 10)} · método ${sel.metodo_elegido ?? 'sin pronóstico'}.`, filas: (JSON.parse(String(sel.prediccion)) as { semana: string; valor: number; p10: number | null; p90: number | null; tipo: string }[]).map((x) => ({ corrida: sel.corrida_id, serie: sel.serie, semana: x.semana, pronostico: x.valor / 1000, p10: x.p10 === null ? 'N/D' : x.p10 / 1000, p90: x.p90 === null ? 'N/D' : x.p90 / 1000, tipo: x.tipo })) }] : []),
    { nombre: 'Pronostico_Metodos', descripcion: `PREDICTIVA. Recalculado al cierre del período (${corteP.slice(0, 10)}) para TODOS los productos: observaciones, método elegido y error (MAE, WAPE) de cada método en la evaluación cronológica sin fuga.`, filas: pr.flatMap((r) => Object.entries(r.metricas ?? {}).map(([m, x]) => ({ serie: r.serie, observaciones: r.n_obs, metodo: m, elegido: r.elegido === m ? 'sí' : '', mae: x.mae === null ? 'N/D' : x.mae / 1000, wape_pct: x.wape ?? 'N/D', semanas_evaluadas: x.n }))).concat(pr.filter((r) => !r.metricas).map((r) => ({ serie: r.serie, observaciones: r.n_obs, metodo: r.elegido ?? 'sin pronóstico', elegido: 'sí', mae: 'N/D', wape_pct: 'N/D', semanas_evaluadas: 0 }))) },
    { nombre: 'Pronostico_Semanas', descripcion: 'PREDICTIVA. Pronóstico semanal por producto (8 semanas desde el cierre del período) con intervalo P10–P90; tipo VALIDADO (≤ 8 semanas) o REFERENCIA.', filas: pr.flatMap((r) => r.prediccion.map((x) => ({ serie: r.serie, semana: x.semana, pronostico: x.valor / 1000, p10: x.p10 === null ? 'N/D' : x.p10 / 1000, p90: x.p90 === null ? 'N/D' : x.p90 / 1000, tipo: x.tipo }))) },
    { nombre: 'Advertencias', descripcion: 'PREDICTIVA. Límites de cada serie (faltantes, atípicos, censura, poca historia).', filas: pr.flatMap((r) => r.advertencias.map((a) => ({ serie: r.serie, advertencia: a }))) },
    { nombre: 'Recomendaciones', descripcion: 'PRESCRIPTIVA. Propuestas por reglas con valores, alternativa, impacto, restricciones y decisión humana.', filas: recomendaciones(repo, corteK) },
  ];
}
export function hojas09(repo: Repo, simId: string | null, evaId: string | null): HojaLibro[] {
  const sim = simId ? M.corridaSim(repo, simId) : null, ev = evaId ? E.evaluacionGuardada(repo, evaId) : null;
  const r = sim?.resultado;
  return [
    { nombre: 'Demanda', descripcion: 'Demanda proyectada por mes (kg solicitados), escenario y si el mes incluye semanas de EXTENSIÓN no validada.', filas: ev ? ev.demanda.meses.map((m) => ({ mes: m.mes, dias: m.dias, kg_demanda: m.kg_demanda, tipo: m.extension ? 'EXTENSIÓN' : 'Validada', escenario: ev.demanda.escenario })) : [], nota: ev ? ev.demanda.nota : 'Sin evaluación guardada.', totales: true },
    { nombre: 'Simulacion', descripcion: `Riesgo de servicio y costo de 3 planes con los mismos sorteos (${r ? `${r.iteraciones} iteraciones, semilla ${sim!.parametros.semilla}` : 'sin corrida'}).`, filas: r ? r.planes.map((p) => ({ plan: p.nombre, pedidos: p.pedidos, servicios_fisicos: p.servicios, otif_esperado_pct: p.a_tiempo.media, otif_p5: p.a_tiempo.p5, otif_p95: p.a_tiempo.p95, ic95_inf: p.a_tiempo.ic95[0], ic95_sup: p.a_tiempo.ic95[1], prob_incumplir_pct: p.prob_incumplimiento * 100, retraso_p95_h: p.retraso_h.p95, costo_medio: p.costo.media, costo_p95: p.costo.p95, kg_no_atendido: p.kg_no_atendido.media })) : [], nota: r?.correlacion },
    { nombre: 'SimulacionPedidos', descripcion: 'Probabilidad por pedido de llegar a tiempo, de no ser atendido y llegada P50/P95.', filas: r ? r.planes.flatMap((p) => p.por_pedido.map((x) => ({ plan: p.nombre, pedido: x.pedido, destino: x.destino, remoto: x.remoto ? 'sí' : 'no', kg: x.kg, prob_a_tiempo_pct: x.prob_a_tiempo * 100, prob_no_atendido_pct: x.prob_no_atendido * 100, retraso_p95_h: x.retraso_p95, llegada_p50: x.llegada_p50 ?? 'N/D', llegada_p95: x.llegada_p95 ?? 'N/D', observacion: x.motivo }))) : [] },
    { nombre: 'Alternativas', descripcion: `Caso base y alternativas de mejora: ingresos, costos, EBIT, NOPAT, capital, cargo de capital, EVA y ΔEVA. ${ev ? ev.convencion : ''}`, filas: ev ? ev.escenarios.map((x) => ({ alternativa: x.nombre, ingresos: x.ingresos, costo_logistico: x.costo_logistico, ebit: x.ebit, nopat: x.nopat, capital_apertura: x.capital_apertura, capital_cierre: x.capital_cierre, capital_promedio: x.capital_promedio, cargo_capital: x.cargo_capital, eva: x.eva ?? 'NO CALCULABLE', delta_eva: x.delta_eva ?? 'N/D', otif_pct: x.servicio.otif_pct, retraso_p95_h: x.servicio.retraso_p95_h, kg_no_atendido: x.kg_no_atendido, inversion: x.inversion, caja_liberada: x.caja_liberada, cambios_fisicos: x.cambios.join(' '), fuente_servicio: x.servicio.fuente, estado: x.estado })) : [] },
    { nombre: 'EVA_Mensual', descripcion: 'Tabla mensual por alternativa.', filas: ev ? ev.escenarios.flatMap((x) => x.meses.map((m) => ({ alternativa: x.nombre, mes: m.mes, kg_demanda: m.kg_demanda, kg_aceptado: m.kg_aceptado, ingresos: m.ingresos, costo_producto: m.costo_producto, costo_logistico: m.costo_logistico, otros: m.otros, depreciacion: m.depreciacion, implementacion: m.implementacion, ebit: m.ebit, impuesto: m.impuesto, nopat: m.nopat, capital_cierre: m.capital_cierre, demanda: m.extension ? 'EXTENSIÓN' : 'Validada' }))) : [] },
    { nombre: 'Comparador', descripcion: `Normalización 0–1 en la misma cohorte, restricciones duras y dominancia. ${ev?.comparador.advertencia ?? ''} Conclusión: ${ev?.comparador.conclusion ?? 'sin evaluación'}`, filas: ev ? ev.comparador.filas.map((f) => ({ alternativa: f.nombre, cumple_restricciones: f.factible ? 'sí' : 'no', motivo: f.motivo, puntaje: f.puntaje ?? '—', dominada_por: f.dominada_por ?? '', ...Object.fromEntries(Object.entries(f.valores).map(([k, v]) => ['valor_' + k, v ?? 'N/D'])), ...Object.fromEntries(Object.entries(f.normalizados).map(([k, v]) => ['norm_' + k, v])) })) : [] },
    { nombre: 'Sensibilidad', descripcion: 'ΔEVA ante demanda ±10 %, transporte ±10 % y WACC ±2 pp.', filas: ev ? ev.sensibilidad.map((x) => ({ alternativa: x.nombre, base: x.base ?? 'N/D', demanda_menos10: x.demanda_menos10 ?? 'N/D', demanda_mas10: x.demanda_mas10 ?? 'N/D', transporte_mas10: x.tarifa_mas10 ?? 'N/D', transporte_menos10: x.tarifa_menos10 ?? 'N/D', wacc_mas2pp: x.wacc_mas2 ?? 'N/D', wacc_menos2pp: x.wacc_menos2 ?? 'N/D' })) : [] },
    { nombre: 'Combinacion', descripcion: 'Combinación de alternativas sin doble conteo: suma individual, ΔEVA conjunto y solapamiento.', filas: ev?.combinacion ? [{ combinacion: ev.combinacion.escenario.nombre, suma_delta_individual: ev.combinacion.suma_individual ?? 'N/D', delta_eva_conjunto: ev.combinacion.escenario.delta_eva ?? 'N/D', solapamiento: ev.combinacion.solapamiento ?? 'N/D', explicacion: ev.combinacion.explicacion }] : [] },
    { nombre: 'Supuestos', descripcion: 'Supuestos de la unidad demostrativa (sintéticos, editables) usados en la evaluación.', filas: ev ? Object.entries(ev.supuestos).map(([k, v]) => ({ clave: k, valor: v === null ? 'FALTA' : v })) : [] },
    { nombre: 'Limitaciones', descripcion: 'Límites declarados de la proyección.', filas: ev ? ev.limitaciones.map((l) => ({ limitacion: l })) : [] },
  ];
}
