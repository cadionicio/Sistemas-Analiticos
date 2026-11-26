"use strict";
/* Lectura y escritura de XLSX sin dependencias externas (ZIP + XML). Común a PC08.exe y PC08.html. */
const XLSX = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const escx = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  /* ---------------- ZIP ---------------- */
  async function inflar(datos) {
    const ds = new DecompressionStream("deflate-raw");
    const s = new Blob([datos]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function leerZip(buf) {
    const b = new Uint8Array(buf), v = new DataView(b.buffer, b.byteOffset, b.byteLength), arch = {};
    let eocd = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("El archivo no es un Excel .xlsx válido.");
    const n = v.getUint16(eocd + 10, true); let p = v.getUint32(eocd + 16, true);
    for (let k = 0; k < n; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error("Estructura ZIP no válida.");
      const met = v.getUint16(p + 10, true), tam = v.getUint32(p + 20, true), ln = v.getUint16(p + 28, true), lx = v.getUint16(p + 30, true), lc = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
      const nombre = dec.decode(b.subarray(p + 46, p + 46 + ln));
      const ini = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
      const datos = b.subarray(ini, ini + tam);
      arch[nombre] = met === 0 ? datos : met === 8 ? await inflar(datos) : null;
      p += 46 + ln + lx + lc;
    }
    return arch;
  }
  function crearZip(archivos) { // método «almacenado»: compatible con Excel y LibreOffice
    const partes = [], central = []; let off = 0;
    for (const [nombre, contenido] of archivos) {
      const nb = enc.encode(nombre), d = typeof contenido === "string" ? enc.encode(contenido) : contenido, c = crc32(d);
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, c, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nb.length, true);
      partes.push(new Uint8Array(h.buffer), nb, d);
      const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint32(16, c, true); ch.setUint32(20, d.length, true); ch.setUint32(24, d.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), nb); off += 30 + nb.length + d.length;
    }
    const tamC = central.reduce((s, x) => s + x.length, 0), fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true); fin.setUint32(12, tamC, true); fin.setUint32(16, off, true);
    const todo = [...partes, ...central, new Uint8Array(fin.buffer)], r = new Uint8Array(todo.reduce((s, x) => s + x.length, 0)); let i = 0; for (const x of todo) { r.set(x, i); i += x.length; }
    return r;
  }

  /* ---------------- lectura ---------------- */
  const xml = t => new DOMParser().parseFromString(t, "application/xml");
  const colNum = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  async function leer(buf) {
    if (buf.byteLength > 10 * 1024 * 1024) throw new Error("El archivo supera 10 MiB.");
    const z = await leerZip(buf);
    const total = Object.values(z).reduce((s, x) => s + (x?.length || 0), 0); if (total > 50 * 1024 * 1024) throw new Error("El contenido descomprimido supera 50 MiB.");
    if (Object.keys(z).some(n => /vbaProject|externalLink/i.test(n))) throw new Error("El archivo contiene macros o vínculos externos; no se admite.");
    if (!z["xl/workbook.xml"]) throw new Error("El archivo no es un Excel .xlsx válido.");
    const ss = z["xl/sharedStrings.xml"] ? [...xml(dec.decode(z["xl/sharedStrings.xml"])).getElementsByTagName("si")].map(si => [...si.getElementsByTagName("t")].map(t => t.textContent).join("")) : [];
    const wb = xml(dec.decode(z["xl/workbook.xml"])), rels = xml(dec.decode(z["xl/_rels/workbook.xml.rels"]));
    const destino = Object.fromEntries([...rels.getElementsByTagName("Relationship")].map(r => [r.getAttribute("Id"), r.getAttribute("Target")]));
    let formulas = false; const hojas = {};
    for (const s of wb.getElementsByTagName("sheet")) {
      const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let ruta = destino[rid] || ""; ruta = ruta.startsWith("/") ? ruta.slice(1) : "xl/" + ruta.replace(/^\.\//, "");
      const d = z[ruta]; if (!d) continue;
      const filas = [];
      for (const row of xml(dec.decode(d)).getElementsByTagName("row")) {
        const r = Number(row.getAttribute("r")) - 1, f = [];
        for (const c of row.getElementsByTagName("c")) {
          const i = colNum(c.getAttribute("r") || ""), t = c.getAttribute("t"), vv = c.getElementsByTagName("v")[0]?.textContent;
          if (c.getElementsByTagName("f").length) formulas = true;
          f[i] = t === "s" ? ss[Number(vv)] : t === "inlineStr" ? [...c.getElementsByTagName("t")].map(x => x.textContent).join("") : t === "b" ? vv === "1" : t === "str" || t === "e" ? vv : vv == null ? null : Number(vv);
        }
        filas[r] = f;
      }
      hojas[s.getAttribute("name")] = filas;
    }
    if (formulas) throw new Error("El archivo contiene fórmulas; cargue solo valores.");
    return hojas;
  }
  const fechaExcel = n => Math.round((n - 25569) * 86400) + 5 * 3600; // serial (hora de Lima) → UTC en segundos

  /* ---------------- escritura ---------------- */
  const ref = (c, r) => { let s = "", n = c + 1; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s + (r + 1); };
  /* hojas: [{nombre, filas: [[...]], anchos?:[], formatos?: {col: "fecha"|"moneda"|"porcentaje"|"decimal"}}]; fila 0 = encabezado */
  function escribir(hojas) {
    const sty = {texto: 0, enc: 1, fecha: 2, moneda: 3, porcentaje: 4, decimal: 5, titulo: 6};
    const hx = hojas.map((h, k) => {
      const f = h.filas.map((fila, r) => `<row r="${r + 1}">${fila.map((v, c) => {
        if (v == null || v === "") return "";
        const fmt = r === 0 && !h.sinEncabezado ? "enc" : h.formatos?.[c] || "texto", s = sty[fmt] || 0;
        if (v instanceof Date) return `<c r="${ref(c, r)}" s="${sty.fecha}"><v>${v.getTime() / 86400000 + 25569 - 5 / 24}</v></c>`;
        if (typeof v === "number" && isFinite(v)) return `<c r="${ref(c, r)}" s="${s}"><v>${v}</v></c>`;
        let t = String(v); if (/^[=+\-@]/.test(t)) t = "'" + t; // evita que un texto se interprete como fórmula
        return `<c r="${ref(c, r)}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${escx(t)}</t></is></c>`;
      }).join("")}</row>`).join("");
      const cols = (h.anchos || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${h.sinEncabezado ? "" : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'}</sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${f}</sheetData></worksheet>`;
    });
    const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="165" formatCode="&quot;S/&quot; #,##0.00"/><numFmt numFmtId="166" formatCode="#,##0.00"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF081F3E"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF081F3E"/></patternFill></fill></fills>
<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="7"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="10" applyNumberFormat="1"/><xf numFmtId="166" applyNumberFormat="1"/><xf fontId="2" applyFont="1"/></cellXfs></styleSheet>`;
    const archivos = [
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${hojas.map((_, k) => `<Override PartName="/xl/worksheets/sheet${k + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${hojas.map((h, k) => `<sheet name="${escx(h.nombre.slice(0, 31))}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join("")}</sheets></workbook>`],
      ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, k) => `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${k + 1}.xml"/>`).join("")}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ["xl/styles.xml", estilos],
      ...hx.map((x, k) => [`xl/worksheets/sheet${k + 1}.xml`, x]),
    ];
    return crearZip(archivos);
  }
  return {leer, escribir, fechaExcel};
})();
if (typeof module !== "undefined") module.exports = XLSX;
