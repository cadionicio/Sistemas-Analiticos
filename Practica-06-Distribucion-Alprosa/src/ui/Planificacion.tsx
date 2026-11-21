import { useMemo, useState } from 'react';
import { useApp, Pestanas, BotonAccion, Campo, Panel, aMil, deLocal, claseEstado, formulario } from './comunes';
import { D, T, O } from './servicio';
import { fmtMil, fmtFecha, fmtSoles, fmtNum } from '../core/util';

type Sub = 'planificar' | 'itinerarios' | 'red';
const hora = (iso: string) => (iso ? `${fmtFecha(iso)} ${iso.slice(11, 16)}` : '—');
const MODO: Record<string, string> = { VIAL: 'Camión', VIAL_LIGERO: 'Camioneta', LACUSTRE: 'Lancha', FLUVIAL: 'Embarcación', ANIMAL: 'Recua', PEATONAL: 'Porteadores', AEREO: 'Avioneta' };

export function Planificacion() {
  const { svc, usuario } = useApp();
  const items = ([['planificar', 'Planificar rutas', 'rutas'], ['itinerarios', 'Itinerarios y ejecución', 'itinerarios'], ['red', 'Red y condiciones de acceso', 'red']] as [Sub, string, string][])
    .map(([id, nombre, v]) => ({ id, nombre, oculto: !svc.ve(usuario, `planificacion.${v}` as 'planificacion.red') }));
  const [elegida, setSub] = useState<Sub>('planificar');
  const sub = items.find((i) => i.id === elegida && !i.oculto) ? elegida : items.find((i) => !i.oculto)!.id;
  return (
    <section>
      <Pestanas etiqueta="Planificación" actual={sub} cambiar={setSub} items={items} />
      {sub === 'planificar' && <Planificar ir={() => setSub('itinerarios')} />}
      {sub === 'itinerarios' && <Itinerarios />}
      {sub === 'red' && <Red />}
    </section>
  );
}

