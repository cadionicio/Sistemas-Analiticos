/**
 * Validación temporal con ORIGEN MÓVIL (ayuda base, PDF 02 pág. 10): se entrena solo con el pasado y se evalúa cada horizonte h = 1…6.
 * Métricas: MAE, RMSE, WAPE, MASE (escala = MAE del Naive un paso en el tramo de entrenamiento), sesgo.
 * Selección: menor MASE promedio; ante empate (±1e-9) gana el modelo más simple (orden de la lista). Nunca se usa MAPE (hay ceros).
 */
import type { Modelo } from './modelos';

export interface MetricasH { h: number; n: number; mae: number; rmse: number; wape: number; mase: number; sesgo: number }
export interface EvalModelo { modelo: string; porH: MetricasH[]; maseProm: number; valido: boolean }

export function pronosticoPuntual(m: Modelo, y: number[], H: number): number[] | null {
  const aj = m.ajustar(y);
  if (!aj) return null;
  return Array.from({ length: H }, (_, i) => aj.prever(aj.estado, i + 1));
}

export function origenes(n: number, H: number, maxOrigenes: number, minEntrenamiento: number): number[] {
  const o: number[] = [];
  for (let k = n - 1; k >= minEntrenamiento && o.length < maxOrigenes; k--) o.push(k); // entrenar con y[0..k-1], evaluar y[k..]
  return o.reverse().filter((k) => k <= n - 1);
}

export function evaluar(modelos: Modelo[], y: number[], H = 6, maxOrigenes = 12, noNegativo = false): EvalModelo[] {
  const n = y.length;
  const minEnt = Math.max(...modelos.map((m) => m.minObs), 6);
  const os = origenes(n, H, maxOrigenes + H - 1, minEnt).slice(-(maxOrigenes + H - 1));
  return modelos.map((m) => {
    const errs: { h: number; e: number; y: number; esc: number }[] = [];
    let valido = n >= m.minObs + 1;
    for (const k of os) {
      const tr = y.slice(0, k);
      if (tr.length < m.minObs) continue;
      const f = pronosticoPuntual(m, tr, H);
      if (!f) { valido = false; break; }
      let esc = 0; for (let t = 1; t < tr.length; t++) esc += Math.abs(tr[t] - tr[t - 1]); esc /= Math.max(1, tr.length - 1);
      for (let h = 1; h <= H && k + h - 1 < n; h++) {
        const fh = noNegativo ? Math.max(0, f[h - 1]) : f[h - 1];
        errs.push({ h, e: y[k + h - 1] - fh, y: y[k + h - 1], esc: esc || 1 });
      }
    }
    const porH: MetricasH[] = [];
    for (let h = 1; h <= H; h++) {
      const x = errs.filter((r) => r.h === h);
      if (!x.length) continue;
      const sa = x.reduce((s, r) => s + Math.abs(r.e), 0), sy = x.reduce((s, r) => s + Math.abs(r.y), 0);
      porH.push({ h, n: x.length, mae: sa / x.length, rmse: Math.sqrt(x.reduce((s, r) => s + r.e * r.e, 0) / x.length), wape: sy > 0 ? sa / sy : NaN,
        mase: x.reduce((s, r) => s + Math.abs(r.e) / r.esc, 0) / x.length, sesgo: -x.reduce((s, r) => s + r.e, 0) / x.length });
    }
    const maseProm = porH.length ? porH.reduce((s, r) => s + r.mase, 0) / porH.length : Infinity;
    return { modelo: m.nombre, porH, maseProm, valido: valido && porH.length > 0 };
  });
}

export function seleccionar(ev: EvalModelo[]): EvalModelo {
  const v = ev.filter((e) => e.valido && isFinite(e.maseProm));
  return v.reduce((b, e) => (e.maseProm < b.maseProm - 1e-9 ? e : b), v[0]);
}
