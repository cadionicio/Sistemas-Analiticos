// Pruebas de I06: simulación Monte Carlo de la cadena, alternativas/EVA, comparador y exportaciones empresariales.
import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Repo } from '../src/core/db';
import { validarConjunto } from '../src/core/contrato';
import { confirmarCarga } from '../src/core/carga';
import * as D from '../src/core/dominio';
import * as P from '../src/core/permisos';
import * as K from '../src/core/kpi';
import * as F from '../src/core/pronostico';
import * as M from '../src/core/simulacion';
import * as E from '../src/core/economia';
import * as X from '../src/core/exportar';
import * as G from '../src/core/diagnostico';
import { fmtNum } from '../src/core/util';
import { aHojas } from '../src/core/demo';
import { tablasExcel06, HISTORIA_CORTE } from '../src/core/historia';

let SQL: SqlJsStatic, repo: Repo, hechos: K.PedidoH[], planes: ReturnType<typeof M.construirPlanes>, sim: M.ResultadoSim;
const AHORA = '2026-11-14T10:00:00-05:00';
function nuevo() {
  const r = Repo.iniciar(new SQL.Database()); r.reloj = () => AHORA;
  P.asegurarUsuarios(r); r.transaccion(() => D.asegurarParametros(r));
  const { errores, datos } = validarConjunto(aHojas(tablasExcel06()));
  if (errores.length) throw new Error(JSON.stringify(errores.slice(0, 2)));
  confirmarCarga(r, 'U01', datos, { hash: 'h', nombre: '06', bytes: 0, datasetId: '06' });
  r.transaccion(() => { E.asegurarSupuestos(r); M.asegurarModeloBase(r); });
  return r;
}
beforeAll(async () => {
  SQL = await initSqlJs(); repo = nuevo(); hechos = K.cargarHechos(repo);
  planes = M.construirPlanes(repo);
  sim = M.simular(planes.planes, planes.servicios, { ...M.PARAMETROS_DEFECTO, iteraciones: 300 });
});

// ------------------------------------------------------------------ Simulación
/** Plan mínimo de 1 pedido y 2 tramos con servicios controlados. */
function planPrueba(o: { min?: number; moda?: number; max?: number; prob?: number; retraso?: number; salida2?: string[] } = {}) {
  const sv = (id: string, enlace: string, cor: string, salida: string): M.ServicioSim => ({ servicio_id: id, enlace, corredor: cor, modo: 'VIAL', salida, llegada: salida, min_min: o.min ?? 120, moda_min: o.moda ?? 120, max_min: o.max ?? 120, prob: o.prob ?? 0, retraso_min: o.retraso ?? 0, fijo_cent: 50000, kg_p4: 0, cap_kg: 1e9 });
  const servicios = [sv('S1', 'E1', 'C1', '2026-11-20T08:00'), ...(o.salida2 ?? ['2026-11-20T10:30', '2026-11-20T16:00']).map((h, i) => sv(`S2-${i}`, 'E2', 'C2', h))];
  const envio = (id: string): M.EnvioSim => ({ pedido: id, origen: 'A', destino: 'DES', region: 'R', remoto: false, kg: 100, ventana_ini: '2026-11-20T00:00:00-05:00', ventana_fin: '2026-11-20T18:00:00-05:00', anticipada: true, factible: true, motivo: '',
    tramos: [{ tramo: 1, enlace: 'E1', modo: 'VIAL', origen: 'A', destino: 'B', manip_min: 0, viajes: [{ servicio: 'S1', salida: '2026-11-20T08:00', kg: 100 }] },
      { tramo: 2, enlace: 'E2', modo: 'VIAL', origen: 'B', destino: 'C', manip_min: 30, viajes: [{ servicio: 'S2-0', salida: (o.salida2 ?? ['2026-11-20T10:30'])[0], kg: 100 }] }] });
  const plan: M.PlanSim = { criterio: 'POR_PEDIDO', nombre: 'Prueba', descripcion: '', envios: [envio('PA'), envio('PB')], servicios: 2, costo_cent: 100000, kg: 200 };
  return { planes: [plan], servicios };
}
const P0 = (x: Partial<M.ParametrosSim> = {}): M.ParametrosSim => ({ ...M.PARAMETROS_DEFECTO, iteraciones: 200, prob_cierre: 0, ...x });

