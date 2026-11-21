import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, Pestanas, BotonAccion, Campo, Panel, useFiltro, aMil, deLocal, errores, leerDecimal, claseEstado, LeyendaEstados, formulario } from './comunes';
import { D } from './servicio';
import { fmtMil, fmtFecha, fmtSoles, fmtNum } from '../core/util';

type Sub = 'pedidos' | 'inventario' | 'disponibilidad' | 'ajustes';

export function Operacion() {
  const { svc, usuario } = useApp();
  const items = ([['pedidos', 'Pedidos'], ['inventario', 'Inventario y traslados'], ['disponibilidad', 'Disponibilidad y propuestas'], ['ajustes', 'Ajustes de inventario']] as [Sub, string][])
    .map(([id, nombre]) => ({ id, nombre, oculto: !svc.ve(usuario, `operacion.${id}`) }));
  const [elegida, setSub] = useState<Sub>('pedidos');
  const sub = items.find((i) => i.id === elegida && !i.oculto) ? elegida : items.find((i) => !i.oculto)!.id;
  return (
    <section>
      <Pestanas etiqueta="Operación" actual={sub} cambiar={setSub} items={items} />
      {sub === 'pedidos' && <Pedidos />}
      {sub === 'inventario' && <Inventario />}
      {sub === 'disponibilidad' && <Disponibilidad />}
      {sub === 'ajustes' && <Ajustes />}
    </section>
  );
}

