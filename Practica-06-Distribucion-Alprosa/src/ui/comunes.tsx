// Componentes y utilidades de interfaz compartidos.
import { Component, createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Servicio } from './servicio';
import type { Accion } from '../core/permisos';

export interface Ctx {
  svc: Servicio; usuario: string; ocupado: boolean; ver: number;
  accion: (fn: () => Promise<unknown> | unknown, exito?: string) => Promise<void>;
  aviso: (tipo: 'ok' | 'error' | 'info', texto: string) => void;
}
export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

/** Número en formato peruano visible: «1.234,5» o «1234,5»; rechaza ambigüedades como «1.234» sin coma decimal ambigua. */
export function leerDecimal(txt: string, decimales = 3): number | null {
  const t = txt.trim().replace(/\s/g, '');
  if (!t) return null;
  let norm: string;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) norm = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)?$/.test(t)) norm = t.replace(',', '.');
  else if (/^-?\d+\.\d{1,2}$/.test(t) || /^-?\d+\.\d{4,}$/.test(t)) norm = t; // punto decimal sin ambigüedad
  else return NaN;
  const [, dec = ''] = norm.split('.');
  if (dec.length > decimales) return NaN;
  return Number(norm);
}
export const aMil = (txt: string) => { const n = leerDecimal(txt, 3); return n === null || Number.isNaN(n) ? n : Math.round(n * 1000); };

export function Pestanas<T extends string>({ items, actual, cambiar, etiqueta }: { items: { id: T; nombre: string; oculto?: boolean }[]; actual: T; cambiar: (t: T) => void; etiqueta: string }) {
  return (
    <div className="pestanas" role="tablist" aria-label={etiqueta}>
      {items.filter((i) => !i.oculto).map((i) => (
        <button key={i.id} role="tab" aria-selected={actual === i.id} className={actual === i.id ? 'activa' : ''} onClick={() => cambiar(i.id)}>{i.nombre}</button>
      ))}
    </div>
  );
}

/** Botón que muestra si el usuario activo puede ejecutar la acción; el permiso se vuelve a comprobar al confirmar. */
export function BotonAccion({ permiso, onClick, children, primario, titulo }: { permiso?: Accion; onClick: () => void; children: ReactNode; primario?: boolean; titulo?: string }) {
  const { svc, usuario, ocupado } = useApp();
  const ok = !permiso || svc.puede(usuario, permiso);
  return (
    <button className={primario ? 'primario' : ''} disabled={ocupado || !ok} onClick={onClick} title={!ok ? 'Su perfil vigente no permite esta acción' : titulo}>
      {children}
    </button>
  );
}

export function Campo({ etiqueta, error, children, ayuda }: { etiqueta: string; error?: string; children: ReactNode; ayuda?: string }) {
  return (
    <label className={'campo' + (error ? ' con-error' : '')}>
      <span>{etiqueta}</span>
      {children}
      {ayuda && <small className="nota">{ayuda}</small>}
      {error && <small className="error-campo" role="alert">{error}</small>}
    </label>
  );
}

/** Panel lateral. Si el usuario ya escribió algo y cierra con × o Escape, se pide confirmar antes de descartarlo (BP07, auditoría RC1 n.º 18). */
export function Panel({ titulo, cerrar, children }: { titulo: string; cerrar: () => void; children: ReactNode }) {
  const sucio = useRef(false);
  const intentarCerrar = async () => {
    if (!sucio.current) return cerrar();
    const r = await formulario('Hay datos sin guardar', [{ id: 'ok', tipo: 'opcion', etiqueta: `En «${titulo}» hay datos escritos que todavía no se guardaron.`, inicial: 'si', opciones: [{ valor: 'si', texto: 'Descartar lo escrito y cerrar', detalle: 'Para conservarlo, pulse «Cancelar» y luego el botón de guardar del formulario.' }] }], { aceptar: 'Descartar y cerrar' });
    if (r) cerrar();
  };
  return (
    <div className="panel-fondo" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); void intentarCerrar(); } }} onInput={() => { sucio.current = true; }} onChange={() => { sucio.current = true; }}>
      <div className="panel" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="panel-cab"><h2>{titulo}</h2><button onClick={() => void intentarCerrar()} aria-label="Cerrar">×</button></div>
        {children}
      </div>
    </div>
  );
}

