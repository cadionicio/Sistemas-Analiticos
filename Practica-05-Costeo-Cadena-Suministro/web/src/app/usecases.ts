import { fmtNum } from "../domain/formato";
// Casos de uso (capa de aplicación). Orquestan Store + dominio; sin HTML.
import { Store, uid, hashStr, APP_VERSION } from "../db/store";
import { costearPersona, costoEmpresa, repartir, ResultadoPersona, ResultadoReparto, TipoBase, ComponentesCosto, round2 } from "../domain/abc";

export interface Contexto {
  empresaId: string;
  modeloId: string;
  versionId: string;
  periodoId: string;
}

const now = () => new Date().toISOString();

export function contextoActual(s: Store): Contexto | null {
  const m = s.one("SELECT valor FROM meta WHERE clave='ctx'");
  if (!m) return null;
  try {
    const c = JSON.parse(m.valor);
    if (s.one("SELECT id FROM modelo_version WHERE id=?", [c.versionId])) return c;
  } catch {}
  return null;
}
export function guardarContexto(s: Store, c: Contexto) {
  s.run("INSERT INTO meta(clave,valor) VALUES('ctx',?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor", [JSON.stringify(c)]);
}

/**
 * Datos de verificación (SINTÉTICOS). Reproducen los vectores obligatorios del Megaprompt V7:
 *  - Costeo individual: Analista A 4 200 / 160 h = 26,25; Analista B 5 040 / 168 h = 30,00.
 *  - Inductor: pool 1 200 / 60 pedidos = 20 S/ por pedido; A 15 → 300, B 45 → 900.
 *  - Vector T08: 12 000 / 600 h = 20 S/h; objeto con 40 h → 800.
 * No son datos de una empresa real.
 */
