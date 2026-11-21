// Pantalla «Indicadores»: tablero integrado con filtros por período, estado actual y las cuatro analíticas.
// Desde cada resultado se llega a la parada, la orden, la pieza o la acción vinculada.
import { filas } from '../nucleo/bd.js';
import { mostrarFH, ahoraIso, textoLocalAIso, isoAMs, msAIso, sello } from '../nucleo/fechas.js';
import { fmtMagnitud, fmtConteo, esc } from '../nucleo/formato.js';
import { NOMBRE_TRAMO, TIPOS_TRAMO } from '../nucleo/tiempo.js';
import { indicadores, descriptiva, diagnostica, predictiva, seguimientoAcciones } from '../nucleo/analitica.js';
import { parametrosPorDefecto, simular } from '../nucleo/simulacion.js';
import * as op from '../nucleo/operaciones.js';
import { libro07, libro08 } from '../adaptadores/exportar.js';
import { formulario, aLocalInput, descargar, aviso, progreso } from './dom.js';
import { svgPareto, barrasH } from './graficos.js';
import { registrarExportacion } from './exportaciones.js';

let filtro = null;
let pestanaA = 'descriptiva';
let horizonte = null;
let modoSel = null;
const h2 = m => fmtMagnitud(m, 2) + ' h';
const sinBase = '<span class="sin-base">sin base de cálculo</span>';

function filtroInicial() {
  const ult = filas('SELECT periodo_desde FROM carga ORDER BY id DESC LIMIT 1')[0];
  const hoy0 = ahoraIso().slice(0, 10) + 'T00:00:00-05:00';
  return { equipo: 'P-01', desde: (ult ? ult.periodo_desde : hoy0.slice(0, 10)) + 'T00:00:00-05:00', hasta: msAIso(isoAMs(hoy0) + 86400000), corteTxt: null };
}
export const filtroActual = () => { if (!filtro) filtro = filtroInicial(); return { equipo: filtro.equipo, desde: filtro.desde, hasta: filtro.hasta, corte: filtro.corteTxt || ahoraIso() }; };

// Prescriptiva: simulación rápida y reproducible por pieza del equipo con demanda histórica
// Usa los mismos parámetros por defecto, semilla y repeticiones que «Simulación», para que ambas pantallas coincidan.
let memoPr = { clave: null, valor: null };
export function prescripcionPiezas(f) {
  const clave = JSON.stringify([f.equipo, f.corte.slice(0, 16), filas("SELECT valor FROM meta WHERE clave='revision'")[0]?.valor]);
  if (memoPr.clave === clave) return memoPr.valor;
  const valor = filas('SELECT codigo FROM pieza WHERE equipo_codigo=? ORDER BY codigo', [f.equipo || 'P-01']).map(p => parametrosPorDefecto(p.codigo, f.corte)).filter(P => P && P.eventos_hist > 0)
    .map(P => { const r = simular(P); return { pieza: P.pieza, nombre: P.nombre, eventos: P.eventos_hist, A: r.A, B: r.B, recomendada: r.recomendada, semilla: P.semilla, repeticiones: P.repeticiones }; });
  memoPr = { clave, valor };
  return valor;
}

// Comparación con el período anterior de igual duración (sin umbrales inventados: mejor o peor que antes)
function delta(actual, anterior, menorEsMejor = true, dec = 2, suf = '') {
  if (actual === null || anterior === null || anterior === undefined) return '<span class="delta neutro">sin período anterior comparable</span>';
  const d = actual - anterior;
  if (Math.abs(d) < 1e-9) return '<span class="delta neutro">= igual que el período anterior</span>';
  const mejor = menorEsMejor ? d < 0 : d > 0;
  return `<span class="delta ${mejor ? 'mejor' : 'peor'}">${d > 0 ? '▲' : '▼'} ${fmtMagnitud(Math.abs(d), dec)}${suf} vs período anterior</span>`;
}
const fila = (etq, val, det, extra = '', id = '') => `<div class="metrica"><div class="m-et">${etq}</div><div class="m-val"${id ? ` id="${id}"` : ''}>${val}</div><div class="m-det">${det}</div>${extra ? `<div class="m-extra">${extra}</div>` : ''}</div>`;

