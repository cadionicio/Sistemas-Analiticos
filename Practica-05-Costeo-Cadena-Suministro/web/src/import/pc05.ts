// Importador del formato normalizado PC05 (05_Datos_Entrada.xlsx). Lee por nombre de hoja y de columna.
// Valida tipos, dominios e integridad referencial; si hay errores, rechaza todo el lote (importación atómica).
import { Paquete, paqueteVacio, norm } from "./paquete";

type Fila = Record<string, any> & { __fila: number };

function leerHoja(wb: any, nombre: string, requerida = true): Fila[] {
  const ws = wb.worksheets.find((w: any) => norm(w.name) === norm(nombre));
  if (!ws) {
    if (requerida) throw new Error(`Falta la hoja «${nombre}».`);
    return [];
  }
  const hdr: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (c: any, col: number) => (hdr[col] = norm(c.value)));
  const out: Fila[] = [];
  ws.eachRow({ includeEmpty: false }, (row: any, r: number) => {
    if (r === 1) return;
    const o: Fila = { __fila: r };
    let vacio = true;
    hdr.forEach((h, col) => {
      if (!h) return;
      let v = row.getCell(col).value;
      if (v && typeof v === "object") v = "result" in v ? v.result : "richText" in v ? v.richText.map((t: any) => t.text).join("") : "text" in v ? v.text : v;
      if (v !== null && v !== undefined && v !== "") vacio = false;
      o[h] = v;
    });
    if (!vacio) out.push(o);
  });
  return out;
}