export function cargarVerificacionI1(s: Store): Contexto {
  return s.tx(() => {
    const t = now();
    const emp = uid("emp_");
    s.run("INSERT INTO empresa(id,nombre,ruc,moneda,igv_tasa,sintetico,creado_en) VALUES(?,?,?,?,?,1,?)", [emp, "Distribuidora Andina Demo S.A.C. — DATOS SINTÉTICOS", null, "PEN", 0.18, t]);
    const per = uid("per_");
    s.run("INSERT INTO periodo(id,empresa_id,codigo,nombre,inicio,fin) VALUES(?,?,?,?,?,?)", [per, emp, "2026-10", "Octubre 2026", "2026-10-01", "2026-10-31"]);
    const mod = uid("mod_");
    s.run("INSERT INTO modelo(id,empresa_id,codigo,nombre,descripcion,origen,creado_en) VALUES(?,?,?,?,?,?,?)", [
      mod, emp, "MV", "Caso de verificación del motor (sintético)", "Modelo mínimo con resultados conocidos para verificar el costeo individual y el laboratorio de inductores. Datos sintéticos.", "DEMO", t,
    ]);
    const ver = uid("ver_");
    s.run("INSERT INTO modelo_version(id,modelo_id,numero,estado,nota,creado_en) VALUES(?,?,1,'ACTIVA',?,?)", [ver, mod, "Versión inicial", t]);
    const ca = (cod: string, nom: string) => {
      const id = uid("ca_");
      s.run("INSERT INTO centro(id,version_id,codigo,nombre,participacion) VALUES(?,?,?,?,'PARTICIPA')", [id, ver, cod, nom]);
      return id;
    };
    const caLog = ca("CA02", "Logística");
    const caAlm = ca("CA03", "Almacén");
    const act = (cod: string, nom: string, c: string, cls: string, o: number) => {
      const id = uid("ac_");
      s.run("INSERT INTO actividad(id,version_id,codigo,nombre,centro_id,alcance,clase_valor,orden) VALUES(?,?,?,?,?,'INCLUIDA',?,?)", [id, ver, cod, nom, c, cls, o]);
      return id;
    };
    const aX = act("AC06", "Cotizar proveedores (actividad X)", caLog, "AV", 1);
    const aY = act("AC07", "Emitir orden de compra (actividad Y)", caLog, "AV", 2);
    act("AC12", "Preparar pedido (picking)", caAlm, "AV", 3);
    const pu = uid("pu_");
    s.run("INSERT INTO puesto(id,version_id,codigo,nombre,tipo) VALUES(?,?,?,?,'DIRECTO')", [pu, ver, "PU03", "Analista de compras"]);
    const persona = (cod: string, nom: string, c: ComponentesCosto, horas: number) => {
      const id = uid("pe_");
      s.run("INSERT INTO persona(id,version_id,codigo,nombre,sintetico) VALUES(?,?,?,?,1)", [id, ver, cod, nom]);
      s.run("INSERT INTO persona_puesto(id,persona_id,puesto_id,centro_id,desde) VALUES(?,?,?,?,?)", [uid("pp_"), id, pu, caLog, "2026-10-01"]);
      s.run(
        "INSERT INTO costo_persona(id,persona_id,periodo_id,remuneracion,essalud,gratificacion,cts,vacaciones,bonos,otros,horas_disponibles,fuente) VALUES(?,?,?,?,?,?,?,?,?,?,?,'SINTÉTICO')",
        [uid("cp_"), id, per, c.remuneracion, c.essalud, c.gratificacion, c.cts, c.vacaciones, c.bonos, c.otros, horas],
      );
      return id;
    };
    const pA = persona("P001", "Analista A — Ana Rojas (sintética)", { remuneracion: 3200, essalud: 288, gratificacion: 400, cts: 186.67, vacaciones: 125.33, bonos: 0, otros: 0 }, 160);
    const pB = persona("P002", "Analista B — Bruno Salas (sintético)", { remuneracion: 3840, essalud: 345.6, gratificacion: 480, cts: 224, vacaciones: 150.4, bonos: 0, otros: 0 }, 168);
    const imp = (p: string, a: string, h: number) =>
      s.run("INSERT INTO imputacion_horas(id,persona_id,actividad_id,periodo_id,horas,fuente) VALUES(?,?,?,?,?,'SINTÉTICO')", [uid("ih_"), p, a, per, h]);
    imp(pA, aX, 80);
    imp(pB, aX, 70);
    imp(pA, aY, 40);
    imp(pB, aY, 30);
    // Laboratorio de inductores
    const oc = (cod: string, nom: string, mag: string) => {
      const id = uid("oc_");
      s.run("INSERT INTO objeto_costo(id,version_id,codigo,nombre,magnitud) VALUES(?,?,?,?,?)", [id, ver, cod, nom, mag]);
      return id;
    };
    const oA = oc("OC01", "Objeto A — Pedidos línea hogar", "# pedidos");
    const oB = oc("OC02", "Objeto B — Pedidos línea industrial", "# pedidos");
    const ind = (cod: string, nom: string, uni: string, tipo: TipoBase, def: string) => {
      const id = uid("in_");
      s.run("INSERT INTO inductor(id,version_id,codigo,nombre,unidad,definicion,nivel,tipo_base) VALUES(?,?,?,?,?,?,'LAB',?)", [id, ver, cod, nom, uni, def, tipo]);
      return id;
    };
    const iPed = ind("IN01", "Número de pedidos procesados", "pedido", "cantidad", "Cantidad de pedidos válidos atendidos por cada objeto en el período.");
    const iHrs = ind("IN02", "Horas de inspección", "hora", "cantidad", "Horas de inspección consumidas por cada objeto en el período.");
    const pool = (cod: string, nom: string, monto: number, i: string) => {
      const id = uid("pool_");
      s.run("INSERT INTO pool_costo(id,version_id,periodo_id,codigo,nombre,monto,inductor_id,fuente) VALUES(?,?,?,?,?,?,?,'SINTÉTICO')", [id, ver, per, cod, nom, monto, i]);
      return id;
    };
    const p1 = pool("POOL01", "Actividad «Atender pedidos»", 1200, iPed);
    const p2 = pool("POOL02", "Actividad «Inspeccionar recepción»", 12000, iHrs);
    const base = (p: string, o: string, v: number) =>
      s.run("INSERT INTO base_inductor(id,pool_id,destino_tipo,destino_id,valor,estado_valor,metodo) VALUES(?,?,'OBJETO',?,?,'REAL','Dato registrado')", [uid("bi_"), p, o, v]);
    base(p1, oA, 15);
    base(p1, oB, 45);
    base(p2, oA, 40);
    base(p2, oB, 560);
    const ctx = { empresaId: emp, modeloId: mod, versionId: ver, periodoId: per };
    guardarContexto(s, ctx);
    s.audit("CARGAR_DATOS_VERIFICACION_I1", "modelo", mod, null, { personas: 2, actividades: 3, pools: 2 });
    return ctx;
  });
}

// ---------- Personas ----------
export interface PersonaFila {
  id: string;
  codigo: string;
  nombre: string;
  puesto: string;
  puestoId: string;
  tipo?: string;
  centro: string;
  costoId: string;
  comp: ComponentesCosto;
  costo: number;
  horas: number;
  autorizada: boolean;
  justificacion: string | null;
  fuente: string;
}

