/**
 * Gráficos interactivos (ECharts, módulos mínimos): tooltip en todos, zoom en series de tiempo,
 * exportar PNG y "Ver tabla" en cada gráfico. Colores tomados de los tokens del tema (claro/oscuro).
 */
import * as echarts from 'echarts/core';
import { LineChart, BarChart, CustomChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { esc, fmtNum, mesCorto, nuevoId, trasPintar } from './componentes';
import { guardarDataUrl } from './host';

echarts.use([LineChart, BarChart, CustomChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, MarkAreaComponent, CanvasRenderer]);

const activos = new Set<echarts.ECharts>();
(globalThis as unknown as { __graficos: Set<echarts.ECharts> }).__graficos = activos; // gancho de pruebas E2E (solo lectura)
export function liberarGraficos(): void { activos.forEach((c) => c.dispose()); activos.clear(); }
window.addEventListener('resize', () => activos.forEach((c) => c.resize()));

export function tema() {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return { s1: v('--s1'), s2: v('--s2'), s3: v('--s3'), s4: v('--s4'), b100: v('--b100'), b200: v('--b200'), txt: v('--txt'), txt2: v('--txt-2'), txt3: v('--txt-3'), borde: v('--borde'), sup: v('--sup'),
    ok: v('--ok'), warn: v('--warn'), crit: v('--crit'), serio: v('--serio') };
}
const base = () => {
  const t = tema();
  return {
    animationDuration: 350, animationDurationUpdate: 250,
    textStyle: { fontFamily: '"Segoe UI", system-ui, sans-serif', color: t.txt2 },
    color: [t.s1, t.s2, t.s3, t.s4, t.txt3],
    tooltip: { trigger: 'axis', backgroundColor: t.sup, borderColor: t.borde, textStyle: { color: t.txt, fontSize: 12 }, confine: true },
    legend: { top: 0, left: 0, textStyle: { color: t.txt2, fontSize: 12 }, itemWidth: 14, itemHeight: 8 },
    grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
  };
};
const ejeY = (fmt: (v: number) => string, escala = false) => { const t = tema(); return { type: 'value', axisLabel: { formatter: fmt, color: t.txt3 }, splitLine: { lineStyle: { color: t.borde } }, scale: escala }; };
const ejeX = (datos: string[]) => { const t = tema(); return { type: 'category', data: datos, axisLabel: { color: t.txt3, formatter: mesCorto }, axisLine: { lineStyle: { color: t.borde } }, axisTick: { show: false } }; };

export interface TablaGrafico { cols: string[]; filas: (string | number)[][] }
/** Contenedor de gráfico con barra: PNG + Ver tabla. `opcion` se evalúa al montar (con los colores del tema vigente). */
export function grafico(opcion: () => EChartsCoreOption, opc: { clase?: string; nombre: string; tabla?: TablaGrafico; alClic?: (p: { name: string; seriesName: string }) => void }): string {
  const id = nuevoId('gr');
  trasPintar(() => {
    const el = document.getElementById(id); if (!el) return;
    const c = echarts.init(el.querySelector('.grafico') as HTMLElement, undefined, { renderer: 'canvas' });
    c.setOption({ ...base(), ...opcion() } as EChartsCoreOption);
    activos.add(c);
    if (opc.alClic) c.on('click', (p) => opc.alClic!(p as never));
    el.querySelector('.png')!.addEventListener('click', () => guardarDataUrl(`${opc.nombre}.png`, c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: tema().sup })));
    el.querySelector('.vt')?.addEventListener('click', (e) => {
      const caja = el.querySelector('.vt-caja') as HTMLElement; const b = e.target as HTMLButtonElement;
      const ver = caja.hidden; caja.hidden = !ver; b.textContent = ver ? '📈 Ver gráfico' : '▦ Ver tabla';
      (el.querySelector('.grafico') as HTMLElement).style.display = ver ? 'none' : '';
      if (!ver) c.resize();
    });
  });
  const t = opc.tabla;
  return `<div id="${id}" class="caja-grafico"><div class="fila" style="justify-content:flex-end;gap:6px;margin:-4px 0 4px">
      ${t ? '<button class="btn chico vt" title="Ver los datos del gráfico como tabla">▦ Ver tabla</button>' : ''}<button class="btn chico png" title="Exportar el gráfico como imagen PNG">⬇ PNG</button></div>
    <div class="grafico ${opc.clase ?? ''}"></div>
    ${t ? `<div class="vt-caja tabla-caja" hidden style="max-height:340px"><table class="t"><thead><tr>${t.cols.map((c, i) => `<th class="${i ? 'n' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${t.filas.map((f) => `<tr>${f.map((v, i) => `<td class="${i ? 'n' : ''}">${typeof v === 'number' ? fmtNum(v, 2) : esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}</div>`;
}

// ---------------- Constructores de opciones ----------------
export interface BandaMes { p025?: number; p10: number; p50: number; p90: number; p975?: number }
/** Historia + abanico del pronóstico (P10–P90 y P2.5–P97.5) con línea P50. */
export function opAbanico(hist: { periodo: string; valor: number }[], horiz: string[], bandas: BandaMes[], fmt: (v: number) => string, ventanaHist = 36) {
  return () => {
    const t = tema();
    const h = hist.slice(-ventanaHist);
    const x = [...h.map((p) => p.periodo), ...horiz];
    const nH = h.length, pad = (arr: (number | null)[]) => [...new Array(nH - 1).fill(null), h[nH - 1].valor, ...arr];
    const lo80 = pad(bandas.map((b) => b.p10)), an80 = pad(bandas.map((b) => b.p90 - b.p10)).map((v, i) => (i === nH - 1 ? 0 : v));
    const lo95 = pad(bandas.map((b) => b.p025 ?? b.p10)), an95 = pad(bandas.map((b) => (b.p975 ?? b.p90) - (b.p025 ?? b.p10))).map((v, i) => (i === nH - 1 ? 0 : v));
    return {
      legend: { top: 0, left: 0, data: ['Real', 'P50 proyectado', 'P10–P90 (80 %)', 'P2.5–P97.5 (95 %)'], textStyle: { color: t.txt2 } },
      tooltip: { trigger: 'axis', formatter: (ps: { axisValue: string; seriesName: string; value: number | null; dataIndex: number }[]) => {
        const i = ps[0].dataIndex, per = x[i];
        if (i < nH) return `<b>${mesCorto(per)}</b><br/>Real: ${fmt(h[i].valor)}`;
        const b = bandas[i - nH];
        return `<b>${mesCorto(per)}</b> (proyección)<br/>P50: <b>${fmt(b.p50)}</b><br/>P10–P90: ${fmt(b.p10)} – ${fmt(b.p90)}${b.p025 != null ? `<br/>P2.5–P97.5: ${fmt(b.p025)} – ${fmt(b.p975!)}` : ''}`;
      } },
      xAxis: ejeX(x), yAxis: ejeY(fmt, Math.min(...lo95.filter((v): v is number => v != null)) > 0.3 * Math.max(...h.map((p) => p.valor))),
      dataZoom: [{ type: 'inside' }],
      series: [
        { name: 'b95', type: 'line', stack: 'b95', data: lo95, lineStyle: { opacity: 0 }, symbol: 'none', silent: true },
        { name: 'P2.5–P97.5 (95 %)', type: 'line', stack: 'b95', data: an95, lineStyle: { opacity: 0 }, symbol: 'none', areaStyle: { color: t.b100, opacity: 0.55 }, itemStyle: { color: t.b100 }, silent: true },
        { name: 'b80', type: 'line', stack: 'b80', data: lo80, lineStyle: { opacity: 0 }, symbol: 'none', silent: true },
        { name: 'P10–P90 (80 %)', type: 'line', stack: 'b80', data: an80, lineStyle: { opacity: 0 }, symbol: 'none', areaStyle: { color: t.b200, opacity: 0.75 }, itemStyle: { color: t.b200 }, silent: true },
        { name: 'Real', type: 'line', data: [...h.map((p) => p.valor), ...horiz.map(() => null)], symbol: 'none', lineStyle: { width: 2, color: t.s1 }, itemStyle: { color: t.s1 },
          markLine: { silent: true, symbol: 'none', lineStyle: { color: t.txt3, type: 'dashed' }, label: { formatter: 'Proyección →', color: t.txt3, position: 'insideEndTop' }, data: [{ xAxis: nH - 1 }] } },
        { name: 'P50 proyectado', type: 'line', data: pad(bandas.map((b) => b.p50)), symbol: 'circle', symbolSize: 5, lineStyle: { width: 2, type: 'dashed', color: t.s1 }, itemStyle: { color: t.s1 } },
      ],
    };
  };
}

export function opLineas(x: string[], series: { nombre: string; datos: (number | null)[]; color?: string; area?: boolean; eje?: number }[], fmt: (v: number) => string, fmt2?: (v: number) => string) {
  return () => {
    const t = tema();
    return {
      legend: { top: 0, left: 0, textStyle: { color: t.txt2 } },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => (v == null ? '—' : fmt(v)) },
      xAxis: ejeX(x), yAxis: fmt2 ? [ejeY(fmt), { ...ejeY(fmt2), splitLine: { show: false } }] : ejeY(fmt),
      dataZoom: [{ type: 'inside' }],
      series: series.map((s) => ({ name: s.nombre, type: 'line', data: s.datos, symbol: 'none', smooth: false, yAxisIndex: s.eje ?? 0, lineStyle: { width: 2, color: s.color }, itemStyle: { color: s.color }, areaStyle: s.area ? { opacity: 0.12 } : undefined })),
    };
  };
}

export function opBarras(x: string[], series: { nombre: string; datos: number[]; color?: string; pila?: string }[], fmt: (v: number) => string, opc: { horizontal?: boolean; etiquetas?: boolean; colorPorValor?: (v: number) => string; mesesX?: boolean } = {}) {
  return () => {
    const t = tema();
    const cat = { type: 'category', data: x, axisLabel: { color: t.txt2, formatter: opc.mesesX ? mesCorto : undefined, interval: opc.horizontal ? 0 : 'auto' }, axisLine: { lineStyle: { color: t.borde } }, axisTick: { show: false }, inverse: !!opc.horizontal };
    const val = ejeY(fmt);
    return {
      legend: series.length > 1 ? { top: 0, left: 0, textStyle: { color: t.txt2 } } : { show: false },
      grid: { left: 8, right: opc.etiquetas ? 64 : 16, top: series.length > 1 ? 32 : 10, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => fmt(v) },
      xAxis: opc.horizontal ? val : cat, yAxis: opc.horizontal ? cat : val,
      series: series.map((s) => ({ name: s.nombre, type: 'bar', stack: s.pila, data: opc.colorPorValor ? s.datos.map((v) => ({ value: v, itemStyle: { color: opc.colorPorValor!(v) } })) : s.datos,
        itemStyle: { color: s.color, borderRadius: opc.horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] }, barMaxWidth: 26,
        label: opc.etiquetas ? { show: true, position: opc.horizontal ? 'right' : 'top', formatter: (p: { value: number }) => fmt(p.value), color: t.txt2, fontSize: 11 } : undefined })),
    };
  };
}

/** Cascada (puente) — p. ej. descomposición precio-volumen-mezcla. */
export function opCascada(pasos: { nombre: string; valor: number; total?: boolean }[], fmt: (v: number) => string) {
  return () => {
    const t = tema();
    let acc = 0; const inv: number[] = [], vis: { value: number; itemStyle: { color: string } }[] = [];
    for (const p of pasos) {
      if (p.total) { inv.push(Math.min(0, p.valor)); vis.push({ value: Math.abs(p.valor), itemStyle: { color: t.s1 } }); acc = p.valor; continue; }
      const ini = acc, fin = acc + p.valor; acc = fin;
      inv.push(Math.min(ini, fin)); vis.push({ value: Math.abs(p.valor), itemStyle: { color: p.valor >= 0 ? t.ok : t.crit } });
    }
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: { dataIndex: number }[]) => `<b>${pasos[ps[0].dataIndex].nombre}</b><br/>${fmt(pasos[ps[0].dataIndex].valor)}` },
      xAxis: { type: 'category', data: pasos.map((p) => p.nombre), axisLabel: { color: t.txt2, interval: 0 }, axisTick: { show: false }, axisLine: { lineStyle: { color: t.borde } } },
      yAxis: ejeY(fmt),
      series: [
        { type: 'bar', stack: 'c', data: inv, itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, silent: true },
        { type: 'bar', stack: 'c', data: vis, barMaxWidth: 48, label: { show: true, position: 'top', color: t.txt2, fontSize: 11, formatter: (p: { dataIndex: number }) => fmt(pasos[p.dataIndex].valor) } },
      ],
    };
  };
}

