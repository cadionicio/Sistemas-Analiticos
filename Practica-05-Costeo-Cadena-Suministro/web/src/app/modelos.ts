// Casos de uso de modelos: importar paquete, listar, activar, clonar, cargar entrada del motor, ejecutar y guardar corrida ABC.
import { Store, uid, hashStr, APP_VERSION } from "../db/store";
import { Paquete } from "../import/paquete";
import { ModeloInput, costearModelo, ResultadoModelo } from "../domain/motor";
import { costoEmpresa } from "../domain/abc";
import { Contexto, guardarContexto } from "./usecases";

const now = () => new Date().toISOString();

/** Guarda un paquete como modelo nuevo e independiente (transacción atómica: todo o nada). */
export function guardarPaquete(s: Store, P: Paquete): Contexto {
  return s.tx(() => {
    const t = now();
    let emp = s.one("SELECT id FROM empresa WHERE nombre=?", [P.empresa.nombre])?.id;
    if (!emp) {
      emp = uid("emp_");
      s.run("INSERT INTO empresa(id,nombre,moneda,igv_tasa,sintetico,creado_en) VALUES(?,?,?,?,?,?)", [emp, P.empresa.nombre, P.empresa.moneda, P.empresa.igv, P.empresa.sintetico ? 1 : 0, t]);
    }
    let codigo = P.modelo.codigo;
    let k = 2;
    while (s.one("SELECT 1 FROM modelo WHERE empresa_id=? AND codigo=?", [emp, codigo])) codigo = `${P.modelo.codigo}-${k++}`;
    const mod = uid("mod_");
    s.run("INSERT INTO modelo(id,empresa_id,codigo,nombre,descripcion,origen,creado_en) VALUES(?,?,?,?,?,?,?)", [mod, emp, codigo, P.modelo.nombre, P.modelo.descripcion, P.modelo.origen, t]);
    s.run("INSERT INTO modelo_origen(modelo_id,archivo,sha256,importado_en,formato,advertencias) VALUES(?,?,?,?,?,?)", [mod, P.archivo, P.sha256, t, P.formato, JSON.stringify(P.advertencias)]);
    const ver = uid("ver_");
    s.run("INSERT INTO modelo_version(id,modelo_id,numero,estado,nota,creado_en) VALUES(?,?,1,'ACTIVA',?,?)", [ver, mod, `Importada de ${P.archivo}`, t]);
    const per = new Map<string, string>();
    for (const p of P.periodos) {
      let id = s.one("SELECT id FROM periodo WHERE empresa_id=? AND codigo=?", [emp, p.codigo])?.id;
      if (!id) {
        id = uid("per_");
        s.run("INSERT INTO periodo(id,empresa_id,codigo,nombre,orden) VALUES(?,?,?,?,?)", [id, emp, p.codigo, p.nombre, p.orden]);
      } else s.run("UPDATE periodo SET orden=? WHERE id=? AND orden=0", [p.orden, id]); // período reutilizado sin orden (p. ej. creado por la verificación)
      per.set(p.codigo, id);
    }
    const cen = new Map<string, string>();
    for (const c of P.centros) {
      const id = uid("ca_");
      cen.set(c.codigo, id);
      s.run("INSERT INTO centro(id,version_id,codigo,nombre,participacion,pct_participacion,nota) VALUES(?,?,?,?,?,?,?)", [id, ver, c.codigo, c.nombre, c.participacion, c.pct ?? null, c.nota ?? null]);
    }
    const act = new Map<string, string>();
    for (const a of P.actividades) {
      const id = uid("ac_");
      act.set(a.codigo, id);
      s.run("INSERT INTO actividad(id,version_id,codigo,nombre,centro_id,alcance,pct_alcance,clase_valor,orden,nota) VALUES(?,?,?,?,?,?,?,?,?,?)", [id, ver, a.codigo, a.nombre, cen.get(a.centro), a.alcance, a.pct ?? null, a.clase ?? null, a.orden, a.nota ?? null]);
    }
    const pu = new Map<string, string>();
    for (const p of P.puestos) {
      const id = uid("pu_");
      pu.set(p.codigo, id);
      s.run("INSERT INTO puesto(id,version_id,codigo,nombre,tipo) VALUES(?,?,?,?,?)", [id, ver, p.codigo, p.nombre, p.tipo]);
    }
    const pe = new Map<string, string>();
    for (const p of P.personas) {
      const id = uid("pe_");
      pe.set(p.codigo, id);
      s.run("INSERT INTO persona(id,version_id,codigo,nombre,sintetico,agregado_puesto) VALUES(?,?,?,?,?,?)", [id, ver, p.codigo, p.nombre, p.sintetico ? 1 : 0, p.agregado ? 1 : 0]);
      s.run("INSERT INTO persona_puesto(id,persona_id,puesto_id,centro_id,desde) VALUES(?,?,?,?,?)", [uid("pp_"), id, pu.get(p.puesto), p.centro ? cen.get(p.centro) : null, "2000-01-01"]);
    }
    for (const c of P.costos)
      s.run(
        "INSERT INTO costo_persona(id,persona_id,periodo_id,remuneracion,essalud,gratificacion,cts,vacaciones,bonos,otros,horas_disponibles,sobreimputacion_autorizada,justificacion,fuente) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [uid("cp_"), pe.get(c.persona), per.get(c.periodo), c.remuneracion, c.essalud, c.gratificacion, c.cts, c.vacaciones, c.bonos, c.otros, c.horas, c.autorizada ? 1 : 0, c.justificacion ?? null, c.fuente],
      );
    for (const h of P.horas) s.run("INSERT INTO imputacion_horas(id,persona_id,actividad_id,periodo_id,horas,fuente) VALUES(?,?,?,?,?,?)", [uid("ih_"), pe.get(h.persona), act.get(h.actividad), per.get(h.periodo), h.horas, h.fuente]);
    const mat = new Map<string, string>();
    for (const m of P.materiales) {
      const id = uid("mt_");
      mat.set(m.codigo, id);
      s.run(
        "INSERT INTO material(id,version_id,codigo,nombre,unidad_consumo,unidad_factura,costo_factura,cantidad_factura,equivalencia,equivalencia_texto,incluye_igv,igv_recuperable,tratamiento_validado,fuente) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, ver, m.codigo, m.nombre, m.unidadConsumo, m.unidadFactura ?? null, m.costoFactura, m.cantidadFactura, m.equivalencia, m.equivalenciaTexto ?? null, m.incluyeIgv ? 1 : 0, m.igvRecuperable ? 1 : 0, m.validado ? 1 : 0, m.fuente],
      );
    }
    for (const p of P.precios) s.run("INSERT INTO material_precio(material_id,periodo_id,costo_factura,fuente) VALUES(?,?,?,?)", [mat.get(p.material), per.get(p.periodo), p.costoFactura, "importado"]);
    for (const c of P.consumos) s.run("INSERT INTO consumo_material(id,actividad_id,material_id,periodo_id,cantidad,fuente) VALUES(?,?,?,?,?,?)", [uid("cm_"), act.get(c.actividad), mat.get(c.material), per.get(c.periodo), c.cantidad, c.fuente]);
    for (const x of P.servicios)
      s.run("INSERT INTO servicio_directo(id,version_id,periodo_id,actividad_id,proveedor,servicio,cantidad,unidad,tarifa,documento,fuente) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [uid("sd_"), ver, per.get(x.periodo), act.get(x.actividad), x.proveedor, x.servicio, x.cantidad, x.unidad, x.tarifa, x.documento ?? null, x.fuente]);
    const ec = new Map<string, string>();
    for (const e of P.ecs) {
      const id = uid("ec_");
      ec.set(e.codigo, id);
      s.run("INSERT INTO elemento_costo(id,version_id,codigo,nombre,tipo) VALUES(?,?,?,?,?)", [id, ver, e.codigo, e.nombre, e.tipo ?? null]);
    }
    for (const m of P.ecMontos) s.run("INSERT INTO ec_monto(ec_id,periodo_id,monto,fuente) VALUES(?,?,?,?)", [ec.get(m.ec), per.get(m.periodo), m.monto, m.fuente]);
    const obj = new Map<string, string>();
    for (const o of P.objetos) {
      const id = uid("oc_");
      obj.set(o.codigo, id);
      s.run("INSERT INTO objeto_costo(id,version_id,codigo,nombre,magnitud,clase,nota) VALUES(?,?,?,?,?,?,?)", [id, ver, o.codigo, o.nombre, o.magnitud, o.clase, o.nota ?? null]);
    }
    for (const m of P.magnitudes) s.run("INSERT INTO objeto_magnitud(objeto_id,periodo_id,cantidad,fuente) VALUES(?,?,?,?)", [obj.get(m.objeto), per.get(m.periodo), m.cantidad, m.fuente]);
    const reg = new Map<string, { id: string; nivel: string }>();
    for (const r of P.reglas) {
      const id = uid("rr_");
      reg.set(r.codigo, { id, nivel: r.nivel });
      const origen = r.nivel === "AC_OC" ? act.get(r.origen) : ec.get(r.origen);
      s.run("INSERT INTO regla_reparto(id,version_id,codigo,nivel,origen_id,centro_id,inductor,unidad,tipo_base,base_desde,fuente) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [id, ver, r.codigo, r.nivel, origen, r.centro ? cen.get(r.centro) : null, r.inductor, r.unidad, r.tipo, r.baseDesde ?? null, r.fuente]);
    }
    for (const b of P.bases) {
      const r = reg.get(b.regla)!;
      const dest = r.nivel === "EC_CA" ? cen.get(b.destino) : r.nivel === "CA_AC" ? act.get(b.destino) : obj.get(b.destino);
      if (!dest) continue;
      s.run("INSERT INTO valor_base(id,regla_id,destino_id,periodo_id,valor,estado_valor,metodo,fuente) VALUES(?,?,?,?,?,?,?,?)", [uid("vb_"), r.id, dest, per.get(b.periodo), b.valor, b.estado, b.metodo ?? null, b.fuente]);
    }
    for (const x of P.presupuesto || []) s.run("INSERT INTO presupuesto(version_id,periodo_id,concepto,monto,unidad,fuente) VALUES(?,?,?,?,?,'importado')", [ver, per.get(x.periodo), x.concepto, x.monto, x.unidad]);
    for (const x of P.finanzas || []) s.run("INSERT INTO finanzas_periodo(version_id,periodo_id,ventas,costo_ventas_sin_logistica,otros_gastos_operativos,tasa_impuesto,fuente) VALUES(?,?,?,?,?,?,'importado')", [ver, per.get(x.periodo), x.ventas, x.costoVentas, x.otrosGastos, x.tasaImpuesto]);
    for (const x of P.parametrosEva || []) s.run("INSERT INTO parametro_eva(version_id,clave,valor,unidad,descripcion,fuente) VALUES(?,?,?,?,?,'importado')", [ver, x.clave, x.valor, x.unidad, x.descripcion]);
    for (const x of P.escenarios || []) s.run("INSERT INTO escenario_variable(version_id,escenario,variable,distribucion,minimo,moda,maximo,fuente) VALUES(?,?,?,?,?,?,?,'importado')", [ver, x.escenario, x.variable, x.distribucion, x.minimo, x.moda, x.maximo]);
    for (const r of P.referencias) s.run("INSERT INTO referencia_excel(version_id,hoja,celda,concepto,clave,valor,formula) VALUES(?,?,?,?,?,?,?)", [ver, r.hoja, r.celda, r.concepto, r.clave, r.valor, r.formula ?? null]);
    s.audit("IMPORTAR_MODELO", "modelo", mod, null, { archivo: P.archivo, sha256: P.sha256, formato: P.formato, advertencias: P.advertencias.length });
    const ctx = { empresaId: emp, modeloId: mod, versionId: ver, periodoId: per.get(P.periodos[P.periodos.length - 1].codigo)! };
    guardarContexto(s, ctx);
    return ctx;
  });
}

export function listarModelos(s: Store) {
  return s.all(
    `SELECT m.*, e.nombre empresa, mv.id version_id, mv.numero, mv.estado version_estado, mo.archivo, mo.sha256, mo.formato,
      (SELECT COUNT(*) FROM actividad a WHERE a.version_id=mv.id) n_act, (SELECT COUNT(*) FROM centro c WHERE c.version_id=mv.id) n_ca,
      (SELECT COUNT(*) FROM objeto_costo o WHERE o.version_id=mv.id) n_oc, (SELECT COUNT(*) FROM persona p WHERE p.version_id=mv.id) n_pe
     FROM modelo m JOIN empresa e ON e.id=m.empresa_id JOIN modelo_version mv ON mv.modelo_id=m.id
     LEFT JOIN modelo_origen mo ON mo.modelo_id=m.id
     WHERE mv.numero=(SELECT MAX(numero) FROM modelo_version WHERE modelo_id=m.id) ORDER BY m.creado_en`,
  );
}

export function activarModelo(s: Store, modeloId: string) {
  const m = s.one("SELECT m.empresa_id, mv.id version_id FROM modelo m JOIN modelo_version mv ON mv.modelo_id=m.id WHERE m.id=? ORDER BY mv.numero DESC LIMIT 1", [modeloId]);
  if (!m) throw new Error("Modelo no encontrado");
  const per = periodosEmpresa(s, m.empresa_id).at(-1); // último período cronológico
  const ctx = { empresaId: m.empresa_id, modeloId, versionId: m.version_id, periodoId: per!.id };
  guardarContexto(s, ctx);
  s.audit("ACTIVAR_MODELO", "modelo", modeloId, null, ctx);
  return ctx;
}

/** Orden cronológico: los códigos AAAA-MM se ordenan por fecha (no dependen de la columna «orden», que puede venir
 *  en 0 desde datos creados por otra vía, p. ej. la verificación); los demás códigos van después, por «orden». */
export const ORDEN_PERIODO = "CASE WHEN codigo GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' THEN 0 ELSE 1 END, CASE WHEN codigo GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' THEN codigo END, orden, codigo";
export function periodosEmpresa(s: Store, empresaId: string) {
  return s.all(`SELECT * FROM periodo WHERE empresa_id=? ORDER BY ${ORDEN_PERIODO}`, [empresaId]);
}

/** Tablas que cuelgan de una versión (para clonar sin contaminar el original, T-clonación). */
export function clonarModelo(s: Store, modeloId: string, nombre: string): string {
  return s.tx(() => {
    const src = s.one("SELECT m.*, mv.id ver FROM modelo m JOIN modelo_version mv ON mv.modelo_id=m.id WHERE m.id=? ORDER BY mv.numero DESC LIMIT 1", [modeloId])!;
    const mod = uid("mod_");
    let codigo = src.codigo + "-C";
    let k = 2;
    while (s.one("SELECT 1 FROM modelo WHERE empresa_id=? AND codigo=?", [src.empresa_id, codigo])) codigo = `${src.codigo}-C${k++}`;
    s.run("INSERT INTO modelo(id,empresa_id,codigo,nombre,descripcion,origen,creado_en) VALUES(?,?,?,?,?,'CLON',?)", [mod, src.empresa_id, codigo, nombre, `Clon de ${src.codigo} · ${src.nombre}`, now()]);
    const ver = uid("ver_");
    s.run("INSERT INTO modelo_version(id,modelo_id,numero,estado,nota,creado_en) VALUES(?,?,1,'ACTIVA',?,?)", [ver, mod, `Clon de ${src.codigo} v?`, now()]);
    const map = new Map<string, string>();
    const m = (id: string | null) => (id ? map.get(id) ?? id : null);
    const copy = (tabla: string, where: string, params: any[], fkCols: string[], extra: Record<string, any> = {}, pref = "x_") => {
      const rows = s.all(`SELECT * FROM ${tabla} WHERE ${where}`, params);
      for (const r of rows) {
        const nid = r.id !== undefined ? uid(pref) : undefined;
        if (r.id !== undefined) map.set(r.id, nid!);
        const o: Record<string, any> = { ...r, ...extra };
        if (nid) o.id = nid;
        for (const c of fkCols) o[c] = m(o[c]);
        const cols = Object.keys(o).filter((c) => !(tabla === "referencia_excel" && c === "id"));
        s.run(`INSERT INTO ${tabla}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`, cols.map((c) => o[c]));
      }
    };
    const V = [src.ver];
    copy("centro", "version_id=?", V, [], { version_id: ver }, "ca_");
    copy("actividad", "version_id=?", V, ["centro_id"], { version_id: ver }, "ac_");
    copy("puesto", "version_id=?", V, [], { version_id: ver }, "pu_");
    copy("persona", "version_id=?", V, [], { version_id: ver }, "pe_");
    copy("persona_puesto", "persona_id IN (SELECT id FROM persona WHERE version_id=?)", V, ["persona_id", "puesto_id", "centro_id"], {}, "pp_");
    copy("costo_persona", "persona_id IN (SELECT id FROM persona WHERE version_id=?)", V, ["persona_id"], {}, "cp_");
    copy("imputacion_horas", "persona_id IN (SELECT id FROM persona WHERE version_id=?)", V, ["persona_id", "actividad_id"], {}, "ih_");
    copy("material", "version_id=?", V, [], { version_id: ver }, "mt_");
    const precios = s.all("SELECT * FROM material_precio WHERE material_id IN (SELECT id FROM material WHERE version_id=?)", V);
    for (const p of precios) s.run("INSERT INTO material_precio(material_id,periodo_id,costo_factura,fuente) VALUES(?,?,?,?)", [m(p.material_id), p.periodo_id, p.costo_factura, p.fuente]);
    copy("consumo_material", "material_id IN (SELECT id FROM material WHERE version_id=?)", V, ["actividad_id", "material_id"], {}, "cm_");
    copy("servicio_directo", "version_id=?", V, ["actividad_id"], { version_id: ver }, "sd_");
    copy("elemento_costo", "version_id=?", V, [], { version_id: ver }, "ec_");
    const ecm = s.all("SELECT * FROM ec_monto WHERE ec_id IN (SELECT id FROM elemento_costo WHERE version_id=?)", V);
    for (const e of ecm) s.run("INSERT INTO ec_monto(ec_id,periodo_id,monto,fuente) VALUES(?,?,?,?)", [m(e.ec_id), e.periodo_id, e.monto, e.fuente]);
    copy("objeto_costo", "version_id=?", V, [], { version_id: ver }, "oc_");
    const om = s.all("SELECT * FROM objeto_magnitud WHERE objeto_id IN (SELECT id FROM objeto_costo WHERE version_id=?)", V);
    for (const o of om) s.run("INSERT INTO objeto_magnitud(objeto_id,periodo_id,cantidad,fuente) VALUES(?,?,?,?)", [m(o.objeto_id), o.periodo_id, o.cantidad, o.fuente]);
    copy("regla_reparto", "version_id=?", V, ["origen_id", "centro_id"], { version_id: ver }, "rr_");
    copy("valor_base", "regla_id IN (SELECT id FROM regla_reparto WHERE version_id=?)", V, ["regla_id", "destino_id"], {}, "vb_");
    copy("inductor", "version_id=?", V, [], { version_id: ver }, "in_");
    copy("pool_costo", "version_id=?", V, ["inductor_id"], { version_id: ver }, "pool_");
    copy("base_inductor", "pool_id IN (SELECT id FROM pool_costo WHERE version_id=?)", V, ["pool_id", "destino_id"], {}, "bi_");
    copy("referencia_excel", "version_id=?", V, [], { version_id: ver });
    for (const t of ["presupuesto", "escenario_variable"]) {
      for (const r of s.all(`SELECT * FROM ${t} WHERE version_id=?`, V)) {
        const o: any = { ...r, version_id: ver };
        delete o.id;
        const cols = Object.keys(o);
        s.run(`INSERT INTO ${t}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`, cols.map((k) => o[k]));
      }
    }
    for (const t of ["finanzas_periodo", "parametro_eva"]) {
      for (const r of s.all(`SELECT * FROM ${t} WHERE version_id=?`, V)) {
        const o: any = { ...r, version_id: ver };
        const cols = Object.keys(o);
        s.run(`INSERT INTO ${t}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`, cols.map((k) => o[k]));
      }
    }
    s.audit("CLONAR_MODELO", "modelo", mod, { origen: modeloId }, { codigo, nombre });
    return mod;
  });
}

export function archivarModelo(s: Store, modeloId: string, archivar: boolean) {
  s.run("UPDATE modelo SET estado=? WHERE id=?", [archivar ? "ARCHIVADO" : "ACTIVO", modeloId]);
  s.audit(archivar ? "ARCHIVAR_MODELO" : "REACTIVAR_MODELO", "modelo", modeloId, null, null);
}

/** Lee de la base la entrada del motor para la versión y período del contexto. */
export function cargarInput(s: Store, c: Contexto): ModeloInput {
  const V = [c.versionId];
  const igv = s.one("SELECT igv_tasa FROM empresa WHERE id=?", [c.empresaId])?.igv_tasa ?? 0.18;
  return {
    igv,
    centros: s.all("SELECT * FROM centro WHERE version_id=? ORDER BY codigo", V).map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, participacion: r.participacion, pct: r.pct_participacion })),
    actividades: s.all("SELECT * FROM actividad WHERE version_id=? ORDER BY orden, codigo", V).map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, centroId: r.centro_id, alcance: r.alcance, pct: r.pct_alcance, clase: r.clase_valor })),
    materiales: s
      .all("SELECT m.*, mp.costo_factura precio_periodo FROM material m LEFT JOIN material_precio mp ON mp.material_id=m.id AND mp.periodo_id=? WHERE m.version_id=? ORDER BY m.codigo", [c.periodoId, c.versionId])
      .map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, unidad: r.unidad_consumo, costoFactura: r.precio_periodo ?? r.costo_factura, cantidadFactura: r.cantidad_factura, equivalencia: r.equivalencia, incluyeIgv: !!r.incluye_igv, igvRecuperable: !!r.igv_recuperable, tratamientoValidado: !!r.tratamiento_validado })),
    consumos: s.all("SELECT cm.* FROM consumo_material cm JOIN material m ON m.id=cm.material_id WHERE m.version_id=? AND cm.periodo_id=?", [c.versionId, c.periodoId]).map((r) => ({ actividadId: r.actividad_id, materialId: r.material_id, cantidad: r.cantidad })),
    servicios: s.all("SELECT * FROM servicio_directo WHERE version_id=? AND periodo_id=?", [c.versionId, c.periodoId]).map((r) => ({ id: r.id, actividadId: r.actividad_id, proveedor: r.proveedor || "", servicio: r.servicio, cantidad: r.cantidad, unidad: r.unidad || "", tarifa: r.tarifa })),
    personas: s
      .all(
        `SELECT p.*, pu.nombre puesto, pu.tipo, pp.centro_id, cp.remuneracion, cp.essalud, cp.gratificacion, cp.cts, cp.vacaciones, cp.bonos, cp.otros, cp.horas_disponibles, cp.sobreimputacion_autorizada
         FROM persona p LEFT JOIN persona_puesto pp ON pp.persona_id=p.id AND pp.hasta IS NULL LEFT JOIN puesto pu ON pu.id=pp.puesto_id
         LEFT JOIN costo_persona cp ON cp.persona_id=p.id AND cp.periodo_id=? WHERE p.version_id=? ORDER BY p.codigo`,
        [c.periodoId, c.versionId],
      )
      .map((r) => ({
        id: r.id, codigo: r.codigo, nombre: r.nombre, puesto: r.puesto || "—", tipo: r.tipo || "DIRECTO", centroId: r.centro_id,
        costo: costoEmpresa({ remuneracion: r.remuneracion || 0, essalud: r.essalud || 0, gratificacion: r.gratificacion || 0, cts: r.cts || 0, vacaciones: r.vacaciones || 0, bonos: r.bonos || 0, otros: r.otros || 0 }),
        horas: r.horas_disponibles || 0, autorizada: !!r.sobreimputacion_autorizada, agregado: !!r.agregado_puesto,
      })),
    horas: s.all("SELECT ih.* FROM imputacion_horas ih JOIN persona p ON p.id=ih.persona_id WHERE p.version_id=? AND ih.periodo_id=?", [c.versionId, c.periodoId]).map((r) => ({ personaId: r.persona_id, actividadId: r.actividad_id, horas: r.horas })),
    ecs: s.all("SELECT e.*, em.monto FROM elemento_costo e LEFT JOIN ec_monto em ON em.ec_id=e.id AND em.periodo_id=? WHERE e.version_id=? ORDER BY e.codigo", [c.periodoId, c.versionId]).map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, monto: r.monto || 0 })),
    reglas: s.all("SELECT * FROM regla_reparto WHERE version_id=? ORDER BY codigo", V).map((r) => ({ id: r.id, codigo: r.codigo, nivel: r.nivel, origenId: r.origen_id, centroId: r.centro_id, inductor: r.inductor, unidad: r.unidad || "", tipo: r.tipo_base, baseDesde: r.base_desde })),
    bases: s.all("SELECT vb.* FROM valor_base vb JOIN regla_reparto r ON r.id=vb.regla_id WHERE r.version_id=? AND vb.periodo_id=?", [c.versionId, c.periodoId]).map((r) => ({ reglaId: r.regla_id, destinoId: r.destino_id, valor: r.valor, estado: r.estado_valor })),
    objetos: s.all("SELECT o.*, om.cantidad FROM objeto_costo o LEFT JOIN objeto_magnitud om ON om.objeto_id=o.id AND om.periodo_id=? WHERE o.version_id=? ORDER BY o.codigo", [c.periodoId, c.versionId]).map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, magnitud: r.magnitud || "", cantidad: r.cantidad, clase: r.clase || "OBJETO" })),
  };
}

