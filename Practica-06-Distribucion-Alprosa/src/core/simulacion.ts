// I06: simulación Monte Carlo de TODA la cadena multimodal (§9 Incertidumbre, §9.1, K01–K08, AD03/AD05/AD06, AV08).
// Cada iteración recorre el itinerario completo: salida → recorrido → manipulación → siguiente salida disponible → … → aceptación.
// Generador del contrato §9 (LCG de 32 bits, semilla por defecto 2026). Es pedagógico y reproducible; no criptográfico.
import type { Repo } from './db';
import { nuevoId, sha256Hex } from './util';
import { pedidos, reservarFefo } from './dominio';
import { planificar, origenesPlanificables, type Alternativa } from './transporte';
import { asegurarUsuarioEvaluacion, EVAL_ID } from './sesion';
import { exigir } from './permisos';

export const VERSION_MOTOR_SIM = 'SIM-1.0';

// ------------------------------------------------------------------ Aleatoriedad (contrato §9)
/** LCG del contrato: estado = (1664525·estado + 1013904223) mod 2^32; u = (estado + 0.5) / 2^32 ∈ (0,1). */
export function lcg(semilla: number) {
  let estado = semilla >>> 0;
  return () => { estado = (Math.imul(1664525, estado) + 1013904223) >>> 0; return (estado + 0.5) / 4294967296; };
}
/** FNV-1a de 32 bits: identifica la clave de un subflujo (servicio, corredor-día). */
export function fnv1a(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/**
 * Subflujo por (semilla, iteración, clave). Así el MISMO servicio o corredor-día recibe los mismos números en todas las alternativas
 * comparadas (vector de shocks común) y el orden en que se recorren los pedidos no altera los resultados.
 */
export const subflujo = (semilla: number, iteracion: number, clave: string) => lcg((semilla ^ fnv1a(clave) ^ Math.imul(iteracion + 1, 0x9e3779b9)) >>> 0);

/** Inversa estándar de la triangular (mín, moda, máx). Con mín = moda = máx devuelve la constante, sin dividir por cero. */
export function triangular(u: number, min: number, moda: number, max: number) {
  if (max === min) return min;
  const f = (moda - min) / (max - min);
  return u < f ? min + Math.sqrt(u * (max - min) * (moda - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - moda));
}
/** Percentil por interpolación lineal en la posición (n−1)·p de la muestra ordenada (contrato §9). */
export function percentil(ordenada: number[], p: number) {
  if (!ordenada.length) return null;
  const pos = (ordenada.length - 1) * p, i = Math.floor(pos), f = pos - i;
  return i + 1 < ordenada.length ? ordenada[i] + f * (ordenada[i + 1] - ordenada[i]) : ordenada[i];
}
export interface Resumen { media: number; desv: number; p5: number; p50: number; p95: number; ic95: [number, number]; n: number }
export function resumir(xs: number[]): Resumen {
  const n = xs.length;
  const o = [...xs].sort((a, b) => a - b);
  const media = xs.reduce((a, b) => a + b, 0) / Math.max(n, 1);
  const desv = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - media) ** 2, 0) / (n - 1)) : 0;
  const e = n > 0 ? 1.96 * desv / Math.sqrt(n) : 0;
  return { media, desv, p5: percentil(o, 0.05) ?? 0, p50: percentil(o, 0.5) ?? 0, p95: percentil(o, 0.95) ?? 0, ic95: [media - e, media + e], n };
}

// ------------------------------------------------------------------ Parámetros del modelo
export interface AjusteModo { modo: string; min_h: number; moda_h: number; max_h: number; prob_incidencia: number; retraso_h: number }
export interface ParametrosSim {
  iteraciones: number; semilla: number;
  /** true: la incidencia y el cierre se sortean UNA vez por corredor y día, y afectan a todos los servicios y pedidos de ese corredor ese día. */
  shock_comun: boolean;
  /** Probabilidad de cierre total del corredor en un día (servicio cancelado: hay que tomar la siguiente salida). */
  prob_cierre: number;
  /** Multiplicador de la duración de todos los tramos (sensibilidad). */
  factor_duracion: number;
  costo_espera_hora: number; costo_reprogramacion: number;
  /** Máximo de horas que se busca una salida alternativa; más allá, la carga queda sin atender en la corrida. */
  horizonte_reprogramacion_h: number;
  /** Despacho por pedido: horas de holgura antes del inicio de la ventana. */
  holgura_por_pedido_h: number;
  /** Reemplaza la distribución de los enlaces de un medio (si no se indica, se usa la del enlace). */
  ajustes: AjusteModo[];
}
/** Filas de la hoja ParametrosSimulacion (Excel 06) → parámetros del modelo base. */
export const FILAS_PARAMETROS: [keyof ParametrosSim, string, string][] = [
  ['iteraciones', 'iteraciones', 'Número de iteraciones Monte Carlo'], ['semilla', 'entero 32 bits', 'Semilla del generador (contrato §9)'],
  ['shock_comun', '0/1', '1 = la incidencia y el cierre se comparten por corredor y día'], ['prob_cierre', '0–1', 'Probabilidad de cierre total de un corredor en un día'],
  ['factor_duracion', 'multiplicador', 'Multiplica la duración de todos los tramos'], ['costo_espera_hora', 'S/ por hora', 'Costo de espera por hora de reprogramación'],
  ['costo_reprogramacion', 'S/ por evento', 'Costo de cambiar una carga a otra salida'], ['horizonte_reprogramacion_h', 'horas', 'Máximo de horas para buscar otra salida'],
  ['holgura_por_pedido_h', 'horas', 'Despacho por pedido: holgura antes del inicio de la ventana'],
];
export function parametrosDesdeFilas(filas: { parametro: string; valor: number }[]): ParametrosSim {
  const p: ParametrosSim = { ...PARAMETROS_DEFECTO, ajustes: [] };
  for (const f of filas) {
    if (f.parametro === 'shock_comun') p.shock_comun = Number(f.valor) === 1;
    else if (f.parametro in p) (p as unknown as Record<string, number>)[f.parametro] = Number(f.valor);
  }
  return p;
}
export const PARAMETROS_DEFECTO: ParametrosSim = {
  iteraciones: 1000, semilla: 2026, shock_comun: true, prob_cierre: 0.02, factor_duracion: 1, costo_espera_hora: 15, costo_reprogramacion: 80, horizonte_reprogramacion_h: 120, holgura_por_pedido_h: 24, ajustes: [],
};
const MODOS = ['VIAL', 'VIAL_LIGERO', 'LACUSTRE', 'FLUVIAL', 'ANIMAL', 'PEATONAL', 'AEREO'];

