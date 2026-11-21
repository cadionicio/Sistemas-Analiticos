// Exportaciones empresariales desde UNA fotografía coherente (RN-24, §11.2, N03–N08, AK01–AK07): XLSX, DOCX y PPTX auténticos.
// Ninguna cifra se escribe a mano: todo sale del snapshot tomado al pulsar el botón. Sin corrida seleccionada no se inventan cifras.
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, WidthType, AlignmentType, ImageRun, Footer, Header, PageNumber, BorderStyle, ShadingType, VerticalAlign } from 'docx';
import PptxGenJS from 'pptxgenjs';
import type { Existencia, PedidoEstado } from './dominio';
import type { Indicador } from './kpi';
import type { ResultadoSim, ParametrosSim } from './simulacion';
import type { Evaluacion } from './economia';
import { fmtNum } from './util';

export const ETIQUETA = 'DATOS SINTÉTICOS — NutriDemo';
export interface Snapshot {
  runId: string; generadoEn: string; datasetId: string; datasetHash: string; build: string; modalidad: 'EXE' | 'HTML';
  existencias: Existencia[]; pedidos: PedidoEstado[];
  analitica?: {
    vista: 'ORIGINAL' | 'REEXPRESADA'; conocidoHasta: string | null; desde: string; hasta: string; filtros: string;
    indicadores: Indicador[]; serie: { periodo: string; num: number; den: number; otif: number | null; fill: number | null }[];
    pareto: { n: number; filas: { causa: string; n: number; pct: number; acumulado: number }[] }; causas: { analisis_id: string; hipotesis: string; estado: string; evidencias: number }[];
  };
  pronostico?: { corrida_id: string; serie: string; corte: string; metodo: string | null; metricas: Record<string, { mae: number | null; wape: number | null; n: number }> | null; prediccion: { semana: string; valor: number; p10: number | null; p90: number | null; tipo: string }[] } | null;
  simulacion?: { run_id: string; modelo: string; parametros: ParametrosSim; resultado: ResultadoSim; creada_en: string } | null;
  evaluacion?: { run_id: string; ev: Evaluacion; creada_en: string } | null;
  itinerarios?: { pedido_id: string; itinerario_id: string; estado: string; tramo: number; viaje: number; modo: string; origen: string; destino: string; servicio_id: string; kg: number; etapa_estado: string; final: boolean }[];
  aceptado?: { pedido_id: string; solicitado_kg: number; aceptado_kg: number }[];
  costos?: { servicio_id: string; total_cent: number; fijo_cent: number; lineas: { etapa_id: string; pedido_id: string; kg: number; fijo_cent: number; variable_cent: number }[]; no_asignado_cent: number }[];
  recomendaciones?: { regla: string; entidad_id: string; estado: string; valores: string; alternativa: string }[];
}
/** Control de avance/cancelación: si se cancela, `paso` lanza un error y NO se descarga un archivo incompleto (N08, AK06). */
export interface Control { paso: (texto: string) => Promise<void> }
export class ExportacionCancelada extends Error { constructor() { super('Exportación cancelada: no se generó ningún archivo.'); } }
const sinControl: Control = { paso: async () => {} };

const vistaRotulo = (s: Snapshot) => !s.analitica ? 'Sin analítica' : s.analitica.vista === 'ORIGINAL' ? `Vista ORIGINAL (lo conocido hasta ${s.analitica.conocidoHasta?.slice(0, 10)})` : 'Vista REEXPRESADA (todo lo registrado hasta la exportación)';
const metaFilas = (s: Snapshot): [string, string][] => [
  ['Conjunto activo', ETIQUETA], ['RUN-ID de la exportación', s.runId], ['Generado (Lima)', s.generadoEn], ['Dataset', s.datasetId], ['SHA-256 de la carga', s.datasetHash],
  ['Build', s.build], ['Modalidad', s.modalidad], ['Vista de la analítica', vistaRotulo(s)],
  ['Rango analizado', s.analitica ? `[${s.analitica.desde.slice(0, 10)}, ${s.analitica.hasta.slice(0, 10)}) hora de Lima` : '—'], ['Filtros', s.analitica?.filtros ?? '—'],
  ['Corrida de pronóstico', s.pronostico?.corrida_id ?? 'Ninguna seleccionada'], ['Corrida de simulación', s.simulacion ? `${s.simulacion.run_id} (semilla ${s.simulacion.parametros.semilla}, ${s.simulacion.parametros.iteraciones} iteraciones)` : 'Ninguna seleccionada'],
  ['Evaluación económica', s.evaluacion?.run_id ?? 'Ninguna seleccionada'], ['Unidades', 'Cantidades en kg o unidad base; importes en PEN nominales'],
];
const n1 = (x: number | null | undefined, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? 'N/D' : fmtNum(x, d));
const soles = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? 'N/D' : 'S/ ' + fmtNum(x, 0));
/** En Excel un valor no calculable se escribe «N/D», nunca 0 ni un error. */
const nd = (x: number) => (Number.isFinite(x) ? x : 'N/D');

