// Motor analítico (megaprompt §4.2–4.4). Cada indicador declara cohorte, unidad y denominador.
// Un denominador cero produce «sin base de cálculo» (valor null).
import { filas, valor } from './bd.js';
import { isoAMs, msAIso, ahoraIso } from './fechas.js';
import { minutosRecortados, resumenTramos, TIPOS_TRAMO, NOMBRE_TRAMO } from './tiempo.js';

const DIA = 86400000;
const fechaDe = iso => msAIso(isoAMs(iso)).slice(0, 10);
const div = (a, b) => (b ? a / b : null);
export const SIN_BASE = 'sin base de cálculo';

// Paradas del equipo que tocan el período, con sus minutos recortados
export function paradasPeriodo({ equipo, desde, hasta, corte }) {
  const ps = filas(`SELECT p.*, m.nombre AS modo_nombre FROM parada p LEFT JOIN modo_falla m ON m.codigo = p.modo_codigo
    WHERE (?='' OR p.equipo_codigo=?) AND p.inicio < ? AND p.inicio < ? AND coalesce(p.fin, ?) > ? ORDER BY p.inicio`, [equipo, equipo, hasta, corte, corte, desde]);
  return ps.map(p => {
    const tr = filas('SELECT * FROM tramo WHERE parada_codigo=? ORDER BY secuencia', [p.codigo]);
    return { ...p, tramos: tr, res: resumenTramos(tr, desde, hasta, corte) };
  });
}

// Minutos de operación efectiva registrados en el período (granularidad diaria)
export function minutosOperacion(equipo, desde, hasta) {
  return Number(valor('SELECT coalesce(sum(minutos), 0) FROM horas_operacion WHERE (?=\'\' OR equipo_codigo=?) AND fecha >= ? AND fecha < ?',
    [equipo, equipo, fechaDe(desde), fechaDe(hasta)]));
}

// Espera de repuesto por intervención que requirió la pieza (incluye las de espera cero).
// Numerador: minutos de «Espera de repuesto» de la parada que se superponen con la intervención.
// Denominador: intervenciones que requirieron pieza con inicio en el período. Las líneas de consumo no intervienen.
export function esperaPorIntervencion({ equipo, desde, hasta, corte, pieza = '' }) {
  const ints = filas(`SELECT i.*, o.parada_codigo FROM intervencion i JOIN orden o ON o.codigo = i.orden_codigo
    WHERE i.requirio_pieza = 1 AND (?='' OR i.pieza_codigo=?) AND (?='' OR o.equipo_codigo=?) AND i.inicio >= ? AND i.inicio < ? AND i.inicio < ? ORDER BY i.inicio`,
  [pieza, pieza, equipo, equipo, desde, hasta, corte]);
  const det = ints.map(i => {
    const esp = i.parada_codigo ? filas("SELECT * FROM tramo WHERE parada_codigo=? AND tipo='ESPERA_REPUESTO'", [i.parada_codigo]) : [];
    const fin = i.fin || corte;
    const min = esp.reduce((a, t) => a + minutosRecortados(t.inicio, t.fin, i.inicio, fin, corte), 0);
    const lineas = Number(valor('SELECT count(*) FROM consumo WHERE orden_codigo=?', [i.orden_codigo]));
    return { intervencion: i.codigo, orden: i.orden_codigo, parada: i.parada_codigo, pieza: i.pieza_codigo, inicio: i.inicio, minutos: min, lineas_consumo: lineas };
  });
  const num = det.reduce((a, d) => a + d.minutos, 0);
  return { numerador_min: num, denominador: det.length, media_min: div(num, det.length), detalle: det };
}

