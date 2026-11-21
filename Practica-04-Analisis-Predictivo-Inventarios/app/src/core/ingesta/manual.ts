/**
 * Registro manual de ventas (formulario CRUD de la pantalla Datos), con validación y auditoría.
 */
import type { BaseDatos } from '../db/db';
import { aFechaISO } from '../util/util';
import { auditar, registrarUso } from '../bitacora';

export interface VentaManual {
  fecha: string; sku: string; soles: number; utilidad: number;
  volumen?: number | null; ruc?: string | null; cliente?: string | null; departamento?: string | null;
}

export function validarVentaManual(v: VentaManual): string[] {
  const e: string[] = [];
  if (!aFechaISO(v.fecha)) e.push('La fecha es obligatoria y debe ser válida (dd/mm/aaaa).');
  if (!v.sku || !String(v.sku).trim()) e.push('El código de producto es obligatorio.');
  if (!isFinite(Number(v.soles)) || Number(v.soles) <= 0) e.push('La venta en soles debe ser un número mayor que cero.');
  if (!isFinite(Number(v.utilidad))) e.push('La utilidad debe ser numérica (puede ser negativa).');
  if (v.volumen != null && (!isFinite(Number(v.volumen)) || Number(v.volumen) < 0)) e.push('El volumen debe ser un número no negativo.');
  return e;
}

/** Inserta una venta manual en un dataset de ventas existente. Devuelve el id o lanza errores de validación. */
export function registrarVentaManual(bd: BaseDatos, datasetId: number, v: VentaManual): number {
  const t0 = Date.now();
  const errores = validarVentaManual(v);
  if (errores.length) throw new Error(errores.join(' '));
  const ds = bd.una<{ tipo: string }>('SELECT tipo FROM dataset WHERE id=?', [datasetId]);
  if (!ds || ds.tipo !== 'ventas') throw new Error('El dataset seleccionado no es de ventas.');
  const sku = String(v.sku).trim();
  return bd.transaccion(() => {
    let pid = bd.valor<number>('SELECT id FROM producto WHERE dataset_id=? AND codigo=?', [datasetId, sku]);
    if (!pid) {
      bd.run('INSERT INTO producto (dataset_id, codigo) VALUES (?,?)', [datasetId, sku]);
      pid = bd.ultimoId();
    }
    bd.run(
      `INSERT INTO venta (dataset_id, fecha, ruc, cliente, departamento, producto_id, sku, soles, volumen, utilidad, origen)
       VALUES (?,?,?,?,?,?,?,?,?,?,'manual')`,
      [datasetId, aFechaISO(v.fecha), v.ruc ?? null, v.cliente ?? null, v.departamento ?? null, pid, sku, Number(v.soles), v.volumen ?? null, Number(v.utilidad)],
    );
    const id = bd.ultimoId();
    bd.run('UPDATE dataset SET filas_validas = filas_validas + 1 WHERE id=?', [datasetId]);
    auditar(bd, 'venta', String(id), 'INSERT', null, v);
    registrarUso(bd, 'Registrar venta manual', 'Datos', `SKU ${sku}, S/ ${v.soles}`, t0);
    return id;
  });
}