/** Validación previa (K02, K03, K04): ningún parámetro inválido llega al motor. */
export function validarParametros(p: ParametrosSim): string[] {
  const e: string[] = [];
  if (!Number.isInteger(p.iteraciones) || p.iteraciones < 10 || p.iteraciones > 20000) e.push('Iteraciones: entero entre 10 y 20 000.');
  if (!Number.isInteger(p.semilla) || p.semilla < 0 || p.semilla > 4294967295) e.push('Semilla: entero sin signo de 32 bits (0 a 4 294 967 295).');
  if (!(p.prob_cierre >= 0 && p.prob_cierre <= 1)) e.push('Probabilidad de cierre: entre 0 y 1.');
  if (!(p.factor_duracion > 0)) e.push('Factor de duración: mayor que 0.');
  if (!(p.costo_espera_hora >= 0) || !(p.costo_reprogramacion >= 0)) e.push('Costos de espera y de reprogramación: no negativos.');
  if (!(p.horizonte_reprogramacion_h > 0)) e.push('Horizonte de reprogramación: mayor que 0 horas.');
  if (!(p.holgura_por_pedido_h >= 0)) e.push('Holgura del despacho por pedido: 0 o más horas.');
  for (const a of p.ajustes) {
    const q = `Medio ${a.modo}: `;
    if (!MODOS.includes(a.modo)) e.push(q + 'medio desconocido.');
    if (!(a.min_h > 0)) e.push(q + 'la duración mínima debe ser mayor que 0 (una duración cero o negativa no es posible).');
    if (!(a.min_h <= a.moda_h && a.moda_h <= a.max_h)) e.push(q + 'debe cumplirse mínimo ≤ más probable ≤ máximo.');
    if (!(a.prob_incidencia >= 0 && a.prob_incidencia <= 1)) e.push(q + 'probabilidad de incidencia entre 0 y 1.');
    if (!(a.retraso_h >= 0)) e.push(q + 'retraso por incidencia no negativo.');
  }
  return e;
}

// ------------------------------------------------------------------ Modelos versionados (N01, N02)
export function modelos(repo: Repo) {
  return repo.todos('SELECT * FROM modelo_simulacion ORDER BY modelo_id, version').map((m) => ({ modelo_id: String(m.modelo_id), version: Number(m.version), nombre: String(m.nombre), motivo: String(m.motivo), creado_en: String(m.creado_en), creado_por: String(m.creado_por), clonado_de: m.clonado_de as string | null, parametros: JSON.parse(String(m.parametros)) as ParametrosSim }));
}
export function modeloVigente(repo: Repo, modeloId: string) {
  const m = repo.uno('SELECT * FROM modelo_simulacion WHERE modelo_id = ? ORDER BY version DESC LIMIT 1', [modeloId]);
  if (!m) throw new Error('Modelo inexistente: ' + modeloId);
  return { modelo_id: String(m.modelo_id), version: Number(m.version), nombre: String(m.nombre), parametros: JSON.parse(String(m.parametros)) as ParametrosSim };
}
export function asegurarModeloBase(repo: Repo, parametros: ParametrosSim = PARAMETROS_DEFECTO) {
  if (!repo.uno("SELECT 1 FROM modelo_simulacion WHERE modelo_id = 'MOD-BASE'"))
    repo.run("INSERT INTO modelo_simulacion VALUES ('MOD-BASE',1,'Modelo base NutriDemo',?,NULL,?,'SISTEMA','Parámetros sintéticos de demostración')", [JSON.stringify(parametros), repo.reloj()]);
}
/** Modificar crea una VERSIÓN nueva; las corridas guardadas conservan la versión con la que se hicieron (N02). */
export function modificarModelo(repo: Repo, usuario: string, modeloId: string, parametros: ParametrosSim, motivo: string) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'SIMULAR');
    const err = validarParametros(parametros);
    if (err.length) throw new Error(err.join(' '));
    if (!motivo.trim()) throw new Error('Indique el motivo del cambio.');
    const v = modeloVigente(repo, modeloId);
    repo.run('INSERT INTO modelo_simulacion VALUES (?,?,?,?,?,?,?,?)', [modeloId, v.version + 1, v.nombre, JSON.stringify(parametros), null, repo.reloj(), usuario, motivo]);
    return { modelo_id: modeloId, version: v.version + 1 };
  });
}
/** Clonar crea un modelo con ID nuevo y los mismos parámetros (N01). */
export function clonarModelo(repo: Repo, usuario: string, modeloId: string, nombre: string) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'SIMULAR');
    const v = modeloVigente(repo, modeloId);
    const id = nuevoId('MOD');
    repo.run('INSERT INTO modelo_simulacion VALUES (?,?,?,?,?,?,?,?)', [id, 1, nombre.trim() || `Copia de ${v.nombre}`, JSON.stringify(v.parametros), `${modeloId} v${v.version}`, repo.reloj(), usuario, 'Clonado']);
    return { modelo_id: id, version: 1 };
  });
}