export function personas(s: Store, c: Contexto): PersonaFila[] {
  return s
    .all(
      `SELECT p.id, p.codigo, p.nombre, pu.nombre puesto, pu.id puesto_id, pu.tipo, ce.codigo || ' ' || ce.nombre centro, cp.id costo_id,
        cp.remuneracion, cp.essalud, cp.gratificacion, cp.cts, cp.vacaciones, cp.bonos, cp.otros, cp.horas_disponibles,
        cp.sobreimputacion_autorizada, cp.justificacion, cp.fuente
       FROM persona p
       LEFT JOIN persona_puesto pp ON pp.persona_id = p.id AND pp.hasta IS NULL
       LEFT JOIN puesto pu ON pu.id = pp.puesto_id
       LEFT JOIN centro ce ON ce.id = pp.centro_id
       LEFT JOIN costo_persona cp ON cp.persona_id = p.id AND cp.periodo_id = ?
       WHERE p.version_id = ? ORDER BY p.codigo`,
      [c.periodoId, c.versionId],
    )
    .map((r) => {
      const comp: ComponentesCosto = {
        remuneracion: r.remuneracion || 0, essalud: r.essalud || 0, gratificacion: r.gratificacion || 0, cts: r.cts || 0,
        vacaciones: r.vacaciones || 0, bonos: r.bonos || 0, otros: r.otros || 0,
      };
      return {
        id: r.id, codigo: r.codigo, nombre: r.nombre, puesto: r.puesto || "—", puestoId: r.puesto_id, tipo: r.tipo || "DIRECTO", centro: r.centro || "—",
        costoId: r.costo_id, comp, costo: costoEmpresa(comp), horas: r.horas_disponibles || 0,
        autorizada: !!r.sobreimputacion_autorizada, justificacion: r.justificacion, fuente: r.fuente || "MANUAL",
      };
    });
}

export function actividades(s: Store, c: Contexto) {
  return s.all(
    `SELECT a.id, a.codigo, a.nombre, a.alcance, a.clase_valor, a.centro_id, ce.codigo ca_codigo, ce.nombre ca_nombre
     FROM actividad a JOIN centro ce ON ce.id = a.centro_id WHERE a.version_id = ? ORDER BY a.orden, a.codigo`,
    [c.versionId],
  );
}
export function centros(s: Store, c: Contexto) {
  return s.all("SELECT * FROM centro WHERE version_id=? ORDER BY codigo", [c.versionId]);
}
export function puestos(s: Store, c: Contexto) {
  return s.all("SELECT * FROM puesto WHERE version_id=? ORDER BY codigo", [c.versionId]);
}

export function imputaciones(s: Store, c: Contexto): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of s.all("SELECT persona_id, actividad_id, horas FROM imputacion_horas WHERE periodo_id=?", [c.periodoId])) m.set(r.persona_id + "|" + r.actividad_id, r.horas);
  return m;
}

export function setImputacion(s: Store, c: Contexto, personaId: string, actividadId: string, horas: number | null) {
  const prev = s.one("SELECT id, horas FROM imputacion_horas WHERE persona_id=? AND actividad_id=? AND periodo_id=?", [personaId, actividadId, c.periodoId]);
  if (horas === null || horas === 0) {
    if (prev) s.run("DELETE FROM imputacion_horas WHERE id=?", [prev.id]);
  } else if (prev) s.run("UPDATE imputacion_horas SET horas=?, fuente='MANUAL' WHERE id=?", [horas, prev.id]);
  else s.run("INSERT INTO imputacion_horas(id,persona_id,actividad_id,periodo_id,horas) VALUES(?,?,?,?,?)", [uid("ih_"), personaId, actividadId, c.periodoId, horas]);
  s.audit("IMPUTAR_HORAS", "imputacion_horas", personaId + "|" + actividadId, prev ? { horas: prev.horas } : null, { horas });
}

