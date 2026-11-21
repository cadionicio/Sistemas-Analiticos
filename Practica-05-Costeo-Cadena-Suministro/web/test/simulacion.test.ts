// Pruebas I4: Monte Carlo reproducible, percentiles, escenarios, EVA y ΔEVA (T13–T17, T49).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, triangular, resumir, percentil, convergencia } from "../src/domain/simulacion";
import { wacc, nopat, eva, deltaEvaPropuesta } from "../src/domain/eva";

test("T16 EVA vector S/ 60 000 (NOPAT 180 000, WACC 10 %, capital 1 200 000)", () => {
  assert.equal(eva(180000, 0.1, 1200000), 60000);
});
test("MT-33 ejemplo: EVA base 50 000, alternativa 70 000, ΔEVA 20 000", () => {
  const b = eva(150000, 0.1, 1000000), a = eva(180000, 0.1, 1100000);
  assert.ok(Math.abs(b - 50000) < 1e-9 && Math.abs(a - 70000) < 1e-9 && Math.abs(a - b - 20000) < 1e-9);
});
test("WACC = Ke·E/V + Kd·(1−T)·D/V", () => {
  const w = wacc({ capital: 0, ke: 0.145, kd: 0.092, deuda: 2600000, patrimonio: 3900000, t: 0.295 });
  assert.ok(Math.abs(w.wacc - (0.145 * 0.6 + 0.092 * 0.705 * 0.4)) < 1e-12);
  assert.throws(() => wacc({ capital: 0, ke: 0.1, kd: 0.1, deuda: 0, patrimonio: 0, t: 0.3 }));
});
test("NOPAT = utilidad operativa × (1 − T); el costo de capital no entra al costo logístico", () => {
  const n = nopat({ ventas: 1000, costoVentas: 600, costoLogistico: 150, otrosGastos: 50, t: 0.3 });
  assert.equal(n.utilidadOperativa, 200);
  assert.ok(Math.abs(n.nopat - 140) < 1e-9);
});
test("T17 ΔEVA de una propuesta: ahorro después de impuestos − WACC × inversión", () => {
  const d = deltaEvaPropuesta(100000, 200000, 0.3, 0.1);
  assert.ok(Math.abs(d.dNopat - 70000) < 1e-9 && Math.abs(d.dCargo - 20000) < 1e-9 && Math.abs(d.dEva - 50000) < 1e-9);
  assert.ok(deltaEvaPropuesta(10000, 200000, 0.3, 0.1).dEva < 0, "una inversión que no se paga reduce EVA");
});
test("T13 PRNG: misma semilla reproduce la secuencia; semilla distinta la cambia", () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const sa = Array.from({ length: 50 }, a), sb = Array.from({ length: 50 }, b), sc = Array.from({ length: 50 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((x) => x >= 0 && x < 1));
});
test("Triangular: dentro de [mín, máx] y media ≈ (a+c+b)/3", () => {
  const r = mulberry32(7); const xs = Array.from({ length: 20000 }, () => triangular(r(), 0.9, 1, 1.2));
  assert.ok(xs.every((x) => x >= 0.9 && x <= 1.2));
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(Math.abs(m - (0.9 + 1 + 1.2) / 3) < 0.003, "media " + m);
  assert.equal(triangular(0.5, 1, 1, 1), 1);
});
test("T14 percentiles ordenados y probabilidades entre 0 y 1", () => {
  const r = mulberry32(1); const xs = Array.from({ length: 1000 }, () => r() * 100 - 20);
  const s = resumir(xs, 50);
  assert.ok(s.min <= s.p5 && s.p5 <= s.p50 && s.p50 <= s.p95 && s.p95 <= s.max);
  assert.ok(s.probSupera! >= 0 && s.probSupera! <= 1 && s.probNegativo >= 0 && s.probNegativo <= 1);
  assert.equal(s.hist.reduce((a, h) => a + h.n, 0), 1000);
  assert.equal(percentil([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(convergencia(xs).at(-1)!.n, 1000);
});