// Hallazgos ordenados por prioridad, cada uno con su acción
function hallazgos(f, ind, dia, pr) {
  const out = [];
  ind.abiertas.forEach(p => out.push({ c: 'error', t: `${p.equipo_codigo} está detenido: parada ${p.codigo} abierta desde ${mostrarFH(p.inicio)}.`, a: ['Ver parada', 'parada', p.codigo] }));
  const tareas = op.estadoTareas(f.corte).filter(t => t.critica && t.estado[0] === 'error');
  if (tareas.length) out.push({ c: 'error', t: `${tareas.length === 1 ? 'Una tarea crítica está vencida' : tareas.length + ' tareas críticas están vencidas'} sin ejecución: ${tareas.map(t => `${t.codigo} (${-t.diasPara} días)`).join(', ')}.`, a: ['Ir a Preventivo', 'ir', 'preventivo'] });
  const piezas = filas('SELECT codigo FROM pieza WHERE (?=\'\' OR equipo_codigo=?) ORDER BY codigo', [f.equipo, f.equipo]).map(x => op.existencia(x.codigo)).filter(e => e.disponible < e.stock_minimo);
  if (piezas.length) out.push({ c: piezas.some(e => e.disponible <= 0) ? 'error' : 'alerta', t: `Piezas bajo el stock mínimo: ${piezas.map(e => `${e.codigo} ${e.nombre} (disponible ${e.disponible}, mínimo ${e.stock_minimo})`).join('; ')}.`, a: ['Ver existencias', 'pieza', piezas[0].codigo] });
  if (ind.horas_espera > 0) {
    const porPieza = {};
    ind.espera_intervencion.detalle.forEach(d => { porPieza[d.pieza] = (porPieza[d.pieza] || 0) + d.minutos; });
    const top = Object.entries(porPieza).sort((x, y) => y[1] - x[1])[0];
    const rec = top && pr.find(x => x.pieza === top[0]);
    out.push({ c: 'alerta', t: `La espera de repuesto explica ${fmtMagnitud(ind.pct_espera, 1)} % del tiempo perdido.${top ? ` La pieza con más espera es ${top[0]} (${fmtMagnitud(top[1] / 60, 2)} h).` : ''}${rec ? ` Política sugerida: ${rec.recomendada === 'B' ? 'B, conservar 1 unidad' : rec.recomendada === 'A' ? 'A, comprar al necesitarla' : 'indiferente'}${rec.recomendada !== 'Indiferente' ? `, diferencia esperada S/ ${fmtMagnitud(Math.abs(rec.B.costo_medio - rec.A.costo_medio), 2)} en el horizonte` : ''}.` : ''}`, a: top ? ['Abrir simulación', 'sim', top[0]] : null });
  }
  if (dia.pareto.length) {
    const p = dia.pareto[0];
    out.push({ c: 'alerta', t: `«${p.nombre}» concentra ${fmtMagnitud(p.pct, 1)} % de las horas perdidas (${p.incidentes} incidentes, ${fmtMagnitud(p.minutos / 60, 2)} h). Es el primer modo a investigar o prevenir.`, a: ['Ver Pareto', 'pestana', 'diagnostica'] });
  }
  const reinc = dia.reincidencias.filter(r => r.estado === 'PENDIENTE');
  if (reinc.length) out.push({ c: 'alerta', t: `Posibles reincidencias por confirmar: ${reinc.map(r => `${r.codigo} (antecedente ${r.antecedente})`).join(', ')}.`, a: ['Ver parada', 'parada', reinc[0].codigo] });
  const sinCausa = dia.sin_diagnostico.filter(x => x.estado_causa !== 'CONFIRMADA');
  if (sinCausa.length) out.push({ c: 'alerta', t: `${sinCausa.length} parada(s) sin causa confirmada: ${sinCausa.map(x => x.codigo).join(', ')}.`, a: ['Ver parada', 'parada', sinCausa[0].codigo] });
  const acc = seguimientoAcciones(f.corte);
  acc.forEach(x => out.push({ c: x.estado === 'Mejora verificada' ? 'ok' : x.estado === 'Empeoró' ? 'error' : 'alerta', t: `${x.codigo} · ${x.problema}: ${x.estado.toLowerCase()}.`, a: ['Ver acciones', 'pestana', 'acciones'] }));
  if (ind.cumplimiento.porcentaje !== null) out.push({ c: ind.cumplimiento.porcentaje >= 90 ? 'ok' : ind.cumplimiento.porcentaje >= 70 ? 'alerta' : 'error', t: `Cumplimiento de tareas críticas en el período: ${fmtMagnitud(ind.cumplimiento.porcentaje, 1)} % (${ind.cumplimiento.a_tiempo} de ${ind.cumplimiento.vencibles}; meta supuesta 90 %).`, a: ['Ir a Preventivo', 'ir', 'preventivo'] });
  const orden = { error: 0, alerta: 1, ok: 2 };
  return out.sort((x, y) => orden[x.c] - orden[y.c]);
}

