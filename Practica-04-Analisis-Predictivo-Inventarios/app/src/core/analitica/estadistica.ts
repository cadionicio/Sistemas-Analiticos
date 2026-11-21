/** Funciones estadísticas básicas (deterministas, sin dependencias). */
export const suma = (x: number[]) => x.reduce((s, v) => s + v, 0);
export const media = (x: number[]) => (x.length ? suma(x) / x.length : NaN);
/** Desviación estándar poblacional (ddof = 0). */
export function desv(x: number[]): number {
  if (!x.length) return NaN;
  const m = media(x);
  return Math.sqrt(suma(x.map((v) => (v - m) ** 2)) / x.length);
}
export function mediana(x: number[]): number {
  if (!x.length) return NaN;
  const s = [...x].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
export const mad = (x: number[]) => { const m = mediana(x); return mediana(x.map((v) => Math.abs(v - m))); };
/** Cuantil con interpolación lineal (equivalente al método por defecto de numpy). */
export function cuantil(x: number[], q: number): number {
  if (!x.length) return NaN;
  const s = [...x].sort((a, b) => a - b), pos = (s.length - 1) * q, i = Math.floor(pos), f = pos - i;
  return i + 1 < s.length ? s[i] + f * (s[i + 1] - s[i]) : s[i];
}
export function pearson(x: number[], y: number[]): number {
  const mx = media(x), my = media(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  return sxy / Math.sqrt(sxx * syy);
}
/** z robusto (MAD). */
export const zRobusto = (v: number, med: number, m: number) => (m > 0 ? (0.6745 * (v - med)) / m : 0);