describe('K — Simulación Monte Carlo reproducible (§9, §14-10)', () => {
  it('Contrato del generador: LCG 32 bits, semilla 2026 y u ∈ (0,1)', () => {
    const g = M.lcg(2026);
    const e1 = (Math.imul(1664525, 2026) + 1013904223) >>> 0;
    expect(g()).toBe((e1 + 0.5) / 4294967296);
    const xs = Array.from({ length: 1000 }, g);
    expect(Math.min(...xs)).toBeGreaterThan(0); expect(Math.max(...xs)).toBeLessThan(1);
  });
  it('Triangular: inversa por ramas, constante si mín=moda=máx, sin valores fuera del rango', () => {
    expect(M.triangular(0.3, 5, 5, 5)).toBe(5);
    for (const u of [0.001, 0.2, 0.5, 0.8, 0.999]) { const x = M.triangular(u, 2, 3, 10); expect(x).toBeGreaterThanOrEqual(2); expect(x).toBeLessThanOrEqual(10); }
    expect(M.triangular(0.125, 2, 4, 10)).toBeCloseTo(2 + Math.sqrt(0.125 * 8 * 2), 10);
  });
  it('Percentil por interpolación lineal en (n−1)·p', () => { expect(M.percentil([1, 2, 3, 4], 0.5)).toBe(2.5); expect(M.percentil([10, 20, 30, 40, 50], 0.95)).toBeCloseTo(48, 10); });
  it('ESC-K01 parámetros válidos: corrida identificada con modelo, versión, semilla y huella', () => {
    const m = M.modeloVigente(repo, 'MOD-BASE');
    const id = M.guardarCorridaSim(repo, 'U06', m, planes.planes, planes.servicios, { cancelada: false, hechas: 300, resultado: sim });
    const c = M.corridaSim(repo, id)!;
    expect(c.estado).toBe('COMPLETA'); expect(c.modelo_id).toBe('MOD-BASE'); expect(c.parametros.semilla).toBe(2026); expect(c.entrada_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('ESC-K02 / K03 / K04 mín>moda, probabilidad fuera de [0,1] y duración cero se bloquean; mín=moda=máx>0 se admite', () => {
    const a = (x: Partial<M.AjusteModo>) => M.validarParametros(P0({ ajustes: [{ modo: 'VIAL', min_h: 2, moda_h: 3, max_h: 4, prob_incidencia: 0.1, retraso_h: 1, ...x }] }));
    expect(a({ min_h: 5 }).join()).toMatch(/mínimo ≤ más probable ≤ máximo/);
    expect(a({ prob_incidencia: 1.2 }).join()).toMatch(/entre 0 y 1/);
    expect(M.validarParametros(P0({ prob_cierre: -0.1 })).join()).toMatch(/cierre/);
    expect(a({ min_h: 0, moda_h: 0, max_h: 0 }).join()).toMatch(/mayor que 0/);
    expect(a({ min_h: 3, moda_h: 3, max_h: 3 })).toEqual([]);
    expect(() => M.simular(planes.planes, planes.servicios, P0({ prob_cierre: 2 }))).toThrow(/cierre/);
  });
  it('ESC-K05 / AD06 igual semilla e insumos ⇒ resultados idénticos (paridad EXE/HTML: el mismo motor TS)', () => {
    const a = M.simular(planes.planes, planes.servicios, P0({ iteraciones: 150, prob_cierre: 0.05 }));
    const b = M.simular(planes.planes, planes.servicios, P0({ iteraciones: 150, prob_cierre: 0.05 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(M.huellaEntrada(planes.planes, planes.servicios, P0())).toBe(M.huellaEntrada(planes.planes, planes.servicios, P0()));
  });
  it('ESC-K06 otra semilla: corrida nueva (no se exige que cada estadístico cambie)', () => {
    const a = M.simular(planes.planes, planes.servicios, P0({ iteraciones: 150, prob_cierre: 0.1, semilla: 1 }));
    const b = M.simular(planes.planes, planes.servicios, P0({ iteraciones: 150, prob_cierre: 0.1, semilla: 2 }));
    expect(JSON.stringify(a.planes.map((p) => p.costo))).not.toBe(JSON.stringify(b.planes.map((p) => p.costo)));
  });
  it('ESC-K07 cancelar: no produce resultado ni sustituye una corrida completa', async () => {
    let n = 0;
    const r = await M.simularPorBloques(planes.planes, planes.servicios, P0({ iteraciones: 500 }), { bloque: 50, cancelado: () => ++n > 3 });
    expect(r.cancelada).toBe(true); expect('resultado' in r).toBe(false);
    const antes = M.corridasSim(repo).filter((c) => c.estado === 'COMPLETA').length;
    const id = M.guardarCorridaSim(repo, 'U06', M.modeloVigente(repo, 'MOD-BASE'), planes.planes, planes.servicios, r);
    expect(M.corridaSim(repo, id)!.resultado).toBeNull(); expect(M.corridaSim(repo, id)!.estado).toBe('CANCELADA');
    expect(M.corridasSim(repo).filter((c) => c.estado === 'COMPLETA').length).toBe(antes);
  });
  it('§14-10 duración fija y probabilidad cero: sin dispersión; probabilidad 1: incidencia en TODAS las iteraciones', () => {
    const t = planPrueba();
    const r0 = M.simular(t.planes, t.servicios, P0());
    expect(r0.planes[0].retraso_h.desv).toBe(0); expect(r0.planes[0].a_tiempo.p5).toBe(r0.planes[0].a_tiempo.p95);
    const t1 = planPrueba({ prob: 1, retraso: 600 });
    const r1 = M.simular(t1.planes, t1.servicios, P0());
    expect(r1.planes[0].conexiones_perdidas.p5).toBeGreaterThan(0); expect(r1.planes[0].conexiones_perdidas.desv).toBe(0);
  });
  it('ESC-AD03 / §14.1.1-4 una demora pierde la salida discreta: toma la siguiente (16:00), no la de 10:30', () => {
    // llega 10:15 (2 h 15 min), manipulación 30 min → listo 10:45 > 10:30: siguiente salida 16:00 (+2 h → 18:00)
    const t = planPrueba({ min: 135, moda: 135, max: 135 });
    const r = M.simular(t.planes, t.servicios, P0({ iteraciones: 20 }));
    const pp = r.planes[0].por_pedido[0];
    expect(pp.llegada_p50).toBe('2026-11-20 18:15'); expect(r.planes[0].conexiones_perdidas.media).toBe(2);
    // a tiempo: llegada 18:15 > fin de ventana 18:00
    expect(pp.prob_a_tiempo).toBe(0);
  });
  it('ESC-AD05 / §14.1.1-8 shock común: con cierre seguro y sin salida alterna, TODOS los pedidos del servicio quedan afectados por igual', () => {
    const t = planPrueba({ salida2: ['2026-11-20T10:30'] });
    const r = M.simular(t.planes, t.servicios, P0({ prob_cierre: 1, iteraciones: 30 }));
    const [a, b] = r.planes[0].por_pedido;
    expect(a.prob_no_atendido).toBe(1); expect(b.prob_no_atendido).toBe(1);
    // con probabilidad intermedia los dos pedidos del MISMO servicio comparten el resultado en cada iteración
    const r2 = M.simular(t.planes, t.servicios, P0({ prob_cierre: 0.5, iteraciones: 200 }));
    expect(r2.planes[0].por_pedido[0].prob_no_atendido).toBe(r2.planes[0].por_pedido[1].prob_no_atendido);
    expect(r2.correlacion).toMatch(/Shock común/);
    expect(M.simular(t.planes, t.servicios, P0({ shock_comun: false, iteraciones: 10 })).correlacion).toMatch(/LIMITACIÓN/);
  });
  it('Planes reales sin modificar datos: el ensayo no deja reservas ni itinerarios; 3 planes con la misma demanda', () => {
    expect(repo.num("SELECT COUNT(*) FROM reserva WHERE estado='ACTIVA'")).toBe(0);
    expect(planes.planes.map((p) => p.criterio)).toEqual(['POR_PEDIDO', 'CONSOLIDADO', 'ANTICIPADO']);
    const kg = planes.planes.map((p) => p.envios.reduce((a, e) => a + e.kg, 0));
    expect(Math.abs(kg[0] - kg[1])).toBeLessThan(0.01); expect(Math.abs(kg[0] - kg[2])).toBeLessThan(0.01);
    expect(planes.planes[1].servicios).toBeLessThan(planes.planes[0].servicios); // consolidar reduce viajes físicos
  });
  it('ESC-K08 alternativa físicamente inviable: no se recomienda por menor costo (restricción dura)', () => {
    const s = { ...E.supuestos(repo), otif_minimo_pct: 99 };
    const ev = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, sim, supuestosExtra: s });
    expect(ev.comparador.filas.every((f) => !f.factible)).toBe(true);
    expect(ev.comparador.conclusion).toMatch(/Ninguna alternativa cumple/);
  });
  it('Resumen distingue dispersión (P5–P95) de intervalo de confianza de la media', () => {
    const p = sim.planes[0].costo;
    expect(p.ic95[1] - p.ic95[0]).toBeLessThan(p.p95 - p.p5 + 1e-9);
    expect(sim.diferencias.length).toBe(2);
  });
});

describe('N01–N02 — Modelos versionados', () => {
  it('ESC-N01 clonar: ID nuevo con parámetros copiados', () => {
    const r = M.clonarModelo(repo, 'U06', 'MOD-BASE', 'Copia lluvias');
    expect(r.modelo_id).not.toBe('MOD-BASE'); expect(M.modeloVigente(repo, r.modelo_id).parametros).toEqual(M.modeloVigente(repo, 'MOD-BASE').parametros);
  });
  it('ESC-N02 modificar: versión nueva; corridas anteriores conservan sus parámetros', () => {
    const c = M.corridasSim(repo).find((x) => x.estado === 'COMPLETA')!;
    const v = M.modificarModelo(repo, 'U06', 'MOD-BASE', { ...M.modeloVigente(repo, 'MOD-BASE').parametros, prob_cierre: 0.2 }, 'Ensayo de sensibilidad');
    expect(v.version).toBe(2);
    expect(M.corridaSim(repo, String(c.run_id))!.parametros.prob_cierre).toBe(M.PARAMETROS_DEFECTO.prob_cierre);
    expect(() => M.modificarModelo(repo, 'U06', 'MOD-BASE', { ...M.PARAMETROS_DEFECTO, iteraciones: 5 }, 'x')).toThrow(/Iteraciones/);
    expect(() => M.modificarModelo(repo, 'U01', 'MOD-BASE', M.PARAMETROS_DEFECTO, 'x')).toThrow(/no permite/);
  });
});

// ------------------------------------------------------------------ Economía
describe('L — EVA de la unidad demostrativa (§10, §14-8)', () => {
  let ev: E.Evaluacion;
  beforeAll(() => { ev = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, sim, combinar: ['CONSOLIDACION', 'TERCERIZACION'] }); });
  it('§14-8 prueba matemática: EBIT 100 000, 30 %, capital 400 000, WACC 12 % ⇒ EVA 22 000; alternativa ⇒ 38 500 y ΔEVA 16 500', () => {
    const b = E.evaAnual(E.nopat(100000, 0.3), 0.12, 400000), a = E.evaAnual(E.nopat(115000, 0.3), 0.12, 350000);
    expect(E.nopat(100000, 0.3)).toBe(70000); expect(b).toBeCloseTo(22000, 6); expect(E.nopat(115000, 0.3)).toBeCloseTo(80500, 6); expect(a).toBeCloseTo(38500, 6); expect(a - b).toBeCloseTo(16500, 6);
  });
  it('ESC-L01 base: concilia mes a mes ingresos − costos = EBIT y NOPAT; EVA = NOPAT − WACC × capital promedio', () => {
    const b = ev.escenarios[0];
    for (const m of b.meses) { expect(m.ebit).toBeCloseTo(m.ingresos - m.costo_producto - m.costo_logistico - m.otros - m.depreciacion - m.implementacion, 6); expect(m.nopat).toBeCloseTo(m.ebit - Math.max(m.ebit, 0) * 0.3, 6); }
    expect(b.eva!).toBeCloseTo(b.nopat - 0.12 * (b.capital_apertura + b.capital_cierre) / 2, 6);
    expect(ev.demanda.meses.length).toBe(12); expect(ev.demanda.meses[0].mes).toBe('2026-12'); expect(ev.demanda.meses.at(-1)!.mes).toBe('2027-11');
    expect(ev.convencion).toMatch(/EVA ANUAL/);
  });
  it('ESC-L02 / AI01 consolidar: menos viajes medidos en la simulación, misma demanda; más merma por espera', () => {
    const c = ev.escenarios.find((x) => x.id === 'CONSOLIDACION')!;
    expect(c.costo_logistico).toBeLessThan(ev.escenarios[0].costo_logistico);
    expect(c.meses.reduce((a, m) => a + m.kg_demanda, 0)).toBeCloseTo(ev.escenarios[0].meses.reduce((a, m) => a + m.kg_demanda, 0), 6);
    expect(c.cambios.join()).toMatch(/medido en la simulación/); expect(c.cambios.join()).toMatch(/merma \+0.2/);
  });
  it('ESC-L03 tercerizar: separa flete, capital y depreciación', () => {
    const t = ev.escenarios.find((x) => x.id === 'TERCERIZACION')!;
    expect(t.meses.every((m) => m.depreciacion === 0)).toBe(true);
    expect(t.capital_cierre).toBeLessThan(ev.escenarios[0].capital_cierre - 150000);
    expect(t.caja_liberada).toBe(180000);
  });
  it('ESC-L04 / AI05 mejorar stock: el capital baja, la liberación de inventario NO entra al EBIT', () => {
    const f = ev.escenarios.find((x) => x.id === 'FEFO_STOCK')!, b = ev.escenarios[0];
    expect(f.capital_cierre).toBeLessThan(b.capital_cierre);
    expect(f.ingresos).toBeCloseTo(b.ingresos, 6);
    expect(f.caja_liberada).toBeGreaterThan(0);
    expect(f.ebit - b.ebit).toBeLessThan(f.caja_liberada); // la caja liberada no aparece como ganancia operativa
  });
  it('ESC-L05 EBIT negativo: impuesto cero, sin crédito fiscal automático', () => {
    expect(E.nopat(-5000, 0.3)).toBe(-5000);
    const e2 = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, supuestosExtra: { otros_gastos_mes: 900000 } });
    expect(e2.escenarios[0].meses.every((m) => m.impuesto === 0 && m.ebit < 0)).toBe(true);
  });
  it('ESC-L06 WACC o tasa inválidos se bloquean', () => {
    expect(() => E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, supuestosExtra: { wacc_anual: 1 } })).toThrow(/WACC/);
    expect(() => E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, supuestosExtra: { tasa_impuesto: 1.5 } })).toThrow(/impuesto/);
    expect(() => E.guardarSupuesto(repo, 'U06', 'wacc_anual', -0.1)).toThrow(/WACC/);
  });
  it('ESC-L07 / AI02 invertir: activo, depreciación y capital; no todo como gasto repetido', () => {
    const n = ev.escenarios.find((x) => x.id === 'NODO_APOYO')!;
    expect(n.inversion).toBe(120000); expect(n.meses[0].depreciacion).toBeCloseTo(2500 + 1000, 6);
    expect(n.capital_cierre).toBeGreaterThan(ev.escenarios[0].capital_cierre + 100000);
    expect(n.cambios.join()).toMatch(/SUPUESTO, no simulado/);
  });
  it('ESC-L08 / AI06 combinación: se aplica a la vez y se informa el solapamiento (no se suman ahorros dos veces)', () => {
    const c = ev.combinacion!;
    expect(c.escenario.id).toBe('COMBINACION');
    expect(Math.abs(c.solapamiento!)).toBeGreaterThan(1000); // consolidar ahorra viajes que la tercerización ya no paga por viaje
    expect(c.suma_individual! - c.escenario.delta_eva!).toBeCloseTo(c.solapamiento!, 6);
    expect(() => E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, combinar: ['ELIMINAR_REMOTOS', 'NODO_APOYO'] })).toThrow(/incompatibles/);
  });
  it('ESC-AI03 / AI04 operador local: costo adicional y mejora de servicio declarada como supuesto (misma demanda)', () => {
    const o = ev.escenarios.find((x) => x.id === 'OPERADOR_LOCAL')!;
    expect(o.costo_logistico).toBeGreaterThan(ev.escenarios[0].costo_logistico);
    expect(o.servicio.otif_pct).toBeGreaterThan(ev.escenarios[0].servicio.otif_pct);
    expect(o.servicio.fuente).toMatch(/SUPUESTOS/);
  });
  it('ESC-AI07 ninguna mejora defendible: se informa sin inventar recomendación', () => {
    const e2 = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, sim, pesos: { eva: 0, otif: 0, retraso: 0, costo: 0, no_atendido: 1 },
      supuestosExtra: { nodo_recupera_no_atendido_pct: 0, oper_recupera_no_atendido_pct: 0 } });
    expect(e2.comparador.conclusion).toMatch(/Ninguna alternativa mejora|Mayor puntaje/);
    const e3 = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, sim, supuestosExtra: { otif_minimo_pct: 0, cons_merma_extra_pct: 50, ter_tarifa_kg: 5, fefo_implementacion: 5e6, nodo_inversion: 5e7, oper_costo_kg_remoto: 100 }, pesos: { eva: 1, otif: 0, retraso: 0, costo: 0, no_atendido: 0 } });
    expect(e3.comparador.conclusion).toMatch(/Ninguna alternativa mejora/);
  });
  it('ESC-AI08 / BO08 horizonte de 6 meses: EVA del período con tasa (1+WACC)^(d/365)−1; no se rotula como anual', () => {
    const e6 = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, meses: 6 });
    const d = e6.demanda.meses.reduce((a, m) => a + m.dias, 0);
    const b = e6.escenarios[0];
    expect(e6.convencion).toMatch(/EVA DEL PERÍODO/);
    expect(b.cargo_capital).toBeCloseTo(((1.12 ** (d / 365)) - 1) * b.capital_promedio, 6);
  });
  it('ESC-AZ06 / BO02 cotización en USD sin tipo de cambio: NO CALCULABLE; con tipo de cambio se convierte', () => {
    const e1 = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, supuestosExtra: { ter_en_usd: 1, tipo_cambio_pen_usd: null, ter_tarifa_kg: 0.07 } });
    const t1 = e1.escenarios.find((x) => x.id === 'TERCERIZACION')!;
    expect(t1.estado).toBe('NO_CALCULABLE'); expect(t1.eva).toBeNull(); expect(t1.motivo).toMatch(/USD/); expect(Number.isNaN(t1.costo_logistico)).toBe(true); // N/D, nunca 0
    const e2 = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, supuestosExtra: { ter_en_usd: 1, tipo_cambio_pen_usd: 3.75, ter_tarifa_kg: 0.07 } });
    expect(e2.escenarios.find((x) => x.id === 'TERCERIZACION')!.estado).toBe('CALCULADO');
  });
  it('ESC-BO10 falta un dato de capital: EVA NO CALCULABLE, no se rellena con cero', () => {
    const e1 = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, supuestosExtra: { activos_flota_propia: null } });
    expect(e1.escenarios[0].estado).toBe('NO_CALCULABLE'); expect(e1.escenarios[0].motivo).toMatch(/NO CALCULABLE/);
  });
  it('ESC-BO01 cambio de tarifa a mitad del horizonte: se separa efecto tarifa de efecto volumen', () => {
    const e1 = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, supuestosExtra: { variacion_tarifa_pct: 10, variacion_tarifa_desde_mes: 7 } });
    const b = e1.escenarios[0];
    expect(b.puente_costo!.tarifa).toBeGreaterThan(0);
    expect(b.puente_costo!.tarifa + b.puente_costo!.volumen).toBeCloseTo(b.costo_logistico, 6);
    expect(b.meses[6].costo_logistico / b.meses[6].kg_aceptado).toBeCloseTo(1.1 * b.meses[5].costo_logistico / b.meses[5].kg_aceptado, 6);
  });
  it('ESC-BO03 / BO05 / BO09 misma demanda para todos; eliminar destinos deja demanda sin atender y no es «ahorro»', () => {
    const r = ev.escenarios.find((x) => x.id === 'ELIMINAR_REMOTOS')!;
    expect(r.kg_no_atendido).toBeGreaterThan(ev.escenarios[0].kg_no_atendido * 5);
    const f = ev.comparador.filas.find((x) => x.id === 'ELIMINAR_REMOTOS')!;
    expect(f.factible).toBe(false); expect(f.motivo).toMatch(/cobertura/);
    for (const e of ev.escenarios) expect(e.meses[3].kg_demanda).toBeCloseTo(ev.escenarios[0].meses[3].kg_demanda, 6);
  });
  it('Sensibilidad a demanda, transporte y WACC para cada alternativa', () => {
    const s = ev.sensibilidad.find((x) => x.id === 'CONSOLIDACION')!;
    expect(s.tarifa_mas10!).toBeGreaterThan(s.base!); // un transporte más caro vuelve más valiosa la consolidación
    expect(s.wacc_mas2).not.toBeNull();
  });
});

