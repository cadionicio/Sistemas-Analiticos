import { useEffect, useMemo, useState } from 'react';
import { useApp, Pestanas, BotonAccion, Campo, Panel, aMil, deLocal, claseEstado, formulario } from './comunes';
import { D, O, C, A, R } from './servicio';
import { fmtMil, fmtSoles } from '../core/util';

type Sub = 'alertas' | 'calidad' | 'conteos' | 'costos' | 'retornables';
const hora = (iso: unknown) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '—');
const num = (t: string) => { const q = aMil(t); if (q === null || Number.isNaN(q)) throw new Error('Revise la cantidad (use coma decimal).'); return Number(q); };

export function Control() {
  const { svc, usuario } = useApp();
  const items = ([['alertas', 'Alertas'], ['calidad', 'Calidad, retiros y devoluciones'], ['conteos', 'Conteos'], ['costos', 'Costos de transporte'], ['retornables', 'Envases retornables']] as [Sub, string][])
    .map(([id, nombre]) => ({ id, nombre, oculto: !svc.ve(usuario, `control.${id}`) }));
  const [elegida, setSub] = useState<Sub>('alertas');
  const sub = items.find((i) => i.id === elegida && !i.oculto) ? elegida : items.find((i) => !i.oculto)!.id;
  return (
    <section>
      <Pestanas etiqueta="Control" actual={sub} cambiar={setSub} items={items} />
      {sub === 'alertas' && <Alertas />}
      {sub === 'calidad' && <Calidad />}
      {sub === 'conteos' && <Conteos />}
      {sub === 'costos' && <Costos />}
      {sub === 'retornables' && <Retornables />}
    </section>
  );
}

