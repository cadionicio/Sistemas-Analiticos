// Pantalla «Simulación»: comparación de políticas de reposición A/B con semilla, réplicas, percentiles y sensibilidad.
import { filas } from '../nucleo/bd.js';
import { mostrarFH, ahoraIso, sello } from '../nucleo/fechas.js';
import { fmtMagnitud, fmtConteo, esc } from '../nucleo/formato.js';
import { parametrosPorDefecto, simular, sensibilidad, idCorrida } from '../nucleo/simulacion.js';
import * as op from '../nucleo/operaciones.js';
import { libro09 } from '../adaptadores/exportar.js';
import { descargar, aviso, progreso } from './dom.js';
import { filtroActual } from './vistaIndicadores.js';
import { registrarExportacion } from './exportaciones.js';

let pieza = '0103';
let params = null;
let ultima = null; // { sim, sens }
const sol = x => 'S/ ' + fmtMagnitud(x, 2);
const CAMPOS = [
  ['horizonte_dias', 'Horizonte (días)', 1], ['semilla', 'Semilla', 1], ['repeticiones', 'Repeticiones', 1],
  ['tasa_por_1000h', 'Demandas por 1000 h de operación', 0.001], ['reparacion_h', 'Reparación y verificación (h)', 0.1],
  ['costo_unitario', 'Costo unitario (S/)', 0.01], ['plazo_normal_dias', 'Plazo normal (días)', 0.1], ['plazo_urgente_horas', 'Plazo urgente (h)', 0.1],
  ['costo_hora_parada', 'Costo de una hora improductiva (S/)', 0.01], ['posesion_anual_pct', 'Posesión anual (%)', 0.1], ['recargo_urgencia_pct', 'Recargo por urgencia (%)', 0.1],
];

