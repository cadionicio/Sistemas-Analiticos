// Aplicación: cabecera, menú, servicios de datos y vistas de la versión 0.1 (apertura y carga).
import { iniciarMotor, abrir, filas, valor, exportar, revision, transaccion, ejecutar, validarBytesBase, alConfirmar } from '../nucleo/bd.js';
import { leerLibro, aplicarCarga, HOJAS } from '../adaptadores/excel06.js';
import { crearPersistencia } from '../adaptadores/persistencia.js';
import { mostrarFH, sello, ahoraIso } from '../nucleo/fechas.js';
import { fmtMagnitud, fmtConteo, esc, claseNum } from '../nucleo/formato.js';
import { $, html, crudo, dialogo, aviso, protegido, elegirArchivo, descargar, formulario, progreso } from './dom.js';
import { hashPin } from '../nucleo/bd.js';
import { ROLES, ErrorNegocio } from '../nucleo/operaciones.js';
import { vistaParadas } from './vistaParadas.js';
import { vistaOrdenes } from './vistaOrdenes.js';
import { vistaPreventivo } from './vistaPreventivo.js';
import { vistaUsuarios } from './vistaUsuarios.js';
import { vistaIndicadores } from './vistaIndicadores.js';
import { vistaSimulacion } from './vistaSimulacion.js';
import { vistaExportar } from './vistaExportar.js';

const V = globalThis.CPR_VERSION || '0.0.0';
const COMP = globalThis.CPR_COMPILACION || 'local';
// Sesión: «Modo demostración» activo = usuario Evaluación con todos los permisos; desactivado = responsable con PIN.
let modoDemo = true;
let usuario = null;
let intentosFallidos = 0, bloqueoHasta = 0;
const usuarioEva = () => filas("SELECT codigo, nombre, rol FROM usuario WHERE codigo='EVA'")[0];
export const usuarioActual = () => usuario;
const firmaActual = () => (usuario ? (usuario.rol === 'EVALUACION' ? 'Evaluación' : usuario.nombre) : 'Sin identificar');
const TABLA_DE_HOJA = {
  Equipos: 'equipo', Piezas: 'pieza', Modos_Falla: 'modo_falla', Horas_Operacion: 'horas_operacion', Paradas: 'parada',
  Tramos: 'tramo', Verificaciones: 'verificacion', Ordenes: 'orden', Intervenciones: 'intervencion', Consumos: 'consumo',
  Movimientos: "movimiento WHERE tipo <> 'CONSUMO'", Reservas: 'reserva', Tareas_Preventivas: 'tarea_preventiva',
  Ejecuciones_Preventivas: 'ejecucion_preventiva', Mant_Programado: 'mant_programado', Acciones: 'accion', Parametros: 'parametro',
};
const VISTAS = [
  { id: 'inicio', titulo: 'Inicio', fn: vistaInicio },
  { id: 'paradas', titulo: 'Paradas', fn: c => vistaParadas(c, ctx) },
  { id: 'ordenes', titulo: 'Órdenes y repuestos', fn: c => vistaOrdenes(c, ctx) },
  { id: 'preventivo', titulo: 'Preventivo', fn: c => vistaPreventivo(c, ctx) },
  { id: 'indicadores', titulo: 'Indicadores', fn: c => vistaIndicadores(c, ctx) },
  { id: 'simulacion', titulo: 'Simulación', fn: c => vistaSimulacion(c, ctx) },
  { id: 'exportar', titulo: '⬇ Exportar resultados', fn: c => vistaExportar(c, ctx), destacada: true },
  { id: 'usuarios', titulo: 'Usuarios', fn: c => vistaUsuarios(c, ctx) },
  { id: 'datos', titulo: 'Datos y respaldos', fn: vistaDatos },
];
// Contexto compartido con las vistas de operación
const ctx = {
  usuario: () => usuario,
  // Si el propio usuario cambia (nombre, rol o queda inactivo), se actualiza o se cierra la sesión
  revalidarSesion() {
    const u = filas('SELECT codigo, nombre, rol FROM usuario WHERE codigo=? AND activo=1', [usuario.codigo])[0];
    if (!u) { usuario = null; return; }
    usuario = u; pintarSesion();
  },
  hayDatos: () => hayDatos(),
  irA: id => irA(id),
  irAParada: codigo => { globalThis.CPR_PARADA_SEL = codigo; irA('paradas'); },
  irAPieza: codigo => { globalThis.CPR_PIEZA_SEL = codigo; irA('ordenes'); },
  refrescar: () => refrescar(),
  // Ejecuta una operación de negocio con el usuario actual, guarda y avisa. Devuelve el resultado o null.
  async operar(fn, datos, { ok, motivo }) {
    let r;
    try { r = fn(datos, usuario); }
    catch (e) {
      aviso((e instanceof ErrorNegocio ? '' : 'No se pudo completar: ') + e.message, e instanceof ErrorNegocio ? 'alerta' : 'error');
      return null;
    }
    if (r && r.repetida) { aviso(`La operación ya estaba registrada (${r.codigo}); no se duplicó.`, 'info'); refrescar(); return r; }
    if (await persistir(motivo)) aviso(typeof ok === 'function' ? ok(r) : ok, 'ok');
    ctx.revalidarSesion();
    refrescar();
    return r;
  },
};

