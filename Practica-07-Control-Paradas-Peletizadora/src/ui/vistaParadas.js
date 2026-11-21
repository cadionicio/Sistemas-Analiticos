// Pantalla «Paradas»: filtro por período con hora de corte, tiempos recortados al intervalo y operación de la parada.
import { filas, valor } from '../nucleo/bd.js';
import { mostrarFH, mostrarF, ahoraIso, textoLocalAIso, isoAMs, msAIso } from '../nucleo/fechas.js';
import { fmtMagnitud, fmtConteo, esc } from '../nucleo/formato.js';
import { resumenTramos, minutosPorFecha, minutosRecortados, NOMBRE_TRAMO, TIPOS_TRAMO } from '../nucleo/tiempo.js';
import * as op from '../nucleo/operaciones.js';
import { formulario, aLocalInput, ahoraLocalInput, aviso } from './dom.js';

const h2 = m => fmtMagnitud(m / 60, 2) + ' h';
// Filtro vigente (solo se reemplaza con valores completos y válidos)
let filtro = null;
let abierta = null; // parada con el detalle desplegado

function filtroInicial() {
  const hasta = ahoraIso();
  const ult = filas('SELECT periodo_desde FROM carga ORDER BY id DESC LIMIT 1')[0];
  return { equipo: 'P-01', desde: (ult ? ult.periodo_desde : hasta.slice(0, 10)) + 'T00:00:00-05:00', hasta: msAIso(isoAMs(hasta.slice(0, 10) + 'T00:00:00-05:00') + 86400000), corte: null };
}
const corteDe = f => f.corte || ahoraIso();

