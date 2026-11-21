/**
 * Skill "proyectar_6m" — Análisis PREDICTIVO (¿qué pasará?) con horizonte de 6 meses.
 * Para cada serie: validación con origen móvil → selección por MASE → ajuste final → 10 000 trayectorias bootstrap →
 * P2,5 / P10 / P50 / P90 / P97,5 por mes y del total de 6 meses → calibración empírica (cobertura del intervalo del 80 %).
 * Ventas: total (soles, utilidad, volumen) + 9 departamentos. Kardex: demanda (salidas) por producto + total.
 */
import type { SqlValue } from 'sql.js';
import type { BaseDatos } from '../db/db';
import { guardarEjecucion, mesMas, nuevoResultado, rangoMeses, type ResultadoSkill } from './contrato';
import { MODELOS_CONTINUOS, MODELOS_INTERMITENTES, type Modelo } from './pronostico/modelos';
import { evaluar, origenes, seleccionar, type EvalModelo } from './pronostico/backtest';
import { simular, pinball, type Bandas } from './pronostico/simulacion';
import { mulberry32 } from './pronostico/prng';
import { syntetosBoylan } from './clasificacion';
import { registrarUso } from '../bitacora';

export const VERSION_PREDICTIVO = 'proyectar_6m@1.0.0';
export const H = 6;

export interface ProyeccionSerie {
  serie: string; nivel: string; clave: string; unidad: string;
  historia: { periodo: string; valor: number }[];
  horizonte: string[];
  modelo: string; params: Record<string, number>;
  evaluacion: EvalModelo[];            // todos los candidatos
  mejorQueNaive: boolean;
  porMes: Bandas[]; total: Bandas;
  calibracion: { cobertura80: number; n: number; pinballP10: number; pinballP90: number; factor: number; coberturaAntes: number };
}

export interface OpcionesPred { semilla?: number; trayectorias?: number; maxOrigenes?: number }

/** Proyecta una serie mensual completa con selección automática de modelo. */
export function proyectarSerie(y: number[], periodos: string[], modelos: Modelo[], meta: { serie: string; nivel: string; clave: string; unidad: string },
  op: Required<OpcionesPred>, noNegativo: boolean, rand: () => number, calibrar = true): ProyeccionSerie {
  const ev = evaluar(modelos, y, H, op.maxOrigenes, noNegativo);
  const mejor = seleccionar(ev);
  const m = modelos.find((x) => x.nombre === mejor.modelo)!;
  const aj = m.ajustar(y)!;
  // Calibración: cobertura empírica del intervalo P10–P90 del modelo elegido, re-simulado en cada origen del backtest.
  // Si queda por debajo de 75 % (y hay n ≥ 20 casos), se amplían los residuos con el menor factor k ∈ {1,2…3,0}
  // que alcanza ≥ 78 % (calibración empírica tipo conformal; la cobertura resultante es optimista por usar el mismo backtest).
  const minEnt = Math.max(...modelos.map((x) => x.minObs), 6);
  const ajustesBT = origenes(y.length, H, op.maxOrigenes + H - 1, minEnt).map((k) => ({ k, a: m.ajustar(y.slice(0, k)) })).filter((x) => x.a);
  const cobertura = (escala: number, N: number) => {
    let dentro = 0, n = 0, pb10 = 0, pb90 = 0;
    for (const { k, a } of ajustesBT) {
      const s = simular(a!, H, N, rand, noNegativo, false, escala);
      for (let h = 1; h <= H && k + h - 1 < y.length; h++) {
        const obs = y[k + h - 1], b = s.porMes[h - 1];
        if (obs >= b.p10 && obs <= b.p90) dentro++;
        pb10 += pinball(obs, b.p10, 0.1); pb90 += pinball(obs, b.p90, 0.9); n++;
      }
    }
    return { cobertura80: n ? dentro / n : NaN, n, pinballP10: n ? pb10 / n : NaN, pinballP90: n ? pb90 / n : NaN };
  };
  let cal = cobertura(1, 500);
  const antes = cal.cobertura80;
  let factor = 1;
  if (calibrar && cal.n >= 20 && cal.cobertura80 < 0.75) {
    for (let k = 1.2; k <= 3.0 + 1e-9; k += 0.2) {
      const c = cobertura(k, 300);
      factor = Math.round(k * 10) / 10; cal = c;
      if (c.cobertura80 >= 0.78) break;
    }
  }
  const sim = simular(aj, H, op.trayectorias, rand, noNegativo, false, factor);
  const naive = ev.find((e) => e.modelo === 'Naive');
  const cutoff = periodos.at(-1)!;
  return {
    ...meta, historia: y.map((v, i) => ({ periodo: periodos[i], valor: v })), horizonte: rangoMeses(mesMas(cutoff, 1), mesMas(cutoff, H)),
    modelo: aj.modelo, params: aj.params, evaluacion: ev, mejorQueNaive: !naive || mejor.maseProm <= naive.maseProm + 1e-9,
    porMes: sim.porMes, total: sim.total,
    calibracion: { ...cal, factor, coberturaAntes: antes },
  };
}

