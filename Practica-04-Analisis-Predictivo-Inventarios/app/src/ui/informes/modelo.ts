/**
 * Modelo de contenido de los informes (skill redactar_informe, modo determinístico):
 * UN solo contenido → tres salidas (Word, PDF y PowerPoint). Todas las cifras salen de los resultados de las skills;
 * los textos distinguen [E] evidencia, [D] diagnóstico por verificar y [S] solución propuesta.
 */
import type { Resultados } from '../../core/agentes/resultados';
import { fmtMillones, fmtNum, fmtPct } from '../../core/util/util';
import { renderizarPNG, opAbanico, opBarras, opCascada, opHistograma, opTornado } from '../graficos';

export type Bloque =
  | { t: 'h1' | 'h2' | 'h3'; texto: string }
  | { t: 'p'; texto: string; estilo?: 'nota' | 'destacado' }
  | { t: 'vinetas'; items: string[] }
  | { t: 'tabla'; cols: string[]; filas: string[][]; anchos?: number[]; num?: number[] }
  | { t: 'imagen'; dataUrl: string; ancho: number; alto: number; pie: string }
  | { t: 'kpis'; items: { et: string; v: string; d: string }[] }
  | { t: 'ecuaciones'; items: { nombre: string; tex: string; nota?: string }[] }
  | { t: 'salto' };
export interface Documento {
  tipo: 'tecnico' | 'ejecutivo'; titulo: string; subtitulo: string; version: number; fecha: string;
  portada: [string, string][]; bloques: Bloque[]; resumen: Record<string, [string, number, string]>;
}

const MC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mes = (p: string) => `${MC[+p.slice(5, 7) - 1]} ${p.slice(2, 4)}`;
const vr = (x: number) => `${x >= 0 ? '+' : ''}${fmtNum(x * 100, 1)} %`;
const M = fmtMillones;
const N = (x: number, d = 0) => fmtNum(x, d);
const ALUMNO = 'Dionicio Achachagua Cesar Alonso';

/** Fórmulas en notación LaTeX: en Word se convierten en ecuaciones nativas; en el PDF, en imagen tipografiada. */
const FORMULAS_INVENTARIO = [
  { nombre: 'Stock de seguridad (variabilidad de demanda y de plazo)', tex: 'SS = z \\cdot \\sqrt{L \\cdot \\sigma_{d}^{2} + \\bar{d}^{2} \\cdot \\sigma_{L}^{2}}', nota: 'Donde $z$ es el cuantil normal del nivel de servicio; $L$, el plazo de suministro (días); $\\sigma_{d}$, la desviación de la demanda diaria; $\\bar{d}$, la demanda diaria media, y $\\sigma_{L}$, la desviación del plazo.' },
  { nombre: 'Punto de reorden', tex: 'ROP = \\bar{d} \\cdot L + SS' },
  { nombre: 'Lote económico de compra', tex: 'EOQ = \\sqrt{\\frac{2 \\cdot D \\cdot S}{H}}', nota: 'Donde $D$ es la demanda anual; $S$, el costo por orden, y $H$, el costo anual de mantener una unidad.' },
  { nombre: 'Nivel objetivo (revisión periódica)', tex: 'S = \\mu_{L+R} + z \\cdot \\sigma_{L+R}', nota: 'Donde $\\mu_{L+R}$ y $\\sigma_{L+R}$ son la media y la desviación de la demanda durante el plazo más el periodo de revisión.' },
  { nombre: 'Cantidad a pedir', tex: 'Q = \\max\\left(0,\\ S - IP\\right)', nota: 'Donde $IP$ es la posición de inventario (stock más pedidos en tránsito).' },
];
const FORMULAS_PRONOSTICO = [
  { nombre: 'Error escalado absoluto medio (criterio de selección del modelo)', tex: 'MASE = \\frac{MAE_{modelo}}{MAE_{ingenuo}}', nota: 'Si $MASE < 1$, el modelo supera al pronóstico ingenuo. No se usa MAPE porque hay meses con valores cercanos a cero.' },
  { nombre: 'Suavizamiento exponencial simple (modelo elegido para ventas)', tex: '\\bar{y}_{t+1} = \\alpha \\cdot y_{t} + (1 - \\alpha) \\cdot \\bar{y}_{t}' },
];
const FORMULAS_IMPACTO = [
  { nombre: 'Retorno sobre la inversión', tex: 'ROI = \\frac{B_{rec} - C_{op}}{C_{op}}', nota: 'Donde $B_{rec}$ es el beneficio recurrente anual y $C_{op}$, el costo anual de operación de la solución (SUPUESTO editable).' },
  { nombre: 'Periodo de recuperación', tex: 'Payback = \\frac{C_{op}}{B_{rec}} \\times 12 \\text{ meses}' },
];

