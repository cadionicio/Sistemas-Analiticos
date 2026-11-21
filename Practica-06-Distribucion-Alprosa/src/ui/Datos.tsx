import { useMemo, useState } from 'react';
import { useApp, Pestanas, BotonAccion, Campo, Panel, useFiltro, errores, leerDecimal, formulario } from './comunes';
import { D, P, S, Q, T, BUILD } from './servicio';
import type { ErrorCarga } from '../core/contrato';
import { descargar } from '../platform/almacen';
import { fmtFecha, fmtNum } from '../core/util';

type Sub = 'carga' | 'maestros' | 'usuarios' | 'parametros' | 'respaldo' | 'estado' | 'clima' | 'diagnostico';

export function Datos() {
  const { svc, usuario } = useApp();
  const items = ([['carga', 'Carga de datos'], ['maestros', 'Maestros'], ['usuarios', 'Usuarios y roles'], ['parametros', 'Parámetros'], ['respaldo', 'Respaldo y continuidad'], ['estado', 'Estado del sistema'], ['clima', 'Clima (internet)'], ['diagnostico', 'Diagnóstico']] as [Sub, string][])
    .map(([id, nombre]) => ({ id, nombre, oculto: !svc.ve(usuario, `datos.${id}`) || (id === 'clima' && !svc.almacen.clima) }));
  const [elegida, setSub] = useState<Sub>(items.find((i) => !i.oculto)?.id ?? 'diagnostico');
  const sub = items.find((i) => i.id === elegida && !i.oculto) ? elegida : items.find((i) => !i.oculto)?.id ?? 'diagnostico';
  return (
    <section>
      <Pestanas etiqueta="Datos" actual={sub} cambiar={setSub} items={items} />
      {sub === 'carga' && <Carga />}
      {sub === 'maestros' && <Maestros />}
      {sub === 'usuarios' && <Usuarios />}
      {sub === 'parametros' && <Parametros />}
      {sub === 'respaldo' && <Respaldo />}
      {sub === 'estado' && <Estado />}
      {sub === 'clima' && <Clima />}
      {sub === 'diagnostico' && <Diagnostico />}
      <p className="pie">Versión {BUILD} · Modalidad {svc.almacen.modalidad} · Conjunto {svc.meta('dataset_id') ?? '—'}</p>
    </section>
  );
}

export function elegirArchivo(accept: string, fn: (nombre: string, buf: ArrayBuffer) => void) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept;
  inp.onchange = async () => { const f = inp.files?.[0]; if (f) fn(f.name, await f.arrayBuffer()); };
  inp.click();
}

