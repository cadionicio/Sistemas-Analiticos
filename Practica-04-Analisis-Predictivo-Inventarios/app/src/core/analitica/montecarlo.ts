/**
 * Skill "simular_escenarios" — SIMULACIÓN ESTOCÁSTICA (Monte Carlo) de escenarios.
 * (A) Inventario, simulación DIARIA a 6 meses (183 días) de la política (s,Q) para los productos clase A:
 *     demanda diaria por BOOTSTRAP de la historia diaria real (con días en cero) × factor del escenario;
 *     plazo de suministro ~ Normal(LT·f, σLT) truncado a ≥ 1 día; ventas perdidas (sin pedidos pendientes).
 *     Costos: mantener = stock × costo × tasa/365; ordenar = S por orden; faltante = unid. perdidas × costo_faltante.
 * (B) Ventas y utilidad a 6 meses: ventas por bootstrap del modelo elegido (Paso 7) × factor; margen mensual por
 *     bootstrap de los márgenes de los últimos 36 meses + desplazamiento (pp) del escenario; utilidad = ventas × margen.
 * Escenarios: pesimista / base / optimista / personalizado. Semilla fija. Tornado de sensibilidad. Chequeo de convergencia.
 * Nota: se usa bootstrap empírico en lugar de ajustar una distribución paramétrica, porque la demanda diaria es intermitente
 * (muchos ceros) y ninguna distribución estándar la representa bien; el supuesto de la normal truncada del plazo es explícito.
 */
import type { SqlValue } from 'sql.js';
import type { BaseDatos } from '../db/db';
import { guardarEjecucion, mesMas, nuevoResultado, rangoMeses, type ResultadoSkill } from './contrato';
import { cuantil, media, suma } from './estadistica';
import { mulberry32 } from './pronostico/prng';
import { MODELOS_CONTINUOS } from './pronostico/modelos';
import { evaluar, seleccionar } from './pronostico/backtest';
import { simular } from './pronostico/simulacion';
import { normInv, param, type Prescriptivo } from './prescriptivo';
import { registrarUso } from '../bitacora';

export const VERSION_SIMULACION = 'simular_escenarios@1.0.0';

