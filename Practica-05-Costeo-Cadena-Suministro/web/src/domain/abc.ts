// Motor de dominio ABC — PC05
// Funciones puras: sin interfaz, sin base de datos. Toda cifra mostrada en pantalla
// o exportada debe provenir de estas funciones (Megaprompt V7, capa P3 Dominio).
// Convención monetaria: los cálculos internos usan precisión completa; los importes
// asignados se redondean a céntimos con ajuste de mayor residuo para que
// origen = asignado + saldo se cumpla exactamente (D-09, regla de conciliación).

import { fmtNum } from "./formato";

export const CENT = 0.01;
export const TOL = 0.005; // tolerancia de conciliación (medio céntimo)

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

// ---------- Costo individual de personal ----------

export interface ComponentesCosto {
  remuneracion: number;
  essalud: number;
  gratificacion: number;
  cts: number;
  vacaciones: number;
  bonos: number;
  otros: number;
}

export const COMPONENTES: { key: keyof ComponentesCosto; label: string }[] = [
  { key: "remuneracion", label: "Remuneración" },
  { key: "essalud", label: "EsSalud" },
  { key: "gratificacion", label: "Gratificación prorrateada" },
  { key: "cts", label: "CTS prorrateada" },
  { key: "vacaciones", label: "Vacaciones prorrateadas" },
  { key: "bonos", label: "Bonos" },
  { key: "otros", label: "Otros" },
];

export function costoEmpresa(c: ComponentesCosto): number {
  return round2(COMPONENTES.reduce((s, k) => s + (Number(c[k.key]) || 0), 0));
}

export interface TasaResultado {
  ok: boolean;
  tasa: number | null; // S/ por hora
  error?: string;
}

/** Tasa individual = costo empresa del período / horas disponibles del período. */
export function tasaHora(costo: number, horasDisponibles: number): TasaResultado {
  if (!(horasDisponibles > 0)) {
    return { ok: false, tasa: null, error: "Horas disponibles = 0: no se puede calcular la tasa (denominador cero)." };
  }
  if (costo < 0) return { ok: false, tasa: null, error: "Costo empresa negativo." };
  return { ok: true, tasa: costo / horasDisponibles };
}

export interface ImputacionPersona {
  actividadId: string;
  horas: number;
}

export interface ResultadoPersona {
  costo: number;
  horasDisponibles: number;
  horasImputadas: number;
  horasRestantes: number;
  tasa: number | null;
  porActividad: { actividadId: string; horas: number; importe: number }[];
  costoAplicado: number;
  capacidadNoUtilizada: number; // S/
  sobreimputada: boolean;
  estado: "OK" | "SOBREIMPUTADA" | "SOBREIMPUTADA_AUTORIZADA" | "SIN_TASA";
  mensaje?: string;
}

/**
 * CPD de una persona: importe_actividad = tasa × horas imputadas.
 * Capacidad no utilizada = (disponibles − imputadas) × tasa, visible y no repartida.
 * Sobreimputación bloqueada salvo autorización justificada.
 */
export function costearPersona(
  costo: number,
  horasDisponibles: number,
  imputaciones: ImputacionPersona[],
  sobreimputacionAutorizada = false,
): ResultadoPersona {
  const t = tasaHora(costo, horasDisponibles);
  const horasImputadas = imputaciones.reduce((s, i) => s + (i.horas || 0), 0);
  const base = {
    costo,
    horasDisponibles,
    horasImputadas,
    horasRestantes: horasDisponibles - horasImputadas,
  };
  if (!t.ok || t.tasa === null) {
    return {
      ...base,
      tasa: null,
      porActividad: imputaciones.map((i) => ({ actividadId: i.actividadId, horas: i.horas, importe: 0 })),
      costoAplicado: 0,
      capacidadNoUtilizada: 0,
      sobreimputada: false,
      estado: "SIN_TASA",
      mensaje: t.error,
    };
  }
  const tasa = t.tasa;
  const sobre = horasImputadas > horasDisponibles + 1e-9;
  if (sobre && !sobreimputacionAutorizada) {
    return {
      ...base,
      tasa,
      porActividad: imputaciones.map((i) => ({ actividadId: i.actividadId, horas: i.horas, importe: 0 })),
      costoAplicado: 0,
      capacidadNoUtilizada: 0,
      sobreimputada: true,
      estado: "SOBREIMPUTADA",
      mensaje: `Imputa ${horasImputadas} h y solo dispone de ${horasDisponibles} h. Cálculo bloqueado hasta corregir o autorizar con justificación.`,
    };
  }
  const porActividad = imputaciones.map((i) => ({ actividadId: i.actividadId, horas: i.horas, importe: round2(tasa * i.horas) }));
  const costoAplicado = round2(porActividad.reduce((s, a) => s + a.importe, 0));
  const capacidad = sobre ? 0 : round2(costo - costoAplicado);
  return {
    ...base,
    tasa,
    porActividad,
    costoAplicado,
    capacidadNoUtilizada: capacidad,
    sobreimputada: sobre,
    estado: sobre ? "SOBREIMPUTADA_AUTORIZADA" : "OK",
    mensaje: sobre ? "Sobreimputación autorizada: el costo aplicado supera el costo empresa; revisar horas extra en componentes." : undefined,
  };
}