// ================================================================== XLSX
export async function exportarXlsx(s: Snapshot, c: Control = sinControl): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema de Distribución Alprosa'; wb.calcProperties = { fullCalcOnLoad: true };
  const encabezar = (ws: ExcelJS.Worksheet, cols: { h: string; w?: number; fmt?: string }[]) => {
    ws.addRow(cols.map((x) => x.h)); ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
    cols.forEach((x, i) => { const col = ws.getColumn(i + 1); col.width = x.w ?? 16; if (x.fmt) col.numFmt = x.fmt; });
  };
  const vacio = (ws: ExcelJS.Worksheet, texto: string) => { ws.getColumn(1).width = 100; ws.addRow([texto]); ws.getRow(1).font = { italic: true }; };
  await c.paso('Metadatos');
  const meta = wb.addWorksheet('Metadatos');
  meta.columns = [{ header: 'campo', width: 30 }, { header: 'valor', width: 90 }];
  metaFilas(s).forEach((f) => meta.addRow(f)); meta.getRow(1).font = { bold: true };

  await c.paso('Indicadores');
  const ind = wb.addWorksheet('Indicadores');
  if (!s.analitica) vacio(ind, 'Sin analítica en esta exportación.');
  else {
    encabezar(ind, [{ h: 'indicador', w: 34 }, { h: 'unidad', w: 12 }, { h: 'numerador', fmt: '#,##0.00' }, { h: 'denominador', fmt: '#,##0.00' }, { h: 'valor', fmt: '#,##0.00' }, { h: 'n', w: 8 }, { h: 'definición', w: 80 }]);
    s.analitica.indicadores.forEach((k, i) => {
      const r = i + 2;
      const formula = k.valor === null ? undefined : k.unidad === '%' ? `IF(D${r}=0,"N/D",C${r}/D${r}*100)` : k.id === 'costo_kg' ? `IF(D${r}=0,"N/D",C${r}/D${r})` : undefined;
      ind.addRow([k.nombre, k.unidad, k.numerador, k.denominador, k.valor === null ? 'N/D' : formula ? { formula, result: k.valor } : k.valor, k.n, k.definicion]);
    });
  }
  await c.paso('Serie OTIF');
  const se = wb.addWorksheet('SerieOTIF');
  if (!s.analitica?.serie.length) vacio(se, 'Sin pedidos elegibles en el rango: OTIF N/D (no cero).');
  else {
    encabezar(se, [{ h: 'periodo', w: 14 }, { h: 'a tiempo y completos' }, { h: 'elegibles' }, { h: 'OTIF %', fmt: '0.0' }]);
    s.analitica.serie.forEach((x, i) => se.addRow([x.periodo, x.num, x.den, { formula: `IF(C${i + 2}=0,"N/D",B${i + 2}/C${i + 2}*100)`, result: x.otif ?? 'N/D' }]));
    const u = s.analitica.serie.length + 1;
    const tn = s.analitica.serie.reduce((a, x) => a + x.num, 0), td = s.analitica.serie.reduce((a, x) => a + x.den, 0);
    se.addRow(['TOTAL', { formula: `SUM(B2:B${u})`, result: tn }, { formula: `SUM(C2:C${u})`, result: td }, { formula: `IF(C${u + 1}=0,"N/D",B${u + 1}/C${u + 1}*100)`, result: td ? (tn / td) * 100 : 'N/D' }]);
    se.getRow(u + 1).font = { bold: true };
  }
  await c.paso('Pareto');
  const pa = wb.addWorksheet('Pareto');
  if (!s.analitica?.pareto.n) vacio(pa, 'Sin incumplimientos en el rango, o sin causas registradas: no se redacta ninguna causa.');
  else {
    encabezar(pa, [{ h: 'causa registrada (no es causa raíz confirmada)', w: 50 }, { h: 'pedidos' }, { h: '%', fmt: '0.0' }, { h: '% acumulado', fmt: '0.0' }]);
    const u = s.analitica.pareto.filas.length + 1;
    s.analitica.pareto.filas.forEach((f, i) => pa.addRow([f.causa, f.n, { formula: `B${i + 2}/SUM($B$2:$B$${u})*100`, result: f.pct }, { formula: `SUM($B$2:B${i + 2})/SUM($B$2:$B$${u})*100`, result: f.acumulado }]));
  }
  await c.paso('Pronóstico');
  const pr = wb.addWorksheet('Pronostico');
  if (!s.pronostico) vacio(pr, 'Sin corrida de pronóstico seleccionada: no se muestran cifras de demanda futura.');
  else {
    pr.addRow([`Corrida ${s.pronostico.corrida_id} · serie ${s.pronostico.serie} · corte ${s.pronostico.corte.slice(0, 10)} · método elegido ${s.pronostico.metodo ?? '—'}`]);
    pr.addRow(['semana', 'pronóstico', 'P10', 'P90', 'tipo']); pr.getRow(2).font = { bold: true };
    for (const x of s.pronostico.prediccion) pr.addRow([x.semana, x.valor / 1000, x.p10 === null ? 'N/D' : x.p10 / 1000, x.p90 === null ? 'N/D' : x.p90 / 1000, x.tipo]);
    pr.getColumn(1).width = 14; [2, 3, 4].forEach((i) => (pr.getColumn(i).numFmt = '#,##0.0')); pr.getColumn(5).width = 14;
  }
  await c.paso('Simulación');
  const si = wb.addWorksheet('Simulacion');
  if (!s.simulacion) vacio(si, 'Sin corrida de simulación seleccionada: no se muestran resultados de incertidumbre.');
  else {
    const r = s.simulacion.resultado;
    encabezar(si, [{ h: 'plan', w: 38 }, { h: 'pedidos' }, { h: 'servicios físicos' }, { h: 'OTIF esperado %', fmt: '0.0' }, { h: 'OTIF P5 %', fmt: '0.0' }, { h: 'OTIF P95 %', fmt: '0.0' },
      { h: 'prob. incumplimiento %', fmt: '0.0' }, { h: 'retraso P95 h', fmt: '0.0' }, { h: 'costo medio S/', fmt: '#,##0' }, { h: 'costo P95 S/', fmt: '#,##0' }, { h: 'kg no atendidos (media)', fmt: '#,##0.0' }]);
    for (const p of r.planes) si.addRow([p.nombre, p.pedidos, p.servicios, p.a_tiempo.media, p.a_tiempo.p5, p.a_tiempo.p95, p.prob_incumplimiento * 100, p.retraso_h.p95, p.costo.media, p.costo.p95, p.kg_no_atendido.media]);
    si.addRow([]); si.addRow([`Semilla ${s.simulacion.parametros.semilla} · ${r.iteraciones} iteraciones · ${r.correlacion}`]);
    const pp = wb.addWorksheet('SimulacionPedidos');
    encabezar(pp, [{ h: 'plan', w: 30 }, { h: 'pedido' }, { h: 'destino' }, { h: 'remoto' }, { h: 'kg', fmt: '#,##0.0' }, { h: 'prob. a tiempo %', fmt: '0.0' }, { h: 'prob. no atendido %', fmt: '0.0' }, { h: 'retraso P95 h', fmt: '0.0' }, { h: 'llegada P50' }, { h: 'llegada P95' }, { h: 'motivo', w: 60 }]);
    for (const p of r.planes) for (const x of p.por_pedido) pp.addRow([p.nombre, x.pedido, x.destino, x.remoto ? 'sí' : 'no', x.kg, x.prob_a_tiempo * 100, x.prob_no_atendido * 100, x.retraso_p95, x.llegada_p50 ?? 'N/D', x.llegada_p95 ?? 'N/D', x.motivo]);
  }
  await c.paso('Alternativas y EVA');
  const ev = wb.addWorksheet('AlternativasEVA');
  if (!s.evaluacion) vacio(ev, 'Sin evaluación económica seleccionada: no se muestran EBIT, NOPAT ni EVA.');
  else {
    const e = s.evaluacion.ev;
    ev.addRow([`Evaluación ${s.evaluacion.run_id} · corte ${e.corte.slice(0, 10)} · ${e.horizonte_meses} meses · demanda: ${e.demanda.escenario}`]);
    ev.addRow([e.convencion]);
    ev.addRow(['alternativa', 'ingresos', 'costo logístico', 'EBIT', 'NOPAT', 'capital apertura', 'capital cierre', 'capital promedio', 'WACC del período', 'cargo de capital', 'EVA', 'ΔEVA vs base', 'OTIF %', 'kg no atendidos', 'inversión', 'caja liberada (no es EBIT)', 'estado']);
    ev.getRow(3).font = { bold: true };
    const dias = e.demanda.meses.reduce((a, m) => a + m.dias, 0);
    const w = e.horizonte_meses === 12 ? e.supuestos.wacc_anual! : (1 + e.supuestos.wacc_anual!) ** (dias / 365) - 1;
    e.escenarios.forEach((x, i) => {
      const r = i + 4;
      const ok = Number.isFinite(x.ebit) && Number.isFinite(x.capital_promedio);
      ev.addRow([x.nombre, nd(x.ingresos), nd(x.costo_logistico), nd(x.ebit), nd(x.nopat), nd(x.capital_apertura), nd(x.capital_cierre), ok ? { formula: `(F${r}+G${r})/2`, result: x.capital_promedio } : 'N/D', w,
        ok ? { formula: `I${r}*H${r}`, result: x.cargo_capital } : 'N/D', x.eva === null ? 'NO CALCULABLE' : { formula: `E${r}-J${r}`, result: x.eva },
        x.eva === null || e.escenarios[0].eva === null ? 'N/D' : { formula: `K${r}-$K$4`, result: x.delta_eva ?? 0 }, x.servicio.otif_pct, x.kg_no_atendido, x.inversion, x.caja_liberada, x.estado + (x.motivo ? ': ' + x.motivo : '')]);
    });
    ev.getColumn(1).width = 46; for (let i = 2; i <= 16; i++) ev.getColumn(i).numFmt = '#,##0'; ev.getColumn(9).numFmt = '0.0000'; ev.getColumn(13).numFmt = '0.0'; ev.getColumn(17).width = 60;
    const me = wb.addWorksheet('EVA_Mensual');
    encabezar(me, [{ h: 'alternativa', w: 34 }, { h: 'mes' }, { h: 'kg demanda', fmt: '#,##0' }, { h: 'kg aceptados', fmt: '#,##0' }, { h: 'ingresos', fmt: '#,##0' }, { h: 'costo producto', fmt: '#,##0' }, { h: 'costo logístico', fmt: '#,##0' },
      { h: 'otros gastos', fmt: '#,##0' }, { h: 'depreciación', fmt: '#,##0' }, { h: 'implementación', fmt: '#,##0' }, { h: 'EBIT', fmt: '#,##0' }, { h: 'impuesto', fmt: '#,##0' }, { h: 'NOPAT', fmt: '#,##0' }, { h: 'capital cierre', fmt: '#,##0' }, { h: 'demanda', w: 24 }]);
    const tasa = e.supuestos.tasa_impuesto ?? 0;
    let r = 2;
    for (const x of e.escenarios) for (const m of x.meses) {
      const ok = Number.isFinite(m.ebit);
      me.addRow([x.nombre, m.mes, m.kg_demanda, m.kg_aceptado, m.ingresos, m.costo_producto, nd(m.costo_logistico), m.otros, m.depreciacion, m.implementacion,
        ok ? { formula: `E${r}-F${r}-G${r}-H${r}-I${r}-J${r}`, result: m.ebit } : 'N/D', ok ? { formula: `MAX(K${r},0)*${tasa}`, result: m.impuesto } : 'N/D', ok ? { formula: `K${r}-L${r}`, result: m.nopat } : 'N/D', nd(m.capital_cierre), m.extension ? 'EXTENSIÓN (no validada)' : 'Validada']);
      r++;
    }
    const su = wb.addWorksheet('Supuestos');
    encabezar(su, [{ h: 'clave', w: 34 }, { h: 'valor', w: 30 }]);
    for (const [k, v] of Object.entries(e.supuestos)) su.addRow([k, v === null ? 'FALTA (no se rellena con cero)' : v]);
    const sen = wb.addWorksheet('Sensibilidad');
    encabezar(sen, [{ h: 'alternativa', w: 46 }, { h: 'ΔEVA base', fmt: '#,##0' }, { h: 'demanda −10 %', fmt: '#,##0' }, { h: 'demanda +10 %', fmt: '#,##0' }, { h: 'transporte +10 %', fmt: '#,##0' }, { h: 'transporte −10 %', fmt: '#,##0' }, { h: 'WACC +2 pp', fmt: '#,##0' }, { h: 'WACC −2 pp', fmt: '#,##0' }]);
    for (const x of e.sensibilidad) sen.addRow([x.nombre, x.base ?? 'N/D', x.demanda_menos10 ?? 'N/D', x.demanda_mas10 ?? 'N/D', x.tarifa_mas10 ?? 'N/D', x.tarifa_menos10 ?? 'N/D', x.wacc_mas2 ?? 'N/D', x.wacc_menos2 ?? 'N/D']);
  }
  await c.paso('Itinerarios multimodales');
  const it = wb.addWorksheet('Itinerarios');
  if (!s.itinerarios?.length) vacio(it, 'Sin itinerarios registrados.');
  else {
    encabezar(it, [{ h: 'pedido' }, { h: 'itinerario', w: 22 }, { h: 'estado itinerario' }, { h: 'tramo', w: 8 }, { h: 'viaje', w: 8 }, { h: 'medio' }, { h: 'origen' }, { h: 'destino' }, { h: 'servicio', w: 32 }, { h: 'kg en la etapa (no se suman entre tramos)', w: 22, fmt: '#,##0.000' }, { h: 'estado etapa' }, { h: 'etapa final' }]);
    for (const x of s.itinerarios) it.addRow([x.pedido_id, x.itinerario_id, x.estado, x.tramo, x.viaje, x.modo, x.origen, x.destino, x.servicio_id, x.kg, x.etapa_estado, x.final ? 'sí' : 'no']);
  }
  const ac = wb.addWorksheet('AceptacionFinal');
  if (!s.aceptado?.length) vacio(ac, 'Sin pedidos.');
  else {
    encabezar(ac, [{ h: 'pedido' }, { h: 'solicitado kg', fmt: '#,##0.000' }, { h: 'aceptado kg (una sola vez, en destino final)', w: 30, fmt: '#,##0.000' }]);
    for (const x of s.aceptado) ac.addRow([x.pedido_id, x.solicitado_kg, x.aceptado_kg]);
  }
  await c.paso('Costos compartidos');
  const co = wb.addWorksheet('CostosCompartidos');
  if (!s.costos?.length) vacio(co, 'Sin servicios con etapas: no hay costos que repartir.');
  else {
    encabezar(co, [{ h: 'servicio', w: 34 }, { h: 'etapa', w: 40 }, { h: 'pedido' }, { h: 'kg', fmt: '#,##0.000' }, { h: 'fijo imputado S/', fmt: '#,##0.00' }, { h: 'variable S/', fmt: '#,##0.00' }]);
    let r = 2;
    for (const sv of s.costos) {
      const ini = r;
      for (const l of sv.lineas) { co.addRow([sv.servicio_id, l.etapa_id, l.pedido_id, l.kg, l.fijo_cent / 100, l.variable_cent / 100]); r++; }
      co.addRow([sv.servicio_id, 'NO ASIGNADO', '', '', sv.no_asignado_cent / 100, 0]); r++;
      co.addRow([sv.servicio_id, 'TOTAL = fijo del servicio + variable (imputado + no asignado)', '', '', { formula: `SUM(E${ini}:E${r - 1})`, result: sv.fijo_cent / 100 }, { formula: `SUM(F${ini}:F${r - 1})`, result: sv.lineas.reduce((a, l) => a + l.variable_cent, 0) / 100 }]);
      co.getRow(r).font = { bold: true }; r++;
    }
  }
  await c.paso('Existencias y pedidos');
  const ex = wb.addWorksheet('Existencias');
  encabezar(ex, [{ h: 'producto_id' }, { h: 'lote' }, { h: 'nodo' }, { h: 'condicion' }, { h: 'vencimiento' }, { h: 'estado_lote' }, { h: 'fisico', fmt: '#,##0.000' }, { h: 'reservado', fmt: '#,##0.000' }, { h: 'disponible', fmt: '#,##0.000' }]);
  for (const e of s.existencias) ex.addRow([e.producto_id, e.codigo_lote, e.nodo_id, e.condicion, e.fecha_vencimiento, e.estado_lote, e.fisico_mil / 1000, e.reservado_mil / 1000, e.disponible_mil / 1000]);
  const ne = s.existencias.length + 1;
  ex.addRow(['TOTAL', '', '', '', '', '', { formula: `SUM(G2:G${ne})`, result: s.existencias.reduce((a, e) => a + e.fisico_mil, 0) / 1000 },
    { formula: `SUM(H2:H${ne})`, result: s.existencias.reduce((a, e) => a + e.reservado_mil, 0) / 1000 }, { formula: `SUM(I2:I${ne})`, result: s.existencias.reduce((a, e) => a + e.disponible_mil, 0) / 1000 }]);
  const pe = wb.addWorksheet('Pedidos');
  encabezar(pe, [{ h: 'pedido_id' }, { h: 'linea' }, { h: 'producto_id' }, { h: 'estado_pedido' }, { h: 'solicitado', fmt: '#,##0.000' }, { h: 'reservado', fmt: '#,##0.000' }, { h: 'pendiente', fmt: '#,##0.000' }, { h: 'ventana_fin', w: 26 }]);
  for (const p of s.pedidos) for (const l of p.lineas) pe.addRow([p.pedido_id, l.pedido_linea_id, l.producto_id, p.estado, l.solicitada_mil / 1000, l.reservada_mil / 1000, l.pendiente_mil / 1000, p.ventana_fin]);
  await c.paso('Escribiendo el archivo');
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// ================================================================== DOCX
const VERDE = '037A61', BORDE = 'C8D3CF';
const run = (t: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) => new TextRun({ text: t, font: 'Calibri', size: o.size ?? 21, bold: o.bold, italics: o.italics, color: o.color });
const P = (t: string, o: { italics?: boolean; bold?: boolean; color?: string; size?: number } = {}) => new Paragraph({ spacing: { after: 120, line: 276 }, children: [run(t, o)] });
const viñeta = (t: string) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 80, line: 264 }, children: [run(t)] });
const H1 = (t: string) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: false, spacing: { before: 360, after: 140 }, children: [new TextRun({ text: t, font: 'Calibri', size: 30, bold: true, color: VERDE })] });
const H2 = (t: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 }, children: [new TextRun({ text: t, font: 'Calibri', size: 24, bold: true, color: '2E5E50' })] });
const espacio = () => new Paragraph({ spacing: { after: 160 }, children: [] });
const bordes = { top: { style: BorderStyle.SINGLE, size: 4, color: BORDE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDE }, left: { style: BorderStyle.SINGLE, size: 4, color: BORDE }, right: { style: BorderStyle.SINGLE, size: 4, color: BORDE } };