// ------------------------------------------------------------------ Planes a simular
export interface ViajeSim { servicio: string; salida: string; kg: number }
export interface TramoSim { tramo: number; enlace: string; modo: string; origen: string; destino: string; manip_min: number; viajes: ViajeSim[] }
export interface EnvioSim { pedido: string; origen: string; destino: string; region: string; remoto: boolean; kg: number; ventana_ini: string; ventana_fin: string; anticipada: boolean; factible: boolean; motivo: string; tramos: TramoSim[] }
export type Criterio = 'POR_PEDIDO' | 'CONSOLIDADO' | 'ANTICIPADO';
export interface PlanSim { criterio: Criterio; nombre: string; descripcion: string; envios: EnvioSim[]; servicios: number; costo_cent: number; kg: number; /** kg de TODOS los envíos (factibles o no): universo común de la demanda */ kg_demanda?: number }
export interface ServicioSim { servicio_id: string; enlace: string; corredor: string; modo: string; salida: string; llegada: string; min_min: number; moda_min: number; max_min: number; prob: number; retraso_min: number; fijo_cent: number; kg_p4: number; cap_kg: number }

const NOMBRES: Record<Criterio, [string, string]> = {
  POR_PEDIDO: ['Despacho por pedido (práctica actual)', 'Cada pedido sale en su propio momento, lo más tarde posible dejando una holgura antes de su ventana. Es la referencia de la comparación.'],
  CONSOLIDADO: ['Despacho consolidado por destino', 'Los pedidos a un mismo destino salen juntos en la salida del que tiene la ventana más temprana: menos viajes, más espera en destino.'],
  ANTICIPADO: ['Despacho anticipado', 'Cada pedido sale en la primera salida factible: más margen ante retrasos, pero la carga llega días antes y espera en destino.'],
};

function envioDe(repo: Repo, p: { pedido_id: string; ventana_inicio: string; ventana_fin: string }, origen: string, alt: Alternativa | undefined, motivo: string): EnvioSim {
  const d = repo.uno('SELECT d.destino_id, d.region, d.acepta_anticipadas, d.nodo_id FROM pedido p JOIN destino d USING (destino_id) WHERE pedido_id = ?', [p.pedido_id])!;
  const remoto = !!repo.uno("SELECT 1 FROM enlace WHERE nodo_destino_id = ? AND modo_id IN ('ANIMAL','PEATONAL','LACUSTRE','FLUVIAL','AEREO')", [d.nodo_id]);
  const manip = (n: string) => Number(repo.uno('SELECT manipulacion_min m FROM nodo WHERE nodo_id = ?', [n])?.m ?? 30);
  const tramos: TramoSim[] = (alt?.tramos ?? []).map((t, i) => ({ tramo: i + 1, enlace: t.enlace_id, modo: t.modo, origen: t.origen, destino: t.destino, manip_min: i === 0 ? 0 : manip(t.origen),
    viajes: t.viajes.map((v) => ({ servicio: v.servicio_id, salida: v.salida, kg: v.kg_mil / 1000 })) }));
  const kg = tramos.length ? tramos[tramos.length - 1].viajes.reduce((a, v) => a + v.kg, 0)
    : Number(repo.uno('SELECT COALESCE(SUM((pl.q_solicitada_mil - pl.q_cancelada_mil) * pr.peso_kg_por_unidad_mil), 0) / 1e6 kg FROM pedido_linea pl JOIN producto pr USING (producto_id) WHERE pl.pedido_id = ?', [p.pedido_id])?.kg ?? 0);
  return { pedido: p.pedido_id, origen, destino: String(d.destino_id), region: String(d.region), remoto, kg, ventana_ini: p.ventana_inicio, ventana_fin: p.ventana_fin,
    anticipada: d.acepta_anticipadas === 1, factible: !!alt && alt.factible, motivo, tramos };
}

