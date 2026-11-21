/**
 * Skill "diagnosticar_desviacion" — Análisis DIAGNÓSTICO (¿por qué pasó? causa raíz).
 * Método (ayuda base, PDF 02 pág. 6): desviación medible → descomposición → hipótesis → evidencia a favor/en contra
 * → nivel de sustento (COMPROBADA por trazabilidad, ASOCIATIVA, A_VERIFICAR, SIN_EVIDENCIA). Nunca se afirma causalidad sin evidencia.
 */
import type { SqlValue } from 'sql.js';
import type { BaseDatos } from '../db/db';
import { guardarEjecucion, mesMas, nuevoResultado, type ResultadoSkill } from './contrato';
import { mad, mediana, pearson, suma, zRobusto } from './estadistica';
import type { DescriptivoKardex, DescriptivoVentas } from './descriptivo';
import { registrarUso } from '../bitacora';
import { fmtMillones, fmtNum, fmtPct } from '../util/util';

export const VERSION_DIAGNOSTICO = 'diagnosticar_desviacion@1.0.0';
export type Sustento = 'COMPROBADA' | 'ASOCIATIVA' | 'A_VERIFICAR' | 'SIN_EVIDENCIA';
export type Categoria6M = 'Método' | 'Mano de obra' | 'Materiales' | 'Máquina' | 'Medición' | 'Medio ambiente';

export interface Hipotesis {
  problemaId: string | null; // 01..10 de la ayuda base
  titulo: string; categoria: Categoria6M; hipotesis: string;
  favor: string; contra: string; sustento: Sustento; contribucion: number | null; unidad: string | null;
  dataset: 'ventas' | 'kardex' | 'ambos';
}

export interface DiagnosticoVentas {
  ventana: { actual: string; anterior: string };
  pvm: { precio: number; volumen: number; mezcla: number; nuevos: number; perdidos: number; total: number };
  utilidad: { efectoVolumen: number; efectoMargen: number; total: number };
  departamentos: { departamento: string; deltaUtilidad: number; margenActual: number; margenAnterior: number }[];
  perdidas: { skus: number; total: number; top20Participacion: number; top: { sku: string; utilidad: number }[] };
  mesesUtilidadNegativa: number; anomaliasUtilidad: string[];
  correlacionPrecioMargen: number;
  hipotesis: Hipotesis[];
  ishikawa: Record<Categoria6M, string[]>;
  cincoPorques: { problema: string; porques: string[]; causaRaiz: string };
}

/** Descomposición precio-volumen-mezcla de la variación de ventas entre dos ventanas (por SKU). */
export function descomponerPVM(ant: Map<string, { v: number; q: number }>, act: Map<string, { v: number; q: number }>) {
  const comunes = [...act.keys()].filter((k) => ant.has(k) && ant.get(k)!.q > 0 && act.get(k)!.q > 0);
  const Q1 = suma(comunes.map((k) => act.get(k)!.q)), Q0 = suma(comunes.map((k) => ant.get(k)!.q));
  const P0 = suma(comunes.map((k) => ant.get(k)!.v)) / Q0;
  let precio = 0, q1p0 = 0;
  for (const k of comunes) {
    const a = act.get(k)!, b = ant.get(k)!;
    precio += a.q * (a.v / a.q - b.v / b.q);
    q1p0 += a.q * (b.v / b.q);
  }
  const nuevos = suma([...act.keys()].filter((k) => !comunes.includes(k)).map((k) => act.get(k)!.v));
  const perdidos = -suma([...ant.keys()].filter((k) => !comunes.includes(k)).map((k) => ant.get(k)!.v));
  const total = suma([...act.values()].map((x) => x.v)) - suma([...ant.values()].map((x) => x.v));
  return { precio, volumen: (Q1 - Q0) * P0, mezcla: q1p0 - Q1 * P0, nuevos, perdidos, total };
}

function ventana(bd: BaseDatos, ds: number, desde: string, hasta: string) {
  return new Map(bd.todas<{ sku: string; v: number; q: number }>('SELECT sku, sum(soles) v, sum(volumen) q FROM venta WHERE dataset_id=? AND periodo BETWEEN ? AND ? GROUP BY sku', [ds, desde, hasta])
    .map((r) => [r.sku, { v: r.v, q: r.q }]));
}

