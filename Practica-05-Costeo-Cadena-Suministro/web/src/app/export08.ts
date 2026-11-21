// Exportación del entregable 08_Proyecciones_Mejoras_EVA.xlsx: proyección 6 meses, escenarios, Monte Carlo, sensibilidad,
// comparativo, alternativas/plan con ΔEVA y EVA base/propuesta. Fórmulas visibles para todo lo derivable en Excel.
import { Store, APP_VERSION } from "../db/store";
import { Contexto } from "./usecases";
import { construirAnalitica } from "./analitica";
import * as SIM from "./simulacion";
import { variablePorId } from "../domain/simulacion";
import { NOMBRE_OFICIAL_EXPORT } from "./nombres";

const FMT = '#,##0.00;[Red]-#,##0.00';
const FMTP = '0.00%;[Red]-0.00%';

export async function exportar08(ExcelJS: any, s: Store, c: Contexto, propPct: Record<string, number> = {}) {
  const ult = SIM.ultimasPorEscenario(s, c);
  if (!ult.size) throw new Error("No hay simulaciones guardadas para el período base: simula al menos un escenario (Simulación → Monte Carlo).");
  const mod = s.one("SELECT * FROM modelo WHERE id=?", [c.modeloId])!;
  const ver = s.one("SELECT * FROM modelo_version WHERE id=?", [c.versionId])!;
  const emp = s.one("SELECT * FROM empresa WHERE id=?", [c.empresaId])!;
  const per = s.one("SELECT * FROM periodo WHERE id=?", [c.periodoId])!;
  const A = construirAnalitica(s, c);
  const ALT = SIM.alternativas(s, c, propPct);
  const ev = ALT.ev;
  const escs = SIM.escenarios(s, c);
  const wb = new ExcelJS.Workbook();
  wb.creator = NOMBRE_OFICIAL_EXPORT;
  wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };
  const hojas: string[] = [];
  const nueva = (n: string, titulo: string, nota = "", frz = 5) => {
    hojas.push(n);
    const ws = wb.addWorksheet(n, { views: [{ state: "frozen", ySplit: frz }] });
    ws.getCell("A1").value = titulo;
    ws.getCell("A1").font = { bold: true, size: 13, color: { argb: "FF1D2E50" } };
    ws.getCell("A2").value = `Modelo ${mod.codigo} · ${mod.nombre} · v${ver.numero} · período base ${per.nombre}${emp.sintetico ? " · DATOS SINTÉTICOS (EVA ILUSTRATIVO)" : ""}`;
    ws.getCell("A2").font = { size: 9, color: { argb: "FF5B6B88" } };
    if (nota) { ws.getCell("A3").value = nota; ws.getCell("A3").font = { italic: true, size: 9, color: { argb: "FF5B6B88" } }; }
    return ws;
  };
  const enc = (ws: any, fila: number, cols: string[]) => {
    cols.forEach((t, i) => {
      const cl = ws.getCell(fila, i + 1);
      cl.value = t;
      cl.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6554C8" } };
      cl.alignment = { wrapText: true, vertical: "middle" };
    });
    ws.getRow(fila).height = 32;
  };
  const anchos = (ws: any, w: number[]) => w.forEach((x, i) => (ws.getColumn(i + 1).width = x));
  const fmt = (ws: any, r: number, cols: number[], f = FMT) => cols.forEach((k) => (ws.getCell(r, k).numFmt = f));
  const titulo = (ws: any, r: number, t: string) => { ws.getCell(r, 1).value = t; ws.getCell(r, 1).font = { bold: true, size: 12, color: { argb: "FF6554C8" } }; };

  // ---- Portada ----
  const P = nueva("Portada", "08 · Proyecciones, mejoras y EVA", "", 0);
  const sims = [...ult.values()];
  [["Sistema", NOMBRE_OFICIAL_EXPORT], ["Modelo", `${mod.codigo} · ${mod.nombre} (v${ver.numero})`], ["Empresa", emp.nombre], ["Período base", per.nombre],
   ["Corrida base (run_id)", sims[0].base_run_id], ["Simulaciones exportadas", sims.map((x) => `${x.escenario}: ${x.id} (semilla ${x.semilla}, ${x.iteraciones} it.)`).join(" · ")],
   ["EVA", ev.calculable ? (ev.sintetico ? "ILUSTRATIVO con datos sintéticos (cálculo real, cifras ficticias)" : "Calculado con datos cargados") : "NO CALCULABLE: " + ev.motivos.join(" ")],
   ["Versión de la aplicación", APP_VERSION], ["Generado", new Date().toLocaleString("es-PE")],
   ["Regla", "Una simulación no modifica costos reales ni corridas. Escenario ≠ simulación. Valor esperado ≠ presupuesto. Las propuestas son heurísticas evaluadas, no una optimización."]]
    .forEach(([k, v], i) => { P.getCell(4 + i, 1).value = k; P.getCell(4 + i, 1).font = { bold: true }; P.getCell(4 + i, 2).value = v; });
  anchos(P, [28, 120]);

  // ---- Proyección 6 meses ----
  const F = nueva("Proyeccion_6_meses", "Proyección a 6 meses (método elegido por backtesting)", "PRONOSTICADO: no es dato histórico. Banda aproximada al 80 %.");
  enc(F, 5, ["Serie", "Método elegido", "Período", "Código", "Pronóstico central", "Límite inferior", "Límite superior", "Tipo"]);
  let r = 6;
  for (const p of A?.pronosticos || []) for (const f of p.futuro) {
    F.getRow(r).values = [p.serie, p.elegidoNombre, f.nombre, f.periodo, f.central, isFinite(f.bajo) ? f.bajo : null, isFinite(f.alto) ? f.alto : null, "PRONOSTICADO"];
    fmt(F, r, [5, 6, 7]);
    r++;
  }
  anchos(F, [38, 34, 16, 10, 16, 14, 14, 14]);

  // ---- Escenarios y variables ----
  const E = nueva("Escenarios_Variables", "Escenarios y variables aleatorias (factores triangulares sobre el período base)", "Media del factor = (mín + moda + máx) / 3 (fórmula). Supuesto: variables independientes.");
  enc(E, 5, ["Escenario", "Variable", "Nombre", "Origen", "Mínimo", "Moda", "Máximo", "Media del factor", "Efecto sobre el modelo"]);
  r = 6;
  for (const e of escs) for (const v of SIM.variablesEscenario(s, c, e)) {
    E.getRow(r).values = [e, v.variable, variablePorId(v.variable)?.nombre || "", v.heredada ? "Heredada de Base" : "Propia", v.minimo, v.moda, v.maximo, null, variablePorId(v.variable)?.efecto || ""];
    E.getCell(r, 8).value = { formula: `(E${r}+F${r}+G${r})/3`, result: (v.minimo + v.moda + v.maximo) / 3 };
    for (const k of [5, 6, 7, 8]) E.getCell(r, k).numFmt = "0.000;[Red]-0.000";
    E.getRow(r).alignment = { wrapText: true, vertical: "top" };
    r++;
  }
  anchos(E, [16, 20, 30, 16, 9, 9, 9, 11, 80]);

  // ---- Monte Carlo ----
  const M = nueva("MonteCarlo", "Monte Carlo: cada iteración pasa por el motor ABC real", "P(> presupuesto) = iteraciones con costo mayor que el presupuesto / iteraciones válidas. % del histograma = n / total (fórmula).", 4);
  r = 5;
  for (const x of sims) {
    const R: SIM.ResumenSim = x.r;
    titulo(M, r, `Escenario ${x.escenario} · ${x.id}`); r++;
    [["Semilla", x.semilla], ["Iteraciones válidas", R.validas], ["Iteraciones bloqueadas (excluidas)", R.bloqueadas], ["Corrida base", x.base_run_id], ["Costo base determinista (S/)", R.costoBase], ["Presupuesto del período (S/)", R.ppto], ["Tiempo (s)", x.ms / 1000]]
      .forEach(([k, v]) => { M.getCell(r, 1).value = k; M.getCell(r, 2).value = v as any; if (typeof v === "number" && v > 1000) M.getCell(r, 2).numFmt = FMT; r++; });
    enc(M, r, ["Indicador", "Media", "Desv. estándar", "Mínimo", "P5", "P50", "P95", "Máximo", "P(> presupuesto)", "P(< 0)"]); r++;
    const fila = (lbl: string, q: any, conProb: boolean, conNeg: boolean) => {
      M.getRow(r).values = [lbl, q.media, q.sd, q.min, q.p5, q.p50, q.p95, q.max, conProb ? q.probSupera : null, conNeg ? q.probNegativo : null];
      fmt(M, r, [2, 3, 4, 5, 6, 7, 8]); fmt(M, r, [9, 10], FMTP); r++;
    };
    fila("Costo de la cadena (S/ por mes)", R.costo, R.ppto !== null, false);
    fila("Costo por pedido (S/)", R.unitario, false, false);
    if (R.eva) fila("EVA anual (S/)", R.eva, false, true);
    r++;
    enc(M, r, ["Convergencia: iteraciones", "Media (S/)", "P50 (S/)", "P95 (S/)"]); r++;
    for (const k of R.convergencia) { M.getRow(r).values = [k.n, k.media, k.p50, k.p95]; fmt(M, r, [2, 3, 4]); r++; }
    r++;
    enc(M, r, ["Histograma: desde (S/)", "hasta (S/)", "Iteraciones", "% (fórmula)"]); r++;
    const h0 = r, h1 = r + R.costo.hist.length - 1;
    for (const b of R.costo.hist) {
      M.getRow(r).values = [b.desde, b.hasta, b.n];
      M.getCell(r, 4).value = { formula: `C${r}/SUM($C$${h0}:$C$${h1})`, result: b.n / (R.validas || 1) };
      fmt(M, r, [1, 2]); M.getCell(r, 4).numFmt = FMTP; r++;
    }
    r += 2;
  }
  anchos(M, [34, 16, 16, 16, 16, 16, 16, 16, 15, 12]);

  // ---- Sensibilidad ----
  const S = nueva("Sensibilidad", "Sensibilidad uno a la vez (motor ABC real): cada variable en su mínimo y máximo, las demás en su moda", "Rango = |costo en máx − costo en mín| (fórmula). Ordenado de mayor a menor efecto.", 4);
  r = 5;
  for (const x of sims) {
    const R: SIM.ResumenSim = x.r;
    titulo(S, r, `Escenario ${x.escenario} · costo con todas las variables en su moda: S/ ${R.sensibilidad.costoModa.toLocaleString("es-PE", { minimumFractionDigits: 2 })}`); r++;
    enc(S, r, ["Variable", "Factor mínimo", "Factor máximo", "Costo en mínimo (S/)", "Costo en máximo (S/)", "Rango (S/)", "EVA en mínimo (S/)", "EVA en máximo (S/)"]); r++;
    for (const f of R.sensibilidad.filas) {
      S.getRow(r).values = [variablePorId(f.variable)?.nombre || f.variable, f.minimo, f.maximo, f.costoMin, f.costoMax, null, f.evaMin, f.evaMax];
      S.getCell(r, 6).value = { formula: `ABS(E${r}-D${r})`, result: f.rango };
      fmt(S, r, [4, 5, 6, 7, 8]); S.getCell(r, 2).numFmt = "0.000;[Red]-0.000"; S.getCell(r, 3).numFmt = "0.000;[Red]-0.000"; r++;
    }
    r += 2;
  }
  anchos(S, [34, 12, 12, 18, 18, 14, 18, 18]);

  // ---- Comparativo ----
  const C = nueva("Comparativo", "Comparativo de escenarios (mismo período base)", "Diferencia P50 frente a Base = P50 escenario − P50 Base (fórmula).");
  enc(C, 5, ["Escenario", "Simulación", "Semilla", "Iteraciones", "P5", "P50", "P95", "P(> presupuesto)", "EVA P50", "P(EVA < 0)", "Δ P50 vs Base"]);
  r = 6;
  const filaBase = escs.filter((e) => ult.has(e)).indexOf("Base");
  for (const e of escs.filter((e) => ult.has(e))) {
    const x = ult.get(e), R: SIM.ResumenSim = x.r;
    C.getRow(r).values = [e, x.id, x.semilla, R.validas, R.costo.p5, R.costo.p50, R.costo.p95, R.costo.probSupera, R.eva?.p50 ?? null, R.eva?.probNegativo ?? null];
    if (filaBase >= 0) C.getCell(r, 11).value = { formula: `F${r}-F${6 + filaBase}` };
    fmt(C, r, [5, 6, 7, 9, 11]); fmt(C, r, [8, 10], FMTP); r++;
  }
  anchos(C, [16, 26, 10, 11, 14, 14, 14, 14, 16, 12, 14]);

  // ---- EVA (fórmulas) ----
  const V = nueva("EVA", "EVA anual base y con plan de mejora", "EVA = NOPAT − WACC × Capital invertido. WACC = Ke·E/(D+E) + Kd·(1−T)·D/(D+E). El costo de capital no se suma al costo logístico.", 0);
  const filaEva: Record<string, number> = {};
  if (!ev.calculable) {
    V.getCell(5, 1).value = "EVA NO CALCULABLE"; V.getCell(5, 1).font = { bold: true, color: { argb: "FFDC2626" } };
    ev.motivos.forEach((m, i) => (V.getCell(6 + i, 1).value = m));
  } else {
    const items: [string, string, any, string?][] = [
      ["ventas", "Ventas (12 meses)", ev.ventas], ["cv", "Costo de ventas sin logística", ev.costoVentas], ["log", "Costo logístico (corridas ABC de 12 meses)", ev.costoLogistico], ["og", "Otros gastos operativos", ev.otrosGastos],
      ["uo", "Utilidad operativa", null, "B{ventas}-B{cv}-B{log}-B{og}"], ["t", "Tasa de impuesto T", ev.t], ["imp", "Impuesto", null, "IF(B{uo}>0,B{uo}*B{t},0)"], ["nopat", "NOPAT", null, "B{uo}-B{imp}"],
      ["ke", "Ke (costo del patrimonio)", ev.ke], ["kd", "Kd (costo de la deuda, antes de impuestos)", ev.kd], ["d", "Deuda D", ev.deuda], ["e", "Patrimonio E", ev.patrimonio],
      ["wacc", "WACC", null, "B{ke}*B{e}/(B{d}+B{e})+B{kd}*(1-B{t})*B{d}/(B{d}+B{e})"], ["cap", "Capital invertido", ev.capital], ["cargo", "Cargo de capital = WACC × Capital", null, "B{wacc}*B{cap}"],
      ["eva", "EVA base", null, "B{nopat}-B{cargo}"], ["devap", "ΔEVA del plan (hoja Alternativas_Plan)", null, "Alternativas_Plan!{dEvaPlan}"], ["evaalt", "EVA con plan", null, "B{eva}+B{devap}"], ["capalt", "Capital invertido con plan", null, "B{cap}+Alternativas_Plan!{invPlan}"],
    ];
    enc(V, 4, ["Concepto", "Valor"]);
    items.forEach(([k], i) => (filaEva[k] = 5 + i));
    items.forEach(([k, lbl, val, fx], i) => {
      const rr = 5 + i;
      V.getCell(rr, 1).value = lbl;
      if (fx) V.getCell(rr, 2).value = { formula: fx.replace(/\{(\w+)\}/g, (_, x) => (filaEva[x] !== undefined ? String(filaEva[x]) : `{${x}}`)) };
      else V.getCell(rr, 2).value = val;
      V.getCell(rr, 2).numFmt = ["t", "ke", "kd", "wacc"].includes(k) ? "0.000%;[Red]-0.000%" : FMT;
      if (["nopat", "eva", "evaalt"].includes(k)) V.getRow(rr).font = { bold: true };
    });
    V.getCell(5 + items.length + 1, 1).value = `Meses: ${ev.meses!.join(", ")}`;
    anchos(V, [48, 20]);
  }

  // ---- Alternativas y plan (fórmulas) ----
  const L = nueva("Alternativas_Plan", "Alternativas, plan de acción e impacto en EVA", "Ahorro anual = Base mensual × Reducción × 12. ΔNOPAT = Ahorro × (1 − T). Δ cargo = WACC × Inversión. ΔEVA = ΔNOPAT − Δ cargo. En el plan entran las alternativas con ΔEVA > 0. Edita la reducción (columna D) para reevaluar.");
  enc(L, 5, ["ID", "Propuesta", "Base mensual (S/)", "Reducción supuesta", "Ahorro anual (S/)", "Inversión (S/)", "ΔNOPAT", "Δ cargo de capital", "ΔEVA", "¿En el plan?", "Acción", "Responsable", "Plazo (meses)", "KPI de seguimiento", "Riesgo"]);
  const tRef = ev.calculable ? `EVA!$B$${filaEva.t}` : "0", wRef = ev.calculable ? `EVA!$B$${filaEva.wacc}` : "0";
  r = 6;
  for (const p of ALT.props) {
    L.getRow(r).values = [p.id, p.titulo, p.base, p.pct, null, p.inversion, null, null, null, null, p.accion, p.responsable, p.plazoMeses, p.kpi, p.riesgo];
    L.getCell(r, 5).value = { formula: `C${r}*D${r}*12`, result: p.ahorroAnual };
    L.getCell(r, 7).value = { formula: `E${r}*(1-${tRef})`, result: p.dNopat ?? undefined };
    L.getCell(r, 8).value = { formula: `${wRef}*F${r}`, result: p.dCargo ?? undefined };
    L.getCell(r, 9).value = { formula: `G${r}-H${r}`, result: p.dEva ?? undefined };
    L.getCell(r, 10).value = { formula: `IF(I${r}>0,"Sí","No")`, result: p.conviene === false ? "No" : "Sí" };
    fmt(L, r, [3, 5, 6, 7, 8, 9]); L.getCell(r, 4).numFmt = "0.0%;[Red]-0.0%";
    L.getCell(r, 4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7E0" } };
    L.getRow(r).alignment = { wrapText: true, vertical: "top" };
    r++;
  }
  const a0 = 6, a1 = r - 1;
  L.getCell(r, 2).value = "Plan (alternativas con ΔEVA > 0)"; L.getRow(r).font = { bold: true };
  L.getCell(r, 5).value = { formula: `SUMIF(J${a0}:J${a1},"Sí",E${a0}:E${a1})`, result: ALT.plan.ahorroAnual };
  L.getCell(r, 6).value = { formula: `SUMIF(J${a0}:J${a1},"Sí",F${a0}:F${a1})`, result: ALT.plan.inversion };
  L.getCell(r, 9).value = { formula: `SUMIF(J${a0}:J${a1},"Sí",I${a0}:I${a1})`, result: ALT.plan.dEva ?? undefined };
  fmt(L, r, [5, 6, 9]);
  if (ev.calculable) {
    // referencias de la hoja EVA a los totales del plan
    const fx = (k: string, ref: string) => { const cl = V.getCell(filaEva[k], 2); cl.value = { formula: (cl.value as any).formula.replace(`{${k === "devap" ? "dEvaPlan" : "invPlan"}}`, ref) }; };
    fx("devap", `I${r}`);
    fx("capalt", `F${r}`);
  }
  anchos(L, [12, 36, 14, 11, 14, 13, 13, 13, 13, 10, 44, 24, 10, 28, 28]);

  // ---- Supuestos ----
  const U = nueva("Supuestos", "Supuestos declarados", "", 4);
  enc(U, 4, ["#", "Supuesto"]);
  ["Las variables aleatorias son independientes (no hay correlaciones estimadas).",
   "Distribución triangular (mínimo, moda, máximo) sobre factores multiplicativos del período base.",
   "Volumen: escala materiales (P1), servicios directos (P2) y cantidades de objetos; personal e indirectos son capacidad fija en el mes. En EVA también escala ventas y costo de ventas.",
   "Remuneraciones: el pool «Personal indirecto» cambia exactamente en lo que cambia el costo del personal indirecto (al céntimo).",
   "EVA anual sobre los 12 meses que terminan en el período base; el efecto relativo del mes base sobre el costo logístico se aplica al año.",
   "Impuesto 0 si la utilidad operativa es negativa (sin escudo fiscal).",
   "La inversión de una propuesta se suma al capital invertido; no se modela depreciación ni capital de trabajo adicional.",
   "El ahorro de las propuestas es aditivo e independiente de los factores simulados.",
   "Las propuestas son alternativas heurísticas evaluadas con supuestos editables; no es una optimización matemática.",
   emp.sintetico ? "Datos sintéticos: el EVA es ILUSTRATIVO (cálculo real, cifras ficticias)." : "Datos cargados por el usuario."]
    .forEach((t, i) => { U.getCell(5 + i, 1).value = i + 1; U.getCell(5 + i, 2).value = t; U.getCell(5 + i, 2).alignment = { wrapText: true }; });
  anchos(U, [5, 120]);

  const buf = await wb.xlsx.writeBuffer();
  const nombre = `Proyecciones_Mejoras_EVA_${mod.codigo}_${per.codigo}.xlsx`;
  return { nombre, bytes: new Uint8Array(buf), hojas, simulaciones: sims.length };
}
