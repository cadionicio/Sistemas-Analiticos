/**
 * Punto de entrada único de la ingesta: detecta el tipo de archivo y lo envía al importador correcto.
 */
import type { BaseDatos } from '../db/db';
import { leerLibro } from './excel';
import { detectarTipo } from './detectar';
import { importarVentas, type ResumenIngestaVentas } from './ventas';
import { importarKardex, type ResumenIngestaKardex } from './kardex';

export type ResultadoImportacion =
  | { tipo: 'ventas'; resumen: ResumenIngestaVentas }
  | { tipo: 'kardex'; resumen: ResumenIngestaKardex };

export async function importarArchivo(bd: BaseDatos, datos: ArrayBuffer | Uint8Array, archivo: string): Promise<ResultadoImportacion> {
  const tipo = detectarTipo(leerLibro(datos));
  if (tipo === 'ventas') return { tipo, resumen: await importarVentas(bd, datos, archivo) };
  if (tipo === 'kardex') return { tipo, resumen: await importarKardex(bd, datos, archivo) };
  throw new Error('No se reconoce el formato del archivo: se esperaba una tabla de ventas (fecha, producto, venta, utilidad) o un Kardex con SALDO INICIAL / Entrada / Salida / Stock. Use el asistente de mapeo.');
}
