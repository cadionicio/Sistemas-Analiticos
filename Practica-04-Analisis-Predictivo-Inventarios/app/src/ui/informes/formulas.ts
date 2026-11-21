/**
 * Fórmulas escritas en notación LaTeX (subconjunto) → ecuaciones NATIVAS de Word (OMML, editables con el editor de ecuaciones)
 * y → imagen PNG tipografiada para el PDF. Soporta: ^{} _{} \sqrt{} \frac{}{} \bar{} \text{} \left( \right), letras griegas,
 * \cdot \times \max \min \sum \ge \le \pm.
 */
import { Math as MathW, MathFraction, MathRadical, MathRun, MathSubScript, MathSubSuperScript, MathSuperScript, XmlComponent, XmlAttributeComponent } from 'docx';

/** Acento de barra (m:acc) de OMML, que la librería docx no trae: produce la notación \bar{d} nativa de Word. */
class AtribVal extends XmlAttributeComponent<{ val: string }> { protected readonly xmlKeys = { val: 'm:val' }; }
class MathAcento extends XmlComponent {
  constructor(hijos: XmlComponent[], chr = '\u203E') {
    super('m:acc');
    const pr = new (class extends XmlComponent { constructor() { super('m:accPr'); const c = new (class extends XmlComponent { constructor() { super('m:chr'); this.root.push(new AtribVal({ val: chr })); } })(); this.root.push(c); } })();
    const e = new (class extends XmlComponent { constructor() { super('m:e'); hijos.forEach((h) => this.root.push(h)); } })();
    this.root.push(pr); this.root.push(e);
  }
}

type Nodo =
  | { k: 'txt'; s: string; recto?: boolean }
  | { k: 'sup'; b: Nodo[]; sup: Nodo[] } | { k: 'sub'; b: Nodo[]; sub: Nodo[] } | { k: 'subsup'; b: Nodo[]; sub: Nodo[]; sup: Nodo[] }
  | { k: 'sqrt'; c: Nodo[] } | { k: 'frac'; n: Nodo[]; d: Nodo[] } | { k: 'bar'; c: Nodo[] } | { k: 'par'; c: Nodo[] };

const GRIEGO: Record<string, string> = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', sigma: 'σ', mu: 'μ', lambda: 'λ', theta: 'θ', Delta: 'Δ', Sigma: 'Σ', rho: 'ρ' };
const SIMBOLO: Record<string, string> = { cdot: '·', times: '×', ge: '≥', le: '≤', pm: '±', sum: '∑', to: '→', approx: '≈', infty: '∞', ',': ' ', ' ': ' ', ';': ' ', quad: '  ' };
const FUNC: Record<string, string> = { max: 'máx', min: 'mín', log: 'log', ln: 'ln' };

/** Analizador de LaTeX (subconjunto) a un árbol de nodos. */
export function parsear(tex: string): Nodo[] {
  tex = tex.replace(/\\left\(/g, '(').replace(/\\right\)/g, ')');
  let i = 0;
  const grupo = (): Nodo[] => {
    while (tex[i] === ' ') i++;
    if (tex[i] === '{') { i++; const r = secuencia('}'); i++; return r; }
    return atomo() ?? [];
  };
  const atomo = (): Nodo[] | null => {
    const c = tex[i];
    if (c === '\\') {
      i++;
      let cmd = '';
      if (/[a-zA-Z]/.test(tex[i])) while (i < tex.length && /[a-zA-Z]/.test(tex[i])) cmd += tex[i++]; else cmd = tex[i++];
      if (cmd === 'sqrt') return [{ k: 'sqrt', c: grupo() }];
      if (cmd === 'frac') { const n = grupo(); return [{ k: 'frac', n, d: grupo() }]; }
      if (cmd === 'bar' || cmd === 'overline') return [{ k: 'bar', c: grupo() }];
      if (cmd === 'text' || cmd === 'mathrm') { i++; let s = ''; while (tex[i] !== '}') s += tex[i++]; i++; return [{ k: 'txt', s, recto: true }]; }
      if (GRIEGO[cmd]) return [{ k: 'txt', s: GRIEGO[cmd] }];
      if (SIMBOLO[cmd] !== undefined) return [{ k: 'txt', s: SIMBOLO[cmd], recto: true }];
      if (FUNC[cmd]) return [{ k: 'txt', s: FUNC[cmd], recto: true }];
      return [{ k: 'txt', s: cmd, recto: true }];
    }
    if (c === '(') { i++; const r = secuencia(')'); i++; return [{ k: 'par', c: r }]; }
    i++;
    if (c === ' ') return [];
    return [{ k: 'txt', s: c, recto: !/[a-zA-Z]/.test(c) }];
  };
  const secuencia = (fin: string): Nodo[] => {
    const out: Nodo[] = [];
    while (i < tex.length && tex[i] !== fin) {
      if (tex[i] === '^' || tex[i] === '_') {
        const op = tex[i++]; const arg = grupo(); const base = out.pop();
        const b: Nodo[] = base ? [base] : [];
        if (base?.k === 'sub' && op === '^') out.push({ k: 'subsup', b: base.b, sub: base.sub, sup: arg });
        else if (base?.k === 'sup' && op === '_') out.push({ k: 'subsup', b: base.b, sub: arg, sup: base.sup });
        else out.push(op === '^' ? { k: 'sup', b, sup: arg } : { k: 'sub', b, sub: arg });
        continue;
      }
      const a = atomo(); if (a) out.push(...a);
    }
    // Une letras consecutivas en un solo texto (las variables de varias letras como LT, SS, EOQ).
    const unido: Nodo[] = [];
    for (const n of out) {
      const u = unido.at(-1);
      if (n.k === 'txt' && u?.k === 'txt' && !!u.recto === !!n.recto) u.s += n.s; else unido.push(n.k === 'txt' ? { ...n } : n);
    }
    return unido;
  };
  return secuencia('\u0000');
}

