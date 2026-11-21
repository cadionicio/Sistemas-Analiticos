/**
 * Módulo de calidad de datos (pantalla Datos → "Calidad de datos"): resumen por dataset leído de la BD.
 */
import type { BaseDatos } from '../db/db';

export interface ResumenCalidad {
  datasetId: number; nombre: string; tipo: string; filas: number; estado: string;
  reglas: { regla: string; severidad: string; detalle: string }[];
  porSeveridad: Record<string, number>;
}

export function resumenCalidad(bd: BaseDatos, datasetId: number): ResumenCalidad {
  const ds = bd.una<{ nombre: string; tipo: string; filas_validas: number; estado: string }>('SELECT nombre, tipo, filas_validas, estado FROM dataset WHERE id=?', [datasetId]);
  if (!ds) throw new Error(`No existe el dataset ${datasetId}`);
  const reglas = bd.todas<{ regla: string; severidad: string; detalle: string }>(
    `SELECT regla, severidad, detalle FROM calidad_hallazgo WHERE dataset_id=? AND fila_origen IS NULL
     ORDER BY CASE severidad WHEN 'CRITICA' THEN 1 WHEN 'ALTA' THEN 2 WHEN 'MEDIA' THEN 3 WHEN 'BAJA' THEN 4 ELSE 5 END, regla`, [datasetId]);
  const porSeveridad: Record<string, number> = {};
  reglas.forEach((r) => (porSeveridad[r.severidad] = (porSeveridad[r.severidad] ?? 0) + 1));
  return { datasetId, nombre: ds.nombre, tipo: ds.tipo, filas: ds.filas_validas, estado: ds.estado, reglas, porSeveridad };
}

/** Ejemplos (filas de origen) de una regla, para que el usuario los revise en su Excel. */
export function ejemplosRegla(bd: BaseDatos, datasetId: number, regla: string, limite = 20): number[] {
  return bd.todas<{ f: number }>('SELECT fila_origen AS f FROM calidad_hallazgo WHERE dataset_id=? AND regla=? AND fila_origen IS NOT NULL LIMIT ?', [datasetId, regla, limite]).map((x) => x.f);
}
