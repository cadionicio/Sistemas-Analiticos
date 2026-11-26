"use strict";
/* Carga de datos desde Excel (plantilla única, validación completa antes de guardar, lote atómico e idempotente). */
const Carga = (() => {
  const MAX_FILAS = 5000;
  const ENUM = {
    horario_estado: ["CONFIRMADO", "DESCONOCIDO", "CONTRADICTORIO"], canal: ["WEB", "APP"],
    estado_compra: ["CONFIRMADO", "PENDIENTE", "FALLIDO", "POR_VERIFICAR"], estado_pago: ["CONFIRMADO", "PENDIENTE", "DUPLICADO", "FALLIDO", "POR_VERIFICAR"],
    estado_emision: ["EMITIDA", "NO_EMITIDA", "POR_VERIFICAR"], estado_ingreso: ["NO_APLICA", "VALIDADO", "RECHAZADO", "POR_VERIFICAR"],
    canal_origen: ["CLIENTE", "DIGITAL", "BOLETERIA", "CARGA"], estado: ["NUEVO", "EN_VERIFICACION", "EN_ATENCION", "ESCALADO", "RESUELTO", "CERRADO"],
    canal_contacto: ["CLIENTE", "DIGITAL", "BOLETERIA"],
  };
  /* Hojas y columnas: [columna, obligatorio, tipo, descripción] */
  const HOJAS = {
    Funciones: [["codigo_funcion", 1, "codigo", "Código único de la función (ej. FUN-201)"], ["sede", 1, "sede", "Nombre de la sede del catálogo (ej. CP Alcázar)"], ["pelicula", 1, "texto", "Título de la película"], ["sala", 1, "texto", "Sala"], ["inicio", 0, "fecha", "Fecha y hora de inicio (AAAA-MM-DD HH:MM, hora de Lima). Vacío si el horario es desconocido"], ["horario_estado", 1, "enum:horario_estado", "CONFIRMADO, DESCONOCIDO o CONTRADICTORIO"]],
    Compras: [["codigo_pedido", 1, "codigo", "Código único del pedido (ej. PED-2001)"], ["codigo_funcion", 1, "ref:funcion", "Función de la hoja Funciones o ya registrada"], ["canal", 1, "enum:canal", "WEB o APP"], ["entradas", 1, "entero", "Cantidad de entradas (1 a 20)"], ["monto_soles", 1, "monto", "Importe en soles, máximo 2 decimales"], ["estado_compra", 1, "enum:estado_compra", "CONFIRMADO, PENDIENTE, FALLIDO o POR_VERIFICAR"], ["estado_pago", 1, "enum:estado_pago", "CONFIRMADO, PENDIENTE, DUPLICADO, FALLIDO o POR_VERIFICAR"], ["estado_emision", 1, "enum:estado_emision", "EMITIDA, NO_EMITIDA o POR_VERIFICAR"], ["estado_ingreso", 1, "enum:estado_ingreso", "NO_APLICA, VALIDADO, RECHAZADO o POR_VERIFICAR"]],
    Incidencias: [["codigo_incidencia", 1, "codigo", "Código único (ej. INC-2001)"], ["codigo_pedido", 0, "ref:compra", "Pedido relacionado (vacío si es caso provisional)"], ["codigo_funcion", 0, "ref:funcion", "Obligatorio si no se informa pedido"], ["sede", 1, "sede", "Sede del catálogo"], ["tipo", 1, "tipo", "Código del motivo: T01 a T08 o T90"], ["descripcion", 1, "texto", "Descripción del episodio"], ["canal_origen", 1, "enum:canal_origen", "CLIENTE, DIGITAL, BOLETERIA o CARGA"], ["apertura", 1, "fecha", "Fecha y hora del primer contacto"], ["estado", 1, "enum:estado", "NUEVO, EN_VERIFICACION, EN_ATENCION, ESCALADO, RESUELTO o CERRADO"], ["responsable", 1, "texto", "Responsable o bandeja actual"], ["resolucion", 0, "fecha", "Fecha y hora de la solución verificada (obligatoria si RESUELTO o CERRADO)"], ["resultado", 0, "texto", "Resultado (obligatorio si RESUELTO o CERRADO)"], ["evidencia_resolucion", 0, "texto", "Evidencia operativa (obligatoria si RESUELTO o CERRADO)"]],
    Contactos: [["codigo_incidencia", 1, "ref:incidencia", "Incidencia de la hoja o ya registrada"], ["canal", 1, "enum:canal_contacto", "CLIENTE, DIGITAL o BOLETERIA"], ["fecha_hora", 1, "fecha", "Fecha y hora del contacto"], ["detalle", 0, "texto", "Detalle"], ["clave_origen", 1, "codigo", "Identificador único del mensaje de origen (evita duplicar reintentos)"]],
    Evidencias: [["codigo_evidencia", 1, "codigo", "Código único (ej. EV-2001)"], ["codigo_incidencia", 0, "ref:incidencia", "Incidencia relacionada (opcional)"], ["tipo", 1, "texto", "Tipo: CAPTURA, REGISTRO, OBSERVACION, ENLACE…"], ["origen", 1, "texto", "Quién o qué la produjo"], ["contenido", 1, "texto", "Descripción de la evidencia"], ["url_https", 0, "url", "Enlace https opcional"], ["fecha", 1, "fecha", "Fecha y hora"]],
  };
  const OPCIONALES = ["Evidencias"];

  const txt = v => v == null ? "" : String(v).trim();
  function fecha(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return XLSX.fechaExcel(v);
    const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
    if (!m) return NaN;
    const d = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 5, +m[5]) / 1000; // hora de Lima (UTC−5) → UTC
    const r = new Date((d - 5 * 3600) * 1000); return r.getUTCMonth() === +m[2] - 1 && r.getUTCDate() === +m[3] ? d : NaN;
  }
  const fmtF = u => { const d = new Date((u - 5 * 3600) * 1000), p = n => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
  async function sha256(texto) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)))].map(b => b.toString(16).padStart(2, "0")).join(""); }
  const pausa = () => new Promise(r => setTimeout(r, 0));

  /* ---------------- validación (no escribe nada) ---------------- */
  async function validar(A, libro, progreso = () => {}) {
    const p = await Nucleo.proyecto(A), errores = [], E = (hoja, fila, campo, codigo, mensaje) => errores.push({hoja, fila, campo, codigo, mensaje});
    const faltan = Object.keys(HOJAS).filter(h => !OPCIONALES.includes(h) && !libro[h]);
    for (const h of faltan) E(h, "—", "—", "HOJA_FALTANTE", `Falta la hoja «${h}» de la plantilla.`);
    const datos = {};
    let total = 0;
    for (const [h, cols] of Object.entries(HOJAS)) {
      const filas = libro[h]; if (!filas) { datos[h] = []; continue; }
      const enc = (filas[0] || []).map(txt), idx = {};
      enc.forEach((c, i) => { if (!c) return; if (idx[c] != null) E(h, 1, c, "ENCABEZADO_DUPLICADO", `La columna «${c}» está repetida.`); idx[c] = i; });
      for (const [c] of cols) if (idx[c] == null) E(h, 1, c, "COLUMNA_FALTANTE", `Falta la columna «${c}».`);
      datos[h] = [];
      for (let r = 1; r < filas.length; r++) {
        const f = filas[r] || []; if (!f.some(v => v != null && String(v).trim() !== "")) continue;
        const o = {_fila: r + 1}; for (const [c] of cols) o[c] = idx[c] != null ? f[idx[c]] : null; datos[h].push(o); total++;
      }
    }
    if (total > MAX_FILAS) E("—", "—", "—", "LIMITE", `El lote tiene ${total} filas; el máximo es ${MAX_FILAS}.`);
    if (!total && !errores.length) E("—", "—", "—", "VACIO", "El archivo no tiene filas de datos.");
    if (errores.some(e => ["HOJA_FALTANTE", "COLUMNA_FALTANTE", "LIMITE", "ENCABEZADO_DUPLICADO"].includes(e.codigo))) return {ok: false, errores, total};
    const [sedes, funs, coms, incs, evs, tipos, conts] = await Promise.all(["sede", "funcion", "compra", "incidencia", "evidencia", "tipo_incidencia", "contacto"].map(t => A.leer(t, t === "tipo_incidencia" || t === "contacto" ? {} : {proyecto_id: p.id})));
    const sedeN = new Map(sedes.map(s => [s.nombre.toLowerCase(), s])), tipoC = new Set(tipos.filter(t => t.activo).map(t => t.codigo));
    const bd = {funcion: new Map(funs.map(x => [x.codigo, x])), compra: new Map(coms.map(x => [x.codigo_pedido, x])), incidencia: new Map(incs.map(x => [x.codigo, x])), evidencia: new Map(evs.map(x => [x.codigo, x])), contacto: new Map(conts.map(x => [x.clave_origen, x]))};
    const clave = {Funciones: "codigo_funcion", Compras: "codigo_pedido", Incidencias: "codigo_incidencia", Evidencias: "codigo_evidencia", Contactos: "clave_origen"};
    const enArchivo = {funcion: new Set(datos.Funciones.map(x => txt(x.codigo_funcion))), compra: new Set(datos.Compras.map(x => txt(x.codigo_pedido))), incidencia: new Set(datos.Incidencias.map(x => txt(x.codigo_incidencia)))};
    let n = 0;
    const norm = {};
    for (const [h, cols] of Object.entries(HOJAS)) {
      norm[h] = []; const vistos = new Map();
      for (const o of datos[h]) {
        if (++n % 200 === 0) { progreso(n, total); await pausa(); }
        const x = {_fila: o._fila};
        for (const [c, ob, tipo] of cols) {
          let v = o[c]; const vacio = v == null || String(v).trim() === "";
          if (vacio) { if (ob) E(h, o._fila, c, "OBLIGATORIO", "Dato obligatorio vacío."); x[c] = null; continue; }
          if (tipo === "codigo") { v = txt(v); if (v.length > 50) E(h, o._fila, c, "LONGITUD", "Máximo 50 caracteres."); x[c] = v; }
          else if (tipo === "texto") { v = txt(v); if (v.length > 2000) E(h, o._fila, c, "LONGITUD", "Máximo 2.000 caracteres."); x[c] = v; }
          else if (tipo === "fecha") { const u = fecha(v); if (Number.isNaN(u)) E(h, o._fila, c, "FECHA", "Use fecha-hora de Excel o el formato AAAA-MM-DD HH:MM."); x[c] = u; }
          else if (tipo === "entero") { const k = Number(v); if (!Number.isInteger(k) || k < 1 || k > 20) E(h, o._fila, c, "NUMERO", "Entero entre 1 y 20."); x[c] = k; }
          else if (tipo === "monto") { const k = Number(String(v).replace(",", ".")); if (!(k >= 0) || Math.round(k * 100) !== +(k * 100).toFixed(6)) E(h, o._fila, c, "IMPORTE", "Importe no negativo con máximo 2 decimales."); x[c] = Math.round(k * 100); }
          else if (tipo.startsWith("enum:")) { v = txt(v).toUpperCase().replace(/\s+/g, "_"); if (!ENUM[tipo.slice(5)].includes(v)) E(h, o._fila, c, "VALOR", `Valor no admitido. Opciones: ${ENUM[tipo.slice(5)].join(", ")}.`); x[c] = v; }
          else if (tipo === "sede") { const s = sedeN.get(txt(v).toLowerCase()); if (!s) E(h, o._fila, c, "SEDE", `La sede «${txt(v)}» no está en el catálogo.`); x[c] = s?.id ?? null; x._sede = txt(v); }
          else if (tipo === "tipo") { v = txt(v).toUpperCase(); if (!tipoC.has(v)) E(h, o._fila, c, "MOTIVO", "Motivo no existe en el catálogo (T01–T08, T90)."); x[c] = v; }
          else if (tipo === "url") { v = txt(v); if (!/^https:\/\//i.test(v) || v.length > 1000) E(h, o._fila, c, "URL", "Debe empezar con https:// (máx. 1.000)."); x[c] = v; }
          else if (tipo.startsWith("ref:")) { const t = tipo.slice(4); v = txt(v); if (!enArchivo[t]?.has(v) && !bd[t].has(v)) E(h, o._fila, c, "REFERENCIA", `«${v}» no existe en la hoja ni en la base.`); x[c] = v; }
        }
        const k = x[clave[h]];
        if (k != null) { if (vistos.has(k)) E(h, o._fila, clave[h], "DUPLICADO", `Clave repetida en el archivo (también en la fila ${vistos.get(k)}).`); else vistos.set(k, o._fila); }
        if (h === "Funciones" && x.horario_estado === "CONFIRMADO" && x.inicio == null) E(h, o._fila, "inicio", "OBLIGATORIO", "Una función CONFIRMADA necesita fecha y hora de inicio.");
        if (h === "Incidencias") {
          if (!x.codigo_pedido && !x.codigo_funcion) E(h, o._fila, "codigo_funcion", "OBLIGATORIO", "Informe el pedido o la función.");
          if (["RESUELTO", "CERRADO"].includes(x.estado)) for (const c of ["resolucion", "resultado", "evidencia_resolucion"]) if (x[c] == null) E(h, o._fila, c, "R21", "Una solución verificada exige resultado, momento y evidencia (R21).");
          if (x.resolucion != null && x.apertura != null && x.resolucion < x.apertura) E(h, o._fila, "resolucion", "FECHA", "La resolución no puede ser anterior a la apertura.");
        }
        norm[h].push(x);
      }
    }
    progreso(total, total);
    // existentes en la base: iguales → se omiten; distintos → error
    const cmp = {Funciones: ["funcion", x => [x.pelicula, x.sala, x.inicio ?? null, x.horario_estado], f => [f.pelicula, f.sala, f.inicio_utc ?? null, f.horario_estado]],
      Compras: ["compra", x => [x.canal, x.entradas, x.monto_soles, x.estado_pago], f => [f.canal, f.entradas, f.monto_centimos, f.estado_pago]],
      Incidencias: ["incidencia", x => [x.tipo, x.estado, x.apertura], f => [f.tipo_codigo, f.estado, f.apertura_utc]],
      Evidencias: ["evidencia", x => [x.tipo, x.contenido], f => [f.tipo, f.contenido]], Contactos: ["contacto", x => [x.canal, x.fecha_hora], f => [f.canal, f.registrado_utc]]};
    const nuevos = {}, existentes = {};
    for (const [h, [t, a, b]] of Object.entries(cmp)) {
      nuevos[h] = []; existentes[h] = 0;
      for (const x of norm[h]) { const prev = bd[t].get(x[clave[h]]); if (!prev) nuevos[h].push(x); else if (JSON.stringify(a(x)) === JSON.stringify(b(prev))) existentes[h]++; else E(h, x._fila, clave[h], "EXISTE_DISTINTO", "La clave ya existe en la base con otros valores. Corrija la fila o edite el registro en la aplicación."); }
    }
    const canon = JSON.stringify(Object.fromEntries(Object.entries(norm).map(([h, xs]) => [h, xs.map(({_fila, _sede, ...r}) => r).sort((a, b) => String(a[clave[h]]).localeCompare(String(b[clave[h]])))])));
    const huella = await sha256(canon);
    const repetido = (await A.leer("lote_importado", {proyecto_id: p.id})).find(l => l.huella_sha256 === huella);
    return {ok: !errores.length, errores, total, nuevos, existentes, huella, repetido: repetido || null, conteo: Object.fromEntries(Object.entries(norm).map(([h, x]) => [h, x.length]))};
  }

  /* ---------------- guardado atómico ---------------- */
  async function guardar(A, val, archivo, usuario) {
    if (!val.ok) throw new Error("El lote tiene errores; no se guardó nada.");
    const p = await Nucleo.proyecto(A), t = Math.floor(Date.now() / 1000);
    const nuevasFilas = Object.values(val.nuevos).reduce((s, x) => s + x.length, 0), existentes = Object.values(val.existentes).reduce((s, x) => s + x, 0);
    if (val.repetido) return {repetido: true, nuevas: 0, existentes: val.total};
    const [funs, coms, incs, tipos] = await Promise.all([A.leer("funcion", {proyecto_id: p.id}), A.leer("compra", {proyecto_id: p.id}), A.leer("incidencia", {proyecto_id: p.id}), A.leer("tipo_incidencia", {})]);
    const id = {funcion: c => ({$ref: "F:" + c}), compra: c => ({$ref: "C:" + c}), incidencia: c => ({$ref: "I:" + c})};
    const fid = c => funs.find(f => f.codigo === c)?.id ?? (val.nuevos.Funciones.some(x => x.codigo_funcion === c) ? id.funcion(c) : null);
    const cid = c => coms.find(f => f.codigo_pedido === c)?.id ?? (val.nuevos.Compras.some(x => x.codigo_pedido === c) ? id.compra(c) : null);
    const iid = c => incs.find(f => f.codigo === c)?.id ?? (val.nuevos.Incidencias.some(x => x.codigo_incidencia === c) ? id.incidencia(c) : null);
    const ops = [];
    for (const x of val.nuevos.Funciones) ops.push({op: "insertar", tabla: "funcion", ref: "F:" + x.codigo_funcion, fila: {proyecto_id: p.id, sede_id: x.sede, codigo: x.codigo_funcion, pelicula: x.pelicula, sala: x.sala, inicio_utc: x.inicio, horario_estado: x.horario_estado, naturaleza: "SINTETICO"}});
    for (const x of val.nuevos.Compras) ops.push({op: "insertar", tabla: "compra", ref: "C:" + x.codigo_pedido, fila: {proyecto_id: p.id, codigo_pedido: x.codigo_pedido, funcion_id: fid(x.codigo_funcion), canal: x.canal, entradas: x.entradas, monto_centimos: x.monto_soles, estado_compra: x.estado_compra, estado_pago: x.estado_pago, estado_emision: x.estado_emision, estado_ingreso: x.estado_ingreso, fuente_estado: "DISPONIBLE", creado_utc: t, naturaleza: "SINTETICO"}});
    const inicioDe = async (fRef, pedido) => { const cod = pedido ? (val.nuevos.Compras.find(c => c.codigo_pedido === pedido)?.codigo_funcion ?? funs.find(f => f.id === coms.find(c => c.codigo_pedido === pedido)?.funcion_id)?.codigo) : fRef;
      const f = val.nuevos.Funciones.find(z => z.codigo_funcion === cod); return f ? f.inicio : funs.find(z => z.codigo === cod)?.inicio_utc ?? null; };
    for (const x of val.nuevos.Incidencias) {
      const tip = tipos.find(z => z.codigo === x.tipo), funCod = x.codigo_pedido ? (val.nuevos.Compras.find(c => c.codigo_pedido === x.codigo_pedido)?.codigo_funcion ?? funs.find(f => f.id === coms.find(c => c.codigo_pedido === x.codigo_pedido)?.funcion_id)?.codigo) : x.codigo_funcion;
      const ini = await inicioDe(funCod, null), resuelta = ["RESUELTO", "CERRADO"].includes(x.estado);
      ops.push({op: "insertar", tabla: "incidencia", ref: "I:" + x.codigo_incidencia, fila: {proyecto_id: p.id, codigo: x.codigo_incidencia, compra_id: x.codigo_pedido ? cid(x.codigo_pedido) : null, funcion_id: funCod ? fid(funCod) : null, sede_id: x.sede, tipo_codigo: x.tipo, pedido_declarado: x.codigo_pedido, cliente_id: null, descripcion: x.descripcion, canal_origen: x.canal_origen, estado: x.estado, provisional: x.codigo_pedido ? 0 : 1, responsable: x.responsable, siguiente_accion: resuelta ? "Sin acción pendiente" : tip.accion_sugerida, resultado: x.resultado, evidencia_resolucion: x.evidencia_resolucion, resuelto_por: resuelta ? x.responsable : null, a_tiempo: resuelta && ini != null ? (x.resolucion < ini ? 1 : 0) : null, naturaleza: "SINTETICO", version: 1, apertura_utc: x.apertura, actualizado_utc: x.resolucion ?? x.apertura, resuelto_utc: resuelta ? x.resolucion : null, cerrado_utc: x.estado === "CERRADO" ? x.resolucion : null}});
      ops.push({op: "insertar", tabla: "evento", fila: {incidencia_id: id.incidencia(x.codigo_incidencia), utc: x.apertura, tipo: "CARGA", canal: "CARGA", actor: usuario.nombre, detalle: `Registrado por carga desde Excel (${archivo})`, regla: "R25/R26"}});
      if (resuelta) ops.push({op: "insertar", tabla: "evento", fila: {incidencia_id: id.incidencia(x.codigo_incidencia), utc: x.resolucion, tipo: "RESOLUCION", canal: "CARGA", actor: x.responsable, detalle: `${x.resultado} · Evidencia: ${x.evidencia_resolucion}`, regla: "R21"}});
    }
    for (const x of val.nuevos.Contactos) ops.push({op: "insertar", tabla: "contacto", fila: {incidencia_id: iid(x.codigo_incidencia), canal: x.canal, clave_origen: x.clave_origen, registrado_utc: x.fecha_hora, detalle: x.detalle || "Contacto cargado desde Excel"}});
    for (const x of val.nuevos.Evidencias || []) ops.push({op: "insertar", tabla: "evidencia", fila: {proyecto_id: p.id, codigo: x.codigo_evidencia, incidencia_id: x.codigo_incidencia ? iid(x.codigo_incidencia) : null, tipo: x.tipo, naturaleza: "SINTETICO", fecha_utc: x.fecha, origen: x.origen, contenido: x.contenido, url_https: x.url_https}});
    ops.push({op: "insertar", tabla: "lote_importado", fila: {proyecto_id: p.id, huella_sha256: val.huella, archivo: String(archivo).slice(0, 200), fecha_utc: t, usuario: usuario.nombre, filas_leidas: val.total, filas_nuevas: nuevasFilas, filas_existentes: existentes, resumen: JSON.stringify(val.conteo)}});
    await A.aplicar(ops);
    return {repetido: false, nuevas: nuevasFilas, existentes, conteo: val.conteo};
  }

  /* ---------------- plantilla, ejemplo y reporte de errores ---------------- */
  function instrucciones() {
    const f = [["Plantilla de carga · Gestión de incidencias Cineplanet (datos sintéticos)"], [], ["Hoja", "Columna", "Obligatoria", "Descripción"]];
    for (const [h, cols] of Object.entries(HOJAS)) for (const [c, ob, , d] of cols) f.push([h + (OPCIONALES.includes(h) ? " (opcional)" : ""), c, ob ? "Sí" : "No", d]);
    f.push([], ["Reglas", "Las fechas usan hora de Lima. La fila 1 de cada hoja es el encabezado. Se aceptan valores, no fórmulas. Máximo 5.000 filas por lote."], ["", "Si hay un error, no se guarda ninguna fila. Repetir el mismo archivo no duplica registros."]);
    return {nombre: "Instrucciones", filas: f, anchos: [22, 24, 12, 90], sinEncabezado: true};
  }
  function hojasLibro(datos) {
    return [instrucciones(), ...Object.entries(HOJAS).map(([h, cols]) => ({nombre: h, filas: [cols.map(c => c[0]), ...(datos[h] || [])], anchos: cols.map(c => Math.max(14, c[0].length + 4)), formatos: Object.fromEntries(cols.map((c, i) => [i, c[2] === "fecha" ? "fecha" : c[2] === "monto" ? "decimal" : "texto"]))}))];
  }
  function plantilla() { return XLSX.escribir(hojasLibro({})); }
  function ejemplo(base = Math.floor(Date.now() / 1000)) {
    const d = m => new Date((base + m * 60) * 1000), sede = "CP Alcázar";
    const F = [["FUN-201", sede, "Avengers: Doomsday", "Sala 1", d(30), "CONFIRMADO"], ["FUN-202", sede, "Minotauro", "Sala 2", d(80), "CONFIRMADO"], ["FUN-203", "CP San Miguel", "Yo soy Rocky", "Sala 3", d(50), "CONFIRMADO"], ["FUN-204", sede, "Ratoncitos en apuros", "Sala 4", null, "DESCONOCIDO"]];
    const C = [], I = [], K = [];
    const tipos = ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T01", "T04", "T02", "T90"];
    for (let k = 0; k < 12; k++) {
      const n = 2001 + k, fun = F[k % 4][0], resuelto = k % 3 === 0;
      C.push([`PED-${n}`, fun, k % 2 ? "APP" : "WEB", 1 + (k % 3), 19 * (1 + (k % 3)), "CONFIRMADO", tipos[k] === "T02" ? "PENDIENTE" : tipos[k] === "T03" ? "DUPLICADO" : "CONFIRMADO", tipos[k] === "T01" ? "NO_EMITIDA" : "EMITIDA", tipos[k] === "T05" ? "RECHAZADO" : "NO_APLICA"]);
      I.push([`INC-${n}`, `PED-${n}`, null, F[k % 4][1], tipos[k], `Caso de carga ${n} (sintético)`, k % 4 === 0 ? "DIGITAL" : "CLIENTE", d(-40 + k), resuelto ? "RESUELTO" : ["NUEVO", "EN_VERIFICACION", "EN_ATENCION"][k % 3], resuelto ? "Boletería" : "Atención Digital", resuelto ? d(-20 + k) : null, resuelto ? "Entrada recuperada y entregada al cliente" : null, resuelto ? "Entrada validada en lector" : null]);
      K.push([`INC-${n}`, "CLIENTE", d(-40 + k), "Reporte inicial", `CARGA-${n}-1`]);
      if (k % 2) K.push([`INC-${n}`, "BOLETERIA", d(-30 + k), "Se acercó a boletería", `CARGA-${n}-2`]);
    }
    const Ev = [["EV-2001", "INC-2001", "REGISTRO", "Atención Digital", "Captura del cobro en la app (sintética)", "https://example.com", d(-39)]];
    return XLSX.escribir(hojasLibro({Funciones: F, Compras: C, Incidencias: I, Contactos: K, Evidencias: Ev}));
  }
  function reporteErrores(errores) {
    return XLSX.escribir([{nombre: "Errores", filas: [["Hoja", "Fila", "Campo", "Código", "Mensaje"], ...errores.map(e => [e.hoja, e.fila, e.campo, e.codigo, e.mensaje])], anchos: [14, 8, 22, 22, 80]}]);
  }
  const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  return {HOJAS, OPCIONALES, MAX_FILAS, validar, guardar, plantilla, ejemplo, reporteErrores, b64, fmtF};
})();
