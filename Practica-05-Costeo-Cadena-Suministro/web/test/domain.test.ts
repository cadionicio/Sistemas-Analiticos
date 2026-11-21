import { test } from "node:test";
import assert from "node:assert/strict";
import { costearPersona, costoEmpresa, repartir, tasaHora, concilia, redondearConservando } from "../src/domain/abc";

// T63 / Vector mínimo obligatorio V7: dos analistas del mismo puesto
test("T63 dos personas mismo puesto, distinta tasa, mismo costo en X", () => {
  const a = costearPersona(4200, 160, [{ actividadId: "X", horas: 80 }, { actividadId: "Y", horas: 40 }]);
  const b = costearPersona(5040, 168, [{ actividadId: "X", horas: 70 }, { actividadId: "Y", horas: 30 }]);
  assert.equal(a.tasa, 26.25);
  assert.equal(b.tasa, 30);
  assert.equal(a.porActividad[0].importe, 2100);
  assert.equal(b.porActividad[0].importe, 2100);
  assert.equal(a.porActividad[0].importe + b.porActividad[0].importe, 4200);
  assert.equal(a.porActividad[1].importe, 1050);
  assert.equal(b.porActividad[1].importe, 900);
  // D-04 capacidad no utilizada
  assert.equal(a.capacidadNoUtilizada, 1050); // 40 h × 26,25
  assert.equal(b.capacidadNoUtilizada, 2040); // 68 h × 30
  assert.ok(concilia(4200, a.costoAplicado, a.capacidadNoUtilizada));
});

test("T65 sobreimputación bloqueada salvo autorización", () => {
  const r = costearPersona(1920, 192, [{ actividadId: "X", horas: 200 }]);
  assert.equal(r.estado, "SOBREIMPUTADA");
  assert.equal(r.costoAplicado, 0);
  const r2 = costearPersona(1920, 192, [{ actividadId: "X", horas: 200 }], true);
  assert.equal(r2.estado, "SOBREIMPUTADA_AUTORIZADA");
  assert.equal(r2.costoAplicado, 2000);
});

test("tasa con horas cero no calcula", () => {
  assert.equal(tasaHora(1000, 0).ok, false);
});

test("D-02 costo empresa por componentes", () => {
  assert.equal(costoEmpresa({ remuneracion: 3200, essalud: 288, gratificacion: 400, cts: 186.67, vacaciones: 125.33, bonos: 0, otros: 0 }), 4200);
});

// T69 inductor 1 200 / 60 pedidos
test("T69 pool 1200 / 60 pedidos = 20; 300 + 900", () => {
  const r = repartir(1200, "cantidad", [{ destinoId: "A", valor: 15 }, { destinoId: "B", valor: 45 }], "pedido");
  assert.equal(r.denominador, 60);
  assert.equal(r.tasa, 20);
  assert.deepEqual(r.lineas.map((l) => l.importe), [300, 900]);
  assert.equal(r.saldo, 0);
  assert.equal(r.estado, "CALCULADO");
});

// T08 vector 12 000 / 600 h
test("T08 12000/600 h = 20/h; 40 h = 800", () => {
  const r = repartir(12000, "cantidad", [{ destinoId: "O1", valor: 40 }, { destinoId: "resto", valor: 560 }], "hora");
  assert.equal(r.tasa, 20);
  assert.equal(r.lineas[0].importe, 800);
});

test("T70 denominador cero → pendiente, saldo = pool", () => {
  const r = repartir(500, "cantidad", [{ destinoId: "A", valor: 0 }, { destinoId: "B", valor: null }]);
  assert.equal(r.estado, "PENDIENTE");
  assert.equal(r.saldo, 500);
  assert.equal(r.tasa, null);
});

test("D-09 porcentajes 90 % → saldo 10 %, sin normalizar", () => {
  const r = repartir(1743, "porcentaje", [{ destinoId: "H", valor: 0.4 }, { destinoId: "I", valor: 0.5 }]);
  assert.equal(r.estado, "CON_SALDO");
  assert.equal(r.lineas[0].importe, 697.2);
  assert.equal(r.lineas[1].importe, 871.5);
  assert.equal(r.saldo, 174.3);
});

test("D-09 porcentajes > 100 % bloquean", () => {
  assert.equal(repartir(100, "porcentaje", [{ destinoId: "A", valor: 0.7 }, { destinoId: "B", valor: 0.4 }]).estado, "BLOQUEADO");
});

test("D-09 importe base > pool bloquea (ejemplo: 52 100 > 48 920)", () => {
  assert.equal(repartir(48920, "importe", [{ destinoId: "P", valor: 18500 }, { destinoId: "Q", valor: 33600 }]).estado, "BLOQUEADO");
});

test("redondeo conserva el total exacto", () => {
  const v = redondearConservando([100 / 3, 100 / 3, 100 / 3], 100);
  assert.equal(Math.round(v.reduce((s, x) => s + x, 0) * 100), 10000);
  const r = repartir(100, "cantidad", [{ destinoId: "a", valor: 1 }, { destinoId: "b", valor: 1 }, { destinoId: "c", valor: 1 }]);
  assert.equal(r.asignado, 100);
});

test("directo y plano", () => {
  const d = repartir(2490, "directo", [{ destinoId: "A", valor: 0 }, { destinoId: "Alm", valor: 1 }]);
  assert.equal(d.lineas[1].importe, 2490);
  const p = repartir(1000, "plano", [{ destinoId: "a", valor: 1 }, { destinoId: "b", valor: 1 }, { destinoId: "c", valor: 0 }, { destinoId: "d", valor: 1 }]);
  assert.equal(p.asignado, 1000);
});

import { fmtNum, fmtMoney, parseNumero } from "../src/domain/formato";
test("formato regional aprobado: 1.234,10 y -1.234,10", () => {
  assert.equal(fmtNum(1234.1), "1.234,10");
  assert.equal(fmtNum(-1234.1), "-1.234,10");
  assert.equal(fmtMoney(4200), "S/ 4.200,00");
  assert.equal(fmtNum(1234567.891), "1.234.567,89");
  assert.equal(fmtNum(26.25, 4), "26,2500");
  assert.equal(fmtNum(0), "0,00");
  assert.equal(fmtNum(-0.001), "0,00");
});
test("lectura de números escritos por el usuario", () => {
  assert.equal(parseNumero("4.200,00"), 4200);
  assert.equal(parseNumero("1.234,10"), 1234.1);
  assert.equal(parseNumero("26,25"), 26.25);
  assert.equal(parseNumero("26.25"), 26.25);
  assert.equal(parseNumero("1.200"), 1200);
  assert.equal(parseNumero("1.234.567"), 1234567);
  assert.equal(parseNumero("S/ 900,00"), 900);
  assert.equal(parseNumero(""), null);
  assert.ok(Number.isNaN(parseNumero("abc") as number));
  assert.ok(Number.isNaN(parseNumero("1,2,3") as number));
});