let P = null; // persistencia
let vistaActual = 'inicio';
let ultimoGuardado = null;
let ultimaValidacion = null;
let errorGuardado = false;

export async function iniciar() {
  document.title = `Control de Paradas y Repuestos · P-01 · v${V}`;
  document.body.innerHTML = '<div id="avisos" class="avisos"></div><main id="vista" class="vista"></main>';
  await iniciarMotor();
  P = crearPersistencia();
  let r = null;
  try { r = await P.cargar(); }
  catch (e) { errorInicio = 'No se pudo leer el almacenamiento local: ' + e.message; }
  try { abrir(r ? r.bytes : null); ultimoGuardado = r ? r.instante : null; }
  catch (e) {
    abrir(null);
    errorInicio = 'Los datos guardados no se pudieron abrir (' + e.message + '). Use «Datos y respaldos» → «Restaurar» con un respaldo automático.';
  }
  P.alCambiarFuera(() => aviso('Otra pestaña guardó cambios en estos datos.', 'alerta', { texto: 'Recargar', fn: () => location.reload() }));
  alConfirmar(() => pintarEstado());
  pantallaIngreso();
}
let errorInicio = null;

// Pantalla de ingreso: «Modo demostración» activo por defecto (Evaluación, todos los permisos).
// Al desactivarlo se elige el responsable en una lista y se escribe su PIN.
function pantallaIngreso(mensaje) {
  usuario = null;
  const lista = filas("SELECT codigo, nombre, rol FROM usuario WHERE rol <> 'EVALUACION' AND activo=1 ORDER BY rol, nombre");
  document.body.innerHTML = `<div id="avisos" class="avisos"></div>
  <main class="ingreso"><div class="ingreso-marco">
    <div class="ingreso-ilustracion">${globalThis.CPR_IMG_INGRESO ? `<img src="${globalThis.CPR_IMG_INGRESO}" alt="Ilustración de la peletizadora con herramientas de mantenimiento">` : ''}</div>
    <form class="caja-ingreso" id="form-ingreso" novalidate autocomplete="off">
    <div class="ingreso-cab"><strong>Control de Paradas y Repuestos</strong><span>Peletizadora P-01 · Nutripellet Andino S.A.C. (empresa ficticia)</span>
      <div><span class="sello-sint">DATOS SINTÉTICOS</span> <span class="subtexto">Versión ${esc(V)}</span></div></div>
    <h1>Ingresar</h1>
    <label class="interruptor oscuro" for="sw-demo"><input type="checkbox" id="sw-demo" ${modoDemo ? 'checked' : ''}><span class="riel"></span><span>Modo demostración</span></label>
    <div id="zona-demo" ${modoDemo ? '' : 'hidden'}><p class="nota-demo">Ingresará como <strong>Evaluación</strong>, con todos los permisos, para revisar el sistema completo.</p></div>
    <div id="zona-resp" ${modoDemo ? 'hidden' : ''}>
      <div class="campo"><label for="i-usuario">Responsable</label><select id="i-usuario">${lista.map(u => `<option value="${esc(u.codigo)}">${esc(u.nombre)} · ${esc(ROLES[u.rol])}</option>`).join('')}</select></div>
      <div class="campo"><label for="i-pin">PIN</label><input id="i-pin" type="password" inputmode="numeric" maxlength="4" placeholder="4 dígitos"></div>
      <small class="subtexto">PIN de los responsables de demostración: Producción 1111 · Mantenimiento 2222 · Almacén 3333 · Responsable de mantenimiento 4444. Los usuarios nuevos se crean en «Usuarios».</small>
    </div>
    <div class="error-form" id="error-ingreso" role="alert">${esc(mensaje || '')}</div>
    <button type="submit" class="btn principal grande ancho" id="b-ingresar">Ingresar</button>
  </form></div></main>`;
  const sw = $('#sw-demo');
  sw.onchange = () => {
    modoDemo = sw.checked;
    $('#zona-demo').hidden = !modoDemo; $('#zona-resp').hidden = modoDemo;
    $('#error-ingreso').textContent = '';
    if (!modoDemo) $('#i-pin').focus();
  };
  $('#form-ingreso').onsubmit = e => {
    e.preventDefault();
    const err = $('#error-ingreso');
    if (modoDemo) { usuario = usuarioEva(); return entrar(); }
    if (Date.now() < bloqueoHasta) { err.textContent = `Demasiados intentos. Espere ${Math.ceil((bloqueoHasta - Date.now()) / 1000)} s.`; return; }
    const pin = $('#i-pin').value.trim();
    if (!/^\d{4}$/.test(pin)) { err.textContent = 'El PIN tiene 4 dígitos.'; return; }
    const u = filas('SELECT * FROM usuario WHERE codigo=? AND activo=1', [$('#i-usuario').value])[0];
    if (!u || hashPin(u.sal, pin) !== u.pin_hash) {
      intentosFallidos++;
      $('#i-pin').value = '';
      if (intentosFallidos >= 5) { bloqueoHasta = Date.now() + 60000; intentosFallidos = 0; err.textContent = 'PIN incorrecto 5 veces: el ingreso queda bloqueado 60 segundos.'; }
      else err.textContent = `PIN incorrecto (intento ${intentosFallidos} de 5).`;
      return;
    }
    intentosFallidos = 0;
    usuario = { codigo: u.codigo, nombre: u.nombre, rol: u.rol };
    entrar();
  };
  (modoDemo ? $('#b-ingresar') : $('#i-pin')).focus();
}