/**
 * Tabla con título numerado, encabezado verde, filas alternadas, anchos por columna y un espacio después:
 * nunca quedan dos tablas pegadas.
 */
function crearTablas() {
  let n = 0;
  return (titulo: string, cab: string[], filas: string[][], anchos: number[], numericas: number[] = []): (Paragraph | Table)[] => {
    n++;
    const cel = (t: string, i: number, fila: number) => new TableCell({
      width: { size: anchos[i], type: WidthType.PERCENTAGE }, borders: bordes, margins: { top: 50, bottom: 50, left: 90, right: 90 },
      shading: fila < 0 ? { type: ShadingType.CLEAR, color: 'auto', fill: VERDE } : fila % 2 ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F8F6' } : undefined,
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({ alignment: numericas.includes(i) ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 0 }, children: [run(t, { bold: fila < 0, size: 18, color: fila < 0 ? 'FFFFFF' : undefined })] })] });
    return [
      new Paragraph({ keepNext: true, spacing: { before: 120, after: 60 }, children: [run(`Tabla ${n}. `, { bold: true, size: 19, color: VERDE }), run(titulo, { size: 19, color: '444444' })] }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: anchos.map((a) => Math.round(a * 90)), rows: [
        new TableRow({ tableHeader: true, cantSplit: true, children: cab.map((t, i) => cel(t, i, -1)) }),
        ...filas.map((f, j) => new TableRow({ cantSplit: true, children: f.map((t, i) => cel(t, i, j)) }))] }),
      espacio(),
    ];
  };
}
const kpi = (s: Snapshot, id: string) => s.analitica?.indicadores.find((k) => k.id === id);

