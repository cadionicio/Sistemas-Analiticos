// Gráficos SVG simples, sin dependencias ni red (funcionan en EXE y HTML offline).
export interface SerieG { nombre: string; puntos: (number | null)[]; color: string; punteada?: boolean; marcas?: boolean[] }
const fmt = (v: number) => (Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('es-PE', { maximumFractionDigits: 1 }) + ' mil' : v.toLocaleString('es-PE', { maximumFractionDigits: 1 }));

/** Líneas con huecos para valores faltantes (null): nunca se dibuja un faltante como cero. */
export function Lineas({ etiquetas, series, banda, unidad, alto = 220, separador, min0 = true }: { etiquetas: string[]; series: SerieG[]; banda?: { inf: (number | null)[]; sup: (number | null)[]; color: string }; unidad?: string; alto?: number; separador?: number; min0?: boolean }) {
  const W = 900, H = alto, L = 56, R = 12, T = 12, B = 34;
  const vals = [...series.flatMap((s) => s.puntos), ...(banda ? [...banda.inf, ...banda.sup] : [])].filter((v): v is number => v !== null && Number.isFinite(v));
  if (!vals.length || !etiquetas.length) return <p className="vacio">Sin datos para graficar en este rango.</p>;
  let max = Math.max(...vals), min = min0 ? 0 : Math.min(...vals);
  if (max === min) max = min + 1;
  const x = (i: number) => L + (etiquetas.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (etiquetas.length - 1));
  const y = (v: number) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const tramo = (pts: (number | null)[]) => { const segs: string[] = []; let cur = ''; pts.forEach((v, i) => { if (v === null) { if (cur) segs.push(cur); cur = ''; } else cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; }); if (cur) segs.push(cur); return segs; };
  const paso = Math.max(1, Math.ceil(etiquetas.length / 10));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="grafico" role="img" aria-label={series.map((s) => s.nombre).join(', ')}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => { const v = min + f * (max - min); return <g key={f}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e3e7ec" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#5b6773">{fmt(v)}</text></g>; })}
      {etiquetas.map((e, i) => i % paso === 0 && <text key={e + i} x={x(i)} y={H - 12} textAnchor="middle" fontSize="11" fill="#5b6773">{e}</text>)}
      {separador !== undefined && <g><line x1={x(separador - 0.5)} x2={x(separador - 0.5)} y1={T} y2={H - B} stroke="#8a96a3" strokeDasharray="4 4" /><text x={x(separador - 0.5) + 4} y={T + 10} fontSize="11" fill="#5b6773">pronóstico →</text></g>}
      {banda && (() => { const pts = banda.inf.map((v, i) => (v !== null && banda.sup[i] !== null ? i : -1)).filter((i) => i >= 0); if (pts.length < 2) return null;
        const d = pts.map((i, k) => `${k ? 'L' : 'M'}${x(i)},${y(banda.sup[i]!)}`).join('') + [...pts].reverse().map((i) => `L${x(i)},${y(banda.inf[i]!)}`).join('') + 'Z';
        return <path d={d} fill={banda.color} opacity={0.18} />; })()}
      {series.map((s) => tramo(s.puntos).map((d, k) => <path key={s.nombre + k} d={d} fill="none" stroke={s.color} strokeWidth={2.2} strokeDasharray={s.punteada ? '6 4' : undefined} />))}
      {series.map((s) => s.puntos.map((v, i) => v !== null && (s.marcas?.[i] || s.puntos.length < 40) ? <circle key={s.nombre + 'p' + i} cx={x(i)} cy={y(v)} r={s.marcas?.[i] ? 5 : 2.5} fill={s.marcas?.[i] ? '#c62828' : s.color}><title>{`${etiquetas[i]}: ${fmt(v)}${unidad ? ' ' + unidad : ''}`}</title></circle> : null))}
    </svg>
  );
}

/** Barras con línea de acumulado (Pareto). */
export function Pareto({ filas, alto = 240 }: { filas: { causa: string; n: number; acumulado: number }[]; alto?: number }) {
  if (!filas.length) return <p className="vacio">No hay incumplimientos en el rango.</p>;
  const W = 900, H = alto, L = 40, R = 40, T = 12, B = 64, max = Math.max(...filas.map((f) => f.n));
  const bw = (W - L - R) / filas.length;
  const y = (v: number) => T + (1 - v / max) * (H - T - B), y2 = (p: number) => T + (1 - p / 100) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="grafico" role="img" aria-label="Pareto de causas registradas">
      {filas.map((f, i) => <g key={f.causa}><rect x={L + i * bw + 4} y={y(f.n)} width={bw - 8} height={H - B - y(f.n)} fill={f.causa === 'Sin causa registrada' ? '#9aa7b4' : '#2e7d5b'}><title>{`${f.causa}: ${f.n}`}</title></rect>
        <text x={L + i * bw + bw / 2} y={y(f.n) - 4} textAnchor="middle" fontSize="11">{f.n}</text>
        <text x={L + i * bw + bw / 2} y={H - B + 14} textAnchor="middle" fontSize="10" fill="#5b6773">{f.causa.length > 18 ? f.causa.slice(0, 17) + '…' : f.causa}</text></g>)}
      <path d={filas.map((f, i) => `${i ? 'L' : 'M'}${L + i * bw + bw / 2},${y2(f.acumulado)}`).join('')} fill="none" stroke="#e08600" strokeWidth={2} />
      {filas.map((f, i) => <circle key={'c' + i} cx={L + i * bw + bw / 2} cy={y2(f.acumulado)} r={3} fill="#e08600"><title>{`Acumulado ${f.acumulado.toFixed(0)} %`}</title></circle>)}
      <text x={W - R + 4} y={y2(80) + 4} fontSize="10" fill="#e08600">80 %</text><line x1={L} x2={W - R} y1={y2(80)} y2={y2(80)} stroke="#e08600" strokeDasharray="3 3" opacity={0.5} />
    </svg>
  );
}
export function Leyenda({ items }: { items: { nombre: string; color: string; punteada?: boolean }[] }) {
  return <div className="leyenda-graf">{items.map((i) => <span key={i.nombre}><svg width="26" height="10"><line x1="0" x2="26" y1="5" y2="5" stroke={i.color} strokeWidth="3" strokeDasharray={i.punteada ? '6 4' : undefined} /></svg>{i.nombre}</span>)}</div>;
}