function entrar() {
  pintarMarco();
  pintarSesion();
  pintarEstado();
  if (errorInicio) { aviso(errorInicio, 'error'); errorInicio = null; }
  irA('inicio');
}

function pintarMarco() {
  document.body.innerHTML = `
  <header class="barra">
    <div class="marca"><strong>Control de Paradas y Repuestos</strong><span>Peletizadora P-01 · Nutripellet Andino S.A.C. (empresa ficticia)</span></div>
    <div class="marca-der"><span class="sello-sint">DATOS SINTÉTICOS</span><span class="version" id="version">Versión ${esc(V)}</span><span id="sesion"></span></div>
    <div class="salto"></div>
    <nav class="menu" id="menu" aria-label="Menú principal"></nav>
    <div class="estado-guardado" id="estado-guardado"></div>
  </header>
  <div id="avisos" class="avisos"></div>
  <main id="vista" class="vista" tabindex="-1"></main>`;
  const menu = $('#menu');
  VISTAS.forEach(v => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pestana' + (v.destacada ? ' destacada' : ''); b.dataset.vista = v.id; b.textContent = v.titulo;
    b.onclick = () => irA(v.id);
    menu.appendChild(b);
  });
}

export function irA(id) {
  vistaActual = id;
  document.querySelectorAll('.pestana').forEach(b => b.classList.toggle('activa', b.dataset.vista === id));
  const v = VISTAS.find(x => x.id === id);
  const cont = $('#vista');
  protegido(cont, v.titulo, () => v.fn(cont));
}
const refrescar = () => { if (!usuario) return pantallaIngreso('La sesión terminó. Ingrese nuevamente.'); irA(vistaActual); };

