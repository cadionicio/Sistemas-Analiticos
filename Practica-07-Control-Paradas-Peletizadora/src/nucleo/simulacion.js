// Modelo estocástico de reposición (megaprompt §4.5–4.6).
// A: comprar la pieza al necesitarla (compra urgente). B: conservar 1 unidad y pedir reposición normal al consumirla.
// Ambas políticas usan el MISMO horizonte, la MISMA secuencia de demandas y los MISMOS plazos aleatorios (números aleatorios comunes).
// Tiempo entre fallas en horas de operación (el reloj se detiene con el equipo parado); plazos en tiempo calendario.
import { filas, valor } from './bd.js';
import { isoAMs } from './fechas.js';
import { sha256Hex } from './sha256.js';

// Generador pseudoaleatorio reproducible (mulberry32)
export function generador(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const percentil = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const media = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const desv = xs => { const m = media(xs); return xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) : 0; };
const param = (k, d) => { const v = valor('SELECT valor FROM parametro WHERE clave=?', [k]); return v === null ? d : Number(v); };

// Parámetros por defecto a partir del historial de la pieza y de los parámetros del Excel 06
export function parametrosPorDefecto(pieza, corte) {
  const p = filas('SELECT * FROM pieza WHERE codigo=?', [pieza])[0];
  if (!p) return null;
  const desde = (valor('SELECT min(fecha) FROM horas_operacion WHERE equipo_codigo=?', [p.equipo_codigo]) || '2026-01-01') + 'T00:00:00-05:00';
  const opH = Number(valor('SELECT coalesce(sum(minutos),0) FROM horas_operacion WHERE equipo_codigo=? AND fecha>=? AND fecha<?', [p.equipo_codigo, desde.slice(0, 10), corte.slice(0, 10)])) / 60;
  const ev = filas(`SELECT c.orden_codigo, min(c.fecha_efectiva) AS fecha, sum(c.cantidad) AS cant, o.parada_codigo FROM consumo c JOIN orden o ON o.codigo=c.orden_codigo
    WHERE c.pieza_codigo=? AND o.tipo='CORRECTIVA' AND c.fecha_efectiva>=? AND c.fecha_efectiva<? GROUP BY c.orden_codigo ORDER BY fecha`, [pieza, desde, corte]);
  // Reparación + verificación media de las paradas que consumieron la pieza (común a ambas políticas)
  const rep = ev.map(e => filas("SELECT * FROM tramo WHERE parada_codigo=? AND tipo IN ('REPARACION','VERIFICACION') AND fin IS NOT NULL", [e.parada_codigo])
    .reduce((a, t) => a + (isoAMs(t.fin) - isoAMs(t.inicio)) / 3600000, 0));
  return {
    pieza, nombre: p.nombre, equipo: p.equipo_codigo,
    eventos_hist: ev.length, horas_operacion_hist: opH,
    tasa_por_1000h: ev.length && opH ? Math.round(1e6 * ev.length / opH) / 1000 : 0,
    unidades_por_demanda: ev.length ? Math.max(1, Math.round(ev.reduce((a, e) => a + e.cant, 0) / ev.length)) : 1,
    reparacion_h: rep.length ? Math.round(100 * media(rep)) / 100 : 4,
    costo_unitario: p.costo_cent / 100,
    plazo_normal_dias: p.plazo_normal_dias,
    plazo_urgente_horas: p.plazo_urgente_horas,
    costo_hora_parada: param('costo_hora_parada_soles', 1800),
    posesion_anual_pct: param('costo_posesion_anual_pct', 25),
    recargo_urgencia_pct: param('recargo_urgencia_pct', 30),
    horas_plan_dia: param('horas_plan_dia', 16),
    horizonte_dias: param('horizonte_defecto_dias', 180),
    semilla: param('semilla_defecto', 20261119),
    repeticiones: param('repeticiones_defecto', 2000),
    reposicion_inmediata: false,
  };
}

// Simulación de una política sobre una réplica ya sorteada
function correrPolitica(pol, rep, P) {
  const H = P.horizonte_dias * 24;
  const fCal = 168 / (P.horas_plan_dia * 6);               // horas calendario por hora de operación
  const fProd = (P.horas_plan_dia * 6) / 168;              // fracción productiva de una hora calendario
  const cu = P.costo_unitario, urg = cu * (1 + P.recargo_urgencia_pct / 100);
  const posH = cu * P.posesion_anual_pct / 100 / 8760;     // costo de posesión por unidad y hora
  let t = 0, stock = pol === 'B' ? 1 : 0, pend = [];
  let compras = pol === 'B' ? cu : 0, posesion = 0, espera = 0, faltas = 0, dem = 0;
  const avanzar = hasta => {                                // acumula posesión y recibe pedidos hasta 'hasta'
    pend.sort((a, b) => a - b);
    while (pend.length && pend[0] <= hasta) { posesion += stock * posH * (pend[0] - t); t = pend.shift(); stock++; }
    posesion += stock * posH * (hasta - t); t = hasta;
  };
  for (const d of rep) {
    const tf = t + d.tbf * fCal;
    if (tf > H) break;
    avanzar(tf); dem++;
    let w = 0;
    if (stock > 0) { stock--; pend.push(tf + d.lt_normal); compras += cu; }
    else if (pol === 'B' && pend.length) {
      pend.sort((a, b) => a - b);
      const rest = pend[0] - tf;
      if (rest <= d.lt_urg) { w = rest; pend.shift(); pend.push(tf + w + d.lt_normal); compras += cu; }
      else { w = d.lt_urg; compras += urg; }
    } else { w = d.lt_urg; compras += urg; if (pol === 'B') pend.push(tf + d.lt_normal), compras += cu; }
    if (w > 0) faltas++;
    espera += w;
    avanzar(Math.min(H, tf + w + P.reparacion_h));          // equipo parado: no se expone a nuevas fallas
    if (t >= H) break;
  }
  avanzar(H);
  const inventarioFinal = (stock + pend.length) * cu;       // se descuenta lo que queda en almacén o en camino
  const costoEspera = espera * fProd * P.costo_hora_parada;
  return { costo: compras + posesion + costoEspera - inventarioFinal, compras, posesion, costoEspera, inventarioFinal, espera_h: espera, faltas, demandas: dem };
}