export function useFiltro<T>(filas: T[], texto: (f: T) => string) {
  const [q, setQ] = useState('');
  const out = q.trim() ? filas.filter((f) => texto(f).toLowerCase().includes(q.trim().toLowerCase())) : filas;
  const caja = <input className="buscar" placeholder="Buscar…" aria-label="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />;
  const vacio = filas.length > 0 && out.length === 0 ? <p className="vacio">Ningún registro coincide con «{q}». <button onClick={() => setQ('')}>Limpiar búsqueda</button></p> : null;
  return { filas: out, caja, vacio, limpiar: () => setQ('') };
}

export const deLocal = (v: string) => (v ? (v.length === 16 ? v + ':00-05:00' : v) : '');
export const aLocal = (iso: string) => (iso ? iso.slice(0, 16) : '');
export function errores(e: unknown): Record<string, string> | null {
  const c = (e as { campos?: Record<string, string> }).campos;
  return c ?? null;
}

/** Clase CSS estándar de un estado (sin tildes ni espacios): «Reserva parcial» → «reserva-parcial». */
export const claseEstado = (estado: string) => estado.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-');
/** Leyenda de colores de estado de pedido (DEC-I04-COLORES). */
export function LeyendaEstados() {
  const e = ['Borrador', 'Confirmado', 'Reserva parcial', 'Reservado', 'En atención', 'Completado', 'Cerrado parcial', 'Cancelado', 'Atrasado'];
  return <div className="leyenda-estados" aria-label="Significado de los colores">Colores: {e.map((x) => <span key={x} className={'chip ' + claseEstado(x)}>{x}</span>)}</div>;
}

// ------------------------------------------------------------------ Formularios guiados (reemplazan cualquier «escriba aquí» libre)
// window.prompt() no existe en el EXE y además deja al usuario sin guía: cada dato se pide con su tipo, opciones, unidad, límites y validación.
export type CampoForm =
  | { id: string; tipo: 'select'; etiqueta: string; opciones: { valor: string; texto: string }[]; ayuda?: string; inicial?: string }
  | { id: string; tipo: 'motivo'; etiqueta: string; opciones: string[]; ayuda?: string; detalleObligatorio?: boolean }
  | { id: string; tipo: 'texto'; etiqueta: string; minLargo?: number; ayuda?: string; inicial?: string; opcional?: boolean; ejemplo?: string }
  | { id: string; tipo: 'numero'; etiqueta: string; unidad: string; maxMil?: number; minMil?: number; inicial?: string; ayuda?: string }
  | { id: string; tipo: 'fechaHora'; etiqueta: string; futuro?: boolean; rapidos?: { texto: string; horas: number }[]; inicial?: string; ayuda?: string; despuesDe?: string }
  | { id: string; tipo: 'fecha'; etiqueta: string; minimo?: string; inicial?: string; ayuda?: string }
  | { id: string; tipo: 'pin'; etiqueta: string; ayuda?: string }
  | { id: string; tipo: 'opcion'; etiqueta: string; opciones: { valor: string; texto: string; detalle?: string }[]; inicial?: string; ayuda?: string };