// Cumplimiento de tareas críticas vencibles en el período: a tiempo / vencimientos del período (ejecutados o vencidos sin ejecutar)
export function cumplimientoCriticas({ equipo, desde, hasta, corte }) {
  const d0 = fechaDe(desde), d1 = fechaDe(isoAMs(hasta) < isoAMs(corte) ? hasta : corte);
  const tareas = filas('SELECT * FROM tarea_preventiva WHERE critica = 1 AND (?=\'\' OR equipo_codigo=?)', [equipo, equipo]);
  const filasDet = [];
  for (const t of tareas) {
    const ejs = filas('SELECT * FROM ejecucion_preventiva WHERE tarea_codigo=? ORDER BY fecha_vencimiento', [t.codigo]);
    ejs.filter(e => e.fecha_vencimiento >= d0 && e.fecha_vencimiento < d1).forEach(e => {
      const aTiempo = !!e.fecha_ejecucion && fechaDe(e.fecha_ejecucion) <= e.fecha_vencimiento;
      filasDet.push({ tarea: t.codigo, vencimiento: e.fecha_vencimiento, ejecucion: e.fecha_ejecucion, estado: aTiempo ? 'A tiempo' : 'Fuera de fecha', a_tiempo: aTiempo ? 1 : 0 });
    });
    // vencimientos posteriores al último atendido que ya pasaron sin ejecución
    let base = ejs.length ? ejs[ejs.length - 1].fecha_vencimiento : null;
    let prox = base ? msAIso(isoAMs(base + 'T12:00:00-05:00') + t.frecuencia_dias * DIA).slice(0, 10) : t.primer_vencimiento;
    while (prox < fechaDe(corte)) {
      if (prox >= d0 && prox < d1) filasDet.push({ tarea: t.codigo, vencimiento: prox, ejecucion: null, estado: 'Vencida sin ejecución', a_tiempo: 0 });
      prox = msAIso(isoAMs(prox + 'T12:00:00-05:00') + t.frecuencia_dias * DIA).slice(0, 10);
    }
  }
  const n = filasDet.length, ok = filasDet.reduce((a, f) => a + f.a_tiempo, 0);
  return { a_tiempo: ok, vencibles: n, porcentaje: div(100 * ok, n), detalle: filasDet.sort((a, b) => (a.vencimiento < b.vencimiento ? -1 : 1)) };
}

// Indicadores del período (principal y complementarios)
export function indicadores(f) {
  const ps = paradasPeriodo(f);
  const total = ps.reduce((a, p) => a + p.res.total, 0);
  const espera = ps.reduce((a, p) => a + p.res.porTipo.ESPERA_REPUESTO, 0);
  const fallas = ps.filter(p => p.inicio >= f.desde && p.inicio < f.hasta);
  const cerradas = fallas.filter(p => p.fin && p.fin <= f.corte);
  const opMin = minutosOperacion(f.equipo, f.desde, f.hasta);
  const recTotal = cerradas.map(p => (isoAMs(p.fin) - isoAMs(p.inicio)) / 60000);
  const repAct = cerradas.map(p => p.tramos.filter(t => t.tipo === 'REPARACION').reduce((a, t) => a + minutosRecortados(t.inicio, t.fin, t.inicio, '9999-12-31T00:00:00-05:00', f.corte), 0));
  const media = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    filtro: f, paradas: ps,
    horas_parada: total / 60,
    horas_espera: espera / 60,
    pct_espera: div(100 * espera, total),
    fallas: fallas.length,
    horas_operacion: opMin / 60,
    mtbf_h: fallas.length ? opMin / 60 / fallas.length : null,
    mttr_recuperacion_h: media(recTotal) === null ? null : media(recTotal) / 60,
    mttr_reparacion_h: media(repAct) === null ? null : media(repAct) / 60,
    incidentes_cerrados: cerradas.length,
    cumplimiento: cumplimientoCriticas(f),
    espera_intervencion: esperaPorIntervencion(f),
    abiertas: ps.filter(p => p.estado === 'ABIERTA'),
  };
}

// Descriptiva: distribución por tramo, cantidades e histograma de esperas por intervención
export function descriptiva(f, ind = indicadores(f)) {
  const porTipo = Object.fromEntries(TIPOS_TRAMO.map(t => [t, ind.paradas.reduce((a, p) => a + p.res.porTipo[t], 0)]));
  const esperas = ind.espera_intervencion.detalle.map(d => d.minutos);
  const clases = [['Sin espera', 0, 0], ['1 a 60 min', 1, 60], ['61 a 240 min', 61, 240], ['4 a 24 h', 241, 1440], ['24 a 48 h', 1441, 2880], ['Más de 48 h', 2881, Infinity]];
  const histograma = clases.map(([nombre, a, b]) => ({ clase: nombre, intervenciones: esperas.filter(x => x >= a && x <= b).length }));
  return {
    porTipo, histograma, n_esperas: esperas.length,
    cantidades: {
      paradas: ind.paradas.length,
      intervenciones: Number(valor('SELECT count(*) FROM intervencion i JOIN orden o ON o.codigo=i.orden_codigo WHERE (?=\'\' OR o.equipo_codigo=?) AND i.inicio>=? AND i.inicio<?', [f.equipo, f.equipo, f.desde, f.hasta])),
      unidades_consumidas: Number(valor('SELECT coalesce(sum(c.cantidad),0) FROM consumo c JOIN orden o ON o.codigo=c.orden_codigo WHERE (?=\'\' OR o.equipo_codigo=?) AND c.fecha_efectiva>=? AND c.fecha_efectiva<?', [f.equipo, f.equipo, f.desde, f.hasta])),
    },
  };
}