/** Hallazgos generados SOLO a partir de cifras del snapshot (N05, AK04). */
export function hallazgos(s: Snapshot): string[] {
  const h: string[] = [];
  const o = kpi(s, 'otif'), c = kpi(s, 'costo_kg');
  if (o) h.push(o.valor === null ? 'OTIF: N/D (sin pedidos elegibles en el rango).' : `OTIF por pedido ${n1(o.valor)} % (${fmtNum(o.numerador, 0)} de ${fmtNum(o.denominador, 0)} pedidos elegibles).`);
  if (c) h.push(c.valor === null ? 'Costo por kg: N/D (sin kg aceptados).' : `Costo logístico por kg aceptado: S/ ${n1(c.valor, 3)}.`);
  const top = s.analitica?.pareto.filas[0];
  if (s.analitica && s.analitica.pareto.n === 0) h.push('No hay incumplimientos en el rango: no se redacta ninguna causa.');
  else if (top) h.push(top.causa === 'Sin causa registrada' ? `La categoría más frecuente es «Sin causa registrada» (${top.n} pedidos): la información es INSUFICIENTE para atribuir una causa.` : `La causa REGISTRADA más frecuente es «${top.causa}» (${top.n} de ${s.analitica!.pareto.n} incumplimientos, ${n1(top.pct)} %). Es una causa registrada, no una causa raíz confirmada.`);
  if (s.simulacion) { const b = s.simulacion.resultado.planes[0]; h.push(`Simulación (${s.simulacion.resultado.iteraciones} iteraciones): con el plan «${b.nombre}» el OTIF esperado es ${n1(b.a_tiempo.media)} % (P5 ${n1(b.a_tiempo.p5)} %, P95 ${n1(b.a_tiempo.p95)} %) y el retraso P95 es ${n1(b.retraso_h.p95)} h.`); }
  if (s.evaluacion) h.push(s.evaluacion.ev.comparador.conclusion);
  return h;
}