export async function vistaIndicadores(c, ctx) {
  if (!ctx.hayDatos()) { c.innerHTML = '<section class="tarjeta vacia"><h1>Indicadores</h1><p>No hay datos. Vaya a «Inicio» y pulse «Cargar demostración».</p></section>'; return; }
  if (!filtro) filtro = filtroInicial();
  if (horizonte === null) horizonte = Number(filas("SELECT valor FROM parametro WHERE clave='horizonte_defecto_dias'")[0]?.valor || 180);
  const f = filtroActual();
  const ind = indicadores(f);
  const largo = isoAMs(f.hasta) - isoAMs(f.desde);
  const fa = { ...f, desde: msAIso(isoAMs(f.desde) - largo), hasta: f.desde };
  // Solo se compara si el período anterior completo está dentro de los datos cargados
  const inicioDatos = (filas('SELECT periodo_desde FROM carga ORDER BY id DESC LIMIT 1')[0]?.periodo_desde || '9999-12-31') + 'T00:00:00-05:00';
  const ant = fa.desde >= inicioDatos ? indicadores(fa) : null;
  const A = k => (ant ? ant[k] : null);
  const dia = diagnostica(f, ind);
  const pr = prescripcionPiezas(f);
  const equipos = filas('SELECT codigo, nombre FROM equipo ORDER BY codigo');
  const cu = ind.cumplimiento, ei = ind.espera_intervencion;
  const vencidasCrit = op.estadoTareas(f.corte).filter(t => t.critica && t.estado[0] === 'error');
  const claseCump = cu.porcentaje === null ? '' : vencidasCrit.length ? 'alerta' : cu.porcentaje >= 90 ? 'ok' : cu.porcentaje >= 70 ? 'alerta' : 'error';
  const abierta = ind.abiertas[0];
  const bajoMin = filas('SELECT codigo FROM pieza WHERE (?=\'\' OR equipo_codigo=?)', [f.equipo, f.equipo]).map(x => op.existencia(x.codigo)).filter(e => e.disponible < e.stock_minimo);
  const reincP = dia.reincidencias.filter(r => r.estado === 'PENDIENTE').length;
  const hs = hallazgos(f, ind, dia, pr);
  c.innerHTML = `<div class="pila">
    <section class="tarjeta"><div class="cab-tarjeta"><h1>Indicadores</h1>
      <div class="barra-herr" id="filtros-ind">
        <div class="campo"><label for="fi-eq">Equipo</label><select id="fi-eq"><option value="">Todos</option>${equipos.map(e => `<option value="${esc(e.codigo)}"${e.codigo === filtro.equipo ? ' selected' : ''}>${esc(e.codigo)}</option>`).join('')}</select></div>
        <div class="campo"><label for="fi-desde">Desde</label><input id="fi-desde" type="datetime-local" value="${aLocalInput(filtro.desde)}"></div>
        <div class="campo"><label for="fi-hasta">Hasta</label><input id="fi-hasta" type="datetime-local" value="${aLocalInput(filtro.hasta)}"></div>
        <div class="campo"><label for="fi-corte">Hora de corte</label><input id="fi-corte" type="datetime-local" value="${filtro.corteTxt ? aLocalInput(filtro.corteTxt) : ''}" title="Vacío = ahora"></div>
        <div class="atajos"><button type="button" class="btn chico" data-r="30">30 días</button><button type="button" class="btn chico" data-r="90">90 días</button><button type="button" class="btn chico" data-r="todo">Período cargado</button></div>
      </div></div>
      <div class="nota-filtro" id="nota-ind"></div>
      <div class="franja-periodo"><span><strong>${esc(f.equipo || 'Todos los equipos')}</strong> · ${esc(mostrarFH(f.desde))} a ${esc(mostrarFH(f.hasta))} · corte ${esc(mostrarFH(f.corte))} · ${ant ? `se compara con ${esc(mostrarFH(fa.desde))} a ${esc(mostrarFH(fa.hasta))}` : 'sin período anterior comparable (los datos empiezan en este período)'}</span>
        <span class="atajos"><button type="button" class="btn exportar" id="b-x07">⬇ Exportar Excel 07 · Resultados operativos</button><button type="button" class="btn exportar" id="b-x08">⬇ Exportar Excel 08 · Analítica</button></span></div>
    </section>
    <div class="bloques-ind" id="kpis-ind">
      <section class="tarjeta bloque"><h2>Producción perdida</h2>
        <div class="estado-equipo ${abierta ? 'error' : 'ok'}">${abierta ? `● ${esc(abierta.equipo_codigo)} detenido · <a href="#" data-ir-parada="${esc(abierta.codigo)}">${esc(abierta.codigo)}</a> en ${esc(NOMBRE_TRAMO[abierta.tramos.find(t => !t.fin)?.tipo] || '')}` : `● ${esc(f.equipo || 'Equipos')} disponible al corte`}</div>
        ${fila('Horas de parada no planificada', h2(ind.horas_parada), `${fmtConteo(ind.paradas.length)} paradas en el período`, delta(ind.horas_parada, A('horas_parada'), true, 2, ' h'), 'ki-total')}
        ${fila('Tiempo medio de recuperación (MTTR)', ind.mttr_recuperacion_h === null ? sinBase : h2(ind.mttr_recuperacion_h), ind.mttr_recuperacion_h === null ? '' : `de la falla a la verificación apta · ${fmtConteo(ind.incidentes_cerrados)} cerradas · reparación activa ${h2(ind.mttr_reparacion_h)}`, delta(ind.mttr_recuperacion_h, A('mttr_recuperacion_h'), true, 2, ' h'), 'ki-mttr')}
      </section>
      <section class="tarjeta bloque"><h2>Repuestos</h2>
        ${fila('Horas de espera de repuesto', h2(ind.horas_espera), ind.pct_espera === null ? sinBase : `${fmtMagnitud(ind.pct_espera, 1)} % del tiempo perdido`, delta(ind.horas_espera, A('horas_espera'), true, 2, ' h'), 'ki-espera')}
        ${fila('Espera media por intervención que requirió una pieza', ei.media_min === null ? sinBase : h2(ei.media_min / 60), ei.media_min === null ? '' : `${fmtMagnitud(ei.numerador_min / 60, 2)} h de espera / ${fmtConteo(ei.denominador)} intervenciones (incluye las de espera cero)`, delta(ei.media_min === null ? null : ei.media_min / 60, ant && ant.espera_intervencion.media_min !== null ? ant.espera_intervencion.media_min / 60 : null, true, 2, ' h'), 'ki-esp-int')}
        <div class="metrica ${bajoMin.length ? (bajoMin.some(e => e.disponible <= 0) ? 'm-error' : 'm-alerta') : 'm-ok'}"><div class="m-et">Piezas bajo el stock mínimo (ahora)</div><div class="m-val">${fmtConteo(bajoMin.length)}</div><div class="m-det">${bajoMin.length ? bajoMin.map(e => `<a href="#" data-ir-pieza="${esc(e.codigo)}">${esc(e.codigo)}</a>`).join(', ') : 'existencias suficientes'}</div></div>
      </section>
      <section class="tarjeta bloque"><h2>Confiabilidad y prevención</h2>
        ${fila('Tiempo medio entre fallas (MTBF)', ind.mtbf_h === null ? sinBase : h2(ind.mtbf_h), ind.mtbf_h === null ? '' : `${fmtMagnitud(ind.horas_operacion, 1)} h de operación registradas / ${fmtConteo(ind.fallas)} fallas`, delta(ind.mtbf_h, A('mtbf_h'), false, 2, ' h'), 'ki-mtbf')}
        <div class="metrica m-${claseCump || 'neutro'}"><div class="m-et">Cumplimiento de tareas críticas</div><div class="m-val" id="ki-cump">${cu.porcentaje === null ? sinBase : fmtMagnitud(cu.porcentaje, 1) + ' %'}</div><div class="m-det">${cu.porcentaje === null ? '' : `${fmtConteo(cu.a_tiempo)} a tiempo de ${fmtConteo(cu.vencibles)} vencimientos del período · meta supuesta 90 %`}</div>
          <div class="m-extra">${vencidasCrit.length ? `<span class="delta peor">Hoy: ${vencidasCrit.map(t => `${esc(t.codigo)} vencida hace ${-t.diasPara} días`).join(', ')}</span>` : '<span class="delta mejor">Hoy: ninguna tarea crítica vencida</span>'}</div></div>
        <div class="metrica ${reincP ? 'm-alerta' : 'm-ok'}"><div class="m-et">Reincidencias por confirmar</div><div class="m-val">${fmtConteo(reincP)}</div><div class="m-det">${fmtConteo(dia.reincidencias.filter(r => r.estado === 'CONFIRMADA').length)} confirmadas en el período · ventana de ${fmtConteo(Number(filas("SELECT valor FROM parametro WHERE clave='ventana_reincidencia_dias'")[0]?.valor || 30))} días</div></div>
      </section>
    </div>
    <section class="tarjeta"><h2>Hallazgos y decisiones sugeridas</h2>
      <ol class="hallazgos" id="hallazgos">${hs.map((x, i) => `<li class="h-${x.c}"><span class="h-num">${i + 1}</span><span class="h-txt">${esc(x.t)}</span>${x.a ? `<button type="button" class="btn chico" data-h="${i}">${esc(x.a[0])}</button>` : ''}</li>`).join('')}</ol></section>
    <section class="tarjeta"><div class="cab-tarjeta"><h2>Análisis</h2>
      <div class="segmentado" role="tablist">${[['descriptiva', 'Descriptiva'], ['diagnostica', 'Diagnóstica'], ['predictiva', 'Predictiva'], ['prescriptiva', 'Prescriptiva'], ['acciones', 'Acciones y seguimiento']].map(([k, t]) => `<button type="button" role="tab" class="seg${pestanaA === k ? ' activo' : ''}" data-a="${k}">${t}</button>`).join('')}</div></div>
      <div id="analisis"></div></section></div>`;
  enlazarFiltros(c, ctx);
  c.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { pestanaA = b.dataset.a; vistaIndicadores(c, ctx); });
  c.querySelector('#b-x07').onclick = () => exportarLibro(ctx, '07');
  c.querySelector('#b-x08').onclick = () => exportarLibro(ctx, '08');
  c.querySelectorAll('[data-h]').forEach(b => b.onclick = () => {
    const [, tipo, ref] = hs[Number(b.dataset.h)].a;
    if (tipo === 'parada') ctx.irAParada(ref);
    else if (tipo === 'pieza') ctx.irAPieza(ref);
    else if (tipo === 'ir') ctx.irA(ref);
    else if (tipo === 'sim') { globalThis.CPR_SIM_PIEZA = ref; ctx.irA('simulacion'); }
    else if (tipo === 'pestana') { pestanaA = ref; vistaIndicadores(c, ctx); setTimeout(() => c.querySelector('#analisis').scrollIntoView({ block: 'start', behavior: 'smooth' }), 50); }
  });
  const z = c.querySelector('#analisis');
  ({ descriptiva: pintarDescriptiva, diagnostica: pintarDiagnostica, predictiva: pintarPredictiva, prescriptiva: (zz, ff, ii, cc) => pintarPrescriptiva(zz, ff, ii, cc, pr), acciones: pintarAcciones })[pestanaA](z, f, ind, ctx, c);
  c.querySelectorAll('[data-ir-parada]').forEach(a => a.onclick = e => { e.preventDefault(); ctx.irAParada(a.dataset.irParada); });
  c.querySelectorAll('#kpis-ind [data-ir-pieza]').forEach(a => a.onclick = e => { e.preventDefault(); ctx.irAPieza(a.dataset.irPieza); });
}

