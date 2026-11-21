/**
 * Clasificaciones de inventario: ABC (Pareto), XYZ (variabilidad) y Syntetos-Boylan (patrón de demanda).
 * Reglas documentadas (Manual Descriptivo):
 *  - ABC: se ordena de mayor a menor; A si el acumulado INCLUYENDO el ítem es ≤ 80 %, B si es ≤ 95 %, C en otro caso.
 *  - XYZ: CV = desv. poblacional / media de la serie mensual (con ceros): X ≤ 0,5 · Y ≤ 1,0 · Z > 1,0.
 *  - Syntetos-Boylan (2005): ADI = periodos / periodos con demanda; CV² de los tamaños no nulos;
 *    cortes ADI 1,32 y CV² 0,49 → SUAVE, ERRÁTICA, INTERMITENTE, IRREGULAR (lumpy).
 */
import { desv, media } from './estadistica';

export type ClaseABC = 'A' | 'B' | 'C';
export type Patron = 'SUAVE' | 'ERRATICA' | 'INTERMITENTE' | 'IRREGULAR' | 'SIN_DEMANDA';

export function abc<K>(items: { clave: K; valor: number }[], cortes: [number, number] = [0.8, 0.95]): Map<K, ClaseABC> {
  const orden = [...items].sort((a, b) => b.valor - a.valor);
  const total = orden.reduce((s, i) => s + i.valor, 0);
  const res = new Map<K, ClaseABC>();
  let acum = 0;
  for (const it of orden) {
    acum += it.valor;
    const c = total > 0 ? acum / total : 1;
    res.set(it.clave, c <= cortes[0] + 1e-12 ? 'A' : c <= cortes[1] + 1e-12 ? 'B' : 'C');
  }
  return res;
}

export function xyz(serie: number[]): { clase: 'X' | 'Y' | 'Z'; cv: number } {
  const m = media(serie);
  const cv = m > 0 ? desv(serie) / m : Infinity;
  return { clase: cv <= 0.5 ? 'X' : cv <= 1.0 ? 'Y' : 'Z', cv };
}

export function syntetosBoylan(serie: number[]): { patron: Patron; adi: number; cv2: number } {
  const nz = serie.filter((v) => v > 0);
  if (nz.length === 0) return { patron: 'SIN_DEMANDA', adi: Infinity, cv2: NaN };
  const adi = serie.length / nz.length;
  const cv2 = (desv(nz) / media(nz)) ** 2;
  const patron: Patron = adi < 1.32 ? (cv2 < 0.49 ? 'SUAVE' : 'ERRATICA') : cv2 < 0.49 ? 'INTERMITENTE' : 'IRREGULAR';
  return { patron, adi, cv2 };
}

export function contar<T extends string>(vals: Iterable<T>): Record<string, number> {
  const r: Record<string, number> = {};
  for (const v of vals) r[v] = (r[v] ?? 0) + 1;
  return r;
}
