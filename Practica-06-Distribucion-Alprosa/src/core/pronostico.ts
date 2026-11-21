// I05: pronóstico de demanda SOLICITADA con validación temporal sin fuga (§9, §9.2).
// Métodos: ingenuo (última observación), promedio móvil de 4 semanas y suavizamiento exponencial simple (alfa elegido solo con el pasado).
import type { Repo } from './db';
import { nuevoId } from './util';
import { periodo, type PedidoH } from './kpi';

export const VERSION_MOTOR = 'PRON-1.0';
export type Metodo = 'INGENUO' | 'PM4' | 'SES';
export interface Punto { semana: string; valor: number | null; censurada: boolean; atipico?: boolean }
const SEM = 7 * 86400000;
const t = (s: string) => Date.parse(s.length === 10 ? s + 'T00:00:00-05:00' : s);

/** Serie semanal de demanda solicitada firme (unidad base), con lo conocido hasta `conocimiento`. Faltante (null) ≠ cero (J05). */
export function serieDemanda(repo: Repo, hechos: PedidoH[], o: { producto: string; region?: string; remoto?: boolean; hasta: string; conocimiento?: string }): Punto[] {
  const sinDatos = repo.todos('SELECT region, semana_inicio FROM hist_sin_datos').map((x) => `${x.region}|${x.semana_inicio}`);
  const regiones = new Set(hechos.map((p) => p.region));
  const m = new Map<string, { v: number; c: boolean }>();
  let primera: string | null = null;
  for (const p of hechos) {
    if (p.tipo !== 'FIRME' || (o.region && p.region !== o.region) || (o.remoto !== undefined && p.remoto !== o.remoto)) continue;
    if (o.conocimiento && t(p.registrado) > t(o.conocimiento)) continue; // lo no conocido en el origen no entrena (J08, AX02)
    if (t(p.fechaPedido) >= t(o.hasta)) continue;
    for (const l of p.lineas) if (l.producto === o.producto) {
      const k = periodo(p.fechaPedido, 'semana');
      const x = m.get(k) ?? { v: 0, c: false }; x.v += l.sol; x.c ||= l.noAt > 0; m.set(k, x);
      if (!primera || k < primera) primera = k;
    }
  }
  if (!primera) return [];
  const out: Punto[] = [];
  for (let s = t(primera); s < t(o.hasta); s += SEM) {
    const k = new Date(s - 5 * 3600000).toISOString().slice(0, 10);
    const falta = [...(o.region ? [o.region] : regiones)].some((r) => sinDatos.includes(`${r}|${k}`));
    const x = m.get(k);
    out.push({ semana: k, valor: falta && !x ? null : (x?.v ?? 0), censurada: x?.c ?? false });
  }
  // atípicos: se señalan y se conservan (J06)
  const v = out.map((p) => p.valor).filter((x): x is number => x !== null && x > 0).sort((a, b) => a - b); // sobre semanas con demanda: robusto a series intermitentes
  if (v.length >= 8) {
    const med = v[Math.floor(v.length / 2)], mad = [...v.map((x) => Math.abs(x - med))].sort((a, b) => a - b)[Math.floor(v.length / 2)];
    if (mad > 0) for (const p of out) if (p.valor !== null && p.valor > 0 && Math.abs(p.valor - med) > 6 * mad) p.atipico = true;
  }
  return out;
}

const obs = (s: (number | null)[]) => s.filter((x): x is number => x !== null);
function pronosticoUnPaso(hist: (number | null)[], m: Metodo, alfa = 0.3): number | null {
  const v = obs(hist);
  if (!v.length) return null;
  if (m === 'INGENUO') return v.at(-1)!;
  if (m === 'PM4') { const u = v.slice(-4); return u.reduce((a, x) => a + x, 0) / u.length; }
  let nivel = v[0]; for (const x of v.slice(1)) nivel = alfa * x + (1 - alfa) * nivel; return nivel;
}
/** Alfa elegido SOLO con el pasado disponible (error a un paso dentro del entrenamiento). */
export function elegirAlfa(hist: (number | null)[]) {
  const v = obs(hist); let mejor = { alfa: 0.3, sse: Infinity };
  for (let a = 0.1; a <= 0.91; a += 0.1) {
    let nivel = v[0], sse = 0;
    for (let i = 1; i < v.length; i++) { sse += (v[i] - nivel) ** 2; nivel = a * v[i] + (1 - a) * nivel; }
    if (sse < mejor.sse - 1e-9) mejor = { alfa: Math.round(a * 10) / 10, sse };
  }
  return mejor.alfa;
}

