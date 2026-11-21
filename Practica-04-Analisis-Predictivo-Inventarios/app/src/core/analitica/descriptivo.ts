/**
 * Skill "describir_operacion" — Análisis DESCRIPTIVO (¿qué pasó?).
 * Todas las cifras se calculan con SQL/TypeScript determinista y se guardan con su run_id (kpi_valor, clasificacion).
 */
import type { SqlValue } from 'sql.js';
import type { BaseDatos } from '../db/db';
import { abc, contar, syntetosBoylan, xyz, type ClaseABC, type Patron } from './clasificacion';
import { guardarEjecucion, mesMas, nuevoResultado, rangoMeses, type ResultadoSkill } from './contrato';
import { suma } from './estadistica';
import { registrarUso } from '../bitacora';

export const VERSION_DESCRIPTIVO = 'describir_operacion@1.0.0';

// ------------------------------------------------------------------ VENTAS
export interface KpiPeriodo { ventas: number; utilidad: number; margen: number; volumen: number; transacciones: number; clientes: number; ticket: number }
export interface DescriptivoVentas {
  cutoff: string; meses: string[];
  serie: { periodo: string; soles: number; utilidad: number; volumen: number; transacciones: number }[];
  kpi12: KpiPeriodo; kpi12prev: KpiPeriodo;
  variacion: { ventas: number; utilidad: number; margenPp: number };
  totalHistorico: { ventas: number; utilidad: number; margen: number };
  departamentos: { departamento: string; soles: number; utilidad: number; margen: number; participacion: number }[];
  abc: Record<string, number>; xyz: Record<string, number>; patrones: Record<string, number>; matriz: Record<string, number>;
  topVentas: { sku: string; soles: number; utilidad: number; margen: number }[];
  topPerdidas: { sku: string; soles: number; utilidad: number; margen: number }[];
  skusConPerdida: number; skus: number;
  indiceEstacional: Record<number, number>;
  concentracionTop20Sku: number;
}

function kpiRango(bd: BaseDatos, ds: number, desde: string, hasta: string): KpiPeriodo {
  const r = bd.una<{ v: number; u: number; q: number; n: number; c: number }>(
    'SELECT sum(soles) v, sum(utilidad) u, sum(volumen) q, count(*) n, count(DISTINCT coalesce(ruc,cliente)) c FROM venta WHERE dataset_id=? AND periodo BETWEEN ? AND ?', [ds, desde, hasta])!;
  return { ventas: r.v ?? 0, utilidad: r.u ?? 0, margen: r.v ? r.u / r.v : 0, volumen: r.q ?? 0, transacciones: r.n, clientes: r.c, ticket: r.n ? r.v / r.n : 0 };
}

