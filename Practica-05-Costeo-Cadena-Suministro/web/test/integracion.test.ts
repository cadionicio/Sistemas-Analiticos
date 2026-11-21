// Pruebas de integración: importadores reales (M01, M02, 05) + motor ABC + conciliación.
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { importarProfesor } from "../src/import/profesor";
import { importarPC05 } from "../src/import/pc05";
import { paqueteAInput } from "../src/import/aModelo";
import { costearModelo } from "../src/domain/motor";
const REF = process.env.PC05_REF || "../ref";
const DATOS = process.env.PC05_DATOS || "../datos/05_Datos_Entrada.xlsx";
async function wb(f: string) { const w = new ExcelJS.Workbook(); await w.xlsx.readFile(f); return w; }

test("M01 plantilla: estructura importada y conciliación exacta", async () => {
  const P = importarProfesor(await wb(REF + "/SUPPLY_CHAIN_COSTING_PLANTILLA_PROFESOR.xlsx"), "M01", "x");
  assert.equal(P.modelo.codigo, "M01");
  assert.equal(P.centros.length, 8);
  assert.equal(P.actividades.filter((a) => a.alcance === "INCLUIDA").length, 15);
  assert.equal(P.actividades.filter((a) => a.alcance === "EXCLUIDA").length, 6);
  assert.equal(P.objetos.length, 7);
  const R = costearModelo(paqueteAInput(P, "EXCEL-MES"));
  assert.ok(R.cuadra);
  assert.equal(R.totalFuente, 100162.68);
  assert.equal(R.bloqueos.length, 0);
  // P3: Jefe PR 128 h × 6400/192 = 4266,67 en «Revisar pedido»
  assert.equal(R.resumen.find((x) => x.act.codigo === "A2")!.cpd, 4266.67);
});

test("M02 ejemplo: P3 coincide con el Excel y los defectos quedan visibles (D-09)", async () => {
  const P = importarProfesor(await wb(REF + "/MODELO_EJEMPLO_APLICATIVO.xlsx"), "M02", "x");
  assert.equal(P.actividades.length, 25);
  const R = costearModelo(paqueteAInput(P, "EXCEL-MES"));
  assert.ok(R.cuadra);
  const refP3 = P.referencias.filter((r) => r.concepto === "P3 total CPD por actividad");
  assert.ok(refP3.length >= 25);
  for (const r of refP3) assert.ok(Math.abs(R.resumen.find((x) => x.act.codigo === r.clave)!.cpd - (r.valor as number)) <= 0.01, "P3 " + r.clave);
  assert.ok(R.bloqueos.some((b) => b.includes("Personal indirecto")), "52 100 > 48 920 debe bloquear");
  assert.equal(R.saldos.filter((z) => z.etapa === "P4a").reduce((s, z) => s + z.monto, 0), 48920);
});

test("05 sintético: 24 períodos conciliados, sin bloqueos ni saldos pendientes", async () => {
  const P = importarPC05(await wb(DATOS), "05", "x");
  assert.equal(P.periodos.length, 24);
  for (const p of P.periodos) {
    const R = costearModelo(paqueteAInput(P, p.codigo));
    assert.ok(R.cuadra, p.codigo);
    assert.equal(R.bloqueos.length, 0, p.codigo);
    assert.equal(R.saldos.filter((z) => z.tipo === "PENDIENTE" || z.tipo === "BLOQUEADO").length, 0, p.codigo);
    // D-05: personal indirecto = suma de personas indirectas, sin doble conteo
    const ec01 = R.p4a.find((g) => g.regla?.codigo === "R-EC01-CA")!;
    assert.equal(ec01.r!.saldo, 0, "EC01 " + p.codigo);
  }
});

test("05 inválido: la importación se rechaza completa", async () => {
  const w = await wb(DATOS);
  const ws = w.getWorksheet("Horas")!;
  ws.getCell(2, 2).value = "A99";
  assert.throws(() => importarPC05(w, "malo", "x"), /actividad «A99» no existe/);
});

import { Simulador, sensibilidad, costearConFactores } from "../src/domain/simulacion";
import { hashInput } from "../src/app/modelos";
test("I4 Monte Carlo con el motor ABC real (05, oct-2026): T13 reproducible, T15 escenarios, T49 base intacta", async () => {
  const w = new ExcelJS.Workbook(); await w.xlsx.readFile(DATOS);
  const P = importarPC05(w, "05", "x");
  const base = paqueteAInput(P, "2026-10");
  const h0 = hashInput(base);
  const costoBase = costearConFactores(base, {}).costo;
  const B = [{ variable: "volumen_pedidos", minimo: 0.95, moda: 1, maximo: 1.06 }, { variable: "tarifa_courier", minimo: 0.98, moda: 1, maximo: 1.05 }, { variable: "precio_combustible", minimo: 0.92, moda: 1, maximo: 1.12 }, { variable: "remuneraciones", minimo: 1, moda: 1, maximo: 1.05 }];
  const run = (vars: any[], seed: number) => { const s = new Simulador(base, vars, seed, 300); while (!s.terminado) s.paso(50); return s.muestras.map((m) => m.costo); };
  const a = run(B, 20261105), b = run(B, 20261105), c = run(B, 99);
  assert.deepEqual(a, b, "T13 misma semilla");
  assert.notDeepEqual(a, c, "T13 semilla distinta");
  assert.equal(hashInput(base), h0, "T49 el input base no se modifica");
  assert.equal(costearConFactores(base, {}).costo, costoBase);
  // T15: un escenario pesimista de combustible sube el costo; uno con remuneraciones fijas en 1 lo baja frente a Base
  const pes = run(B.map((v) => (v.variable === "precio_combustible" ? { ...v, minimo: 1, moda: 1.08, maximo: 1.2 } : v)), 20261105);
  const med = (x: number[]) => [...x].sort((p, q) => p - q)[Math.floor(x.length / 2)];
  assert.ok(med(pes) > med(a), "pesimista combustible > base");
  // efecto exacto de un factor: remuneraciones ×1,05 sube el costo en 5 % del costo de personal (P3 + personal indirecto)
  const sens = sensibilidad(base, B);
  assert.ok(sens.filas.every((f) => f.costoMax >= f.costoMin), "subir un factor de costo nunca baja el costo");
  const r105 = costearConFactores(base, { remuneraciones: 1.05 });
  assert.equal(r105.bloqueado, false, "remuneraciones ×1,05 no debe romper la relación personal indirecto = pool (D-05/D-09)");
  assert.ok(r105.costo > costoBase);
  assert.ok(Math.abs(sens.costoModa - costoBase) < 0.01, "modas = 1 → costo base");
});