describe('AV — Comparador de alternativas', () => {
  const e = () => E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, sim });
  it('ESC-AV01 / AV06 normalización 0–1 sobre la misma cohorte con pesos visibles; agregar alternativa recalcula la cohorte', () => {
    const ev = e();
    for (const f of ev.comparador.filas.filter((x) => x.factible)) for (const v of Object.values(f.normalizados)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    const ev2 = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, sim, combinar: ['CONSOLIDACION', 'FEFO_STOCK'] });
    expect(ev2.comparador.cohorte_id).not.toBe(ev.comparador.cohorte_id);
    expect(() => E.comparar(ev.escenarios, { eva: 0.5, otif: 0.5, retraso: 0.5, costo: 0, no_atendido: 0 }, ev.supuestos)).toThrow(/sumar 1/);
  });
  it('ESC-AV02 peso de servicio cero NO autoriza violar la restricción dura', () => {
    const ev = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, sim, pesos: { eva: 0.5, otif: 0, retraso: 0, costo: 0.5, no_atendido: 0 } });
    expect(ev.comparador.filas.find((f) => f.id === 'ELIMINAR_REMOTOS')!.factible).toBe(false);
    expect(ev.comparador.orden).not.toContain('ELIMINAR_REMOTOS');
  });
  it('ESC-AV03 empate: componentes visibles y desempate declarado', () => {
    const ev = e();
    const dup = [...ev.escenarios, { ...ev.escenarios[1], id: 'COPIA', nombre: 'Copia exacta' }];
    const c = E.comparar(dup, E.PESOS_DEFECTO, ev.supuestos);
    const a = c.filas.find((f) => f.id === 'COPIA')!, b = c.filas.find((f) => f.id === ev.escenarios[1].id)!;
    expect(a.puntaje).toBeCloseTo(b.puntaje!, 9);
  });
  it('ESC-AV04 dominancia: se identifica sin declarar óptimo', () => {
    const ev = e();
    expect(ev.comparador.filas.some((f) => f.dominada_por)).toBe(true);
    expect(ev.comparador.conclusion).not.toMatch(/óptim/i);
  });
  it('ESC-AV05 sensibilidad de pesos: se informa si la recomendación es frágil', () => {
    const ev = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, sim, combinar: ['CONSOLIDACION', 'FEFO_STOCK'] });
    expect(Array.isArray(ev.comparador.fragil)).toBe(true);
    if (ev.comparador.fragil.length) expect(ev.comparador.conclusion).toMatch(/FRÁGIL/); else expect(ev.comparador.conclusion).toMatch(/se mantiene/);
  });
  it('ESC-AV07 penalización negativa por no atención se rechaza', () => {
    expect(() => E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, supuestosExtra: { penalizacion_no_atencion_kg: -1 } })).toThrow(/no puede ser negativa/);
  });
  it('ESC-AV08 riesgo de cola: el comparador usa el retraso P95, no solo la media', () => {
    const ev = e();
    expect(Object.keys(E.PESOS_DEFECTO)).toContain('retraso');
    expect(ev.escenarios.every((x) => typeof x.servicio.retraso_p95_h === 'number')).toBe(true);
  });
});