// ------------------------------------------------------------------ Alertas
function Alertas() {
  const { svc, usuario, accion, ver } = useApp();
  const [r, setR] = useState<ReturnType<typeof A.evaluarAlertas> | null>(null);
  useEffect(() => { void svc.op('evaluación de alertas', () => setR(A.evaluarAlertas(svc.repo))); }, [svc]);
  const lista = useMemo(() => A.alertas(svc.repo), [svc, ver, r]);
  const usuarios = svc.usuarios().filter((u) => u.activo === 1);
  return (
    <>
      <div className="barra">
        <p className="nota">Las alertas se calculan dentro del sistema y nunca envían mensajes externos. «Reconocer» indica que ya la vio; la alerta sigue hasta que desaparece su causa. Se escala si vence su plazo o si es grave y no tiene responsable.</p>
        <BotonAccion onClick={() => accion(async () => { const x = await svc.op('evaluación de alertas', () => A.evaluarAlertas(svc.repo)); setR(x); return `Evaluadas: ${x.hechos} situación(es); ${x.nuevas} nueva(s), ${x.resueltas} resuelta(s) porque desapareció la causa, ${x.escaladas} escalada(s).`; })}>Evaluar ahora</BotonAccion>
      </div>
      {!lista.length ? <p className="vacio">No hay alertas vigentes.</p> : (
        <table><thead><tr><th>Gravedad</th><th>Situación</th><th>Estado</th><th>Responsable</th><th>Plazo</th><th>Episodio</th><th>Acciones</th></tr></thead>
          <tbody>{lista.map((a) => (
            <tr key={String(a.alerta_id)}>
              <td><span className={'chip ' + (a.severidad === 'ALTA' ? 'atrasado' : a.severidad === 'MEDIA' ? 'confirmado' : 'borrador')}>{String(a.severidad)}</span>{a.escalada ? <span className="chip atrasado">Escalada</span> : null}</td>
              <td>{String(a.mensaje)}{a.relacionadas ? <div className="nota">{a.relacionadas} alerta(s) relacionada(s) con {String(a.grupo)}</div> : null}{a.umbral ? <div className="nota">Umbral vigente al detectarla: {String(a.umbral)} (versión {String(a.version_parametro)})</div> : null}</td>
              <td>{({ ABIERTA: 'Abierta', RECONOCIDA: 'Reconocida', SILENCIADA: `Silenciada hasta ${hora(a.silencio_hasta)}` } as Record<string, string>)[String(a.estado)]}</td>
              <td>{String(a.responsable_id ?? '—')}</td><td>{hora(a.plazo)}</td><td>{String(a.episodio)}</td>
              <td className="botonera">
                {a.estado === 'ABIERTA' && <BotonAccion onClick={() => accion(async () => { await svc.op('reconocer alerta', () => A.accionAlerta(svc.repo, usuario, String(a.alerta_id), 'RECONOCER')); }, 'Alerta reconocida: sigue activa hasta que se resuelva la causa.')}>Reconocer</BotonAccion>}
                <BotonAccion onClick={async () => { const f = await formulario('Asignar responsable', [{ id: 'u', tipo: 'select', etiqueta: 'Persona responsable de atenderla', opciones: usuarios.filter((x) => x.usuario_id !== 'U00').map((x) => ({ valor: String(x.usuario_id), texto: String(x.nombre_ficticio) })) }], { explicacion: String(a.mensaje), aceptar: 'Asignar' }); if (f) accion(async () => { await svc.op('asignar alerta', () => A.accionAlerta(svc.repo, usuario, String(a.alerta_id), 'ASIGNAR', { responsable: f.u })); }, 'Responsable asignado.'); }}>Asignar</BotonAccion>
                <BotonAccion onClick={async () => { const f = await formulario('Silenciar alerta temporalmente', [{ id: 'm', tipo: 'motivo', etiqueta: 'Motivo', opciones: ['Investigación en curso', 'Esperando informe de laboratorio', 'Esperando respuesta del transportista', 'Situación conocida y bajo control'] }, { id: 'h', tipo: 'fechaHora', etiqueta: 'Silenciar hasta', futuro: true, rapidos: [{ texto: '+2 horas', horas: 2 }, { texto: '+8 horas', horas: 8 }, { texto: '+1 día', horas: 24 }, { texto: '+3 días', horas: 72 }], ayuda: 'Al llegar esa hora, si la causa sigue, la alerta vuelve a abrirse sola.' }], { explicacion: String(a.mensaje), aceptar: 'Silenciar' }); if (f) accion(async () => { await svc.op('silenciar alerta', () => A.accionAlerta(svc.repo, usuario, String(a.alerta_id), 'SILENCIAR', { motivo: f.m, hasta: f.h })); }, 'Alerta silenciada; se reactivará al vencer si la causa continúa.'); }}>Silenciar</BotonAccion>
                <BotonAccion onClick={async () => { const f = await formulario('Descartar alerta', [{ id: 'm', tipo: 'motivo', etiqueta: 'Por qué se descarta', opciones: ['Falsa alarma comprobada', 'Duplicada de otra alerta', 'Ya resuelta fuera del sistema'], detalleObligatorio: true }], { explicacion: 'Descartar no borra el hecho ni su historia. Indique la evidencia (informe, guía o persona que lo comprobó).', aceptar: 'Descartar' }); if (f) accion(async () => { await svc.op('descartar alerta', () => A.accionAlerta(svc.repo, usuario, String(a.alerta_id), 'DESCARTAR', { motivo: f.m })); }, 'Alerta descartada; el evento y su historia se conservan.'); }}>Descartar</BotonAccion>
              </td>
            </tr>
          ))}</tbody></table>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Calidad, retiros y devoluciones
function Calidad() {
  const { svc, usuario, accion, ver } = useApp();
  const retenido = useMemo(() => D.existencias(svc.repo).filter((e) => e.condicion !== 'APTO' && e.fisico_mil > 0 && e.tipo_nodo !== 'TRANSITO'), [svc, ver]);
  const retiros = useMemo(() => svc.repo.todos("SELECT * FROM bloqueo_lote ORDER BY registrado_en DESC"), [svc, ver]);
  const lotes = useMemo(() => svc.repo.todos(`SELECT l.lote_id, l.codigo_lote, l.producto_id, p.nombre_generico, l.fecha_vencimiento
    FROM lote l JOIN producto p USING (producto_id) WHERE EXISTS (SELECT 1 FROM movimiento m WHERE m.lote_id = l.lote_id) ORDER BY l.producto_id, l.codigo_lote`), [svc, ver]);
  const [dec, setDec] = useState<null | { lote_id: string; nodo_id: string; desde: string; max: number }>(null);
  const [bq, setBq] = useState<null | { lote_id: string; motivo: string; efecto: string }>(null);
  const [traza, setTraza] = useState<null | ReturnType<typeof O.trazabilidadLote>>(null);
  const [dev, setDev] = useState<null | { pedido: string; linea: string; lote: string; q: string; nodo: string; tipo: 'REPOSICION' | 'ANULACION'; motivo: string }>(null);
  const aceptadas = useMemo(() => svc.repo.todos(`SELECT en.pedido_id, d.pedido_linea_id, d.lote_id, SUM(d.aceptado_mil) q FROM entrega_detalle d JOIN entrega en USING (entrega_id) WHERE d.aceptado_mil > 0 GROUP BY 1,2,3 ORDER BY 1`), [svc, ver]);
  return (
    <>
      <h2>Mercadería retenida (cuarentena o dañada)</h2>
      <p className="nota">Lo que vuelve de un cliente, llega con observaciones o está en retiro queda retenido y no se puede vender ni prometer. Solo Supervisión decide, con evidencia, si vuelve a apto, queda dañado o se da de baja.</p>
      {!retenido.length ? <p className="vacio">No hay mercadería retenida.</p> : (
        <table><thead><tr><th>Lote</th><th>Producto</th><th>Ubicación</th><th>Condición</th><th className="num">Cantidad</th><th>Retiro</th><th></th></tr></thead>
          <tbody>{retenido.map((e) => (
            <tr key={e.lote_id + e.nodo_id + e.condicion}><td>{e.codigo_lote}</td><td>{e.producto_id}</td><td>{e.nodo_id}</td><td><span className={'chip ' + (e.condicion === 'DANADO' ? 'cancelado' : 'confirmado')}>{e.condicion === 'DANADO' ? 'Dañado' : 'Cuarentena'}</span></td>
              <td className="num">{fmtMil(e.fisico_mil)}</td><td>{retiros.some((b) => b.lote_id === e.lote_id && b.estado === 'ACTIVO') ? <span className="chip atrasado">En retiro</span> : '—'}</td>
              <td><BotonAccion permiso="APROBAR_AJUSTE" onClick={() => setDec({ lote_id: e.lote_id, nodo_id: e.nodo_id, desde: e.condicion, max: e.fisico_mil })}>Decidir calidad</BotonAccion></td></tr>
          ))}</tbody></table>
      )}
      <h2>Retiros y bloqueos de lote</h2>
      <div className="barra"><BotonAccion permiso="APROBAR_AJUSTE" onClick={() => setBq({ lote_id: String(lotes[0]?.lote_id ?? ''), motivo: '', efecto: '' })}>Bloquear un lote (retiro)</BotonAccion></div>
      {!retiros.length ? <p className="vacio">No hay retiros registrados.</p> : (
        <table><thead><tr><th>Lote</th><th>Motivo</th><th>Efecto desde</th><th>Registrado</th><th>Estado</th><th></th></tr></thead>
          <tbody>{retiros.map((b) => (
            <tr key={String(b.bloqueo_id)}><td>{String(b.lote_id)}</td><td>{String(b.motivo)}</td><td>{hora(b.efecto_desde)}</td><td>{hora(b.registrado_en)}</td><td><span className={'chip ' + (b.estado === 'ACTIVO' ? 'atrasado' : 'completado')}>{b.estado === 'ACTIVO' ? 'Activo' : 'Cerrado'}</span></td>
              <td className="botonera"><button onClick={() => setTraza(O.trazabilidadLote(svc.repo, String(b.lote_id), String(b.efecto_desde) < String(b.registrado_en) ? String(b.efecto_desde) : undefined))}>Ver dónde está</button>
                {b.estado === 'ACTIVO' && <BotonAccion permiso="APROBAR_AJUSTE" onClick={async () => { const f = await formulario('Cerrar el retiro', [{ id: 'c', tipo: 'motivo', etiqueta: 'Resultado del retiro', opciones: ['Lote liberado por laboratorio', 'Lote destruido con acta', 'Liberación parcial y destrucción del resto', 'Recuperado de clientes y destruido'], detalleObligatorio: true }], { explicacion: 'Solo se cierra si no queda nada del lote en camino, en verificación ni en cuarentena sin decisión.', aceptar: 'Cerrar retiro' }); if (f) accion(async () => { await svc.op('cerrar retiro', () => O.cerrarRetiro(svc.repo, usuario, String(b.bloqueo_id), f.c)); }, 'Retiro cerrado con todas las cantidades conciliadas.'); }}>Cerrar retiro</BotonAccion>}</td></tr>
          ))}</tbody></table>
      )}
      <h2>Devoluciones de clientes después de aceptar</h2>
      <p className="nota">«Reposición»: se vuelve a enviar (el pendiente se reabre una vez). «Anulación»: se reduce lo pedido, sin demanda nueva. La devolución entra en cuarentena.</p>
      {!aceptadas.length ? <p className="vacio">Aún no hay entregas aceptadas.</p> : (
        <table><thead><tr><th>Pedido</th><th>Lote</th><th className="num">Aceptado</th><th></th></tr></thead>
          <tbody>{aceptadas.map((a) => <tr key={String(a.pedido_linea_id) + a.lote_id}><td>{String(a.pedido_id)}</td><td>{String(a.lote_id)}</td><td className="num">{fmtMil(Number(a.q))}</td>
            <td><BotonAccion permiso="DESPACHAR" onClick={() => setDev({ pedido: String(a.pedido_id), linea: String(a.pedido_linea_id), lote: String(a.lote_id), q: '', nodo: 'ALM-AQP', tipo: 'REPOSICION', motivo: '' })}>Registrar devolución</BotonAccion></td></tr>)}</tbody></table>
      )}

      {dec && <Panel titulo="Decisión de calidad" cerrar={() => setDec(null)}><FormDecision d={dec} cerrar={() => setDec(null)} /></Panel>}
      {bq && <Panel titulo="Bloquear lote (retiro de calidad)" cerrar={() => setBq(null)}>
        <p className="nota">Todo lo apto del lote en almacenes y puntos de transbordo pasa a cuarentena; se liberan sus reservas y se detienen los planes no ejecutados. Lo que ya viaja no se entrega comercialmente. Se necesita un lote identificado: un aviso sin lote se registra como alerta.</p>
        <div className="formulario">
          <Campo etiqueta="Lote"><select value={bq.lote_id} onChange={(e) => setBq({ ...bq, lote_id: e.target.value })}>{lotes.map((l) => <option key={String(l.lote_id)} value={String(l.lote_id)}>{String(l.codigo_lote)} — {String(l.producto_id)} {String(l.nombre_generico)} — vence {String(l.fecha_vencimiento)}</option>)}</select></Campo>
          <Campo etiqueta="Motivo"><select value={bq.motivo} onChange={(e) => setBq({ ...bq, motivo: e.target.value })}><option value="">— Elija el motivo —</option>{['Aviso de laboratorio: posible contaminación', 'Reclamo de cliente por calidad', 'Retiro ordenado por la autoridad sanitaria', 'Falla en el proceso de producción del lote'].map((m) => <option key={m}>{m}</option>)}</select></Campo>
          <Campo etiqueta="Efecto desde (opcional, si es anterior a hoy)"><input type="datetime-local" value={bq.efecto} onChange={(e) => setBq({ ...bq, efecto: e.target.value })} /></Campo>
        </div>
        <div className="botonera"><BotonAccion primario permiso="APROBAR_AJUSTE" onClick={() => accion(async () => {
          const r = await svc.op('bloqueo de lote', () => O.bloquearLote(svc.repo, usuario, { lote_id: bq.lote_id, motivo: bq.motivo, efecto_desde: bq.efecto ? deLocal(bq.efecto) : undefined }));
          setBq(null); setTraza(r.resultado.traza);
          return `Lote bloqueado. Pedidos afectados: ${r.resultado.pedidos_afectados.join(', ') || 'ninguno'}; itinerarios detenidos: ${r.resultado.itinerarios_detenidos}. En camino: ${fmtMil(r.resultado.traza.resumen.en_camino_mil)}; en clientes: ${fmtMil(r.resultado.traza.resumen.en_cliente_mil)}.`;
        })}>Bloquear</BotonAccion></div>
      </Panel>}
      {traza && <Panel titulo={`Dónde está el lote ${traza.lote_id}`} cerrar={() => setTraza(null)}>
        <div className="resumen-traza">
          <span>Apto en almacenes: <strong>{fmtMil(traza.resumen.fisico_apto_mil)}</strong></span><span>Retenido: <strong>{fmtMil(traza.resumen.fisico_retenido_mil)}</strong></span>
          <span>En camino: <strong>{fmtMil(traza.resumen.en_camino_mil)}</strong></span><span>Aceptado por clientes: <strong>{fmtMil(traza.resumen.en_cliente_mil)}</strong></span>
        </div>
        <h3>Ubicaciones</h3><ul>{traza.ubicaciones.map((u, i) => <li key={i}>{String(u.nodo_id)} · {String(u.condicion).toLowerCase()} · {fmtMil(Number(u.q_mil))}</li>)}</ul>
        <h3>En camino</h3>{traza.en_camino.length ? <ul>{traza.en_camino.map((e) => <li key={String(e.etapa_id)}>{String(e.pedido_id)} · {String(e.nodo_origen_id)} → {String(e.nodo_destino_id)} · {fmtMil(e.q_mil)} · {String(e.recurso_id)}</li>)}</ul> : <p className="nota">Nada.</p>}
        <h3>Clientes que lo recibieron</h3>{traza.aceptado_por_clientes.length ? <ul>{traza.aceptado_por_clientes.map((a) => <li key={String(a.pedido_id)}>{String(a.pedido_id)} · {String(a.cliente_id)} · {String(a.destino_id)} · {fmtMil(Number(a.q_mil))} (aceptado {hora(a.ultima)})</li>)}</ul> : <p className="nota">Ninguno.</p>}
        {traza.despachos_en_intervalo.length > 0 && <><h3>Despachos ocurridos desde el efecto del bloqueo</h3><ul>{traza.despachos_en_intervalo.map((d, i) => <li key={i}>{String(d.etapa_id)} · {hora(d.ocurrido_en)} · {fmtMil(Number(d.q_mil))}</li>)}</ul></>}
      </Panel>}
      {dev && <Panel titulo={`Devolución — ${dev.pedido}`} cerrar={() => setDev(null)}>
        <div className="formulario">
          <Campo etiqueta="Cantidad devuelta" ayuda="Unidad base del producto; no puede superar lo aceptado de ese lote."><input inputMode="decimal" value={dev.q} onChange={(e) => setDev({ ...dev, q: e.target.value })} /></Campo>
          <Campo etiqueta="Almacén que recibe"><select value={dev.nodo} onChange={(e) => setDev({ ...dev, nodo: e.target.value })}>{svc.repo.todos("SELECT nodo_id FROM nodo WHERE tipo = 'ALMACEN' ORDER BY 1").map((n) => <option key={String(n.nodo_id)}>{String(n.nodo_id)}</option>)}</select></Campo>
          <Campo etiqueta="Tipo"><select value={dev.tipo} onChange={(e) => setDev({ ...dev, tipo: e.target.value as 'REPOSICION' })}><option value="REPOSICION">Reposición (se vuelve a enviar)</option><option value="ANULACION">Anulación (se reduce lo pedido)</option></select></Campo>
          <Campo etiqueta="Motivo"><select value={dev.motivo} onChange={(e) => setDev({ ...dev, motivo: e.target.value })}><option value="">— Elija el motivo —</option>{['Producto con humedad o daño', 'Producto o presentación equivocada', 'Exceso sobre lo pedido', 'Vencimiento próximo'].map((m) => <option key={m}>{m}</option>)}</select></Campo>
        </div>
        <div className="botonera"><BotonAccion primario permiso="DESPACHAR" onClick={() => accion(async () => { await svc.op('devolución', () => O.registrarDevolucion(svc.repo, usuario, { pedido_linea_id: dev.linea, lote_id: dev.lote, q_mil: num(dev.q), nodo_destino_id: dev.nodo, tipo: dev.tipo, motivo: dev.motivo })); setDev(null); }, 'Devolución registrada en cuarentena.')}>Registrar</BotonAccion></div>
      </Panel>}
    </>
  );
}

function FormDecision({ d, cerrar }: { d: { lote_id: string; nodo_id: string; desde: string; max: number }; cerrar: () => void }) {
  const { svc, usuario, accion } = useApp();
  const [f, setF] = useState({ q: fmtMil(d.max), hacia: 'APTO', evidencia: '' });
  return (<>
    <p className="nota">{d.lote_id} en {d.nodo_id}: {fmtMil(d.max)} en {d.desde === 'DANADO' ? 'condición dañada' : 'cuarentena'}. Puede decidir solo una parte (por ejemplo, lo que el laboratorio liberó).</p>
    <div className="formulario">
      <Campo etiqueta="Cantidad"><input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></Campo>
      <Campo etiqueta="Decisión"><select value={f.hacia} onChange={(e) => setF({ ...f, hacia: e.target.value })}><option value="APTO">Liberar como apto</option><option value="DANADO">Pasar a dañado</option><option value="BAJA">Dar de baja (destrucción)</option></select></Campo>
      <Campo etiqueta="Evidencia (informe, análisis, acta)"><input value={f.evidencia} onChange={(e) => setF({ ...f, evidencia: e.target.value })} /></Campo>
    </div>
    <div className="botonera"><BotonAccion primario permiso="APROBAR_AJUSTE" onClick={() => accion(async () => { await svc.op('decisión de calidad', () => O.decidirCalidad(svc.repo, usuario, { lote_id: d.lote_id, nodo_id: d.nodo_id, q_mil: num(f.q), desde: d.desde as 'CUARENTENA', hacia: f.hacia as 'APTO', evidencia: f.evidencia })); cerrar(); }, 'Decisión de calidad registrada.')}>Guardar decisión</BotonAccion></div>
  </>);
}

// ------------------------------------------------------------------ Conteos
function Conteos() {
  const { svc, usuario, accion, ver } = useApp();
  const ex = useMemo(() => D.existencias(svc.repo).filter((e) => e.tipo_nodo === 'ALMACEN' && e.fisico_mil > 0), [svc, ver]);
  const conteos = useMemo(() => svc.repo.todos('SELECT * FROM conteo ORDER BY registrado_en DESC LIMIT 50'), [svc, ver]);
  const [f, setF] = useState({ clave: ex[0] ? `${ex[0].nodo_id}|${ex[0].lote_id}|${ex[0].condicion}` : '', contado: '' });
  const [nodo, lote, cond] = f.clave.split('|');
  return (
    <>
      <p className="nota">Registre lo contado físicamente. Si hay diferencia, primero se recuenta; si el recuento la confirma, se solicita un ajuste que aprueba otra persona (Supervisión). El conteo compara con el saldo a la hora del corte: lo movido después no cuenta.</p>
      <div className="formulario">
        <Campo etiqueta="Lote · almacén · condición"><select value={f.clave} onChange={(e) => setF({ ...f, clave: e.target.value })}>{ex.map((e) => <option key={e.nodo_id + e.lote_id + e.condicion} value={`${e.nodo_id}|${e.lote_id}|${e.condicion}`}>{e.codigo_lote} ({e.producto_id}) · {e.nodo_id} · {e.condicion.toLowerCase()}</option>)}</select></Campo>
        <Campo etiqueta="Cantidad contada" ayuda="En la unidad base del producto (kg para granel, unidades para sacos). El saldo del sistema no se muestra para no influir en el conteo."><input inputMode="decimal" value={f.contado} onChange={(e) => setF({ ...f, contado: e.target.value })} /></Campo>
        <BotonAccion primario permiso="SOLICITAR_AJUSTE" onClick={() => accion(async () => { const r = await svc.op('conteo', () => O.registrarConteo(svc.repo, usuario, { nodo_id: nodo, lote_id: lote, condicion: cond, contado_mil: num(f.contado) })); setF({ ...f, contado: '' }); return `Sistema: ${fmtMil(r.sistema_mil)}; diferencia ${fmtMil(r.diferencia_mil)}. ${r.siguiente}.`; })}>Registrar conteo</BotonAccion>
      </div>
      <table><thead><tr><th>Corte</th><th>Almacén</th><th>Lote</th><th className="num">Contado</th><th className="num">Sistema</th><th className="num">Diferencia</th><th>Estado</th><th></th></tr></thead>
        <tbody>{conteos.map((c) => (
          <tr key={String(c.conteo_id)}><td>{hora(c.corte)}</td><td>{String(c.nodo_id)}</td><td>{String(c.lote_id)}</td><td className="num">{fmtMil(Number(c.contado_mil))}</td><td className="num">{fmtMil(Number(c.sistema_mil))}</td><td className="num">{fmtMil(Number(c.diferencia_mil))}</td>
            <td>{({ SIN_DIFERENCIA: 'Sin diferencia', RECUENTO: 'Requiere recuento', PENDIENTE: 'Diferencia confirmada', AJUSTE_SOLICITADO: 'Ajuste solicitado', RESUELTO: 'Resuelto' } as Record<string, string>)[String(c.estado)]}</td>
            <td className="botonera">
              {c.estado === 'RECUENTO' && <BotonAccion permiso="SOLICITAR_AJUSTE" onClick={async () => { const f = await formulario('Recuento', [{ id: 'q', tipo: 'numero', etiqueta: 'Cantidad contada en el recuento', unidad: 'unidad base' }], { explicacion: `${c.lote_id} en ${c.nodo_id}: el primer conteo dio ${fmtMil(Number(c.contado_mil))} y el sistema tenía ${fmtMil(Number(c.sistema_mil))}. Cuente de nuevo, idealmente otra persona.`, aceptar: 'Registrar recuento' }); if (f) accion(async () => { const r = await svc.op('recuento', () => O.registrarConteo(svc.repo, usuario, { nodo_id: String(c.nodo_id), lote_id: String(c.lote_id), condicion: String(c.condicion), contado_mil: Number(f.q), corte: String(c.corte), recuento_de: String(c.conteo_id) })); return `Recuento: diferencia ${fmtMil(r.diferencia_mil)}. ${r.siguiente}.`; }); }}>Recontar</BotonAccion>}
              {c.estado === 'PENDIENTE' && <BotonAccion permiso="SOLICITAR_AJUSTE" onClick={async () => { const f = await formulario('Solicitar ajuste por diferencia de conteo', [{ id: 'm', tipo: 'motivo', etiqueta: 'Causa probable', opciones: Number(c.diferencia_mil) < 0 ? ['Faltante en conteo físico', 'Merma por manipulación', 'Error de registro previo'] : ['Sobrante en conteo físico', 'Error de registro previo'] }], { explicacion: `Diferencia confirmada: ${fmtMil(Number(c.diferencia_mil))}. El ajuste lo aprueba otra persona (Supervisión).`, aceptar: 'Solicitar' }); if (f) accion(async () => { await svc.op('ajuste por conteo', () => O.solicitarAjustePorConteo(svc.repo, usuario, String(c.conteo_id), f.m)); }, 'Ajuste solicitado: lo aprueba Supervisión en Operación → Ajustes.'); }}>Solicitar ajuste</BotonAccion>}
            </td></tr>
        ))}</tbody></table>
    </>
  );
}

// ------------------------------------------------------------------ Costos
function Costos() {
  const { svc, usuario, accion, ver } = useApp();
  const servicios = useMemo(() => svc.repo.todos(`SELECT DISTINCT s.servicio_id, s.salida, s.estado, en.nodo_origen_id, en.nodo_destino_id, en.modo_id,
      (SELECT GROUP_CONCAT(DISTINCT i.pedido_id) FROM etapa e JOIN itinerario i USING (itinerario_id) WHERE e.servicio_id = s.servicio_id AND e.estado <> 'CANCELADA') pedidos
    FROM servicio s JOIN enlace en USING (enlace_id) WHERE s.servicio_id IN (SELECT servicio_id FROM etapa WHERE estado <> 'CANCELADA') OR s.servicio_id IN (SELECT servicio_id FROM cargo_transporte) ORDER BY s.salida`), [svc, ver]);
  const pedidosConPlan = useMemo(() => svc.repo.todos("SELECT DISTINCT pedido_id FROM itinerario WHERE estado <> 'CANCELADO' ORDER BY 1").map((x) => C.costoPedido(svc.repo, String(x.pedido_id))), [svc, ver]);
  const [sel, setSel] = useState<string | null>(null);
  const [f, setF] = useState({ doc: '', concepto: 'FLETE', importe: '', moneda: 'PEN', tasa: '', incluido: false, noReemb: false });
  const c = sel ? C.costoServicio(svc.repo, sel) : null;
  return (
    <>
      <p className="nota">El costo estimado se calcula al planificar; el real se registra con el comprobante del transportista. Un mismo comprobante y concepto no se cargan dos veces. El costo de una salida compartida se reparte por kg con una regla fija de centavos. Costo por kg = todo lo devengado / kg aceptados.</p>
      <h2>Costo por pedido</h2>
      {!pedidosConPlan.length ? <p className="vacio">Aún no hay pedidos planificados.</p> : (
        <table><thead><tr><th>Pedido</th><th className="num">Estimado</th><th className="num">Devengado</th><th>Base</th><th className="num">Costo por kg aceptado</th></tr></thead>
          <tbody>{pedidosConPlan.map((p) => <tr key={p.pedido_id}><td>{p.pedido_id}</td><td className="num">{fmtSoles(p.estimado_cent)}</td><td className="num">{fmtSoles(p.devengado_cent)}</td><td>{p.base}</td><td className="num">{p.costo_por_kg_aceptado_cent === null ? 'N/D (sin aceptación)' : fmtSoles(p.costo_por_kg_aceptado_cent)}</td></tr>)}</tbody></table>
      )}
      <h2>Salidas usadas</h2>
      <table><thead><tr><th>Salida</th><th>Pedidos que la usan</th><th>Tramo</th><th>Estado</th><th></th></tr></thead>
        <tbody>{servicios.map((s) => <tr key={String(s.servicio_id)} className={sel === s.servicio_id ? 'seleccionada' : ''}><td>{hora(s.salida)}</td><td>{String(s.pedidos ?? '—')}</td><td>{String(s.nodo_origen_id)} → {String(s.nodo_destino_id)} ({String(s.modo_id)})</td><td>{String(s.estado)}</td><td><button onClick={() => setSel(String(s.servicio_id))}>Ver costo</button></td></tr>)}</tbody></table>
      {c && <div className="detalle">
        <h2>Salida {c.servicio_id}</h2>
        <p>Estimado <strong>{fmtSoles(c.estimado_cent)}</strong> · Real <strong>{c.real_cent === null ? 'sin comprobante' : fmtSoles(c.real_cent)}</strong>{c.variacion_cent !== null && <> · Variación <strong>{fmtSoles(c.variacion_cent)}</strong></>}</p>
        {c.por_concepto.length > 0 && <table><thead><tr><th>Concepto</th><th className="num">Real</th><th className="num">Incluido en tarifa (no suma)</th></tr></thead><tbody>{c.por_concepto.map((x) => <tr key={x.concepto}><td>{x.concepto}</td><td className="num">{fmtSoles(x.real_cent)}</td><td className="num">{fmtSoles(x.incluido_en_tarifa_cent)}</td></tr>)}</tbody></table>}
        <h3>Registrar comprobante</h3>
        <div className="formulario">
          <Campo etiqueta="Número de comprobante" ayuda="Tal como figura en la factura del transportista"><input placeholder="Ej.: F001-000123" value={f.doc} onChange={(e) => setF({ ...f, doc: e.target.value })} /></Campo>
          <Campo etiqueta="Concepto"><select value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })}>{['FLETE', 'ESPERA', 'MANIPULACION', 'TRANSBORDO', 'PEAJE', 'RECARGO', 'PENALIDAD', 'OTRO'].map((x) => <option key={x}>{x}</option>)}</select></Campo>
          <Campo etiqueta={`Importe (${f.moneda === 'PEN' ? 'S/' : 'US$'})`} ayuda="Use coma decimal, por ejemplo 850,50"><input inputMode="decimal" value={f.importe} onChange={(e) => setF({ ...f, importe: e.target.value })} /></Campo>
          <Campo etiqueta="Moneda"><select value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value })}><option>PEN</option><option>USD</option></select></Campo>
          {f.moneda !== 'PEN' && <Campo etiqueta="Tipo de cambio a soles (fecha y fuente en el comprobante)"><input value={f.tasa} onChange={(e) => setF({ ...f, tasa: e.target.value })} /></Campo>}
          <label className="check"><input type="checkbox" checked={f.incluido} onChange={(e) => setF({ ...f, incluido: e.target.checked })} /> Ya incluido en la tarifa integral</label>
          <label className="check"><input type="checkbox" checked={f.noReemb} onChange={(e) => setF({ ...f, noReemb: e.target.checked })} /> No reembolsable</label>
        </div>
        <div className="botonera"><BotonAccion primario permiso="PLANIFICAR" onClick={() => accion(async () => {
          const imp = aMil(f.importe); if (imp === null || Number.isNaN(imp)) throw new Error('Importe inválido.');
          const tasa = f.moneda === 'PEN' ? undefined : Math.round(Number(f.tasa.replace(',', '.')) * 1e6);
          await svc.op('cargo de transporte', () => C.registrarCargo(svc.repo, usuario, { documento_ref: f.doc, concepto: f.concepto, servicio_id: c.servicio_id, importe_cent: Math.round(Number(imp) / 10), moneda: f.moneda, tasa_pen_p6: tasa, incluido_en_tarifa: f.incluido, no_reembolsable: f.noReemb }));
          setF({ ...f, doc: '', importe: '' });
        }, 'Comprobante registrado.')}>Registrar comprobante</BotonAccion></div>
      </div>}
    </>
  );
}

