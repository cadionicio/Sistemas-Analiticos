// Generación del informe técnico (.docx) y de la presentación ejecutiva (.pptx) desde el contenido calculado.
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, ShadingType, BorderStyle, Footer, PageNumber, TableLayoutType } from "docx";
import PptxGenJS from "pptxgenjs";
import { Store } from "../db/store";
import { Contexto } from "./usecases";
import { construirInforme, ContenidoInforme, Tabla, m, n2, pc } from "./informe";
import { mesCortoTxt } from "./util";
import { variablePorId } from "../domain/simulacion";

const AZUL = "2A78D6", NAR = "EB6834", GRIS = "52514E", TINTA = "1D2E50", MORADO = "6554C8", SUAVE = "F3F5FB";

// ---------------- Word ----------------
const borde = { style: BorderStyle.SINGLE, size: 4, color: "DFE4F0" };
function tablaDocx(t: Tabla) {
  const anchoTotal = 9360; // twips aprox. A4 con márgenes 2,5 cm
  const n = t.cab.length;
  // Anchos por contenido: una cifra nunca se parte en dos líneas y un encabezado no corta palabras.
  const palabra = (x: string) => Math.max(0, ...String(x || "").split(/\s+/).map((w) => w.length));
  const medir = (size: number) => {
    const cw = (size / 2) * 20 * 0.56, pad = 190;
    const min = t.cab.map((h, i) => (t.num?.[i] ? Math.max(...t.filas.map((f) => String(f[i] || "").length), palabra(h)) : Math.max(palabra(h), ...t.filas.map((f) => palabra(f[i])))) * cw + pad);
    const des = t.cab.map((h, i) => (t.num?.[i] ? min[i] : Math.min(30, Math.max(h.length * 0.6, ...t.filas.map((f) => String(f[i] || "").length))) * cw + pad));
    return { min, des: des.map((d, i) => Math.max(d, min[i])) };
  };
  let tam = 17, M = medir(tam);
  while (tam > 13 && M.min.reduce((a, b) => a + b, 0) > anchoTotal) { tam -= 1; M = medir(tam); }
  const sMin = M.min.reduce((a, b) => a + b, 0), extra = Math.max(0, anchoTotal - sMin);
  const holg = M.des.map((d, i) => d - M.min[i]), sH = holg.reduce((a, b) => a + b, 0);
  let anchos = sMin > anchoTotal
    ? M.min.map((x) => Math.floor((anchoTotal * x) / sMin))
    : M.min.map((x, i) => Math.floor(x + (sH > 0 ? (extra * holg[i]) / sH : extra / n)));
  const resto = anchoTotal - anchos.reduce((a, b) => a + b, 0);
  if (resto > 0 && sH <= 0) anchos = anchos.map((a) => a + Math.floor(resto / n));
  let col = 0;
  const celda = (txt: string, cab: boolean, num: boolean, total = false) =>
    new TableCell({
      width: { size: anchos[col++ % n], type: WidthType.DXA },
      shading: cab ? { type: ShadingType.CLEAR, color: "auto", fill: MORADO } : total ? { type: ShadingType.CLEAR, color: "auto", fill: SUAVE } : undefined,
      borders: { top: borde, bottom: borde, left: borde, right: borde },
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      children: [new Paragraph({ alignment: num && !cab ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: txt, bold: cab || total, color: cab ? "FFFFFF" : txt.startsWith("-") && num ? "C00000" : TINTA, size: tam })] })],
    });
  const filas = [
    new TableRow({ tableHeader: true, children: t.cab.map((c) => celda(c, true, false)) }),
    ...t.filas.map((f) => new TableRow({ children: f.map((v, i) => celda(v, false, !!t.num?.[i], f[0] === "Total")) })),
  ];
  return [
    new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: t.titulo, bold: true, color: TINTA, size: 20 })] }),
    new Table({ rows: filas, width: { size: anchoTotal, type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: anchos }),
    ...(t.nota ? [new Paragraph({ children: [new TextRun({ text: t.nota, italics: true, size: 16, color: GRIS })] })] : []),
  ];
}

