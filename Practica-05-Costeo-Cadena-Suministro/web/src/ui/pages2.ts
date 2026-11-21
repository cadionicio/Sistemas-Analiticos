// Pantallas de la Iteración 2: modelos, estructuras, procesos, recursos, maestros, inductores, matrices P1–P4c y conciliación.
import { Store } from "../db/store";
import * as MOD from "../app/modelos";
import { Contexto } from "../app/usecases";
import { ResultadoModelo, costoUnitarioMaterial, RepartoReg } from "../domain/motor";
import { round2 } from "../domain/abc";
import { money, num, neg, esc, pct, pillEstado, fechaHora, abrev } from "./comun";

export interface Host {
  s: Store;
  ctx: Contexto | null;
  st: { sub: Record<string, string>; drawer: string | null; [k: string]: any };
  abc(): ResultadoModelo | null;
  estadoABC(): { cls: string; txt: string; run: any; vivo: boolean };
  title(h: string, p: string, actions?: string): string;
  subtabs(key: string, items: { id: string; label: string; soon?: string }[]): string;
}

const TIPOS = ["cantidad", "porcentaje", "importe", "directo", "plano"];

function mapNombre(s: Store, c: Contexto) {
  const m = new Map<string, any>();
  for (const r of s.all("SELECT id, codigo, nombre, 'CA' t FROM centro WHERE version_id=?", [c.versionId])) m.set(r.id, r);
  for (const r of s.all("SELECT id, codigo, nombre, 'AC' t FROM actividad WHERE version_id=?", [c.versionId])) m.set(r.id, r);
  for (const r of s.all("SELECT id, codigo, nombre, 'OC' t FROM objeto_costo WHERE version_id=?", [c.versionId])) m.set(r.id, r);
  for (const r of s.all("SELECT id, codigo, nombre, 'EC' t FROM elemento_costo WHERE version_id=?", [c.versionId])) m.set(r.id, r);
  for (const r of s.all("SELECT id, codigo, nombre, 'MT' t FROM material WHERE version_id=?", [c.versionId])) m.set(r.id, r);
  for (const r of s.all("SELECT id, codigo, nombre, 'PE' t FROM persona WHERE version_id=?", [c.versionId])) m.set(r.id, r);
  return m;
}

function bannerEstado(h: Host): string {
  const e = h.estadoABC();
  if (e.cls === "none") return `<div class="alert info">El costeo de este período aún no se ha ejecutado. Pulsa «Ejecutar costeo completo» para calcular y guardar la corrida; las matrices muestran «Sin calcular» hasta entonces.</div>`;
  if (e.vivo) return `<div class="alert warn">Los datos de origen cambiaron después de la corrida ${esc(e.run.id)}. Las cifras son el recálculo en vivo, aún no confirmadas: vuelve a ejecutar el costeo.</div>`;
  return "";
}
const mostrar = (h: Host) => h.estadoABC().cls !== "none";

