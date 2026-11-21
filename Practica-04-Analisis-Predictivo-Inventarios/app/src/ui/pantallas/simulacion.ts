/** Pantalla 7 · Simulación de escenarios (Monte Carlo en segundo plano, 10 000 iteraciones, semilla reproducible). */
import { registrar, estado, analisisCompleto, repintar, trasCambioDeDatos } from '../app';
import { llamar } from '../motor';
import { tarjeta, tarjetaKpi, vacio, insignia, esc, mesCorto, fmtNum, fmtMillones, fmtPct, trasPintar, hallazgos, avisar, ayuda } from '../componentes';
import { grafico, opHistograma, opTornado, opBarras, tema } from '../graficos';
import { contrato } from './analisis';
import type { Simulacion } from '../../core/analitica/montecarlo';

let escSel = 'Base';
const pers = { fDemanda: 100, fLT: 100, ns: 95, fVentas: 100, dMargen: 0, fVol: 100, iter: 10000, semilla: 24092026 };

registrar({ id: 'simulacion', icono: '🎲', menu: 'Simulación de escenarios', titulo: 'Simulación de escenarios', pregunta: '¿Qué puede pasar? Modelo estocástico Monte Carlo: pesimista, base, optimista y personalizado',
  pintar() {
    const R = estado.R;
    if (!R?.sm) {
      trasPintar(() => document.getElementById('sm-1clic')?.addEventListener('click', analisisCompleto));
      return vacio('🎲', 'Aún no hay simulación', 'La simulación usa las políticas del análisis prescriptivo. Ejecute primero el análisis completo.', '<button class="btn primario" id="sm-1clic">▶ Análisis completo en 1 clic</button>');
    }
    const s: Simulacion = R.sm.result;
    const t = tema();
    let html = `<div class="tarjeta"><header><div class="t"><h3>Escenario personalizado</h3><div class="sub">Mueva los controles y pulse <b>Simular</b>: el Monte Carlo corre en segundo plano (la ventana no se congela)</div></div></header>
      <div class="fila" style="gap:22px">
        ${rango('fDemanda', 'Demanda', 50, 150, 5, '%')}${rango('fLT', 'Plazo de suministro', 50, 200, 10, '%')}${rango('ns', 'Nivel de servicio', 80, 99, 1, '%')}
        ${rango('fVentas', 'Ventas', 80, 120, 1, '%')}${rango('dMargen', 'Margen', -3, 3, 0.25, 'pp')}${rango('fVol', 'Volatilidad del margen', 50, 200, 10, '%')}
      </div>
      <div class="fila mt"><label class="campo">Iteraciones<input type="number" id="sm-iter" value="${pers.iter}" min="1000" max="50000" step="1000"/></label>
        <label class="campo">Semilla ${ayuda('Misma semilla = mismos resultados (reproducibilidad)')}<input type="number" id="sm-semilla" value="${pers.semilla}"/></label>
        <button class="btn primario" id="sm-btn">🎲 Simular (4 escenarios)</button><span class="nota" id="sm-est"></span></div></div>`;

    const escs = [...(s.inventario?.escenarios.map((e) => e.escenario) ?? []), ...(s.ventas?.escenarios.map((e) => e.escenario) ?? [])].filter((x, i, a) => a.indexOf(x) === i);
    if (!escs.includes(escSel)) escSel = 'Base';
    html += `<div class="filtros mt"><label class="campo">Escenario para histogramas<select id="sm-esc">${escs.map((e) => `<option ${e === escSel ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></label>
      <span class="nota">Semilla ${s.semilla} · ${fmtNum(s.iteraciones)} iteraciones por escenario</span></div>`;

    if (s.ventas) {
      const v = s.ventas, e = v.escenarios.find((x) => x.escenario === escSel) ?? v.escenarios[1];
      html += `<h3 class="mt" style="margin-bottom:8px">💰 Utilidad y ventas (6 meses: ${mesCorto(v.horizonte[0])} a ${mesCorto(v.horizonte.at(-1)!)})</h3>
      <div class="tarjeta"><div class="tabla-caja"><table class="t"><thead><tr><th>Métrica</th>${v.escenarios.map((x) => `<th class="n">${esc(x.escenario)}</th>`).join('')}</tr></thead><tbody>
        <tr><td>Ventas 6 meses · P50</td>${v.escenarios.map((x) => `<td class="n">${fmtMillones(x.ventas6m.p50)}</td>`).join('')}</tr>
        <tr><td>Utilidad 6 meses · P5</td>${v.escenarios.map((x) => `<td class="n">${fmtMillones(x.utilidad6m.p5)}</td>`).join('')}</tr>
        <tr><td><b>Utilidad 6 meses · P50</b></td>${v.escenarios.map((x) => `<td class="n"><b>${fmtMillones(x.utilidad6m.p50)}</b></td>`).join('')}</tr>
        <tr><td>Utilidad 6 meses · P95</td>${v.escenarios.map((x) => `<td class="n">${fmtMillones(x.utilidad6m.p95)}</td>`).join('')}</tr>
        <tr><td>P(utilidad &lt; 0)</td>${v.escenarios.map((x) => `<td class="n">${fmtPct(x.probUtilidadNegativa, 1)} ${x.probUtilidadNegativa > 0.2 ? insignia('Alto', 'crit') : x.probUtilidadNegativa > 0.05 ? insignia('Medio', 'warn') : insignia('Bajo', 'ok')}</td>`).join('')}</tr>
      </tbody></table></div></div>
      <div class="grid g2 mt">
        ${tarjeta(`Distribución de la utilidad 6 meses · ${esc(e.escenario)}`, grafico(opHistograma(e.histogramaUtilidad, (x) => `${fmtNum(x / 1e6, 1)} M`, [{ nombre: 'P5', valor: e.utilidad6m.p5 }, { nombre: 'P50', valor: e.utilidad6m.p50 }, { nombre: 'P95', valor: e.utilidad6m.p95 }]),
          { nombre: `histograma_utilidad_${e.escenario}`, tabla: { cols: ['Desde S/', 'Hasta S/', 'Iteraciones'], filas: e.histogramaUtilidad.map((b) => [b.desde, b.hasta, b.n]) } }), { sub: 'Histograma + curva de probabilidad acumulada (eje derecho) · S/' })}
        ${tarjeta('Sensibilidad (tornado) · utilidad 6 meses P50', grafico(opTornado(v.tornado, (x) => `S/ ${fmtNum(x / 1e6, 1)} M`), { nombre: 'tornado_utilidad', tabla: { cols: ['Factor', 'Bajo', 'Alto', 'Base'], filas: v.tornado.map((x) => [x.factor, x.bajo, x.alto, x.base]) } }), { sub: '¿Qué variable mueve más el resultado?' })}
      </div>`;
    }
    if (s.inventario) {
      const inv = s.inventario, e = inv.escenarios.find((x) => x.escenario === escSel) ?? inv.escenarios[1];
      html += `<h3 class="mt" style="margin-bottom:8px">📦 Inventario (política (s,Q) diaria de ${inv.productos.length} productos clase A, 183 días)</h3>
      <div class="grid g4">
        ${tarjetaKpi({ etiqueta: `Nivel de servicio (fill rate) · ${e.escenario}`, valor: fmtPct(e.fillRate.media, 1), delta: `P5–P95: ${fmtPct(e.fillRate.p5, 1)} – ${fmtPct(e.fillRate.p95, 1)}`, formula: 'Unidades despachadas ÷ unidades demandadas (ventas perdidas si no hay stock)' })}
        ${tarjetaKpi({ etiqueta: 'Probabilidad de quiebre', valor: fmtPct(e.probQuiebre, 1), delta: `por producto: ${fmtPct(e.probQuiebreProducto, 1)}`, sentido: e.probQuiebre > 0.5 ? 'baja' : 'neutro', formula: 'Proporción de iteraciones con al menos un día sin stock' })}
        ${tarjetaKpi({ etiqueta: 'Stock promedio (capital inmovilizado)', valor: fmtNum(e.stockPromedio.p50, 0), unidadMenor: 'unid.', delta: `P5–P95: ${fmtNum(e.stockPromedio.p5, 0)} – ${fmtNum(e.stockPromedio.p95, 0)}` })}
        ${tarjetaKpi({ etiqueta: 'Costo total 6 meses (P50)', valor: fmtNum(e.costoTotal.p50, 0), unidadMenor: 'unid. eq.', delta: `P95: ${fmtNum(e.costoTotal.p95, 0)} · convergencia ${inv.convergencia.ok ? '✔' : '✖'}`, formula: 'Mantener + ordenar + faltantes; en unidades equivalentes (costo unitario = 1, SUPUESTO)' })}
      </div>
      <div class="grid g2 mt">
        ${tarjeta('Comparación de escenarios · fill rate', grafico(opBarras(inv.escenarios.map((x) => x.escenario), [{ nombre: 'Fill rate medio', datos: inv.escenarios.map((x) => x.fillRate.media) }], (x) => `${fmtNum(x * 100, 1)} %`,
          { etiquetas: true, colorPorValor: (x) => (x >= 0.95 ? t.ok : x >= 0.85 ? t.s1 : t.crit) }), { nombre: 'fill_rate_escenarios', clase: 'bajo', tabla: { cols: ['Escenario', 'Fill rate', 'P(quiebre)', 'Stock P50', 'Costo P50'], filas: inv.escenarios.map((x) => [x.escenario, x.fillRate.media * 100, x.probQuiebre * 100, x.stockPromedio.p50, x.costoTotal.p50]) } }))}
        ${tarjeta('Sensibilidad (tornado) · fill rate', grafico(opTornado(inv.tornado, (x) => `${fmtNum(x * 100, 1)} %`), { nombre: 'tornado_fill_rate', clase: 'bajo', tabla: { cols: ['Factor', 'Bajo', 'Alto', 'Base'], filas: inv.tornado.map((x) => [x.factor, x.bajo, x.alto, x.base]) } }))}
      </div>
      <div class="mt">${tarjeta(`Distribución del costo total de inventario · ${esc(e.escenario)}`, grafico(opHistograma(e.histogramaCosto, (x) => fmtNum(x, 0), [{ nombre: 'P50', valor: e.costoTotal.p50 }, { nombre: 'P95', valor: e.costoTotal.p95 }]), { nombre: `histograma_costo_${e.escenario}` }), { sub: 'Unidades equivalentes' })}</div>`;
    }
    const vb = s.ventas?.escenarios.find((x) => x.escenario === 'Base'), ib = s.inventario?.escenarios.find((x) => x.escenario === 'Base');
    const ip = s.inventario?.escenarios.find((x) => x.escenario === 'Pesimista');
    html += `<div class="mt">${hallazgos([
      ...(vb ? [{ t: 'E' as const, texto: `Escenario base: utilidad 6 meses P50 ${fmtMillones(vb.utilidad6m.p50)} (P5 ${fmtMillones(vb.utilidad6m.p5)} – P95 ${fmtMillones(vb.utilidad6m.p95)}); probabilidad de pérdida ${fmtPct(vb.probUtilidadNegativa, 1)}.` }] : []),
      ...(s.ventas ? [{ t: 'D' as const, texto: `La variable más sensible para la utilidad es «${esc([...s.ventas.tornado].sort((a, b) => Math.abs(b.alto - b.bajo) - Math.abs(a.alto - a.bajo))[0].factor)}»: gestionar margen pesa más que empujar volumen.` }] : []),
      ...(ib && ip ? [{ t: 'E' as const, texto: `Con la política propuesta, el fill rate de clase A es ${fmtPct(ib.fillRate.media, 1)} en el escenario base y ${fmtPct(ip.fillRate.media, 1)} en el pesimista (demanda +20 %, plazo +50 %).` }] : []),
      { t: 'S', texto: 'Use el escenario personalizado para probar un nivel de servicio mayor o un plazo de suministro más corto antes de negociar con proveedores.' },
    ])}</div>${contrato(R.sm)}`;

    trasPintar(() => {
      document.querySelectorAll<HTMLInputElement>('input[data-r]').forEach((i) => i.addEventListener('input', () => {
        (pers as Record<string, number>)[i.dataset.r!] = +i.value; document.getElementById(`v-${i.dataset.r}`)!.textContent = etiquetaRango(i.dataset.r!, +i.value);
      }));
      document.getElementById('sm-esc')?.addEventListener('change', (e) => { escSel = (e.target as HTMLSelectElement).value; repintar(); });
      document.getElementById('sm-btn')!.addEventListener('click', async (ev) => {
        const b = ev.target as HTMLButtonElement; b.disabled = true;
        pers.iter = Math.max(1000, Math.min(50000, +(document.getElementById('sm-iter') as HTMLInputElement).value || 10000));
        pers.semilla = Math.trunc(+(document.getElementById('sm-semilla') as HTMLInputElement).value || 24092026);
        const est = document.getElementById('sm-est')!; est.textContent = '⏳ Simulando en segundo plano…';
        const t0 = performance.now();
        try {
          await llamar('simular', { iteraciones: pers.iter, semilla: pers.semilla,
            personalizadoInv: { nombre: 'Personalizado', fDemanda: pers.fDemanda / 100, fLT: pers.fLT / 100, nivelServicio: pers.ns / 100 },
            personalizadoVtas: { nombre: 'Personalizado', fVentas: pers.fVentas / 100, deltaMargenPp: pers.dMargen, fVolatilidad: pers.fVol / 100 } });
          estado.R = await llamar('resultados'); await trasCambioDeDatos();
          escSel = 'Personalizado';
          avisar(`✔ Simulación lista en ${fmtNum((performance.now() - t0) / 1000, 1)} s (${fmtNum(pers.iter)} iteraciones × 4 escenarios, semilla ${pers.semilla}).`, 'ok');
          repintar();
        } catch (e) { avisar(esc((e as Error).message), 'error'); b.disabled = false; est.textContent = ''; }
      });
    });
    return html;
  },
});
function etiquetaRango(k: string, v: number): string {
  if (k === 'dMargen') return `${v >= 0 ? '+' : ''}${fmtNum(v, 2)} pp`;
  if (k === 'ns') return `${v} %`;
  return `${v >= 100 ? '+' : ''}${v - 100} %`;
}
function rango(k: keyof typeof pers, et: string, min: number, max: number, paso: number, _u: string): string {
  return `<label class="campo">${et}: <b id="v-${k}">${etiquetaRango(k, pers[k])}</b><input type="range" data-r="${k}" min="${min}" max="${max}" step="${paso}" value="${pers[k]}"/></label>`;
}
