// Gráficos SVG sin dependencias (offline). Reglas dataviz: un solo eje Y, líneas de 2 px, marcadores ≥ 8 px,
// barras ≤ 24 px con extremo redondeado de 4 px y base recta, rejilla tenue, leyenda siempre (≥ 2 series),
// etiquetas directas selectivas, capa de hover (data-tip) y tabla alternativa en <details>.
import { esc } from "./comun";
import { fmtNum } from "../domain/formato";

export const COL = { s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a", s4: "#eda100", ppto: "#52514e", fav: "#2a78d6", desf: "#e34948", grid: "#E6E9F2", axis: "#5B6B88", ink: "#1D2E50" };
const SERIES = [COL.s1, COL.s2, COL.s3, COL.s4];
export const colorSerie = (i: number) => SERIES[i % SERIES.length];

function nice(min: number, max: number, n = 5) {
  if (!isFinite(min) || !isFinite(max)) return { lo: 0, hi: 1, step: 0.2, ticks: [0, 1] };
  if (min === max) { min = min - Math.abs(min || 1) * 0.1; max = max + Math.abs(max || 1) * 0.1; }
  const raw = (max - min) / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { lo, hi, step, ticks };
}
export const corto = (v: number, dec?: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return fmtNum(v / 1e6, dec ?? 1) + " M";
  if (a >= 1e4) return fmtNum(v / 1e3, dec ?? 0) + " mil";
  if (a >= 100) return fmtNum(v, dec ?? 0);
  return fmtNum(v, dec ?? 2);
};
/** Rótulos de eje exactos y sin repeticiones: una sola escala (M, mil o unidades) para todo el eje y los
 *  decimales justos para representar el paso de la escala (p. ej. paso 25.000 en millones → 3 decimales). */
export function rotulosEje(ticks: number[]): Map<number, string> {
  if (!ticks.length) return new Map();
  const maxAbs = Math.max(...ticks.map((t) => Math.abs(t)));
  const [div, suf] = maxAbs >= 1e6 ? [1e6, " M"] : maxAbs >= 1e4 ? [1e3, " mil"] : [1, ""];
  const ord = [...ticks].sort((a, b) => a - b);
  const step = ord.length > 1 ? Math.min(...ord.slice(1).map((t, k) => t - ord[k]).filter((d) => d > 0)) : 0;
  let d = 0;
  if (step > 0) while (d < 4 && Math.abs(Math.round((step / div) * 10 ** d) - (step / div) * 10 ** d) > 1e-6) d++;
  else d = div === 1 ? 2 : 1;
  const m = new Map(ticks.map((t) => [t, t === 0 ? "0" : fmtNum(t / div, d) + suf]));
  if (new Set(m.values()).size < ticks.length) return new Map(ticks.map((t) => [t, fmtNum(t, 0)]));
  return m;
}
/** Valor de referencia rotulado con precisión suficiente (millones con 2 decimales). */
export const cortoRef = (v: number) => (Math.abs(v) >= 1e6 ? corto(v, 2) : corto(v));

export interface SerieLinea { id: string; label: string; color: string; estilo?: "solido" | "guion" | "punto"; valores: (number | null)[]; etiquetaFinal?: boolean }
export interface OpcLinea {
  titulo: string; xs: string[]; series: SerieLinea[]; banda?: { bajo: (number | null)[]; alto: (number | null)[]; color: string; label: string };
  actual?: number; // índice del punto "actual"
  fmt?: (v: number) => string; alto?: number; ancho?: number; desdeCero?: boolean; leyendaExtra?: string; unidad?: string;
}

export function leyenda(items: { label: string; color: string; estilo?: string; tipo?: "linea" | "barra" | "banda" | "punto" }[]) {
  return `<div class="viz-legend">${items
    .map((i) => {
      const sw =
        i.tipo === "barra" ? `<svg width="14" height="10" aria-hidden="true"><rect width="14" height="10" rx="2" fill="${i.color}"/></svg>`
        : i.tipo === "banda" ? `<svg width="18" height="10" aria-hidden="true"><rect width="18" height="10" fill="${i.color}" opacity=".18"/></svg>`
        : i.tipo === "punto" ? `<svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="${i.color}" stroke="#fff" stroke-width="2"/></svg>`
        : `<svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="${i.color}" stroke-width="2" ${i.estilo === "guion" ? 'stroke-dasharray="6 4"' : i.estilo === "punto" ? 'stroke-dasharray="2 3" stroke-linecap="round"' : ""}/></svg>`;
      return `<span>${sw}${esc(i.label)}</span>`;
    })
    .join("")}</div>`;
}

/** Línea temporal: histórico, actual, presupuestado y pronosticado, con banda opcional. */
export function lineas(o: OpcLinea): string {
  const W = o.ancho || 760, H = o.alto || 260, L = 64, T = 14, B = 30;
  const R = o.series.some((s) => s.etiquetaFinal) ? 100 : 16;
  const fmt = o.fmt || ((v: number) => fmtNum(v, 2));
  const vals: number[] = [];
  for (const s of o.series) for (const v of s.valores) if (v !== null && isFinite(v)) vals.push(v);
  if (o.banda) for (const v of [...o.banda.bajo, ...o.banda.alto]) if (v !== null && isFinite(v)) vals.push(v);
  if (!vals.length) return `<div class="empty small">Sin datos para graficar.</div>`;
  const sc = nice(o.desdeCero ? Math.min(0, ...vals) : Math.min(...vals), Math.max(...vals));
  const n = o.xs.length;
  const x = (i: number) => L + (n <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (H - T - B) * (1 - (v - sc.lo) / (sc.hi - sc.lo || 1));
  let g = "";
  const rot = rotulosEje(sc.ticks);
  for (const t of sc.ticks) g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${COL.grid}" stroke-width="1"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" class="viz-ax">${esc(rot.get(t) || corto(t))}</text>`;
  const paso = Math.max(1, Math.ceil(n / 10));
  o.xs.forEach((lbl, i) => {
    const ultimo = i === n - 1;
    if (!(i % paso === 0 || ultimo)) return;
    if (!ultimo && n - 1 - i < Math.max(1, paso * 0.6)) return; // evita chocar con el rótulo final
    const anc = ultimo && x(i) + lbl.length * 3.6 > W - 2 ? "end" : "middle";
    g += `<text x="${x(i)}" y="${H - 8}" text-anchor="${anc}" class="viz-ax">${esc(lbl)}</text>`;
  });
  if (o.banda) {
    const idx = o.banda.alto.map((v, i) => (v !== null && o.banda!.bajo[i] !== null && isFinite(v) ? i : -1)).filter((i) => i >= 0);
    if (idx.length) {
      const up = idx.map((i) => `${x(i)},${y(o.banda!.alto[i]!)}`).join(" ");
      const dn = [...idx].reverse().map((i) => `${x(i)},${y(o.banda!.bajo[i]!)}`).join(" ");
      g += `<polygon points="${up} ${dn}" fill="${o.banda.color}" opacity=".16"/>`;
    }
  }
  const finales: { y: number; txt: string; color: string }[] = [];
  for (const s of o.series) {
    let d = "", pen = false;
    s.valores.forEach((v, i) => {
      if (v === null || !isFinite(v)) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    const dash = s.estilo === "guion" ? 'stroke-dasharray="6 4"' : s.estilo === "punto" ? 'stroke-dasharray="2 4" stroke-linecap="round"' : "";
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${dash}/>`;
    const nn = s.valores.filter((v) => v !== null).length;
    if (nn === 1) { const i = s.valores.findIndex((v) => v !== null); g += `<circle cx="${x(i)}" cy="${y(s.valores[i]!)}" r="4" fill="${s.color}"/>`; }
    if (s.etiquetaFinal) {
      let li = -1;
      s.valores.forEach((v, i) => { if (v !== null && isFinite(v)) li = i; });
      if (li >= 0) finales.push({ y: y(s.valores[li]!), txt: s.label, color: s.color });
    }
  }
  // etiquetas directas al final, sin colisión
  finales.sort((a, b) => a.y - b.y);
  for (let i = 1; i < finales.length; i++) if (finales[i].y - finales[i - 1].y < 13) finales[i].y = finales[i - 1].y + 13;
  for (const f of finales) g += `<text x="${W - R + 8}" y="${f.y + 4}" class="viz-lbl">${esc(f.txt.length > 16 ? f.txt.slice(0, 15) + "…" : f.txt)}</text>`;
  if (o.actual !== undefined && o.actual >= 0) {
    const s0 = o.series[0], v = s0.valores[o.actual];
    if (v !== null && v !== undefined) g += `<circle cx="${x(o.actual)}" cy="${y(v)}" r="5" fill="${s0.color}" stroke="#fff" stroke-width="2"/><text x="${x(o.actual)}" y="${y(v) - 10}" text-anchor="middle" class="viz-val">${esc(fmt(v))}</text>`;
  }
  // capa de hover: una columna por x
  const cw = n <= 1 ? W - L - R : (W - L - R) / (n - 1);
  o.xs.forEach((lbl, i) => {
    const filas = o.series.filter((s) => s.valores[i] !== null && s.valores[i] !== undefined && isFinite(s.valores[i]!)).map((s) => `${s.label}: ${fmt(s.valores[i]!)}`);
    if (o.banda && o.banda.bajo[i] !== null && isFinite(o.banda.bajo[i]!)) filas.push(`${o.banda.label}: ${fmt(o.banda.bajo[i]!)} – ${fmt(o.banda.alto[i]!)}`);
    if (!filas.length) return;
    g += `<g class="viz-hit" data-tip="${esc(lbl + "\n" + filas.join("\n"))}"><rect x="${x(i) - cw / 2}" y="${T}" width="${cw}" height="${H - T - B}" fill="transparent"/><line class="viz-xh" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/></g>`;
  });
  const items = o.series.map((s) => ({ label: s.label, color: s.color, estilo: s.estilo }));
  if (o.banda) items.push({ label: o.banda.label, color: o.banda.color, estilo: undefined, tipo: "banda" } as any);
  const tabla = tablaDatos(["Período", ...o.series.map((s) => s.label), ...(o.banda ? [o.banda.label + " (mín.)", o.banda.label + " (máx.)"] : [])],
    o.xs.map((lbl, i) => [lbl, ...o.series.map((s) => s.valores[i]), ...(o.banda ? [o.banda.bajo[i], o.banda.alto[i]] : [])]), fmt);
  return `<figure class="viz"><figcaption>${esc(o.titulo)}${o.unidad ? ` <span class="muted">· ${esc(o.unidad)}</span>` : ""}</figcaption>
    ${o.series.length > 1 || o.banda ? leyenda(items as any) : ""}${o.leyendaExtra || ""}
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.titulo)}" class="viz-svg">${g}</svg>${tabla}</figure>`;
}

function tablaDatos(cab: string[], filas: any[][], fmt: (v: number) => string) {
  return `<details class="viz-table"><summary>Ver tabla de datos</summary><div class="matrix-wrap"><table class="matrix"><thead><tr>${cab.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${filas
    .map((f) => `<tr>${f.map((v, i) => (i === 0 ? `<td>${esc(v)}</td>` : `<td class="num${typeof v === "number" && v < -0.004 ? " neg" : ""}">${v === null || v === undefined || (typeof v === "number" && !isFinite(v)) ? "—" : typeof v === "number" ? esc(fmt(v)) : esc(v)}</td>`)).join("")}</tr>`)
    .join("")}</tbody></table></div></details>`;
}

const barraH = (x0: number, y0: number, w: number, h: number) => {
  // extremo de datos redondeado (4 px), base recta
  const r = Math.min(4, w / 2, h / 2);
  if (w <= 0.5) return "";
  return `M${x0},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${y0 + h - r}Q${x0 + w},${y0 + h} ${x0 + w - r},${y0 + h}H${x0}Z`;
};

/** Barras horizontales (magnitud / ranking). */
export function barrasH(titulo: string, items: { label: string; valor: number; color: string; nota?: string; tip?: string }[], fmt = (v: number) => fmtNum(v, 2), leyendaItems?: { label: string; color: string }[], unidad?: string, ancho = 760) {
  if (!items.length) return `<div class="empty small">Sin datos.</div>`;
  const W = ancho, fila = 26, bh = 16, T = 4;
  const corta = (t: string) => (t.length > 46 ? t.slice(0, 45) + "…" : t);
  const L = Math.min(Math.round(W * 0.4), Math.max(160, Math.max(...items.map((i) => corta(i.label).length)) * 6.7 + 18));
  const R = Math.max(90, Math.max(...items.map((i) => (fmt(i.valor) + (i.nota ? " " + i.nota : "")).length)) * 6.9 + 14);
  const H = T + items.length * fila + 4;
  const max = Math.max(...items.map((i) => Math.abs(i.valor)), 1e-9);
  let g = `<line x1="${L}" x2="${L}" y1="0" y2="${H}" stroke="${COL.grid}"/>`;
  items.forEach((it, k) => {
    const y0 = T + k * fila + (fila - bh) / 2;
    const w = (Math.max(0, it.valor) / max) * (W - L - R);
    const maxCh = Math.floor((L - 14) / 6.7), lbl = it.label.length > maxCh ? it.label.slice(0, maxCh - 1) + "…" : it.label;
    g += `<text x="${L - 8}" y="${y0 + bh - 4}" text-anchor="end" class="viz-ax-ink">${esc(lbl)}</text>`;
    g += `<path d="${barraH(L, y0, w, bh)}" fill="${it.color}"/>`;
    g += `<text x="${L + w + 6}" y="${y0 + bh - 4}" class="viz-val">${esc(fmt(it.valor))}${it.nota ? ` <tspan class="viz-ax">${esc(it.nota)}</tspan>` : ""}</text>`;
    g += `<rect class="viz-hit" x="0" y="${T + k * fila}" width="${W}" height="${fila}" fill="transparent" data-tip="${esc(it.tip || it.label + "\n" + fmt(it.valor))}"/>`;
  });
  return `<figure class="viz"><figcaption>${esc(titulo)}${unidad ? ` <span class="muted">· ${esc(unidad)}</span>` : ""}</figcaption>${leyendaItems ? leyenda(leyendaItems.map((l) => ({ ...l, tipo: "barra" as const }))) : ""}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}" class="viz-svg">${g}</svg></figure>`;
}

/** Columnas divergentes alrededor de cero (p. ej. variación vs presupuesto). */
export function columnasDiv(titulo: string, xs: string[], vals: number[], fmt = (v: number) => fmtNum(v, 2), etiquetas = { pos: "Por encima del presupuesto (desfavorable)", neg: "Por debajo del presupuesto (favorable)" }, tips?: string[], ancho = 760) {
  if (!vals.length) return `<div class="empty small">Sin datos.</div>`;
  const W = ancho, H = 230, L = 64, R = 16, T = 12, B = 30;
  const sc = nice(Math.min(0, ...vals), Math.max(0, ...vals));
  const y = (v: number) => T + (H - T - B) * (1 - (v - sc.lo) / (sc.hi - sc.lo || 1));
  const n = vals.length, slot = (W - L - R) / n, bw = Math.min(24, slot - 2);
  let g = "";
  const rot = rotulosEje(sc.ticks);
  for (const t of sc.ticks) g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? COL.axis : COL.grid}" stroke-width="1"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" class="viz-ax">${esc(rot.get(t) || corto(t))}</text>`;
  const paso = Math.max(1, Math.ceil(n / 12));
  vals.forEach((v, i) => {
    const cx = L + slot * i + slot / 2, x0 = cx - bw / 2, y0 = y(0), yv = y(v), r = Math.min(4, Math.abs(yv - y0) / 2, bw / 2);
    const col = v > 0 ? COL.desf : COL.fav;
    const d = v >= 0
      ? `M${x0},${y0}V${yv + r}Q${x0},${yv} ${x0 + r},${yv}H${x0 + bw - r}Q${x0 + bw},${yv} ${x0 + bw},${yv + r}V${y0}Z`
      : `M${x0},${y0}V${yv - r}Q${x0},${yv} ${x0 + r},${yv}H${x0 + bw - r}Q${x0 + bw},${yv} ${x0 + bw},${yv - r}V${y0}Z`;
    if (Math.abs(yv - y0) > 0.5) g += `<path d="${d}" fill="${col}"/>`;
    if (i % paso === 0 || i === n - 1) g += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="viz-ax">${esc(xs[i])}</text>`;
    g += `<rect class="viz-hit" x="${cx - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent" data-tip="${esc(tips?.[i] || xs[i] + "\n" + fmt(v))}"/>`;
  });
  const tabla = tablaDatos(["Período", "Variación"], xs.map((x, i) => [x, vals[i]]), fmt);
  return `<figure class="viz"><figcaption>${esc(titulo)}</figcaption>${leyenda([{ label: etiquetas.pos, color: COL.desf, tipo: "barra" }, { label: etiquetas.neg, color: COL.fav, tipo: "barra" }])}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}" class="viz-svg">${g}</svg>${tabla}</figure>`;
}