export async function exportarDocx(s: Snapshot, logoPng?: Uint8Array, c: Control = sinControl): Promise<Blob | Uint8Array> {
  const T = crearTablas();
  await c.paso('Portada');
  // ---- Portada (sección propia)
  const portada: Paragraph[] = [];
  if (logoPng) portada.push(new Paragraph({ spacing: { after: 600 }, children: [new ImageRun({ type: 'png', data: logoPng, transformation: { width: 300, height: 35 } })] }));
  portada.push(
    new Paragraph({ spacing: { before: 1800, after: 200 }, children: [new TextRun({ text: 'Informe técnico de distribución multimodal', font: 'Calibri', size: 52, bold: true, color: VERDE })] }),
    new Paragraph({ spacing: { after: 600 }, children: [run('Servicio, causas, demanda, riesgo simulado y alternativas con impacto económico', { size: 28, color: '444444' })] }),
    ...metaFilas(s).filter(([k]) => ['RUN-ID de la exportación', 'Generado (Lima)', 'Vista de la analítica', 'Rango analizado', 'Corrida de simulación', 'Evaluación económica'].includes(k))
      .map(([k, v]) => new Paragraph({ spacing: { after: 80 }, children: [run(k + ': ', { bold: true, size: 20 }), run(v, { size: 20 })] })),
    new Paragraph({ spacing: { before: 800 }, border: { top: { style: BorderStyle.SINGLE, size: 8, color: 'E0A800', space: 6 }, bottom: { style: BorderStyle.SINGLE, size: 8, color: 'E0A800', space: 6 } },
      children: [run(`${ETIQUETA}. Las cifras provienen del sistema; no son datos reales de Alprosa.`, { italics: true, size: 20, color: '8A5A00' })] }));

  // ---- Cuerpo
  const ch: (Paragraph | Table)[] = [];
  ch.push(H1('1. Resumen ejecutivo'), ...hallazgos(s).map(viñeta));
  await c.paso('Situación');
  ch.push(H1('2. Situación de la distribución'));
  if (s.analitica) {
    ch.push(P(`${vistaRotulo(s)}. Rango [${s.analitica.desde.slice(0, 10)}, ${s.analitica.hasta.slice(0, 10)}). Filtros: ${s.analitica.filtros}.`));
    ch.push(...T('Indicadores del período (el valor se recalcula desde numerador y denominador).', ['Indicador', 'Valor', 'Numerador / denominador', 'n'],
      s.analitica.indicadores.map((k) => [k.nombre, k.valor === null ? 'N/D' : `${n1(k.valor, k.unidad === 'S/ por kg' ? 3 : 1)} ${k.unidad}`, `${fmtNum(k.numerador, 0)} / ${fmtNum(k.denominador, 0)}`, String(k.n)]), [42, 18, 28, 12], [1, 2, 3]));
  } else ch.push(P('Sin analítica incluida en esta exportación.'));
  ch.push(H1('3. Datos y calidad'), ...T('Origen y alcance de las cifras.', ['Campo', 'Valor'], metaFilas(s), [30, 70]), P('Los valores N/D indican denominador cero o falta de datos; no son ceros.'));
  await c.paso('Metodología');
  ch.push(H1('4. Metodología y modelos'));
  ch.push(H2('4.1 Pronóstico'), P(s.pronostico ? `Corrida ${s.pronostico.corrida_id}, serie ${s.pronostico.serie}, corte ${s.pronostico.corte.slice(0, 10)}. Se comparan ingenuo, promedio móvil de 4 semanas y suavizamiento exponencial con evaluación de origen móvil en las últimas 8 semanas, sin usar datos futuros. Método elegido: ${s.pronostico.metodo ?? 'sin pronóstico'}.` : 'Sin corrida de pronóstico seleccionada.'));
  ch.push(H2('4.2 Simulación Monte Carlo'), P(s.simulacion ? `Corrida ${s.simulacion.run_id} (modelo ${s.simulacion.modelo}): ${fmtNum(s.simulacion.parametros.iteraciones, 0)} iteraciones, semilla ${s.simulacion.parametros.semilla}, generador LCG del contrato. Duración triangular por tramo, incidencia Bernoulli con retraso y cierre de corredor.` : 'Sin corrida de simulación seleccionada.'));
  if (s.simulacion) ch.push(P(s.simulacion.resultado.correlacion, { size: 19, color: '555555' }));
  ch.push(H2('4.3 Evaluación económica'), P(s.evaluacion ? s.evaluacion.ev.convencion : 'Sin evaluación económica seleccionada.'));
  await c.paso('Analítica');
  ch.push(H1('5. Cuatro tipos de analítica'));
  ch.push(H2('5.1 Descriptiva'), P(s.analitica ? `Serie OTIF de ${s.analitica.serie.length} períodos; los porcentajes se recalculan desde numerador y denominador (ver Excel, hoja SerieOTIF).` : 'Sin analítica.'));
  ch.push(H2('5.2 Diagnóstica'));
  if (!s.analitica || s.analitica.pareto.n === 0) ch.push(P('Sin incumplimientos o sin causas registradas en el rango: información insuficiente; no se redacta una causa.'));
  else {
    ch.push(...T(`Causas registradas de incumplimiento (n = ${s.analitica.pareto.n}). No son causas raíz confirmadas.`, ['Causa registrada', 'Pedidos', '%', '% acumulado'], s.analitica.pareto.filas.map((f) => [f.causa, String(f.n), n1(f.pct), n1(f.acumulado)]), [52, 16, 16, 16], [1, 2, 3]));
    ch.push(P(s.analitica.causas.length ? `Cadenas causales: ${s.analitica.causas.map((x) => `«${x.hipotesis}» en estado ${x.estado} (${x.evidencias} evidencia/s)`).join('; ')}. Solo una cadena CONFIRMADA por otra persona es causa raíz.` : 'No hay cadenas causales registradas: ninguna causa está confirmada.'));
  }
  ch.push(H2('5.3 Predictiva'));
  if (s.pronostico?.metricas) ch.push(...T(`Error de cada método en la evaluación cronológica (${s.pronostico.serie}).`, ['Método', 'MAE', 'WAPE %', 'Semanas'], Object.entries(s.pronostico.metricas).map(([m, x]) => [m, n1(x.mae === null ? null : x.mae / 1000), n1(x.wape), String(x.n)]), [40, 20, 20, 20], [1, 2, 3]));
  else ch.push(P(s.pronostico ? 'Información limitada: referencia simple sin evaluación estadística.' : 'Sin corrida de pronóstico.'));
  ch.push(H2('5.4 Prescriptiva'));
  if (s.recomendaciones?.length) ch.push(...T('Recomendaciones registradas (las decide una persona; ninguna se aplica sola).', ['Regla', 'Entidad', 'Estado', 'Alternativa'], s.recomendaciones.slice(0, 15).map((r) => [r.regla, r.entidad_id, r.estado, r.alternativa]), [20, 16, 14, 50]));
  else ch.push(P('Sin recomendaciones registradas.'));
  await c.paso('Propuestas');
  ch.push(H1('6. Hallazgos y propuestas factibles'));
  if (s.simulacion) ch.push(...T('Planes simulados con los mismos sorteos (riesgo de servicio y costo).', ['Plan', 'OTIF esperado', 'P5 – P95', 'Retraso P95', 'Costo medio'],
    s.simulacion.resultado.planes.map((p) => [p.nombre, `${n1(p.a_tiempo.media)} %`, `${n1(p.a_tiempo.p5)} – ${n1(p.a_tiempo.p95)} %`, `${n1(p.retraso_h.p95)} h`, soles(p.costo.media)]), [40, 15, 17, 13, 15], [1, 2, 3, 4]));
  if (s.evaluacion) {
    const e = s.evaluacion.ev;
    ch.push(...T(`Alternativas evaluadas (${e.horizonte_meses} meses, demanda: ${e.demanda.escenario}).`, ['Alternativa', 'EVA', 'ΔEVA', 'OTIF', '¿Cumple?', 'Puntaje'],
      e.escenarios.map((x) => { const f = e.comparador.filas.find((y) => y.id === x.id); return [x.nombre, x.eva === null ? 'No calculable' : soles(x.eva), soles(x.delta_eva), `${n1(x.servicio.otif_pct)} %`, f?.factible ? 'Sí' : 'No (ver nota)', f?.puntaje === null || f?.puntaje === undefined ? '—' : fmtNum(f.puntaje, 3)]; }),
      [36, 14, 13, 10, 14, 13], [1, 2, 3, 5]));
    const no = e.comparador.filas.filter((f) => !f.factible);
    if (no.length) { ch.push(P('Notas — alternativas que no cumplen las restricciones:', { bold: true, size: 20 })); for (const f of no) ch.push(viñeta(`${f.nombre}: ${f.motivo}`)); }
    ch.push(new Paragraph({ spacing: { before: 160, after: 160 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'E3F4EE' }, border: { left: { style: BorderStyle.SINGLE, size: 24, color: VERDE, space: 8 } },
      children: [run(e.comparador.conclusion, { bold: true })] }));
  } else ch.push(P('Sin evaluación económica: no se proponen alternativas con impacto monetario.'));
  ch.push(H1('7. Plan de implementación'));
  const gana = s.evaluacion ? s.evaluacion.ev.escenarios.find((x) => x.id === s.evaluacion!.ev.comparador.orden[0]) : null;
  if (!gana || gana.id === 'BASE' || (gana.delta_eva ?? 0) <= 0) ch.push(P('No hay una alternativa con mejora defendible: se mantiene la operación actual y se repite la evaluación al cierre del próximo mes.'));
  else ch.push(...T(`Etapas para «${gana.nombre}».`, ['Etapa', 'Responsable funcional', 'Acción'], [
    ['1. Validar supuestos', 'Supervisión y Análisis', `Revisar los supuestos: ${gana.cambios.join(' ')}`],
    ['2. Piloto', 'Planificación', 'Aplicar en una región durante 4 semanas y registrar OTIF, costo y demanda no atendida.'],
    ['3. Medir', 'Análisis', 'Comparar con la base usando el mismo rango y la vista REEXPRESADA.'],
    ['4. Decidir', 'Supervisión', 'Extender, ajustar o descartar según el resultado medido, no según la proyección.']], [20, 22, 58]));
  ch.push(H1('8. Impacto económico (EVA)'));
  if (s.evaluacion) {
    const b = s.evaluacion.ev.escenarios[0];
    ch.push(P(s.evaluacion.ev.convencion));
    ch.push(...T('Base: componentes del EVA.', ['Concepto', 'Importe'], [['Ingresos', soles(b.ingresos)], ['Costo logístico', soles(b.costo_logistico)], ['EBIT', soles(b.ebit)], ['NOPAT', soles(b.nopat)], ['Capital operativo promedio', soles(b.capital_promedio)], ['Cargo de capital', soles(b.cargo_capital)], ['EVA', b.eva === null ? 'No calculable' : soles(b.eva)]], [60, 40], [1]));
    ch.push(P('Unidad demostrativa de distribución; no es el EVA de Alprosa.', { italics: true, size: 19 }));
  } else ch.push(P('Sin evaluación económica.'));
  ch.push(H1('9. Limitaciones'), ...[...(s.evaluacion?.ev.limitaciones ?? []), 'Datos sintéticos NutriDemo; parámetros editables.', 'El Pareto prioriza causas registradas; no confirma causas raíz.'].map(viñeta));
  await c.paso('Escribiendo el archivo');
  const margen = { top: 1134, bottom: 1134, left: 1134, right: 1134 };
  const pie = new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(`${s.runId} · página `, { size: 16, color: '777777' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '777777' }), run(' de ', { size: 16, color: '777777' }), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '777777' })] })] });
  const cab = new Header({ children: [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDE, space: 4 } }, children: [run('Informe técnico de distribución · ' + ETIQUETA, { size: 16, color: '777777' })] })] });
  const doc = new Document({ creator: 'Sistema de Distribución Alprosa', title: 'Informe técnico ' + s.runId, description: `${ETIQUETA} · ${s.runId}`,
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [{ properties: { page: { margin: margen } }, children: portada }, { properties: { page: { margin: margen } }, headers: { default: cab }, footers: { default: pie }, children: ch }] });
  return typeof window === 'undefined' ? await Packer.toBuffer(doc) : await Packer.toBlob(doc);
}

