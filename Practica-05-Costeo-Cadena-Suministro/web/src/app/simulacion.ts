// Casos de uso I4: escenarios, variables, Monte Carlo guardado, sensibilidad, EVA base y alternativas (ΔEVA).
// Una simulación crea un registro nuevo y NUNCA modifica corridas, costos ni datos históricos.
import { Store, APP_VERSION, uid, hashStr } from "../db/store";
import { Contexto } from "./usecases";
import { cargarInput, hashInput, periodosEmpresa } from "./modelos";
import { construirAnalitica } from "./analitica";
import { VARIABLES, VarEscenario, validarVariables, Simulador, resumir, convergencia, sensibilidad, ContextoEVA, costearConFactores } from "../domain/simulacion";
import { wacc, nopat, eva, deltaEvaPropuesta } from "../domain/eva";
import { round2 } from "../domain/abc";

const ORDEN = new Map(VARIABLES.map((v, i) => [v.id, i]));
const ordenar = (vs: VarEscenario[]) => [...vs].sort((a, b) => (ORDEN.get(a.variable) ?? 99) - (ORDEN.get(b.variable) ?? 99));

export function escenarios(s: Store, c: Contexto): string[] {
  const xs = s.all("SELECT DISTINCT escenario FROM escenario_variable WHERE version_id=?", [c.versionId]).map((r) => r.escenario as string);
  return xs.sort((a, b) => (a === "Base" ? -1 : b === "Base" ? 1 : a.localeCompare(b)));
}

/** Variables efectivas de un escenario: las propias + las de Base que no redefine (rotuladas «heredada»). */
export function variablesEscenario(s: Store, c: Contexto, esc: string): VarEscenario[] {
  const filas = (e: string) => s.all("SELECT variable, minimo, moda, maximo FROM escenario_variable WHERE version_id=? AND escenario=?", [c.versionId, e]) as any[];
  const propias = filas(esc).map((r) => ({ ...r, heredada: false }));
  if (esc === "Base") return ordenar(propias);
  const ids = new Set(propias.map((r) => r.variable));
  return ordenar([...propias, ...filas("Base").filter((r) => !ids.has(r.variable)).map((r) => ({ ...r, heredada: true }))]);
}

export function crearEscenario(s: Store, c: Contexto, nombre: string, desde?: string) {
  nombre = nombre.trim();
  if (!nombre) throw new Error("Escribe un nombre para el escenario.");
  if (escenarios(s, c).includes(nombre)) throw new Error(`Ya existe el escenario «${nombre}».`);
  s.tx(() => {
    if (desde) for (const v of variablesEscenario(s, c, desde).filter((v) => !v.heredada || desde === "Base"))
      s.run("INSERT INTO escenario_variable(version_id,escenario,variable,distribucion,minimo,moda,maximo,fuente) VALUES(?,?,?,?,?,?,?,?)", [c.versionId, nombre, v.variable, "triangular", v.minimo, v.moda, v.maximo, `duplicado de ${desde}`]);
    else s.run("INSERT INTO escenario_variable(version_id,escenario,variable,distribucion,minimo,moda,maximo,fuente) VALUES(?,?,?,?,?,?,?,?)", [c.versionId, nombre, "volumen_pedidos", "triangular", 1, 1, 1, "creado en la interfaz"]);
    s.audit("CREAR_ESCENARIO", "escenario", nombre, null, { desde: desde || null });
  });
}

export function setVariable(s: Store, c: Contexto, esc: string, variable: string, campo: "minimo" | "moda" | "maximo", valor: number) {
  const vs = variablesEscenario(s, c, esc);
  const v = vs.find((x) => x.variable === variable);
  if (!v) throw new Error("Variable no encontrada.");
  const nuevo = { ...v, [campo]: valor };
  const err = validarVariables([nuevo]);
  if (err.length) throw new Error(err[0]);
  s.tx(() => {
    if (v.heredada) s.run("INSERT INTO escenario_variable(version_id,escenario,variable,distribucion,minimo,moda,maximo,fuente) VALUES(?,?,?,?,?,?,?,?)", [c.versionId, esc, variable, "triangular", nuevo.minimo, nuevo.moda, nuevo.maximo, "editado en la interfaz (antes heredada de Base)"]);
    else s.run(`UPDATE escenario_variable SET ${campo}=?, fuente='editado en la interfaz' WHERE version_id=? AND escenario=? AND variable=?`, [valor, c.versionId, esc, variable]);
    s.audit("EDITAR_VARIABLE_ESCENARIO", "escenario", esc, v, nuevo);
  });
}