type PedidoForm = { titulo: string; explicacion?: string; aceptar?: string; campos: CampoForm[]; resolver: (v: Record<string, string> | null) => void };
let abrirForm: ((p: PedidoForm) => void) | null = null;
/** Abre un formulario guiado y devuelve los valores validados (cantidades en milésimas, fechas con hora de Lima) o null si se cancela. */
export function formulario(titulo: string, campos: CampoForm[], o: { explicacion?: string; aceptar?: string } = {}): Promise<Record<string, string> | null> {
  return new Promise((resolver) => { if (abrirForm) abrirForm({ titulo, campos, ...o, resolver }); else resolver(null); });
}
const localAhora = (horas = 0) => { const d = new Date(Date.now() + horas * 3600000 - 5 * 3600000); return d.toISOString().slice(0, 16); };
export function DialogoHost() {
  const [p, setP] = useState<PedidoForm | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  // BA02: el foco entra al primer campo al abrir y vuelve al botón de origen al cerrar
  const origen = useRef<HTMLElement | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (p) setTimeout(() => formRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus(), 0); }, [p]);
  useEffect(() => {
    abrirForm = (x) => {
      origen.current = document.activeElement as HTMLElement | null;
      const ini: Record<string, string> = {};
      for (const c of x.campos) {
        if (c.tipo === 'select' || c.tipo === 'opcion') ini[c.id] = c.inicial ?? c.opciones[0]?.valor ?? '';
        else if (c.tipo === 'motivo') { ini[c.id] = ''; ini[c.id + '__detalle'] = ''; }
        else if (c.tipo === 'fechaHora') ini[c.id] = c.inicial ?? '';
        else ini[c.id] = ('inicial' in c && c.inicial) || '';
      }
      setV(ini); setErr({}); setP(x);
    };
    return () => { abrirForm = null; };
  }, []);
  if (!p) return null;
  const fin = (r: Record<string, string> | null) => { p.resolver(r); setP(null); const o = origen.current; setTimeout(() => { if (o && document.contains(o)) o.focus(); }, 0); };
  const irA = (id: string) => formRef.current?.querySelector<HTMLElement>(`[data-campo="${id}"] input, [data-campo="${id}"] select`)?.focus();
  const validar = () => {
    const e: Record<string, string> = {}, out: Record<string, string> = {};
    for (const c of p.campos) {
      const x = (v[c.id] ?? '').trim();
      switch (c.tipo) {
        case 'select': case 'opcion': if (!x) e[c.id] = 'Elija una opción.'; out[c.id] = x; break;
        case 'motivo': {
          const d = (v[c.id + '__detalle'] ?? '').trim();
          if (!x) e[c.id] = 'Elija el motivo.';
          else if ((x === 'Otro' || c.detalleObligatorio) && d.length < 5) e[c.id] = 'Escriba el detalle (al menos 5 caracteres).';
          out[c.id] = x === 'Otro' ? d : d ? `${x}: ${d}` : x; break;
        }
        case 'texto': if (!c.opcional && x.length < (c.minLargo ?? 2)) e[c.id] = `Complete este dato (mínimo ${c.minLargo ?? 2} caracteres).`; out[c.id] = x; break;
        case 'numero': {
          const q = aMil(x);
          if (q === null || Number.isNaN(q)) e[c.id] = 'Escriba un número (use coma decimal, por ejemplo 12,5).';
          else if (q < (c.minMil ?? 0)) e[c.id] = `No puede ser menor que ${(c.minMil ?? 0) / 1000}.`;
          else if (c.maxMil !== undefined && q > c.maxMil) e[c.id] = `No puede ser mayor que ${String(c.maxMil / 1000).replace('.', ',')} ${c.unidad}.`;
          out[c.id] = String(q); break;
        }
        case 'fechaHora': {
          if (!x) { e[c.id] = 'Elija fecha y hora en el calendario.'; break; }
          const iso = deLocal(x);
          if (c.futuro && Date.parse(iso) <= Date.now()) e[c.id] = 'Debe ser una fecha y hora futura.';
          if (c.despuesDe && v[c.despuesDe] && x <= v[c.despuesDe]) e[c.id] = 'Debe ser posterior a la fecha de inicio.';
          out[c.id] = iso; break;
        }
        case 'fecha': if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) e[c.id] = 'Elija la fecha en el calendario.'; else if (c.minimo && x < c.minimo) e[c.id] = `No puede ser anterior a ${c.minimo}.`; out[c.id] = x; break;
        case 'pin': if (!/^\d{4,8}$/.test(x)) e[c.id] = 'El PIN tiene de 4 a 8 dígitos.'; out[c.id] = x; break;
      }
    }
    setErr(e);
    // BA05: el foco va al primer campo con error; los datos válidos se conservan
    const primero = p.campos.find((c) => e[c.id]);
    if (primero) setTimeout(() => irA(primero.id), 0);
    return Object.keys(e).length ? null : out;
  };
  const set = (k: string, x: string) => setV((a) => ({ ...a, [k]: x }));
  return (
    <div className="panel-fondo fondo-dialogo" onKeyDown={(e) => e.key === 'Escape' && fin(null)}>
      <form ref={formRef} className="panel panel-dato" role="dialog" aria-modal="true" aria-label={p.titulo} noValidate onSubmit={(e) => { e.preventDefault(); const r = validar(); if (r) fin(r); }}>
        <div className="panel-cab"><h2>{p.titulo}</h2><button type="button" onClick={() => fin(null)} aria-label="Cerrar">×</button></div>
        {p.explicacion && <p className="nota">{p.explicacion}</p>}
        {Object.keys(err).length > 1 && <div className="resumen-errores" role="alert"><strong>Revise {Object.keys(err).length} campos:</strong> {p.campos.filter((c) => err[c.id]).map((c) => <button type="button" key={c.id} className="enlace-btn" onClick={() => irA(c.id)}>{c.etiqueta}</button>)}</div>}
        {p.campos.map((c) => (
          <div key={c.id} data-campo={c.id} className={'campo' + (err[c.id] ? ' con-error' : '')}>
            <span className="campo-etiqueta">{c.etiqueta}</span>
            {c.tipo === 'select' && <select aria-label={c.etiqueta} value={v[c.id]} onChange={(e) => set(c.id, e.target.value)}>{c.opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}</select>}
            {c.tipo === 'opcion' && <div className="opciones" role="radiogroup" aria-label={c.etiqueta}>{c.opciones.map((o) => (
              <label key={o.valor} className={'opcion' + (v[c.id] === o.valor ? ' activa' : '')}><input type="radio" name={c.id} checked={v[c.id] === o.valor} onChange={() => set(c.id, o.valor)} /> <strong>{o.texto}</strong>{o.detalle && <small>{o.detalle}</small>}</label>))}</div>}
            {c.tipo === 'motivo' && <>
              <select aria-label={c.etiqueta} value={v[c.id]} onChange={(e) => set(c.id, e.target.value)}><option value="">— Elija el motivo —</option>{[...c.opciones, 'Otro'].map((o) => <option key={o}>{o}</option>)}</select>
              {(v[c.id] === 'Otro' || c.detalleObligatorio || v[c.id]) && <input aria-label={`Detalle de ${c.etiqueta}`} placeholder={v[c.id] === 'Otro' || c.detalleObligatorio ? 'Detalle (obligatorio)' : 'Detalle (opcional): número de informe, guía, persona…'} value={v[c.id + '__detalle']} onChange={(e) => set(c.id + '__detalle', e.target.value)} />}
            </>}
            {c.tipo === 'texto' && <input aria-label={c.etiqueta} placeholder={c.ejemplo ? `Ej.: ${c.ejemplo}` : ''} value={v[c.id]} onChange={(e) => set(c.id, e.target.value)} />}
            {c.tipo === 'numero' && <div className="con-unidad"><input aria-label={c.etiqueta} inputMode="decimal" value={v[c.id]} onChange={(e) => set(c.id, e.target.value)} /><span>{c.unidad}</span></div>}
            {c.tipo === 'fecha' && <input type="date" aria-label={c.etiqueta} min={c.minimo ?? '2020-01-01'} max="2035-12-31" value={v[c.id]} onChange={(e) => set(c.id, e.target.value)} />}
            {c.tipo === 'pin' && <input type="password" inputMode="numeric" maxLength={8} aria-label={c.etiqueta} value={v[c.id]} onChange={(e) => set(c.id, e.target.value.replace(/\D/g, ''))} />}
            {c.tipo === 'fechaHora' && <>
              <input type="datetime-local" aria-label={c.etiqueta} min={c.futuro ? localAhora() : undefined} value={v[c.id]} onChange={(e) => set(c.id, e.target.value)} />
              {c.rapidos && <div className="rapidos">{c.rapidos.map((r) => <button type="button" key={r.texto} className="chip-rapido" onClick={() => set(c.id, localAhora(r.horas))}>{r.texto}</button>)}</div>}
            </>}
            {c.ayuda && <small className="nota">{c.ayuda}</small>}
            {err[c.id] && <small className="error-campo" role="alert">{err[c.id]}</small>}
          </div>
        ))}
        <div className="botonera"><button type="submit" className="primario">{p.aceptar ?? 'Aceptar'}</button><button type="button" onClick={() => fin(null)}>Cancelar</button></div>
      </form>
    </div>
  );
}

