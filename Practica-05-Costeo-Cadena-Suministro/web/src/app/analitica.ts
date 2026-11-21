// Analítica de un modelo sobre todos sus períodos con corrida guardada.
import { Store } from "../db/store";
import { Contexto } from "./usecases";
import { cargarInput, hashInput, periodosEmpresa } from "./modelos";
import { costearModelo, ResultadoModelo } from "../domain/motor";
import { round2 } from "../domain/abc";
import * as A from "../domain/analitica";

export interface FilaPeriodo {
  periodo: string; nombre: string; periodoId: string; runId: string | null; vigente: boolean;
  total: number; cmd: number; csd: number; cpd: number; ci: number; navi: number; nav: number; av: number;
  capacidad: number; fuera: number; volumen: number; unitario: number | null;
  objetos: Record<string, { costo: number; cantidad: number | null; unitario: number | null }>;
  actividades: Record<string, number>;
  ppto: number | null; pptoVol: number | null;
  ventas: number | null;
  R: ResultadoModelo;
}

export interface Analitica {
  filas: FilaPeriodo[];
  faltantes: string[];
  desactualizados: string[];
  objetos: { id: string; codigo: string; nombre: string }[];
  actividades: { id: string; codigo: string; nombre: string; clase: string | null; alcance: string }[];
  // descriptivo
  ultima: FilaPeriodo;
  crecimientoInteranual: number | null;
  // diagnóstico
  varPpto: (ReturnType<typeof A.variacionPresupuesto> & { periodo: string; nombre: string })[];
  regresionVolumen: { a: number; b: number; r2: number; r: number };
  cambioMensual: { componente: string; anterior: number; actual: number; delta: number }[];
  cambioActividades: { codigo: string; nombre: string; anterior: number; actual: number; delta: number }[];
  anomalias: { objeto: string; periodo: string; nombre: string; valor: number; z: number }[];
  // predictivo
  pronosticos: A.ResultadoPronostico[];
  // relevancia
  paretoAct: ReturnType<typeof A.pareto<{ codigo: string; nombre: string; clase: string | null }>>;
  paretoEC: ReturnType<typeof A.pareto<{ codigo: string; nombre: string }>>;
  // hallazgos y propuestas
  hallazgos: { tipo: "HECHO" | "ASOCIACIÓN" | "HIPÓTESIS"; texto: string; evidencia: string }[];
  propuestas: Propuesta[];
}

export interface Propuesta {
  id: string; titulo: string; causa: string; accion: string; actividad: string; base: number; pct: number; ahorroMensual: number;
  inversion: number; plazoMeses: number; responsable: string; kpi: string; riesgo: string; supuesto: string;
}

// Memoria de la última analítica por base: se reutiliza mientras no cambie ningún dato (s.rev) ni el contexto.
const memoAnalitica = new WeakMap<Store, { clave: string; valor: Analitica | null }>();
export function construirAnalitica(s: Store, c: Contexto): Analitica | null {
  const clave = `${c.versionId}|${c.periodoId}|${s.rev}`;
  const m = memoAnalitica.get(s);
  if (m && m.clave === clave) return m.valor;
  const valor = construirAnaliticaSinMemoria(s, c);
  memoAnalitica.set(s, { clave, valor });
  return valor;
}