export interface ResultadoPronostico {
  serie: string; corte: string; n_obs: number; protocolo: string; advertencias: string[];
  metricas: Record<Metodo, { mae: number | null; wape: number | null; n: number }> | null; elegido: Metodo | null; alfa: number | null;
  backtest: { semana: string; real: number | null; INGENUO: number | null; PM4: number | null; SES: number | null }[];
  prediccion: { semana: string; valor: number; p10: number | null; p90: number | null; tipo: 'VALIDADO' | 'EXTENSION' | 'REFERENCIA' }[];
  historia: Punto[];
}

/**
 * Protocolo (§9): ≥26 observaciones → últimas 8 como evaluación cronológica de origen móvil a un paso; en cada origen la serie se reconstruye
 * con lo CONOCIDO a esa fecha (registrado_en) y los parámetros se eligen con ese pasado. <26 → ingenuo con advertencia; sin observaciones → sin pronóstico.
 */
export function pronosticar(repo: Repo, hechos: PedidoH[], o: { producto: string; region?: string; remoto?: boolean; corte: string; horizonte?: number }): ResultadoPronostico {
  const serie = `${o.producto}${o.region ? ' · ' + o.region : o.remoto !== undefined ? (o.remoto ? ' · remotos' : ' · no remotos') : ' · todas las regiones'}`;
  const H = o.horizonte ?? 8;
  const hist = serieDemanda(repo, hechos, { ...o, hasta: o.corte, conocimiento: o.corte });
  const v = hist.map((p) => p.valor), n = obs(v).length;
  const adv: string[] = [];
  const res: ResultadoPronostico = { serie, corte: o.corte, n_obs: n, protocolo: '', advertencias: adv, metricas: null, elegido: null, alfa: null, backtest: [], prediccion: [], historia: hist };
  if (!n) { res.protocolo = 'Sin observaciones: no hay pronóstico estadístico. Puede registrarse un escenario paramétrico explícito.'; adv.push('Producto o serie sin historia propia: no se copia la precisión de otro producto (AU03).'); return res; }
  if (hist.some((p) => p.valor === null)) adv.push(`${hist.filter((p) => p.valor === null).length} semana(s) sin datos: se tratan como faltantes, no como cero.`);
  if (hist.some((p) => p.atipico)) adv.push(`Atípico(s) señalado(s) en ${hist.filter((p) => p.atipico).map((p) => p.semana).join(', ')}: se conservan en la serie.`);
  if (hist.some((p) => p.censurada)) adv.push('Hay semanas con demanda censurada por falta de stock: se pronostica lo SOLICITADO, no lo entregado (AU01).');
  const ceros = obs(v).filter((x) => x === 0).length;
  if (ceros / n > 0.3) adv.push(`Serie intermitente (${Math.round((ceros / n) * 100)} % de semanas en cero): se informa MAE/WAPE; no se usa MAPE.`);
  const futuro = (nivel: number, q: [number, number] | null) => Array.from({ length: H }, (_, h) => {
    const sem = new Date(t(hist.at(-1)!.semana) + (h + 1) * SEM - 5 * 3600000).toISOString().slice(0, 10);
    return { semana: sem, valor: Math.max(0, nivel), p10: q ? Math.max(0, nivel + q[0]) : null, p90: q ? Math.max(0, nivel + q[1]) : null, tipo: (h < 8 ? 'VALIDADO' : 'EXTENSION') as 'VALIDADO' | 'EXTENSION' };
  });
  if (H > 8) adv.push(`Horizonte de ${H} semanas: las semanas 9 en adelante son una EXTENSIÓN por hipótesis de nivel constante, sin la validación del horizonte corto.`);
  if (n < 26) {
    res.protocolo = `Solo ${n} observaciones (< 26): método ingenuo con advertencia de información limitada; sin evaluación estadística.`;
    adv.push('Información limitada: la cifra es una referencia simple, no un pronóstico validado.');
    res.elegido = 'INGENUO';
    res.prediccion = futuro(obs(v).at(-1)!, null).map((x) => ({ ...x, tipo: 'REFERENCIA' as const }));
    return res;
  }
  res.protocolo = 'Evaluación cronológica: últimas 8 semanas, origen móvil a un paso, serie reconstruida con lo conocido en cada origen; alfa elegido solo con el pasado.';
  const metodos: Metodo[] = ['INGENUO', 'PM4', 'SES'];
  const err: Record<Metodo, { abs: number; y: number; n: number; res: number[] }> = { INGENUO: { abs: 0, y: 0, n: 0, res: [] }, PM4: { abs: 0, y: 0, n: 0, res: [] }, SES: { abs: 0, y: 0, n: 0, res: [] } };
  for (let i = hist.length - 8; i < hist.length; i++) {
    const origen = hist[i].semana + 'T00:00:00-05:00';
    const pasado = serieDemanda(repo, hechos, { ...o, hasta: origen, conocimiento: origen }).map((p) => p.valor);
    const alfa = elegirAlfa(pasado);
    const fila = { semana: hist[i].semana, real: hist[i].valor, INGENUO: pronosticoUnPaso(pasado, 'INGENUO'), PM4: pronosticoUnPaso(pasado, 'PM4'), SES: pronosticoUnPaso(pasado, 'SES', alfa) };
    res.backtest.push(fila);
    if (hist[i].valor === null) continue;
    for (const m of metodos) { const p = fila[m]; if (p === null) continue; const e = hist[i].valor! - p; err[m].abs += Math.abs(e); err[m].y += Math.abs(hist[i].valor!); err[m].n++; err[m].res.push(e); }
  }
  res.metricas = Object.fromEntries(metodos.map((m) => [m, { mae: err[m].n ? err[m].abs / err[m].n : null, wape: err[m].y ? (err[m].abs / err[m].y) * 100 : null, n: err[m].n }])) as ResultadoPronostico['metricas'];
  if (metodos.every((m) => res.metricas![m].wape === null)) adv.push('Todas las semanas evaluadas son cero: pronóstico base cero y WAPE no disponible (N/D).');
  // elección DESPUÉS de medir: menor WAPE; empate → menor MAE; luego el más simple
  const orden = [...metodos].sort((a, b) => (res.metricas![a].wape ?? Infinity) - (res.metricas![b].wape ?? Infinity) || (res.metricas![a].mae ?? Infinity) - (res.metricas![b].mae ?? Infinity) || metodos.indexOf(a) - metodos.indexOf(b));
  res.elegido = orden[0];
  res.alfa = elegirAlfa(v);
  const nivel = pronosticoUnPaso(v, res.elegido, res.alfa)!;
  const r = [...err[res.elegido].res].sort((a, b) => a - b);
  const q = (p: number) => { const pos = (r.length - 1) * p, lo = Math.floor(pos); return r[lo] + (r[Math.ceil(pos)] - r[lo]) * (pos - lo); };
  res.prediccion = futuro(nivel, r.length >= 5 ? [q(0.1), q(0.9)] : null);
  adv.push(r.length >= 5 ? 'Intervalo P10–P90 aproximado a partir de los residuos de la evaluación (8 semanas); no garantiza cobertura estadística.' : 'Sin residuos suficientes para un intervalo.');
  return res;
}