export function importarPC05(wb: any, archivo: string, sha256: string): Paquete {
  const P = paqueteVacio("PC05_NORMALIZADO");
  P.archivo = archivo;
  P.sha256 = sha256;
  const errores: string[] = [];
  const err = (hoja: string, f: Fila | null, msg: string) => errores.length < 60 && errores.push(`${hoja}${f ? " fila " + f.__fila : ""}: ${msg}`);
  const txt = (f: Fila, k: string) => (f[k] === null || f[k] === undefined ? "" : String(f[k]).trim());
  const numR = (hoja: string, f: Fila, k: string, opt = false): number | null => {
    const v = f[k];
    if (v === null || v === undefined || v === "") {
      if (!opt) err(hoja, f, `columna «${k}» vacía`);
      return null;
    }
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isFinite(n)) {
      err(hoja, f, `columna «${k}» no es número («${v}»)`);
      return null;
    }
    if (n < 0) err(hoja, f, `columna «${k}» negativa`);
    return n;
  };
  const bool = (v: any) => ["1", "si", "sí", "true", "x", "s"].includes(norm(v));

  const emp = Object.fromEntries(leerHoja(wb, "Empresa").map((f) => [norm(f.clave), f.valor]));
  P.empresa = { nombre: String(emp["nombre"] || "Empresa sin nombre"), moneda: String(emp["moneda"] || "PEN"), igv: Number(emp["igv"] ?? 0.18), sintetico: bool(emp["sintetico"]) };
  P.modelo = { codigo: String(emp["codigo_modelo"] || "M03"), nombre: String(emp["nombre_modelo"] || "Modelo importado"), descripcion: `Importado de ${archivo} (formato normalizado).`, origen: bool(emp["sintetico"]) ? "DEMO" : "USUARIO" };

  const per = new Set<string>();
  for (const f of leerHoja(wb, "Periodos")) {
    const c = txt(f, "codigo");
    if (!c) err("Periodos", f, "código vacío");
    else if (per.has(c)) err("Periodos", f, `período duplicado ${c}`);
    per.add(c);
    P.periodos.push({ codigo: c, nombre: txt(f, "nombre") || c, orden: Number(f.orden) || P.periodos.length + 1 });
  }
  const chkPer = (h: string, f: Fila) => (per.has(txt(f, "periodo")) ? txt(f, "periodo") : (err(h, f, `período «${txt(f, "periodo")}» no existe`), ""));
  const uniq = (h: string, rows: Fila[], k = "codigo") => {
    const s = new Set<string>();
    rows.forEach((f) => {
      const c = txt(f, k);
      if (!c) err(h, f, `«${k}» vacío`);
      if (s.has(c)) err(h, f, `código duplicado «${c}»`);
      s.add(c);
    });
    return s;
  };
  const cen = leerHoja(wb, "Centros");
  const sCen = uniq("Centros", cen);
  for (const f of cen) {
    const p = (txt(f, "participacion") || "PARTICIPA").toUpperCase();
    if (!["PARTICIPA", "NO_PARTICIPA", "PARCIAL"].includes(p)) err("Centros", f, `participación inválida «${p}»`);
    const pct = numR("Centros", f, "pct_participacion", true);
    if (p === "PARCIAL" && (pct === null || pct > 1)) err("Centros", f, "PARCIAL requiere pct_participacion entre 0 y 1");
    P.centros.push({ codigo: txt(f, "codigo"), nombre: txt(f, "nombre"), participacion: p as any, pct, nota: txt(f, "nota") || undefined });
  }
  const act = leerHoja(wb, "Actividades");
  const sAct = uniq("Actividades", act);
  for (const f of act) {
    if (!sCen.has(txt(f, "centro"))) err("Actividades", f, `centro «${txt(f, "centro")}» no existe`);
    const a = (txt(f, "alcance") || "INCLUIDA").toUpperCase();
    if (!["INCLUIDA", "EXCLUIDA", "PARCIAL"].includes(a)) err("Actividades", f, `alcance inválido «${a}»`);
    const cl = txt(f, "clase").toUpperCase() || null;
    if (cl && !["AV", "NAVN", "NAVI"].includes(cl)) err("Actividades", f, `clase inválida «${cl}»`);
    P.actividades.push({ codigo: txt(f, "codigo"), nombre: txt(f, "nombre"), centro: txt(f, "centro"), alcance: a as any, pct: numR("Actividades", f, "pct_alcance", true), clase: cl, orden: Number(f.orden) || 0, nota: txt(f, "nota") || undefined });
  }
  const pu = leerHoja(wb, "Puestos");
  const sPu = uniq("Puestos", pu);
  for (const f of pu) P.puestos.push({ codigo: txt(f, "codigo"), nombre: txt(f, "nombre"), tipo: (txt(f, "tipo").toUpperCase() === "INDIRECTO" ? "INDIRECTO" : "DIRECTO") as any });
  const pe = leerHoja(wb, "Personas");
  const sPe = uniq("Personas", pe);
  for (const f of pe) {
    if (!sPu.has(txt(f, "puesto"))) err("Personas", f, `puesto «${txt(f, "puesto")}» no existe`);
    if (txt(f, "centro") && !sCen.has(txt(f, "centro"))) err("Personas", f, `centro «${txt(f, "centro")}» no existe`);
    P.personas.push({ codigo: txt(f, "codigo"), nombre: txt(f, "nombre"), puesto: txt(f, "puesto"), centro: txt(f, "centro") || null, sintetico: P.empresa.sintetico, agregado: false });
  }
  const dup = new Set<string>();
  for (const f of leerHoja(wb, "CostoPersona")) {
    const k = txt(f, "persona") + "|" + txt(f, "periodo");
    if (dup.has(k)) err("CostoPersona", f, `duplicado ${k}`);
    dup.add(k);
    if (!sPe.has(txt(f, "persona"))) err("CostoPersona", f, `persona «${txt(f, "persona")}» no existe`);
    const g = (c: string) => numR("CostoPersona", f, c, true) || 0;
    P.costos.push({ persona: txt(f, "persona"), periodo: chkPer("CostoPersona", f), remuneracion: g("remuneracion"), essalud: g("essalud"), gratificacion: g("gratificacion"), cts: g("cts"), vacaciones: g("vacaciones"), bonos: g("bonos"), otros: g("otros"), horas: numR("CostoPersona", f, "horas_disponibles") || 0, autorizada: bool(f.sobreimputacion_autorizada), justificacion: txt(f, "justificacion") || undefined, fuente: `05:CostoPersona!${f.__fila}` });
  }
  for (const f of leerHoja(wb, "Horas")) {
    if (!sPe.has(txt(f, "persona"))) err("Horas", f, `persona «${txt(f, "persona")}» no existe`);
    if (!sAct.has(txt(f, "actividad"))) err("Horas", f, `actividad «${txt(f, "actividad")}» no existe`);
    P.horas.push({ persona: txt(f, "persona"), actividad: txt(f, "actividad"), periodo: chkPer("Horas", f), horas: numR("Horas", f, "horas") || 0, fuente: `05:Horas!${f.__fila}` });
  }
  const mat = leerHoja(wb, "Materiales");
  const sMat = uniq("Materiales", mat);
  for (const f of mat) {
    const cant = numR("Materiales", f, "cantidad_factura");
    const eq = numR("Materiales", f, "equivalencia");
    if (!cant || !eq) err("Materiales", f, "cantidad_factura y equivalencia deben ser > 0");
    P.materiales.push({ codigo: txt(f, "codigo"), nombre: txt(f, "nombre"), unidadConsumo: txt(f, "unidad_consumo"), unidadFactura: txt(f, "unidad_factura"), costoFactura: numR("Materiales", f, "costo_factura") || 0, cantidadFactura: cant || 1, equivalencia: eq || 1, incluyeIgv: bool(f.incluye_igv), igvRecuperable: f.igv_recuperable === undefined ? true : bool(f.igv_recuperable), validado: f.validado === undefined ? true : bool(f.validado), fuente: `05:Materiales!${f.__fila}` });
  }
  for (const f of leerHoja(wb, "PreciosMaterial", false)) {
    if (!sMat.has(txt(f, "material"))) err("PreciosMaterial", f, `material «${txt(f, "material")}» no existe`);
    P.precios.push({ material: txt(f, "material"), periodo: chkPer("PreciosMaterial", f), costoFactura: numR("PreciosMaterial", f, "costo_factura") || 0 });
  }
  for (const f of leerHoja(wb, "ConsumoMaterial")) {
    if (!sAct.has(txt(f, "actividad"))) err("ConsumoMaterial", f, `actividad «${txt(f, "actividad")}» no existe`);
    if (!sMat.has(txt(f, "material"))) err("ConsumoMaterial", f, `material «${txt(f, "material")}» no existe`);
    P.consumos.push({ actividad: txt(f, "actividad"), material: txt(f, "material"), periodo: chkPer("ConsumoMaterial", f), cantidad: numR("ConsumoMaterial", f, "cantidad") || 0, fuente: `05:ConsumoMaterial!${f.__fila}` });
  }
  for (const f of leerHoja(wb, "ServiciosDirectos", false)) {
    if (!sAct.has(txt(f, "actividad"))) err("ServiciosDirectos", f, `actividad «${txt(f, "actividad")}» no existe`);
    P.servicios.push({ actividad: txt(f, "actividad"), periodo: chkPer("ServiciosDirectos", f), proveedor: txt(f, "proveedor"), servicio: txt(f, "servicio"), cantidad: numR("ServiciosDirectos", f, "cantidad") || 0, unidad: txt(f, "unidad"), tarifa: numR("ServiciosDirectos", f, "tarifa") || 0, documento: txt(f, "documento") || undefined, fuente: `05:ServiciosDirectos!${f.__fila}` });
  }
  const ecs = leerHoja(wb, "ElementosCosto");
  const sEc = uniq("ElementosCosto", ecs);
  for (const f of ecs) P.ecs.push({ codigo: txt(f, "codigo"), nombre: txt(f, "nombre"), tipo: txt(f, "tipo") || undefined });
  for (const f of leerHoja(wb, "MontosEC")) {
    if (!sEc.has(txt(f, "ec"))) err("MontosEC", f, `elemento «${txt(f, "ec")}» no existe`);
    P.ecMontos.push({ ec: txt(f, "ec"), periodo: chkPer("MontosEC", f), monto: numR("MontosEC", f, "monto") || 0, fuente: `05:MontosEC!${f.__fila}` });
  }
  const obj = leerHoja(wb, "ObjetosCosto");
  const sObj = uniq("ObjetosCosto", obj);
  for (const f of obj) P.objetos.push({ codigo: txt(f, "codigo"), nombre: txt(f, "nombre"), magnitud: txt(f, "magnitud"), clase: (["KPI", "OBJETO_REVISION"].includes(txt(f, "clase").toUpperCase()) ? txt(f, "clase").toUpperCase() : "OBJETO") as any });
  for (const f of leerHoja(wb, "MagnitudObjeto", false)) {
    if (!sObj.has(txt(f, "objeto"))) err("MagnitudObjeto", f, `objeto «${txt(f, "objeto")}» no existe`);
    P.magnitudes.push({ objeto: txt(f, "objeto"), periodo: chkPer("MagnitudObjeto", f), cantidad: numR("MagnitudObjeto", f, "cantidad", true), fuente: `05:MagnitudObjeto!${f.__fila}` });
  }
  const reg = leerHoja(wb, "Reglas");
  const sReg = uniq("Reglas", reg);
  const nivelDe = new Map<string, string>();
  for (const f of reg) {
    const nivel = txt(f, "nivel").toUpperCase();
    if (!["EC_CA", "CA_AC", "AC_OC"].includes(nivel)) err("Reglas", f, `nivel inválido «${nivel}»`);
    const tipo = norm(f.tipo_base);
    if (!["cantidad", "porcentaje", "importe", "directo", "plano"].includes(tipo)) err("Reglas", f, `tipo_base inválido «${f.tipo_base}»`);
    const origen = txt(f, "origen");
    if (nivel === "AC_OC" ? !sAct.has(origen) : !sEc.has(origen)) err("Reglas", f, `origen «${origen}» no existe para el nivel ${nivel}`);
    if (nivel === "CA_AC" && !sCen.has(txt(f, "centro"))) err("Reglas", f, `centro «${txt(f, "centro")}» no existe`);
    nivelDe.set(txt(f, "codigo"), nivel);
    P.reglas.push({ codigo: txt(f, "codigo"), nivel: nivel as any, origen, centro: txt(f, "centro") || null, inductor: txt(f, "inductor"), unidad: txt(f, "unidad"), tipo: tipo as any, baseDesde: txt(f, "base_desde") || null, fuente: `05:Reglas!${f.__fila}` });
  }
  const dupB = new Set<string>();
  for (const f of leerHoja(wb, "Bases")) {
    const r = txt(f, "regla");
    if (!sReg.has(r)) {
      err("Bases", f, `regla «${r}» no existe`);
      continue;
    }
    const nv = nivelDe.get(r);
    const d = txt(f, "destino");
    if ((nv === "EC_CA" && !sCen.has(d)) || (nv === "CA_AC" && !sAct.has(d)) || (nv === "AC_OC" && !sObj.has(d))) err("Bases", f, `destino «${d}» no válido para ${nv}`);
    const k = r + "|" + d + "|" + txt(f, "periodo");
    if (dupB.has(k)) err("Bases", f, `valor duplicado ${k}`);
    dupB.add(k);
    const est = (txt(f, "estado") || "REAL").toUpperCase();
    if (!["REAL", "ESTIMADO", "AJUSTADO", "PENDIENTE"].includes(est)) err("Bases", f, `estado inválido «${est}»`);
    P.bases.push({ regla: r, destino: d, periodo: chkPer("Bases", f), valor: numR("Bases", f, "valor", true), estado: est as any, metodo: txt(f, "metodo") || undefined, fuente: `05:Bases!${f.__fila}` });
  }
  for (const f of leerHoja(wb, "Presupuesto", false)) P.presupuesto.push({ periodo: chkPer("Presupuesto", f), concepto: txt(f, "concepto"), monto: numR("Presupuesto", f, "monto") || 0, unidad: txt(f, "unidad") });
  for (const f of leerHoja(wb, "FinanzasEVA", false))
    P.finanzas.push({ periodo: chkPer("FinanzasEVA", f), ventas: numR("FinanzasEVA", f, "ventas", true), costoVentas: numR("FinanzasEVA", f, "costo_ventas_sin_logistica", true), otrosGastos: numR("FinanzasEVA", f, "otros_gastos_operativos", true), tasaImpuesto: numR("FinanzasEVA", f, "tasa_impuesto", true) });
  for (const f of leerHoja(wb, "ParametrosEVA", false)) P.parametrosEva.push({ clave: norm(f.clave), valor: numR("ParametrosEVA", f, "valor", true), unidad: txt(f, "unidad"), descripcion: txt(f, "descripcion") });
  for (const f of leerHoja(wb, "Escenarios", false)) {
    const mn = numR("Escenarios", f, "minimo") || 0, mo = numR("Escenarios", f, "moda") || 0, mx = numR("Escenarios", f, "maximo") || 0;
    if (!(mn <= mo && mo <= mx)) err("Escenarios", f, "se requiere mínimo ≤ moda ≤ máximo");
    P.escenarios.push({ escenario: txt(f, "escenario"), variable: txt(f, "variable"), distribucion: norm(f.distribucion) || "triangular", minimo: mn, moda: mo, maximo: mx });
  }
  if (errores.length) throw new Error(`${errores.length} error(es) de validación; no se importó nada:\n- ` + errores.slice(0, 15).join("\n- ") + (errores.length > 15 ? "\n…" : ""));
  if (P.empresa.sintetico) P.advertencias.push("Los datos de este archivo están declarados como SINTÉTICOS: no representan una empresa real.");
  return P;
}