/** Fecha válida «AAAA-MM-DD» dentro de [min, max]. */
export const fechaValida = (v: string, min = '2020-01-01', max = '2035-12-31') => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && v >= min && v <= max;

/**
 * Campo de fecha con calendario que nunca entrega una fecha a medio escribir.
 * Mientras el usuario borra o teclea, el valor queda en borrador; solo se aplica cuando es una fecha completa y válida.
 */
export function CampoFecha({ valor, cambiar, min = '2020-01-01', max = '2035-12-31', etiqueta }: { valor: string; cambiar: (v: string) => void; min?: string; max?: string; etiqueta?: string }) {
  const [borrador, setBorrador] = useState(valor);
  useEffect(() => setBorrador(valor), [valor]);
  const ok = fechaValida(borrador, min, max);
  return (
    <span className="campo-fecha">
      <input type="date" aria-label={etiqueta} min={min} max={max} value={borrador} className={ok ? '' : 'fecha-incompleta'}
        onChange={(e) => { const v = e.target.value; setBorrador(v); if (fechaValida(v, min, max)) cambiar(v); }}
        onBlur={() => { if (!fechaValida(borrador, min, max)) setBorrador(valor); }} />
      {!ok && <small className="aviso-fecha">Complete día, mes y año (entre {min.slice(0, 4)} y {max.slice(0, 4)}). Mientras tanto se sigue usando {valor.split('-').reverse().join('/')}.</small>}
    </span>
  );
}