export async function vistaSimulacion(c, ctx) {
  if (!ctx.hayDatos()) { c.innerHTML = '<section class="tarjeta vacia"><h1>Simulación</h1><p>No hay datos. Vaya a «Inicio» y pulse «Cargar demostración».</p></section>'; return; }
  const corte = filtroActual().corte;
  if (globalThis.CPR_SIM_PIEZA) { pieza = globalThis.CPR_SIM_PIEZA; globalThis.CPR_SIM_PIEZA = null; params = null; ultima = null; }
  if (!params || params.pieza !== pieza) params = parametrosPorDefecto(pieza, corte);
  const piezas = filas('SELECT codigo, nombre FROM pieza ORDER BY codigo');
  c.innerHTML = `<div class="pila">
    <section class="tarjeta"><div class="cab-tarjeta"><h1>Simulación de reposición</h1>
      <div class="barra-herr">
        <div class="campo"><label for="s-pieza">Pieza</label><select id="s-pieza">${piezas.map(p => `<option value="${esc(p.codigo)}"${p.codigo === pieza ? ' selected' : ''}>${esc(p.codigo)} · ${esc(p.nombre)}</option>`).join('')}</select></div>
        <button type="button" class="btn principal grande" id="b-simular">Simular</button>
        <button type="button" class="btn exportar" id="b-x09" title="${ultima ? 'Exporta la corrida mostrada' : 'Simula con los valores actuales y exporta'}">⬇ Exportar Excel 09 · Proyección y control</button>
        <button type="button" class="btn" id="b-defecto">Valores del historial</button>
      </div></div>
      <p class="subtexto"><strong>A</strong> · comprar la pieza al necesitarla (compra urgente, stock inicial 0). <strong>B</strong> · conservar 1 unidad disponible y pedir reposición normal al consumirla (stock inicial 1). Ambas usan el mismo horizonte, la misma secuencia de demandas y los mismos plazos aleatorios.
      Historial de ${esc(pieza)}: ${fmtConteo(params.eventos_hist)} demandas en ${fmtMagnitud(params.horas_operacion_hist, 0)} h de operación${params.eventos_hist < 5 ? ' · <span class="pildora alerta">muestra pequeña: tasa tratada como supuesto sintético</span>' : ''}.</p>
      <div class="rejilla-param" id="parametros">
        ${CAMPOS.map(([k, t, st]) => `<div class="campo"><label for="p-${k}">${t}</label><input id="p-${k}" type="number" step="${st}" min="0" value="${params[k]}"></div>`).join('')}
        <div class="campo"><label class="casilla"><input type="checkbox" id="p-inmediata"${params.reposicion_inmediata ? ' checked' : ''}> Reposición inmediata (plazos cero)</label><small>Caso de control: la espera por suministro debe ser cero.</small></div>
      </div>
      <div class="error-form" id="err-sim"></div></section>
    ${tarjetaTipoCambio()}
    <div id="resultado-sim">${ultima ? resultado(ultima) : '<section class="tarjeta"><p class="vacio centro">Ajuste los parámetros si lo desea y pulse «Simular».</p></section>'}</div></div>`;
  const btc = c.querySelector('#b-tc');
  if (btc) btc.onclick = async () => {
    btc.disabled = true; btc.textContent = 'Consultando…';
    const pr = progreso('Consulta por internet');
    await pr.paso('Consultando el tipo de cambio en el BCRP (máximo 8 s)…', 50);
    let r;
    try { r = await globalThis.hostCPR.tipoCambio(); } catch (e) { r = { ok: false, error: e.message }; }
    pr.fin();
    if (!r.ok) { aviso('No se pudo consultar el tipo de cambio: ' + r.error + '. Se mantiene el último valor guardado; la simulación funciona igual.', 'alerta'); vistaSimulacion(c, ctx); return; }
    await ctx.operar(op.guardarTipoCambio, r, { ok: `Tipo de cambio guardado: S/ ${r.valor.toFixed(3)} por US$ (${r.fecha}, BCRP).`, motivo: 'Tipo de cambio' });
  };
  c.querySelector('#s-pieza').onchange = e => { pieza = e.target.value; params = null; ultima = null; vistaSimulacion(c, ctx); };
  c.querySelector('#b-defecto').onclick = () => { params = null; ultima = null; vistaSimulacion(c, ctx); };
  c.querySelector('#b-simular').onclick = async () => {
    const P = { ...params };
    for (const [k] of CAMPOS) {
      const el = c.querySelector('#p-' + k); el.classList.remove('incompleto');
      const v = Number(el.value);
      if (el.value === '' || !Number.isFinite(v) || v < 0) { el.classList.add('incompleto'); c.querySelector('#err-sim').textContent = 'Revise los valores marcados.'; return; }
      P[k] = v;
    }
    if (!Number.isInteger(P.repeticiones) || P.repeticiones < 100 || P.repeticiones > 20000) { c.querySelector('#err-sim').textContent = 'Use entre 100 y 20000 repeticiones.'; return; }
    if (!Number.isInteger(P.horizonte_dias) || P.horizonte_dias < 7) { c.querySelector('#err-sim').textContent = 'El horizonte debe ser de al menos 7 días.'; return; }
    P.semilla = Math.trunc(P.semilla);
    P.reposicion_inmediata = c.querySelector('#p-inmediata').checked;
    params = P;
    await correrSimulacion(P, corte, ctx);
  };
  const bx = c.querySelector('#b-x09');
  if (bx) bx.onclick = () => exportar09(ctx);
}

// Ejecuta la simulación, guarda la corrida y la deja como última para exportar
async function correrSimulacion(P, corte, ctx) {
  const pr = progreso('Simulación de reposición');
  await pr.paso(`Simulando ${fmtConteo(P.repeticiones)} réplicas por política…`, 20);
  const t0 = performance.now();
  const sim = simular(P);
  await pr.paso('Calculando la sensibilidad (9 escenarios)…', 70);
  const sens = sensibilidad(P, 400);
  const ms = Math.round(performance.now() - t0);
  pr.fin();
  const carga = filas('SELECT sha256 FROM carga ORDER BY id DESC LIMIT 1')[0] || {};
  sim.id = idCorrida(P, globalThis.CPR_VERSION, carga.sha256 || '', corte);
  sim.corte = corte; sim.ms = ms; sim.sha06 = carga.sha256 || '';
  ultima = { sim, sens };
  await ctx.operar(op.guardarCorrida, { id: sim.id, parametros: P, A: sim.A, B: sim.B, recomendada: sim.recomendada, diferencia_media: sim.diferencia_media, diferencia_ic95: sim.diferencia_ic95, sha06: sim.sha06 },
    { ok: `Corrida ${sim.id} guardada (${ms} ms).`, motivo: 'Simulación ' + sim.id });
  return ultima;
}