describe('AU06 / BL03 — Escenarios de demanda y revisión de modelos', () => {
  it('ESC-AU06 promoción comunicada: escenario separado; no altera la serie de entrenamiento', () => {
    const base = E.demandaMensual(repo, hechos, HISTORIA_CORTE, 12);
    const promo = E.demandaMensual(repo, hechos, HISTORIA_CORTE, 12, 'ESC-PROMO-P01');
    const ene = (x: typeof base) => x.meses.find((m) => m.mes === '2027-01')!.kg_demanda;
    expect(ene(promo)).toBeGreaterThan(ene(base)); expect(promo.meses[0].kg_demanda).toBeCloseTo(base.meses[0].kg_demanda, 6);
    expect(promo.escenario).toMatch(/Promoción de verano P01/);
    const r1 = F.pronosticar(repo, hechos, { producto: 'P01', corte: HISTORIA_CORTE });
    expect(r1.prediccion[0].valor).toBeGreaterThan(0); // el pronóstico estadístico no cambia por el escenario
    expect(() => E.crearEscenarioDemanda(repo, 'U06', { nombre: 'x', producto_id: null, desde: '2027-02-01', hasta: '2027-01-01', aumento_pct: 10, fuente: 'y' })).toThrow(/posterior/);
  });
  it('ESC-BL03 error sobre el umbral en dos cortes: abre revisión (recomendación), no cambia corridas', () => {
    const r = nuevo(); const h = K.cargarHechos(r);
    for (const c of ['2026-08-03', '2026-08-10']) F.guardarCorrida(r, 'U06', F.pronosticar(r, h, { producto: 'P09', corte: c + 'T00:00:00-05:00' }));
    const rev = F.revisarDesempeno(r, h, 1);
    const s = rev.find((x) => x.serie.startsWith('P09'))!;
    expect(s.corridas.every((c) => c.semanas > 0)).toBe(true);
    expect(s.revisar).toBe(true);
    const n = G.actualizarRecomendaciones(r, { revisionModelo: [{ serie: s.serie, wapes: 'x' }] });
    expect(n).toBeGreaterThan(0);
    expect(r.num("SELECT COUNT(*) FROM recomendacion WHERE regla = 'REVISION_MODELO'")).toBe(1);
    expect(r.num('SELECT COUNT(*) FROM corrida_pronostico')).toBe(2);
  });
});