function pintarSesion() {
  const z = $('#sesion');
  if (!z) return;
  z.innerHTML = `<span class="usuario ${usuario.rol === 'EVALUACION' ? 'eva' : 'resp'}" id="usuario-actual">${usuario.rol === 'EVALUACION' ? 'Modo demostración · Evaluación' : esc(usuario.nombre) + ' · ' + esc(ROLES[usuario.rol])}</span>
    <button type="button" class="btn chico claro" id="b-salir">Cerrar sesión</button>`;
  $('#b-salir').onclick = () => { vistaActual = 'inicio'; pantallaIngreso(); };
}

function pintarEstado() {
  const e = $('#estado-guardado');
  if (!e) return;
  const rev = revision();
  const lugar = P ? (P.tipo === 'EXE' ? 'Aplicación de escritorio' : 'Navegador') : '';
  let clase = 'ok', txt = `Guardado · ${lugar} · revisión ${fmtConteo(rev)}${ultimoGuardado ? ' · ' + mostrarFH(new Date(ultimoGuardado).toISOString()) : ''}`;
  if (errorGuardado) { clase = 'error'; txt = 'No guardado · revise el aviso'; }
  else if (!hayDatos()) { clase = 'alerta'; txt = `Sin datos · ${lugar}`; }
  e.innerHTML = `<span class="pildora ${clase}">${esc(txt)}</span>`;
}

// Guarda el estado confirmado. Si falla, el usuario recibe un aviso con acción de recuperación.
async function persistir(motivo) {
  try {
    const r = await P.guardar(exportar(), revision(), motivo);
    ultimoGuardado = r.instante || new Date().toISOString();
    errorGuardado = false;
    pintarEstado();
    return true;
  } catch (e) {
    errorGuardado = true; pintarEstado();
    aviso('El cambio se aplicó en pantalla pero NO se guardó: ' + e.message, 'error', { texto: 'Recargar', fn: () => location.reload() });
    return false;
  }
}

const hayDatos = () => Number(valor('SELECT count(*) FROM equipo')) > 0;
function resumenActual() {
  return `${fmtConteo(valor('SELECT count(*) FROM parada'))} paradas, ${fmtConteo(valor('SELECT count(*) FROM orden'))} órdenes y ${fmtConteo(valor('SELECT count(*) FROM movimiento'))} movimientos de almacén`;
}

