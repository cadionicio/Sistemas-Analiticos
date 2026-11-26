"use strict";
/* Almacén de la solución HTML: base IndexedDB del navegador (aislada del EXE). */
const AlmacenIDB = (() => {
  const NOMBRE = "PC08_Cineplanet", VER = 3;
  const ESQUEMA = {
    proyecto: [["codigo", "codigo", true]],
    sede: [["proyecto_id", "proyecto_id"], ["u_codigo", ["proyecto_id", "codigo"], true]],
    funcion: [["proyecto_id", "proyecto_id"], ["u_codigo", ["proyecto_id", "codigo"], true]],
    compra: [["proyecto_id", "proyecto_id"], ["u_pedido", ["proyecto_id", "codigo_pedido"], true]],
    tipo_incidencia: [["codigo", "codigo", true]],
    incidencia: [["proyecto_id", "proyecto_id"], ["u_codigo", ["proyecto_id", "codigo"], true], ["compra_id", "compra_id"], ["cliente_id", "cliente_id"]],
    configuracion: [["clave", "clave", true]],
    usuario: [["correo", "correo", true]],
    verificacion: [["incidencia_id", "incidencia_id"]],
    lote_importado: [["u_huella", ["proyecto_id", "huella_sha256"], true]],
    instrumento_version: [["proyecto_id", "proyecto_id"], ["u_version", ["proyecto_id", "codigo", "version"], true]],
    contacto: [["incidencia_id", "incidencia_id"], ["clave_origen", "clave_origen", true]],
    evento: [["incidencia_id", "incidencia_id"]],
    evidencia: [["proyecto_id", "proyecto_id"], ["u_codigo", ["proyecto_id", "codigo"], true]],
    verificacion_enlace: [],
  };
  let db;
  const prom = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });

  async function abrir() {
    if (db) return db;
    if (!window.indexedDB) throw Object.assign(new Error("Este navegador no permite guardar datos locales (IndexedDB). Use Chrome o Edge actualizados."), {codigo: "SIN_ALMACEN"});
    const r = indexedDB.open(NOMBRE, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const [t, idx] of Object.entries(ESQUEMA)) {
        const s = d.objectStoreNames.contains(t) ? r.transaction.objectStore(t) : d.createObjectStore(t, {keyPath: "id", autoIncrement: true});
        idx.forEach(([n, k, u]) => { if (!s.indexNames.contains(n)) s.createIndex(n, k, {unique: !!u}); });
      }
    };
    db = await prom(r);
    try { await navigator.storage?.persist?.(); } catch (e) { /* opcional */ }
    return db;
  }

  async function leer(tabla, filtro = {}) {
    const d = await abrir(); const s = d.transaction(tabla).objectStore(tabla);
    const claves = Object.keys(filtro);
    let filas;
    const simple = claves.find(k => s.indexNames.contains(k));
    if (simple && filtro[simple] != null) filas = await prom(s.index(simple).getAll(filtro[simple]));
    else filas = await prom(s.getAll());
    return filas.filter(f => claves.every(k => f[k] === filtro[k]));
  }
  async function obtener(tabla, id) { const d = await abrir(); return (await prom(d.transaction(tabla).objectStore(tabla).get(id))) || null; }

  async function aplicar(ops, vaciar = []) {
    const d = await abrir();
    const tablas = [...new Set([...ops.map(o => o.tabla), ...vaciar])];
    return new Promise((ok, no) => {
      const tx = d.transaction(tablas, "readwrite"), refs = {}, ids = [];
      let fallo = null;
      const res = v => (v && typeof v === "object" && "$ref" in v) ? refs[v.$ref] : v;
      tx.oncomplete = () => ok({ids, refs});
      tx.onabort = () => no(fallo || Object.assign(new Error("La operación no se guardó."), {codigo: "ABORTADA"}));
      const paso = k => {
        if (k >= ops.length) return;
        const o = ops[k], s = tx.objectStore(o.tabla);
        if (o.op === "insertar") {
          const fila = Object.fromEntries(Object.entries(o.fila).map(([c, v]) => [c, res(v)]));
          const r = s.add(fila);
          r.onsuccess = () => { ids.push(r.result); if (o.ref) refs[o.ref] = r.result; paso(k + 1); };
          r.onerror = ev => { ev.preventDefault(); fallo = Object.assign(new Error(r.error?.name === "ConstraintError" ? "Registro duplicado" : String(r.error)), {codigo: r.error?.name === "ConstraintError" ? "UNICO" : "ERROR"}); tx.abort(); };
        } else if (o.op === "actualizar") {
          const g = s.get(res(o.id));
          g.onsuccess = () => {
            const f = g.result;
            if (!f) { fallo = Object.assign(new Error("Registro inexistente"), {codigo: "NO_EXISTE"}); return tx.abort(); }
            if (o.version != null && f.version !== o.version) { fallo = Object.assign(new Error("Otro usuario guardó un cambio antes."), {codigo: "CONFLICTO", vigente: f}); return tx.abort(); }
            const n = {...f, ...Object.fromEntries(Object.entries(o.cambios).map(([c, v]) => [c, res(v)]))};
            if (o.version != null) n.version = f.version + 1;
            const p = s.put(n); p.onsuccess = () => { ids.push(n.id); paso(k + 1); };
            p.onerror = ev => { ev.preventDefault(); fallo = Object.assign(new Error("Registro duplicado"), {codigo: "UNICO"}); tx.abort(); };
          };
        }
      };
      vaciar.forEach(t => tx.objectStore(t).clear());
      paso(0);
    });
  }
  async function estadoSemilla() { return (await leer("configuracion", {clave: "semilla"}))[0]?.valor ?? null; }
  async function sembrar(version, tablas, ops) { await aplicar(ops, tablas); return true; }
  async function siguienteCodigo(tabla, prefijo) {
    const n = (await leer(tabla, {})).reduce((m, x) => x.codigo?.startsWith(prefijo) ? Math.max(m, parseInt(x.codigo.slice(prefijo.length), 10) || 0) : m, 0);
    return `${prefijo}${String(n + 1).padStart(4, "0")}`;
  }

  async function consultarEnlace(url) {
    if (!navigator.onLine) return {estado: "NO_VERIFICADO", codigo_http: null, detalle: "El equipo no tiene conexión a internet. Los datos siguen disponibles en modo local."};
    const c = new AbortController(); const tm = setTimeout(() => c.abort(), 8000);
    try {
      await fetch(url, {method: "HEAD", mode: "no-cors", cache: "no-store", redirect: "manual", credentials: "omit", signal: c.signal});
      return {estado: "DISPONIBLE", codigo_http: null, detalle: "El sitio respondió. El navegador no muestra el código HTTP en esta solución; el contenido se revisa manualmente."};
    } catch (e) {
      return {estado: "NO_VERIFICADO", codigo_http: null, detalle: e.name === "AbortError" ? "Sin respuesta en 8 segundos. Los datos siguen disponibles en modo local." : "No se pudo conectar con el sitio. Los datos siguen disponibles en modo local."};
    } finally { clearTimeout(tm); }
  }

  /* Descarga real de feriados oficiales del Perú desde el navegador (el servicio permite consultas CORS) */
  async function consultarFeriados(anio) {
    const url = `https://date.nager.at/api/v3/PublicHolidays/${Number(anio)}/PE`;
    if (!navigator.onLine) return {estado: "NO_VERIFICADO", codigo_http: null, detalle: "El equipo no tiene conexión a internet. Se conserva la última descarga y los datos siguen disponibles en modo local.", datos: null};
    const c = new AbortController(); const tm = setTimeout(() => c.abort(), 8000);
    try {
      const r = await fetch(url, {method: "GET", mode: "cors", cache: "no-store", redirect: "error", credentials: "omit", headers: {Accept: "application/json"}, signal: c.signal});
      if (!r.ok) return {estado: "NO_DISPONIBLE", codigo_http: r.status, detalle: `El servicio respondió ${r.status}.`, datos: null};
      const txt = await r.text(); if (txt.length > 300000) return {estado: "NO_VERIFICADO", codigo_http: r.status, detalle: "La respuesta supera el tamaño permitido.", datos: null};
      return {estado: "DISPONIBLE", codigo_http: r.status, detalle: `El servicio respondió ${r.status}.`, datos: JSON.parse(txt)};
    } catch (e) {
      return {estado: "NO_VERIFICADO", codigo_http: null, detalle: e.name === "AbortError" ? "Sin respuesta en 8 segundos. Se conserva la última descarga." : e instanceof SyntaxError ? "La respuesta no tiene el formato esperado (JSON)." : "No se pudo conectar con el servicio. Se conserva la última descarga y los datos siguen disponibles en modo local.", datos: null};
    } finally { clearTimeout(tm); }
  }

  async function info() {
    let persistente = null; try { persistente = await navigator.storage?.persisted?.(); } catch (e) {}
    return {modo_app: "HTML", almacen: "Base de datos del navegador (IndexedDB)", ubicacion: `${location.pathname.split("/").slice(-2, -1)[0] || "carpeta"} · ${navigator.userAgent.includes("Edg/") ? "Microsoft Edge" : navigator.userAgent.includes("Chrome/") ? "Google Chrome" : "Navegador"}`, persistente, integridad: "ok"};
  }
  async function guardarArchivo(nombre, b64) {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bin], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const a = document.createElement("a"); a.href = url; a.download = nombre; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return {guardado: true, ruta: "Carpeta de descargas del navegador", bytes: bin.length};
  }
  /* Respaldo del navegador: archivo JSON con todas las tablas; la restauración reemplaza la base en una sola transacción. */
  async function exportarTodo() { const d = await abrir(), r = {formato: "PC08-respaldo", version: VER, fecha: new Date().toISOString(), tablas: {}}; for (const t of Object.keys(ESQUEMA)) r.tablas[t] = await leer(t, {}); return r; }
  async function restaurarTodo(json) {
    if (json?.formato !== "PC08-respaldo" || !json.tablas?.incidencia) throw Object.assign(new Error("El archivo no es un respaldo válido de PC08."), {codigo: "RESPALDO"});
    const ops = []; for (const [t, filas] of Object.entries(json.tablas)) if (ESQUEMA[t]) filas.forEach(f => ops.push({op: "insertar", tabla: t, fila: f}));
    await aplicar(ops, Object.keys(ESQUEMA)); return {incidencias: json.tablas.incidencia.length};
  }
  return {nombre: "HTML", guardarArchivo, exportarTodo, restaurarTodo, leer, obtener, aplicar, estadoSemilla, sembrar, siguienteCodigo, cerrarSesion: async () => true, consultarEnlace, consultarFeriados, info, preparar: abrir};
})();