function Pedidos() {
  const { svc, usuario, accion, aviso, ver } = useApp();
  const todos = useMemo(() => svc.pedidos(), [svc, ver]);
  const [estado, setEstado] = useState('Abiertos');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const base = todos.filter((p) => estado === 'Todos' || (estado === 'Abiertos' ? p.estado !== 'Cancelado' : estado === 'Atrasados' ? p.atrasado : p.estado === estado));
  const f = useFiltro(base, (p) => `${p.pedido_id} ${p.cliente_id} ${p.destino_id}`);
  const cola = useMemo(() => D.pedidosSinResponsable(svc.repo), [svc, ver]);
  return (
    <>
      <div className="barra">
        <BotonAccion primario permiso="GESTIONAR_PEDIDOS" onClick={() => setNuevo(true)}>Nuevo pedido</BotonAccion>
        <BotonAccion permiso="RESERVAR" titulo="Urgentes primero, luego por fin de ventana" onClick={() => accion(async () => {
          const r = await svc.op('reserva por prioridad', () => D.reservarPendientes(svc.repo, usuario));
          aviso('info', r.length ? r.map((x) => `${x.pedido_id} (${x.prioridad}): ${x.ok ? x.detalle : x.detalle}`).join(' · ') : 'No hay pedidos confirmados con pendiente.');
        })}>Reservar pendientes por prioridad</BotonAccion>
        <label className="filtro">Mostrar <select value={estado} onChange={(e) => setEstado(e.target.value)}>{['Abiertos', 'Atrasados', 'Borrador', 'Confirmado', 'Reserva parcial', 'Reservado', 'Cancelado', 'Todos'].map((x) => <option key={x}>{x}</option>)}</select></label>
        {f.caja}
        <span className="nota">{f.filas.length} de {todos.length} pedidos</span>
      </div>
      {cola.length > 0 && <p className="alerta-suave">Pedidos sin responsable vigente: {cola.map((c) => c.pedido_id).join(', ')}. Asígnelos desde Datos → Usuarios y roles.</p>}
      <LeyendaEstados />
      <table>
        <thead><tr><th>Pedido</th><th>Cliente</th><th>Destino</th><th>Prioridad</th><th>Estado</th><th>Ventana hasta</th><th className="num">Solicitado</th><th className="num">Reservado</th><th className="num">Pendiente</th><th className="num">Importe</th></tr></thead>
        <tbody>
          {f.filas.map((p) => {
            const s = p.lineas.reduce((a, l) => a + l.solicitada_mil - l.cancelada_mil, 0), r = p.lineas.reduce((a, l) => a + l.reservada_mil, 0);
            const sel = abierto === p.pedido_id;
            return (
              <Fragment key={p.pedido_id}>
                <tr className={'clicable' + (sel ? ' seleccionada' : '')} tabIndex={0} aria-expanded={sel} title="Clic para ver el detalle y las acciones del pedido"
                  onClick={() => setAbierto(sel ? null : p.pedido_id)} onKeyDown={(e) => e.key === 'Enter' && setAbierto(sel ? null : p.pedido_id)}>
                  <td><span className="flecha">{sel ? '▾' : '▸'}</span> {p.pedido_id}</td><td>{p.cliente_id}</td><td>{p.destino_id}</td><td>{p.prioridad === 'URGENTE' ? <strong>Urgente</strong> : 'Normal'}</td>
                  <td><span className={'chip ' + claseEstado(p.estado)}>{p.estado}</span>{p.atrasado && <span className="chip atrasado">Atrasado</span>}</td>
                  <td>{fmtFecha(p.ventana_fin)} {p.ventana_fin.slice(11, 16)}</td>
                  <td className="num">{fmtMil(s)}</td><td className="num">{fmtMil(r)}</td><td className="num">{fmtMil(s - r)}</td><td className="num">{fmtSoles(p.importe_cent)}</td>
                </tr>
                {sel && <tr className="fila-detalle"><td colSpan={10}><DetallePedido id={p.pedido_id} /></td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {f.vacio}
      {nuevo && <NuevoPedido cerrar={() => setNuevo(false)} creado={(id) => { setEstado('Abiertos'); f.limpiar?.(); setAbierto(id); }} />}
    </>
  );
}

function DetallePedido({ id }: { id: string }) {
  const { svc, usuario, accion, aviso, ver } = useApp();
  const p = useMemo(() => svc.pedidos().find((x) => x.pedido_id === id), [svc, ver, id]);
  const [res, setRes] = useState<D.ResultadoReserva | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [id]);
  const dispo = useMemo(() => svc.existencias().filter((e) => e.disponible_mil > 0), [svc, ver]);
  if (!p) return null;
  const nodos = [...new Set(p.lineas.flatMap((l) => l.reservas.map((r) => r.nodo_id)))];
  const almacenes = svc.repo.todos("SELECT nodo_id FROM nodo WHERE tipo='ALMACEN' AND activo=1 ORDER BY nodo_id").map((n) => String(n.nodo_id));
  return (
    <div className="detalle" ref={ref}>
      <h2>Pedido {p.pedido_id} — {p.estado}{p.atrasado ? ' (atrasado)' : ''}</h2>
      <p className="nota">Ventana {fmtFecha(p.ventana_inicio)} {p.ventana_inicio.slice(11, 16)} – {fmtFecha(p.ventana_fin)} {p.ventana_fin.slice(11, 16)} · Parcialidad: {p.permite_parcial ? 'permitida' : 'no'} · Entregas divididas: {p.permite_entregas_divididas ? 'permitidas' : 'no'} · Responsable: {p.responsable_id ?? 'sin asignar'}</p>
      <table>
        <thead><tr><th>Línea</th><th>Producto</th><th>Presentación</th><th className="num">Solicitado (base)</th><th className="num">Reservado</th><th className="num">Pendiente</th><th>Reservas (almacén · lote · cantidad)</th><th>Disponible ahora por almacén</th></tr></thead>
        <tbody>{p.lineas.map((l) => (
          <tr key={l.pedido_linea_id}><td>{l.pedido_linea_id}</td><td>{l.nombre}</td><td>{l.presentacion_id}</td><td className="num">{fmtMil(l.solicitada_mil)}</td><td className="num">{fmtMil(l.reservada_mil)}</td><td className="num">{fmtMil(l.pendiente_mil)}</td>
            <td>{l.reservas.map((r) => <div key={r.reserva_id}>{r.nodo_id} · {r.lote} · {fmtMil(r.q_mil)} <button className="mini" onClick={() => accion(async () => { await svc.op('liberar reserva', () => D.liberarReservas(svc.repo, usuario, { reserva_id: r.reserva_id }, 'Liberación de una contribución')); }, 'Reserva liberada; no se creó ingreso físico.')}>Liberar</button></div>)}</td>
            <td className="nota">{(() => { const m = new Map<string, number>(); for (const e of dispo.filter((x) => x.producto_id === l.producto_id)) m.set(e.nodo_id, (m.get(e.nodo_id) ?? 0) + e.disponible_mil); return m.size ? [...m].map(([n, q]) => `${n}: ${fmtMil(q)}`).join(' · ') : 'sin disponible'; })()}</td></tr>
        ))}</tbody>
      </table>
      <div className="botonera">
        {p.estado === 'Borrador' && <BotonAccion primario permiso="GESTIONAR_PEDIDOS" onClick={() => accion(async () => { await svc.op('confirmar pedido', () => D.confirmarPedido(svc.repo, usuario, id)); }, 'Pedido confirmado; se guardó el compromiso original.')}>Confirmar pedido</BotonAccion>}
        {['Confirmado', 'Reserva parcial'].includes(p.estado) && <BotonAccion primario permiso="RESERVAR" onClick={() => accion(async () => { const r = await svc.op('reserva', () => D.reservarFefo(svc.repo, usuario, id)); setRes(r.resultado); aviso('ok', `Reserva realizada${r.resultado.origen_unico ? ' desde ' + r.resultado.origen_unico : ''}.`); })}>Reservar (FEFO)</BotonAccion>}
        {p.lineas.some((l) => l.reservada_mil > 0) && <BotonAccion permiso="RESERVAR" onClick={() => accion(async () => { await svc.op('liberar', () => D.liberarReservas(svc.repo, usuario, { pedido_id: id })); setRes(null); }, 'Reservas liberadas; no se creó ingreso físico.')}>Liberar todas</BotonAccion>}
        {nodos.length === 1 && almacenes.filter((a) => a !== nodos[0]).map((a) => (
          <BotonAccion key={a} permiso="RESERVAR" onClick={() => accion(async () => { await svc.op('reasignar origen', () => D.reasignarOrigen(svc.repo, usuario, id, nodos[0], a)); }, `Origen cambiado a ${a}.`)}>Cambiar origen a {a}</BotonAccion>
        ))}
        {['Confirmado', 'Reserva parcial'].includes(p.estado) && <BotonAccion permiso="PROPONER_FECHA" onClick={() => accion(async () => {
          const r = await svc.op('propuesta', () => D.proponerFecha(svc.repo, usuario, id));
          aviso('info', `Fecha factible ${fmtFecha(r.fecha)} (referencia por plazo fijo: ${fmtFecha(r.estimacion_plazo_fijo)}). ${r.dentro_de_ventana ? 'Dentro de la ventana.' : 'FUERA de la ventana comprometida.'} Vigente hasta ${r.vence.slice(11, 16)}. Acéptela en Disponibilidad y propuestas.`);
        })}>Proponer fecha</BotonAccion>}
        {p.estado !== 'Cancelado' && <BotonAccion permiso="GESTIONAR_PEDIDOS" onClick={async () => { const f = await formulario(`Cancelar ${id}`, [{ id: 'm', tipo: 'motivo', etiqueta: 'Motivo de la cancelación', opciones: ['Cliente desiste del pedido', 'Pedido duplicado', 'Sin stock ni fecha aceptable para el cliente', 'Error de registro'] }], { explicacion: 'Se liberan las reservas sin movimiento físico. Si una parte ya salió, se conserva lo entregado y lo que viaja queda para retorno.', aceptar: 'Cancelar pedido' }); if (f) accion(async () => { await svc.op('cancelar', () => D.cancelarPedido(svc.repo, usuario, id, f.m)); }, 'Pedido cancelado; reservas liberadas sin movimiento físico.'); }}>Cancelar pedido</BotonAccion>}
      </div>
      {res && (
        <div className="nota">
          {res.asignaciones.map((a, i) => <div key={i}>{a.pedido_linea_id}: lote {a.lote} en {a.nodo_id} — {fmtMil(a.q_mil)}</div>)}
          {res.pendientes.length > 0 && <div>Pendiente: {res.pendientes.map((x) => `${x.pedido_linea_id} ${fmtMil(x.q_mil)}`).join('; ')}</div>}
          {res.excluidos.length > 0 && <div>Lotes excluidos: {[...new Set(res.excluidos.map((e) => `${e.lote} en ${e.nodo_id} (${e.motivo})`))].join('; ')}</div>}
        </div>
      )}
    </div>
  );
}

function NuevoPedido({ cerrar, creado }: { cerrar: () => void; creado: (id: string) => void }) {
  const { svc, usuario, accion, aviso } = useApp();
  const clientes = svc.repo.todos('SELECT cliente_id, nombre_ficticio FROM cliente WHERE activo=1 ORDER BY cliente_id');
  const [cab, setCab] = useState({ cliente_id: String(clientes[0]?.cliente_id ?? ''), destino_id: '', ventana_inicio: '', ventana_fin: '', prioridad: 'NORMAL', permite_parcial: false, permite_entregas_divididas: false });
  const destinos = svc.repo.todos('SELECT destino_id, nombre_ficticio FROM destino WHERE activo=1 AND cliente_id=? ORDER BY destino_id', [cab.cliente_id]);
  const productos = svc.repo.todos('SELECT producto_id, nombre_generico FROM producto WHERE activo=1 ORDER BY producto_id');
  const [lineas, setLineas] = useState([{ producto_id: '', presentacion_id: '', cantidad: '', precio: '' }]);
  const [err, setErr] = useState<Record<string, string>>({});
  const pres = (pid: string) => svc.repo.todos('SELECT p.presentacion_id, p.nombre, p.factor_base_mil, pr.unidad_base FROM presentacion p JOIN producto pr USING (producto_id) WHERE p.activo=1 AND p.producto_id=? ORDER BY p.factor_base_mil, p.presentacion_id', [pid]);
  const equivalente = (l: { presentacion_id: string; cantidad: string; producto_id: string }) => { const ps = pres(l.producto_id).find((x) => x.presentacion_id === l.presentacion_id); const q = aMil(l.cantidad); if (!ps || q === null || Number.isNaN(q)) return ''; const base = (Number(q) * Number(ps.factor_base_mil)) / 1e6; return `= ${fmtNum(base, 3)} ${ps.unidad_base === 'kg' ? 'kg' : 'unidades'} (unidad base)`; };
  const guardar = (confirmar: boolean) => accion(async () => {
    const e: Record<string, string> = {};
    const ls = lineas.map((l, i) => {
      const q = aMil(l.cantidad), pr = leerDecimal(l.precio, 4);
      if (q === null || Number.isNaN(q)) e[`linea ${i + 1} cantidad`] = 'Número inválido (use coma decimal).';
      if (pr === null || Number.isNaN(pr)) e[`linea ${i + 1} precio`] = 'Número inválido (hasta 4 decimales).';
      return { producto_id: l.producto_id, presentacion_id: l.presentacion_id, cantidad_presentacion_mil: Number(q), precio_neto_base_p4: Math.round(Number(pr) * 10000) };
    });
    if (Object.keys(e).length) { setErr(e); throw new Error('Revise los campos marcados.'); }
    try {
      const id = await svc.op('nuevo pedido', () => {
        const id = D.crearPedido(svc.repo, usuario, { ...cab, prioridad: cab.prioridad as 'NORMAL', fecha_pedido: new Date().toISOString().slice(0, 10), ventana_inicio: deLocal(cab.ventana_inicio), ventana_fin: deLocal(cab.ventana_fin), lineas: ls });
        if (confirmar) D.confirmarPedido(svc.repo, usuario, id);
        return id;
      });
      cerrar();
      creado(id);
      aviso('ok', confirmar ? `Pedido ${id} creado y confirmado. Se abrió su detalle debajo de su fila: el siguiente paso es «Reservar stock».` : `Pedido ${id} guardado como borrador. Se abrió su detalle para revisarlo y confirmarlo.`);
    } catch (ex) { const c = errores(ex); if (c) { setErr(c); throw new Error(`Revise los ${Object.keys(c).length} campo(s) marcados en el formulario.`); } throw ex; }
  });
  return (
    <Panel titulo="Nuevo pedido" cerrar={cerrar}>
      <div className="formulario">
        <Campo etiqueta="Cliente" error={err.cliente}><select value={cab.cliente_id} onChange={(e) => setCab({ ...cab, cliente_id: e.target.value, destino_id: '' })}>{clientes.map((c) => <option key={String(c.cliente_id)} value={String(c.cliente_id)}>{String(c.cliente_id)} — {String(c.nombre_ficticio)}</option>)}</select></Campo>
        <Campo etiqueta="Destino" error={err.destino}><select value={cab.destino_id} onChange={(e) => setCab({ ...cab, destino_id: e.target.value })}><option value="">Seleccione…</option>{destinos.map((d) => <option key={String(d.destino_id)} value={String(d.destino_id)}>{String(d.destino_id)} — {String(d.nombre_ficticio)}</option>)}</select></Campo>
        <Campo etiqueta="Ventana desde (hora de Lima)" error={err.ventana}><input type="datetime-local" value={cab.ventana_inicio} onChange={(e) => setCab({ ...cab, ventana_inicio: e.target.value })} /></Campo>
        <Campo etiqueta="Ventana hasta (hora de Lima)"><input type="datetime-local" value={cab.ventana_fin} onChange={(e) => setCab({ ...cab, ventana_fin: e.target.value })} /></Campo>
        <Campo etiqueta="Prioridad"><select value={cab.prioridad} onChange={(e) => setCab({ ...cab, prioridad: e.target.value })}><option value="NORMAL">Normal</option><option value="URGENTE">Urgente</option></select></Campo>
        <label className="check"><input type="checkbox" checked={cab.permite_parcial} onChange={(e) => setCab({ ...cab, permite_parcial: e.target.checked })} /> Admite atención parcial</label>
        <label className="check"><input type="checkbox" checked={cab.permite_entregas_divididas} onChange={(e) => setCab({ ...cab, permite_entregas_divididas: e.target.checked })} /> Admite entregas divididas (varios orígenes)</label>
      </div>
      <h3>Líneas</h3>
      {err.lineas && <p className="error-campo">{err.lineas}</p>}
      {lineas.map((l, i) => (
        <div className="formulario linea" key={i}>
          <Campo etiqueta={`Producto ${i + 1}`} error={err[`linea ${i + 1} producto`]}><select value={l.producto_id} onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, producto_id: e.target.value, presentacion_id: String(pres(e.target.value)[0]?.presentacion_id ?? '') } : x)))}><option value="">Seleccione…</option>{productos.map((p) => <option key={String(p.producto_id)} value={String(p.producto_id)}>{String(p.producto_id)} — {String(p.nombre_generico)}</option>)}</select></Campo>
          <Campo etiqueta="Presentación" error={err[`linea ${i + 1} presentación`]}><select value={l.presentacion_id} onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, presentacion_id: e.target.value } : x)))}>{pres(l.producto_id).map((p) => <option key={String(p.presentacion_id)} value={String(p.presentacion_id)}>{String(p.nombre)} ({fmtNum(Number(p.factor_base_mil) / 1000, 3).replace(/,?0+$/, '')} {p.unidad_base === 'kg' ? 'kg' : 'u.'})</option>)}</select></Campo>
          <Campo etiqueta="Cantidad (en la presentación elegida)" error={err[`linea ${i + 1} cantidad`]} ayuda={equivalente(l) || 'Ejemplo: 1.250,5'}><input inputMode="decimal" value={l.cantidad} onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))} /></Campo>
          <Campo etiqueta="Precio neto S/ por unidad base" error={err[`linea ${i + 1} precio`]}><input inputMode="decimal" value={l.precio} onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, precio: e.target.value } : x)))} /></Campo>
          {lineas.length > 1 && <button className="mini" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}>Quitar</button>}
        </div>
      ))}
      <div className="botonera">
        <button onClick={() => setLineas([...lineas, { producto_id: '', presentacion_id: '', cantidad: '', precio: '' }])}>Agregar línea</button>
        <BotonAccion permiso="GESTIONAR_PEDIDOS" onClick={() => guardar(false)}>Guardar borrador</BotonAccion>
        <BotonAccion primario permiso="GESTIONAR_PEDIDOS" onClick={() => guardar(true)}>Guardar y confirmar</BotonAccion>
      </div>
    </Panel>
  );
}