function Planificar({ ir }: { ir: () => void }) {
  const { svc, usuario, accion, ver } = useApp();
  const lista = useMemo(() => svc.pedidos().filter((p) => !['Borrador', 'Cancelado', 'Cerrado parcial'].includes(p.estado)).map((p) => ({ p, origenes: T.origenesPlanificables(svc.repo, p.pedido_id).map((o) => o.tipo === 'CUSTODIA' ? `${o.origen} (custodia en ruta)` : o.origen) })).filter((x) => x.origenes.length), [svc, ver]);
  const sinReserva = useMemo(() => svc.pedidos().filter((p) => p.estado === 'Confirmado').length, [svc, ver]);
  const [plan, setPlan] = useState<{ id: string; res: (T.ResultadoPlan & { tipo_origen?: string })[] } | null>(null);
  return (
    <>
      <p className="nota">Aquí aparecen los pedidos con stock reservado que aún no tienen ruta. El sistema busca cadenas de tramos hasta el <strong>cliente final</strong> con salidas reales, capacidad por tramo, bultos que no se parten, transbordos, accesos vigentes, ventana y vida útil. {sinReserva > 0 && `Hay ${sinReserva} pedido(s) confirmados sin reserva: resérvelos primero en Operación → Pedidos.`}</p>
      {!lista.length ? <p className="vacio">No hay pedidos reservados pendientes de planificar.</p> : (
        <table><thead><tr><th>Pedido</th><th>Destino</th><th>Prioridad</th><th>Ventana hasta</th><th>Origen(es) de la reserva</th><th className="num">Reservado</th><th>Acción</th></tr></thead>
          <tbody>{lista.map(({ p, origenes }) => (
            <tr key={p.pedido_id} className={plan?.id === p.pedido_id ? 'seleccionada' : ''}><td>{p.pedido_id}</td><td>{p.destino_id}</td><td>{p.prioridad === 'URGENTE' ? <strong>Urgente</strong> : 'Normal'}</td><td>{hora(p.ventana_fin)}</td><td>{origenes.join(', ')}</td>
              <td className="num">{fmtMil(p.lineas.reduce((a, l) => a + l.reservada_mil, 0))}</td>
              <td><BotonAccion primario permiso="PLANIFICAR" onClick={() => accion(async () => { setPlan({ id: p.pedido_id, res: T.planificarPedido(svc.repo, p.pedido_id) }); })}>Planificar ruta</BotonAccion></td></tr>
          ))}</tbody></table>
      )}
      {plan && (
        <div className="detalle">
          <h2>Alternativas para {plan.id}</h2>
          {plan.res.map((r) => (
            <div key={r.origen}>
              <p className="nota">Desde <strong>{r.origen}</strong>{r.tipo_origen === 'CUSTODIA' ? ' (carga en custodia en ese nodo: se replanifica desde su ubicación real)' : ''}: {r.rutas_exploradas} ruta(s) exploradas{r.limite_alcanzado ? ' (se alcanzó el límite de exploración: puede existir otra ruta no evaluada)' : ''}. Criterio: factibles primero, entrega más temprana, luego menor costo y menos tramos. No se afirma un óptimo global.</p>
              {r.motivo_global && <p className="alerta-suave">{r.motivo_global}</p>}
              <table><thead><tr><th>Ruta (medios)</th><th>Primera salida</th><th>Entrega prevista</th><th>Viajes por tramo</th><th className="num">Costo estimado</th><th>Resultado</th><th></th></tr></thead>
                <tbody>{r.alternativas.map((a, i) => (
                  <tr key={i} className={a.factible ? '' : 'inactiva'}>
                    <td>{a.nodos.map((n, k) => <span key={k}>{n}{k < a.tramos.length ? <em className="modo"> —{MODO[a.tramos[k].modo] ?? a.tramos[k]?.modo ?? '…'}→ </em> : k < a.nodos.length - 1 ? ' → ' : ''}</span>)}</td>
                    <td>{hora(a.salida)}</td><td>{a.factible ? hora(a.entrega_prevista) : '—'}</td><td>{a.tramos.map((t) => t.viajes.length).join(' / ') || '—'}</td><td className="num">{fmtSoles(a.costo_cent)}{a.tramos.some((t) => t.transbordo_cent) ? <div className="nota">incluye transbordos {fmtSoles(a.tramos.reduce((x, t) => x + t.transbordo_cent, 0))}</div> : null}</td>
                    <td>{a.factible ? <span className="chip factible">Factible{a.dentro_ventana ? ', dentro de la ventana' : ''}</span> : <span className="motivo">{a.motivo}</span>}</td>
                    <td>{a.factible && <BotonAccion primario permiso="PLANIFICAR" onClick={() => accion(async () => { await svc.op('confirmar itinerario', () => T.confirmarItinerario(svc.repo, usuario, plan.id, r.origen, a.clave)); setPlan(null); ir(); }, 'Itinerario confirmado: la capacidad de cada salida quedó comprometida. Ejecute las etapas en «Itinerarios y ejecución».')}>Confirmar esta ruta</BotonAccion>}</td>
                  </tr>
                ))}</tbody></table>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Itinerarios() {
  const { svc, usuario, accion, ver } = useApp();
  const its = useMemo(() => T.itinerarios(svc.repo).filter((i) => i.estado !== 'CANCELADO'), [svc, ver]);
  const [verTodos, setVerTodos] = useState(false);
  const [rec, setRec] = useState<null | { etapa: Record<string, unknown>; final: boolean; pedido: string }>(null);
  const [verif, setVerif] = useState<null | { entrega_id: string; destino: string }>(null);
  const [inc, setInc] = useState<null | Record<string, unknown>>(null);
  const [ret, setRet] = useState<null | Record<string, unknown>>(null);
  if (!its.length) return <p className="vacio">No hay itinerarios. Confírmelos desde «Planificar rutas».</p>;
  return (
    <>
      <label className="check"><input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> Mostrar también completados y reemplazados</label>
      {its.filter((i) => verTodos || ['CONFIRMADO', 'EN_EJECUCION'].includes(String(i.estado))).map((i) => {
        const pedido = svc.pedidos().find((p) => p.pedido_id === i.pedido_id);
        const tramos = [...new Set(i.etapas.map((e) => Number(e.tramo)))];
        return (
          <div key={String(i.itinerario_id)} className="itinerario">
            <div className="itin-cab"><strong>{String(i.pedido_id)}</strong> · {String(i.ruta)} · entrega prevista {hora(String(i.entrega_prevista))} · costo est. {fmtSoles(Number(i.costo_estimado_cent))}
              <span className={'chip ' + ({ CONFIRMADO: 'confirmado', EN_EJECUCION: 'en-ejecucion', COMPLETADO: 'completado', CANCELADO: 'cancelado' } as Record<string, string>)[String(i.estado)]}>{({ CONFIRMADO: 'Confirmado', EN_EJECUCION: 'En ejecución', COMPLETADO: 'Completado', REEMPLAZADO: 'Reemplazado' } as Record<string, string>)[String(i.estado)] ?? String(i.estado)}</span>
              <span className="nota"> Pedido: </span>{pedido && <span className={'chip ' + claseEstado(pedido.estado)}>{pedido.estado}</span>}<span className="nota">{pedido?.atrasado ? ' (atrasado)' : ''} · aceptado {fmtMil(pedido?.lineas.reduce((a, l) => a + l.aceptada_mil, 0) ?? 0)} de {fmtMil(pedido?.lineas.reduce((a, l) => a + l.solicitada_mil - l.cancelada_mil, 0) ?? 0)}</span>
              {i.estado === 'EN_EJECUCION' && !i.etapas.some((e) => e.estado === 'DESPACHADA') && i.etapas.some((e) => e.estado === 'PLANIFICADA') && <BotonAccion permiso="PLANIFICAR" onClick={async () => { const f = await formulario('Reemplazar lo pendiente del itinerario', [{ id: 'm', tipo: 'motivo', etiqueta: 'Motivo', opciones: ['Cierre o interrupción de la vía', 'Avería del medio de transporte', 'Cambio de prioridad del pedido', 'Cambio de capacidad o salida'] }], { explicacion: 'Lo ya ejecutado se conserva. La carga queda en el nodo donde está y se vuelve a planificar desde allí.', aceptar: 'Reemplazar' }); if (f) accion(async () => { await svc.op('reemplazar itinerario', () => T.reemplazarItinerario(svc.repo, usuario, String(i.itinerario_id), f.m)); }, 'Itinerario reemplazado: los hechos se conservan. Replanifique desde «Planificar rutas».'); }}>Reemplazar lo pendiente</BotonAccion>}
              {i.estado === 'CONFIRMADO' && <BotonAccion permiso="PLANIFICAR" onClick={async () => { const f = await formulario('Anular itinerario', [{ id: 'm', tipo: 'motivo', etiqueta: 'Motivo', opciones: ['Cierre o interrupción de la vía', 'Avería del medio de transporte', 'Cambio de prioridad del pedido', 'Cambio de capacidad o salida'] }], { explicacion: 'La reserva de stock se mantiene; solo se libera la capacidad de las salidas.', aceptar: 'Anular' }); if (f) accion(async () => { await svc.op('cancelar itinerario', () => T.cancelarItinerario(svc.repo, usuario, String(i.itinerario_id), f.m)); }, 'Itinerario anulado; la capacidad de las salidas quedó libre.'); }}>Anular itinerario</BotonAccion>}
            </div>
            <div className="linea-itinerario" role="list" aria-label={`Etapas de ${i.pedido_id}`}>
              {tramos.map((t) => (
                <div key={t} className="tramo" role="listitem">
                  {i.etapas.filter((e) => Number(e.tramo) === t).map((e) => {
                    const est = String(e.estado);
                    return (
                      <div key={String(e.etapa_id)} className={'etapa-chip ' + est.toLowerCase()}>
                        <div className="etapa-tit">Tramo {t}{i.etapas.filter((x) => Number(x.tramo) === t).length > 1 ? ` · viaje ${e.viaje}` : ''} · {MODO[String(e.modo_id)] ?? String(e.modo_id)}</div>
                        <div>{String(e.nodo_origen_id)} → {String(e.nodo_destino_id)}{e.final ? ' (cliente)' : ''}</div>
                        <div className="nota">Sale {hora(String(e.salida))} · llega {hora(String(e.llegada))}</div>
                        <div className="nota">{fmtNum(Number(e.kg_bruto_mil) / 1000, 1)} kg{Number(e.bultos) ? ` · ${e.bultos} bultos` : ''} · {String(e.recurso)}</div>
                        <div className="estado-etapa">{({ PLANIFICADA: 'Planificada', DESPACHADA: 'En camino', RECIBIDA: 'Recibida en nodo', ENTREGADA: 'Entregada', CANCELADA: 'Cancelada' } as Record<string, string>)[est]}
                          {e.entregas.length > 0 && ` · ${e.entregas.map((x) => ({ TOTAL: 'aceptación total', PARCIAL: 'aceptación parcial', FALLIDO: 'intento fallido', EN_VERIFICACION: 'en verificación' } as Record<string, string>)[String(x.estado)]).join(', ')}`}</div>
                        <div className="botonera">
                          {est === 'PLANIFICADA' && <BotonAccion permiso="DESPACHAR" onClick={() => accion(async () => { await svc.op('despacho', () => T.despacharEtapa(svc.repo, usuario, String(e.etapa_id))); }, 'Etapa despachada: la carga está en camino.')}>Despachar</BotonAccion>}
                          {est === 'DESPACHADA' && !e.final && <BotonAccion permiso="DESPACHAR" onClick={() => setRec({ etapa: e, final: false, pedido: String(i.pedido_id) })}>Registrar recepción</BotonAccion>}
                          {est === 'DESPACHADA' && <BotonAccion permiso="DESPACHAR" onClick={() => setInc(e)}>Incidencia</BotonAccion>}
                          {est === 'DESPACHADA' && e.final === 1 && e.entregas.length === 0 && <BotonAccion permiso="DESPACHAR" onClick={() => setRec({ etapa: e, final: false, pedido: String(i.pedido_id) })}>Recibir en nodo de contingencia</BotonAccion>}
                          {e.final === 1 && e.en_transito.some((x) => x.q_mil > 0) && e.entregas.length > 0 && <BotonAccion permiso="DESPACHAR" onClick={() => setRet(e)}>Registrar retorno</BotonAccion>}
                          {e.final === 1 && (est === 'DESPACHADA' || (est === 'ENTREGADA' && e.en_transito.length > 0 && !e.entregas.some((x) => x.estado !== 'FALLIDO'))) && <BotonAccion primario permiso="DESPACHAR" onClick={() => setRec({ etapa: e, final: true, pedido: String(i.pedido_id) })}>Registrar entrega al cliente</BotonAccion>}
                          {e.entregas.filter((x) => x.estado === 'EN_VERIFICACION').map((x) => <BotonAccion key={String(x.entrega_id)} permiso="DESPACHAR" onClick={() => setVerif({ entrega_id: String(x.entrega_id), destino: String(pedido?.destino_id) })}>Confirmar verificación</BotonAccion>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {rec && <FormRecepcion e={rec.etapa} final={rec.final} pedido={rec.pedido} cerrar={() => setRec(null)} />}
      {inc && <FormIncidencia e={inc} cerrar={() => setInc(null)} />}
      {ret && <FormRetorno e={ret} cerrar={() => setRet(null)} />}
      {verif && <FormVerificacion entregaId={verif.entrega_id} destino={verif.destino} cerrar={() => setVerif(null)} />}
    </>
  );
}

function FormRecepcion({ e, final, pedido, cerrar }: { e: Record<string, unknown>; final: boolean; pedido: string; cerrar: () => void }) {
  const { svc, usuario, accion } = useApp();
  const carga = e.carga as Record<string, unknown>[];
  const transito = e.en_transito as { lote_id: string; q_mil: number }[];
  const destino = String(svc.repo.uno('SELECT destino_id FROM pedido WHERE pedido_id = ?', [pedido])!.destino_id);
  const receptores = T.receptoresVigentes(svc.repo, destino, svc.repo.reloj());
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(carga.flatMap((c) => { const q = transito.find((t) => t.lote_id === c.lote_id)?.q_mil ?? 0; return [[`a-${c.lote_id}`, fmtMil(q)], [`b-${c.lote_id}`, '0'], [`c-${c.lote_id}`, '0']]; })));
  const nodosCont = svc.repo.todos("SELECT nodo_id, tipo FROM nodo WHERE tipo IN ('ALMACEN','TRANSBORDO') AND activo = 1 ORDER BY nodo_id");
  const nodoInicial = nodosCont.some((n) => n.nodo_id === e.nodo_destino_id) ? String(e.nodo_destino_id) : String(e.nodo_origen_id);
  const [r, setR] = useState({ receptor: receptores[0]?.receptor_id ? String(receptores[0].receptor_id) : 'OTRO', nombre: '', metodo: 'Firma en constancia', ref: '', motivo: '', custodio: '', nodo: nodoInicial });
  const num = (k: string) => { const q = aMil(v[k] ?? '0'); if (q === null || Number.isNaN(q)) throw new Error('Revise las cantidades (coma decimal).'); return Number(q); };
  return (
    <Panel titulo={final ? 'Registrar entrega al cliente final' : 'Registrar recepción en nodo intermedio'} cerrar={cerrar}>
      <p className="nota">{final ? 'Solo una persona facultada, con evidencia, confirma la aceptación comercial. Si recibe otra persona o falta evidencia, la carga queda entregada físicamente «en verificación», sin venta. Lo rechazado sigue en el vehículo hasta su retorno.' : 'Registre lo que realmente llegó. Solo lo apto queda disponible para el siguiente tramo; la diferencia sigue en tránsito como investigación.'}</p>
      <table><thead><tr><th>Lote</th><th className="num">Viaja</th>{final ? <><th>Entregado</th><th>Rechazado</th></> : <><th>Apto</th><th>Cuarentena</th><th>Dañado</th></>}</tr></thead>
        <tbody>{carga.map((c) => (
          <tr key={String(c.lote_id)}><td>{String(c.codigo_lote)}</td><td className="num">{fmtMil(transito.find((t) => t.lote_id === c.lote_id)?.q_mil ?? 0)}</td>
            {(final ? ['a', 'b'] : ['a', 'b', 'c']).map((p) => <td key={p}><input className="corto" aria-label={`${p} ${c.codigo_lote}`} value={v[`${p}-${c.lote_id}`]} onChange={(ev) => setV({ ...v, [`${p}-${c.lote_id}`]: ev.target.value })} /></td>)}</tr>
        ))}</tbody></table>
      <div className="formulario">
        {final ? <>
          <Campo etiqueta="Quién recibe"><select value={r.receptor} onChange={(ev) => setR({ ...r, receptor: ev.target.value })}>{receptores.map((x) => <option key={String(x.receptor_id)} value={String(x.receptor_id)}>{String(x.nombre_ficticio)} (facultado)</option>)}<option value="OTRO">Otra persona (sin facultad registrada)</option></select></Campo>
          {r.receptor === 'OTRO' && <Campo etiqueta="Nombre de quien recibe"><input value={r.nombre} onChange={(ev) => setR({ ...r, nombre: ev.target.value })} /></Campo>}
          <Campo etiqueta="Evidencia: método"><select value={r.metodo} onChange={(ev) => setR({ ...r, metodo: ev.target.value })}><option>Firma en constancia</option><option>Fotografía con código del pedido</option><option>Código de confirmación</option><option value="">Sin evidencia</option></select></Campo>
          <Campo etiqueta="Evidencia: referencia (número de constancia o archivo)"><input value={r.ref} onChange={(ev) => setR({ ...r, ref: ev.target.value })} /></Campo>
          <Campo etiqueta="Motivo (obligatorio si no se entrega nada o hay rechazo)"><input value={r.motivo} onChange={(ev) => setR({ ...r, motivo: ev.target.value })} /></Campo>
        </> : <>
          <Campo etiqueta="Custodio que recibe en el nodo"><input value={r.custodio} onChange={(ev) => setR({ ...r, custodio: ev.target.value })} /></Campo>
          <Campo etiqueta="Dónde se recibe" ayuda="Si la carga no pudo llegar al nodo previsto (avería, cierre), elija el nodo real: el resto del itinerario se reemplaza y se replanifica desde allí."><select value={r.nodo} onChange={(ev) => setR({ ...r, nodo: ev.target.value })}>{nodosCont.map((n) => <option key={String(n.nodo_id)} value={String(n.nodo_id)}>{String(n.nodo_id)}{n.nodo_id === e.nodo_destino_id ? ' (previsto)' : ' — contingencia'}</option>)}</select></Campo>
        </>}
      </div>
      <div className="botonera"><BotonAccion primario permiso="DESPACHAR" onClick={() => accion(async () => {
        if (final) {
          const lineas = carga.map((c) => ({ pedido_linea_id: String(c.pedido_linea_id), lote_id: String(c.lote_id), entregado_mil: num(`a-${c.lote_id}`), rechazado_mil: num(`b-${c.lote_id}`) }));
          const x = await svc.op('entrega', () => T.registrarEntrega(svc.repo, usuario, String(e.etapa_id), { receptor_id: r.receptor === 'OTRO' ? null : r.receptor, receptor_nombre: r.receptor === 'OTRO' ? r.nombre : null, metodo_evidencia: r.metodo || null, evidencia_ref: r.ref || null, motivo: r.motivo || null, lineas }));
          cerrar();
          const est = { TOTAL: 'Entrega total aceptada', PARCIAL: 'Entrega parcial aceptada', FALLIDO: 'Intento fallido registrado; la carga sigue en el vehículo', EN_VERIFICACION: 'Entrega física registrada EN VERIFICACIÓN (sin venta)' }[x.resultado.estado];
          return `${est}. Aceptado ${fmtMil(x.resultado.aceptado_mil)}; en verificación ${fmtMil(x.resultado.en_verificacion_mil)}; rechazado en tránsito ${fmtMil(x.resultado.rechazado_en_transito_mil)}.${x.resultado.motivo ? ' Motivo: ' + x.resultado.motivo + '.' : ''}`;
        }
        const recibido = carga.map((c) => ({ lote_id: String(c.lote_id), apta_mil: num(`a-${c.lote_id}`), cuarentena_mil: num(`b-${c.lote_id}`), danada_mil: num(`c-${c.lote_id}`) }));
        const x = await svc.op('recepción', () => T.recibirEtapa(svc.repo, usuario, String(e.etapa_id), recibido, r.custodio, null, undefined, r.nodo));
        cerrar();
        return `Recepción registrada en ${x.resultado.nodo}: apto ${fmtMil(x.resultado.apto_mil)}${x.resultado.diferencia_en_investigacion_mil ? `; diferencia en investigación ${fmtMil(x.resultado.diferencia_en_investigacion_mil)} (sigue en tránsito)` : ''}.${x.resultado.contingencia ? ' Nodo de contingencia: el itinerario se reemplazó; replanifique desde «Planificar rutas».' : ''}`;
      })}>Registrar</BotonAccion><button onClick={cerrar}>Cancelar</button></div>
    </Panel>
  );
}

function FormVerificacion({ entregaId, destino, cerrar }: { entregaId: string; destino: string; cerrar: () => void }) {
  const { svc, usuario, accion } = useApp();
  const en = svc.repo.uno('SELECT ocurrido_en FROM entrega WHERE entrega_id = ?', [entregaId])!;
  const receptores = T.receptoresVigentes(svc.repo, destino, String(en.ocurrido_en));
  const [f, setF] = useState({ receptor: String(receptores[0]?.receptor_id ?? ''), metodo: 'Firma en constancia', ref: '' });
  return (
    <Panel titulo="Confirmar verificación de la entrega" cerrar={cerrar}>
      <p className="nota">Se confirma comercialmente la entrega física del {hora(String(en.ocurrido_en))}. La hora que cuenta es la de la entrega física (DEC-I01-D4).</p>
      <div className="formulario">
        <Campo etiqueta="Receptor facultado a esa hora"><select value={f.receptor} onChange={(e) => setF({ ...f, receptor: e.target.value })}>{receptores.map((x) => <option key={String(x.receptor_id)} value={String(x.receptor_id)}>{String(x.nombre_ficticio)}</option>)}</select></Campo>
        <Campo etiqueta="Método de evidencia"><select value={f.metodo} onChange={(e) => setF({ ...f, metodo: e.target.value })}><option>Firma en constancia</option><option>Fotografía con código del pedido</option><option>Código de confirmación</option></select></Campo>
        <Campo etiqueta="Referencia"><input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></Campo>
      </div>
      <div className="botonera"><BotonAccion primario permiso="DESPACHAR" onClick={() => accion(async () => { const r = await svc.op('verificación', () => T.verificarEntrega(svc.repo, usuario, entregaId, f.receptor, f.metodo, f.ref)); cerrar(); return `Entrega confirmada: ${fmtMil(r.resultado.aceptado_mil)} aceptados con la hora física ${hora(r.resultado.hora_fisica)}.`; })}>Confirmar</BotonAccion><button onClick={cerrar}>Cancelar</button></div>
    </Panel>
  );
}

function Red() {
  const { svc, usuario, accion, ver } = useApp();
  const ahora = svc.repo.reloj();
  const enlaces = useMemo(() => svc.repo.todos('SELECT * FROM enlace ORDER BY nodo_origen_id, nodo_destino_id').map((e) => Object.assign({}, e, { ef: T.estadoEnlace(svc.repo, String(e.enlace_id), ahora, ahora), salidas: svc.repo.num("SELECT COUNT(*) FROM servicio WHERE enlace_id = ? AND estado = 'PROGRAMADO' AND salida >= ?", [e.enlace_id, ahora]) })), [svc, ver]);
  const conds = useMemo(() => svc.repo.todos('SELECT * FROM condicion_acceso ORDER BY registrado_en DESC'), [svc, ver]);
  const [ensayo, setEnsayo] = useState<null | ReturnType<typeof O.ensayoContinuidad>>(null);
  return (
    <>
      <div className="barra">
        <BotonAccion permiso="PLANIFICAR" onClick={async () => { const f = await formulario('Cerrar un nodo por un período', [{ id: 'n', tipo: 'select', etiqueta: 'Nodo', opciones: svc.repo.todos("SELECT nodo_id, nombre, tipo FROM nodo WHERE tipo IN ('ALMACEN','TRANSBORDO') AND activo = 1 ORDER BY tipo, nodo_id").map((n) => ({ valor: String(n.nodo_id), texto: `${n.nodo_id} — ${n.nombre}` })) }, { id: 'd', tipo: 'fechaHora', etiqueta: 'Cerrado desde' }, { id: 'h', tipo: 'fechaHora', etiqueta: 'Cerrado hasta', despuesDe: 'd' }, { id: 'm', tipo: 'motivo', etiqueta: 'Motivo', opciones: ['Muelle o almacén en reparación', 'Bloqueo o conflicto social', 'Fenómeno climático', 'Disposición de la autoridad'] }, { id: 'fu', tipo: 'texto', etiqueta: 'Fuente (quién lo informa)', ejemplo: 'Capitanía de Puno', minLargo: 3 }], { explicacion: 'Se interrumpen todos los tramos que entran o salen del nodo durante ese intervalo y se listan los itinerarios afectados.', aceptar: 'Cerrar nodo' }); if (f) accion(async () => { const r = await svc.op('cierre de nodo', () => O.cerrarNodo(svc.repo, usuario, f.n, f.d, f.h, f.m, f.fu)); return `Nodo cerrado: ${r.enlaces} tramo(s) interrumpidos. Itinerarios afectados: ${r.afectados.map((a) => (a as { pedido_id: string }).pedido_id).join(', ') || 'ninguno'}.`; }); }}>Cerrar un nodo por un período</BotonAccion>
        <BotonAccion permiso="PLANIFICAR" onClick={async () => { const f = await formulario('Ensayo de continuidad', [{ id: 'n', tipo: 'select', etiqueta: '¿Qué pasaría si perdemos este nodo?', opciones: svc.repo.todos("SELECT nodo_id, nombre, tipo FROM nodo WHERE tipo IN ('ALMACEN','TRANSBORDO') AND activo = 1 ORDER BY tipo, nodo_id").map((n) => ({ valor: String(n.nodo_id), texto: `${n.nodo_id} — ${n.nombre}` })) }], { explicacion: 'Se simula su pérdida con la misma demanda reservada. No se modifica ningún dato.', aceptar: 'Ensayar' }); if (f) accion(async () => { const r = O.ensayoContinuidad(svc.repo, f.n, svc.repo.reloj(), '2027-12-31T00:00:00-05:00'); setEnsayo(r); return `Ensayo sin ${f.n}: ${r.alcanzables_ensayo} de ${r.pedidos} pedidos siguen alcanzables (hoy ${r.alcanzables_base}). No se modificó ningún dato.`; }); }}>Ensayo de continuidad</BotonAccion>
      </div>
      {ensayo && <div className="detalle"><h2>Ensayo: pérdida de {ensayo.nodo_id}</h2><p className="nota">{ensayo.limitacion}</p>
        <table><thead><tr><th>Pedido</th><th>Hoy</th><th>Sin el nodo</th><th className="num">Atraso (h)</th><th className="num">Costo extra</th></tr></thead>
          <tbody>{ensayo.detalle.map((d) => <tr key={d.pedido_id}><td>{d.pedido_id}</td><td>{d.base_factible ? 'Alcanzable' : 'No'}</td><td>{d.ensayo_factible ? 'Alcanzable' : <span className="motivo">No alcanzable</span>}</td><td className="num">{d.atraso_h ?? '—'}</td><td className="num">{d.costo_extra_cent === null ? '—' : fmtSoles(d.costo_extra_cent)}</td></tr>)}</tbody></table></div>}
      <p className="nota">Tramos dirigidos (la ida no implica la vuelta). El estado se aplica solo dentro de su vigencia; «Desconocido» nunca se trata como normal. El clima de un punto no prueba que una vía, río o lago esté transitable.</p>
      <table><thead><tr><th>Origen → destino</th><th>Medio</th><th className="num">Horas</th><th>Estado ahora</th><th>Fuente / motivo</th><th className="num">Salidas futuras</th><th></th></tr></thead>
        <tbody>{enlaces.map((e) => (
          <tr key={String(e.enlace_id)}><td>{String(e.nodo_origen_id)} → {String(e.nodo_destino_id)}</td><td>{MODO[String(e.modo_id)] ?? String(e.modo_id)}</td><td className="num">{fmtNum(Number(e.duracion_min) / 60, 1)}</td>
            <td><span className={'chip ' + claseEstado(String(e.ef.estado))}>{e.ef.estado}</span></td><td className="nota">{e.ef.fuente} — {e.ef.motivo}</td><td className="num">{String(e.salidas)}</td>
            <td><BotonAccion permiso="PLANIFICAR" onClick={async () => { const c = await formulario(`Condición de acceso: ${e.nodo_origen_id} → ${e.nodo_destino_id}`, [{ id: 'estado', tipo: 'opcion', etiqueta: 'Estado del tramo', inicial: 'INTERRUMPIDO', opciones: [{ valor: 'INTERRUMPIDO', texto: 'Interrumpido', detalle: 'No se puede usar en ese intervalo' }, { valor: 'RESTRINGIDO', texto: 'Restringido', detalle: 'Se puede usar con precaución' }, { valor: 'DESCONOCIDO', texto: 'Desconocido', detalle: 'Sin información confiable: no se planifica por él' }, { valor: 'NORMAL', texto: 'Normal', detalle: 'Confirmado como transitable' }] }, { id: 'desde', tipo: 'fechaHora', etiqueta: 'Vigente desde', rapidos: [{ texto: 'Ahora', horas: 0 }] }, { id: 'hasta', tipo: 'fechaHora', etiqueta: 'Vigente hasta', despuesDe: 'desde', rapidos: [{ texto: '+6 horas', horas: 6 }, { texto: '+1 día', horas: 24 }, { texto: '+1 semana', horas: 168 }] }, { id: 'motivo', tipo: 'motivo', etiqueta: 'Motivo', opciones: ['Huaico o deslizamiento', 'Estiaje (bajo caudal)', 'Oleaje o tormenta', 'Bloqueo o paro', 'Obra en la vía', 'Reapertura confirmada'] }, { id: 'fuente', tipo: 'texto', etiqueta: 'Fuente (quién lo informa)', ejemplo: 'Policía de carreteras, Capitanía, transportista', minLargo: 3 }], { aceptar: 'Guardar condición' }); if (!c) return; accion(async () => { const r = await svc.op('condición de acceso', () => T.registrarCondicion(svc.repo, usuario, { enlace_id: String(e.enlace_id), estado: c.estado, motivo: c.motivo, desde: c.desde, hasta: c.hasta, fuente: c.fuente })); return r.afectados.length ? `Condición registrada. Itinerarios afectados que deben replanificarse: ${r.afectados.map((a) => a.pedido_id).join(', ')}.` : 'Condición registrada. Ningún itinerario confirmado usa ese tramo en esa vigencia.'; }); }}>Registrar condición</BotonAccion></td></tr>
        ))}</tbody></table>
      <h2>Condiciones registradas</h2>
      <table><thead><tr><th>Tramo</th><th>Estado</th><th>Vigencia</th><th>Motivo</th><th>Fuente</th><th>Registrado</th></tr></thead>
        <tbody>{conds.map((c) => <tr key={String(c.condicion_id)}><td>{String(c.enlace_id).replace(/^E-/, '')}</td><td>{String(c.estado)}</td><td>{hora(String(c.vigente_desde))} – {hora(String(c.vigente_hasta))}</td><td>{String(c.motivo)}</td><td>{String(c.fuente)}</td><td>{hora(String(c.registrado_en))}</td></tr>)}</tbody></table>
    </>
  );
}
export { D };

function FormIncidencia({ e, cerrar }: { e: Record<string, unknown>; cerrar: () => void }) {
  const { svc, usuario, accion } = useApp();
  const carga = e.carga as Record<string, unknown>[];
  const [f, setF] = useState({ tipo: 'AVERIA', descripcion: '', lote: String(carga[0]?.lote_id ?? ''), q: '', custodio: '', ubicacion: '', retraso: '', costo: '', documento: '' });
  return (
    <Panel titulo="Registrar incidencia en ruta" cerrar={cerrar}>
      <p className="nota">La carga nunca «desaparece» ni salta de lugar: queda en tránsito bajo la custodia indicada hasta registrar su recepción (en el nodo previsto o en uno de contingencia), su retorno o su pérdida.</p>
      <div className="formulario">
        <Campo etiqueta="Tipo"><select value={f.tipo} onChange={(ev) => setF({ ...f, tipo: ev.target.value })}>{[['AVERIA', 'Avería del vehículo'], ['DETENCION', 'Detención (deslizamiento, bloqueo)'], ['RETRASO', 'Retraso'], ['PERDIDA', 'Pérdida de carga'], ['DANO', 'Daño de carga (se declara al recibir)'], ['SOBRECOSTO', 'Sobrecosto'], ['OTRO', 'Otro']].map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></Campo>
        <Campo etiqueta="Qué pasó" ayuda="Breve y concreto: qué, dónde y quién lo reporta."><input placeholder="Ej.: motor averiado a 3 km del muelle; reporta el patrón" value={f.descripcion} onChange={(ev) => setF({ ...f, descripcion: ev.target.value })} /></Campo>
        {['PERDIDA', 'DANO'].includes(f.tipo) && <>
          <Campo etiqueta="Lote"><select value={f.lote} onChange={(ev) => setF({ ...f, lote: ev.target.value })}>{carga.map((c) => <option key={String(c.lote_id)} value={String(c.lote_id)}>{String(c.codigo_lote)}</option>)}</select></Campo>
          <Campo etiqueta="Cantidad afectada"><input value={f.q} onChange={(ev) => setF({ ...f, q: ev.target.value })} /></Campo>
        </>}
        {['AVERIA', 'DETENCION'].includes(f.tipo) && <>
          <Campo etiqueta="Quién custodia la carga"><input value={f.custodio} onChange={(ev) => setF({ ...f, custodio: ev.target.value })} /></Campo>
          <Campo etiqueta="Dónde está"><input value={f.ubicacion} onChange={(ev) => setF({ ...f, ubicacion: ev.target.value })} /></Campo>
        </>}
        {['RETRASO', 'AVERIA', 'DETENCION'].includes(f.tipo) && <Campo etiqueta="Retraso estimado (horas)" ayuda="Número, por ejemplo 3 o 1,5"><input inputMode="decimal" value={f.retraso} onChange={(ev) => setF({ ...f, retraso: ev.target.value })} /></Campo>}
        {['SOBRECOSTO', 'AVERIA'].includes(f.tipo) && <><Campo etiqueta="Costo adicional (S/)"><input value={f.costo} onChange={(ev) => setF({ ...f, costo: ev.target.value })} /></Campo><Campo etiqueta="Comprobante"><input value={f.documento} onChange={(ev) => setF({ ...f, documento: ev.target.value })} /></Campo></>}
      </div>
      <div className="botonera"><BotonAccion primario permiso="DESPACHAR" onClick={() => accion(async () => {
        const q = f.q ? aMil(f.q) : 0, costo = f.costo ? aMil(f.costo) : 0;
        if (q === null || Number.isNaN(q) || costo === null || Number.isNaN(costo)) throw new Error('Revise las cantidades (coma decimal).');
        const r = await svc.op('incidencia', () => O.registrarIncidencia(svc.repo, usuario, { tipo: f.tipo as O.TipoIncidencia, etapa_id: String(e.etapa_id), descripcion: f.descripcion, lote_id: f.lote, q_mil: Number(q), custodio: f.custodio, ubicacion: f.ubicacion,
          retraso_min: f.retraso ? Math.round(Number(f.retraso.replace(',', '.')) * 60) : 0, costo_cent: Math.round(Number(costo) / 10), documento: f.documento || undefined }));
        cerrar();
        return `Incidencia registrada. ${r.resultado.custodia}.`;
      })}>Registrar</BotonAccion><button onClick={cerrar}>Cancelar</button></div>
    </Panel>
  );
}

function FormRetorno({ e, cerrar }: { e: Record<string, unknown>; cerrar: () => void }) {
  const { svc, usuario, accion } = useApp();
  const transito = (e.en_transito as { lote_id: string; q_mil: number }[]).filter((x) => x.q_mil > 0);
  const almacenes = svc.repo.todos("SELECT nodo_id FROM nodo WHERE tipo = 'ALMACEN' AND activo = 1 ORDER BY nodo_id");
  const [f, setF] = useState({ lote: transito[0]?.lote_id ?? '', q: fmtMil(transito[0]?.q_mil ?? 0), nodo: String(almacenes[0]?.nodo_id ?? ''), condicion: 'CUARENTENA', motivo: '', anuncio: false, documento: '' });
  return (
    <Panel titulo="Registrar retorno de lo no entregado" cerrar={cerrar}>
      <p className="nota">Lo rechazado o no entregado vuelve a un almacén en cuarentena (nunca como apto) y el pedido vuelve a mostrar ese saldo pendiente. Si solo tiene el aviso o la guía, márquelo como «anuncio»: no suma stock hasta recibirlo.</p>
      <div className="formulario">
        <Campo etiqueta="Lote"><select value={f.lote} onChange={(ev) => setF({ ...f, lote: ev.target.value, q: fmtMil(transito.find((x) => x.lote_id === ev.target.value)?.q_mil ?? 0) })}>{transito.map((t) => <option key={t.lote_id} value={t.lote_id}>{t.lote_id} — viaja {fmtMil(t.q_mil)}</option>)}</select></Campo>
        <Campo etiqueta="Cantidad"><input value={f.q} onChange={(ev) => setF({ ...f, q: ev.target.value })} /></Campo>
        <Campo etiqueta="Almacén que recibe"><select value={f.nodo} onChange={(ev) => setF({ ...f, nodo: ev.target.value })}>{almacenes.map((n) => <option key={String(n.nodo_id)}>{String(n.nodo_id)}</option>)}</select></Campo>
        <Campo etiqueta="Condición al llegar"><select value={f.condicion} onChange={(ev) => setF({ ...f, condicion: ev.target.value })}><option value="CUARENTENA">Cuarentena (revisar)</option><option value="DANADO">Dañado</option></select></Campo>
        <Campo etiqueta="Motivo"><select value={f.motivo} onChange={(ev) => setF({ ...f, motivo: ev.target.value })}><option value="">— Elija el motivo —</option>{['Rechazo del cliente', 'Cliente ausente o local cerrado', 'Dirección inaccesible', 'Producto con observaciones de calidad'].map((m) => <option key={m}>{m}</option>)}</select></Campo>
        <Campo etiqueta="Documento (guía)"><input value={f.documento} onChange={(ev) => setF({ ...f, documento: ev.target.value })} /></Campo>
        <label className="check"><input type="checkbox" checked={f.anuncio} onChange={(ev) => setF({ ...f, anuncio: ev.target.checked })} /> Solo anuncio (todavía no llegó)</label>
      </div>
      <div className="botonera"><BotonAccion primario permiso="DESPACHAR" onClick={() => accion(async () => {
        const q = aMil(f.q); if (q === null || Number.isNaN(q)) throw new Error('Revise la cantidad.');
        const r = await svc.op('retorno', () => O.registrarRetorno(svc.repo, usuario, { etapa_id: String(e.etapa_id), lote_id: f.lote, q_mil: Number(q), nodo_destino_id: f.nodo, condicion: f.condicion as 'CUARENTENA', motivo: f.motivo, documento: f.documento || undefined, solo_anuncio: f.anuncio }));
        cerrar();
        return r.resultado.estado === 'ANUNCIADO' ? 'Retorno anunciado: la carga sigue en tránsito hasta recibirla.' : `Retorno recibido en ${f.nodo} en ${f.condicion === 'DANADO' ? 'condición dañada' : 'cuarentena'}. El pedido vuelve a mostrar el saldo pendiente.`;
      })}>Registrar</BotonAccion><button onClick={cerrar}>Cancelar</button></div>
    </Panel>
  );
}