export function describirVentas(bd: BaseDatos, datasetId: number): ResultadoSkill<DescriptivoVentas> {
  const t0 = Date.now();
  const cutoff = bd.valor<string>('SELECT ultimo_mes_cerrado FROM dataset WHERE id=?', [datasetId]);
  const base = nuevoResultado<DescriptivoVentas>(bd, 'describir_operacion', VERSION_DESCRIPTIVO, datasetId, cutoff);
  const desde = bd.valor<string>('SELECT min(periodo) FROM venta WHERE dataset_id=?', [datasetId]);
  const meses = rangoMeses(desde, cutoff);
  const serieRaw = new Map(bd.todas<{ periodo: string; s: number; u: number; q: number; n: number }>(
    'SELECT periodo, sum(soles) s, sum(utilidad) u, sum(volumen) q, count(*) n FROM venta WHERE dataset_id=? AND periodo<=? GROUP BY periodo', [datasetId, cutoff]).map((r) => [r.periodo, r]));
  const serie = meses.map((p) => { const r = serieRaw.get(p); return { periodo: p, soles: r?.s ?? 0, utilidad: r?.u ?? 0, volumen: r?.q ?? 0, transacciones: r?.n ?? 0 }; });
  const kpi12 = kpiRango(bd, datasetId, mesMas(cutoff, -11), cutoff);
  const kpi12prev = kpiRango(bd, datasetId, mesMas(cutoff, -23), mesMas(cutoff, -12));
  const tv = suma(serie.map((s) => s.soles)), tu = suma(serie.map((s) => s.utilidad));
  const departamentos = bd.todas<{ departamento: string; soles: number; utilidad: number }>(
    "SELECT coalesce(departamento,'(sin dato)') departamento, sum(soles) soles, sum(utilidad) utilidad FROM venta WHERE dataset_id=? AND periodo<=? GROUP BY 1 ORDER BY soles DESC", [datasetId, cutoff])
    .map((d) => ({ ...d, margen: d.utilidad / d.soles, participacion: d.soles / tv }));
  // Por SKU: totales y serie mensual de volumen (con ceros) para XYZ y Syntetos-Boylan
  const porSku = bd.todas<{ sku: string; pid: number; soles: number; utilidad: number }>(
    'SELECT sku, producto_id pid, sum(soles) soles, sum(utilidad) utilidad FROM venta WHERE dataset_id=? AND periodo<=? GROUP BY sku', [datasetId, cutoff]);
  const idx = new Map(meses.map((m, i) => [m, i]));
  const seriesSku = new Map<string, number[]>(porSku.map((s) => [s.sku, new Array(meses.length).fill(0)]));
  for (const r of bd.todas<{ sku: string; periodo: string; q: number }>('SELECT sku, periodo, sum(volumen) q FROM venta WHERE dataset_id=? AND periodo<=? GROUP BY sku, periodo', [datasetId, cutoff])) {
    seriesSku.get(r.sku)![idx.get(r.periodo)!] = r.q ?? 0;
  }
  const claseAbc = abc(porSku.map((s) => ({ clave: s.sku, valor: s.soles })));
  const claseAbcU = abc(porSku.filter((s) => s.utilidad > 0).map((s) => ({ clave: s.sku, valor: s.utilidad })));
  const cls = porSku.map((s) => {
    const x = xyz(seriesSku.get(s.sku)!), sb = syntetosBoylan(seriesSku.get(s.sku)!);
    return { ...s, abc: claseAbc.get(s.sku) as ClaseABC, abcU: claseAbcU.get(s.sku) ?? '−', xyz: x.clase, cv: x.cv, patron: sb.patron as Patron, adi: sb.adi, cv2: sb.cv2 };
  });
  // Índice estacional: promedio de ventas del mes calendario / promedio mensual global
  const promGlobal = tv / meses.length;
  const indiceEstacional: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) {
    const xs = serie.filter((s) => Number(s.periodo.slice(5)) === m).map((s) => s.soles);
    indiceEstacional[m] = xs.length ? suma(xs) / xs.length / promGlobal : NaN;
  }
  const ordenados = [...porSku].sort((a, b) => b.soles - a.soles);
  const n20 = Math.max(1, Math.round(ordenados.length * 0.2));
  const fmt = (s: typeof porSku[number]) => ({ sku: s.sku, soles: s.soles, utilidad: s.utilidad, margen: s.utilidad / s.soles });
  const result: DescriptivoVentas = {
    cutoff, meses, serie, kpi12, kpi12prev,
    variacion: { ventas: kpi12.ventas / kpi12prev.ventas - 1, utilidad: kpi12.utilidad / kpi12prev.utilidad - 1, margenPp: (kpi12.margen - kpi12prev.margen) * 100 },
    totalHistorico: { ventas: tv, utilidad: tu, margen: tu / tv },
    departamentos,
    abc: contar(cls.map((c) => c.abc)), xyz: contar(cls.map((c) => c.xyz)), patrones: contar(cls.map((c) => c.patron)),
    matriz: contar(cls.map((c) => c.abc + c.xyz)),
    topVentas: ordenados.slice(0, 10).map(fmt),
    topPerdidas: [...porSku].sort((a, b) => a.utilidad - b.utilidad).slice(0, 10).map(fmt),
    skusConPerdida: porSku.filter((s) => s.utilidad < 0).length, skus: porSku.length,
    indiceEstacional, concentracionTop20Sku: suma(ordenados.slice(0, n20).map((s) => s.soles)) / tv,
  };
  const r: ResultadoSkill<DescriptivoVentas> = { ...base, result };
  r.evidence.push({ tabla: 'venta', filtro: `dataset_id=${datasetId} AND periodo<='${cutoff}'`, filas: suma(serie.map((s) => s.transacciones)) });
  r.assumptions.push({ clave: 'ventana_12m', valor: `${mesMas(cutoff, -11)} a ${cutoff} vs. ${mesMas(cutoff, -23)} a ${mesMas(cutoff, -12)}`, es_supuesto: true });
  r.assumptions.push({ clave: 'volumen', valor: '"Venta (Ton)" se usa como volumen reportado (unidad ambigua)', es_supuesto: true });
  // Validaciones internas (el Evaluador independiente repite estas y otras)
  r.validation.push({ regla: 'Σ departamentos = total', ok: Math.abs(suma(departamentos.map((d) => d.soles)) - tv) < 0.01 });
  r.validation.push({ regla: 'Σ ABC = n SKU', ok: suma(Object.values(result.abc)) === porSku.length });
  r.status = r.validation.every((v) => v.ok) ? 'OK' : 'NEEDS_REVIEW';
  r.next_action = 'diagnosticar_desviacion';
  guardarEjecucion(bd, r);
  // Persistencia de KPI y clasificaciones
  const kv: SqlValue[][] = [];
  const add = (kpi: string, dim: string, clave: string, periodo: string, valor: number, unidad: string) => kv.push([r.run_id, kpi, dim, clave, periodo, valor, unidad, 'real']);
  add('ventas_12m', 'total', '*', cutoff, kpi12.ventas, 'S/'); add('utilidad_12m', 'total', '*', cutoff, kpi12.utilidad, 'S/'); add('margen_12m', 'total', '*', cutoff, kpi12.margen, 'fracción');
  add('ventas_12m_prev', 'total', '*', mesMas(cutoff, -12), kpi12prev.ventas, 'S/'); add('utilidad_12m_prev', 'total', '*', mesMas(cutoff, -12), kpi12prev.utilidad, 'S/'); add('margen_12m_prev', 'total', '*', mesMas(cutoff, -12), kpi12prev.margen, 'fracción');
  add('skus_con_perdida', 'total', '*', cutoff, result.skusConPerdida, 'SKU');
  serie.forEach((s) => { add('ventas', 'mes', '*', s.periodo, s.soles, 'S/'); add('utilidad', 'mes', '*', s.periodo, s.utilidad, 'S/'); });
  departamentos.forEach((d) => { add('ventas', 'departamento', d.departamento, '*', d.soles, 'S/'); add('margen', 'departamento', d.departamento, '*', d.margen, 'fracción'); });
  bd.insertarMuchos('INSERT INTO kpi_valor (run_id,kpi,dimension,clave,periodo,valor,unidad,tipo) VALUES (?,?,?,?,?,?,?,?)', kv);
  bd.insertarMuchos('INSERT INTO clasificacion (run_id, producto_id, abc_valor, abc_utilidad, xyz, cv, adi, cv2, patron_sb) VALUES (?,?,?,?,?,?,?,?,?)',
    cls.map((c) => [r.run_id, c.pid, c.abc, c.abcU, c.xyz, isFinite(c.cv) ? c.cv : null, isFinite(c.adi) ? c.adi : null, isFinite(c.cv2) ? c.cv2 : null, c.patron]));
  registrarUso(bd, 'Análisis descriptivo de ventas', 'Análisis descriptivo', `run ${r.run_id.slice(0, 8)} · ${meses.length} meses · ${porSku.length} SKU`, t0);
  return r;
}