/**
 * Construye los planes alternativos SIN modificar datos: en un ensayo aislado reserva (FEFO) los pedidos abiertos, planifica y deshace todo.
 * POR_PEDIDO = sale lo más tarde posible dejando una holgura antes de la ventana (práctica actual, referencia);
 * CONSOLIDADO = los pedidos a un mismo destino salen juntos en la salida «por pedido» del que tiene la ventana más temprana;
 * ANTICIPADO = primera salida factible.
 * Los itinerarios ya confirmados se incluyen tal cual en todos los planes.
 */
export function construirPlanes(repo: Repo, holguraH = PARAMETROS_DEFECTO.holgura_por_pedido_h): { planes: PlanSim[]; servicios: ServicioSim[]; limitaciones: string[] } {
  type Opc = { p: { pedido_id: string; ventana_inicio: string; ventana_fin: string }; origen: string; destinoNodo: string; base?: Alternativa; jit?: Alternativa; cons?: Alternativa; jitAhora: string; motivo: string };
  const opciones: Opc[] = [];
  const fijos: EnvioSim[] = [];
  const ahora = repo.reloj();
  const iso = (t: number) => new Date(t - 5 * 3600000).toISOString().slice(0, 19) + '-05:00';
  repo.ensayo(() => {
    asegurarUsuarioEvaluacion(repo);
    const abiertos = pedidos(repo).filter((p) => ['Confirmado', 'Reserva parcial', 'Reservado'].includes(p.estado));
    const items = new Map<Opc, ReturnType<typeof origenesPlanificables>[number]['items']>();
    for (const p of abiertos) {
      let motivoReserva = '';
      if (p.estado !== 'Reservado') { try { reservarFefo(repo, EVAL_ID, p.pedido_id); } catch (e) { motivoReserva = 'No se pudo reservar stock apto (FEFO): ' + (e as Error).message; } }
      const base0 = { pedido_id: p.pedido_id, ventana_inicio: p.ventana_inicio, ventana_fin: p.ventana_fin };
      const origenes = origenesPlanificables(repo, p.pedido_id);
      const dn = String(repo.uno('SELECT d.nodo_id FROM pedido p JOIN destino d USING (destino_id) WHERE pedido_id = ?', [p.pedido_id])!.nodo_id);
      if (!origenes.length) { opciones.push({ p: base0, origen: '—', destinoNodo: dn, jitAhora: ahora, motivo: motivoReserva || 'Sin cantidad reservada pendiente de planificar.' }); continue; }
      for (const o of origenes) {
        const r = planificar(repo, p.pedido_id, o.origen, o.items, ahora);
        const base = r.alternativas.find((a) => a.factible);
        let jitAhora = ahora, jit = base;
        if (base) {
          const dur = Date.parse(base.llegada) - Date.parse(base.salida);
          const t = Math.max(Date.parse(ahora), Date.parse(p.ventana_inicio) - dur - holguraH * 3600000);
          jitAhora = iso(t);
          jit = planificar(repo, p.pedido_id, o.origen, o.items, jitAhora).alternativas.find((a) => a.factible) ?? base;
        }
        const op: Opc = { p: base0, origen: o.origen, destinoNodo: dn, base, jit, jitAhora, motivo: base ? '' : r.alternativas[0]?.motivo ?? r.motivo_global ?? 'Sin ruta factible.' };
        opciones.push(op); items.set(op, o.items);
      }
    }
    // Consolidación: el grupo de un destino sale junto en la salida «justo a tiempo» más temprana del grupo
    const grupos = new Map<string, Opc[]>();
    for (const o of opciones) if (o.base) grupos.set(o.destinoNodo, [...(grupos.get(o.destinoNodo) ?? []), o]);
    for (const g of grupos.values()) {
      const t = g.map((o) => o.jitAhora).sort()[0];
      for (const o of g) o.cons = g.length > 1 ? planificar(repo, o.p.pedido_id, o.origen, items.get(o)!, t).alternativas.find((a) => a.factible) ?? o.jit : o.jit;
    }
  });
  // Itinerarios confirmados aún no despachados: entran fijos en todos los planes
  for (const it of repo.todos("SELECT i.*, p.ventana_inicio, p.ventana_fin FROM itinerario i JOIN pedido p USING (pedido_id) WHERE i.estado = 'CONFIRMADO'")) {
    const et = repo.todos('SELECT e.*, s.enlace_id, s.salida, en.modo_id FROM etapa e JOIN servicio s USING (servicio_id) JOIN enlace en ON en.enlace_id = s.enlace_id WHERE itinerario_id = ? AND e.estado <> \'CANCELADA\' ORDER BY tramo, viaje', [it.itinerario_id]);
    const alt = { factible: true, tramos: [] as Alternativa['tramos'] } as unknown as Alternativa;
    for (const e of et) {
      let t = alt.tramos.find((x) => x.origen === e.nodo_origen_id && x.destino === e.nodo_destino_id);
      if (!t) { t = { enlace_id: String(e.enlace_id), modo: String(e.modo_id), origen: String(e.nodo_origen_id), destino: String(e.nodo_destino_id), espera_min: 0, transbordo_cent: 0, viajes: [] }; alt.tramos.push(t); }
      t.viajes.push({ servicio_id: String(e.servicio_id), recurso: '', salida: String(e.salida), llegada: '', kg_mil: Number(e.kg_bruto_mil), dm3: 0, bultos: 0, costo_cent: 0, items: [] });
    }
    fijos.push(envioDe(repo, { pedido_id: String(it.pedido_id), ventana_inicio: String(it.ventana_inicio), ventana_fin: String(it.ventana_fin) }, String(it.nodo_origen_id), alt, ''));
  }
  const elegir = (c: Criterio): EnvioSim[] => [...fijos, ...opciones.map((o) => { const alt = c === 'ANTICIPADO' ? o.base : c === 'POR_PEDIDO' ? o.jit : o.cons; return envioDe(repo, o.p, o.origen, alt, alt ? '' : o.motivo); })];
  const servicios = repo.todos(`SELECT s.servicio_id, s.enlace_id enlace, COALESCE(e.corredor_id, e.enlace_id) corredor, e.modo_id modo, s.salida, s.llegada, e.min_min, e.moda_min, e.max_min,
      e.prob_incidencia_ppm / 1e6 prob, e.retraso_incidencia_min retraso_min, s.tarifa_fija_cent fijo_cent, s.costo_kg_p4 kg_p4, r.capacidad_kg_mil / 1000.0 cap_kg
    FROM servicio s JOIN enlace e USING (enlace_id) JOIN recurso r ON r.recurso_id = s.recurso_id WHERE s.estado = 'PROGRAMADO' ORDER BY s.enlace_id, s.salida`).map((r) => ({ ...r, salida: String(r.salida), llegada: String(r.llegada) })) as unknown as ServicioSim[];
  const porServicio = new Map(servicios.map((s) => [s.servicio_id, s]));
  const planes = (['POR_PEDIDO', 'CONSOLIDADO', 'ANTICIPADO'] as Criterio[]).map((c) => {
    const envios = elegir(c);
    // Costo de servicios compartidos: el fijo se cuenta UNA vez por servicio físico; el variable por kg (§14.1.1-3, RN-29)
    const kgPorServ = new Map<string, number>();
    for (const e of envios) for (const t of e.tramos) for (const v of t.viajes) kgPorServ.set(v.servicio, (kgPorServ.get(v.servicio) ?? 0) + v.kg);
    let costo = 0;
    for (const [sid, kg] of kgPorServ) { const s = porServicio.get(sid); if (s) costo += Number(s.fijo_cent) + Math.round(kg * Number(s.kg_p4) / 100); }
    return { criterio: c, nombre: NOMBRES[c][0], descripcion: NOMBRES[c][1], envios, servicios: kgPorServ.size, costo_cent: costo, kg: envios.reduce((a, e) => a + (e.factible ? e.kg : 0), 0), kg_demanda: envios.reduce((a, e) => a + (e.kg || 0), 0) };
  });
  const limitaciones = [
    `Despacho por pedido: sale con ${holguraH} h de holgura antes del inicio de la ventana (supuesto editable).`,
    'La capacidad (kg) de los servicios se respeta al planificar y también al reprogramar: una carga que pierde su salida solo ocupa la capacidad libre de las salidas siguientes del mismo enlace. Si una parte no cabe dentro del horizonte, TODO el envío queda NO ATENDIDO (no se entrega parcial al cliente) y se libera la capacidad que tenía en las etapas siguientes; lo ya transportado queda en custodia intermedia. El volumen y los bultos se validan al planificar, no al reprogramar en la simulación.',
    'Las distribuciones de duración, incidencia y cierre son sintéticas y editables; no son probabilidades reales de Alprosa.',
    'Una carga reprogramada conserva el costo del servicio planificado y suma el costo de reprogramación y de espera.',
  ];
  return { planes, servicios, limitaciones };
}