function Carga() {
  const { svc, usuario, accion, aviso } = useApp();
  const [err, setErr] = useState<ErrorCarga[]>([]);
  const [adv, setAdv] = useState<string[]>([]);
  const cargas = svc.repo.todos('SELECT * FROM carga ORDER BY registrado_en DESC LIMIT 10');
  const resultado = (r: { estado: string; detalle: string; errores: ErrorCarga[]; advertencias: string[]; hash: string }, nombre: string) => {
    setErr(r.errores); setAdv(r.advertencias);
    aviso(r.estado === 'RECHAZADO' ? 'error' : r.estado === 'YA_CARGADO' ? 'info' : 'ok', `${nombre} (SHA-256 ${r.hash.slice(0, 16)}…): ${r.detalle}`);
  };
  return (
    <>
      <div className="grupo">
        <h2>Cargar datos</h2>
        <p className="nota">La carga reemplaza los datos de negocio actuales (antes se guarda una copia). Si hay un solo error no se cambia nada y se listan todos los errores por hoja y celda.</p>
        <div className="botonera">
          <BotonAccion primario permiso="CARGAR_DATOS" onClick={async () => {
            if (svc.hayDatos() && !(await formulario('Cargar demostración', [{ id: 'ok', tipo: 'opcion', etiqueta: '¿Qué desea hacer?', inicial: 'si', opciones: [{ valor: 'si', texto: 'Reemplazar los datos actuales por la demostración NutriDemo', detalle: 'Antes se guarda una copia de los datos actuales.' }] }], { aceptar: 'Cargar' }))) return;
            accion(async () => { resultado(await svc.cargarDemostracion(usuario), 'Demostración'); }); }}>Cargar demostración</BotonAccion>
          <BotonAccion permiso="CARGAR_DATOS" onClick={() => elegirArchivo('.xlsx', async (n, b) => {
            if (svc.hayDatos() && !(await formulario(`Cargar «${n}»`, [{ id: 'ok', tipo: 'opcion', etiqueta: '¿Qué desea hacer?', inicial: 'si', opciones: [{ valor: 'si', texto: 'Validar y, si es válido, reemplazar los datos actuales', detalle: 'Se guarda una copia previa. Si el archivo tiene errores, no cambia nada.' }] }], { explicacion: 'Si tiene un formulario abierto con cambios sin guardar, ciérrelo antes: la carga reemplaza todo el conjunto.', aceptar: 'Cargar' }))) return;
            accion(async () => { resultado(await svc.cargarArchivo(n, b, usuario), n); }); })}>Cargar Excel</BotonAccion>
          <button onClick={() => accion(async () => svc.plantilla())}>Descargar plantilla</button>
        </div>
      </div>
      {svc.hayDatos() && <div className="grupo">
        <h2>Recorrido operativo de demostración</h2>
        <p className="nota">Ejecuta con las reglas normales un día de operación sobre 6 pedidos de la demostración: reserva, itinerario, despacho, recepción en nodos, entrega, un rechazo parcial con retorno, una incidencia, un cargo, retornables y un conteo. Cada paso lo firma el rol que corresponde. Sirve para que «Excel 07 – Resultados del sistema» tenga operación real.</p>
        {svc.puedeRecorrer().ok
          ? <BotonAccion permiso="CARGAR_DATOS" onClick={async () => {
              if (!(await formulario('Recorrido operativo de demostración', [{ id: 'ok', tipo: 'opcion', etiqueta: '¿Qué desea hacer?', inicial: 'si', opciones: [{ valor: 'si', texto: 'Ejecutar el recorrido sobre 6 pedidos', detalle: 'Queda registrado en la bitácora y en Estado del sistema. Solo se puede hacer una vez por carga.' }] }], { aceptar: 'Ejecutar' }))) return;
              accion(async () => { const r = await svc.recorridoDemostracion(usuario); return r; }, 'Recorrido terminado: revise Operación, Planificación y entregas, y Resultados.');
            }}>Ejecutar recorrido de demostración</BotonAccion>
          : <p className="nota">No disponible: {svc.puedeRecorrer().motivo}</p>}
      </div>}
      {adv.length > 0 && <div className="alerta-suave">{adv.map((a, i) => <div key={i}>Advertencia: {a}</div>)}</div>}
      {err.length > 0 && (
        <div className="errores">
          <h3>{err.length} error(es) — no se cambió ningún dato</h3>
          <button onClick={() => descargar('Errores_de_carga.csv', '﻿hoja;celda;fila;columna;valor;mensaje\n' + err.map((e) => [e.hoja, e.celda, e.fila, e.columna, e.valor, e.mensaje].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv')}>Descargar detalle de errores</button>
          <table><thead><tr><th>Hoja</th><th>Celda</th><th>Fila</th><th>Columna</th><th>Valor</th><th>Mensaje</th></tr></thead>
            <tbody>{err.slice(0, 300).map((e, i) => <tr key={i}><td>{e.hoja}</td><td>{e.celda}</td><td>{e.fila}</td><td>{e.columna}</td><td>{e.valor}</td><td>{e.mensaje}</td></tr>)}</tbody></table>
        </div>
      )}
      <h2>Últimas cargas</h2>
      <table><thead><tr><th>Fecha</th><th>Archivo</th><th>SHA-256</th><th>Conjunto</th><th>Usuario</th></tr></thead>
        <tbody>{cargas.map((c) => <tr key={String(c.carga_id)}><td>{fmtFecha(String(c.registrado_en))} {String(c.registrado_en).slice(11, 16)}</td><td>{String(c.nombre_archivo)}</td><td className="mono">{String(c.file_hash).slice(0, 16)}…</td><td>{String(c.dataset_id)}</td><td>{String(c.usuario_id ?? '')}</td></tr>)}</tbody></table>
    </>
  );
}

const ENTIDADES: { id: keyof typeof D.MAESTROS; nombre: string }[] = [
  { id: 'producto', nombre: 'Productos' }, { id: 'presentacion', nombre: 'Presentaciones' }, { id: 'cliente', nombre: 'Clientes' },
  { id: 'destino', nombre: 'Destinos' }, { id: 'nodo', nombre: 'Nodos logísticos' }, { id: 'lote', nombre: 'Lotes' }];
const ETIQ: Record<string, string> = {
  producto_id: 'Código', nombre_generico: 'Nombre genérico', familia: 'Familia', unidad_base: 'Unidad base', peso_kg_por_unidad_mil: 'Peso kg por unidad', vol_cm3_por_unidad: 'Volumen cm³ por unidad',
  fraccionable: 'Fraccionable', activo: 'Activo', presentacion_id: 'Código', nombre: 'Nombre', factor_base_mil: 'Unidades base por presentación', cliente_id: 'Cliente', nombre_ficticio: 'Nombre (ficticio)',
  nodo_id: 'Nodo', tipo: 'Tipo', region: 'Región', capacidad_almacen_kg_mil: 'Capacidad de almacén (kg)', permite_espera_nocturna: 'Permite espera nocturna', destino_id: 'Código',
  codigo_territorial: 'Código territorial (texto)', catalogo_territorial: 'Catálogo territorial', version_catalogo: 'Versión de catálogo', latitud: 'Latitud', longitud: 'Longitud',
  precision_geografica: 'Precisión geográfica', acepta_anticipadas: 'Acepta entregas anticipadas', vida_util_min_dias: 'Vida útil mínima (días)', lote_id: 'Código', codigo_lote: 'Código de partida',
  fecha_fabricacion: 'Fabricación (AAAA-MM-DD)', fecha_vencimiento: 'Vencimiento (AAAA-MM-DD)', estado_lote: 'Estado del lote',
};

function Maestros() {
  const { svc, usuario, accion, ver } = useApp();
  const [ent, setEnt] = useState<keyof typeof D.MAESTROS>('producto');
  const def = D.MAESTROS[ent];
  const filas = useMemo(() => svc.repo.todos(`SELECT * FROM ${def.tabla} ORDER BY ${def.pk}`), [svc, ver, ent]);
  const f = useFiltro(filas, (r) => Object.values(r).join(' '));
  const [editar, setEditar] = useState<Record<string, unknown> | 'nuevo' | null>(null);
  const cols = def.campos.map((c) => c.col);
  const mostrar = (c: (typeof def.campos)[number], v: unknown) => v === null || v === undefined ? '—' : c.tipo === 'bool' ? (v ? 'Sí' : 'No') : c.tipo === 'mil' ? fmtNum(Number(v) / 1000, 3) : c.tipo === 'entero' ? fmtNum(Number(v), 0) : String(v);
  return (
    <>
      <div className="barra">
        <label className="filtro">Maestro <select value={ent} onChange={(e) => { setEnt(e.target.value as keyof typeof D.MAESTROS); setEditar(null); }}>{ENTIDADES.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
        {f.caja}
        <BotonAccion primario permiso="EDITAR_MAESTROS" onClick={() => setEditar('nuevo')}>Nuevo</BotonAccion>
        <span className="nota">{f.filas.length} de {filas.length}</span>
      </div>
      <table>
        <thead><tr>{def.campos.map((c) => <th key={c.col} className={['mil', 'entero', 'real'].includes(c.tipo) ? 'num' : ''}>{ETIQ[c.col] ?? c.col}</th>)}{ent === 'destino' && <th>Verificación territorial</th>}<th>Acciones</th></tr></thead>
        <tbody>{f.filas.map((r) => (
          <tr key={String(r[def.pk])} className={r.activo === 0 ? 'inactiva' : ''}>
            {def.campos.map((c) => <td key={c.col} className={['mil', 'entero', 'real'].includes(c.tipo) ? 'num' : ''}>{mostrar(c, r[c.col])}</td>)}
            {ent === 'destino' && <td title={D.verificacionTerritorial(svc.repo, String(r.destino_id)).detalle}>{D.verificacionTerritorial(svc.repo, String(r.destino_id)).estado}</td>}
            <td className="acciones">
              <BotonAccion permiso="EDITAR_MAESTROS" onClick={() => setEditar(r)}>Editar</BotonAccion>
              {'activo' in r && ent !== 'lote' && <BotonAccion permiso="EDITAR_MAESTROS" onClick={() => accion(async () => { await svc.op('activo maestro', () => D.cambiarActivo(svc.repo, usuario, ent as 'producto', String(r[def.pk]), r.activo !== 1)); }, r.activo === 1 ? 'Inactivado: ya no se puede elegir en operaciones nuevas; las existentes continúan.' : 'Reactivado.')}>{r.activo === 1 ? 'Inactivar' : 'Reactivar'}</BotonAccion>}
            </td>
          </tr>
        ))}</tbody>
      </table>
      {f.vacio}
      {editar && <FormMaestro ent={ent} inicial={editar === 'nuevo' ? null : editar} cols={cols} cerrar={() => setEditar(null)} />}
    </>
  );
}

function FormMaestro({ ent, inicial, cols, cerrar }: { ent: keyof typeof D.MAESTROS; inicial: Record<string, unknown> | null; cols: string[]; cerrar: () => void }) {
  const { svc, usuario, accion } = useApp();
  const def = D.MAESTROS[ent];
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(def.campos.map((c) => {
    const x = inicial?.[c.col];
    if (x === null || x === undefined) return [c.col, c.tipo === 'bool' ? '1' : ''];
    return [c.col, c.tipo === 'mil' ? fmtNum(Number(x) / 1000, 3).replace(/\./g, '') : String(x)];
  })));
  const [err, setErr] = useState<Record<string, string>>({});
  const opciones = (col: string) => col === 'producto_id' ? svc.repo.todos('SELECT producto_id k FROM producto ORDER BY 1') : col === 'cliente_id' ? svc.repo.todos('SELECT cliente_id k FROM cliente ORDER BY 1') : col === 'nodo_id' && ent === 'destino' ? svc.repo.todos("SELECT nodo_id k FROM nodo ORDER BY 1") : null;
  const guardar = () => accion(async () => {
    const datos: Record<string, unknown> = {}; const e: Record<string, string> = {};
    for (const c of def.campos) {
      const t = v[c.col] ?? '';
      if (c.tipo === 'mil') { const n = leerDecimal(t, 3); if (Number.isNaN(n)) e[c.col] = 'Número inválido (coma decimal, hasta 3 decimales).'; datos[c.col] = n === null ? null : Math.round(Number(n) * 1000); }
      else if (c.tipo === 'entero') { datos[c.col] = t.trim() === '' ? null : /^-?\d+$/.test(t.trim()) ? Number(t) : NaN; }
      else if (c.tipo === 'real') { const n = leerDecimal(t, 8); if (Number.isNaN(n)) e[c.col] = 'Número inválido.'; datos[c.col] = n; }
      else if (c.tipo === 'bool') datos[c.col] = t === '1' ? 1 : 0;
      else datos[c.col] = t;
    }
    if (Object.keys(e).length) { setErr(e); throw new Error('Revise los campos marcados.'); }
    try { await svc.op('maestro', () => D.guardarMaestro(svc.repo, usuario, ent, datos, inicial ? 'edicion' : 'alta')); cerrar(); }
    catch (ex) { const c = errores(ex); setErr(c ?? {}); if (c) throw new Error(`Revise los ${Object.keys(c).length} campo(s) marcados en el formulario.`); throw ex; }
  }, inicial ? 'Cambios guardados; las operaciones confirmadas conservan sus datos originales.' : 'Registro creado.');
  return (
    <Panel titulo={(inicial ? 'Editar ' : 'Alta de ') + ({ producto: 'producto', presentacion: 'presentación', cliente: 'cliente', destino: 'destino', nodo: 'nodo logístico', lote: 'lote' } as Record<string, string>)[ent]} cerrar={cerrar}>
      <div className="formulario">
        {def.campos.filter((c) => cols.includes(c.col)).map((c) => {
          const ops = c.col === def.pk ? null : opciones(c.col);
          return (
            <Campo key={c.col} etiqueta={(ETIQ[c.col] ?? c.col) + (c.obligatorio ? ' *' : '')} error={err[c.col]}>
              {c.tipo === 'bool' ? <select value={v[c.col]} onChange={(e) => setV({ ...v, [c.col]: e.target.value })}><option value="1">Sí</option><option value="0">No</option></select>
                : c.tipo === 'enum' ? <select value={v[c.col]} onChange={(e) => setV({ ...v, [c.col]: e.target.value })}><option value="">Seleccione…</option>{c.valores!.map((o) => <option key={o}>{o}</option>)}</select>
                  : ops ? <select value={v[c.col]} onChange={(e) => setV({ ...v, [c.col]: e.target.value })}><option value="">Seleccione…</option>{ops.map((o) => <option key={String(o.k)}>{String(o.k)}</option>)}</select>
                    : <input value={v[c.col]} disabled={!!inicial && c.col === def.pk} onChange={(e) => setV({ ...v, [c.col]: e.target.value })} />}
            </Campo>
          );
        })}
      </div>
      {ent === 'destino' && inicial && <p className="nota">Para un cambio administrativo de código sin mudanza use «Recodificar»: conserva el código anterior como alias.
        <button className="mini" onClick={async () => { const f = await formulario('Recodificar destino', [{ id: 'c', tipo: 'texto', etiqueta: 'Nuevo código territorial', ejemplo: '040101', minLargo: 2 }, { id: 'm', tipo: 'motivo', etiqueta: 'Motivo', opciones: ['Cambio del catálogo oficial', 'Corrección de un código mal registrado', 'Fusión o división territorial'] }], { explicacion: 'El código anterior se conserva como alias histórico.', aceptar: 'Recodificar' }); if (!f) return; accion(async () => { await svc.op('recodificar', () => D.cambiarCodigoTerritorial(svc.repo, usuario, String(inicial.destino_id), f.c, String(inicial.catalogo_territorial ?? 'CAT-FICTICIO-NUTRIDEMO'), String(inicial.version_catalogo ?? ''), f.m)); cerrar(); }, 'Código actualizado; el anterior queda como alias histórico.'); }}>Recodificar</button></p>}
      <div className="botonera"><BotonAccion primario permiso="EDITAR_MAESTROS" onClick={guardar}>Guardar</BotonAccion><button onClick={cerrar}>Cancelar</button></div>
    </Panel>
  );
}

function Usuarios() {
  const { svc, usuario, accion, ver } = useApp();
  const us = useMemo(() => svc.usuarios(), [svc, ver]);
  const asign = useMemo(() => svc.repo.todos('SELECT * FROM rol_asignacion ORDER BY usuario_id, vigente_desde'), [svc, ver]);
  const [nuevoRol, setNuevoRol] = useState({ usuario_id: '', rol: 'ENCARGADO_PEDIDOS', desde: '', hasta: '' });
  return (
    <>
      <p className="nota">Perfiles funcionales de demostración: definen qué puede confirmar cada persona ficticia. No es una autenticación empresarial ni protege frente al administrador del equipo.</p>
      <table><thead><tr><th>Usuario</th><th>Nombre</th><th>Estado</th><th>Roles vigentes</th><th>Acciones</th></tr></thead>
        <tbody>{us.map((u) => (
          <tr key={String(u.usuario_id)} className={u.activo === 0 ? 'inactiva' : ''}><td>{String(u.usuario_id)}</td><td>{String(u.nombre_ficticio)}{u.compartida ? ' (cuenta compartida)' : ''}</td>
            <td>{u.activo === 1 ? 'Activo' : `Desactivado ${fmtFecha(String(u.desactivado_en))}: ${u.motivo_desactivacion}`}</td><td>{u.roles.map((r) => P.NOMBRE_ROL[r]).join(', ') || '—'}</td>
            <td>{u.activo === 1 && u.usuario_id !== usuario && <BotonAccion permiso="GESTIONAR_USUARIOS" onClick={async () => {
              const f = await formulario(`Desactivar a ${u.nombre_ficticio}`, [{ id: 'm', tipo: 'motivo', etiqueta: 'Motivo', opciones: ['Dejó la empresa', 'Cambio de área', 'Licencia prolongada', 'Cuenta creada por error'] }, { id: 'a', tipo: 'select', etiqueta: 'Sus pedidos abiertos pasan a', opciones: [{ valor: '', texto: 'Nadie: quedan en la cola «sin responsable»' }, ...us.filter((x) => x.activo === 1 && x.usuario_id !== u.usuario_id && x.roles.includes('ENCARGADO_PEDIDOS')).map((x) => ({ valor: String(x.usuario_id), texto: String(x.nombre_ficticio) }))] }], { explicacion: 'Su historia y auditoría se conservan; solo pierde el acceso desde ahora.', aceptar: 'Desactivar' }); if (!f) return;
              const m = f.m, a = f.a;
              accion(async () => { const r = await svc.op('desactivar usuario', () => P.desactivarUsuario(svc.repo, usuario, String(u.usuario_id), m, a.trim() || null)); if (r.pedidosSinResponsable) return (`Usuario desactivado. ${r.pedidosSinResponsable} pedido(s) quedaron sin responsable y aparecen en la cola de Pedidos.`); }, 'Usuario desactivado; su historia se conserva.');
            }}>Desactivar</BotonAccion>}
            {u.activo === 1 && <BotonAccion permiso="GESTIONAR_USUARIOS" onClick={async () => { const f = await formulario(`Restablecer PIN de ${u.nombre_ficticio}`, [{ id: 'p', tipo: 'pin', etiqueta: 'PIN temporal (4 a 8 dígitos)', ayuda: 'Entrégueselo en persona: al ingresar, deberá crear su propio PIN.' }], { aceptar: 'Asignar PIN temporal' }); if (f) accion(async () => { await svc.op('restablecer PIN', () => S.restablecerPin(svc.repo, usuario, String(u.usuario_id), f.p)); }, 'PIN temporal asignado. Al ingresar, la persona deberá crear su propio PIN.'); }}>Restablecer PIN</BotonAccion>}</td></tr>
        ))}</tbody></table>
      <div className="formulario">
        <Campo etiqueta="Usuario"><select value={nuevoRol.usuario_id} onChange={(e) => setNuevoRol({ ...nuevoRol, usuario_id: e.target.value })}><option value="">Seleccione…</option>{us.filter((u) => u.activo === 1).map((u) => <option key={String(u.usuario_id)} value={String(u.usuario_id)}>{String(u.usuario_id)} — {String(u.nombre_ficticio)}</option>)}</select></Campo>
        <Campo etiqueta="Rol"><select value={nuevoRol.rol} onChange={(e) => setNuevoRol({ ...nuevoRol, rol: e.target.value })}>{P.ROLES.map((r) => <option key={r} value={r}>{P.NOMBRE_ROL[r]}</option>)}</select></Campo>
        <Campo etiqueta="Vigente desde"><input type="datetime-local" value={nuevoRol.desde} onChange={(e) => setNuevoRol({ ...nuevoRol, desde: e.target.value })} /></Campo>
        <Campo etiqueta="Vigente hasta (opcional)"><input type="datetime-local" value={nuevoRol.hasta} onChange={(e) => setNuevoRol({ ...nuevoRol, hasta: e.target.value })} /></Campo>
        <BotonAccion permiso="GESTIONAR_USUARIOS" onClick={() => accion(async () => {
          if (!nuevoRol.usuario_id || !nuevoRol.desde) throw new Error('Seleccione usuario y fecha de inicio.');
          await svc.op('otorgar rol', () => P.otorgarRol(svc.repo, usuario, nuevoRol.usuario_id, nuevoRol.rol as P.Rol, nuevoRol.desde + ':00-05:00', nuevoRol.hasta ? nuevoRol.hasta + ':00-05:00' : null));
        }, 'Rol otorgado con su vigencia.')}>Otorgar rol</BotonAccion>
        <BotonAccion permiso="GESTIONAR_USUARIOS" onClick={async () => { const f = await formulario('Nuevo usuario', [{ id: 'n', tipo: 'texto', etiqueta: 'Nombre (ficticio en la demostración)', ejemplo: 'Gina (Almacén Juliaca)', minLargo: 3 }, { id: 'c', tipo: 'opcion', etiqueta: 'Tipo de cuenta', opciones: [{ valor: 'no', texto: 'Personal (una sola persona)', detalle: 'Recomendado' }, { valor: 'si', texto: 'Compartida (mostrador)', detalle: 'No podrá hacer acciones que modifican datos' }] }, { id: 'p', tipo: 'pin', etiqueta: 'PIN temporal (4 a 8 dígitos)', ayuda: 'Al primer ingreso deberá cambiarlo.' }], { explicacion: 'Después de crearlo, asígnele sus roles en la tabla de abajo.', aceptar: 'Crear usuario' }); if (!f) return; accion(async () => { await svc.op('crear usuario', () => { const id = P.crearUsuario(svc.repo, usuario, f.n, f.c === 'si'); S.asegurarCredenciales(svc.repo); S.restablecerPin(svc.repo, usuario, id, f.p); return id; }); }, 'Usuario creado con PIN temporal; asígnele roles.'); }}>Nuevo usuario</BotonAccion>
      </div>
      <h2>Historial de asignaciones</h2>
      <table><thead><tr><th>Usuario</th><th>Rol</th><th>Desde</th><th>Hasta</th><th>Otorgado por</th><th>Acción</th></tr></thead>
        <tbody>{asign.map((a) => (
          <tr key={String(a.asignacion_id)}><td>{String(a.usuario_id)}</td><td>{P.NOMBRE_ROL[a.rol as P.Rol]}</td><td>{String(a.vigente_desde).slice(0, 16).replace('T', ' ')}</td><td>{a.vigente_hasta ? String(a.vigente_hasta).slice(0, 16).replace('T', ' ') : 'sin fin'}</td><td>{String(a.otorgado_por ?? '')}</td>
            <td>{!a.vigente_hasta && <BotonAccion permiso="GESTIONAR_USUARIOS" onClick={() => accion(async () => { await svc.op('revocar rol', () => P.revocarRol(svc.repo, usuario, String(a.asignacion_id), svc.repo.reloj())); }, 'Rol revocado desde ahora; la historia se conserva.')}>Revocar</BotonAccion>}</td></tr>
        ))}</tbody></table>
    </>
  );
}

function Parametros() {
  const { svc, usuario, accion, ver } = useApp();
  const ahora = svc.repo.reloj();
  const ps = useMemo(() => svc.repo.todos('SELECT * FROM parametro p WHERE version = (SELECT MAX(version) FROM parametro q WHERE q.clave = p.clave AND q.vigente_desde <= ?) ORDER BY clave', [ahora]), [svc, ver]);
  const prog = useMemo(() => svc.repo.todos('SELECT * FROM parametro WHERE vigente_desde > ? ORDER BY clave, version', [ahora]), [svc, ver]);
  const hist = useMemo(() => svc.repo.todos('SELECT * FROM parametro ORDER BY clave, version DESC'), [svc, ver]);
  const recursos = useMemo(() => svc.repo.todos('SELECT * FROM recurso WHERE activo = 1 ORDER BY recurso_id'), [svc, ver]);
  const cambiar = async (p: Record<string, unknown>, valorInicial?: string, motivoFijo?: string) => {
    const base = Number(svc.repo.uno('SELECT MAX(version) v FROM parametro WHERE clave = ?', [String(p.clave)])!.v);
    const campoValor = p.tipo === 'booleano'
      ? { id: 'v', tipo: 'select' as const, etiqueta: 'Nuevo valor', inicial: valorInicial ?? String(p.valor), opciones: [{ valor: 'true', texto: 'Sí (activado)' }, { valor: 'false', texto: 'No (desactivado)' }] }
      : { id: 'v', tipo: 'numero' as const, etiqueta: `Nuevo valor (${String(p.unidad)})`, unidad: String(p.unidad), inicial: valorInicial ?? String(p.valor), maxMil: 1e12 };
    const x = await formulario(`Nueva versión de «${String(p.clave)}»`, [campoValor,
      { id: 'd', tipo: 'fecha', etiqueta: 'Vigente desde', inicial: ahora.slice(0, 10), minimo: ahora.slice(0, 10) },
      motivoFijo ? { id: 'm', tipo: 'select' as const, etiqueta: 'Motivo', opciones: [{ valor: motivoFijo, texto: motivoFijo }] } : { id: 'm', tipo: 'motivo' as const, etiqueta: 'Motivo', opciones: ['Ajuste operativo acordado', 'Corrección de un valor erróneo', 'Nueva política de la empresa'] }],
      { explicacion: `Valor vigente: ${String(p.valor)} ${String(p.unidad)} (versión ${base}). Si la fecha es futura, el valor actual sigue rigiendo hasta ese día [desde, siguiente). Las versiones anteriores no se borran.`, aceptar: 'Guardar versión' });
    if (!x) return;
    const valor = p.tipo === 'booleano' ? x.v : String(Math.round(Number(x.v) / 1000));
    const desde = x.d === ahora.slice(0, 10) ? ahora : x.d + 'T00:00:00-05:00';
    accion(async () => { await svc.op('parámetro', () => D.cambiarParametro(svc.repo, usuario, String(p.clave), valor, desde, x.m, base)); return desde > ahora ? `Versión programada: rige desde ${x.d}.` : 'Nueva versión vigente desde ahora; la anterior queda en el historial.'; });
  };
  const anterior = (clave: string, version: number) => svc.repo.uno('SELECT valor FROM parametro WHERE clave = ? AND version < ? ORDER BY version DESC LIMIT 1', [clave, version])?.valor as string | undefined;
  return (
    <>
      <p className="nota">Cada cambio crea una versión con fecha de vigencia y motivo. Para deshacer, «Volver al valor anterior» crea OTRA versión con el valor previo: nada se borra.</p>
      <table><thead><tr><th>Parámetro</th><th>Valor vigente</th><th>Unidad</th><th>Versión</th><th>Desde</th><th>Descripción / motivo</th><th></th></tr></thead>
        <tbody>{ps.map((p) => { const prev = anterior(String(p.clave), Number(p.version)); return <tr key={String(p.clave)}><td>{String(p.clave)}</td><td>{String(p.valor)}</td><td>{String(p.unidad)}</td><td>{String(p.version)}</td><td>{String(p.vigente_desde).slice(0, 10)}</td><td>{String(p.motivo)}</td>
          <td><BotonAccion permiso="EDITAR_PARAMETROS" onClick={() => cambiar(p)}>Cambiar</BotonAccion>{prev !== undefined && <BotonAccion permiso="EDITAR_PARAMETROS" onClick={() => cambiar(p, p.tipo === 'booleano' ? prev : prev, 'Reversión por error operacional')}>Volver al valor anterior ({prev})</BotonAccion>}</td></tr>; })}</tbody></table>
      {prog.length > 0 && <><h2>Versiones programadas (aún no rigen)</h2>
        <table><thead><tr><th>Parámetro</th><th>Versión</th><th>Valor</th><th>Rige desde</th><th>Motivo</th></tr></thead>
          <tbody>{prog.map((p) => <tr key={`${p.clave}-${p.version}`}><td>{String(p.clave)}</td><td>{String(p.version)}</td><td>{String(p.valor)} {String(p.unidad)}</td><td><span className="chip confirmado">Programado</span> {String(p.vigente_desde).slice(0, 10)}</td><td>{String(p.motivo)}</td></tr>)}</tbody></table></>}
      <h2>Capacidad de los recursos de transporte</h2>
      <p className="nota">Antes de activar una capacidad menor se revisan las cargas ya comprometidas (planificadas o en camino). Si alguna la supera, el cambio se bloquea y se listan los servicios y pedidos afectados.</p>
      <table><thead><tr><th>Recurso</th><th>Medio</th><th>Operador</th><th className="num">Capacidad (kg)</th><th></th></tr></thead>
        <tbody>{recursos.map((r) => <tr key={String(r.recurso_id)}><td>{String(r.recurso_id)} — {String(r.nombre)}</td><td>{String(r.modo_id)}</td><td>{String(r.operador)}</td><td className="num">{fmtNum(Number(r.capacidad_kg_mil) / 1000, 0)}</td>
          <td><BotonAccion permiso="EDITAR_MAESTROS" onClick={async () => {
            const x = await formulario(`Capacidad de ${String(r.recurso_id)}`, [{ id: 'v', tipo: 'numero', etiqueta: 'Nueva capacidad (kg)', unidad: 'kg', inicial: String(Number(r.capacidad_kg_mil) / 1000), maxMil: 1e12 },
              { id: 'm', tipo: 'motivo', etiqueta: 'Motivo', opciones: ['Cambio de unidad o vehículo', 'Restricción del operador', 'Corrección de dato'] }], { aceptar: 'Revisar y activar' });
            if (x) accion(async () => { await svc.op('capacidad de recurso', () => T.cambiarCapacidadRecurso(svc.repo, usuario, String(r.recurso_id), Math.round(Number(x.v)), x.m)); return `Capacidad de ${String(r.recurso_id)} actualizada a ${fmtNum(Number(x.v) / 1000, 0)} kg.`; });
          }}>Cambiar capacidad</BotonAccion></td></tr>)}</tbody></table>
      <h2>Historial de versiones</h2>
      <table><thead><tr><th>Parámetro</th><th>Versión</th><th>Valor</th><th>Desde</th><th>Autor</th><th>Motivo</th></tr></thead>
        <tbody>{hist.map((p) => <tr key={`${p.clave}-${p.version}`}><td>{String(p.clave)}</td><td>{String(p.version)}</td><td>{String(p.valor)}</td><td>{String(p.vigente_desde).slice(0, 16).replace('T', ' ')}</td><td>{String(p.autor)}</td><td>{String(p.motivo)}</td></tr>)}</tbody></table>
    </>
  );
}

function Respaldo() {
  const { svc, usuario, accion, aviso, ver } = useApp();
  const ens = useMemo(() => Q.ensayos(svc.repo), [svc, ver]);
  const restaurar = (b: ArrayBuffer) => {
    const p = svc.previsualizarRestauracion(b);
    if (!p.ok) { aviso('error', p.detalle); return; }
    const v = p.vista;
    void (async () => {
      const x = await formulario('Restaurar una copia', [
        { id: 'm', tipo: 'motivo', etiqueta: 'Motivo de la restauración (queda registrado)', opciones: ['Daño o pérdida de datos', 'Volver a un estado de prueba', 'Traslado a otro equipo'] }],
        { explicacion: `Copia válida (última operación registrada: ${v.corteCopia ? v.corteCopia.slice(0, 16).replace('T', ' ') : 'sin operaciones'}). ` +
          v.filas.filter((f) => f.actual || f.copia).map((f) => `${f.tabla}: hoy ${f.actual} → copia ${f.copia}`).join(' · ') +
          (v.perdida ? ` ⚠ Se PERDERÍAN ${v.posteriores} movimiento(s) posteriores a la copia y los registros que hoy superan a la copia. Antes se guarda una copia de los datos actuales.` : ' No se pierden registros.'), aceptar: 'Restaurar' });
      if (x) accion(async () => { const r = await svc.restaurar(usuario, b, x.m); if (!r.ok) throw new Error(r.detalle); return 'Restauración completa. ' + r.detalle; });
    })();
  };
  return (
    <>
      <div className="grupo">
        <h2>Respaldo y restauración</h2>
        <p className="nota">{svc.almacen.descripcion}. «Respaldar» descarga una copia completa (.sqlite) que puede guardar fuera del equipo; «Restaurar» la valida y le muestra qué cambiaría ANTES de reemplazar.</p>
        <div className="botonera">
          <BotonAccion permiso="RESPALDAR" onClick={() => accion(async () => { const r = svc.respaldar(usuario); return `Respaldo descargado: ${r.nombre} (SHA-256 ${r.hash.slice(0, 16)}…)`; })}>Respaldar</BotonAccion>
          <BotonAccion permiso="RESPALDAR" onClick={() => elegirArchivo('.sqlite,.db', (_n, b) => restaurar(b))}>Restaurar</BotonAccion>
          <BotonAccion permiso="RESPALDAR" onClick={() => elegirArchivo('.sqlite,.db', (_n, b) => accion(async () => { const r = await svc.ensayarRestauracion(usuario, b);
            if (!r.ok) throw new Error('Ensayo: copia RECHAZADA. ' + r.detalle);
            return `Ensayo de restauración: ${(r.ms / 1000).toFixed(2)} s (meta RTO ${r.rto_meta_s} s: ${r.cumple_rto ? 'cumple' : 'NO cumple'}); antigüedad de la copia ${r.rpo_h === null ? 'N/D' : r.rpo_h.toFixed(1) + ' h'} (meta RPO ${r.rpo_meta_h} h: ${r.cumple_rpo === null ? 'N/D' : r.cumple_rpo ? 'cumple' : 'NO cumple'}). No se reemplazó nada.`; }))}>Ensayo de restauración</BotonAccion>
        </div>
      </div>
      <div className="grupo">
        <h2>Portabilidad y soporte</h2>
        <div className="botonera">
          <BotonAccion permiso="RESPALDAR" onClick={() => accion(async () => { const r = svc.descargarPortable(usuario); return `Exportación portable descargada (${Object.keys(r.conteos).length} tablas, SHA-256 ${r.sha256.slice(0, 16)}…). Incluye esquema, unidades, zona horaria, relaciones y conteos; no incluye PIN.`; })}>Exportación portable (JSON)</BotonAccion>
          <BotonAccion permiso="RESPALDAR" onClick={() => accion(async () => { const r = svc.descargarAnonimizada(usuario); return `Copia anonimizada descargada (SHA-256 ${r.hash.slice(0, 16)}…): sin PIN y con receptores y evidencias reemplazados.`; })}>Copia anonimizada para soporte</BotonAccion>
        </div>
      </div>
      <h2>Ensayos de restauración registrados</h2>
      {!ens.length ? <p className="vacio">Aún no hay ensayos. Pulse «Ensayo de restauración» y elija un respaldo.</p> :
        <table><thead><tr><th>Fecha</th><th>Resultado</th><th className="num">Duración</th><th>RTO</th><th className="num">Antigüedad de la copia</th><th>RPO</th><th>Huella</th></tr></thead>
          <tbody>{ens.map((e) => <tr key={String(e.ensayo_id)}><td>{String(e.instante).slice(0, 16).replace('T', ' ')}</td><td>{String(e.resultado)}</td><td className="num">{(Number(e.duracion_ms) / 1000).toFixed(2)} s</td>
            <td>{Number(e.cumple_rto) ? <span className="chip completado">Cumple</span> : <span className="chip atrasado">No cumple</span>} (meta {String(e.rto_meta_s)} s)</td>
            <td className="num">{e.rpo_h === null ? 'N/D' : Number(e.rpo_h).toFixed(1) + ' h'}</td><td>{e.cumple_rpo === null ? 'N/D' : Number(e.cumple_rpo) ? <span className="chip completado">Cumple</span> : <span className="chip atrasado">No cumple</span>} (meta {String(e.rpo_meta_h)} h)</td><td className="mono">{String(e.archivo_hash).slice(0, 12)}</td></tr>)}</tbody></table>}
    </>
  );
}

function Estado() {
  const { svc, ver, accion } = useApp();
  const sal = useMemo(() => svc.salud(), [svc, ver]);
  const evs = useMemo(() => Q.eventosTecnicos(svc.repo), [svc, ver]);
  return (
    <>
      <p className="nota">Cada dimensión se evalúa por separado: que la aplicación funcione no significa que exista una copia recuperable.</p>
      <table><thead><tr><th>Dimensión</th><th>Estado</th><th>Detalle</th></tr></thead>
        <tbody>{sal.map((x) => <tr key={x.dimension}><td>{x.dimension}</td><td>{x.estado === 'OK' ? <span className="chip completado">✓ OK</span> : x.estado === 'AVISO' ? <span className="chip reserva-parcial">! Aviso</span> : <span className="chip atrasado">✖ Falla</span>}</td><td>{x.detalle}</td></tr>)}</tbody></table>
      <div className="botonera"><button onClick={() => svc.descargarDiagnostico()}>Descargar paquete de diagnóstico</button></div>
      <p className="nota">El paquete incluye versión, esquema, migraciones, parámetros, conteos y eventos técnicos; no incluye PIN, nombres de receptores ni evidencias.</p>
      <h2>Eventos técnicos</h2>
      {!evs.length ? <p className="vacio">Sin eventos técnicos registrados.</p> :
        <table><thead><tr><th>Último</th><th>Nivel</th><th>Etapa</th><th>Código</th><th className="num">Veces</th><th>Mensaje</th><th>RUN-ID</th><th>Estado</th><th></th></tr></thead>
          <tbody>{evs.map((e) => <tr key={String(e.evento_id)}><td>{String(e.ultimo_instante).slice(0, 16).replace('T', ' ')}</td><td>{String(e.nivel)}</td><td>{String(e.etapa)}</td><td className="mono">{String(e.codigo)}</td><td className="num">{String(e.ocurrencias)}</td><td>{String(e.mensaje)}</td><td className="mono">{String(e.run_id ?? '—')}</td><td>{String(e.estado)}</td>
            <td>{e.estado === 'ABIERTO' && <button className="mini" onClick={() => accion(async () => { await svc.op('evento técnico', () => Q.resolverEvento(svc.repo, String(e.evento_id))); return 'Evento marcado como resuelto.'; })}>Marcar resuelto</button>}</td></tr>)}</tbody></table>}
      <h2>Versión instalada</h2>
      <p>Build <span className="mono">{BUILD}</span> · {svc.almacen.modalidad} · {svc.almacen.descripcion}</p>
    </>
  );
}

function Diagnostico() {
  const { svc } = useApp();
  const d = D.diagnostico(svc.repo);
  const pend = JSON.parse(svc.meta('pendientes_migracion') ?? '[]') as { entidad: string; id: string; campo: string; regla: string }[];
  return (
    <div className="grupo">
      <h2>Diagnóstico técnico (sin datos comerciales)</h2>
      <p>Esquema de base: v{d.schema} · Integridad: {String(d.integridad)} · Versión del programa: {BUILD} · Modalidad: {svc.almacen.modalidad}</p>
      <p>Migraciones: {d.migraciones.map((m) => `v${m.version} (${String(m.aplicada_en).slice(0, 16).replace('T', ' ')})`).join(', ')}</p>
      <table><thead><tr><th>Tabla</th><th className="num">Registros</th></tr></thead><tbody>{Object.entries(d.conteos).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{fmtNum(v, 0)}</td></tr>)}</tbody></table>
      {pend.length > 0 && <><h3>Datos pendientes declarados por la migración</h3><ul>{pend.map((p, i) => <li key={i}>{p.entidad} {p.id} — {p.campo}: {p.regla}</li>)}</ul></>}
    </div>
  );
}

function Clima() {
  const { svc, accion, aviso, ver } = useApp();
  const destinos = svc.repo.todos("SELECT destino_id, nombre_ficticio, latitud, longitud, precision_geografica FROM destino ORDER BY destino_id");
  const [sel, setSel] = useState('');
  const d = destinos.find((x) => x.destino_id === sel);
  const ref = sel || 'ALM-AQP';
  const historial = useMemo(() => svc.repo.todos('SELECT * FROM lectura_clima ORDER BY consultado_en DESC LIMIT 20'), [svc, ver]);
  const consultar = (forzar: boolean) => accion(async () => {
    const r = await svc.clima(ref, d ? Number(d.latitud) : -16.409, d ? Number(d.longitud) : -71.537, forzar);
    aviso('ok', r.reutilizada ? `Se reutilizó la lectura guardada de ${ref} (vigente hasta ${String(r.lectura.vigente_hasta).slice(11, 16)}); no se consultó internet.` : `Lectura de ${ref} guardada; se muestra en la banda superior.`);
  });
  return (
    <div className="grupo">
      <h2>Consulta meteorológica por coordenadas registradas</h2>
      <p className="nota">Solo en el EXE y con internet (servicio Open-Meteo, lectura). No se envían clientes ni pedidos. Cada lectura se guarda en la base y se reutiliza mientras esté vigente (parámetro clima_vigencia_min); la última se muestra en la banda superior. El clima de un punto no prueba que una vía, río o lago esté transitable.</p>
      <div className="barra">
        <label className="filtro">Punto <select value={sel} onChange={(e) => setSel(e.target.value)}><option value="">ALM-AQP — Almacén principal Arequipa</option>{destinos.map((x) => <option key={String(x.destino_id)} value={String(x.destino_id)} disabled={x.latitud == null}>{String(x.destino_id)} — {String(x.nombre_ficticio)} ({x.latitud == null ? 'sin coordenadas: no se puede consultar' : String(x.precision_geografica).toLowerCase()})</option>)}</select></label>
        <button className="primario" onClick={() => consultar(false)}>Consultar clima</button>
        <button onClick={() => consultar(true)}>Consultar de nuevo (ignorar lectura vigente)</button>
      </div>
      <h2>Lecturas guardadas</h2>
      {!historial.length ? <p className="vacio">Aún no hay lecturas guardadas.</p> : (
        <table><thead><tr><th>Punto</th><th>Hora observada</th><th className="num">Temperatura °C</th><th className="num">Lluvia últimos 15 min (mm)</th><th className="num">Lluvia prevista hoy (mm)</th><th className="num">Prob. lluvia</th><th className="num">Viento km/h</th><th>Consultado</th><th>Vigente hasta</th></tr></thead>
          <tbody>{historial.map((h) => <tr key={String(h.lectura_id)}><td>{String(h.referencia)}</td><td>{String(h.observado_en ?? '—').slice(0, 16).replace('T', ' ')}</td><td className="num">{fmtNum(Number(h.temperatura_c), 1)}</td><td className="num">{fmtNum(Number(h.precipitacion_mm), 1)}</td><td className="num">{h.lluvia_hoy_mm == null ? 'N/D' : fmtNum(Number(h.lluvia_hoy_mm), 1)}</td><td className="num">{h.prob_lluvia_pct == null ? 'N/D' : `${h.prob_lluvia_pct} %`}</td><td className="num">{fmtNum(Number(h.viento_kmh), 1)}</td><td>{String(h.consultado_en).slice(0, 16).replace('T', ' ')}</td><td>{String(h.vigente_hasta).slice(11, 16)}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}
