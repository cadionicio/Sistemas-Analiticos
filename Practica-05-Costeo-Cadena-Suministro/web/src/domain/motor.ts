import { fmtNum } from "./formato";
// Motor ABC completo (dominio puro). Secuencia: P1 → P2 → P3 → P4a → P4b(N centros) → Resumen → P4c.
// Reglas aprobadas: D-04 capacidad no utilizada, D-06 P2 opcional, D-07 centros fuera de la cadena,
// D-08 otras actividades, D-09 sin normalización silenciosa, D-10 IGV, D-15 estados de valor.
import { costearPersona, repartir, round2, ResultadoReparto, TipoBase, TOL, ResultadoPersona } from "./abc";

export type Participacion = "PARTICIPA" | "NO_PARTICIPA" | "PARCIAL";
export type Alcance = "INCLUIDA" | "EXCLUIDA" | "PARCIAL";

export interface MCentro { id: string; codigo: string; nombre: string; participacion: Participacion; pct: number | null }
export interface MActividad { id: string; codigo: string; nombre: string; centroId: string; alcance: Alcance; pct: number | null; clase: string | null }
export interface MMaterial {
  id: string; codigo: string; nombre: string; unidad: string; costoFactura: number; cantidadFactura: number; equivalencia: number;
  incluyeIgv: boolean; igvRecuperable: boolean; tratamientoValidado: boolean;
}
export interface MConsumo { actividadId: string; materialId: string; cantidad: number }
export interface MServicio { id: string; actividadId: string; proveedor: string; servicio: string; cantidad: number; unidad: string; tarifa: number }
export interface MPersona { id: string; codigo: string; nombre: string; puesto: string; tipo: "DIRECTO" | "INDIRECTO"; centroId: string | null; costo: number; horas: number; autorizada: boolean; agregado: boolean }
export interface MHoras { personaId: string; actividadId: string; horas: number }
export interface MEC { id: string; codigo: string; nombre: string; monto: number }
export interface MRegla { id: string; codigo: string; nivel: "EC_CA" | "CA_AC" | "AC_OC"; origenId: string; centroId: string | null; inductor: string; unidad: string; tipo: TipoBase; baseDesde: string | null }
export interface MBase { reglaId: string; destinoId: string; valor: number | null; estado: string }
export interface MObjeto { id: string; codigo: string; nombre: string; magnitud: string; cantidad: number | null; clase: string }

export interface ModeloInput {
  igv: number;
  centros: MCentro[]; actividades: MActividad[]; materiales: MMaterial[]; consumos: MConsumo[]; servicios: MServicio[];
  personas: MPersona[]; horas: MHoras[]; ecs: MEC[]; reglas: MRegla[]; bases: MBase[]; objetos: MObjeto[];
}

export interface CostoUnitMaterial { materialId: string; base: number; impuesto: number; costoUnit: number; pendiente: boolean; formula: string }

export function costoUnitarioMaterial(m: MMaterial, igv: number): CostoUnitMaterial {
  const excluir = m.incluyeIgv && m.igvRecuperable;
  const base = excluir ? m.costoFactura / (1 + igv) : m.costoFactura;
  const impuesto = m.incluyeIgv ? m.costoFactura - m.costoFactura / (1 + igv) : 0;
  const costoUnit = base / (m.cantidadFactura * m.equivalencia);
  const formula = excluir
    ? `${m.costoFactura} / (1 + ${igv}) / (${m.cantidadFactura} × ${m.equivalencia})`
    : `${m.costoFactura} / (${m.cantidadFactura} × ${m.equivalencia})`;
  return { materialId: m.id, base, impuesto, costoUnit, pendiente: m.incluyeIgv && !m.tratamientoValidado, formula };
}

export interface Saldo { etapa: string; origen: string; destino?: string; monto: number; causa: string; tipo: "PENDIENTE" | "FUERA_ALCANCE" | "CAPACIDAD" | "BLOQUEADO" }

export interface RepartoReg { regla: MRegla | null; origenId: string; centroId: string | null; pool: number; r: ResultadoReparto | null; causa?: string }