// ------------------------------------------------------------------ Motor
const H = 3600000;
const ms = (s: string) => Date.parse(s.length === 16 ? s + ':00-05:00' : s);

export interface ResultadoPlan {
  criterio: Criterio; nombre: string; pedidos: number; envios: number; servicios: number; costo_plan_cent: number; kg_plan: number; kg_demanda?: number;
  a_tiempo: Resumen; retraso_h: Resumen; costo: Resumen; kg_no_atendido: Resumen; conexiones_perdidas: Resumen;
  /** Promedio, entre pedidos con ruta factible, de la probabilidad de llegar fuera de su ventana o no llegar. */
  prob_incumplimiento: number;
  por_pedido: { pedido: string; destino: string; region: string; remoto: boolean; kg: number; ventana_fin: string; factible: boolean; motivo: string; prob_a_tiempo: number; prob_no_atendido: number; retraso_p50: number; retraso_p95: number; llegada_p50: string | null; llegada_p95: string | null }[];
}
export interface ResultadoSim { planes: ResultadoPlan[]; diferencias: { contra: Criterio; a_tiempo: Resumen; costo: Resumen }[]; iteraciones: number; correlacion: string; orden_extraccion: string }

interface Acum { aTiempo: number[]; retraso: number[]; costo: number[]; noAt: number[]; conex: number[]; ped: Map<string, { ok: number; noAt: number; retrasos: number[]; llegadas: number[] }> }

