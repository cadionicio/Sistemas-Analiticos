// Salidas Excel 07 (operativos), 08 (analítica) y 09 (proyección y control), generadas desde el estado confirmado.
// Cada libro lleva hoja META con versión, corte, filtros, identificador de corrida y SHA-256 del Excel 06 de origen.
// Las cifras son celdas numéricas con formato; los totales de control son fórmulas.
import { filas } from '../nucleo/bd.js';
import { mostrarFH, ahoraIso, isoAMs, minutosEntre } from '../nucleo/fechas.js';
import { NOMBRE_TRAMO, TIPOS_TRAMO, minutosRecortados } from '../nucleo/tiempo.js';
import { indicadores, descriptiva, diagnostica, predictiva, seguimientoAcciones } from '../nucleo/analitica.js';
import { existencia, estadoTareas, ROLES } from '../nucleo/operaciones.js';
import { sha256Hex } from '../nucleo/sha256.js';

const F = { mag: '#,##0.00;[Red]-#,##0.00', mag1: '#,##0.0;[Red]-#,##0.0', ent: '0;[Red]-0', sol: '#,##0.00;[Red]-#,##0.00', mag3: '#,##0.000;[Red]-#,##0.000' };
const X = () => globalThis.XLSX;
const fh = iso => (iso ? mostrarFH(iso) : '');

// Hoja desde filas: encabezados, datos y formatos por columna ('mag','ent','sol','txt')
function hoja(enc, datos, formatos = [], anchos = []) {
  const ws = X().utils.aoa_to_sheet([enc, ...datos.map(r => r.map(v => (v === null || v === undefined ? '' : v)))]);
  const rg = X().utils.decode_range(ws['!ref']);
  for (let r = 1; r <= rg.e.r; r++) for (let c = 0; c <= rg.e.c; c++) {
    const cel = ws[X().utils.encode_cell({ r, c })];
    if (cel && cel.t === 'n' && formatos[c] && F[formatos[c]]) cel.z = F[formatos[c]];
    if (cel && cel.t === 's' && /^\d+$/.test(cel.v)) cel.t = 's'; // códigos con ceros iniciales quedan como texto
  }
  ws['!cols'] = enc.map((h, i) => ({ wch: anchos[i] || Math.min(48, Math.max(10, String(h).length + 2)) }));
  ws['!autofilter'] = { ref: X().utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rg.e.r, 0), c: rg.e.c } }) };
  return ws;
}
// Agrega una fila de fórmulas al final de la hoja
function filaFormulas(ws, etiqueta, formulas, formatos) {
  const rg = X().utils.decode_range(ws['!ref']);
  const r = rg.e.r + 2;
  ws[X().utils.encode_cell({ r, c: 0 })] = { t: 's', v: etiqueta };
  formulas.forEach(([c, f, v]) => { ws[X().utils.encode_cell({ r, c })] = { t: 'n', f, v, z: F[formatos || 'mag'] }; });
  rg.e.r = r; ws['!ref'] = X().utils.encode_range(rg);
  return r + 1; // fila Excel (1-based)
}
function meta(info) {
  const carga = filas('SELECT * FROM carga ORDER BY id DESC LIMIT 1')[0] || {};
  const filasMeta = [
    ['Sistema', 'Control de Paradas y Repuestos · Peletizadora P-01'],
    ['Rótulo', 'DATOS SINTÉTICOS · Nutripellet Andino S.A.C. (empresa ficticia)'],
    ['Libro', info.libro],
    ['Versión del aplicativo', globalThis.CPR_VERSION],
    ['Compilación', globalThis.CPR_COMPILACION],
    ['Generado el (Lima)', mostrarFH(ahoraIso())],
    ['Generado por', info.usuario],
    ['Hora de corte', fh(info.corte)],
    ['Filtro · equipo', info.equipo || 'Todos'],
    ['Filtro · desde', fh(info.desde)],
    ['Filtro · hasta', fh(info.hasta)],
    ['Identificador de corrida', info.corrida],
    ['Excel 06 de origen', carga.archivo || ''],
    ['SHA-256 del Excel 06 de origen', carga.sha256 || ''],
    ['Contrato del Excel 06', carga.contrato || ''],
    ['Formato numérico', 'Magnitudes con coma de miles y punto decimal; conteos enteros sin agrupación; negativos en rojo'],
  ].concat(info.extra || []);
  const ws = X().utils.aoa_to_sheet([['Campo', 'Valor'], ...filasMeta]);
  ws['!cols'] = [{ wch: 34 }, { wch: 90 }];
  return ws;
}
const idSalida = (libro, f) => libro + '-' + sha256Hex(new TextEncoder().encode(JSON.stringify([f, globalThis.CPR_VERSION, (filas("SELECT valor FROM meta WHERE clave='revision'")[0] || {}).valor]))).slice(0, 10).toUpperCase();
const escribir = wb => X().write(wb, { type: 'array', bookType: 'xlsx', compression: true });