// ------------------------------------------------------------------ VENTAS
export interface PredictivoVentas {
  cutoff: string; horizonte: string[]; semilla: number; trayectorias: number;
  series: ProyeccionSerie[];
  probabilidades: { utilidad6mNegativa: number; ventas6mMenorQueUltimos6m: number };
}

const OPD: Required<OpcionesPred> = { semilla: 24092026, trayectorias: 10000, maxOrigenes: 12 };

export function proyectarVentas(bd: BaseDatos, datasetId: number, opciones: OpcionesPred = {}): ResultadoSkill<PredictivoVentas> {
  const t0 = Date.now();
  const op = { ...OPD, ...opciones };
  const cutoff = bd.valor<string>('SELECT ultimo_mes_cerrado FROM dataset WHERE id=?', [datasetId]);
  const base = nuevoResultado<PredictivoVentas>(bd, 'proyectar_6m', VERSION_PREDICTIVO, datasetId, cutoff);
  const desde = bd.valor<string>('SELECT min(periodo) FROM venta WHERE dataset_id=?', [datasetId]);
  const meses = rangoMeses(desde, cutoff);
  const rand = mulberry32(op.semilla);
  const serieDe = (col: string, filtro = '', params: SqlValue[] = []) => {
    const m = new Map(bd.todas<{ p: string; v: number }>(`SELECT periodo p, sum(${col}) v FROM venta WHERE dataset_id=? AND periodo<=? ${filtro} GROUP BY periodo`, [datasetId, cutoff, ...params]).map((r) => [r.p, r.v]));
    return meses.map((p) => m.get(p) ?? 0);
  };
  const series: ProyeccionSerie[] = [];
  series.push(proyectarSerie(serieDe('soles'), meses, MODELOS_CONTINUOS, { serie: 'ventas_soles', nivel: 'total', clave: '*', unidad: 'S/' }, op, true, rand));
  series.push(proyectarSerie(serieDe('utilidad'), meses, MODELOS_CONTINUOS, { serie: 'utilidad', nivel: 'total', clave: '*', unidad: 'S/' }, op, false, rand));
  series.push(proyectarSerie(serieDe('volumen'), meses, MODELOS_CONTINUOS, { serie: 'volumen', nivel: 'total', clave: '*', unidad: 'vol.' }, op, true, rand));
  for (const d of bd.todas<{ d: string }>('SELECT DISTINCT departamento d FROM venta WHERE dataset_id=? AND departamento IS NOT NULL ORDER BY 1', [datasetId])) {
    series.push(proyectarSerie(serieDe('soles', 'AND departamento=?', [d.d]), meses, MODELOS_CONTINUOS, { serie: 'ventas_soles', nivel: 'departamento', clave: d.d, unidad: 'S/' }, { ...op, trayectorias: 2000 }, true, rand));
  }
  // Probabilidades a partir de trayectorias (se re-simulan conservando la matriz del total de utilidad y ventas)
  const pNeg = probabilidad(serieDe('utilidad'), (s) => s < 0, op, rand);
  const ult6 = serieDe('soles').slice(-6).reduce((a, b) => a + b, 0);
  const pMenor = probabilidad(serieDe('soles'), (s) => s < ult6, op, rand, true);
  const result: PredictivoVentas = { cutoff, horizonte: series[0].horizonte, semilla: op.semilla, trayectorias: op.trayectorias, series,
    probabilidades: { utilidad6mNegativa: pNeg, ventas6mMenorQueUltimos6m: pMenor } };
  return cerrarPred(bd, base, result, series, t0, 'ventas');
}

function probabilidad(y: number[], cond: (total6: number) => boolean, op: Required<OpcionesPred>, rand: () => number, noNeg = false): number {
  const ev = evaluar(MODELOS_CONTINUOS, y, H, op.maxOrigenes, noNeg);
  const m = MODELOS_CONTINUOS.find((x) => x.nombre === seleccionar(ev).modelo)!;
  const s = simular(m.ajustar(y)!, H, op.trayectorias, rand, noNeg, true);
  let c = 0;
  for (let i = 0; i < op.trayectorias; i++) { let t = 0; for (let h = 0; h < H; h++) t += s.matriz![h][i]; if (cond(t)) c++; }
  return c / op.trayectorias;
}