function Inventario() {
  const { svc, usuario, accion, ver } = useApp();
  const ex = useMemo(() => svc.existencias(), [svc, ver]);
  const f = useFiltro(ex, (e) => `${e.producto_id} ${e.codigo_lote} ${e.nodo_id} ${e.condicion}`);
  const traslados = useMemo(() => svc.repo.todos("SELECT s.*, l.codigo_lote FROM suministro_esperado s LEFT JOIN lote l USING (lote_id) WHERE transfer_id IS NOT NULL AND estado <> 'RECIBIDO' ORDER BY fecha_prevista"), [svc, ver]);
  const [tr, setTr] = useState(false);
  const almacenes = svc.repo.todos("SELECT nodo_id FROM nodo WHERE tipo='ALMACEN' AND activo=1 ORDER BY nodo_id").map((n) => String(n.nodo_id));
  const [form, setForm] = useState({ lote_id: '', origen: almacenes[0] ?? '', destino: almacenes[1] ?? '', cantidad: '', fecha: '' });
  const lotesOrigen = ex.filter((e) => e.nodo_id === form.origen && e.disponible_mil > 0);
  const bal = useMemo(() => { const ids = [...new Set(ex.map((e) => e.lote_id))]; return ids.filter((id) => !D.balanceLote(svc.repo, id).cuadra); }, [svc, ver, ex]);
  return (
    <>
      <div className="barra">{f.caja}<BotonAccion permiso="MOVER_INVENTARIO" onClick={() => setTr(true)}>Nuevo traslado entre almacenes</BotonAccion>
        <span className={bal.length ? 'chip atrasado' : 'chip reservado'}>{bal.length ? `Balance con diferencias: ${bal.join(', ')}` : 'Balance por lote conciliado'}</span></div>
      <table>
        <thead><tr><th>Producto</th><th>Lote</th><th>Nodo</th><th>Condición</th><th>Vence</th><th>Estado lote</th><th className="num">Físico</th><th className="num">Reservado</th><th className="num">Disponible</th><th>Motivo no disponible</th></tr></thead>
        <tbody>{f.filas.map((e, i) => (
          <tr key={i}><td>{e.producto_id}</td><td>{e.codigo_lote}</td><td>{e.nodo_id}</td><td>{e.condicion}</td><td>{fmtFecha(e.fecha_vencimiento)}</td><td>{e.estado_lote}</td>
            <td className="num">{fmtMil(e.fisico_mil)}</td><td className="num">{fmtMil(e.reservado_mil)}</td><td className="num">{fmtMil(e.disponible_mil)}</td><td>{e.motivo_no_disponible}</td></tr>
        ))}</tbody>
      </table>
      {f.vacio}
      <h2>Traslados en curso</h2>
      {!traslados.length ? <p className="nota">No hay traslados pendientes de recepción.</p> : (
        <table><thead><tr><th>Traslado</th><th>Lote</th><th>Destino</th><th>Llegada prevista</th><th className="num">Enviado</th><th>Acción</th></tr></thead>
          <tbody>{traslados.map((t) => (
            <tr key={String(t.transfer_id)}><td>{String(t.transfer_id)}</td><td>{String(t.codigo_lote)}</td><td>{String(t.nodo_destino_id)}</td><td>{fmtFecha(String(t.fecha_prevista))}</td><td className="num">{fmtMil(Number(t.q_mil))}</td>
              <td><BotonAccion permiso="MOVER_INVENTARIO" onClick={async () => { const f = await formulario('Recepción del traslado', [{ id: 'q', tipo: 'numero', etiqueta: 'Cantidad que llegó apta', unidad: 'unidad base', maxMil: Number(t.q_mil), inicial: fmtMil(Number(t.q_mil)), ayuda: `Se enviaron ${fmtMil(Number(t.q_mil))}. Si llegó menos, la diferencia queda en tránsito en investigación.` }], { aceptar: 'Registrar recepción' }); if (!f) return; accion(async () => { const r = await svc.op('recepción de traslado', () => D.recibirTraslado(svc.repo, usuario, String(t.transfer_id), Number(f.q))); if (r.resultado.diferencia_en_investigacion_mil) return (`Recibido con diferencia: ${fmtMil(r.resultado.diferencia_en_investigacion_mil)} queda en tránsito en investigación.`); }, 'Traslado recibido completo.'); }}>Registrar recepción</BotonAccion></td></tr>
          ))}</tbody></table>
      )}
      {tr && (
        <Panel titulo="Nuevo traslado entre almacenes" cerrar={() => setTr(false)}>
          <div className="formulario">
            <Campo etiqueta="Origen"><select value={form.origen} onChange={(e) => setForm({ ...form, origen: e.target.value, lote_id: '' })}>{almacenes.map((a) => <option key={a}>{a}</option>)}</select></Campo>
            <Campo etiqueta="Lote (con disponible)"><select value={form.lote_id} onChange={(e) => setForm({ ...form, lote_id: e.target.value })}><option value="">Seleccione…</option>{lotesOrigen.map((l) => <option key={l.lote_id} value={l.lote_id}>{l.producto_id} · {l.codigo_lote} · disp. {fmtMil(l.disponible_mil)}</option>)}</select></Campo>
            <Campo etiqueta="Destino"><select value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })}>{almacenes.map((a) => <option key={a}>{a}</option>)}</select></Campo>
            <Campo etiqueta="Cantidad (unidad base)"><input inputMode="decimal" value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })} /></Campo>
            <Campo etiqueta="Llegada prevista"><input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} /></Campo>
          </div>
          <div className="botonera"><BotonAccion primario permiso="MOVER_INVENTARIO" onClick={() => accion(async () => {
            const q = aMil(form.cantidad); if (q === null || Number.isNaN(q)) throw new Error('Cantidad inválida.');
            if (!form.lote_id || !form.fecha) throw new Error('Seleccione lote y fecha prevista.');
            await svc.op('traslado', () => D.trasladar(svc.repo, usuario, { lote_id: form.lote_id, origen: form.origen, destino: form.destino, q_mil: q, fecha_prevista: form.fecha }));
            setTr(false);
          }, 'Traslado registrado: la carga está en tránsito; el destino la verá como entrada prevista hasta recibirla.')}>Registrar salida</BotonAccion></div>
        </Panel>
      )}
    </>
  );
}

