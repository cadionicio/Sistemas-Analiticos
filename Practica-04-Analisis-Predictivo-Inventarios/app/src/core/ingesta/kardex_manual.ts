/**
 * Registro manual de movimientos de Kardex (entrada/salida), con recálculo del saldo, validación y auditoría.
 * Si una salida deja stock negativo, se registra pero se devuelve una ADVERTENCIA (el Kardex real lo permite y la regla K02 lo reporta).
 */
import type { BaseDatos } from '../db/db';
import { aFechaISO } from '../util/util';
import { auditar, registrarUso } from '../bitacora';
import { clasificarMotivo } from './kardex';

export interface MovimientoManual {
  fecha: string; codigo: string; tipo: 'ENTRADA' | 'SALIDA'; cantidad: number; motivo: string; documento?: string; descripcion?: string;
}

export function validarMovimiento(m: MovimientoManual): string[] {
  const e: string[] = [];
  if (!aFechaISO(m.fecha)) e.push('La fecha es obligatoria y debe ser válida (dd/mm/aaaa).');
  if (!m.codigo || !m.codigo.trim()) e.push('El código de producto es obligatorio.');
  if (m.tipo !== 'ENTRADA' && m.tipo !== 'SALIDA') e.push('El tipo debe ser ENTRADA o SALIDA.');
  if (!isFinite(Number(m.cantidad)) || Number(m.cantidad) <= 0) e.push('La cantidad debe ser un número mayor que cero.');
  if (!m.motivo || !m.motivo.trim()) e.push('El motivo es obligatorio (p. ej., Venta, Compras locales, Por Produccion en Planta).');
  return e;
}

export function registrarMovimientoManual(bd: BaseDatos, datasetId: number, m: MovimientoManual): { id: number; stock: number; advertencias: string[] } {
  const t0 = Date.now();
  const errores = validarMovimiento(m);
  if (errores.length) throw new Error(errores.join(' '));
  const ds = bd.una<{ tipo: string }>('SELECT tipo FROM dataset WHERE id=?', [datasetId]);
  if (!ds || ds.tipo !== 'kardex') throw new Error('El dataset seleccionado no es un Kardex.');
  const fecha = aFechaISO(m.fecha)!;
  const codigo = m.codigo.trim();
  return bd.transaccion(() => {
    let pid = bd.valor<number>('SELECT id FROM producto WHERE dataset_id=? AND codigo=?', [datasetId, codigo]);
    if (!pid) {
      bd.run('INSERT INTO producto (dataset_id, codigo, descripcion, familia) VALUES (?,?,?,?)', [datasetId, codigo, m.descripcion ?? null, codigo.split('-')[0]]);
      pid = bd.ultimoId();
    }
    const previo = bd.valor<number>(
      'SELECT coalesce(stock_reportado, stock_calculado) FROM kardex_mov WHERE producto_id=? AND fecha<=? ORDER BY fecha DESC, id DESC LIMIT 1', [pid, fecha]) ?? 0;
    const e = m.tipo === 'ENTRADA' ? Number(m.cantidad) : 0;
    const s = m.tipo === 'SALIDA' ? Number(m.cantidad) : 0;
    const stock = previo + e - s;
    bd.run(`INSERT INTO kardex_mov (dataset_id, producto_id, hoja, fecha, documento, tipo_doc, entrada, salida, stock_reportado, stock_calculado, motivo, clase_mov, almacen, sede, origen)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'manual')`,
      [datasetId, pid, 'MANUAL', fecha, m.documento ?? 'MANUAL', 'MAN', e, s, stock, stock, m.motivo.trim(), clasificarMotivo(m.motivo, e, s), 'General', '01']);
    const id = bd.ultimoId();
    bd.run('UPDATE dataset SET filas_validas = filas_validas + 1, filas_origen = filas_origen + 1 WHERE id=?', [datasetId]);
    const adv: string[] = [];
    if (stock < 0) adv.push(`El stock de ${codigo} queda negativo (${stock}). Se registró y se reportará en calidad de datos (K02).`);
    auditar(bd, 'kardex_mov', String(id), 'INSERT', null, m);
    registrarUso(bd, 'Registrar movimiento de Kardex manual', 'Datos', `${m.tipo} ${m.cantidad} de ${codigo}`, t0);
    return { id, stock, advertencias: adv };
  });
}