/** Selector de mes (calendario mensual del navegador), sin máximo fijo: acepta cualquier AAAA-MM desde «min». */
export function CampoMes({ valor, cambiar, min, etiqueta }: { valor: string; cambiar: (v: string) => void; min: string; etiqueta: string }) {
  const [borrador, setBorrador] = useState(valor);
  useEffect(() => setBorrador(valor), [valor]);
  const ok = /^\d{4}-(0[1-9]|1[0-2])$/.test(borrador) && borrador >= min;
  return (
    <span className="campo-fecha">
      <input type="month" aria-label={etiqueta} min={min} value={borrador} className={ok ? '' : 'fecha-incompleta'}
        onChange={(e) => { const v = e.target.value; setBorrador(v); if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v) && v >= min) cambiar(v); }}
        onBlur={() => { if (!ok) setBorrador(valor); }} />
      {!ok && <small className="aviso-fecha">Elija un mes desde {min}. Mientras tanto se sigue usando {valor}.</small>}
    </span>
  );
}

/** Si una pantalla falla, se muestra el problema solo en esa pantalla: la cabecera y los datos siguen disponibles. */
export class Protector extends Component<{ children: ReactNode; zona: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Pantalla ' + this.props.zona + ':', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mensaje error protector" role="alert">
        <h3>Esta pantalla encontró un problema y se detuvo para no mostrar datos incorrectos</h3>
        <p>Sus datos no se modificaron. Puede volver a intentarlo o cambiar de sección.</p>
        <p className="mono">Detalle técnico ({this.props.zona}): {this.state.error.message}</p>
        <button className="primario" onClick={() => this.setState({ error: null })}>Volver a intentar</button>
      </div>
    );
  }
}

/** Avance de un cálculo largo con botón Cancelar (K07, N08). */
export function PanelProgreso({ titulo, texto, hechas, total, cancelar }: { titulo: string; texto: string; hechas: number; total: number; cancelar: () => void }) {
  const pct = total ? Math.round((hechas / total) * 100) : 0;
  return (
    <div className="panel-fondo" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="panel progreso">
        <h2>{titulo}</h2>
        <p>{texto}</p>
        <div className="barra-progreso" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
        <p className="nota">{pct} % · Si cancela, no se guarda ni se descarga un resultado incompleto.</p>
        <button onClick={cancelar}>Cancelar</button>
      </div>
    </div>
  );
}