export function simular(Pentrada) {
  const P = { ...Pentrada };
  if (P.reposicion_inmediata) { P.plazo_normal_dias = 0; P.plazo_urgente_horas = 0; }
  const rnd = generador(P.semilla);
  const lam = P.tasa_por_1000h / 1000;
  const reps = [];
  for (let r = 0; r < P.repeticiones; r++) {
    const rep = [];
    let acum = 0;
    // Demandas suficientes para cubrir el horizonte (el bucle de política corta al pasar el horizonte)
    while (lam > 0 && acum < P.horizonte_dias * 24 * 2 && rep.length < 500) {
      const tbf = -Math.log(1 - rnd()) / lam;                // horas de operación entre demandas (exponencial)
      const ltN = P.plazo_normal_dias * 24 * (0.8 + 0.6 * rnd());   // plazo normal: 80 % a 140 % del nominal
      const ltU = P.plazo_urgente_horas * (0.75 + 0.75 * rnd());    // plazo urgente: 75 % a 150 % del nominal
      rep.push({ tbf, lt_normal: ltN, lt_urg: ltU });
      acum += tbf * 1.75;
    }
    reps.push(rep);
  }
  const A = reps.map(rp => correrPolitica('A', rp, P)), B = reps.map(rp => correrPolitica('B', rp, P));
  const resumen = xs => {
    const c = xs.map(x => x.costo), e = xs.map(x => x.espera_h);
    const dem = xs.reduce((a, x) => a + x.demandas, 0), fal = xs.reduce((a, x) => a + x.faltas, 0);
    return { costo_medio: media(c), costo_desv: desv(c), costo_p10: percentil(c, 0.1), costo_p50: percentil(c, 0.5), costo_p90: percentil(c, 0.9),
      espera_media_h: media(e), espera_p90_h: percentil(e, 0.9), demandas: dem, faltantes: fal, prob_faltante: dem ? fal / dem : null,
      compras: media(xs.map(x => x.compras)), posesion: media(xs.map(x => x.posesion)), costo_espera: media(xs.map(x => x.costoEspera)), inventario_final: media(xs.map(x => x.inventarioFinal)) };
  };
  const dif = A.map((a, i) => B[i].costo - a.costo);
  const se = desv(dif) / Math.sqrt(dif.length || 1);
  const rA = resumen(A), rB = resumen(B);
  const md = media(dif);
  const recomendada = Math.abs(md) < 1.96 * se ? 'Indiferente' : md < 0 ? 'B' : 'A';
  return {
    parametros: P, A: rA, B: rB,
    diferencia_media: md, diferencia_ic95: [md - 1.96 * se, md + 1.96 * se], error_estandar: se,
    recomendada,
    metodo_demanda: 'Exponencial con la tasa histórica de demandas por hora de operación (pocos registros: parámetro tratado como supuesto sintético)',
    replicas: A.map((a, i) => ({ replica: i + 1, demandas: a.demandas, costo_A: a.costo, costo_B: B[i].costo, espera_A_h: a.espera_h, espera_B_h: B[i].espera_h, faltantes_A: a.faltas, faltantes_B: B[i].faltas })),
  };
}

// Sensibilidad: cómo cambia la decisión al variar el costo por hora y el plazo urgente
export function sensibilidad(P, reps = 500) {
  const out = [];
  for (const fc of [0.5, 1, 1.5]) for (const fp of [0.5, 1, 2]) {
    const r = simular({ ...P, repeticiones: reps, costo_hora_parada: P.costo_hora_parada * fc, plazo_urgente_horas: P.plazo_urgente_horas * fp });
    out.push({ factor_costo_hora: fc, factor_plazo_urgente: fp, costo_hora: P.costo_hora_parada * fc, plazo_urgente_h: P.plazo_urgente_horas * fp, costo_A: r.A.costo_medio, costo_B: r.B.costo_medio, recomendada: r.recomendada });
  }
  return out;
}

export function idCorrida(P, version, sha06, corte) {
  return 'SIM-' + sha256Hex(new TextEncoder().encode(JSON.stringify({ P, version, sha06, corte: corte.slice(0, 16) }))).slice(0, 10).toUpperCase();
}