export interface ResultadoModelo {
  p1: { actividadId: string; materialId: string; cantidad: number; costoUnit: number; importe: number }[];
  cmd: Map<string, number>;
  unitMat: Map<string, CostoUnitMaterial>;
  p2: { servicio: MServicio; importe: number }[];
  csd: Map<string, number>;
  p3: { persona: MPersona; r: ResultadoPersona }[];
  cpd: Map<string, number>;
  p4a: RepartoReg[]; // uno por EC
  ciCentro: Map<string, Map<string, number>>; // ec -> centro -> importe
  p4b: RepartoReg[]; // uno por (centro, EC)
  ciAct: Map<string, Map<string, number>>; // actividad -> ec -> importe
  ci: Map<string, number>;
  resumen: { act: MActividad; cmd: number; csd: number; cpd: number; ci: number; total: number; pct: number }[];
  p4c: RepartoReg[]; // uno por actividad
  objetos: { obj: MObjeto; costo: number; unitario: number | null }[];
  saldos: Saldo[];
  conciliacion: { concepto: string; monto: number; signo: 1 | -1 }[];
  totalFuente: number;
  totalExplicado: number;
  cuadra: boolean;
  bloqueos: string[];
  advertencias: string[];
}

function addTo(m: Map<string, number>, k: string, v: number) {
  m.set(k, round2((m.get(k) || 0) + v));
}