export interface Contexto { R: Resultados; parametros: { clave: string; valor: string; unidad: string; descripcion: string; es_supuesto: number }[]; datasets: { tipo: string; archivo: string; filas_validas: number; fecha_min: string; fecha_max: string; ultimo_mes_cerrado: string }[];
  calidad: { tipo: string; porSeveridad: Record<string, number> }[]; aportes: string; version: number; fecha: string; historial: { version: number; generado_en: string; cambios: string }[] }

/** Cifras clave de la versión (se comparan entre versiones para el control de cambios). */
export function resumenCifras(R: Resultados): Record<string, [string, number, string]> {
  const r: Record<string, [string, number, string]> = {};
  const d = R.dv?.result, pv = R.pv?.result.series.find((s) => s.serie === 'ventas_soles' && s.nivel === 'total'), pr = R.pr?.result;
  if (d) { r.ventas12 = ['Ventas 12 meses', d.kpi12.ventas, M(d.kpi12.ventas)]; r.utilidad12 = ['Utilidad operativa 12 meses', d.kpi12.utilidad, M(d.kpi12.utilidad)]; r.margen12 = ['Margen operativo 12 meses', d.kpi12.margen, fmtPct(d.kpi12.margen)]; r.skusPerdida = ['SKU con utilidad negativa', d.skusConPerdida, N(d.skusConPerdida)]; }
  if (pv) { r.ventas6m = ['Ventas proyectadas 6 meses (P50)', pv.total.p50, M(pv.total.p50)]; r.probPerdida = ['P(utilidad 6 meses < 0)', R.pv!.result.probabilidades.utilidad6mNegativa, fmtPct(R.pv!.result.probabilidades.utilidad6mNegativa, 1)]; }
  if (pr) { r.benefCentral = ['Beneficio recurrente anual (central)', pr.caso.recurrente.central, M(pr.caso.recurrente.central)]; r.recs = ['Recomendaciones', pr.recomendaciones.length, N(pr.recomendaciones.length)]; r.costoOp = ['Costo anual de operación (SUPUESTO)', pr.caso.costoOperacion, `S/ ${N(pr.caso.costoOperacion)}`]; }
  if (R.gk) r.saldosNoCuadran = ['Saldos del Kardex que no cuadran', R.gk.result.conciliacion.saldosNoCuadran, N(R.gk.result.conciliacion.saldosNoCuadran)];
  if (R.sm?.result.inventario) { const b = R.sm.result.inventario.escenarios.find((e) => e.escenario === 'Base')!; r.fillBase = ['Fill rate clase A (base)', b.fillRate.media, fmtPct(b.fillRate.media, 1)]; }
  return r;
}

