// Pantalla «Usuarios»: cada persona con su responsabilidad y su PIN. Administra el Responsable de mantenimiento.
import { filas } from '../nucleo/bd.js';
import { mostrarFH } from '../nucleo/fechas.js';
import { fmtConteo, esc } from '../nucleo/formato.js';
import * as op from '../nucleo/operaciones.js';
import { formulario } from './dom.js';

const OPC_ROL = [['PRODUCCION', 'Producción'], ['MANTENIMIENTO', 'Mantenimiento'], ['ALMACEN', 'Almacén'], ['RESP_MANTENIMIENTO', 'Responsable de mantenimiento']];
const QUE_HACE = {
  PRODUCCION: 'Registra la parada y verifica el retorno al servicio.',
  MANTENIMIENTO: 'Cambia tramos, diagnostica, abre órdenes, registra intervenciones y preventivos.',
  ALMACEN: 'Reserva, entrega y recibe piezas.',
  RESP_MANTENIMIENTO: 'Todo lo de Mantenimiento, decide acciones y administra usuarios.',
  EVALUACION: 'Todos los permisos (solo modo demostración).',
};

export async function vistaUsuarios(c, ctx) {
  const u = ctx.usuario();
  const puede = op.puede(u, 'gestionar_usuarios');
  const us = filas("SELECT * FROM usuario ORDER BY CASE rol WHEN 'EVALUACION' THEN 9 ELSE 0 END, activo DESC, rol, nombre");
  const evs = filas("SELECT * FROM evento WHERE tipo IN ('CREAR_USUARIO','EDITAR_USUARIO','CAMBIAR_PIN','ACTIVAR_USUARIO','DESACTIVAR_USUARIO') ORDER BY id DESC LIMIT 15");
  const dis = puede ? '' : `disabled title="Corresponde a ${op.quienPuede('gestionar_usuarios')}"`;
  c.innerHTML = `<div class="pila">
    <section class="tarjeta encabezado-vista"><h1>Usuarios</h1>
      <div class="acciones"><button type="button" class="btn principal grande" id="b-nuevo-usuario" ${dis}>Nuevo usuario</button></div></section>
    ${puede ? '' : `<div class="aviso alerta"><span>Solo el ${esc(op.quienPuede('gestionar_usuarios'))} puede crear o modificar usuarios. Usted puede consultar la lista.</span></div>`}
    <section class="tarjeta"><h2>Personas y responsabilidades</h2>
      <div class="kpis">${OPC_ROL.map(([r, t]) => `<div class="kpi"><span>${t}</span><strong>${fmtConteo(us.filter(x => x.rol === r && x.activo).length)}</strong><small>activos</small></div>`).join('')}</div>
      <div class="tabla-centro" style="margin-top:12px"><table class="tabla" id="tabla-usuarios"><thead><tr><th>Código</th><th>Nombre</th><th>Responsabilidad</th><th>Qué puede hacer</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      ${us.map(x => `<tr data-usuario="${esc(x.codigo)}" data-activo="${x.activo}"><td>${esc(x.codigo)}</td><td><strong>${esc(x.nombre)}</strong>${x.codigo === u.codigo ? ' <span class="subtexto">(usted)</span>' : ''}</td><td>${esc(op.ROLES[x.rol])}</td><td class="subtexto">${esc(QUE_HACE[x.rol])}</td>
        <td>${x.rol === 'EVALUACION' ? '<span class="pildora info">Solo demostración</span>' : x.activo ? '<span class="pildora ok">Activo</span>' : '<span class="pildora error">Inactivo</span>'}</td>
        <td class="nw">${x.rol === 'EVALUACION' ? '' : `<button type="button" class="btn chico" data-editar="${esc(x.codigo)}" ${dis}>Editar</button> <button type="button" class="btn chico" data-pin="${esc(x.codigo)}" ${dis}>Cambiar PIN</button> <button type="button" class="btn chico${x.activo ? '' : ' principal'}" data-estado="${esc(x.codigo)}" ${dis}>${x.activo ? 'Desactivar' : 'Activar'}</button>`}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="subtexto centro">El PIN se guarda cifrado (hash con sal); nadie puede verlo. Un usuario inactivo no puede ingresar, pero sus registros anteriores se conservan con su nombre.</p></section>
    <section class="tarjeta"><h2>Cambios recientes de usuarios</h2>
      ${evs.length ? `<table class="tabla ajustada"><thead><tr><th>Fecha y hora</th><th>Cambio</th><th>Usuario afectado</th><th>Detalle</th><th>Hecho por</th></tr></thead><tbody>
      ${evs.map(e => `<tr><td class="nw">${esc(mostrarFH(e.instante))}</td><td>${esc(e.tipo.replace(/_/g, ' ').toLowerCase())}</td><td>${esc(e.referencia)}</td><td>${esc(e.detalle)}</td><td>${esc(e.usuario)}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio centro">Sin cambios registrados.</p>'}
    </section></div>`;
  const pinCampos = [{ id: 'pin', etiqueta: 'PIN (4 dígitos)', tipo: 'texto' }, { id: 'pin2', etiqueta: 'Repetir PIN', tipo: 'texto' }];
  const validarPin = v => (/^\d{4}$/.test(v.pin) ? (v.pin === v.pin2 ? null : 'La confirmación del PIN no coincide.') : 'El PIN debe tener exactamente 4 dígitos.');
  c.querySelector('#b-nuevo-usuario').onclick = async () => {
    const v = await formulario({
      titulo: 'Nuevo usuario', intro: '<p>Registre a la persona con su responsabilidad. Entregue el PIN solo a esa persona.</p>',
      campos: [{ id: 'nombre', etiqueta: 'Nombre y apellido', tipo: 'texto' }, { id: 'rol', etiqueta: 'Responsabilidad', tipo: 'select', opciones: OPC_ROL }, ...pinCampos],
      validar: v => (v.nombre.trim().length < 3 ? 'Escriba el nombre de la persona.' : validarPin(v)), textoOk: 'Crear usuario',
    });
    if (v) await ctx.operar(op.crearUsuario, v, { ok: r => `Usuario ${r.codigo} creado: ${r.nombre}. Ya puede ingresar con su PIN.`, motivo: 'Crear usuario' });
  };
  c.querySelectorAll('[data-editar]').forEach(b => b.onclick = async () => {
    const x = us.find(y => y.codigo === b.dataset.editar);
    const v = await formulario({ titulo: `Editar usuario · ${x.codigo}`, campos: [{ id: 'nombre', etiqueta: 'Nombre y apellido', tipo: 'texto', valor: x.nombre }, { id: 'rol', etiqueta: 'Responsabilidad', tipo: 'select', opciones: OPC_ROL, valor: x.rol }], textoOk: 'Guardar cambios' });
    if (v) await ctx.operar(op.editarUsuario, { codigo: x.codigo, ...v }, { ok: 'Usuario actualizado.', motivo: 'Editar usuario ' + x.codigo });
  });
  c.querySelectorAll('[data-pin]').forEach(b => b.onclick = async () => {
    const x = us.find(y => y.codigo === b.dataset.pin);
    const v = await formulario({ titulo: `Cambiar PIN · ${x.nombre}`, campos: pinCampos, validar: validarPin, textoOk: 'Cambiar PIN' });
    if (v) await ctx.operar(op.cambiarPin, { codigo: x.codigo, ...v }, { ok: `PIN de ${x.nombre} cambiado.`, motivo: 'Cambiar PIN ' + x.codigo });
  });
  c.querySelectorAll('[data-estado]').forEach(b => b.onclick = async () => {
    const x = us.find(y => y.codigo === b.dataset.estado);
    await ctx.operar(op.cambiarEstadoUsuario, { codigo: x.codigo, activo: !x.activo }, { ok: `Usuario ${x.nombre} ${x.activo ? 'desactivado' : 'activado'}.`, motivo: 'Estado de usuario ' + x.codigo });
  });
}