// ------------------------------------------------------------------ (A) inventario
export interface ProductoSim { codigo: string; demandaDiaria: number[]; stockInicial: number; s: number; Q: number }
export interface EscenarioInv { nombre: string; fDemanda: number; fLT: number; nivelServicio?: number }
export interface ParamInv { LT: number; sLT: number; costo: number; tasa: number; S: number; costoFaltante: number; dias: number }
export interface ResultadoInv {
  escenario: string; iteraciones: number;
  fillRate: Resumen; probQuiebre: number; probQuiebreProducto: number; stockPromedio: Resumen; costoTotal: Resumen; ordenes: Resumen; unidadesPerdidas: Resumen;
  histogramaCosto: { desde: number; hasta: number; n: number }[];
}
export interface Resumen { media: number; p5: number; p50: number; p95: number }
const resumen = (x: number[]): Resumen => ({ media: media(x), p5: cuantil(x, 0.05), p50: cuantil(x, 0.5), p95: cuantil(x, 0.95) });
function histograma(x: number[], bins = 30) {
  const mn = Math.min(...x), mx = Math.max(...x), w = (mx - mn) / bins || 1;
  const h = Array.from({ length: bins }, (_, i) => ({ desde: mn + i * w, hasta: mn + (i + 1) * w, n: 0 }));
  x.forEach((v) => h[Math.min(bins - 1, Math.floor((v - mn) / w))].n++);
  return h;
}
function normal(rand: () => number): number { // Box-Muller
  let u = 0; while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Simula la política (s,Q) de un conjunto de productos. Función pura (sin BD) para poder probarla con casos exactos. */
export function simularPolitica(productos: ProductoSim[], p: ParamInv, esc: EscenarioInv, N: number, rand: () => number, sAjustado?: (prod: ProductoSim) => number): ResultadoInv {
  const fill: number[] = [], stockProm: number[] = [], costo: number[] = [], ords: number[] = [], perd: number[] = [];
  let conQuiebre = 0, prodQuiebre = 0;
  const hold = (p.costo * p.tasa) / 365;
  for (let it = 0; it < N; it++) {
    let dem = 0, serv = 0, stockAcum = 0, c = 0, nOrd = 0, perdidas = 0, algun = false;
    for (const prod of productos) {
      const s = sAjustado ? sAjustado(prod) : prod.s;
      let stock = Math.max(0, prod.stockInicial);
      const llegadas: { dia: number; q: number }[] = [];
      let pendiente = 0, quiebre = false;
      const hist = prod.demandaDiaria, nh = hist.length;
      for (let d = 0; d < p.dias; d++) {
        for (let k = llegadas.length - 1; k >= 0; k--) if (llegadas[k].dia === d) { stock += llegadas[k].q; pendiente -= llegadas[k].q; llegadas.splice(k, 1); }
        const D = nh ? hist[Math.floor(rand() * nh)] * esc.fDemanda : 0;
        const sv = Math.min(stock, D);
        stock -= sv; dem += D; serv += sv;
        if (D - sv > 1e-9) { quiebre = true; perdidas += D - sv; }
        if (stock + pendiente <= s && prod.Q > 0) {
          const lt = Math.max(1, Math.round(p.LT * esc.fLT + (p.sLT > 0 ? p.sLT * normal(rand) : 0)));
          llegadas.push({ dia: d + lt, q: prod.Q }); pendiente += prod.Q; nOrd++; c += p.S;
        }
        c += stock * hold; stockAcum += stock;
      }
      if (quiebre) { algun = true; prodQuiebre++; }
    }
    c += perdidas * p.costoFaltante;
    fill.push(dem > 0 ? serv / dem : 1); stockProm.push(stockAcum / p.dias); costo.push(c); ords.push(nOrd); perd.push(perdidas);
    if (algun) conQuiebre++;
  }
  return { escenario: esc.nombre, iteraciones: N, fillRate: resumen(fill), probQuiebre: conQuiebre / N, probQuiebreProducto: prodQuiebre / (N * Math.max(1, productos.length)),
    stockPromedio: resumen(stockProm), costoTotal: resumen(costo), ordenes: resumen(ords), unidadesPerdidas: resumen(perd), histogramaCosto: histograma(costo) };
}

// ------------------------------------------------------------------ (B) ventas y utilidad
export interface EscenarioVtas { nombre: string; fVentas: number; deltaMargenPp: number; fVolatilidad: number }
export interface ResultadoVtas { escenario: string; iteraciones: number; ventas6m: Resumen; utilidad6m: Resumen; probUtilidadNegativa: number; histogramaUtilidad: { desde: number; hasta: number; n: number }[] }

export function simularUtilidad(ventasHist: number[], margenesHist: number[], esc: EscenarioVtas, N: number, rand: () => number): ResultadoVtas {
  const ev = evaluar(MODELOS_CONTINUOS, ventasHist, 6, 12, true);
  const m = MODELOS_CONTINUOS.find((x) => x.nombre === seleccionar(ev).modelo)!;
  const sim = simular(m.ajustar(ventasHist)!, 6, N, rand, true, true);
  const mm = media(margenesHist);
  const vt: number[] = [], ut: number[] = [];
  for (let i = 0; i < N; i++) {
    let v = 0, u = 0;
    for (let h = 0; h < 6; h++) {
      const vh = sim.matriz![h][i] * esc.fVentas;
      const mg = mm + (margenesHist[Math.floor(rand() * margenesHist.length)] - mm) * esc.fVolatilidad + esc.deltaMargenPp / 100;
      v += vh; u += vh * mg;
    }
    vt.push(v); ut.push(u);
  }
  return { escenario: esc.nombre, iteraciones: N, ventas6m: resumen(vt), utilidad6m: resumen(ut), probUtilidadNegativa: ut.filter((x) => x < 0).length / N, histogramaUtilidad: histograma(ut) };
}

// ------------------------------------------------------------------ skill
export interface Simulacion {
  semilla: number; iteraciones: number;
  inventario: { productos: string[]; escenarios: ResultadoInv[]; tornado: { factor: string; bajo: number; alto: number; base: number }[]; convergencia: { p50N: number; p50N2: number; ok: boolean } } | null;
  ventas: { escenarios: ResultadoVtas[]; tornado: { factor: string; bajo: number; alto: number; base: number }[]; horizonte: string[] } | null;
}
export interface OpcionesSim { semilla?: number; iteraciones?: number; maxProductos?: number; personalizadoInv?: EscenarioInv; personalizadoVtas?: EscenarioVtas }

export const ESC_INV: EscenarioInv[] = [
  { nombre: 'Pesimista', fDemanda: 1.2, fLT: 1.5 }, { nombre: 'Base', fDemanda: 1, fLT: 1 }, { nombre: 'Optimista', fDemanda: 0.9, fLT: 0.8 }];
export const ESC_VTAS: EscenarioVtas[] = [
  { nombre: 'Pesimista', fVentas: 0.95, deltaMargenPp: -1, fVolatilidad: 1.2 }, { nombre: 'Base', fVentas: 1, deltaMargenPp: 0, fVolatilidad: 1 }, { nombre: 'Optimista', fVentas: 1.05, deltaMargenPp: 0.5, fVolatilidad: 0.8 }];

export function simularEscenarios(bd: BaseDatos, pres: Prescriptivo | null, kardexId: number | null, ventasId: number | null, op: OpcionesSim = {}): ResultadoSkill<Simulacion> {
  const t0 = Date.now();
  const semilla = op.semilla ?? param(bd, 'mc_semilla', 24092026), N = op.iteraciones ?? param(bd, 'mc_iteraciones', 10000);
  const base = nuevoResultado<Simulacion>(bd, 'simular_escenarios', VERSION_SIMULACION, (kardexId ?? ventasId)!, null);
  const rand = mulberry32(semilla);
  let inventario: Simulacion['inventario'] = null, ventas: Simulacion['ventas'] = null;

  if (kardexId && pres) {
    const ds = bd.una<{ fecha_min: string; ultimo_mes_cerrado: string }>('SELECT fecha_min, ultimo_mes_cerrado FROM dataset WHERE id=?', [kardexId])!;
    const fin = `${ds.ultimo_mes_cerrado}-31`;
    const dias: string[] = [];
    for (let t = Date.parse(ds.fecha_min); ; t += 86400000) { const d = new Date(t).toISOString().slice(0, 10); if (d > fin || d.slice(0, 7) > ds.ultimo_mes_cerrado) break; dias.push(d); }
    const iDia = new Map(dias.map((d, i) => [d, i]));
    const elegidos = pres.politicas.filter((x) => x.clase === 'A' && x.politica !== 'REVISAR').sort((a, b) => b.demandaMesPron - a.demandaMesPron).slice(0, op.maxProductos ?? 25);
    const productos: ProductoSim[] = elegidos.map((x) => {
      const serie = new Array(dias.length).fill(0);
      for (const r of bd.todas<{ f: string; s: number }>("SELECT fecha f, sum(salida) s FROM kardex_mov WHERE producto_id=? AND origen='excel' AND fecha<=? GROUP BY fecha", [x.pid, fin])) {
        const i = iDia.get(r.f); if (i != null) serie[i] = r.s ?? 0;
      }
      return { codigo: x.codigo, demandaDiaria: serie, stockInicial: x.stockActual, s: x.rop, Q: Math.max(1, Math.ceil(Math.max(x.eoq, x.sObjetivo - x.rop))) };
    });
    const P: ParamInv = { LT: pres.parametros.LT, sLT: pres.parametros.sLT, costo: pres.parametros.costo, tasa: pres.parametros.tasa, S: pres.parametros.S, costoFaltante: param(bd, 'costo_faltante_unit', 1), dias: 183 };
    const escs = [...ESC_INV, ...(op.personalizadoInv ? [op.personalizadoInv] : [])];
    const sPorNS = (ns: number) => (prod: ProductoSim) => {
      const x = elegidos.find((e) => e.codigo === prod.codigo)!;
      return x.dDia * P.LT + normInv(ns) * Math.sqrt(P.LT * x.sdDia ** 2 + x.dDia ** 2 * P.sLT ** 2);
    };
    const res = escs.map((e) => simularPolitica(productos, P, e, N, rand, e.nivelServicio ? sPorNS(e.nivelServicio) : undefined));
    const Nt = Math.max(500, Math.round(N / 10));
    const fr = (e: EscenarioInv, ns?: number, pp: ParamInv = P) => simularPolitica(productos, pp, e, Nt, rand, ns ? sPorNS(ns) : undefined).fillRate.media;
    const b0 = { nombre: 'Base', fDemanda: 1, fLT: 1 };
    const baseFR = fr(b0);
    const tornado = [
      { factor: 'Demanda ±20 %', bajo: fr({ ...b0, fDemanda: 0.8 }), alto: fr({ ...b0, fDemanda: 1.2 }), base: baseFR },
      { factor: 'Plazo de suministro ±50 %', bajo: fr({ ...b0, fLT: 0.5 }), alto: fr({ ...b0, fLT: 1.5 }), base: baseFR },
      { factor: 'Variabilidad del plazo (σLT ×0,5 / ×2)', bajo: fr(b0, undefined, { ...P, sLT: P.sLT * 0.5 }), alto: fr(b0, undefined, { ...P, sLT: P.sLT * 2 }), base: baseFR },
      { factor: 'Nivel de servicio 85 % / 99 %', bajo: fr(b0, 0.85), alto: fr(b0, 0.99), base: baseFR },
    ];
    const half = simularPolitica(productos, P, ESC_INV[1], Math.round(N / 2), rand).costoTotal.p50;
    const full = res[1].costoTotal.p50;
    inventario = { productos: productos.map((x) => x.codigo), escenarios: res, tornado, convergencia: { p50N: full, p50N2: half, ok: Math.abs(full - half) / Math.max(1, Math.abs(full)) < 0.02 } };
  }

  if (ventasId) {
    const cutoff = bd.valor<string>('SELECT ultimo_mes_cerrado FROM dataset WHERE id=?', [ventasId]);
    const desde = bd.valor<string>('SELECT min(periodo) FROM venta WHERE dataset_id=?', [ventasId]);
    const meses = rangoMeses(desde, cutoff);
    const mp = new Map(bd.todas<{ p: string; v: number; u: number }>('SELECT periodo p, sum(soles) v, sum(utilidad) u FROM venta WHERE dataset_id=? AND periodo<=? GROUP BY 1', [ventasId, cutoff]).map((r) => [r.p, r]));
    const v = meses.map((m) => mp.get(m)?.v ?? 0);
    const mg = meses.slice(-36).map((m) => (mp.get(m)?.u ?? 0) / (mp.get(m)?.v || 1));
    const escs = [...ESC_VTAS, ...(op.personalizadoVtas ? [op.personalizadoVtas] : [])];
    const res = escs.map((e) => simularUtilidad(v, mg, e, N, rand));
    const Nt = Math.max(500, Math.round(N / 10));
    const b0: EscenarioVtas = { nombre: 'Base', fVentas: 1, deltaMargenPp: 0, fVolatilidad: 1 };
    const u = (e: EscenarioVtas) => simularUtilidad(v, mg, e, Nt, rand).utilidad6m.p50;
    const baseU = u(b0);
    ventas = { horizonte: rangoMeses(mesMas(cutoff, 1), mesMas(cutoff, 6)), escenarios: res, tornado: [
      { factor: 'Ventas ±10 %', bajo: u({ ...b0, fVentas: 0.9 }), alto: u({ ...b0, fVentas: 1.1 }), base: baseU },
      { factor: 'Margen ±1 pp', bajo: u({ ...b0, deltaMargenPp: -1 }), alto: u({ ...b0, deltaMargenPp: 1 }), base: baseU },
      { factor: 'Volatilidad del margen ×0,5 / ×1,5', bajo: u({ ...b0, fVolatilidad: 0.5 }), alto: u({ ...b0, fVolatilidad: 1.5 }), base: baseU },
    ] };
  }

  const result: Simulacion = { semilla, iteraciones: N, inventario, ventas };
  const r: ResultadoSkill<Simulacion> = { ...base, result };
  r.assumptions.push({ clave: 'demanda_diaria', valor: 'Bootstrap i.i.d. de la demanda diaria histórica (incluye días en cero)', es_supuesto: true });
  r.assumptions.push({ clave: 'plazo', valor: 'Plazo ~ Normal(LT, σLT) truncado a ≥ 1 día (SUPUESTO: no hay fechas de pedido en los datos)', es_supuesto: true });
  r.assumptions.push({ clave: 'faltantes', valor: 'Ventas perdidas (sin pedidos pendientes)', es_supuesto: true });
  if (inventario) {
    const [pe, ba, op2] = inventario.escenarios;
    r.validation.push({ regla: 'Monotonía: fill rate pesimista ≤ base ≤ optimista', ok: pe.fillRate.media <= ba.fillRate.media + 1e-9 && ba.fillRate.media <= op2.fillRate.media + 0.005 });
    r.validation.push({ regla: 'Convergencia: P50 del costo con N y N/2 difiere < 2 %', ok: inventario.convergencia.ok });
  }
  if (ventas) {
    const [pe, ba, op2] = ventas.escenarios;
    r.validation.push({ regla: 'Monotonía: utilidad P50 pesimista ≤ base ≤ optimista', ok: pe.utilidad6m.p50 <= ba.utilidad6m.p50 && ba.utilidad6m.p50 <= op2.utilidad6m.p50 });
  }
  r.status = r.validation.every((x) => x.ok) ? 'OK' : 'NEEDS_REVIEW';
  r.estado_flujo = 'PROPUESTO';
  r.next_action = 'redactar_informe';
  guardarEjecucion(bd, r);
  const filasS: SqlValue[][] = [], filasR: SqlValue[][] = [];
  if (inventario) inventario.escenarios.forEach((e) => {
    filasS.push([r.run_id, `Inventario · ${e.escenario}`, semilla, e.iteraciones, JSON.stringify({ productos: inventario!.productos.length })]);
    const add = (m: string, x: Resumen, prob: number | null = null, hist: unknown = null) => filasR.push([r.run_id, `Inventario · ${e.escenario}`, m, x.media, x.p5, x.p50, x.p95, prob, hist == null ? null : JSON.stringify(hist)]);
    add('fill_rate', e.fillRate); add('costo_total_6m', e.costoTotal, null, e.histogramaCosto); add('stock_promedio', e.stockPromedio); add('unidades_perdidas', e.unidadesPerdidas);
    filasR.push([r.run_id, `Inventario · ${e.escenario}`, 'prob_quiebre', null, null, null, null, e.probQuiebre, null]);
  });
  if (ventas) ventas.escenarios.forEach((e) => {
    filasS.push([r.run_id, `Ventas · ${e.escenario}`, semilla, e.iteraciones, JSON.stringify(ESC_VTAS.find((x) => x.nombre === e.escenario) ?? op.personalizadoVtas)]);
    filasR.push([r.run_id, `Ventas · ${e.escenario}`, 'ventas_6m', e.ventas6m.media, e.ventas6m.p5, e.ventas6m.p50, e.ventas6m.p95, null, null]);
    filasR.push([r.run_id, `Ventas · ${e.escenario}`, 'utilidad_6m', e.utilidad6m.media, e.utilidad6m.p5, e.utilidad6m.p50, e.utilidad6m.p95, e.probUtilidadNegativa, JSON.stringify(e.histogramaUtilidad)]);
  });
  bd.insertarMuchos('INSERT INTO simulacion (run_id, escenario, semilla, iteraciones, parametros_json) VALUES (?,?,?,?,?)', filasS);
  bd.insertarMuchos('INSERT INTO simulacion_resultado (run_id, escenario, metrica, media, p5, p50, p95, probabilidad, histograma_json) VALUES (?,?,?,?,?,?,?,?,?)', filasR);
  registrarUso(bd, 'Simulación Monte Carlo de escenarios', 'Simulación de escenarios', `run ${r.run_id.slice(0, 8)} · ${N} iteraciones · semilla ${semilla}`, t0);
  return r;
}
export { suma };