export const ultimaSimulacion = () => (ultima ? { id: ultima.sim.id, pieza: ultima.sim.parametros.pieza, nombre: ultima.sim.parametros.nombre, semilla: ultima.sim.parametros.semilla, repeticiones: ultima.sim.parametros.repeticiones, horizonte: ultima.sim.parametros.horizonte_dias } : null);

// Exporta el 09 con la última simulación; si aún no hay, simula primero con los valores del historial de la pieza elegida
export async function exportar09(ctx) {
  if (!ultima) {
    const corte = filtroActual().corte;
    if (!params || params.pieza !== pieza) params = parametrosPorDefecto(pieza, corte);
    await correrSimulacion({ ...params }, corte, ctx);
  }
  const u = ctx.usuario();
  const pr = progreso('Exportando Excel 09');
  await pr.paso('Armando escenarios, réplicas, sensibilidad y trazabilidad…', 40);
  try {
    const r = libro09(ultima.sim, ultima.sens, u.rol === 'EVALUACION' ? 'Evaluación' : u.nombre, filtroActual(), ultima.sim.parametros.horizonte_dias);
    const nombre = `09_Proyeccion_control_v${globalThis.CPR_VERSION}_${sello()}.xlsx`;
    descargar(r.bytes, nombre, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const ms = pr.fin();
    registrarExportacion('09', nombre, r.corrida);
    aviso(`Se generó ${nombre} (corrida ${r.corrida}, ${fmtConteo(ms)} ms). Revise su carpeta de descargas.`, 'ok');
  } catch (e) { pr.fin(); aviso('No se pudo generar el Excel: ' + e.message, 'error'); }
}

function resultado({ sim, sens }) {
  const A = sim.A, B = sim.B, P = sim.parametros;
  const rec = sim.recomendada === 'B' ? '<span class="pildora ok">Recomendada: B · conservar 1 unidad</span>' : sim.recomendada === 'A' ? '<span class="pildora info">Recomendada: A · comprar al necesitar</span>' : '<span class="pildora alerta">Indiferente: la diferencia está dentro del error</span>';
  const tc = Number(filas("SELECT valor FROM parametro WHERE clave='tipo_cambio_usd_venta'")[0]?.valor || 0);
  const usd = x => (tc ? ` · ≈ US$ ${fmtMagnitud(x / tc, 2)}` : '');
  const col = (pol, R) => `<div class="pol pol-${pol}"><h3>Política ${pol}</h3>
    <div class="kpis compactos"><div class="kpi"><span>Costo total medio</span><strong data-costo="${pol}">${sol(R.costo_medio)}</strong><small>P10 ${sol(R.costo_p10)} · P90 ${sol(R.costo_p90)}${usd(R.costo_medio)}</small></div>
      <div class="kpi ${R.espera_media_h > 0 ? 'alerta' : 'ok'}"><span>Espera por suministro</span><strong data-espera="${pol}">${fmtMagnitud(R.espera_media_h, 2)} h</strong><small>P90 ${fmtMagnitud(R.espera_p90_h, 2)} h</small></div>
      <div class="kpi ${R.prob_faltante > 0.5 ? 'error' : R.prob_faltante > 0 ? 'alerta' : 'ok'}"><span>Probabilidad de faltante</span><strong>${R.prob_faltante === null ? '—' : fmtMagnitud(100 * R.prob_faltante, 1) + ' %'}</strong><small>${fmtConteo(R.faltantes)} de ${fmtConteo(R.demandas)} demandas no atendidas de inmediato</small></div></div>
    <table class="tabla"><tbody><tr><td>Compras</td><td class="num">${sol(R.compras)}</td></tr><tr><td>Posesión de inventario</td><td class="num">${sol(R.posesion)}</td></tr><tr><td>Horas improductivas valorizadas</td><td class="num">${sol(R.costo_espera)}</td></tr><tr><td>Inventario final descontado</td><td class="num neg">-${fmtMagnitud(R.inventario_final, 2)}</td></tr></tbody></table></div>`;
  return `<section class="tarjeta" id="sim-res"><div class="cab-tarjeta"><h2>Resultado · ${esc(P.pieza)} ${esc(P.nombre)}</h2>${rec}</div>
    <p class="subtexto">Corrida <strong id="sim-id">${esc(sim.id)}</strong> · horizonte ${fmtConteo(P.horizonte_dias)} días · semilla ${esc(P.semilla)} · ${fmtConteo(P.repeticiones)} repeticiones por política · versión ${esc(globalThis.CPR_VERSION)} · corte ${esc(mostrarFH(sim.corte))} · ${fmtConteo(sim.ms)} ms${P.reposicion_inmediata ? ' · <strong>reposición inmediata</strong>' : ''}</p>
    <div class="rejilla-2">${col('A', A)}${col('B', B)}</div>
    <p class="centro"><strong>B − A = <span class="${sim.diferencia_media < 0 ? 'neg' : ''}">${sim.diferencia_media < 0 ? '-' : ''}S/ ${fmtMagnitud(Math.abs(sim.diferencia_media), 2)}</span></strong> · IC 95 %: ${fmtMagnitud(sim.diferencia_ic95[0], 2)} a ${fmtMagnitud(sim.diferencia_ic95[1], 2)} · error estándar ${fmtMagnitud(sim.error_estandar, 2)}</p>
    <p class="subtexto centro">${esc(sim.metodo_demanda)}. Esta estimación es una simulación y se mantiene separada de las horas históricas reales.</p></section>
    <section class="tarjeta"><h2>Sensibilidad de la decisión (400 réplicas, misma semilla)</h2>
    <table class="tabla" id="tabla-sens"><thead><tr><th>Costo de una hora improductiva</th><th>Plazo urgente</th><th>Costo A</th><th>Costo B</th><th>Recomendada</th></tr></thead><tbody>
    ${sens.map(s => `<tr><td class="num">${sol(s.costo_hora)} (×${fmtMagnitud(s.factor_costo_hora, 1)})</td><td class="num">${fmtMagnitud(s.plazo_urgente_h, 1)} h (×${fmtMagnitud(s.factor_plazo_urgente, 1)})</td><td class="num">${sol(s.costo_A)}</td><td class="num">${sol(s.costo_B)}</td><td>${s.recomendada === 'B' ? '<span class="pildora ok">B</span>' : s.recomendada === 'A' ? '<span class="pildora info">A</span>' : '<span class="pildora alerta">Indiferente</span>'}</td></tr>`).join('')}
    </tbody></table></section>`;
}

function tarjetaTipoCambio() {
  const tc = filas("SELECT * FROM parametro WHERE clave='tipo_cambio_usd_venta'")[0];
  const exe = !!(globalThis.hostCPR && globalThis.hostCPR.tipoCambio);
  return `<section class="tarjeta"><div class="cab-tarjeta"><h2>Tipo de cambio para repuestos importados</h2>
    <div class="barra-herr">${exe ? '<button type="button" class="btn" id="b-tc">Consultar tipo de cambio (internet)</button>' : '<span class="pildora info">La consulta por internet está disponible en la aplicación de escritorio</span>'}</div></div>
    <p class="subtexto" id="tc-estado">${tc ? `<strong>S/ ${fmtMagnitud(Number(tc.valor), 3)} por US$</strong> · ${esc(tc.descripcion)}` : 'Sin consulta guardada. Los costos se muestran en soles; el tipo de cambio solo agrega su equivalente en dólares.'}</p></section>`;
}