// ---------- Reparto por inductor ----------

/**
 * Tipos de base:
 *  - cantidad:   unidades físicas (pedidos, kWh, m², #PC). Tasa = pool / Σ cantidades.
 *  - porcentaje: fracciones 0..1. Σ<1 → saldo no asignado; Σ>1 → error bloqueante.
 *  - importe:    soles por destino que deben sumar el pool (ej. «Remun directa»). Σ<pool → saldo; Σ>pool → error.
 *  - directo:    un único destino recibe el 100 %.
 *  - plano:      partes iguales entre los destinos marcados (método de menor precisión).
 */
export type TipoBase = "cantidad" | "porcentaje" | "importe" | "directo" | "plano";

export interface BaseDestino {
  destinoId: string;
  valor: number | null; // null = sin dato (pendiente)
}

export interface LineaReparto {
  destinoId: string;
  base: number;
  importe: number;
}

export interface ResultadoReparto {
  estado: "CALCULADO" | "CON_SALDO" | "BLOQUEADO" | "PENDIENTE";
  pool: number;
  tipo: TipoBase;
  denominador: number | null; // Σ bases usadas
  tasa: number | null; // S/ por unidad del inductor
  unidadTasa: string;
  lineas: LineaReparto[];
  asignado: number;
  saldo: number; // pool − asignado (≥ 0)
  mensajes: string[];
  pasos: string[]; // explicación paso a paso
}

function fmt(n: number, d = 2): string {
  return fmtNum(n, d);
}

/** Redondea a céntimos garantizando Σ redondeado = objetivo (método de mayor residuo). */
export function redondearConservando(valores: number[], objetivo: number): number[] {
  const cents = Math.round(objetivo * 100);
  const raw = valores.map((v) => v * 100);
  const floor = raw.map((v) => Math.floor(v + 1e-9));
  let resto = cents - floor.reduce((s, v) => s + v, 0);
  const orden = raw.map((v, i) => ({ i, frac: v - Math.floor(v + 1e-9) })).sort((a, b) => b.frac - a.frac);
  const out = floor.slice();
  for (let k = 0; k < orden.length && resto > 0; k++, resto--) out[orden[k].i] += 1;
  for (let k = orden.length - 1; k >= 0 && resto < 0; k--, resto++) out[orden[k].i] -= 1;
  return out.map((c) => c / 100);
}