function enlazarFiltros(c, ctx) {
  const aplicar = () => {
    const nota = c.querySelector('#nota-ind');
    const nuevo = { ...filtro, equipo: c.querySelector('#fi-eq').value };
    let malo = false;
    for (const [k, id] of [['desde', '#fi-desde'], ['hasta', '#fi-hasta'], ['corteTxt', '#fi-corte']]) {
      const el = c.querySelector(id); el.classList.remove('incompleto');
      if (el.validity.badInput || (k !== 'corteTxt' && !el.value)) { el.classList.add('incompleto'); malo = true; continue; }
      nuevo[k] = el.value ? textoLocalAIso(el.value) : null;
    }
    if (!malo && nuevo.hasta <= nuevo.desde) { malo = true; c.querySelector('#fi-hasta').classList.add('incompleto'); }
    if (malo) { nota.textContent = 'Fecha incompleta o inválida: se mantiene el filtro anterior.'; return; }
    filtro = nuevo; vistaIndicadores(c, ctx);
  };
  c.querySelectorAll('#filtros-ind input, #filtros-ind select').forEach(el => el.addEventListener('change', aplicar));
  c.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
    const hoy0 = ahoraIso().slice(0, 10) + 'T00:00:00-05:00';
    if (b.dataset.r === '30' || b.dataset.r === '90') filtro = { ...filtro, desde: msAIso(isoAMs(hoy0) - (Number(b.dataset.r) - 1) * 86400000), hasta: msAIso(isoAMs(hoy0) + 86400000) };
    else filtro = { ...filtroInicial(), equipo: filtro.equipo, corteTxt: filtro.corteTxt };
    vistaIndicadores(c, ctx);
  });
}