/** Ejecuta las iteraciones [desde, hasta) sobre todos los planes con el MISMO vector de shocks por iteración. */
export function iterar(planes: PlanSim[], servicios: ServicioSim[], p: ParametrosSim, desde: number, hasta: number, acum: Acum[]) {
  const porServicio = new Map(servicios.map((s) => [s.servicio_id, s]));
  const porEnlace = new Map<string, ServicioSim[]>();
  for (const s of servicios) porEnlace.set(s.enlace, [...(porEnlace.get(s.enlace) ?? []), s]);
  const ajuste = new Map(p.ajustes.map((a) => [a.modo, a]));
  for (let i = desde; i < hasta; i++) {
    const shocks = new Map<string, { incid: boolean; cierre: boolean }>();
    const reales = new Map<string, { cancelado: boolean; sal: number; lle: number }>();
    const realizar = (s: ServicioSim) => {
      let r = reales.get(s.servicio_id);
      if (r) return r;
      const aj = ajuste.get(s.modo);
      const clave = p.shock_comun ? `C|${s.corredor}|${s.salida.slice(0, 10)}` : `S|${s.servicio_id}`;
      let sh = shocks.get(clave);
      if (!sh) { const g = subflujo(p.semilla, i, clave); const u1 = g(), u2 = g(); sh = { incid: u1 < (aj ? aj.prob_incidencia : s.prob), cierre: u2 < p.prob_cierre }; shocks.set(clave, sh); }
      const g = subflujo(p.semilla, i, `D|${s.servicio_id}`);
      const [mn, mo, mx] = aj ? [aj.min_h * 60, aj.moda_h * 60, aj.max_h * 60] : [Number(s.min_min), Number(s.moda_min), Number(s.max_min)];
      const dur = triangular(g(), mn, mo, mx) * p.factor_duracion + (sh.incid ? (aj ? aj.retraso_h * 60 : Number(s.retraso_min)) : 0);
      const sal = ms(s.salida);
      r = { cancelado: sh.cierre, sal, lle: sal + dur * 60000 };
      reales.set(s.servicio_id, r);
      return r;
    };
    planes.forEach((plan, k) => {
      const a = acum[k];
      // Ocupación por servicio físico en esta iteración: parte de lo planificado y cambia con cada reprogramación (capacidad compartida)
      const ocup = new Map<string, number>();
      for (const e of plan.envios) if (e.factible) for (const t of e.tramos) for (const v of t.viajes) ocup.set(v.servicio, (ocup.get(v.servicio) ?? 0) + v.kg);
      const porPedido = new Map<string, { ok: boolean; noAt: boolean; llegada: number; retraso: number }>();
      let costoExtra = 0, kgNoAt = 0, conex = 0;
      for (const e of plan.envios) {
        let llegada = NaN, noAt = !e.factible;
        if (e.factible) {
          let t: number | null = null;
          for (const tr of e.tramos) {
            const listo: number | null = t === null ? null : t + tr.manip_min * 60000;
            let fin = 0;
            for (const v of tr.viajes) {
              const s = porServicio.get(v.servicio);
              let r = s ? realizar(s) : null;
              const plan0 = ms(v.salida);
              if (!r || r.cancelado || (listo !== null && listo > r.sal)) {
                // AD03: se pierde la salida (conexión o cierre): se toma la siguiente disponible del mismo enlace dentro del horizonte
                conex++;
                const minimo = Math.max(listo ?? plan0, plan0);
                ocup.set(v.servicio, (ocup.get(v.servicio) ?? 0) - v.kg); // libera su lugar en la salida perdida
                const cands = (porEnlace.get(tr.enlace) ?? []).filter((x) => ms(x.salida) >= minimo && ms(x.salida) > plan0 - 1 && x.servicio_id !== v.servicio && !realizar(x).cancelado && ms(x.salida) - plan0 <= p.horizonte_reprogramacion_h * H);
                let restante = v.kg, lle = -Infinity, extra = 0;
                const tomadas: [string, number][] = [];
                for (const x of cands) {
                  const libre = Number(x.cap_kg) - (ocup.get(x.servicio_id) ?? 0);
                  if (libre <= 1e-9) continue;
                  const q = Math.min(libre, restante);
                  tomadas.push([x.servicio_id, q]); ocup.set(x.servicio_id, (ocup.get(x.servicio_id) ?? 0) + q);
                  restante -= q;
                  const rx = realizar(x); lle = Math.max(lle, rx.lle);
                  extra += p.costo_reprogramacion * 100 + Math.max(0, (rx.sal - plan0) / H) * p.costo_espera_hora * 100;
                  if (restante <= 1e-9) break;
                }
                if (restante > 1e-9) {
                  // Política explícita: no se entrega parcial al cliente. Si una parte no cabe, TODO el envío queda pendiente:
                  // se deshacen las asignaciones de este viaje y se libera la capacidad reservada en los viajes y etapas siguientes.
                  for (const [sid, q] of tomadas) ocup.set(sid, (ocup.get(sid) ?? 0) - q);
                  const resto = e.tramos.filter((t2) => t2.tramo > tr.tramo).flatMap((t2) => t2.viajes).concat(tr.viajes.slice(tr.viajes.indexOf(v) + 1));
                  for (const v2 of resto) ocup.set(v2.servicio, (ocup.get(v2.servicio) ?? 0) - v2.kg);
                  noAt = true; break;
                }
                costoExtra += extra;
                r = { cancelado: false, sal: minimo, lle };
              }
              fin = Math.max(fin, r.lle);
            }
            if (noAt) break;
            t = fin;
          }
          if (!noAt && t !== null) llegada = e.anticipada ? t : Math.max(t, ms(e.ventana_ini));
        }
        if (noAt) kgNoAt += e.kg || 0; // todo el envío queda pendiente para el cliente final (lo ya transportado queda en custodia intermedia)
        const fin = ms(e.ventana_fin);
        const ret = noAt ? NaN : Math.max(0, (llegada - fin) / H);
        const prev = porPedido.get(e.pedido);
        const ok = !noAt && llegada <= fin;
        porPedido.set(e.pedido, prev ? { ok: prev.ok && ok, noAt: prev.noAt || noAt, llegada: Math.max(prev.llegada, llegada), retraso: Math.max(prev.retraso, ret) } : { ok, noAt, llegada, retraso: ret });
      }
      let okN = 0;
      const retrasos: number[] = [];
      for (const [id, r] of porPedido) {
        if (r.ok) okN++;
        if (!r.noAt) retrasos.push(r.retraso);
        let pp = a.ped.get(id);
        if (!pp) { pp = { ok: 0, noAt: 0, retrasos: [], llegadas: [] }; a.ped.set(id, pp); }
        if (r.ok) pp.ok++;
        if (r.noAt) pp.noAt++; else { pp.retrasos.push(r.retraso); pp.llegadas.push(r.llegada); }
      }
      a.aTiempo.push(porPedido.size ? okN / porPedido.size : 0);
      a.retraso.push(retrasos.length ? Math.max(...retrasos) : 0);
      a.costo.push((plan.costo_cent + costoExtra) / 100);
      a.noAt.push(kgNoAt);
      a.conex.push(conex);
    });
  }
}
export const acumVacio = (n: number): Acum[] => Array.from({ length: n }, () => ({ aTiempo: [], retraso: [], costo: [], noAt: [], conex: [], ped: new Map() }));