// ---------- 07 · Resultados operativos ----------
export function libro07(f, usuario) {
  const wb = X().utils.book_new();
  const corrida = idSalida('OPE', f);
  const ind = indicadores(f);
  X().utils.book_append_sheet(wb, meta({ libro: '07 · Resultados operativos', usuario, ...f, corrida }), 'META');
  const ps = ind.paradas;
  const wsP = hoja(['Parada', 'Equipo', 'Inicio', 'Fin', 'Estado', 'Modo de falla', 'Estado de la causa', 'Reincidencia de', 'Estado reincidencia', ...TIPOS_TRAMO.map(t => 'Min ' + NOMBRE_TRAMO[t].toLowerCase()), 'Min en el período', 'Horas en el período'],
    ps.map(p => [p.codigo, p.equipo_codigo, fh(p.inicio), fh(p.fin), p.estado, p.modo_nombre || 'Sin diagnóstico', p.estado_causa, p.reincidencia_de || '', p.estado_reincidencia, ...TIPOS_TRAMO.map(t => p.res.porTipo[t]), p.res.total, p.res.total / 60]),
    ['txt', 'txt', 'txt', 'txt', 'txt', 'txt', 'txt', 'txt', 'txt', 'ent', 'ent', 'ent', 'ent', 'ent', 'ent', 'ent', 'mag'], [10, 8, 17, 17, 9, 30, 12, 12, 12]);
  const n = ps.length + 1;
  const tot = ps.reduce((a, p) => a + p.res.total, 0), esp = ps.reduce((a, p) => a + p.res.porTipo.ESPERA_REPUESTO, 0);
  filaFormulas(wsP, 'Total (fórmula)', [[11, `SUM(L2:L${n})`, esp], [15, `SUM(P2:P${n})`, tot], [16, `SUM(Q2:Q${n})`, tot / 60]], 'ent');
  X().utils.book_append_sheet(wb, wsP, 'Paradas');
  const trs = ps.flatMap(p => p.tramos.map(t => [p.codigo, t.secuencia, NOMBRE_TRAMO[t.tipo], fh(t.inicio), fh(t.fin), minutosRecortados(t.inicio, t.fin, t.inicio, '9999-12-31T00:00:00-05:00', f.corte), minutosRecortados(t.inicio, t.fin, f.desde, f.hasta, f.corte), t.evidencia, t.autor]));
  X().utils.book_append_sheet(wb, hoja(['Parada', 'Secuencia', 'Tramo', 'Desde', 'Hasta', 'Minutos del tramo', 'Minutos en el período', 'Evidencia', 'Registró'], trs, ['txt', 'ent', 'txt', 'txt', 'txt', 'ent', 'ent'], [10, 9, 20, 17, 17, 14, 16, 40, 22]), 'Tramos');
  const ords = filas(`SELECT o.*, (SELECT count(*) FROM consumo c WHERE c.orden_codigo=o.codigo) AS entregas, (SELECT coalesce(sum(c.cantidad),0) FROM consumo c WHERE c.orden_codigo=o.codigo) AS unidades
    FROM orden o WHERE (?='' OR o.equipo_codigo=?) AND o.apertura < ? AND coalesce(o.cierre, ?) >= ? ORDER BY o.apertura`, [f.equipo, f.equipo, f.hasta, f.corte, f.desde]);
  X().utils.book_append_sheet(wb, hoja(['Orden', 'Tipo', 'Equipo', 'Parada', 'Tarea', 'Apertura', 'Cierre', 'Estado', 'Responsable', 'Entregas', 'Unidades entregadas', 'Descripción'],
    ords.map(o => [o.codigo, o.tipo, o.equipo_codigo, o.parada_codigo || '', o.tarea_codigo || '', fh(o.apertura), fh(o.cierre), o.estado, o.responsable, o.entregas, o.unidades, o.descripcion]), ['txt', 'txt', 'txt', 'txt', 'txt', 'txt', 'txt', 'txt', 'txt', 'ent', 'ent'], [9, 12, 7, 10, 7, 17, 17, 9, 22, 9, 10, 50]), 'Ordenes');
  const cons = filas('SELECT c.*, p.nombre FROM consumo c JOIN pieza p ON p.codigo=c.pieza_codigo WHERE c.fecha_efectiva>=? AND c.fecha_efectiva<? ORDER BY c.fecha_efectiva', [f.desde, f.hasta]);
  X().utils.book_append_sheet(wb, hoja(['Consumo', 'Orden', 'Pieza', 'Nombre', 'Cantidad', 'Fecha efectiva', 'Fecha de registro', 'Movimiento', 'Reserva', 'Responsable'],
    cons.map(c => [c.codigo, c.orden_codigo, c.pieza_codigo, c.nombre, c.cantidad, fh(c.fecha_efectiva), fh(c.fecha_registro), c.movimiento_codigo, c.reserva_codigo || '', c.responsable]), ['txt', 'txt', 'txt', 'txt', 'ent']), 'Consumos');
  const saldo = {};
  const movs = filas('SELECT * FROM movimiento ORDER BY pieza_codigo, fecha_efectiva, signo DESC, codigo').map(m => { saldo[m.pieza_codigo] = (saldo[m.pieza_codigo] || 0) + m.cantidad * m.signo; return [m.codigo, m.pieza_codigo, m.tipo, m.cantidad * m.signo, saldo[m.pieza_codigo], fh(m.fecha_efectiva), fh(m.fecha_registro), m.orden_codigo || '', m.referencia, m.responsable]; })
    .filter(r => true);
  X().utils.book_append_sheet(wb, hoja(['Movimiento', 'Pieza', 'Tipo', 'Cantidad (+/−)', 'Saldo físico', 'Fecha efectiva', 'Fecha de registro', 'Orden', 'Referencia', 'Responsable'], movs, ['txt', 'txt', 'txt', 'ent', 'ent']), 'Movimientos');
  const ex = filas('SELECT codigo FROM pieza ORDER BY codigo').map(p => existencia(p.codigo, f.corte));
  X().utils.book_append_sheet(wb, hoja(['Pieza', 'Nombre', 'Unidad', 'Físico al corte', 'Reservado al corte', 'Disponible al corte', 'Mínimo'],
    ex.map(e => e.noDisponible ? [e.codigo, e.nombre, e.unidad, 'No disponible', 'No disponible', 'No disponible', e.stock_minimo] : [e.codigo, e.nombre, e.unidad, e.fisico, e.reservado, e.disponible, e.stock_minimo]), ['txt', 'txt', 'txt', 'ent', 'ent', 'ent', 'ent']), 'Existencias');
  const res = filas('SELECT * FROM reserva ORDER BY fecha');
  X().utils.book_append_sheet(wb, hoja(['Reserva', 'Orden', 'Pieza', 'Cantidad', 'Fecha', 'Estado', 'Cierre'], res.map(r => [r.codigo, r.orden_codigo, r.pieza_codigo, r.cantidad, fh(r.fecha), r.estado, fh(r.cierre)]), ['txt', 'txt', 'txt', 'ent']), 'Reservas');
  const ts = estadoTareas(f.corte);
  X().utils.book_append_sheet(wb, hoja(['Tarea', 'Descripción', 'Modo que previene', 'Frecuencia (días)', 'Crítica', 'Responsable', 'Último vencimiento atendido', 'Próximo vencimiento', 'Estado'],
    ts.map(t => [t.codigo, t.descripcion, t.modo_codigo, t.frecuencia_dias, t.critica ? 'Sí' : 'No', t.responsable, t.ultima ? t.ultima.fecha_vencimiento : '', t.proximo, t.estado[1]]), ['txt', 'txt', 'txt', 'ent']), 'Tareas');
  const ejs = filas('SELECT e.*, t.critica FROM ejecucion_preventiva e JOIN tarea_preventiva t ON t.codigo=e.tarea_codigo ORDER BY e.fecha_vencimiento');
  X().utils.book_append_sheet(wb, hoja(['Ejecución', 'Tarea', 'Orden', 'Vencimiento', 'Ejecutada', 'Resultado', 'Evidencia'], ejs.map(e => [e.codigo, e.tarea_codigo, e.orden_codigo || '', e.fecha_vencimiento, fh(e.fecha_ejecucion), e.resultado, e.evidencia])), 'Ejecuciones');
  const acc = seguimientoAcciones(f.corte);
  X().utils.book_append_sheet(wb, hoja(['Acción', 'Tipo', 'Problema', 'Acción', 'Responsable', 'Indicador', 'Estado del seguimiento'], acc.map(a => [a.codigo, a.tipo, a.problema, a.accion, a.responsable, a.indicador, a.estado])), 'Acciones');
  const wsT = hoja(['Total de control', 'Valor', 'Unidad', 'Fuente'], [
    ['Horas de parada no planificada en el período', tot / 60, 'h', 'Fórmula sobre la hoja Paradas'],
    ['Horas de espera de repuesto en el período', esp / 60, 'h', 'Fórmula sobre la hoja Paradas'],
    ['Paradas en el período', ps.length, 'paradas', 'Fórmula sobre la hoja Paradas'],
  ], ['txt', 'mag'], [48, 14, 10, 34]);
  wsT.B2 = { t: 'n', f: `SUM(Paradas!P2:P${n})/60`, v: tot / 60, z: F.mag };
  wsT.B3 = { t: 'n', f: `SUM(Paradas!L2:L${n})/60`, v: esp / 60, z: F.mag };
  wsT.B4 = { t: 'n', f: `COUNTA(Paradas!A2:A${n})`, v: ps.length, z: F.ent };
  X().utils.book_append_sheet(wb, wsT, 'Totales');
  return { bytes: escribir(wb), corrida, control: { horas_parada: tot / 60, horas_espera: esp / 60, paradas: ps.length } };
}

