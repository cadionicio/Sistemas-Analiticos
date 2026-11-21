// Simulación estocástica (MT-31): cada muestra pasa por el MISMO motor ABC (costearModelo) y el mismo cálculo financiero.
// Reproducible por semilla (PRNG mulberry32). Variables independientes (supuesto declarado: no hay correlaciones estimadas).
import { ModeloInput, costearModelo } from "./motor";
import { round2 } from "./abc";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Muestra triangular por inversa de la función de distribución. */
export function triangular(u: number, a: number, c: number, b: number) {
  if (b === a) return a;
  const fc = (c - a) / (b - a);
  return u < fc ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
}

export interface DefVariable { id: string; nombre: string; efecto: string; aplicar(inp: ModeloInput, f: number): ModeloInput }
const rx = { courier: /courier|[uú]ltima milla|env[ií]o/i, combustible: /combust/i, personal: /personal/i };

/** Catálogo de variables: el efecto de cada factor sobre los datos del modelo es explícito y auditable. */
export const VARIABLES: DefVariable[] = [
  { id: "volumen_pedidos", nombre: "Volumen de pedidos", efecto: "Multiplica consumos de materiales (P1), cantidades de servicios directos (P2) y cantidades de los objetos de costo. Personal e indirectos no cambian (capacidad fija en el mes). En EVA también escala ventas y costo de ventas.",
    aplicar: (inp, f) => ({ ...inp, consumos: inp.consumos.map((x) => ({ ...x, cantidad: x.cantidad * f })), servicios: inp.servicios.map((x) => ({ ...x, cantidad: x.cantidad * f })), objetos: inp.objetos.map((o) => ({ ...o, cantidad: o.cantidad === null ? null : o.cantidad * f })) }) },
  { id: "tarifa_courier", nombre: "Tarifa del courier", efecto: "Multiplica la tarifa de los servicios directos de courier / última milla (P2).",
    aplicar: (inp, f) => ({ ...inp, servicios: inp.servicios.map((x) => (rx.courier.test(x.servicio + " " + x.proveedor) ? { ...x, tarifa: x.tarifa * f } : x)) }) },
  { id: "precio_combustible", nombre: "Precio del combustible", efecto: "Multiplica el monto del elemento de costo indirecto «Combustible» (P4a).",
    aplicar: (inp, f) => ({ ...inp, ecs: inp.ecs.map((e) => (rx.combustible.test(e.nombre) ? { ...e, monto: round2(e.monto * f) } : e)) }) },
  { id: "remuneraciones", nombre: "Remuneraciones (costo por persona)", efecto: "Multiplica el costo empresa de cada persona (P3) y el elemento «Personal indirecto» (P4a).",
    aplicar: (inp, f) => {
      // al céntimo: el pool «Personal indirecto» cambia exactamente en lo que cambia el personal indirecto (no se rompe la relación D-05)
      const personas = inp.personas.map((p) => ({ ...p, costo: round2(p.costo * f) }));
      const ind = (ps: typeof personas) => ps.filter((p) => p.tipo === "INDIRECTO").reduce((a, p) => a + p.costo, 0);
      const delta = round2(ind(personas) - ind(inp.personas));
      const hayInd = inp.personas.some((p) => p.tipo === "INDIRECTO");
      return { ...inp, personas, ecs: inp.ecs.map((e) => (rx.personal.test(e.nombre) ? { ...e, monto: round2(hayInd ? e.monto + delta : e.monto * f) } : e)) };
    } },
  { id: "precio_materiales", nombre: "Precio de materiales", efecto: "Multiplica el costo de factura de todos los materiales directos (P1).",
    aplicar: (inp, f) => ({ ...inp, materiales: inp.materiales.map((m) => ({ ...m, costoFactura: m.costoFactura * f })) }) },
  { id: "horas_imputadas", nombre: "Horas imputadas a actividades", efecto: "Multiplica las horas imputadas de cada persona (P3). Cambia la capacidad no utilizada; si una persona supera sus horas disponibles, la iteración queda bloqueada y se cuenta aparte.",
    aplicar: (inp, f) => ({ ...inp, horas: inp.horas.map((h) => ({ ...h, horas: h.horas * f })) }) },
];
export const variablePorId = (id: string) => VARIABLES.find((v) => v.id === id);

export interface VarEscenario { variable: string; minimo: number; moda: number; maximo: number; heredada?: boolean }

export function validarVariables(vs: VarEscenario[]) {
  const errores: string[] = [];
  for (const v of vs) {
    if (!variablePorId(v.variable)) errores.push(`Variable «${v.variable}» sin efecto definido en el catálogo: no se simula.`);
    if (!(v.minimo > 0) || !(v.minimo <= v.moda && v.moda <= v.maximo)) errores.push(`«${v.variable}»: se requiere 0 < mínimo ≤ moda ≤ máximo (hay ${v.minimo}; ${v.moda}; ${v.maximo}).`);
  }
  return errores;
}

/** Aplica un conjunto de factores al input base y lo pasa por el motor ABC. Nunca modifica el input base. */
export function costearConFactores(base: ModeloInput, factores: Record<string, number>) {
  let inp = base;
  for (const [id, f] of Object.entries(factores)) {
    const d = variablePorId(id);
    if (d && f !== 1) inp = d.aplicar(inp, f);
  }
  const R = costearModelo(inp);
  const costo = R.objetos.reduce((a, o) => a + o.costo, 0);
  const volumen = R.objetos.reduce((a, o) => a + (o.obj.cantidad || 0), 0);
  return { costo, volumen, unitario: volumen > 0 ? costo / volumen : NaN, bloqueado: R.bloqueos.length > 0, cuadra: R.cuadra };
}

