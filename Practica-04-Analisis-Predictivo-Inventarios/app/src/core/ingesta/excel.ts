/**
 * Lectura de libros Excel (.xlsx, .xls BIFF8, .csv) con SheetJS.
 * Se leen valores crudos (raw) para convertir las fechas sin desfases de zona horaria.
 */
import * as XLSX from 'xlsx';

export interface Hoja {
  nombre: string;
  filas: unknown[][]; // matriz de celdas (fila x columna), valores crudos
}

export function leerLibro(datos: ArrayBuffer | Uint8Array): Hoja[] {
  const wb = XLSX.read(datos, { type: 'array', cellDates: false, raw: false });
  return wb.SheetNames.map((nombre) => ({
    nombre,
    filas: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nombre], {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    }),
  }));
}