// ================================================================== PPTX
export async function exportarPptx(s: Snapshot, logoPng?: Uint8Array, c: Control = sinControl): Promise<Blob | ArrayBuffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = 'Presentación ejecutiva ' + s.runId;
  const verde = '037A61', gris = '555555';
  let logo: string | null = null;
  if (logoPng) { let b = ''; for (const x of logoPng) b += String.fromCharCode(x); logo = 'data:image/png;base64,' + btoa(b); }
  const titulo = (sl: PptxGenJS.Slide, t: string) => {
    sl.addText(t, { x: 0.5, y: 0.3, w: 10.3, h: 0.7, fontSize: 26, bold: true, color: verde });
    if (logo) sl.addImage({ data: logo, x: 10.9, y: 0.4, w: 2.0, h: 0.23 });
    sl.addText(`${ETIQUETA} · ${s.runId} · ${vistaRotulo(s)}`, { x: 0.5, y: 7.0, w: 12.3, h: 0.3, fontSize: 10, color: gris });
  };
  await c.paso('Propósito');
  const s1 = pptx.addSlide(); titulo(s1, 'Distribución multimodal — resultados y decisión');
  s1.addText([{ text: 'Propósito: ', options: { bold: true } }, { text: 'mostrar servicio y costo de la distribución, causas registradas, demanda proyectada, riesgo simulado y alternativas con su impacto económico.' }], { x: 0.5, y: 1.3, w: 12.3, h: 1.2, fontSize: 18 });
  s1.addText(`Alcance: ${s.analitica ? `[${s.analitica.desde.slice(0, 10)}, ${s.analitica.hasta.slice(0, 10)}) · ${s.analitica.filtros}` : 'sin analítica'} · generado ${s.generadoEn}`, { x: 0.5, y: 2.6, w: 12.3, h: 0.6, fontSize: 14, color: gris });
  s1.addText(hallazgos(s).map((t) => ({ text: t, options: { bullet: true } })), { x: 0.5, y: 3.3, w: 12.3, h: 3.4, fontSize: 14 });
  await c.paso('Servicio y costo');
  const s2 = pptx.addSlide(); titulo(s2, 'Servicio y costo');
  if (s.analitica) {
    s2.addTable([['Indicador', 'Valor', 'Base de cálculo'].map((t) => ({ text: t, options: { bold: true, fill: { color: 'E8F3EF' } } })),
      ...s.analitica.indicadores.slice(0, 8).map((k) => [{ text: k.nombre }, { text: k.valor === null ? 'N/D' : `${n1(k.valor, k.unidad === 'S/ por kg' ? 3 : 1)} ${k.unidad}` }, { text: `${fmtNum(k.numerador, 0)} / ${fmtNum(k.denominador, 0)} · n ${k.n}` }])], { x: 0.5, y: 1.2, w: 6.4, fontSize: 12 });
    if (s.analitica.serie.length) s2.addChart(pptx.ChartType.line, [{ name: 'OTIF %', labels: s.analitica.serie.map((x) => x.periodo), values: s.analitica.serie.map((x) => x.otif ?? 0) }],
      { x: 7.1, y: 1.2, w: 5.8, h: 5.2, chartColors: [verde], valAxisMinVal: 0, valAxisMaxVal: 100, showLegend: false, catAxisLabelFontSize: 9, showTitle: true, title: 'OTIF por período (%)', titleFontSize: 12 });
  } else s2.addText('Sin analítica en esta exportación.', { x: 0.5, y: 1.3, w: 12, h: 0.6, fontSize: 18 });
  await c.paso('Diagnóstico');
  const s3 = pptx.addSlide(); titulo(s3, 'Diagnóstico: causas registradas de incumplimiento');
  if (!s.analitica || !s.analitica.pareto.n) s3.addText('Sin incumplimientos o sin causas registradas: información insuficiente; no se atribuye una causa.', { x: 0.5, y: 1.3, w: 12, h: 1, fontSize: 18 });
  else {
    const f = s.analitica.pareto.filas.slice(0, 8).reverse(); // en barras horizontales la primera categoría queda abajo
    s3.addChart(pptx.ChartType.bar, [{ name: 'Pedidos', labels: f.map((x) => x.causa), values: f.map((x) => x.n) }], { x: 0.5, y: 1.2, w: 8.2, h: 5.4, barDir: 'bar', chartColors: [verde], showValue: true, catAxisLabelFontSize: 11, showLegend: false });
    s3.addText(`n = ${s.analitica.pareto.n} incumplimientos. Son causas REGISTRADAS, no causas raíz confirmadas. «Sin causa registrada» se muestra para no esconder la falta de información.`, { x: 9.0, y: 1.3, w: 3.9, h: 3, fontSize: 14, color: gris });
  }
  await c.paso('Demanda');
  const s4 = pptx.addSlide(); titulo(s4, 'Demanda proyectada');
  const dm = s.evaluacion?.ev.demanda.meses;
  if (dm) {
    s4.addChart(pptx.ChartType.bar, [{ name: 'kg solicitados', labels: dm.map((m) => m.mes + (m.extension ? '*' : '')), values: dm.map((m) => Math.round(m.kg_demanda)) }], { x: 0.5, y: 1.2, w: 8.5, h: 5.2, chartColors: [verde], valAxisLabelFormatCode: '#,##0', valAxisMinVal: 0, showLegend: false });
    s4.addText(`${s.evaluacion!.ev.demanda.escenario}. ${s.evaluacion!.ev.demanda.nota} (*) mes con semanas de extensión.`, { x: 9.2, y: 1.3, w: 3.7, h: 4.5, fontSize: 12, color: gris });
  } else if (s.pronostico) {
    s4.addChart(pptx.ChartType.line, [{ name: 'Pronóstico', labels: s.pronostico.prediccion.map((x) => x.semana), values: s.pronostico.prediccion.map((x) => x.valor / 1000) }], { x: 0.5, y: 1.2, w: 8.5, h: 5.2, chartColors: ['F2994A'] });
    s4.addText(`Corrida ${s.pronostico.corrida_id} · ${s.pronostico.serie} · corte ${s.pronostico.corte.slice(0, 10)}`, { x: 9.2, y: 1.3, w: 3.7, h: 2, fontSize: 12, color: gris });
  } else s4.addText('Sin pronóstico ni evaluación seleccionados: no se muestra demanda futura.', { x: 0.5, y: 1.3, w: 12, h: 1, fontSize: 18 });
  await c.paso('Incertidumbre');
  const s5 = pptx.addSlide(); titulo(s5, 'Incertidumbre y riesgos (simulación Monte Carlo)');
  if (s.simulacion) {
    const r = s.simulacion.resultado;
    s5.addTable([['Plan', 'OTIF esperado', 'P5 – P95', 'Prob. incumplir', 'Retraso P95', 'Costo medio'].map((t) => ({ text: t, options: { bold: true, fill: { color: 'E8F3EF' } } })),
      ...r.planes.map((p) => [p.nombre, `${n1(p.a_tiempo.media)} %`, `${n1(p.a_tiempo.p5)} – ${n1(p.a_tiempo.p95)} %`, `${n1(p.prob_incumplimiento * 100)} %`, `${n1(p.retraso_h.p95)} h`, soles(p.costo.media)].map((t) => ({ text: t })))], { x: 0.5, y: 1.2, w: 12.3, fontSize: 13 });
    s5.addText(`${r.iteraciones} iteraciones, semilla ${s.simulacion.parametros.semilla}. ${r.correlacion}`, { x: 0.5, y: 4.6, w: 12.3, h: 1.6, fontSize: 12, color: gris });
  } else s5.addText('Sin corrida de simulación seleccionada.', { x: 0.5, y: 1.3, w: 12, h: 1, fontSize: 18 });
  await c.paso('Alternativas');
  const s6 = pptx.addSlide(); titulo(s6, 'Base y alternativas: impacto en EVA');
  if (s.evaluacion) {
    const e = s.evaluacion.ev, xs = e.escenarios.filter((x) => x.id !== 'BASE').reverse();
    s6.addChart(pptx.ChartType.bar, [{ name: 'ΔEVA S/', labels: xs.map((x) => x.nombre), values: xs.map((x) => Math.round(x.delta_eva ?? 0)) }], { x: 0.5, y: 1.2, w: 7.4, h: 5.3, barDir: 'bar', chartColors: [verde], valAxisLabelFormatCode: '#,##0', showValue: true, catAxisLabelFontSize: 10, catAxisLabelPos: 'low', showLegend: false });
    s6.addText(`EVA base: ${soles(e.escenarios[0].eva)}. ${e.convencion}`, { x: 8.1, y: 1.3, w: 4.8, h: 3.5, fontSize: 11, color: gris });
  } else s6.addText('Sin evaluación económica seleccionada.', { x: 0.5, y: 1.3, w: 12, h: 1, fontSize: 18 });
  await c.paso('Decisión');
  const s7 = pptx.addSlide(); titulo(s7, 'Decisión recomendada, restricciones y plan');
  s7.addText(s.evaluacion ? s.evaluacion.ev.comparador.conclusion : 'Sin evaluación: no se recomienda un cambio.', { x: 0.5, y: 1.2, w: 12.3, h: 1.6, fontSize: 17, bold: true });
  s7.addText((s.evaluacion?.ev.limitaciones ?? ['Datos sintéticos NutriDemo.']).map((t) => ({ text: t, options: { bullet: true } })), { x: 0.5, y: 3.0, w: 12.3, h: 3.6, fontSize: 13, color: gris });
  await c.paso('Escribiendo el archivo');
  return (await pptx.write({ outputType: typeof window === 'undefined' ? 'arraybuffer' : 'blob' })) as Blob | ArrayBuffer;
}