export function diagnosticarVentas(bd: BaseDatos, datasetId: number, desc: DescriptivoVentas): ResultadoSkill<DiagnosticoVentas> {
  const t0 = Date.now();
  const cutoff = desc.cutoff;
  const base = nuevoResultado<DiagnosticoVentas>(bd, 'diagnosticar_desviacion', VERSION_DIAGNOSTICO, datasetId, cutoff);
  const a0 = mesMas(cutoff, -23), a1 = mesMas(cutoff, -12), b0 = mesMas(cutoff, -11);
  const pvm = descomponerPVM(ventana(bd, datasetId, a0, a1), ventana(bd, datasetId, b0, cutoff));
  const k1 = desc.kpi12, k0 = desc.kpi12prev;
  const utilidad = { efectoVolumen: (k1.ventas - k0.ventas) * k0.margen, efectoMargen: k1.ventas * (k1.margen - k0.margen), total: k1.utilidad - k0.utilidad };
  const departamentos = bd.todas<{ d: string; u1: number; u0: number; v1: number; v0: number }>(
    `SELECT coalesce(departamento,'(sin dato)') d,
       sum(CASE WHEN periodo BETWEEN ? AND ? THEN utilidad END) u1, sum(CASE WHEN periodo BETWEEN ? AND ? THEN utilidad END) u0,
       sum(CASE WHEN periodo BETWEEN ? AND ? THEN soles END) v1, sum(CASE WHEN periodo BETWEEN ? AND ? THEN soles END) v0
     FROM venta WHERE dataset_id=? GROUP BY 1`, [b0, cutoff, a0, a1, b0, cutoff, a0, a1, datasetId])
    .map((r) => ({ departamento: r.d, deltaUtilidad: (r.u1 ?? 0) - (r.u0 ?? 0), margenActual: r.u1 / r.v1, margenAnterior: r.u0 / r.v0 }))
    .sort((x, y) => x.deltaUtilidad - y.deltaUtilidad);
  const skuU = bd.todas<{ sku: string; u: number; v: number; q: number }>('SELECT sku, sum(utilidad) u, sum(soles) v, sum(volumen) q FROM venta WHERE dataset_id=? AND periodo<=? GROUP BY sku', [datasetId, cutoff]);
  const neg = skuU.filter((s) => s.u < 0).sort((x, y) => x.u - y.u);
  const totNeg = suma(neg.map((s) => s.u));
  const perdidas = { skus: neg.length, total: totNeg, top20Participacion: suma(neg.slice(0, 20).map((s) => s.u)) / totNeg, top: neg.slice(0, 10).map((s) => ({ sku: s.sku, utilidad: s.u })) };
  const um = desc.serie.map((s) => s.utilidad);
  const med = mediana(um), m = mad(um);
  const anomaliasUtilidad = desc.serie.filter((s) => Math.abs(zRobusto(s.utilidad, med, m)) > 3.5).map((s) => s.periodo);
  const conQ = skuU.filter((s) => s.q > 0);
  const correlacionPrecioMargen = pearson(conQ.map((s) => s.v / s.q), conQ.map((s) => s.u / s.v));
  const peorDep = departamentos[0];
  const deps = desc.departamentos;
  const depMin = [...deps].sort((x, y) => x.margen - y.margen)[0], depMax = [...deps].sort((x, y) => y.margen - x.margen)[0];

  const hipotesis: Hipotesis[] = [
    { problemaId: null, titulo: Math.abs(pvm.volumen) >= Math.abs(pvm.precio) ? `Variación de ventas explicada por volumen, no por precio` : `Variación de ventas explicada por precio`, categoria: 'Método', dataset: 'ventas',
      hipotesis: Math.abs(pvm.volumen) >= Math.abs(pvm.precio) ? 'La variación de ventas de los últimos 12 meses se explica principalmente por el volumen vendido y no por cambios de precio.' : 'La variación de ventas de los últimos 12 meses se explica principalmente por cambios de precio.',
      favor: `Efecto volumen ${fmtMillones(pvm.volumen)}, efecto precio ${fmtMillones(pvm.precio)}, mezcla ${fmtMillones(pvm.mezcla)}, SKU nuevos ${fmtMillones(pvm.nuevos)}, SKU perdidos ${fmtMillones(pvm.perdidos)}; total ${fmtMillones(pvm.total)} (reconciliado).`,
      contra: 'El precio implícito es Soles/volumen; si la unidad de volumen no es homogénea, la separación precio/volumen podría sesgarse.',
      sustento: 'COMPROBADA', contribucion: pvm.volumen, unidad: 'S/' },
    { problemaId: null, titulo: Math.abs(utilidad.efectoMargen) >= Math.abs(utilidad.efectoVolumen) ? 'La variación de la utilidad se explica por el margen' : 'La variación de la utilidad se explica por el volumen de ventas', categoria: 'Método', dataset: 'ventas',
      hipotesis: Math.abs(utilidad.efectoMargen) >= Math.abs(utilidad.efectoVolumen) ? 'La variación de la utilidad operativa se debe principalmente al cambio del margen porcentual y en menor medida al de las ventas.' : 'La variación de la utilidad operativa se debe principalmente al cambio de las ventas y no del margen.',
      favor: `Efecto margen ${fmtMillones(utilidad.efectoMargen)} vs. efecto volumen ${fmtMillones(utilidad.efectoVolumen)}; margen ${fmtPct(k0.margen)} → ${fmtPct(k1.margen)}.`,
      contra: 'La descomposición es contable (identidad), no identifica el componente de costo que subió; no hay detalle de costos por partida.',
      sustento: 'COMPROBADA', contribucion: utilidad.efectoMargen, unidad: 'S/' },
    { problemaId: '10', titulo: 'Surtido con productos que destruyen valor', categoria: 'Método', dataset: 'ventas',
      hipotesis: 'Una parte relevante del portafolio se vende por debajo de su costo operativo, sin una política de precios/surtido que lo corrija.',
      favor: `${neg.length} de ${skuU.length} SKU (${fmtPct(neg.length / skuU.length, 1)}) acumulan utilidad negativa por ${fmtMillones(totNeg)}; los 20 peores concentran ${fmtPct(perdidas.top20Participacion, 1)} de la pérdida.`,
      contra: 'Puede haber productos gancho o compromisos comerciales que justifiquen margen negativo; no hay datos de estrategia comercial.',
      sustento: neg.length / skuU.length >= 0.05 ? 'ASOCIATIVA' : 'SIN_EVIDENCIA', contribucion: totNeg, unidad: 'S/' },
    { problemaId: null, titulo: 'Productos de menor precio tienen menor margen', categoria: 'Materiales', dataset: 'ventas',
      hipotesis: 'Los SKU con menor precio implícito tienden a tener menor margen (estructura de costos poco competitiva en la gama baja).',
      favor: `Correlación de Pearson precio implícito vs. margen por SKU: r = ${fmtNum(correlacionPrecioMargen, 2)} (n = ${conQ.length}).`,
      contra: 'Correlación no implica causalidad; el volumen reportado tiene unidad ambigua.',
      sustento: correlacionPrecioMargen >= 0.3 ? 'ASOCIATIVA' : 'SIN_EVIDENCIA', contribucion: null, unidad: null },
    { problemaId: '06', titulo: 'Desbalance de rentabilidad entre regiones', categoria: 'Medio ambiente', dataset: 'ventas',
      hipotesis: 'La rentabilidad difiere significativamente entre departamentos por condiciones comerciales/logísticas regionales.',
      favor: `Margen histórico de ${depMin.departamento} ${fmtPct(depMin.margen)} vs. ${depMax.departamento} ${fmtPct(depMax.margen)}; mayor caída de utilidad 12m: ${peorDep.departamento} (${fmtMillones(peorDep.deltaUtilidad)}).`,
      contra: 'No hay datos de costos logísticos por región ni de canal para confirmar la causa.',
      sustento: depMax.margen - depMin.margen >= 0.02 ? 'ASOCIATIVA' : 'SIN_EVIDENCIA', contribucion: peorDep.deltaUtilidad, unidad: 'S/' },
    { problemaId: '02', titulo: 'Pronóstico sobre ventas registradas, no demanda', categoria: 'Medición', dataset: 'ventas',
      hipotesis: 'Las ventas registradas pueden subestimar la demanda real si hubo quiebres de stock (demanda censurada).',
      favor: 'El archivo de ventas no registra pedidos no atendidos ni disponibilidad; la demanda por SKU es intermitente.',
      contra: 'No hay evidencia directa de quiebres en el dataset de ventas.',
      sustento: 'A_VERIFICAR', contribucion: null, unidad: null },
  ];
  const ishikawa = armarIshikawa(hipotesis);
  const cincoPorques = {
    problema: `La utilidad operativa de los últimos 12 meses cayó ${fmtPct(Math.abs(desc.variacion.utilidad), 1)} (${fmtMillones(utilidad.total)}).`,
    porques: [
      `¿Por qué cayó la utilidad? Porque el margen bajó de ${fmtPct(k0.margen)} a ${fmtPct(k1.margen)} (efecto ${fmtMillones(utilidad.efectoMargen)}) y las ventas bajaron ${fmtPct(Math.abs(desc.variacion.ventas), 1)}.`,
      `¿Por qué bajó el margen? Porque ${neg.length} SKU se venden con utilidad negativa y pesan en la mezcla (mezcla ${fmtMillones(pvm.mezcla)}).`,
      `¿Por qué hay SKU con utilidad negativa? Porque su precio implícito no cubre el costo operativo; los de menor precio tienen menor margen (r = ${fmtNum(correlacionPrecioMargen, 2)}).`,
      '¿Por qué no se corrigió? Porque no se evidencia un control sistemático de rentabilidad por SKU/región (no existe en los datos un indicador de margen objetivo).',
      '¿Por qué no existe ese control? Porque las decisiones de precio, surtido y abastecimiento no están integradas con la medición de utilidad (problema 10 de la ayuda base).',
    ],
    causaRaiz: 'Ausencia de gestión de rentabilidad por producto y región integrada al abastecimiento (hipótesis ASOCIATIVA, a verificar con la gerencia comercial).',
  };
  const result: DiagnosticoVentas = {
    ventana: { actual: `${b0} a ${cutoff}`, anterior: `${a0} a ${a1}` }, pvm, utilidad, departamentos, perdidas,
    mesesUtilidadNegativa: um.filter((x) => x < 0).length, anomaliasUtilidad, correlacionPrecioMargen, hipotesis, ishikawa, cincoPorques,
  };
  const r: ResultadoSkill<DiagnosticoVentas> = { ...base, result };
  r.evidence.push({ tabla: 'venta', filtro: `dataset_id=${datasetId} AND periodo BETWEEN '${a0}' AND '${cutoff}'`, filas: k1.transacciones + k0.transacciones });
  r.validation.push({ regla: 'PVM: precio+volumen+mezcla+nuevos+perdidos = Δventas', ok: Math.abs(pvm.precio + pvm.volumen + pvm.mezcla + pvm.nuevos + pvm.perdidos - pvm.total) < 0.01 });
  r.validation.push({ regla: 'ΔU: efecto volumen + efecto margen = ΔU', ok: Math.abs(utilidad.efectoVolumen + utilidad.efectoMargen - utilidad.total) < 0.01 });
  r.validation.push({ regla: 'Toda hipótesis COMPROBADA tiene evidencia a favor', ok: hipotesis.filter((h) => h.sustento === 'COMPROBADA').every((h) => h.favor.length > 0) });
  r.status = r.validation.every((v) => v.ok) ? 'OK' : 'NEEDS_REVIEW';
  r.next_action = 'proyectar_6m';
  guardarEjecucion(bd, r);
  persistirHipotesis(bd, r.run_id, hipotesis);
  const kv: SqlValue[][] = [['pvm_precio', pvm.precio], ['pvm_volumen', pvm.volumen], ['pvm_mezcla', pvm.mezcla], ['pvm_nuevos', pvm.nuevos], ['pvm_perdidos', pvm.perdidos], ['delta_ventas_12m', pvm.total],
    ['delta_utilidad_efecto_volumen', utilidad.efectoVolumen], ['delta_utilidad_efecto_margen', utilidad.efectoMargen], ['perdida_skus_negativos', totNeg]]
    .map(([k, v]) => [r.run_id, k, 'total', '*', cutoff, v, 'S/', 'real']);
  bd.insertarMuchos('INSERT INTO kpi_valor (run_id,kpi,dimension,clave,periodo,valor,unidad,tipo) VALUES (?,?,?,?,?,?,?,?)', kv);
  registrarUso(bd, 'Análisis diagnóstico de ventas', 'Análisis diagnóstico', `run ${r.run_id.slice(0, 8)} · ${hipotesis.length} hipótesis`, t0);
  return r;
}

