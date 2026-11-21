// Exportación del entregable 07_Resultados_Analitica.xlsx desde las corridas guardadas (todos los períodos).
// Las cifras derivadas llevan fórmulas Excel visibles (variación, efectos, regresión, Pareto, propuestas).
import { Store, APP_VERSION } from "../db/store";
import { Contexto } from "./usecases";
import { construirAnalitica } from "./analitica";
import { NOMBRE_OFICIAL_EXPORT } from "./nombres";

const FMT = '#,##0.00;[Red]-#,##0.00';
const FMT0 = '#,##0;[Red]-#,##0';
const FMTP = '0.00%;[Red]-0.00%';
const L = (c: number) => { let s = ""; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };

export interface Export07Info { nombre: string; bytes: Uint8Array; hojas: string[]; runs: number }

export async function exportar07(ExcelJS: any, s: Store, c: Contexto, propPct: Record<string, number> = {}): Promise<Export07Info> {
  const A = construirAnalitica(s, c);
  if (!A || !A.filas.length) throw new Error("No hay corridas guardadas: ejecuta el costeo de los períodos antes de exportar la analítica.");
  if (A.faltantes.length) throw new Error(`Faltan corridas en ${A.faltantes.length} período(s) (${A.faltantes.slice(0, 3).join(", ")}…). Ejecuta el costeo de todos los períodos.`);
  if (A.desactualizados.length) throw new Error(`Hay ${A.desactualizados.length} corrida(s) desactualizada(s): vuelve a ejecutar el costeo de todos los períodos para exportar cifras vigentes.`);
  const mod = s.one("SELECT * FROM modelo WHERE id=?", [c.modeloId])!;
  const ver = s.one("SELECT * FROM modelo_version WHERE id=?", [c.versionId])!;
  const emp = s.one("SELECT * FROM empresa WHERE id=?", [c.empresaId])!;
  const wb = new ExcelJS.Workbook();
  wb.creator = NOMBRE_OFICIAL_EXPORT;
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  const hojas: string[] = [];
  const ini = A.filas[0], fin = A.ultima;
  const nueva = (n: string, titulo: string, nota = "", frz = 5) => {
    hojas.push(n);
    const ws = wb.addWorksheet(n, { views: [{ state: "frozen", xSplit: 1, ySplit: frz }] });
    ws.getCell("A1").value = titulo;
    ws.getCell("A1").font = { bold: true, size: 13, color: { argb: "FF1D2E50" } };
    ws.getCell("A2").value = `Modelo ${mod.codigo} · ${mod.nombre} · v${ver.numero} · ${ini.nombre} – ${fin.nombre} · ${A.filas.length} corridas${emp.sintetico ? " · DATOS SINTÉTICOS" : ""}`;
    ws.getCell("A2").font = { size: 9, color: { argb: "FF5B6B88" } };
    if (nota) { ws.getCell("A3").value = nota; ws.getCell("A3").font = { italic: true, size: 9, color: { argb: "FF5B6B88" } }; }
    return ws;
  };
  const enc = (ws: any, fila: number, cols: string[], desde = 1) => {
    cols.forEach((t, i) => {
      const cl = ws.getCell(fila, desde + i);
      cl.value = t;
      cl.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6554C8" } };
      cl.alignment = { wrapText: true, vertical: "middle" };
    });
    ws.getRow(fila).height = 32;
  };
  const anchos = (ws: any, w: number[]) => w.forEach((x, i) => (ws.getColumn(i + 1).width = x));
  const fmtCols = (ws: any, f0: number, f1: number, cols: number[], fmt = FMT) => { for (let r = f0; r <= f1; r++) for (const k of cols) ws.getCell(r, k).numFmt = fmt; };

  // ---- Portada ----
  const P = nueva("Portada", "07 · Analítica de costos de la cadena de suministro", "", 0);
  const filasPort: [string, any][] = [
    ["Sistema", NOMBRE_OFICIAL_EXPORT], ["Modelo", `${mod.codigo} · ${mod.nombre}`], ["Versión del modelo", ver.numero], ["Empresa", emp.nombre + (emp.sintetico ? " (datos sintéticos)" : "")],
    ["Períodos analizados", `${ini.nombre} – ${fin.nombre} (${A.filas.length} meses)`], ["Período actual del análisis", fin.nombre],
    ["Corridas usadas (run_id)", `${ini.runId} … ${fin.runId} (detalle en Serie_Mensual)`], ["Versión de la aplicación", APP_VERSION], ["Generado", new Date().toLocaleString("es-PE")],
    ["Contenido", "Serie mensual, diagnóstico vs presupuesto, regresión costo~volumen, anomalías, pronósticos con backtesting, Pareto, hallazgos y propuestas"],
    ["Nota", "Correlación no implica causalidad. Las bandas de pronóstico son aproximadas (80 %). Las propuestas usan supuestos editables, no optimización global."],
  ];
  filasPort.forEach(([k, v], i) => { P.getCell(4 + i, 1).value = k; P.getCell(4 + i, 1).font = { bold: true }; P.getCell(4 + i, 2).value = v; });
  anchos(P, [30, 110]);

  // ---- Serie mensual (con fórmulas de total, unitario y variación) ----
  const S = nueva("Serie_Mensual", "Serie mensual de costos (corridas guardadas)", "Total = CMD + CSD + CPD + CI (fórmula). Costo/pedido = Total / Pedidos. Variación = Total − Presupuesto.");
  const cabS = ["Período", "Código", "run_id", "CMD (P1)", "CSD (P2)", "CPD (P3)", "CI (P4)", "Total cadena", "Pedidos", "Costo / pedido", "AV", "NAVN", "NAVI", "Capacidad no utilizada", "Fuera de alcance", "Presupuesto costo", "Presupuesto pedidos", "Variación vs ppto.", "Variación %"];
  enc(S, 5, cabS);
  A.filas.forEach((f, i) => {
    const r = 6 + i;
    S.getRow(r).values = [f.nombre, f.periodo, f.runId, f.cmd, f.csd, f.cpd, f.ci, null, f.volumen, null, f.av, f.nav, f.navi, f.capacidad, f.fuera, f.ppto, f.pptoVol, null, null];
    S.getCell(r, 8).value = { formula: `SUM(D${r}:G${r})`, result: f.total };
    S.getCell(r, 10).value = { formula: `IF(I${r}>0,H${r}/I${r},"")`, result: f.unitario ?? "" };
    if (f.ppto !== null) {
      S.getCell(r, 18).value = { formula: `H${r}-P${r}`, result: f.total - f.ppto };
      S.getCell(r, 19).value = { formula: `IF(P${r}<>0,R${r}/P${r},"")`, result: f.ppto ? (f.total - f.ppto) / f.ppto : "" };
    }
  });
  const nS = 6 + A.filas.length;
  S.getCell(nS, 1).value = "Total";
  S.getRow(nS).font = { bold: true };
  for (const k of [4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18]) S.getCell(nS, k).value = { formula: `SUM(${L(k)}6:${L(k)}${nS - 1})` };
  S.getCell(nS, 10).value = { formula: `IF(I${nS}>0,H${nS}/I${nS},"")` };
  fmtCols(S, 6, nS, [4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 18]);
  fmtCols(S, 6, nS, [9, 17], FMT0);
  fmtCols(S, 6, nS - 1, [19], FMTP);
  anchos(S, [18, 10, 24, 13, 13, 13, 13, 14, 10, 12, 13, 13, 13, 14, 13, 14, 12, 14, 11]);

  // ---- Diagnóstico vs presupuesto (fórmulas de efecto volumen y costo) ----
  const D = nueva("Diagnostico_Presupuesto", "Real vs presupuesto: efecto volumen + efecto costo unitario", "Efecto volumen = (Pedidos reales − Pedidos ppto.) × Costo/pedido ppto. Efecto costo = (Costo/pedido real − Costo/pedido ppto.) × Pedidos reales. Suma = Variación (control).");
  enc(D, 5, ["Período", "Real (S/)", "Pedidos reales", "Presupuesto (S/)", "Pedidos ppto.", "Costo/pedido real", "Costo/pedido ppto.", "Variación", "Efecto volumen", "Efecto costo unitario", "Control (debe ser 0)"]);
  A.varPpto.forEach((v, i) => {
    const r = 6 + i, f = A.filas.find((x) => x.periodo === v.periodo)!;
    D.getRow(r).values = [v.nombre, f.total, f.volumen, f.ppto, f.pptoVol];
    D.getCell(r, 6).value = { formula: `B${r}/C${r}`, result: v.cR };
    D.getCell(r, 7).value = { formula: `D${r}/E${r}`, result: v.cP };
    D.getCell(r, 8).value = { formula: `B${r}-D${r}`, result: v.variacion };
    D.getCell(r, 9).value = { formula: `(C${r}-E${r})*G${r}`, result: v.efVol };
    D.getCell(r, 10).value = { formula: `(F${r}-G${r})*C${r}`, result: v.efCosto };
    D.getCell(r, 11).value = { formula: `ROUND(H${r}-I${r}-J${r},6)`, result: 0 };
  });
  fmtCols(D, 6, 5 + A.varPpto.length, [2, 4, 6, 7, 8, 9, 10, 11]);
  fmtCols(D, 6, 5 + A.varPpto.length, [3, 5], FMT0);
  anchos(D, [18, 14, 12, 14, 12, 13, 13, 13, 13, 14, 12]);

  // ---- Regresión ----
  const G = nueva("Regresion_Volumen", "Asociación costo mensual ~ pedidos (regresión lineal)", "Fórmulas INTERCEPT, SLOPE, RSQ y CORREL sobre la serie mensual. Correlación no implica causalidad.");
  enc(G, 5, ["Período", "Pedidos (x)", "Costo total (y)", "Costo ajustado", "Residuo"]);
  A.filas.forEach((f, i) => {
    const r = 6 + i;
    G.getRow(r).values = [f.nombre, f.volumen, f.total];
    G.getCell(r, 4).value = { formula: `$H$6+$H$7*B${r}`, result: A.regresionVolumen.a + A.regresionVolumen.b * f.volumen };
    G.getCell(r, 5).value = { formula: `C${r}-D${r}` };
  });
  const gE = 5 + A.filas.length;
  [["a (intercepto)", `INTERCEPT(C6:C${gE},B6:B${gE})`, A.regresionVolumen.a], ["b (S/ por pedido)", `SLOPE(C6:C${gE},B6:B${gE})`, A.regresionVolumen.b], ["R²", `RSQ(C6:C${gE},B6:B${gE})`, A.regresionVolumen.r2], ["r (Pearson)", `CORREL(B6:B${gE},C6:C${gE})`, A.regresionVolumen.r]].forEach(([k, fx, v], i) => {
    G.getCell(6 + i, 7).value = k as string; G.getCell(6 + i, 7).font = { bold: true };
    G.getCell(6 + i, 8).value = { formula: fx as string, result: v as number };
    G.getCell(6 + i, 8).numFmt = i < 2 ? FMT : "0.0000;[Red]-0.0000";
  });
  fmtCols(G, 6, gE, [3, 4, 5]);
  fmtCols(G, 6, gE, [2], FMT0);
  anchos(G, [18, 12, 15, 15, 13, 2, 20, 16]);

  // ---- Anomalías ----
  const N = nueva("Anomalias", "Valores atípicos del costo unitario por objeto (|z| ≥ 2)", "Se marcan para revisión; no se eliminan.");
  enc(N, 5, ["Objeto", "Período", "Costo unitario", "Puntaje z"]);
  if (!A.anomalias.length) N.getCell(6, 1).value = "Sin valores atípicos con |z| ≥ 2.";
  A.anomalias.forEach((x, i) => { N.getRow(6 + i).values = [x.objeto, x.nombre, x.valor, x.z]; N.getCell(6 + i, 3).numFmt = FMT; N.getCell(6 + i, 4).numFmt = "0.00;[Red]-0.00"; });
  anchos(N, [14, 18, 15, 11]);

  // ---- Pronósticos ----
  const F = nueva("Pronosticos", "Pronósticos a 6 meses con selección por backtesting temporal", "Entrenamiento: primeros n−6 meses; validación: últimos 6 (sin fuga). Se elige el menor sMAPE y se reajusta con toda la serie. Banda aprox. 80 % = central ± 1,2816 × RMSE × √(h/3,5).", 4);
  let r = 5;
  for (const p of A.pronosticos) {
    F.getCell(r, 1).value = p.serie; F.getCell(r, 1).font = { bold: true, size: 12, color: { argb: "FF6554C8" } };
    F.getCell(r, 4).value = `Método elegido: ${p.elegidoNombre} · Parámetros: ${Object.entries(p.params).map(([k, v]) => `${k}=${v}`).join(", ") || "—"}${p.advertencia ? " · " + p.advertencia : ""}`;
    r++;
    enc(F, r, ["Método", "Elegible", "sMAPE %", "MAE", "RMSE", "MAPE %", "Observación"]);
    r++;
    for (const b of p.backtest) {
      F.getRow(r).values = [b.nombre, b.elegible ? "Sí" : "No", b.smape ?? null, b.mae ?? null, b.rmse ?? null, b.mape !== undefined && isFinite(b.mape) ? b.mape : null, b.id === p.elegido ? "ELEGIDO (menor sMAPE)" : b.motivo || ""];
      for (const k of [3, 4, 5, 6]) F.getCell(r, k).numFmt = FMT;
      if (b.id === p.elegido) F.getRow(r).font = { bold: true };
      r++;
    }
    r++;
    enc(F, r, ["Período", "Código", "Pronóstico central", "Límite inferior", "Límite superior", "Tipo"]);
    r++;
    for (const f of p.futuro) {
      F.getRow(r).values = [f.nombre, f.periodo, f.central, isFinite(f.bajo) ? f.bajo : null, isFinite(f.alto) ? f.alto : null, "PRONOSTICADO"];
      for (const k of [3, 4, 5]) F.getCell(r, k).numFmt = FMT;
      r++;
    }
    r += 2;
  }
  anchos(F, [34, 10, 16, 14, 14, 12, 26]);

  // ---- Pareto ----
  const pareto = (n: string, titulo: string, rows: any[], conClase: boolean) => {
    const W = nueva(n, titulo, "% = costo / total (fórmula). % acumulado = suma corrida (fórmula). Clase A: acumulado previo < 80 %; B: < 95 %; C: resto.");
    const cab = ["#", "Código", "Nombre", ...(conClase ? ["Clase de valor"] : []), "Costo acumulado (S/)", "%", "% acumulado", "Clase ABC"];
    enc(W, 5, cab);
    const kc = conClase ? 5 : 4;
    const e = 5 + rows.length;
    rows.forEach((x, i) => {
      const rr = 6 + i;
      W.getRow(rr).values = [i + 1, x.item.codigo, x.item.nombre, ...(conClase ? [x.item.clase || ""] : []), x.valor];
      W.getCell(rr, kc).numFmt = FMT;
      W.getCell(rr, kc + 1).value = { formula: `IF(SUM($${L(kc)}$6:$${L(kc)}$${e})=0,0,${L(kc)}${rr}/SUM($${L(kc)}$6:$${L(kc)}$${e}))`, result: x.pct };
      W.getCell(rr, kc + 2).value = { formula: `SUM($${L(kc + 1)}$6:${L(kc + 1)}${rr})`, result: x.acumulado };
      W.getCell(rr, kc + 3).value = { formula: rr === 6 ? `"A"` : `IF(${L(kc + 2)}${rr - 1}<0.8,"A",IF(${L(kc + 2)}${rr - 1}<0.95,"B","C"))`, result: x.clase };
      W.getCell(rr, kc + 1).numFmt = FMTP;
      W.getCell(rr, kc + 2).numFmt = FMTP;
    });
    W.getCell(e + 1, 3).value = "Total"; W.getRow(e + 1).font = { bold: true };
    W.getCell(e + 1, kc).value = { formula: `SUM(${L(kc)}6:${L(kc)}${e})` }; W.getCell(e + 1, kc).numFmt = FMT;
    anchos(W, conClase ? [5, 10, 46, 12, 18, 10, 12, 10] : [5, 10, 46, 18, 10, 12, 10]);
  };
  pareto("Pareto_Actividades", "Relevancia: Pareto de actividades (costo acumulado del horizonte)", A.paretoAct.filter((x: any) => x.valor > 0.004), true);
  pareto("Pareto_Elementos", "Relevancia: Pareto de elementos de costo indirecto (P4a)", A.paretoEC.filter((x: any) => x.valor > 0.004), false);

  // ---- Hallazgos ----
  const H = nueva("Hallazgos", "Hallazgos (hecho · asociación · hipótesis)", "Un hecho es una cifra verificable; una asociación es estadística (no causal); una hipótesis requiere evidencia adicional.");
  enc(H, 5, ["Tipo", "Hallazgo", "Evidencia"]);
  A.hallazgos.forEach((x, i) => { H.getRow(6 + i).values = [x.tipo, x.texto, x.evidencia]; H.getRow(6 + i).alignment = { wrapText: true, vertical: "top" }; });
  anchos(H, [14, 100, 50]);

  // ---- Propuestas ----
  const R = nueva("Propuestas", "Propuestas prescriptivas con supuestos editables", "Ahorro = Base × Reducción (fórmula). Recuperación = Inversión / Ahorro. Beneficio 12 meses = Ahorro × 12 − Inversión. Cambia la reducción supuesta (columna F) para evaluar.");
  enc(R, 5, ["ID", "Propuesta", "Causa", "Acción", "Base mensual (S/)", "Reducción supuesta", "Ahorro mensual", "Inversión supuesta", "Recuperación (meses)", "Beneficio neto 12 meses", "Responsable", "KPI", "Riesgo", "Supuesto"]);
  A.propuestas.forEach((p, i) => {
    const rr = 6 + i, pc = propPct[p.id] ?? p.pct;
    R.getRow(rr).values = [p.id, p.titulo, p.causa, p.accion, p.base, pc, null, p.inversion, null, null, p.responsable, p.kpi, p.riesgo, p.supuesto];
    R.getCell(rr, 7).value = { formula: `E${rr}*F${rr}`, result: p.base * pc };
    R.getCell(rr, 9).value = { formula: `IF(G${rr}>0,H${rr}/G${rr},"")`, result: p.base * pc > 0 ? p.inversion / (p.base * pc) : "" };
    R.getCell(rr, 10).value = { formula: `G${rr}*12-H${rr}`, result: p.base * pc * 12 - p.inversion };
    for (const k of [5, 7, 8, 10]) R.getCell(rr, k).numFmt = FMT;
    R.getCell(rr, 6).numFmt = "0.0%;[Red]-0.0%";
    R.getCell(rr, 9).numFmt = "0.0;[Red]-0.0";
    R.getCell(rr, 6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7E0" } };
    R.getRow(rr).alignment = { wrapText: true, vertical: "top" };
  });
  const pe = 5 + A.propuestas.length;
  R.getCell(pe + 1, 2).value = "Total"; R.getRow(pe + 1).font = { bold: true };
  for (const k of [7, 8, 10]) { R.getCell(pe + 1, k).value = { formula: `SUM(${L(k)}6:${L(k)}${pe})` }; R.getCell(pe + 1, k).numFmt = FMT; }
  anchos(R, [12, 34, 30, 40, 14, 11, 13, 13, 12, 15, 22, 24, 22, 34]);

  const buf = await wb.xlsx.writeBuffer();
  const nombre = `Resultados_Analitica_${mod.codigo}_${ini.periodo}_a_${fin.periodo}.xlsx`;
  return { nombre, bytes: new Uint8Array(buf), hojas, runs: A.filas.length };
}