export function agregarVariable(s: Store, c: Contexto, esc: string, variable: string) {
  if (!VARIABLES.some((v) => v.id === variable)) throw new Error("Variable fuera del catálogo.");
  if (variablesEscenario(s, c, esc).some((v) => v.variable === variable && !v.heredada)) throw new Error("La variable ya está en el escenario.");
  s.run("INSERT INTO escenario_variable(version_id,escenario,variable,distribucion,minimo,moda,maximo,fuente) VALUES(?,?,?,?,?,?,?,?)", [c.versionId, esc, variable, "triangular", 1, 1, 1, "agregada en la interfaz"]);
  s.audit("AGREGAR_VARIABLE_ESCENARIO", "escenario", esc, null, { variable });
}

export function quitarVariable(s: Store, c: Contexto, esc: string, variable: string) {
  s.run("DELETE FROM escenario_variable WHERE version_id=? AND escenario=? AND variable=?", [c.versionId, esc, variable]);
  s.audit("QUITAR_VARIABLE_ESCENARIO", "escenario", esc, { variable }, null);
}

// ---------------- EVA base (anual, 12 meses que terminan en el período base) ----------------
export interface EvaBase {
  calculable: boolean; motivos: string[]; sintetico: boolean;
  meses?: string[]; ventas?: number; costoVentas?: number; otrosGastos?: number; costoLogistico?: number; t?: number;
  utilidadOperativa?: number; impuesto?: number; nopat?: number;
  ke?: number; kd?: number; deuda?: number; patrimonio?: number; pesoE?: number; pesoD?: number; wacc?: number; capital?: number; cargoCapital?: number; eva?: number;
  cx?: ContextoEVA; costoBaseMes?: number;
}

export function evaBase(s: Store, c: Contexto): EvaBase {
  const emp = s.one("SELECT sintetico FROM empresa WHERE id=?", [c.empresaId]);
  const out: EvaBase = { calculable: false, motivos: [], sintetico: !!emp?.sintetico };
  const par: Record<string, number | null> = {};
  for (const r of s.all("SELECT clave, valor FROM parametro_eva WHERE version_id=?", [c.versionId])) par[r.clave] = r.valor;
  for (const k of ["capital_invertido", "ke", "kd", "deuda", "patrimonio", "tasa_impuesto"]) if (par[k] === undefined || par[k] === null) out.motivos.push(`Falta el parámetro «${k}» (ParametrosEVA).`);
  const A = construirAnalitica(s, c);
  const ps = periodosEmpresa(s, c.empresaId);
  const iBase = ps.findIndex((p) => p.id === c.periodoId);
  const ventana = iBase >= 11 ? ps.slice(iBase - 11, iBase + 1) : [];
  if (!ventana.length) out.motivos.push("Se requieren 12 meses que terminen en el período base (hay menos períodos anteriores).");
  const filas = ventana.map((p) => A?.filas.find((f) => f.periodoId === p.id));
  if (ventana.length && filas.some((f) => !f)) out.motivos.push("Faltan corridas de costeo en alguno de los 12 meses: ejecuta el costeo de todos los períodos.");
  if (ventana.length && filas.some((f) => f && !f.vigente)) out.motivos.push("Hay corridas desactualizadas en los 12 meses: vuelve a ejecutar el costeo.");
  const fin = ventana.map((p) => s.one("SELECT * FROM finanzas_periodo WHERE version_id=? AND periodo_id=?", [c.versionId, p.id]));
  if (ventana.length && fin.some((f) => !f || f.ventas === null)) out.motivos.push("Faltan datos financieros (ventas, costo de ventas, otros gastos) en alguno de los 12 meses (FinanzasEVA).");
  if (out.motivos.length) return out;
  const sum = (k: string) => fin.reduce((a, f) => a + (f[k] || 0), 0);
  const t = par.tasa_impuesto!;
  const costoLogistico = round2(filas.reduce((a, f) => a + f!.total, 0));
  const ER = { ventas: sum("ventas"), costoVentas: sum("costo_ventas_sin_logistica"), otrosGastos: sum("otros_gastos_operativos"), costoLogistico, t };
  const n = nopat(ER);
  const w = wacc({ capital: par.capital_invertido!, ke: par.ke!, kd: par.kd!, deuda: par.deuda!, patrimonio: par.patrimonio!, t });
  const capital = par.capital_invertido!;
  const costoBaseMes = filas[11]!.total;
  return {
    ...out, calculable: true, meses: ventana.map((p) => p.nombre), ...ER, utilidadOperativa: n.utilidadOperativa, impuesto: n.impuesto, nopat: n.nopat,
    ke: par.ke!, kd: par.kd!, deuda: par.deuda!, patrimonio: par.patrimonio!, pesoE: w.pesoE, pesoD: w.pesoD, wacc: w.wacc, capital, cargoCapital: w.wacc * capital, eva: eva(n.nopat, w.wacc, capital), costoBaseMes,
    cx: { ventas: ER.ventas, costoVentas: ER.costoVentas, otrosGastos: ER.otrosGastos, costoLogisticoAnual: costoLogistico, costoBaseMes, t, wacc: w.wacc, capital },
  };
}