function construirAnaliticaSinMemoria(s: Store, c: Contexto): Analitica | null {
  const ps = periodosEmpresa(s, c.empresaId);
  if (!ps.length) return null;
  const objetos: any[] = s.all("SELECT id, codigo, nombre FROM objeto_costo WHERE version_id=? ORDER BY codigo", [c.versionId]);
  const actividades: any[] = s.all("SELECT id, codigo, nombre, clase_valor clase, alcance FROM actividad WHERE version_id=? ORDER BY orden, codigo", [c.versionId]);
  const ecs = s.all("SELECT id, codigo, nombre FROM elemento_costo WHERE version_id=? ORDER BY codigo", [c.versionId]);
  const filas: FilaPeriodo[] = [];
  const faltantes: string[] = [];
  const desactualizados: string[] = [];
  for (const p of ps) {
    const cc = { ...c, periodoId: p.id };
    const run = s.one("SELECT * FROM corrida WHERE version_id=? AND periodo_id=? AND etapa='ABC' ORDER BY creado_en DESC LIMIT 1", [c.versionId, p.id]);
    if (!run) {
      faltantes.push(p.nombre);
      continue;
    }
    const inp = cargarInput(s, cc);
    const vigente = hashInput(inp) === run.params_hash;
    if (!vigente) desactualizados.push(p.nombre);
    const R = costearModelo(inp);
    const cadena = R.resumen.filter((x) => x.act.alcance !== "EXCLUIDA");
    const sum = (f: (x: (typeof cadena)[number]) => number) => round2(cadena.reduce((a, x) => a + f(x), 0));
    const total = round2(R.objetos.reduce((a, o) => a + o.costo, 0));
    const volumen = R.objetos.reduce((a, o) => a + (o.obj.cantidad || 0), 0);
    const ppto = s.one("SELECT monto FROM presupuesto WHERE version_id=? AND periodo_id=? AND concepto LIKE 'Costo log%'", [c.versionId, p.id])?.monto ?? null;
    const pptoVol = s.one("SELECT monto FROM presupuesto WHERE version_id=? AND periodo_id=? AND concepto LIKE 'Volumen%'", [c.versionId, p.id])?.monto ?? null;
    const ventas = s.one("SELECT ventas FROM finanzas_periodo WHERE version_id=? AND periodo_id=?", [c.versionId, p.id])?.ventas ?? null;
    const objs: FilaPeriodo["objetos"] = {};
    for (const o of R.objetos) objs[o.obj.codigo] = { costo: o.costo, cantidad: o.obj.cantidad, unitario: o.unitario };
    const acts: Record<string, number> = {};
    for (const x of R.resumen) acts[x.act.codigo] = x.total;
    filas.push({
      periodo: p.codigo, nombre: p.nombre, periodoId: p.id, runId: run.id, vigente, total,
      cmd: sum((x) => x.cmd), csd: sum((x) => x.csd), cpd: sum((x) => x.cpd), ci: sum((x) => x.ci),
      navi: sum((x) => (x.act.clase === "NAVI" ? x.total : 0)), nav: sum((x) => (x.act.clase === "NAVN" ? x.total : 0)), av: sum((x) => (x.act.clase === "AV" ? x.total : 0)),
      capacidad: round2(R.saldos.filter((z) => z.tipo === "CAPACIDAD").reduce((a, z) => a + z.monto, 0)),
      fuera: round2(R.saldos.filter((z) => z.tipo === "FUERA_ALCANCE").reduce((a, z) => a + z.monto, 0)),
      volumen, unitario: volumen > 0 ? total / volumen : null, objetos: objs, actividades: acts, ppto, pptoVol, ventas, R,
    });
  }
  // defensa: la serie debe ser cronológica (AAAA-MM); si no lo es, se ordena y se advierte en pruebas
  filas.sort((a, b) => (/^\d{4}-\d{2}$/.test(a.periodo) && /^\d{4}-\d{2}$/.test(b.periodo) ? a.periodo.localeCompare(b.periodo) : 0));
  if (!filas.length) return { filas, faltantes, desactualizados, objetos, actividades } as any;
  const ultima = filas[filas.length - 1];
  const anioAntes = filas.find((f) => {
    const [y, m] = ultima.periodo.split("-").map(Number);
    return f.periodo === `${y - 1}-${String(m).padStart(2, "0")}`;
  });
  // ---- diagnóstico ----
  const varPpto = filas.filter((f) => f.ppto !== null && f.pptoVol).map((f) => ({ periodo: f.periodo, nombre: f.nombre, ...A.variacionPresupuesto(f.total, f.volumen, f.ppto!, f.pptoVol!) }));
  const rg = A.regresion(filas.map((f) => f.volumen), filas.map((f) => f.total));
  const regresionVolumen = { ...rg, r: A.pearson(filas.map((f) => f.volumen), filas.map((f) => f.total)) };
  const ant = filas.length > 1 ? filas[filas.length - 2] : null;
  const cambioMensual = ant
    ? (["cmd", "csd", "cpd", "ci"] as const).map((k) => ({ componente: { cmd: "Material directo (CMD)", csd: "Servicio directo (CSD)", cpd: "Personal directo (CPD)", ci: "Indirectos asignados (CI)" }[k], anterior: ant[k], actual: ultima[k], delta: round2(ultima[k] - ant[k]) }))
    : [];
  const cambioActividades = ant
    ? actividades.map((a) => ({ codigo: a.codigo, nombre: a.nombre, anterior: ant.actividades[a.codigo] || 0, actual: ultima.actividades[a.codigo] || 0, delta: round2((ultima.actividades[a.codigo] || 0) - (ant.actividades[a.codigo] || 0)) })).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 8)
    : [];
  const anom: Analitica["anomalias"] = [];
  for (const o of objetos) {
    const serie = filas.filter((f) => f.objetos[o.codigo]?.unitario != null).map((f) => ({ periodo: f.periodo, nombre: f.nombre, valor: f.objetos[o.codigo].unitario! }));
    for (const x of A.anomalias(serie, 2)) anom.push({ objeto: o.codigo, ...x });
  }
  // ---- predictivo ----
  const serie = (fn: (f: FilaPeriodo) => number | null) => filas.filter((f) => fn(f) !== null).map((f) => ({ periodo: f.periodo, nombre: f.nombre, valor: fn(f)! }));
  const pronosticos: A.ResultadoPronostico[] = [];
  if (filas.length >= 2) {
    pronosticos.push(A.pronosticar("Costo total de la cadena (S/)", serie((f) => f.total)));
    pronosticos.push(A.pronosticar("Volumen de pedidos", serie((f) => f.volumen)));
    pronosticos.push(A.pronosticar("Costo unitario por pedido (S/)", serie((f) => f.unitario)));
    for (const o of objetos) pronosticos.push(A.pronosticar(`Costo de ${o.codigo} ${o.nombre} (S/)`, serie((f) => f.objetos[o.codigo]?.costo ?? null)));
  }
  // ---- relevancia ----
  const acum: Record<string, number> = {};
  for (const f of filas) for (const a of actividades) acum[a.codigo] = (acum[a.codigo] || 0) + (f.actividades[a.codigo] || 0);
  const paretoAct = A.pareto(actividades.filter((a) => a.alcance !== "EXCLUIDA").map((a) => ({ codigo: a.codigo, nombre: a.nombre, clase: a.clase, total: acum[a.codigo] || 0 })), (x: any) => x.total) as any;
  const ecAcum: Record<string, number> = {};
  for (const f of filas) for (const g of f.R.p4a) ecAcum[g.origenId] = (ecAcum[g.origenId] || 0) + g.pool;
  const paretoEC = A.pareto(ecs.map((e) => ({ codigo: e.codigo, nombre: e.nombre, total: ecAcum[e.id] || 0 })), (x: any) => x.total) as any;
  // ---- hallazgos (hechos, asociaciones, hipótesis; nunca causalidad automática) ----
  const hallazgos: Analitica["hallazgos"] = [];
  const fm = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tot24 = filas.reduce((a, f) => a + f.total, 0);
  hallazgos.push({ tipo: "HECHO", texto: `Costo de la cadena en ${ultima.nombre}: S/ ${fm(ultima.total)} (${anioAntes ? ((ultima.total / anioAntes.total - 1) * 100).toFixed(1).replace(".", ",") + " % frente a " + anioAntes.nombre : "sin comparación interanual"}).`, evidencia: `Corridas ${ultima.runId}${anioAntes ? " y " + anioAntes.runId : ""}` });
  const naviT = filas.reduce((a, f) => a + f.navi, 0);
  if (naviT > 0) hallazgos.push({ tipo: "HECHO", texto: `Las actividades que no agregan valor e innecesarias (NAVI) acumulan S/ ${fm(naviT)} en ${filas.length} ${filas.length === 1 ? "mes" : "meses"} (${((naviT / tot24) * 100).toFixed(1).replace(".", ",")} % del costo de la cadena): potencial de ahorro.`, evidencia: "Resumen de costos por actividad, clase NAVI (Procesos)" });
  const capT = filas.reduce((a, f) => a + f.capacidad, 0);
  if (capT > 0) hallazgos.push({ tipo: "HECHO", texto: `Capacidad de personal pagada y no imputada: S/ ${fm(capT)} en ${filas.length} ${filas.length === 1 ? "mes" : "meses"}.`, evidencia: "Saldos de capacidad no utilizada de P3" });
  const pa = paretoAct.filter((x: any) => x.clase === "A");
  hallazgos.push({ tipo: "HECHO", texto: `${pa.length} de ${paretoAct.length} actividades de la cadena concentran el ${((pa.at(-1)?.acumulado || 0) * 100).toFixed(1).replace(".", ",")} % del costo (clase A de Pareto): ${pa.slice(0, 5).map((x: any) => x.item.codigo).join(", ")}${pa.length > 5 ? ` y ${pa.length - 5} más` : ""}.`, evidencia: "Análisis de relevancia (Pareto acumulado)" });
  if (filas.length >= 6) hallazgos.push({ tipo: "ASOCIACIÓN", texto: `El costo mensual se asocia al volumen de pedidos (r = ${regresionVolumen.r.toFixed(2).replace(".", ",")}, R² = ${regresionVolumen.r2.toFixed(2).replace(".", ",")}). Estimación: costo ≈ S/ ${fm(regresionVolumen.a)} fijos + S/ ${fm(regresionVolumen.b)} por pedido. Es una asociación estadística, no prueba causalidad.`, evidencia: "Regresión lineal costo ~ volumen sobre las corridas mensuales" });
  const vp = varPpto.at(-1);
  if (vp) hallazgos.push({ tipo: "HECHO", texto: `En ${vp.nombre} el costo real difiere del presupuesto en S/ ${fm(vp.variacion)} (${(vp.pct * 100).toFixed(1).replace(".", ",")} %): efecto volumen S/ ${fm(vp.efVol)} y efecto costo unitario S/ ${fm(vp.efCosto)}.`, evidencia: "Descomposición de variación real vs presupuesto" });
  const ecom = objetos.find((o) => /commerce/i.test(o.nombre));
  if (ecom) {
    const u = ultima.objetos[ecom.codigo]?.unitario, prom = media(objetos.filter((o) => o.codigo !== ecom.codigo).map((o) => ultima.objetos[o.codigo]?.unitario || 0));
    if (u && prom) hallazgos.push({ tipo: "HIPÓTESIS", texto: `El costo por pedido de ${ecom.nombre} (S/ ${fm(u)}) supera el promedio de los demás canales (S/ ${fm(prom)}). Hipótesis a contrastar: mayor número de entregas y devoluciones por pedido. Evidencia a revisar: inductores de A13 y A14.`, evidencia: "Costo unitario por objeto e inductores P4c" });
  }
  if (anom.length) hallazgos.push({ tipo: "HECHO", texto: `${anom.length} valor(es) atípico(s) de costo unitario (|z| ≥ 2): ${anom.slice(0, 4).map((a) => a.objeto + " " + a.nombre).join("; ")}. No se eliminan; requieren revisión.`, evidencia: "Puntaje z por objeto de costo" });
  // ---- propuestas (evaluación de alternativas con supuestos editables; no es optimización global) ----
  const promAct = (cod: string) => media(filas.slice(-12).map((f) => f.actividades[cod] || 0));
  const propuestas: Propuesta[] = [];
  const add = (p: Omit<Propuesta, "base" | "ahorroMensual"> & { baseFn: number }) => {
    const { baseFn, ...r } = p;
    if (baseFn > 0) propuestas.push({ ...r, base: round2(baseFn), ahorroMensual: round2(baseFn * p.pct) });
  };
  const navis = actividades.filter((a) => a.clase === "NAVI" && a.alcance !== "EXCLUIDA");
  for (const a of navis)
    add({ id: "PR-" + a.codigo, titulo: `Reducir «${a.nombre}»`, causa: `Actividad NAVI con costo promedio mensual alto (últimos 12 meses)`, accion: /reproces/i.test(a.nombre) ? "Verificación por escáner en picking y doble control de pedidos e-commerce" : /devoluc/i.test(a.nombre) ? "Confirmación de dirección y ventana horaria previa a la entrega" : "Rediseñar el proceso para eliminar la causa del retrabajo", actividad: a.codigo, baseFn: promAct(a.codigo), pct: 0.4, inversion: /reproces/i.test(a.nombre) ? 18000 : 9000, plazoMeses: 3, responsable: "Jefe del centro de la actividad", kpi: "Costo mensual de la actividad y nº de eventos", riesgo: "Medio: depende de la adopción del nuevo control", supuesto: "Reducción del 40 % del costo de la actividad (supuesto editable)" });
  if (capT > 0) propuestas.push({ id: "PR-CAP", titulo: "Reasignar capacidad no utilizada del personal", causa: "Horas pagadas no imputadas a actividades", accion: "Polivalencia y turnos flexibles entre recepción y picking en meses de baja demanda", actividad: "P3", base: round2(capT / filas.length), pct: 0.5, ahorroMensual: round2((capT / filas.length) * 0.5), inversion: 6000, plazoMeses: 2, responsable: "Jefe de operaciones (tipo)", kpi: "Capacidad no utilizada S/ por mes", riesgo: "Bajo", supuesto: "Se recupera el 50 % de la capacidad ociosa (supuesto editable)" });
  const courier = filas.slice(-12).map((f) => f.csd);
  if (media(courier) > 0) propuestas.push({ id: "PR-CSD", titulo: "Renegociar tarifas de servicios directos (courier)", causa: "Servicio directo creciente con el canal e-commerce", accion: "Licitación con 3 proveedores y tarifa escalonada por volumen", actividad: "P2", base: round2(media(courier)), pct: 0.08, ahorroMensual: round2(media(courier) * 0.08), inversion: 2500, plazoMeses: 2, responsable: "Jefe de compras (tipo)", kpi: "Tarifa promedio por envío", riesgo: "Bajo", supuesto: "Reducción de tarifa de 8 % (supuesto editable)" });
  const oc = actividades.find((a) => /[oó]rden(es)? de compra/i.test(a.nombre));
  if (oc) add({ id: "PR-" + oc.codigo, titulo: "Consolidar compras (menos órdenes de compra)", causa: "Costo por orden de compra y alto número de órdenes", accion: "Calendario de compras por familia, lote económico (EOQ) y contratos marco con proveedores clave (Kraljic)", actividad: oc.codigo, baseFn: promAct(oc.codigo), pct: 0.2, inversion: 4000, plazoMeses: 3, responsable: "Jefe de compras (tipo)", kpi: "Nº de OC por mes y costo por OC", riesgo: "Medio: posible aumento de inventario", supuesto: "20 % menos órdenes de compra (supuesto editable)" });
  return { filas, faltantes, desactualizados, objetos, actividades, ultima, crecimientoInteranual: anioAntes ? ultima.total / anioAntes.total - 1 : null, varPpto, regresionVolumen, cambioMensual, cambioActividades, anomalias: anom, pronosticos, paretoAct, paretoEC, hallazgos, propuestas };
}

const media = (x: number[]) => (x.length ? x.reduce((a, v) => a + v, 0) / x.length : 0);
