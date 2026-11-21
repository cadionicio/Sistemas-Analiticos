/**
 * Detección automática del tipo de archivo: 'ventas' (tabla) o 'kardex' (reporte por bloques).
 */
import type { Hoja } from './excel';
import { normalizar } from '../util/util';
import { detectarFilaEncabezado, faltantes } from './mapeo';

export type TipoDataset = 'ventas' | 'kardex' | 'desconocido';

export function detectarTipo(hojas: Hoja[]): TipoDataset {
  for (const h of hojas) {
    const muestra = h.filas.slice(0, 40).map((f) => (f ?? []).map(normalizar).join(' | ')).join(' \n ');
    if (/saldo inicial/.test(muestra) || (/transaccion/.test(muestra) && /entrada/.test(muestra) && /salida/.test(muestra) && /stock/.test(muestra))) {
      return 'kardex';
    }
  }
  const h = hojas[0];
  if (h && faltantes(detectarFilaEncabezado(h.filas).mapeo).length === 0) return 'ventas';
  return 'desconocido';
}