/** Instala el tooltip de la capa de hover (una vez por raíz). */
export function instalarTooltip(root: HTMLElement) {
  const tip = document.createElement("div");
  tip.className = "viz-tip";
  tip.setAttribute("role", "status");
  document.body.appendChild(tip);
  root.addEventListener("mousemove", (e) => {
    const t = (e.target as Element).closest?.("[data-tip]") as HTMLElement | null;
    if (!t) { tip.style.display = "none"; return; }
    const lines = (t.getAttribute("data-tip") || "").split("\n");
    tip.innerHTML = `<b>${esc(lines[0])}</b>${lines.slice(1).map((l) => `<div>${esc(l)}</div>`).join("")}`;
    tip.style.display = "block";
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = (e as MouseEvent).clientX + 14, y = (e as MouseEvent).clientY + 14;
    if (x + w > window.innerWidth - 8) x = (e as MouseEvent).clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = (e as MouseEvent).clientY - h - 14;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  });
  root.addEventListener("mouseleave", () => (tip.style.display = "none"));
}

/** Histograma (columnas contiguas con separación de 2 px) con líneas de referencia rotuladas. */
export function histograma(titulo: string, bins: { desde: number; hasta: number; n: number }[], refs: { valor: number; label: string; color: string; estilo?: "guion" | "solido" }[], fmt = (v: number) => fmtNum(v, 2), ancho = 1200, unidad?: string) {
  if (!bins.length) return `<div class="empty small">Sin datos.</div>`;
  const W = ancho, H = 276, L = 56, R = 16, T = 50, B = 30;
  const lo = Math.min(bins[0].desde, ...refs.map((r) => r.valor)), hi = Math.max(bins[bins.length - 1].hasta, ...refs.map((r) => r.valor));
  const pad = (hi - lo) * 0.02 || 1;
  const x = (v: number) => L + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (W - L - R);
  const maxN = Math.max(...bins.map((b) => b.n), 1);
  const sc = nice(0, maxN);
  const y = (n: number) => T + (H - T - B) * (1 - n / (sc.hi || 1));
  let g = "";
  for (const t of sc.ticks) g += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${COL.grid}"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" class="viz-ax">${esc(fmtNum(t, 0))}</text>`;
  const tot = bins.reduce((a, b) => a + b.n, 0);
  for (const b of bins) {
    const x0 = x(b.desde) + 1, x1 = x(b.hasta) - 1, w = Math.max(0.5, x1 - x0), y0 = y(b.n), r = Math.min(3, w / 2, (H - B - y0) / 2);
    if (b.n > 0) g += `<path d="M${x0},${H - B}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${H - B}Z" fill="${COL.s1}"/>`;
    g += `<rect class="viz-hit" x="${x0 - 1}" y="${T}" width="${w + 2}" height="${H - T - B}" fill="transparent" data-tip="${esc(`${fmt(b.desde)} – ${fmt(b.hasta)}\n${b.n} iteraciones (${fmtNum((b.n / (tot || 1)) * 100, 1)} %)`)}"/>`;
  }
  const marcas = nice(lo, hi, 6);
  const visibles = marcas.ticks.filter((t) => t >= lo - pad && t <= hi + pad), rotH = rotulosEje(visibles);
  for (const t of visibles) g += `<text x="${x(t)}" y="${H - 8}" text-anchor="middle" class="viz-ax">${esc(rotH.get(t) || corto(t))}</text>`;
  const ord = [...refs].sort((a, b) => a.valor - b.valor);
  const finFila: number[] = [-1e9, -1e9, -1e9]; // borde derecho ocupado en cada fila de rótulos
  for (const r of ord) {
    const xr = x(r.valor), ancho = (r.label.length + 7) * 6.6, ini = xr - ancho / 2;
    let fila = finFila.findIndex((f) => ini > f + 6);
    if (fila < 0) fila = finFila.indexOf(Math.min(...finFila));
    finFila[fila] = xr + ancho / 2;
    g += `<line x1="${xr}" x2="${xr}" y1="${T - 4}" y2="${H - B}" stroke="${r.color}" stroke-width="2" ${r.estilo === "guion" ? 'stroke-dasharray="6 4"' : ""}/>`;
    g += `<text x="${xr}" y="${T - 8 - fila * 14}" text-anchor="middle" class="viz-lbl">${esc(r.label)} ${esc(cortoRef(r.valor))}</text>`;
  }
  return `<figure class="viz"><figcaption>${esc(titulo)}${unidad ? ` <span class="muted">· ${esc(unidad)}</span>` : ""}</figcaption>${leyenda([{ label: "Iteraciones por intervalo", color: COL.s1, tipo: "barra" }, ...refs.map((r) => ({ label: r.label, color: r.color, estilo: r.estilo }))] as any)}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}" class="viz-svg">${g}</svg></figure>`;
}

