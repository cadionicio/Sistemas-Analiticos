// Gráficos SVG livianos (sin bibliotecas externas). Cada gráfico lleva título accesible y valores visibles.
import { esc, fmtMagnitud, fmtConteo } from '../nucleo/formato.js';

// Pareto: barras por categoría (minutos → horas) y línea de porcentaje acumulado
export function svgPareto(items, { etiqueta = x => x.nombre, valorH = x => x.minutos / 60, acum = x => x.pct_acum, alto = 240 } = {}) {
  if (!items.length) return '<p class="vacio centro">Sin datos para el gráfico.</p>';
  const W = 640, H = alto, m = { l: 48, r: 44, t: 14, b: 70 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const max = Math.max(...items.map(valorH)) || 1;
  const bw = iw / items.length;
  const barras = items.map((x, i) => {
    const h = ih * valorH(x) / max, xx = m.l + i * bw + bw * 0.15, yy = m.t + ih - h;
    const lab = etiqueta(x).length > 18 ? etiqueta(x).slice(0, 17) + '…' : etiqueta(x);
    return `<rect x="${xx}" y="${yy}" width="${bw * 0.7}" height="${Math.max(h, 1)}" fill="#1f5fa8" rx="2"><title>${esc(etiqueta(x))}: ${fmtMagnitud(valorH(x), 2)} h</title></rect>
      <text x="${xx + bw * 0.35}" y="${yy - 4}" text-anchor="middle" font-size="11" fill="#1d2733">${fmtMagnitud(valorH(x), 1)}</text>
      <text x="${xx + bw * 0.35}" y="${m.t + ih + 14}" text-anchor="end" font-size="11" fill="#5b6675" transform="rotate(-30 ${xx + bw * 0.35} ${m.t + ih + 14})">${esc(lab)}</text>`;
  }).join('');
  const pts = items.map((x, i) => `${m.l + i * bw + bw / 2},${m.t + ih - ih * (acum(x) || 0) / 100}`).join(' ');
  const puntos = items.map((x, i) => `<circle cx="${m.l + i * bw + bw / 2}" cy="${m.t + ih - ih * (acum(x) || 0) / 100}" r="3.5" fill="#e8590c"><title>Acumulado: ${fmtMagnitud(acum(x), 1)} %</title></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="grafico" role="img" aria-label="Pareto de horas perdidas con porcentaje acumulado">
    <line x1="${m.l}" y1="${m.t + ih}" x2="${m.l + iw}" y2="${m.t + ih}" stroke="#b8c0cc"/>
    <line x1="${m.l}" y1="${m.t + ih - ih * 0.8}" x2="${m.l + iw}" y2="${m.t + ih - ih * 0.8}" stroke="#e8590c" stroke-dasharray="4 4" opacity=".5"/>
    <text x="${m.l + iw + 4}" y="${m.t + ih - ih * 0.8 + 4}" font-size="10" fill="#e8590c">80 %</text>
    <text x="8" y="${m.t + 10}" font-size="10" fill="#5b6675">horas</text>
    ${barras}<polyline points="${pts}" fill="none" stroke="#e8590c" stroke-width="2"/>${puntos}
    <text x="${m.l + iw + 4}" y="${m.t + 8}" font-size="10" fill="#e8590c">100 %</text></svg>`;
}

// Barras horizontales simples
export function barrasH(items, { valor, etiqueta, formato = v => fmtConteo(v), color = '#1f5fa8' }) {
  const max = Math.max(1, ...items.map(valor));
  return `<div class="barras-h">${items.map(x => `<div class="bh-fila"><span class="bh-et">${esc(etiqueta(x))}</span><span class="bh-barra"><i style="width:${100 * valor(x) / max}%;background:${color}"></i></span><span class="bh-val">${formato(valor(x))}</span></div>`).join('')}</div>`;
}
