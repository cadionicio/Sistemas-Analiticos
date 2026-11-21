/**
 * Bitácora de uso: cada acción del usuario o del Super Agente con inicio, fin y duración.
 * Es la fuente del Word de la Pregunta 02 ("tiempo por actividad").
 */
import type { BaseDatos } from './db/db';
import { ahoraLima } from './util/util';

export function registrarUso(bd: BaseDatos, accion: string, pantalla: string, detalle: string, inicioMs: number, finMs = Date.now()): void {
  const iso = (ms: number) => new Date(ms - 5 * 3600 * 1000).toISOString().slice(0, 23);
  bd.run('INSERT INTO bitacora_uso (ts_inicio, ts_fin, duracion_ms, pantalla, accion, detalle) VALUES (?,?,?,?,?,?)', [
    iso(inicioMs), iso(finMs), Math.max(0, Math.round(finMs - inicioMs)), pantalla, accion, detalle,
  ]);
}

export function auditar(bd: BaseDatos, entidad: string, entidadId: string, accion: 'INSERT' | 'UPDATE' | 'DELETE' | 'APROBAR', antes: unknown, despues: unknown): void {
  bd.run('INSERT INTO auditoria (ts, entidad, entidad_id, accion, antes_json, despues_json) VALUES (?,?,?,?,?,?)', [
    ahoraLima(), entidad, entidadId, accion, antes == null ? null : JSON.stringify(antes), despues == null ? null : JSON.stringify(despues),
  ]);
}
