/**
 * Skill "optimizar_plan" — Análisis PRESCRIPTIVO (¿qué debemos hacer?).
 * Fórmulas (Manual Descriptivo; ayuda base PDF 01 pág. 15):
 *   SS  = z · √(LT·σd² + d̄²·σLT²)       (d en unidades/día; LT en días)
 *   ROP = d̄·LT + SS                       EOQ = √(2·D·S / H),  H = tasa_mantener × costo_unit
 *   Regla de reposición: S = μ(L+R) + z·σ(L+R);  IP = stock utilizable + suministro abierto − comprometido;  Q = máx(0, S − IP) (a múltiplo/MOQ)
 * Plan de compras a 6 meses con restricción de presupuesto: programa lineal tipo mochila fraccionaria
 *   máx Σ prioridad_i·x_i  s.a. Σ c_i·x_i ≤ B, 0 ≤ x_i ≤ necesidad_i   → solución óptima por algoritmo voraz (prioridad/costo).
 * Caso económico sin doble conteo: beneficio RECURRENTE anual y CAJA liberada una sola vez se reportan por separado.
 */
import type { SqlValue } from 'sql.js';
import type { BaseDatos } from '../db/db';
import { guardarEjecucion, nuevoResultado, type ResultadoSkill } from './contrato';
import { desv, media, mediana, suma } from './estadistica';
import type { DescriptivoKardex, DescriptivoVentas } from './descriptivo';
import type { DiagnosticoVentas } from './diagnostico';
import type { PredictivoKardex } from './predictivo';
import { registrarUso } from '../bitacora';
import { fmtMillones, fmtNum, fmtPct } from '../util/util';

export const VERSION_PRESCRIPTIVO = 'optimizar_plan@1.0.0';

/** Parámetros SUPUESTOS por defecto (editables en Configuración; se muestran como supuestos). */
export const PARAMETROS_PRESCRIPTIVO: [string, string, string, string][] = [
  ['lead_time_dias', '15', 'días', 'Plazo de suministro medio (no existe en el Kardex)'],
  ['lead_time_sd_dias', '5', 'días', 'Desviación del plazo de suministro'],
  ['costo_unit_kardex', '1', 'S/ por unid.', 'Costo unitario del Kardex (no existe en el archivo): 1 = valor normalizado; reemplazar por el costo real'],
  ['costo_faltante_unit', '1', 'S/ por unid.', 'Penalidad por unidad no atendida (margen perdido)'],
  ['recuperacion_liquidacion', '0.5', 'fracción', 'Fracción del valor recuperado al liquidar stock sin movimiento'],
  ['costo_operacion_anual', '60000', 'S/ por año', 'Costo anual de operar la solución (personas, TI, soporte)'],
];

export function asegurarParametros(bd: BaseDatos): void {
  for (const [k, v, u, d] of PARAMETROS_PRESCRIPTIVO) bd.run('INSERT OR IGNORE INTO parametro (clave, valor, unidad, es_supuesto, descripcion) VALUES (?,?,?,1,?)', [k, v, u, d]);
}
export function param(bd: BaseDatos, clave: string, def = 0): number {
  const v = bd.valor<string>('SELECT valor FROM parametro WHERE clave=?', [clave]);
  const n = Number(v);
  return v == null || !isFinite(n) ? def : n;
}