const CAMPOS_COSTO = ["remuneracion", "essalud", "gratificacion", "cts", "vacaciones", "bonos", "otros", "horas_disponibles"];
export function setCostoCampo(s: Store, costoId: string, campo: string, valor: number) {
  if (!CAMPOS_COSTO.includes(campo)) throw new Error("Campo no permitido: " + campo);
  const prev = s.one(`SELECT ${campo} v FROM costo_persona WHERE id=?`, [costoId]);
  s.run(`UPDATE costo_persona SET ${campo}=?, fuente='MANUAL' WHERE id=?`, [valor, costoId]);
  s.audit("EDITAR_COSTO_PERSONA", "costo_persona", costoId, { [campo]: prev?.v }, { [campo]: valor });
}
export function setAutorizacion(s: Store, costoId: string, autorizada: boolean, justificacion: string) {
  s.run("UPDATE costo_persona SET sobreimputacion_autorizada=?, justificacion=? WHERE id=?", [autorizada ? 1 : 0, justificacion || null, costoId]);
  s.audit(autorizada ? "AUTORIZAR_SOBREIMPUTACION" : "RETIRAR_AUTORIZACION", "costo_persona", costoId, null, { justificacion });
}

export function nuevaPersona(s: Store, c: Contexto, nombre: string, puestoId: string, horas: number): string {
  return s.tx(() => {
    const n = (s.one("SELECT COUNT(*) n FROM persona WHERE version_id=?", [c.versionId]) as any).n + 1;
    let codigo = "P" + String(n).padStart(3, "0");
    while (s.one("SELECT 1 FROM persona WHERE version_id=? AND codigo=?", [c.versionId, codigo])) codigo = "P" + String(Math.floor(Math.random() * 900) + 100);
    const id = uid("pe_");
    const pu = s.one("SELECT * FROM puesto WHERE id=?", [puestoId]);
    const ca = s.one("SELECT centro_id FROM persona_puesto WHERE puesto_id=? LIMIT 1", [puestoId]);
    s.run("INSERT INTO persona(id,version_id,codigo,nombre,sintetico) VALUES(?,?,?,?,0)", [id, c.versionId, codigo, nombre]);
    s.run("INSERT INTO persona_puesto(id,persona_id,puesto_id,centro_id,desde) VALUES(?,?,?,?,?)", [uid("pp_"), id, puestoId, ca ? ca.centro_id : null, new Date().toISOString().slice(0, 10)]);
    s.run("INSERT INTO costo_persona(id,persona_id,periodo_id,horas_disponibles) VALUES(?,?,?,?)", [uid("cp_"), id, c.periodoId, horas]);
    s.audit("CREAR_PERSONA", "persona", id, null, { codigo, nombre, puesto: pu?.nombre });
    return id;
  });
}
export function eliminarPersona(s: Store, id: string) {
  s.tx(() => {
    const p = s.one("SELECT * FROM persona WHERE id=?", [id]);
    s.run("DELETE FROM persona WHERE id=?", [id]);
    s.audit("ELIMINAR_PERSONA", "persona", id, p, null);
  });
}
export function renombrarPersona(s: Store, id: string, nombre: string) {
  const p = s.one("SELECT nombre FROM persona WHERE id=?", [id]);
  s.run("UPDATE persona SET nombre=? WHERE id=?", [nombre, id]);
  s.audit("EDITAR_PERSONA", "persona", id, p, { nombre });
}

// ---------- P3 CPD por persona ----------
export interface P3Calculo {
  porPersona: { p: PersonaFila; r: ResultadoPersona }[];
  filas: { actividad: any; persona: PersonaFila; horas: number; tasa: number | null; importe: number; bloqueada: boolean }[];
  totalPorActividad: Map<string, number>;
  totalCPD: number;
  totalCapacidad: number;
  totalCosto: number;
  hash: string;
  bloqueos: string[];
}

export function calcularP3(s: Store, c: Contexto): P3Calculo {
  // P3 solo costea personal DIRECTO; el personal indirecto va a P4a («Personal indirecto») y no imputa horas.
  const ps = personas(s, c).filter((p) => p.tipo !== "INDIRECTO");
  const acts = actividades(s, c);
  const imp = imputaciones(s, c);
  const porPersona = ps.map((p) => {
    const lst = acts.filter((a) => imp.has(p.id + "|" + a.id)).map((a) => ({ actividadId: a.id, horas: imp.get(p.id + "|" + a.id)! }));
    return { p, r: costearPersona(p.costo, p.horas, lst, p.autorizada) };
  });
  const filas: P3Calculo["filas"] = [];
  const totalPorActividad = new Map<string, number>();
  for (const a of acts) {
    for (const { p, r } of porPersona) {
      const pa = r.porActividad.find((x) => x.actividadId === a.id);
      if (!pa) continue;
      const bloqueada = r.estado === "SOBREIMPUTADA" || r.estado === "SIN_TASA";
      filas.push({ actividad: a, persona: p, horas: pa.horas, tasa: r.tasa, importe: pa.importe, bloqueada });
      totalPorActividad.set(a.id, round2((totalPorActividad.get(a.id) || 0) + pa.importe));
    }
  }
  const bloqueos = porPersona.filter((x) => x.r.estado === "SOBREIMPUTADA" || x.r.estado === "SIN_TASA").map((x) => `${x.p.codigo} ${x.p.nombre}: ${x.r.mensaje}`);
  const hash = hashStr(JSON.stringify({ ps: ps.map((p) => [p.id, p.costo, p.horas, p.autorizada]), imp: Array.from(imp.entries()).sort() }));
  return {
    porPersona,
    filas,
    totalPorActividad,
    totalCPD: round2(porPersona.reduce((s2, x) => s2 + x.r.costoAplicado, 0)),
    totalCapacidad: round2(porPersona.reduce((s2, x) => s2 + x.r.capacidadNoUtilizada, 0)),
    totalCosto: round2(ps.reduce((s2, p) => s2 + p.costo, 0)),
    hash,
    bloqueos,
  };
}

