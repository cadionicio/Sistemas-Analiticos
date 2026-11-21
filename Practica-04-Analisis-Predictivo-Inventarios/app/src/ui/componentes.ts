/**
 * Componentes de interfaz reutilizables: tarjetas KPI, tablas ordenables/filtrables/exportables,
 * insignias de estado, avisos, panel "Hallazgos del agente" y utilidades de formato.
 */
import { fmtNum, fmtMillones, fmtPct, fmtSoles } from '../core/util/util';
import { llamar } from './motor';
import { guardarArchivo } from './host';

export { fmtNum, fmtMillones, fmtPct, fmtSoles };

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** '2019-03' → 'mar 19' (formato único decidido en el PC1). */
export const mesCorto = (p: string) => (p && /^\d{4}-\d{2}/.test(p) ? `${MESES[+p.slice(5, 7) - 1]} ${p.slice(2, 4)}` : p);
export const mesLargo = (p: string) => (p && /^\d{4}-\d{2}/.test(p) ? `${MESES[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}` : p);
/** '2019-03-15' → '15/03/2019'. */
export const fechaPE = (f: string | null | undefined) => (f && /^\d{4}-\d{2}-\d{2}/.test(f) ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}${f.length > 10 ? ' ' + f.slice(11, 19) : ''}` : (f ?? '—'));
export const fmtPp = (x: number) => `${x >= 0 ? '+' : ''}${fmtNum(x * 100, 2)} pp`;
export const fmtVar = (x: number | null | undefined) => (x == null || !isFinite(x) ? '—' : `${x >= 0 ? '+' : ''}${fmtNum(x * 100, 1)} %`);
export const fmtUnid = (x: number | null | undefined, dec = 0) => (x == null ? '—' : `${fmtNum(x, dec)} unid.`);

// ---------- Ciclo de montaje: los componentes registran su inicialización tras pintar el HTML ----------
let alMontar: (() => void)[] = [];
export const trasPintar = (f: () => void) => alMontar.push(f);
export function montar(): void { const fs = alMontar; alMontar = []; fs.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }
let sec = 0;
export const nuevoId = (p = 'c') => `${p}${++sec}`;

// ---------- Insignias ----------
export type Nivel = 'ok' | 'warn' | 'serio' | 'crit' | 'info' | 'gris';
const ICONO: Record<Nivel, string> = { ok: '✔', warn: '⚠', serio: '▲', crit: '⛔', info: 'ℹ', gris: '•' };
export const insignia = (texto: string, nivel: Nivel) => `<span class="ins ${nivel}">${ICONO[nivel]} ${esc(texto)}</span>`;
const NIVEL_ESTADO: Record<string, Nivel> = {
  OK: 'ok', PROVISIONAL: 'warn', NEEDS_REVIEW: 'serio', BLOCKED: 'crit', CRITICA: 'crit', ALTA: 'serio', MEDIA: 'warn', BAJA: 'info', INFO: 'info',
  COMPROBADA: 'ok', ASOCIATIVA: 'info', A_VERIFICAR: 'warn', SIN_EVIDENCIA: 'gris',
  QUIEBRE_INMINENTE: 'crit', STOCK_NEGATIVO: 'crit', REPONER: 'warn', BAJO_PEDIDO: 'info', SOBRESTOCK: 'serio', SIN_MOVIMIENTO: 'gris',
  DATOS_VALIDADOS: 'ok', DATOS_INCOMPLETOS: 'warn', APROBADO: 'ok', PROPUESTO: 'info', EVALUADO: 'info',
};
export const insigniaEstado = (e: string, texto = e.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())) => insignia(texto, NIVEL_ESTADO[e] ?? 'gris');
export const ayuda = (texto: string) => `<span class="ayuda" title="${esc(texto)}">?</span>`;

// ---------- Tarjetas ----------
export interface Kpi { etiqueta: string; valor: string; unidadMenor?: string; delta?: string; sentido?: 'sube' | 'baja' | 'neutro'; formula?: string; semaforo?: string; id?: string }
export function tarjetaKpi(k: Kpi): string {
  return `<div class="tarjeta kpi" ${k.id ? `id="${k.id}"` : ''}>
    <div class="et">${esc(k.etiqueta)} ${k.formula ? ayuda(k.formula) : ''}</div>
    <div class="v">${esc(k.valor)}${k.unidadMenor ? ` <small>${esc(k.unidadMenor)}</small>` : ''}</div>
    <div class="d ${k.sentido ?? 'neutro'}">${k.sentido === 'sube' ? '▲ ' : k.sentido === 'baja' ? '▼ ' : ''}${esc(k.delta ?? '')} ${k.semaforo ?? ''}</div></div>`;
}
export function tarjeta(titulo: string, cuerpo: string, opc: { sub?: string; acciones?: string; clase?: string; id?: string } = {}): string {
  return `<section class="tarjeta ${opc.clase ?? ''}" ${opc.id ? `id="${opc.id}"` : ''}><header><div class="t"><h3>${esc(titulo)}</h3>${opc.sub ? `<div class="sub">${opc.sub}</div>` : ''}</div>${opc.acciones ?? ''}</header>${cuerpo}</section>`;
}
export function vacio(icono: string, titulo: string, texto: string, acciones = ''): string {
  return `<div class="tarjeta vacio"><div class="big">${icono}</div><h3>${esc(titulo)}</h3><p>${texto}</p><div class="fila" style="justify-content:center">${acciones}</div></div>`;
}
/** Panel "Hallazgos del agente": [E] evidencia, [D] diagnóstico por verificar, [S] solución propuesta. */
export function hallazgos(items: { t: 'E' | 'D' | 'S'; texto: string }[], titulo = 'Hallazgos del agente'): string {
  if (!items.length) return '';
  return `<div class="hallazgos"><h4>🤖 ${esc(titulo)}</h4><ul>${items.map((i) => `<li><span class="tag ${i.t}" title="${i.t === 'E' ? 'Evidencia de los datos' : i.t === 'D' ? 'Diagnóstico por verificar' : 'Solución propuesta'}">${i.t}</span>${i.texto}</li>`).join('')}</ul></div>`;
}

// ---------- Tablas ordenables, filtrables y exportables ----------
export interface Columna<T> { k: keyof T & string; t: string; n?: boolean; f?: (v: T[keyof T], fila: T) => string; exp?: (fila: T) => unknown }
export function tabla<T extends Record<string, unknown>>(filas: T[], cols: Columna<T>[], opc: { nombre: string; alto?: number; id?: string; buscar?: boolean } = { nombre: 'tabla' }): string {
  const id = opc.id ?? nuevoId('tb');
  let orden: { k: string; dir: 1 | -1 } | null = null;
  let filtro = '';
  const cuerpo = () => {
    let fs = filas;
    if (filtro) { const q = filtro.toLowerCase(); fs = fs.filter((r) => cols.some((c) => String(r[c.k] ?? '').toLowerCase().includes(q))); }
    if (orden) { const { k, dir } = orden; fs = [...fs].sort((a, b) => { const x = a[k] as never, y = b[k] as never; return (x == null ? 1 : y == null ? -1 : x < y ? -1 : x > y ? 1 : 0) * dir; }); }
    return { html: fs.slice(0, 1000).map((r) => `<tr>${cols.map((c) => `<td class="${c.n ? 'n' : ''}">${c.f ? c.f(r[c.k], r) : c.n && typeof r[c.k] === 'number' ? fmtNum(r[c.k] as number, 2) : esc(r[c.k])}</td>`).join('')}</tr>`).join(''), n: fs.length };
  };
  const cab = () => cols.map((c) => `<th class="${c.n ? 'n' : ''}" data-k="${c.k}">${esc(c.t)} <span class="o">${orden?.k === c.k ? (orden.dir === 1 ? '▲' : '▼') : '↕'}</span></th>`).join('');
  trasPintar(() => {
    const raiz = document.getElementById(id); if (!raiz) return;
    const pintar = () => {
      const c = cuerpo();
      raiz.querySelector('thead')!.innerHTML = `<tr>${cab()}</tr>`;
      raiz.querySelector('tbody')!.innerHTML = c.html;
      raiz.querySelector('.cuenta')!.textContent = `${fmtNum(c.n)} de ${fmtNum(filas.length)} filas${c.n > 1000 ? ' (se muestran 1,000)' : ''}`;
    };
    raiz.querySelector('thead')!.addEventListener('click', (e) => {
      const th = (e.target as HTMLElement).closest('th'); if (!th) return;
      const k = th.dataset.k!; orden = orden?.k === k ? { k, dir: (orden.dir * -1) as 1 | -1 } : { k, dir: cols.find((c) => c.k === k)?.n ? -1 : 1 }; pintar();
    });
    raiz.querySelector<HTMLInputElement>('input.buscar')?.addEventListener('input', (e) => { filtro = (e.target as HTMLInputElement).value.trim(); pintar(); });
    raiz.querySelector('.exportar')!.addEventListener('click', () => exportarExcel(opc.nombre, [{ nombre: opc.nombre.slice(0, 31), filas: filas.map((r) => Object.fromEntries(cols.map((c) => [c.t, c.exp ? c.exp(r) : r[c.k]]))) }]));
    pintar();
  });
  return `<div id="${id}"><div class="tabla-caja" style="${opc.alto ? `max-height:${opc.alto}px` : ''}"><table class="t"><thead></thead><tbody></tbody></table></div>
    <div class="tabla-pie">${opc.buscar === false ? '' : '<input class="buscar" type="text" placeholder="🔎 Filtrar filas…" />'}<span class="cuenta"></span><span style="flex:1"></span><button class="btn chico exportar" title="Exportar la tabla completa a Excel">⬇ Excel</button></div></div>`;
}

export async function exportarExcel(nombre: string, hojas: { nombre: string; filas: Record<string, unknown>[] }[]): Promise<void> {
  const bytes = await llamar<Uint8Array>('exportarXlsx', hojas);
  await guardarArchivo(`${nombre}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// ---------- Avisos ----------
export function avisar(texto: string, tipo: 'ok' | 'error' | 'warn' | 'info' = 'info', ms = 5000): void {
  let c = document.querySelector('.avisos');
  if (!c) { c = document.createElement('div'); c.className = 'avisos'; c.setAttribute('role', 'status'); document.body.appendChild(c); }
  const a = document.createElement('div');
  a.className = `aviso ${tipo}`; a.innerHTML = texto;
  c.appendChild(a);
  setTimeout(() => a.remove(), ms);
}
export function confirmar(texto: string): Promise<boolean> {
  return new Promise((ok) => {
    const v = document.createElement('div'); v.className = 'velo';
    v.innerHTML = `<div class="caja"><p style="margin-top:0">${texto}</p><div class="fila" style="justify-content:flex-end"><button class="btn" data-r="0">Cancelar</button><button class="btn primario" data-r="1">Aceptar</button></div></div>`;
    v.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) { v.remove(); ok(b.dataset.r === '1'); } });
    document.body.appendChild(v);
  });
}