// ------------------------------------------------------------------ Envases retornables
function Retornables() {
  const { svc, usuario, accion, ver } = useApp();
  const activos = useMemo(() => svc.repo.todos('SELECT * FROM activo_retornable ORDER BY tipo, activo_id'), [svc, ver]);
  const pedidosAbiertos = useMemo(() => D.pedidos(svc.repo).filter((p) => ['En atención', 'Completado', 'Reservado'].includes(p.estado)).map((p) => p.pedido_id), [svc, ver]);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [pedido, setPedido] = useState('');
  return (
    <>
      <p className="nota">Pallets y contenedores son activos de la empresa, separados del alimento: venderlo no los vende. Un comprobante de devolución solo «anuncia»; el activo vuelve a la custodia de la empresa cuando se recibe físicamente, y si llega dudoso queda en revisión hasta inspeccionarlo.</p>
      <div className="barra">
        <label className="filtro">Pedido <select value={pedido} onChange={(e) => setPedido(e.target.value)}><option value="">— elegir —</option>{pedidosAbiertos.map((p) => <option key={p}>{p}</option>)}</select></label>
        <BotonAccion permiso="DESPACHAR" onClick={() => accion(async () => { if (!pedido || !marcados.length) throw new Error('Marque los activos y elija el pedido.'); const r = await svc.op('entrega de retornables', () => R.entregarActivos(svc.repo, usuario, { activos: marcados, pedido_id: pedido })); setMarcados([]); return `${r.entregados} activo(s) quedan en custodia de ${r.cliente} con devolución pendiente.`; })}>Entregar marcados con el pedido</BotonAccion>
      </div>
      <table><thead><tr><th></th><th>Activo</th><th>Tipo</th><th>Propietario</th><th>Dónde está</th><th>Condición</th><th>Acciones</th></tr></thead>
        <tbody>{activos.map((a) => (
          <tr key={String(a.activo_id)}>
            <td><input type="checkbox" aria-label={`Marcar ${a.activo_id}`} disabled={a.ubicacion_tipo !== 'NODO' || a.condicion !== 'DISPONIBLE'} checked={marcados.includes(String(a.activo_id))} onChange={(e) => setMarcados(e.target.checked ? [...marcados, String(a.activo_id)] : marcados.filter((x) => x !== a.activo_id))} /></td>
            <td>{String(a.activo_id)}</td><td>{String(a.tipo)}</td><td>{String(a.propietario)}</td><td>{a.ubicacion_tipo === 'CLIENTE' ? `Cliente ${a.ubicacion_id}` : String(a.ubicacion_id)}</td>
            <td><span className={'chip ' + claseEstado(String(a.condicion) === 'DISPONIBLE' ? 'Completado' : String(a.condicion) === 'REVISION' ? 'Confirmado' : 'Cancelado')}>{({ DISPONIBLE: 'Disponible', REVISION: 'En revisión', DANADO: 'Dañado', BAJA: 'Baja' } as Record<string, string>)[String(a.condicion)]}</span></td>
            <td className="botonera">
              {a.ubicacion_tipo === 'CLIENTE' && <>
                <BotonAccion permiso="DESPACHAR" onClick={async () => { const f = await formulario('Anunciar retorno del envase', [{ id: 'd', tipo: 'texto', etiqueta: 'Documento del aviso (guía, mensaje, acta)', ejemplo: 'Guía 0045' }, { id: 'n', tipo: 'select', etiqueta: 'Almacén al que volverá', opciones: svc.repo.todos("SELECT nodo_id, nombre FROM nodo WHERE tipo = 'ALMACEN' AND activo = 1 ORDER BY nodo_id").map((n) => ({ valor: String(n.nodo_id), texto: `${n.nodo_id} — ${n.nombre}` })) }], { explicacion: 'El anuncio no cambia la custodia: el envase sigue a cargo del cliente hasta que se reciba físicamente.', aceptar: 'Anunciar' }); if (f) accion(async () => { const r = await svc.op('anuncio de retorno', () => R.retornarActivo(svc.repo, usuario, { activo_id: String(a.activo_id), desde_cliente: String(a.ubicacion_id), nodo_id: f.n, recibido: false, documento: f.d })); return r.mensaje; }); }}>Anunciar retorno</BotonAccion>
                <BotonAccion permiso="DESPACHAR" onClick={async () => { const f = await formulario(`Recibir ${a.activo_id}`, [{ id: 'n', tipo: 'select', etiqueta: 'Almacén que lo recibe', opciones: svc.repo.todos("SELECT nodo_id, nombre FROM nodo WHERE tipo = 'ALMACEN' AND activo = 1 ORDER BY nodo_id").map((n) => ({ valor: String(n.nodo_id), texto: `${n.nodo_id} — ${n.nombre}` })) }, { id: 'c', tipo: 'opcion', etiqueta: 'Estado al llegar', opciones: [{ valor: 'DISPONIBLE', texto: 'En buen estado', detalle: 'Queda disponible para reutilizar' }, { valor: 'REVISION', texto: 'Dudoso o con daño visible', detalle: 'Queda en revisión: no se reutiliza hasta inspeccionarlo' }] }], { aceptar: 'Recibir' }); if (f) accion(async () => { await svc.op('recepción de retornable', () => R.retornarActivo(svc.repo, usuario, { activo_id: String(a.activo_id), desde_cliente: String(a.ubicacion_id), nodo_id: f.n, recibido: true, condicion: f.c as 'DISPONIBLE' })); }, f.c === 'DISPONIBLE' ? 'Activo recibido y disponible.' : 'Activo recibido en revisión: no se reutiliza hasta inspeccionarlo.'); }}>Recibir</BotonAccion>
              </>}
              {a.ubicacion_tipo === 'NODO' && a.condicion === 'REVISION' && <BotonAccion permiso="APROBAR_AJUSTE" onClick={async () => { const f = await formulario(`Inspeccionar ${a.activo_id}`, [{ id: 'c', tipo: 'opcion', etiqueta: 'Resultado', opciones: [{ valor: 'DISPONIBLE', texto: 'Apto para reutilizar' }, { valor: 'DANADO', texto: 'Dañado (no se reutiliza)' }, { valor: 'BAJA', texto: 'Dar de baja' }] }, { id: 'e', tipo: 'texto', etiqueta: 'Evidencia de la inspección', ejemplo: 'Acta de inspección 12, foto F-33', minLargo: 5 }], { aceptar: 'Guardar inspección' }); if (f) accion(async () => { await svc.op('inspección de retornable', () => R.inspeccionarActivo(svc.repo, usuario, String(a.activo_id), f.c as 'DISPONIBLE', f.e)); }, 'Inspección registrada.'); }}>Inspeccionar</BotonAccion>}
            </td>
          </tr>
        ))}</tbody></table>
    </>
  );
}
