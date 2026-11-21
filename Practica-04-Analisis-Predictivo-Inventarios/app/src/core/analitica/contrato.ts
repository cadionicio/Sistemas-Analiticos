/**
 * Contrato transversal de resultado (ayuda base, PDF 02 pág. 15) y su persistencia en la tabla `ejecucion`.
 */
import type { BaseDatos } from '../db/db';
import { ahoraLima, uuid } from '../util/util';

export type Estado = 'OK' | 'PROVISIONAL' | 'NEEDS_REVIEW' | 'BLOCKED';
export type EstadoFlujo = 'RECIBIDO' | 'DATOS_VALIDADOS' | 'ANALIZADO' | 'EVALUADO' | 'PROPUESTO' | 'APROBADO' | 'DATOS_INCOMPLETOS' | 'MODELO_NO_APTO' | 'INVIABLE';
export interface Validacion { regla: string; ok: boolean; detalle?: string }
export interface Supuesto { clave: string; valor: string; es_supuesto: true }

export interface ResultadoSkill<T> {
  run_id: string; skill: string; skill_version: string; cutoff: string | null; dataset_id: number; source_hash: string;
  metric_version: string; status: Estado; estado_flujo: EstadoFlujo; result: T;
  evidence: { tabla: string; filtro: string; filas: number }[]; assumptions: Supuesto[]; warnings: string[];
  validation: Validacion[]; next_action: string; inicio: string; fin: string;
}

export function nuevoResultado<T>(bd: BaseDatos, skill: string, version: string, datasetId: number, cutoff: string | null): Omit<ResultadoSkill<T>, 'result'> {
  const hash = bd.valor<string>('SELECT hash_sha256 FROM dataset WHERE id=?', [datasetId]) ?? '';
  return {
    run_id: uuid(), skill, skill_version: version, cutoff, dataset_id: datasetId, source_hash: hash, metric_version: '1.0',
    status: 'OK', estado_flujo: 'ANALIZADO', evidence: [], assumptions: [], warnings: [], validation: [], next_action: '', inicio: ahoraLima(), fin: '',
  };
}

export function guardarEjecucion<T>(bd: BaseDatos, r: ResultadoSkill<T>): void {
  r.fin = ahoraLima();
  bd.run(
    `INSERT INTO ejecucion (run_id, skill, skill_version, dataset_id, cutoff, source_hash, metric_version, status, estado_flujo,
      parametros_json, assumptions_json, warnings_json, validation_json, next_action, inicio, fin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [r.run_id, r.skill, r.skill_version, r.dataset_id, r.cutoff, r.source_hash, r.metric_version, r.status, r.estado_flujo,
      JSON.stringify({ evidence: r.evidence }), JSON.stringify(r.assumptions), JSON.stringify(r.warnings), JSON.stringify(r.validation), r.next_action, r.inicio, r.fin],
  );
}

export function actualizarEstado(bd: BaseDatos, runId: string, status: Estado, flujo: EstadoFlujo, validacion: Validacion[]): void {
  bd.run('UPDATE ejecucion SET status=?, estado_flujo=?, validation_json=? WHERE run_id=?', [status, flujo, JSON.stringify(validacion), runId]);
}

/** Resta meses a un periodo 'aaaa-mm'. */
export function mesMas(periodo: string, n: number): string {
  const [a, m] = periodo.split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export function rangoMeses(desde: string, hasta: string): string[] {
  const r: string[] = [];
  for (let p = desde; p <= hasta; p = mesMas(p, 1)) r.push(p);
  return r;
}
