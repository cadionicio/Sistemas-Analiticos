"use strict";
/* Almacén de la solución EXE: base SQLite local a través del puente de la ventana de aplicación.
   La sesión, el rol y los permisos se validan en la aplicación (Python), no solo en la pantalla. */
const AlmacenEXE = (() => {
  let api;
  function preparar() {
    if (api) return Promise.resolve(true);
    return new Promise((ok, no) => {
      const listo = () => { api = window.pywebview.api; ok(true); };
      if (window.pywebview?.api?.aplicar) return listo();
      window.addEventListener("pywebviewready", listo, {once: true});
      setTimeout(() => !api && no(Object.assign(new Error("No se pudo conectar con la base de datos local. Cierre y vuelva a abrir PC08.exe."), {codigo: "SIN_ALMACEN"})), 10000);
    });
  }
  async function llamar(metodo, ...args) {
    await preparar();
    const r = await api[metodo](...args);
    if (r && r.ok === false) throw Object.assign(new Error(r.mensaje || "Error de la base local"), {codigo: r.codigo, vigente: r.vigente});
    return r && "datos" in r ? r.datos : r;
  }
  return {nombre: "EXE", preparar,
    leer: (t, f = {}, c = null) => llamar("leer", t, f, c), obtener: (t, id) => llamar("obtener", t, id), aplicar: ops => llamar("aplicar", ops),
    estadoSemilla: () => llamar("estado_semilla"), sembrar: (v, tablas, ops) => llamar("sembrar", v, tablas, ops),
    iniciarSesion: (c, k) => llamar("iniciar_sesion", c, k), elegirRol: r => llamar("elegir_rol", r), cerrarSesion: () => llamar("cerrar_sesion"), cambiarModo: (m, k) => llamar("cambiar_modo", m, k),
    siguienteCodigo: (t, p) => llamar("siguiente_codigo", t, p),
    consultarEnlace: url => llamar("consultar_enlace", url), consultarFeriados: anio => llamar("consultar_feriados", anio), info: () => llamar("info"), guardarArchivo: (n, b64) => llamar("guardar_archivo", n, b64), respaldar: () => llamar("respaldar"), listarRespaldos: () => llamar("listar_respaldos"), restaurar: a => llamar("restaurar", a), cerrar: () => llamar("cerrar")};
})();