/** Gráficos del informe (PNG, paleta clara). */
export function graficosInforme(R: Resultados) {
  const g: Record<string, { dataUrl: string; pie: string }> = {};
  const MMf = (v: number) => `S/ ${fmtNum(v / 1e6, 1)} M`;
  const pv = R.pv?.result.series.find((s) => s.serie === 'ventas_soles' && s.nivel === 'total');
  if (pv) g.ventas = { dataUrl: renderizarPNG(opAbanico(pv.historia, pv.horizonte, pv.porMes, MMf)), pie: `Ventas mensuales (últimos 36 meses) y proyección ${mes(pv.horizonte[0])}–${mes(pv.horizonte.at(-1)!)} con intervalos del 80 % (P10–P90) y 95 %. Modelo ${pv.modelo} elegido por backtesting.` };
  if (R.dv) { const ds = [...R.dv.result.departamentos].sort((a, b) => a.margen - b.margen);
    g.deptos = { dataUrl: renderizarPNG(opBarras(ds.map((d) => d.departamento), [{ nombre: 'Margen', datos: ds.map((d) => d.margen) }], (x) => `${fmtNum(x * 100, 2)} %`, { horizontal: true, etiquetas: true }), 1000, 420), pie: 'Margen operativo por departamento (histórico completo).' }; }
  if (R.gv) { const p = R.gv.result.pvm;
    g.pvm = { dataUrl: renderizarPNG(opCascada([{ nombre: 'Precio', valor: p.precio }, { nombre: 'Volumen', valor: p.volumen }, { nombre: 'Mezcla', valor: p.mezcla }, { nombre: 'SKU nuevos', valor: p.nuevos }, { nombre: 'SKU perdidos', valor: p.perdidos }, { nombre: 'Variación total', valor: p.total, total: true }], MMf), 1000, 420),
      pie: `Descomposición precio-volumen-mezcla de la variación de ventas (${R.gv.result.ventana.anterior} → ${R.gv.result.ventana.actual}).` }; }
  if (R.pk) { const t = R.pk.result.total; g.kardex = { dataUrl: renderizarPNG(opAbanico(t.historia, t.horizonte, t.porMes, (x) => fmtNum(x, 0), 24), 1000, 420), pie: `Salidas mensuales del Kardex (unid.) y proyección ${mes(t.horizonte[0])}–${mes(t.horizonte.at(-1)!)}; modelo ${t.modelo}.` }; }
  const vb = R.sm?.result.ventas?.escenarios.find((e) => e.escenario === 'Base');
  if (vb) g.histo = { dataUrl: renderizarPNG(opHistograma(vb.histogramaUtilidad, (x) => `${fmtNum(x / 1e6, 1)} M`, [{ nombre: 'P5', valor: vb.utilidad6m.p5 }, { nombre: 'P50', valor: vb.utilidad6m.p50 }, { nombre: 'P95', valor: vb.utilidad6m.p95 }]), 1000, 420), pie: `Distribución simulada de la utilidad de 6 meses (escenario base, ${fmtNum(vb.iteraciones)} iteraciones) y probabilidad acumulada.` };
  if (R.sm?.result.ventas) g.tornado = { dataUrl: renderizarPNG(opTornado(R.sm.result.ventas.tornado, MMf), 1000, 360), pie: 'Sensibilidad (tornado) de la utilidad de 6 meses P50 a cada factor.' };
  return g;
}

const img = (g: { dataUrl: string; pie: string } | undefined, alto = 0.46): Bloque[] => (g ? [{ t: 'imagen', dataUrl: g.dataUrl, ancho: 1000, alto: alto * 1000, pie: g.pie }] : []);

/** Plan de implementación derivado de los plazos de las recomendaciones. */
function plan(R: Resultados): string[][] {
  const rs = [...(R.pr?.result.recomendaciones ?? [])].sort((a, b) => a.prioridad - b.prioridad);
  const fase = (p: string) => (/inmediat|semana/i.test(p) ? 'Fase 1 · Semanas 1–4' : /0.3|1.3/.test(p) ? 'Fase 2 · Meses 1–3' : 'Fase 3 · Meses 3–6');
  return rs.map((r) => [fase(r.plazo), r.titulo, r.responsable, r.plazo, r.kpi]).sort((a, b) => a[0].localeCompare(b[0]));
}