// ---------- 08 · Analítica ----------
export function libro08(f, usuario, horizonte, prescripcion) {
  const wb = X().utils.book_new();
  const corrida = idSalida('ANA', [f, horizonte]);
  const ind = indicadores(f), des = descriptiva(f, ind), dia = diagnostica(f, ind), pre = predictiva({ equipo: f.equipo || 'P-01', corte: f.corte, horizonte_dias: horizonte });
  X().utils.book_append_sheet(wb, meta({ libro: '08 · Analítica', usuario, ...f, corrida, extra: [['Horizonte de la predictiva (días)', String(horizonte)], ['Cohorte', 'Paradas del equipo que tocan el período; minutos recortados al período y a la hora de corte']] }), 'META');
  const ei = ind.espera_intervencion, cu = ind.cumplimiento;
  const wsI = hoja(['Indicador', 'Valor', 'Unidad', 'Numerador', 'Denominador', 'Criterio'], [
    ['Horas de parada no planificada (principal)', ind.horas_parada, 'h', ind.horas_parada, '', 'Suma de minutos de tramos recortados al período'],
    ['Horas de espera de pieza', ind.horas_espera, 'h', ind.horas_espera, '', 'Tramos «Espera de repuesto» recortados'],
    ['Porcentaje del tiempo perdido por espera', ind.pct_espera, '%', ind.horas_espera, ind.horas_parada, 'Espera / horas de parada × 100'],
    ['Espera media por intervención que requirió una pieza', ei.media_min === null ? 'sin base de cálculo' : ei.media_min / 60, 'h', ei.numerador_min / 60, ei.denominador, 'Incluye intervenciones con espera cero; las líneas de consumo no cambian el denominador'],
    ['Cumplimiento de tareas críticas vencibles', cu.porcentaje === null ? 'sin base de cálculo' : cu.porcentaje, '%', cu.a_tiempo, cu.vencibles, 'Ejecutadas a tiempo / vencimientos del período (incluye vencidas sin ejecución)'],
    ['MTBF', ind.mtbf_h === null ? 'sin base de cálculo' : ind.mtbf_h, 'h de operación', ind.horas_operacion, ind.fallas, 'Horas efectivas de operación / fallas con inicio en el período'],
    ['MTTR · recuperación total', ind.mttr_recuperacion_h === null ? 'sin base de cálculo' : ind.mttr_recuperacion_h, 'h', '', ind.incidentes_cerrados, 'Promedio de inicio a verificación apta; incidentes cerrados con inicio en el período'],
    ['MTTR · reparación activa', ind.mttr_reparacion_h === null ? 'sin base de cálculo' : ind.mttr_reparacion_h, 'h', '', ind.incidentes_cerrados, 'Promedio de minutos en tramo «Reparación»'],
  ], ['txt', 'mag', 'txt', 'mag', 'ent'], [48, 14, 14, 12, 12, 70]);
  if (ind.horas_parada) wsI.B4 = { t: 'n', f: 'D4/E4*100', v: ind.pct_espera, z: F.mag1 };
  X().utils.book_append_sheet(wb, wsI, 'Indicadores');
  const wsD = hoja(['Tramo', 'Minutos', 'Horas', 'Porcentaje'], TIPOS_TRAMO.map(t => [NOMBRE_TRAMO[t], des.porTipo[t], des.porTipo[t] / 60, dia.total_min ? 100 * des.porTipo[t] / dia.total_min : null]), ['txt', 'ent', 'mag', 'mag1'], [22, 10, 10, 12]);
  const fr = filaFormulas(wsD, 'Total (fórmula)', [[1, 'SUM(B2:B7)', dia.total_min], [2, 'SUM(C2:C7)', dia.total_min / 60]], 'mag');
  X().utils.book_append_sheet(wb, wsD, 'Descriptiva');
  X().utils.book_append_sheet(wb, hoja(['Clase de espera por intervención', 'Intervenciones'], des.histograma.map(h => [h.clase, h.intervenciones]), ['txt', 'ent'], [32, 14]), 'Histograma_espera');
  X().utils.book_append_sheet(wb, hoja(['Intervención', 'Orden', 'Parada', 'Pieza', 'Inicio', 'Minutos de espera', 'Líneas de consumo'], ei.detalle.map(d => [d.intervencion, d.orden, d.parada || '', d.pieza, fh(d.inicio), d.minutos, d.lineas_consumo]), ['txt', 'txt', 'txt', 'txt', 'txt', 'ent', 'ent']), 'Espera_por_intervencion');
  const wsPa = hoja(['Modo de falla', 'Nombre', 'Incidentes', 'Minutos', 'Porcentaje', 'Porcentaje acumulado', 'Paradas'], dia.pareto.map(p => [p.modo, p.nombre, p.incidentes, p.minutos, p.pct, p.pct_acum, p.paradas.join(', ')]), ['txt', 'txt', 'ent', 'ent', 'mag1', 'mag1'], [10, 32, 10, 10, 11, 12, 60]);
  X().utils.book_append_sheet(wb, wsPa, 'Diagnostica_Pareto_modo');
  X().utils.book_append_sheet(wb, hoja(['Motivo de demora (tramo)', 'Minutos', 'Porcentaje', 'Porcentaje acumulado'], dia.paretoTramo.map(p => [p.nombre, p.minutos, p.pct, p.pct_acum]), ['txt', 'ent', 'mag1', 'mag1'], [26]), 'Diagnostica_Pareto_tramo');
  X().utils.book_append_sheet(wb, hoja(['Parada', 'Modo', 'Estado de la causa', 'Causa o hipótesis'], dia.sin_diagnostico.map(s => [s.codigo, s.modo, s.estado_causa, s.causa]), [], [10, 30, 16, 50]), 'Diagnostica_sin_confirmar');
  X().utils.book_append_sheet(wb, hoja(['Parada', 'Antecedente', 'Estado', 'Modo'], dia.reincidencias.map(r => [r.codigo, r.antecedente, r.estado, r.modo])), 'Diagnostica_reincidencias');
  if (pre) {
    X().utils.book_append_sheet(wb, hoja(['Modo', 'Nombre', 'Fallas en el historial', 'Tasa por 1000 h', 'Fallas previstas', 'Duración media (h)', 'Horas de parada previstas', 'Espera prevista (h)'],
      pre.modos.map(m => [m.modo, m.nombre, m.n, m.tasa_por_1000h, m.fallas_previstas, m.duracion_media_h, m.horas_previstas, m.espera_prevista_h]), ['txt', 'txt', 'ent', 'mag3', 'mag', 'mag', 'mag', 'mag'], [8, 30]), 'Predictiva_modos');
    X().utils.book_append_sheet(wb, hoja(['Pieza', 'Nombre', 'Demandas en el historial', 'Unidades', 'Demanda en el horizonte', 'Demanda durante la reposición normal', 'Plazo normal (días)'],
      pre.piezas.map(p => [p.pieza, p.nombre, p.eventos, p.unidades, p.demanda_horizonte, p.demanda_en_plazo, p.plazo_normal_dias]), ['txt', 'txt', 'ent', 'ent', 'mag', 'mag', 'ent'], [8, 28]), 'Predictiva_piezas');
    const v = pre.validacion;
    X().utils.book_append_sheet(wb, hoja(['Concepto', 'Valor'], [['Método', pre.metodo], ['Historial', `${fh(pre.historial_desde)} a ${fh(pre.historial_hasta)}`], ['Horas de operación del historial', pre.horas_operacion_hist], ['Fallas del historial (tamaño de muestra)', pre.fallas_hist], ['Horizonte (días)', pre.horizonte_dias], ['Exposición prevista (h de operación)', pre.exposicion_h],
      ['Fallas previstas en el horizonte', pre.fallas_previstas], ['Horas de parada previstas en el horizonte', pre.horas_previstas],
      ['Validación · entrenamiento', `${fh(v.entrenamiento[0])} a ${fh(v.entrenamiento[1])} (${v.muestra_entrenamiento} fallas)`], ['Validación · tramo reservado', `${fh(v.prueba[0])} a ${fh(v.prueba[1])}`],
      ['Fallas previstas en el tramo reservado', v.fallas_previstas], ['Fallas reales en el tramo reservado', v.fallas_reales], ['Error (real − previsto) en fallas', v.error_fallas],
      ['Horas previstas en el tramo reservado', v.horas_previstas], ['Horas reales en el tramo reservado', v.horas_reales], ['Error (real − previsto) en horas', v.error_horas],
      ['Límites', 'Muestra pequeña: los resultados son orientativos; tasas constantes; no incluye mantenimiento programado']], ['txt', 'mag'], [44, 80]), 'Predictiva_resumen');
  }
  if (prescripcion && prescripcion.length) {
    X().utils.book_append_sheet(wb, hoja(['Pieza', 'Nombre', 'Política recomendada', 'Costo A (S/)', 'Costo B (S/)', 'B − A (S/)', 'Prob. faltante A', 'Prob. faltante B', 'Espera media A (h)', 'Espera media B (h)', 'Semilla', 'Repeticiones'],
      prescripcion.map(p => [p.pieza, p.nombre, p.recomendada === 'B' ? 'B · conservar 1 unidad' : p.recomendada === 'A' ? 'A · comprar al necesitar' : 'Indiferente', p.A.costo_medio, p.B.costo_medio, p.B.costo_medio - p.A.costo_medio, p.A.prob_faltante, p.B.prob_faltante, p.A.espera_media_h, p.B.espera_media_h, p.semilla, p.repeticiones]),
      ['txt', 'txt', 'txt', 'sol', 'sol', 'sol', 'mag3', 'mag3', 'mag', 'mag', 'ent', 'ent'], [8, 28, 24]), 'Prescriptiva');
  }
  X().utils.book_append_sheet(wb, hoja(['Parada', 'Equipo', 'Inicio', 'Fin', 'Modo', 'Minutos en el período', 'Espera en el período'], ind.paradas.map(p => [p.codigo, p.equipo_codigo, fh(p.inicio), fh(p.fin), p.modo_nombre || 'Sin diagnóstico', p.res.total, p.res.porTipo.ESPERA_REPUESTO]), ['txt', 'txt', 'txt', 'txt', 'txt', 'ent', 'ent']), 'Datos_origen');
  return { bytes: escribir(wb), corrida, control: { horas_parada: ind.horas_parada, pct_espera: ind.pct_espera } };
}

