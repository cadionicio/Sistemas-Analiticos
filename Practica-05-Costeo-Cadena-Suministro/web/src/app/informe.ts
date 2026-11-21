// Contenido del informe técnico y de la presentación ejecutiva (RF-09 / RF-10).
// Todo se deriva de corridas, analítica y simulaciones guardadas; los textos de conclusión se arman con cifras calculadas
// y nunca presentan una recomendación como certeza.
import { Store, APP_VERSION } from "../db/store";
import { Contexto } from "./usecases";
import { construirAnalitica, Analitica } from "./analitica";
import * as SIM from "./simulacion";
import { variablePorId } from "../domain/simulacion";
import { fmtNum } from "../domain/formato";
import { NOMBRE_OFICIAL_EXPORT } from "./nombres";

export const m = (v: number | null | undefined) => (v === null || v === undefined || !isFinite(v) ? "—" : "S/ " + fmtNum(v, 2));
export const n2 = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !isFinite(v) ? "—" : fmtNum(v, d));
export const pc = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !isFinite(v) ? "—" : fmtNum(v * 100, d) + " %");

export interface Tabla { titulo: string; cab: string[]; filas: string[][]; nota?: string; num?: boolean[] }
export interface Seccion { titulo: string; parrafos: string[]; vinetas?: string[]; tablas?: Tabla[] }
export interface ContenidoInforme {
  titulo: string; subtitulo: string; meta: [string, string][]; sintetico: boolean;
  kpis: { lbl: string; val: string; sub: string }[];
  secciones: Seccion[];
  A: Analitica; sims: any[]; alt: ReturnType<typeof SIM.alternativas>; per: any; mod: any;
}