// ------------------------------------------------------------------ KARDEX
export interface PredictivoKardex {
  cutoff: string; horizonte: string[]; semilla: number; trayectorias: number;
  total: ProyeccionSerie;
  productos: { codigo: string; pid: number; patron: string; modelo: string; mase: number; mejorQueNaive: boolean; porMes: Bandas[]; total: Bandas; demandaMediaHist: number }[];
  modelosElegidos: Record<string, number>;
}

export function proyectarKardex(bd: BaseDatos, datasetId: number, opciones: OpcionesPred = {}): ResultadoSkill<PredictivoKardex> {
  const t0 = Date.now();
  const op = { ...OPD, ...opciones };
  const ds = bd.una<{ fecha_min: string; ultimo_mes_cerrado: string }>('SELECT fecha_min, ultimo_mes_cerrado FROM dataset WHERE id=?', [datasetId])!;
  const cutoff = ds.ultimo_mes_cerrado;
  const base = nuevoResultado<PredictivoKardex>(bd, 'proyectar_6m', VERSION_PREDICTIVO, datasetId, cutoff);
  const meses = rangoMeses(ds.fecha_min.slice(0, 7), cutoff);
  const idx = new Map(meses.map((m, i) => [m, i]));
  const rand = mulberry32(op.semilla);
  const prods = bd.todas<{ pid: number; codigo: string }>('SELECT id pid, codigo FROM producto WHERE dataset_id=? ORDER BY codigo', [datasetId]);
  const matriz = new Map(prods.map((p) => [p.pid, new Array(meses.length).fill(0)]));
  for (const r of bd.todas<{ pid: number; p: string; s: number }>("SELECT producto_id pid, periodo p, sum(salida) s FROM kardex_mov WHERE dataset_id=? AND origen='excel' AND periodo<=? GROUP BY 1,2", [datasetId, cutoff])) {
    matriz.get(r.pid)![idx.get(r.p)!] = r.s ?? 0;
  }
  const totalSerie = meses.map((_, i) => prods.reduce((s, p) => s + matriz.get(p.pid)![i], 0));
  const total = proyectarSerie(totalSerie, meses, MODELOS_INTERMITENTES, { serie: 'demanda_kardex', nivel: 'total', clave: '*', unidad: 'unid.' }, op, true, rand);
  const productos: PredictivoKardex['productos'] = [];
  for (const p of prods) {
    const y = matriz.get(p.pid)!;
    const sb = syntetosBoylan(y);
    if (sb.patron === 'SIN_DEMANDA') {
      const cero = { p025: 0, p10: 0, p50: 0, p90: 0, p975: 0, media: 0 };
      productos.push({ codigo: p.codigo, pid: p.pid, patron: sb.patron, modelo: 'Sin demanda (pronóstico 0)', mase: NaN, mejorQueNaive: true, porMes: Array(H).fill(cero), total: cero, demandaMediaHist: 0 });
      continue;
    }
    const pr = proyectarSerie(y, meses, MODELOS_INTERMITENTES, { serie: 'demanda_kardex', nivel: 'producto', clave: p.codigo, unidad: 'unid.' }, { ...op, trayectorias: 1000, maxOrigenes: 6 }, true, rand, false);
    productos.push({ codigo: p.codigo, pid: p.pid, patron: sb.patron, modelo: pr.modelo, mase: pr.evaluacion.find((e) => e.modelo === pr.modelo)!.maseProm, mejorQueNaive: pr.mejorQueNaive,
      porMes: pr.porMes, total: pr.total, demandaMediaHist: y.reduce((a, b) => a + b, 0) / y.length });
  }
  const modelosElegidos: Record<string, number> = {};
  productos.forEach((p) => (modelosElegidos[p.modelo] = (modelosElegidos[p.modelo] ?? 0) + 1));
  const result: PredictivoKardex = { cutoff, horizonte: total.horizonte, semilla: op.semilla, trayectorias: op.trayectorias, total, productos, modelosElegidos };
  const r = cerrarPred(bd, base, result, [total], t0, 'kardex');
  bd.insertarMuchos(`INSERT INTO pronostico (run_id, serie, nivel, clave, periodo, h, modelo, p025, p10, p50, p90, p975, media) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    productos.flatMap((p) => p.porMes.map((b, i) => [r.run_id, 'demanda_kardex', 'producto', p.codigo, result.horizonte[i], i + 1, p.modelo, b.p025, b.p10, b.p50, b.p90, b.p975, b.media])));
  return r;
}

// ------------------------------------------------------------------ persistencia común
function cerrarPred<T>(bd: BaseDatos, base: Omit<ResultadoSkill<T>, 'result'>, result: T, series: ProyeccionSerie[], t0: number, tipo: string): ResultadoSkill<T> {
  const r: ResultadoSkill<T> = { ...base, result };
  r.assumptions.push({ clave: 'residuos', valor: 'Intervalos por bootstrap de residuos un paso adelante (supone residuos intercambiables); no incluyen cambios de régimen', es_supuesto: true });
  r.assumptions.push({ clave: 'semilla', valor: String((result as { semilla: number }).semilla), es_supuesto: true });
  for (const s of series) {
    const ordenOk = s.porMes.every((b) => b.p025 <= b.p10 + 1e-9 && b.p10 <= b.p50 + 1e-9 && b.p50 <= b.p90 + 1e-9 && b.p90 <= b.p975 + 1e-9);
    r.validation.push({ regla: `Cuantiles ordenados (${s.serie}/${s.clave})`, ok: ordenOk });
    if (!s.mejorQueNaive) r.warnings.push(`${s.serie}/${s.clave}: ningún modelo supera al Naive; se usa ${s.modelo}.`);
    if (s.calibracion.factor > 1) r.assumptions.push({ clave: `calibracion_${s.serie}_${s.clave}`, valor: `Intervalo calibrado ×${s.calibracion.factor} (cobertura en backtest ${(s.calibracion.coberturaAntes * 100).toFixed(0)} % → ${(s.calibracion.cobertura80 * 100).toFixed(0)} %, n = ${s.calibracion.n})`, es_supuesto: true });
    if (s.historia.length < 36) r.warnings.push(`${s.serie}/${s.clave}: historia corta (${s.historia.length} meses); bandas provisionales${s.calibracion.factor > 1 ? ` (calibradas ×${s.calibracion.factor})` : ''}.`);
    else if (isFinite(s.calibracion.cobertura80) && (s.calibracion.cobertura80 < 0.6 || s.calibracion.cobertura80 > 0.97))
      r.warnings.push(`${s.serie}/${s.clave}: cobertura empírica del intervalo 80 % = ${(s.calibracion.cobertura80 * 100).toFixed(0)} % (n = ${s.calibracion.n}); interpretar las bandas con cautela.`);
  }
  r.status = !r.validation.every((v) => v.ok) ? 'NEEDS_REVIEW' : r.warnings.length ? 'PROVISIONAL' : 'OK';
  r.next_action = 'optimizar_plan';
  guardarEjecucion(bd, r);
  const filas: SqlValue[][] = [], bt: SqlValue[][] = [], kv: SqlValue[][] = [];
  for (const s of series) {
    s.porMes.forEach((b, i) => filas.push([r.run_id, s.serie, s.nivel, s.clave, s.horizonte[i], i + 1, s.modelo, b.p025, b.p10, b.p50, b.p90, b.p975, b.media]));
    for (const e of s.evaluacion) for (const m of e.porH)
      bt.push([r.run_id, s.serie, s.nivel, s.clave, e.modelo, m.h, m.mae, m.rmse, isFinite(m.wape) ? m.wape : null, m.mase,
        e.modelo === s.modelo ? s.calibracion.pinballP10 : null, e.modelo === s.modelo ? s.calibracion.pinballP90 : null, e.modelo === s.modelo ? s.calibracion.cobertura80 : null, m.sesgo, e.modelo === s.modelo ? 1 : 0]);
    if (s.nivel === 'total') for (const [q, v] of [['p10', s.total.p10], ['p50', s.total.p50], ['p90', s.total.p90]] as const)
      kv.push([r.run_id, `${s.serie}_6m_${q}`, 'total', '*', s.horizonte.join('..'), v, s.unidad, 'proyectado']);
  }
  bd.insertarMuchos('INSERT INTO pronostico (run_id, serie, nivel, clave, periodo, h, modelo, p025, p10, p50, p90, p975, media) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', filas);
  bd.insertarMuchos(`INSERT INTO backtest (run_id, serie, nivel, clave, modelo, h, mae, rmse, wape, mase, pinball_p10, pinball_p90, cobertura80, sesgo, seleccionado)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, bt);
  bd.insertarMuchos('INSERT INTO kpi_valor (run_id,kpi,dimension,clave,periodo,valor,unidad,tipo) VALUES (?,?,?,?,?,?,?,?)', kv);
  registrarUso(bd, `Análisis predictivo (${tipo}) a 6 meses`, 'Análisis predictivo', `run ${r.run_id.slice(0, 8)} · ${series.length} series · estado ${r.status}`, t0);
  return r;
}
