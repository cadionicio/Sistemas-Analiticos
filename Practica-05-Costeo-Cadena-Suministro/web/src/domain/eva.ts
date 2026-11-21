// EVA (MT-33): EVA = NOPAT − WACC × Capital invertido. Periodicidad ANUAL; no se mezcla con cifras mensuales sin convertir.
// WACC = Ke·E/(D+E) + Kd·(1−T)·D/(D+E). El costo de capital NO se suma al costo logístico (se cuenta solo aquí).

export interface ParametrosEVA { capital: number; ke: number; kd: number; deuda: number; patrimonio: number; t: number }
export interface EstadoResultados { ventas: number; costoVentas: number; costoLogistico: number; otrosGastos: number; t: number }

export function wacc(p: ParametrosEVA) {
  const v = p.deuda + p.patrimonio;
  if (!(v > 0)) throw new Error("WACC no calculable: deuda + patrimonio debe ser mayor que 0.");
  return { wacc: p.ke * (p.patrimonio / v) + p.kd * (1 - p.t) * (p.deuda / v), pesoE: p.patrimonio / v, pesoD: p.deuda / v, kdNeto: p.kd * (1 - p.t) };
}

export function nopat(e: EstadoResultados) {
  const utilidadOperativa = e.ventas - e.costoVentas - e.costoLogistico - e.otrosGastos;
  const impuesto = utilidadOperativa > 0 ? utilidadOperativa * e.t : 0; // sin escudo fiscal sobre pérdida operativa (supuesto declarado)
  return { utilidadOperativa, impuesto, nopat: utilidadOperativa - impuesto };
}

export const eva = (nopatAnual: number, waccAnual: number, capital: number) => nopatAnual - waccAnual * capital;

/** Alternativa: el ahorro operativo anual mejora NOPAT después de impuestos; la inversión aumenta el capital invertido. */
export function deltaEvaPropuesta(ahorroAnual: number, inversion: number, t: number, waccAnual: number) {
  const dNopat = ahorroAnual * (1 - t);
  const dCargo = waccAnual * inversion;
  return { dNopat, dCargo, dEva: dNopat - dCargo };
}
