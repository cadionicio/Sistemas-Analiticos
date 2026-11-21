/**
 * Pruebas del Paso 6: análisis DESCRIPTIVO y DIAGNÓSTICO + Evaluador independiente.
 * Valores esperados calculados de forma INDEPENDIENTE con pandas (tests/fixtures/esperado_analitica.json);
 * para el Kardex, a partir del parser prototipo de la F0 (otro código, otro lenguaje).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { BaseDatos } from '../src/core/db/db';
import { importarVentas } from '../src/core/ingesta/ventas';
import { importarKardex } from '../src/core/ingesta/kardex';
import { describirVentas, describirKardex } from '../src/core/analitica/descriptivo';
import { diagnosticarVentas, diagnosticarKardex, descomponerPVM } from '../src/core/analitica/diagnostico';
import { abc, syntetosBoylan, xyz } from '../src/core/analitica/clasificacion';
import { cuantil, desv, pearson } from '../src/core/analitica/estadistica';
import { evaluarDescriptivoVentas, evaluarDescriptivoKardex, evaluarDiagnosticoVentas } from '../src/core/agentes/evaluador';

const E = JSON.parse(readFileSync('tests/fixtures/esperado_analitica.json', 'utf8'));
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

describe('T-EST · Funciones con casos calculados a mano', () => {
  it('desviación poblacional, cuantil y Pearson', () => {
    expect(desv([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(cuantil([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
  });
  it('ABC con cortes 80/95 (acumulado incluyendo el ítem)', () => {
    const m = abc([{ clave: 'a', valor: 70 }, { clave: 'b', valor: 20 }, { clave: 'c', valor: 6 }, { clave: 'd', valor: 4 }]);
    expect([...'abcd'].map((k) => m.get(k))).toEqual(['A', 'B', 'C', 'C']);
  });
  it('XYZ y Syntetos-Boylan', () => {
    expect(xyz([10, 10, 10, 10]).clase).toBe('X');
    expect(syntetosBoylan([5, 5, 5, 5]).patron).toBe('SUAVE');               // ADI 1, CV² 0
    expect(syntetosBoylan([0, 5, 0, 5, 0, 5]).patron).toBe('INTERMITENTE');  // ADI 2, CV² 0
    expect(syntetosBoylan([0, 1, 0, 9, 0, 1]).patron).toBe('IRREGULAR');     // ADI 2, CV² alto
    expect(syntetosBoylan([0, 0]).patron).toBe('SIN_DEMANDA');
  });
  it('formato sin cero negativo', async () => {
    const { fmtMillones } = await import('../src/core/util/util');
    expect(fmtMillones(-372.6)).toBe('S/ 0.0 M');
  });
  it('PVM reconcilia exactamente en un caso a mano', () => {
    const ant = new Map([['x', { v: 100, q: 10 }], ['y', { v: 50, q: 10 }], ['z', { v: 30, q: 3 }]]);
    const act = new Map([['x', { v: 132, q: 12 }], ['y', { v: 40, q: 8 }], ['w', { v: 20, q: 2 }]]);
    const p = descomponerPVM(ant, act);
    expect(p.precio).toBeCloseTo(12 * (11 - 10), 10); // solo x cambia de precio
    expect(p.precio + p.volumen + p.mezcla + p.nuevos + p.perdidos).toBeCloseTo(p.total, 10);
    expect(p.nuevos).toBe(20); expect(p.perdidos).toBe(-30);
  });
});

describe('T-DES / T-DIA · Ventas reales', () => {
  let bd: BaseDatos; let d: ReturnType<typeof describirVentas>; let g: ReturnType<typeof diagnosticarVentas>;
  beforeAll(async () => {
    bd = await BaseDatos.abrir();
    const r = await importarVentas(bd, readFileSync('tests/fixtures/ventas.xlsx'), 'ventas.xlsx');
    d = describirVentas(bd, r.datasetId);
    g = diagnosticarVentas(bd, r.datasetId, d.result);
  });
  it('T-DES-01 KPI 12 meses = pandas', () => {
    expect(rel(d.result.kpi12.ventas, E.v12)).toBeLessThan(1e-9);
    expect(rel(d.result.kpi12.utilidad, E.u12)).toBeLessThan(1e-9);
    expect(d.result.kpi12.margen).toBeCloseTo(E.margen12, 10);
    expect(d.result.kpi12prev.margen).toBeCloseTo(E.margen12p, 10);
    expect(d.result.kpi12.transacciones).toBe(E.tx12);
    expect(d.result.kpi12.clientes).toBe(E.clientes12);
    expect(d.result.meses.length).toBe(E.meses);
  });
  it('T-DES-02 margen por departamento = pandas', () => {
    for (const x of d.result.departamentos) expect(x.margen).toBeCloseTo(E.deptos[x.departamento].m, 10);
  });
  it('T-DES-03 ABC, XYZ y Syntetos-Boylan = pandas', () => {
    expect(d.result.abc).toEqual(E.abc_ventas);
    expect(d.result.xyz).toEqual(E.xyz);
    expect(d.result.patrones).toEqual(E.sb_ventas);
    expect(d.result.skusConPerdida).toBe(E.sku_util_neg);
  });
  it('T-DES-04 índice estacional = pandas', () => {
    for (let m = 1; m <= 12; m++) expect(d.result.indiceEstacional[m]).toBeCloseTo(E.indice_estacional[m], 10);
  });
  it('T-DIA-01 descomposición precio-volumen-mezcla = pandas y reconcilia', () => {
    for (const k of ['precio', 'volumen', 'mezcla', 'nuevos', 'perdidos', 'total'] as const) expect(Math.abs(g.result.pvm[k] - E.pvm[k])).toBeLessThan(0.01);
  });
  it('T-DIA-02 efecto margen vs. efecto volumen en la utilidad = pandas', () => {
    expect(Math.abs(g.result.utilidad.efectoMargen - E.du.efecto_margen)).toBeLessThan(0.01);
    expect(Math.abs(g.result.utilidad.efectoVolumen - E.du.efecto_volumen)).toBeLessThan(0.01);
  });
  it('T-DIA-03 pérdidas, meses negativos, anomalías y correlación = pandas', () => {
    expect(g.result.perdidas.top20Participacion).toBeCloseTo(E.top20_share_perdidas, 10);
    expect(g.result.mesesUtilidadNegativa).toBe(E.meses_util_neg);
    expect(g.result.anomaliasUtilidad).toEqual(E.anomalias_util);
    expect(g.result.correlacionPrecioMargen).toBeCloseTo(E.corr_precio_margen, 10);
  });
  it('T-DIA-04 hipótesis con sustento, Ishikawa 6M y 5 porqués; guardadas en causa_raiz', () => {
    expect(g.result.hipotesis.length).toBeGreaterThanOrEqual(5);
    expect(g.result.cincoPorques.porques).toHaveLength(5);
    expect(bd.valor<number>('SELECT count(*) FROM causa_raiz WHERE run_id=?', [g.run_id])).toBe(g.result.hipotesis.length);
    expect(Object.values(g.result.ishikawa).flat().length).toBeGreaterThan(0);
  });
  it('T-EVA-01 el Evaluador independiente aprueba descriptivo y diagnóstico (estado EVALUADO)', () => {
    const v1 = evaluarDescriptivoVentas(bd, d);
    const v2 = evaluarDiagnosticoVentas(bd, g, d.result);
    expect(v1.filter((v) => !v.ok)).toEqual([]);
    expect(v2.filter((v) => !v.ok)).toEqual([]);
    expect(bd.valor<string>('SELECT estado_flujo FROM ejecucion WHERE run_id=?', [g.run_id])).toBe('EVALUADO');
  });
  it('T-EVA-02 el Evaluador detecta una cifra adulterada (NEEDS_REVIEW)', () => {
    const falso = structuredClone(d);
    falso.result.kpi12.ventas += 1000;
    const v = evaluarDescriptivoVentas(bd, falso);
    expect(v.some((x) => !x.ok)).toBe(true);
    expect(falso.status).toBe('NEEDS_REVIEW');
  });
});

describe('T-DES / T-DIA · Kardex real', () => {
  let bd: BaseDatos; let d: ReturnType<typeof describirKardex>; let g: ReturnType<typeof diagnosticarKardex>;
  beforeAll(async () => {
    bd = await BaseDatos.abrir();
    const r = await importarKardex(bd, readFileSync('tests/fixtures/kardex.xls'), 'kardex.xls');
    d = describirKardex(bd, r.datasetId);
    g = diagnosticarKardex(bd, r.datasetId, d.result);
  });
  it('T-DES-05 totales por clase de salida, meses y ABC por volumen = parser F0', () => {
    expect(d.result.meses.length).toBe(E.k_meses);
    expect(Math.abs(d.result.totales.salidas - E.k_sal_total)).toBeLessThan(0.01);
    expect(Math.abs(d.result.totales.salVenta - E.k_sal_venta - 0.3)).toBeLessThan(0.01); // + MUESTRAS (0,30), clasificada como salida por venta
    expect(Math.abs(d.result.totales.salConsumo - E.k_sal_consumo)).toBeLessThan(0.01);
    expect(d.result.abc).toEqual(E.k_abc);
    expect(d.result.sinSalidas.length).toBe(E.k_sin_salidas);
  });
  it('T-DES-06 patrones Syntetos-Boylan del Kardex = parser F0', () => {
    expect(d.result.patrones).toEqual(E.sb_kardex);
  });
  it('T-DIA-05 diagnóstico del Kardex: problemas 01, 03, 08 COMPROBADOS; 04 y 05 SIN_EVIDENCIA', () => {
    const s = (id: string) => g.result.hipotesis.find((h) => h.problemaId === id)?.sustento;
    expect([s('01'), s('03'), s('08')]).toEqual(['COMPROBADA', 'COMPROBADA', 'COMPROBADA']);
    expect([s('04'), s('05')]).toEqual(['SIN_EVIDENCIA', 'SIN_EVIDENCIA']);
    expect(g.result.conciliacion.saldosNoCuadran).toBe(57);
    const h07 = g.result.hipotesis.find((h) => h.problemaId === '07')!;
    expect(h07.titulo).toMatch(/DESCARTADA/); // r consumo vs. producción ≈ 0,92: los datos refutan la hipótesis
    expect(h07.sustento).toBe('SIN_EVIDENCIA');
    expect(g.result.conciliacion.bloquesDescuadrados).toBe(19);
  });
  it('T-EVA-03 el Evaluador aprueba el descriptivo del Kardex', () => {
    expect(evaluarDescriptivoKardex(bd, d).filter((v) => !v.ok)).toEqual([]);
  });
});