/** Histograma + curva de probabilidad acumulada (eje derecho). */
export function opHistograma(bins: { desde: number; hasta: number; n: number }[], fmt: (v: number) => string, marcas: { nombre: string; valor: number }[] = []) {
  return () => {
    const t = tema();
    const total = bins.reduce((s, b) => s + b.n, 0) || 1;
    let acc = 0;
    const cdf = bins.map((b) => (acc += b.n) / total);
    const x = bins.map((b) => (b.desde + b.hasta) / 2);
    const idx = (v: number) => bins.findIndex((b) => v >= b.desde && v <= b.hasta);
    return {
      legend: { top: 0, left: 0, data: ['Frecuencia', 'Probabilidad acumulada'], textStyle: { color: t.txt2 } },
      tooltip: { trigger: 'axis', formatter: (ps: { dataIndex: number }[]) => { const b = bins[ps[0].dataIndex]; return `${fmt(b.desde)} – ${fmt(b.hasta)}<br/>Frecuencia: ${fmtNum(b.n / total * 100, 1)} %<br/>Acumulada: ${fmtNum(cdf[ps[0].dataIndex] * 100, 1)} %`; } },
      xAxis: { type: 'category', data: x.map((v) => fmt(v)), axisLabel: { color: t.txt3, hideOverlap: true }, axisTick: { show: false }, axisLine: { lineStyle: { color: t.borde } } },
      yAxis: [ejeY((v) => `${fmtNum(v / total * 100, 0)} %`), { ...ejeY((v) => `${fmtNum(v * 100, 0)} %`), max: 1, splitLine: { show: false } }],
      series: [
        { name: 'Frecuencia', type: 'bar', data: bins.map((b) => b.n), barCategoryGap: '4%', itemStyle: { color: t.s1 },
          markLine: marcas.length ? { symbol: 'none', lineStyle: { color: t.s2, type: 'dashed' }, label: { color: t.txt2, formatter: (p: { name: string }) => p.name }, data: marcas.filter((m) => idx(m.valor) >= 0).map((m) => ({ name: m.nombre, xAxis: idx(m.valor) })) } : undefined },
        { name: 'Probabilidad acumulada', type: 'line', yAxisIndex: 1, data: cdf, symbol: 'none', lineStyle: { color: t.s2, width: 2 }, itemStyle: { color: t.s2 } },
      ],
    };
  };
}

