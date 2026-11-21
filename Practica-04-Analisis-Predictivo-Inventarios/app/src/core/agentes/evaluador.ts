/**
 * EVALUADOR INDEPENDIENTE (ayuda base, PDF 02 pág. 14): recalcula cifras con consultas propias —distintas de las de la skill—
 * y decide el estado del resultado. No "pregunta a otro modelo si está de acuerdo".
 */
import type { BaseDatos } from '../db/db';
import { actualizarEstado, type ResultadoSkill, type Validacion } from '../analitica/contrato';
import type { DescriptivoKardex, DescriptivoVentas } from '../analitica/descriptivo';
import type { DiagnosticoVentas } from '../analitica/diagnostico';

const cerca = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

function cerrar<T>(bd: BaseDatos, r: ResultadoSkill<T>, v: Validacion[]): Validacion[] {
  const todas = [...r.validation, ...v];
  const ok = todas.every((x) => x.ok);
  r.status = ok ? 'OK' : 'NEEDS_REVIEW';
  r.estado_flujo = ok ? 'EVALUADO' : 'ANALIZADO';
  r.validation = todas;
  actualizarEstado(bd, r.run_id, r.status, r.estado_flujo, todas);
  return todas;
}

export function evaluarDescriptivoVentas(bd: BaseDatos, r: ResultadoSkill<DescriptivoVentas>): Validacion[] {
  const x = r.result;
  const total = bd.valor<number>('SELECT total(soles) FROM venta WHERE dataset_id=? AND periodo<=?', [r.dataset_id, x.cutoff]);
  const tot12 = bd.valor<number>('SELECT total(soles) FROM venta WHERE dataset_id=? AND periodo>? AND periodo<=?', [r.dataset_id, x.meses.at(-13) ?? '', x.cutoff]);
  const serieSum = x.serie.reduce((s, m) => s + m.soles, 0);
  const nsku = bd.valor<number>('SELECT count(DISTINCT sku) FROM venta WHERE dataset_id=? AND periodo<=?', [r.dataset_id, x.cutoff]);
  return cerrar(bd, r, [
    { regla: 'EV-D1 Serie mensual suma el total recalculado', ok: cerca(serieSum, total), detalle: `${serieSum} vs ${total}` },
    { regla: 'EV-D2 Ventas 12m = recálculo independiente', ok: cerca(x.kpi12.ventas, tot12) },
    { regla: 'EV-D3 Todos los SKU clasificados (ABC/XYZ/patrón)', ok: Object.values(x.abc).reduce((a, b) => a + b, 0) === nsku && Object.values(x.patrones).reduce((a, b) => a + b, 0) === nsku },
    { regla: 'EV-D4 Margen = utilidad / ventas', ok: cerca(x.kpi12.margen, x.kpi12.utilidad / x.kpi12.ventas, 1e-12) },
    { regla: 'EV-D5 Meses consecutivos sin huecos hasta el corte', ok: x.meses.at(-1) === x.cutoff },
  ]);
}

export function evaluarDescriptivoKardex(bd: BaseDatos, r: ResultadoSkill<DescriptivoKardex>): Validacion[] {
  const x = r.result;
  const sal = bd.valor<number>("SELECT total(salida) FROM kardex_mov WHERE dataset_id=? AND origen='excel'", [r.dataset_id]);
  const prod = bd.valor<number>('SELECT count(*) FROM producto WHERE dataset_id=?', [r.dataset_id]);
  return cerrar(bd, r, [
    { regla: 'EV-K1 Salidas totales = recálculo', ok: cerca(x.totales.salidas, sal) },
    { regla: 'EV-K2 Todos los productos clasificados', ok: Object.values(x.patrones).reduce((a, b) => a + b, 0) === prod },
    { regla: 'EV-K3 Salidas por venta + consumo ≤ salidas totales', ok: x.totales.salVenta + x.totales.salConsumo <= x.totales.salidas + 0.01 },
  ]);
}

export function evaluarDiagnosticoVentas(bd: BaseDatos, r: ResultadoSkill<DiagnosticoVentas>, desc: DescriptivoVentas): Validacion[] {
  const x = r.result;
  return cerrar(bd, r, [
    { regla: 'EV-G1 Δventas del PVM = Δ de los KPI descriptivos', ok: cerca(x.pvm.total, desc.kpi12.ventas - desc.kpi12prev.ventas) },
    { regla: 'EV-G2 Δutilidad = Σ Δ por departamento', ok: cerca(x.utilidad.total, x.departamentos.reduce((s, d) => s + d.deltaUtilidad, 0)) },
    { regla: 'EV-G3 SKU con pérdida coincide con el descriptivo', ok: x.perdidas.skus === desc.skusConPerdida },
    { regla: 'EV-G4 Ninguna hipótesis de causalidad sin evidencia', ok: x.hipotesis.every((h) => h.sustento === 'SIN_EVIDENCIA' || h.sustento === 'A_VERIFICAR' || h.favor.length > 10) },
  ]);
}