export function construirDocumento(tipo: 'tecnico' | 'ejecutivo', c: Contexto, g: ReturnType<typeof graficosInforme>): Documento {
  const { R } = c, B: Bloque[] = [];
  const d = R.dv?.result, gv = R.gv?.result, pv = R.pv?.result, dk = R.dk?.result, gk = R.gk?.result, pk = R.pk?.result, pr = R.pr?.result, sm = R.sm?.result;
  const tv = pv?.series.find((s) => s.serie === 'ventas_soles' && s.nivel === 'total'), tu = pv?.series.find((s) => s.serie === 'utilidad' && s.nivel === 'total');
  const ej = tipo === 'ejecutivo';
  let n = 0; const H1 = (t: string) => B.push({ t: 'h1', texto: `${++n}. ${t}` });

  // ---------------- Resumen ejecutivo ----------------
  H1('Resumen ejecutivo');
  if (d) B.push({ t: 'kpis', items: [
    { et: 'Ventas 12 meses', v: M(d.kpi12.ventas), d: `${vr(d.variacion.ventas)} vs. 12 meses previos` },
    { et: 'Utilidad operativa 12 meses', v: M(d.kpi12.utilidad), d: vr(d.variacion.utilidad) },
    { et: 'Margen operativo', v: fmtPct(d.kpi12.margen), d: `antes ${fmtPct(d.kpi12prev.margen)}` },
    ...(tv ? [{ et: 'Ventas proyectadas 6 meses (P50)', v: M(tv.total.p50), d: `80 %: ${M(tv.total.p10)} – ${M(tv.total.p90)}` }] : []) ] });
  const hall: string[] = [];
  if (d) hall.push(`[E] En los últimos 12 meses cerrados (${mes(d.meses.at(-12)!)}–${mes(d.cutoff)}) las ventas fueron ${M(d.kpi12.ventas)} (${vr(d.variacion.ventas)}) y la utilidad operativa ${M(d.kpi12.utilidad)} (${vr(d.variacion.utilidad)}); el margen cayó de ${fmtPct(d.kpi12prev.margen)} a ${fmtPct(d.kpi12.margen)}.`);
  if (gv) hall.push(`[E] La caída de ventas se explica por volumen (${M(gv.pvm.volumen)}), no por precio (${M(gv.pvm.precio)}); la caída de utilidad se explica principalmente por el margen (${M(gv.utilidad.efectoMargen)}).`);
  if (d) hall.push(`[E] ${N(d.skusConPerdida)} de ${N(d.skus)} productos (${fmtPct(d.skusConPerdida / d.skus, 0)}) acumulan utilidad negativa.`);
  if (gk) hall.push(`[E] El Kardex no es confiable sin conciliación: ${N(gk.conciliacion.saldosNoCuadran)} saldos no cuadran y hay ${N(gk.conciliacion.stockNegativo)} registros con stock negativo.`);
  if (tv && pv) hall.push(`[E] Pronóstico ${mes(tv.horizonte[0])}–${mes(tv.horizonte.at(-1)!)}: ventas ${M(tv.total.p50)} (80 %: ${M(tv.total.p10)} – ${M(tv.total.p90)}); probabilidad de utilidad negativa en 6 meses: ${fmtPct(pv.probabilidades.utilidad6mNegativa, 1)}.`);
  if (pr) hall.push(`[S] ${pr.recomendaciones.length} recomendaciones priorizadas con beneficio recurrente estimado de ${M(pr.caso.recurrente.conservador)} / ${M(pr.caso.recurrente.central)} / ${M(pr.caso.recurrente.favorable)} por año (conservador / central / favorable).`);
  B.push({ t: 'vinetas', items: hall });
  B.push({ t: 'p', estilo: 'nota', texto: 'Convención: [E] evidencia de los datos · [D] diagnóstico por verificar · [S] solución propuesta. Todas las cifras provienen del motor analítico del sistema (sin búsqueda web ni cifras inventadas) y se identifican por su run_id en el anexo de trazabilidad.' });

  // ---------------- Datos y alcance ----------------
  H1(ej ? 'Alcance y datos' : 'Datos, alcance y calidad');
  B.push({ t: 'tabla', cols: ['Dataset', 'Archivo', 'Registros válidos', 'Periodo', 'Último mes cerrado'], num: [2],
    filas: c.datasets.map((x) => [x.tipo === 'ventas' ? 'Ventas y utilidad' : 'Kardex de almacén', x.archivo, N(x.filas_validas), `${x.fecha_min} a ${x.fecha_max}`, x.ultimo_mes_cerrado]) });
  if (!ej) {
    B.push({ t: 'p', texto: 'La ingesta aplica reglas de calidad (V00–V12 para ventas y K01–K11 para el Kardex). Los meses incompletos se excluyen del pronóstico (abril 2019 en ventas; junio 2010 en el Kardex).' });
    B.push({ t: 'tabla', cols: ['Dataset', 'Críticas', 'Altas', 'Medias', 'Bajas', 'Informativas'], num: [1, 2, 3, 4, 5], filas: c.calidad.map((q) => [q.tipo, ...['CRITICA', 'ALTA', 'MEDIA', 'BAJA', 'INFO'].map((s) => N(q.porSeveridad[s] ?? 0))]) });
  }

  // ---------------- Descriptivo ----------------
  if (d) {
    H1('Análisis descriptivo: ¿qué pasó?');
    B.push(...img(g.ventas));
    B.push({ t: 'tabla', cols: ['Indicador', '12 meses previos', 'Últimos 12 meses', 'Variación'], num: [1, 2, 3], filas: [
      ['Ventas', M(d.kpi12prev.ventas), M(d.kpi12.ventas), vr(d.variacion.ventas)], ['Utilidad operativa', M(d.kpi12prev.utilidad), M(d.kpi12.utilidad), vr(d.variacion.utilidad)],
      ['Margen operativo', fmtPct(d.kpi12prev.margen), fmtPct(d.kpi12.margen), `${fmtNum(d.variacion.margenPp, 2)} pp`], ['Transacciones', N(d.kpi12prev.transacciones), N(d.kpi12.transacciones), vr(d.kpi12.transacciones / d.kpi12prev.transacciones - 1)],
      ['Clientes', N(d.kpi12prev.clientes), N(d.kpi12.clientes), vr(d.kpi12.clientes / d.kpi12prev.clientes - 1)]] });
    B.push(...img(g.deptos, 0.42));
    if (!ej) {
      B.push({ t: 'ecuaciones', items: [{ nombre: 'Margen operativo', tex: '\\text{Margen} = \\frac{\\text{Utilidad operativa}}{\\text{Ventas}}' }] });
      B.push({ t: 'tabla', cols: ['Departamento', 'Ventas', 'Participación', 'Utilidad', 'Margen'], num: [1, 2, 3, 4], filas: d.departamentos.map((x) => [x.departamento, M(x.soles), fmtPct(x.participacion, 1), M(x.utilidad, 2), fmtPct(x.margen)]) });
      B.push({ t: 'p', texto: `Clasificación de productos: ABC por ventas A = ${N(d.abc.A ?? 0)}, B = ${N(d.abc.B ?? 0)}, C = ${N(d.abc.C ?? 0)} SKU; XYZ por variabilidad X = ${N(d.xyz.X ?? 0)}, Y = ${N(d.xyz.Y ?? 0)}, Z = ${N(d.xyz.Z ?? 0)}. Los 20 SKU más vendidos concentran ${fmtPct(d.concentracionTop20Sku, 1)} de las ventas.` });
      B.push({ t: 'tabla', cols: ['SKU con mayor pérdida', 'Ventas', 'Utilidad', 'Margen'], num: [1, 2, 3], filas: d.topPerdidas.slice(0, 10).map((x) => [x.sku, M(x.soles, 2), M(x.utilidad, 2), fmtPct(x.margen)]) });
    }
  }
  if (dk) {
    if (!d) H1('Análisis descriptivo: ¿qué pasó?');
    B.push({ t: 'h2', texto: 'Inventario (Kardex)' });
    B.push({ t: 'p', texto: `${N(dk.productos)} productos en ${dk.meses.length} meses (${mes(dk.meses[0])}–${mes(dk.meses.at(-1)!)}). Salidas totales ${N(dk.totales.salidas)} unid. (${fmtPct(dk.totales.salConsumo / (dk.totales.salidas || 1), 0)} por consumo de producción). ${N(dk.sinSalidas.length)} productos sin salidas y ${N(dk.coberturaMayor180)} con cobertura mayor a 180 días. Patrones de demanda: ${Object.entries(dk.patrones).map(([k, v]) => `${k.replace(/_/g, ' ').toLowerCase()} ${v}`).join(', ')}.` });
  }

  // ---------------- Diagnóstico ----------------
  if (gv || gk) {
    H1('Análisis diagnóstico: ¿por qué pasó?');
    if (gv) {
      B.push(...img(g.pvm, 0.42));
      B.push({ t: 'p', texto: `[E] Variación de ventas ${M(gv.pvm.total)} = precio ${M(gv.pvm.precio)} + volumen ${M(gv.pvm.volumen)} + mezcla ${M(gv.pvm.mezcla)} + SKU nuevos ${M(gv.pvm.nuevos)} + SKU perdidos ${M(gv.pvm.perdidos)}. En la utilidad, el efecto margen (${M(gv.utilidad.efectoMargen)}) supera al efecto volumen (${M(gv.utilidad.efectoVolumen)}).` });
    }
    const hips = [...(gv?.hipotesis ?? []), ...(gk?.hipotesis ?? [])].filter((h) => !ej || h.sustento === 'COMPROBADA' || h.sustento === 'ASOCIATIVA');
    B.push({ t: 'tabla', cols: ['Prob.', 'Problema crítico / hipótesis', 'Categoría 6M', 'Evidencia', 'Sustento'], anchos: [6, 28, 12, 38, 16],
      filas: hips.map((h) => [h.problemaId ? `#${h.problemaId}` : '—', h.titulo, h.categoria, h.favor, h.sustento.replace('_', ' ')]) });
    if (gv && !ej) {
      B.push({ t: 'h2', texto: 'Cinco porqués' });
      B.push({ t: 'p', texto: `Problema: ${gv.cincoPorques.problema}` });
      B.push({ t: 'vinetas', items: gv.cincoPorques.porques.map((p, i) => `¿Por qué? (${i + 1}) ${p}`) });
      B.push({ t: 'p', estilo: 'destacado', texto: `Causa raíz: ${gv.cincoPorques.causaRaiz}` });
      B.push({ t: 'h2', texto: 'Diagrama de Ishikawa (6M)' });
      B.push({ t: 'tabla', cols: ['Categoría', 'Causas con evidencia'], anchos: [22, 78], filas: Object.entries(gv.ishikawa).map(([k, v]) => [k, v.length ? v.join('; ') : 'sin causas con evidencia']) });
    }
  }

  // ---------------- Predictivo ----------------
  if (tv || pk) {
    H1('Análisis predictivo: ¿qué pasará en los próximos 6 meses?');
    if (tv && pv) {
      B.push({ t: 'tabla', cols: ['Mes', 'P10', 'P50', 'P90'], num: [1, 2, 3], filas: [...tv.horizonte.map((h, i) => [mes(h), M(tv.porMes[i].p10), M(tv.porMes[i].p50), M(tv.porMes[i].p90)]), ['Total 6 meses', M(tv.total.p10), M(tv.total.p50), M(tv.total.p90)]] });
      B.push({ t: 'p', texto: `[E] Modelo ${tv.modelo} elegido entre ${tv.evaluacion.filter((e) => e.valido).length} candidatos por menor MASE en backtesting con origen móvil (MASE ${fmtNum(tv.evaluacion.find((e) => e.modelo === tv.modelo)?.maseProm ?? NaN, 3)}; cobertura real del intervalo 80 %: ${fmtPct(tv.calibracion.cobertura80, 0)}). Intervalos por bootstrap de residuos con ${N(pv.trayectorias)} trayectorias (semilla ${pv.semilla}).${tu ? ` Utilidad operativa proyectada: ${M(tu.total.p50)} (80 %: ${M(tu.total.p10)} – ${M(tu.total.p90)}).` : ''}` });
      if (!ej) B.push({ t: 'ecuaciones', items: FORMULAS_PRONOSTICO });
      if (!ej) B.push({ t: 'tabla', cols: ['Modelo', 'MASE promedio'], num: [1], filas: tv.evaluacion.filter((e) => e.valido).sort((a, b) => a.maseProm - b.maseProm).map((e) => [e.modelo + (e.modelo === tv.modelo ? ' (elegido)' : ''), fmtNum(e.maseProm, 3)]) });
    }
    if (pk) {
      B.push(...img(g.kardex, 0.42));
      if (!ej) B.push({ t: 'p', texto: `Kardex: salidas proyectadas ${N(pk.total.total.p50)} unid. en 6 meses (80 %: ${N(pk.total.total.p10)} – ${N(pk.total.total.p90)}). Modelos por producto: ${Object.entries(pk.modelosElegidos).map(([k, v]) => `${k} ${v}`).join(', ')}.` });
    }
  }

  // ---------------- Prescriptivo ----------------
  if (pr) {
    H1(ej ? 'Recomendaciones priorizadas' : 'Análisis prescriptivo: propuestas para los problemas críticos');
    B.push({ t: 'tabla', cols: ['#', 'Recomendación', 'Acción', 'Responsable', 'Plazo', 'KPI'], anchos: [5, 22, 33, 15, 10, 15],
      filas: [...pr.recomendaciones].sort((a, b) => a.prioridad - b.prioridad).slice(0, ej ? 5 : 99).map((r) => [`P${r.prioridad}`, r.titulo, r.accion, r.responsable, r.plazo, r.kpi]) });
    if (!ej) {
      B.push({ t: 'p', texto: `Políticas de inventario asignadas: ${Object.entries(pr.resumenPoliticas).map(([k, v]) => `${k} ${v}`).join(', ')}. Estados: ${Object.entries(pr.resumenEstados).map(([k, v]) => `${k.replace(/_/g, ' ').toLowerCase()} ${v}`).join(', ')}. Las políticas se calculan con las siguientes fórmulas:` });
      B.push({ t: 'ecuaciones', items: FORMULAS_INVENTARIO });
      B.push({ t: 'tabla', cols: ['Mes', 'Unidades a comprar', 'Costo (unid. equivalentes)'], num: [1, 2], filas: pr.planTotal.porMes.map((m) => [mes(m.periodo), N(m.unidades), N(m.costo)]) });
    }
  }

  // ---------------- Simulación ----------------
  if (sm?.ventas || sm?.inventario) {
    H1('Simulación de escenarios (Monte Carlo)');
    if (sm.ventas) B.push({ t: 'tabla', cols: ['Escenario', 'Ventas 6m P50', 'Utilidad 6m P5', 'Utilidad 6m P50', 'Utilidad 6m P95', 'P(utilidad < 0)'], num: [1, 2, 3, 4, 5],
      filas: sm.ventas.escenarios.map((e) => [e.escenario, M(e.ventas6m.p50), M(e.utilidad6m.p5), M(e.utilidad6m.p50), M(e.utilidad6m.p95), fmtPct(e.probUtilidadNegativa, 1)]) });
    if (sm.inventario) B.push({ t: 'tabla', cols: ['Escenario (inventario clase A)', 'Fill rate', 'P(quiebre por producto)', 'Stock promedio P50'], num: [1, 2, 3], filas: sm.inventario.escenarios.map((e) => [e.escenario, fmtPct(e.fillRate.media, 1), fmtPct(e.probQuiebreProducto, 1), N(e.stockPromedio.p50)]) });
    if (!ej) { B.push(...img(g.histo, 0.42)); B.push(...img(g.tornado, 0.36)); B.push({ t: 'ecuaciones', items: [{ nombre: 'Nivel de servicio (fill rate)', tex: '\\text{Fill rate} = \\frac{\\text{unidades atendidas}}{\\text{unidades demandadas}}' }] }); }
    B.push({ t: 'p', estilo: 'nota', texto: `${N(sm.iteraciones)} iteraciones por escenario, semilla ${sm.semilla} (reproducible). Demanda diaria por bootstrap empírico; plazo de suministro normal truncado (SUPUESTO); ventas perdidas sin pedidos pendientes.` });
  }

  // ---------------- Plan e impacto ----------------
  if (pr) {
    H1('Plan de implementación');
    B.push({ t: 'tabla', cols: ['Fase', 'Acción', 'Responsable', 'Plazo', 'KPI de seguimiento'], anchos: [16, 30, 20, 12, 22], filas: plan(R) });
    H1('Impacto en los resultados de la empresa');
    const ca = pr.caso;
    B.push({ t: 'tabla', cols: ['Concepto', 'Conservador', 'Central', 'Favorable'], num: [1, 2, 3], filas: [
      ['Beneficio recurrente anual', M(ca.recurrente.conservador), M(ca.recurrente.central), M(ca.recurrente.favorable)],
      ['Liberación de caja (una vez)', M(ca.cajaUnaVez.conservador), M(ca.cajaUnaVez.central), M(ca.cajaUnaVez.favorable)],
      ['Beneficio neto anual (− costo de operación)', M(ca.beneficioNeto.conservador), M(ca.beneficioNeto.central), M(ca.beneficioNeto.favorable)]] });
    const costos = [ca.costoOperacion, 250000, 500000, 1000000].filter((x, i, a) => a.indexOf(x) === i);
    B.push({ t: 'ecuaciones', items: FORMULAS_IMPACTO });
    B.push({ t: 'p', texto: `El ROI depende del costo anual de operación de la solución, que es un SUPUESTO (S/ ${N(ca.costoOperacion)} en esta versión). Sensibilidad del ROI (escenario central):` });
    B.push({ t: 'tabla', cols: ['Costo anual de operación', 'Beneficio neto central', 'ROI', 'Payback'], num: [1, 2, 3], filas: costos.map((co) => [`S/ ${N(co)}`, M(ca.recurrente.central - co), `${fmtNum((ca.recurrente.central - co) / co, 1)} ×`, ca.recurrente.central > 0 ? `${fmtNum((co / ca.recurrente.central) * 12, 1)} meses` : '—']) });
    B.push({ t: 'p', estilo: 'nota', texto: 'Los impactos son rangos, no promesas: suponen recuperar 10 % / 25 % / 40 % de la pérdida de los SKU críticos y cerrar parte de la brecha de margen regional. Los impactos del Kardex se expresan en unidades equivalentes hasta ingresar el costo unitario real.' });
  }

  // ---------------- Conclusiones, supuestos, aportes ----------------
  H1('Conclusiones');
  const con: string[] = [];
  if (gv) con.push(`El problema principal es de rentabilidad, no de precio: la utilidad cae más que las ventas por la erosión del margen y por un surtido con ${N(d?.skusConPerdida ?? 0)} SKU que destruyen valor.`);
  if (gk) con.push('La información del almacén requiere conciliación antes de automatizar reposiciones; es la primera acción del plan.');
  if (tv) con.push(`El pronóstico no anticipa recuperación espontánea: las ventas de 6 meses se ubicarían alrededor de ${M(tv.total.p50)}, con un rango del 80 % entre ${M(tv.total.p10)} y ${M(tv.total.p90)}.`);
  if (pr) con.push('Las recomendaciones priorizadas atacan las causas comprobadas (surtido, margen regional, conciliación y políticas de reposición) con responsables, plazos y KPI medibles.');
  B.push({ t: 'vinetas', items: con });
  if (!ej) {
    H1('Supuestos y limitaciones');
    B.push({ t: 'tabla', cols: ['Parámetro', 'Valor', 'Unidad', 'Descripción'], anchos: [22, 12, 14, 52], filas: c.parametros.filter((p) => p.es_supuesto).map((p) => [p.clave, p.valor, p.unidad ?? '', p.descripcion]) });
    B.push({ t: 'vinetas', items: ['El Kardex no registra costos ni fechas de pedido: costo unitario y plazo de suministro son SUPUESTOS editables.', 'Las correlaciones son asociativas, no causales; las hipótesis «A verificar» requieren datos adicionales.', 'La historia del Kardex (17 meses) es corta: sus intervalos se calibraron empíricamente y su estado es PROVISIONAL.'] });
  }
  H1('Aportes del usuario');
  B.push(c.aportes.trim() ? { t: 'p', texto: c.aportes.trim() } : { t: 'p', estilo: 'nota', texto: '(Sin aportes registrados en esta versión. El usuario puede escribirlos en la pantalla «Informes y presentación».)' });
  if (c.historial.length || c.version > 1) {
    H1('Control de versiones');
    B.push({ t: 'tabla', cols: ['Versión', 'Fecha', 'Cambios respecto a la versión anterior'], anchos: [10, 18, 72], filas: c.historial.map((h) => [`v${h.version}`, h.generado_en.replace('T', ' '), h.cambios]) });
  }
  H1('Anexo: trazabilidad del Super Agente');
  B.push({ t: 'tabla', cols: ['Skill', 'Versión', 'run_id', 'Estado', 'Corte'], anchos: [22, 26, 34, 10, 8],
    filas: [R.dv, R.gv, R.pv, R.dk, R.gk, R.pk, R.pr, R.sm].filter(Boolean).map((r) => [r!.skill, r!.skill_version, r!.run_id, r!.status, r!.cutoff ?? '—']) });

  return {
    tipo, version: c.version, fecha: c.fecha, resumen: resumenCifras(R),
    titulo: ej ? 'Informe Ejecutivo de Gestión de Inventarios y Rentabilidad' : 'Informe Técnico de Análisis de Datos y Predictivo de Gestión de Inventarios',
    subtitulo: 'Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios · Super Agente IA',
    portada: [['Versión', `v${c.version}`], ['Fecha de generación', c.fecha.replace('T', ' ')], ['Elaborado con', 'Super Agente IA (motor determinístico + Evaluador)'], ['Alumno', ALUMNO], ['Código UNI', '20192589B'], ['Curso', 'GE803U · Sistemas Analíticos · UNI-FIIS']],
    bloques: B,
  };
}