// Diagnóstica: Pareto de minutos por modo de falla y por motivo de demora, causas y reincidencias
export function diagnostica(f, ind = indicadores(f)) {
  const total = ind.paradas.reduce((a, p) => a + p.res.total, 0);
  const g = {};
  ind.paradas.forEach(p => {
    const k = p.modo_codigo || 'SIN';
    g[k] ||= { modo: p.modo_codigo || '', nombre: p.modo_nombre || 'Sin diagnóstico', minutos: 0, incidentes: 0, paradas: [] };
    g[k].minutos += p.res.total; g[k].incidentes++; g[k].paradas.push(p.codigo);
  });
  let acum = 0;
  const pareto = Object.values(g).sort((a, b) => b.minutos - a.minutos).map(x => { acum += x.minutos; return { ...x, pct: div(100 * x.minutos, total), pct_acum: div(100 * acum, total) }; });
  let ac2 = 0;
  const paretoTramo = TIPOS_TRAMO.map(t => ({ tipo: t, nombre: NOMBRE_TRAMO[t], minutos: ind.paradas.reduce((a, p) => a + p.res.porTipo[t], 0) }))
    .filter(x => x.minutos > 0).sort((a, b) => b.minutos - a.minutos).map(x => { ac2 += x.minutos; return { ...x, pct: div(100 * x.minutos, total), pct_acum: div(100 * ac2, total) }; });
  const causas = { CONFIRMADA: 0, HIPOTESIS: 0, PENDIENTE: 0 };
  ind.paradas.forEach(p => { causas[p.estado_causa]++; });
  return {
    total_min: total, pareto, paretoTramo, causas,
    sin_diagnostico: ind.paradas.filter(p => !p.modo_codigo || p.estado_causa !== 'CONFIRMADA').map(p => ({ codigo: p.codigo, modo: p.modo_nombre || 'Sin diagnóstico', estado_causa: p.estado_causa, causa: p.causa })),
    reincidencias: ind.paradas.filter(p => p.reincidencia_de).map(p => ({ codigo: p.codigo, antecedente: p.reincidencia_de, estado: p.estado_reincidencia, modo: p.modo_nombre })),
  };
}

// Predictiva: tasa por hora de operación × exposición futura; validación con el último 30 % del historial
export function predictiva({ equipo, corte, horizonte_dias }) {
  const ini = valor('SELECT min(fecha) FROM horas_operacion WHERE equipo_codigo=?', [equipo]);
  const horasPlan = Number(valor("SELECT valor FROM parametro WHERE clave='horas_plan_dia'") || 16);
  if (!ini) return null;
  const desde = ini + 'T00:00:00-05:00';
  const expFutura = horizonte_dias * horasPlan * 6 / 7; // horas de operación previstas (lunes a sábado)
  const modelo = (d0, d1) => {
    const op = minutosOperacion(equipo, d0, d1) / 60;
    const ps = filas('SELECT p.*, m.nombre AS modo_nombre FROM parada p LEFT JOIN modo_falla m ON m.codigo=p.modo_codigo WHERE p.equipo_codigo=? AND p.inicio>=? AND p.inicio<? AND p.fin IS NOT NULL AND p.fin<=?', [equipo, d0, d1, corte]);
    const g = {};
    ps.forEach(p => {
      const k = p.modo_codigo || 'SIN';
      g[k] ||= { modo: p.modo_codigo || '', nombre: p.modo_nombre || 'Sin diagnóstico', n: 0, min: 0, esp: 0 };
      g[k].n++; g[k].min += (isoAMs(p.fin) - isoAMs(p.inicio)) / 60000;
      g[k].esp += filas("SELECT * FROM tramo WHERE parada_codigo=? AND tipo='ESPERA_REPUESTO'", [p.codigo]).reduce((a, t) => a + (isoAMs(t.fin) - isoAMs(t.inicio)) / 60000, 0);
    });
    return { op, n: ps.length, horas: ps.reduce((a, p) => a + (isoAMs(p.fin) - isoAMs(p.inicio)) / 3600000, 0), modos: Object.values(g) };
  };
  const hist = modelo(desde, corte);
  const modos = hist.modos.map(m => {
    const tasa = div(m.n, hist.op);
    const fallas = tasa === null ? null : tasa * expFutura;
    return { ...m, tasa_por_1000h: tasa === null ? null : tasa * 1000, fallas_previstas: fallas, duracion_media_h: m.min / m.n / 60, horas_previstas: fallas === null ? null : fallas * m.min / m.n / 60, espera_prevista_h: fallas === null ? null : fallas * m.esp / m.n / 60 };
  }).sort((a, b) => (b.horas_previstas || 0) - (a.horas_previstas || 0));
  const piezas = filas('SELECT * FROM pieza WHERE equipo_codigo=? ORDER BY codigo', [equipo]).map(p => {
    const r = filas('SELECT count(DISTINCT c.orden_codigo) AS eventos, coalesce(sum(c.cantidad),0) AS unidades FROM consumo c JOIN orden o ON o.codigo=c.orden_codigo WHERE c.pieza_codigo=? AND c.fecha_efectiva>=? AND c.fecha_efectiva<?', [p.codigo, desde, corte])[0];
    const tasa = div(r.unidades, hist.op);
    const horasPlazo = p.plazo_normal_dias * horasPlan * 6 / 7;
    return { pieza: p.codigo, nombre: p.nombre, eventos: r.eventos, unidades: r.unidades, demanda_horizonte: tasa === null ? null : tasa * expFutura, demanda_en_plazo: tasa === null ? null : tasa * horasPlazo, plazo_normal_dias: p.plazo_normal_dias };
  });
  // Validación: se ajusta con el primer 70 % del historial y se compara con el 30 % reservado
  const t0 = isoAMs(desde), t1 = isoAMs(corte);
  const corteVal = msAIso(t0 + 0.7 * (t1 - t0));
  const ent = modelo(desde, corteVal), pru = modelo(corteVal, corte);
  const tasaEnt = div(ent.n, ent.op), durEnt = div(ent.horas, ent.n);
  const predN = tasaEnt === null ? null : tasaEnt * pru.op;
  const predH = predN === null || durEnt === null ? null : predN * durEnt;
  return {
    metodo: 'Tasa de fallas por hora de operación (historial) × horas de operación previstas; horas de parada = fallas previstas × duración media por modo',
    historial_desde: desde, historial_hasta: corte, horas_operacion_hist: hist.op, fallas_hist: hist.n, horizonte_dias, exposicion_h: expFutura,
    fallas_previstas: modos.reduce((a, m) => a + (m.fallas_previstas || 0), 0),
    horas_previstas: modos.reduce((a, m) => a + (m.horas_previstas || 0), 0),
    espera_prevista_h: modos.reduce((a, m) => a + (m.espera_prevista_h || 0), 0),
    modos, piezas,
    validacion: { entrenamiento: [desde, corteVal], prueba: [corteVal, corte], horas_op_prueba: pru.op, fallas_previstas: predN, fallas_reales: pru.n, horas_previstas: predH, horas_reales: pru.horas,
      error_fallas: predN === null ? null : pru.n - predN, error_horas: predH === null ? null : pru.horas - predH, muestra_entrenamiento: ent.n },
  };
}

