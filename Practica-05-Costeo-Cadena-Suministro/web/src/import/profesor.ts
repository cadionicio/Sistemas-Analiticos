// Importador de los libros del profesor (plantilla M01 y ejemplo M02), por nombre de hoja y encabezados.
// No inventa datos: lo que el Excel no tiene queda vacío o pendiente, con advertencia.
import { Paquete, paqueteVacio, norm } from "./paquete";

type WS = any;
type WB = any;

const raw = (ws: WS, r: number, c: number) => ws.getCell(r, c).value;
function val(ws: WS, r: number, c: number): any {
  const v = raw(ws, r, c);
  if (v && typeof v === "object") {
    if ("result" in v) return v.result && typeof v.result === "object" && "error" in v.result ? null : v.result;
    if ("richText" in v) return v.richText.map((t: any) => t.text).join("");
    if ("error" in v) return null;
    if ("text" in v) return v.text;
    if ("sharedFormula" in v) return v.result ?? null;
  }
  return v;
}
const txt = (ws: WS, r: number, c: number) => (val(ws, r, c) == null ? "" : String(val(ws, r, c)).replace(/\s+/g, " ").trim());
const num = (ws: WS, r: number, c: number): number | null => {
  const v = val(ws, r, c);
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const formula = (ws: WS, r: number, c: number): string | null => {
  const v = raw(ws, r, c);
  return v && typeof v === "object" && (v.formula || v.sharedFormula) ? String(v.formula || v.sharedFormula) : null;
};
const colL = (c: number) => {
  let s = "";
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
};
function find(ws: WS, pred: (t: string) => boolean, maxR = 80, maxC = 40): [number, number] | null {
  for (let r = 1; r <= maxR; r++) for (let c = 1; c <= maxC; c++) if (pred(norm(txt(ws, r, c)))) return [r, c];
  return null;
}
function sheet(wb: WB, pred: (n: string) => boolean): WS | null {
  return wb.worksheets.find((w: any) => pred(norm(w.name))) || null;
}

/** Clasifica el rótulo del inductor del Excel en un tipo de base del motor. */
export function tipoDesdeRotulo(rot: string): { tipo: "cantidad" | "porcentaje" | "importe" | "directo" | "plano"; unidad: string } {
  const n = norm(rot);
  if (n.includes("remun")) return { tipo: "importe", unidad: "S/" };
  if (n === "directo" || n.startsWith("directo")) return { tipo: "directo", unidad: "destino" };
  if (n.includes("%") || n.includes("porcent") || n.includes("dedicac") || n.includes("asignac")) return { tipo: "porcentaje", unidad: "%" };
  if (n.includes("flat") || n.includes("plano")) return { tipo: "plano", unidad: "destino" };
  return { tipo: "cantidad", unidad: rot.replace(/^#\s*/, "").trim() || "unidad" };
}

/** Valor del inductor en una celda: número directo, o numerador de una fórmula «=Bk*n/d» (ejemplo). */
function baseCelda(ws: WS, r: number, c: number): { valor: number | null; fuente: string } | null {
  const f = formula(ws, r, c);
  const ref = `${ws.name}!${colL(c)}${r}`;
  if (f) {
    const m = f.replace(/\s/g, "").match(/^\+?B\d+\*([0-9.]+)\/([0-9.]+)$/i);
    if (m) return { valor: Number(m[1]), fuente: `${ref} (fórmula =${f}: inductor ${m[1]} incrustado)` };
    const n = num(ws, r, c);
    return n === null ? null : { valor: n, fuente: `${ref} (=${f})` };
  }
  const n = num(ws, r, c);
  return n === null ? null : { valor: n, fuente: ref };
}

export function importarProfesor(wb: WB, archivo: string, sha256: string): Paquete {
  const nombres = wb.worksheets.map((w: any) => norm(w.name));
  const esEjemplo = nombres[0] !== "modelo costeo";
  const P = paqueteVacio(esEjemplo ? "EJEMPLO_APLICATIVO" : "PLANTILLA_PROFESOR");
  P.archivo = archivo;
  P.sha256 = sha256;
  P.modelo = esEjemplo
    ? { codigo: "M02", nombre: "Ejemplo aplicativo (Excel de referencia)", descripcion: `Importado de ${archivo}. Modo compatibilidad: estructura y datos del Excel original, sin datos inventados.`, origen: "EJEMPLO" }
    : { codigo: "M01", nombre: "Plantilla ABC de referencia (Excel)", descripcion: `Importado de ${archivo}. Modo compatibilidad: estructura y datos del Excel original, sin datos inventados.`, origen: "PLANTILLA" };
  P.empresa = { nombre: esEjemplo ? "Empresa del Excel de ejemplo (según archivo de origen)" : "Empresa de la plantilla de referencia", sintetico: false, igv: 0.18, moneda: "PEN" };
  const PER = "EXCEL-MES";
  P.periodos = [{ codigo: PER, nombre: "Mes del Excel de referencia", orden: 1 }];
  const adv = (s: string) => P.advertencias.push(s);
  const faltan = ["maestros", "asme costeo", "p4a1 ec-ca", "p4c ac-oc"].filter((n) => !nombres.includes(n));
  if (faltan.length) throw new Error("El archivo no tiene las hojas del formato de referencia: faltan " + faltan.join(", "));

  // ---------- Maestros: personal y materiales ----------
  const M = sheet(wb, (n) => n === "maestros")!;
  const pPos = find(M, (t) => t === "personal");
  const puestosMaestro: { nombre: string; costo: number; horas: number; fila: number }[] = [];
  if (pPos) {
    for (let r = pPos[0] + 1; r < pPos[0] + 20; r++) {
      const n = txt(M, r, pPos[1]);
      const costo = num(M, r, pPos[1] + 1);
      if (!n || costo === null) break;
      puestosMaestro.push({ nombre: n, costo, horas: num(M, r, pPos[1] + 2) || 0, fila: r });
    }
  }
  const matPos = find(M, (t) => t === "material");
  const materiales: { codigo: string; nombre: string }[] = [];
  if (matPos) {
    const [r0, c0] = matPos;
    for (let r = r0 + 1; r < r0 + 20; r++) {
      const n = txt(M, r, c0);
      const cf = num(M, r, c0 + 2);
      const cant = num(M, r, c0 + 3);
      const cu = num(M, r, c0 + 6);
      if (!n || cf === null || !cant || !cu) break;
      const f = formula(M, r, c0 + 6) || "";
      const incluyeIgv = /1[.,]18/.test(f);
      const eq = cf / (cu * cant * (incluyeIgv ? 1.18 : 1));
      const eqR = Math.round(eq * 1e6) / 1e6;
      const codigo = "MAT" + String(materiales.length + 1).padStart(2, "0");
      materiales.push({ codigo, nombre: n });
      P.materiales.push({
        codigo, nombre: n, unidadConsumo: txt(M, r, c0 + 5) || "unid", unidadFactura: txt(M, r, c0 + 1), costoFactura: cf, cantidadFactura: cant,
        equivalencia: eqR, equivalenciaTexto: txt(M, r, c0 + 4), incluyeIgv, igvRecuperable: true, validado: !incluyeIgv,
        fuente: `Maestros!${colL(c0)}${r}:${colL(c0 + 6)}${r}${f ? " (=" + f + ")" : ""}`,
      });
      P.referencias.push({ hoja: "Maestros", celda: `${colL(c0 + 6)}${r}`, concepto: "costo unitario material", clave: codigo, valor: cu, formula: f });
      if (incluyeIgv) adv(`Material ${n}: el Excel divide entre 1,18 (excluye IGV). Se conserva ese tratamiento; el derecho a crédito fiscal queda «pendiente de validación».`);
    }
  }

  // ---------- P4a1: centros y elementos de costo ----------
  const A = sheet(wb, (n) => n.startsWith("p4a1"))!;
  const aHdr = find(A, (t) => t === "elemento costo indirecto")!;
  const cenCols: { c: number; codigo: string; nombre: string }[] = [];
  for (let c = aHdr[1] + 3; c < aHdr[1] + 40; c++) {
    const t = txt(A, aHdr[0], c);
    if (!t || norm(t) === "total") break;
    cenCols.push({ c, codigo: "CA" + String(cenCols.length + 1).padStart(2, "0"), nombre: t });
  }
  const p4bSheets = wb.worksheets.filter((w: any) => norm(w.name).startsWith("p4b1"));
  const centroP4b = new Map<string, WS>();
  for (const w of p4bSheets) {
    const pos = find(w, (t) => t === "centro actividad", 5, 10);
    const nom = pos ? txt(w, pos[0], pos[1] + 1) : "";
    const cc = cenCols.find((x) => norm(x.nombre) === norm(nom));
    if (cc) centroP4b.set(cc.codigo, w);
    else adv(`Hoja ${w.name}: el centro «${nom}» no coincide con los centros de P4a1; no se importó.`);
  }
  for (const cc of cenCols)
    P.centros.push({
      codigo: cc.codigo, nombre: cc.nombre,
      participacion: centroP4b.has(cc.codigo) ? "PARTICIPA" : "NO_PARTICIPA",
      nota: centroP4b.has(cc.codigo) ? `Tiene hoja ${centroP4b.get(cc.codigo).name}` : "Sin hoja P4b1 en el Excel: no participa en la cadena (nota P2 del Modelo Costeo)",
    });
  const cenByName = (n: string) => cenCols.find((x) => norm(x.nombre) === norm(n) || norm(x.nombre).startsWith(norm(n)) || norm(n).startsWith(norm(x.nombre)));
  const ecByName = new Map<string, string>();
  for (let r = aHdr[0] + 1; r < aHdr[0] + 30; r++) {
    const n = txt(A, r, aHdr[1]);
    if (!n || norm(n).startsWith("total") || norm(n).startsWith("distribuc")) break;
    const monto = num(A, r, aHdr[1] + 1);
    const codigo = "EC" + String(P.ecs.length + 1).padStart(2, "0");
    ecByName.set(norm(n), codigo);
    P.ecs.push({ codigo, nombre: n });
    P.ecMontos.push({ ec: codigo, periodo: PER, monto: monto || 0, fuente: `${A.name}!${colL(aHdr[1] + 1)}${r}` });
    const rot = txt(A, r, aHdr[1] + 2);
    const t = tipoDesdeRotulo(rot);
    const rc = `R-${codigo}-CA`;
    P.reglas.push({ codigo: rc, nivel: "EC_CA", origen: codigo, inductor: rot, unidad: t.unidad, tipo: t.tipo, fuente: `${A.name}!${colL(aHdr[1] + 2)}${r}` });
    for (const cc of cenCols) {
      const b = baseCelda(A, r, cc.c);
      if (b) P.bases.push({ regla: rc, destino: cc.codigo, periodo: PER, valor: b.valor, estado: "REAL", metodo: "Dato del Excel", fuente: b.fuente });
    }
  }
  if (find(A, (t) => t.startsWith("distribucion de costos indirectos"))) {
    // ejemplo: matriz 2 calculada; se guardan sus resultados como referencia de comparación
    const p = find(A, (t) => t.startsWith("distribucion de costos indirectos"))!;
    for (let r = p[0] + 2; r < p[0] + 15; r++) {
      const n = txt(A, r, 1);
      if (!n || norm(n).startsWith("total")) break;
      for (const cc of cenCols) {
        const v = num(A, r, cc.c);
        if (v !== null) P.referencias.push({ hoja: A.name, celda: `${colL(cc.c)}${r}`, concepto: "P4a importe EC→CA", clave: `${ecByName.get(norm(n))}|${cc.codigo}`, valor: v, formula: formula(A, r, cc.c) || undefined });
      }
    }
  }

  // ---------- Asme Costeo: actividades, horas por puesto, cantidades de material ----------
  const S = sheet(wb, (n) => n === "asme costeo")!;
  const sHdr = find(S, (t) => t === "actividad", 10, 4)!;
  const hr = sHdr[0];
  const cols: { c: number; grupo: string; nombre: string }[] = [];
  for (let c = 4; c <= 30; c++) {
    const g = norm(txt(S, hr + 1, c) || txt(S, hr - 1, c));
    const n = txt(S, hr + 2 > hr + 1 ? hr + 2 : hr, c) || txt(S, hr, c);
    cols.push({ c, grupo: g, nombre: n });
  }
  // detectar columnas por grupo (fila de grupos = la que contiene «personal directo»)
  let gRow = -1;
  for (let r = hr - 1; r <= hr + 2; r++) for (let c = 4; c <= 12; c++) if (norm(txt(S, r, c)).includes("personal directo")) gRow = r;
  let nRow = -1;
  for (let r = hr; r <= hr + 3; r++) for (let c = 4; c <= 12; c++) if (/jefe/.test(norm(txt(S, r, c)))) nRow = nRow === -1 ? r : nRow;
  const persCols: number[] = [];
  const matCols: { c: number; mat: string | null }[] = [];
  const claseCols: { c: number; clase: string }[] = [];
  for (let c = 4; c <= 30; c++) {
    const g = gRow > 0 ? norm(txt(S, gRow, c)) : "";
    const nm = nRow > 0 ? norm(txt(S, nRow, c)) : "";
    if (g.includes("personal directo")) persCols.push(c);
    else if (g.includes("material directo")) {
      const mm = materiales.find((m) => nm.startsWith(norm(m.nombre).split(" ")[0]));
      matCols.push({ c, mat: mm ? mm.codigo : null });
    }
    const top = norm(txt(S, gRow, c) || "") + " " + nm;
    const mC = top.match(/\b(av|navn|navi)\b/);
    if (mC && !claseCols.find((x) => x.clase === mC[1].toUpperCase())) {
      const unidadFila = norm(txt(S, nRow + (gRow === nRow ? 1 : 0), c)) + " " + nm;
      if (!unidadFila.includes("s/")) claseCols.push({ c, clase: mC[1].toUpperCase() });
    }
  }
  if (persCols.length !== puestosMaestro.length) adv(`Asme Costeo tiene ${persCols.length} columnas de personal y Maestros ${puestosMaestro.length} puestos; se asocian por orden.`);
  puestosMaestro.forEach((p, i) => {
    const codigo = "PU" + String(i + 1).padStart(2, "0");
    P.puestos.push({ codigo, nombre: p.nombre, tipo: "DIRECTO" });
    const pc = "PA" + String(i + 1).padStart(2, "0");
    P.personas.push({ codigo: pc, nombre: `Puesto agregado: ${p.nombre} (sin detalle individual)`, puesto: codigo, centro: null, sintetico: false, agregado: true });
    P.costos.push({ persona: pc, periodo: PER, remuneracion: 0, essalud: 0, gratificacion: 0, cts: 0, vacaciones: 0, bonos: 0, otros: p.costo, horas: p.horas, autorizada: false, fuente: `Maestros!B${p.fila}:C${p.fila} (costo mes total sin desglose)` });
    P.referencias.push({ hoja: "Maestros", celda: `D${p.fila}`, concepto: "tasa hora puesto", clave: pc, valor: num(M, p.fila, pPos![1] + 3), formula: formula(M, p.fila, pPos![1] + 3) || undefined });
  });
  if (puestosMaestro.length) adv("Los Excel costean por PUESTO, no por persona. Cada puesto se importa como «puesto agregado» sin inventar personas; el costo mes total va al componente «Otros» porque el Excel no lo desglosa.");
  let orden = 0;
  for (let r = hr + 1; r < hr + 60; r++) {
    const nombre = txt(S, r, 2);
    const nro = num(S, r, 1);
    if (!nombre || norm(nombre) === "total" || norm(txt(S, r, 3)) === "total") {
      if (norm(txt(S, r, 2)) === "total" || norm(txt(S, r, 3)) === "total") break;
      continue;
    }
    if (nro === null) continue;
    const cen = cenByName(txt(S, r, 3));
    if (!cen) {
      adv(`Asme fila ${r}: centro «${txt(S, r, 3)}» no existe en P4a1; actividad omitida.`);
      continue;
    }
    orden++;
    const codigo = "A" + String(nro);
    const clase = claseCols.find((x) => (num(S, r, x.c) || 0) > 0)?.clase || null;
    P.actividades.push({ codigo, nombre, centro: cen.codigo, alcance: "INCLUIDA", clase, orden, nota: `Asme Costeo fila ${r} (mapeo de actividades de la cadena)` });
    persCols.forEach((c, i) => {
      const h = num(S, r, c);
      if (h && h > 0 && P.personas[i]) P.horas.push({ persona: P.personas[i].codigo, actividad: codigo, periodo: PER, horas: h, fuente: `Asme Costeo!${colL(c)}${r}` });
    });
    for (const mc of matCols) {
      const q = num(S, r, mc.c);
      if (q && q > 0) {
        if (mc.mat) P.consumos.push({ actividad: codigo, material: mc.mat, periodo: PER, cantidad: q, fuente: `Asme Costeo!${colL(mc.c)}${r}` });
        else adv(`Asme ${colL(mc.c)}${r}: material sin correspondencia en Maestros; cantidad ${q} no costeada.`);
      }
    }
  }
  // sobreimputación por puesto (el Excel agrupa varias personas por puesto)
  for (const c of P.costos) {
    const imp = P.horas.filter((h) => h.persona === c.persona).reduce((s, h) => s + h.horas, 0);
    if (imp > c.horas + 1e-9) {
      c.autorizada = true;
      c.justificacion = `Modo compatibilidad Excel: el puesto imputa ${imp} h con ${c.horas} h disponibles por persona; el Excel agrupa varias personas no identificadas en el puesto. Revisar al pasar a costeo por persona.`;
      adv(`${P.personas.find((p) => p.codigo === c.persona)?.nombre}: ${imp} h imputadas vs ${c.horas} h disponibles → sobreimputación autorizada en modo compatibilidad (revisable).`);
    }
  }
  // referencias P1 / P3 del ejemplo
  const P1 = sheet(wb, (n) => n === "p1 cmd");
  const P3 = sheet(wb, (n) => n === "p3 cpd");
  const refPorActividad = (ws: WS | null, concepto: string, colTotal: (ws: WS) => number | null) => {
    if (!ws) return;
    const ct = colTotal(ws);
    if (!ct) return;
    for (let r = 1; r < 60; r++) {
      const nro = num(ws, r, 1);
      const nm = txt(ws, r, 2);
      if (nro === null || !nm) continue;
      const v = num(ws, r, ct);
      if (v !== null) P.referencias.push({ hoja: ws.name, celda: `${colL(ct)}${r}`, concepto, clave: "A" + nro, valor: v, formula: formula(ws, r, ct) || undefined });
    }
  };
  const colDe = (re: RegExp) => (ws: WS) => {
    for (let r = 1; r < 8; r++) for (let c = 5; c < 25; c++) if (re.test(norm(txt(ws, r, c)))) return c;
    return null;
  };
  refPorActividad(P1, "P1 total CMD por actividad", colDe(/^total( cmd)?/));
  refPorActividad(P3, "P3 total CPD por actividad", colDe(/^total( cpd)?/));

  // ---------- P4b1: centros → actividades ----------
  const actByName = (n: string) => P.actividades.find((a) => norm(a.nombre) === norm(n));
  for (const [cc, w] of centroP4b) {
    const h = find(w, (t) => t === "elemento costo indirecto", 8, 4)!;
    const actCols: { c: number; act: string }[] = [];
    for (let c = h[1] + 3; c < h[1] + 30; c++) {
      const t = txt(w, h[0], c);
      if (!t || norm(t) === "total") break;
      let a = actByName(t);
      if (!a) {
        const codigo = `X${cc.slice(2)}-${actCols.length + 1}`;
        a = { codigo, nombre: t, centro: cc, alcance: "EXCLUIDA", clase: null, orden: 900 + P.actividades.length, nota: `Figura en ${w.name} pero no en Asme Costeo (mapeo de la cadena): se registra como «Otra actividad» del centro. Revisable.` };
        P.actividades.push(a);
        adv(`${w.name}: actividad «${t}» no está en Asme Costeo → «Otra actividad» (excluida de P4c, revisable).`);
      }
      actCols.push({ c, act: a.codigo });
    }
    for (let r = h[0] + 1; r < h[0] + 20; r++) {
      const n = txt(w, r, 1);
      if (!n || norm(n).startsWith("total")) break;
      const ec = ecByName.get(norm(n));
      if (!ec) {
        adv(`${w.name} fila ${r}: elemento «${n}» no existe en P4a1.`);
        continue;
      }
      const rot = txt(w, r, 3);
      const t = tipoDesdeRotulo(rot);
      const rc = `R-${ec}-${cc}`;
      P.reglas.push({ codigo: rc, nivel: "CA_AC", origen: ec, centro: cc, inductor: rot, unidad: t.unidad, tipo: t.tipo, fuente: `${w.name}!C${r}` });
      for (const ac of actCols) {
        const b = baseCelda(w, r, ac.c);
        if (b) P.bases.push({ regla: rc, destino: ac.act, periodo: PER, valor: b.valor, estado: "REAL", metodo: "Dato del Excel", fuente: b.fuente });
      }
    }
    // referencia: total CI por actividad (fila TOTAL) si está calculado
    const tr = find(w, (t) => t.startsWith("total"), 25, 2);
    if (tr) for (const ac of actCols) {
      const v = num(w, tr[0], ac.c);
      if (v !== null) P.referencias.push({ hoja: w.name, celda: `${colL(ac.c)}${tr[0]}`, concepto: "P4b total CI por actividad", clave: ac.act, valor: v, formula: formula(w, tr[0], ac.c) || undefined });
    }
  }

  // ---------- Resumen: referencia del total por actividad ----------
  const R = sheet(wb, (n) => n.startsWith("resumen costos"));
  if (R) refPorActividad(R, "Resumen total costo por actividad", colDe(/^total costo s\/?/));

  // ---------- P4C: actividades → objetos ----------
  const C = sheet(wb, (n) => n.startsWith("p4c"))!;
  const cHdr = find(C, (t) => t === "actividad", 8, 2)!;
  const indCol = (() => {
    for (let c = 2; c < 8; c++) if (norm(txt(C, cHdr[0], c)) === "inductor") return c;
    return 4;
  })();
  const objCols: { c: number; codigo: string; nombre: string }[] = [];
  for (let c = indCol + 1; c < indCol + 30; c++) {
    const parts = [txt(C, cHdr[0] - 1, c), txt(C, cHdr[0], c), txt(C, cHdr[0] + 1, c)];
    if (parts.some((p) => norm(p) === "total")) break;
    const cod = parts.find((p) => /^oc\s*\d+/i.test(p));
    if (!cod) break;
    const nom = parts.find((p) => p && !/^oc\s*\d+/i.test(p) && norm(p) !== "total") || cod;
    objCols.push({ c, codigo: cod.replace(/\s+/g, " ").toUpperCase(), nombre: nom });
  }
  // tabla de costo unitario (magnitud y cantidad)
  const uPos = find(C, (t) => t === "objeto de costo", 90, 2);
  const unit = new Map<string, { mag: string; cant: number | null; fila: number }>();
  if (uPos) for (let r = uPos[0] + 1; r < uPos[0] + 20; r++) {
    const cod = txt(C, r, 1);
    if (!/^oc\s*\d+/i.test(cod)) break;
    unit.set(cod.replace(/\s+/g, " ").toUpperCase(), { mag: txt(C, r, 4), cant: num(C, r, 5), fila: r });
    const v = num(C, r, 3);
    if (v !== null) P.referencias.push({ hoja: C.name, celda: `C${r}`, concepto: "P4c costo por objeto", clave: cod.replace(/\s+/g, " ").toUpperCase(), valor: v, formula: formula(C, r, 3) || undefined });
  }
  for (const oc of objCols) {
    const u = unit.get(oc.codigo);
    const mag = u?.mag || "";
    const revisar = /d[ií]as/i.test(mag);
    P.objetos.push({ codigo: oc.codigo, nombre: oc.nombre, magnitud: mag, clase: revisar ? "OBJETO_REVISION" : "OBJETO", nota: revisar ? "Su magnitud es un tiempo (días): conceptualmente es un indicador (KPI). Se conserva como en el Excel original; reclasificar requiere aprobación." : undefined });
    P.magnitudes.push({ objeto: oc.codigo, periodo: PER, cantidad: u?.cant ?? null, fuente: u ? `${C.name}!E${u.fila}` : "sin dato" });
    if (revisar) adv(`Objeto ${oc.codigo} «${oc.nombre}» (magnitud «${mag}»): se conserva como objeto, marcado para revisión conceptual como KPI.`);
  }
  for (let r = cHdr[0] + 1; r < cHdr[0] + 40; r++) {
    const n = txt(C, r, 1);
    if (!n || norm(n) === "total") {
      if (norm(n) === "total") break;
      continue;
    }
    const a = actByName(n);
    if (!a) {
      adv(`${C.name} fila ${r}: actividad «${n}» no encontrada.`);
      continue;
    }
    const rot = txt(C, r, indCol);
    if (!rot) continue;
    const t = tipoDesdeRotulo(rot);
    const rc = `R-${a.codigo}-OC`;
    if (P.reglas.find((x) => x.codigo === rc)) continue;
    P.reglas.push({ codigo: rc, nivel: "AC_OC", origen: a.codigo, inductor: rot, unidad: t.unidad, tipo: t.tipo, fuente: `${C.name}!${colL(indCol)}${r}` });
    for (const oc of objCols) {
      const b = baseCelda(C, r, oc.c);
      if (b) P.bases.push({ regla: rc, destino: oc.codigo, periodo: PER, valor: b.valor, estado: "REAL", metodo: "Dato del Excel", fuente: b.fuente });
    }
  }
  return P;
}