function b64ABytes(b64) {
  const s = atob(b64); const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

// Carga del Excel 06 (archivo o demostración) con vista previa, conteos y errores por celda.
async function flujoCarga(bytes, nombre, origen) {
  const pr = progreso('Leyendo el Excel 06');
  await pr.paso(`Leyendo y validando ${nombre} (${(bytes.length / 1024).toFixed(0)} KB)…`, 30);
  let lect;
  try { lect = leerLibro(bytes, nombre); } finally { lect && (lect.ms_lectura = pr.fin()); if (!lect) pr.fin(); }
  ultimaValidacion = { instante: ahoraIso(), nombre, sha256: lect.sha256, errores: lect.errores, conteos: lect.conteos };
  const ok = lect.errores.length === 0;
  const filasConteo = HOJAS.map(h => {
    const esp = lect.conteosEsperados ? lect.conteosEsperados[h] : undefined;
    const coincide = esp === undefined ? '<span class="pildora info">Sin dato</span>' : (esp === lect.conteos[h] ? '<span class="pildora ok">✓</span>' : '<span class="pildora error">✗</span>');
    return `<tr><td>${esc(h)}</td><td class="num">${fmtConteo(lect.conteos[h] ?? 0)}</td><td class="num">${esp === undefined ? '—' : fmtConteo(esp)}</td><td class="centro">${coincide}</td></tr>`;
  }).join('');
  const tablaErrores = ok ? '' : `<h3>Errores encontrados: ${fmtConteo(lect.errores.length)} (no se cargará nada)</h3>
    <div class="tabla-scroll"><table class="tabla"><thead><tr><th>Hoja</th><th>Fila</th><th>Columna</th><th>Motivo</th></tr></thead><tbody>
    ${lect.errores.slice(0, 300).map(e => `<tr><td>${esc(e.hoja)}</td><td class="num">${esc(e.fila)}</td><td>${esc(e.columna)}</td><td>${esc(e.motivo)}</td></tr>`).join('')}
    </tbody></table></div>`;
  const reemplazo = hayDatos() ? `<p class="nota-alerta">Ya hay datos (${esc(resumenActual())}). Si confirma, se reemplazarán por los de este archivo. Antes se guardará un respaldo automático del estado actual.</p>` : '';
  const cuerpo = `
    <p><strong>Archivo:</strong> ${esc(nombre)}<br><strong>SHA-256:</strong> <code>${esc(lect.sha256)}</code></p>
    ${lect.meta && lect.meta.Empresa ? `<p><strong>Empresa:</strong> ${esc(lect.meta.Empresa)} · <strong>Contrato:</strong> ${esc(lect.meta.Version_contrato || '—')} · <strong>Período:</strong> ${esc(lect.meta.Periodo_desde || '—')} a ${esc(lect.meta.Periodo_hasta || '—')}</p>` : ''}
    <div class="resumen-validacion ${ok ? 'ok' : 'error'}">${ok ? '✓ Validación correcta: sin errores.' : '✗ El archivo tiene errores. Los datos actuales no se modifican.'}</div>
    ${tablaErrores}
    <h3>Conteos por hoja</h3>
    <div class="tabla-scroll corta"><table class="tabla ajustada"><thead><tr><th>Hoja</th><th>Filas leídas</th><th>Esperadas (LEEME)</th><th>Coincide</th></tr></thead><tbody>${filasConteo}</tbody></table></div>
    ${ok ? reemplazo : ''}`;
  const titulo = origen === 'DEMOSTRACION' ? 'Cargar demostración' : 'Cargar Excel 06';
  const r = await dialogo({
    titulo, cuerpo, ancho: 900,
    botones: ok ? [{ texto: 'Cancelar', valor: null }, { texto: 'Confirmar carga', valor: 'ok', principal: true }] : [{ texto: 'Cerrar', valor: null, principal: true }],
  });
  if (r !== 'ok') { aviso(ok ? 'Carga cancelada. Los datos no cambiaron.' : 'Archivo rechazado. Los datos no cambiaron.', ok ? 'info' : 'alerta'); refrescar(); return; }
  const total = Object.values(lect.conteos).reduce((a, b) => a + b, 0);
  const pr2 = progreso('Cargando datos');
  await pr2.paso(`Escribiendo ${fmtConteo(total)} registros en una sola transacción…`, 40);
  try {
    aplicarCarga(lect, origen, firmaActual());
  } catch (e) {
    pr2.fin();
    aviso('La carga se revirtió por completo: ' + e.message, 'error');
    refrescar();
    return;
  }
  await pr2.paso('Guardando en el almacenamiento local…', 85);
  const guardado = await persistir(titulo + ' ' + nombre);
  const ms = pr2.fin();
  if (guardado) aviso(`Carga confirmada y guardada: ${resumenActual()}. Lectura y validación ${fmtConteo(lect.ms_lectura)} ms · escritura y guardado ${fmtConteo(ms)} ms.`, 'ok');
  irA('inicio');
}

async function cargarDemostracion() {
  await flujoCarga(b64ABytes(globalThis.CPR_DEMO_B64), globalThis.CPR_DEMO_NOMBRE, 'DEMOSTRACION');
}
async function cargarExcel() {
  const f = await elegirArchivo('.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (f) await flujoCarga(f.bytes, f.nombre, 'ARCHIVO');
}
function respaldar() {
  const rev = revision();
  descargar(exportar(), `Respaldo_ControlParadas_P01_${sello()}_rev${rev}.sqlite`);
  aviso(`Respaldo generado (revisión ${rev}). Guarde el archivo .sqlite en una carpeta segura.`, 'ok');
}
async function restaurarBytes(bytes, etiqueta) {
  let info;
  try { info = validarBytesBase(bytes); }
  catch (e) { aviso('No se puede restaurar: ' + e.message, 'error'); return; }
  const r = await dialogo({
    titulo: 'Restaurar datos desde un respaldo',
    cuerpo: `<p>Se reemplazarán los datos actuales (${esc(resumenActual())}) por el respaldo <strong>${esc(etiqueta)}</strong> (revisión ${fmtConteo(info.revision)}).</p><p>Antes se guardará un respaldo automático del estado actual.</p>`,
    botones: [{ texto: 'Cancelar', valor: null }, { texto: 'Restaurar', valor: 'ok', principal: true }],
  });
  if (r !== 'ok') { aviso('Restauración cancelada. Los datos no cambiaron.', 'info'); return; }
  const revActual = revision();
  abrir(bytes);
  transaccion(() => ejecutar("UPDATE meta SET valor=? WHERE clave='revision'", [String(revActual)]),
    { tipo: 'RESTAURACION', referencia: etiqueta, detalle: `Revisión del respaldo ${info.revision}`, usuario: firmaActual() });
  // La restauración trae su propia tabla de usuarios: se revalida la sesión
  const sigue = filas('SELECT codigo, nombre, rol FROM usuario WHERE codigo=? AND activo=1', [usuario.codigo])[0];
  if (!sigue) { pantallaIngreso('Los datos restaurados no incluyen su usuario. Ingrese nuevamente.'); return; }
  usuario = sigue; pintarSesion();
  if (await persistir('Restaurar ' + etiqueta)) aviso(`Restauración completada desde ${etiqueta}: ${resumenActual()}.`, 'ok');
  irA('inicio');
}
async function restaurarArchivo() {
  const f = await elegirArchivo('.sqlite,.db,application/octet-stream');
  if (f) await restaurarBytes(f.bytes, f.nombre);
}

function botonesDatos() {
  return `<div class="acciones">
    <button type="button" class="btn principal grande" id="b-demo">Cargar demostración</button>
    <button type="button" class="btn" id="b-excel">Cargar Excel 06…</button>
    <button type="button" class="btn" id="b-respaldar"${hayDatos() ? '' : ' disabled title="No hay datos para respaldar"'}>Respaldar</button>
    <button type="button" class="btn" id="b-restaurar">Restaurar…</button></div>`;
}
function enlazarBotones(c) {
  c.querySelector('#b-demo').onclick = cargarDemostracion;
  c.querySelector('#b-excel').onclick = cargarExcel;
  c.querySelector('#b-respaldar').onclick = respaldar;
  c.querySelector('#b-restaurar').onclick = restaurarArchivo;
}

function tablaConteos() {
  const ult = filas('SELECT * FROM carga ORDER BY id DESC LIMIT 1')[0];
  const esp = ult ? JSON.parse(ult.conteos_json) : {};
  const fila = h => {
    const n = Number(valor(`SELECT count(*) FROM ${TABLA_DE_HOJA[h]}`));
    const e = esp[h];
    // Las operaciones registradas después de la carga suman registros: se distingue de un faltante.
    const est = e === undefined ? ['info', 'Sin archivo'] : n === e ? ['ok', 'Igual al archivo'] : n > e ? ['alerta', `+${n - e} registrados`] : ['error', `Faltan ${e - n}`];
    return `<tr data-hoja="${esc(h)}" data-n="${n}"><td>${esc(h)}</td><td class="num">${fmtConteo(n)}</td><td class="num">${e === undefined ? '—' : fmtConteo(e)}</td><td><span class="pildora ${est[0]}">${esc(est[1])}</span></td></tr>`;
  };
  const mitad = Math.ceil(HOJAS.length / 2);
  const tabla = hs => `<table class="tabla"><thead><tr><th>Hoja</th><th>En la base</th><th>En el archivo</th><th>Estado</th></tr></thead><tbody>${hs.map(fila).join('')}</tbody></table>`;
  return `<div class="dos-tablas" id="conteos">${tabla(HOJAS.slice(0, mitad))}${tabla(HOJAS.slice(mitad))}</div>`;
}

function datosControl() {
  const min = Math.round(Number(valor("SELECT coalesce(sum((julianday(fin) - julianday(inicio)) * 1440), 0) FROM parada WHERE fin IS NOT NULL") || 0));
  const esp = Math.round(Number(valor("SELECT coalesce(sum((julianday(fin) - julianday(inicio)) * 1440), 0) FROM tramo WHERE tipo='ESPERA_REPUESTO' AND fin IS NOT NULL") || 0));
  const piezas = filas(`SELECT p.codigo, p.nombre, p.unidad, p.stock_minimo AS minimo,
      coalesce((SELECT sum(cantidad * signo) FROM movimiento m WHERE m.pieza_codigo = p.codigo), 0) AS fisico,
      coalesce((SELECT sum(cantidad) FROM reserva r WHERE r.pieza_codigo = p.codigo AND r.estado = 'VIGENTE'), 0) AS reservado
    FROM pieza p ORDER BY p.codigo`).map(p => {
    const disp = p.fisico - p.reservado;
    const est = disp < p.minimo ? (disp <= 0 ? ['error', 'Sin disponible'] : ['alerta', 'Bajo mínimo']) : ['ok', 'Suficiente'];
    return { ...p, disp, est };
  });
  return { min, esp, piezas, paradas: Number(valor('SELECT count(*) FROM parada')), abiertas: Number(valor("SELECT count(*) FROM orden WHERE estado='ABIERTA'")) };
}

function kpisInicio(d) {
  const bajo = d.piezas.filter(p => p.est[0] !== 'ok');
  const claseBajo = d.piezas.some(p => p.est[0] === 'error') ? 'error' : bajo.length ? 'alerta' : 'ok';
  const pct = d.min ? (100 * d.esp / d.min) : 0;
  return `<div class="kpis" id="kpis">
      <div class="kpi"><span>Paradas no planificadas</span><strong>${fmtConteo(d.paradas)}</strong><small>todos los equipos</small></div>
      <div class="kpi"><span>Horas de parada</span><strong>${fmtMagnitud(d.min / 60, 2)} h</strong><small>todos los equipos</small></div>
      <div class="kpi"><span>Horas de espera de repuesto</span><strong>${fmtMagnitud(d.esp / 60, 2)} h</strong><small>${d.min ? fmtMagnitud(pct, 1) + ' % del tiempo de parada' : 'sin base de cálculo'}</small></div>
      <div class="kpi ${d.abiertas ? 'alerta' : 'ok'}"><span>Órdenes abiertas</span><strong>${fmtConteo(d.abiertas)}</strong><small>${d.abiertas ? 'pendientes de atender' : 'todas cerradas'}</small></div>
      <div class="kpi ${claseBajo}"><span>Piezas bajo el mínimo</span><strong>${fmtConteo(bajo.length)}</strong><small>${bajo.length ? esc(bajo.map(p => p.codigo).join(', ')) + ' · todos los equipos' : 'existencias suficientes'}</small></div>
    </div>`;
}

function tablaExistencias(d) {
  return `<div class="tabla-centro"><table class="tabla ajustada" id="existencias"><thead><tr><th>Código</th><th>Pieza</th><th>Unidad</th><th>Físico</th><th>Reservado</th><th>Disponible</th><th>Mínimo</th><th>Estado</th></tr></thead><tbody>
    ${d.piezas.map(p => `<tr><td>${esc(p.codigo)}</td><td>${esc(p.nombre)}</td><td>${esc(p.unidad)}</td><td class="${claseNum(p.fisico)}">${fmtConteo(p.fisico)}</td><td class="num">${fmtConteo(p.reservado)}</td><td class="${claseNum(p.disp)}"><strong>${fmtConteo(p.disp)}</strong></td><td class="num">${fmtConteo(p.minimo)}</td><td><span class="pildora ${p.est[0]}">${p.est[1]}</span></td></tr>`).join('')}
    </tbody></table></div>`;
}

async function vistaInicio(c) {
  const ubic = await P.ubicacion();
  if (!hayDatos()) {
    c.innerHTML = `<section class="tarjeta vacia">
      <h1>Bienvenido</h1>
      <p>Aún no hay datos cargados. Pulse <strong>«Cargar demostración»</strong> para cargar los datos sintéticos del Excel 06 incluidos en la aplicación, o <strong>«Cargar Excel 06…»</strong> para elegir un archivo.</p>
      ${botonesDatos()}
      <p class="pie">Los datos se guardan en: ${esc(ubic)}</p></section>`;
    enlazarBotones(c);
    return;
  }
  const ult = filas('SELECT * FROM carga ORDER BY id DESC LIMIT 1')[0];
  const d = datosControl();
  c.innerHTML = html`<div class="pila">
    <section class="tarjeta encabezado-vista">
      <h1>Inicio</h1>${crudo(botonesDatos())}
    </section>
    <section class="tarjeta"><div class="cab-tarjeta"><h2>Totales de control de la carga</h2><span class="subtexto">Todos los equipos · todo el período cargado · para el análisis de P-01 use «Indicadores»</span></div>${crudo(kpisInicio(d))}</section>
    <div class="fila-tarjetas dos">
      <section class="tarjeta"><h2>Existencias actuales</h2>${crudo(tablaExistencias(d))}</section>
      <section class="tarjeta"><h2>Datos cargados</h2><dl class="ficha">
          <dt>Origen</dt><dd>${ult ? (ult.origen === 'DEMOSTRACION' ? 'Demostración incluida' : 'Archivo elegido por el usuario') : '—'}</dd>
          <dt>Archivo</dt><dd>${ult ? ult.archivo : '—'}</dd>
          <dt>Empresa</dt><dd>${ult ? ult.empresa : '—'}</dd>
          <dt>Contrato</dt><dd>${ult ? ult.contrato : '—'}</dd>
          <dt>Período</dt><dd>${ult ? ult.periodo_desde + ' a ' + ult.periodo_hasta : '—'}</dd>
          <dt>Cargado el</dt><dd>${ult ? mostrarFH(ult.instante) : '—'}</dd>
          <dt>SHA-256</dt><dd><code>${ult ? ult.sha256 : '—'}</code></dd>
          <dt>Se guarda en</dt><dd>${ubic}</dd></dl></section>
    </div>
    <section class="tarjeta"><h2>Registros por hoja del Excel 06</h2>${crudo(tablaConteos())}</section>
  </div>`;
  enlazarBotones(c);
}

async function vistaDatos(c) {
  const resp = await P.listarRespaldos();
  const eventos = filas('SELECT * FROM evento ORDER BY id DESC LIMIT 50');
  const val = ultimaValidacion;
  c.innerHTML = html`<div class="pila">
    <section class="tarjeta encabezado-vista"><h1>Datos y respaldos</h1>${crudo(botonesDatos())}</section>
    <div class="fila-tarjetas"><section class="tarjeta"><h2>Respaldos automáticos (últimos 10)</h2>
    ${crudo(resp.length ? `<table class="tabla ajustada"><thead><tr><th>Fecha y hora</th><th>Revisión</th><th>Motivo</th><th></th></tr></thead><tbody>
      ${resp.map((r, i) => `<tr><td>${esc(mostrarFH(new Date(r.instante).toISOString()))}</td><td class="num">${fmtConteo(r.rev)}</td><td>${esc(r.motivo)}</td><td><button type="button" class="btn chico" data-resp="${i}">Restaurar este</button></td></tr>`).join('')}
      </tbody></table>` : '<p class="vacio">Todavía no hay respaldos automáticos. Se crean al guardar un cambio sobre datos existentes.</p>')}</section>
    <section class="tarjeta"><h2>Última validación de Excel en esta sesión</h2>
    ${crudo(val ? `<p>${esc(val.nombre)} · ${esc(mostrarFH(val.instante))} · ${val.errores.length ? `<span class="pildora error">${fmtConteo(val.errores.length)} errores</span>` : '<span class="pildora ok">Sin errores</span>'}</p>` : '<p class="vacio">Sin validaciones en esta sesión.</p>')}</section></div>
    <section class="tarjeta"><h2>Bitácora de operaciones</h2>
    ${crudo(eventos.length ? `<div class="tabla-scroll"><table class="tabla"><thead><tr><th>Fecha y hora</th><th>Operación</th><th>Referencia</th><th>Usuario</th></tr></thead><tbody>
      ${eventos.map(e => `<tr><td>${esc(mostrarFH(e.instante))}</td><td>${esc(e.tipo)}</td><td>${esc(e.referencia)}</td><td>${esc(e.usuario)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vacio">Sin operaciones registradas.</p>')}
    <p class="pie">Versión ${V} · compilación ${COMP}</p></section>
  </div>`;
  enlazarBotones(c);
  c.querySelectorAll('[data-resp]').forEach(b => {
    b.onclick = async () => {
      const r = resp[Number(b.dataset.resp)];
      await restaurarBytes(await P.obtenerRespaldo(r.id), `respaldo automático de revisión ${r.rev}`);
    };
  });
}