// ---------- 09 · Proyección y control ----------
export function libro09(sim, sens, usuario, f, horizonte) {
  const wb = X().utils.book_new();
  const P = sim.parametros;
  X().utils.book_append_sheet(wb, meta({ libro: '09 · Proyección y control', usuario, ...f, corrida: sim.id, extra: [
    ['Horizonte (días)', String(P.horizonte_dias)], ['Pieza simulada', `${P.pieza} · ${P.nombre}`],
    ['Política A', 'Comprar la pieza al necesitarla (compra urgente); stock inicial 0'], ['Política B', 'Conservar 1 unidad disponible y pedir reposición normal al consumirla; stock inicial 1 (comprado al inicio, se descuenta el inventario final)'],
    ['Semilla', String(P.semilla)], ['Repeticiones por política', String(P.repeticiones)], ['Reposición inmediata', P.reposicion_inmediata ? 'Sí' : 'No'],
    ['Método de demanda', sim.metodo_demanda], ['Plazos', 'Normal: uniforme 80 %–140 % del nominal; urgente: uniforme 75 %–150 % del nominal (supuestos sintéticos)'],
    ['Exposición', 'El tiempo entre demandas corre en horas de operación; con el equipo detenido no hay nuevas fallas'],
    ['Costo total', 'Compras + posesión + horas improductivas valorizadas − inventario final; sin mano de obra (igual en ambas políticas)'],
    ['Tipo de cambio de referencia', (filas("SELECT valor, descripcion FROM parametro WHERE clave='tipo_cambio_usd_venta'").map(x => `S/ ${x.valor} por US$ · ${x.descripcion}`)[0]) || 'Sin consulta (costos solo en soles)'],
  ] }), 'META');
  const par = [['Tasa de demandas por 1000 h de operación', P.tasa_por_1000h, 'mag3'], ['Demandas en el historial (tamaño de muestra)', P.eventos_hist, 'ent'], ['Horas de operación del historial', P.horas_operacion_hist, 'mag'],
    ['Reparación y verificación media (h)', P.reparacion_h, 'mag'], ['Costo unitario (S/)', P.costo_unitario, 'sol'], ['Plazo normal (días)', P.plazo_normal_dias, 'mag'], ['Plazo urgente (h)', P.plazo_urgente_horas, 'mag'],
    ['Costo de una hora improductiva (S/)', P.costo_hora_parada, 'sol'], ['Costo de posesión anual (%)', P.posesion_anual_pct, 'mag'], ['Recargo por urgencia (%)', P.recargo_urgencia_pct, 'mag'], ['Horas planificadas por día', P.horas_plan_dia, 'mag'], ['Horizonte (días)', P.horizonte_dias, 'ent']];
  const wsPar = hoja(['Parámetro', 'Valor'], par.map(p => [p[0], p[1]]), [], [44, 14]);
  par.forEach((p, i) => { const c = wsPar[`B${i + 2}`]; if (c && c.t === 'n') c.z = F[p[2]]; });
  X().utils.book_append_sheet(wb, wsPar, 'Parametros');
  const fila = (n, k, fmt) => [n, sim.A[k], sim.B[k]];
  const wsE = hoja(['Resultado por política (media de las réplicas)', 'A · comprar al necesitar', 'B · conservar 1 unidad'], [
    fila('Costo total (S/)', 'costo_medio'), fila('Costo P10 (S/)', 'costo_p10'), fila('Costo P50 (S/)', 'costo_p50'), fila('Costo P90 (S/)', 'costo_p90'), fila('Desviación del costo (S/)', 'costo_desv'),
    fila('Compras (S/)', 'compras'), fila('Posesión de inventario (S/)', 'posesion'), fila('Horas improductivas valorizadas (S/)', 'costo_espera'), fila('Inventario final descontado (S/)', 'inventario_final'),
    fila('Horas de espera por suministro (media)', 'espera_media_h'), fila('Horas de espera P90', 'espera_p90_h'),
    fila('Demandas totales simuladas', 'demandas'), fila('Demandas no atendidas de inmediato', 'faltantes'), fila('Probabilidad de faltante (no atendidas / demandas)', 'prob_faltante'),
  ], ['txt', 'sol', 'sol'], [50, 24, 24]);
  ['B', 'C'].forEach(c => { for (let r = 11; r <= 12; r++) wsE[c + r].z = F.mag; for (let r = 13; r <= 14; r++) wsE[c + r].z = F.ent; wsE[c + 15].z = F.mag3; });
  const nR = sim.replicas.length + 1;
  wsE.A17 = { t: 's', v: 'Diferencia media B − A (S/)' }; wsE.B17 = { t: 'n', v: sim.diferencia_media, z: F.sol };
  wsE.A18 = { t: 's', v: 'Intervalo de confianza 95 % de B − A (S/)' }; wsE.B18 = { t: 'n', v: sim.diferencia_ic95[0], z: F.sol }; wsE.C18 = { t: 'n', v: sim.diferencia_ic95[1], z: F.sol };
  wsE.A19 = { t: 's', v: 'Política recomendada' }; wsE.B19 = { t: 's', v: sim.recomendada === 'B' ? 'B · conservar 1 unidad' : sim.recomendada === 'A' ? 'A · comprar al necesitar' : 'Indiferente (diferencia dentro del error)' };
  wsE.A20 = { t: 's', v: 'Conciliación: costo medio recalculado desde la hoja Replicas (fórmula)' };
  wsE.B20 = { t: 'n', f: `AVERAGE(Replicas!C2:C${nR})`, v: sim.A.costo_medio, z: F.sol }; wsE.C20 = { t: 'n', f: `AVERAGE(Replicas!D2:D${nR})`, v: sim.B.costo_medio, z: F.sol };
  wsE['!ref'] = 'A1:C20';
  X().utils.book_append_sheet(wb, wsE, 'Escenarios');
  X().utils.book_append_sheet(wb, hoja(['Factor costo hora', 'Factor plazo urgente', 'Costo hora (S/)', 'Plazo urgente (h)', 'Costo A (S/)', 'Costo B (S/)', 'Recomendada'],
    sens.map(s => [s.factor_costo_hora, s.factor_plazo_urgente, s.costo_hora, s.plazo_urgente_h, s.costo_A, s.costo_B, s.recomendada]), ['mag', 'mag', 'sol', 'mag', 'sol', 'sol', 'txt'], [14, 16, 14, 14, 14, 14, 14]), 'Sensibilidad');
  X().utils.book_append_sheet(wb, hoja(['Réplica', 'Demandas', 'Costo A (S/)', 'Costo B (S/)', 'Espera A (h)', 'Espera B (h)', 'Faltantes A', 'Faltantes B'],
    sim.replicas.map(r => [r.replica, r.demandas, r.costo_A, r.costo_B, r.espera_A_h, r.espera_B_h, r.faltantes_A, r.faltantes_B]), ['ent', 'ent', 'sol', 'sol', 'mag', 'mag', 'ent', 'ent']), 'Replicas');
  const pre = predictiva({ equipo: P.equipo, corte: f.corte, horizonte_dias: P.horizonte_dias });
  if (pre) X().utils.book_append_sheet(wb, hoja(['Modo', 'Nombre', 'Fallas previstas', 'Horas de parada previstas', 'Espera prevista (h)'], pre.modos.map(m => [m.modo, m.nombre, m.fallas_previstas, m.horas_previstas, m.espera_prevista_h]), ['txt', 'txt', 'mag', 'mag', 'mag'], [8, 30, 14, 20, 16]), 'Proyeccion_horizonte');
  const acc = seguimientoAcciones(f.corte);
  X().utils.book_append_sheet(wb, hoja(['Acción', 'Problema', 'Acción tomada', 'Responsable', 'Fecha', 'Objetivo', 'Indicador', 'Unidad', 'Período antes', 'Valor antes', 'Período de revisión', 'Valor en revisión', 'Base mínima', 'Estado', 'Detalle antes', 'Detalle revisión', 'Seguimientos registrados'],
    acc.map(a => [a.codigo, a.problema, a.accion, a.responsable, a.fecha, a.objetivo, a.indicador, a.unidad, `${fh(a.periodo_antes[0])} a ${fh(a.periodo_antes[1])}`, a.antes.valor === null ? 'sin base de cálculo' : a.antes.valor,
      `${fh(a.periodo_despues[0])} a ${fh(a.periodo_despues[1])}`, a.despues.valor === null ? 'sin base de cálculo' : a.despues.valor, a.base, a.estado, a.antes.texto, a.despues.texto, a.seguimientos.map(s => `${s.fecha}: ${s.valor} (${s.autor})`).join(' | ')]),
    ['txt', 'txt', 'txt', 'txt', 'txt', 'txt', 'txt', 'txt', 'txt', 'mag', 'txt', 'mag'], [8, 36, 40, 22, 11, 40, 40, 22, 34, 12, 34, 14, 26, 22, 40, 40, 30]), 'Trazabilidad_acciones');
  return { bytes: escribir(wb), corrida: sim.id };
}
