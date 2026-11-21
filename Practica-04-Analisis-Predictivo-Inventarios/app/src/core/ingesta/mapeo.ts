/**
 * Mapeo inteligente de columnas: diccionario de sinónimos en español + puntuación de confianza.
 * El usuario puede confirmar o corregir el mapeo en el asistente (pantalla Datos).
 */
import { normalizar } from '../util/util';

export type CampoVenta =
  | 'fecha' | 'sku' | 'soles' | 'volumen' | 'utilidad'
  | 'ruc' | 'cliente' | 'direccion' | 'departamento' | 'n_origen';

export const OBLIGATORIOS_VENTA: CampoVenta[] = ['fecha', 'sku', 'soles', 'utilidad'];

/** Sinónimos por campo canónico (ya normalizados: minúsculas, sin tildes). */
export const SINONIMOS_VENTA: Record<CampoVenta, string[]> = {
  fecha: ['fecha', 'fecha venta', 'fecha emision', 'fec', 'date', 'dia', 'periodo'],
  sku: ['item codigo producto', 'codigo producto', 'cod producto', 'codigo', 'item', 'sku', 'producto', 'articulo', 'cod articulo'],
  soles: ['ventas soles', 'venta soles', 'ventas', 'venta', 'importe', 'monto', 'total venta', 'venta neta', 'ingresos', 'ventas s'],
  volumen: ['venta ton', 'ventas ton', 'toneladas', 'ton', 'cantidad', 'cant', 'unidades', 'volumen', 'kg', 'qty'],
  utilidad: ['utilidad operativa soles', 'utilidad operativa', 'utilidad', 'margen soles', 'ganancia', 'profit', 'utilidad bruta'],
  ruc: ['ruc', 'ruc cliente', 'nro ruc', 'documento cliente'],
  cliente: ['razon social cliente', 'razon social', 'cliente', 'nombre cliente'],
  direccion: ['direccion', 'direccion cliente', 'domicilio'],
  departamento: ['departamento', 'region', 'depto', 'zona', 'provincia'],
  n_origen: ['n', 'no', 'nro', 'numero', 'item n', 'correlativo'],
};

export interface MapeoColumna {
  campo: CampoVenta;
  indice: number;
  columnaOrigen: string;
  confianza: number; // 0..1
}

/** Puntuación entre un encabezado y un sinónimo. */
export function puntuar(encabezado: string, sinonimo: string): number {
  const e = normalizar(encabezado);
  if (!e) return 0;
  if (e === sinonimo) return 1;
  const te = new Set(e.split(' '));
  const ts = sinonimo.split(' ');
  const comunes = ts.filter((t) => te.has(t)).length;
  if (comunes === ts.length) return 0.9 - Math.max(0, te.size - ts.length) * 0.02; // sinónimo contenido en el encabezado
  if (comunes > 0) return 0.5 * (comunes / Math.max(ts.length, te.size));
  return 0;
}

/**
 * Asigna cada campo canónico a la columna de mayor puntuación (sin repetir columnas),
 * priorizando los campos obligatorios y las coincidencias más fuertes.
 */
export function mapearVentas(encabezados: unknown[]): MapeoColumna[] {
  const candidatos: { campo: CampoVenta; indice: number; conf: number }[] = [];
  (Object.keys(SINONIMOS_VENTA) as CampoVenta[]).forEach((campo) => {
    encabezados.forEach((h, i) => {
      const conf = Math.max(...SINONIMOS_VENTA[campo].map((s) => puntuar(String(h ?? ''), s)));
      if (conf >= 0.45) candidatos.push({ campo, indice: i, conf });
    });
  });
  candidatos.sort((a, b) => b.conf - a.conf || (OBLIGATORIOS_VENTA.includes(b.campo) ? 1 : 0) - (OBLIGATORIOS_VENTA.includes(a.campo) ? 1 : 0));
  const usados = new Set<number>(), asignados = new Set<CampoVenta>(), res: MapeoColumna[] = [];
  for (const c of candidatos) {
    if (usados.has(c.indice) || asignados.has(c.campo)) continue;
    usados.add(c.indice); asignados.add(c.campo);
    res.push({ campo: c.campo, indice: c.indice, columnaOrigen: String(encabezados[c.indice] ?? ''), confianza: Math.round(c.conf * 100) / 100 });
  }
  return res.sort((a, b) => a.indice - b.indice);
}

/** Busca, en las primeras 25 filas, la que mejor funciona como encabezado de una tabla de ventas. */
export function detectarFilaEncabezado(filas: unknown[][]): { fila: number; mapeo: MapeoColumna[] } {
  let mejor = { fila: 0, mapeo: [] as MapeoColumna[], puntaje: -1 };
  for (let i = 0; i < Math.min(25, filas.length); i++) {
    const m = mapearVentas(filas[i] ?? []);
    const oblig = m.filter((x) => OBLIGATORIOS_VENTA.includes(x.campo)).length;
    const puntaje = oblig * 10 + m.reduce((s, x) => s + x.confianza, 0);
    if (puntaje > mejor.puntaje) mejor = { fila: i, mapeo: m, puntaje };
  }
  return { fila: mejor.fila, mapeo: mejor.mapeo };
}

export function faltantes(mapeo: MapeoColumna[]): CampoVenta[] {
  return OBLIGATORIOS_VENTA.filter((c) => !mapeo.some((m) => m.campo === c));
}