function Disponibilidad() {
  const { svc, usuario, accion, ver } = useApp();
  const productos = svc.repo.todos('SELECT producto_id, nombre_generico FROM producto ORDER BY producto_id');
  const almacenes = svc.repo.todos("SELECT nodo_id FROM nodo WHERE tipo='ALMACEN' ORDER BY nodo_id").map((n) => String(n.nodo_id));
  const [prod, setProd] = useState(String(productos[0]?.producto_id ?? ''));
  const [nodo, setNodo] = useState('');
  const [escenario, setEscenario] = useState(false);
  const serie = useMemo(() => (prod ? D.disponibilidadAFecha(svc.repo, prod, nodo || null, { incluirNoConfirmados: escenario }) : []), [svc, ver, prod, nodo, escenario]);
  const sum = useMemo(() => svc.repo.todos('SELECT * FROM suministro_esperado ORDER BY fecha_prevista'), [svc, ver]);
  const props = useMemo(() => { D.expirarPropuestas(svc.repo); return svc.repo.todos('SELECT * FROM propuesta_entrega ORDER BY creada_en DESC LIMIT 50'); }, [svc, ver]);
  const alt = useMemo(() => D.alternativasMasTempranas(svc.repo), [svc, ver]);
  return (
    <>
      <details className="ayuda"><summary>¿Cómo se calcula lo prometible?</summary>
        <p>Prometible en una fecha = el mínimo, desde esa fecha hacia adelante, de (disponible físico hoy + entradas CONFIRMADAS hasta cada fecha − compromisos ya aceptados hasta cada fecha). Así una promesa nueva nunca rompe otra ya hecha. Una entrada NO confirmada solo se usa como escenario y no permite aceptar la propuesta. Una entrada prevista nunca permite despachar antes de recibirse. Las propuestas valen en el intervalo [emisión, vencimiento); al aceptar se revalida. Versión de la regla: RN-50 (I03).</p>
      </details>
      <div className="barra">
        <label className="filtro">Producto <select value={prod} onChange={(e) => setProd(e.target.value)}>{productos.map((p) => <option key={String(p.producto_id)} value={String(p.producto_id)}>{String(p.producto_id)} — {String(p.nombre_generico)}</option>)}</select></label>
        <label className="filtro">Almacén <select value={nodo} onChange={(e) => setNodo(e.target.value)}><option value="">Todos</option>{almacenes.map((a) => <option key={a}>{a}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={escenario} onChange={(e) => setEscenario(e.target.checked)} /> Escenario con entradas no confirmadas</label>
      </div>
      <table><thead><tr><th>Fecha</th><th className="num">Saldo proyectado</th><th className="num">Prometible desde esa fecha</th></tr></thead>
        <tbody>{serie.map((s) => <tr key={s.fecha}><td>{fmtFecha(s.fecha)}</td><td className="num">{fmtMil(s.acumulado_mil)}</td><td className="num">{fmtMil(s.prometible_mil)}</td></tr>)}</tbody></table>
      {escenario && <p className="alerta-suave">Escenario condicionado: incluye entradas no confirmadas; no sirve para comprometer fechas.</p>}
      <h2>Propuestas de fecha</h2>
      {!props.length ? <p className="nota">Aún no hay propuestas. Se generan desde el detalle del pedido con «Proponer fecha».</p> : (
        <table><thead><tr><th>Pedido</th><th>Versión</th><th>Fecha factible</th><th>Plazo fijo (referencia)</th><th>Vence</th><th>Estado</th><th>Motivo</th><th>Acción</th></tr></thead>
          <tbody>{props.map((p) => (
            <tr key={String(p.propuesta_id)}><td>{String(p.pedido_id)}</td><td>{String(p.version)}</td><td>{fmtFecha(String(p.fecha_propuesta))}</td><td>{fmtFecha(String(p.estimacion_plazo_fijo))}</td><td>{String(p.vence).slice(11, 16)}</td>
              <td><span className="chip">{String(p.estado)}</span>{p.condicionada ? <span className="chip atrasado">Condicionada</span> : null}</td><td>{String(p.motivo_estado ?? '')}</td>
              <td>{p.estado === 'PROPUESTA' && <BotonAccion permiso="PROPONER_FECHA" onClick={() => accion(async () => { const r = await svc.op('aceptar propuesta', () => D.aceptarPropuesta(svc.repo, usuario, String(p.propuesta_id))); if (!r.aceptada) throw new Error(r.motivo); }, 'Propuesta aceptada; la ventana original del pedido no cambia.')}>Aceptar</BotonAccion>}</td></tr>
          ))}</tbody></table>
      )}
      {alt.length > 0 && <p className="alerta-suave">Fechas más tempranas posibles (no se aplican solas): {alt.map((a) => `${a.pedido_id}: aceptada ${fmtFecha(a.fecha_aceptada)}, posible ${fmtFecha(a.fecha_posible)}`).join(' · ')}</p>}
      <h2>Entradas previstas (suministros)</h2>
      <table><thead><tr><th>Suministro</th><th>Producto</th><th>Destino</th><th>Fecha prevista</th><th className="num">Cantidad</th><th>Estado</th><th>Cambiar estado</th></tr></thead>
        <tbody>{sum.map((s) => (
          <tr key={String(s.suministro_id)}><td>{String(s.suministro_id)}{s.transfer_id ? ' (traslado)' : ''}</td><td>{String(s.producto_id)}</td><td>{String(s.nodo_destino_id)}</td><td>{fmtFecha(String(s.fecha_prevista))}</td><td className="num">{fmtMil(Number(s.q_mil))}</td><td><span className="chip">{String(s.estado)}</span></td>
            <td>{s.estado !== 'RECIBIDO' && s.estado !== 'CANCELADO' && ['CONFIRMADO', 'RETRASADO', 'CANCELADO'].filter((x) => x !== s.estado).map((x) => (
              <button key={x} className="mini" disabled={!svc.puede(usuario, 'GESTIONAR_SUMINISTRO')} onClick={async () => { const fm = x === 'RETRASADO' ? await formulario('Retrasar suministro', [{ id: 'f', tipo: 'fecha', etiqueta: 'Nueva fecha prevista de llegada', minimo: String(s.fecha_prevista), inicial: String(s.fecha_prevista) }], { aceptar: 'Retrasar' }) : undefined; if (fm === null) return; accion(async () => { const r = await svc.op('suministro', () => D.actualizarSuministro(svc.repo, usuario, String(s.suministro_id), x as 'CONFIRMADO', fm?.f || undefined)); if (r.pedidosAfectados.length) return (`Propuestas invalidadas para: ${r.pedidosAfectados.join(', ')}. Las fechas comprometidas originales no cambiaron; vuelva a proponer.`); }, 'Estado actualizado.'); }}>{x === 'CONFIRMADO' ? 'Confirmar' : x === 'RETRASADO' ? 'Retrasar' : 'Cancelar'}</button>
            ))}</td></tr>
        ))}</tbody></table>
      <p className="nota">Cifras en unidad base del producto. {fmtNum(serie.length, 0)} fechas con cambios de saldo.</p>
    </>
  );
}

function Ajustes() {
  const { svc, usuario, accion, ver } = useApp();
  const sol = useMemo(() => svc.repo.todos('SELECT a.*, l.codigo_lote, l.producto_id FROM solicitud_ajuste a JOIN lote l USING (lote_id) ORDER BY solicitado_en DESC'), [svc, ver]);
  const ex = useMemo(() => svc.existencias().filter((e) => e.tipo_nodo === 'ALMACEN'), [svc, ver]);
  const [f, setF] = useState({ clave: '', delta: '', motivo: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  return (
    <>
      <p className="nota">Un ajuste corrige el saldo físico con motivo. Por política, lo aprueba otra persona con rol Supervisión; nunca deja saldo negativo ni reservas sin respaldo.</p>
      <div className="formulario">
        <Campo etiqueta="Lote · almacén · condición"><select value={f.clave} onChange={(e) => setF({ ...f, clave: e.target.value })}><option value="">Seleccione…</option>{ex.map((e) => <option key={e.lote_id + e.nodo_id + e.condicion} value={`${e.lote_id}|${e.nodo_id}|${e.condicion}`}>{e.producto_id} · {e.codigo_lote} · {e.nodo_id} · {e.condicion} (físico {fmtMil(e.fisico_mil)})</option>)}</select></Campo>
        <Campo etiqueta="Diferencia (+ sobrante / − faltante)" error={err.cantidad}><input value={f.delta} onChange={(e) => setF({ ...f, delta: e.target.value })} /></Campo>
        <Campo etiqueta="Motivo" error={err.motivo}><input value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} /></Campo>
        <BotonAccion permiso="SOLICITAR_AJUSTE" onClick={() => accion(async () => {
          const [lote_id, nodo_id, condicion] = f.clave.split('|'); const q = aMil(f.delta);
          if (!lote_id) throw new Error('Seleccione el lote.');
          try { await svc.op('solicitud de ajuste', () => D.solicitarAjuste(svc.repo, usuario, { lote_id, nodo_id, condicion, q_delta_mil: Number(q), motivo: f.motivo })); setErr({}); setF({ clave: '', delta: '', motivo: '' }); }
          catch (e) { setErr(errores(e) ?? {}); throw e; }
        }, 'Solicitud registrada; pendiente de aprobación.')}>Solicitar ajuste</BotonAccion>
      </div>
      <table><thead><tr><th>Fecha</th><th>Producto · lote</th><th>Almacén</th><th className="num">Diferencia</th><th>Motivo</th><th>Solicita</th><th>Estado</th><th>Resolver</th></tr></thead>
        <tbody>{sol.map((s) => (
          <tr key={String(s.ajuste_id)}><td>{fmtFecha(String(s.solicitado_en))}</td><td>{String(s.producto_id)} · {String(s.codigo_lote)}</td><td>{String(s.nodo_id)}</td><td className="num">{fmtMil(Number(s.q_delta_mil))}</td><td>{String(s.motivo)}</td><td>{String(s.solicitado_por)}</td>
            <td><span className="chip">{String(s.estado)}</span>{s.resuelto_por ? ` por ${s.resuelto_por}` : ''}</td>
            <td>{s.estado === 'PENDIENTE' && <>
              <BotonAccion permiso="APROBAR_AJUSTE" onClick={() => accion(async () => { await svc.op('aprobar ajuste', () => D.resolverAjuste(svc.repo, usuario, String(s.ajuste_id), true, 'Aprobado')); }, 'Ajuste aprobado y aplicado.')}>Aprobar</BotonAccion>
              <BotonAccion permiso="APROBAR_AJUSTE" onClick={() => accion(async () => { await svc.op('rechazar ajuste', () => D.resolverAjuste(svc.repo, usuario, String(s.ajuste_id), false, 'Rechazado')); }, 'Ajuste rechazado; el saldo no cambió.')}>Rechazar</BotonAccion></>}</td></tr>
        ))}</tbody></table>
    </>
  );
}
