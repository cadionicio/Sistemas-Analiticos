"use strict";
/* Cineplanet · Gestión de incidencias — interfaz común de PC08.exe y PC08.html (soluciones aisladas) */
const A = location.protocol === "file:" ? AlmacenIDB : AlmacenEXE;
const SOLUCION = A.nombre;
const $app = document.getElementById("app");
const E = {sede: sessionStorage.getItem("pc08_sede"), usuario: JSON.parse(sessionStorage.getItem("pc08_usuario") || "null"), modo: "DEMO", ctx: null, sel: null, filtros: {q: "", urgencia: "", estado: "", tipo: "", sede_id: ""}, pagina: 1, timer: null, guardado: null};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const hora = () => new Date().toLocaleTimeString("es-PE", {hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima"});
const fmtNum = (n, dec = 0) => Number(n).toLocaleString("de-DE", {minimumFractionDigits: dec, maximumFractionDigits: dec}); /* 1.234,10 (decisión P-07) */
const plural = (n, s, p) => `${fmtNum(n)} ${n === 1 ? s : p}`;
const v = id => (document.getElementById(id)?.value ?? "").trim();
const espera = ms => new Promise(r => setTimeout(r, ms));
function anunciar(t) { const a = document.getElementById("anuncio"); a.textContent = ""; setTimeout(() => a.textContent = t, 30); }
function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.innerHTML = I.check + `<span>${esc(t)}</span>`; document.getElementById("toasts").append(d); setTimeout(() => d.remove(), 5000); }
function marcarGuardado() { E.guardado = hora(); const g = document.getElementById("guardado"); if (g) g.innerHTML = `${I.escudo}Guardado · ${E.guardado}`; }

const I = {
  check: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
  alerta: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>',
  reloj: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  escudo: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
  bd: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
  user: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
  flecha: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  atras: '<svg class="ic" style="width:22px;height:22px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  ticket: '<svg style="width:34px;height:34px;color:var(--accion)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 8a2 2 0 002-2h14a2 2 0 002 2v2a2 2 0 000 4v2a2 2 0 00-2 2H5a2 2 0 00-2-2v-2a2 2 0 000-4z"/></svg>',
  enlace: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></svg>',
  buscar: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
};
const RIC = {
  CLIENTE: '<svg viewBox="0 0 64 64" fill="none" stroke="#081F3E" stroke-width="3" aria-hidden="true"><circle cx="32" cy="20" r="8"/><circle cx="16" cy="25" r="6"/><circle cx="48" cy="25" r="6"/><path d="M18 50c0-9 6-15 14-15s14 6 14 15M4 50c0-7 4-12 10-12M60 50c0-7-4-12-10-12"/></svg>',
  DIGITAL: '<svg viewBox="0 0 64 64" fill="none" stroke="#081F3E" stroke-width="3" aria-hidden="true"><rect x="10" y="12" width="44" height="30" rx="3"/><path d="M4 48h56l-4 4H8z"/><path d="M24 30v-4a8 8 0 0116 0v4"/><rect x="21" y="28" width="5" height="7" rx="2"/><rect x="38" y="28" width="5" height="7" rx="2"/></svg>',
  BOLETERIA: '<svg viewBox="0 0 64 64" fill="none" stroke="#081F3E" stroke-width="3" aria-hidden="true"><path d="M8 22l40-10 3 9a5 5 0 004 7l3 9-40 10-3-9a5 5 0 00-4-7z"/><path d="M40 16l6 24" stroke-dasharray="3 4"/></svg>',
  SUPERVISION: '<svg viewBox="0 0 64 64" fill="none" stroke="#081F3E" stroke-width="3" aria-hidden="true"><path d="M8 52V30M22 52V18M36 52V36M50 52V10"/><path d="M4 56h56"/></svg>',
};

/* ---------------------------------------------------- barra de actividad (trabajo visible del sistema) */
const Actividad = {
  ultimo: null,
  vigente() { return this.ultimo && Date.now() - this.ultimo.t < 2000 ? this.ultimo.html : ""; },
  async ejecutar(titulo, pasos) {
    const caja = () => document.getElementById("actividad") || {set innerHTML(x) {}, querySelector() { return null; }};
    let i = 0, res;
    const pintar = (clase = "", extra = "") => {
      const pct = clase === "ok" ? 100 : Math.round((i / pasos.length) * 100);
      const html = `<div class="act ${clase}" role="status" aria-live="polite"><div class="fila1"><span class="tit">${clase === "ok" ? I.check : clase === "err" ? I.alerta : I.reloj} ${esc(titulo)}</span>
      <span class="fase">${clase === "ok" ? `Completado a las ${hora()} · ${pasos.length} de ${pasos.length} pasos` : clase === "err" ? esc(extra) : `Paso ${i + 1} de ${pasos.length}: ${esc(pasos[i].texto)}…`}</span><span class="num">${pct} %</span>
      ${clase ? `<button class="cerrar" aria-label="Cerrar aviso" onclick="document.getElementById('actividad').innerHTML='';Actividad.ultimo=null">×</button>` : ""}</div>
      <div class="barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(titulo)}"><i style="width:${pct}%"></i></div>
      <ol>${pasos.map((p, k) => `<li class="${k < i || clase === "ok" ? "hecho" : k === i && clase === "err" ? "fallo" : k === i ? "actual" : ""}">${k < i || clase === "ok" ? "✓" : k === i && clase === "err" ? "✕" : `${k + 1}.`} ${esc(p.texto)}</li>`).join("")}</ol></div>`;
      caja().innerHTML = html; if (clase === "ok") this.ultimo = {t: Date.now(), html}; else this.ultimo = null;
    };
    anunciar(`${titulo}: iniciado`);
    try {
      for (i = 0; i < pasos.length; i++) { pintar(); const r = await pasos[i].fn(res); if (r !== undefined) res = r; await espera(120); }
      i = pasos.length; pintar("ok"); anunciar(`${titulo}: completado`);
      setTimeout(() => { const c = document.getElementById("actividad"); if (c?.querySelector(".act.ok")) c.innerHTML = ""; }, 2000);
      return res;
    } catch (e) { pintar("err", e.message || String(e)); anunciar(`${titulo}: no se completó`); throw e; }
  },
};

async function api(fn) {
  try { return await fn(); }
  catch (e) {
    if (e instanceof Nucleo.ErrorValidacion) throw {campos: e.campos, mensaje: "Revisa los campos marcados."};
    if (["SESION"].includes(e.codigo)) { salir(true); }
    throw {codigo: e.codigo, mensaje: e.message || String(e), vigente: e.vigente};
  }
}
function etiquetaPrioridad(p) {
  const m = {CRITICO: ["rojo", I.alerta], URGENTE: ["amarillo", I.reloj], VERIFICAR_HORARIO: ["amarillo", I.reloj], NORMAL: ["gris", ""], FUNCION_INICIADA: ["rojo", I.alerta], CERRADO: ["verde", I.check]}[p.nivel] || ["gris", ""];
  return `<span class="et ${m[0]}">${m[1]}${esc(p.etiqueta)}</span>`;
}
function etiquetaEstado(e, t) { return `<span class="et ${{NUEVO: "gris", EN_VERIFICACION: "azul", EN_ATENCION: "azul", ESCALADO: "amarillo", RESUELTO: "verde", CERRADO: "verde"}[e] || "gris"}">${esc(t)}</span>`; }
function etiquetaParte(cod, txt) { const c = ["CONFIRMADO", "EMITIDA", "VALIDADO", "NO_APLICA"].includes(cod) ? "verde" : ["FALLIDO", "RECHAZADO", "DUPLICADO"].includes(cod) ? "rojo" : "amarillo"; return `<span class="et ${c}">${esc(txt)}</span>`; }
const restante = p => p.minutos == null ? "—" : (p.minutos < 0 ? `Inició hace ${-p.minutos} min` : `${p.minutos} min`);
function errorVista(e, reintentar) { return `<div class="aviso err" role="alert">${I.alerta}<div><b>No se pudo completar</b>${esc(e.mensaje || e)}${reintentar ? `<div style="margin-top:8px"><button class="btn sec" onclick="${reintentar}">Volver a intentar</button></div>` : ""}</div></div>`; }
function errores(cont, e) {
  document.querySelectorAll(".campo").forEach(x => x.classList.remove("invalido")); document.querySelectorAll(".error").forEach(x => x.textContent = "");
  let primero;
  if (e.campos) for (const [k, m] of Object.entries(e.campos)) { if (!m) continue; const el = document.getElementById("e-" + k); if (el) { el.textContent = m; document.getElementById("c-" + k)?.classList.add("invalido"); primero ??= document.getElementById(k); } }
  document.getElementById(cont).innerHTML = e.campos ? `<div class="aviso err" role="alert">${I.alerta}<div><b>Revisa los campos marcados</b>Tus datos siguen en el formulario.</div></div>`
    : e.codigo === "CONFLICTO" ? `<div class="aviso err" role="alert">${I.alerta}<div><b>Otro usuario guardó un cambio antes</b>Se conservó el primer cambio confirmado. <button class="btn sec" onclick="router()">Ver versión vigente</button></div></div>`
    : errorVista(e);
  primero?.focus();
}
const campo = (id, etiqueta, control, ayuda = "") => `<div class="campo" id="c-${id}"><label for="${id}">${etiqueta}</label>${control}${ayuda ? `<span class="ayuda">${ayuda}</span>` : ""}<span class="error" id="e-${id}"></span></div>`;

/* ---------------------------------------------------- permisos de navegación por rol */
const MENU = {
  DIGITAL: [["bandeja", "Bandeja"], ["buscar", "Buscar caso"]],
  BOLETERIA: [["mostrador", "Mostrador"], ["buscar", "Buscar código"]],
  SUPERVISION: [["panel", "Panel"], ["bandeja", "Bandeja"], ["datos", "Datos"], ["dt", "Design Thinking"], ["indicadores", "Indicadores"], ["exportaciones", "Exportaciones"], ["configuracion", "Configuración"], ["operacion", "Operación"]],
};
const INICIO = {CLIENTE: "#/c/reportar", DIGITAL: "#/bandeja", BOLETERIA: "#/mostrador", SUPERVISION: "#/panel"};
const VISTAS = {CLIENTE: ["Cliente", "Reportar una incidencia y seguir mis casos"], DIGITAL: ["Atención Digital", "Bandeja priorizada, verificación, vinculación y derivación"], BOLETERIA: ["Boletería", "Mostrador: retomar por código y resolver en sede"], SUPERVISION: ["Supervisión", "Panel de control, datos, indicadores y operación"]};
const puede = (rol, ruta) => ruta === "exp" ? ["DIGITAL", "BOLETERIA", "SUPERVISION"].includes(rol) : (MENU[rol] || []).some(m => m[0] === ruta);
const varias = () => (E.usuario?.roles || []).length > 1;
/* Selector de módulo: con una sola sesión se pasa entre los módulos autorizados de la cuenta */
function selectorModulo(oscuro = true) {
  if (!varias()) return "";
  return `<label class="sel-modulo ${oscuro ? "" : "claro"}"><span>Módulo</span><select aria-label="Cambiar de módulo" onchange="cambiarModulo(this.value)">${E.usuario.roles.map(r => `<option value="${r}" ${r === E.usuario.rol ? "selected" : ""}>${VISTAS[r][0]}</option>`).join("")}</select></label>`;
}
async function cambiarModulo(rol) {
  try {
    const x = await api(() => Nucleo.elegirRol(A, E.usuario, rol));
    E.usuario = x; sessionStorage.setItem("pc08_usuario", JSON.stringify(x)); E.ctx = null; E.sel = null; E.filtros = {q: "", urgencia: "", estado: "", tipo: "", sede_id: ""};
    if (location.hash === INICIO[rol]) router(); else location.hash = INICIO[rol];
  } catch (e) { toast(e.mensaje || "No se pudo cambiar de módulo"); }
}

function cabecera() {
  const u = E.usuario;
  return `<header class="cab"><a class="placa" href="${varias() ? "#/vistas" : INICIO[u.rol]}" aria-label="Cineplanet, ir al inicio"><img src="img/logo_cabecera.svg" alt=""></a><span class="sep"></span><span class="titulo">Gestión de incidencias</span>
  <div class="der"><span class="guardado" id="guardado">${I.escudo}${E.guardado ? `Guardado · ${E.guardado}` : "Sin cambios pendientes"}</span><span class="chip-osc">${I.bd}Datos sintéticos</span>
  ${E.modo === "DEMO" ? `<span class="chip-modo">Demostración</span>` : ""}<span class="num" id="reloj" title="Hora de Lima">${I.reloj} Hora de Lima ${hora()}</span><span class="sep"></span>
  <strong>${I.user} ${esc(u.nombre)} · ${esc(Nucleo.ROLES[u.rol])}${u.sede && u.rol === "BOLETERIA" ? ` · ${esc(u.sede)}` : ""}</strong>
  ${selectorModulo()}<button class="btn-cab" onclick="salir()">Cerrar sesión</button></div></header>`;
}
function interna(activa, migas, contenido) {
  const tabs = (MENU[E.usuario.rol] || []).map(([k, t]) => `<a href="#/${k}" class="${k === activa ? "activa" : ""}" ${k === activa ? 'aria-current="page"' : ""}>${t}</a>`).join("");
  $app.innerHTML = cabecera() + `<nav class="navsec" aria-label="Módulos">${tabs}<span class="ctx sede-global">${I.bd}<label for="gsede">Sede</label><select id="gsede" onchange="cambiarSede(this.value)" aria-label="Sede para todos los módulos">${opcionesSede()}</select></span></nav><div id="actividad">${Actividad.vigente()}</div>
  <main id="contenido" tabindex="-1"><div class="migas"><a href="${INICIO[E.usuario.rol]}">Inicio</a>${migas.map(([t, h]) => h ? ` › <a href="${h}">${esc(t)}</a>` : ` › ${esc(t)}`).join("")}</div>${contenido}</main>`;
}
/* Sede global: «Todas (general)» o un cine; se aplica a todos los módulos del personal y se conserva al navegar */
/* Mientras el usuario no elija una sede, Boletería trabaja con su sede asignada y los demás módulos con «Todas las sedes» */
function sedeAct() { if (E.sede == null || E.sede === "" && sessionStorage.getItem("pc08_sede_elegida") !== "1") return E.usuario?.rol === "BOLETERIA" && E.usuario.sede_id ? String(E.usuario.sede_id) : ""; return E.sede; }
function opcionesSede() {
  const sedes = E.ctx?.sedes || [], act = sedeAct();
  if (!sedes.length) { ctx().then(() => { const g = document.getElementById("gsede"); if (g && g.options.length <= 1) g.innerHTML = opcionesSede(); }).catch(() => {}); }
  return `<option value="">Todas las sedes (general)</option>${sedes.map(x => `<option value="${x.id}" ${String(x.id) === act ? "selected" : ""}>${esc(x.nombre)}${x.piloto ? " · piloto" : ""}</option>`).join("")}`;
}
function nombreSede(id = sedeAct()) { return id ? (E.ctx?.sedes || []).find(x => String(x.id) === String(id))?.nombre || "Sede" : "Todas las sedes"; }
function cambiarSede(v) {
  E.sede = v || ""; sessionStorage.setItem("pc08_sede", E.sede); sessionStorage.setItem("pc08_sede_elegida", "1");
  E.filtros.sede_id = E.sede; E.pagina = 1; if (E.filtrosInd) E.filtrosInd.sede_id = E.sede;
  router();
}
function cabCliente(activa) {
  return `<header class="cab-movil"><a href="${varias() ? "#/vistas" : "#/c/reportar"}" aria-label="Ir al inicio"><img src="img/01_cineplanet_isotipo_fondo_azul.svg" alt=""></a><div><div class="n">Cineplanet</div><small>Hola, ${esc(E.usuario.nombre.split(" ")[0])}</small></div>${selectorModulo() || `<span class="chip-osc">${I.bd}Datos sintéticos</span>`}</header>
  <nav class="cli-menu" aria-label="Menú del cliente"><a href="#/c/reportar" class="${activa === "reportar" ? "activa" : ""}">Reportar</a><a href="#/c/casos" class="${activa === "casos" ? "activa" : ""}">Mis casos</a><button onclick="salir()">Cerrar sesión</button></nav><div id="actividad">${Actividad.vigente()}</div>`;
}
const pieCliente = `<p class="pie-legal">${I.escudo} Información de demostración · datos sintéticos</p>`;
async function salir(silencioso) { try { await A.cerrarSesion(); } catch (e) {} sessionStorage.removeItem("pc08_usuario"); sessionStorage.removeItem("pc08_sede"); sessionStorage.removeItem("pc08_sede_elegida"); E.sede = null; E.usuario = null; E.ctx = null; if (!silencioso) toast("Sesión cerrada"); location.hash = "#/ingreso"; }

/* ---------------------------------------------------- 01 · inicio de sesión y vistas autorizadas */
async function vistaIngreso() {
  E.modo = await Nucleo.modo(A);
  const demo = E.modo === "DEMO", cuenta = demo ? await Nucleo.cuentaDemo(A) : null;
  $app.innerHTML = `<div id="actividad">${Actividad.vigente()}</div><section class="ingreso">${mosaico()}
  <div class="tarjeta-ingreso"><img class="logo-ingreso" src="img/03_cineplanet_logo_vertical.svg" alt="Cineplanet"><h1>Inicia sesión</h1><p class="sub">Gestión de incidencias</p>
  <form id="fl" novalidate>${campo("correo", "Correo", `<input id="correo" type="email" autocomplete="username" value="${esc(cuenta?.correo || "")}">`)}${campo("clave", "Contraseña", `<input id="clave" type="password" autocomplete="current-password" value="${esc(cuenta?.clave || "")}">`)}
  <div id="lerr"></div><button class="btn grande" id="entrar" type="submit">Iniciar sesión ${I.flecha}</button></form>
  <div class="interruptor"><label><input type="checkbox" id="sw" ${demo ? "checked" : ""}> <span>Datos de demostración</span></label></div><div id="modoform"></div></div>
  <p class="pie-legal">${I.escudo} Versión ${Nucleo.VERSION} · ${SOLUCION === "EXE" ? "aplicación de escritorio" : "aplicación en navegador"}</p></section>`;
  document.getElementById("fl").onsubmit = async ev => {
    ev.preventDefault(); const b = document.getElementById("entrar"); b.disabled = true;
    try {
      const u = await Actividad.ejecutar("Iniciando sesión", [{texto: "Validando credenciales", fn: () => api(() => Nucleo.iniciarSesion(A, v("correo"), document.getElementById("clave").value))}, {texto: "Cargando vistas autorizadas", fn: async u => u}]);
      E.usuario = u; sessionStorage.setItem("pc08_usuario", JSON.stringify(u)); location.hash = "#/vistas";
    } catch (e) { b.disabled = false; errores("lerr", e); }
  };
  const sw = document.getElementById("sw"), mf = document.getElementById("modoform");
  sw.onchange = () => {
    if (!sw.checked) {
      mf.innerHTML = `<div class="aviso pend">${I.alerta}<div><b>¿Desactivar los datos de demostración?</b>Se pedirán las credenciales reales de cada cuenta.<div class="fila" style="margin-top:8px"><button class="btn" id="okprod">Desactivar</button><button class="btn sec" id="noprod">Cancelar</button></div></div></div>`;
      document.getElementById("noprod").onclick = () => { sw.checked = true; mf.innerHTML = ""; };
      document.getElementById("okprod").onclick = async () => { await api(() => Nucleo.cambiarModo(A, "PRODUCCION")); vistaIngreso(); };
    } else {
      mf.innerHTML = `<form id="fdemo" class="aviso info" style="display:block">${campo("csup", "Contraseña del personal", `<input id="csup" type="password">`)}<div id="derr"></div><div class="fila"><button class="btn">Activar demostración</button><button type="button" class="btn sec" id="nodemo">Cancelar</button></div></form>`;
      document.getElementById("nodemo").onclick = () => { sw.checked = false; mf.innerHTML = ""; };
      document.getElementById("csup").focus();
      document.getElementById("fdemo").onsubmit = async ev => { ev.preventDefault(); try { await api(() => Nucleo.cambiarModo(A, "DEMO", document.getElementById("csup").value)); vistaIngreso(); } catch (e) { errores("derr", e); } };
    }
  };
}
const mosaico = () => `<div class="mosaico" style="right:150px;top:40px">${["#F89500", "#8CC63F", "#00B5B8", "#FFD400", "#00A3A6"].map((c, i) => `<i style="background:${c};left:${(i % 3) * 92}px;top:${Math.floor(i / 3) * 64 + (i % 3) * 20}px"></i>`).join("")}</div><div class="mosaico" style="left:10px;bottom:150px">${["#E5195E", "#F89500", "", "#B5197A", "#E5195E"].map((c, i) => c ? `<i style="background:${c};left:${(i % 3) * 92}px;top:${Math.floor(i / 3) * 64 + (i % 3) * 20}px"></i>` : "").join("")}</div>`;
function vistaVistas() {
  const u = E.usuario;
  $app.innerHTML = `<div id="actividad">${Actividad.vigente()}</div><section class="ingreso">${mosaico()}<div class="tarjeta-ingreso ancho"><img class="logo-ingreso chico" src="img/03_cineplanet_logo_vertical.svg" alt="Cineplanet">
  <h1>Hola, ${esc(u.nombre.split(" ")[0])}</h1><p class="sub">${u.roles.length > 1 ? "Elige a qué vista deseas ingresar." : "Tu acceso autorizado:"}</p>
  <div class="cuentas v${Math.min(u.roles.length, 4)}">${u.roles.map(r => `<button type="button" class="rol" data-rol="${r}">${RIC[r]}<span>${VISTAS[r][0]}</span><small>${VISTAS[r][1]}</small></button>`).join("")}</div>
  <div id="verr"></div><button class="link" onclick="salir()">Cerrar sesión</button></div></section>`;
  document.querySelectorAll("[data-rol]").forEach(b => b.onclick = async () => {
    try { const x = await api(() => Nucleo.elegirRol(A, E.usuario, b.dataset.rol)); E.usuario = x; sessionStorage.setItem("pc08_usuario", JSON.stringify(x)); E.ctx = null; E.filtros = {q: "", urgencia: "", estado: "", tipo: "", sede_id: ""}; location.hash = INICIO[x.rol]; }
    catch (e) { errores("verr", e); }
  });
}

/* ---------------------------------------------------- cliente: 02 reportar, 03 recibido, 04/13 seguimiento y resultado, mis casos */
async function ctx() { if (!E.ctx) E.ctx = await api(() => Nucleo.contexto(A, E.usuario)); return E.ctx; }
async function vistaClienteReportar() {
  $app.innerHTML = cabCliente("reportar") + `<div class="movil"><p>Cargando…</p></div>`;
  let c; try { c = await ctx(); } catch (e) { document.querySelector(".movil").innerHTML = errorVista(e, "router()"); return; }
  const clave = sessionStorage.getItem("clave_envio") || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  sessionStorage.setItem("clave_envio", clave);
  const sedeIni = c.piloto.id;
  document.querySelector(".movil").innerHTML = `<button class="volver" onclick="location.hash='#/c/casos'">${I.atras} Mis casos</button>
  <h1>Reportar incidencia</h1><p class="sub">Completa los datos de tu compra para recibir ayuda.</p>
  <form class="tarjeta" id="f" novalidate>
   <div class="funcion-box">${I.ticket}<div><small>Tu función</small><div style="font-weight:800;font-size:17px" id="fpel">—</div><small id="fhora"></small></div></div>
   ${campo("pedido", "Identificación de pedido", `<input id="pedido" autocomplete="off" placeholder="Ej.: PED-0418">`, "Si no lo tienes, envía el reporte igual: lo verificaremos.")}
   ${campo("sede_id", "Sede", `<select id="sede_id">${c.sedes.map(s => `<option value="${s.id}" ${s.id === sedeIni ? "selected" : ""}>${esc(s.nombre)}</option>`).join("")}</select>`)}
   <div class="grid2">${campo("pelicula", "Película", `<select id="pelicula"></select>`)}${campo("funcion_id", "Horario", `<select id="funcion_id"></select>`)}</div><span class="ayuda" style="display:block;margin:-6px 0 12px;font-size:13px;color:var(--neutro-tx)">Si indicas tu pedido, usaremos la función registrada en tu compra.</span>
   ${campo("tipo", "Motivo", `<select id="tipo"><option value="">Selecciona el motivo</option>${c.tipos.map(t => `<option value="${t.codigo}">${esc(t.nombre)}</option>`).join("")}</select>`)}
   ${campo("descripcion", "Describe lo ocurrido", `<textarea id="descripcion" maxlength="2000"></textarea>`)}
   ${campo("evidencia_url", "Evidencia (opcional): enlace https", `<input id="evidencia_url" inputmode="url" placeholder="https://…">`)}
   <div id="ferr"></div><button class="btn grande" id="enviar" type="submit">${I.flecha} Enviar reporte</button></form>${pieCliente}</div>`;
  const ss = document.getElementById("sede_id"), sp = document.getElementById("pelicula"), sf = document.getElementById("funcion_id");
  const proxima = fs => fs.find(f => f.prioridad.nivel !== "FUNCION_INICIADA" && f.horario_estado === "CONFIRMADO") || fs[0];
  const pintarP = () => { const fs = c.funciones.filter(f => f.sede_id === Number(ss.value)); const pels = [...new Set(fs.map(f => f.pelicula))]; const def = proxima(fs);
    sp.innerHTML = pels.length ? pels.map(p => `<option ${def && def.pelicula === p ? "selected" : ""}>${esc(p)}</option>`).join("") : `<option value="">Sin cartelera registrada hoy</option>`; pintarH(); };
  const pintarH = () => { const fs = c.funciones.filter(f => f.sede_id === Number(ss.value) && f.pelicula === sp.value); const def = proxima(fs);
    sf.innerHTML = fs.length ? fs.map(f => `<option value="${f.id}" ${def && f.id === def.id ? "selected" : ""}>${f.horario_estado !== "CONFIRMADO" ? "Horario por confirmar" : esc(f.hora)} · ${esc(f.sala)}${f.prioridad.nivel === "FUNCION_INICIADA" ? " (ya inició)" : ""}</option>`).join("") : `<option value="">—</option>`; pintarCaja(); };
  const pintarCaja = () => { const f = c.funciones.find(x => String(x.id) === sf.value); document.getElementById("fpel").textContent = f ? f.pelicula : "Función por confirmar"; document.getElementById("fhora").textContent = `${ss.options[ss.selectedIndex].text}${f ? " · " + (f.horario_estado === "CONFIRMADO" ? f.hora : "horario por confirmar") + " · " + f.sala : ""}`; };
  ss.onchange = pintarP; sp.onchange = pintarH; sf.onchange = pintarCaja; pintarP();
  document.getElementById("f").onsubmit = async ev => {
    ev.preventDefault(); const b = document.getElementById("enviar"); b.disabled = true; document.getElementById("ferr").innerHTML = "";
    const datos = {clave_origen: clave, pedido: v("pedido"), sede_id: Number(ss.value), funcion_id: v("pedido") ? null : (Number(sf.value) || null), tipo: v("tipo"), descripcion: v("descripcion"), evidencia_url: v("evidencia_url")};
    try {
      const r = await Actividad.ejecutar("Enviando reporte", [
        {texto: "Validando datos", fn: () => { const e = {}; if (!datos.tipo) e.tipo = "Selecciona el motivo."; if (!datos.descripcion) e.descripcion = "Describe brevemente lo ocurrido."; if (Object.keys(e).length) throw new Nucleo.ErrorValidacion(e); }},
        {texto: "Guardando el caso y calculando prioridad", fn: () => Nucleo.registrarCliente(A, datos, E.usuario)},
        {texto: "Asignando responsable", fn: r => r},
      ]);
      sessionStorage.removeItem("clave_envio"); marcarGuardado(); location.hash = `#/c/recibido/${r.codigo}${r.reintento ? "?reintento=1" : ""}`;
    } catch (e) { b.disabled = false; errores("ferr", e instanceof Nucleo.ErrorValidacion ? {campos: e.campos} : {codigo: e.codigo, mensaje: e.message || e.mensaje}); }
  };
}
async function vistaClienteCaso(codigo, modo) {
  $app.innerHTML = cabCliente("casos") + `<div class="movil"><p>Cargando…</p></div>`;
  let d; try { d = await api(async () => { const x = await Nucleo.detalle(A, codigo); if (!x || x.cliente_id !== E.usuario.id) throw new Error(`No encontramos el caso ${codigo} en tu cuenta.`); return x; }); }
  catch (e) { document.querySelector(".movil").innerHTML = errorVista(e); return; }
  const reint = location.hash.includes("reintento=1"), m = document.querySelector(".movil");
  if (modo === "recibido") {
    m.innerHTML = `<button class="volver" onclick="location.hash='#/c/reportar'">${I.atras} Reportar</button><h1>Reporte recibido</h1><p class="sub">Recibimos tu reporte correctamente.</p>
    <div class="aviso ok" role="status">${I.check}<div><b>${reint ? "Reporte ya registrado" : "Reporte registrado"}</b>${reint ? "Este envío ya estaba guardado; no se creó otro caso." : `Guardado a las ${esc(d.apertura)}.`}</div></div>
    <div class="tarjeta" style="text-align:center"><div style="letter-spacing:.12em;font-weight:700;color:var(--neutro-tx);font-size:13px">CÓDIGO DE INCIDENCIA</div><div class="codigo-grande num">${esc(d.codigo)}</div>${etiquetaEstado(d.estado, d.estado_texto)}
    <div class="lista-dl" style="margin-top:18px;text-align:left"><div>Pedido</div><div>${esc(d.pedido)}</div><div>Función</div><div class="num">${esc(d.funcion)} · ${esc(d.pelicula)}</div><div>Sede</div><div>${esc(d.sede)}</div></div></div>
    <div class="aviso info">${I.enlace}<div><b>Ten este código a mano si cambias de canal</b>Podrás continuar la atención sin volver a explicar tu caso.</div></div>
    <a class="btn grande" href="#/c/caso/${esc(d.codigo)}">${I.flecha} Ver seguimiento</a><div style="height:10px"></div><button class="btn grande sec" id="copiar">Copiar código</button>${pieCliente}`;
    document.getElementById("copiar").onclick = () => navigator.clipboard?.writeText(d.codigo).then(() => toast(`Código ${d.codigo} copiado`), () => toast(`Código: ${d.codigo}`));
    return;
  }
  const res = ["RESUELTO", "CERRADO"].includes(d.estado);
  m.innerHTML = `<button class="volver" onclick="location.hash='#/c/casos'">${I.atras} Mis casos</button><h1>${res ? "Resultado" : "Seguimiento"}</h1>
  <div class="tarjeta"><div class="fila" style="justify-content:space-between"><strong class="num" style="font-size:26px">${esc(d.codigo)}</strong>${etiquetaEstado(d.estado, d.estado_texto)}</div>
  <p class="fila" style="margin:12px 0">${etiquetaPrioridad(d.prioridad)} <span class="num">Función ${esc(d.funcion)} · ${esc(d.pelicula)}${res ? "" : ` · ${esc(restante(d.prioridad))}`}</span></p>
  ${res ? `<div class="aviso ok">${I.check}<div><b>${esc(d.resultado || "Caso resuelto")}</b>Registrado a las ${esc(d.resuelto)}${d.a_tiempo === 1 ? ", antes del inicio de tu función" : ""}.</div></div>`
      : `<div class="aviso pend">${I.reloj}<div><b>Siguiente paso</b>${esc(d.siguiente_accion)}</div></div>`}
  <h2 style="font-size:18px">Historial de atención</h2><ul class="histo">${d.eventos.filter(e => !["PRIORIDAD_CALCULADA"].includes(e.tipo)).map(e => `<li><span class="h num">${esc(e.hora)}</span><span>${esc(e.detalle)}<small>${esc(e.canal)}</small></span></li>`).join("")}</ul></div>${pieCliente}`;
}
async function vistaClienteCasos() {
  $app.innerHTML = cabCliente("casos") + `<div class="movil"><h1>Mis casos</h1><div id="lc"><p>Cargando…</p></div><a class="btn grande" href="#/c/reportar" style="margin-top:14px">${I.flecha} Reportar una incidencia</a>${pieCliente}</div>`;
  try {
    const r0 = await api(() => Nucleo.listar(A, {activas: false, cliente_id: E.usuario.id, porPagina: 50})), sedesC = [...new Map(r0.items.map(x => [String(x.sede_id), x.sede])).entries()];
    if (E.cliSede && !sedesC.some(([k]) => k === E.cliSede)) E.cliSede = "";
    const r = {...r0, items: r0.items.filter(x => !E.cliSede || String(x.sede_id) === E.cliSede)};
    if (sedesC.length > 1) document.querySelector(".movil h1").insertAdjacentHTML("afterend", `<label class="fila" style="gap:8px;margin:-4px 0 12px;font-size:14px">Sede <select id="csede" style="flex:1;border:1px solid var(--borde);border-radius:8px;padding:8px"><option value="">Todas mis sedes</option>${sedesC.map(([k, n]) => `<option value="${k}" ${k === E.cliSede ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>`);
    document.getElementById("csede")?.addEventListener("change", e => { E.cliSede = e.target.value; vistaClienteCasos(); });
    document.getElementById("lc").innerHTML = r.items.length ? r.items.map(x => `<a class="tarjeta" style="display:block;text-decoration:none;color:inherit;margin-bottom:10px" href="#/c/caso/${esc(x.codigo)}"><div class="fila" style="justify-content:space-between"><strong class="num">${esc(x.codigo)}</strong>${etiquetaEstado(x.estado, x.estado_texto)}</div><div style="margin-top:6px">${esc(x.motivo)}</div><small style="color:var(--neutro-tx)">${esc(x.sede)} · función ${esc(x.funcion)}</small></a>`).join("") : `<div class="tarjeta vacio">Aún no tienes casos registrados.</div>`;
  } catch (e) { document.getElementById("lc").innerHTML = errorVista(e, "router()"); }
}

/* ---------------------------------------------------- 05 bandeja (Atención Digital / Supervisión) y atenciones de sede (Boletería) */
async function vistaBandeja(modoSede) {
  const titulo = modoSede ? "Atenciones de mi sede" : "Bandeja de incidencias";
  interna(modoSede ? "sede" : "bandeja", [[titulo]], `<h1>${titulo}</h1><p class="sub">Prioriza los casos según el tiempo restante para la función.</p>
  <div class="filtros" role="search"><label class="sr" for="fq">Buscar</label><input id="fq" placeholder="Buscar por código o pedido" value="${esc(E.filtros.q)}">
  ${modoSede ? "" : `<label class="sr" for="fs">Sede</label><select id="fs"><option value="">Sede: todas (general)</option></select>`}
  <label class="sr" for="fu">Urgencia</label><select id="fu"><option value="">Urgencia: todas</option>${["CRITICO", "URGENTE", "NORMAL", "VERIFICAR_HORARIO", "FUNCION_INICIADA"].map(n => `<option value="${n}">${{CRITICO: "Crítico", URGENTE: "Urgente", NORMAL: "Normal", VERIFICAR_HORARIO: "Verificar horario", FUNCION_INICIADA: "Función iniciada"}[n]}</option>`).join("")}</select>
  <label class="sr" for="fe">Estado</label><select id="fe"><option value="">Estado: activos</option>${["NUEVO", "EN_VERIFICACION", "EN_ATENCION", "ESCALADO"].map(s => `<option value="${s}">${Nucleo.ESTADOS[s]}</option>`).join("")}</select>
  <label class="sr" for="ft">Motivo</label><select id="ft"><option value="">Motivo: todos</option></select></div>
  <section class="tarjeta"><div class="fila" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0;font-size:18px">Incidencias activas</h2><span id="res" class="num" style="color:var(--neutro-tx);font-size:14px"></span></div><div id="tabla"><p>Cargando…</p></div><div id="pie"></div></section>`);
  const c = await ctx().catch(() => null);
  if (c) { const ft = document.getElementById("ft"); c.tipos.forEach(t => ft.insertAdjacentHTML("beforeend", `<option value="${t.codigo}">${esc(t.nombre)}</option>`));
    const fs = document.getElementById("fs"); if (fs) c.sedes.forEach(s => fs.insertAdjacentHTML("beforeend", `<option value="${s.id}">${esc(s.nombre)}</option>`)); }
  if (modoSede) E.filtros.sede_id = String(E.usuario.sede_id || ""); else E.filtros.sede_id = sedeAct();
  [["fu", "urgencia"], ["fe", "estado"], ["ft", "tipo"], ["fs", "sede_id"]].forEach(([id, k]) => { const el = document.getElementById(id); if (!el) return; el.value = E.filtros[k]; el.onchange = () => { if (k === "sede_id") return cambiarSede(el.value); E.filtros[k] = el.value; E.pagina = 1; cargarBandeja(); }; });
  let t0; document.getElementById("fq").oninput = e => { clearTimeout(t0); t0 = setTimeout(() => { E.filtros.q = e.target.value.trim(); E.pagina = 1; cargarBandeja(); }, 300); };
  await cargarBandeja(); E.timer = setInterval(() => cargarBandeja(true), 30000);
}
async function cargarBandeja(silencioso) {
  let d; try { d = await api(() => Nucleo.listar(A, {...E.filtros, pagina: E.pagina})); } catch (e) { if (!silencioso) document.getElementById("tabla").innerHTML = errorVista(e, "cargarBandeja()"); return; }
  const r = d.resumen;
  document.getElementById("res").textContent = `${plural(d.total, "registro", "registros")} · ${plural(r.CRITICO, "crítico", "críticos")} · ${plural(r.URGENTE, "urgente", "urgentes")} · actualizado ${d.ahora}`;
  const t = document.getElementById("tabla");
  if (!d.items.length) { t.innerHTML = `<div class="vacio">${Object.values(E.filtros).some(Boolean) ? "Ningún caso coincide con los filtros activos." : "No hay incidencias activas."}</div>`; document.getElementById("pie").innerHTML = ""; return; }
  if (!E.sel || !d.items.some(x => x.codigo === E.sel)) E.sel = d.items[0].codigo;
  t.innerHTML = `<div class="tabla-cont"><table><thead><tr><th>Código</th><th>Motivo</th><th>Sede</th><th>Función</th><th>Tiempo restante</th><th>Urgencia</th><th>Estado</th><th>Responsable</th></tr></thead><tbody>
  ${d.items.map(x => `<tr data-c="${esc(x.codigo)}" class="${x.codigo === E.sel ? "sel" : ""}" tabindex="0" aria-selected="${x.codigo === E.sel}"><td class="cod num">${esc(x.codigo)}${x.provisional ? ' <span class="et amarillo">Provisional</span>' : ""}</td><td>${esc(x.motivo)}</td><td>${esc(x.sede)}</td><td class="num">${esc(x.funcion)}</td><td class="num">${esc(restante(x.prioridad))}</td><td>${etiquetaPrioridad(x.prioridad)}</td><td>${etiquetaEstado(x.estado, x.estado_texto)}</td><td>${esc(x.responsable)}</td></tr>`).join("")}</tbody></table></div>`;
  t.querySelectorAll("tbody tr").forEach(tr => { tr.onclick = () => { E.sel = tr.dataset.c; cargarBandeja(true); }; tr.ondblclick = () => location.hash = `#/exp/${tr.dataset.c}`; tr.onkeydown = e => { if (e.key === "Enter") location.hash = `#/exp/${tr.dataset.c}`; if (e.key === " ") { e.preventDefault(); E.sel = tr.dataset.c; cargarBandeja(true); } }; });
  const s = d.items.find(x => x.codigo === E.sel), pags = Math.ceil(d.total / d.por_pagina);
  document.getElementById("pie").innerHTML = `<div class="pie-sel"><div><strong class="num">${esc(s.codigo)} · ${esc(s.pedido)}</strong><div style="font-size:13px;color:var(--neutro-tx)">Siguiente acción: ${esc(s.siguiente_accion)} · ${esc(s.sede)}</div></div>
   <div class="fila">${pags > 1 ? `<button class="btn sec" ${E.pagina <= 1 ? "disabled" : ""} onclick="E.pagina--;cargarBandeja()">Anterior</button><span class="num">Página ${E.pagina} de ${pags}</span><button class="btn sec" ${E.pagina >= pags ? "disabled" : ""} onclick="E.pagina++;cargarBandeja()">Siguiente</button>` : ""}
   <a class="btn" href="#/exp/${esc(s.codigo)}">${I.flecha} Abrir expediente</a></div></div>`;
}

/* ---------------------------------------------------- 10 buscar por código */
function vistaBuscar() {
  const bol = E.usuario.rol === "BOLETERIA";
  interna("buscar", bol ? [["Mostrador", "#/mostrador"], ["Buscar código"]] : [["Buscar caso"]], `<h1>${bol ? "Buscar por código" : "Buscar caso"}</h1><p class="sub">Recupera el expediente con el código de incidencia o el pedido que muestra el cliente. Buscando en: <b>${esc(nombreSede())}</b>.</p>
  <form id="fb" class="tarjeta fila" role="search"><label class="sr" for="qb">Código o pedido</label><input id="qb" style="flex:1;min-width:240px;border:1px solid var(--borde);border-radius:8px;padding:12px;font-size:18px" placeholder="INC-0126 o PED-0418" value="${esc(E.ultimaBusqueda || "")}"><button class="btn">${I.buscar} Buscar</button></form><div id="rb" style="margin-top:14px"></div>`);
  const buscar = async () => {
    const q = v("qb"); E.ultimaBusqueda = q; if (!q) return;
    try {
      const r = await api(() => Nucleo.listar(A, {q, activas: false, porPagina: 10, sede_id: sedeAct()}));
      document.getElementById("rb").innerHTML = r.items.length ? r.items.map(x => `<div class="tarjeta" style="margin-bottom:12px"><div class="fila" style="justify-content:space-between"><div><strong class="num" style="font-size:22px">${esc(x.codigo)}</strong> · ${esc(x.pedido)} · ${esc(x.sede)}</div><div class="fila">${etiquetaPrioridad(x.prioridad)}${etiquetaEstado(x.estado, x.estado_texto)}</div></div>
       <p style="margin:8px 0">${esc(x.motivo)} · Función ${esc(x.funcion)} (${esc(restante(x.prioridad))}) · Responsable: ${esc(x.responsable)}</p><div class="aviso pend" style="margin:8px 0">${I.reloj}<div><b>Siguiente acción</b>${esc(x.siguiente_accion)}</div></div>
       <div class="fila">${bol && !["RESUELTO", "CERRADO"].includes(x.estado) ? `<button class="btn" data-ret="${esc(x.codigo)}">${I.flecha} Retomar atención</button>` : ""}<a class="btn sec" href="#/exp/${esc(x.codigo)}">Ver expediente</a></div></div>`).join("")
        : `<div class="tarjeta vacio">No se encontró ningún caso con «${esc(q)}» en ${esc(nombreSede())}. Revise el código o pida al cliente su número de pedido.${sedeAct() ? ` <button class="btn sec" onclick="cambiarSede('')">Buscar en todas las sedes</button>` : ""}</div>`;
      document.querySelectorAll("[data-ret]").forEach(b => b.onclick = async () => {
        try { await Actividad.ejecutar(`Retomando ${b.dataset.ret}`, [{texto: "Registrando contacto en boletería", fn: () => api(() => Nucleo.retomar(A, b.dataset.ret, E.usuario))}, {texto: "Cargando historial del expediente", fn: async () => {}}]);
          marcarGuardado(); toast(`Atención retomada: ${b.dataset.ret}`); location.hash = `#/exp/${b.dataset.ret}`; } catch (e) { document.getElementById("rb").insertAdjacentHTML("afterbegin", errorVista(e)); }
      });
    } catch (e) { document.getElementById("rb").innerHTML = errorVista(e); }
  };
  document.getElementById("fb").onsubmit = ev => { ev.preventDefault(); buscar(); };
  if (E.ultimaBusqueda) buscar(); else document.getElementById("qb").focus();
}

/* ---------------------------------------------------- 06 expediente y acciones 07, 08, 09, 11, 12, 14 */
async function vistaExpediente(codigo, accion) {
  const volver = E.usuario.rol === "BOLETERIA" ? ["Mostrador", "#/mostrador"] : ["Bandeja", "#/bandeja"];
  interna(volver[1].slice(2), [volver, [codigo]], `<div id="ex"><p>Cargando expediente…</p></div>`);
  let d; try { d = await api(async () => { const x = await Nucleo.detalle(A, codigo); if (!x) throw new Error(`No existe la incidencia ${codigo}.`); return x; }); } catch (e) { document.getElementById("ex").innerHTML = errorVista(e, "router()"); return; }
  if (E.usuario.rol === "BOLETERIA" && sedeAct() && d.sede_id !== Number(sedeAct())) { document.getElementById("ex").innerHTML = `<div class="aviso pend">${I.alerta}<div><b>Corresponde a otra sede</b>El caso ${esc(d.codigo)} pertenece a ${esc(d.sede)}. Solo puede atender casos de ${esc(E.usuario.sede)}.</div></div>`; return; }
  const abierto = !["RESUELTO", "CERRADO"].includes(d.estado), rol = E.usuario.rol;
  const acciones = abierto ? [
    rol !== "SUPERVISION" && ["verificar", rol === "BOLETERIA" ? "Verificar compra e ingreso" : "Verificar compra y entrada"],
    rol === "DIGITAL" && d.candidatos.length && ["vincular", `Vincular contacto duplicado (${d.candidatos.length})`],
    rol === "DIGITAL" && ["derivar", "Derivar a Boletería"],
    rol === "BOLETERIA" && ["resolver", "Registrar resolución"],
    ["escalar", rol === "BOLETERIA" ? "Solicitar apoyo / escalar" : "Escalar"],
  ].filter(Boolean) : [];
  document.getElementById("ex").innerHTML = `<div class="fila" style="justify-content:space-between"><h1 class="num">${esc(d.codigo)} · ${esc(d.pedido)}</h1><div class="fila">${etiquetaPrioridad(d.prioridad)}${etiquetaEstado(d.estado, d.estado_texto)}<span class="et gris">v${d.version}</span></div></div>
  <p class="sub">${esc(d.motivo)} · ${esc(d.sede)} · Función ${esc(d.funcion)} (${esc(restante(d.prioridad))})</p>
  <div class="exp"><div style="display:grid;gap:16px">
   ${abierto ? `<div class="aviso pend" style="margin:0">${I.reloj}<div><b>Siguiente acción · ${esc(d.responsable)}</b>${esc(d.siguiente_accion)}</div></div>` : `<div class="aviso ok" style="margin:0">${I.check}<div><b>${esc(d.resultado || d.estado_texto)}</b>${d.resuelto_utc ? `Registrado a las ${esc(d.resuelto)} por ${esc(d.resuelto_por)}${d.a_tiempo === 1 ? " · antes del inicio" : d.a_tiempo === 0 ? " · después del inicio" : ""}. Evidencia: ${esc(d.evidencia_resolucion || "—")}` : ""}</div></div>`}
   <div id="panel"></div>
   <section class="tarjeta"><h2>Estados de la compra</h2><div class="partes">${[["compra", "Compra"], ["pago", "Pago"], ["emision", "Emisión"], ["ingreso", "Ingreso"]].map(([k, t]) => `<div class="parte"><small>${t}</small>${etiquetaParte(d.estados[k], d.estados_texto[k])}</div>`).join("")}</div>
   <p style="font-size:13px;color:var(--neutro-tx);margin:10px 0 0">${d.verificacion ? `Última verificación ${esc(d.verificacion.hora)} · ${esc(d.verificacion.actor)} · origen: ${esc(d.verificacion.origen)}` : "Aún sin verificación registrada: los cuatro estados se confirman por separado (R06)."}</p></section>
   <section class="tarjeta"><h2>Historial del expediente</h2><ul class="histo">${d.eventos.map(e => `<li><span class="h num">${esc(e.hora)}</span><span>${esc(e.detalle)}<small>${esc(e.canal)} · ${esc(e.actor)}${e.regla ? ` · regla ${esc(e.regla)}` : ""}</small></span></li>`).join("")}</ul></section></div>
  <aside style="display:grid;gap:16px"><section class="tarjeta"><h2>Datos del caso</h2><dl class="kv"><dt>Película</dt><dd>${esc(d.pelicula)}</dd><dt>Sala</dt><dd>${esc(d.sala)}</dd><dt>Sede</dt><dd>${esc(d.sede)}</dd><dt>Apertura</dt><dd class="num">${esc(d.apertura)}</dd>
    ${d.compra ? `<dt>Canal de compra</dt><dd>${esc(d.compra.canal)}</dd><dt>Entradas</dt><dd class="num">${d.compra.entradas} · S/ ${fmtNum(d.compra.monto, 2)}</dd>` : `<dt>Pedido</dt><dd>Caso provisional (R05)</dd>`}
    <dt>Contactos</dt><dd>${plural(d.contactos.length, "contacto", "contactos")}: ${d.contactos.map(k => esc(k.canal)).join(", ")}</dd><dt>Descripción</dt><dd style="word-break:normal">${esc(d.descripcion)}</dd></dl></section>
   ${acciones.length ? `<section class="tarjeta"><h2>Acciones</h2><div class="acciones">${acciones.map(([k, t], i) => `<a class="btn ${i ? "sec" : ""}" href="#/exp/${esc(d.codigo)}/${k}">${t}</a>`).join("")}</div></section>` : ""}
   <p style="font-size:12px;color:var(--neutro-tx)">${I.bd} Registro sintético de demostración.</p></aside></div>`;
  if (accion && abierto) panelAccion(d, accion);
}
function panelAccion(d, accion) {
  const P = document.getElementById("panel"), cerrar = `<a class="btn sec" href="#/exp/${esc(d.codigo)}">Cancelar</a>`;
  const fin = async (titulo, pasos, msg) => { try { await Actividad.ejecutar(titulo, pasos); marcarGuardado(); toast(msg); location.hash = `#/exp/${d.codigo}`; } catch (e) { errores("perr", e.campos ? e : {codigo: e.codigo, mensaje: e.message || e.mensaje}); } };
  if (accion === "verificar") {
    const sel = (k, val) => `<select id="${k}">${Nucleo.OPC_PARTES[k].map(o => `<option value="${o}" ${o === val ? "selected" : ""}>${Nucleo.PARTES[o]}</option>`).join("")}</select><span class="sugerido" id="s-${k}"></span>`;
    P.innerHTML = `<section class="tarjeta panel-accion"><h2>Verificar compra, pago, emisión e ingreso</h2><p class="sub" style="margin-bottom:10px">Consulte el registro de compras para autocompletar, o registre lo que verificó manualmente. Cada estado se guarda por separado.</p>
     <div class="fila" style="margin-bottom:12px"><button class="btn" id="consultar">${I.buscar} Consultar registro de compras</button><span style="font-size:13px;color:var(--neutro-tx)">Servicio de validación de demostración (sintético)</span></div><div id="ext"></div>
     <div class="partes">${[["compra", "Compra"], ["pago", "Pago"], ["emision", "Emisión"], ["ingreso", "Ingreso"]].map(([k, t]) => campo(k, t, sel(k, d.estados[k]))).join("")}</div>
     ${campo("nota", "Nota de verificación", `<input id="nota" maxlength="500" placeholder="Ej.: pago confirmado en el registro de compras">`)}<input type="hidden" id="origen" value="Registro manual">
     <div id="perr"></div><div class="fila"><button class="btn" id="guardar">${I.check} Guardar verificación</button>${cerrar}</div></section>`;
    document.getElementById("consultar").onclick = async () => {
      try {
        const r = await Actividad.ejecutar("Consultando registro de compras", [{texto: "Conectando con el servicio de validación", fn: () => api(() => Nucleo.consultarRegistroCompra(A, d.codigo))}, {texto: "Leyendo estados de la transacción", fn: async r => r}, {texto: "Comparando con el caso", fn: async r => r}]);
        if (!r.disponible) {
          if (r.motivo === "SIN_RESPUESTA") await api(() => Nucleo.registrarFalloExterno(A, d.codigo, E.usuario));
          document.getElementById("ext").innerHTML = `<div class="aviso err" role="alert">${I.alerta}<div><b>Verificación interrumpida</b>${esc(r.mensaje)} El caso sigue abierto; el historial y los datos locales están disponibles (último guardado ${esc(E.guardado || d.apertura)}).
           <div class="fila" style="margin-top:8px"><button class="btn sec" id="reint">Reintentar verificación</button><a class="btn sec" href="#/exp/${esc(d.codigo)}/escalar">Escalar a Validación de pagos</a></div></div></div>`;
          document.getElementById("reint").onclick = () => document.getElementById("consultar").click(); return;
        }
        for (const [k, val] of Object.entries(r.sugerido)) { const s = document.getElementById(k); s.value = val; document.getElementById("s-" + k).textContent = "Autocompletado · " + r.origen; }
        document.getElementById("origen").value = r.origen;
        document.getElementById("ext").innerHTML = `<div class="aviso info">${I.check}<div><b>Valores sugeridos por el sistema</b>Origen: ${esc(r.origen)} · regla R06. Revise y corrija si lo verificó de otra forma antes de guardar.</div></div>`;
      } catch (e) { document.getElementById("ext").innerHTML = errorVista(e); }
    };
    document.getElementById("guardar").onclick = () => fin("Guardando verificación", [{texto: "Validando estados", fn: async () => {}}, {texto: "Guardando verificación y evento", fn: () => api(() => Nucleo.guardarVerificacion(A, d.codigo, d.version, {compra: v("compra"), pago: v("pago"), emision: v("emision"), ingreso: v("ingreso")}, v("nota"), v("origen"), E.usuario))}, {texto: "Actualizando siguiente acción", fn: async r => r}], "Verificación guardada");
  }
  if (accion === "vincular") {
    const c = d.candidatos[0], orig = c.apertura_utc <= d.apertura_utc ? c : null;
    P.innerHTML = `<section class="tarjeta panel-accion"><h2>Posible contacto duplicado</h2><p class="sub" style="margin-bottom:10px">Compare los datos. Al vincular, los contactos pasan al expediente original y ambos historiales se conservan.</p>
     <div class="comparar"><div class="h">Dato</div><div class="h">${esc(d.codigo)} (actual)</div><div class="h">${esc(c.codigo)}</div>
     ${[["Pedido", d.pedido, c.pedido], ["Motivo", d.motivo, c.motivo], ["Función", d.funcion, c.funcion], ["Sede", d.sede, c.sede], ["Apertura", d.apertura, c.apertura], ["Estado", d.estado_texto, c.estado_texto]].map(([a, b, x]) => `<div>${a}</div><div>${esc(b)}</div><div>${esc(x)}${b === x ? " ✓" : ""}</div>`).join("")}</div>
     <div id="perr"></div><div class="fila" style="margin-top:12px">${orig ? `<button class="btn" id="vin">Vincular a ${esc(c.codigo)} (original)</button>` : `<button class="btn" id="vin2">Vincular ${esc(c.codigo)} a este expediente</button>`}<button class="btn sec" id="sep">Mantener separado</button>${cerrar}</div></section>`;
    document.getElementById("vin")?.addEventListener("click", () => fin("Vinculando contacto", [{texto: "Comparando datos", fn: async () => {}}, {texto: "Moviendo contactos al original", fn: () => api(() => Nucleo.vincular(A, c.codigo, d.codigo, d.version, E.usuario))}], `Contacto vinculado a ${c.codigo}`).then(() => location.hash = `#/exp/${c.codigo}`));
    document.getElementById("vin2")?.addEventListener("click", () => fin("Vinculando contacto", [{texto: "Comparando datos", fn: async () => {}}, {texto: "Moviendo contactos al original", fn: () => api(() => Nucleo.vincular(A, d.codigo, c.codigo, c.version, E.usuario))}], `${c.codigo} vinculado a ${d.codigo}`));
    document.getElementById("sep").onclick = () => fin("Registrando decisión", [{texto: "Guardando decisión", fn: () => api(() => Nucleo.mantenerSeparado(A, d.codigo, c.codigo, E.usuario))}], "Se mantienen separados");
  }
  if (accion === "derivar" || accion === "escalar") {
    const esc_ = accion === "escalar", sedes = E.ctx?.sedes || [];
    const destinos = esc_ ? ["Validación de pagos", "Responsable de sede", "Supervisión"] : [`Boletería · ${d.sede}`];
    P.innerHTML = `<section class="tarjeta panel-accion"><h2>${esc_ ? "Escalar el caso" : "Derivar a Boletería"}</h2>
     <div class="grid2">${campo("destino", "Destino", `<select id="destino">${destinos.map(x => `<option>${esc(x)}</option>`).join("")}</select>`)}${campo("responsable", "Responsable", `<input id="responsable" value="${esc(destinos[0])}">`)}</div>
     ${campo("motivo", "Motivo", `<input id="motivo" maxlength="300" value="${esc_ ? "" : "El cliente se encuentra en sede y la función está próxima"}">`)}
     ${campo("siguiente", "Acción siguiente", `<input id="siguiente" maxlength="300" value="${esc(esc_ ? "Confirmar el estado del pago y responder al responsable" : "Recuperar la entrada con el código " + d.codigo + " sin pedir de nuevo los datos")}">`)}
     <div class="previo" id="prev"></div><div id="perr"></div><div class="fila"><button class="btn" id="conf">${esc_ ? "Confirmar escalamiento" : "Confirmar derivación"}</button>${cerrar}</div></section>`;
    const prev = () => document.getElementById("prev").innerHTML = `<b>Vista previa (aún no guardada)</b><br>Estado previsto: ${esc_ ? "Escalado" : "En atención"} · Responsable: ${esc(v("responsable"))} · Revisión esperada: ${Nucleo.fmtHora(Math.floor(Date.now() / 1000) + 300)} · Se conserva el código ${esc(d.codigo)} y su historial.`;
    document.getElementById("destino").onchange = () => { document.getElementById("responsable").value = v("destino"); prev(); }; document.getElementById("responsable").oninput = prev; prev();
    document.getElementById("conf").onclick = () => fin(esc_ ? "Escalando caso" : "Derivando a Boletería", [{texto: "Validando datos", fn: async () => {}}, {texto: "Guardando transferencia y responsable", fn: () => api(() => Nucleo.derivar(A, d.codigo, d.version, {destino: v("destino"), responsable: v("responsable"), motivo: v("motivo"), siguiente: v("siguiente")}, E.usuario, esc_ ? "ESCALAMIENTO" : "DERIVACION"))}, {texto: "Notificando a la bandeja destino", fn: async r => r}], esc_ ? `Escalamiento confirmado: ${d.codigo}` : `Derivación confirmada. Boletería recibió ${d.codigo}`);
  }
  if (accion === "resolver") {
    P.innerHTML = `<section class="tarjeta panel-accion"><h2>Registrar resolución verificada</h2>
     ${campo("resultado", "Resultado", `<select id="resultado"><option value="">Selecciona el resultado</option>${Nucleo.RESULTADOS.map(x => `<option>${esc(x)}</option>`).join("")}</select>`)}
     ${campo("evidencia", "Evidencia operativa", `<textarea id="evidencia" maxlength="1000" placeholder="Ej.: entrada reimpresa y validada en el lector de la sala 4"></textarea>`)}
     <dl class="kv"><dt>Responsable</dt><dd>${esc(E.usuario.nombre)} · ${esc(E.usuario.sede || "")}</dd></dl><div class="previo" id="prev">Calculando…</div><div id="perr"></div>
     <div class="fila"><button class="btn" id="conf">${I.check} Confirmar resolución</button>${cerrar}</div></section>`;
    Nucleo.vistaPreviaResolucion(A, d.codigo).then(p => document.getElementById("prev").innerHTML = `<b>Cálculo previo (aún no registrado)</b><br>${p.a_tiempo == null ? "Horario de función por verificar: no se podrá contar como solución a tiempo hasta confirmarlo." : p.a_tiempo ? `Si confirma ahora, contará como solución antes del inicio de la función ${esc(p.funcion)} (faltan ${p.minutos} min).` : `La función ${esc(p.funcion)} ya inició: se registrará como solución después del inicio (R10).`}`).catch(() => {});
    document.getElementById("conf").onclick = () => fin("Registrando resolución", [{texto: "Validando resultado y evidencia", fn: async () => {}}, {texto: "Guardando resolución", fn: () => api(() => Nucleo.resolver(A, d.codigo, d.version, {resultado: v("resultado"), evidencia: v("evidencia")}, E.usuario))}, {texto: "Actualizando indicadores del caso", fn: async r => r}], `Resolución registrada: ${d.codigo}`);
  }
  P.scrollIntoView({behavior: "smooth", block: "start"});
}

/* ---------------------------------------------------- Boletería · mostrador de la sede */
async function vistaMostrador() {
  await ctx().catch(() => null); /* nombre de la sede disponible antes de pintar el título */
  const u = E.usuario, sm = sedeAct();
  interna("mostrador", [["Mostrador"]], `<div class="fila" style="justify-content:space-between"><div><h1>Mostrador · ${esc(nombreSede(sm))}</h1><p class="sub">Retoma con el código que muestra el cliente. Los casos derivados a tu sede aparecen por urgencia.</p></div>
  <form id="fm" class="fila" role="search"><label class="sr" for="qm">Código o pedido</label><input id="qm" class="buscador-grande" placeholder="INC-0126 o PED-0418" autocomplete="off"><button class="btn">${I.buscar} Buscar</button></form></div>
  <div id="cola"><p>Cargando…</p></div>`);
  document.getElementById("fm").onsubmit = ev => { ev.preventDefault(); E.ultimaBusqueda = v("qm"); location.hash = "#/buscar"; };
  document.getElementById("qm").focus();
  const pintar = async () => {
    let d; try { d = await api(() => Nucleo.listar(A, {sede_id: sm, porPagina: 60})); } catch (e) { document.getElementById("cola").innerHTML = errorVista(e, "router()"); return; }
    const mios = d.items.filter(x => /boleter/i.test(x.responsable)), otros = d.items.filter(x => !/boleter/i.test(x.responsable));
    const tarjeta = x => `<article class="tarjeta caso-mostrador ${x.prioridad.nivel.toLowerCase()}"><div class="fila" style="justify-content:space-between"><strong class="num" style="font-size:22px">${esc(x.codigo)}</strong>${etiquetaPrioridad(x.prioridad)}</div>
      <div class="cuenta-regresiva num">${x.prioridad.minutos == null ? "Horario por verificar" : x.prioridad.minutos < 0 ? `Función iniciada hace ${-x.prioridad.minutos} min` : `${x.prioridad.minutos} min para la función`}</div>
      <p style="margin:6px 0">${esc(x.motivo)} · ${esc(x.pelicula)} · ${esc(x.funcion)}</p><p style="margin:0 0 10px;font-size:13px;color:var(--neutro-tx)">${esc(x.siguiente_accion)}</p>
      <div class="fila"><button class="btn" data-ret="${esc(x.codigo)}">${I.flecha} Retomar</button><a class="btn sec" href="#/exp/${esc(x.codigo)}">Ver expediente</a></div></article>`;
    document.getElementById("cola").innerHTML = `<h2 style="font-size:18px">Derivados a Boletería (${mios.length})</h2>${mios.length ? `<div class="rejilla">${mios.map(tarjeta).join("")}</div>` : `<div class="tarjeta vacio">No hay casos derivados en este momento.</div>`}
      <h2 style="font-size:18px;margin-top:22px">Otros casos abiertos ${sm ? "de la sede" : "de todas las sedes"} (${otros.length})</h2>${otros.length ? `<div class="rejilla">${otros.slice(0, 9).map(tarjeta).join("")}</div>` : `<div class="tarjeta vacio">Sin otros casos abiertos.</div>`}
      <p style="font-size:13px;color:var(--neutro-tx)">Actualizado ${esc(d.ahora)} · se renueva cada 30 s.</p>`;
    document.querySelectorAll("[data-ret]").forEach(b => b.onclick = async () => {
      try { await Actividad.ejecutar(`Retomando ${b.dataset.ret}`, [{texto: "Registrando contacto en boletería", fn: () => api(() => Nucleo.retomar(A, b.dataset.ret, E.usuario))}, {texto: "Cargando historial del expediente", fn: async () => {}}]);
        marcarGuardado(); toast(`Atención retomada: ${b.dataset.ret}`); location.hash = `#/exp/${b.dataset.ret}`; } catch (e) { document.getElementById("cola").insertAdjacentHTML("afterbegin", errorVista(e)); }
    });
  };
  await pintar(); E.timer = setInterval(pintar, 30000);
}

/* ---------------------------------------------------- Supervisión · panel de control */
async function vistaPanel() {
  const h0 = location.hash, cx = await ctx().catch(() => null), fsede = sedeAct();
  if (location.hash !== h0) return; /* el usuario ya cambió de vista */
  interna("panel", [["Panel"]], `<div class="fila" style="justify-content:space-between;align-items:flex-end"><div><h1>Panel de supervisión</h1><p class="sub">Situación en tiempo real ${fsede ? "de la sede seleccionada" : "de todas las sedes"}. Los indicadores formales y la comparación de escenarios están en «Indicadores».</p></div>
    <div class="filtros" style="margin:0"><label class="sr" for="psede">Sede</label><select id="psede"><option value="">Sede: todas (general)</option>${(cx?.sedes || []).map(x => `<option value="${x.id}" ${String(x.id) === fsede ? "selected" : ""}>${esc(x.nombre)}${x.piloto ? " (piloto)" : ""}</option>`).join("")}</select></div></div><div id="pn"><p>Cargando…</p></div>`);
  document.getElementById("psede").onchange = e => cambiarSede(e.target.value);
  let d; try { d = await api(() => Nucleo.listar(A, {activas: false, porPagina: 100000, sede_id: fsede})); } catch (e) { document.getElementById("pn").innerHTML = errorVista(e, "router()"); return; }
  const it = d.items, abiertas = it.filter(x => !["RESUELTO", "CERRADO"].includes(x.estado)), res = it.filter(x => x.estado === "RESUELTO");
  const aTiempo = res.filter(x => x.a_tiempo === 1).length, conHora = res.filter(x => x.a_tiempo != null).length;
  const sinAsignar = abiertas.filter(x => x.responsable === "Sin asignar"), iniciadas = abiertas.filter(x => x.prioridad.nivel === "FUNCION_INICIADA"), criticas = abiertas.filter(x => x.prioridad.nivel === "CRITICO");
  const kpi = (t, val, det, cls) => `<div class="tarjeta kpi ${cls || ""}"><small>${t}</small><div class="num">${val}</div><span>${det}</span></div>`;
  const porSede = Object.values(it.reduce((m, x) => { const z = (m[x.sede] ||= {sede: x.sede, total: 0, abiertos: 0, conHora: 0, aTiempo: 0}); z.total++; if (!["RESUELTO", "CERRADO"].includes(x.estado)) z.abiertos++; if (x.estado === "RESUELTO" || x.estado === "CERRADO") { if (x.a_tiempo != null) z.conHora++; if (x.a_tiempo === 1) z.aTiempo++; } return m; }, {})).sort((a, b) => b.abiertos - a.abiertos || b.total - a.total);
  const alertas = [...criticas.map(x => [x, "rojo", `Crítico: faltan ${x.prioridad.minutos} min`]), ...iniciadas.map(x => [x, "rojo", "Función iniciada sin solución"]), ...sinAsignar.map(x => [x, "amarillo", "Sin responsable asignado"])];
  document.getElementById("pn").innerHTML = `<div class="kpis">${kpi("Casos abiertos", plural(abiertas.length, "caso", "casos"), `${plural(it.length, "registro", "registros")} en total`)}${kpi("Críticos ahora", criticas.length, "faltan 15 min o menos", criticas.length ? "alerta" : "")}
   ${kpi("Resueltos antes del inicio", conHora ? `${fmtNum(aTiempo / conHora * 100, 1)} %` : "Sin datos", `${aTiempo} de ${conHora} resueltos con horario conocido`)}${kpi("Función iniciada sin solución", iniciadas.length, "atención posterior al inicio (R10)", iniciadas.length ? "alerta" : "")}</div>
   <div class="grid2" style="margin-top:16px"><section class="tarjeta"><h2 style="font-size:18px;margin-top:0">Alertas para actuar (${alertas.length})</h2>${alertas.length ? `<ul class="histo alertas">${alertas.slice(0, 12).map(([x, c, t]) => `<li><span class="et ${c}">${esc(x.codigo)}</span><span><a href="#/exp/${esc(x.codigo)}">${esc(t)}</a><small>${esc(x.motivo)} · ${esc(x.sede)} · ${esc(x.responsable)}</small></span></li>`).join("")}</ul>` : `<p class="vacio">Sin alertas.</p>`}</section>
   <section class="tarjeta"><h2 style="font-size:18px;margin-top:0">Casos por sede</h2>${porSede.length ? `<div class="tabla-cont" style="max-height:360px;overflow:auto"><table style="min-width:360px"><thead><tr><th>Sede</th><th>Abiertos</th><th>Total</th><th>A tiempo</th></tr></thead><tbody>${porSede.map(z => `<tr><td>${esc(z.sede)}</td><td class="num">${z.abiertos}</td><td class="num">${z.total}</td><td class="num">${z.conHora ? fmtNum(z.aTiempo / z.conHora * 100, 1) + " %" : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<p class="vacio">Sin casos.</p>`}
   <p style="font-size:13px;color:var(--neutro-tx)">Datos sintéticos · ${fsede ? "sede filtrada" : "44 sedes"} · actualizado ${esc(d.ahora)}</p></section></div><div id="pfer" style="margin-top:16px"></div>`;
  Nucleo.feriados(A).then(f => { const el = document.getElementById("pfer"); if (el) el.innerHTML = tarjetaFeriados(f); }).catch(() => {});
  E.timer = setInterval(() => location.hash === "#/panel" && vistaPanel(), 60000);
}


/* ---------------------------------------------------- Design Thinking automatizado (v0.8.0) */
const autorAuto = () => ({...(E.usuario || {}), nombre: `${E.usuario?.nombre || "Sistema"} (generación automática)`});
async function generarDT() {
  return Actividad.ejecutar("Regenerando Design Thinking desde los datos", [
    {texto: "Leyendo incidencias, contactos y eventos", fn: async () => {}},
    {texto: "Aplicando reglas y guardando las versiones que cambian", fn: () => api(() => DTAuto.ejecutar(A, autorAuto(), undefined, true))},
    {texto: "Actualizando avance y trazabilidad", fn: async r => r}]);
}
/* Sincronización automática: si los datos cambiaron, el Design Thinking se actualiza solo (no toca las herramientas editadas a mano) */
async function syncDT() {
  if (!E.usuario || E.usuario.rol !== "SUPERVISION" || !window.DTAuto) return null;
  let pend = null; try { pend = await DTAuto.pendiente(A); } catch { return null; }
  if (!pend) return null;
  try {
    const r = await Actividad.ejecutar("Actualizando Design Thinking con los datos nuevos", [
      {texto: `Recalculando ${plural(pend.herramientas.length, "herramienta", "herramientas")} con los datos registrados`, fn: () => api(() => DTAuto.sincronizar(A, autorAuto()))},
      {texto: "Guardando versiones nuevas y conservando las anteriores", fn: async r => r}]);
    if (r && r.resultados.length) toast(`Design Thinking actualizado: ${plural(r.resultados.length, "herramienta", "herramientas")} con datos nuevos`);
    if (r && r.perdidas.length) E.avisoDT = `La propuesta cambió con los datos nuevos: vuelve a confirmar ${r.perdidas.map(k => k === "ID2" ? "la elección (Matriz de priorización)" : "la decisión final").join(" y ")}.`;
    return r;
  } catch (e) { console.error(e); return null; }
}
function avisoGenerado(c, d) {
  const g = c && c._generado;
  if (d && d.sedeVista) return `<div class="aviso info gen-aviso">${I.bd}<div><b>Vista por sede: ${esc(d.sedeVista)}</b>Calculada al momento con los datos de esta sede (no crea versiones). <b>Regla:</b> ${esc(g?.regla || "")}<br><small>Para ver la versión general guardada, elige «Todas las sedes» en Design Thinking.</small></div></div>`;
  if (!g) return d && d.autor && !/contenido inicial/.test(d.autor) ? `<div class="aviso pend gen-aviso">${I.alerta}<div><b>Editada a mano por ${esc(d.autor)}</b>No se actualiza sola con los datos nuevos. Para volver al modo automático usa «Regenerar todo» en Design Thinking.</div></div>` : "";
  return `<div class="aviso info gen-aviso">${I.bd}<div><b>Generada automáticamente · ${esc(Nucleo.fmtFechaHora(g.utc))}</b>Datos: ${esc(g.base)}.<br><b>Regla:</b> ${esc(g.regla)}<br><small>Se actualiza sola cuando cambian los datos. Si la editas a mano, deja de actualizarse automáticamente.</small></div></div>`;
}

/* ---------------------------------------------------- Feriados oficiales (dato real por internet, v0.7.0) */
const fmtDiaFer = f => new Date(f + "T12:00:00Z").toLocaleDateString("es-PE", {weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC"});
const faltanFer = d => d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`;
function tarjetaFeriados(info) {
  const px = Nucleo.proximosFeriados(info, 3);
  if (!info) return `<section class="tarjeta fer-tarjeta"><h2 style="font-size:18px;margin-top:0">Próximos feriados (alta demanda)</h2><p class="vacio">Aún no se descargan los feriados oficiales. Ve a <a href="#/operacion">Operación → Feriados oficiales del Perú</a> y pulsa «Actualizar feriados».</p></section>`;
  return `<section class="tarjeta fer-tarjeta"><h2 style="font-size:18px;margin-top:0">Próximos feriados (alta demanda)</h2>${px.length ? `<ul class="fer-lista">${px.map(x => `<li class="${x.dias <= 7 ? "pronto" : ""}"><b>${esc(fmtDiaFer(x.fecha))}</b><span>${esc(x.nombre)}</span><em>${faltanFer(x.dias)}</em></li>`).join("")}</ul>` : `<p class="vacio">No hay feriados próximos en los años descargados.</p>`}
    <p style="font-size:12.5px;color:var(--neutro-tx);margin-bottom:0">Datos reales · ${esc(info.fuente)} · consultado ${esc(Nucleo.fmtFechaHora(info.consultado_utc))}. Sugerencia: reforzar Boletería y Atención Digital esos días.</p></section>`;
}

/* ---------------------------------------------------- 16–19 · Datos: carga desde Excel y evidencias */
async function descargar(nombre, u8) {
  try { const r = await Actividad.ejecutar(`Generando ${nombre}`, [{texto: "Preparando el libro", fn: async () => u8}, {texto: "Guardando el archivo", fn: () => A.guardarArchivo(nombre, Carga.b64(u8))}]);
    if (r?.guardado) toast(`${nombre} guardado · ${r.ruta}`); } catch (e) { toast(e.message || "No se pudo guardar el archivo"); }
}
async function resumenDatosSede(sede) {
  const p = await Nucleo.proyecto(A), [inc, ct, ev, fu, co] = await Promise.all([A.leer("incidencia", {proyecto_id: p.id}), A.leer("contacto", {}), A.leer("evento", {}), A.leer("funcion", {proyecto_id: p.id}), A.leer("compra", {proyecto_id: p.id})]);
  const I = sede ? inc.filter(i => i.sede_id === Number(sede)) : inc, ids = new Set(I.map(i => i.id)), F = sede ? fu.filter(f => f.sede_id === Number(sede)) : fu, fids = new Set(F.map(f => f.id));
  const n = {incidencias: I.length, contactos: ct.filter(c => ids.has(c.incidencia_id)).length, eventos: ev.filter(e => ids.has(e.incidencia_id)).length, funciones: F.length, compras: co.filter(c => fids.has(c.funcion_id)).length,
    abiertas: I.filter(i => !["RESUELTO", "CERRADO"].includes(i.estado)).length, cargadas: I.filter(i => i.canal_origen === "CARGA").length};
  return n;
}
async function vistaDatos() {
  interna("datos", [["Datos"]], `<h1>Datos y evidencias</h1><p class="sub">Carga lotes desde Excel con validación completa antes de guardar. Un lote con errores no modifica la base.</p><div id="dsede" class="tarjeta" style="margin-bottom:16px"><p>Calculando datos de ${esc(nombreSede())}…</p></div>
  <div class="grid2"><section class="tarjeta"><h2 style="margin-top:0;font-size:18px">Importar Excel</h2>
   <ol class="pasos-carga"><li>Descargue la plantilla o el ejemplo.</li><li>Seleccione el archivo .xlsx.</li><li>Valide: se revisan hoja, fila y campo.</li><li>Si no hay errores, confirme el guardado.</li></ol>
   <div class="fila"><button class="btn sec" id="dpl">Descargar plantilla</button><button class="btn sec" id="dej">Descargar ejemplo de carga</button></div>
   <label class="zona-archivo" for="arch"><input type="file" id="arch" accept=".xlsx"><span id="narch">Seleccione o arrastre un archivo .xlsx</span><small>Hojas: Funciones, Compras, Incidencias, Contactos y Evidencias (opcional) · máximo 5.000 filas</small></label>
   <button class="btn" id="val" disabled>Validar archivo</button></section>
   <section class="tarjeta"><h2 style="margin-top:0;font-size:18px">Progreso de la carga</h2><div id="prog"><p class="vacio">Aún no se ha seleccionado un archivo.</p></div></section></div>
  <div id="resval"></div>
  <section class="tarjeta" style="margin-top:16px"><h2 style="margin-top:0;font-size:18px">Lotes registrados</h2><div id="lotes"><p>Cargando…</p></div></section>
  <section class="tarjeta" style="margin-top:16px"><h2 style="margin-top:0;font-size:18px">Evidencias del caso</h2><div id="evid"><p>Cargando…</p></div></section>`);
  resumenDatosSede(sedeAct()).then(n => { const el = document.getElementById("dsede"); if (el) el.innerHTML = `<h2 class="h2" style="margin-top:0">Datos registrados · ${esc(nombreSede())}</h2><div class="kpis">${[["Incidencias", n.incidencias, `${n.abiertas} abiertas · ${n.cargadas} desde Excel`], ["Contactos", n.contactos, "por canal"], ["Eventos", n.eventos, "historial del expediente"], ["Funciones", n.funciones, `${n.compras} compras`]].map(([t, v, d]) => `<div class="tarjeta kpi"><small>${t}</small><div class="num">${fmtNum(v)}</div><span>${d}</span></div>`).join("")}</div><p style="font-size:13px;color:var(--neutro-tx);margin-bottom:0">Datos sintéticos. Cambie la sede en la barra superior para ver otro cine o «Todas las sedes» para el total.</p>`; }).catch(() => {});
  let archivo = null;
  document.getElementById("dpl").onclick = () => descargar("Plantilla_Carga_Incidencias.xlsx", Carga.plantilla());
  document.getElementById("dej").onclick = () => descargar("Ejemplo_Carga_Incidencias.xlsx", Carga.ejemplo());
  const inp = document.getElementById("arch");
  inp.onchange = () => { archivo = inp.files[0] || null; document.getElementById("narch").textContent = archivo ? `${archivo.name} · ${fmtNum(archivo.size / 1024, 1)} KB` : "Seleccione un archivo .xlsx"; document.getElementById("val").disabled = !archivo; document.getElementById("resval").innerHTML = ""; pintarFases(archivo ? 0 : -1); };
  document.getElementById("val").onclick = () => procesar(archivo);
  cargarLotes(); cargarEvidencias();
}
const FASES = ["Leer archivo", "Validar filas", "Revisar resultado", "Guardar en la base", "Finalizado"];
function pintarFases(actual, detalle = "", pct = null, clase = "") {
  const el = document.getElementById("prog"); if (!el) return;
  if (actual < 0) { el.innerHTML = `<p class="vacio">Aún no se ha seleccionado un archivo.</p>`; return; }
  const p = pct ?? Math.round(actual / (FASES.length - 1) * 100);
  el.innerHTML = `<div class="act ${clase}" style="padding:0;box-shadow:none;border:0"><div class="fila1"><span class="tit">${esc(FASES[Math.min(actual, 4)])}</span><span class="fase">${esc(detalle)}</span><span class="num">${p} %</span></div>
   <div class="barra" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100" aria-label="Progreso de la carga"><i style="width:${p}%"></i></div>
   <ol>${FASES.map((f, i) => `<li class="${i < actual || clase === "ok" ? "hecho" : i === actual && clase === "err" ? "fallo" : i === actual ? "actual" : ""}">${i < actual || clase === "ok" ? "✓" : i === actual && clase === "err" ? "✕" : i + 1 + "."} ${f}</li>`).join("")}</ol></div>`;
}
async function procesar(archivo) {
  const R = document.getElementById("resval"); R.innerHTML = ""; document.getElementById("val").disabled = true;
  try {
    pintarFases(0, "Leyendo hojas del archivo…", 5);
    const libro = await XLSX.leer(await archivo.arrayBuffer());
    pintarFases(1, "Validando…", 10);
    const val = await Carga.validar(A, libro, (n, t) => pintarFases(1, `${fmtNum(n)} de ${fmtNum(t)} filas revisadas`, 10 + Math.round(n / Math.max(t, 1) * 60)));
    E.validacion = {val, nombre: archivo.name};
    const tabla = `<div class="tabla-cont"><table style="min-width:420px"><thead><tr><th>Hoja</th><th>Filas</th><th>Nuevas</th><th>Ya registradas</th></tr></thead><tbody>${Object.keys(Carga.HOJAS).map(h => `<tr><td>${h}</td><td class="num">${fmtNum(val.conteo?.[h] ?? 0)}</td><td class="num">${fmtNum(val.nuevos?.[h]?.length ?? 0)}</td><td class="num">${fmtNum(val.existentes?.[h] ?? 0)}</td></tr>`).join("")}</tbody></table></div>`;
    if (!val.ok) {
      pintarFases(2, `${plural(val.errores.length, "error encontrado", "errores encontrados")} · guardado cancelado`, 80, "err");
      R.innerHTML = `<section class="tarjeta" style="margin-top:16px"><div class="aviso err" role="alert">${I.alerta}<div><b>Lote rechazado: ${plural(val.errores.length, "error", "errores")}</b>No se guardó ninguna fila. Los datos que ya estaban en la base se conservan. Corrija el archivo y vuelva a cargarlo.</div></div>
       <div class="fila" style="margin-bottom:10px"><button class="btn sec" id="derr">Descargar detalle de errores</button><label class="btn" for="arch">Cargar archivo corregido</label></div>
       <div class="tabla-cont"><table><thead><tr><th>Hoja</th><th>Fila</th><th>Campo</th><th>Error</th><th>Corrección sugerida</th></tr></thead><tbody>${val.errores.slice(0, 200).map(e => `<tr><td>${esc(e.hoja)}</td><td class="num">${esc(e.fila)}</td><td>${esc(e.campo)}</td><td><span class="et rojo">${esc(e.codigo)}</span></td><td>${esc(e.mensaje)}</td></tr>`).join("")}</tbody></table></div>
       ${val.errores.length > 200 ? `<p style="font-size:13px">Se muestran 200 de ${fmtNum(val.errores.length)}; el detalle completo está en el archivo descargable.</p>` : ""}</section>`;
      document.getElementById("derr").onclick = () => descargar("Errores_de_carga.xlsx", Carga.reporteErrores(val.errores));
      return;
    }
    if (val.repetido) {
      pintarFases(4, "Archivo ya registrado: 0 filas nuevas", 100, "ok");
      R.innerHTML = `<section class="tarjeta" style="margin-top:16px"><div class="aviso info">${I.check}<div><b>Ya registrado</b>Este mismo lote se cargó el ${esc(Nucleo.fmtFechaHora(val.repetido.fecha_utc))} por ${esc(val.repetido.usuario)}. No se insertó nada para evitar duplicados.</div></div>${tabla}</section>`; return;
    }
    pintarFases(2, "Validación completa · guardado pendiente", 75);
    R.innerHTML = `<section class="tarjeta" style="margin-top:16px"><div class="aviso pend">${I.reloj}<div><b>Validación completa · guardado pendiente</b>${plural(val.total, "fila revisada", "filas revisadas")} sin errores. Revise el resumen y confirme.</div></div>${tabla}
     <div class="fila" style="margin-top:12px"><button class="btn" id="gl">${I.check} Guardar lote</button><button class="btn sec" onclick="document.getElementById('resval').innerHTML='';pintarFases(-1)">Cancelar</button></div></section>`;
    document.getElementById("gl").onclick = async () => {
      document.getElementById("gl").disabled = true; pintarFases(3, "Guardando en una sola operación…", 90);
      try { const r = await Carga.guardar(A, val, archivo.name, E.usuario); marcarGuardado(); E.ctx = null;
        pintarFases(4, `${plural(r.nuevas, "fila nueva", "filas nuevas")} · ${plural(r.existentes, "ya registrada", "ya registradas")}`, 100, "ok");
        R.innerHTML = `<section class="tarjeta" style="margin-top:16px"><div class="aviso ok">${I.check}<div><b>Lote guardado</b>${plural(r.nuevas, "fila nueva", "filas nuevas")} y ${plural(r.existentes, "fila ya registrada", "filas ya registradas")}. Las incidencias cargadas ya aparecen en la Bandeja.<div id="gendt2" style="margin-top:6px">Actualizando Design Thinking con estos datos…</div></div></div>${tabla}</section>`;
        syncDT().then(x => { const el = document.getElementById("gendt2"); if (el) el.innerHTML = x && x.resultados.length ? `Design Thinking actualizado: ${plural(x.resultados.length, "herramienta", "herramientas")} con los datos cargados. <a href="#/dt">Ver Design Thinking</a>` : `Design Thinking al día. <a href="#/dt">Ver Design Thinking</a>`; });
        toast("Lote guardado"); cargarLotes(); cargarEvidencias();
      } catch (e) { pintarFases(3, e.message, 90, "err"); R.insertAdjacentHTML("afterbegin", errorVista({mensaje: e.message + " No se guardó ninguna fila."})); }
    };
  } catch (e) { pintarFases(0, e.message, 5, "err"); R.innerHTML = errorVista({mensaje: e.message}); }
  finally { const b = document.getElementById("val"); if (b) b.disabled = false; }
}
async function cargarLotes() {
  const p = await Nucleo.proyecto(A), l = (await A.leer("lote_importado", {proyecto_id: p.id})).sort((a, b) => b.id - a.id);
  document.getElementById("lotes").innerHTML = l.length ? `<div class="tabla-cont"><table><thead><tr><th>Fecha</th><th>Archivo</th><th>Usuario</th><th>Filas leídas</th><th>Nuevas</th><th>Ya registradas</th></tr></thead><tbody>${l.map(x => `<tr><td class="num">${esc(Nucleo.fmtFechaHora(x.fecha_utc))}</td><td>${esc(x.archivo)}</td><td>${esc(x.usuario)}</td><td class="num">${fmtNum(x.filas_leidas)}</td><td class="num">${fmtNum(x.filas_nuevas)}</td><td class="num">${fmtNum(x.filas_existentes)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="vacio">Aún no hay lotes cargados. Use «Descargar ejemplo de carga» para probar.</p>`;
}
async function cargarEvidencias() {
  const p = await Nucleo.proyecto(A), [ev, inc] = await Promise.all([A.leer("evidencia", {proyecto_id: p.id}), A.leer("incidencia", {proyecto_id: p.id})]), I2 = new Map(inc.map(i => [i.id, i.codigo]));
  document.getElementById("evid").innerHTML = ev.length ? `<div class="tabla-cont"><table><thead><tr><th>Código</th><th>Caso</th><th>Tipo</th><th>Origen</th><th>Contenido</th><th>Naturaleza</th><th>Enlace</th></tr></thead><tbody>${ev.sort((a, b) => b.id - a.id).map(x => `<tr><td class="num">${esc(x.codigo)}</td><td>${I2.has(x.incidencia_id) ? `<a href="#/exp/${esc(I2.get(x.incidencia_id))}">${esc(I2.get(x.incidencia_id))}</a>` : "—"}</td><td>${esc(x.tipo)}</td><td>${esc(x.origen)}</td><td>${esc(x.contenido)}</td><td><span class="et gris">Sintética</span></td><td>${x.url_https ? `<a href="#/operacion" title="Verificar en Operación">${esc(new URL(x.url_https).hostname)}</a>` : "—"}</td></tr>`).join("")}</tbody></table></div>` : `<p class="vacio">Sin evidencias registradas. Se agregan con el reporte del cliente o con la hoja «Evidencias».</p>`;
}

/* ---------------------------------------------------- 20–30 · Design Thinking */
const EST_DT = {SIN_INICIAR: ["gris", "Sin iniciar"], BORRADOR: ["amarillo", "Pendiente"], COMPLETA: ["azul", "Completa"], VALIDADA: ["verde", "Validada"], EN_CURSO: ["amarillo", "En curso"]};
const etDT = e => `<span class="et ${EST_DT[e][0]}">${e === "VALIDADA" || e === "COMPLETA" ? I.check : I.reloj}${EST_DT[e][1]}</span>`;
async function vistaDT() {
  interna("dt", [["Design Thinking"]], `<div id="dtv"><p>Cargando…</p></div>`);
  { const h0 = location.hash; await syncDT(); if (location.hash !== h0) return; }
  const cx = await ctx().catch(() => null), sedeSel = sedeAct(), sedeNom = (cx?.sedes || []).find(x => String(x.id) === sedeSel)?.nombre;
  const gS = sedeSel ? await DTAuto.porSede(A, sedeSel).catch(() => null) : null;
  const p = await Nucleo.proyecto(A), av = await DT.avance(A, p.id), vg = DT.vigente(await DT.versiones(A, p.id)), C = k => sedeSel ? (gS ? gS.contenidos[k] : {}) : vg[k] ? JSON.parse(vg[k].contenido) : {};
  const gen = C("EM1")._generado, genGeneral = vg.EM1 ? JSON.parse(vg.EM1.contenido)._generado : null;
  const sel = C("ID2").seleccion, fr = (C("EM2").etapas || []).find(e => e.friccion && e.friccion !== "—"), causa = (C("DF1").causas || [])[0], ficha = (C("PR2").fichas || [])[0], pr = DT.resumenPrueba(C("PV1"));
  const rk = DT.ranking(C("ID2").filas), pos = rk.findIndex(x => x.idea === sel), esc1 = (C("PR1").escenas || []).filter(e => e.titulo), nN = esc1.filter(e => e.tipo !== "Excepción").length, nX = esc1.length - nN;
  const evGen = gen ? [...new Set((C("EM1").entradas || []).flatMap(x => String(x.evidencia || "").match(/INC-\d+|HIS-S\d+-\d+/g) || []))].slice(0, 3).join(" · ") : null;
  const traza = {evidencia: evGen || "INC-0126 · INC-0130", friccion: fr?.friccion, hipotesis: causa?.causa, reto: C("DF2").pregunta, idea: sel, puntaje: pos >= 0 ? `${fmtNum(rk[pos].puntaje, 2)} de 5 · ${pos + 1}.ª de ${rk.length} ideas` : null,
    guion: esc1.length ? `${plural(nN, "escena", "escenas")}${nX ? ` + ${plural(nX, "excepción", "excepciones")}` : ""}` : null, prototipo: ficha?.nombre, tarea: (C("PV1").intentos || [])[0]?.tarea,
    resultado: pr.tasa != null ? `${fmtNum(pr.tasa, 1)} % sin ayuda (umbral ${pr.umbral ?? "—"} %)` : null, decision: C("PV2").decision};
  document.getElementById("dtv").innerHTML = `<div class="fila" style="justify-content:space-between"><div><h1>Avance de Design Thinking</h1><p class="sub">Cinco etapas y diez herramientas. Una herramienta cuenta cuando su versión vigente está completa; la validación registra quién la revisó.</p></div>
   <div class="tarjeta" style="min-width:320px"><strong class="num" style="font-size:28px">${av.completas} de ${av.total}</strong> herramientas completas · ${plural(av.validadas, "validada", "validadas")}
   <div class="barra-dt" role="progressbar" aria-valuenow="${av.porcentaje}" aria-valuemin="0" aria-valuemax="100" aria-label="Avance metodológico"><i style="width:${av.porcentaje}%"></i></div><span class="num">${av.porcentaje} %</span></div></div>
   <div class="filtros ambito-dt"><label for="dtsede"><b>Ámbito del análisis</b></label><select id="dtsede"><option value="">Todas las sedes (general · versiones guardadas)</option>${(cx?.sedes || []).map(x => `<option value="${x.id}" ${String(x.id) === sedeSel ? "selected" : ""}>${esc(x.nombre)}${x.piloto ? " (piloto)" : ""}</option>`).join("")}</select>
     ${sedeSel ? `<span class="et azul">Vista por sede: ${esc(sedeNom || "")} · ${gS ? esc(gS.base) : "sin incidencias registradas"}</span>` : ""}</div>
   ${sedeSel ? `<div class="aviso info" style="margin-bottom:12px">${I.bd}<div><b>Análisis de ${esc(sedeNom || "la sede")} calculado al momento</b>La trazabilidad, la estimación y las herramientas (al abrirlas) usan solo los datos de esta sede. No se guardan versiones: las versiones guardadas, el avance y las confirmaciones corresponden al análisis general.</div></div>` : ""}
   <section class="tarjeta auto-dt"><div class="auto-dt-t">${I.bd}<div><h2>Design Thinking automatizado</h2><p>Las 10 herramientas se calculan con las incidencias, contactos y eventos registrados o cargados desde Excel, y <b>se actualizan solas cada vez que cambian los datos</b>. Cada herramienta muestra la regla aplicada; cada cambio crea una versión nueva y conserva las anteriores. Las herramientas editadas a mano no se sobrescriben.</p>${E.avisoDT ? `<div class="aviso pend" style="margin:6px 0">${I.alerta}<div><b>${esc(E.avisoDT)}</b></div></div>` : ""}
     <p class="auto-dt-h"><b>Requiere confirmación humana:</b> la elección de la idea (Matriz de priorización) y la decisión final (Resultados, mejoras y decisión).${genGeneral ? ` <b>Última generación (general):</b> ${esc(Nucleo.fmtFechaHora(genGeneral.utc))} · ${esc(genGeneral.base)}.` : ""}</p></div>
     <button class="btn sec" id="gendt">${I.check} Regenerar todo</button></div><div id="genmsg"></div></section>
   <div class="etapas">${av.etapas.map((e, i) => `<section class="tarjeta etapa"><div class="fila" style="justify-content:space-between"><h2>${i + 1}. ${e.nombre}</h2>${etDT(e.estado === "SIN_INICIAR" ? "SIN_INICIAR" : e.estado)}</div><small>${e.completas} de 2 herramientas</small>
     ${e.herramientas.map(h => `<a class="herr" href="#/dt/${h.codigo}"><div class="fila" style="justify-content:space-between"><strong>${esc(h.nombre)}</strong>${etDT(h.estado)}</div><small>v${h.version}${h.revisado_por ? ` · revisó ${esc(h.revisado_por)}` : ""}</small>${h.faltantes.length && h.estado !== "SIN_INICIAR" ? `<small class="falta">Falta: ${esc(h.faltantes[0])}</small>` : ""}</a>`).join("")}</section>`).join("")}</div>
   <section class="tarjeta" style="margin-top:16px"><h2 style="margin-top:0;font-size:18px">Trazabilidad del problema a la decisión</h2>${DTG.trazabilidad(traza)}</section>
   <section class="tarjeta" style="margin-top:16px"><h2 style="margin-top:0;font-size:18px">Estimación de cambios favorables</h2><div id="estim"></div></section>`;
  document.getElementById("dtsede").onchange = e => cambiarSede(e.target.value);
  document.getElementById("gendt").onclick = () => {
    document.getElementById("genmsg").innerHTML = `<div class="aviso pend">${I.alerta}<div><b>¿Regenerar las 10 herramientas desde los datos?</b>También se reemplazan las herramientas editadas a mano (sus versiones anteriores se conservan en «Versiones»). Si la propuesta no cambia, se conservan tus confirmaciones.<div class="fila" style="margin-top:8px"><button class="btn" id="okgen">Regenerar</button><button class="btn sec" id="nogen">Cancelar</button></div></div></div>`;
    document.getElementById("nogen").onclick = () => { document.getElementById("genmsg").innerHTML = ""; };
    document.getElementById("okgen").onclick = async () => {
      try { const r = await generarDT(); E.avisoDT = r.perdidas.length ? `La propuesta cambió: vuelve a confirmar ${r.perdidas.map(k => k === "ID2" ? "la elección (Matriz de priorización)" : "la decisión final").join(" y ")}.` : null; toast(r.resultados.length ? `Design Thinking regenerado: ${plural(r.resultados.length, "herramienta actualizada", "herramientas actualizadas")}` : "Sin cambios: las herramientas ya reflejan los datos actuales"); vistaDT(); }
      catch (e) { document.getElementById("genmsg").innerHTML = errorVista(e); }
    };
  };
  { const r = await Resultados.calcular(A, {sede_id: sedeSel}).catch(() => null), sim = Resultados.simularCon(r);
    document.getElementById("estim").innerHTML = `<div class="comparacion"><div><small>${sedeSel ? esc(sedeNom || "Sede") : "Todas las sedes"} · registrado (sintético)</small><b class="num">${r?.ind.tasa == null ? "—" : fmtNum(r.ind.tasa, 1) + " %"}</b><span>${r ? `${r.ind.a_tiempo} de ${r.ind.elegibles} elegibles a tiempo` : ""}</span></div><div><small>Flujo actual (simulado${sim.calibrada ? ", calibrado con los datos" : ""})</small><b class="num">${fmtNum(sim.tasa_actual, 1)} %</b><span>${sim.actual} de ${sim.elegibles}</span></div><div class="flecha">→</div><div><small>Flujo propuesto (simulado)</small><b class="num">${fmtNum(sim.tasa_propuesto, 1)} %</b><span>${sim.propuesto} de ${sim.elegibles}</span></div><div class="dif"><small>Cambio favorable estimado</small><b class="num">+${fmtNum(sim.diferencia_pp, 1)} pp</b><span>${Math.round(sim.diferencia_pp / 100 * 104)} soluciones más a tiempo cada 30 días (104 incidencias)</span></div></div>
    <p style="font-size:13px;color:var(--neutro-tx);margin-bottom:0">Proyección con supuestos explícitos (ver Indicadores → Supuestos). También se espera menos repetición de datos al cambiar de canal. El valor en soles queda por estimar hasta definir margen y costos. <a href="#/indicadores">Ver indicadores</a></p>`; }
}
function vistaHerramienta(d, H) {
  /* v0.7.0: vista gráfica (solo presentación) + el mismo detalle en tabla, desplegable */
  const c = d.contenido, r = DT.resumenPrueba(d.codigo === "PV2" ? d.pv1 || {} : c);
  const extra = {df2: d.df2, ranking: DT.ranking, resumen: d.codigo === "PV1" || d.codigo === "PV2" ? r : null};
  let g = "";
  try { g = window.DTG && DTG.tiene(d.codigo) ? DTG[d.codigo](c, extra) : ""; } catch (e) { console.error(e); g = ""; }
  if (!g) return avisoGenerado(c, d) + genericaVista(d, H);
  return `${avisoGenerado(c, d)}${g}<details class="detalle-tabla"><summary>Ver el detalle en tabla</summary>${genericaVista(d, H)}</details>`;
}
function genericaVista(d, H) {
  const c = d.contenido;
  return `${H.campos.length ? `<dl class="kv" style="margin-bottom:14px">${H.campos.map(([k, t]) => `<dt>${t}</dt><dd>${esc(c[k] || "—")}</dd>`).join("")}</dl>` : ""}
   ${Object.entries(H.listas).map(([k, L]) => `<h3 style="font-size:16px">${L.titulo}</h3><div class="tabla-cont"><table><thead><tr>${L.cols.map(x => `<th>${x[1]}</th>`).join("")}</tr></thead><tbody>${(c[k] || []).map(r => `<tr>${L.cols.map(([q, , tipo]) => `<td class="${tipo === "num" ? "num" : ""}">${esc(r[q] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`).join("")}`;
}
function editorHerramienta(c, H) {
  const ctl = (id, val, tipo, ops) => tipo === "sel" ? `<select id="${id}"><option value=""></option>${ops.map(o => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>` : tipo === "num" ? `<input id="${id}" type="number" step="any" value="${esc(val ?? "")}">` : `<input id="${id}" value="${esc(val ?? "")}">`;
  return `${H.campos.map(([k, t, tipo, ops]) => campo("f_" + k, t, tipo === "sel" ? ctl("f_" + k, c[k], "sel", ops) : `<textarea id="f_${k}" rows="2">${esc(c[k] || "")}</textarea>`)).join("")}
   ${Object.entries(H.listas).map(([k, L]) => `<h3 style="font-size:16px">${L.titulo}</h3><div class="tabla-cont"><table class="editable" data-lista="${k}"><thead><tr>${L.cols.map(x => `<th>${x[1]}</th>`).join("")}<th></th></tr></thead><tbody>${(c[k] || []).map((r, i) => `<tr>${L.cols.map(([q, , tipo, ops]) => `<td>${ctl(`l_${k}_${i}_${q}`, r[q], tipo, ops)}</td>`).join("")}<td><button type="button" class="link" data-quitar>Quitar</button></td></tr>`).join("")}</tbody></table></div><button type="button" class="btn sec" data-agregar="${k}" style="margin:8px 0 14px">+ Agregar fila</button>`).join("")}`;
}
function leerEditor(H) {
  const c = {};
  for (const [k] of H.campos) c[k] = v("f_" + k);
  for (const [k, L] of Object.entries(H.listas)) c[k] = [...document.querySelectorAll(`table[data-lista="${k}"] tbody tr`)].map(tr => Object.fromEntries(L.cols.map(([q, , tipo], j) => { const val = tr.querySelectorAll("td")[j].querySelector("input,select").value.trim(); return [q, tipo === "num" ? (val === "" ? "" : Number(val)) : val]; })));
  return c;
}
async function vistaDTHerramienta(cod, modo, ver) {
  const H = DT.H[cod]; if (!H) { location.hash = "#/dt"; return; }
  const etapa = DT.ETAPAS.find(e => e[0] === H.etapa)[1];
  interna("dt", [["Design Thinking", "#/dt"], [H.nombre]], `<div id="hv"><p>Cargando…</p></div>`);
  if (modo !== "editar") { const h0 = location.hash; await syncDT(); if (location.hash !== h0) return; }
  const p = await Nucleo.proyecto(A), vs = await DT.versiones(A, p.id, cod), ult = vs[vs.length - 1], mostrada = ver ? vs.find(x => x.version === Number(ver)) : ult;
  if (!mostrada) { document.getElementById("hv").innerHTML = `<div class="tarjeta vacio">Sin versiones.</div>`; return; }
  const d = {codigo: cod, contenido: JSON.parse(mostrada.contenido), autor: mostrada.autor};
  if (sedeAct() && modo !== "editar" && !ver) { const gS = await DTAuto.porSede(A, sedeAct()).catch(() => null), nom = nombreSede();
    if (gS) { d.contenido = gS.contenidos[cod]; d.sedeVista = `${nom} · ${gS.base}`; } }
  if (cod === "PV2") { const pv1 = (await DT.versiones(A, p.id, "PV1")).pop(); d.pv1 = pv1 ? JSON.parse(pv1.contenido) : {}; }
  if (cod === "ID1") { const df2 = (await DT.versiones(A, p.id, "DF2")).pop(); d.df2 = df2 ? JSON.parse(df2.contenido) : {}; }
  const falt = DT.faltantes(cod, d.contenido), antigua = mostrada.version !== ult.version;
  document.getElementById("hv").innerHTML = `<div class="fila" style="justify-content:space-between"><div><small class="etapa-chip">${etapa} · pantalla ${H.pantalla}</small><h1>${esc(H.nombre)}</h1></div><div class="fila">${etDT(mostrada.estado)}<span class="et gris">v${mostrada.version}${antigua ? " (anterior)" : ""}</span><span class="et gris">${mostrada.naturaleza === "SIMULADO" ? "Contenido simulado" : "Contenido registrado"}</span></div></div>
   <p class="sub">Autor: ${esc(mostrada.autor)} · ${esc(Nucleo.fmtFechaHora(mostrada.fecha_utc))}${mostrada.revisado_por ? ` · Revisó: ${esc(mostrada.revisado_por)} (${esc(Nucleo.fmtFechaHora(mostrada.fecha_revision_utc))})` : ""}</p>
   <nav class="subtabs"><a href="#/dt/${cod}" class="${modo !== "editar" && modo !== "versiones" ? "activa" : ""}">Vista</a>${antigua ? "" : `<a href="#/dt/${cod}/editar" class="${modo === "editar" ? "activa" : ""}">Editar</a>`}<a href="#/dt/${cod}/versiones" class="${modo === "versiones" ? "activa" : ""}">Versiones (${vs.length})</a></nav>
   <div id="hcont"></div>`;
  const hc = document.getElementById("hcont");
  if (modo === "versiones") {
    hc.innerHTML = `<section class="tarjeta"><div class="tabla-cont"><table><thead><tr><th>Versión</th><th>Estado</th><th>Autor</th><th>Fecha</th><th>Revisión</th><th></th></tr></thead><tbody>${[...vs].reverse().map(x => `<tr><td class="num">v${x.version}</td><td>${etDT(x.estado)}</td><td>${esc(x.autor)}</td><td class="num">${esc(Nucleo.fmtFechaHora(x.fecha_utc))}</td><td>${esc(x.revisado_por || "—")}</td><td><a href="#/dt/${cod}/v/${x.version}">Ver</a></td></tr>`).join("")}</tbody></table></div><p style="font-size:13px;color:var(--neutro-tx)">Cada guardado crea una versión nueva; las anteriores y su revisión se conservan.</p></section>`;
    return;
  }
  if (modo === "editar") {
    hc.innerHTML = `<section class="tarjeta panel-accion"><form id="fe">${editorHerramienta(d.contenido, H)}<div id="perr"></div><div class="fila"><button class="btn" id="gh" type="submit">${I.check} Guardar como v${ult.version + 1}</button><a class="btn sec" href="#/dt/${cod}">Cancelar</a></div></form></section>`;
    hc.querySelectorAll("[data-agregar]").forEach(b => b.onclick = () => { const c = leerEditor(H); (c[b.dataset.agregar] ||= []).push({}); hc.querySelector("form").innerHTML = editorHerramienta(c, H) + hc.querySelector("form").innerHTML.slice(hc.querySelector("form").innerHTML.indexOf('<div id="perr">')); vistaEditorEventos(); });
    const vistaEditorEventos = () => { hc.querySelectorAll("[data-quitar]").forEach(b => b.onclick = () => b.closest("tr").remove()); hc.querySelectorAll("[data-agregar]").forEach(b => b.onclick = () => { const c = leerEditor(H); (c[b.dataset.agregar] ||= []).push({}); const f = hc.querySelector("form"); const resto = f.innerHTML.slice(f.innerHTML.indexOf('<div id="perr">')); f.innerHTML = editorHerramienta(c, H) + resto; vistaEditorEventos(); }); };
    vistaEditorEventos();
    hc.querySelector("form").onsubmit = async ev => { ev.preventDefault(); const c = leerEditor(H);
      try { const r = await Actividad.ejecutar(`Guardando ${H.nombre}`, [{texto: "Revisando campos obligatorios", fn: async () => DT.faltantes(cod, c)}, {texto: `Creando la versión ${ult.version + 1}`, fn: () => DT.guardar(A, p.id, cod, c, ult.version, E.usuario)}, {texto: "Actualizando el avance", fn: async r => r}]);
        marcarGuardado(); toast(r.estado === "COMPLETA" ? `Versión ${r.version} guardada · completa` : `Versión ${r.version} guardada · faltan ${r.faltantes.length} datos`); location.hash = `#/dt/${cod}`;
      } catch (e) { errores("perr", {codigo: e.codigo, mensaje: e.message}); } };
    return;
  }
  hc.innerHTML = `${falt.length ? `<div class="aviso pend">${I.reloj}<div><b>Pendiente para completar</b>${falt.map(esc).join(" · ")}${antigua ? "" : ` <a href="#/dt/${cod}/editar">Editar</a>`}</div></div>` : ""}
   <section class="tarjeta">${vistaHerramienta(d, H)}</section>
   ${!antigua && mostrada.estado === "COMPLETA" ? `<section class="tarjeta" style="margin-top:16px"><h2 style="margin-top:0;font-size:18px">Validar versión ${mostrada.version}</h2><form id="fv2" class="grid2">${campo("revisor", "Revisado por", `<input id="revisor" value="">`, "Nombre de quien revisó el resultado (usuario responsable).")}${campo("nota", "Nota de revisión", `<input id="nota" maxlength="500">`)}</form><div id="verr2"></div><button class="btn" id="bval">${I.check} Validar</button></section>` : ""}`;
  document.getElementById("bval")?.addEventListener("click", async () => {
    try { await Actividad.ejecutar("Validando herramienta", [{texto: "Registrando revisión", fn: () => DT.validar(A, p.id, cod, v("revisor"), v("nota"))}]); marcarGuardado(); toast(`${H.nombre} validada`); router(); }
    catch (e) { errores("verr2", e.campos ? {campos: e.campos} : {mensaje: e.message}); }
  });
}


/* ---------------------------------------------------- 31–32 · Indicadores, comparación y valor */
const fmtPct = x => x == null ? "Sin datos para calcular" : `${fmtNum(x, 2)} %`;
function barra(etq, val, max, txt, cls = "") { const w = max ? Math.max(2, Math.round(val / max * 100)) : 0; return `<div class="gbar"><span>${esc(etq)}</span><div><i class="${cls}" style="width:${w}%"></i></div><b class="num">${txt}</b></div>`; }
async function vistaIndicadores() {
  const h0 = location.hash, c = await ctx().catch(() => null), f = E.filtrosInd ||= {sede_id: "", desde: "", hasta: ""}; f.sede_id = sedeAct();
  if (location.hash !== h0) return;
  interna("indicadores", [["Indicadores"]], `<h1>Indicadores del piloto</h1><p class="sub">Calculados desde los registros guardados. Cambie los filtros para ver otro alcance; la exportación usa los mismos filtros.</p>
  <div class="filtros"><label class="sr" for="is">Sede</label><select id="is"><option value="">Sede: todas</option>${(c?.sedes || []).map(x => `<option value="${x.id}" ${String(x.id) === f.sede_id ? "selected" : ""}>${esc(x.nombre)}</option>`).join("")}</select>
  <label class="fila" style="gap:6px">Desde <input type="date" id="id" value="${f.desde}"></label><label class="fila" style="gap:6px">Hasta <input type="date" id="ih" value="${f.hasta}"></label><button class="btn sec" id="ilimpiar">Todo el periodo</button></div><div id="ind"><p>Calculando…</p></div>`);
  const aplicar = () => { f.desde = v("id"); f.hasta = v("ih"); if (v("is") !== f.sede_id) return cambiarSede(v("is")); vistaIndicadores(); };
  ["is", "id", "ih"].forEach(k => document.getElementById(k).onchange = aplicar); document.getElementById("ilimpiar").onclick = () => { E.sede = ""; sessionStorage.setItem("pc08_sede", ""); sessionStorage.setItem("pc08_sede_elegida", "1"); E.filtros.sede_id = ""; E.filtrosInd = {sede_id: "", desde: "", hasta: ""}; vistaIndicadores(); };
  const filtros = {sede_id: f.sede_id, desde: f.desde ? Date.parse(f.desde + "T00:00:00-05:00") / 1000 : null, hasta: f.hasta ? Date.parse(f.hasta + "T00:00:00-05:00") / 1000 + 86400 : null};
  let r; try { r = await Actividad.ejecutar("Calculando indicadores", [{texto: "Leyendo incidencias y funciones", fn: () => Resultados.calcular(A, filtros)}, {texto: "Aplicando reglas de elegibilidad (P-01)", fn: async r => r}]); } catch (e) { document.getElementById("ind").innerHTML = errorVista(e, "router()"); return; }
  E.ultimoCalculo = {r, filtros}; const i = r.ind, sim = Resultados.simularCon(r), val = Resultados.valor(sim, E.supuestos);
  const maxM = Math.max(1, ...r.porMotivo.map(m => m.elegibles));
  Nucleo.feriados(A).then(info => { const el = document.getElementById("ifer"); if (!el || !info) return;
    const enRango = f.desde || f.hasta ? info.lista.filter(x => (!f.desde || x.fecha >= f.desde) && (!f.hasta || x.fecha <= f.hasta)) : Nucleo.proximosFeriados(info, 3);
    el.innerHTML = `<div class="aviso info fer-ind">${I.reloj}<div><b>${f.desde || f.hasta ? `Feriados oficiales en el periodo filtrado: ${enRango.length}` : "Próximos feriados oficiales (alta demanda)"}</b>${enRango.map(x => `${esc(fmtDiaFer(x.fecha))} · ${esc(x.nombre)}`).join(" | ") || "Ninguno."} <small>(datos reales, ${esc(info.fuente)})</small></div></div>`; }).catch(() => {});
  document.getElementById("ind").innerHTML = `<p class="alcance">${I.bd} ${esc(r.sede)} · ${f.desde || f.hasta ? `apertura ${esc(f.desde || "…")} a ${esc(f.hasta || "…")}` : "todos los registros"} · corte ${esc(Nucleo.fmtFechaHora(r.corte))} · datos sintéticos · fórmulas ${esc(r.formula)}</p><div id="ifer"></div>
   <div class="kpis"><div class="tarjeta kpi principal"><small>Solución verificada antes del inicio</small><div class="num">${fmtPct(i.tasa)}</div><span>${i.a_tiempo} de ${plural(i.elegibles, "incidencia elegible", "incidencias elegibles")}</span></div>
   <div class="tarjeta kpi"><small>Contactos por incidencia</small><div class="num">${i.contactos_por_incidencia == null ? "—" : fmtNum(i.contactos_por_incidencia, 2)}</div><span>${plural(i.vinculados, "duplicado vinculado", "duplicados vinculados")}</span></div>
   <div class="tarjeta kpi"><small>Tiempo de atención mediano</small><div class="num">${i.mediana_atencion_min == null ? "—" : fmtNum(i.mediana_atencion_min, 1) + " min"}</div><span>de primer contacto a solución verificada</span></div>
   <div class="tarjeta kpi"><small>Reaperturas</small><div class="num">${i.reaperturas}</div><span>mismo motivo en 24 h (R22)</span></div></div>
   <div class="grid2" style="margin-top:16px"><section class="tarjeta"><h2 class="h2">Universo elegible (${fmtNum(i.elegibles)})</h2>
     ${barra("A tiempo", i.a_tiempo, i.elegibles, fmtNum(i.a_tiempo), "ok")}${barra("Resueltas después del inicio", i.despues, i.elegibles, fmtNum(i.despues), "am")}${barra("Sin solución, función iniciada", i.sin_solucion, i.elegibles, fmtNum(i.sin_solucion), "rj")}${barra("Pendientes dentro de la ventana", i.pendientes, i.elegibles, fmtNum(i.pendientes), "az")}
     <h3 class="h3">Fuera del universo (se reportan aparte)</h3><p style="margin:0;font-size:14px">${plural(i.posteriores, "abierta", "abiertas")} después del inicio · ${plural(i.verificar_horario, "caso", "casos")} con horario por verificar · ${plural(i.vinculados, "duplicado vinculado", "duplicados vinculados")} · total ${fmtNum(i.total)}</p></section>
    <section class="tarjeta"><h2 class="h2">Solución a tiempo por motivo</h2>${r.porMotivo.length ? r.porMotivo.map(m => barra(m.motivo, m.a_tiempo, m.elegibles, `${m.a_tiempo}/${m.elegibles}`, "ok")).join("") : `<p class="vacio">Sin incidencias elegibles en el alcance.</p>`}</section></div>
   <section class="tarjeta" style="margin-top:16px"><div class="fila" style="justify-content:space-between"><h2 class="h2" style="margin:0">Comparación de escenarios equivalentes · simulación</h2><span class="et amarillo">Resultado simulado, no observado</span></div>
    <p class="sub" style="margin:6px 0 12px">Los mismos ${sim.n} episodios sintéticos (${sim.elegibles} elegibles) se procesan con el flujo actual y con el flujo propuesto (P-02).</p>
    <div class="comparacion"><div><small>Flujo actual</small><b class="num">${sim.actual} de ${sim.elegibles}</b><span>${fmtPct(sim.tasa_actual)}</span></div><div class="flecha">→</div><div><small>Flujo propuesto</small><b class="num">${sim.propuesto} de ${sim.elegibles}</b><span>${fmtPct(sim.tasa_propuesto)}</span></div><div class="dif"><small>Diferencia</small><b class="num">${sim.diferencia_pp >= 0 ? "+" : ""}${fmtNum(sim.diferencia_pp, 1)} puntos porcentuales</b><span>no es un porcentaje relativo</span></div></div>
    <details style="margin-top:12px"><summary>Supuestos de la simulación</summary><dl class="kv" style="margin-top:8px">${Resultados.supuestos(sim).map(([k, x]) => `<dt>${esc(k)}</dt><dd style="font-weight:500">${esc(x)}</dd>`).join("")}</dl></details>
    <p style="font-size:13px;color:var(--neutro-tx)">Sensibilidad: con 52 episodios ${fmtNum(Resultados.simularCon(r, 52).diferencia_pp, 1)} pp; con 156 episodios ${fmtNum(Resultados.simularCon(r, 156).diferencia_pp, 1)} pp. La hipótesis queda pendiente de contraste con registros reales autorizados.</p></section>
   <section class="tarjeta" style="margin-top:16px"><h2 class="h2">Estimación de valor (R30)</h2><p class="sub" style="margin-top:0">Se calcula solo con supuestos explícitos. Una entrada ya pagada que se recupera cuenta como recuperación del servicio, no como venta nueva.</p>
    <form id="fsup" class="fila">${campo("margen", "Margen por solución adicional a tiempo (S/)", `<input id="margen" type="number" step="0.01" min="0" value="${esc(E.supuestos?.margen ?? "")}">`)}${campo("costo_contacto", "Costo por contacto evitado (S/)", `<input id="costo_contacto" type="number" step="0.01" min="0" value="${esc(E.supuestos?.costo_contacto ?? "")}">`)}${campo("costo_incremental", "Costo incremental del periodo (S/)", `<input id="costo_incremental" type="number" step="0.01" min="0" value="${esc(E.supuestos?.costo_incremental ?? "")}">`)}<button class="btn sec">Calcular</button></form>
    <div id="valor">${val ? `<div class="kpis">${[["Conservador", val.conservador], ["Central", val.central], ["Favorable", val.favorable]].map(([k, x]) => `<div class="tarjeta kpi"><small>${k}</small><div class="num">S/ ${fmtNum(x.beneficio, 2)}</div><span>${x.adicionales} soluciones adicionales a tiempo</span></div>`).join("")}</div>` : `<div class="aviso pend">${I.reloj}<div><b>Por estimar</b>Ingrese margen y costo incremental para proyectar el valor. Sin esos supuestos no se muestra una cifra monetaria.</div></div>`}</div></section>`;
  document.getElementById("fsup").onsubmit = ev => { ev.preventDefault(); E.supuestos = {margen: v("margen"), costo_contacto: v("costo_contacto"), costo_incremental: v("costo_incremental")}; vistaIndicadores(); };
}

/* ---------------------------------------------------- 33 · Exportaciones */
function vistaExportaciones() {
  const f = {...(E.filtrosInd || {desde: "", hasta: ""}), sede_id: sedeAct()};
  interna("exportaciones", [["Exportaciones"]], `<h1>Exportaciones</h1><p class="sub">Los archivos se generan desde los datos guardados, con los mismos cálculos que muestran las pantallas.</p>
  <div class="grid2"><section class="tarjeta exp-card"><h2 class="h2">Resultados de la solución</h2><p>Resumen, indicadores, casos filtrados, resultado por motivo, escenarios simulados, supuestos y calidad de datos.</p>
   <p class="alcance">Alcance: ${esc(nombreSede(f.sede_id))} · ${f.desde || f.hasta ? `${esc(f.desde || "…")} a ${esc(f.hasta || "…")}` : "todo el periodo"}</p><div id="st1"><span class="et gris">Pendiente</span></div><button class="btn" id="x1">Generar y descargar</button></section>
  <section class="tarjeta exp-card"><h2 class="h2">Resultados de Design Thinking</h2><p>Resumen de avance, una hoja por etapa con las diez herramientas, prototipos, pruebas, evidencias y versiones.</p><p class="alcance">Alcance: ${f.sede_id ? `${esc(nombreSede(f.sede_id))} (análisis calculado para la sede)` : "todas las sedes (versiones guardadas)"}</p><div id="st2"><span class="et gris">Pendiente</span></div><button class="btn" id="x2">Generar y descargar</button></section></div>`);
  const gen = async (id, nombre, fn) => { const st = document.getElementById(id); st.innerHTML = `<span class="et azul">${I.reloj}En preparación…</span>`;
    try { const u8 = await fn(); const r = await A.guardarArchivo(nombre, Carga.b64(u8)); st.innerHTML = r?.guardado ? `<span class="et verde">${I.check}Disponible · ${esc(r.ruta)}</span>` : `<span class="et gris">Cancelado por el usuario</span>`; if (r?.guardado) { toast(`${nombre} guardado`); marcarGuardado(); } }
    catch (e) { st.innerHTML = `<span class="et rojo">${I.alerta}${esc(e.message)}</span>`; } };
  const filtros = {sede_id: f.sede_id, desde: f.desde ? Date.parse(f.desde + "T00:00:00-05:00") / 1000 : null, hasta: f.hasta ? Date.parse(f.hasta + "T00:00:00-05:00") / 1000 + 86400 : null};
  document.getElementById("x1").onclick = () => gen("st1", "07_Resultados_de_la_Solucion.xlsx", () => Actividad.ejecutar("Exportando resultados", [{texto: "Calculando indicadores", fn: () => Resultados.calcular(A, filtros)}, {texto: "Simulando escenarios", fn: async r => ({r, sim: Resultados.simularCon(r)})}, {texto: "Escribiendo 7 hojas de Excel", fn: async x => Resultados.excelResultados(x.r, x.sim, Resultados.valor(x.sim, E.supuestos), E.usuario.nombre)}]));
  document.getElementById("x2").onclick = () => gen("st2", "08_Resultados_Design_Thinking.xlsx", () => Actividad.ejecutar("Exportando Design Thinking", [{texto: "Actualizando Design Thinking con los datos vigentes", fn: () => api(() => DTAuto.sincronizar(A, autorAuto()))}, {texto: "Escribiendo hojas por etapa", fn: async () => Resultados.excelDT(A, E.usuario.nombre, f.sede_id ? {nombre: nombreSede(f.sede_id), g: await DTAuto.porSede(A, f.sede_id)} : null)}]));
}

/* ---------------------------------------------------- 34 · Configuración: reglas y catálogo */
async function vistaConfiguracion() {
  interna("configuracion", [["Configuración"]], `<h1>Reglas y catálogo de incidencias</h1><p class="sub">Los motivos nuevos usan el flujo general (R29): se registran, clasifican, priorizan, derivan y miden con la misma estructura. El catálogo y las reglas son comunes a todas las sedes${sedeAct() ? ` (sede seleccionada: ${esc(nombreSede())})` : ""}.</p><div id="cf"><p>Cargando…</p></div>`);
  const tipos = (await A.leer("tipo_incidencia", {})).sort((a, b) => a.codigo.localeCompare(b.codigo));
  document.getElementById("cf").innerHTML = `<div class="grid2"><section class="tarjeta"><h2 class="h2">Umbrales de prioridad (R07–R10)</h2><div class="tabla-cont"><table style="min-width:360px"><thead><tr><th>Condición</th><th>Nivel</th></tr></thead><tbody>
   <tr><td>Faltan 15 min o menos</td><td><span class="et rojo">Crítico</span></td></tr><tr><td>Más de 15 y hasta 45 min</td><td><span class="et amarillo">Urgente</span></td></tr><tr><td>Más de 45 min</td><td><span class="et gris">Normal</span></td></tr><tr><td>Horario faltante o contradictorio</td><td><span class="et amarillo">Verificar horario</span></td></tr><tr><td>Función iniciada</td><td><span class="et rojo">Función iniciada</span></td></tr></tbody></table></div>
   <p style="font-size:13px;color:var(--neutro-tx)">Versión de reglas v1. Cambiar los umbrales requiere aprobación del responsable del estudio. Reapertura: 24 h · revisión de escalamiento: 5 min.</p></section>
   <section class="tarjeta"><h2 class="h2">Agregar motivo</h2><form id="fm2">${campo("tc", "Código", `<input id="tc" placeholder="Ej.: T91" maxlength="5">`)}${campo("tn", "Nombre", `<input id="tn" maxlength="80" placeholder="Ej.: Combo no entregado">`)}
   <div class="grid2">${campo("tg", "Grupo", `<input id="tg" value="Otros">`)}${campo("tr", "Responsable", `<select id="tr"><option>Atención Digital</option><option>Boletería</option><option>Responsable de sede</option><option>Validación de pagos</option></select>`)}</div>
   ${campo("ta", "Acción sugerida", `<input id="ta" maxlength="160" value="Verificar con el área responsable y registrar la alternativa">`)}<div id="cerr"></div><button class="btn">Agregar motivo</button></form></section></div>
   <section class="tarjeta" style="margin-top:16px"><h2 class="h2">Catálogo (${tipos.length})</h2><div class="tabla-cont"><table><thead><tr><th>Código</th><th>Motivo</th><th>Grupo</th><th>Responsable</th><th>Acción sugerida</th><th>Regla</th><th>Estado</th><th></th></tr></thead><tbody>
   ${tipos.map(t => `<tr><td class="num">${esc(t.codigo)}</td><td>${esc(t.nombre)}${t.prioritario ? ' <span class="et azul">Prioritario</span>' : ""}</td><td>${esc(t.grupo)}</td><td>${esc(t.responsable_defecto)}</td><td>${esc(t.accion_sugerida)}</td><td>${esc(t.regla)}</td><td>${t.activo ? '<span class="et verde">Activo</span>' : '<span class="et gris">Inactivo</span>'}</td><td>${t.prioritario ? "" : `<button class="link" data-act="${t.id}" data-v="${t.activo ? 0 : 1}">${t.activo ? "Desactivar" : "Activar"}</button>`}</td></tr>`).join("")}</tbody></table></div></section>`;
  document.getElementById("fm2").onsubmit = async ev => { ev.preventDefault(); const e = {}, cod = v("tc").toUpperCase();
    if (!/^T\d{2}$/.test(cod)) e.tc = "Formato T00 (ej. T91)."; else if (tipos.some(t => t.codigo === cod)) e.tc = "Ese código ya existe."; if (v("tn").length < 3) e.tn = "Indique el nombre."; if (v("ta").length < 5) e.ta = "Indique la acción sugerida.";
    if (Object.keys(e).length) return errores("cerr", {campos: e});
    try { await Actividad.ejecutar("Agregando motivo", [{texto: "Validando código único", fn: async () => {}}, {texto: "Guardando en el catálogo", fn: () => A.aplicar([{op: "insertar", tabla: "tipo_incidencia", fila: {codigo: cod, nombre: v("tn"), grupo: v("tg") || "Otros", prioritario: 0, responsable_defecto: v("tr"), accion_sugerida: v("ta"), regla: "R29", palabras_clave: "", activo: 1, version: 1}}])}]);
      E.ctx = null; toast(`Motivo ${cod} agregado: ya está disponible para el cliente`); marcarGuardado(); vistaConfiguracion(); } catch (x) { errores("cerr", {mensaje: x.message}); } };
  document.querySelectorAll("[data-act]").forEach(b => b.onclick = async () => { await A.aplicar([{op: "actualizar", tabla: "tipo_incidencia", id: Number(b.dataset.act), cambios: {activo: Number(b.dataset.v)}}]); E.ctx = null; vistaConfiguracion(); });
}

/* ---------------------------------------------------- 35 · respaldos (parte de Operación) */
async function seccionRespaldos() {
  const el = document.getElementById("resp"); if (!el) return;
  if (SOLUCION === "EXE") {
    let l = []; try { l = await api(() => A.listarRespaldos()); } catch (e) {}
    el.innerHTML = `<p class="sub" style="margin-top:0">Copia consistente de la base SQLite con verificación de integridad. Se conservan las 5 copias más recientes.</p><div class="fila"><button class="btn" id="bresp">Crear respaldo ahora</button></div>
     ${l.length ? `<div class="tabla-cont" style="margin-top:10px"><table style="min-width:420px"><thead><tr><th>Respaldo</th><th>Fecha</th><th>Tamaño</th><th></th></tr></thead><tbody>${l.map(x => `<tr><td>${esc(x.archivo)}</td><td class="num">${esc(Nucleo.fmtFechaHora(x.fecha_utc))}</td><td class="num">${fmtNum(x.bytes / 1024, 1)} KB</td><td>${x.archivo.startsWith("pc08_2") ? `<button class="link" data-rest="${esc(x.archivo)}">Restaurar</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="vacio">Aún no hay respaldos.</p>`}<div id="rmsg"></div>`;
    document.getElementById("bresp").onclick = async () => { try { const r = await Actividad.ejecutar("Creando respaldo", [{texto: "Copiando la base", fn: () => api(() => A.respaldar())}, {texto: "Verificando integridad de la copia", fn: async r => r}]); toast(`Respaldo ${r.archivo} · ${plural(r.incidencias, "incidencia", "incidencias")}`); seccionRespaldos(); } catch (e) { document.getElementById("rmsg").innerHTML = errorVista(e); } };
    el.querySelectorAll("[data-rest]").forEach(b => b.onclick = () => { document.getElementById("rmsg").innerHTML = `<div class="aviso pend">${I.alerta}<div><b>¿Restaurar ${esc(b.dataset.rest)}?</b>Se reemplaza la base actual. Antes se guarda una copia «pc08_antes_de_restaurar». Deberá iniciar sesión otra vez.<div class="fila" style="margin-top:8px"><button class="btn" id="okrest">Restaurar</button><button class="btn sec" onclick="document.getElementById('rmsg').innerHTML=''">Cancelar</button></div></div></div>`;
      document.getElementById("okrest").onclick = async () => { try { const r = await Actividad.ejecutar("Restaurando respaldo", [{texto: "Validando la copia elegida", fn: async () => {}}, {texto: "Reemplazando la base", fn: () => api(() => A.restaurar(b.dataset.rest))}]); toast(`Restaurado · ${plural(r.incidencias, "incidencia", "incidencias")}`); salir(true); } catch (e) { document.getElementById("rmsg").innerHTML = errorVista(e); } }; });
  } else {
    el.innerHTML = `<p class="sub" style="margin-top:0">El navegador guarda los datos en este equipo. El respaldo descarga un archivo con todas las tablas; restaurarlo reemplaza la base del navegador en una sola operación.</p>
     <div class="fila"><button class="btn" id="bresp">Descargar respaldo</button><label class="btn sec" for="frest">Restaurar desde archivo</label><input type="file" id="frest" accept=".json" hidden></div><div id="rmsg"></div>`;
    document.getElementById("bresp").onclick = async () => { const j = await Actividad.ejecutar("Creando respaldo", [{texto: "Leyendo todas las tablas", fn: () => A.exportarTodo()}]); const u8 = new TextEncoder().encode(JSON.stringify(j));
      const url = URL.createObjectURL(new Blob([u8], {type: "application/json"})), a = document.createElement("a"); a.href = url; a.download = `Respaldo_PC08_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000); toast(`Respaldo descargado · ${plural(j.tablas.incidencia.length, "incidencia", "incidencias")}`); };
    document.getElementById("frest").onchange = async ev => { const fl = ev.target.files[0]; if (!fl) return;
      try { const j = JSON.parse(await fl.text()); const r = await Actividad.ejecutar("Restaurando respaldo", [{texto: "Validando el archivo", fn: async () => j}, {texto: "Reemplazando la base del navegador", fn: () => A.restaurarTodo(j)}]); toast(`Restaurado · ${plural(r.incidencias, "incidencia", "incidencias")}`); salir(true); }
      catch (e) { document.getElementById("rmsg").innerHTML = errorVista({mensaje: e.message || "Archivo no válido"}); } };
  }
}

/* ---------------------------------------------------- operación (supervisión) */
async function vistaOperacion() {
  interna("operacion", [["Operación"]], `<h1>Estado de la aplicación</h1><p class="sub">Base de datos de esta solución, modo de operación, feriados oficiales y comprobación de enlaces por internet.</p><div id="op"><p>Cargando…</p></div>`);
  let d; try { d = await api(() => Nucleo.operacion(A)); } catch (e) { document.getElementById("op").innerHTML = errorVista(e, "vistaOperacion()"); return; }
  const ok = d.integridad === "ok";
  document.getElementById("op").innerHTML = `<div class="grid2"><section class="tarjeta"><h2 style="margin-top:0;font-size:18px">${SOLUCION === "EXE" ? "Aplicación de escritorio" : "Aplicación en navegador"}</h2>
   <p>${ok ? `<span class="et verde">${I.check}Base íntegra</span>` : `<span class="et rojo">${I.alerta}Revisar base</span>`} <span class="et azul">Versión ${esc(d.version)}</span> <span class="et gris">Solución ${esc(d.modo_app)}</span> <span class="chip-modo ${d.modo === "PRODUCCION" ? "prod" : ""}">${d.modo === "DEMO" ? "Demostración" : "Producción"}</span></p>
   <dl class="kv"><dt>Base de datos</dt><dd>${esc(d.almacen)}</dd><dt>Ubicación</dt><dd>${esc(d.ubicacion)}</dd>
   <dt>Sede seleccionada</dt><dd id="opsede">${esc(nombreSede())}</dd>
   <dt>Registros (total)</dt><dd class="num">${plural(d.conteos.incidencia, "incidencia", "incidencias")} · ${plural(d.conteos.contacto, "contacto", "contactos")} · ${plural(d.conteos.evento, "evento", "eventos")} · ${plural(d.conteos.sede, "sede", "sedes")} · ${plural(d.conteos.usuario, "cuenta", "cuentas")}</dd></dl>
   <p style="font-size:13px;color:var(--neutro-tx)">Los datos de esta solución son independientes de la otra solución entregada.</p>
   <div class="fila" style="margin-top:12px"><button class="btn sec" id="reprog">Actualizar horarios de demostración</button><button class="btn sec" id="restab">Restablecer datos de demostración</button>${SOLUCION === "EXE" ? '<button class="btn peligro" id="cerrar">Cerrar aplicación</button>' : ""}</div><div id="opmsg"></div></section>
   <section class="tarjeta" style="grid-column:1/-1;order:3"><h2 style="margin-top:0;font-size:18px">Respaldo y recuperación</h2><div id="resp"><p>Cargando…</p></div></section>
   <section class="tarjeta" style="grid-column:1/-1;order:2"><h2 style="margin-top:0;font-size:18px">Feriados oficiales del Perú (internet)</h2><p style="color:var(--neutro-tx);font-size:14px;margin-top:0">Descarga real desde ${esc(Nucleo.FUENTE_FERIADOS)} para el año actual y el siguiente. Sirve para anticipar días de alta demanda en las sedes. No se envían datos del expediente; sin internet se conserva la última descarga.</p>
   <div class="fila"><button class="btn" id="bf">${I.enlace} Actualizar feriados</button></div><div id="fres"></div><div id="flista"><p>Cargando…</p></div></section>
   <section class="tarjeta"><h2 style="margin-top:0;font-size:18px">Verificar enlace por internet</h2><p style="color:var(--neutro-tx);font-size:14px;margin-top:0">Dominios aprobados: www.gob.pe, www.inei.gob.pe y example.com. No se envían datos del expediente.${SOLUCION === "HTML" ? " En el navegador se confirma la respuesta del sitio sin mostrar el código HTTP." : ""}</p>
   <form id="fv" class="fila"><label class="sr" for="url">Enlace https</label><input id="url" style="flex:1;min-width:220px;border:1px solid var(--borde);border-radius:8px;padding:10px 12px;min-height:44px" value="https://example.com"><button class="btn" id="bv">${I.enlace} Verificar enlace</button></form>
   <div id="vres"></div><h3 style="font-size:15px">Últimas comprobaciones</h3><div id="vhis">${historial(d.verificaciones)}</div></section></div>`;
  seccionRespaldos();
  if (sedeAct()) resumenDatosSede(sedeAct()).then(n => { const el = document.getElementById("opsede"); if (el) el.innerHTML = `${esc(nombreSede())} · <span class="num">${plural(n.incidencias, "incidencia", "incidencias")} · ${plural(n.contactos, "contacto", "contactos")} · ${plural(n.eventos, "evento", "eventos")} · ${plural(n.funciones, "función", "funciones")}</span>`; }).catch(() => {});
  const pintarFer = info => { const el = document.getElementById("flista"); if (!el) return; const px = Nucleo.proximosFeriados(info, 6), todos = info?.lista || [];
    el.innerHTML = !info ? `<p class="vacio">Aún no hay feriados descargados.</p>` : `<p style="font-size:13px"><span class="et verde">${I.check}Datos reales</span> ${esc(info.fuente)} · consultado ${esc(Nucleo.fmtFechaHora(info.consultado_utc))} (hora de Lima) · ${plural(todos.length, "feriado", "feriados")} de ${Object.keys(info.anios || {}).join(" y ")}</p>
      <div class="tabla-cont"><table><thead><tr><th>Fecha</th><th>Feriado</th><th>Faltan</th></tr></thead><tbody>${px.map(x => `<tr class="${x.dias <= 7 ? "sel" : ""}"><td class="num">${esc(fmtDiaFer(x.fecha))}</td><td>${esc(x.nombre)}</td><td>${faltanFer(x.dias)}</td></tr>`).join("") || `<tr><td colspan="3">Sin feriados próximos.</td></tr>`}</tbody></table></div>
      <details class="detalle-tabla"><summary>Ver todos los feriados descargados (${todos.length})</summary><div class="tabla-cont"><table><thead><tr><th>Fecha</th><th>Feriado</th><th>Nombre en inglés</th></tr></thead><tbody>${todos.map(x => `<tr><td class="num">${esc(fmtDiaFer(x.fecha))}</td><td>${esc(x.nombre)}</td><td>${esc(x.nombre_en)}</td></tr>`).join("")}</tbody></table></div></details>`; };
  Nucleo.feriados(A).then(pintarFer).catch(() => pintarFer(null));
  document.getElementById("bf").onclick = async () => { const b = document.getElementById("bf"); b.disabled = true;
    try { const r = await Actividad.ejecutar("Actualizando feriados", [{texto: "Consultando el servicio de feriados (máximo 8 s por año)", fn: () => api(() => Nucleo.actualizarFeriados(A))}, {texto: "Guardando y registrando la consulta", fn: async r => r}]);
      const ok = r.guardados > 0;
      { const o = await api(() => Nucleo.operacion(A)), vh = document.getElementById("vhis"); if (vh) vh.innerHTML = historial(o.verificaciones); }
      if (!document.getElementById("fres")) return;
      document.getElementById("fres").innerHTML = `<div class="aviso ${ok ? "ok" : "pend"}" role="status">${ok ? I.check : I.alerta}<div><b>${ok ? `${plural(r.guardados, "feriado oficial descargado", "feriados oficiales descargados")}` : "NO VERIFICADO"}</b>${r.resultado.map(x => `${esc(x.anio)}: ${esc(x.estado.replace("_", " "))}${x.codigo_http ? ` · HTTP ${x.codigo_http}` : ""} — ${esc(x.detalle)}`).join("<br>")}</div></div>`;
      pintarFer(r.info); marcarGuardado(); const o = await api(() => Nucleo.operacion(A)), vh = document.getElementById("vhis"); if (vh) vh.innerHTML = historial(o.verificaciones);
    } catch (e) { document.getElementById("fres").innerHTML = errorVista(e); }
    b.disabled = false; };
  document.getElementById("fv").onsubmit = async ev => {
    ev.preventDefault(); const b = document.getElementById("bv"); b.disabled = true;
    try { const r = await Actividad.ejecutar("Verificando enlace", [{texto: "Validando dominio aprobado", fn: async () => { const x = Nucleo.validarEnlace(v("url")); if (!x.ok) return; }}, {texto: "Consultando el sitio (máximo 8 s)", fn: () => api(() => Nucleo.verificarEnlace(A, v("url")))}, {texto: "Registrando resultado", fn: async r => r}]);
      const cls = {DISPONIBLE: "ok", NO_DISPONIBLE: "err", NO_VERIFICADO: "pend"}[r.estado];
      document.getElementById("vres").innerHTML = `<div class="aviso ${cls}" role="status">${r.estado === "DISPONIBLE" ? I.check : I.alerta}<div><b>${r.estado.replace("_", " ")}${r.codigo_http ? ` · HTTP ${r.codigo_http}` : ""}</b>${esc(r.detalle)}</div></div>`;
      marcarGuardado(); const o = await api(() => Nucleo.operacion(A)), vh = document.getElementById("vhis"); if (vh) vh.innerHTML = historial(o.verificaciones);
    } catch (e) { document.getElementById("vres").innerHTML = errorVista(e); }
    b.disabled = false;
  };
  document.getElementById("reprog").onclick = async () => { const r = await Actividad.ejecutar("Actualizando horarios", [{texto: "Desplazando funciones a la hora actual", fn: () => api(() => Nucleo.reprogramarDemo(A))}]); E.ctx = null; toast(r); };
  document.getElementById("restab").onclick = () => {
    document.getElementById("opmsg").innerHTML = `<div class="aviso pend">${I.alerta}<div><b>¿Restablecer los datos de demostración?</b>Se reemplazan las incidencias, contactos y eventos por el conjunto sintético inicial (30 incidencias del guion en CP Alcázar + historial de 30 días de las 44 sedes). Las cuentas se conservan con sus contraseñas documentadas.<div class="fila" style="margin-top:8px"><button class="btn" id="okr">Restablecer</button><button class="btn sec" onclick="document.getElementById('opmsg').innerHTML=''">Cancelar</button></div></div></div>`;
    document.getElementById("okr").onclick = async () => { try { await Actividad.ejecutar("Restableciendo demostración", [{texto: "Generando el guion (30 incidencias) y el historial de las 44 sedes", fn: async () => {}}, {texto: "Reemplazando datos en una sola operación", fn: () => api(() => Nucleo.asegurarDemo(A, true))}]); E.ctx = null; toast("Datos de demostración restablecidos"); salir(true); } catch (e) { document.getElementById("opmsg").innerHTML = errorVista(e); } };
  };
  document.getElementById("cerrar")?.addEventListener("click", async () => {
    if (!window.confirm("¿Cerrar la aplicación? Los datos confirmados quedan guardados.")) return;
    $app.innerHTML = `<div class="archivo"><div class="aviso ok">${I.check}<div><b>Aplicación cerrada</b>Los datos confirmados quedaron guardados.</div></div></div>`;
    try { await A.cerrar(); } catch (e) {}
  });
}
function historial(h) {
  if (!h.length) return `<p style="color:var(--neutro-tx)">Aún no hay comprobaciones.</p>`;
  return `<div class="tabla-cont"><table style="min-width:480px"><thead><tr><th>Hora</th><th>Dominio</th><th>Resultado</th><th>HTTP</th></tr></thead><tbody>${h.map(x => `<tr><td class="num">${Nucleo.fmtHora(x.utc)}</td><td>${esc(x.dominio)}</td><td>${esc(x.estado.replace("_", " "))}</td><td class="num">${x.codigo_http ?? "—"}</td></tr>`).join("")}</tbody></table></div>`;
}
function vistaPendiente(clave, titulo) { interna(clave, [[titulo]], `<h1>${esc(titulo)}</h1><div class="tarjeta vacio">Este módulo se habilita en la siguiente versión del plan de trabajo.</div>`); }

/* ---------------------------------------------------- enrutador con control de acceso por rol */
async function router() {
  clearInterval(E.timer);
  const h = location.hash.replace(/\?.*$/, "") || "#/ingreso";
  const [, a, b, c] = h.split("/");
  if (!E.usuario) { if (a !== "ingreso") { location.hash = "#/ingreso"; return; } return vistaIngreso(); }
  if (a === "vistas") return vistaVistas();
  if (!E.usuario.rol) { location.hash = "#/vistas"; return; }
  if (a === "ingreso") { location.hash = INICIO[E.usuario.rol]; return; }
  E.modo = await Nucleo.modo(A).catch(() => E.modo);
  const rol = E.usuario.rol;
  if (rol === "CLIENTE") {
    if (a !== "c") { location.hash = INICIO.CLIENTE; return; }           // el cliente no ve ni se entera de otras vistas
    if (b === "recibido") return vistaClienteCaso(c, "recibido");
    if (b === "caso") return vistaClienteCaso(c, "seguimiento");
    if (b === "casos") return vistaClienteCasos();
    return vistaClienteReportar();
  }
  if (a === "c" || !a) { location.hash = INICIO[rol]; return; }
  if (!puede(rol, a)) { interna("", [["Sin acceso"]], `<div class="aviso pend">${I.alerta}<div><b>Opción no disponible para su rol</b>Corresponde a otro perfil. Vuelva a su <a href="${INICIO[rol]}">inicio</a>.</div></div>`); return; }
  if (a === "bandeja") return vistaBandeja(false);
  if (a === "mostrador") return vistaMostrador();
  if (a === "panel") return vistaPanel();
  if (a === "buscar") return vistaBuscar();
  if (a === "exp") return vistaExpediente(decodeURIComponent(b || ""), c);
  if (a === "operacion") return vistaOperacion();
  if (a === "datos") return vistaDatos();
  if (a === "indicadores") return vistaIndicadores();
  if (a === "exportaciones") return vistaExportaciones();
  if (a === "configuracion") return vistaConfiguracion();
  if (a === "dt") return b ? vistaDTHerramienta(b, c === "v" ? "vista" : c, c === "v" ? h.split("/")[4] : null) : vistaDT();
  const m = MENU[rol].find(x => x[0] === a); return vistaPendiente(m[0], m[1]);
}
setInterval(() => { const r = document.getElementById("reloj"); if (r) r.innerHTML = `${I.reloj} Hora de Lima ${hora()}`; }, 15000);
window.addEventListener("hashchange", router);
(async function arranque() {
  $app.innerHTML = `<div id="actividad"></div><div class="archivo"><img src="img/logo_cabecera.svg" alt="Cineplanet" style="height:56px"></div>`;
  try {
    await A.preparar();
    const nueva = await Actividad.ejecutar("Preparando la aplicación", [{texto: "Abriendo la base de datos", fn: async () => {}}, {texto: "Comprobando datos de demostración", fn: async () => { const n = await Nucleo.asegurarDemo(A); await Nucleo.iniciarEnDemo(A); return n; }}]);
    if (nueva) { sessionStorage.removeItem("pc08_usuario"); E.usuario = null; toast("Datos de demostración preparados: guion de 30 incidencias + historial sintético de las 44 sedes"); }
    if (E.usuario && SOLUCION === "EXE") { try { await A.leer("incidencia", {id: -1}); } catch (e) { sessionStorage.removeItem("pc08_usuario"); E.usuario = null; } }
    router();
  } catch (e) { $app.innerHTML = `<div class="archivo"><img src="img/logo_cabecera.svg" alt="Cineplanet" style="height:56px"><div class="aviso err" role="alert">${I.alerta}<div><b>No se pudo abrir la base de datos</b>${esc(e.message || e)}<div style="margin-top:8px"><button class="btn sec" onclick="location.reload()">Volver a intentar</button></div></div></div></div>`; }
})();