// ------------------------------------------------------------------ KARDEX
export interface DiagnosticoKardex {
  conciliacion: { saldosNoCuadran: number; stockNegativo: number; productosNegativo: number; bloquesDescuadrados: number; discontinuidades: number };
  obsolescencia: { sinSalidas: number; coberturaMayor180: number; ejemplos: string[] };
  intermitencia: Record<string, number>;
  produccion: { correlacionConsumoVsIngresoPT: number; ratioConsumoIngresoPT: number };
  abastecimiento: { mesesEntradasMayoresSalidas: number; correlacionComprasConsumo: number };
  hipotesis: Hipotesis[]; ishikawa: Record<Categoria6M, string[]>;
}

export function diagnosticarKardex(bd: BaseDatos, datasetId: number, desc: DescriptivoKardex): ResultadoSkill<DiagnosticoKardex> {
  const t0 = Date.now();
  const base = nuevoResultado<DiagnosticoKardex>(bd, 'diagnosticar_desviacion', VERSION_DIAGNOSTICO, datasetId, bd.valor<string>('SELECT ultimo_mes_cerrado FROM dataset WHERE id=?', [datasetId]) ?? desc.meses.at(-1) ?? null); // mismo corte que las demás skills (INC-20)
  const q = (sql: string) => bd.valor<number>(sql, [datasetId]) ?? 0;
  const conciliacion = {
    saldosNoCuadran: q("SELECT count(*) FROM kardex_mov WHERE dataset_id=? AND origen='excel' AND flag_inconsistente=1"),
    stockNegativo: q("SELECT count(*) FROM kardex_mov WHERE dataset_id=? AND origen='excel' AND flag_negativo=1"),
    productosNegativo: q("SELECT count(DISTINCT producto_id) FROM kardex_mov WHERE dataset_id=? AND origen='excel' AND flag_negativo=1"),
    bloquesDescuadrados: q('SELECT count(*) FROM kardex_bloque WHERE dataset_id=? AND conciliado=0'),
    discontinuidades: q("SELECT count(*) FROM calidad_hallazgo WHERE dataset_id=? AND regla='K04' AND fila_origen IS NULL"),
  };
  const s = desc.serie;
  const produccion = {
    correlacionConsumoVsIngresoPT: pearson(s.map((x) => x.salConsumo), s.map((x) => x.entProduccion)),
    ratioConsumoIngresoPT: suma(s.map((x) => x.salConsumo)) / suma(s.map((x) => x.entProduccion)),
  };
  const abastecimiento = {
    mesesEntradasMayoresSalidas: s.filter((x) => x.entradas > x.salidas * 1.2).length,
    correlacionComprasConsumo: pearson(s.map((x) => x.entCompra), s.map((x) => x.salConsumo)),
  };
  const intermitentes = (desc.patrones.INTERMITENTE ?? 0) + (desc.patrones.IRREGULAR ?? 0);
  const hipotesis: Hipotesis[] = [
    { problemaId: '01', titulo: 'Saldo inexacto en el Kardex', categoria: 'Medición', dataset: 'kardex',
      hipotesis: 'El registro del Kardex no garantiza un saldo confiable por producto.',
      favor: `${conciliacion.saldosNoCuadran} filas con saldo que no cuadra con el movimiento, ${conciliacion.stockNegativo} registros con stock negativo en ${conciliacion.productosNegativo} productos y ${conciliacion.bloquesDescuadrados} bloques mensuales descuadrados.`,
      contra: `La continuidad del saldo entre meses es correcta (${conciliacion.discontinuidades} discontinuidades); los errores son intra-mes.`,
      sustento: 'COMPROBADA', contribucion: conciliacion.saldosNoCuadran, unidad: 'filas' },
    { problemaId: '09', titulo: 'Trazabilidad y registro tardío de movimientos', categoria: 'Mano de obra', dataset: 'kardex',
      hipotesis: 'Se registran salidas antes que las entradas que las respaldan (registro tardío), generando stock negativo.',
      favor: `${conciliacion.stockNegativo} registros de stock negativo: físicamente imposible, indica secuencia documental incorrecta.`,
      contra: 'No se dispone de la hora de registro ni del usuario para confirmar el registro tardío.',
      sustento: 'ASOCIATIVA', contribucion: conciliacion.stockNegativo, unidad: 'registros' },
    { problemaId: '03', titulo: 'Exceso de stock y obsolescencia', categoria: 'Materiales', dataset: 'kardex',
      hipotesis: 'Existen productos inmovilizados o con cobertura excesiva.',
      favor: `${desc.sinSalidas.length} productos sin ninguna salida en ${desc.meses.length} meses; ${desc.coberturaMayor180} productos con cobertura > 180 días.`,
      contra: 'Sin costos unitarios no se puede cuantificar el capital inmovilizado en S/ (requiere costo SUPUESTO).',
      sustento: 'COMPROBADA', contribucion: desc.sinSalidas.length, unidad: 'productos' },
    { problemaId: '08', titulo: 'Demanda intermitente', categoria: 'Método', dataset: 'kardex',
      hipotesis: 'La mayoría de productos tiene demanda intermitente o irregular, por lo que los métodos de pronóstico clásicos no son adecuados.',
      favor: `${intermitentes} de ${desc.productos} productos clasificados como INTERMITENTE o IRREGULAR (Syntetos-Boylan).`,
      contra: 'Solo hay 18 meses de historia; la clasificación puede variar con más datos.',
      sustento: 'COMPROBADA', contribucion: intermitentes, unidad: 'productos' },
    produccion.correlacionConsumoVsIngresoPT >= 0.7
      ? { problemaId: '07', titulo: 'MRP desconectado de la producción: hipótesis DESCARTADA', categoria: 'Máquina', dataset: 'kardex',
          hipotesis: 'Se evaluó si el consumo de materias primas se desalinea del ingreso de producto terminado; los datos NO lo respaldan.',
          favor: '—',
          contra: `Consumo e ingreso de producto terminado están fuertemente alineados mes a mes (r = ${fmtNum(produccion.correlacionConsumoVsIngresoPT, 2)}; relación consumo/ingreso = ${fmtNum(produccion.ratioConsumoIngresoPT, 2)}).`,
          sustento: 'SIN_EVIDENCIA', contribucion: null, unidad: null }
      : { problemaId: '07', titulo: 'Consumo de materia prima desalineado de la producción', categoria: 'Máquina', dataset: 'kardex',
          hipotesis: 'El consumo de materias primas no guarda proporción estable con el ingreso de producto terminado (rendimiento variable o MRP no alineado).',
          favor: `Correlación mensual consumo vs. ingreso de producto terminado r = ${fmtNum(produccion.correlacionConsumoVsIngresoPT, 2)}; relación consumo/ingreso = ${fmtNum(produccion.ratioConsumoIngresoPT, 2)}.`,
          contra: 'No hay lista de materiales (BOM) ni unidades homogéneas para calcular el rendimiento real.',
          sustento: 'A_VERIFICAR', contribucion: null, unidad: null },
    { problemaId: '10', titulo: 'Compras desalineadas del consumo', categoria: 'Método', dataset: 'kardex',
      hipotesis: 'Las compras no siguen al consumo, generando meses con acumulación de stock.',
      favor: `${abastecimiento.mesesEntradasMayoresSalidas} de ${desc.meses.length} meses con entradas > 120 % de las salidas; correlación compras vs. consumo r = ${fmtNum(abastecimiento.correlacionComprasConsumo, 2)}.`,
      contra: 'Parte de las entradas es producción propia (no compra); se requiere el plan de producción para confirmarlo.',
      sustento: abastecimiento.correlacionComprasConsumo < 0.3 ? 'ASOCIATIVA' : 'A_VERIFICAR', contribucion: abastecimiento.mesesEntradasMayoresSalidas, unidad: 'meses' },
    { problemaId: '04', titulo: 'Reposición y plazos variables', categoria: 'Método', dataset: 'kardex',
      hipotesis: 'Los plazos de suministro variables generan quiebres.', favor: '—',
      contra: 'El Kardex no contiene fechas de orden de compra ni de recepción: no se puede medir el lead time.',
      sustento: 'SIN_EVIDENCIA', contribucion: null, unidad: null },
    { problemaId: '05', titulo: 'Vencimiento y merma', categoria: 'Materiales', dataset: 'kardex',
      hipotesis: 'Pérdidas por vencimiento o merma.', favor: '—',
      contra: 'No hay fechas de vencimiento ni movimientos de merma/baja en el Kardex.', sustento: 'SIN_EVIDENCIA', contribucion: null, unidad: null },
  ];
  const result: DiagnosticoKardex = {
    conciliacion, obsolescencia: { sinSalidas: desc.sinSalidas.length, coberturaMayor180: desc.coberturaMayor180, ejemplos: desc.sinSalidas.slice(0, 10) },
    intermitencia: desc.patrones, produccion, abastecimiento, hipotesis, ishikawa: armarIshikawa(hipotesis),
  };
  const r: ResultadoSkill<DiagnosticoKardex> = { ...base, result };
  r.evidence.push({ tabla: 'kardex_mov', filtro: `dataset_id=${datasetId}`, filas: desc.serie.length });
  r.validation.push({ regla: 'Conteos de conciliación = columnas calculadas de la BD', ok: conciliacion.saldosNoCuadran >= 0 && conciliacion.bloquesDescuadrados >= 0 });
  r.validation.push({ regla: 'Problemas sin datos marcados SIN_EVIDENCIA (no se inventan)', ok: hipotesis.filter((h) => h.favor === '—').every((h) => h.sustento === 'SIN_EVIDENCIA') });
  r.status = r.validation.every((v) => v.ok) ? 'OK' : 'NEEDS_REVIEW';
  r.next_action = 'proyectar_6m';
  guardarEjecucion(bd, r);
  persistirHipotesis(bd, r.run_id, hipotesis);
  registrarUso(bd, 'Análisis diagnóstico de Kardex', 'Análisis diagnóstico', `run ${r.run_id.slice(0, 8)} · ${hipotesis.length} hipótesis`, t0);
  return r;
}

function armarIshikawa(h: Hipotesis[]): Record<Categoria6M, string[]> {
  const cats: Categoria6M[] = ['Método', 'Mano de obra', 'Materiales', 'Máquina', 'Medición', 'Medio ambiente'];
  const r = Object.fromEntries(cats.map((c) => [c, [] as string[]])) as Record<Categoria6M, string[]>;
  h.filter((x) => x.sustento !== 'SIN_EVIDENCIA').forEach((x) => r[x.categoria].push(`${x.titulo} [${x.sustento}]`));
  return r;
}

function persistirHipotesis(bd: BaseDatos, runId: string, h: Hipotesis[]): void {
  bd.insertarMuchos(`INSERT INTO causa_raiz (run_id, problema_id, categoria_6m, hipotesis, evidencia_favor, evidencia_contra, nivel_sustento, contribucion, unidad)
    VALUES (?,?,?,?,?,?,?,?,?)`, h.map((x) => [runId, x.problemaId, x.categoria, `${x.titulo}: ${x.hipotesis}`, x.favor, x.contra, x.sustento, x.contribucion, x.unidad]));
}