// ---------------- Word (OMML nativo) ----------------
type Comp = MathAcento | MathRun | MathFraction | MathRadical | MathSuperScript | MathSubScript | MathSubSuperScript;
function aOMML(ns: Nodo[]): Comp[] {
  return ns.flatMap((n): Comp[] => {
    switch (n.k) {
      case 'txt': return [new MathRun(n.s)];
      case 'sup': return [new MathSuperScript({ children: aOMML(n.b), superScript: aOMML(n.sup) })];
      case 'sub': return [new MathSubScript({ children: aOMML(n.b), subScript: aOMML(n.sub) })];
      case 'subsup': return [new MathSubSuperScript({ children: aOMML(n.b), subScript: aOMML(n.sub), superScript: aOMML(n.sup) })];
      case 'sqrt': return [new MathRadical({ children: aOMML(n.c) })];
      case 'frac': return [new MathFraction({ numerator: aOMML(n.n), denominator: aOMML(n.d) })];
      case 'bar': return [new MathAcento(aOMML(n.c) as unknown as XmlComponent[])];
      case 'par': return [new MathRun('('), ...aOMML(n.c), new MathRun(')')]; // paréntesis literales: se ven igual en Word y en LibreOffice
    }
  });
}
/** Ecuación nativa de Word a partir de LaTeX. */
export const ecuacionWord = (tex: string) => new MathW({ children: aOMML(parsear(tex)) });