export async function vistaParadas(c, ctx) {
  if (!ctx.hayDatos()) { c.innerHTML = '<section class="tarjeta vacia"><h1>Paradas</h1><p>No hay datos. Vaya a «Inicio» y pulse «Cargar demostración».</p></section>'; return; }
  if (!filtro) filtro = filtroInicial();
  if (globalThis.CPR_PARADA_SEL) {
    // Llegada desde Indicadores: el período se ajusta para mostrar la parada y su detalle
    const p = filas('SELECT * FROM parada WHERE codigo=?', [globalThis.CPR_PARADA_SEL])[0];
    globalThis.CPR_PARADA_SEL = null;
    if (p) {
      const d0 = p.inicio.slice(0, 10) + 'T00:00:00-05:00';
      const fin = p.fin || ahoraIso();
      filtro = { ...filtro, equipo: p.equipo_codigo, desde: d0, hasta: msAIso(isoAMs(fin.slice(0, 10) + 'T00:00:00-05:00') + 86400000), corte: null };
      abierta = p.codigo;
      setTimeout(() => { const tr = c.querySelector(`tr[data-parada="${p.codigo}"]`); if (tr) tr.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 60);
    }
  }
  const u = ctx.usuario();
  const equipos = filas('SELECT codigo, nombre FROM equipo ORDER BY codigo');
  c.innerHTML = `<div class="pila">
    <section class="tarjeta encabezado-vista"><h1>Paradas</h1>
      <div class="acciones"><button type="button" class="btn principal grande" id="b-nueva" ${op.puede(u, 'registrar_parada') ? '' : `disabled title="Corresponde a ${op.quienPuede('registrar_parada')}"`}>Registrar parada</button></div></section>
    <section class="tarjeta"><div class="cab-tarjeta"><h2>Período consultado</h2>
      <div class="barra-herr" id="filtros">
        <div class="campo"><label for="f-eq">Equipo</label><select id="f-eq"><option value="">Todos</option>${equipos.map(e => `<option value="${esc(e.codigo)}"${e.codigo === filtro.equipo ? ' selected' : ''}>${esc(e.codigo)} · ${esc(e.nombre)}</option>`).join('')}</select></div>
        <div class="campo"><label for="f-desde">Desde</label><input id="f-desde" type="datetime-local" value="${aLocalInput(filtro.desde)}"></div>
        <div class="campo"><label for="f-hasta">Hasta</label><input id="f-hasta" type="datetime-local" value="${aLocalInput(filtro.hasta)}"></div>
        <div class="campo"><label for="f-corte">Hora de corte</label><input id="f-corte" type="datetime-local" value="${filtro.corte ? aLocalInput(filtro.corte) : ''}"><small>Vacío = ahora</small></div>
        <div class="atajos"><button type="button" class="btn chico" data-r="hoy">Hoy</button><button type="button" class="btn chico" data-r="7">Últimos 7 días</button><button type="button" class="btn chico" data-r="todo">Período cargado</button></div>
      </div></div><div class="nota-filtro" id="nota-filtro"></div></section>
    <div id="resultado"></div></div>`;
  c.querySelector('#b-nueva').onclick = () => nuevaParada(ctx);
  // Fecha segura: un valor incompleto no se aplica; se mantiene el último filtro válido.
  const aplicar = () => {
    const nota = c.querySelector('#nota-filtro');
    const campos = { desde: c.querySelector('#f-desde'), hasta: c.querySelector('#f-hasta'), corte: c.querySelector('#f-corte') };
    let malo = null;
    const nuevo = { ...filtro, equipo: c.querySelector('#f-eq').value };
    for (const [k, el] of Object.entries(campos)) {
      el.classList.remove('incompleto');
      if (el.validity.badInput || (k !== 'corte' && !el.value)) { el.classList.add('incompleto'); malo = malo || k; continue; }
      nuevo[k] = el.value ? textoLocalAIso(el.value) : null;
      if (el.value && !nuevo[k]) { el.classList.add('incompleto'); malo = malo || k; }
    }
    if (!malo && nuevo.hasta <= nuevo.desde) { campos.hasta.classList.add('incompleto'); malo = 'hasta'; nota.textContent = '«Hasta» debe ser posterior a «Desde». Se mantiene el filtro anterior.'; return; }
    if (malo) { nota.textContent = 'Fecha incompleta o inválida: se mantiene el filtro anterior.'; pintarResultado(c, ctx); return; }
    nota.textContent = '';
    filtro = nuevo;
    pintarResultado(c, ctx);
  };
  c.querySelectorAll('#filtros input, #filtros select').forEach(el => { el.addEventListener('change', aplicar); el.addEventListener('input', () => { if (el.validity && el.validity.badInput) el.classList.add('incompleto'); }); });
  c.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
    const hoy0 = ahoraIso().slice(0, 10) + 'T00:00:00-05:00';
    const man = msAIso(isoAMs(hoy0) + 86400000);
    if (b.dataset.r === 'hoy') filtro = { ...filtro, desde: hoy0, hasta: man };
    if (b.dataset.r === '7') filtro = { ...filtro, desde: msAIso(isoAMs(hoy0) - 6 * 86400000), hasta: man };
    if (b.dataset.r === 'todo') filtro = { ...filtroInicial(), equipo: filtro.equipo, corte: filtro.corte };
    vistaParadas(c, ctx);
  });
  pintarResultado(c, ctx);
}

function paradasEnFiltro() {
  const corte = corteDe(filtro);
  const ps = filas(`SELECT p.*, m.nombre AS modo_nombre FROM parada p LEFT JOIN modo_falla m ON m.codigo = p.modo_codigo
     WHERE (?='' OR p.equipo_codigo=?) AND p.inicio < ? AND p.inicio < ? AND coalesce(p.fin, ?) > ? ORDER BY p.inicio DESC`,
  [filtro.equipo, filtro.equipo, filtro.hasta, corte, corte, filtro.desde]);
  return ps.map(p => {
    const tr = filas('SELECT * FROM tramo WHERE parada_codigo=? ORDER BY secuencia', [p.codigo]);
    return { ...p, tramos: tr, res: resumenTramos(tr, filtro.desde, filtro.hasta, corte) };
  });
}

