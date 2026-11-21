import { fmtNum } from "./formato";
// Analítica (dominio puro): descriptiva, diagnóstica, predictiva y prescriptiva.
// Reglas del megaprompt: backtesting temporal sin fuga de información, métodos simples primero,
// correlación ≠ causalidad, intervalos rotulados como aproximados, nada de precisión inventada.
import { round2 } from "./abc";

export interface Punto { periodo: string; nombre: string; valor: number }

// ---------- estadística básica ----------
export const media = (x: number[]) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN);
export const desv = (x: number[]) => {
  if (x.length < 2) return NaN;
  const m = media(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1));
};
export const mediana = (x: number[]) => {
  const s = [...x].sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN;
};
export function pearson(x: number[], y: number[]) {
  const mx = media(x), my = media(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}
/** Regresión lineal simple y = a + b·x (MCO). */
export function regresion(x: number[], y: number[]) {
  const mx = media(x), my = media(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const b = sxx ? sxy / sxx : 0;
  const a = my - b * mx;
  const pred = x.map((v) => a + b * v);
  const ssr = y.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0);
  const sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
  return { a, b, r2: sst ? 1 - ssr / sst : NaN };
}

// ---------- métricas de error ----------
export function metricas(real: number[], pron: number[]) {
  const n = real.length;
  const e = real.map((y, i) => y - pron[i]);
  const mae = media(e.map(Math.abs));
  const rmse = Math.sqrt(media(e.map((v) => v * v)));
  const smape = (100 / n) * real.reduce((s, y, i) => s + (Math.abs(y) + Math.abs(pron[i]) > 0 ? (2 * Math.abs(y - pron[i])) / (Math.abs(y) + Math.abs(pron[i])) : 0), 0);
  const mape = real.some((y) => y === 0) ? NaN : (100 / n) * real.reduce((s, y, i) => s + Math.abs((y - pron[i]) / y), 0);
  return { mae, rmse, smape, mape };
}

// ---------- métodos de pronóstico ----------
export interface Metodo {
  id: string;
  nombre: string;
  minObs: number;
  descripcion: string;
  ajustar(y: number[], h: number): { pron: number[]; params: Record<string, number | string> };
}

function holt(y: number[], alpha: number, beta: number) {
  let l = y[0], b = y.length > 1 ? y[1] - y[0] : 0, sse = 0;
  for (let t = 1; t < y.length; t++) {
    const f = l + b;
    sse += (y[t] - f) ** 2;
    const ln = alpha * y[t] + (1 - alpha) * (l + b);
    b = beta * (ln - l) + (1 - beta) * b;
    l = ln;
  }
  return { l, b, sse };
}

export const METODOS: Metodo[] = [
  {
    id: "ingenuo", nombre: "Ingenuo (último valor)", minObs: 1, descripcion: "ŷ(t+h) = y(t). Línea base obligatoria.",
    ajustar: (y, h) => ({ pron: Array(h).fill(y[y.length - 1]), params: {} }),
  },
  {
    id: "media3", nombre: "Media móvil de 3 meses", minObs: 3, descripcion: "ŷ(t+h) = promedio de los 3 últimos meses.",
    ajustar: (y, h) => ({ pron: Array(h).fill(media(y.slice(-3))), params: { ventana: 3 } }),
  },
  {
    id: "tendencia", nombre: "Tendencia lineal", minObs: 6, descripcion: "Regresión y = a + b·t por mínimos cuadrados.",
    ajustar: (y, h) => {
      const t = y.map((_, i) => i + 1);
      const r = regresion(t, y);
      return { pron: Array.from({ length: h }, (_, k) => r.a + r.b * (y.length + k + 1)), params: { a: round2(r.a), b: round2(r.b) } };
    },
  },
  {
    id: "holt", nombre: "Suavizamiento exponencial de Holt", minObs: 6, descripcion: "Nivel y tendencia; α y β por búsqueda en rejilla minimizando el error de un paso dentro de la muestra.",
    ajustar: (y, h) => {
      let best = { a: 0.5, b: 0.1, sse: Infinity, l: 0, tr: 0 };
      for (let a = 0.1; a <= 0.91; a += 0.1) for (let b = 0.05; b <= 0.51; b += 0.05) {
        const r = holt(y, a, b);
        if (r.sse < best.sse) best = { a, b, sse: r.sse, l: r.l, tr: r.b };
      }
      return { pron: Array.from({ length: h }, (_, k) => best.l + (k + 1) * best.tr), params: { alfa: round2(best.a), beta: round2(best.b) } };
    },
  },
  {
    id: "estacional", nombre: "Estacional ingenuo con crecimiento", minObs: 18,
    descripcion: "ŷ(t+h) = y(t+h−12) × (1 + g), g = crecimiento de los últimos 6 meses frente a los mismos 6 meses del año anterior. Requiere ≥ 18 meses.",
    ajustar: (y, h) => {
      const n = y.length;
      const g = media(y.slice(n - 6)) / media(y.slice(n - 18, n - 12)) - 1;
      return { pron: Array.from({ length: h }, (_, k) => y[n - 12 + k] * (1 + g)), params: { crecimiento: fmtNum(g * 100, 2) + " %" } };
    },
  },
];

export interface ResultadoPronostico {
  serie: string;
  n: number;
  hold: number;
  backtest: { id: string; nombre: string; elegible: boolean; motivo?: string; mae?: number; rmse?: number; smape?: number; mape?: number; pron?: number[] }[];
  elegido: string;
  elegidoNombre: string;
  params: Record<string, any>;
  futuro: { periodo: string; nombre: string; central: number; bajo: number; alto: number }[];
  advertencia?: string;
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export function periodosSiguientes(ultimo: string, h: number) {
  let [y, m] = ultimo.split("-").map(Number);
  const out: { periodo: string; nombre: string }[] = [];
  for (let k = 0; k < h; k++) {
    m++;
    if (m > 12) { m = 1; y++; }
    out.push({ periodo: `${y}-${String(m).padStart(2, "0")}`, nombre: `${MESES[m - 1]} ${y}` });
  }
  return out;
}

/**
 * Selección por backtesting temporal: se entrenan los métodos con los primeros n−hold meses y se evalúan
 * en los últimos «hold» meses (nunca se usan datos futuros). Se elige el menor sMAPE; luego se reajusta
 * con toda la serie y se pronostican 6 meses. Banda aproximada al 80 %: ± 1,2816 × RMSE_backtest × √(h/3,5).
 */
export function pronosticar(serie: string, y: Punto[], h = 6, hold = 6): ResultadoPronostico {
  const v = y.map((p) => p.valor);
  const n = v.length;
  const fut = periodosSiguientes(y[n - 1].periodo, h);
  if (n < hold + 3) {
    const base = METODOS[0].ajustar(v, h).pron;
    return { serie, n, hold: 0, backtest: [], elegido: "ingenuo", elegidoNombre: METODOS[0].nombre, params: {}, futuro: fut.map((f, i) => ({ ...f, central: base[i], bajo: NaN, alto: NaN })), advertencia: "Histórico insuficiente para validar métodos: se muestra solo la línea base ingenua, sin banda." };
  }
  const train = v.slice(0, n - hold);
  const test = v.slice(n - hold);
  const bt = METODOS.map((m) => {
    if (train.length < m.minObs) return { id: m.id, nombre: m.nombre, elegible: false, motivo: `requiere ≥ ${m.minObs} meses de entrenamiento (hay ${train.length})` };
    const p = m.ajustar(train, hold).pron;
    return { id: m.id, nombre: m.nombre, elegible: true, ...metricas(test, p), pron: p };
  });
  const ok = bt.filter((b) => b.elegible) as any[];
  ok.sort((a, b) => a.smape - b.smape);
  const g = ok[0];
  const M = METODOS.find((m) => m.id === g.id)!;
  const fin = M.ajustar(v, h);
  const z = 1.2816;
  const futuro = fut.map((f, i) => {
    const s = g.rmse * Math.sqrt((i + 1) / 3.5);
    return { ...f, central: fin.pron[i], bajo: Math.max(0, fin.pron[i] - z * s), alto: fin.pron[i] + z * s };
  });
  return { serie, n, hold, backtest: bt, elegido: g.id, elegidoNombre: g.nombre, params: fin.params, futuro };
}

// ---------- descriptiva / relevancia ----------
export function pareto<T>(items: T[], valor: (t: T) => number) {
  const tot = items.reduce((s, t) => s + valor(t), 0);
  let acum = 0;
  return [...items]
    .sort((a, b) => valor(b) - valor(a))
    .map((t) => {
      const v = valor(t);
      const previo = tot ? acum / tot : 0;
      acum += v;
      const pa = tot ? acum / tot : 0;
      return { item: t, valor: v, pct: tot ? v / tot : 0, acumulado: pa, clase: previo < 0.8 - 1e-9 ? "A" : previo < 0.95 - 1e-9 ? "B" : "C" };
    });
}

/** Variación real vs presupuesto: efecto volumen + efecto costo unitario (suma exacta). */
export function variacionPresupuesto(real: number, vReal: number, ppto: number, vPpto: number) {
  const cP = vPpto ? ppto / vPpto : 0;
  const cR = vReal ? real / vReal : 0;
  const efVol = (vReal - vPpto) * cP;
  const efCosto = (cR - cP) * vReal;
  return { variacion: real - ppto, pct: ppto ? (real - ppto) / ppto : NaN, efVol, efCosto, cP, cR };
}

export function anomalias(y: Punto[], umbral = 2) {
  const v = y.map((p) => p.valor);
  const m = media(v), s = desv(v);
  return y.map((p) => ({ ...p, z: s ? (p.valor - m) / s : 0 })).filter((p) => Math.abs(p.z) >= umbral);
}