const isoLima = (t: number) => new Date(t - 5 * H).toISOString().slice(0, 16).replace('T', ' ');
export function resumirResultados(planes: PlanSim[], acum: Acum[], iteraciones: number, p: ParametrosSim): ResultadoSim {
  const res: ResultadoPlan[] = planes.map((plan, k) => {
    const a = acum[k];
    const pedidosIds = [...new Set(plan.envios.map((e) => e.pedido))];
    return {
      criterio: plan.criterio, nombre: plan.nombre, pedidos: pedidosIds.length, envios: plan.envios.length, servicios: plan.servicios, costo_plan_cent: plan.costo_cent, kg_plan: plan.kg, kg_demanda: plan.kg_demanda ?? plan.kg,
      a_tiempo: resumir(a.aTiempo.map((x) => x * 100)), retraso_h: resumir(a.retraso), costo: resumir(a.costo), kg_no_atendido: resumir(a.noAt), conexiones_perdidas: resumir(a.conex),
      prob_incumplimiento: 0,
      por_pedido: pedidosIds.map((id) => {
        const e = plan.envios.filter((x) => x.pedido === id);
        const pp = a.ped.get(id) ?? { ok: 0, noAt: 0, retrasos: [], llegadas: [] };
        const r = [...pp.retrasos].sort((x, y) => x - y), l = [...pp.llegadas].sort((x, y) => x - y);
        return { pedido: id, destino: e[0].destino, region: e[0].region, remoto: e[0].remoto, kg: e.reduce((s, x) => s + x.kg, 0), ventana_fin: e[0].ventana_fin, factible: e.every((x) => x.factible), motivo: e.map((x) => x.motivo).filter(Boolean).join(' '),
          prob_a_tiempo: pp.ok / Math.max(iteraciones, 1), prob_no_atendido: pp.noAt / Math.max(iteraciones, 1), retraso_p50: percentil(r, 0.5) ?? 0, retraso_p95: percentil(r, 0.95) ?? 0,
          llegada_p50: l.length ? isoLima(percentil(l, 0.5)!) : null, llegada_p95: l.length ? isoLima(percentil(l, 0.95)!) : null };
      }),
    };
  });
  for (const r of res) { const f = r.por_pedido.filter((x) => x.factible); r.prob_incumplimiento = f.length ? f.reduce((a, x) => a + (1 - x.prob_a_tiempo), 0) / f.length : 0; }
  // Diferencias PAREADAS contra la referencia (primer plan): misma iteración, mismos shocks
  const diferencias = planes.slice(1).map((plan, j) => ({ contra: plan.criterio,
    a_tiempo: resumir(acum[j + 1].aTiempo.map((x, i) => (x - acum[0].aTiempo[i]) * 100)), costo: resumir(acum[j + 1].costo.map((x, i) => x - acum[0].costo[i])) }));
  return { planes: res, diferencias, iteraciones,
    correlacion: p.shock_comun ? 'Shock común: la incidencia y el cierre se sortean una vez por corredor y día; todos los servicios y pedidos de ese corredor ese día comparten el resultado. Cada servicio físico se simula una sola vez y sus cargas heredan su llegada.'
      : 'Independencia: cada servicio sortea su incidencia y cierre por separado. LIMITACIÓN: subestima bloqueos que afectan a la vez a varios servicios del mismo corredor.',
    orden_extraccion: 'Por iteración i y clave: corredor-día (o servicio) → [u incidencia, u cierre]; servicio → [u duración]. Cada clave usa su propio subflujo LCG con estado inicial = semilla XOR FNV-1a(clave) XOR (i+1)·0x9E3779B9, por lo que las alternativas comparten el mismo vector de shocks.' };
}