export function ultimaCorrida(s: Store, c: Contexto, etapa: string) {
  return s.one("SELECT * FROM corrida WHERE version_id=? AND periodo_id=? AND etapa=? ORDER BY creado_en DESC LIMIT 1", [c.versionId, c.periodoId, etapa]);
}

/** Ejecuta la etapa P3 y guarda la corrida con sus asignaciones y saldos (transacción atómica). */
export function ejecutarP3(s: Store, c: Contexto, host: string): { runId: string; calc: P3Calculo } {
  const calc = calcularP3(s, c);
  if (calc.bloqueos.length) throw new Error("No se puede ejecutar P3:\n" + calc.bloqueos.join("\n"));
  const runId = "RUN-P3-" + new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14) + "-" + calc.hash.slice(0, 4);
  s.tx(() => {
    s.run("INSERT INTO corrida(id,version_id,periodo_id,etapa,params_hash,estado,host,app_version,creado_en) VALUES(?,?,?,?,?,?,?,?,?)", [
      runId, c.versionId, c.periodoId, "P3", calc.hash, "CALCULADO", host, APP_VERSION, now(),
    ]);
    for (const f of calc.filas)
      s.run("INSERT INTO asignacion(corrida_id,etapa,origen_tipo,origen_id,destino_tipo,destino_id,base,denominador,tasa,importe,detalle) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [
        runId, "P3", "PERSONA", f.persona.id, "ACTIVIDAD", f.actividad.id, f.horas, f.persona.horas, f.tasa, f.importe,
        JSON.stringify({ costo_empresa: f.persona.costo, componentes: f.persona.comp }),
      ]);
    for (const { p, r } of calc.porPersona)
      if (r.capacidadNoUtilizada > 0)
        s.run("INSERT INTO saldo(corrida_id,etapa,origen_tipo,origen_id,monto,causa) VALUES(?,?,?,?,?,?)", [
          runId, "P3", "PERSONA", p.id, r.capacidadNoUtilizada, `Capacidad no utilizada: ${fmtNum(r.horasRestantes, 2)} h × tasa`,
        ]);
    s.audit("EJECUTAR_ETAPA", "corrida", runId, null, { etapa: "P3", total: calc.totalCPD, capacidad: calc.totalCapacidad });
  });
  return { runId, calc };
}

// ---------- Laboratorio de inductores ----------
export function pools(s: Store, c: Contexto) {
  return s.all(
    `SELECT pc.*, i.nombre inductor, i.unidad, i.tipo_base, i.definicion, i.codigo inductor_codigo FROM pool_costo pc JOIN inductor i ON i.id = pc.inductor_id
     WHERE pc.version_id=? AND pc.periodo_id=? ORDER BY pc.codigo`,
    [c.versionId, c.periodoId],
  );
}
export function objetos(s: Store, c: Contexto) {
  return s.all("SELECT * FROM objeto_costo WHERE version_id=? ORDER BY codigo", [c.versionId]);
}
export function basesPool(s: Store, poolId: string) {
  return s.all("SELECT * FROM base_inductor WHERE pool_id=?", [poolId]);
}