export function costearModelo(inp: ModeloInput): ResultadoModelo {
  const saldos: Saldo[] = [];
  const bloqueos: string[] = [];
  const advertencias: string[] = [];
  const actById = new Map(inp.actividades.map((a) => [a.id, a]));
  const cenById = new Map(inp.centros.map((c) => [c.id, c]));
  // Índices de búsqueda (mismo resultado que recorrer las listas: se conserva el primer registro de cada clave).
  const idxBases = new Map<string, (typeof inp.bases)[number]>();
  for (const x of inp.bases) {
    const k = x.reglaId + "\u0000" + x.destinoId;
    if (!idxBases.has(k)) idxBases.set(k, x);
  }
  const baseDe = (reglaId: string, destinoId: string) => idxBases.get(reglaId + "\u0000" + destinoId);
  const horasDe = new Map<string, (typeof inp.horas)[number][]>();
  for (const h of inp.horas) {
    const l = horasDe.get(h.personaId);
    if (l) l.push(h);
    else horasDe.set(h.personaId, [h]);
  }

  // ---- P1 CMD ----
  const unitMat = new Map(inp.materiales.map((m) => [m.id, costoUnitarioMaterial(m, inp.igv)]));
  const cmd = new Map<string, number>();
  const p1 = inp.consumos
    .filter((c) => c.cantidad > 0 && actById.has(c.actividadId))
    .map((c) => {
      const u = unitMat.get(c.materialId)!;
      const importe = round2(c.cantidad * u.costoUnit);
      addTo(cmd, c.actividadId, importe);
      return { actividadId: c.actividadId, materialId: c.materialId, cantidad: c.cantidad, costoUnit: u.costoUnit, importe };
    });
  for (const u of unitMat.values()) if (u.pendiente) advertencias.push(`Material ${u.materialId}: tratamiento tributario pendiente de validación.`);

  // ---- P2 CSD ----
  const csd = new Map<string, number>();
  const p2 = inp.servicios.map((s) => {
    const importe = round2(s.cantidad * s.tarifa);
    addTo(csd, s.actividadId, importe);
    return { servicio: s, importe };
  });

  // ---- P3 CPD (solo personal directo) ----
  const cpd = new Map<string, number>();
  const p3 = inp.personas
    .filter((p) => p.tipo === "DIRECTO")
    .map((p) => {
      const imps = (horasDe.get(p.id) || []).filter((h) => h.horas > 0).map((h) => ({ actividadId: h.actividadId, horas: h.horas }));
      const r = costearPersona(p.costo, p.horas, imps, p.autorizada);
      if (r.estado === "SOBREIMPUTADA" || r.estado === "SIN_TASA") bloqueos.push(`P3 ${p.codigo} ${p.nombre}: ${r.mensaje}`);
      for (const a of r.porActividad) addTo(cpd, a.actividadId, a.importe);
      if (r.capacidadNoUtilizada > TOL) saldos.push({ etapa: "P3", origen: p.id, monto: r.capacidadNoUtilizada, causa: `Capacidad no utilizada de ${p.codigo} (${fmtNum(r.horasRestantes, 2)} h × tasa)`, tipo: "CAPACIDAD" });
      return { persona: p, r };
    });

  // ---- P4a EC → CA ----
  const ciCentro = new Map<string, Map<string, number>>();
  const p4a: RepartoReg[] = inp.ecs.map((ec) => {
    const regla = inp.reglas.find((r) => r.nivel === "EC_CA" && r.origenId === ec.id) || null;
    const m = new Map<string, number>();
    ciCentro.set(ec.id, m);
    if (!regla) {
      if (ec.monto > TOL) saldos.push({ etapa: "P4a", origen: ec.id, monto: round2(ec.monto), causa: `${ec.nombre}: sin regla de reparto a centros`, tipo: "PENDIENTE" });
      return { regla: null, origenId: ec.id, centroId: null, pool: ec.monto, r: null, causa: "Sin regla" };
    }
    let bases = inp.centros.map((c) => {
      const b = baseDe(regla.id, c.id);
      return { destinoId: c.id, valor: b && b.estado !== "PENDIENTE" ? b.valor : null };
    });
    if (regla.baseDesde === "PERSONAL_INDIRECTO") {
      // D-05: base = suma del costo empresa del personal indirecto registrado por centro
      bases = inp.centros.map((c) => ({ destinoId: c.id, valor: round2(inp.personas.filter((p) => p.tipo === "INDIRECTO" && p.centroId === c.id).reduce((s, p) => s + p.costo, 0)) }));
    }
    const r = repartir(ec.monto, regla.tipo, bases, regla.unidad || "unidad");
    r.lineas.forEach((l) => l.importe > 0 && m.set(l.destinoId, l.importe));
    if (r.estado === "BLOQUEADO") bloqueos.push(`P4a ${ec.nombre}: ${r.mensajes.join(" ")}`);
    if (r.saldo > TOL) saldos.push({ etapa: "P4a", origen: ec.id, monto: r.saldo, causa: `${ec.nombre}: ${r.mensajes.join(" ") || "saldo no asignado"}`, tipo: r.estado === "BLOQUEADO" ? "BLOQUEADO" : "PENDIENTE" });
    return { regla, origenId: ec.id, centroId: null, pool: ec.monto, r };
  });

  // ---- P4b CA → AC (por centro participante) ----
  const ciAct = new Map<string, Map<string, number>>();
  const ci = new Map<string, number>();
  const p4b: RepartoReg[] = [];
  for (const c of inp.centros) {
    const frac = c.participacion === "PARTICIPA" ? 1 : c.participacion === "PARCIAL" ? Math.max(0, Math.min(1, c.pct ?? 0)) : 0;
    const acts = inp.actividades.filter((a) => a.centroId === c.id);
    for (const ec of inp.ecs) {
      const monto = ciCentro.get(ec.id)?.get(c.id) || 0;
      if (monto <= TOL) continue;
      const fuera = round2(monto * (1 - frac));
      if (fuera > TOL)
        saldos.push({ etapa: "P4b", origen: ec.id, destino: c.id, monto: fuera, causa: `${ec.nombre} en ${c.codigo} ${c.nombre}: centro ${c.participacion === "NO_PARTICIPA" ? "fuera de la cadena" : "con participación parcial " + Math.round(frac * 100) + " %"}`, tipo: "FUERA_ALCANCE" });
      const pool = round2(monto - fuera);
      if (pool <= TOL) continue;
      const regla = inp.reglas.find((r) => r.nivel === "CA_AC" && r.origenId === ec.id && r.centroId === c.id) || null;
      if (!regla) {
        saldos.push({ etapa: "P4b", origen: ec.id, destino: c.id, monto: pool, causa: `${ec.nombre} en ${c.codigo}: sin regla de reparto a actividades`, tipo: "PENDIENTE" });
        p4b.push({ regla: null, origenId: ec.id, centroId: c.id, pool, r: null, causa: "Sin regla" });
        continue;
      }
      const bases = acts.map((a) => {
        const b = baseDe(regla.id, a.id);
        return { destinoId: a.id, valor: b && b.estado !== "PENDIENTE" ? b.valor : null };
      });
      const r = repartir(pool, regla.tipo, bases, regla.unidad || "unidad");
      for (const l of r.lineas) {
        if (l.importe <= 0) continue;
        if (!ciAct.has(l.destinoId)) ciAct.set(l.destinoId, new Map());
        addTo(ciAct.get(l.destinoId)!, ec.id, l.importe);
        addTo(ci, l.destinoId, l.importe);
      }
      if (r.estado === "BLOQUEADO") bloqueos.push(`P4b ${c.codigo} · ${ec.nombre}: ${r.mensajes.join(" ")}`);
      if (r.saldo > TOL) saldos.push({ etapa: "P4b", origen: ec.id, destino: c.id, monto: r.saldo, causa: `${ec.nombre} en ${c.codigo}: ${r.mensajes.join(" ") || "saldo no asignado"}`, tipo: r.estado === "BLOQUEADO" ? "BLOQUEADO" : "PENDIENTE" });
      p4b.push({ regla, origenId: ec.id, centroId: c.id, pool, r });
    }
  }

  // ---- Resumen por actividad ----
  const resumen = inp.actividades.map((a) => {
    const v = { act: a, cmd: cmd.get(a.id) || 0, csd: csd.get(a.id) || 0, cpd: cpd.get(a.id) || 0, ci: ci.get(a.id) || 0, total: 0, pct: 0 };
    v.total = round2(v.cmd + v.csd + v.cpd + v.ci);
    return v;
  });
  const totAct = resumen.reduce((s, x) => s + x.total, 0);
  resumen.forEach((x) => (x.pct = totAct > 0 ? x.total / totAct : 0));

  // ---- P4c AC → OC ----
  const objCosto = new Map<string, number>();
  const p4c: RepartoReg[] = [];
  for (const x of resumen) {
    const a = x.act;
    if (x.total <= TOL) continue;
    const frac = a.alcance === "INCLUIDA" ? 1 : a.alcance === "PARCIAL" ? Math.max(0, Math.min(1, a.pct ?? 0)) : 0;
    const fuera = round2(x.total * (1 - frac));
    if (fuera > TOL) saldos.push({ etapa: "P4c", origen: a.id, monto: fuera, causa: `${a.codigo} ${a.nombre}: ${a.alcance === "EXCLUIDA" ? "otra actividad, fuera de la cadena" : "inclusión parcial " + Math.round(frac * 100) + " %"}`, tipo: "FUERA_ALCANCE" });
    const pool = round2(x.total - fuera);
    if (pool <= TOL) continue;
    const regla = inp.reglas.find((r) => r.nivel === "AC_OC" && r.origenId === a.id) || null;
    if (!regla) {
      saldos.push({ etapa: "P4c", origen: a.id, monto: pool, causa: `${a.codigo}: sin regla de reparto a objetos de costo`, tipo: "PENDIENTE" });
      p4c.push({ regla: null, origenId: a.id, centroId: null, pool, r: null, causa: "Sin regla" });
      continue;
    }
    const bases = inp.objetos.map((o) => {
      const b = baseDe(regla.id, o.id);
      return { destinoId: o.id, valor: b && b.estado !== "PENDIENTE" ? b.valor : null };
    });
    const r = repartir(pool, regla.tipo, bases, regla.unidad || "unidad");
    r.lineas.forEach((l) => l.importe > 0 && addTo(objCosto, l.destinoId, l.importe));
    if (r.estado === "BLOQUEADO") bloqueos.push(`P4c ${a.codigo}: ${r.mensajes.join(" ")}`);
    if (r.saldo > TOL) saldos.push({ etapa: "P4c", origen: a.id, monto: r.saldo, causa: `${a.codigo}: ${r.mensajes.join(" ") || "saldo no asignado"}`, tipo: r.estado === "BLOQUEADO" ? "BLOQUEADO" : "PENDIENTE" });
    p4c.push({ regla, origenId: a.id, centroId: null, pool, r });
  }
  const objetos = inp.objetos.map((o) => {
    const costo = objCosto.get(o.id) || 0;
    return { obj: o, costo, unitario: o.cantidad && o.cantidad > 0 ? costo / o.cantidad : null };
  });

  // ---- Conciliación global ----
  const totCMD = round2(p1.reduce((s, x) => s + x.importe, 0));
  const totCSD = round2(p2.reduce((s, x) => s + x.importe, 0));
  const totPersonalDir = round2(p3.reduce((s, x) => s + x.persona.costo, 0));
  const sobre = round2(p3.reduce((s, x) => s + Math.max(0, x.r.costoAplicado - x.persona.costo), 0));
  const totEC = round2(inp.ecs.reduce((s, x) => s + x.monto, 0));
  const totalFuente = round2(totCMD + totCSD + totPersonalDir + sobre + totEC);
  const sum = (f: (s: Saldo) => boolean) => round2(saldos.filter(f).reduce((s, x) => s + x.monto, 0));
  const totObj = round2(objetos.reduce((s, x) => s + x.costo, 0));
  const bloqueadasP3 = round2(p3.filter((x) => x.r.estado === "SOBREIMPUTADA" || x.r.estado === "SIN_TASA").reduce((s, x) => s + x.persona.costo, 0));
  const conciliacion: ResultadoModelo["conciliacion"] = [
    { concepto: "Material directo aplicado (P1)", monto: totCMD, signo: 1 },
    { concepto: "Servicio directo (P2)", monto: totCSD, signo: 1 },
    { concepto: "Costo empresa del personal directo (P3)", monto: totPersonalDir, signo: 1 },
    { concepto: "Sobreimputación autorizada (P3)", monto: sobre, signo: 1 },
    { concepto: "Elementos de costo indirecto (P4a)", monto: totEC, signo: 1 },
    { concepto: "Asignado a objetos de costo (P4c)", monto: totObj, signo: -1 },
    { concepto: "Capacidad no utilizada del personal", monto: sum((s) => s.tipo === "CAPACIDAD"), signo: -1 },
    { concepto: "Personal directo con cálculo bloqueado", monto: bloqueadasP3, signo: -1 },
    { concepto: "Indirectos de centros fuera de la cadena", monto: sum((s) => s.tipo === "FUERA_ALCANCE" && s.etapa === "P4b"), signo: -1 },
    { concepto: "Otras actividades fuera de la cadena", monto: sum((s) => s.tipo === "FUERA_ALCANCE" && s.etapa === "P4c"), signo: -1 },
    { concepto: "Saldos pendientes o bloqueados P4a", monto: sum((s) => s.etapa === "P4a"), signo: -1 },
    { concepto: "Saldos pendientes o bloqueados P4b", monto: sum((s) => s.etapa === "P4b" && s.tipo !== "FUERA_ALCANCE"), signo: -1 },
    { concepto: "Saldos pendientes o bloqueados P4c", monto: sum((s) => s.etapa === "P4c" && s.tipo !== "FUERA_ALCANCE"), signo: -1 },
  ];
  const totalExplicado = round2(conciliacion.filter((c) => c.signo === -1).reduce((s, c) => s + c.monto, 0));
  const cuadra = Math.abs(totalFuente - totalExplicado) <= 0.05; // tolerancia por redondeo acumulado de céntimos
  return { p1, cmd, unitMat, p2, csd, p3, cpd, p4a, ciCentro, p4b, ciAct, ci, resumen, p4c, objetos, saldos, conciliacion, totalFuente, totalExplicado, cuadra, bloqueos, advertencias };
}