/** Barras de rango flotantes (sensibilidad «tornado» o P5–P95 por escenario) con marca central y línea de referencia. */
export function rangos(titulo: string, items: { label: string; lo: number; hi: number; centro?: number; tip?: string; color?: string }[], ref: { valor: number; label: string } | null, fmt = (v: number) => fmtNum(v, 2), ancho = 1200, unidad?: string) {
  if (!items.length) return `<div class="empty small">Sin datos.</div>`;
  const W = ancho, L = 260, R = 30, fila = 34, bh = 16, T = 22, B = 26;
  const H = T + items.length * fila + B;
  const vals = items.flatMap((i) => [i.lo, i.hi]).concat(ref ? [ref.valor] : []);
  const sc = nice(Math.min(...vals), Math.max(...vals), 6);
  const x = (v: number) => L + ((v - sc.lo) / (sc.hi - sc.lo || 1)) * (W - L - R);
  let g = "";
  const rotR = rotulosEje(sc.ticks);
  for (const t of sc.ticks) g += `<line x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}" stroke="${COL.grid}"/><text x="${x(t)}" y="${H - 8}" text-anchor="middle" class="viz-ax">${esc(rotR.get(t) || corto(t))}</text>`;
  if (ref) g += `<line x1="${x(ref.valor)}" x2="${x(ref.valor)}" y1="${T - 6}" y2="${H - B}" stroke="${COL.ppto}" stroke-width="2" stroke-dasharray="6 4"/><text x="${x(ref.valor)}" y="${T - 10}" text-anchor="middle" class="viz-lbl">${esc(ref.label)} ${esc(cortoRef(ref.valor))}</text>`;
  items.forEach((it, k) => {
    const y0 = T + k * fila + (fila - bh) / 2, a = x(Math.min(it.lo, it.hi)), b = x(Math.max(it.lo, it.hi)), w = Math.max(2, b - a);
    g += `<text x="${L - 10}" y="${y0 + bh - 4}" text-anchor="end" class="viz-ax-ink">${esc(it.label.length > 38 ? it.label.slice(0, 37) + "…" : it.label)}</text>`;
    g += `<rect x="${a}" y="${y0}" width="${w}" height="${bh}" rx="4" fill="${it.color || COL.s1}"/>`;
    if (it.centro !== undefined) g += `<circle cx="${x(it.centro)}" cy="${y0 + bh / 2}" r="5" fill="#fff" stroke="${COL.ink}" stroke-width="2"/>`;
    g += `<rect class="viz-hit" x="0" y="${T + k * fila}" width="${W}" height="${fila}" fill="transparent" data-tip="${esc(it.tip || `${it.label}\n${fmt(it.lo)} – ${fmt(it.hi)}`)}"/>`;
  });
  return `<figure class="viz"><figcaption>${esc(titulo)}${unidad ? ` <span class="muted">· ${esc(unidad)}</span>` : ""}</figcaption><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}" class="viz-svg">${g}</svg></figure>`;
}
