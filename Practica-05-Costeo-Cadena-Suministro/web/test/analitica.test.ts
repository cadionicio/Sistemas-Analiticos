// Pruebas unitarias de la analítica (I3): vectores conocidos, sin fuga temporal, Pareto y descomposición.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pronosticar, metricas, pareto, variacionPresupuesto, anomalias, regresion, pearson, periodosSiguientes, METODOS } from "../src/domain/analitica";

const serie = (v: number[], ini = "2024-11") => {
  const ps = [{ periodo: ini, nombre: ini }, ...periodosSiguientes(ini, v.length - 1)];
  return v.map((x, i) => ({ periodo: ps[i].periodo, nombre: ps[i].nombre, valor: x }));
};

test("T-A01 métricas con vector conocido", () => {
  const m = metricas([100, 200], [110, 180]);
  assert.equal(m.mae, 15);
  assert.ok(Math.abs(m.rmse - Math.sqrt((100 + 400) / 2)) < 1e-9);
  assert.ok(Math.abs(m.mape - 10) < 1e-9); // (10 % + 10 %) / 2
});

test("T-A02 serie lineal exacta: gana tendencia (o Holt) con error ≈ 0 y continúa la recta", () => {
  const y = serie(Array.from({ length: 24 }, (_, i) => 1000 + 50 * i));
  const r = pronosticar("lineal", y);
  assert.ok(["tendencia", "holt"].includes(r.elegido), r.elegido);
  const best = r.backtest.find((b) => b.id === r.elegido)!;
  assert.ok(best.smape! < 1e-6);
  assert.ok(Math.abs(r.futuro[0].central - (1000 + 50 * 24)) < 1e-6);
  assert.equal(r.futuro[0].periodo, "2026-11");
  assert.equal(r.futuro.length, 6);
});

test("T-A03 backtest sin fuga: cambiar los meses de prueba no altera los pronósticos de prueba", () => {
  const base = Array.from({ length: 24 }, (_, i) => 500 + 10 * i + (i % 3) * 7);
  const otra = [...base];
  for (let i = 18; i < 24; i++) otra[i] = otra[i] * 3; // se alteran solo los 6 meses de validación
  const a = pronosticar("a", serie(base)), b = pronosticar("b", serie(otra));
  for (const m of a.backtest.filter((x) => x.elegible)) {
    const mb = b.backtest.find((x) => x.id === m.id)!;
    assert.deepEqual(m.pron, mb.pron, "el método " + m.id + " no debe ver los meses de prueba");
  }
});

test("T-A04 selección por menor sMAPE y métodos no elegibles rotulados", () => {
  const r = pronosticar("corta", serie([10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17]));
  const ok = r.backtest.filter((b) => b.elegible);
  const min = Math.min(...ok.map((b) => b.smape!));
  assert.equal(r.backtest.find((b) => b.id === r.elegido)!.smape, min);
  const est = r.backtest.find((b) => b.id === "estacional")!;
  assert.equal(est.elegible, false);
  assert.match(est.motivo!, /≥ 18/);
});

test("T-A05 histórico insuficiente: solo línea base ingenua, sin banda", () => {
  const r = pronosticar("mini", serie([5, 6, 7]));
  assert.equal(r.elegido, "ingenuo");
  assert.ok(r.advertencia);
  assert.ok(Number.isNaN(r.futuro[0].bajo));
});

test("T-A06 banda: se ensancha con el horizonte y no es negativa", () => {
  const r = pronosticar("ruido", serie(Array.from({ length: 24 }, (_, i) => 100 + ((i * 37) % 11) - 5)));
  for (let i = 1; i < 6; i++) assert.ok(r.futuro[i].alto - r.futuro[i].bajo >= r.futuro[i - 1].alto - r.futuro[i - 1].bajo - 1e-9);
  assert.ok(r.futuro.every((f) => f.bajo >= 0));
});

test("T-A07 Pareto: orden, acumulado 100 % y clases A/B/C", () => {
  const p = pareto([{ k: "a", v: 70 }, { k: "b", v: 20 }, { k: "c", v: 6 }, { k: "d", v: 4 }], (x) => x.v);
  assert.deepEqual(p.map((x) => x.item.k), ["a", "b", "c", "d"]);
  assert.deepEqual(p.map((x) => x.clase), ["A", "A", "B", "C"]); // la que cruza el 80 % es A (acumulado previo < 80 %)
  assert.ok(Math.abs(p[3].acumulado - 1) < 1e-12);
});

test("T-A08 variación presupuesto: efecto volumen + efecto costo = variación total (exacto)", () => {
  const v = variacionPresupuesto(121000, 1100, 100000, 1000);
  assert.equal(v.variacion, 21000);
  assert.equal(v.efVol, 10000); // 100 pedidos × 100
  assert.equal(v.efCosto, 11000); // (110 − 100) × 1100
  assert.ok(Math.abs(v.efVol + v.efCosto - v.variacion) < 1e-9);
});

test("T-A09 regresión y correlación con vector conocido", () => {
  const r = regresion([1, 2, 3, 4], [3, 5, 7, 9]);
  assert.ok(Math.abs(r.a - 1) < 1e-12 && Math.abs(r.b - 2) < 1e-12 && Math.abs(r.r2 - 1) < 1e-12);
  assert.ok(Math.abs(pearson([1, 2, 3], [3, 2, 1]) + 1) < 1e-12);
});

test("T-A10 anomalías: detecta el valor atípico y no los normales", () => {
  const y = serie([10, 11, 10, 9, 10, 11, 10, 9, 10, 40]);
  const a = anomalias(y, 2);
  assert.equal(a.length, 1);
  assert.equal(a[0].valor, 40);
});

test("T-A11 catálogo de métodos con línea base ingenua", () => {
  assert.equal(METODOS[0].id, "ingenuo");
  assert.ok(METODOS.length >= 5);
});