function pintarDescriptiva(z, f, ind) {
  const d = descriptiva(f, ind);
  const tot = TIPOS_TRAMO.reduce((a, t) => a + d.porTipo[t], 0);
  z.innerHTML = `<div class="rejilla-2">
    <div><h3>Horas por tramo</h3>${tot ? `<div class="linea-tramos grande">${TIPOS_TRAMO.filter(t => d.porTipo[t]).map(t => `<div class="t-${t}" style="flex-grow:${d.porTipo[t]}" title="${NOMBRE_TRAMO[t]}">${d.porTipo[t] >= tot * 0.08 ? fmtMagnitud(100 * d.porTipo[t] / tot, 0) + ' %' : ''}</div>`).join('')}</div>` : ''}
      <table class="tabla" id="tabla-desc"><thead><tr><th>Tramo</th><th>Horas</th><th>Porcentaje</th></tr></thead><tbody>
      ${TIPOS_TRAMO.map(t => `<tr data-tipo="${t}" data-min="${d.porTipo[t]}"><td><i class="marca-tramo t-${t}"></i>${NOMBRE_TRAMO[t]}</td><td class="num">${h2(d.porTipo[t] / 60)}</td><td class="num">${tot ? fmtMagnitud(100 * d.porTipo[t] / tot, 1) + ' %' : '—'}</td></tr>`).join('')}
      <tr><td><strong>Total</strong></td><td class="num"><strong>${h2(tot / 60)}</strong></td><td class="num">${tot ? '100.0 %' : '—'}</td></tr></tbody></table></div>
    <div><h3>Espera de pieza por intervención (histograma)</h3>
      ${d.n_esperas ? barrasH(d.histograma, { valor: x => x.intervenciones, etiqueta: x => x.clase }) : `<p class="vacio">${sinBase}: no hay intervenciones que requirieron pieza en el período.</p>`}
      <p class="subtexto">Muestra: ${fmtConteo(d.n_esperas)} intervenciones que requirieron pieza (incluye las de espera cero).</p>
      <h3>Cantidades del período</h3><div class="kpis compactos">
        <div class="kpi"><span>Paradas</span><strong>${fmtConteo(d.cantidades.paradas)}</strong></div>
        <div class="kpi"><span>Intervenciones</span><strong>${fmtConteo(d.cantidades.intervenciones)}</strong></div>
        <div class="kpi"><span>Unidades de repuesto consumidas</span><strong>${fmtConteo(d.cantidades.unidades_consumidas)}</strong></div></div></div></div>`;
}