// ================================================================== Libros 07 / 08 / 09 (se generan con el sistema tras congelar)
export interface HojaLibro { nombre: string; descripcion: string; filas: Record<string, unknown>[]; totales?: boolean; nota?: string }
/** Convierte columnas de unidades internas: *_mil → unidad base, *_cent → soles, *_p4 → decimal. Así ningún valor queda en milésimas sin explicar. */
function convertir(f: Record<string, unknown>) {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) {
    if (typeof v === 'number' && /_mil$/.test(k)) o[k.replace(/_mil$/, '')] = v / 1000;
    else if (typeof v === 'number' && /_cent$/.test(k)) o[k.replace(/_cent$/, '_soles')] = v / 100;
    else if (typeof v === 'number' && /_p4$/.test(k)) o[k.replace(/_p4$/, '')] = v / 10000;
    else if (typeof v === 'number' && /_ppm$/.test(k)) o[k.replace(/_ppm$/, '_prob')] = v / 1e6;
    else o[k] = v === null || v === undefined ? '' : v;
  }
  return o;
}
/** Libro con LEEME (índice), Metadatos, Diccionario de convenciones y una hoja por tabla; totales con fórmulas SUM verificables. */
/** alcance: qué datos usa el libro; solo se listan en Metadatos los campos de selección que el libro realmente aplica. */
export interface AlcanceLibro { texto: string; incluir: string[] }
const META_BASE = ['Conjunto activo', 'RUN-ID de la exportación', 'Generado (Lima)', 'Dataset', 'SHA-256 de la carga', 'Build', 'Modalidad', 'Unidades'];
export async function exportarLibro(titulo: string, s: Snapshot, hojas: HojaLibro[], c: Control = sinControl, alcance?: AlcanceLibro): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema de Distribución Alprosa'; wb.calcProperties = { fullCalcOnLoad: true };
  await c.paso('Índice');
  const le = wb.addWorksheet('LEEME');
  le.getColumn(1).width = 28; le.getColumn(2).width = 110; le.getColumn(3).width = 10;
  le.addRow([titulo]); le.getRow(1).font = { bold: true, size: 14 };
  le.addRow([`${ETIQUETA}. Generado por el sistema (RUN-ID ${s.runId}, build ${s.build}, ${s.modalidad}) el ${s.generadoEn}. Ninguna cifra se escribió a mano.`]);
  le.addRow([]); le.addRow(['Hoja', 'Contenido', 'Filas']); le.getRow(4).font = { bold: true };
  for (const h of hojas) le.addRow([h.nombre, h.descripcion, h.filas.length]);
  const meta = wb.addWorksheet('Metadatos');
  meta.columns = [{ header: 'campo', width: 30 }, { header: 'valor', width: 90 }];
  (alcance ? [['Alcance del libro', alcance.texto] as [string, string], ...metaFilas(s).filter(([k]) => META_BASE.includes(k) || alcance.incluir.includes(k))] : metaFilas(s)).forEach((f) => meta.addRow(f)); meta.getRow(1).font = { bold: true };
  const dic = wb.addWorksheet('Diccionario');
  dic.columns = [{ header: 'convención', width: 34 }, { header: 'significado', width: 100 }]; dic.getRow(1).font = { bold: true };
  for (const r of [['columnas de cantidad', 'Unidad base del producto (kg o unidad); en la base se guardan en milésimas (*_mil) y aquí se muestran convertidas.'],
    ['columnas *_soles', 'Soles (PEN) nominales; en la base se guardan en céntimos.'], ['fechas e instantes', 'ISO 8601 con desfase −05:00 (America/Lima).'],
    ['vacío', 'Dato no aplicable o no registrado; no equivale a cero.'], ['N/D', 'No calculable (denominador cero o falta de datos).'], ['fila TOTAL', 'Suma con fórmula SUM, recalculable por Excel/LibreOffice.']]) dic.addRow(r);
  for (const h of hojas) {
    await c.paso(h.nombre);
    const ws = wb.addWorksheet(h.nombre.slice(0, 31));
    if (!h.filas.length) { ws.getColumn(1).width = 100; ws.addRow([`Sin registros. ${h.nota ?? ''}`]); continue; }
    const filas = h.filas.map(convertir);
    const cols = [...new Set(filas.flatMap((f) => Object.keys(f)))];
    ws.addRow(cols); ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }];
    cols.forEach((k, i) => { ws.getColumn(i + 1).width = Math.min(48, Math.max(10, k.length + 2, ...filas.slice(0, 50).map((f) => String(f[k] ?? '').length + 1))); });
    for (const f of filas) ws.addRow(cols.map((k) => f[k] ?? ''));
    if (h.totales) {
      const n = filas.length + 1;
      ws.addRow(cols.map((k, i) => {
        const L = ws.getColumn(i + 1).letter;
        if (i === 0) return 'TOTAL';
        const num = filas.every((f) => f[k] === '' || typeof f[k] === 'number') && filas.some((f) => typeof f[k] === 'number') && !/(^|_)(id|tramo|viaje|intento|linea|version|semana|anio|mes|n|dias|h|tasa|tipo_cambio|ppm|p4)$/.test(k) && !/(pct|acumulado|wape|mae|_p\d+|media|prob)/.test(k);
        return num ? { formula: `SUM(${L}2:${L}${n})`, result: filas.reduce((a, f) => a + (typeof f[k] === 'number' ? (f[k] as number) : 0), 0) } : '';
      }));
      ws.getRow(n + 1).font = { bold: true };
    }
    if (h.nota) { ws.addRow([]); ws.addRow([h.nota]); }
  }
  await c.paso('Escribiendo el archivo');
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
