/**
 * Modelos de pronóstico (implementación propia, determinista y documentada; replicada en Python para validar).
 * Cada modelo expone: ajustar(y) → { params, residuos (errores un paso adelante), pronosticar(H), estado clonable }.
 * Inicializaciones (Manual Descriptivo):
 *  - SES: nivel₀ = y₀. Holt: nivel₀ = y₀, tendencia₀ = y₁ − y₀.
 *  - Holt-Winters aditivo (m = 12, requiere ≥ 24 obs.): nivel₀ = media(y₀..y₁₁), tendencia₀ = (media(y₁₂..y₂₃) − media(y₀..y₁₁)) / 12,
 *    estacional_i = y_i − nivel₀ (i < 12); los errores se miden desde t = 12.
 *  - Parámetros por búsqueda en rejilla minimizando la SSE un paso adelante: SES α ∈ {0,05…0,95};
 *    Holt y HW α, β, γ ∈ {0,1…0,9}.
 *  - Croston/SBA/TSB (demanda intermitente): α = 0,1 (y β = 0,1 en TSB), tamaño y periodo inicial = primera demanda no nula.
 */
export interface Estado { [k: string]: number | number[] }
export interface Ajuste {
  modelo: string;
  params: Record<string, number>;
  residuos: number[];
  estado: Estado;
  prever: (e: Estado, h: number) => number;          // pronóstico h pasos adelante desde el estado e
  actualizar: (e: Estado, y: number) => Estado;       // nuevo estado tras observar y
}
export interface Modelo { nombre: string; minObs: number; ajustar: (y: number[]) => Ajuste | null }

const rejilla = (a: number, b: number, paso: number) => { const r: number[] = []; for (let v = a; v <= b + 1e-9; v += paso) r.push(Math.round(v * 100) / 100); return r; };
const G05 = rejilla(0.05, 0.95, 0.05), G1 = rejilla(0.1, 0.9, 0.1);
const clon = (e: Estado): Estado => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));

// ------------------------------------------------ Naive, Naive estacional, media móvil
export const Naive: Modelo = {
  nombre: 'Naive', minObs: 2,
  ajustar: (y) => ({ modelo: 'Naive', params: {}, residuos: y.slice(1).map((v, i) => v - y[i]), estado: { u: y.at(-1)! },
    prever: (e) => e.u as number, actualizar: (e, v) => ({ ...e, u: v }) }),
};
export const NaiveEstacional: Modelo = {
  nombre: 'Naive estacional', minObs: 24,
  ajustar: (y) => ({ modelo: 'Naive estacional', params: { m: 12 }, residuos: y.slice(12).map((v, i) => v - y[i]), estado: { h: y.slice(-12) },
    prever: (e, h) => (e.h as number[])[(h - 1) % 12], actualizar: (e, v) => ({ h: [...(e.h as number[]).slice(1), v] }) }),
};
export const MediaMovil6: Modelo = {
  nombre: 'Media móvil (6)', minObs: 8,
  ajustar: (y) => {
    const res: number[] = [];
    for (let t = 6; t < y.length; t++) res.push(y[t] - y.slice(t - 6, t).reduce((s, v) => s + v, 0) / 6);
    return { modelo: 'Media móvil (6)', params: { k: 6 }, residuos: res, estado: { w: y.slice(-6) },
      prever: (e) => (e.w as number[]).reduce((s, v) => s + v, 0) / 6, actualizar: (e, v) => ({ w: [...(e.w as number[]).slice(1), v] }) };
  },
};

// ------------------------------------------------ SES
function sesSSE(y: number[], a: number) { let l = y[0], sse = 0; const r: number[] = []; for (let t = 1; t < y.length; t++) { const e = y[t] - l; r.push(e); sse += e * e; l += a * e; } return { sse, l, r }; }
export const SES: Modelo = {
  nombre: 'SES', minObs: 6,
  ajustar: (y) => {
    let best = { a: G05[0], ...sesSSE(y, G05[0]) };
    for (const a of G05) { const s = sesSSE(y, a); if (s.sse < best.sse - 1e-9) best = { a, ...s }; }
    return { modelo: 'SES', params: { alfa: best.a }, residuos: best.r, estado: { l: best.l },
      prever: (e) => e.l as number, actualizar: (e, v) => ({ l: (e.l as number) + best.a * (v - (e.l as number)) }) };
  },
};

// ------------------------------------------------ Holt (tendencia lineal)
function holtSSE(y: number[], a: number, b: number) {
  let l = y[0], t0 = y[1] - y[0], sse = 0; const r: number[] = [];
  for (let t = 1; t < y.length; t++) { const f = l + t0, e = y[t] - f; r.push(e); sse += e * e; const ln = a * y[t] + (1 - a) * (l + t0); t0 = b * (ln - l) + (1 - b) * t0; l = ln; }
  return { sse, l, b: t0, r };
}
export const Holt: Modelo = {
  nombre: 'Holt', minObs: 8,
  ajustar: (y) => {
    let best: { a: number; bb: number; sse: number; l: number; b: number; r: number[] } | null = null;
    for (const a of G1) for (const bb of G1) { const s = holtSSE(y, a, bb); if (!best || s.sse < best.sse - 1e-9) best = { a, bb, ...s }; }
    const B = best!;
    return { modelo: 'Holt', params: { alfa: B.a, beta: B.bb }, residuos: B.r, estado: { l: B.l, b: B.b },
      prever: (e, h) => (e.l as number) + h * (e.b as number),
      actualizar: (e, v) => { const l = e.l as number, b = e.b as number, ln = B.a * v + (1 - B.a) * (l + b); return { l: ln, b: B.bb * (ln - l) + (1 - B.bb) * b }; } };
  },
};