function pintarResultado(c, ctx) {
  const z = c.querySelector('#resultado');
  const corte = corteDe(filtro);
  const ps = paradasEnFiltro();
  const tot = ps.reduce((a, p) => a + p.res.total, 0);
  const esp = ps.reduce((a, p) => a + p.res.porTipo.ESPERA_REPUESTO, 0);
  const abiertas = ps.filter(p => p.estado === 'ABIERTA').length;
  const todos = ps.flatMap(p => p.tramos);
  const porFecha = minutosPorFecha(todos, filtro.desde, filtro.hasta, corte);
  const fechas = Object.keys(porFecha).sort().reverse();
  const cruza = isoAMs(filtro.hasta) > isoAMs(corte);
  z.innerHTML = `<div class="pila">
    <section class="tarjeta"><h2>Tiempo de parada en el período</h2>
      <p class="subtexto centro">${esc(mostrarFH(filtro.desde))} a ${esc(mostrarFH(filtro.hasta))} · corte ${esc(mostrarFH(corte))}${cruza ? ' · el período llega hasta la hora de corte (no incluye tiempo futuro)' : ''}</p>
      <div class="kpis" id="kpis-paradas">
        <div class="kpi"><span>Horas de parada</span><strong id="k-total">${h2(tot)}</strong><small>recortadas al período</small></div>
        <div class="kpi"><span>Paradas en el período</span><strong>${fmtConteo(ps.length)}</strong><small>${filtro.equipo || 'todos los equipos'}</small></div>
        <div class="kpi"><span>Horas de espera de repuesto</span><strong id="k-espera">${h2(esp)}</strong><small>${tot ? fmtMagnitud(100 * esp / tot, 1) + ' % del tiempo de parada' : 'sin base de cálculo'}</small></div>
        <div class="kpi ${abiertas ? 'alerta' : 'ok'}"><span>Paradas abiertas</span><strong>${fmtConteo(abiertas)}</strong><small>${abiertas ? 'equipo indisponible' : 'equipos disponibles'}</small></div>
      </div>
      ${tot ? `<h3 class="centro">Distribución del tiempo por tramo</h3>
      <div class="linea-tramos grande" id="distribucion">${TIPOS_TRAMO.map(t => { const m = ps.reduce((a, p) => a + p.res.porTipo[t], 0); return m ? `<div class="t-${t}" style="flex-grow:${m}" title="${NOMBRE_TRAMO[t]}: ${h2(m)}" data-tipo="${t}" data-min="${m}">${m >= tot * 0.07 ? `${NOMBRE_TRAMO[t]} ${fmtMagnitud(100 * m / tot, 0)} %` : ''}</div>` : ''; }).join('')}</div>
      <div class="leyenda-tramos centro-flex">${TIPOS_TRAMO.map(t => { const m = ps.reduce((a, p) => a + p.res.porTipo[t], 0); return `<span><i class="marca-tramo t-${t}"></i>${NOMBRE_TRAMO[t]}: <strong>${h2(m)}</strong></span>`; }).join('')}</div>` : ''}
      </section>
    <section class="tarjeta"><h2>Paradas</h2>
      ${ps.length ? `<div class="tabla-centro"><table class="tabla" id="tabla-paradas"><thead><tr><th>Código</th><th>Equipo</th><th>Inicio</th><th>Fin</th><th>Estado</th><th>Modo de falla</th><th>Causa</th><th>Reincidencia</th><th>Horas en el período</th><th>Espera de repuesto</th></tr></thead><tbody>
      ${ps.map(p => filaParada(p)).join('')}</tbody></table></div>` : '<p class="vacio centro">No hay paradas en el período elegido.</p>'}
    </section>
    <section class="tarjeta"><h2>Horas por fecha</h2>
      ${fechas.length ? `<div class="tabla-scroll"><table class="tabla" id="tabla-fechas"><thead><tr><th>Fecha</th><th>Total</th>${TIPOS_TRAMO.map(t => `<th>${NOMBRE_TRAMO[t]}</th>`).join('')}</tr></thead><tbody>
      ${fechas.map(f => `<tr data-fecha="${f}" data-min="${porFecha[f].total}"><td>${mostrarF(f)}</td><td class="num"><strong>${fmtConteo(porFecha[f].total)} min</strong></td>${TIPOS_TRAMO.map(t => `<td class="num">${porFecha[f].porTipo[t] ? fmtConteo(porFecha[f].porTipo[t]) : ''}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>` : '<p class="vacio centro">Sin minutos de parada en el período.</p>'}
    </section></div>`;
  z.querySelectorAll('tr[data-parada]').forEach(tr => tr.onclick = () => {
    abierta = abierta === tr.dataset.parada ? null : tr.dataset.parada;
    pintarResultado(c, ctx);
  });
  if (abierta) {
    const tr = z.querySelector(`tr[data-parada="${abierta}"]`);
    if (tr) {
      const det = document.createElement('tr');
      det.className = 'detalle';
      det.innerHTML = `<td colspan="10">${detalleParada(abierta, ctx)}</td>`;
      tr.after(det);
      enlazarDetalle(det, abierta, ctx, c);
    }
  }
}

function chipCausa(p) {
  return p.estado_causa === 'CONFIRMADA' ? '<span class="pildora ok">Confirmada</span>' : p.estado_causa === 'HIPOTESIS' ? '<span class="pildora alerta">Hipótesis</span>' : '<span class="pildora error">Pendiente</span>';
}
function chipReinc(p) {
  if (!p.reincidencia_de) return '';
  const cls = { PENDIENTE: 'alerta', CONFIRMADA: 'error', DESCARTADA: 'ok' }[p.estado_reincidencia] || 'info';
  const txt = { PENDIENTE: 'Posible, por confirmar', CONFIRMADA: 'Confirmada', DESCARTADA: 'Descartada' }[p.estado_reincidencia] || '';
  return `<span class="pildora ${cls}">${txt}</span> <span class="subtexto">de ${esc(p.reincidencia_de)}</span>`;
}
function filaParada(p) {
  return `<tr class="clic${abierta === p.codigo ? ' sel' : ''}" data-parada="${esc(p.codigo)}" data-min="${p.res.total}" data-espera="${p.res.porTipo.ESPERA_REPUESTO}">
    <td>${esc(p.codigo)}</td><td>${esc(p.equipo_codigo)}</td><td class="nw">${esc(mostrarFH(p.inicio))}</td><td class="nw">${p.fin ? esc(mostrarFH(p.fin)) : '—'}</td>
    <td>${p.estado === 'ABIERTA' ? '<span class="pildora alerta">Abierta</span>' : '<span class="pildora ok">Cerrada</span>'}</td>
    <td>${esc(p.modo_nombre || '—')}</td><td>${chipCausa(p)}</td><td>${chipReinc(p)}</td>
    <td class="num"><strong>${h2(p.res.total)}</strong></td><td class="num">${h2(p.res.porTipo.ESPERA_REPUESTO)}</td></tr>`;
}

function botonOp(id, texto, permiso, u, extra = '') {
  return `<button type="button" class="btn ${extra}" id="${id}" ${op.puede(u, permiso) ? '' : `disabled title="Corresponde a ${op.quienPuede(permiso)}"`}>${texto}</button>`;
}

function detalleParada(codigo, ctx) {
  const u = ctx.usuario();
  const p = filas('SELECT p.*, m.nombre AS modo_nombre FROM parada p LEFT JOIN modo_falla m ON m.codigo = p.modo_codigo WHERE p.codigo=?', [codigo])[0];
  const corte = corteDe(filtro);
  const tr = filas('SELECT * FROM tramo WHERE parada_codigo=? ORDER BY secuencia', [codigo]);
  const totalCompleto = tr.reduce((a, t) => a + minutosRecortados(t.inicio, t.fin, p.inicio, '9999-12-31T00:00:00-05:00', corte), 0);
  const ver = filas('SELECT * FROM verificacion WHERE parada_codigo=? ORDER BY instante', [codigo]);
  const ords = filas('SELECT * FROM orden WHERE parada_codigo=? ORDER BY apertura', [codigo]);
  const cons = filas('SELECT c.*, pz.nombre FROM consumo c JOIN orden o ON o.codigo = c.orden_codigo JOIN pieza pz ON pz.codigo = c.pieza_codigo WHERE o.parada_codigo=? ORDER BY c.fecha_efectiva', [codigo]);
  const corr = filas('SELECT c.*, t.secuencia FROM correccion_tramo c JOIN tramo t ON t.id = c.tramo_id WHERE t.parada_codigo=? ORDER BY c.id', [codigo]);
  const actual = tr.find(t => !t.fin);
  const linea = tr.map(t => {
    const m = minutosRecortados(t.inicio, t.fin, t.inicio, '9999-12-31T00:00:00-05:00', corte);
    return `<div class="t-${t.tipo}" style="flex-grow:${Math.max(m, 1)}" title="${esc(NOMBRE_TRAMO[t.tipo])}: ${fmtConteo(m)} min">${m >= totalCompleto * 0.08 ? esc(NOMBRE_TRAMO[t.tipo]) : ''}</div>`;
  }).join('');
  return `<div class="det-parada" id="det-${esc(codigo)}">
    <div class="encabezado-vista"><h3 style="margin:0">${esc(codigo)} · ${esc(p.sintoma)}</h3>
      <span>${p.estado === 'ABIERTA' ? `<span class="pildora alerta">Abierta · en ${esc(NOMBRE_TRAMO[actual.tipo])}</span>` : '<span class="pildora ok">Cerrada · equipo apto</span>'}</span></div>
    <div class="linea-tramos">${linea}</div>
    <div class="leyenda-tramos">${TIPOS_TRAMO.map(t => `<span><i class="marca-tramo t-${t}"></i>${NOMBRE_TRAMO[t]}</span>`).join('')}</div>
    <div class="acciones izq">
      ${p.estado === 'ABIERTA' ? botonOp('b-tramo', 'Cambiar tramo', 'cambiar_tramo', u) : ''}
      ${p.estado === 'ABIERTA' ? botonOp('b-verif', 'Verificar retorno', 'verificar_retorno', u, 'principal') : ''}
      ${botonOp('b-diag', 'Registrar diagnóstico', 'diagnosticar', u)}
      ${p.reincidencia_de && p.estado_reincidencia === 'PENDIENTE' ? botonOp('b-reinc', 'Confirmar o descartar reincidencia', 'resolver_reincidencia', u) : ''}
      ${!ords.some(o => o.estado === 'ABIERTA') ? botonOp('b-orden', 'Abrir orden correctiva', 'abrir_orden', u) : ''}
      ${botonOp('b-reclas', 'Reclasificar tramo', 'reclasificar_tramo', u)}
    </div>
    <div class="bloques-detalle">
      <div><h4>Tramos (minutos totales: ${fmtConteo(totalCompleto)})</h4><table class="tabla" id="tabla-tramos"><thead><tr><th>#</th><th>Tramo</th><th>Desde</th><th>Hasta</th><th>Minutos</th><th>En el período</th><th>Evidencia</th></tr></thead><tbody>
        ${tr.map(t => `<tr data-tipo="${t.tipo}"><td>${t.secuencia}</td><td><i class="marca-tramo t-${t.tipo}"></i>${esc(NOMBRE_TRAMO[t.tipo])}</td><td>${esc(mostrarFH(t.inicio))}</td><td>${t.fin ? esc(mostrarFH(t.fin)) : '<em>en curso</em>'}</td>
          <td class="num">${fmtConteo(minutosRecortados(t.inicio, t.fin, t.inicio, '9999-12-31T00:00:00-05:00', corte))}</td><td class="num">${fmtConteo(minutosRecortados(t.inicio, t.fin, filtro.desde, filtro.hasta, corte))}</td><td>${esc(t.evidencia)}</td></tr>`).join('')}
      </tbody></table>
      ${corr.length ? `<h4>Correcciones de tramo</h4><table class="tabla"><thead><tr><th>#</th><th>Antes</th><th>Después</th><th>Autor</th><th>Fecha</th><th>Motivo</th><th>Evidencia</th></tr></thead><tbody>${corr.map(x => `<tr><td>${x.secuencia}</td><td>${esc(NOMBRE_TRAMO[x.tipo_anterior])}</td><td>${esc(NOMBRE_TRAMO[x.tipo_nuevo])}</td><td>${esc(x.autor)}</td><td>${esc(mostrarFH(x.instante))}</td><td>${esc(x.motivo)}</td><td>${esc(x.evidencia)}</td></tr>`).join('')}</tbody></table>` : ''}
      </div>
      <div><h4>Hecho y diagnóstico</h4><dl class="ficha">
        <dt>Equipo</dt><dd>${esc(p.equipo_codigo)}</dd>
        <dt>Hora del hecho</dt><dd>${esc(mostrarFH(p.inicio))}</dd><dt>Hora de registro</dt><dd>${esc(mostrarFH(p.registro))}</dd>
        <dt>Reportó</dt><dd>${esc(p.reportado_por)}</dd>
        <dt>Modo de falla</dt><dd>${esc(p.modo_nombre || 'Sin diagnóstico')}</dd>
        <dt>Causa</dt><dd>${chipCausa(p)} ${esc(p.causa)}</dd><dt>Evidencia</dt><dd>${esc(p.evidencia_causa || '—')}</dd>
        <dt>Reincidencia</dt><dd>${chipReinc(p) || 'No'}</dd>
        <dt>Verificó</dt><dd>${esc(p.verificado_por || '—')}</dd></dl>
        <h4>Verificaciones de retorno</h4>${ver.length ? `<table class="tabla"><tbody>${ver.map(v => `<tr><td>${esc(mostrarFH(v.instante))}</td><td>${v.resultado === 'APTO' ? '<span class="pildora ok">Apto</span>' : '<span class="pildora error">No apto</span>'}</td><td>${esc(v.verificado_por)}</td><td>${esc(v.observacion)}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Aún sin verificación.</p>'}
        <h4>Órdenes y repuestos</h4>${ords.length ? `<table class="tabla"><tbody>${ords.map(o => `<tr><td>${esc(o.codigo)}</td><td>${o.estado === 'ABIERTA' ? '<span class="pildora alerta">Abierta</span>' : '<span class="pildora ok">Cerrada</span>'}</td><td>${esc(o.responsable)}</td><td><button type="button" class="btn chico" data-ir-orden="${esc(o.codigo)}">Ver orden</button></td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Sin orden de trabajo.</p>'}
        ${cons.length ? `<table class="tabla"><thead><tr><th>Consumo</th><th>Pieza</th><th>Cantidad</th><th>Entrega</th></tr></thead><tbody>${cons.map(x => `<tr><td>${esc(x.codigo)}</td><td>${esc(x.pieza_codigo)} ${esc(x.nombre)}</td><td class="num">${fmtConteo(x.cantidad)}</td><td>${esc(mostrarFH(x.fecha_efectiva))}</td></tr>`).join('')}</tbody></table>` : ''}
      </div>
    </div></div>`;
}

function enlazarDetalle(det, codigo, ctx, c) {
  const on = (id, f) => { const b = det.querySelector('#' + id); if (b) b.onclick = e => { e.stopPropagation(); f(); }; };
  const p = () => filas('SELECT * FROM parada WHERE codigo=?', [codigo])[0];
  on('b-tramo', async () => {
    const t = op.tramoAbierto(codigo);
    const v = await formulario({
      titulo: `Cambiar tramo · ${codigo}`, intro: `<p>Tramo actual: <strong>${esc(NOMBRE_TRAMO[t.tipo])}</strong> desde ${esc(mostrarFH(t.inicio))}. El tramo actual termina donde empieza el nuevo.</p>`,
      campos: [
        { id: 'tipo', etiqueta: 'Nuevo tramo', tipo: 'select', opciones: TIPOS_TRAMO.filter(x => x !== t.tipo).map(x => [x, NOMBRE_TRAMO[x]]) },
        { id: 'instante', etiqueta: 'Desde', tipo: 'fechahora', valor: ahoraLocalInput(), ayuda: 'La espera de repuesto empieza cuando la falta de la pieza impide continuar, no al hacer el pedido.' },
        { id: 'evidencia', etiqueta: 'Evidencia', tipo: 'texto', ayuda: 'Obligatoria para «Espera de repuesto» (pedido, pieza faltante).' },
      ],
    });
    if (v) await ctx.operar(op.cambiarTramo, { parada: codigo, ...v }, { ok: `Tramo cambiado a «${NOMBRE_TRAMO[v.tipo]}».`, motivo: 'Cambiar tramo ' + codigo });
  });
  on('b-verif', async () => {
    const v = await formulario({
      titulo: `Verificar retorno · ${codigo}`, intro: '<p>Producción comprueba si el equipo está apto para producir. Si no está apto, la misma parada sigue abierta y se retoma la reparación.</p>',
      campos: [
        { id: 'resultado', etiqueta: 'Resultado de la prueba', tipo: 'select', opciones: [['APTO', 'Apto: el equipo produce normalmente'], ['NO_APTO', 'No apto: la falla persiste']] },
        { id: 'instante', etiqueta: 'Hora de la verificación', tipo: 'fechahora', valor: ahoraLocalInput() },
        { id: 'observacion', etiqueta: 'Observación', tipo: 'texto' },
      ],
    });
    if (v) await ctx.operar(op.verificarRetorno, { parada: codigo, ...v }, { ok: v.resultado === 'APTO' ? `Parada ${codigo} cerrada: equipo apto.` : `Prueba no apta: la parada ${codigo} sigue abierta en reparación.`, motivo: 'Verificar retorno ' + codigo });
  });
  on('b-diag', async () => {
    const pa = p();
    const modos = filas('SELECT m.codigo, m.nombre FROM modo_falla m JOIN equipo e ON e.tipo_codigo = m.tipo_codigo WHERE e.codigo=? ORDER BY m.codigo', [pa.equipo_codigo]);
    const v = await formulario({
      titulo: `Registrar diagnóstico · ${codigo}`, intro: `<p>Síntoma reportado: <strong>${esc(pa.sintoma)}</strong>. Una hipótesis pasa a causa confirmada solo con observación documentada.</p>`,
      campos: [
        { id: 'modo', etiqueta: 'Modo de falla', tipo: 'select', valor: pa.modo_codigo, opciones: modos.map(m => [m.codigo, `${m.codigo} · ${m.nombre}`]) },
        { id: 'estado_causa', etiqueta: 'Estado de la causa', tipo: 'select', valor: pa.estado_causa, opciones: [['PENDIENTE', 'Pendiente'], ['HIPOTESIS', 'Hipótesis'], ['CONFIRMADA', 'Confirmada con evidencia']] },
        { id: 'causa', etiqueta: 'Hipótesis o causa', tipo: 'texto', valor: pa.causa },
        { id: 'evidencia', etiqueta: 'Evidencia', tipo: 'texto', valor: pa.evidencia_causa, ayuda: 'Obligatoria para confirmar la causa.' },
      ],
    });
    if (v) await ctx.operar(op.registrarDiagnostico, { parada: codigo, ...v }, { ok: r => r.antecedente ? `Diagnóstico registrado. Posible reincidencia: mismo modo que ${r.antecedente} dentro de ${r.ventana} días (pendiente de confirmar).` : 'Diagnóstico registrado.', motivo: 'Diagnóstico ' + codigo });
  });
  on('b-reinc', async () => {
    const pa = p();
    const v = await formulario({
      titulo: `Reincidencia · ${codigo}`, intro: `<p>Antecedente: <strong>${esc(pa.reincidencia_de)}</strong> (mismo equipo y modo de falla dentro de la ventana).</p>`,
      campos: [{ id: 'decision', etiqueta: 'Decisión', tipo: 'select', opciones: [['CONFIRMADA', 'Confirmar reincidencia'], ['DESCARTADA', 'Descartar: causa distinta']] }, { id: 'motivo', etiqueta: 'Motivo', tipo: 'texto' }],
    });
    if (v) await ctx.operar(op.resolverReincidencia, { parada: codigo, ...v }, { ok: 'Reincidencia ' + (v.decision === 'CONFIRMADA' ? 'confirmada.' : 'descartada.'), motivo: 'Reincidencia ' + codigo });
  });
  on('b-orden', async () => {
    const v = await formulario({ titulo: `Abrir orden correctiva · ${codigo}`, campos: [{ id: 'descripcion', etiqueta: 'Trabajo a realizar', tipo: 'texto', valor: 'Correctivo: ' + p().sintoma }] });
    if (v) await ctx.operar(op.abrirOrdenCorrectiva, { parada: codigo, op_id: op.nuevoOpId(), ...v }, { ok: r => `Orden ${r.codigo} abierta para ${codigo}.`, motivo: 'Abrir orden ' + codigo });
  });
  on('b-reclas', async () => {
    const tr = filas('SELECT * FROM tramo WHERE parada_codigo=? ORDER BY secuencia', [codigo]);
    const v = await formulario({
      titulo: `Reclasificar tramo · ${codigo}`, intro: '<p>Se conserva el tipo anterior, el autor, la hora y el motivo.</p>',
      campos: [
        { id: 'tramo', etiqueta: 'Tramo', tipo: 'select', opciones: tr.map(t => [t.id, `#${t.secuencia} · ${NOMBRE_TRAMO[t.tipo]} · ${mostrarFH(t.inicio)}`]) },
        { id: 'tipo', etiqueta: 'Nuevo tipo', tipo: 'select', opciones: TIPOS_TRAMO.map(x => [x, NOMBRE_TRAMO[x]]) },
        { id: 'motivo', etiqueta: 'Motivo', tipo: 'texto' }, { id: 'evidencia', etiqueta: 'Evidencia', tipo: 'texto' },
      ],
    });
    if (v) await ctx.operar(op.reclasificarTramo, { tramo: Number(v.tramo), tipo: v.tipo, motivo: v.motivo, evidencia: v.evidencia }, { ok: 'Tramo reclasificado con su evidencia.', motivo: 'Reclasificar tramo ' + codigo });
  });
  det.querySelectorAll('[data-ir-orden]').forEach(b => b.onclick = e => { e.stopPropagation(); globalThis.CPR_ORDEN_SEL = b.dataset.irOrden; ctx.irA('ordenes'); });
}

async function nuevaParada(ctx) {
  const v = await formulario({
    titulo: 'Registrar parada', intro: '<p>Producción registra la pérdida de disponibilidad del equipo. La parada empieza en la hora del hecho, no en la hora de registro.</p>',
    campos: [
      { id: 'equipo', etiqueta: 'Equipo', tipo: 'select', valor: 'P-01', opciones: filas('SELECT codigo, nombre FROM equipo ORDER BY codigo').map(e => [e.codigo, `${e.codigo} · ${e.nombre}`]) },
      { id: 'inicio', etiqueta: 'Hora del hecho', tipo: 'fechahora', valor: ahoraLocalInput() },
      { id: 'sintoma', etiqueta: 'Síntoma observado', tipo: 'texto' },
    ],
  });
  if (!v) return;
  const r = await ctx.operar(op.registrarParada, { ...v, op_id: op.nuevoOpId() }, { ok: r => `Parada ${r.codigo} registrada. Mantenimiento debe atenderla.`, motivo: 'Registrar parada' });
  if (r && r.codigo) { abierta = r.codigo; ctx.refrescar(); }
}