/** Guarda una corrida inmutable; una corrección crea otra corrida enlazada y conserva la original (AU07, BL07). */
export function guardarCorrida(repo: Repo, usuario: string, r: ResultadoPronostico, o: { corrige_a?: string; motivo?: string } = {}) {
  const id = nuevoId('PRN');
  repo.run('INSERT INTO corrida_pronostico VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, repo.reloj(), usuario, r.serie, r.corte, r.corte, r.elegido, JSON.stringify({ alfa: r.alfa, protocolo: r.protocolo, horizonte: r.prediccion.length }),
    JSON.stringify(r.metricas), JSON.stringify(r.prediccion), JSON.stringify(r.advertencias), VERSION_MOTOR, o.corrige_a ?? null, o.motivo ?? null]);
  return id;
}
/** Una corrida «vence» tras N días; la recomendación que dependa de ella exige revalidación (BL10). */
export function estadoCorrida(repo: Repo, corridaId: string, diasVigencia = 14) {
  const c = repo.uno('SELECT creada_en FROM corrida_pronostico WHERE corrida_id = ?', [corridaId]);
  if (!c) return 'INEXISTENTE';
  return Date.parse(repo.reloj()) - Date.parse(String(c.creada_en)) > diasVigencia * 86400000 ? 'VENCIDA' : 'VIGENTE';
}