/** Simulación síncrona completa (pruebas y paridad EXE/HTML). */
export function simular(planes: PlanSim[], servicios: ServicioSim[], p: ParametrosSim): ResultadoSim {
  const err = validarParametros(p);
  if (err.length) throw new Error(err.join(' '));
  const acum = acumVacio(planes.length);
  iterar(planes, servicios, p, 0, p.iteraciones, acum);
  return resumirResultados(planes, acum, p.iteraciones, p);
}

/** Versión por bloques con progreso y cancelación (K07): una cancelación NO produce una corrida completa. */
export async function simularPorBloques(planes: PlanSim[], servicios: ServicioSim[], p: ParametrosSim, o: { bloque?: number; progreso?: (hechas: number) => void; cancelado?: () => boolean } = {}) {
  const err = validarParametros(p);
  if (err.length) throw new Error(err.join(' '));
  const acum = acumVacio(planes.length);
  const b = o.bloque ?? 50;
  for (let i = 0; i < p.iteraciones; i += b) {
    if (o.cancelado?.()) return { cancelada: true as const, hechas: i };
    iterar(planes, servicios, p, i, Math.min(i + b, p.iteraciones), acum);
    o.progreso?.(Math.min(i + b, p.iteraciones));
    await new Promise((r) => setTimeout(r, 0));
  }
  return { cancelada: false as const, hechas: p.iteraciones, resultado: resumirResultados(planes, acum, p.iteraciones, p) };
}

export const huellaEntrada = (planes: PlanSim[], servicios: ServicioSim[], p: ParametrosSim) =>
  sha256Hex(new TextEncoder().encode(JSON.stringify({ planes, servicios: servicios.map((s) => [s.servicio_id, s.salida, s.min_min, s.moda_min, s.max_min, s.prob, s.retraso_min]), p })));

export function guardarCorridaSim(repo: Repo, usuario: string, m: { modelo_id: string; version: number; parametros: ParametrosSim }, planes: PlanSim[], servicios: ServicioSim[],
  r: { cancelada: boolean; hechas: number; resultado?: ResultadoSim }) {
  return repo.transaccion(() => {
    exigir(repo, usuario, 'SIMULAR');
    const id = nuevoId('SIM');
    const ds = repo.uno("SELECT valor FROM meta WHERE clave = 'dataset_id'")?.valor ?? null;
    repo.run('INSERT INTO corrida_simulacion VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, m.modelo_id, m.version, JSON.stringify(m.parametros), m.parametros.semilla, m.parametros.iteraciones, r.hechas,
      r.cancelada ? 'CANCELADA' : 'COMPLETA', JSON.stringify(planes.map((pl) => ({ criterio: pl.criterio, envios: pl.envios.length, servicios: pl.servicios, costo_cent: pl.costo_cent, detalle: pl.envios }))),
      huellaEntrada(planes, servicios, m.parametros), r.cancelada ? null : JSON.stringify(r.resultado), VERSION_MOTOR_SIM, ds, repo.reloj(), usuario]);
    return id;
  });
}
export function corridasSim(repo: Repo) {
  return repo.todos('SELECT run_id, modelo_id, modelo_version, semilla, iteraciones, iteraciones_completas, estado, entrada_hash, creada_en, creada_por FROM corrida_simulacion ORDER BY creada_en DESC, run_id DESC');
}
export function corridaSim(repo: Repo, runId: string) {
  const c = repo.uno('SELECT * FROM corrida_simulacion WHERE run_id = ?', [runId]);
  if (!c) return null;
  return { run_id: String(c.run_id), modelo_id: String(c.modelo_id), modelo_version: Number(c.modelo_version), estado: String(c.estado), creada_en: String(c.creada_en), creada_por: String(c.creada_por),
    entrada_hash: String(c.entrada_hash), iteraciones_completas: Number(c.iteraciones_completas), parametros: JSON.parse(String(c.parametros)) as ParametrosSim, resultado: c.resultados ? (JSON.parse(String(c.resultados)) as ResultadoSim) : null,
    planes: JSON.parse(String(c.planes)) as { criterio: Criterio; envios: number; servicios: number; costo_cent: number; detalle: EnvioSim[] }[] };
}