/** Tornado de sensibilidad: barras desde el valor base hacia el resultado con el factor bajo/alto. */
export function opTornado(items: { factor: string; bajo: number; alto: number; base: number }[], fmt: (v: number) => string, etiquetas = ['Factor bajo', 'Factor alto']) {
  return () => {
    const t = tema();
    const orden = [...items].sort((a, b) => Math.abs(b.alto - b.bajo) - Math.abs(a.alto - a.bajo));
    const base = orden[0]?.base ?? 0;
    return {
      legend: { top: 0, left: 0, data: etiquetas, textStyle: { color: t.txt2 } },
      grid: { left: 8, right: 70, top: 48, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (ps: { dataIndex: number }[]) => { const o = orden[ps[0].dataIndex]; return `<b>${o.factor}</b><br/>${etiquetas[0]}: ${fmt(o.bajo)}<br/>${etiquetas[1]}: ${fmt(o.alto)}<br/>Base: ${fmt(o.base)}`; } },
      xAxis: { ...ejeY((v) => `${v > 0 ? '+' : ''}${fmt(v)}`), splitNumber: 4, axisLabel: { formatter: (v: number) => `${v > 0 ? '+' : ''}${fmt(v)}`, color: t.txt3, hideOverlap: true } }, // eje: diferencia respecto a la base
      yAxis: { type: 'category', data: orden.map((o) => o.factor), inverse: true, axisLabel: { color: t.txt2, width: 170, overflow: 'break' }, axisTick: { show: false }, axisLine: { lineStyle: { color: t.borde } } },
      series: [
        { name: etiquetas[0], type: 'bar', data: orden.map((o) => o.bajo - base), stack: undefined, itemStyle: { color: t.s2 }, barGap: '-100%', barMaxWidth: 26 },
        { name: etiquetas[1], type: 'bar', data: orden.map((o) => o.alto - base), itemStyle: { color: t.s1 }, barMaxWidth: 26,
          markLine: { symbol: 'none', silent: true, lineStyle: { color: t.txt3 }, label: { formatter: `Base ${fmt(base)}`, color: t.txt2, position: 'start' }, data: [{ xAxis: 0 }] } },
      ].map((s) => ({ ...s, data: s.data.map((v) => ({ value: v, label: { position: v < 0 ? 'left' : 'right' } })),
        label: { show: true, color: t.txt2, fontSize: 11, formatter: (p: { value: number }) => fmt(base + p.value) } })), // la etiqueta muestra el valor absoluto
    };
  };
}

/**
 * Renderiza un gráfico fuera de pantalla y devuelve un PNG (para Word, PDF y respaldo de la PPT).
 * Siempre con la paleta CLARA (los documentos se imprimen sobre fondo blanco) y sin animación.
 */
export function renderizarPNG(opcion: () => EChartsCoreOption, ancho = 1000, alto = 460): string {
  const raiz = document.documentElement, temaPrevio = raiz.dataset.tema;
  raiz.dataset.tema = 'claro';
  const div = document.createElement('div');
  div.style.cssText = `position:fixed;left:-10000px;top:0;width:${ancho}px;height:${alto}px`;
  document.body.appendChild(div);
  try {
    const c = echarts.init(div, undefined, { renderer: 'canvas', width: ancho, height: alto });
    c.setOption({ ...base(), ...opcion(), animation: false, dataZoom: [] } as EChartsCoreOption);
    const url = c.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
    c.dispose();
    return url;
  } finally { div.remove(); if (temaPrevio) raiz.dataset.tema = temaPrevio; }
}
