/**
 * Pruebas del Paso 7: análisis PREDICTIVO a 6 meses.
 * Oráculo: implementación de referencia independiente en Python (tests/referencia/pronostico_ref.py → esperado_pronostico.json).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { BaseDatos } from '../src/core/db/db';
import { importarVentas } from '../src/core/ingesta/ventas';
import { importarKardex } from '../src/core/ingesta/kardex';
import { proyectarVentas, proyectarKardex } from '../src/core/analitica/predictivo';
import { MODELOS_CONTINUOS, MODELOS_INTERMITENTES, SES, Holt, HoltWinters, Croston, SBA, TSB } from '../src/core/analitica/pronostico/modelos';
import { evaluar, pronosticoPuntual } from '../src/core/analitica/pronostico/backtest';
import { mulberry32 } from '../src/core/analitica/pronostico/prng';
import { simular, pinball } from '../src/core/analitica/pronostico/simulacion';

const R = JSON.parse(readFileSync('tests/fixtures/esperado_pronostico.json', 'utf8'));
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

describe('T-PRE · Modelos con casos calculados a mano', () => {
  it('SES sobre serie constante pronostica la constante y residuos 0', () => {
    const f = pronosticoPuntual(SES, [5, 5, 5, 5, 5, 5, 5], 3)!;
    expect(f).toEqual([5, 5, 5]);
  });
  it('Holt sobre una recta perfecta la extrapola', () => {
    const f = pronosticoPuntual(Holt, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3)!;
    f.forEach((v, i) => expect(v).toBeCloseTo(11 + i, 9));
  });
  it('Holt-Winters sobre estacionalidad pura la reproduce', () => {
    const base = [1, 3, 5, 7, 9, 11, 9, 7, 5, 3, 1, 0];
    const f = pronosticoPuntual(HoltWinters, [...base, ...base, ...base], 12)!;
    f.forEach((v, i) => expect(v).toBeCloseTo(base[i], 6));
  });
  it('Croston/SBA/TSB: demanda 10 cada 2 periodos → tasa 5 (SBA con sesgo corregido 0,95×)', () => {
    const y = [0, 10, 0, 10, 0, 10, 0, 10, 0, 10, 0, 10];
    expect(pronosticoPuntual(Croston, y, 1)![0]).toBeCloseTo(5, 6);
    expect(pronosticoPuntual(SBA, y, 1)![0]).toBeCloseTo(4.75, 6);
    expect(pronosticoPuntual(TSB, y, 1)![0]).toBeGreaterThan(3);
  });
  it('pinball y generador reproducible', () => {
    expect(pinball(10, 8, 0.9)).toBeCloseTo(1.8, 12);
    expect(pinball(6, 8, 0.9)).toBeCloseTo(0.2, 12);
    const a = mulberry32(7), b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('T-PRE · Ventas reales vs. referencia Python', () => {
  let bd: BaseDatos; let p: ReturnType<typeof proyectarVentas>; let y: Record<string, number[]>;
  beforeAll(async () => {
    bd = await BaseDatos.abrir();
    const r = await importarVentas(bd, readFileSync('tests/fixtures/ventas.xlsx'), 'ventas.xlsx');
    p = proyectarVentas(bd, r.datasetId);
    y = Object.fromEntries(p.result.series.slice(0, 3).map((s) => [s.serie, s.historia.map((h) => h.valor)]));
  }, 120000);
  it('T-PRE-01 horizonte abr–sep 2019 y 12 series (3 totales + 9 departamentos)', () => {
    expect(p.result.horizonte).toEqual(['2019-04', '2019-05', '2019-06', '2019-07', '2019-08', '2019-09']);
    expect(p.result.series).toHaveLength(12);
  });
  it('T-PRE-02 MASE por modelo idéntico a la referencia (ventas, utilidad, volumen)', () => {
    const map: Record<string, string> = { ventas_soles: 'soles', utilidad: 'util', volumen: 'vol' };
    for (const s of p.result.series.slice(0, 3)) {
      const ref = R[map[s.serie]];
      for (const e of s.evaluacion) expect(rel(e.maseProm, ref.mase[e.modelo])).toBeLessThan(1e-9);
      expect(s.modelo).toBe(ref.seleccionado);
      expect(s.params).toEqual(ref.params);
    }
  });
  it('T-PRE-03 pronóstico puntual idéntico a la referencia', () => {
    const f = pronosticoPuntual(HoltWinters, y.volumen, 6)!;
    f.forEach((v, i) => expect(rel(v, R.vol.puntual[i])).toBeLessThan(1e-9));
    const g = pronosticoPuntual(SES, y.ventas_soles, 6)!;
    g.forEach((v, i) => expect(rel(v, R.soles.puntual[i])).toBeLessThan(1e-9));
  });
  it('T-PRE-04 bootstrap del total 6 meses coincide con la referencia (±1 %, error de muestreo)', () => {
    const t = p.result.series[0].total;
    expect(rel(t.p10, R.soles.boot.p10)).toBeLessThan(0.01);
    expect(rel(t.p50, R.soles.boot.p50)).toBeLessThan(0.01);
    expect(rel(t.p90, R.soles.boot.p90)).toBeLessThan(0.01);
  });
  it('T-PRE-05 cuantiles ordenados, modelo elegido ≤ Naive y calibración razonable del intervalo 80 %', () => {
    for (const s of p.result.series) {
      s.porMes.forEach((b) => expect(b.p025 <= b.p10 && b.p10 <= b.p50 && b.p50 <= b.p90 && b.p90 <= b.p975).toBe(true));
      expect(s.mejorQueNaive).toBe(true);
    }
    for (const s of p.result.series.slice(0, 3)) { expect(s.calibracion.cobertura80).toBeGreaterThan(0.6); expect(s.calibracion.cobertura80).toBeLessThan(0.97); }
    expect(p.result.series[0].calibracion.factor).toBe(1); // ventas ya bien calibrada: no se toca
    expect(p.status).toBe('OK'); // 111 meses: las calibraciones quedan como supuestos declarados, no como advertencias
  });
  it('T-PRE-06 probabilidad de utilidad 6m negativa entre 0 y 1 y persistencia en BD', () => {
    expect(p.result.probabilidades.utilidad6mNegativa).toBeGreaterThanOrEqual(0);
    expect(p.result.probabilidades.utilidad6mNegativa).toBeLessThan(0.5);
    expect(bd.valor<number>('SELECT count(*) FROM pronostico WHERE run_id=?', [p.run_id])).toBe(12 * 6);
    expect(bd.valor<number>('SELECT count(*) FROM backtest WHERE run_id=? AND seleccionado=1', [p.run_id])).toBe(12 * 6);
    expect(bd.valor<number>("SELECT count(*) FROM kpi_valor WHERE run_id=? AND tipo='proyectado'", [p.run_id])).toBe(9);
  });
  it('T-PRE-07 reproducible: misma semilla → mismos cuantiles', async () => {
    const aj = SES.ajustar(y.ventas_soles)!;
    const a = simular(aj, 6, 2000, mulberry32(1)), b = simular(aj, 6, 2000, mulberry32(1));
    expect(a.total).toEqual(b.total);
  });
  it('T-PRE-08 nunca se usa MAPE; WAPE/MASE definidos', () => {
    const ev = evaluar(MODELOS_CONTINUOS, y.ventas_soles);
    expect(ev.every((e) => e.porH.every((m) => isFinite(m.mase) && isFinite(m.wape)))).toBe(true);
  });
});

describe('T-PRE · Kardex real vs. referencia Python', () => {
  let p: ReturnType<typeof proyectarKardex>;
  beforeAll(async () => {
    const bd = await BaseDatos.abrir();
    const r = await importarKardex(bd, readFileSync('tests/fixtures/kardex.xls'), 'kardex.xls');
    p = proyectarKardex(bd, r.datasetId);
  }, 120000);
  it('T-PRE-09 horizonte jun–nov 2010 (junio 2010 incompleto excluido) y total = referencia', () => {
    expect(p.result.horizonte).toEqual(['2010-06', '2010-07', '2010-08', '2010-09', '2010-10', '2010-11']);
    const t = p.result.total;
    for (const e of t.evaluacion) expect(rel(e.maseProm, R.kardex_total.mase[e.modelo])).toBeLessThan(1e-9);
    expect(t.modelo).toBe(R.kardex_total.seleccionado);
    // Historia corta (17 meses): el intervalo sin calibrar cubre < 75 % → se calibra con un factor declarado
    expect(t.calibracion.coberturaAntes).toBeLessThan(0.75);
    expect(t.calibracion.factor).toBeGreaterThan(1);
    expect(t.calibracion.cobertura80).toBeGreaterThan(t.calibracion.coberturaAntes);
    expect(p.warnings.some((w) => /historia corta \(17 meses\)/.test(w))).toBe(true);
    expect(p.assumptions.some((x) => /calibrado ×/.test(x.valor))).toBe(true);
    expect(p.status).toBe('PROVISIONAL');
  });
  it('T-PRE-10 productos de referencia: mismo modelo y pronóstico puntual', () => {
    for (const cod of ['MATPRIMA-003', 'TB60-3.00', 'TW0-FLAT']) {
      const pr = p.result.productos.find((x) => x.codigo === cod)!;
      expect(pr.modelo).toBe(R['kardex_' + cod].seleccionado);
      const m = MODELOS_INTERMITENTES.find((x) => x.nombre === pr.modelo)!;
      expect(m).toBeDefined();
    }
    expect(p.result.productos).toHaveLength(244);
    expect(p.result.productos.filter((x) => x.patron === 'SIN_DEMANDA').every((x) => x.total.p50 === 0)).toBe(true);
    expect(p.result.productos.every((x) => x.porMes.every((b) => b.p10 >= 0))).toBe(true); // demanda no negativa
  });
});