export async function exportarInformeDocx(s: Store, c: Contexto, propPct: Record<string, number> = {}) {
  const C = construirInforme(s, c, propPct);
  const p = (t: string, opt: any = {}) => new Paragraph({ spacing: { after: 120, line: 300 }, children: [new TextRun({ text: t, size: 21, color: TINTA, ...opt })] });
  const hijos: any[] = [
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: C.titulo, bold: true, size: 40, color: MORADO })] }),
    new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: C.subtitulo, size: 24, color: GRIS })] }),
    ...(C.sintetico ? [p("DATOS SINTÉTICOS: empresa ficticia; las cifras no describen una empresa real.", { bold: true, color: "B45309" })] : []),
    ...tablaDocx({ titulo: "Datos del informe", cab: ["Campo", "Valor"], filas: C.meta.map(([a, b]) => [a, b]) }),
    ...tablaDocx({ titulo: "Indicadores clave", cab: ["Indicador", "Valor", "Detalle"], num: [false, true, false], filas: C.kpis.map((k) => [k.lbl, k.val, k.sub]) }),
  ];
  C.secciones.forEach((sec, i) => {
    hijos.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: i === 0, spacing: { before: 280, after: 120 }, children: [new TextRun({ text: `${i + 1}. ${sec.titulo}`, bold: true, size: 28, color: MORADO })] }));
    for (const t of sec.parrafos) hijos.push(p(t));
    for (const v of sec.vinetas || []) hijos.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: v, size: 21, color: TINTA })] }));
    for (const t of sec.tablas || []) hijos.push(...tablaDocx(t));
  });
  const doc = new Document({
    creator: "César Alonso Dionicio Achachagua", lastModifiedBy: "César Alonso Dionicio Achachagua", title: C.titulo, description: C.subtitulo,
    styles: { default: { document: { run: { font: "Calibri" } } } },
    sections: [{
      properties: { page: { margin: { top: 1418, bottom: 1418, left: 1418, right: 1418 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${C.subtitulo} · página `, size: 16, color: GRIS }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GRIS })] })] }) },
      children: hijos,
    }],
  });
  const blob = await Packer.toBlob(doc);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { nombre: `Informe_Tecnico_${C.mod.codigo}_${C.per.codigo}.docx`, bytes, secciones: C.secciones.length };
}

// ---------------- PowerPoint ----------------
export async function exportarPresentacion(s: Store, c: Contexto, propPct: Record<string, number> = {}) {
  const C = construirInforme(s, c, propPct);
  const A = C.A;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13,33 × 7,5 in
  pptx.author = "César Alonso Dionicio Achachagua";
  pptx.title = C.titulo;
  const W = 13.33;
  const cab = (sl: any, titulo: string, sub = "") => {
    sl.background = { color: "FFFFFF" };
    sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: MORADO }, line: { color: MORADO } });
    sl.addText(titulo, { x: 0.5, y: 0.3, w: W - 1, h: 0.6, fontFace: "Calibri", fontSize: 26, bold: true, color: TINTA });
    if (sub) sl.addText(sub, { x: 0.5, y: 0.85, w: W - 1, h: 0.4, fontFace: "Calibri", fontSize: 13, color: GRIS });
    sl.addText(`${C.subtitulo}${C.sintetico ? " · DATOS SINTÉTICOS" : ""}`, { x: 0.5, y: 7.05, w: W - 1, h: 0.3, fontSize: 9, color: GRIS });
  };
  const tabla = (sl: any, t: Tabla, x: number, y: number, w: number, fs = 10) => {
    const rows = [t.cab.map((h) => ({ text: h, options: { bold: true, color: "FFFFFF", fill: { color: MORADO }, fontSize: fs } })),
      ...t.filas.map((f) => f.map((v, i) => ({ text: v, options: { fontSize: fs, color: v.startsWith("-") && t.num?.[i] ? "C00000" : TINTA, align: t.num?.[i] ? "right" : "left", bold: f[0] === "Total" } })))];
    sl.addTable(rows, { x, y, w, border: { type: "solid", color: "DFE4F0", pt: 0.75 }, autoPage: false, fontFace: "Calibri" });
  };
  // 1 portada
  let sl = pptx.addSlide();
  sl.background = { color: "FFFFFF" };
  sl.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: MORADO }, line: { color: MORADO } });
  sl.addText("Costeo de la cadena de suministro", { x: 0.9, y: 2.0, w: 11.5, h: 0.9, fontSize: 40, bold: true, color: TINTA });
  sl.addText(C.subtitulo, { x: 0.9, y: 2.9, w: 11.5, h: 0.5, fontSize: 20, color: GRIS });
  sl.addText(`Presentación ejecutiva · ${new Date().toLocaleDateString("es-PE")}${C.sintetico ? " · DATOS SINTÉTICOS (empresa ficticia)" : ""}`, { x: 0.9, y: 3.6, w: 11.5, h: 0.4, fontSize: 14, color: C.sintetico ? "B45309" : GRIS });
  sl.addText(C.meta[0][1], { x: 0.9, y: 6.4, w: 11.5, h: 0.5, fontSize: 11, color: GRIS });
  // 2 indicadores
  sl = pptx.addSlide();
  cab(sl, "Indicadores clave", "Cifras de las corridas del motor y de las simulaciones guardadas");
  C.kpis.forEach((k, i) => {
    const x = 0.5 + (i % 3) * 4.15, y = 1.5 + Math.floor(i / 3) * 2.6;
    sl.addShape(pptx.ShapeType.roundRect, { x, y, w: 3.95, h: 2.35, fill: { color: SUAVE }, line: { color: "DFE4F0" }, rectRadius: 0.08 });
    sl.addText(k.lbl, { x: x + 0.2, y: y + 0.15, w: 3.6, h: 0.5, fontSize: 13, color: GRIS });
    sl.addText(k.val, { x: x + 0.2, y: y + 0.7, w: 3.6, h: 0.8, fontSize: 28, bold: true, color: k.val.startsWith("S/ -") ? "C00000" : TINTA });
    sl.addText(k.sub, { x: x + 0.2, y: y + 1.55, w: 3.6, h: 0.6, fontSize: 11, color: GRIS });
  });
  // 3 tendencia y pronóstico
  const P0 = A.pronosticos[0];
  if (P0) {
    sl = pptx.addSlide();
    cab(sl, "Costo mensual: histórico, presupuesto y pronóstico", `Pronóstico a 6 meses con «${P0.elegidoNombre}» (backtesting) · S/ por mes`);
    const labels = [...A.filas.map((f) => mesCortoTxt(f.periodo)), ...P0.futuro.map((f) => mesCortoTxt(f.periodo))];
    const nh = A.filas.length;
    const hist = [...A.filas.map((f) => f.total), ...P0.futuro.map(() => null)];
    const ppto = [...A.filas.map((f) => f.ppto), ...P0.futuro.map(() => null)];
    const fut = [...A.filas.map((_, i) => (i === nh - 1 ? A.filas[i].total : null)), ...P0.futuro.map((f) => f.central)];
    const vals = [...hist, ...ppto, ...fut].filter((v) => v !== null && isFinite(v as number)) as number[];
    const eje = Math.floor((Math.min(...vals) * 0.95) / 10000) * 10000;
    sl.addChart(pptx.ChartType.line, [
      { name: "Histórico (real)", labels, values: hist },
      ...(ppto.some((v) => v !== null) ? [{ name: "Presupuestado", labels, values: ppto }] : []),
      { name: "Pronosticado", labels, values: fut },
    ] as any, { x: 0.5, y: 1.4, w: W - 1, h: 5.4, lineSize: 2, lineDataSymbol: "none", chartColors: [AZUL, GRIS, NAR], showLegend: true, legendPos: "t", legendFontSize: 12,
      catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, valAxisLabelFormatCode: "#,##0", valAxisMinVal: eje, valGridLine: { color: "E6E9F2", size: 0.5 }, catGridLine: { style: "none" }, displayBlanksAs: "gap" } as any);
  }
  // 4 costo por objeto y componentes
  const F = A.filas.find((f) => f.periodoId === c.periodoId) || A.ultima;
  sl = pptx.addSlide();
  {
    const muchos = A.objetos.length > 12;
    const orden = [...A.objetos].filter((o) => F.objetos[o.codigo]).sort((a, b) => (F.objetos[b.codigo]?.costo || 0) - (F.objetos[a.codigo]?.costo || 0));
    const sel = muchos ? orden.slice(0, 12) : A.objetos;
    const tit = muchos ? `Costo del mes por objeto (S/) · 12 de mayor costo de ${orden.length}` : "Costo por pedido (S/)";
    cab(sl, `Costo por objeto y por componente · ${F.nombre}`, muchos ? `Costo ABC asignado a los objetos de costo; los otros ${orden.length - 12} suman ${m(orden.slice(12).reduce((a, o) => a + (F.objetos[o.codigo]?.costo || 0), 0))}` : "Costo ABC asignado a cada objeto de costo y su costo por pedido");
    sl.addChart(pptx.ChartType.bar, [{ name: tit, labels: sel.map((o) => o.nombre), values: sel.map((o) => Math.round((muchos ? F.objetos[o.codigo]?.costo : F.objetos[o.codigo]?.unitario) || 0) * 100 / 100) }] as any,
      { x: 0.5, y: 1.4, w: 6.2, h: 5.3, barDir: "bar", chartColors: [AZUL], showValue: true, dataLabelFormatCode: muchos ? "#,##0" : "#,##0.00", dataLabelFontSize: 10, catAxisLabelFontSize: 10, catAxisOrientation: "maxMin", valAxisHidden: true, valGridLine: { style: "none" }, showLegend: false, showTitle: true, title: tit, titleFontSize: 12 } as any);
  }
  tabla(sl, C.secciones[2].tablas![1], 7.0, 1.6, 5.8, 12);
  // 5 diagnóstico
  sl = pptx.addSlide();
  cab(sl, "Diagnóstico: real vs presupuesto y hallazgos", "Variación mensual (S/): positivo = por encima del presupuesto");
  const vs = A.varPpto.slice(-12);
  if (vs.length) sl.addChart(pptx.ChartType.bar, [{ name: "Variación (S/)", labels: vs.map((v) => mesCortoTxt(v.periodo)), values: vs.map((v) => Math.round(v.variacion)) }] as any,
    { x: 0.5, y: 1.4, w: 7.0, h: 5.3, barDir: "col", chartColors: [AZUL], invertIfNegative: false, valAxisLabelFormatCode: "#,##0", valAxisLabelFontSize: 10, catAxisLabelFontSize: 10, valGridLine: { color: "E6E9F2", size: 0.5 }, showLegend: false } as any);
  sl.addText(A.hallazgos.slice(0, 5).map((h) => ({ text: `${h.tipo}: ${h.texto}`, options: { bullet: true, fontSize: 12, color: TINTA, paraSpaceAfter: 6 } })) as any, { x: 7.8, y: 1.4, w: 5.0, h: 5.3, valign: "top" });
  // 6 Pareto
  const pa = A.paretoAct.slice(0, 10) as any[];
  sl = pptx.addSlide();
  cab(sl, "Relevancia: actividades que concentran el costo", `Pareto del costo acumulado de ${A.filas.length} meses (S/)`);
  sl.addChart(pptx.ChartType.bar, [{ name: "Costo acumulado", labels: pa.map((x) => `${x.item.codigo} ${x.item.nombre}`), values: pa.map((x) => Math.round(x.valor)) }] as any,
    { x: 0.5, y: 1.4, w: 8.2, h: 5.4, barDir: "bar", chartColors: [AZUL], showValue: true, dataLabelFormatCode: "#,##0", dataLabelFontSize: 10, catAxisLabelFontSize: 10, catAxisOrientation: "maxMin", valAxisHidden: true, valGridLine: { style: "none" }, showLegend: false } as any);
  sl.addText(pa.map((x) => ({ text: `${x.item.codigo}: ${pc(x.acumulado)} acum. · clase ${x.clase}${x.item.clase ? " · " + x.item.clase : ""}`, options: { fontSize: 11, color: TINTA, breakLine: true } })) as any, { x: 9.0, y: 1.5, w: 3.9, h: 5.2, valign: "top" });
  // 7 escenarios
  if (C.sims.length) {
    sl = pptx.addSlide();
    cab(sl, "Escenarios y Monte Carlo", `Período base ${C.per.nombre} · cada iteración pasa por el motor ABC · variables independientes (supuesto)`);
    tabla(sl, { titulo: "", cab: ["Escenario", "Semilla", "Iteraciones", "P5 (S/)", "P50 (S/)", "P95 (S/)", "P(> presupuesto)", "EVA P50 (S/)"], num: [false, true, true, true, true, true, true, true],
      filas: C.sims.map((x) => [x.escenario, String(x.semilla), String(x.r.validas), n2(x.r.costo.p5), n2(x.r.costo.p50), n2(x.r.costo.p95), pc(x.r.costo.probSupera), x.r.eva ? n2(x.r.eva.p50) : "—"]) }, 0.5, 1.4, W - 1, 12);
    const base = C.sims.find((x) => x.escenario === "Base");
    if (base) {
      const fs = base.r.sensibilidad.filas;
      sl.addChart(pptx.ChartType.bar, [{ name: "Rango de costo (S/)", labels: fs.map((f: any) => variablePorId(f.variable)?.nombre || f.variable), values: fs.map((f: any) => Math.round(f.rango)) }] as any,
        { x: 0.5, y: 3.7, w: 7.5, h: 3.2, barDir: "bar", chartColors: [NAR], showValue: true, dataLabelFormatCode: "#,##0", catAxisOrientation: "maxMin", valAxisHidden: true, valGridLine: { style: "none" }, showLegend: false, showTitle: true, title: "Sensibilidad (escenario Base): rango de costo por variable", titleFontSize: 12 } as any);
      sl.addText([{ text: `P(costo > presupuesto) en Base: ${pc(base.r.costo.probSupera)}`, options: { bold: true, fontSize: 14, color: TINTA, breakLine: true } }, { text: `EVA P50 Base: ${m(base.r.eva?.p50)}`, options: { fontSize: 13, color: TINTA, breakLine: true } }, { text: "Estimaciones bajo supuestos; no son pronósticos garantizados.", options: { fontSize: 11, color: GRIS } }] as any, { x: 8.3, y: 4.2, w: 4.6, h: 2.4, valign: "top" });
    }
  }
  // 8 propuestas y ΔEVA
  sl = pptx.addSlide();
  cab(sl, "Propuestas de mejora e impacto en EVA", "ΔEVA = ahorro anual × (1 − T) − WACC × inversión · supuestos editables");
  const props = C.alt.props;
  sl.addChart(pptx.ChartType.bar, [{ name: "ΔEVA anual (S/)", labels: props.map((p) => p.titulo), values: props.map((p) => Math.round(p.dEva ?? 0)) }] as any,
    { x: 0.5, y: 1.4, w: 7.4, h: 5.4, barDir: "bar", chartColors: [AZUL], showValue: true, dataLabelFormatCode: "#,##0", catAxisOrientation: "maxMin", catAxisLabelFontSize: 10, valAxisHidden: true, valGridLine: { style: "none" }, showLegend: false } as any);
  sl.addText([
    { text: `Plan: ${C.alt.plan.ids.length} de ${props.length} propuestas`, options: { bold: true, fontSize: 16, color: TINTA, breakLine: true } },
    { text: `Ahorro anual: ${m(C.alt.plan.ahorroAnual)}`, options: { fontSize: 14, color: TINTA, breakLine: true } },
    { text: `Inversión: ${m(C.alt.plan.inversion)}`, options: { fontSize: 14, color: TINTA, breakLine: true } },
    { text: `ΔEVA: ${m(C.alt.plan.dEva)}`, options: { fontSize: 18, bold: true, color: AZUL, breakLine: true } },
    { text: "Heurística evaluada, no optimización matemática.", options: { fontSize: 11, color: GRIS } },
  ] as any, { x: 8.2, y: 1.6, w: 4.7, h: 4.5, valign: "top" });
  // 9 EVA
  const secEva = C.secciones.find((x) => x.titulo.startsWith("Impacto"));
  sl = pptx.addSlide();
  cab(sl, "Valor económico agregado (EVA)", C.sintetico ? "ILUSTRATIVO: datos financieros sintéticos; cálculo real · periodicidad anual" : "Periodicidad anual");
  if (secEva?.tablas?.length) tabla(sl, secEva.tablas[0], 0.5, 1.4, 6.5, 12);
  else sl.addText(secEva?.parrafos.join("\n") || "EVA no calculable", { x: 0.5, y: 1.5, w: 12, h: 2, fontSize: 14, color: TINTA });
  sl.addText([{ text: "EVA = NOPAT − WACC × Capital invertido", options: { fontSize: 16, bold: true, color: TINTA, breakLine: true } }, { text: "WACC = Ke·E/(D+E) + Kd·(1−T)·D/(D+E)", options: { fontSize: 14, color: TINTA, breakLine: true } }, { text: "El costo del capital no se suma al costo logístico (sin doble conteo).", options: { fontSize: 12, color: GRIS } }] as any, { x: 7.4, y: 1.6, w: 5.5, h: 3, valign: "top" });
  // 10 cronograma
  sl = pptx.addSlide();
  cab(sl, "Plan de implementación (cronograma referencial)", "Meses desde el inicio; el plazo de cada propuesta es un supuesto editable");
  const meses = 6;
  const rows: any[] = [[{ text: "Propuesta", options: { bold: true, color: "FFFFFF", fill: { color: MORADO } } }, { text: "Responsable", options: { bold: true, color: "FFFFFF", fill: { color: MORADO } } }, ...Array.from({ length: meses }, (_, i) => ({ text: `M${i + 1}`, options: { bold: true, color: "FFFFFF", fill: { color: MORADO }, align: "center" } })), { text: "KPI", options: { bold: true, color: "FFFFFF", fill: { color: MORADO } } }]];
  for (const p of props) rows.push([{ text: p.titulo, options: { fontSize: 10 } }, { text: p.responsable, options: { fontSize: 10 } }, ...Array.from({ length: meses }, (_, i) => ({ text: "", options: { fill: { color: i < p.plazoMeses ? AZUL : "FFFFFF" } } })), { text: p.kpi, options: { fontSize: 10 } }]);
  sl.addTable(rows, { x: 0.5, y: 1.5, w: W - 1, colW: [3.6, 2.4, 0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 2.53], border: { type: "solid", color: "DFE4F0", pt: 0.75 }, fontSize: 11, color: TINTA, fontFace: "Calibri" });
  // 11 supuestos
  const sup = C.secciones.at(-1)!;
  sl = pptx.addSlide();
  cab(sl, "Conclusiones y supuestos", "Las conclusiones dependen de los datos y supuestos declarados");
  const concl = C.secciones.find((x) => x.titulo === "Conclusiones")!;
  sl.addText(concl.vinetas!.map((t) => ({ text: t, options: { bullet: true, fontSize: 13, color: TINTA, paraSpaceAfter: 8 } })) as any, { x: 0.5, y: 1.4, w: 6.2, h: 5.4, valign: "top" });
  sl.addText(sup.vinetas!.map((t) => ({ text: t, options: { bullet: true, fontSize: 11, color: GRIS, paraSpaceAfter: 6 } })) as any, { x: 7.0, y: 1.4, w: 5.8, h: 5.4, valign: "top" });
  const bytes = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  return { nombre: `Presentacion_Ejecutiva_${C.mod.codigo}_${C.per.codigo}.pptx`, bytes, diapositivas: (pptx as any).slides?.length ?? 11 };
}