export function hashInput(inp: ModeloInput): string {
  return hashStr(JSON.stringify(inp));
}

export function ultimaCorridaABC(s: Store, c: Contexto) {
  return s.one("SELECT * FROM corrida WHERE version_id=? AND periodo_id=? AND etapa='ABC' ORDER BY creado_en DESC LIMIT 1", [c.versionId, c.periodoId]);
}

/** Ejecuta el costeo completo y guarda la corrida con todas sus asignaciones y saldos (atómico). */
export function ejecutarABC(s: Store, c: Contexto, host: string): { runId: string; R: ResultadoModelo } {
  const inp = cargarInput(s, c);
  const R = costearModelo(inp);
  const h = hashInput(inp);
  const runId = "RUN-ABC-" + new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14) + "-" + h.slice(0, 4);
  const estado = R.bloqueos.length ? "CALCULADO_CON_BLOQUEOS" : R.saldos.some((x) => x.tipo === "PENDIENTE") ? "CALCULADO_CON_SALDOS" : "CONCILIADO";
  s.tx(() => {
    s.run("INSERT INTO corrida(id,version_id,periodo_id,etapa,params_hash,estado,host,app_version,creado_en) VALUES(?,?,?,?,?,?,?,?,?)", [runId, c.versionId, c.periodoId, "ABC", h, estado, host, APP_VERSION, now()]);
    const ins = (et: string, ot: string, oi: string, dt: string, di: string, base: number | null, den: number | null, tasa: number | null, imp: number, det?: any) =>
      s.run("INSERT INTO asignacion(corrida_id,etapa,origen_tipo,origen_id,destino_tipo,destino_id,base,denominador,tasa,importe,detalle) VALUES(?,?,?,?,?,?,?,?,?,?,?)", [runId, et, ot, oi, dt, di, base, den, tasa, imp, det ? JSON.stringify(det) : null]);
    for (const x of R.p1) ins("P1", "MATERIAL", x.materialId, "ACTIVIDAD", x.actividadId, x.cantidad, null, x.costoUnit, x.importe);
    for (const x of R.p2) ins("P2", "SERVICIO", x.servicio.id, "ACTIVIDAD", x.servicio.actividadId, x.servicio.cantidad, null, x.servicio.tarifa, x.importe);
    for (const x of R.p3) for (const a of x.r.porActividad) ins("P3", "PERSONA", x.persona.id, "ACTIVIDAD", a.actividadId, a.horas, x.persona.horas, x.r.tasa, a.importe);
    for (const g of R.p4a) if (g.r) for (const l of g.r.lineas) if (l.importe) ins("P4a", "EC", g.origenId, "CENTRO", l.destinoId, l.base, g.r.denominador, g.r.tasa, l.importe, { regla: g.regla?.codigo });
    for (const g of R.p4b) if (g.r) for (const l of g.r.lineas) if (l.importe) ins("P4b", "EC@" + g.centroId, g.origenId, "ACTIVIDAD", l.destinoId, l.base, g.r.denominador, g.r.tasa, l.importe, { regla: g.regla?.codigo });
    for (const g of R.p4c) if (g.r) for (const l of g.r.lineas) if (l.importe) ins("P4c", "ACTIVIDAD", g.origenId, "OBJETO", l.destinoId, l.base, g.r.denominador, g.r.tasa, l.importe, { regla: g.regla?.codigo });
    for (const z of R.saldos) s.run("INSERT INTO saldo(corrida_id,etapa,origen_tipo,origen_id,monto,causa) VALUES(?,?,?,?,?,?)", [runId, z.etapa, z.tipo, z.origen, z.monto, z.causa]);
    s.audit("EJECUTAR_COSTEO_ABC", "corrida", runId, null, { estado, fuente: R.totalFuente, objetos: R.objetos.reduce((a, o) => a + o.costo, 0), cuadra: R.cuadra });
  });
  return { runId, R };
}