export interface LabCalculo {
  pool: any;
  destinos: { objeto: any; base: any }[];
  r: ResultadoReparto;
}
export function calcularLab(s: Store, c: Contexto, poolId: string): LabCalculo | null {
  const pool = pools(s, c).find((p) => p.id === poolId);
  if (!pool) return null;
  const bs = basesPool(s, poolId);
  const destinos = objetos(s, c).map((o) => ({ objeto: o, base: bs.find((b) => b.destino_id === o.id) || null }));
  const r = repartir(
    pool.monto,
    pool.tipo_base,
    destinos.map((d) => ({ destinoId: d.objeto.id, valor: d.base && d.base.estado_valor !== "PENDIENTE" ? d.base.valor : null })),
    pool.unidad,
  );
  return { pool, destinos, r };
}
export function setBase(s: Store, poolId: string, objetoId: string, campo: "valor" | "estado_valor" | "metodo" | "justificacion", v: any) {
  const prev = s.one("SELECT * FROM base_inductor WHERE pool_id=? AND destino_tipo='OBJETO' AND destino_id=?", [poolId, objetoId]);
  if (!prev) s.run("INSERT INTO base_inductor(id,pool_id,destino_tipo,destino_id,valor,estado_valor) VALUES(?,?,'OBJETO',?,NULL,'PENDIENTE')", [uid("bi_"), poolId, objetoId]);
  const allowed = ["valor", "estado_valor", "metodo", "justificacion"];
  if (!allowed.includes(campo)) throw new Error("Campo no permitido");
  s.run(`UPDATE base_inductor SET ${campo}=? WHERE pool_id=? AND destino_tipo='OBJETO' AND destino_id=?`, [v, poolId, objetoId]);
  if (campo === "valor" && prev && prev.estado_valor === "REAL" && prev.valor !== v)
    s.run("UPDATE base_inductor SET estado_valor='AJUSTADO' WHERE pool_id=? AND destino_id=?", [poolId, objetoId]);
  if (campo === "valor" && (!prev || prev.estado_valor === "PENDIENTE") && v !== null)
    s.run("UPDATE base_inductor SET estado_valor='REAL' WHERE pool_id=? AND destino_id=?", [poolId, objetoId]);
  s.audit("EDITAR_BASE_INDUCTOR", "base_inductor", poolId + "|" + objetoId, prev ? { [campo]: prev[campo] } : null, { [campo]: v });
}
export function setPoolCampo(s: Store, poolId: string, campo: "monto" | "nombre", v: any) {
  const prev = s.one(`SELECT ${campo} v FROM pool_costo WHERE id=?`, [poolId]);
  s.run(`UPDATE pool_costo SET ${campo}=?, fuente='MANUAL' WHERE id=?`, [v, poolId]);
  s.audit("EDITAR_POOL", "pool_costo", poolId, { [campo]: prev?.v }, { [campo]: v });
}
export function setTipoInductor(s: Store, poolId: string, tipo: TipoBase) {
  const p = s.one("SELECT inductor_id FROM pool_costo WHERE id=?", [poolId]);
  s.run("UPDATE inductor SET tipo_base=? WHERE id=?", [tipo, p!.inductor_id]);
  s.audit("EDITAR_INDUCTOR", "inductor", p!.inductor_id, null, { tipo_base: tipo });
}
export function nuevoObjeto(s: Store, c: Contexto, nombre: string, magnitud: string) {
  const n = (s.one("SELECT COUNT(*) n FROM objeto_costo WHERE version_id=?", [c.versionId]) as any).n + 1;
  const id = uid("oc_");
  s.run("INSERT INTO objeto_costo(id,version_id,codigo,nombre,magnitud) VALUES(?,?,?,?,?)", [id, c.versionId, "OC" + String(n).padStart(2, "0"), nombre, magnitud]);
  s.audit("CREAR_OBJETO_COSTO", "objeto_costo", id, null, { nombre });
  return id;
}
export function nuevaActividad(s: Store, c: Contexto, nombre: string, centroId: string) {
  const n = (s.one("SELECT COUNT(*) n FROM actividad WHERE version_id=?", [c.versionId]) as any).n + 1;
  let codigo = "AC" + String(n + 20).padStart(2, "0");
  while (s.one("SELECT 1 FROM actividad WHERE version_id=? AND codigo=?", [c.versionId, codigo])) codigo = "AC" + String(Math.floor(Math.random() * 90) + 30);
  const id = uid("ac_");
  s.run("INSERT INTO actividad(id,version_id,codigo,nombre,centro_id,alcance,orden) VALUES(?,?,?,?,?,'INCLUIDA',?)", [id, c.versionId, codigo, nombre, centroId, n + 10]);
  s.audit("CREAR_ACTIVIDAD", "actividad", id, null, { codigo, nombre });
  return id;
}