// ======================= 4 · Modelo de costeo =======================
export function pModelo(h: Host): string {
  const sub = h.st.sub.modelo || "gestion";
  let body = "";
  if (sub === "gestion") {
    const ms = MOD.listarModelos(h.s);
    body = `${(h as any).panelDemo(true)}<section class="panel"><h3>Modelos de costeo (N modelos independientes)</h3>
      <p class="lead">Cada modelo tiene sus propios centros, actividades, personas, inductores y resultados. Clonar crea una copia independiente: los cambios en el clon no alteran el original.</p>
      <div class="form-row">
        <label class="btn primary" style="cursor:pointer">Importar Excel de referencia (plantilla ABC)<input type="file" accept=".xlsx" data-edit="m2-import-profesor" hidden></label>
        <label class="btn" style="cursor:pointer">Importar Excel de datos (formato normalizado)<input type="file" accept=".xlsx" data-edit="m2-import-pc05" hidden></label>
      </div>
      <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Modelo</th><th>Origen</th><th>Empresa</th><th>Versión</th><th>Centros</th><th>Actividades</th><th>Objetos</th><th>Personas</th><th>Archivo de origen</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      ${ms
        .map((m) => {
          const activo = h.ctx?.modeloId === m.id;
          return `<tr><td class="frz1 mono">${esc(m.codigo)}</td><td class="frz2"><b>${esc(m.nombre)}</b>${activo ? ' <span class="pill ok">Activo</span>' : ""}</td><td>${esc(m.origen)}</td><td>${esc(m.empresa)}</td>
          <td class="num">v${esc(m.numero)}</td><td class="num">${m.n_ca}</td><td class="num">${m.n_act}</td><td class="num">${m.n_oc}</td><td class="num">${m.n_pe}</td>
          <td class="mono" title="SHA-256 ${esc(m.sha256 || "")}">${esc(m.archivo || "—")}</td><td>${m.estado === "ARCHIVADO" ? '<span class="pill none">Archivado</span>' : '<span class="pill ok">Activo</span>'}</td>
          <td style="white-space:nowrap">${activo ? "" : `<button class="btn small" data-act="m2-activar" data-id="${m.id}">Abrir</button> `}<button class="btn small" data-act="m2-clonar" data-id="${m.id}">Clonar</button> <button class="btn small" data-act="m2-archivar" data-id="${m.id}" data-v="${m.estado === "ARCHIVADO" ? 0 : 1}">${m.estado === "ARCHIVADO" ? "Reactivar" : "Archivar"}</button></td></tr>`;
        })
        .join("")}</tbody></table></div></section>`;
    if (h.ctx) {
      const o = h.s.one("SELECT * FROM modelo_origen WHERE modelo_id=?", [h.ctx.modeloId]);
      if (o) {
        const adv: string[] = JSON.parse(o.advertencias || "[]");
        body += `<section class="panel"><h3>Trazabilidad de la importación del modelo activo</h3>
          <dl class="mono" style="display:grid;grid-template-columns:170px 1fr;gap:6px 10px;margin:0 0 12px"><dt class="muted">Archivo</dt><dd>${esc(o.archivo)}</dd><dt class="muted">SHA-256</dt><dd>${esc(o.sha256)}</dd><dt class="muted">Formato</dt><dd>${esc(({ PLANTILLA_PROFESOR: "Plantilla ABC de referencia", EJEMPLO_APLICATIVO: "Ejemplo aplicativo de referencia", PC05_NORMALIZADO: "Formato normalizado" } as any)[o.formato] || o.formato)}</dd><dt class="muted">Importado</dt><dd>${fechaHora(o.importado_en)}</dd></dl>
          ${adv.length ? `<div class="alert warn"><b>${adv.length} advertencias de importación (no se inventaron datos):</b><ul style="margin:6px 0 0;padding-left:18px">${adv.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : `<div class="alert ok">Sin advertencias.</div>`}</section>`;
      }
    }
  } else if (sub === "comparacion") body = comparacionExcel(h);
  else if (sub === "diagrama") body = diagrama(h);
  return (
    h.title("Modelo de costeo", "Gestión de N modelos, versiones y comparación con el Excel de origen.") +
    h.subtabs("modelo", [
      { id: "gestion", label: "Gestión de modelos" },
      { id: "diagrama", label: "Diagrama conceptual 1–5" },
      { id: "comparacion", label: "Comparación con Excel de origen" },
    ]) +
    body
  );
}

function comparacionExcel(h: Host): string {
  if (!h.ctx) return "";
  const refs = h.s.all("SELECT * FROM referencia_excel WHERE version_id=? ORDER BY concepto, id", [h.ctx.versionId]);
  if (!refs.length) {
    const conRef = h.s.all("SELECT DISTINCT m.id, m.codigo, m.nombre FROM modelo m JOIN modelo_version mv ON mv.modelo_id=m.id JOIN referencia_excel r ON r.version_id=mv.id ORDER BY m.codigo");
    return `<section class="panel guia"><h3>¿Para qué sirve la comparación con el Excel de origen?</h3>
      <p class="lead">Verifica, celda por celda, que el motor del sistema reproduce las cifras de un libro Excel de costeo existente (plantilla ABC de referencia o ejemplo aplicativo). Para cada cifra muestra la celda del Excel, su fórmula, el valor del Excel, el valor del sistema y la diferencia; así se detectan los errores de fórmula del libro original sin copiarlos.</p>
      <div class="alert info">El modelo activo se cargó con el formato normalizado del sistema (o es la demostración): no tiene un libro Excel de costeo con resultados con el cual compararse. Su trazabilidad está en «Asignación → Conciliación», en «Explicar cálculo» y en el Excel de resultados.</div>
      <h3 style="font-size:15px;margin-top:14px">Cómo usarla</h3>
      <ol class="steps">
        <li>En «Gestión de modelos», pulsa <b>«Importar Excel de referencia (plantilla ABC)»</b> y elige el libro Excel (por ejemplo, la plantilla ABC o el ejemplo aplicativo).</li>
        <li>Ve a <b>9 «Asignación»</b> y pulsa <b>«Ejecutar costeo completo»</b>.</li>
        <li>Vuelve a esta subpestaña: verás cuántos valores coinciden (±0,01) y la lista de diferencias con su celda de origen.</li>
      </ol>
      ${conRef.length ? `<h3 style="font-size:15px;margin-top:14px">Modelos con comparación disponible</h3><div class="form-row">${conRef.map((m) => `<button class="btn" data-act="comp-abrir" data-id="${m.id}">Abrir ${esc(m.codigo)} · ${esc(m.nombre)}</button>`).join("")}</div>` : `<div class="form-row"><button class="btn primary" data-act="sub" data-key="modelo" data-sub="gestion">Ir a «Gestión de modelos» para importar un Excel de referencia</button></div>`}
    </section>`;
  }
  const R = h.abc();
  if (!R) return "";
  const acts = new Map(R.resumen.map((x) => [x.act.codigo, x]));
  const objs = new Map(R.objetos.map((o) => [o.obj.codigo, o]));
  const sistema = (r: any): number | null => {
    if (r.concepto === "P1 total CMD por actividad") return acts.get(r.clave)?.cmd ?? null;
    if (r.concepto === "P3 total CPD por actividad") return acts.get(r.clave)?.cpd ?? null;
    if (r.concepto === "P4b total CI por actividad") return acts.get(r.clave)?.ci ?? null;
    if (r.concepto === "Resumen total costo por actividad") return acts.get(r.clave)?.total ?? null;
    if (r.concepto === "P4c costo por objeto") return objs.get(r.clave)?.costo ?? null;
    if (r.concepto === "costo unitario material") {
      const m = R.unitMat.get(h.s.one("SELECT id FROM material WHERE version_id=? AND codigo=?", [h.ctx!.versionId, r.clave])?.id);
      return m ? m.costoUnit : null;
    }
    if (r.concepto === "tasa hora puesto") {
      const p = R.p3.find((x) => x.persona.codigo === r.clave);
      return p?.r.tasa ?? null;
    }
    if (r.concepto === "P4a importe EC→CA") {
      const [ec, ca] = String(r.clave).split("|");
      const eid = h.s.one("SELECT id FROM elemento_costo WHERE version_id=? AND codigo=?", [h.ctx!.versionId, ec])?.id;
      const cid = h.s.one("SELECT id FROM centro WHERE version_id=? AND codigo=?", [h.ctx!.versionId, ca])?.id;
      return R.ciCentro.get(eid)?.get(cid) ?? 0;
    }
    return null;
  };
  const filas = refs.map((r) => ({ r, sis: sistema(r) }));
  const difs = filas.filter((f) => f.r.valor !== null && f.sis !== null && Math.abs(f.r.valor - f.sis) > 0.01);
  return `<section class="panel"><h3>Comparación celda por celda: Excel de origen vs. motor del sistema</h3>
    <p class="lead">No se alteran distribuciones para reproducir el Excel. Cada diferencia se muestra con su celda de origen; las causas documentadas están en las advertencias de importación (Gestión de modelos → Trazabilidad de la importación).</p>
    <div class="alert ${difs.length ? "warn" : "ok"}">${filas.length} valores comparados · ${filas.length - difs.length} coinciden (±0,01) · ${difs.length} difieren.</div>
    <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Celda</th><th class="frz2">Concepto</th><th>Clave</th><th>Valor en Excel</th><th>Valor del sistema</th><th>Diferencia</th><th>Fórmula del Excel</th></tr></thead><tbody>
    ${filas
      .map(({ r, sis }) => {
        const d = r.valor !== null && sis !== null ? round2(sis - r.valor) : null;
        return `<tr><td class="frz1 mono">${esc(r.hoja)}!${esc(r.celda)}</td><td class="frz2">${esc(r.concepto)}</td><td class="mono">${esc(r.clave)}</td>
        <td class="num">${r.valor === null ? "error/vacío" : num(r.valor, r.concepto.includes("unitario") ? 6 : 2)}</td><td class="num derived">${sis === null ? "—" : num(sis, r.concepto.includes("unitario") ? 6 : 2)}</td>
        <td class="num${d !== null && Math.abs(d) > 0.01 ? " blocked" : ""}">${d === null ? "—" : num(d)}</td><td class="mono" style="max-width:340px;overflow:hidden;text-overflow:ellipsis">${esc(r.formula || "")}</td></tr>`;
      })
      .join("")}</tbody></table></div></section>`;
}

// Diagrama conceptual generado desde el modelo (SVG en columnas; cada caja crece según su texto)
function diagrama(h: Host): string {
  if (!h.ctx) return "";
  const R = h.abc();
  const c = h.ctx;
  const caP = h.s.all("SELECT * FROM centro WHERE version_id=? ORDER BY codigo", [c.versionId]);
  const acts = h.s.all("SELECT * FROM actividad WHERE version_id=? ORDER BY orden", [c.versionId]);
  const nEC = h.s.one("SELECT COUNT(*) n FROM elemento_costo WHERE version_id=?", [c.versionId])!.n;
  const inc = acts.filter((a) => a.alcance !== "EXCLUIDA").length;
  const exc = acts.length - inc;
  const nOC = h.s.one("SELECT COUNT(*) n FROM objeto_costo WHERE version_id=?", [c.versionId])!.n;
  const tot = (k: "cmd" | "csd" | "cpd" | "ci") => (R ? R.resumen.reduce((s, x) => s + x[k], 0) : null);
  const ecTot = R ? R.p4a.reduce((s, g) => s + g.pool, 0) : null;
  const objTot = R ? R.objetos.reduce((s, o) => s + o.costo, 0) : null;
  const m = (v: number | null) => (v === null ? "" : money(v));
  // ---- texto: partir en líneas según el ancho de la caja (ancho medio de carácter de Segoe UI) ----
  const PX1 = 7.7, PX2 = 6.7, LH1 = 17, LH2 = 15, PAD = 12;
  const wrap = (t: string, w: number, px: number) => {
    const max = Math.max(6, Math.floor((w - 2 * PAD) / px));
    const out: string[] = [];
    let cur = "";
    for (const word of String(t).split(/\s+/)) {
      if (!cur) cur = word;
      else if ((cur + " " + word).length <= max) cur += " " + word;
      else { out.push(cur); cur = word; }
      while (cur.length > max) { out.push(cur.slice(0, max - 1) + "-"); cur = cur.slice(max - 1); }
    }
    if (cur) out.push(cur);
    return out;
  };
  type Caja = { x: number; y: number; w: number; h: number; svg: string };
  const caja = (x: number, y: number, w: number, t1: string, t2: string, cls: string, minH = 0): Caja => {
    const l1 = wrap(t1, w, PX1), l2 = t2 ? wrap(t2, w, PX2) : [];
    const hh = Math.max(minH, PAD * 2 + l1.length * LH1 + l2.length * LH2);
    const y0 = y + (hh - (l1.length * LH1 + l2.length * LH2)) / 2 + 13;
    const tx = l1.map((l, k) => `<tspan x="${x + w / 2}" y="${y0 + k * LH1}">${esc(l)}</tspan>`).join("") ;
    const tx2 = l2.map((l, k) => `<tspan x="${x + w / 2}" y="${y0 + l1.length * LH1 + k * LH2}">${esc(l)}</tspan>`).join("");
    return { x, y, w, h: hh, svg: `<g><rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="10" class="${cls}"/><text text-anchor="middle" class="dt1">${tx}</text>${l2.length ? `<text text-anchor="middle" class="dt2">${tx2}</text>` : ""}</g>` };
  };
  const ar = (d: string, cls = "darr") => `<path d="${d}" class="${cls}" marker-end="url(#dm)"/>`;
  const ln = (d: string, cls = "darr") => `<path d="${d}" class="${cls}"/>`;
  const lbl = (x: number, y: number, t: string) => `<g><circle cx="${x}" cy="${y}" r="13" class="dlab"/><text x="${x}" y="${y + 4}" text-anchor="middle" class="dlabt">${t}</text></g>`;
  // ---- columnas ----
  const X_EC = 20, W_EC = 210;
  const X_CA = 330, W_CA = 380;
  const X_AC = 840, W_AC = 260;
  const X_OC = 1190, W_OC = 200;
  const X_TD = 1470, W_TD = 160;
  const W = X_TD + W_TD + 20;
  const TOP = 150; // espacio para las rutas 1–3
  // centros: todos, en una columna
  let y = TOP;
  const cas = caP.map((ca) => {
    const v = R ? round2(Array.from(R.ciCentro.values()).reduce((s, mm) => s + (mm.get(ca.id) || 0), 0)) : null;
    const pref = ca.participacion === "PARTICIPA" ? "" : ca.participacion === "PARCIAL" ? `participa ${Math.round((ca.pct_participacion || 0) * 100)} % · ` : "fuera de la cadena · ";
    const b = caja(X_CA, y, W_CA, `${ca.codigo} ${ca.nombre}`, pref + m(v), ca.participacion === "PARTICIPA" ? "dca" : ca.participacion === "PARCIAL" ? "dcapar" : "dcaoff");
    y += b.h + 8;
    return { ca, b };
  });
  const yFinCA = y - 8;
  const midCA = (TOP + yFinCA) / 2;
  const ec = caja(X_EC, 0, W_EC, `Elementos de costo indirecto (${nEC})`, m(ecTot), "dec", 70);
  ec.y = midCA - ec.h / 2; Object.assign(ec, caja(X_EC, ec.y, W_EC, `Elementos de costo indirecto (${nEC})`, m(ecTot), "dec", 70));
  const acH = Math.max(160, Math.min(320, (yFinCA - TOP) * 0.5));
  const ac = caja(X_AC, Math.max(TOP, midCA - acH / 2 - 60), W_AC, `Actividades de la cadena (${inc})`, R ? m(R.resumen.filter((x) => x.act.alcance !== "EXCLUIDA").reduce((s, x) => s + x.total, 0)) : "", "dac", acH);
  const oa = caja(X_AC, ac.y + ac.h + 70, W_AC, `Otras actividades, fuera de la cadena (${exc})`, R ? m(R.resumen.filter((x) => x.act.alcance === "EXCLUIDA").reduce((s, x) => s + x.total, 0)) : "", "doa", 60);
  const oc = caja(X_OC, 0, W_OC, `Objetos de costo (${nOC})`, m(objTot), "doc", 80);
  Object.assign(oc, caja(X_OC, ac.y + ac.h / 2 - oc.h / 2, W_OC, `Objetos de costo (${nOC})`, m(objTot), "doc", 80));
  const td = caja(X_TD, oc.y + oc.h / 2 - 40, W_TD, "5 Toma de decisiones", "analítica · simulación · EVA", "dtd", 80);
  const d1 = caja(X_AC - 330, 20, 220, "1 Material directo", m(tot("cmd")), "dd", 60);
  const d2 = caja(X_AC + 20, 20, 220, "2 Servicio directo", m(tot("csd")), "dd", 60);
  const d3 = caja(X_AC + 330, 20, 220, "3 Personal directo", m(tot("cpd")), "dd", 60);
  const hTot = Math.max(yFinCA, oa.y + oa.h, td.y + td.h) + 30;
  // ---- flechas ----
  const busEC = X_EC + W_EC + 50; // bus vertical entre EC y centros (deja 50 px para ver cada punta)
  const yEC = ec.y + ec.h / 2;
  const fl: string[] = [];
  fl.push(ln(`M${X_EC + W_EC} ${yEC} H${busEC}`));
  fl.push(ln(`M${busEC} ${cas[0] ? cas[0].b.y + cas[0].b.h / 2 : yEC} V${cas.length ? cas[cas.length - 1].b.y + cas[cas.length - 1].b.h / 2 : yEC}`));
  for (const { b } of cas) fl.push(ar(`M${busEC} ${b.y + b.h / 2} H${X_CA - 2}`));
  const busCA = X_CA + W_CA + 45;
  const part = cas.filter((x) => x.ca.participacion !== "NO_PARTICIPA");
  for (const { b } of part) fl.push(ln(`M${X_CA + W_CA} ${b.y + b.h / 2} H${busCA}`));
  if (part.length) {
    const yA = Math.min(part[0].b.y + part[0].b.h / 2, ac.y + ac.h / 2), yB = Math.max(part[part.length - 1].b.y + part[part.length - 1].b.h / 2, oa.y + oa.h / 2);
    fl.push(ln(`M${busCA} ${yA} V${yB}`));
    fl.push(ar(`M${busCA} ${ac.y + ac.h / 2} H${X_AC - 2}`));
    fl.push(ar(`M${busCA} ${oa.y + oa.h / 2} H${X_AC - 2}`, "darr dash"));
  }
  fl.push(ar(`M${d1.x + d1.w / 2} ${d1.y + d1.h} V${d1.y + d1.h + 25} H${X_AC + 50} V${ac.y - 2}`));
  fl.push(ar(`M${d2.x + d2.w / 2} ${d2.y + d2.h} V${ac.y - 2}`));
  fl.push(ar(`M${d3.x + d3.w / 2} ${d3.y + d3.h} V${d3.y + d3.h + 25} H${X_AC + W_AC - 50} V${ac.y - 2}`));
  fl.push(ar(`M${X_AC + W_AC} ${ac.y + ac.h / 2} H${X_OC - 2}`));
  fl.push(ar(`M${X_OC + W_OC} ${oc.y + oc.h / 2} H${X_TD - 2}`));
  const etiquetas = [lbl(busEC, yEC - 26, "4a"), lbl(busCA, ac.y + ac.h / 2 - 26, "4b"), lbl((X_AC + W_AC + X_OC) / 2, ac.y + ac.h / 2 - 22, "4c"), lbl((X_OC + W_OC + X_TD) / 2, oc.y + oc.h / 2 - 22, "5")];
  return `<section class="panel"><h3>Diagrama conceptual del modelo activo (rutas 1–5)</h3>
    <p class="lead">Generado desde las entidades del modelo (${caP.length} centros, ${acts.length} actividades, ${nOC} objetos de costo, ${nEC} elementos de costo indirecto); no es una imagen fija. Importes de la corrida del período activo.</p>
    <div style="overflow:auto;border:1px solid var(--border);border-radius:10px;background:#fff">
    <svg viewBox="0 0 ${W} ${hTot}" style="width:100%;min-width:1100px;height:auto;display:block" role="img" aria-label="Modelo conceptual de costeo">
    <defs><marker id="dm" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#475569"/></marker></defs>
    <style>.dd{fill:#E8F2FE;stroke:#3682F6}.dca{fill:#FFF1E6;stroke:#D97706}.dcapar{fill:#FFF7ED;stroke:#D97706;stroke-dasharray:6 3}.dcaoff{fill:#F3F4F6;stroke:#9CA3AF;stroke-dasharray:4 3}.dac{fill:#FFFBE6;stroke:#CA8A04}.doc{fill:#E7F7EE;stroke:#16A34A}.dtd{fill:#FDECEC;stroke:#DC2626}.dec{fill:#EEEBFB;stroke:#6554C8}.doa{fill:#F1F5E9;stroke:#65A30D}
    rect{stroke-width:1.4}.dt1{font:600 13px Segoe UI,sans-serif;fill:#1D2E50}.dt2{font:12px Segoe UI,sans-serif;fill:#5B6B88}.darr{fill:none;stroke:#475569;stroke-width:1.6}.darr.dash{stroke-dasharray:5 4}.dlab{fill:#6554C8}.dlabt{font:700 11px Segoe UI,sans-serif;fill:#fff}</style>
    ${fl.join("")}
    ${d1.svg}${d2.svg}${d3.svg}${ec.svg}${cas.map((x) => x.b.svg).join("")}${ac.svg}${oa.svg}${oc.svg}${td.svg}
    ${etiquetas.join("")}
    </svg></div>
    <div class="legend"><span>Rutas: 1 material, 2 servicio y 3 personal directo → actividades; 4a elementos de costo indirecto → cada centro; 4b centros que participan → actividades de la cadena (línea continua) y otras actividades (línea discontinua); 4c actividades → objetos de costo; 5 objetos → decisiones. Borde discontinuo naranja: centro con participación parcial; borde gris punteado: centro fuera de la cadena (su costo se informa aparte).</span></div></section>`;
}

// ======================= 5 · Estructuras =======================
export function pEstructuras(h: Host): string {
  const c = h.ctx!;
  const R = h.abc();
  const cs = h.s.all("SELECT c.*, (SELECT COUNT(*) FROM actividad a WHERE a.centro_id=c.id) n_act FROM centro c WHERE version_id=? ORDER BY codigo", [c.versionId]);
  const ps = h.s.all("SELECT pu.*, (SELECT COUNT(*) FROM persona_puesto pp WHERE pp.puesto_id=pu.id AND pp.hasta IS NULL) n FROM puesto pu WHERE version_id=? ORDER BY codigo", [c.versionId]);
  const ciDe = (id: string) => (R ? round2(Array.from(R.ciCentro.values()).reduce((s, m) => s + (m.get(id) || 0), 0)) : null);
  return (
    h.title("Estructuras", "Centros de actividad (N), su participación en la cadena y puestos de trabajo.") +
    `<section class="panel"><h3>Centros de actividad</h3><p class="lead">Participa: su costo indirecto continúa a P4b. No participa: se informa por separado. Parcial: solo el % indicado continúa; el resto queda fuera de alcance. Todo cambio queda en auditoría.</p>
    <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Centro de actividad</th><th>Participación en la cadena</th><th>% participación (parcial)</th><th>Actividades</th><th>Costo indirecto recibido (P4a) S/</th><th>Nota / fuente</th></tr></thead><tbody>
    ${cs
      .map(
        (x) => `<tr><td class="frz1 mono">${esc(x.codigo)}</td><td class="frz2">${esc(x.nombre)}</td>
      <td><select data-edit="m2-centro-part" data-id="${x.id}">${["PARTICIPA", "NO_PARTICIPA", "PARCIAL"].map((o) => `<option ${x.participacion === o ? "selected" : ""}>${o}</option>`).join("")}</select></td>
      <td>${x.participacion === "PARCIAL" ? `<input data-key="cp-${x.id}" data-edit="m2-centro-pct" data-id="${x.id}" value="${x.pct_participacion === null ? "" : num(x.pct_participacion * 100)}" placeholder="%">` : "—"}</td>
      <td class="num">${x.n_act}</td><td class="num derived">${ciDe(x.id) === null ? "—" : money(ciDe(x.id))}</td><td class="muted" style="white-space:normal;min-width:260px">${esc(x.nota || "")}</td></tr>`,
      )
      .join("")}</tbody></table></div></section>
    <section class="panel"><h3>Puestos de trabajo</h3><p class="lead">Un puesto puede tener varias personas, cada una con su propio costo y horas (ver Personas).</p>
    <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Puesto</th><th>Tipo</th><th>Personas asignadas</th></tr></thead><tbody>
    ${ps.map((p) => `<tr><td class="frz1 mono">${esc(p.codigo)}</td><td class="frz2">${esc(p.nombre)}</td><td>${esc(p.tipo)}</td><td class="num">${p.n}</td></tr>`).join("")}</tbody></table></div></section>`
  );
}

// ======================= 3 · Procesos (ASME) =======================
export function pProcesos(h: Host): string {
  const c = h.ctx!;
  const acts = h.s.all(
    `SELECT a.*, ce.codigo ca, ce.nombre ca_nombre,
      (SELECT COALESCE(SUM(horas),0) FROM imputacion_horas ih WHERE ih.actividad_id=a.id AND ih.periodo_id=?) horas,
      (SELECT COUNT(DISTINCT persona_id) FROM imputacion_horas ih WHERE ih.actividad_id=a.id AND ih.periodo_id=?) n_pers,
      (SELECT COUNT(*) FROM consumo_material cm WHERE cm.actividad_id=a.id AND cm.periodo_id=?) n_mat,
      (SELECT COUNT(*) FROM servicio_directo sd WHERE sd.actividad_id=a.id AND sd.periodo_id=?) n_srv
     FROM actividad a JOIN centro ce ON ce.id=a.centro_id WHERE a.version_id=? ORDER BY a.orden, a.codigo`,
    [c.periodoId, c.periodoId, c.periodoId, c.periodoId, c.versionId],
  );
  const tot = acts.reduce((s, a) => s + a.horas, 0);
  const cls = (k: string) => acts.filter((a) => a.clase_valor === k).reduce((s, a) => s + a.horas, 0);
  return (
    h.title("Procesos", "Matriz ASME normalizada: actividades, centro, tiempo efectivo, recursos y clasificación. Las «X» del Excel se guardan como relaciones.") +
    `<section class="panel"><h3>Matriz ASME de actividades</h3>
    <p class="lead">Alcance y clasificación AV/NAVN/NAVI son independientes. Tiempo efectivo = Σ horas imputadas por las personas en el período.</p>
    <div class="magnitudes"><div class="mag"><div class="t">Tiempo total</div><div class="v">${num(tot)} h</div><div class="d">Σ horas imputadas</div></div>
      <div class="mag"><div class="t">Agrega valor (AV)</div><div class="v">${pct(tot ? cls("AV") / tot : null)}</div><div class="d">${num(cls("AV"))} h</div></div>
      <div class="mag"><div class="t">No agrega, necesaria (NAVN)</div><div class="v">${pct(tot ? cls("NAVN") / tot : null)}</div><div class="d">${num(cls("NAVN"))} h</div></div>
      <div class="mag"><div class="t">No agrega, innecesaria (NAVI)</div><div class="v">${pct(tot ? cls("NAVI") / tot : null)}</div><div class="d">${num(cls("NAVI"))} h · potencial de ahorro</div></div></div>
    <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Actividad</th><th>Centro</th><th>Alcance en la cadena</th><th>% incluido (parcial)</th><th>Clase</th><th>Tiempo efectivo h</th><th>Personas</th><th>Materiales</th><th>Servicios directos</th><th>Nota / fuente</th></tr></thead><tbody>
    ${acts
      .map(
        (a) => `<tr><td class="frz1 mono">${esc(a.codigo)}</td><td class="frz2">${esc(a.nombre)}</td><td>${esc(a.ca)} ${esc(a.ca_nombre)}</td>
      <td><select data-edit="m2-act-alc" data-id="${a.id}">${["INCLUIDA", "EXCLUIDA", "PARCIAL"].map((o) => `<option ${a.alcance === o ? "selected" : ""}>${o}</option>`).join("")}</select></td>
      <td>${a.alcance === "PARCIAL" ? `<input data-key="ap-${a.id}" data-edit="m2-act-pct" data-id="${a.id}" value="${a.pct_alcance === null ? "" : num(a.pct_alcance * 100)}" placeholder="%">` : "—"}</td>
      <td><select data-edit="m2-act-clase" data-id="${a.id}"><option value="">—</option>${["AV", "NAVN", "NAVI"].map((o) => `<option ${a.clase_valor === o ? "selected" : ""}>${o}</option>`).join("")}</select></td>
      <td class="num derived">${num(a.horas)}</td><td class="num">${a.n_pers}</td><td class="num">${a.n_mat}</td><td class="num">${a.n_srv}</td><td class="muted" style="white-space:normal;min-width:260px">${esc(a.nota || "")}</td></tr>`,
      )
      .join("")}</tbody></table></div></section>`
  );
}

// ======================= 6 · Recursos =======================
export function pRecursos(h: Host): string {
  const c = h.ctx!;
  const sub = h.st.sub.recursos || "materiales";
  const igv = h.s.one("SELECT igv_tasa FROM empresa WHERE id=?", [c.empresaId])!.igv_tasa;
  let body = "";
  if (sub === "materiales") {
    const ms = h.s.all("SELECT m.*, mp.costo_factura precio_periodo FROM material m LEFT JOIN material_precio mp ON mp.material_id=m.id AND mp.periodo_id=? WHERE version_id=? ORDER BY codigo", [c.periodoId, c.versionId]);
    body = `<section class="panel"><h3>Materiales directos</h3><p class="lead">Costo unitario = costo factura (sin IGV recuperable) ÷ (cantidad facturada × equivalencia). IGV ${num(igv * 100)} % (editable en Datos Maestros).</p>
    <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Material</th><th>Unidad factura</th><th>Costo factura S/</th><th>Cantidad facturada</th><th>Equivalencia (unid. consumo por unid. factura)</th><th>Unidad consumo</th><th>¿Precio incluye IGV?</th><th>¿IGV recuperable?</th><th>¿Tratamiento validado?</th><th>IGV excluido S/</th><th>Costo unitario S/</th><th>Fuente</th></tr></thead><tbody>
    ${ms
      .map((m) => {
        const u = costoUnitarioMaterial({ id: m.id, codigo: m.codigo, nombre: m.nombre, unidad: m.unidad_consumo, costoFactura: m.precio_periodo ?? m.costo_factura, cantidadFactura: m.cantidad_factura, equivalencia: m.equivalencia, incluyeIgv: !!m.incluye_igv, igvRecuperable: !!m.igv_recuperable, tratamientoValidado: !!m.tratamiento_validado }, igv);
        const sel = (f: string, v: number) => `<select data-edit="m2-mat-flag" data-id="${m.id}" data-f="${f}"><option value="1" ${v ? "selected" : ""}>Sí</option><option value="0" ${!v ? "selected" : ""}>No</option></select>`;
        return `<tr><td class="frz1 mono">${esc(m.codigo)}</td><td class="frz2">${esc(m.nombre)}</td><td>${esc(m.unidad_factura || "")}</td>
        <td><input data-key="mf-${m.id}" data-edit="m2-mat-num" data-id="${m.id}" data-f="costo_factura" value="${num(m.costo_factura)}"></td>
        <td><input data-key="mc-${m.id}" data-edit="m2-mat-num" data-id="${m.id}" data-f="cantidad_factura" value="${num(m.cantidad_factura)}"></td>
        <td><input data-key="me-${m.id}" data-edit="m2-mat-num" data-id="${m.id}" data-f="equivalencia" value="${num(m.equivalencia, 2)}" title="${esc(m.equivalencia_texto || "")}"></td>
        <td>${esc(m.unidad_consumo)}</td><td>${sel("incluye_igv", m.incluye_igv)}</td><td>${sel("igv_recuperable", m.igv_recuperable)}</td><td>${sel("tratamiento_validado", m.tratamiento_validado)}</td>
        <td class="num derived">${m.incluye_igv && m.igv_recuperable ? money(u.impuesto) : "—"}</td>
        <td class="num derived ${u.pendiente ? "" : ""}" title="${esc(u.formula)}">${num(u.costoUnit, 6)}${u.pendiente ? '<br><span class="pill warn">Tributario pendiente</span>' : ""}</td>
        <td class="mono muted">${esc(m.fuente || "")}</td></tr>`;
      })
      .join("")}</tbody></table></div></section>`;
  } else if (sub === "indirectos") {
    const es = h.s.all("SELECT e.*, em.monto, em.fuente mfuente FROM elemento_costo e LEFT JOIN ec_monto em ON em.ec_id=e.id AND em.periodo_id=? WHERE e.version_id=? ORDER BY e.codigo", [c.periodoId, c.versionId]);
    const tot = es.reduce((s, e) => s + (e.monto || 0), 0);
    body = `<section class="panel"><h3>Elementos de costo indirecto del período · análisis de relevancia</h3><p class="lead">Relevante = participación > 10 % (criterio de la plantilla de referencia). El monto alimenta P4a.</p>
    <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Elemento de costo indirecto</th><th>Monto del período S/</th><th>Participación</th><th>Relevante (>10 %)</th><th>Fuente</th></tr></thead><tbody>
    ${es
      .map(
        (e) => `<tr><td class="frz1 mono">${esc(e.codigo)}</td><td class="frz2">${esc(e.nombre)}</td>
      <td><input data-key="ec-${e.id}" data-edit="m2-ec-monto" data-id="${e.id}" value="${num(e.monto || 0)}"></td><td class="num derived">${pct(tot ? (e.monto || 0) / tot : null)}</td>
      <td>${tot && (e.monto || 0) / tot > 0.1 ? '<span class="pill warn">Relevante</span>' : ""}</td><td class="mono muted">${esc(e.mfuente || "")}</td></tr>`,
      )
      .join("")}<tr class="total"><td class="frz1"></td><td class="frz2">Total</td><td class="num">${money(tot)}</td><td class="num">${pct(tot ? 1 : null)}</td><td colspan="2"></td></tr></tbody></table></div></section>`;
  } else {
    const ss = h.s.all("SELECT sd.*, a.codigo act, a.nombre act_nombre FROM servicio_directo sd JOIN actividad a ON a.id=sd.actividad_id WHERE sd.version_id=? AND sd.periodo_id=? ORDER BY a.orden", [c.versionId, c.periodoId]);
    const acts = h.s.all("SELECT id, codigo, nombre FROM actividad WHERE version_id=? ORDER BY orden", [c.versionId]);
    body = `<section class="panel"><h3>Servicios directos (P2)</h3><p class="lead">Solo servicios atribuibles de forma verificable a una actividad. Los compartidos (internet, teléfono, energía) son indirectos y van a P4a; un mismo gasto no puede estar en ambos.</p>
    <div class="form-row"><label>Actividad<select id="sd-act">${acts.map((a) => `<option value="${a.id}">${esc(a.codigo)} · ${esc(a.nombre)}</option>`).join("")}</select></label>
      <label>Proveedor<input id="sd-prov"></label><label>Servicio<input id="sd-serv"></label><label>Cantidad<input id="sd-cant" value="1,00"></label><label>Unidad<input id="sd-uni" value="servicio"></label><label>Tarifa S/<input id="sd-tar"></label><label>Documento<input id="sd-doc" placeholder="Factura / OS"></label>
      <button class="btn primary" data-act="m2-srv-add">Agregar servicio</button></div>
    ${ss.length ? "" : '<div class="alert info">P2 «No aplica» en este período: no hay servicios directos registrados (importe cero, no bloquea el cálculo).</div>'}
    <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Actividad</th><th class="frz2">Servicio directo</th><th>Proveedor</th><th>Cantidad</th><th>Unidad</th><th>Tarifa S/</th><th>Costo directo S/</th><th>Documento</th><th></th></tr></thead><tbody>
    ${ss.map((x) => `<tr><td class="frz1 mono">${esc(x.act)}</td><td class="frz2">${esc(x.servicio)}</td><td>${esc(x.proveedor || "")}</td><td class="num">${num(x.cantidad)}</td><td>${esc(x.unidad || "")}</td><td class="num">${money(x.tarifa)}</td><td class="num derived">${money(round2(x.cantidad * x.tarifa))}</td><td>${esc(x.documento || "")}</td><td><button class="btn small danger" data-act="m2-srv-del" data-id="${x.id}">Eliminar</button></td></tr>`).join("")}
    </tbody></table></div></section>`;
  }
  return (
    h.title("Recursos", "Materiales directos, servicios directos y elementos de costo indirecto del período.") +
    h.subtabs("recursos", [
      { id: "materiales", label: "Materiales directos" },
      { id: "servicios", label: "Servicios directos (P2)" },
      { id: "indirectos", label: "Elementos de costo indirecto" },
    ]) +
    body
  );
}

// ======================= 2 · Datos maestros =======================
export function pMaestros(h: Host): string {
  const c = h.ctx!;
  const e = h.s.one("SELECT * FROM empresa WHERE id=?", [c.empresaId])!;
  const os = h.s.all("SELECT o.*, om.cantidad FROM objeto_costo o LEFT JOIN objeto_magnitud om ON om.objeto_id=o.id AND om.periodo_id=? WHERE o.version_id=? ORDER BY codigo", [c.periodoId, c.versionId]);
  const ps = MOD.periodosEmpresa(h.s, c.empresaId);
  return (
    h.title("Datos maestros", "Empresa, períodos, parámetros y objetos de costo (separados de los indicadores).") +
    `<div class="grid g2"><section class="panel"><h3>Empresa y parámetros</h3>
      <dl style="display:grid;grid-template-columns:170px 1fr;gap:8px 10px;margin:0"><dt class="muted">Empresa</dt><dd>${esc(e.nombre)}</dd><dt class="muted">Moneda</dt><dd>${esc(e.moneda)}</dd>
      <dt class="muted">Tasa de IGV</dt><dd><input data-key="igv" data-edit="m2-igv" value="${num(e.igv_tasa * 100)}" style="width:90px;height:30px;border:1px solid var(--input-border);border-radius:6px;padding:0 8px;text-align:right"> % · referencia Perú 2026: 18 %</dd>
      <dt class="muted">Datos</dt><dd>${e.sintetico ? '<span class="pill warn">Sintéticos</span>' : "Según archivo de origen"}</dd></dl></section>
    <section class="panel"><h3>Períodos</h3><div class="matrix-wrap" style="max-height:220px"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Período</th><th>Estado</th></tr></thead><tbody>
      ${ps.map((p) => `<tr><td class="frz1 mono">${esc(p.codigo)}</td><td class="frz2">${esc(p.nombre)}${p.id === c.periodoId ? ' <span class="pill ok">Activo</span>' : ""}</td><td>${esc(p.estado)}</td></tr>`).join("")}</tbody></table></div></section></div>
    <section class="panel"><h3>Objetos de costo</h3><p class="lead">Cantidad = magnitud del período para el costo unitario. Los marcados «revisión» conservan su tratamiento del Excel original hasta tu aprobación.</p>
    <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Objeto de costo</th><th>Magnitud</th><th>Cantidad del período</th><th>Clase</th><th>Nota</th></tr></thead><tbody>
    ${os
      .map(
        (o) => `<tr><td class="frz1 mono">${esc(o.codigo)}</td><td class="frz2">${esc(o.nombre)}</td><td>${esc(o.magnitud || "")}</td>
      <td><input data-key="om-${o.id}" data-edit="m2-obj-cant" data-id="${o.id}" value="${o.cantidad === null ? "" : num(o.cantidad)}" placeholder="sin dato"></td>
      <td>${o.clase === "OBJETO" ? "Objeto" : o.clase === "OBJETO_REVISION" ? '<span class="pill warn">Objeto · revisión KPI</span>' : '<span class="pill calc">KPI</span>'}</td><td class="muted" style="white-space:normal;min-width:260px">${esc(o.nota || "")}</td></tr>`,
      )
      .join("")}</tbody></table></div></section>`
  );
}

// ======================= 8 · Inductores (catálogo + laboratorio de reglas) =======================
export function pInductoresCatalogo(h: Host): string {
  const c = h.ctx!;
  const R = h.abc();
  const nm = mapNombre(h.s, c);
  const rs = h.s.all("SELECT r.*, (SELECT COUNT(*) FROM valor_base vb WHERE vb.regla_id=r.id AND vb.periodo_id=?) nb FROM regla_reparto r WHERE r.version_id=? ORDER BY CASE nivel WHEN 'EC_CA' THEN 1 WHEN 'CA_AC' THEN 2 ELSE 3 END, codigo", [c.periodoId, c.versionId]);
  const est = (r: any): RepartoReg | undefined => (R ? [...R.p4a, ...R.p4b, ...R.p4c].find((g) => g.regla?.id === r.id) : undefined);
  return `<section class="panel"><h3>Catálogo de inductores y reglas de reparto</h3>
    <p class="lead">Cada regla dice qué costo (origen) se reparte, entre qué destinos y con qué inductor. Clic en una fila para ver su laboratorio paso a paso. Cambiar el tipo de base exige justificación.</p>
    <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Nivel</th><th class="frz2">Origen → destinos</th><th>Inductor</th><th>Unidad</th><th>Tipo de base</th><th>Valores en el período</th><th>Pool S/</th><th>Denominador</th><th>Tasa</th><th>Saldo S/</th><th>Estado</th><th>Fuente</th></tr></thead><tbody>
    ${rs
      .map((r) => {
        const g = est(r);
        const o = nm.get(r.origen_id);
        const ce = r.centro_id ? nm.get(r.centro_id) : null;
        const dest = r.nivel === "EC_CA" ? "centros" : r.nivel === "CA_AC" ? `actividades de ${ce?.codigo}` : "objetos de costo";
        return `<tr class="clickable-row"><td class="frz1 mono">${r.nivel === "EC_CA" ? "4a" : r.nivel === "CA_AC" ? "4b" : "4c"}</td>
        <td class="frz2 clickable" data-act="m2-lab" data-id="${r.id}">${esc(o?.codigo)} ${esc(o?.nombre)} → ${dest}</td><td>${esc(r.inductor)}</td><td>${esc(r.unidad || "")}</td><td class="mono">${esc(r.tipo_base)}</td><td class="num">${r.nb}</td>
        <td class="num">${g ? money(g.pool) : "—"}</td><td class="num">${g?.r?.denominador == null ? "—" : num(g.r.denominador, 4)}</td><td class="num">${g?.r?.tasa == null ? "—" : num(g.r.tasa, 6)}</td>
        <td class="num${g?.r && g.r.saldo > 0.005 ? " blocked" : ""}">${g?.r ? money(g.r.saldo) : "—"}</td><td>${g?.r ? pillEstado(g.r.estado) : g ? '<span class="pill none">Sin costo</span>' : '<span class="pill none">Sin costo en el período</span>'}</td><td class="mono muted">${esc(r.fuente || "")}</td></tr>`;
      })
      .join("")}</tbody></table></div></section>`;
}

export function labRegla(h: Host, reglaId: string): string {
  const c = h.ctx!;
  const R = h.abc();
  const nm = mapNombre(h.s, c);
  const r = h.s.one("SELECT * FROM regla_reparto WHERE id=?", [reglaId]);
  if (!r) return "";
  const g = R ? [...R.p4a, ...R.p4b, ...R.p4c].find((x) => x.regla?.id === r.id) : undefined;
  const destinos =
    r.nivel === "EC_CA" ? h.s.all("SELECT id, codigo, nombre FROM centro WHERE version_id=? ORDER BY codigo", [c.versionId])
      : r.nivel === "CA_AC" ? h.s.all("SELECT id, codigo, nombre FROM actividad WHERE version_id=? AND centro_id=? ORDER BY orden", [c.versionId, r.centro_id])
      : h.s.all("SELECT id, codigo, nombre FROM objeto_costo WHERE version_id=? ORDER BY codigo", [c.versionId]);
  const vb = new Map(h.s.all("SELECT * FROM valor_base WHERE regla_id=? AND periodo_id=?", [r.id, c.periodoId]).map((v) => [v.destino_id, v]));
  const o = nm.get(r.origen_id);
  const res = g?.r;
  const todas = h.s.all("SELECT id, codigo, nivel, origen_id, centro_id, inductor FROM regla_reparto WHERE version_id=? ORDER BY CASE nivel WHEN 'EC_CA' THEN 1 WHEN 'CA_AC' THEN 2 ELSE 3 END, codigo", [c.versionId]);
  const grupo = (nv: string, t: string) => `<optgroup label="${t}">${todas.filter((x) => x.nivel === nv).map((x) => `<option value="${x.id}" ${x.id === r.id ? "selected" : ""}>${esc(nm.get(x.origen_id)?.codigo || "")} ${esc(nm.get(x.origen_id)?.nombre || "")}${x.nivel === "CA_AC" ? " · en " + esc(nm.get(x.centro_id)?.codigo || "") : ""} — ${esc(x.inductor || "")}</option>`).join("")}</optgroup>`;
  const guia = `<section class="panel guia"><h3>Cómo usar el laboratorio</h3>
    <ol class="steps">
      <li><b>Elige la regla</b> en «Regla a revisar»: cada regla reparte un costo (elemento indirecto, centro o actividad) entre sus destinos con un inductor. También puedes llegar aquí desde el «Catálogo de inductores» haciendo clic en una regla.</li>
      <li><b>Lee las cuatro magnitudes</b>: el inductor (qué causa el consumo), la cantidad total o denominador, la tasa (costo ÷ denominador) y el costo aplicado. Son magnitudes distintas.</li>
      <li><b>Prueba un cambio</b>: modifica el valor del inductor de un destino, su estado (REAL, ESTIMADO, AJUSTADO, PENDIENTE) o su fuente. La tabla y el cálculo paso a paso se actualizan al instante; la corrida guardada queda «Desactualizada» hasta que vuelvas a ejecutar el costeo en «Asignación».</li>
      <li><b>Comprueba el resultado</b> en «Cálculo paso a paso» (al final): pool, denominador, tasa, importes y saldo no asignado.</li>
    </ol>
    <div class="form-row"><label style="flex:1 1 640px">Regla a revisar<select data-edit="lab-regla" style="width:100%">${grupo("EC_CA", "4a · Elementos de costo indirecto → centros")}${grupo("CA_AC", "4b · Centros → actividades")}${grupo("AC_OC", "4c · Actividades → objetos de costo")}</select></label>
      <span class="muted">Período: ${esc(h.s.one("SELECT nombre FROM periodo WHERE id=?", [c.periodoId])?.nombre || "")} (cámbialo en la barra gris)</span></div></section>`;
  return `${guia}<section class="panel"><h3>Laboratorio · ${esc(o?.codigo)} ${esc(o?.nombre)} → ${r.nivel === "EC_CA" ? "centros (4a)" : r.nivel === "CA_AC" ? "actividades de " + esc(nm.get(r.centro_id)?.codigo) + " (4b)" : "objetos (4c)"}</h3>
    <div class="form-row"><label>Inductor<input data-key="ri-${r.id}" data-edit="m2-regla-ind" data-id="${r.id}" value="${esc(r.inductor)}"></label><label>Unidad<input data-key="ru-${r.id}" data-edit="m2-regla-uni" data-id="${r.id}" value="${esc(r.unidad || "")}"></label>
      <label>Tipo de base<select data-edit="m2-regla-tipo" data-id="${r.id}">${TIPOS.map((t) => `<option ${t === r.tipo_base ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Justificación del cambio de tipo<input id="rj-${r.id}" placeholder="Obligatoria para cambiar el tipo" style="min-width:320px"></label>${res ? pillEstado(res.estado) : ""}</div>
    <div class="magnitudes"><div class="mag"><div class="t">Inductor</div><div class="v" style="font-size:15px">${esc(r.inductor)}</div><div class="d">unidad: ${esc(r.unidad || "—")} · tipo ${esc(r.tipo_base)}</div></div>
      <div class="mag"><div class="t">Cantidad total (denominador)</div><div class="v">${res?.denominador == null ? "—" : num(res.denominador, 4)}</div><div class="d">Σ valores válidos</div></div>
      <div class="mag"><div class="t">Tasa de asignación</div><div class="v">${res?.tasa == null ? "—" : num(res.tasa, 6)}</div><div class="d">${esc(res?.unidadTasa || "")}</div></div>
      <div class="mag"><div class="t">Costo aplicado</div><div class="v">${res ? money(res.asignado) : "—"}</div><div class="d">Pool ${g ? money(g.pool) : "—"} · saldo ${res ? money(res.saldo) : "—"}</div></div></div>
    ${res?.mensajes.length ? `<div class="alert ${res.estado === "CALCULADO" ? "info" : res.estado === "CON_SALDO" ? "warn" : "err"}">${res.mensajes.map(esc).join("<br>")}</div>` : ""}
    <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Destino</th><th>Valor del inductor</th><th>Estado del valor</th><th>Método / fuente</th><th>Costo aplicado S/</th><th>% del pool</th></tr></thead><tbody>
    ${destinos
      .map((d) => {
        const v = vb.get(d.id);
        const l = res?.lineas.find((x) => x.destinoId === d.id);
        if (r.base_desde === "PERSONAL_INDIRECTO")
          return `<tr><td class="frz1 mono">${esc(d.codigo)}</td><td class="frz2">${esc(d.nombre)}</td>
        <td class="num derived">${l ? num(l.base, 2) : "0,00"}</td><td><span class="pill calc">Calculado</span></td><td class="muted">Suma del costo empresa de las personas indirectas del centro (pestaña 7 «Personas»)</td>
        <td class="num derived">${l ? money(l.importe) : "—"}</td><td class="num derived">${l && g && g.pool > 0 ? pct(l.importe / g.pool) : "—"}</td></tr>`;
        return `<tr><td class="frz1 mono">${esc(d.codigo)}</td><td class="frz2">${esc(d.nombre)}</td>
        <td><input data-key="vb-${r.id}-${d.id}" data-edit="m2-vb-valor" data-r="${r.id}" data-d="${d.id}" value="${v && v.valor !== null ? num(v.valor, 4).replace(/,?0+$/, "") : ""}" placeholder="sin dato"></td>
        <td><select data-edit="m2-vb-estado" data-r="${r.id}" data-d="${d.id}">${["REAL", "ESTIMADO", "AJUSTADO", "PENDIENTE"].map((e) => `<option ${(v?.estado_valor || "PENDIENTE") === e ? "selected" : ""}>${e}</option>`).join("")}</select></td>
        <td><input class="txt" data-key="vm-${r.id}-${d.id}" data-edit="m2-vb-metodo" data-r="${r.id}" data-d="${d.id}" value="${esc(v?.metodo || "")}" title="${esc(v?.fuente || "")}" placeholder="Método o fuente"></td>
        <td class="num derived">${l ? money(l.importe) : "—"}</td><td class="num derived">${l && g && g.pool > 0 ? pct(l.importe / g.pool) : "—"}</td></tr>`;
      })
      .join("")}</tbody></table></div>
    ${res ? `<h3 style="font-size:15px;margin-top:16px">Cálculo paso a paso</h3><ol class="steps">${res.pasos.map((p) => `<li>${esc(p.replace(/^\d+\.\s*/, ""))}</li>`).join("")}</ol>` : `<p class="muted">Esta regla no tiene costo que repartir en el período.</p>`}
    <p class="muted mono" style="margin-top:8px">Fuente de la regla: ${esc(r.fuente || "manual")}</p></section>`;
}

// ======================= 9 · Asignación: matrices =======================
export function matriz(h: Host, sub: string): string {
  const c = h.ctx!;
  const R = h.abc();
  if (!R) return "";
  const show = mostrar(h);
  const V = (x: number | null | undefined, d = 2) => (show ? num(x ?? 0, d) : "—");
  const M = (x: number | null | undefined) => (show ? money(x ?? 0) : "—");
  const nm = mapNombre(h.s, c);
  const acts = R.resumen.map((x) => x.act);
  let body = bannerEstado(h);
  if (R.bloqueos.length) body += `<div class="alert err"><b>Bloqueos del cálculo:</b><br>${R.bloqueos.map(esc).join("<br>")}</div>`;
  if (sub === "p1") {
    const mats = h.s.all("SELECT * FROM material WHERE version_id=? ORDER BY codigo", [c.versionId]);
    const q = new Map(R.p1.map((x) => [x.actividadId + "|" + x.materialId, x]));
    body += `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1" rowspan="2">Código</th><th class="frz2" rowspan="2">Actividad</th><th rowspan="2">CA</th>
      <th class="group" colspan="${mats.length}">Cantidad (unidad de consumo)</th><th class="group" colspan="${mats.length}">Costo S/ = cantidad × costo unitario</th><th rowspan="2">Total CMD S/</th></tr>
      <tr class="h2">${mats.map((m) => `<th>${esc(m.nombre)}<br><span class="muted">${esc(m.unidad_consumo)}</span></th>`).join("")}${mats.map((m) => `<th>${esc(m.nombre)}<br><span class="muted">${num(R.unitMat.get(m.id)?.costoUnit, 6)}/${esc(m.unidad_consumo)}</span></th>`).join("")}</tr></thead><tbody>
      ${acts
        .map((a) => {
          const ca = nm.get(a.centroId);
          return `<tr><td class="frz1 mono">${esc(a.codigo)}</td><td class="frz2">${esc(a.nombre)}</td><td>${esc(ca?.nombre)}</td>
          ${mats.map((m) => `<td class="num">${q.has(a.id + "|" + m.id) ? num(q.get(a.id + "|" + m.id)!.cantidad) : ""}</td>`).join("")}
          ${mats.map((m) => `<td class="num derived ${q.has(a.id + "|" + m.id) && show ? "clickable" : ""}" ${q.has(a.id + "|" + m.id) && show ? `data-act="m2-exp-p1" data-a="${a.id}" data-m="${m.id}"` : ""}>${q.has(a.id + "|" + m.id) ? V(q.get(a.id + "|" + m.id)!.importe) : ""}</td>`).join("")}
          <td class="num derived"><b>${V(R.cmd.get(a.id))}</b></td></tr>`;
        })
        .join("")}
      <tr class="total"><td class="frz1"></td><td class="frz2">Total</td><td></td>${mats.map((m) => `<td class="num">${num(R.p1.filter((x) => x.materialId === m.id).reduce((s, x) => s + x.cantidad, 0))}</td>`).join("")}${mats.map((m) => `<td class="num">${V(R.p1.filter((x) => x.materialId === m.id).reduce((s, x) => s + x.importe, 0))}</td>`).join("")}<td class="num">${M(R.p1.reduce((s, x) => s + x.importe, 0))}</td></tr>
      </tbody></table></div>`;
  } else if (sub === "p2") {
    body += R.p2.length
      ? `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Actividad</th><th class="frz2">Servicio directo</th><th>Proveedor</th><th>Base / cantidad</th><th>Unidad</th><th>Tarifa S/</th><th>Costo directo S/</th></tr></thead><tbody>
      ${R.p2.map((x) => `<tr><td class="frz1 mono">${esc(nm.get(x.servicio.actividadId)?.codigo)}</td><td class="frz2">${esc(x.servicio.servicio)}</td><td>${esc(x.servicio.proveedor)}</td><td class="num">${num(x.servicio.cantidad)}</td><td>${esc(x.servicio.unidad)}</td><td class="num">${money(x.servicio.tarifa)}</td><td class="num derived">${V(x.importe)}</td></tr>`).join("")}
      <tr class="total"><td class="frz1"></td><td class="frz2">Total CSD</td><td colspan="4"></td><td class="num">${M(R.p2.reduce((s, x) => s + x.importe, 0))}</td></tr></tbody></table></div>`
      : `<div class="alert info">P2 Servicio directo: <b>No aplica</b> en este período (sin servicios directos registrados; importe S/ 0,00). Regístralos en Recursos → Servicios directos.</div>`;
  } else if (sub === "p4a") {
    const cs = h.s.all("SELECT * FROM centro WHERE version_id=? ORDER BY codigo", [c.versionId]);
    body += `<p class="lead">Matriz 1: valores del inductor por centro. Matriz 2: importe asignado = tasa × valor. Saldo = monto − asignado (sin normalizar).</p>
      <div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1" rowspan="2">EC</th><th class="frz2" rowspan="2">Elemento indirecto</th><th rowspan="2">Monto período S/</th><th rowspan="2">Inductor</th><th rowspan="2">Tipo</th>
      <th class="group" colspan="${cs.length}">Matriz 1 · valor del inductor</th><th rowspan="2">Total base</th><th rowspan="2">Tasa</th><th class="group" colspan="${cs.length}">Matriz 2 · importe asignado S/</th><th rowspan="2">Saldo S/</th><th rowspan="2">Estado</th></tr>
      <tr class="h2">${cs.map((x) => `<th>${esc(x.codigo)}<br><span class="muted">${esc(x.nombre)}</span></th>`).join("")}${cs.map((x) => `<th>${esc(x.codigo)}<br><span class="muted">${esc(x.nombre)}</span></th>`).join("")}</tr></thead><tbody>
      ${R.p4a
        .map((g) => {
          const ec = nm.get(g.origenId);
          const vb = g.regla ? new Map(h.s.all("SELECT destino_id, valor, estado_valor FROM valor_base WHERE regla_id=? AND periodo_id=?", [g.regla.id, c.periodoId]).map((v) => [v.destino_id, v])) : new Map();
          return `<tr><td class="frz1 mono">${esc(ec?.codigo)}</td><td class="frz2">${esc(ec?.nombre)}</td><td class="num">${money(g.pool)}</td><td>${esc(g.regla?.inductor || "Sin regla")}</td><td class="mono">${esc(g.regla?.tipo || "")}</td>
          ${cs.map((x) => `<td class="num">${vb.has(x.id) && vb.get(x.id).valor !== null ? num(vb.get(x.id).valor, g.regla?.tipo === "porcentaje" ? 4 : 2) : ""}</td>`).join("")}
          <td class="num derived">${g.r?.denominador == null ? "—" : num(g.r.denominador, 2)}</td><td class="num derived">${g.r?.tasa == null ? "—" : num(g.r.tasa, 6)}</td>
          ${cs.map((x) => { const l = g.r?.lineas.find((z) => z.destinoId === x.id); return `<td class="num derived ${l && l.importe && show ? "clickable" : ""}" ${l && l.importe && show ? `data-act="m2-exp" data-et="4a" data-o="${g.origenId}" data-d="${x.id}"` : ""}>${l && l.importe ? V(l.importe) : ""}</td>`; }).join("")}
          <td class="num${g.r && g.r.saldo > 0.005 ? " blocked" : ""}">${g.r ? V(g.r.saldo) : M(g.pool)}</td><td>${g.r ? pillEstado(g.r.estado) : pillEstado("PENDIENTE")}</td></tr>`;
        })
        .join("")}
      <tr class="total"><td class="frz1"></td><td class="frz2">Total</td><td class="num">${money(R.p4a.reduce((s, g) => s + g.pool, 0))}</td><td colspan="${2 + cs.length + 2}"></td>${cs.map((x) => `<td class="num">${V(Array.from(R.ciCentro.values()).reduce((s, m) => s + (m.get(x.id) || 0), 0))}</td>`).join("")}<td class="num">${V(R.saldos.filter((z) => z.etapa === "P4a").reduce((s, z) => s + z.monto, 0))}</td><td></td></tr>
      </tbody></table></div>`;
  } else if (sub === "p4b") {
    const cs = h.s.all("SELECT * FROM centro WHERE version_id=? ORDER BY codigo", [c.versionId]);
    const sel = h.st.sub.p4bCentro && cs.find((x) => x.id === h.st.sub.p4bCentro) ? h.st.sub.p4bCentro : (cs.find((x) => x.participacion !== "NO_PARTICIPA") || cs[0])?.id;
    const ce = cs.find((x) => x.id === sel)!;
    const aC = acts.filter((a) => a.centroId === sel);
    const gs = R.p4b.filter((g) => g.centroId === sel);
    body += `<div class="form-row"><label>Centro de actividad (una matriz por cada uno de los ${cs.length} centros)<select data-edit="m2-p4b-centro">${cs.map((x) => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${esc(x.codigo)} · ${esc(x.nombre)} · ${esc(x.participacion)}</option>`).join("")}</select></label></div>`;
    if (ce.participacion === "NO_PARTICIPA") body += `<div class="alert info">${esc(ce.codigo)} ${esc(ce.nombre)} no participa en la cadena: su costo indirecto de P4a se informa como «fuera de la cadena» y no se reparte a actividades.</div>`;
    else
      body += `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1" rowspan="2">EC</th><th class="frz2" rowspan="2">Elemento indirecto en ${esc(ce.codigo)}</th><th rowspan="2">Costo EC en el centro S/</th><th rowspan="2">Inductor</th><th rowspan="2">Tipo</th>
      <th class="group" colspan="${aC.length}">Matriz 1 · valor del inductor por actividad</th><th rowspan="2">Total base</th><th rowspan="2">Tasa</th><th class="group" colspan="${aC.length}">Matriz 2 · importe asignado S/</th><th rowspan="2">Saldo S/</th><th rowspan="2">Estado</th></tr>
      <tr class="h2">${aC.map((a) => `<th title="${esc(a.nombre)}">${esc(a.codigo)}<br><span class="muted">${esc(abrev(a.nombre, 26))}${a.alcance === "EXCLUIDA" ? " · otra" : ""}</span></th>`).join("")}${aC.map((a) => `<th>${esc(a.codigo)}</th>`).join("")}</tr></thead><tbody>
      ${gs
        .map((g) => {
          const ec = nm.get(g.origenId);
          const vb = g.regla ? new Map(h.s.all("SELECT destino_id, valor FROM valor_base WHERE regla_id=? AND periodo_id=?", [g.regla.id, c.periodoId]).map((v) => [v.destino_id, v])) : new Map();
          return `<tr><td class="frz1 mono">${esc(ec?.codigo)}</td><td class="frz2">${esc(ec?.nombre)}</td><td class="num">${money(g.pool)}</td><td>${esc(g.regla?.inductor || "Sin regla")}</td><td class="mono">${esc(g.regla?.tipo || "")}</td>
          ${aC.map((a) => `<td class="num">${vb.has(a.id) && vb.get(a.id).valor !== null ? num(vb.get(a.id).valor, g.regla?.tipo === "porcentaje" ? 4 : 2) : ""}</td>`).join("")}
          <td class="num derived">${g.r?.denominador == null ? "—" : num(g.r.denominador, 2)}</td><td class="num derived">${g.r?.tasa == null ? "—" : num(g.r.tasa, 6)}</td>
          ${aC.map((a) => { const l = g.r?.lineas.find((z) => z.destinoId === a.id); return `<td class="num derived ${l && l.importe && show ? "clickable" : ""}" ${l && l.importe && show ? `data-act="m2-exp" data-et="4b" data-o="${g.origenId}" data-c="${sel}" data-d="${a.id}"` : ""}>${l && l.importe ? V(l.importe) : ""}</td>`; }).join("")}
          <td class="num${g.r && g.r.saldo > 0.005 ? " blocked" : ""}">${g.r ? V(g.r.saldo) : M(g.pool)}</td><td>${g.r ? pillEstado(g.r.estado) : pillEstado("PENDIENTE")}</td></tr>`;
        })
        .join("")}
      <tr class="total"><td class="frz1"></td><td class="frz2">Total CI del centro</td><td class="num">${money(gs.reduce((s, g) => s + g.pool, 0))}</td><td colspan="${2 + aC.length + 2}"></td>${aC.map((a) => `<td class="num">${V(R.ci.get(a.id))}</td>`).join("")}<td class="num">${V(gs.reduce((s, g) => s + (g.r ? g.r.saldo : g.pool), 0))}</td><td></td></tr>
      </tbody></table></div>`;
  } else if (sub === "resumen") {
    const t = (k: "cmd" | "csd" | "cpd" | "ci" | "total") => R.resumen.reduce((s, x) => s + x[k], 0);
    body += `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Actividad</th><th>Centro</th><th>Alcance</th><th>CMD S/ (P1)</th><th>CSD S/ (P2)</th><th>CPD S/ (P3)</th><th>CI asignado S/ (P4b)</th><th>Total actividad S/</th><th>% participación</th></tr></thead><tbody>
      ${R.resumen
        .map((x) => `<tr><td class="frz1 mono">${esc(x.act.codigo)}</td><td class="frz2">${esc(x.act.nombre)}</td><td>${esc(nm.get(x.act.centroId)?.nombre)}</td><td>${x.act.alcance === "INCLUIDA" ? "Cadena" : x.act.alcance === "EXCLUIDA" ? '<span class="pill none">Otra actividad</span>' : "Parcial " + pct(x.act.pct)}</td>
        <td class="num">${V(x.cmd)}</td><td class="num">${V(x.csd)}</td><td class="num">${V(x.cpd)}</td><td class="num">${V(x.ci)}</td><td class="num derived clickable" data-act="m2-exp-res" data-a="${x.act.id}"><b>${V(x.total)}</b></td><td class="num derived">${show ? pct(x.pct) : "—"}</td></tr>`)
        .join("")}
      <tr class="total"><td class="frz1"></td><td class="frz2">Total</td><td colspan="2"></td><td class="num">${V(t("cmd"))}</td><td class="num">${V(t("csd"))}</td><td class="num">${V(t("cpd"))}</td><td class="num">${V(t("ci"))}</td><td class="num">${M(t("total"))}</td><td class="num">${show ? pct(1) : "—"}</td></tr></tbody></table></div>`;
  } else if (sub === "p4c") {
    const os = R.objetos.map((o) => o.obj);
    body += `<div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1" rowspan="2">Código</th><th class="frz2" rowspan="2">Actividad</th><th rowspan="2">Costo disponible S/</th><th rowspan="2">Inductor</th><th rowspan="2">Tipo</th>
      <th class="group" colspan="${os.length}">Matriz 1 · consumo del inductor por objeto</th><th rowspan="2">Total base</th><th rowspan="2">Tasa</th><th class="group" colspan="${os.length}">Matriz 2 · costo asignado S/</th><th rowspan="2">Saldo S/</th><th rowspan="2">Estado</th></tr>
      <tr class="h2">${os.map((o) => `<th title="${esc(o.nombre)}">${esc(o.codigo)}<br><span class="muted">${esc(abrev(o.nombre, 26))}</span></th>`).join("")}${os.map((o) => `<th>${esc(o.codigo)}</th>`).join("")}</tr></thead><tbody>
      ${R.p4c
        .map((g) => {
          const a = nm.get(g.origenId);
          const vb = g.regla ? new Map(h.s.all("SELECT destino_id, valor FROM valor_base WHERE regla_id=? AND periodo_id=?", [g.regla.id, c.periodoId]).map((v) => [v.destino_id, v])) : new Map();
          return `<tr><td class="frz1 mono">${esc(a?.codigo)}</td><td class="frz2">${esc(a?.nombre)}</td><td class="num">${V(g.pool)}</td><td>${esc(g.regla?.inductor || "Sin regla")}</td><td class="mono">${esc(g.regla?.tipo || "")}</td>
          ${os.map((o) => `<td class="num">${vb.has(o.id) && vb.get(o.id).valor !== null ? num(vb.get(o.id).valor, g.regla?.tipo === "porcentaje" ? 4 : 2) : ""}</td>`).join("")}
          <td class="num derived">${g.r?.denominador == null ? "—" : num(g.r.denominador, 2)}</td><td class="num derived">${g.r?.tasa == null ? "—" : num(g.r.tasa, 6)}</td>
          ${os.map((o) => { const l = g.r?.lineas.find((z) => z.destinoId === o.id); return `<td class="num derived ${l && l.importe && show ? "clickable" : ""}" ${l && l.importe && show ? `data-act="m2-exp" data-et="4c" data-o="${g.origenId}" data-d="${o.id}"` : ""}>${l && l.importe ? V(l.importe) : ""}</td>`; }).join("")}
          <td class="num${g.r && g.r.saldo > 0.005 ? " blocked" : ""}">${g.r ? V(g.r.saldo) : V(g.pool)}</td><td>${g.r ? pillEstado(g.r.estado) : pillEstado("PENDIENTE")}</td></tr>`;
        })
        .join("")}
      <tr class="total"><td class="frz1"></td><td class="frz2">Total</td><td class="num">${V(R.p4c.reduce((s, g) => s + g.pool, 0))}</td><td colspan="${2 + os.length + 2}"></td>${R.objetos.map((o) => `<td class="num">${V(o.costo)}</td>`).join("")}<td class="num">${V(R.saldos.filter((z) => z.etapa === "P4c" && z.tipo !== "FUERA_ALCANCE").reduce((s, z) => s + z.monto, 0))}</td><td></td></tr>
      </tbody></table></div>
      <section class="panel" style="margin-top:16px"><h3>Costo unitario por objeto de costo</h3><div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Código</th><th class="frz2">Objeto de costo</th><th>Costo S/</th><th>Magnitud</th><th>Cantidad</th><th>Costo unitario S/</th><th>Clase</th></tr></thead><tbody>
      ${R.objetos.map((o) => `<tr><td class="frz1 mono">${esc(o.obj.codigo)}</td><td class="frz2">${esc(o.obj.nombre)}</td><td class="num">${V(o.costo)}</td><td>${esc(o.obj.magnitud)}</td><td class="num">${o.obj.cantidad === null ? "sin dato" : num(o.obj.cantidad)}</td><td class="num derived">${o.unitario === null ? "—" : V(o.unitario)}</td><td>${o.obj.clase === "OBJETO" ? "Objeto" : '<span class="pill warn">Revisión KPI</span>'}</td></tr>`).join("")}
      </tbody></table></div></section>`;
  } else if (sub === "conciliacion") {
    body += `<div class="grid g2"><section class="panel"><h3>Conciliación global del costo</h3><p class="lead">Costo de origen = asignado a objetos + capacidad no utilizada + fuera de alcance + saldos.</p>
      <div class="matrix-wrap" style="max-height:none"><table class="matrix"><tbody>
      ${R.conciliacion.map((x) => `<tr><td class="frz2">${x.signo > 0 ? "(+)" : "(−)"} ${esc(x.concepto)}</td><td class="num">${V(x.monto)}</td></tr>`).join("")}
      <tr class="subtotal"><td class="frz2">Total de origen</td><td class="num">${M(R.totalFuente)}</td></tr><tr class="subtotal"><td class="frz2">Total explicado</td><td class="num">${M(R.totalExplicado)}</td></tr>
      <tr class="total"><td class="frz2">Diferencia</td><td class="num${neg(round2(R.totalFuente - R.totalExplicado))}">${show ? money(round2(R.totalFuente - R.totalExplicado)) + (R.cuadra ? " · cuadra" : " · NO CUADRA") : "—"}</td></tr></tbody></table></div></section>
      <section class="panel"><h3>Saldos y costos fuera de alcance (${R.saldos.length})</h3><div class="matrix-wrap"><table class="matrix"><thead><tr><th class="frz1">Etapa</th><th class="frz2">Causa</th><th>Tipo</th><th>Monto S/</th></tr></thead><tbody>
      ${R.saldos.map((z) => `<tr><td class="frz1 mono">${esc(z.etapa)}</td><td class="frz2" style="white-space:normal;min-width:320px">${esc(z.causa)}</td><td>${z.tipo === "CAPACIDAD" ? '<span class="pill calc">Capacidad</span>' : z.tipo === "FUERA_ALCANCE" ? '<span class="pill none">Fuera de alcance</span>' : z.tipo === "BLOQUEADO" ? '<span class="pill err">Bloqueado</span>' : '<span class="pill warn">Pendiente</span>'}</td><td class="num">${V(z.monto)}</td></tr>`).join("")}
      </tbody></table></div></section></div>`;
  }
  return body;
}

export function explicar(h: Host, et: string, origen: string, destino: string, centro?: string): string {
  const R = h.abc()!;
  const nm = mapNombre(h.s, h.ctx!);
  const g = et === "4a" ? R.p4a.find((x) => x.origenId === origen) : et === "4b" ? R.p4b.find((x) => x.origenId === origen && x.centroId === centro) : R.p4c.find((x) => x.origenId === origen);
  if (!g || !g.r) return "";
  const l = g.r.lineas.find((x) => x.destinoId === destino)!;
  const vb = g.regla ? h.s.one("SELECT * FROM valor_base WHERE regla_id=? AND destino_id=? AND periodo_id=?", [g.regla.id, destino, h.ctx!.periodoId]) : null;
  const run = h.estadoABC().run;
  return `<h3>Explicar cálculo · ${et}</h3><p class="muted">${esc(nm.get(origen)?.codigo)} ${esc(nm.get(origen)?.nombre)} → ${esc(nm.get(destino)?.codigo)} ${esc(nm.get(destino)?.nombre)}${centro ? " · en " + esc(nm.get(centro)?.codigo) : ""}</p>
    <div class="formula">Pool = ${num(g.pool)}
Inductor: ${esc(g.regla?.inductor)} (${esc(g.regla?.tipo)}, unidad ${esc(g.regla?.unidad)})
Denominador = Σ valores = ${g.r.denominador == null ? "—" : num(g.r.denominador, 4)}
Tasa = ${num(g.pool)} / ${g.r.denominador == null ? "—" : num(g.r.denominador, 4)} = ${g.r.tasa == null ? "—" : num(g.r.tasa, 6)} ${esc(g.r.unidadTasa)}

Costo aplicado = tasa × valor del destino
               = ${g.r.tasa == null ? "—" : num(g.r.tasa, 6)} × ${num(l.base, 4)} = ${money(l.importe)}</div>
    <dl><dt>Estado del valor</dt><dd>${esc(vb?.estado_valor || "—")}</dd><dt>Método</dt><dd>${esc(vb?.metodo || "—")}</dd><dt>Fuente del valor</dt><dd class="mono" style="font-size:11.5px">${esc(vb?.fuente || "—")}</dd>
    <dt>Fuente de la regla</dt><dd class="mono" style="font-size:11.5px">${esc(h.s.one("SELECT fuente FROM regla_reparto WHERE id=?", [g.regla?.id])?.fuente || "—")}</dd>
    <dt>Saldo de la regla</dt><dd>${money(g.r.saldo)}</dd><dt>Corrida</dt><dd class="mono">${esc(run?.id || "sin corrida")}</dd></dl>`;
}

export function explicarResumen(h: Host, actId: string): string {
  const R = h.abc()!;
  const x = R.resumen.find((z) => z.act.id === actId)!;
  const nm = mapNombre(h.s, h.ctx!);
  const per = R.p3.flatMap((p) => p.r.porActividad.filter((a) => a.actividadId === actId).map((a) => ({ p: p.persona, a, t: p.r.tasa })));
  const ecs = Array.from(R.ciAct.get(actId)?.entries() || []);
  return `<h3>Explicar cálculo · costo de la actividad</h3><p class="muted">${esc(x.act.codigo)} ${esc(x.act.nombre)}</p>
    <div class="formula">Total = CMD + CSD + CPD + CI
      = ${num(x.cmd)} + ${num(x.csd)} + ${num(x.cpd)} + ${num(x.ci)}
      = ${money(x.total)}</div>
    <h3 style="font-size:14px;margin-top:12px">Personas que participan (P3)</h3><div class="formula">${per.map((z) => `${z.p.codigo} ${z.p.nombre}: ${num(z.a.horas)} h × ${num(z.t, 4)} = ${num(z.a.importe)}`).join("\n") || "ninguna"}</div>
    <h3 style="font-size:14px;margin-top:12px">Indirectos recibidos (P4b)</h3><div class="formula">${ecs.map(([e, v]) => `${nm.get(e)?.nombre}: ${num(v)}`).join("\n") || "ninguno"}</div>
    <h3 style="font-size:14px;margin-top:12px">Materiales (P1)</h3><div class="formula">${R.p1.filter((p) => p.actividadId === actId).map((p) => `${nm.get(p.materialId)?.nombre}: ${num(p.cantidad)} × ${num(p.costoUnit, 6)} = ${num(p.importe)}`).join("\n") || "ninguno"}</div>`;
}