// ---------------- Monte Carlo ----------------
export interface PreparacionSim { sim: Simulador; esc: string; vars: VarEscenario[]; baseRun: any; hash: string; ppto: number | null; ev: EvaBase; t0: number; costoBase: number }

export function prepararSimulacion(s: Store, c: Contexto, esc: string, semilla: number, iteraciones: number): PreparacionSim {
  if (!Number.isInteger(semilla) || semilla < 0) throw new Error("La semilla debe ser un entero mayor o igual a 0.");
  if (!Number.isInteger(iteraciones) || iteraciones < 100 || iteraciones > 20000) throw new Error("Iteraciones: entero entre 100 y 20 000.");
  const run = s.one("SELECT * FROM corrida WHERE version_id=? AND periodo_id=? AND etapa='ABC' ORDER BY creado_en DESC LIMIT 1", [c.versionId, c.periodoId]);
  if (!run) throw new Error("El período base no tiene corrida de costeo: ejecuta el costeo antes de simular.");
  const inp = cargarInput(s, c);
  const h = hashInput(inp);
  if (h !== run.params_hash) throw new Error("Los datos del período base cambiaron después de su corrida: vuelve a ejecutar el costeo antes de simular.");
  const vars = variablesEscenario(s, c, esc);
  if (!vars.length) throw new Error(`El escenario «${esc}» no tiene variables.`);
  const err = validarVariables(vars);
  if (err.length) throw new Error(err.join(" "));
  const ev = evaBase(s, c);
  const ppto = s.one("SELECT monto FROM presupuesto WHERE version_id=? AND periodo_id=? AND concepto LIKE 'Costo log%'", [c.versionId, c.periodoId])?.monto ?? null;
  const costoBase = costearConFactores(inp, {}).costo;
  const sim = new Simulador(inp, vars, semilla, iteraciones, ev.calculable ? ev.cx : undefined);
  const hash = hashStr(JSON.stringify({ h, vars: vars.map(({ heredada, ...v }) => v), semilla, iteraciones, cx: ev.cx || null }));
  return { sim, esc, vars, baseRun: run, hash, ppto, ev, t0: performance.now(), costoBase };
}