export function repartir(pool: number, tipo: TipoBase, bases: BaseDestino[], unidad = "unidad"): ResultadoReparto {
  const pasos: string[] = [];
  const mensajes: string[] = [];
  const conDato = bases.filter((b) => b.valor !== null && b.valor !== undefined && !Number.isNaN(b.valor));
  const faltan = bases.length - conDato.length;
  const r = (estado: ResultadoReparto["estado"], extra: Partial<ResultadoReparto>): ResultadoReparto => ({
    estado,
    pool,
    tipo,
    denominador: null,
    tasa: null,
    unidadTasa: `S/ por ${unidad}`,
    lineas: [],
    asignado: 0,
    saldo: round2(pool),
    mensajes,
    pasos,
    ...extra,
  });
  pasos.push(`1. Costo a repartir (pool) = S/ ${fmt(pool)}.`);
  if (pool < 0) {
    mensajes.push("El costo a repartir es negativo.");
    return r("BLOQUEADO", {});
  }
  if (faltan > 0) mensajes.push(`${faltan} destino(s) sin valor de inductor: se tratan como 0 y quedan marcados Pendiente.`);
  const vals = bases.map((b) => (b.valor === null || b.valor === undefined || Number.isNaN(b.valor) ? 0 : Number(b.valor)));
  if (vals.some((v) => v < 0)) {
    mensajes.push("Hay valores de inductor negativos: reparto bloqueado.");
    return r("BLOQUEADO", {});
  }
  let brutos: number[] = [];
  let objetivo = pool;
  let denominador: number | null = null;
  let tasa: number | null = null;

  if (tipo === "cantidad") {
    denominador = vals.reduce((s, v) => s + v, 0);
    pasos.push(`2. Denominador = Σ cantidades del inductor = ${fmt(denominador, 4)} ${unidad}.`);
    if (denominador <= 0) {
      mensajes.push("Denominador cero: no se calcula la tasa; el costo completo queda como saldo pendiente de asignación.");
      pasos.push("3. Denominador = 0 → reparto NO calculado. Saldo = pool.");
      return r("PENDIENTE", { denominador });
    }
    tasa = pool / denominador;
    pasos.push(`3. Tasa de asignación = ${fmt(pool)} / ${fmt(denominador, 4)} = S/ ${fmt(tasa, 6)} por ${unidad}.`);
    brutos = vals.map((v) => tasa! * v);
    pasos.push(`4. Importe por destino = tasa × cantidad del destino.`);
  } else if (tipo === "porcentaje" || tipo === "importe") {
    const suma = vals.reduce((s, v) => s + v, 0);
    denominador = suma;
    if (tipo === "porcentaje") {
      pasos.push(`2. Suma de porcentajes = ${fmt(suma * 100, 4)} %.`);
      if (suma > 1 + 1e-9) {
        mensajes.push(`Los porcentajes suman ${fmt(suma * 100, 2)} % (> 100 %): confirmación bloqueada.`);
        return r("BLOQUEADO", { denominador });
      }
      tasa = pool / 100;
      pasos.push(`3. Tasa = S/ ${fmt(pool)} / 100 = S/ ${fmt(tasa, 6)} por punto porcentual.`);
      brutos = vals.map((v) => pool * v);
      objetivo = pool * suma;
      pasos.push(`4. Importe por destino = pool × porcentaje del destino. No se normaliza.`);
    } else {
      pasos.push(`2. Suma de importes base = S/ ${fmt(suma)} frente a pool S/ ${fmt(pool)}.`);
      if (suma > pool + TOL) {
        mensajes.push(`Los importes base suman S/ ${fmt(suma)}, más que el pool S/ ${fmt(pool)}: confirmación bloqueada.`);
        return r("BLOQUEADO", { denominador });
      }
      tasa = 1;
      pasos.push(`3. Tasa = 1 (cada sol de base es un sol asignado).`);
      brutos = vals.slice();
      objetivo = suma;
      pasos.push(`4. Importe por destino = importe base del destino. No se normaliza.`);
    }
  } else if (tipo === "directo") {
    const marcados = vals.filter((v) => v > 0).length;
    pasos.push(`2. Regla directa: un único destino recibe el 100 %.`);
    if (marcados !== 1) {
      mensajes.push(marcados === 0 ? "Regla directa sin destino marcado: el costo queda pendiente." : "Regla directa con más de un destino: reparto bloqueado.");
      return r(marcados === 0 ? "PENDIENTE" : "BLOQUEADO", {});
    }
    denominador = 1;
    tasa = pool;
    brutos = vals.map((v) => (v > 0 ? pool : 0));
  } else if (tipo === "plano") {
    const marcados = vals.filter((v) => v > 0).length;
    pasos.push(`2. Reparto plano (menor precisión): partes iguales entre ${marcados} destino(s) marcados.`);
    if (marcados === 0) {
      mensajes.push("Reparto plano sin destinos marcados: el costo queda pendiente.");
      return r("PENDIENTE", {});
    }
    denominador = marcados;
    tasa = pool / marcados;
    pasos.push(`3. Tasa = ${fmt(pool)} / ${marcados} = S/ ${fmt(tasa, 6)} por destino.`);
    brutos = vals.map((v) => (v > 0 ? tasa! : 0));
  }

  const importes = redondearConservando(brutos, round2(objetivo));
  const lineas = bases.map((b, i) => ({ destinoId: b.destinoId, base: vals[i], importe: importes[i] }));
  const asignado = round2(importes.reduce((s, v) => s + v, 0));
  const saldo = round2(pool - asignado);
  pasos.push(`5. Total asignado = S/ ${fmt(asignado)}; saldo no asignado = S/ ${fmt(saldo)}.`);
  pasos.push(`6. Conciliación: ${fmt(pool)} = ${fmt(asignado)} + ${fmt(saldo)} → ${Math.abs(pool - asignado - saldo) <= TOL ? "CUADRA" : "NO CUADRA"}.`);
  if (saldo > TOL) mensajes.push(`Saldo no asignado S/ ${fmt(saldo)}: visible y pendiente de revisión.`);
  return {
    estado: saldo > TOL ? "CON_SALDO" : "CALCULADO",
    pool,
    tipo,
    denominador,
    tasa,
    unidadTasa: tipo === "porcentaje" ? "S/ por punto %" : tipo === "importe" ? "S/ por S/" : tipo === "plano" ? "S/ por destino" : `S/ por ${unidad}`,
    lineas,
    asignado,
    saldo,
    mensajes,
    pasos,
  };
}

export function concilia(origen: number, asignado: number, saldo: number): boolean {
  return Math.abs(origen - asignado - saldo) <= TOL;
}