function pintarDiagnostica(z, f, ind, ctx, c) {
  const d = diagnostica(f, ind);
  z.innerHTML = `<div class="rejilla-2">
    <div><h3>Pareto de horas perdidas por modo de falla</h3>${svgPareto(d.pareto)}
      <table class="tabla" id="tabla-pareto"><thead><tr><th>Modo de falla</th><th>Incidentes</th><th>Horas</th><th>%</th><th>% acumulado</th></tr></thead><tbody>
      ${d.pareto.map(p => `<tr class="clic${modoSel === (p.modo || 'SIN') ? ' sel' : ''}" data-modo="${esc(p.modo || 'SIN')}"><td>${esc(p.nombre)}</td><td class="num">${fmtConteo(p.incidentes)}</td><td class="num">${h2(p.minutos / 60)}</td><td class="num">${fmtMagnitud(p.pct, 1)}</td><td class="num">${fmtMagnitud(p.pct_acum, 1)}</td></tr>`).join('')}
      </tbody></table><p class="subtexto">Pulse un modo para ver sus paradas y llegar al detalle con su evidencia.</p></div>
    <div><h3>Contribución de cada demora</h3>
      <table class="tabla"><thead><tr><th>Motivo (tramo)</th><th>Horas</th><th>%</th><th>% acumulado</th></tr></thead><tbody>
      ${d.paretoTramo.map(p => `<tr><td><i class="marca-tramo t-${p.tipo}"></i>${esc(p.nombre)}</td><td class="num">${h2(p.minutos / 60)}</td><td class="num">${fmtMagnitud(p.pct, 1)}</td><td class="num">${fmtMagnitud(p.pct_acum, 1)}</td></tr>`).join('') || `<tr><td colspan="4">${sinBase}</td></tr>`}
      </tbody></table>
      <h3>Causas</h3><div class="chips"><span class="pildora ok">Confirmadas: ${fmtConteo(d.causas.CONFIRMADA)}</span> <span class="pildora alerta">Hipótesis: ${fmtConteo(d.causas.HIPOTESIS)}</span> <span class="pildora error">Pendientes: ${fmtConteo(d.causas.PENDIENTE)}</span></div>
      <h3>Casos sin causa confirmada</h3>${d.sin_diagnostico.length ? `<table class="tabla"><tbody>${d.sin_diagnostico.map(s => `<tr><td><a href="#" data-ir-parada="${esc(s.codigo)}">${esc(s.codigo)}</a></td><td>${esc(s.modo)}</td><td>${esc(s.estado_causa)}</td><td>${esc(s.causa)}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Ninguno.</p>'}
      <h3>Reincidencias</h3>${d.reincidencias.length ? `<table class="tabla"><tbody>${d.reincidencias.map(r => `<tr><td><a href="#" data-ir-parada="${esc(r.codigo)}">${esc(r.codigo)}</a></td><td>antecedente <a href="#" data-ir-parada="${esc(r.antecedente)}">${esc(r.antecedente)}</a></td><td>${esc(r.modo || '')}</td><td>${r.estado === 'CONFIRMADA' ? '<span class="pildora error">Confirmada</span>' : r.estado === 'DESCARTADA' ? '<span class="pildora ok">Descartada</span>' : '<span class="pildora alerta">Por confirmar</span>'}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Ninguna.</p>'}
    </div></div>`;
  z.querySelectorAll('tr[data-modo]').forEach(tr => tr.onclick = () => { modoSel = modoSel === tr.dataset.modo ? null : tr.dataset.modo; pintarDiagnostica(z, f, ind, ctx, c); });
  if (modoSel) {
    const tr = z.querySelector(`tr[data-modo="${modoSel}"]`);
    const p = d.pareto.find(x => (x.modo || 'SIN') === modoSel);
    if (tr && p) {
      const ps = ind.paradas.filter(x => p.paradas.includes(x.codigo));
      const det = document.createElement('tr'); det.className = 'detalle';
      det.innerHTML = `<td colspan="5"><div class="det-envoltura"><table class="tabla"><thead><tr><th>Parada</th><th>Inicio</th><th>Horas</th><th>Causa</th><th>Evidencia</th><th></th></tr></thead><tbody>${ps.map(x => `<tr><td>${esc(x.codigo)}</td><td class="nw">${esc(mostrarFH(x.inicio))}</td><td class="num">${h2(x.res.total / 60)}</td><td>${esc(x.causa || '—')}</td><td>${esc(x.evidencia_causa || '—')}</td><td><button type="button" class="btn chico" data-ir-parada="${esc(x.codigo)}">Ver parada</button></td></tr>`).join('')}</tbody></table></div></td>`;
      tr.after(det);
    }
  }
  z.querySelectorAll('[data-ir-parada]').forEach(a => a.onclick = e => { e.preventDefault(); e.stopPropagation(); ctx.irAParada(a.dataset.irParada); });
}

function pintarPredictiva(z, f, ind, ctx, c) {
  const p = predictiva({ equipo: f.equipo || 'P-01', corte: f.corte, horizonte_dias: horizonte });
  if (!p) { z.innerHTML = `<p class="vacio">${sinBase}: no hay horas de operación registradas.</p>`; return; }
  const v = p.validacion;
  z.innerHTML = `<div class="cab-tarjeta sub"><p class="subtexto" style="margin:0">${esc(p.metodo)}.</p>
      <div class="campo en-linea"><label for="f-hor">Horizonte (días)</label><input id="f-hor" type="number" min="7" max="730" step="1" value="${horizonte}"></div></div>
    <div class="kpis compactos" id="kpis-pred">
      <div class="kpi"><span>Fallas previstas en ${fmtConteo(horizonte)} días</span><strong>${fmtMagnitud(p.fallas_previstas, 1)}</strong><small>${fmtMagnitud(p.exposicion_h, 0)} h de operación previstas</small></div>
      <div class="kpi"><span>Horas de parada previstas</span><strong>${h2(p.horas_previstas)}</strong><small>proyección, no historia</small></div>
      <div class="kpi"><span>Horas de espera previstas</span><strong>${h2(p.espera_prevista_h)}</strong></div>
      <div class="kpi"><span>Historial usado</span><strong>${fmtConteo(p.fallas_hist)} fallas</strong><small>${fmtMagnitud(p.horas_operacion_hist, 0)} h de operación</small></div></div>
    <div class="rejilla-2">
      <div><h3>Por modo de falla</h3><table class="tabla"><thead><tr><th>Modo</th><th>Muestra</th><th>Tasa / 1000 h</th><th>Fallas previstas</th><th>Horas previstas</th></tr></thead><tbody>
        ${p.modos.map(m => `<tr><td>${esc(m.nombre)}</td><td class="num">${fmtConteo(m.n)}</td><td class="num">${fmtMagnitud(m.tasa_por_1000h, 3)}</td><td class="num">${fmtMagnitud(m.fallas_previstas, 2)}</td><td class="num">${h2(m.horas_previstas)}</td></tr>`).join('')}</tbody></table></div>
      <div><h3>Demanda de piezas</h3><table class="tabla"><thead><tr><th>Pieza</th><th>Historial (u)</th><th>En el horizonte (u)</th><th>Durante la reposición (u)</th></tr></thead><tbody>
        ${p.piezas.map(x => `<tr><td><a href="#" data-ir-pieza="${esc(x.pieza)}">${esc(x.pieza)}</a> ${esc(x.nombre)}</td><td class="num">${fmtConteo(x.unidades)}</td><td class="num">${x.demanda_horizonte === null ? '—' : fmtMagnitud(x.demanda_horizonte, 2)}</td><td class="num">${x.demanda_en_plazo === null ? '—' : fmtMagnitud(x.demanda_en_plazo, 2)}</td></tr>`).join('')}</tbody></table>
        <h3>Validación con el tramo reservado</h3>
        <table class="tabla"><tbody><tr><td>Entrenamiento</td><td>${esc(mostrarFH(v.entrenamiento[0]))} a ${esc(mostrarFH(v.entrenamiento[1]))} · ${fmtConteo(v.muestra_entrenamiento)} fallas</td></tr>
        <tr><td>Tramo reservado</td><td>${esc(mostrarFH(v.prueba[0]))} a ${esc(mostrarFH(v.prueba[1]))}</td></tr>
        <tr><td>Fallas previstas / reales</td><td>${v.fallas_previstas === null ? '—' : fmtMagnitud(v.fallas_previstas, 2)} / ${fmtConteo(v.fallas_reales)} · error <span class="${v.error_fallas < 0 ? 'neg' : ''}">${v.error_fallas === null ? '—' : fmtMagnitud(v.error_fallas, 2)}</span></td></tr>
        <tr><td>Horas previstas / reales</td><td>${v.horas_previstas === null ? '—' : h2(v.horas_previstas)} / ${h2(v.horas_reales)} · error <span class="${v.error_horas < 0 ? 'neg' : ''}">${v.error_horas === null ? '—' : fmtMagnitud(v.error_horas, 2)} h</span></td></tr></tbody></table>
        <p class="subtexto">Muestra pequeña: resultados orientativos. La proyección se separa de las horas históricas reales.</p></div></div>`;
  const hi = z.querySelector('#f-hor');
  hi.onchange = () => { const n = Number(hi.value); if (Number.isInteger(n) && n >= 7 && n <= 730) { horizonte = n; pintarPredictiva(z, f, ind, ctx, c); } else hi.classList.add('incompleto'); };
  z.querySelectorAll('[data-ir-pieza]').forEach(a => a.onclick = e => { e.preventDefault(); ctx.irAPieza(a.dataset.irPieza); });
}

function pintarPrescriptiva(z, f, ind, ctx, pr) {
  z.innerHTML = `<p class="subtexto">Para cada pieza con demanda histórica se comparan A (comprar al necesitarla) y B (conservar 1 unidad y reponer al consumirla) con los mismos parámetros, semilla y repeticiones que la pantalla «Simulación» (${fmtConteo(pr[0]?.repeticiones || 0)} réplicas), por lo que sus cifras coinciden. Costo total en soles para el horizonte por defecto (${fmtConteo(Number(filas("SELECT valor FROM parametro WHERE clave='horizonte_defecto_dias'")[0]?.valor || 180))} días). Para el detalle y la sensibilidad use «Simulación».</p>
    ${pr.length ? `<table class="tabla" id="tabla-prescr"><thead><tr><th>Pieza</th><th>Demandas históricas</th><th>Costo A (S/)</th><th>Costo B (S/)</th><th>Faltante A</th><th>Faltante B</th><th>Espera A</th><th>Espera B</th><th>Política recomendada</th><th></th></tr></thead><tbody>
    ${pr.map(p => `<tr data-pieza="${esc(p.pieza)}"><td><strong>${esc(p.pieza)}</strong> ${esc(p.nombre)}</td><td class="num">${fmtConteo(p.eventos)}</td><td class="num">${fmtMagnitud(p.A.costo_medio, 2)}</td><td class="num">${fmtMagnitud(p.B.costo_medio, 2)}</td>
      <td class="num">${fmtMagnitud(100 * p.A.prob_faltante, 1)} %</td><td class="num">${fmtMagnitud(100 * p.B.prob_faltante, 1)} %</td><td class="num">${h2(p.A.espera_media_h)}</td><td class="num">${h2(p.B.espera_media_h)}</td>
      <td>${p.recomendada === 'B' ? '<span class="pildora ok">B · conservar 1 unidad</span>' : p.recomendada === 'A' ? '<span class="pildora info">A · comprar al necesitar</span>' : '<span class="pildora alerta">Indiferente</span>'}</td>
      <td><button type="button" class="btn chico" data-sim="${esc(p.pieza)}">Abrir en Simulación</button></td></tr>`).join('')}</tbody></table>` : `<p class="vacio">${sinBase}: ninguna pieza tiene demanda histórica.</p>`}`;
  z.querySelectorAll('[data-sim]').forEach(b => b.onclick = () => { globalThis.CPR_SIM_PIEZA = b.dataset.sim; ctx.irA('simulacion'); });
}

function pintarAcciones(z, f, ind, ctx, c) {
  const u = ctx.usuario();
  const acc = seguimientoAcciones(f.corte);
  const cls = e => (e === 'Mejora verificada' ? 'ok' : e === 'Empeoró' ? 'error' : 'alerta');
  const dis = op.puede(u, 'gestionar_acciones') ? '' : `disabled title="Corresponde a ${op.quienPuede('gestionar_acciones')}"`;
  z.innerHTML = `<div class="cab-tarjeta sub"><p class="subtexto" style="margin:0">Acciones técnicas: reincidencias confirmadas por 1000 h de operación. Acciones de almacén: horas de espera por intervención que requirió la pieza (incluye espera cero). Se compara con un período anterior de igual duración.</p>
    <button type="button" class="btn principal" id="b-accion" ${dis}>Registrar acción</button></div>
    <table class="tabla" id="tabla-acciones"><thead><tr><th>Acción</th><th>Problema y acción</th><th>Responsable</th><th>Indicador</th><th>Antes</th><th>En revisión</th><th>Estado</th><th>Vínculos</th><th></th></tr></thead><tbody>
    ${acc.map(a => `<tr data-accion="${esc(a.codigo)}" data-estado="${esc(a.estado)}"><td>${esc(a.codigo)}<br><span class="subtexto">${a.tipo === 'TECNICA' ? 'Técnica' : 'Almacén'}</span></td><td><strong>${esc(a.problema)}</strong><br>${esc(a.accion)}</td><td>${esc(a.responsable)}</td><td>${esc(a.indicador)}<br><span class="subtexto">Objetivo: ${esc(a.objetivo)}</span></td>
      <td>${a.antes.valor === null ? sinBase : '<strong>' + fmtMagnitud(a.antes.valor, 2) + '</strong>'}<br><span class="subtexto">${esc(a.antes.texto)}</span></td>
      <td>${a.despues.valor === null ? sinBase : '<strong>' + fmtMagnitud(a.despues.valor, 2) + '</strong>'}<br><span class="subtexto">${esc(a.despues.texto)}</span></td>
      <td><span class="pildora ${cls(a.estado)}">${esc(a.estado)}</span><br><span class="subtexto">${esc(a.base)}</span></td>
      <td class="nw">${a.parada_codigo ? `<a href="#" data-ir-parada="${esc(a.parada_codigo)}">${esc(a.parada_codigo)}</a><br>` : ''}${a.pieza_codigo ? `<a href="#" data-ir-pieza="${esc(a.pieza_codigo)}">Pieza ${esc(a.pieza_codigo)}</a>` : ''}${a.modo_codigo ? esc(a.modo_codigo) : ''}</td>
      <td><button type="button" class="btn chico" data-seg="${esc(a.codigo)}" ${dis}>Registrar seguimiento</button>${a.seguimientos.length ? `<br><span class="subtexto">${a.seguimientos.length} seguimientos</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
  z.querySelectorAll('[data-ir-parada]').forEach(a => a.onclick = e => { e.preventDefault(); ctx.irAParada(a.dataset.irParada); });
  z.querySelectorAll('[data-ir-pieza]').forEach(a => a.onclick = e => { e.preventDefault(); ctx.irAPieza(a.dataset.irPieza); });
  const b = z.querySelector('#b-accion');
  if (b) b.onclick = async () => {
    const v = await formulario({
      titulo: 'Registrar acción', ancho: 700,
      campos: [
        { id: 'problema', etiqueta: 'Problema', tipo: 'texto' }, { id: 'accion', etiqueta: 'Acción', tipo: 'texto' },
        { id: 'tipo', etiqueta: 'Tipo', tipo: 'select', opciones: [['TECNICA', 'Técnica (se mide por reincidencias)'], ['ALMACEN', 'Almacén (se mide por espera de pieza)']] },
        { id: 'modo', etiqueta: 'Modo de falla (acción técnica)', tipo: 'select', opciones: [['', '—']].concat(filas('SELECT codigo, nombre FROM modo_falla ORDER BY codigo').map(m => [m.codigo, `${m.codigo} · ${m.nombre}`])) },
        { id: 'pieza', etiqueta: 'Pieza (acción de almacén)', tipo: 'select', opciones: [['', '—']].concat(filas('SELECT codigo, nombre FROM pieza ORDER BY codigo').map(p => [p.codigo, `${p.codigo} · ${p.nombre}`])) },
        { id: 'parada', etiqueta: 'Parada que la origina (opcional)', tipo: 'select', opciones: [['', '—']].concat(filas('SELECT codigo FROM parada ORDER BY inicio DESC LIMIT 60').map(p => [p.codigo, p.codigo])) },
        { id: 'responsable', etiqueta: 'Responsable', tipo: 'texto', valor: u.nombre || '' }, { id: 'objetivo', etiqueta: 'Objetivo', tipo: 'texto' }, { id: 'indicador', etiqueta: 'Indicador', tipo: 'texto' },
        { id: 'revision_desde', etiqueta: 'Revisión desde', tipo: 'fecha', valor: ahoraIso().slice(0, 10) }, { id: 'revision_hasta', etiqueta: 'Revisión hasta', tipo: 'fecha' },
      ],
    });
    if (v) await ctx.operar(op.registrarAccion, v, { ok: r => `Acción ${r.codigo} registrada.`, motivo: 'Registrar acción' });
  };
  z.querySelectorAll('[data-seg]').forEach(bt => bt.onclick = async () => {
    const v = await formulario({ titulo: `Registrar seguimiento · ${bt.dataset.seg}`, campos: [{ id: 'valor', etiqueta: 'Resultado observado', tipo: 'texto' }, { id: 'comentario', etiqueta: 'Comentario', tipo: 'texto' }] });
    if (v) await ctx.operar(op.registrarSeguimiento, { accion: bt.dataset.seg, ...v }, { ok: 'Seguimiento registrado.', motivo: 'Seguimiento ' + bt.dataset.seg });
  });
}

export async function exportarLibro(ctx, libro) {
  const f = filtroActual();
  const u = ctx.usuario();
  const quien = u.rol === 'EVALUACION' ? 'Evaluación' : u.nombre;
  const pr = progreso('Exportando Excel ' + libro);
  await pr.paso('Calculando y armando las hojas…', 40);
  try {
    const r = libro === '07' ? libro07(f, quien) : libro08(f, quien, horizonte, prescripcionPiezas(f));
    const nombre = `${libro === '07' ? '07_Resultados_operativos' : '08_Analitica'}_v${globalThis.CPR_VERSION}_${sello()}.xlsx`;
    descargar(r.bytes, nombre, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const ms = pr.fin();
    registrarExportacion(libro, nombre, r.corrida);
    aviso(`Se generó ${nombre} (identificador ${r.corrida}, ${fmtConteo(ms)} ms). Revise su carpeta de descargas.`, 'ok');
  } catch (e) { pr.fin(); aviso('No se pudo generar el Excel: ' + e.message, 'error'); }
}
