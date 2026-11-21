/**
 * Trayectorias futuras por BOOTSTRAP de residuos un paso adelante (ayuda base, PDF 02 págs. 9–11):
 * y_{t+1} = pronóstico(estado) + residuo remuestreado; el estado se actualiza con el valor simulado.
 * Los percentiles de cada mes y del TOTAL de 6 meses se calculan sobre las trayectorias (P90(A+B) ≠ P90(A)+P90(B)).
 */
import type { Ajuste } from './modelos';
import { clon } from './modelos';
import { cuantil } from '../estadistica';

export interface Bandas { p025: number; p10: number; p50: number; p90: number; p975: number; media: number }
export interface Simulado { porMes: Bandas[]; total: Bandas; trayectorias: number }

export function bandas(xs: number[]): Bandas {
  return { p025: cuantil(xs, 0.025), p10: cuantil(xs, 0.1), p50: cuantil(xs, 0.5), p90: cuantil(xs, 0.9), p975: cuantil(xs, 0.975), media: xs.reduce((s, v) => s + v, 0) / xs.length };
}

export function simular(aj: Ajuste, H: number, N: number, rand: () => number, noNegativo = false, conservarTrayectorias = false, escala = 1): Simulado & { matriz?: number[][] } {
  const res = (aj.residuos.length ? aj.residuos : [0]).map((e) => e * escala);
  const porMes: number[][] = Array.from({ length: H }, () => new Array(N));
  const tot = new Array(N);
  for (let i = 0; i < N; i++) {
    let e = clon(aj.estado), s = 0;
    for (let h = 0; h < H; h++) {
      let v = aj.prever(e, 1) + res[Math.floor(rand() * res.length)];
      if (noNegativo && v < 0) v = 0;
      porMes[h][i] = v; s += v; e = aj.actualizar(e, v);
    }
    tot[i] = s;
  }
  return { porMes: porMes.map(bandas), total: bandas(tot), trayectorias: N, matriz: conservarTrayectorias ? porMes : undefined };
}

/** Pérdida pinball de un cuantil q. */
export const pinball = (y: number, qv: number, q: number) => (y >= qv ? q * (y - qv) : (1 - q) * (qv - y));