// ------------------------------------------------------------------ KARDEX
export interface ProductoKardex {
  codigo: string; pid: number; familia: string; descripcion: string; entradas: number; salidas: number; salVenta: number; salConsumo: number;
  stockFinal: number; stockPromedio: number; rotacion: number | null; coberturaDias: number | null; mesesSinStock: number; abc: ClaseABC | '−'; patron: Patron; adi: number; cv2: number;
}
export interface DescriptivoKardex {
  meses: string[]; dias: number; productos: number;
  serie: { periodo: string; entradas: number; salidas: number; salVenta: number; salConsumo: number; entCompra: number; entProduccion: number }[];
  porProducto: ProductoKardex[];
  abc: Record<string, number>; patrones: Record<string, number>;
  sinSalidas: string[]; coberturaMayor180: number; conStockNegativo: number;
  totales: { entradas: number; salidas: number; salVenta: number; salConsumo: number };
}

export function describirKardex(bd: BaseDatos, datasetId: number): ResultadoSkill<DescriptivoKardex> {
  const t0 = Date.now();
  const ds = bd.una<{ fecha_min: string; fecha_max: string; ultimo_mes_cerrado: string }>('SELECT fecha_min, fecha_max, ultimo_mes_cerrado FROM dataset WHERE id=?', [datasetId])!;
  const base = nuevoResultado<DescriptivoKardex>(bd, 'describir_operacion', VERSION_DESCRIPTIVO, datasetId, ds.ultimo_mes_cerrado);
  const meses = rangoMeses(ds.fecha_min.slice(0, 7), ds.fecha_max.slice(0, 7));
  const dias = Math.round((Date.parse(ds.fecha_max) - Date.parse(ds.fecha_min)) / 86400000) + 1;
  const serie = meses.map((p) => {
    const r = bd.una<{ e: number; s: number; sv: number; sc: number; ec: number; ep: number }>(
      `SELECT sum(entrada) e, sum(salida) s, sum(CASE WHEN clase_mov='SALIDA_VENTA' THEN salida END) sv, sum(CASE WHEN clase_mov='SALIDA_CONSUMO' THEN salida END) sc,
              sum(CASE WHEN clase_mov='ENTRADA_COMPRA' THEN entrada END) ec, sum(CASE WHEN clase_mov='ENTRADA_PRODUCCION' THEN entrada END) ep
       FROM kardex_mov WHERE dataset_id=? AND periodo=? AND origen='excel'`, [datasetId, p])!;
    return { periodo: p, entradas: r.e ?? 0, salidas: r.s ?? 0, salVenta: r.sv ?? 0, salConsumo: r.sc ?? 0, entCompra: r.ec ?? 0, entProduccion: r.ep ?? 0 };
  });
  const prods = bd.todas<{ pid: number; codigo: string; familia: string; descripcion: string; e: number; s: number; sv: number; sc: number }>(
    `SELECT p.id pid, p.codigo, p.familia, p.descripcion, coalesce(sum(m.entrada),0) e, coalesce(sum(m.salida),0) s,
            coalesce(sum(CASE WHEN m.clase_mov='SALIDA_VENTA' THEN m.salida END),0) sv, coalesce(sum(CASE WHEN m.clase_mov='SALIDA_CONSUMO' THEN m.salida END),0) sc
     FROM producto p LEFT JOIN kardex_mov m ON m.producto_id=p.id AND m.origen='excel' WHERE p.dataset_id=? GROUP BY p.id ORDER BY p.codigo`, [datasetId]);
  const stockFinal = new Map(bd.todas<{ pid: number; st: number }>(
    `SELECT producto_id pid, stock_reportado st FROM kardex_mov m WHERE dataset_id=? AND origen='excel' AND id = (
       SELECT id FROM kardex_mov x WHERE x.producto_id=m.producto_id AND x.origen='excel' ORDER BY fecha DESC, id DESC LIMIT 1)`, [datasetId]).map((r) => [r.pid, r.st ?? 0]));
  const bloques = bd.todas<{ pid: number; fin: number; ini: number }>('SELECT producto_id pid, total_final_reportado fin, saldo_inicial ini FROM kardex_bloque WHERE dataset_id=?', [datasetId]);
  const stockProm = new Map<number, number[]>();
  bloques.forEach((b) => stockProm.set(b.pid, [...(stockProm.get(b.pid) ?? []), b.fin ?? b.ini ?? 0]));
  const sinStock = new Map<number, number>();
  bloques.forEach((b) => { if ((b.fin ?? 0) <= 0) sinStock.set(b.pid, (sinStock.get(b.pid) ?? 0) + 1); });
  const idx = new Map(meses.map((m, i) => [m, i]));
  const seriesP = new Map<number, number[]>(prods.map((p) => [p.pid, new Array(meses.length).fill(0)]));
  for (const r of bd.todas<{ pid: number; periodo: string; s: number }>("SELECT producto_id pid, periodo, sum(salida) s FROM kardex_mov WHERE dataset_id=? AND origen='excel' GROUP BY 1,2", [datasetId])) {
    seriesP.get(r.pid)![idx.get(r.periodo)!] = r.s ?? 0;
  }
  const claseAbc = abc(prods.filter((p) => p.s > 0).map((p) => ({ clave: p.pid, valor: p.s })));
  const porProducto: ProductoKardex[] = prods.map((p) => {
    const sp = stockProm.get(p.pid) ?? [0];
    const prom = suma(sp) / sp.length;
    const sf = stockFinal.get(p.pid) ?? 0;
    const sb = syntetosBoylan(seriesP.get(p.pid)!);
    const diaria = p.s / dias;
    return { codigo: p.codigo, pid: p.pid, familia: p.familia, descripcion: p.descripcion, entradas: p.e, salidas: p.s, salVenta: p.sv, salConsumo: p.sc,
      stockFinal: sf, stockPromedio: prom, rotacion: prom > 0 ? p.s / prom : null, coberturaDias: diaria > 0 ? Math.max(sf, 0) / diaria : null,
      mesesSinStock: sinStock.get(p.pid) ?? 0, abc: claseAbc.get(p.pid) ?? '−', patron: sb.patron, adi: sb.adi, cv2: sb.cv2 };
  });
  const result: DescriptivoKardex = {
    meses, dias, productos: prods.length, serie, porProducto,
    abc: contar(porProducto.filter((p) => p.abc !== '−').map((p) => p.abc)), patrones: contar(porProducto.map((p) => p.patron)),
    sinSalidas: porProducto.filter((p) => p.salidas === 0).map((p) => p.codigo),
    coberturaMayor180: porProducto.filter((p) => p.coberturaDias != null && p.coberturaDias > 180).length,
    conStockNegativo: bd.valor<number>('SELECT count(DISTINCT producto_id) FROM kardex_mov WHERE dataset_id=? AND flag_negativo=1', [datasetId]),
    totales: { entradas: suma(prods.map((p) => p.e)), salidas: suma(prods.map((p) => p.s)), salVenta: suma(prods.map((p) => p.sv)), salConsumo: suma(prods.map((p) => p.sc)) },
  };
  const r: ResultadoSkill<DescriptivoKardex> = { ...base, result };
  r.evidence.push({ tabla: 'kardex_mov', filtro: `dataset_id=${datasetId} AND origen='excel'`, filas: bd.valor<number>("SELECT count(*) FROM kardex_mov WHERE dataset_id=? AND origen='excel'", [datasetId]) });
  r.assumptions.push({ clave: 'abc_kardex', valor: 'ABC por volumen de salidas (no hay costos; unidades heterogéneas entre productos)', es_supuesto: true });
  r.assumptions.push({ clave: 'stock_promedio', valor: 'Promedio de los saldos de cierre mensuales (TOTAL FINAL) de cada producto', es_supuesto: true });
  r.validation.push({ regla: 'Σ serie mensual de salidas = Σ por producto', ok: Math.abs(suma(serie.map((s) => s.salidas)) - result.totales.salidas) < 0.01 });
  r.status = r.validation.every((v) => v.ok) ? 'OK' : 'NEEDS_REVIEW';
  r.next_action = 'diagnosticar_desviacion';
  guardarEjecucion(bd, r);
  const kv: SqlValue[][] = [];
  serie.forEach((s) => { kv.push([r.run_id, 'salidas', 'mes', '*', s.periodo, s.salidas, 'unid.', 'real']); kv.push([r.run_id, 'entradas', 'mes', '*', s.periodo, s.entradas, 'unid.', 'real']); });
  kv.push([r.run_id, 'productos_sin_salidas', 'total', '*', '*', result.sinSalidas.length, 'productos', 'real']);
  kv.push([r.run_id, 'productos_cobertura_mayor_180d', 'total', '*', '*', result.coberturaMayor180, 'productos', 'real']);
  bd.insertarMuchos('INSERT INTO kpi_valor (run_id,kpi,dimension,clave,periodo,valor,unidad,tipo) VALUES (?,?,?,?,?,?,?,?)', kv);
  bd.insertarMuchos('INSERT INTO clasificacion (run_id, producto_id, abc_valor, abc_utilidad, xyz, cv, adi, cv2, patron_sb) VALUES (?,?,?,?,?,?,?,?,?)',
    porProducto.map((p) => [r.run_id, p.pid, p.abc === '−' ? null : p.abc, null, null, null, isFinite(p.adi) ? p.adi : null, isFinite(p.cv2) ? p.cv2 : null, p.patron]));
  registrarUso(bd, 'Análisis descriptivo de Kardex', 'Análisis descriptivo', `run ${r.run_id.slice(0, 8)} · ${meses.length} meses · ${prods.length} productos`, t0);
  return r;
}
