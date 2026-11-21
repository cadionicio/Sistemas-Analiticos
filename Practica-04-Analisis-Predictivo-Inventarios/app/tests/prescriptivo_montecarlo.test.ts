/**
 * Pruebas del Paso 8: análisis PRESCRIPTIVO y SIMULACIÓN Monte Carlo.
 * Oráculo: referencia independiente en Python (tests/referencia/prescriptivo_ref.py → esperado_prescriptivo.json).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { BaseDatos } from '../src/core/db/db';
import { importarVentas } from '../src/core/ingesta/ventas';
import { importarKardex } from '../src/core/ingesta/kardex';
import { describirVentas, describirKardex } from '../src/core/analitica/descriptivo';
import { diagnosticarVentas } from '../src/core/analitica/diagnostico';
import { proyectarKardex } from '../src/core/analitica/predictivo';
import { optimizarPlan, normInv, stockSeguridad, eoq, asignarPresupuesto } from '../src/core/analitica/prescriptivo';
import { simularEscenarios, simularPolitica } from '../src/core/analitica/montecarlo';
import { mulberry32 } from '../src/core/analitica/pronostico/prng';

const E = JSON.parse(readFileSync('tests/fixtures/esperado_prescriptivo.json', 'utf8'));

describe('T-PRS · Fórmulas y optimización (casos de libro)', () => {
  it('T-PRS-01 z(95 %), SS, ROP y EOQ = referencia', () => {
    expect(normInv(0.95)).toBeCloseTo(E.z95, 8);
    const ss = stockSeguridad(normInv(0.95), 15, 20, 100, 5);
    expect(ss).toBeCloseTo(E.ss_ejemplo, 4); // error de Acklam ~1e-9 en z amplificado ×506
    expect(100 * 15 + ss).toBeCloseTo(E.rop_ejemplo, 4);
    expect(eoq(36500, 150, 0.2 * 10)).toBeCloseTo(E.eoq_ejemplo, 6);
    expect(normInv(0.5)).toBeCloseTo(0, 9);
  });
  it('T-PRS-02 presupuesto: mochila fraccionaria óptima (verificada con fuerza bruta en rejilla)', () => {
    const items = [{ id: 1, necesidad: 10, costo: 5, prioridad: 3 }, { id: 2, necesidad: 20, costo: 2, prioridad: 1 }, { id: 3, necesidad: 5, costo: 10, prioridad: 2 }];
    const a = asignarPresupuesto(items, 60);
    const valor = (m: Map<number, number>) => items.reduce((s, i) => s + i.prioridad * (m.get(i.id) ?? 0), 0);
    let mejor = 0;
    for (let x1 = 0; x1 <= 10; x1++) for (let x2 = 0; x2 <= 20; x2++) for (let x3 = 0; x3 <= 5; x3++)
      if (5 * x1 + 2 * x2 + 10 * x3 <= 60) mejor = Math.max(mejor, 3 * x1 + x2 + 2 * x3);
    expect(valor(a)).toBeGreaterThanOrEqual(mejor - 1e-9);           // el óptimo continuo ≥ óptimo entero
    expect(items.reduce((s, i) => s + i.costo * (a.get(i.id) ?? 0), 0)).toBeLessThanOrEqual(60 + 1e-9);
    expect(asignarPresupuesto(items, 0).get(2)).toBe(20);            // sin presupuesto → toda la necesidad
  });
  it('T-SIM-01 simulación determinista (s,Q) = referencia exacta', () => {
    const r = simularPolitica([{ codigo: 'X', demandaDiaria: [10], stockInicial: 300, s: 100, Q: 200 }],
      { LT: 10, sLT: 0, costo: 2, tasa: 0.365, S: 150, costoFaltante: 1, dias: 183 }, { nombre: 'Base', fDemanda: 1, fLT: 1 }, 3, mulberry32(1));
    expect(r.fillRate.media).toBe(E.det.fill);
    expect(r.ordenes.p50).toBe(E.det.ordenes);
    expect(r.stockPromedio.p50).toBeCloseTo(E.det.stock_prom, 9);
    expect(r.costoTotal.p50).toBeCloseTo(E.det.costo, 6);
    expect(r.probQuiebre).toBe(0);
  });
});

describe('T-PRS / T-SIM · Datos reales', () => {
  let bd: BaseDatos; let pr: ReturnType<typeof optimizarPlan>; let s: ReturnType<typeof simularEscenarios>; let kid: number;
  beforeAll(async () => {
    bd = await BaseDatos.abrir();
    const v = await importarVentas(bd, readFileSync('tests/fixtures/ventas.xlsx'), 'v');
    const k = await importarKardex(bd, readFileSync('tests/fixtures/kardex.xls'), 'k'); kid = k.datasetId;
    const dv = describirVentas(bd, v.datasetId); const gv = diagnosticarVentas(bd, v.datasetId, dv.result);
    const dk = describirKardex(bd, k.datasetId); const pk = proyectarKardex(bd, k.datasetId);
    pr = optimizarPlan(bd, k.datasetId, dk.result, pk.result, v.datasetId, dv.result, gv.result);
    s = simularEscenarios(bd, pr.result, k.datasetId, v.datasetId, { iteraciones: 2000 });
  }, 300000);
  it('T-PRS-03 demanda histórica mensual de MATPRIMA-003 = referencia', () => {
    const x = pr.result.politicas.find((p) => p.codigo === 'MATPRIMA-003')!;
    expect(x.demandaMesHist).toBeCloseTo(E.matprima003.dem_mes_media, 6);
    expect(x.sdMesHist).toBeCloseTo(E.matprima003.dem_mes_sd, 6);
    expect(x.politica).toBe('(s,Q)');
  });
  it('T-PRS-04 coherencia de cada política: SS ≥ 0, ROP = d·LT + SS, Q = máx(0, S − IP)', () => {
    const P = pr.result.parametros;
    for (const x of pr.result.politicas) {
      expect(x.ss).toBeGreaterThanOrEqual(0);
      expect(x.rop).toBeCloseTo(x.dDia * P.LT + x.ss, 6);
      expect(x.qSugerida).toBe(Math.ceil(Math.max(0, x.sObjetivo - x.posicionInventario)));
    }
    expect(pr.result.politicas).toHaveLength(244);
    expect(pr.result.resumenEstados.SIN_MOVIMIENTO).toBe(17);
  });
  it('T-PRS-05 plan de compras: sin negativos; con presupuesto, se respeta cada mes', async () => {
    expect(pr.result.plan.every((x) => x.cantidad > 0)).toBe(true);
    bd.run("UPDATE parametro SET valor='20000' WHERE clave='presupuesto_compras_mensual'");
    const dk = describirKardex(bd, kid); const pk = proyectarKardex(bd, kid, { trayectorias: 500 });
    const p2 = optimizarPlan(bd, kid, dk.result, pk.result, null, null, null);
    expect(p2.result.planTotal.porMes.every((m) => m.costo <= 20000 + 1e-6)).toBe(true);
    expect(p2.result.plan.some((x) => x.restriccion === 'PRESUPUESTO')).toBe(true);
    bd.run("UPDATE parametro SET valor='0' WHERE clave='presupuesto_compras_mensual'");
  }, 120000);
  it('T-PRS-06 recomendaciones priorizadas; caso económico sin doble conteo', () => {
    const rec = pr.result.recomendaciones;
    expect(rec.length).toBeGreaterThanOrEqual(6);
    expect(rec.map((x) => x.prioridad)).toEqual([...rec.map((x) => x.prioridad)].sort((a, b) => a - b));
    const c = pr.result.caso;
    const rec_c = rec.filter((x) => x.tipo === 'RECURRENTE_ANUAL' && x.unidad === 'S/').reduce((s, x) => s + x.impacto.central!, 0);
    expect(rec.filter((x) => x.dataset === 'kardex').every((x) => x.unidad === 'unid. equivalentes')).toBe(true); // costo normalizado → no se mezcla con S/
    expect(c.recurrente.central).toBeCloseTo(rec_c, 6);
    expect(c.beneficioNeto.central).toBeCloseTo(c.recurrente.central - c.costoOperacion, 6);
    expect(c.recurrente.conservador <= c.recurrente.central && c.recurrente.central <= c.recurrente.favorable).toBe(true);
    expect(bd.valor<number>('SELECT count(*) FROM recomendacion WHERE run_id=?', [pr.run_id])).toBe(rec.length);
  });
  it('T-PRS-07 advertencia honesta por costo unitario SUPUESTO del Kardex', () => {
    expect(pr.warnings.some((w) => /costo unitario/i.test(w))).toBe(true);
    expect(pr.assumptions.some((a) => a.clave === 'lead_time_dias')).toBe(true);
  });
  it('T-SIM-02 escenarios monótonos, convergencia y resultados persistidos', () => {
    expect(s.validation.every((v) => v.ok)).toBe(true);
    const inv = s.result.inventario!, vt = s.result.ventas!;
    expect(inv.escenarios.map((e) => e.escenario)).toEqual(['Pesimista', 'Base', 'Optimista']);
    expect(vt.escenarios[0].probUtilidadNegativa).toBeGreaterThan(vt.escenarios[2].probUtilidadNegativa);
    expect(bd.valor<number>('SELECT count(*) FROM simulacion WHERE run_id=?', [s.run_id])).toBe(6);
  });
  it('T-SIM-03 Monte Carlo de MATPRIMA-003 = referencia Python independiente (±2 pp de fill rate)', () => {
    const x = pr.result.politicas.find((p) => p.codigo === 'MATPRIMA-003')!;
    expect(x.rop).toBeCloseTo(E.mc_params.s, -1);
    const dias = 515, serie = new Array(dias).fill(0);
    const inicio = Date.parse('2009-01-02');
    for (const r of bd.todas<{ f: string; s: number }>("SELECT fecha f, sum(salida) s FROM kardex_mov WHERE producto_id=? AND origen='excel' AND fecha<='2010-05-31' GROUP BY fecha", [x.pid]))
      serie[Math.round((Date.parse(r.f) - inicio) / 86400000)] = r.s;
    const r = simularPolitica([{ codigo: x.codigo, demandaDiaria: serie, stockInicial: E.mc_params.stock0, s: E.mc_params.s, Q: E.mc_params.Q }],
      { LT: 15, sLT: 5, costo: 1, tasa: 0.2, S: 150, costoFaltante: 1, dias: 183 }, { nombre: 'Base', fDemanda: 1, fLT: 1 }, 4000, mulberry32(3));
    expect(Math.abs(r.fillRate.media - E.mc_fill)).toBeLessThan(0.02);
  });
  it('T-SIM-04 tornado: más demanda y más plazo reducen el fill rate; más nivel de servicio lo aumenta', () => {
    const t = s.result.inventario!.tornado;
    expect(t[0].alto).toBeLessThan(t[0].bajo);
    expect(t[1].alto).toBeLessThan(t[1].bajo);
    expect(t[3].alto).toBeGreaterThan(t[3].bajo);
  });
});
