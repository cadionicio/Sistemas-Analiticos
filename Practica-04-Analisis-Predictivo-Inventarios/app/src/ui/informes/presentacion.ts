/** Presentación ejecutiva (.pptx) para la alta dirección, con gráficos NATIVOS de PowerPoint (editables). */
import pptxgen from 'pptxgenjs';
import type { Resultados } from '../../core/agentes/resultados';
import { fmtMillones as M, fmtNum as N, fmtPct } from '../../core/util/util';

const AZUL = '0F2A47', AZUL2 = '2A78D6', NARANJA = 'EB6834', GRIS = '5B5A55', CLARO = 'EEF4FC', VERDE = '0A5C0A', ROJO = 'B42828';
const MC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mes = (p: string) => `${MC[+p.slice(5, 7) - 1]} ${p.slice(2, 4)}`;
const vr = (x: number) => `${x >= 0 ? '+' : ''}${N(x * 100, 1)} %`;
const F = 'Calibri';

export async function aPPTX(R: Resultados, meta: { version: number; fecha: string; aportes: string }): Promise<Uint8Array> {
  const p = new pptxgen();
  p.layout = 'LAYOUT_WIDE'; p.author = 'Dionicio Achachagua Cesar Alonso (20192589B)'; p.company = 'UNI-FIIS · GE803U'; p.title = 'Presentación ejecutiva · Gestión de inventarios y rentabilidad';
  p.defineSlideMaster({ title: 'BASE', background: { color: 'FFFFFF' }, objects: [
    { rect: { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: AZUL } } },
    { text: { text: 'Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios · Super Agente IA', options: { x: 0.5, y: 7.05, w: 9, h: 0.3, fontSize: 9, color: GRIS, fontFace: F } } }],
    slideNumber: { x: 12.3, y: 7.05, fontSize: 9, color: GRIS, fontFace: F } });
  const d = R.dv?.result, gv = R.gv?.result, pv = R.pv?.result, dk = R.dk?.result, gk = R.gk?.result, pr = R.pr?.result, sm = R.sm?.result;
  const tv = pv?.series.find((s) => s.serie === 'ventas_soles' && s.nivel === 'total');
  let nSl = 0;
  const nueva = (titulo: string, mensaje: string) => {
    const s = p.addSlide({ masterName: 'BASE' }); nSl++;
    s.addText(titulo, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 26, bold: true, color: AZUL, fontFace: F });
    s.addText(mensaje, { x: 0.5, y: 0.92, w: 12.3, h: 0.5, fontSize: 15, color: AZUL2, fontFace: F });
    return s;
  };
  const kpi = (s: pptxgen.Slide, x: number, y: number, w: number, et: string, v: string, dd: string, color = AZUL) => {
    s.addShape(p.ShapeType.roundRect, { x, y, w, h: 1.45, fill: { color: CLARO }, line: { color: CLARO }, rectRadius: 0.08 });
    s.addText(et, { x: x + 0.15, y: y + 0.08, w: w - 0.3, h: 0.35, fontSize: 12, color: GRIS, fontFace: F });
    s.addText(v, { x: x + 0.15, y: y + 0.42, w: w - 0.3, h: 0.6, fontSize: 28, bold: true, color, fontFace: F });
    s.addText(dd, { x: x + 0.15, y: y + 1.0, w: w - 0.3, h: 0.35, fontSize: 11, color: GRIS, fontFace: F });
  };
  const vinetas = (s: pptxgen.Slide, items: string[], x: number, y: number, w: number, h: number, tam = 15) =>
    s.addText(items.map((t) => ({ text: t, options: { bullet: { code: '25A0' }, breakLine: true } })), { x, y, w, h, fontSize: tam, color: '222222', fontFace: F, valign: 'top', paraSpaceAfter: 8 });
  const tabla = (s: pptxgen.Slide, cab: string[], filas: string[][], x: number, y: number, w: number, colW?: number[], tam = 11) =>
    s.addTable([cab.map((c) => ({ text: c, options: { bold: true, color: 'FFFFFF', fill: { color: AZUL } } })), ...filas.map((f, i) => f.map((c) => ({ text: c, options: { fill: { color: i % 2 ? 'F7F7F4' : 'FFFFFF' } } })))],
      { x, y, w, colW, fontSize: tam, fontFace: F, border: { type: 'solid', pt: 0.5, color: 'D9D8D2' }, valign: 'middle', autoPage: false });

  // 1 · Portada
  const s1 = p.addSlide(); nSl++;
  s1.background = { color: AZUL };
  s1.addText('Gestión de inventarios y rentabilidad', { x: 0.7, y: 1.7, w: 12, h: 0.9, fontSize: 38, bold: true, color: 'FFFFFF', fontFace: F });
  s1.addText('Diagnóstico, pronóstico a 6 meses y plan de acción · Presentación para la alta dirección', { x: 0.7, y: 2.6, w: 12, h: 0.6, fontSize: 18, color: 'CDE2FB', fontFace: F });
  s1.addText([{ text: 'Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios · Super Agente IA', options: { breakLine: true } },
    { text: `Versión v${meta.version} · ${meta.fecha.replace('T', ' ')}`, options: { breakLine: true } },
    { text: 'Dionicio Achachagua Cesar Alonso (20192589B) · GE803U Sistemas Analíticos · UNI-FIIS' }], { x: 0.7, y: 4.6, w: 12, h: 1.3, fontSize: 14, color: 'FFFFFF', fontFace: F });

  // 2 · Situación
  if (d) {
    const s = nueva('Situación actual', `La utilidad cae ${N(Math.abs(d.variacion.utilidad / (d.variacion.ventas || 1)), 1)} veces más rápido que las ventas`);
    kpi(s, 0.5, 1.7, 2.95, 'Ventas 12 meses', M(d.kpi12.ventas), `${vr(d.variacion.ventas)} vs. año previo`);
    kpi(s, 3.6, 1.7, 2.95, 'Utilidad operativa 12 meses', M(d.kpi12.utilidad), vr(d.variacion.utilidad), ROJO);
    kpi(s, 6.7, 1.7, 2.95, 'Margen operativo', fmtPct(d.kpi12.margen), `antes ${fmtPct(d.kpi12prev.margen)}`, ROJO);
    kpi(s, 9.8, 1.7, 3.0, 'Productos con pérdida', `${N(d.skusConPerdida)} de ${N(d.skus)}`, `${fmtPct(d.skusConPerdida / d.skus, 0)} del surtido`, ROJO);
    const ult = d.serie.slice(-36);
    s.addChart(p.ChartType.line, [{ name: 'Ventas (S/ M)', labels: ult.map((x) => mes(x.periodo)), values: ult.map((x) => +(x.soles / 1e6).toFixed(2)) }, { name: 'Utilidad (S/ M)', labels: ult.map((x) => mes(x.periodo)), values: ult.map((x) => +(x.utilidad / 1e6).toFixed(2)) }],
      { x: 0.5, y: 3.35, w: 12.3, h: 3.55, chartColors: [AZUL2, NARANJA], lineSize: 2, lineDataSymbol: 'none', showLegend: true, legendPos: 't', legendFontSize: 11, catAxisLabelFontSize: 9, valAxisLabelFontSize: 10, valAxisLabelFormatCode: '#,##0', showTitle: false, catAxisLabelFrequency: '3' });
  }
  // 3 · Dónde se pierde margen
  if (d) {
    const ds = [...d.departamentos].sort((a, b) => a.margen - b.margen);
    const s = nueva('¿Dónde se pierde el margen?', `${ds[0].departamento} deja solo ${fmtPct(ds[0].margen)} de margen; ${ds.at(-1)!.departamento} logra ${fmtPct(ds.at(-1)!.margen)}`);
    s.addChart(p.ChartType.bar, [{ name: 'Margen %', labels: ds.map((x) => x.departamento), values: ds.map((x) => +(x.margen * 100).toFixed(2)) }],
      { x: 0.5, y: 1.6, w: 7.2, h: 5.3, barDir: 'bar', chartColors: [AZUL2], showValue: true, dataLabelFormatCode: '0.00"%"', dataLabelFontSize: 10, valAxisHidden: true, catAxisLabelFontSize: 12, showLegend: false, valGridLine: { style: 'none' } });
    vinetas(s, [`${N(d.skusConPerdida)} SKU acumulan utilidad negativa; los 20 peores concentran ${gv ? fmtPct(gv.perdidas.top20Participacion, 0) : '—'} de la pérdida.`,
      `Los 20 SKU más vendidos concentran ${fmtPct(d.concentracionTop20Sku, 0)} de las ventas.`, 'El problema es de rentabilidad por producto y región, no de volumen general.'], 8.0, 1.8, 4.8, 4.8);
  }
  // 4 · Causas raíz
  if (gv) {
    const s = nueva('Causas raíz con evidencia', `Las ventas cayeron por volumen (${M(gv.pvm.volumen)}), no por precio; la utilidad, por el margen`);
    const ef = [['Precio', gv.pvm.precio], ['Volumen', gv.pvm.volumen], ['Mezcla', gv.pvm.mezcla], ['SKU nuevos', gv.pvm.nuevos], ['SKU perdidos', gv.pvm.perdidos]] as [string, number][];
    s.addChart(p.ChartType.bar, [{ name: 'S/ M', labels: ef.map((e) => e[0]), values: ef.map((e) => +(e[1] / 1e6).toFixed(1)) }],
      { x: 0.5, y: 1.6, w: 6.3, h: 5.2, chartColors: [AZUL2], showValue: true, dataLabelFormatCode: '#,##0.0', showLegend: false, valAxisLabelFontSize: 10, catAxisLabelFontSize: 12, valGridLine: { color: 'E1E0D9', size: 0.5 } });
    vinetas(s, [...gv.hipotesis.filter((h) => h.sustento === 'COMPROBADA').slice(0, 4).map((h) => `${h.titulo} (comprobada)`), `Causa raíz: ${gv.cincoPorques.causaRaiz}`], 7.1, 1.7, 5.8, 5.1, 13);
  }
  // 5 · Inventario
  if (gk && dk) {
    const s = nueva('El inventario necesita orden antes de automatizar', 'El Kardex no cuadra: primero conciliar, luego reponer con políticas');
    kpi(s, 0.5, 1.7, 2.95, 'Saldos que no cuadran', N(gk.conciliacion.saldosNoCuadran), `${N(gk.conciliacion.bloquesDescuadrados)} bloques descuadrados`, ROJO);
    kpi(s, 3.6, 1.7, 2.95, 'Registros con stock negativo', N(gk.conciliacion.stockNegativo), `${N(gk.conciliacion.productosNegativo)} productos`, ROJO);
    kpi(s, 6.7, 1.7, 2.95, 'Productos sin salidas', N(dk.sinSalidas.length), 'riesgo de obsolescencia');
    kpi(s, 9.8, 1.7, 3.0, 'Cobertura > 180 días', N(dk.coberturaMayor180), 'capital inmovilizado');
    vinetas(s, [`${N(dk.productos)} productos, ${dk.meses.length} meses de movimientos; ${N(dk.patrones.INTERMITENTE ?? 0)} con demanda intermitente (requieren Croston/SBA/TSB).`,
      ...(pr ? [`Estado frente a la política propuesta: ${Object.entries(pr.resumenEstados).map(([k, v]) => `${k.replace(/_/g, ' ').toLowerCase()} ${v}`).join(' · ')}.`] : []),
      'Recomendación: conciliación semanal y conteo cíclico de clase A; luego políticas (s,Q), (R,S) y mín-máx por clase y patrón.'], 0.5, 3.5, 12.3, 3.3);
  }
  // 6 · Pronóstico
  if (tv && pv) {
    const s = nueva('¿Qué pasará en los próximos 6 meses?', `Ventas ${mes(tv.horizonte[0])}–${mes(tv.horizonte.at(-1)!)}: ${M(tv.total.p50)} (80 %: ${M(tv.total.p10)} – ${M(tv.total.p90)})`);
    const h = tv.historia.slice(-24), lab = [...h.map((x) => mes(x.periodo)), ...tv.horizonte.map(mes)];
    const nul = (n: number) => new Array(n).fill(null);
    s.addChart(p.ChartType.line, [
      { name: 'Real', labels: lab, values: [...h.map((x) => +(x.valor / 1e6).toFixed(2)), ...nul(6)] },
      { name: 'P10', labels: lab, values: [...nul(h.length), ...tv.porMes.map((b) => +(b.p10 / 1e6).toFixed(2))] },
      { name: 'P50 (proyección)', labels: lab, values: [...nul(h.length - 1), +(h.at(-1)!.valor / 1e6).toFixed(2), ...tv.porMes.map((b) => +(b.p50 / 1e6).toFixed(2))] },
      { name: 'P90', labels: lab, values: [...nul(h.length), ...tv.porMes.map((b) => +(b.p90 / 1e6).toFixed(2))] }] as never,
      { x: 0.5, y: 1.6, w: 8.4, h: 5.3, chartColors: [AZUL, 'A9CCF5', AZUL2, 'A9CCF5'], lineSize: 2, lineDataSymbol: 'none', showLegend: true, legendPos: 't', valAxisLabelFormatCode: '#,##0', catAxisLabelFontSize: 9, catAxisLabelFrequency: '3', valAxisMinVal: 0 });
    vinetas(s, [`Modelo ${tv.modelo}, elegido entre ${tv.evaluacion.filter((e) => e.valido).length} por menor error en backtesting.`,
      `P(utilidad de 6 meses < 0): ${fmtPct(pv.probabilidades.utilidad6mNegativa, 1)}.`, `P(ventas menores que los últimos 6 meses): ${fmtPct(pv.probabilidades.ventas6mMenorQueUltimos6m, 0)}.`,
      'No se espera una recuperación espontánea: se requieren acciones.'], 9.2, 1.8, 3.7, 5.0, 13);
  }
  // 7 · Escenarios
  if (sm?.ventas) {
    const b = sm.ventas.escenarios.find((e) => e.escenario === 'Base')!;
    const s = nueva('Escenarios de riesgo (Monte Carlo)', `Escenario base: utilidad de 6 meses ${M(b.utilidad6m.p50)}; probabilidad de pérdida ${fmtPct(b.probUtilidadNegativa, 1)}`);
    tabla(s, ['Escenario', 'Ventas 6m (P50)', 'Utilidad 6m (P50)', 'Rango P5–P95', 'P(pérdida)'], sm.ventas.escenarios.map((e) => [e.escenario, M(e.ventas6m.p50), M(e.utilidad6m.p50), `${M(e.utilidad6m.p5)} – ${M(e.utilidad6m.p95)}`, fmtPct(e.probUtilidadNegativa, 1)]), 0.5, 1.7, 12.3, [2.4, 2.3, 2.3, 3.3, 2.0], 13);
    if (sm.inventario) tabla(s, ['Inventario clase A', ...sm.inventario.escenarios.map((e) => e.escenario)], [['Fill rate', ...sm.inventario.escenarios.map((e) => fmtPct(e.fillRate.media, 1))], ['P(quiebre por producto)', ...sm.inventario.escenarios.map((e) => fmtPct(e.probQuiebreProducto, 1))]], 0.5, 4.2, 12.3, undefined, 13);
    const t = [...sm.ventas.tornado].sort((a, c) => Math.abs(c.alto - c.bajo) - Math.abs(a.alto - a.bajo))[0];
    s.addText(`Variable más sensible: ${t.factor} (utilidad de ${M(t.bajo)} a ${M(t.alto)}). ${N(sm.iteraciones)} iteraciones, semilla ${sm.semilla}.`, { x: 0.5, y: 6.2, w: 12.3, h: 0.6, fontSize: 13, color: GRIS, fontFace: F, italic: true });
  }
  // 8 · Recomendaciones
  if (pr) {
    const s = nueva('Recomendaciones priorizadas', 'Cada acción tiene evidencia, responsable, plazo y KPI de seguimiento');
    const rs = [...pr.recomendaciones].sort((a, b) => a.prioridad - b.prioridad).slice(0, 7);
    tabla(s, ['#', 'Recomendación', 'Responsable', 'Plazo', 'Impacto central'], rs.map((r) => [`P${r.prioridad}`, r.titulo, r.responsable, r.plazo, r.impacto.central == null ? '—' : r.unidad === 'S/' ? `${M(r.impacto.central)}/año` : `${N(r.impacto.central)} unid. eq.`]), 0.5, 1.6, 12.3, [0.6, 5.6, 2.9, 1.3, 1.9], 12);
  }
  // 9 · Impacto
  if (pr) {
    const c = pr.caso;
    const s = nueva('Impacto económico esperado', `Beneficio recurrente de ${M(c.recurrente.conservador)} a ${M(c.recurrente.favorable)} por año (central ${M(c.recurrente.central)})`);
    kpi(s, 0.5, 1.7, 3.9, 'Conservador (10 % de recuperación)', M(c.recurrente.conservador), 'beneficio anual', VERDE);
    kpi(s, 4.7, 1.7, 3.9, 'Central (25 %)', M(c.recurrente.central), 'beneficio anual', VERDE);
    kpi(s, 8.9, 1.7, 3.9, 'Favorable (40 %)', M(c.recurrente.favorable), 'beneficio anual', VERDE);
    const costos = [c.costoOperacion, 250000, 500000, 1000000].filter((x, i, a) => a.indexOf(x) === i);
    tabla(s, ['Costo anual de operación (SUPUESTO)', 'Beneficio neto central', 'ROI', 'Payback'], costos.map((co) => [`S/ ${N(co)}`, M(c.recurrente.central - co), `${N((c.recurrente.central - co) / co, 1)} ×`, `${N((co / c.recurrente.central) * 12, 1)} meses`]), 0.5, 3.5, 12.3, undefined, 13);
    s.addText('Rangos, no promesas: dependen de la ejecución y de supuestos editables en el sistema. Los impactos del Kardex se valorizan al ingresar su costo unitario real.', { x: 0.5, y: 6.1, w: 12.3, h: 0.6, fontSize: 12, color: GRIS, italic: true, fontFace: F });
  }
  // 10 · Plan
  if (pr) {
    const s = nueva('Plan de implementación (6 meses)', 'Primero ordenar la información; luego rentabilidad y reposición');
    const fase = (pl: string) => (/inmediat|semana/i.test(pl) ? 0 : /0.3|1.3/.test(pl) ? 1 : 2);
    const fases = ['Fase 1 · Semanas 1–4', 'Fase 2 · Meses 1–3', 'Fase 3 · Meses 3–6'];
    fases.forEach((f, i) => {
      const x = 0.5 + i * 4.15;
      s.addShape(p.ShapeType.rect, { x, y: 1.65, w: 3.95, h: 0.55, fill: { color: [AZUL, AZUL2, '1C9A8A'][i] } });
      s.addText(f, { x, y: 1.65, w: 3.95, h: 0.55, fontSize: 15, bold: true, color: 'FFFFFF', align: 'center', fontFace: F });
      vinetas(s, pr.recomendaciones.filter((r) => fase(r.plazo) === i).map((r) => `${r.titulo} — ${r.responsable}. KPI: ${r.kpi}`), x, 2.35, 3.95, 4.5, 12);
    });
  }
  // 11 · Decisiones
  {
    const s = nueva('Decisiones que se solicitan a la dirección', 'Aprobar el plan y asignar responsables esta semana');
    vinetas(s, ['Aprobar la conciliación del Kardex y el conteo cíclico de clase A (Jefatura de Almacén + Contabilidad).',
      'Autorizar la revisión de precio, costo y continuidad de los SKU con mayor pérdida (Comercial + Finanzas).',
      'Fijar metas de margen por región y revisarlas mensualmente en un comité S&OP.',
      'Definir el costo real de operación de la solución y el costo unitario del inventario para cerrar el caso económico.',
      ...(meta.aportes.trim() ? [`Aportes del usuario: ${meta.aportes.trim().slice(0, 300)}`] : [])], 0.5, 1.7, 12.3, 5.0, 16);
  }
  // 12 · Supuestos y trazabilidad
  {
    const s = nueva('Supuestos, método y trazabilidad', 'Todas las cifras provienen del motor analítico; ninguna fue escrita a mano');
    vinetas(s, ['Pronóstico: 9 modelos con backtesting de origen móvil, selección por MASE e intervalos por bootstrap (10 000 trayectorias).',
      'Prescriptivo: stock de seguridad con variabilidad de demanda y plazo, EOQ, políticas por ABC y patrón de demanda.',
      'Simulación: Monte Carlo reproducible (semilla fija) con escenarios pesimista, base, optimista y personalizado.',
      'SUPUESTOS: plazo de suministro 15 ± 5 días; costo unitario del Kardex = 1 (normalizado); costo de operación editable.',
      'Sin búsqueda web: la IA solo redacta con cifras verificadas por el Evaluador.'], 0.5, 1.7, 7.4, 5.0, 13);
    tabla(s, ['Skill', 'Estado', 'run_id'], [R.dv, R.gv, R.pv, R.dk, R.gk, R.pk, R.pr, R.sm].filter(Boolean).map((r) => [r!.skill, r!.status, r!.run_id.slice(0, 8)]), 8.1, 1.7, 4.7, [2.3, 1.2, 1.2], 10);
  }
  void nSl;
  return (await p.write({ outputType: 'uint8array' })) as Uint8Array;
}