// ---------------- PNG tipografiado (para el PDF) ----------------
interface Caja { w: number; a: number; d: number; dibujar: (c: CanvasRenderingContext2D, x: number, y: number) => void }
const FUENTE = '"Cambria Math", "Cambria", "Times New Roman", serif';
function cajaFila(c: CanvasRenderingContext2D, ns: Nodo[], t: number): Caja {
  const cs = ns.map((n) => caja(c, n, t));
  const w = cs.reduce((s, x) => s + x.w, 0), a = Math.max(t * 0.72, ...cs.map((x) => x.a)), d = Math.max(t * 0.22, ...cs.map((x) => x.d));
  return { w, a, d, dibujar: (g, x, y) => { let xx = x; for (const k of cs) { k.dibujar(g, xx, y); xx += k.w; } } };
}
function caja(c: CanvasRenderingContext2D, n: Nodo, t: number): Caja {
  switch (n.k) {
    case 'txt': {
      const partes = [...n.s].map((ch) => ({ ch, it: !n.recto && /[a-zA-Zα-ω]/.test(ch) }));
      const esp = (ch: string) => ('=+−-·×≥≤±'.includes(ch) ? t * 0.22 : 0);
      const ws = partes.map((p) => { c.font = `${p.it ? 'italic ' : ''}${t}px ${FUENTE}`; return c.measureText(p.ch === '-' ? '−' : p.ch).width + 2 * esp(p.ch); });
      return { w: ws.reduce((s, x) => s + x, 0), a: t * 0.72, d: t * 0.22, dibujar: (g, x, y) => {
        let xx = x; partes.forEach((p, k) => { g.font = `${p.it ? 'italic ' : ''}${t}px ${FUENTE}`; g.fillText(p.ch === '-' ? '−' : p.ch, xx + esp(p.ch), y); xx += ws[k]; });
      } };
    }
    case 'sup': case 'sub': case 'subsup': {
      const b = cajaFila(c, n.b, t);
      const sp = n.k !== 'sub' ? cajaFila(c, (n as { sup: Nodo[] }).sup, t * 0.68) : null;
      const sb = n.k !== 'sup' ? cajaFila(c, (n as { sub: Nodo[] }).sub, t * 0.68) : null;
      const w = b.w + Math.max(sp?.w ?? 0, sb?.w ?? 0) + t * 0.05;
      return { w, a: Math.max(b.a, sp ? t * 0.42 + sp.a : 0), d: Math.max(b.d, sb ? t * 0.22 + sb.d : 0), dibujar: (g, x, y) => {
        b.dibujar(g, x, y); sp?.dibujar(g, x + b.w + t * 0.04, y - t * 0.42); sb?.dibujar(g, x + b.w + t * 0.02, y + t * 0.22);
      } };
    }
    case 'sqrt': {
      const b = cajaFila(c, n.c, t), pre = t * 0.62, sobre = t * 0.14;
      return { w: b.w + pre + t * 0.12, a: b.a + sobre + 2, d: b.d + 2, dibujar: (g, x, y) => {
        g.lineWidth = Math.max(1.2, t / 18); g.beginPath();
        g.moveTo(x + t * 0.05, y - b.a * 0.35); g.lineTo(x + pre * 0.35, y - b.a * 0.5); g.lineTo(x + pre * 0.6, y + b.d); g.lineTo(x + pre, y - b.a - sobre); g.lineTo(x + pre + b.w + t * 0.08, y - b.a - sobre); g.stroke();
        b.dibujar(g, x + pre + t * 0.04, y);
      } };
    }
    case 'frac': {
      const nu = cajaFila(c, n.n, t * 0.9), de = cajaFila(c, n.d, t * 0.9), eje = t * 0.3, pad = t * 0.15;
      const w = Math.max(nu.w, de.w) + 2 * pad;
      return { w: w + t * 0.1, a: eje + nu.d + nu.a + t * 0.12, d: de.a + de.d - eje + t * 0.12, dibujar: (g, x, y) => {
        g.lineWidth = Math.max(1, t / 20); g.beginPath(); g.moveTo(x + t * 0.05, y - eje); g.lineTo(x + t * 0.05 + w, y - eje); g.stroke();
        nu.dibujar(g, x + t * 0.05 + (w - nu.w) / 2, y - eje - nu.d - t * 0.1); de.dibujar(g, x + t * 0.05 + (w - de.w) / 2, y - eje + de.a + t * 0.1);
      } };
    }
    case 'bar': {
      const b = cajaFila(c, n.c, t);
      return { w: b.w, a: b.a + t * 0.12, d: b.d, dibujar: (g, x, y) => { b.dibujar(g, x, y); g.lineWidth = Math.max(1, t / 20); g.beginPath(); g.moveTo(x + b.w * 0.15, y - b.a + t * 0.05); g.lineTo(x + b.w * 0.95, y - b.a + t * 0.05); g.stroke(); } };
    }
    case 'par': {
      const b = cajaFila(c, n.c, t); c.font = `${t}px ${FUENTE}`; const wp = c.measureText('(').width;
      return { w: b.w + 2 * wp, a: b.a, d: b.d, dibujar: (g, x, y) => {
        const esc = (b.a + b.d) / (t * 0.94);
        g.save(); g.font = `${t}px ${FUENTE}`; g.translate(x, y + b.d - (b.a + b.d)); g.scale(1, esc); g.fillText('(', 0, t * 0.72 + 0.02 * t); g.fillText(')', wp + b.w, t * 0.72 + 0.02 * t); g.restore();
        b.dibujar(g, x + wp, y);
      } };
    }
  }
}
/** PNG de la fórmula (fondo blanco) y su tamaño en píxeles. */
export function ecuacionPNG(tex: string, t = 44): { dataUrl: string; w: number; h: number } {
  const cv = document.createElement('canvas'), c = cv.getContext('2d')!;
  const k = cajaFila(c, parsear(tex), t), m = t * 0.25;
  cv.width = Math.ceil(k.w + 2 * m); cv.height = Math.ceil(k.a + k.d + 2 * m);
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = '#111111'; c.strokeStyle = '#111111'; c.textBaseline = 'alphabetic';
  k.dibujar(c, m, m + k.a);
  return { dataUrl: cv.toDataURL('image/png'), w: cv.width, h: cv.height };
}