/** Desagregación de una semana a días con pesos declarados, solo en días habilitados; conserva el total (AE08, AU08). */
export function desagregarSemana(total: number, pesos: number[], cerrados: number[] = []) {
  if (pesos.length !== 7 || pesos.some((p) => p < 0)) throw new Error('Se necesitan 7 pesos no negativos (lunes a domingo).');
  const w = pesos.map((p, i) => (cerrados.includes(i) ? 0 : p)), s = w.reduce((a, x) => a + x, 0);
  if (s <= 0) throw new Error('Distribución imposible: todos los días habilitados tienen peso cero o están cerrados.');
  const brutos = w.map((x) => (total * x) / s), base = brutos.map(Math.floor);
  let falta = Math.round(total) - base.reduce((a, x) => a + x, 0);
  for (const i of brutos.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[1])) { if (falta <= 0) break; if (w[i] > 0) { base[i]++; falta--; } }
  return { dias: base, regla: `Pesos normalizados sobre días habilitados (suma original ${pesos.reduce((a, x) => a + x, 0).toFixed(2)}); resto entero al día de mayor fracción.`, total: base.reduce((a, x) => a + x, 0) };
}

/** Kg → bultos solo con una mezcla de presentaciones declarada (AU04). */
export function convertirABultos(kg: number, mezcla: { presentacion: string; kg_por_bulto: number; proporcion: number }[]) {
  if (!mezcla.length) throw new Error('Para convertir kg a bultos declare la mezcla de presentaciones; no se inventa un número de bultos.');
  const s = mezcla.reduce((a, m) => a + m.proporcion, 0);
  if (Math.abs(s - 1) > 1e-6) throw new Error('Las proporciones de la mezcla deben sumar 100 %.');
  return mezcla.map((m) => { const exacto = (kg * m.proporcion) / m.kg_por_bulto; return { presentacion: m.presentacion, bultos: Math.ceil(exacto - 1e-9), exacto }; });
}

/**
 * BL03: revisión de desempeño. Para cada serie con corridas guardadas se mide el error REALIZADO de sus semanas validadas ya observadas
 * (con lo conocido hoy). Si las dos últimas corridas superan el umbral de WAPE, se abre una revisión (no se cambia el modelo solo).
 */
export function revisarDesempeno(repo: Repo, hechos: PedidoH[], umbralWape = 50) {
  const corr = repo.todos('SELECT corrida_id, serie, corte, metodo_elegido, prediccion FROM corrida_pronostico ORDER BY serie, corte');
  const porSerie = new Map<string, typeof corr>();
  for (const c of corr) porSerie.set(String(c.serie), [...(porSerie.get(String(c.serie)) ?? []), c]);
  const ahora = repo.reloj();
  const out: { serie: string; corridas: { corrida_id: string; corte: string; metodo: string; wape: number | null; semanas: number }[]; revisar: boolean }[] = [];
  for (const [serie, cs] of porSerie) {
    const [producto, resto] = serie.split(' · ');
    const o = resto === 'todas las regiones' ? {} : resto === 'remotos' ? { remoto: true } : resto === 'no remotos' ? { remoto: false } : { region: resto };
    const obsHoy = serieDemanda(repo, hechos, { producto, ...o, hasta: ahora, conocimiento: ahora });
    const mapa = new Map(obsHoy.map((p) => [p.semana, p.valor]));
    const filas = cs.map((c) => {
      const pred = (JSON.parse(String(c.prediccion)) as ResultadoPronostico['prediccion']).filter((x) => x.tipo === 'VALIDADO');
      let abs = 0, y = 0, n = 0;
      for (const x of pred) { const r = mapa.get(x.semana); if (r === undefined || r === null) continue; abs += Math.abs(r - x.valor); y += Math.abs(r); n++; }
      return { corrida_id: String(c.corrida_id), corte: String(c.corte), metodo: String(c.metodo_elegido), wape: y ? (abs / y) * 100 : null, semanas: n };
    });
    const ult = filas.filter((f) => f.semanas > 0).slice(-2);
    out.push({ serie, corridas: filas, revisar: ult.length === 2 && ult.every((f) => f.wape !== null && f.wape > umbralWape) });
  }
  return out;
}