/** Contexto financiero anual para trasladar cada muestra a EVA (opcional). */
export interface ContextoEVA {
  ventas: number; costoVentas: number; otrosGastos: number; costoLogisticoAnual: number; costoBaseMes: number; t: number; wacc: number; capital: number;
}
export function evaMuestra(cx: ContextoEVA, costoMes: number, fVolumen: number) {
  const logistico = cx.costoLogisticoAnual * (costoMes / cx.costoBaseMes); // el efecto relativo del mes base se aplica al año (supuesto declarado)
  const uo = cx.ventas * fVolumen - cx.costoVentas * fVolumen - logistico - cx.otrosGastos;
  const n = uo - (uo > 0 ? uo * cx.t : 0);
  return n - cx.wacc * cx.capital;
}

export interface Muestra { costo: number; unitario: number; eva: number | null; bloqueado: boolean }

/** Simulador por lotes: permite avance real y cancelación segura (la UI llama paso() en bloques). */
export class Simulador {
  private rnd: () => number;
  muestras: Muestra[] = [];
  constructor(private base: ModeloInput, private vars: VarEscenario[], readonly semilla: number, readonly iteraciones: number, private eva?: ContextoEVA) {
    this.rnd = mulberry32(semilla);
  }
  get terminado() { return this.muestras.length >= this.iteraciones; }
  paso(n: number) {
    const fin = Math.min(this.iteraciones, this.muestras.length + n);
    while (this.muestras.length < fin) {
      const f: Record<string, number> = {};
      for (const v of this.vars) f[v.variable] = triangular(this.rnd(), v.minimo, v.moda, v.maximo); // orden fijo de variables → reproducible
      const r = costearConFactores(this.base, f);
      this.muestras.push({ costo: r.costo, unitario: r.unitario, bloqueado: r.bloqueado, eva: this.eva ? evaMuestra(this.eva, r.costo, f.volumen_pedidos ?? 1) : null });
    }
    return this.muestras.length;
  }
}

export function percentil(ordenados: number[], p: number) {
  if (!ordenados.length) return NaN;
  const i = (ordenados.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return ordenados[lo] + (ordenados[hi] - ordenados[lo]) * (i - lo);
}

export function resumir(valores: number[], umbral?: number | null, bins = 24) {
  const v = valores.filter((x) => isFinite(x));
  const s = [...v].sort((a, b) => a - b);
  const n = s.length;
  const media = v.reduce((a, x) => a + x, 0) / (n || 1);
  const sd = n > 1 ? Math.sqrt(v.reduce((a, x) => a + (x - media) ** 2, 0) / (n - 1)) : 0;
  const min = s[0], max = s[n - 1];
  const w = (max - min) / bins || 1;
  const hist = Array.from({ length: bins }, (_, k) => ({ desde: min + k * w, hasta: min + (k + 1) * w, n: 0 }));
  for (const x of s) hist[Math.min(bins - 1, Math.floor((x - min) / w))].n++;
  return {
    n, media, sd, min, max, p5: percentil(s, 0.05), p50: percentil(s, 0.5), p95: percentil(s, 0.95),
    probSupera: umbral === null || umbral === undefined ? null : s.filter((x) => x > umbral).length / (n || 1),
    probNegativo: s.filter((x) => x < 0).length / (n || 1), hist,
  };
}

/** Estabilidad: media y P50 al 25 %, 50 %, 75 % y 100 % de las iteraciones (control de convergencia aproximada). */
export function convergencia(valores: number[]) {
  return [0.25, 0.5, 0.75, 1].map((q) => {
    const k = Math.max(1, Math.round(valores.length * q));
    const sub = valores.slice(0, k);
    const s = [...sub].sort((a, b) => a - b);
    return { fraccion: q, n: k, media: sub.reduce((a, x) => a + x, 0) / k, p50: percentil(s, 0.5), p95: percentil(s, 0.95) };
  });
}

/** Sensibilidad uno a la vez: cada variable en su mínimo y máximo con las demás en su moda (motor ABC real). */
export function sensibilidad(base: ModeloInput, vars: VarEscenario[], eva?: ContextoEVA) {
  const modas: Record<string, number> = {};
  for (const v of vars) modas[v.variable] = v.moda;
  const ref = costearConFactores(base, modas);
  const evaRef = eva ? evaMuestra(eva, ref.costo, modas.volumen_pedidos ?? 1) : null;
  const filas = vars.map((v) => {
    const lo = costearConFactores(base, { ...modas, [v.variable]: v.minimo });
    const hi = costearConFactores(base, { ...modas, [v.variable]: v.maximo });
    const eLo = eva ? evaMuestra(eva, lo.costo, v.variable === "volumen_pedidos" ? v.minimo : modas.volumen_pedidos ?? 1) : null;
    const eHi = eva ? evaMuestra(eva, hi.costo, v.variable === "volumen_pedidos" ? v.maximo : modas.volumen_pedidos ?? 1) : null;
    return { variable: v.variable, minimo: v.minimo, maximo: v.maximo, costoMin: lo.costo, costoMax: hi.costo, rango: Math.abs(hi.costo - lo.costo), evaMin: eLo, evaMax: eHi };
  });
  filas.sort((a, b) => b.rango - a.rango);
  return { costoModa: ref.costo, evaModa: evaRef, filas };
}