export function construirInforme(s: Store, c: Contexto, propPct: Record<string, number> = {}): ContenidoInforme {
  const A = construirAnalitica(s, c);
  if (!A || !A.filas.length) throw new Error("No hay corridas guardadas: ejecuta el costeo de los períodos antes de generar el informe.");
  if (A.faltantes.length || A.desactualizados.length) throw new Error("Hay períodos sin corrida o con corridas desactualizadas: ejecuta el costeo de todos los períodos antes de generar el informe.");
  const mod = s.one("SELECT * FROM modelo WHERE id=?", [c.modeloId])!;
  const ver = s.one("SELECT * FROM modelo_version WHERE id=?", [c.versionId])!;
  const emp = s.one("SELECT * FROM empresa WHERE id=?", [c.empresaId])!;
  const per = s.one("SELECT * FROM periodo WHERE id=?", [c.periodoId])!;
  const F = A.filas.find((f) => f.periodoId === c.periodoId) || A.ultima;
  const ult = SIM.ultimasPorEscenario(s, c);
  const sims = SIM.escenarios(s, c).filter((e) => ult.has(e)).map((e) => ult.get(e));
  const alt = SIM.alternativas(s, c, propPct);
  const ev = alt.ev;
  const vp = A.varPpto.find((v) => v.periodo === F.periodo);
  const base = sims.find((x) => x.escenario === "Base");
  const P0 = A.pronosticos[0];
  const tot = A.filas.reduce((a, f) => a + f.total, 0);
  const navi = A.filas.reduce((a, f) => a + f.navi, 0);
  const cap = A.filas.reduce((a, f) => a + f.capacidad, 0);
  const sint = !!emp.sintetico;

  const kpis = [
    { lbl: `Costo de la cadena · ${F.nombre}`, val: m(F.total), sub: A.crecimientoInteranual !== null && F === A.ultima ? `${pc(A.crecimientoInteranual)} interanual` : `${fmtNum(F.volumen, 0)} pedidos` },
    { lbl: "Costo por pedido", val: m(F.unitario), sub: `${fmtNum(F.volumen, 0)} pedidos` },
    { lbl: "Real vs presupuesto", val: vp ? m(vp.variacion) : "—", sub: vp ? `${pc(vp.pct)} (${vp.variacion > 0 ? "desfavorable" : "favorable"})` : "sin presupuesto" },
    { lbl: "NAVI (no agrega valor, innecesaria)", val: pc(navi / (tot || 1)), sub: `${m(navi)} en ${A.filas.length} meses` },
    { lbl: "EVA anual base", val: ev.calculable ? m(ev.eva) : "No calculable", sub: ev.calculable ? (sint ? "ilustrativo (datos sintéticos)" : "12 meses") : ev.motivos[0] || "" },
    { lbl: "ΔEVA del plan de mejora", val: alt.plan.dEva !== null ? m(alt.plan.dEva) : "—", sub: `${alt.plan.ids.length} propuestas · inversión ${m(alt.plan.inversion)}` },
  ];

  const sec: Seccion[] = [];
  // 1. Resumen ejecutivo
  const res: string[] = [
    `En ${F.nombre} el costo de la cadena de suministro asignado a los objetos de costo fue ${m(F.total)}, equivalente a ${m(F.unitario)} por pedido (${fmtNum(F.volumen, 0)} pedidos). La conciliación del período cuadra: costo de origen = asignado + capacidad no utilizada + fuera de alcance + saldos.`,
    vp ? `Frente al presupuesto del mes la diferencia es ${m(vp.variacion)} (${pc(vp.pct)}): efecto volumen ${m(vp.efVol)} y efecto costo unitario ${m(vp.efCosto)}.` : "El modelo no tiene presupuesto cargado.",
    `En ${A.filas.length} meses, las actividades que no agregan valor y son innecesarias (NAVI) suman ${m(navi)} (${pc(navi / (tot || 1))} del costo) y la capacidad de personal pagada y no imputada suma ${m(cap)}: son las principales fuentes de ahorro identificadas.`,
  ];
  if (P0 && P0.futuro[0]) res.push(`El pronóstico para ${P0.futuro[0].nombre} es ${m(P0.futuro[0].central)} (banda aproximada al 80 %: ${m(P0.futuro[0].bajo)} – ${m(P0.futuro[0].alto)}), con el método «${P0.elegidoNombre}» elegido por backtesting.`);
  if (base) res.push(`La simulación Monte Carlo del escenario Base (${base.r.validas} iteraciones, semilla ${base.semilla}) da un costo mensual P50 de ${m(base.r.costo.p50)} (P5 ${m(base.r.costo.p5)} – P95 ${m(base.r.costo.p95)}) y una probabilidad de superar el presupuesto de ${pc(base.r.costo.probSupera)}.`);
  if (ev.calculable) res.push(`El EVA anual base es ${m(ev.eva)} (NOPAT ${m(ev.nopat)} − WACC ${pc(ev.wacc, 2)} × capital ${m(ev.capital)})${sint ? ", con datos financieros sintéticos (ilustrativo)" : ""}. El plan de ${alt.plan.ids.length} propuestas tendría un ΔEVA estimado de ${m(alt.plan.dEva)} con una inversión de ${m(alt.plan.inversion)}, bajo los supuestos indicados.`);
  sec.push({ titulo: "Resumen ejecutivo", parrafos: res });

  // 2. Metodología
  sec.push({
    titulo: "Metodología",
    parrafos: [
      "Costeo basado en actividades (ABC) en cinco rutas: P1 material directo (cantidad × costo unitario, IGV recuperable excluido), P2 servicios directos (cantidad × tarifa), P3 personal directo por persona (tasa individual = costo empresa / horas disponibles; capacidad no utilizada separada), P4a elementos de costo indirecto a centros, P4b centros a actividades (solo centros participantes, en su porcentaje), Resumen por actividad y P4c actividades a objetos de costo. Cada reparto usa redondeo por mayor resto y conserva el total; los saldos no se normalizan.",
      "Analítica: descriptiva (series de las corridas guardadas), diagnóstica (variación real vs presupuesto descompuesta en efecto volumen y efecto costo unitario; regresión costo ~ pedidos como asociación, no causalidad; valores atípicos por puntaje z), predictiva (métodos ingenuo, media móvil, tendencia, Holt y estacional; selección por sMAPE en los últimos 6 meses sin usar datos futuros) y relevancia (Pareto acumulado).",
      "Simulación: Monte Carlo con semilla reproducible; cada iteración pasa por el mismo motor ABC con factores triangulares independientes. Una simulación nunca modifica los costos ni las corridas guardadas.",
      "Valor económico: EVA = NOPAT − WACC × Capital invertido; WACC = Ke·E/(D+E) + Kd·(1−T)·D/(D+E); periodicidad anual. ΔEVA de una propuesta = ahorro anual × (1 − T) − WACC × inversión.",
    ],
  });

  // 3. Resultados del costeo
  const tObj: Tabla = { titulo: `Costo por objeto de costo · ${F.nombre}`, cab: ["Objeto", "Costo (S/)", "Cantidad", "Costo unitario (S/)", "Participación"], num: [false, true, true, true, true],
    filas: A.objetos.map((o) => { const d = F.objetos[o.codigo]; return [`${o.codigo} · ${o.nombre}`, n2(d?.costo), d?.cantidad != null ? fmtNum(d.cantidad, 0) : "—", n2(d?.unitario), pc((d?.costo || 0) / (F.total || 1))]; }) };
  tObj.filas.push(["Total", n2(F.total), fmtNum(F.volumen, 0), n2(F.unitario), "100,0 %"]);
  const sumc = F.cmd + F.csd + F.cpd + F.ci;
  const tComp: Tabla = { titulo: "Composición del costo por componente", cab: ["Componente", "Importe (S/)", "%"], num: [false, true, true],
    filas: [["Material directo (P1)", n2(F.cmd), pc(F.cmd / sumc)], ["Servicio directo (P2)", n2(F.csd), pc(F.csd / sumc)], ["Personal directo (P3)", n2(F.cpd), pc(F.cpd / sumc)], ["Indirectos asignados (P4a–P4b)", n2(F.ci), pc(F.ci / sumc)]] };
  const acts = [...F.R.resumen].filter((x) => x.act.alcance !== "EXCLUIDA").sort((a, b) => b.total - a.total).slice(0, 10);
  const tAct: Tabla = { titulo: "Diez actividades de mayor costo del período", cab: ["Actividad", "Clase", "CMD", "CSD", "CPD", "CI", "Total (S/)"], num: [false, false, true, true, true, true, true],
    filas: acts.map((x) => [`${x.act.codigo} · ${x.act.nombre}`, x.act.clase || "—", n2(x.cmd), n2(x.csd), n2(x.cpd), n2(x.ci), n2(x.total)]) };
  sec.push({ titulo: "Resultados del costeo ABC", parrafos: [`Corrida ${F.runId}. Capacidad no utilizada del personal en el mes: ${m(F.capacidad)}; costos fuera del alcance de la cadena (centros no participantes y otras actividades): ${m(F.fuera)}.`], tablas: [tObj, tComp, tAct] });

  // 4. Diagnóstico
  const tVar: Tabla = { titulo: "Real vs presupuesto (últimos 6 meses)", cab: ["Período", "Real", "Presupuesto", "Variación", "%", "Efecto volumen", "Efecto costo unitario"], num: [false, true, true, true, true, true, true],
    filas: A.varPpto.slice(-6).map((v) => { const f = A.filas.find((x) => x.periodo === v.periodo)!; return [v.nombre, n2(f.total), n2(f.ppto), n2(v.variacion), pc(v.pct), n2(v.efVol), n2(v.efCosto)]; }) };
  const rg = A.regresionVolumen;
  sec.push({
    titulo: "Diagnóstico: causas y hallazgos",
    parrafos: [A.filas.length >= 6 ? `Asociación costo ~ volumen (regresión lineal sobre ${A.filas.length} meses): costo ≈ ${m(rg.a)} + ${m(rg.b)} por pedido; R² = ${n2(rg.r2, 3)}. Es una asociación estadística, no prueba causalidad.` : "Se requieren al menos 6 meses para estimar la asociación costo ~ volumen."],
    vinetas: A.hallazgos.map((h) => `[${h.tipo}] ${h.texto} (evidencia: ${h.evidencia})`),
    tablas: A.varPpto.length ? [tVar] : [],
  });

  // 5. Proyección
  if (P0) {
    const tF: Tabla = { titulo: `Pronóstico a 6 meses · ${P0.serie} · método ${P0.elegidoNombre}`, cab: ["Período", "Central (S/)", "Límite inferior", "Límite superior"], num: [false, true, true, true],
      filas: P0.futuro.map((f) => [f.nombre, n2(f.central), n2(f.bajo), n2(f.alto)]) };
    const tB: Tabla = { titulo: "Backtesting (validación en los últimos 6 meses)", cab: ["Método", "sMAPE", "MAE", "RMSE", "Estado"], num: [false, true, true, true, false],
      filas: P0.backtest.map((b) => [b.nombre, b.elegible ? n2(b.smape) + " %" : "—", b.elegible ? n2(b.mae) : "—", b.elegible ? n2(b.rmse) : "—", b.id === P0.elegido ? "Elegido" : b.elegible ? "Evaluado" : b.motivo || "No elegible"]) };
    sec.push({ titulo: "Proyección a seis meses", parrafos: ["Valores PRONOSTICADOS, no históricos. La banda es una aproximación empírica al 80 % basada en el error del backtesting."], tablas: [tF, tB] });
  }

  // 6. Relevancia
  const pa = A.paretoAct.filter((x: any) => x.clase === "A");
  sec.push({ titulo: "Relevancia (Pareto)", parrafos: [`${pa.length} de ${A.paretoAct.length} actividades de la cadena concentran el ${pc(pa.at(-1)?.acumulado || 0)} del costo acumulado (clase A). La regla 80/20 se usa como referencia, no como ley.`],
    tablas: [{ titulo: "Actividades clase A", cab: ["Actividad", "Clase de valor", "Costo acumulado (S/)", "%", "% acumulado"], num: [false, false, true, true, true], filas: pa.map((x: any) => [`${x.item.codigo} · ${x.item.nombre}`, x.item.clase || "—", n2(x.valor), pc(x.pct), pc(x.acumulado)]) }] });

  // 7. Simulación
  if (sims.length) {
    sec.push({ titulo: "Escenarios y simulación Monte Carlo", parrafos: [`Período base ${per.nombre}. Variables triangulares independientes (supuesto). Cada escenario se simuló con su semilla y número de iteraciones; los resultados son estimaciones bajo esos supuestos.`],
      tablas: [
        { titulo: "Comparativo de escenarios (costo mensual de la cadena)", cab: ["Escenario", "Simulación", "Semilla", "Iteraciones", "P5", "P50", "P95", "P(> presupuesto)", "EVA P50"], num: [false, false, true, true, true, true, true, true, true],
          filas: sims.map((x) => [x.escenario, x.id, String(x.semilla), String(x.r.validas), n2(x.r.costo.p5), n2(x.r.costo.p50), n2(x.r.costo.p95), pc(x.r.costo.probSupera), x.r.eva ? n2(x.r.eva.p50) : "—"]) },
        ...(base ? [{ titulo: "Sensibilidad (escenario Base, motor ABC real)", cab: ["Variable", "Factor mín.", "Factor máx.", "Costo en mín.", "Costo en máx.", "Rango"], num: [false, true, true, true, true, true],
          filas: base.r.sensibilidad.filas.map((f: any) => [variablePorId(f.variable)?.nombre || f.variable, n2(f.minimo, 3), n2(f.maximo, 3), n2(f.costoMin), n2(f.costoMax), n2(f.rango)]) } as Tabla] : []),
      ] });
  } else sec.push({ titulo: "Escenarios y simulación Monte Carlo", parrafos: ["No hay simulaciones guardadas para el período base: simula al menos un escenario en la pestaña Simulación."] });

  // 8. Propuestas y plan
  sec.push({
    titulo: "Propuestas y plan de implementación",
    parrafos: ["Alternativas heurísticas evaluadas con supuestos explícitos y editables (no es una optimización matemática). Ninguna propuesta es una certeza: el ahorro real debe medirse con el KPI indicado."],
    tablas: [{ titulo: "Plan de acción", cab: ["Propuesta", "Acción", "Responsable", "Plazo (meses)", "Ahorro anual (S/)", "Inversión (S/)", "ΔEVA (S/)", "KPI"], num: [false, false, false, true, true, true, true, false],
      filas: alt.props.map((p) => [p.titulo, p.accion, p.responsable, String(p.plazoMeses), n2(p.ahorroAnual), n2(p.inversion), n2(p.dEva), p.kpi]) }],
  });

  // 9. EVA
  if (ev.calculable) {
    sec.push({ titulo: "Impacto económico y EVA", parrafos: [sint ? "EVA ILUSTRATIVO: ventas, balance y costos de capital son datos sintéticos; el cálculo es real." : "EVA calculado con los datos financieros cargados.", `Meses considerados: ${ev.meses![0]} – ${ev.meses![11]}. El costo del capital no se suma al costo logístico.`],
      tablas: [{ titulo: "Cálculo del EVA anual", cab: ["Concepto", "Valor"], num: [false, true], filas: [
        ["Ventas", n2(ev.ventas)], ["Costo de ventas sin logística", n2(ev.costoVentas)], ["Costo logístico (corridas ABC)", n2(ev.costoLogistico)], ["Otros gastos operativos", n2(ev.otrosGastos)],
        ["Utilidad operativa", n2(ev.utilidadOperativa)], [`Impuesto (${pc(ev.t)})`, n2(ev.impuesto)], ["NOPAT", n2(ev.nopat)], ["WACC", pc(ev.wacc, 3)], ["Capital invertido", n2(ev.capital)],
        ["Cargo de capital", n2(ev.cargoCapital)], ["EVA base", n2(ev.eva)], ["ΔEVA del plan", n2(alt.plan.dEva)], ["EVA con plan", n2(alt.plan.evaAlt)]] }] });
  } else sec.push({ titulo: "Impacto económico y EVA", parrafos: ["EVA no calculable con los datos actuales:", ...ev.motivos] });

  // 10. Conclusiones
  const concl: string[] = [];
  concl.push(`El costo de la cadena se concentra en indirectos asignados (${pc(F.ci / sumc)}) y personal directo (${pc(F.cpd / sumc)}); el costo ABC unitario varía según el objeto de costo entre ${m(Math.min(...A.objetos.map((o) => F.objetos[o.codigo]?.unitario ?? Infinity)))} y ${m(Math.max(...A.objetos.map((o) => F.objetos[o.codigo]?.unitario ?? -Infinity)))}.`);
  if (navi > 0) concl.push(`Las actividades NAVI y la capacidad no utilizada son los focos de mejora con evidencia cuantitativa; el plan propuesto apunta a ellas.`);
  if (base && base.r.costo.probSupera !== null) concl.push(`Con los supuestos del escenario Base, la probabilidad de superar el presupuesto del período es ${pc(base.r.costo.probSupera)}; la variable de mayor efecto es «${variablePorId(base.r.sensibilidad.filas[0]?.variable)?.nombre}».`);
  if (ev.calculable) concl.push(ev.eva! < 0 ? `El EVA base es negativo: la operación no cubre el costo del capital; el plan reduce la brecha en ${m(alt.plan.dEva)} pero no la elimina con los supuestos actuales.` : `El EVA base es positivo; el plan lo aumentaría en ${m(alt.plan.dEva)} bajo los supuestos actuales.`);
  concl.push("Las conclusiones dependen de los datos y supuestos declarados; deben revisarse con datos reales antes de decidir.");
  sec.push({ titulo: "Conclusiones", parrafos: [], vinetas: concl });

  // 11. Supuestos y trazabilidad
  sec.push({ titulo: "Supuestos, limitaciones y trazabilidad", parrafos: [], vinetas: [
    sint ? "Datos sintéticos de una empresa ficticia: no describen una empresa real." : "Datos cargados por el usuario.",
    "Variables de simulación independientes; distribución triangular sobre factores del período base.",
    "Volumen: escala materiales, servicios directos y cantidades de objetos; personal e indirectos son capacidad fija en el mes.",
    "EVA anual sobre 12 meses; la inversión de las propuestas se suma al capital invertido; sin depreciación ni capital de trabajo adicional.",
    `Corridas ABC: ${A.filas[0].runId} … ${A.ultima.runId} (${A.filas.length}). Simulaciones: ${sims.map((x) => x.id).join(", ") || "ninguna"}.`,
    `Generado por ${NOMBRE_OFICIAL_EXPORT}, versión ${APP_VERSION}, el ${new Date().toLocaleString("es-PE")}.`,
  ] });

  return {
    titulo: "Informe técnico de costeo de la cadena de suministro",
    subtitulo: `${mod.codigo} · ${mod.nombre} · período ${per.nombre}`,
    meta: [["Sistema", NOMBRE_OFICIAL_EXPORT], ["Empresa", emp.nombre], ["Modelo", `${mod.codigo} · ${mod.nombre} (v${ver.numero})`], ["Período", per.nombre], ["Corrida del período", F.runId || "—"], ["Versión de la aplicación", APP_VERSION], ["Fecha de generación", new Date().toLocaleString("es-PE")]],
    sintetico: sint, kpis, secciones: sec, A, sims, alt, per, mod,
  };
}
