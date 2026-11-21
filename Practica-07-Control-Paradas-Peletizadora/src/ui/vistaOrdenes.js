// Pantalla «Órdenes y repuestos»: órdenes, reservas, entregas (consumo atómico e idempotente) y existencias al corte.
import { filas } from '../nucleo/bd.js';
import { mostrarFH, textoLocalAIso, ahoraIso } from '../nucleo/fechas.js';
import { fmtConteo, esc, claseNum } from '../nucleo/formato.js';
import * as op from '../nucleo/operaciones.js';
import { formulario, aLocalInput, ahoraLocalInput, aviso } from './dom.js';

let estadoFiltro = 'ABIERTA';
let ordenSel = null;
let piezaSel = null;
let corte = null; // null = existencias actuales

export async function vistaOrdenes(c, ctx) {
  if (!ctx.hayDatos()) { c.innerHTML = '<section class="tarjeta vacia"><h1>Órdenes y repuestos</h1><p>No hay datos. Vaya a «Inicio» y pulse «Cargar demostración».</p></section>'; return; }
  if (globalThis.CPR_PIEZA_SEL) { piezaSel = globalThis.CPR_PIEZA_SEL; globalThis.CPR_PIEZA_SEL = null; setTimeout(() => { const tr = c.querySelector(`#tabla-existencias tr[data-pieza="${piezaSel}"]`); if (tr) tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 60); }
  if (globalThis.CPR_ORDEN_SEL) { ordenSel = globalThis.CPR_ORDEN_SEL; estadoFiltro = 'TODAS'; globalThis.CPR_ORDEN_SEL = null; }
  const u = ctx.usuario();
  const ords = filas(`SELECT o.*, (SELECT count(*) FROM reserva r WHERE r.orden_codigo=o.codigo AND r.estado='VIGENTE') AS reservas,
      (SELECT count(*) FROM consumo x WHERE x.orden_codigo=o.codigo) AS consumos
    FROM orden o WHERE (?='TODAS' OR o.estado=?) ORDER BY o.apertura DESC LIMIT 300`, [estadoFiltro, estadoFiltro]);
  c.innerHTML = `<div class="pila">
    <section class="tarjeta encabezado-vista"><h1>Órdenes y repuestos</h1>
      <div class="acciones"><button type="button" class="btn" id="b-ingreso" ${op.puede(u, 'registrar_ingreso') ? '' : `disabled title="Corresponde a ${op.quienPuede('registrar_ingreso')}"`}>Registrar ingreso de pieza</button></div></section>
    <section class="tarjeta"><div class="cab-tarjeta"><h2>Órdenes de trabajo</h2>
      <div class="barra-herr"><div class="campo en-linea"><label for="f-est">Mostrar</label><select id="f-est">
        ${[['ABIERTA', 'Abiertas'], ['CERRADA', 'Cerradas'], ['TODAS', 'Todas']].map(([v, t]) => `<option value="${v}"${v === estadoFiltro ? ' selected' : ''}>${t}</option>`).join('')}</select></div></div></div>
      ${ords.length ? `<div class="tabla-centro"><table class="tabla" id="tabla-ordenes"><thead><tr><th>Orden</th><th>Tipo</th><th>Equipo</th><th>Parada o tarea</th><th>Apertura</th><th>Estado</th><th>Reservas vigentes</th><th>Entregas</th><th>Descripción</th></tr></thead><tbody>
        ${ords.map(o => `<tr class="clic${ordenSel === o.codigo ? ' sel' : ''}" data-orden="${esc(o.codigo)}"><td>${esc(o.codigo)}</td><td>${o.tipo === 'CORRECTIVA' ? 'Correctiva' : 'Preventiva'}</td><td>${esc(o.equipo_codigo)}</td><td>${esc(o.parada_codigo || o.tarea_codigo || '—')}</td>
          <td>${esc(mostrarFH(o.apertura))}</td><td>${o.estado === 'ABIERTA' ? '<span class="pildora alerta">Abierta</span>' : o.estado === 'CERRADA' ? '<span class="pildora ok">Cerrada</span>' : '<span class="pildora error">Anulada</span>'}</td>
          <td class="num">${fmtConteo(o.reservas)}</td><td class="num">${fmtConteo(o.consumos)}</td><td>${esc(o.descripcion)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="vacio centro">No hay órdenes con ese estado.</p>'}
    </section>
    <section class="tarjeta"><div class="cab-tarjeta"><h2>Existencias</h2>
      <div class="barra-herr"><div class="campo en-linea"><label for="f-corte-ex">Existencias al corte</label><input id="f-corte-ex" type="datetime-local" value="${corte ? aLocalInput(corte) : ''}" title="Vacío = existencias actuales"></div>
        <button type="button" class="btn chico" id="b-corte-hoy">Actual</button></div></div><div class="nota-filtro" id="nota-corte"></div>
      <div id="existencias-corte">${tablaExistencias()}</div>
    </section></div>`;
  c.querySelector('#f-est').onchange = e => { estadoFiltro = e.target.value; vistaOrdenes(c, ctx); };
  c.querySelector('#b-ingreso').onclick = () => ingreso(ctx);
  const fc = c.querySelector('#f-corte-ex');
  fc.onchange = () => {
    fc.classList.remove('incompleto');
    if (fc.validity.badInput) { fc.classList.add('incompleto'); c.querySelector('#nota-corte').textContent = 'Fecha incompleta: se mantiene el corte anterior.'; return; }
    c.querySelector('#nota-corte').textContent = '';
    corte = fc.value ? textoLocalAIso(fc.value) : null;
    c.querySelector('#existencias-corte').innerHTML = tablaExistencias();
    enlazarPiezas(c);
  };
  c.querySelector('#b-corte-hoy').onclick = () => { corte = null; vistaOrdenes(c, ctx); };
  c.querySelectorAll('tr[data-orden]').forEach(tr => tr.onclick = () => { ordenSel = ordenSel === tr.dataset.orden ? null : tr.dataset.orden; vistaOrdenes(c, ctx); });
  if (ordenSel) {
    const tr = c.querySelector(`tr[data-orden="${ordenSel}"]`);
    if (tr) {
      const det = document.createElement('tr'); det.className = 'detalle';
      det.innerHTML = `<td colspan="9">${detalleOrden(ordenSel, u)}</td>`;
      tr.after(det); enlazarOrden(det, ordenSel, ctx);
      tr.scrollIntoView({ block: 'nearest' });
    }
  }
  enlazarPiezas(c);
}

function tablaExistencias() {
  const ps = filas('SELECT codigo FROM pieza ORDER BY codigo').map(p => op.existencia(p.codigo, corte));
  return `<p class="subtexto">${corte ? 'Saldo reconstruido con los movimientos con fecha efectiva hasta ' + esc(mostrarFH(corte)) : 'Existencias actuales con todos los movimientos confirmados'}</p>
    <div class="tabla-centro"><table class="tabla" id="tabla-existencias"><thead><tr><th>Código</th><th>Pieza</th><th>Unidad</th><th>Físico</th><th>Reservado</th><th>Disponible</th><th>Mínimo</th><th>Estado</th></tr></thead><tbody>
    ${ps.map(e => {
      if (e.noDisponible) return `<tr class="clic" data-pieza="${esc(e.codigo)}" data-fisico="ND"><td>${esc(e.codigo)}</td><td>${esc(e.nombre)}</td><td>${esc(e.unidad)}</td><td colspan="3" class="centro"><span class="pildora alerta">No disponible: saldo inicial desconocido a esa fecha</span></td><td class="num">${fmtConteo(e.stock_minimo)}</td><td></td></tr>`;
      const est = e.disponible < e.stock_minimo ? (e.disponible <= 0 ? ['error', 'Sin disponible'] : ['alerta', 'Bajo mínimo']) : ['ok', 'Suficiente'];
      return `<tr class="clic${piezaSel === e.codigo ? ' sel' : ''}" data-pieza="${esc(e.codigo)}" data-fisico="${e.fisico}" data-reservado="${e.reservado}" data-disponible="${e.disponible}"><td>${esc(e.codigo)}</td><td>${esc(e.nombre)}</td><td>${esc(e.unidad)}</td>
        <td class="${claseNum(e.fisico)}">${fmtConteo(e.fisico)}</td><td class="num">${fmtConteo(e.reservado)}</td><td class="${claseNum(e.disponible)}"><strong>${fmtConteo(e.disponible)}</strong></td><td class="num">${fmtConteo(e.stock_minimo)}</td><td><span class="pildora ${est[0]}">${est[1]}</span></td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function enlazarPiezas(c) {
  c.querySelectorAll('#tabla-existencias tr[data-pieza]').forEach(tr => tr.onclick = () => {
    piezaSel = piezaSel === tr.dataset.pieza ? null : tr.dataset.pieza;
    c.querySelector('#existencias-corte').innerHTML = tablaExistencias();
    enlazarPiezas(c);
  });
  if (piezaSel) {
    const tr = c.querySelector(`#tabla-existencias tr[data-pieza="${piezaSel}"]`);
    if (tr) {
      const movs = filas('SELECT * FROM movimiento WHERE pieza_codigo=? ORDER BY fecha_efectiva, signo DESC, codigo', [piezaSel]);
      let saldo = 0;
      const filasM = movs.map(m => { saldo += m.cantidad * m.signo; return { ...m, saldo, dentro: !corte || m.fecha_efectiva <= corte }; });
      const det = document.createElement('tr'); det.className = 'detalle';
      det.innerHTML = `<td colspan="8"><h4>Movimientos de ${esc(piezaSel)}${corte ? ' (los posteriores al corte aparecen atenuados)' : ''}</h4>
        <div class="tabla-scroll"><table class="tabla" id="tabla-movimientos"><thead><tr><th>Movimiento</th><th>Tipo</th><th>Cantidad</th><th>Saldo físico</th><th>Fecha efectiva</th><th>Registro</th><th>Orden</th><th>Referencia</th><th>Responsable</th></tr></thead><tbody>
        ${filasM.reverse().map(m => `<tr style="${m.dentro ? '' : 'opacity:.45'}"><td>${esc(m.codigo)}</td><td>${esc(m.tipo.replace('_', ' ').toLowerCase())}</td><td class="${claseNum(m.cantidad * m.signo)}">${m.signo < 0 ? '-' : ''}${fmtConteo(m.cantidad)}</td><td class="num"><strong>${fmtConteo(m.saldo)}</strong></td><td>${esc(mostrarFH(m.fecha_efectiva))}</td><td>${esc(mostrarFH(m.fecha_registro))}</td><td>${esc(m.orden_codigo || '')}</td><td>${esc(m.referencia)}</td><td>${esc(m.responsable)}</td></tr>`).join('')}
        </tbody></table></div></td>`;
      tr.after(det);
    }
  }
}

function detalleOrden(codigo, u) {
  const o = filas('SELECT * FROM orden WHERE codigo=?', [codigo])[0];
  const res = filas('SELECT r.*, p.nombre FROM reserva r JOIN pieza p ON p.codigo = r.pieza_codigo WHERE r.orden_codigo=? ORDER BY r.fecha', [codigo]);
  const cons = filas('SELECT c.*, p.nombre FROM consumo c JOIN pieza p ON p.codigo = c.pieza_codigo WHERE c.orden_codigo=? ORDER BY c.fecha_efectiva', [codigo]);
  const ints = filas('SELECT * FROM intervencion WHERE orden_codigo=? ORDER BY inicio', [codigo]);
  const b = (id, t, perm, extra = '') => `<button type="button" class="btn ${extra}" id="${id}" ${op.puede(u, perm) ? '' : `disabled title="Corresponde a ${op.quienPuede(perm)}"`}>${t}</button>`;
  const abierta = o.estado === 'ABIERTA';
  return `<div class="encabezado-vista"><h3 style="margin:0">${esc(o.codigo)} · ${esc(o.descripcion)}</h3>${abierta ? '<span class="pildora alerta">Abierta</span>' : '<span class="pildora ok">Cerrada</span>'}</div>
    ${abierta ? `<div class="acciones izq">${b('b-reservar', 'Reservar pieza', 'reservar')}${b('b-entregar', 'Entregar sin reserva', 'consumir')}${b('b-interv', 'Registrar intervención', 'registrar_intervencion')}${b('b-cerrar', 'Cerrar orden', 'cerrar_orden')}</div>` : ''}
    <div class="bloques-detalle">
      <div><h4>Reservas</h4>${res.length ? `<table class="tabla" id="tabla-reservas"><thead><tr><th>Reserva</th><th>Pieza</th><th>Cantidad</th><th>Estado</th><th></th></tr></thead><tbody>
        ${res.map(r => `<tr><td>${esc(r.codigo)}</td><td>${esc(r.pieza_codigo)} ${esc(r.nombre)}</td><td class="num">${fmtConteo(r.cantidad)}</td><td>${r.estado === 'VIGENTE' ? '<span class="pildora alerta">Vigente</span>' : r.estado === 'CONSUMIDA' ? '<span class="pildora ok">Entregada</span>' : '<span class="pildora info">Liberada</span>'}</td>
          <td>${r.estado === 'VIGENTE' && abierta ? `<button type="button" class="btn chico principal" data-entregar="${esc(r.codigo)}" ${op.puede(u, 'consumir') ? '' : 'disabled'}>Entregar y consumir</button> <button type="button" class="btn chico" data-liberar="${esc(r.codigo)}" ${op.puede(u, 'liberar_reserva') ? '' : 'disabled'}>Liberar</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Sin reservas.</p>'}</div>
      <div><h4>Entregas (consumos)</h4>${cons.length ? `<table class="tabla" id="tabla-consumos"><thead><tr><th>Consumo</th><th>Pieza</th><th>Cantidad</th><th>Entrega</th><th>Movimiento</th><th>Reserva</th></tr></thead><tbody>
        ${cons.map(x => `<tr><td>${esc(x.codigo)}</td><td>${esc(x.pieza_codigo)} ${esc(x.nombre)}</td><td class="num">${fmtConteo(x.cantidad)}</td><td>${esc(mostrarFH(x.fecha_efectiva))}</td><td>${esc(x.movimiento_codigo)}</td><td>${esc(x.reserva_codigo || '—')}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Sin entregas.</p>'}
      <h4>Intervenciones</h4>${ints.length ? `<table class="tabla"><tbody>${ints.map(i => `<tr><td>${esc(i.codigo)}</td><td>${esc(mostrarFH(i.inicio))}</td><td>${esc(i.tecnico)}</td><td>${i.requirio_pieza ? 'Requirió ' + esc(i.pieza_codigo) : 'Sin pieza'}</td><td>${esc(i.descripcion)}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Sin intervenciones.</p>'}</div>
    </div>`;
}

const opcionesPieza = () => filas('SELECT codigo, nombre FROM pieza ORDER BY codigo').map(p => {
  const e = op.existencia(p.codigo);
  return [p.codigo, `${p.codigo} · ${p.nombre} · disponible ${e.disponible}`];
});

// Entrega con identificador de operación: el aviso ofrece «Reintentar envío» con el mismo identificador para comprobar que no se duplica.
async function entregar(ctx, datos) {
  const opId = op.nuevoOpId();
  const enviar = () => ctx.operar(op.consumirPieza, { ...datos, op_id: opId }, {
    ok: r => `Entrega ${r.codigo} registrada: físico ${r.fisico}, reservado ${r.reservado}, disponible ${r.disponible}.`, motivo: 'Entrega ' + datos.orden,
  });
  const r = await enviar();
  if (r && !r.repetida) aviso('Si duda de que la entrega se haya registrado, puede reenviar la misma operación: no se duplicará.', 'info', { texto: 'Reintentar envío', fn: () => enviar() });
}

function enlazarOrden(det, codigo, ctx) {
  const on = (id, f) => { const b = det.querySelector('#' + id); if (b) b.onclick = e => { e.stopPropagation(); f(); }; };
  on('b-reservar', async () => {
    const v = await formulario({ titulo: `Reservar pieza · ${codigo}`, campos: [{ id: 'pieza', etiqueta: 'Pieza', tipo: 'select', opciones: opcionesPieza() }, { id: 'cantidad', etiqueta: 'Cantidad', tipo: 'numero', valor: 1 }] });
    if (v) await ctx.operar(op.reservarPieza, { orden: codigo, ...v }, { ok: r => `Reserva ${r.codigo} registrada.`, motivo: 'Reservar ' + codigo });
  });
  on('b-entregar', async () => {
    const v = await formulario({ titulo: `Entregar sin reserva · ${codigo}`, campos: [{ id: 'pieza', etiqueta: 'Pieza', tipo: 'select', opciones: opcionesPieza() }, { id: 'cantidad', etiqueta: 'Cantidad', tipo: 'numero', valor: 1 }, { id: 'fecha_efectiva', etiqueta: 'Fecha y hora de entrega', tipo: 'fechahora', valor: ahoraLocalInput() }] });
    if (v) await entregar(ctx, { orden: codigo, ...v });
  });
  det.querySelectorAll('[data-entregar]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const r = filas('SELECT * FROM reserva WHERE codigo=?', [b.dataset.entregar])[0];
    const ex = op.existencia(r.pieza_codigo);
    const v = await formulario({
      titulo: `Entregar y consumir · ${r.codigo}`, intro: `<p>Pieza <strong>${esc(r.pieza_codigo)}</strong>: físico ${ex.fisico}, reservado ${ex.reservado}, disponible ${ex.disponible}. Al confirmar se descuenta del físico y se libera la reserva en la misma operación.</p>`,
      campos: [{ id: 'cantidad', etiqueta: 'Cantidad entregada', tipo: 'numero', valor: r.cantidad }, { id: 'fecha_efectiva', etiqueta: 'Fecha y hora de entrega', tipo: 'fechahora', valor: ahoraLocalInput() }],
      textoOk: 'Confirmar entrega',
    });
    if (v) await entregar(ctx, { orden: codigo, pieza: r.pieza_codigo, reserva: r.codigo, ...v });
  });
  det.querySelectorAll('[data-liberar]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    await ctx.operar(op.liberarReserva, { reserva: b.dataset.liberar }, { ok: 'Reserva liberada.', motivo: 'Liberar reserva' });
  });
  on('b-interv', async () => {
    const v = await formulario({
      titulo: `Registrar intervención · ${codigo}`,
      campos: [
        { id: 'inicio', etiqueta: 'Inicio', tipo: 'fechahora', valor: ahoraLocalInput() }, { id: 'fin', etiqueta: 'Fin (opcional)', tipo: 'fechahora' },
        { id: 'descripcion', etiqueta: 'Trabajo realizado', tipo: 'texto' },
        { id: 'requirio_pieza', etiqueta: 'Pieza', tipo: 'casilla', texto: 'La intervención requirió una pieza' },
        { id: 'pieza', etiqueta: 'Pieza requerida', tipo: 'select', opciones: [['', '—']].concat(filas('SELECT codigo, nombre FROM pieza ORDER BY codigo').map(p => [p.codigo, `${p.codigo} · ${p.nombre}`])) },
      ],
    });
    if (v) await ctx.operar(op.registrarIntervencion, { orden: codigo, ...v }, { ok: r => `Intervención ${r.codigo} registrada.`, motivo: 'Intervención ' + codigo });
  });
  on('b-cerrar', async () => { await ctx.operar(op.cerrarOrden, { orden: codigo }, { ok: `Orden ${codigo} cerrada.`, motivo: 'Cerrar orden ' + codigo }); });
}

async function ingreso(ctx) {
  const v = await formulario({
    titulo: 'Registrar ingreso de pieza',
    campos: [{ id: 'pieza', etiqueta: 'Pieza', tipo: 'select', opciones: opcionesPieza() }, { id: 'cantidad', etiqueta: 'Cantidad', tipo: 'numero', valor: 1 },
      { id: 'fecha_efectiva', etiqueta: 'Fecha y hora de recepción', tipo: 'fechahora', valor: ahoraLocalInput() }, { id: 'referencia', etiqueta: 'Guía o comprobante', tipo: 'texto' }],
  });
  if (v) await ctx.operar(op.registrarIngreso, { ...v, op_id: op.nuevoOpId() }, { ok: r => `Ingreso ${r.codigo} registrado.`, motivo: 'Ingreso ' + v.pieza });
}