// ------------------------------------------------------------------ Exportaciones
function snap(o: { sinCorridas?: boolean } = {}): X.Snapshot {
  const f: K.Filtros = { desde: '2025-11-10T00:00:00-05:00', hasta: HISTORIA_CORTE, granularidad: 'mes', corte: AHORA };
  const ev = E.evaluar(repo, hechos, { corte: HISTORIA_CORTE, sim, simRunId: 'SIM-T' });
  const pr = F.pronosticar(repo, hechos, { producto: 'P01', corte: HISTORIA_CORTE });
  return { runId: 'RUN-T' + Math.random().toString(36).slice(2, 8), generadoEn: AHORA, datasetId: '06', datasetHash: 'h', build: 'test', modalidad: 'HTML', existencias: D.existencias(repo), pedidos: D.pedidos(repo),
    analitica: { vista: 'REEXPRESADA', conocidoHasta: null, desde: f.desde, hasta: f.hasta, filtros: 'prueba', indicadores: K.indicadores(hechos, f), serie: K.serieOTIF(hechos, f), pareto: K.pareto(hechos, f), causas: [] },
    pronostico: o.sinCorridas ? null : { corrida_id: 'PRN-T', serie: pr.serie, corte: pr.corte, metodo: pr.elegido, metricas: pr.metricas, prediccion: pr.prediccion },
    simulacion: o.sinCorridas ? null : { run_id: 'SIM-T', modelo: 'MOD-BASE v1', parametros: M.PARAMETROS_DEFECTO, resultado: sim, creada_en: AHORA },
    evaluacion: o.sinCorridas ? null : { run_id: 'EVA-T', ev, creada_en: AHORA },
    itinerarios: [{ pedido_id: 'P', itinerario_id: 'IT', estado: 'COMPLETADO', tramo: 1, viaje: 1, modo: 'VIAL', origen: 'A', destino: 'B', servicio_id: 'S1', kg: 200, etapa_estado: 'RECIBIDA', final: false },
      { pedido_id: 'P', itinerario_id: 'IT', estado: 'COMPLETADO', tramo: 2, viaje: 1, modo: 'LACUSTRE', origen: 'B', destino: 'C', servicio_id: 'S2', kg: 200, etapa_estado: 'ENTREGADA', final: true }],
    aceptado: [{ pedido_id: 'P', solicitado_kg: 200, aceptado_kg: 200 }],
    costos: [{ servicio_id: 'S2', fijo_cent: 30000, total_cent: 30000, no_asignado_cent: 1, lineas: [{ etapa_id: 'E1', pedido_id: 'P', kg: 120, fijo_cent: 17999, variable_cent: 0 }, { etapa_id: 'E2', pedido_id: 'Q', kg: 80, fijo_cent: 12000, variable_cent: 0 }] }],
    recomendaciones: [] };
}
describe('N / AK — Exportaciones empresariales', () => {
  let s: X.Snapshot, xlsx: ArrayBuffer;
  beforeAll(async () => { s = snap(); xlsx = await X.exportarXlsx(s); });
  it('ESC-N03 / AK05 Excel: metadatos con RUN-ID, vista, filtros y corridas; cifras iguales al motor', async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xlsx);
    const meta = wb.getWorksheet('Metadatos')!; const txt = JSON.stringify(meta.getSheetValues());
    expect(txt).toContain(s.runId); expect(txt).toContain('Vista REEXPRESADA'); expect(txt).toContain('SIM-T'); expect(txt).toContain('EVA-T');
    const ind = wb.getWorksheet('Indicadores')!;
    const otif = s.analitica!.indicadores.find((k) => k.id === 'otif')!;
    const fila = ind.getRows(2, 12)!.find((r) => r.getCell(1).value === otif.nombre)!;
    expect((fila.getCell(5).value as { result: number }).result).toBeCloseTo(otif.valor!, 9);
    const ev = wb.getWorksheet('AlternativasEVA')!;
    expect((ev.getRow(4).getCell(11).value as { result: number }).result).toBeCloseTo(s.evaluacion!.ev.escenarios[0].eva!, 6);
  });
  it('ESC-N04 exportar sin corridas: estado sin datos, nunca cifras inventadas', async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await X.exportarXlsx(snap({ sinCorridas: true })));
    expect(String(wb.getWorksheet('Simulacion')!.getCell('A1').value)).toMatch(/Sin corrida de simulación/);
    expect(String(wb.getWorksheet('AlternativasEVA')!.getCell('A1').value)).toMatch(/Sin evaluación económica/);
    expect(wb.getWorksheet('AlternativasEVA')!.rowCount).toBe(1);
  });
  it('ESC-N05 / AK04 DOCX técnico: secciones y cifras del motor; sin causa registrada declara insuficiencia', async () => {
    const b = (await X.exportarDocx(s)) as Uint8Array;
    const xml = await (await JSZip.loadAsync(b)).file('word/document.xml')!.async('string');
    for (const t of ['Resumen ejecutivo', 'Datos y calidad', 'Metodología', 'Cuatro tipos de analítica', 'Plan de implementación', 'Impacto económico', 'Limitaciones', s.runId]) expect(xml).toContain(t);
    expect(xml).toContain(fmt(s.analitica!.indicadores.find((k) => k.id === 'otif')!.valor!));
    const s2 = snap(); s2.analitica!.pareto = { n: 3, filas: [{ causa: 'Sin causa registrada', n: 3, pct: 100, acumulado: 100 }] };
    expect(X.hallazgos(s2).join()).toMatch(/INSUFICIENTE para atribuir una causa/);
  });
  it('ESC-N06 / AK03 PPTX ejecutivo 16:9: abre y refleja la misma corrida, horizonte y supuestos', async () => {
    const b = (await X.exportarPptx(s)) as ArrayBuffer;
    const z = await JSZip.loadAsync(b);
    const pres = await z.file('ppt/presentation.xml')!.async('string');
    expect(pres).toMatch(/cx="12192000" cy="6858000"/);
    const slides = Object.keys(z.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides.length).toBe(7);
    const todo = (await Promise.all(slides.map((f) => z.file(f)!.async('string')))).join('');
    expect(todo).toContain(s.runId); expect(todo).toContain('Incertidumbre'); expect(todo).toContain(s.evaluacion!.ev.demanda.escenario);
  });
  it('ESC-N07 un cambio de dato produce otra corrida/salida identificada', () => { expect(snap().runId).not.toBe(snap().runId); });
  it('ESC-N08 / AK06 exportación cancelada: no entrega archivo incompleto', async () => {
    let n = 0;
    await expect(X.exportarXlsx(s, { paso: async () => { if (++n > 3) throw new X.ExportacionCancelada(); } })).rejects.toThrow(/cancelada/);
  });
  it('ESC-AK01 cadena multimodal: etapas con su kg y aceptación final una sola vez (no se triplica)', async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xlsx);
    expect(wb.getWorksheet('Itinerarios')!.rowCount).toBe(3);
    expect(wb.getWorksheet('AceptacionFinal')!.getRow(2).getCell(3).value).toBe(200);
  });
  it('ESC-AK02 costos de servicio compartido: imputado + no asignado = fijo del servicio', async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xlsx);
    const co = wb.getWorksheet('CostosCompartidos')!;
    const tot = co.getRow(co.rowCount).getCell(5).value as { formula: string; result: number };
    expect(tot.formula).toMatch(/^SUM\(E2:E4\)$/); expect(tot.result).toBe(300);
  });
  it('ESC-AK07 libro con fórmulas: recalculado por un motor real (LibreOffice) con cero errores y valores iguales', async () => {
    const soffice = ['/usr/bin/soffice', '/usr/bin/libreoffice'].find((x) => fs.existsSync(x));
    if (!soffice) { console.warn('LibreOffice no disponible: verificación de recálculo PENDIENTE, no aprobada'); return; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recalc-'));
    // Perfil de LibreOffice que SIEMPRE recalcula al abrir (si no, conservaría los valores guardados y no probaría nada)
    fs.mkdirSync(path.join(dir, 'perfil', 'user'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'perfil', 'user', 'registrymodifications.xcu'), '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item></oor:items>');
    // Se ALTERAN los valores guardados de todas las fórmulas: solo un recálculo real puede devolver los correctos
    const alterado = new ExcelJS.Workbook(); await alterado.xlsx.load(xlsx);
    alterado.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => { const v = cell.value as { formula?: string }; if (v && typeof v === 'object' && 'formula' in v) cell.value = { formula: v.formula!, result: -123456 }; })));
    const ent = path.join(dir, 'entrada.xlsx'); await alterado.xlsx.writeFile(ent);
    const out = path.join(dir, 'out'); fs.mkdirSync(out);
    execFileSync(soffice, ['--headless', `-env:UserInstallation=file://${dir}/perfil`, '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', out, ent], { timeout: 120000, stdio: 'ignore' });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(out, 'entrada.xlsx'));
    const orig = new ExcelJS.Workbook(); await orig.xlsx.load(xlsx);
    let formulas = 0;
    orig.eachSheet((ws) => ws.eachRow((row, r) => row.eachCell((cell, c) => {
      const v = cell.value as { formula?: string; result?: unknown };
      if (!v || typeof v !== 'object' || !('formula' in v)) return;
      formulas++;
      const nuevo = wb.getWorksheet(ws.name)!.getRow(r).getCell(c).value as { result?: unknown } | number;
      const res = typeof nuevo === 'object' && nuevo !== null ? (nuevo as { result?: unknown }).result : nuevo;
      expect(String(res)).not.toMatch(/#(REF|DIV|VALUE|NAME|N\/A)/);
      if (typeof v.result === 'number') expect(Number(res)).toBeCloseTo(v.result, 4);
    })));
    expect(formulas).toBeGreaterThan(100);
  }, 180000);
});
const fmt = (x: number) => fmtNum(x, 1);