// Seguimiento de acciones: indicador antes y después con exposición suficiente; si no, «pendiente de verificación»
export function seguimientoAcciones(corte = ahoraIso()) {
  return filas('SELECT * FROM accion ORDER BY fecha, codigo').map(a => {
    const d1 = a.revision_desde + 'T00:00:00-05:00';
    const d2 = msAIso(Math.min(isoAMs(a.revision_hasta + 'T00:00:00-05:00') + DIA, isoAMs(corte)));
    const largo = isoAMs(d2) - isoAMs(d1);
    const d0 = msAIso(isoAMs(d1) - largo);
    const segs = filas('SELECT * FROM seguimiento_accion WHERE accion_codigo=? ORDER BY fecha', [a.codigo]);
    let antes, despues, unidad, base;
    if (a.tipo === 'TECNICA') {
      const f = (x, y) => {
        const op = minutosOperacion('P-01', x, y) / 60;
        const n = Number(valor("SELECT count(*) FROM parada WHERE modo_codigo IS ? AND estado_reincidencia='CONFIRMADA' AND inicio>=? AND inicio<?", [a.modo_codigo, x, y]));
        return { valor: op >= 500 ? (1000 * n / op) : null, n, exposicion: op, texto: `${n} reincidencias confirmadas en ${op.toFixed(0)} h de operación` };
      };
      antes = f(d0, d1); despues = f(d1, d2); unidad = 'reincidencias por 1000 h'; base = 'mínimo 500 h de operación por período';
    } else {
      const f = (x, y) => {
        const r = esperaPorIntervencion({ equipo: '', desde: x, hasta: y, corte, pieza: a.pieza_codigo || '' });
        return { valor: r.denominador >= 2 ? r.media_min / 60 : null, n: r.denominador, exposicion: r.denominador, texto: `${(r.numerador_min / 60).toFixed(2)} h de espera en ${r.denominador} intervención(es) que requirieron la pieza` };
      };
      antes = f(d0, d1); despues = f(d1, d2); unidad = 'horas de espera por intervención'; base = 'mínimo 2 intervenciones por período';
    }
    const estado = antes.valor === null || despues.valor === null ? 'Pendiente de verificación'
      : despues.valor < antes.valor ? 'Mejora verificada' : despues.valor > antes.valor ? 'Empeoró' : 'Sin cambio';
    return { ...a, periodo_antes: [d0, d1], periodo_despues: [d1, d2], antes, despues, unidad, base, estado, seguimientos: segs };
  });
}
