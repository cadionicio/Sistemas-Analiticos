// Cálculo de tiempo para cualquier intervalo (megaprompt §4.1).
// Períodos [inicio, fin). Minutos de un tramo en la consulta:
//   max(0, min(fin del tramo, fin consultado, corte) − max(inicio del tramo, inicio consultado))
// En una parada abierta el fin del tramo es la hora de corte. Se agrupa después de recortar.
import { isoAMs, msAIso } from './fechas.js';

export const TIPOS_TRAMO = ['ESPERA_ATENCION', 'DIAGNOSTICO', 'ESPERA_REPUESTO', 'REPARACION', 'VERIFICACION', 'SIN_CLASIFICAR'];
export const NOMBRE_TRAMO = {
  ESPERA_ATENCION: 'Espera de atención', DIAGNOSTICO: 'Diagnóstico', ESPERA_REPUESTO: 'Espera de repuesto',
  REPARACION: 'Reparación', VERIFICACION: 'Verificación', SIN_CLASIFICAR: 'Sin clasificar',
};

export function minutosRecortados(inicioIso, finIso, desdeIso, hastaIso, corteIso) {
  const fin = Math.min(finIso ? isoAMs(finIso) : Infinity, isoAMs(hastaIso), isoAMs(corteIso));
  const ini = Math.max(isoAMs(inicioIso), isoAMs(desdeIso));
  return Math.max(0, Math.round((fin - ini) / 60000));
}

// Resumen de una lista de tramos dentro de [desde, hasta) con corte
export function resumenTramos(tramos, desde, hasta, corte) {
  const porTipo = Object.fromEntries(TIPOS_TRAMO.map(t => [t, 0]));
  let total = 0;
  for (const t of tramos) {
    const m = minutosRecortados(t.inicio, t.fin, desde, hasta, corte);
    porTipo[t.tipo] += m;
    total += m;
  }
  return { total, porTipo };
}

// Reparte los minutos por fecha calendario de Lima (00:00 a 24:00)
export function minutosPorFecha(tramos, desde, hasta, corte) {
  const out = {};
  const fin = Math.min(isoAMs(hasta), isoAMs(corte));
  let d = isoAMs(desde.slice(0, 10) + 'T00:00:00-05:00');
  while (d < fin) {
    const sig = d + 86400000;
    const a = msAIso(Math.max(d, isoAMs(desde))), b = msAIso(Math.min(sig, fin));
    const r = resumenTramos(tramos, a, b, corte);
    if (r.total > 0) out[msAIso(d).slice(0, 10)] = r;
    d = sig;
  }
  return out;
}