// ------------------------------------------------ Holt-Winters aditivo (m = 12)
function hwSSE(y: number[], a: number, b: number, g: number) {
  const m = 12;
  const media = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  let l = media(y.slice(0, m)), t0 = (media(y.slice(m, 2 * m)) - l) / m;
  const s = y.slice(0, m).map((v) => v - l);
  let sse = 0; const r: number[] = [];
  for (let t = m; t < y.length; t++) {
    const st = s[t - m], f = l + t0 + st, e = y[t] - f; r.push(e); sse += e * e;
    const ln = a * (y[t] - st) + (1 - a) * (l + t0);
    t0 = b * (ln - l) + (1 - b) * t0;
    s.push(g * (y[t] - ln) + (1 - g) * st); l = ln;
  }
  return { sse, l, b: t0, s: s.slice(-m), r };
}
export const HoltWinters: Modelo = {
  nombre: 'Holt-Winters aditivo', minObs: 24,
  ajustar: (y) => {
    if (y.length < 24) return null;
    let best: { a: number; bb: number; g: number; sse: number; l: number; b: number; s: number[]; r: number[] } | null = null;
    for (const a of G1) for (const bb of G1) for (const g of G1) { const x = hwSSE(y, a, bb, g); if (!best || x.sse < best.sse - 1e-9) best = { a, bb, g, ...x }; }
    const B = best!;
    return { modelo: 'Holt-Winters aditivo', params: { alfa: B.a, beta: B.bb, gamma: B.g }, residuos: B.r, estado: { l: B.l, b: B.b, s: B.s },
      prever: (e, h) => (e.l as number) + h * (e.b as number) + (e.s as number[])[(h - 1) % 12],
      actualizar: (e, v) => {
        const l = e.l as number, b = e.b as number, s = e.s as number[], st = s[0];
        const ln = B.a * (v - st) + (1 - B.a) * (l + b);
        return { l: ln, b: B.bb * (ln - l) + (1 - B.bb) * b, s: [...s.slice(1), B.g * (v - ln) + (1 - B.g) * st] };
      } };
  },
};

// ------------------------------------------------ Croston / SBA / TSB (demanda intermitente)
function crostonBase(y: number[], variante: 'Croston' | 'SBA' | 'TSB'): Ajuste | null {
  const a = 0.1, bt = 0.1;
  const i0 = y.findIndex((v) => v > 0);
  if (i0 < 0) return null;
  let z = y[i0], p = i0 + 1, q = 1, prob = 1 / p;
  const factor = variante === 'SBA' ? 1 - a / 2 : 1;
  const f = () => (variante === 'TSB' ? prob * z : (factor * z) / p);
  const r: number[] = [];
  for (let t = i0 + 1; t < y.length; t++) {
    r.push(y[t] - f());
    if (variante === 'TSB') { prob += bt * ((y[t] > 0 ? 1 : 0) - prob); if (y[t] > 0) z += a * (y[t] - z); }
    else if (y[t] > 0) { z += a * (y[t] - z); p += a * (q - p); q = 1; } else q++;
  }
  const upd = (e: Estado, v: number): Estado => {
    let { z: zz, p: pp, q: qq, prob: pr } = e as { z: number; p: number; q: number; prob: number };
    if (variante === 'TSB') { pr += bt * ((v > 0 ? 1 : 0) - pr); if (v > 0) zz += a * (v - zz); }
    else if (v > 0) { zz += a * (v - zz); pp += a * (qq - pp); qq = 1; } else qq++;
    return { z: zz, p: pp, q: qq, prob: pr };
  };
  return { modelo: variante, params: variante === 'TSB' ? { alfa: a, beta: bt } : { alfa: a }, residuos: r, estado: { z, p, q, prob },
    prever: (e) => (variante === 'TSB' ? (e.prob as number) * (e.z as number) : (factor * (e.z as number)) / (e.p as number)), actualizar: upd };
}
export const Croston: Modelo = { nombre: 'Croston', minObs: 6, ajustar: (y) => crostonBase(y, 'Croston') };
export const SBA: Modelo = { nombre: 'SBA', minObs: 6, ajustar: (y) => crostonBase(y, 'SBA') };
export const TSB: Modelo = { nombre: 'TSB', minObs: 6, ajustar: (y) => crostonBase(y, 'TSB') };

export const MODELOS_CONTINUOS: Modelo[] = [Naive, NaiveEstacional, MediaMovil6, SES, Holt, HoltWinters];
export const MODELOS_INTERMITENTES: Modelo[] = [Naive, MediaMovil6, SES, Croston, SBA, TSB];
export { clon };