export function resumenSimulacion(p: PreparacionSim) {
  const validas = p.sim.muestras.filter((m) => !m.bloqueado);
  const bloqueadas = p.sim.muestras.length - validas.length;
  const costos = validas.map((m) => m.costo);
  return {
    escenario: p.esc, semilla: p.sim.semilla, iteraciones: p.sim.iteraciones, validas: validas.length, bloqueadas, costoBase: p.costoBase, ppto: p.ppto,
    variables: p.vars, costo: resumir(costos, p.ppto), unitario: resumir(validas.map((m) => m.unitario)),
    eva: p.ev.calculable ? resumir(validas.map((m) => m.eva!), null) : null, evaBase: p.ev.calculable ? p.ev.eva : null,
    convergencia: convergencia(costos), sensibilidad: sensibilidad((p.sim as any).base, p.vars, p.ev.calculable ? p.ev.cx : undefined),
  };
}
export type ResumenSim = ReturnType<typeof resumenSimulacion>;

/** Guarda solo simulaciones COMPLETAS (una cancelada no produce resultado definitivo: T48). */
export function guardarSimulacion(s: Store, c: Contexto, p: PreparacionSim) {
  if (!p.sim.terminado) throw new Error("La simulación no terminó: no se guarda un resultado parcial.");
  const r = resumenSimulacion(p);
  const id = "SIM-" + new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14) + "-" + p.hash.slice(0, 4);
  const ms = Math.round(performance.now() - p.t0);
  s.tx(() => {
    s.run("INSERT INTO simulacion(id,version_id,periodo_id,escenario,semilla,iteraciones,estado,base_run_id,params_hash,resultado,ms,app_version,creado_en) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [id, c.versionId, c.periodoId, p.esc, p.sim.semilla, p.sim.iteraciones, "COMPLETA", p.baseRun.id, p.hash, JSON.stringify(r), ms, APP_VERSION, new Date().toISOString()]);
    s.audit("SIMULAR_ESCENARIO", "simulacion", id, null, { escenario: p.esc, semilla: p.sim.semilla, iteraciones: p.sim.iteraciones, base_run_id: p.baseRun.id, ms });
  });
  return { id, r, ms };
}

export function simulaciones(s: Store, c: Contexto) {
  return s.all("SELECT s.*, p.nombre periodo_nombre FROM simulacion s JOIN periodo p ON p.id=s.periodo_id WHERE s.version_id=? ORDER BY s.creado_en DESC", [c.versionId]).map((x: any) => ({ ...x, r: JSON.parse(x.resultado) as ResumenSim })) as any[];
}
/** Última simulación por escenario para el período base activo. */
export function ultimasPorEscenario(s: Store, c: Contexto) {
  const m = new Map<string, any>();
  for (const x of simulaciones(s, c)) if (x.periodo_id === c.periodoId && !m.has(x.escenario)) m.set(x.escenario, x);
  return m;
}

// ---------------- Alternativas (ΔEVA) ----------------
export function alternativas(s: Store, c: Contexto, propPct: Record<string, number> = {}) {
  const A = construirAnalitica(s, c);
  const ev = evaBase(s, c);
  const props = (A?.propuestas || []).map((p) => {
    const pct = propPct[p.id] ?? p.pct;
    const ahorroMensual = p.base * pct, ahorroAnual = ahorroMensual * 12;
    const d = ev.calculable ? deltaEvaPropuesta(ahorroAnual, p.inversion, ev.t!, ev.wacc!) : null;
    return { ...p, pct, ahorroMensual, ahorroAnual, dNopat: d?.dNopat ?? null, dCargo: d?.dCargo ?? null, dEva: d?.dEva ?? null, conviene: d ? d.dEva > 0 : null };
  });
  const plan = props.filter((p) => p.conviene !== false);
  const ahorroPlan = plan.reduce((a, p) => a + p.ahorroAnual, 0), invPlan = plan.reduce((a, p) => a + p.inversion, 0);
  const dPlan = ev.calculable ? deltaEvaPropuesta(ahorroPlan, invPlan, ev.t!, ev.wacc!) : null;
  return { ev, props, plan: { ids: plan.map((p) => p.id), ahorroAnual: ahorroPlan, ahorroMensual: ahorroPlan / 12, inversion: invPlan, dEva: dPlan?.dEva ?? null, evaAlt: ev.calculable && dPlan ? ev.eva! + dPlan.dEva : null, capitalAlt: ev.calculable ? ev.capital! + invPlan : null } };
}