/** Inversa de la normal estándar (Acklam, error < 1,15e-9). */
export function normInv(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export const stockSeguridad = (z: number, LT: number, sd: number, d: number, sLT: number) => z * Math.sqrt(LT * sd * sd + d * d * sLT * sLT);
export const eoq = (Danual: number, S: number, H: number) => (H > 0 && Danual > 0 ? Math.sqrt((2 * Danual * S) / H) : 0);

/** Mochila fraccionaria (LP) con presupuesto: devuelve la cantidad asignada a cada ítem. */
export function asignarPresupuesto(items: { id: number; necesidad: number; costo: number; prioridad: number }[], presupuesto: number): Map<number, number> {
  const r = new Map<number, number>();
  if (!(presupuesto > 0)) { items.forEach((i) => r.set(i.id, i.necesidad)); return r; }
  let restante = presupuesto;
  for (const it of [...items].sort((a, b) => b.prioridad / Math.max(b.costo, 1e-12) - a.prioridad / Math.max(a.costo, 1e-12))) {
    const q = it.costo > 0 ? Math.min(it.necesidad, restante / it.costo) : it.necesidad;
    r.set(it.id, q); restante -= q * it.costo;
    if (restante <= 1e-9) restante = 0;
  }
  return r;
}

export interface PoliticaProducto {
  codigo: string; pid: number; clase: string; patron: string; politica: string; nivelServicio: number; z: number;
  demandaMesHist: number; sdMesHist: number; demandaMesPron: number; dDia: number; sdDia: number;
  ss: number; rop: number; eoq: number; sObjetivo: number; stockActual: number; posicionInventario: number; qSugerida: number;
  coberturaDias: number | null; estado: 'QUIEBRE_INMINENTE' | 'REPONER' | 'OK' | 'SOBRESTOCK' | 'SIN_MOVIMIENTO' | 'STOCK_NEGATIVO' | 'BAJO_PEDIDO';
}

export interface Recomendacion {
  problemaId: string | null; titulo: string; evidencia: string; accion: string; responsable: string; plazo: string; kpi: string;
  impacto: { conservador: number | null; central: number | null; favorable: number | null }; tipo: 'RECURRENTE_ANUAL' | 'CAJA_UNA_VEZ' | null; prioridad: number; dataset: 'ventas' | 'kardex';
  unidad: 'S/' | 'unid. equivalentes';
}

export interface Prescriptivo {
  parametros: Record<string, number>;
  politicas: PoliticaProducto[];
  resumenPoliticas: Record<string, number>; resumenEstados: Record<string, number>;
  plan: { codigo: string; pid: number; periodo: string; cantidad: number; costo: number; restriccion: string | null }[];
  planTotal: { unidades: number; costo: number; porMes: { periodo: string; unidades: number; costo: number }[] };
  recomendaciones: Recomendacion[];
  caso: { recurrente: { conservador: number; central: number; favorable: number }; cajaUnaVez: { conservador: number; central: number; favorable: number };
          costoOperacion: number; beneficioNeto: { conservador: number; central: number; favorable: number }; roi: number | null; paybackMeses: number | null };
}

export function optimizarPlan(bd: BaseDatos, kardexId: number | null, dk: DescriptivoKardex | null, pk: PredictivoKardex | null,
  ventasId: number | null, dv: DescriptivoVentas | null, gv: DiagnosticoVentas | null): ResultadoSkill<Prescriptivo> {
  const t0 = Date.now();
  asegurarParametros(bd);
  const base = nuevoResultado<Prescriptivo>(bd, 'optimizar_plan', VERSION_PRESCRIPTIVO, (kardexId ?? ventasId)!, pk?.cutoff ?? dv?.cutoff ?? null);
  const P = {
    LT: param(bd, 'lead_time_dias', 15), sLT: param(bd, 'lead_time_sd_dias', 5), R: param(bd, 'revision_R_dias', 30),
    S: param(bd, 'costo_ordenar', 150), tasa: param(bd, 'tasa_mantener_anual', 0.2), costo: param(bd, 'costo_unit_kardex', 1),
    nsA: param(bd, 'nivel_servicio_A', 0.95), nsB: param(bd, 'nivel_servicio_B', 0.9), nsC: param(bd, 'nivel_servicio_C', 0.85),
    presupuesto: param(bd, 'presupuesto_compras_mensual', 0), recup: param(bd, 'recuperacion_liquidacion', 0.5), operacion: param(bd, 'costo_operacion_anual', 60000),
  };
  const DPM = 30.4375; // días por mes
  const politicas: PoliticaProducto[] = [];
  const plan: Prescriptivo['plan'] = [];
  if (kardexId && dk && pk) {
    const meses = pk.horizonte;
    const hist = new Map<number, number[]>();
    const idx = new Map(dk.meses.map((m, i) => [m, i]));
    for (const r of bd.todas<{ pid: number; p: string; s: number }>("SELECT producto_id pid, periodo p, sum(salida) s FROM kardex_mov WHERE dataset_id=? AND origen='excel' AND periodo<=? GROUP BY 1,2", [kardexId, pk.cutoff])) {
      if (!hist.has(r.pid)) hist.set(r.pid, new Array(dk.meses.filter((m) => m <= pk.cutoff).length).fill(0));
      const i = idx.get(r.p); if (i != null && i < hist.get(r.pid)!.length) hist.get(r.pid)![i] = r.s ?? 0;
    }
    const pron = new Map(pk.productos.map((p) => [p.pid, p]));
    for (const p of dk.porProducto) {
      const y = hist.get(p.pid) ?? [0];
      const f = pron.get(p.pid);
      const dMesHist = media(y), sdMes = desv(y);
      const dMesPron = f ? media(f.porMes.map((b) => b.p50)) : 0;
      const dDia = dMesPron / DPM, sdDia = sdMes / Math.sqrt(DPM);
      const clase = p.abc === '−' ? 'C' : p.abc;
      const ns = clase === 'A' ? P.nsA : clase === 'B' ? P.nsB : P.nsC;
      const z = normInv(ns);
      const ss = stockSeguridad(z, P.LT, sdDia, dDia, P.sLT);
      const rop = dDia * P.LT + ss;
      const q = eoq(dDia * 365, P.S, P.tasa * P.costo);
      const prot = P.LT + P.R;
      const sObj = dDia * prot + z * Math.sqrt(prot * sdDia * sdDia + dDia * dDia * P.sLT * P.sLT);
      const ip = p.stockFinal; // sin órdenes abiertas ni reservas en los datos
      const qS = Math.ceil(Math.max(0, sObj - ip));
      const politica = p.patron === 'SIN_DEMANDA' ? 'REVISAR' : clase === 'A' && (p.patron === 'SUAVE' || p.patron === 'ERRATICA') ? '(s,Q)' : clase === 'C' && p.patron === 'IRREGULAR' ? 'BAJO_PEDIDO' : clase === 'C' ? 'MIN_MAX' : '(R,S)';
      const cob = dDia > 0 ? Math.max(ip, 0) / dDia : null;
      const estado: PoliticaProducto['estado'] = p.patron === 'SIN_DEMANDA' ? 'SIN_MOVIMIENTO' : ip < 0 ? 'STOCK_NEGATIVO' : politica === 'BAJO_PEDIDO' ? 'BAJO_PEDIDO' : ip <= ss ? 'QUIEBRE_INMINENTE' : ip <= rop ? 'REPONER' : cob != null && cob > 180 ? 'SOBRESTOCK' : 'OK';
      politicas.push({ codigo: p.codigo, pid: p.pid, clase, patron: p.patron, politica, nivelServicio: ns, z, demandaMesHist: dMesHist, sdMesHist: sdMes, demandaMesPron: dMesPron,
        dDia, sdDia, ss, rop, eoq: q, sObjetivo: sObj, stockActual: p.stockFinal, posicionInventario: ip, qSugerida: qS, coberturaDias: cob, estado });
    }
    // Plan de compras mensual (revisión periódica R = 1 mes): pedido_t = máx(0, S − IP_t); el plazo (< 1 mes) se recibe dentro del mes.
    const stock = new Map(politicas.map((x) => [x.pid, Math.max(0, x.posicionInventario)]));
    for (let t = 0; t < meses.length; t++) {
      const items = politicas.filter((x) => x.politica !== 'REVISAR').map((x) => {
        const dem = pron.get(x.pid)?.porMes[t]?.p50 ?? 0;
        const necesidad = Math.ceil(Math.max(0, x.sObjetivo - stock.get(x.pid)!));
        const prioridad = (x.clase === 'A' ? 3 : x.clase === 'B' ? 2 : 1) * (x.estado === 'QUIEBRE_INMINENTE' || x.estado === 'STOCK_NEGATIVO' ? 2 : 1);
        return { id: x.pid, necesidad, costo: P.costo, prioridad, dem };
      });
      const asign = asignarPresupuesto(items, P.presupuesto);
      for (const it of items) {
        const q = Math.floor(asign.get(it.id) ?? 0);
        const x = politicas.find((pp) => pp.pid === it.id)!;
        if (q > 0) plan.push({ codigo: x.codigo, pid: x.pid, periodo: meses[t], cantidad: q, costo: q * P.costo, restriccion: q < it.necesidad ? 'PRESUPUESTO' : null });
        stock.set(it.id, Math.max(0, stock.get(it.id)! + q - it.dem));
      }
    }
  }
  const resumenPoliticas: Record<string, number> = {}, resumenEstados: Record<string, number> = {};
  politicas.forEach((x) => { resumenPoliticas[x.politica] = (resumenPoliticas[x.politica] ?? 0) + 1; resumenEstados[x.estado] = (resumenEstados[x.estado] ?? 0) + 1; });
  const porMes = [...new Set(plan.map((x) => x.periodo))].sort().map((m) => ({ periodo: m, unidades: suma(plan.filter((x) => x.periodo === m).map((x) => x.cantidad)), costo: suma(plan.filter((x) => x.periodo === m).map((x) => x.costo)) }));

  // ---------------- Recomendaciones con impacto (rangos, sin doble conteo)
  const rec: Recomendacion[] = [];
  const rango = (base: number, f: [number, number, number]) => ({ conservador: base * f[0], central: base * f[1], favorable: base * f[2] });
  if (dv && gv && ventasId) {
    const perd12 = bd.todas<{ sku: string; u: number }>('SELECT sku, sum(utilidad) u FROM venta WHERE dataset_id=? AND periodo BETWEEN ? AND ? GROUP BY sku HAVING u<0 ORDER BY u LIMIT 20', [ventasId, gv.ventana.actual.slice(0, 7), dv.cutoff]);
    const perdida20 = -suma(perd12.map((x) => x.u));
    rec.push({ unidad: 'S/', problemaId: '10', dataset: 'ventas', titulo: 'Revisar precio y surtido de los 20 SKU con mayor pérdida', prioridad: 1,
      evidencia: `${gv.perdidas.skus} SKU con utilidad acumulada negativa; los 20 con mayor pérdida en los últimos 12 meses suman ${fmtMillones(-perdida20)} de utilidad.`,
      accion: 'Revisar la lista de precios y el costo de servir de cada SKU; subir precio, renegociar costo o descontinuar. Aprobar caso por caso con Comercial y Finanzas. Impacto = recuperar 10 % / 25 % / 40 % de esa pérdida (SUPUESTO conservador/central/favorable).',
      responsable: 'Gerencia Comercial + Finanzas', plazo: '0–3 meses', kpi: 'Utilidad por SKU; % de SKU con margen negativo',
      impacto: rango(perdida20, [0.1, 0.25, 0.4]), tipo: 'RECURRENTE_ANUAL' });
    const deps = dv.departamentos, medM = mediana(deps.map((d) => d.margen));
    const bajos = deps.filter((d) => d.margen < medM);
    const venta12 = new Map(bd.todas<{ d: string; v: number }>('SELECT departamento d, sum(soles) v FROM venta WHERE dataset_id=? AND periodo BETWEEN ? AND ? GROUP BY 1', [ventasId, gv.ventana.actual.slice(0, 7), dv.cutoff]).map((x) => [x.d, x.v]));
    const brecha = suma(bajos.map((d) => (venta12.get(d.departamento) ?? 0) * (medM - d.margen)));
    rec.push({ unidad: 'S/', problemaId: '06', dataset: 'ventas', titulo: `Plan de margen regional (${bajos.map((d) => d.departamento).join(', ')})`, prioridad: 2,
      evidencia: `Margen histórico por debajo de la mediana (${fmtPct(medM)}): ${bajos.map((d) => `${d.departamento} ${fmtPct(d.margen)}`).join(', ')}.`,
      accion: 'Analizar costo de servir por región (flete, descuentos, mezcla); fijar un margen objetivo regional y revisarlo mensualmente.',
      responsable: 'Gerencia Comercial regional', plazo: '1–6 meses', kpi: 'Margen operativo por departamento',
      impacto: rango(brecha, [0.25, 0.5, 0.75]), tipo: 'RECURRENTE_ANUAL' });
    rec.push({ unidad: 'S/', problemaId: '02', dataset: 'ventas', titulo: 'Pronóstico probabilístico y S&OP mensual', prioridad: 4,
      evidencia: `Ventas estables (CV mensual bajo) con pronóstico validado (MASE < Naive); utilidad volátil (${gv.mesesUtilidadNegativa} de ${dv.meses.length} meses con pérdida).`,
      accion: 'Instalar un ciclo S&OP mensual que use P10/P50/P90 del sistema para ventas, utilidad y abastecimiento; registrar demanda no atendida.',
      responsable: 'Planeamiento + Comercial + Operaciones', plazo: '1–3 meses', kpi: 'Sesgo y MASE del pronóstico; cumplimiento del plan', impacto: { conservador: null, central: null, favorable: null }, tipo: null });
  }
  const uKardex: Recomendacion['unidad'] = P.costo === 1 ? 'unid. equivalentes' : 'S/';
  if (politicas.length) {
    const sinMov = politicas.filter((x) => x.estado === 'SIN_MOVIMIENTO' && x.stockActual > 0);
    const valSinMov = suma(sinMov.map((x) => x.stockActual)) * P.costo;
    rec.push({ unidad: uKardex, problemaId: '03', dataset: 'kardex', titulo: 'Liquidar o transferir stock sin movimiento', prioridad: 3,
      evidencia: `${sinMov.length} productos sin salidas en ${dk!.meses.length} meses con ${fmtNum(suma(sinMov.map((x) => x.stockActual)))} unid. en stock.`,
      accion: 'Validar con Producción si son estratégicos; si no, liquidar, transferir o dar de baja. Bloquear compras de esos códigos.',
      responsable: 'Almacén + Planeamiento + Finanzas', plazo: '0–2 meses', kpi: 'Unidades sin movimiento; capital inmovilizado',
      impacto: rango(valSinMov * P.recup, [0.6, 1, 1.4]), tipo: 'CAJA_UNA_VEZ' });
    const exceso = suma(politicas.filter((x) => x.estado === 'SOBRESTOCK').map((x) => Math.max(0, x.stockActual - x.sObjetivo)));
    rec.push({ unidad: uKardex, problemaId: '04', dataset: 'kardex', titulo: 'Implantar políticas de reposición por clase ABC y patrón de demanda', prioridad: 2,
      evidencia: `Políticas calculadas: ${Object.entries(resumenPoliticas).map(([k, v]) => `${k} ${v}`).join(', ')}; ${resumenEstados.SOBRESTOCK ?? 0} productos en sobrestock (${fmtNum(exceso)} unid. sobre el nivel objetivo) y ${(resumenEstados.QUIEBRE_INMINENTE ?? 0) + (resumenEstados.STOCK_NEGATIVO ?? 0)} en riesgo de quiebre.`,
      accion: 'Aplicar SS/ROP/EOQ y S = μ(L+R) + z·σ; reponer con el plan de compras del sistema; recalcular mensualmente.',
      responsable: 'Compras + Planeamiento', plazo: '1–3 meses', kpi: 'Fill rate; días de inventario; quiebres',
      impacto: rango(exceso * P.costo * P.tasa, [0.5, 1, 1.5]), tipo: 'RECURRENTE_ANUAL' });
    const nInc = bd.valor<number>("SELECT count(*) FROM kardex_mov WHERE dataset_id=? AND origen='excel' AND (flag_inconsistente=1 OR flag_negativo=1)", [kardexId!]);
    rec.push({ unidad: uKardex, problemaId: '01', dataset: 'kardex', titulo: 'Conciliación semanal del Kardex y conteo dirigido', prioridad: 1,
      evidencia: `${nInc} movimientos con saldo inconsistente o stock negativo (reglas K01/K02).`,
      accion: 'Cuarentena de movimientos inválidos, corrección documentada y conteos cíclicos priorizados por el sistema.',
      responsable: 'Jefatura de Almacén + Contabilidad', plazo: 'Inmediato', kpi: 'Exactitud de inventario; n.° de inconsistencias', impacto: { conservador: null, central: null, favorable: null }, tipo: null });
  }
  rec.sort((a, b) => a.prioridad - b.prioridad);
  // El caso económico en S/ solo suma impactos expresados en S/ (los del Kardex con costo normalizado quedan en unidades equivalentes)
  const sumT = (tipo: string, k: 'conservador' | 'central' | 'favorable') => suma(rec.filter((x) => x.tipo === tipo && x.unidad === 'S/').map((x) => x.impacto[k] ?? 0));
  const recurrente = { conservador: sumT('RECURRENTE_ANUAL', 'conservador'), central: sumT('RECURRENTE_ANUAL', 'central'), favorable: sumT('RECURRENTE_ANUAL', 'favorable') };
  const cajaUnaVez = { conservador: sumT('CAJA_UNA_VEZ', 'conservador'), central: sumT('CAJA_UNA_VEZ', 'central'), favorable: sumT('CAJA_UNA_VEZ', 'favorable') };
  const beneficioNeto = { conservador: recurrente.conservador - P.operacion, central: recurrente.central - P.operacion, favorable: recurrente.favorable - P.operacion };
  const result: Prescriptivo = {
    parametros: P, politicas, resumenPoliticas, resumenEstados, plan,
    planTotal: { unidades: suma(plan.map((x) => x.cantidad)), costo: suma(plan.map((x) => x.costo)), porMes },
    recomendaciones: rec,
    caso: { recurrente, cajaUnaVez, costoOperacion: P.operacion, beneficioNeto, roi: P.operacion > 0 ? beneficioNeto.central / P.operacion : null,
      paybackMeses: recurrente.central > 0 ? (P.operacion / recurrente.central) * 12 : null },
  };
  const r: ResultadoSkill<Prescriptivo> = { ...base, result };
  for (const [k, , u, d] of PARAMETROS_PRESCRIPTIVO) r.assumptions.push({ clave: k, valor: `${bd.valor<string>('SELECT valor FROM parametro WHERE clave=?', [k])} ${u} — ${d}`, es_supuesto: true });
  r.assumptions.push({ clave: 'ordenes_abiertas', valor: 'IP = stock actual (no hay órdenes abiertas ni reservas en los datos)', es_supuesto: true });
  r.validation.push({ regla: 'Sin cantidades negativas en el plan', ok: plan.every((x) => x.cantidad >= 0) });
  r.validation.push({ regla: 'Presupuesto respetado cada mes', ok: !(P.presupuesto > 0) || porMes.every((m) => m.costo <= P.presupuesto + 1e-6) });
  r.validation.push({ regla: 'SS ≥ 0 y ROP ≥ SS', ok: politicas.every((x) => x.ss >= 0 && x.rop >= x.ss - 1e-9) });
  r.validation.push({ regla: 'Caja una vez separada del beneficio recurrente (sin doble conteo)', ok: rec.every((x) => x.tipo !== null || x.impacto.central === null) });
  if (P.costo === 1) r.warnings.push('Costo unitario del Kardex = 1 (valor normalizado SUPUESTO): los impactos del Kardex se expresan en unidades equivalentes y NO se suman al caso económico en S/; al ingresar el costo real en Configuración se integran automáticamente.');
  r.status = !r.validation.every((v) => v.ok) ? 'NEEDS_REVIEW' : r.warnings.length ? 'PROVISIONAL' : 'OK';
  r.estado_flujo = 'PROPUESTO';
  r.next_action = 'simular_escenarios';
  guardarEjecucion(bd, r);
  bd.insertarMuchos(`INSERT INTO politica_inventario (run_id, producto_id, politica, nivel_servicio, demanda_media, demanda_sd, ss, rop, eoq, s_objetivo, posicion_inventario, q_sugerida)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, politicas.map((x) => [r.run_id, x.pid, x.politica, x.nivelServicio, x.demandaMesPron, x.sdMesHist, x.ss, x.rop, x.eoq, x.sObjetivo, x.posicionInventario, x.qSugerida]));
  bd.insertarMuchos('INSERT INTO plan_compra (run_id, producto_id, periodo, cantidad, costo, restriccion_activa) VALUES (?,?,?,?,?,?)', plan.map((x) => [r.run_id, x.pid, x.periodo, x.cantidad, x.costo, x.restriccion]));
  bd.insertarMuchos(`INSERT INTO recomendacion (run_id, problema_id, titulo, evidencia, accion, responsable, plazo, kpi, impacto_conservador, impacto_central, impacto_favorable, tipo_impacto, prioridad)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, rec.map((x) => [r.run_id, x.problemaId, x.titulo, x.evidencia, x.accion, x.responsable, x.plazo, x.kpi, x.impacto.conservador, x.impacto.central, x.impacto.favorable, x.tipo, x.prioridad] as SqlValue[]));
  const alertas = politicas.filter((x) => x.estado !== 'OK' && x.estado !== 'BAJO_PEDIDO').map((x) => [r.run_id, x.estado, x.estado === 'STOCK_NEGATIVO' || x.estado === 'QUIEBRE_INMINENTE' ? 'ALTA' : 'MEDIA', x.codigo,
    `${x.codigo}: ${x.estado.replace('_', ' ').toLowerCase()} (stock ${fmtNum(x.stockActual)}, ROP ${fmtNum(x.rop)}, SS ${fmtNum(x.ss)})`, r.fin]);
  bd.insertarMuchos('INSERT INTO alerta (run_id, tipo, severidad, entidad, mensaje, creada_en) VALUES (?,?,?,?,?,?)', alertas as SqlValue[][]);
  registrarUso(bd, 'Análisis prescriptivo (políticas, plan de compras, recomendaciones)', 'Análisis prescriptivo', `run ${r.run_id.slice(0, 8)} · ${politicas.length} políticas · ${rec.length} recomendaciones`, t0);
  return r;
}
