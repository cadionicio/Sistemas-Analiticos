import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import logoSvg from '../assets/alprosa_vectorizado.svg?raw';
import type { Servicio, OpcionesExportacion } from './servicio';
import { D, P, S, M, E, BUILD } from './servicio';
import { AppCtx, BotonAccion, DialogoHost, Protector, PanelProgreso, CampoFecha, type Ctx } from './comunes';
import { HISTORIA_CORTE } from '../core/historia';
import { Ingreso, CambioPin } from './Ingreso';
import { Operacion } from './Operacion';
import { Datos } from './Datos';
import { Planificacion } from './Planificacion';
import { Control } from './Control';
import { Analitica } from './Analitica';
import { fmtMil, fmtSoles, fmtNum } from '../core/util';
import { ETIQUETA } from '../core/exportar';

type Area = 'inicio' | 'operacion' | 'planificacion' | 'control' | 'analitica' | 'resultados' | 'datos';

async function logoPng(): Promise<Uint8Array | undefined> {
  try {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logoSvg);
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 899 * 1.5; c.height = 105 * 1.5;
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const blob: Blob = await new Promise((ok) => c.toBlob((b) => ok(b!), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } catch { return undefined; }
}

const INACTIVIDAD_MIN = 20;

export default function App({ svc }: { svc: Servicio }) {
  const [sesion, setSesion] = useState<{ usuario: string; motivo?: string } | null>(null);
  const [salida, setSalida] = useState<string | null>(null);
  if (!sesion) return <Ingreso svc={svc} mensaje={salida ?? svc.errorInicio ?? null} entrar={(u) => { setSalida(null); setSesion({ usuario: u }); }} />;
  return <Principal key={sesion.usuario} svc={svc} usuario={sesion.usuario} salir={(m) => { setSalida(m ?? null); setSesion(null); }} />;
}

export const NOVEDADES = [
  'El recorrido de demostración también funciona con el Excel 06 cargado desde archivo (se reconoce por lo que declara su hoja LEEME).',
  'Alternativas y EVA: «Corte de la evaluación» elegible e intervalo de meses sin tope.',
  'Simulación: al perder una salida, la carga solo usa la capacidad libre de las siguientes; lo que no cabe queda no atendido.',
  'Alternativas y EVA: intervalo libre por meses (Desde el mes / Hasta el mes). Pronóstico: horizonte hasta una fecha.',
  'Datos → Parámetros: capacidad de recursos con revisión previa de cargas comprometidas.',
  'Al cerrar un formulario con datos escritos se pide confirmar antes de descartarlos.',
  'Resultados: período libre (Desde/Hasta) y paso 4 con tres libros: resultados del sistema, analítica y proyecciones y alternativas, con índice, metadatos y totales con fórmulas.',
  'Datos → Recorrido operativo de demostración: registra un día de operación (entregas, rechazo con retorno, incidencia, cargo, retornables y conteo) con las reglas normales.',
  'Analítica → Simulación: compare tres formas de despachar con los mismos sorteos (Monte Carlo reproducible).',
  'Analítica → Alternativas y EVA: base, 6 alternativas y combinación sin doble conteo, con sensibilidad.',
  'Resultados: elija período, vista y corridas; exporte a Excel, Word o PowerPoint (cancelable).',
  'Datos → Respaldo y continuidad: vista previa antes de restaurar, ensayo de restauración con metas RTO/RPO, exportación portable y copia anonimizada.',
  'Datos → Estado del sistema: salud por dimensión, eventos técnicos y paquete de diagnóstico.',
  'Datos → Parámetros: versiones con fecha de vigencia futura, reversión sin borrar y control de cambios simultáneos.',
  'HTML: si otra pestaña guarda cambios, esta pestaña lo avisa y no sobrescribe en silencio.',
];

function Principal({ svc, usuario, salir }: { svc: Servicio; usuario: string; salir: (motivo?: string) => void }) {
  const ve = (v: Parameters<Servicio['ve']>[1]) => svc.ve(usuario, v);
  const inicial: Area = (['inicio', 'operacion', 'planificacion', 'control', 'analitica', 'resultados', 'datos'] as Area[]).find((a) => ve(a)) ?? 'datos';
  const [area, setArea] = useState<Area>(inicial);
  const [cambioPin, setCambioPin] = useState(false);
  useEffect(() => { // cierre por inactividad
    let t = setTimeout(() => salir(`Sesión cerrada por ${INACTIVIDAD_MIN} minutos de inactividad.`), INACTIVIDAD_MIN * 60000);
    const reiniciar = () => { clearTimeout(t); t = setTimeout(() => salir(`Sesión cerrada por ${INACTIVIDAD_MIN} minutos de inactividad.`), INACTIVIDAD_MIN * 60000); };
    window.addEventListener('mousedown', reiniciar); window.addEventListener('keydown', reiniciar);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', reiniciar); window.removeEventListener('keydown', reiniciar); };
  }, [salir]);
  const [ver, setVer] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(
    svc.errorInicio ? { tipo: 'error', texto: svc.errorInicio } : svc.migracion ? { tipo: 'info', texto: svc.migracion } : null);
  const aviso = useCallback((tipo: 'ok' | 'error' | 'info', texto: string) => setMsg({ tipo, texto }), []);
  const accion = useCallback(async (fn: () => Promise<unknown> | unknown, exito?: string) => {
    if (ocupado) return; // evita doble clic
    setOcupado(true); setMsg(null);
    try { const r = await fn(); if (typeof r === 'string') setMsg({ tipo: 'info', texto: r }); else if (exito) setMsg({ tipo: 'ok', texto: exito }); }
    catch (e) { setMsg({ tipo: 'error', texto: (e as Error).message }); }
    finally { setOcupado(false); setVer((v) => v + 1); }
  }, [ocupado]);
  useEffect(() => { if (msg?.tipo === 'ok') { const t = setTimeout(() => setMsg(null), 10000); return () => clearTimeout(t); } }, [msg]);
  // AG03: otra pestaña guardó cambios → aviso persistente con opción de recargar (no se mezclan datos en silencio)
  const [fuera, setFuera] = useState(false);
  useEffect(() => { (svc.almacen as { alCambiarFuera?: () => void }).alCambiarFuera = () => setFuera(true); }, [svc]);
  // BP06: novedades de la versión, una vez por versión
  const version = BUILD.split('-')[0];
  const [novedades, setNovedades] = useState(() => { try { return localStorage.getItem('alprosa-version-vista') !== version; } catch { return false; } });
  useEffect(() => { const f = () => setNovedades(true); window.addEventListener('alprosa-novedades', f); return () => window.removeEventListener('alprosa-novedades', f); }, []);
  const cerrarNovedades = () => { try { localStorage.setItem('alprosa-version-vista', version); } catch { /* sin almacenamiento */ } setNovedades(false); };
  const ctx: Ctx = { svc, usuario, ocupado, ver, accion, aviso };
  const nombre = useMemo(() => String(svc.usuarios().find((u) => u.usuario_id === usuario)?.nombre_ficticio ?? usuario), [svc, usuario]);
  const roles = useMemo(() => P.rolesVigentes(svc.repo, usuario), [svc, usuario, ver]);
  const g = svc.ultimoGuardado;
  const guardadoTxt = svc.fallosCopia > 0 ? `⚠ Copia automática fallida (${svc.fallosCopia}); última verificada: ${svc.ultimaCopiaVerificada?.slice(11, 16) ?? 'ninguna'}` : g ? (g.guardado ? (g.respaldo === 'VERIFICADO' ? 'Guardado' : 'Guardado, respaldo pendiente') : 'No guardado') : svc.almacen.persistente ? 'Sin cambios pendientes' : 'Temporal: guarde un respaldo antes de salir';
  const areas: { id: Area; nombre: string; oculto?: boolean }[] = [
    { id: 'inicio', nombre: 'Inicio', oculto: !ve('inicio') }, { id: 'operacion', nombre: 'Operación', oculto: !ve('operacion') }, { id: 'planificacion', nombre: 'Planificación y entregas', oculto: !ve('planificacion') }, { id: 'control', nombre: 'Control', oculto: !ve('control') }, { id: 'analitica', nombre: 'Analítica', oculto: !ve('analitica') },
    { id: 'resultados', nombre: 'Resultados', oculto: !ve('resultados') }, { id: 'datos', nombre: 'Datos', oculto: !ve('datos') }];
  const actual = areas.find((a) => a.id === area && !a.oculto) ? area : inicial;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <header className="cabecera">
          <div className="marca" role="img" aria-label="Alprosa" dangerouslySetInnerHTML={{ __html: logoSvg }} />
          <div className="titulo">Distribución</div>
          <nav className="areas" aria-label="Secciones">
            {areas.filter((a) => !a.oculto).map((a) => <button key={a.id} className={actual === a.id ? 'activa' : ''} aria-current={actual === a.id ? 'page' : undefined} onClick={() => setArea(a.id)}>{a.nombre}</button>)}
          </nav>
          <div className="estado">
            <span className="etiqueta-datos">{svc.hayDatos() ? ETIQUETA : 'Sin datos cargados'}</span>
            <span className={'guardado ' + (svc.almacen.persistente ? '' : 'temporal')}>{guardadoTxt}</span>
            <span className="perfil" title={roles.map((r) => P.NOMBRE_ROL[r]).join(', ')}>
              <span className="perfil-nombre" aria-label="Usuario en sesión">{nombre}</span>
              <span className="perfil-rol">{roles.length > 2 ? `Acceso a ${roles.length} funciones` : roles.map((r) => P.NOMBRE_ROL[r]).join(' · ')}</span>
            </span>
            <button className="enlace-btn" onClick={() => setCambioPin(true)}>Cambiar PIN</button>
            <button onClick={() => salir()}>Cambiar de usuario</button>
          </div>
          {usuario === S.EVAL_ID && <div className="franja-prueba" role="status">MODO PRUEBA · Evaluación con acceso total.<span className="franja-detalle"> En operación real cada persona entra con su usuario y ve solo lo de su función.</span></div>}
        </header>
        <BandaClima />
        {fuera && <div className="banda-externa" role="alert"><span className="icono" aria-hidden="true">⟳</span><span className="texto"><strong>Otra pestaña o ventana guardó cambios. </strong>Lo que ve puede estar desactualizado y sus próximos cambios serían rechazados.</span>
          <button className="primario" onClick={async () => { await svc.recargarDesdeAlmacen(); setFuera(false); setVer((v) => v + 1); }}>Recargar datos</button></div>}
        {novedades && <div className="panel-fondo" role="dialog" aria-modal="true" aria-label="Novedades de la versión"><div className="panel novedades">
          <h2>Novedades de la versión {version}</h2>
          <ul>{NOVEDADES.map((n) => <li key={n}>{n}</li>)}</ul>
          <p className="nota">Puede volver a ver esta lista en Inicio → «Novedades de la versión».</p>
          <button className="primario" autoFocus onClick={cerrarNovedades}>Entendido</button></div></div>}
        <DialogoHost />
        {cambioPin && <CambioPin svc={svc} usuario={usuario} cerrar={(m) => { setCambioPin(false); if (m) aviso('ok', m); }} />}
        {msg && (
          <div className={'aviso ' + msg.tipo} role={msg.tipo === 'error' ? 'alert' : 'status'}>
            <span className="icono" aria-hidden="true">{msg.tipo === 'error' ? '✖' : msg.tipo === 'ok' ? '✔' : 'ℹ'}</span>
            <span className="texto"><strong>{msg.tipo === 'error' ? 'No se realizó. ' : msg.tipo === 'ok' ? 'Listo. ' : ''}</strong>{msg.texto}</span>
            <button className="cerrar" onClick={() => setMsg(null)} aria-label="Cerrar aviso">×</button>
          </div>
        )}
        <main><Protector key={actual} zona={actual}>
          {actual === 'inicio' && <Inicio ir={setArea} />}
          {actual === 'operacion' && <Operacion />}
          {actual === 'planificacion' && <Planificacion />}
          {actual === 'control' && <Control />}
          {actual === 'analitica' && <Analitica />}
          {actual === 'resultados' && <Resultados />}
          {actual === 'datos' && <Datos />}
        </Protector></main>
      </div>
    </AppCtx.Provider>
  );
}

function Inicio({ ir }: { ir: (a: Area) => void }) {
  const { svc, usuario, accion, ver, aviso } = (AppCtxUse());
  const d = useMemo(() => {
    const ps = svc.pedidos(), ex = svc.existencias();
    return {
      ps, ex, atrasados: ps.filter((p) => p.atrasado), porReservar: ps.filter((p) => ['Confirmado', 'Reserva parcial'].includes(p.estado)),
      ajustes: svc.repo.num("SELECT COUNT(*) FROM solicitud_ajuste WHERE estado='PENDIENTE'"),
      traslados: svc.repo.num("SELECT COUNT(*) FROM suministro_esperado WHERE transfer_id IS NOT NULL AND estado <> 'RECIBIDO'"),
      propuestas: svc.repo.num("SELECT COUNT(*) FROM propuesta_entrega WHERE estado='PROPUESTA'"),
      sinResp: D.pedidosSinResponsable(svc.repo).length,
      entregas: svc.repo.num("SELECT COUNT(DISTINCT pedido_id) FROM entrega WHERE estado IN ('TOTAL','PARCIAL')"),
    };
  }, [svc, ver]);
  if (!svc.hayDatos()) return (
    <section>
      <h1>Bienvenido al sistema de distribución</h1>
      <div className="vacio">
        <p>No hay datos cargados. Puede cargar la demostración (empresa ficticia NutriDemo) o su propio Excel desde Datos → Carga de datos.</p>
        <BotonAccion primario permiso="CARGAR_DATOS" onClick={() => accion(async () => { const r = await svc.cargarDemostracion(usuario); aviso(r.estado === 'CONFIRMADO' ? 'ok' : 'error', r.detalle); })}>Cargar demostración</BotonAccion>
        {!svc.puede(usuario, 'CARGAR_DATOS') && <p className="nota">Seleccione arriba un usuario con rol «Responsable de datos» (por ejemplo, Ana).</p>}
      </div>
    </section>
  );
  const tot = (k: 'fisico_mil' | 'reservado_mil' | 'disponible_mil') => d.ex.filter((e) => e.tipo_nodo === 'ALMACEN').reduce((a, e) => a + e[k], 0);
  const alertas = [
    d.atrasados.length && { t: `${d.atrasados.length} pedido(s) con la ventana vencida y saldo pendiente`, a: 'operacion' as Area },
    d.sinResp && { t: `${d.sinResp} pedido(s) sin responsable vigente`, a: 'operacion' as Area },
    d.ajustes && { t: `${d.ajustes} ajuste(s) de inventario esperan aprobación`, a: 'operacion' as Area },
    d.traslados && { t: `${d.traslados} traslado(s) en tránsito por recibir`, a: 'operacion' as Area },
    d.propuestas && { t: `${d.propuestas} propuesta(s) de fecha vigentes por responder`, a: 'operacion' as Area },
    svc.fallosCopia > 0 && { t: `La copia automática falló ${svc.fallosCopia} vez/veces: la protección NO está vigente (última verificada: ${svc.ultimaCopiaVerificada ?? 'ninguna'})`, a: 'datos' as Area },
  ].filter(Boolean) as { t: string; a: Area }[];
  return (
    <section>
      <div className="titulo-con-accion"><h1>Resumen de distribución</h1><button className="mini" onClick={() => window.dispatchEvent(new Event('alprosa-novedades'))}>Novedades de la versión</button></div>
      {alertas.length > 0 && <ul className="alertas">{alertas.map((x, i) => <li key={i}><button className="enlace" onClick={() => ir(x.a)}>{x.t} →</button></li>)}</ul>}
      <div className="flujo" aria-label="Flujo de distribución">
        {[['Pedidos', d.ps.filter((p) => p.estado !== 'Cancelado').length, 'abiertos'], ['Por reservar', d.porReservar.length, 'con pendiente'], ['Reservados', d.ps.filter((p) => p.estado === 'Reservado').length, 'listos para planificar'],
          ['En atención', d.ps.filter((p) => p.estado === 'En atención').length, 'en ruta o en nodos'], ['Con entrega', d.entregas, 'pedidos con entrega registrada']].map(([n, v, s], i) => (
          <div key={i} className="etapa"><span>{n}</span><strong>{String(v)}</strong><small>{s}</small></div>
        ))}
      </div>
      <div className="tarjetas">
        <div className="tarjeta"><span>Stock físico en almacenes</span><strong>{fmtMil(tot('fisico_mil'), 0)}</strong><small>unidades base, todas las condiciones</small></div>
        <div className="tarjeta"><span>Reservado</span><strong>{fmtMil(tot('reservado_mil'), 0)}</strong><small>compromisos activos</small></div>
        <div className="tarjeta"><span>Disponible</span><strong>{fmtMil(tot('disponible_mil'), 0)}</strong><small>apto, liberado, vigente, sin reservar</small></div>
        <div className="tarjeta"><span>Importe de pedidos abiertos</span><strong>{fmtSoles(d.ps.filter((p) => p.estado !== 'Cancelado').reduce((a, p) => a + p.importe_cent, 0))}</strong><small>precio neto × cantidad solicitada</small></div>
      </div>
      <p className="nota">Las cifras se recalculan con cada operación confirmada. Unidades base: kg o unidad según el producto.</p>
    </section>
  );
}
import { useApp as AppCtxUse } from './comunes';

function Resultados() {
  const { svc, usuario, accion, aviso, ver } = AppCtxUse();
  const dia = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  // Hasta por defecto: el día de hoy si ya hay operación posterior al corte de la historia; si no, el corte.
  const hoy = svc.repo.reloj().slice(0, 10), corteH = HISTORIA_CORTE.slice(0, 10);
  const [hasta, setHasta] = useState(hoy > corteH ? hoy : corteH);
  const [desde, setDesde] = useState(dia(hoy > corteH ? hoy : corteH, -363));
  const PRESETS: [number, string][] = [[363, 'Últimas 52 semanas'], [90, 'Últimas 13 semanas'], [27, 'Últimas 4 semanas']]; // días a restar: el rango es inclusivo (4 semanas = 28 días)
  const presetSel = PRESETS.find(([n]) => dia(hasta, -n) === desde)?.[0];
  const corte = hasta;
  const [vista, setVista] = useState<'REEXPRESADA' | 'ORIGINAL'>('REEXPRESADA');
  const [conocido, setConocido] = useState(corteH);
  const prns = useMemo(() => svc.repo.todos('SELECT corrida_id, serie, corte FROM corrida_pronostico ORDER BY creada_en DESC'), [svc, ver]);
  const sims = useMemo(() => M.corridasSim(svc.repo).filter((c) => c.estado === 'COMPLETA'), [svc, ver]);
  const evs = useMemo(() => E.evaluaciones(svc.repo), [svc, ver]);
  const [sel, setSel] = useState<{ prn?: string; sim?: string; eva?: string }>({});
  const prn = sel.prn ?? String(prns[0]?.corrida_id ?? ''), sim = sel.sim ?? String(sims[0]?.run_id ?? ''), eva = sel.eva ?? String(evs[0]?.run_id ?? '');
  const [prog, setProg] = useState<{ texto: string; i: number; n: number } | null>(null);
  const cancelar = useRef(false);
  const opcionesActuales = (): OpcionesExportacion => {
    if (desde > hasta) throw new Error('«Desde» no puede ser posterior a «Hasta».');
    const filtros = { desde: desde + 'T00:00:00-05:00', hasta: dia(hasta, 1) + 'T00:00:00-05:00', granularidad: 'mes' as const, vista, corte: vista === 'ORIGINAL' ? dia(conocido, 1) + 'T00:00:00-05:00' : svc.repo.reloj() };
    const txt = `${desde} a ${hasta} (inclusive) · vista ${vista === 'ORIGINAL' ? 'original, conocido hasta ' + conocido : 'reexpresada'} · todas las regiones y productos`;
    return { filtros, textoFiltros: txt, pronostico: prn || null, simulacion: sim || null, evaluacion: eva || null };
  };
  const exportar = async (tipo: 'xlsx' | 'docx' | 'pptx') => {
    cancelar.current = false;
    try {
      const opciones = opcionesActuales();
      setProg({ texto: 'Tomando la fotografía de los datos…', i: 0, n: 1 });
      const r = await svc.exportar(usuario, tipo, tipo === 'xlsx' ? undefined : await logoPng(), opciones, { progreso: (t, i, n) => setProg({ texto: t, i, n }), cancelado: () => cancelar.current });
      setProg(null); aviso('ok', `Archivo generado: ${r.nombre} (RUN-ID ${r.runId}).`);
    } catch (e) { setProg(null); aviso('error', (e as Error).message); }
  };
  const libro = async (n: '07' | '08' | '09') => {
    cancelar.current = false;
    try {
      const opciones = opcionesActuales();
      setProg({ texto: 'Tomando la fotografía de los datos…', i: 0, n: 1 });
      const r = await svc.exportarLibroN(usuario, n, opciones, { progreso: (t, i, k) => setProg({ texto: t, i, n: k }), cancelado: () => cancelar.current });
      setProg(null); aviso('ok', `Archivo generado: ${r.nombre} (RUN-ID ${r.runId}, ${r.hojas} hojas de datos).`);
    } catch (e) { setProg(null); aviso('error', (e as Error).message); }
  };
  void accion;
  return (
    <section>
      {prog && <PanelProgreso titulo="Generando archivo" texto={prog.texto} hechas={prog.i} total={prog.n} cancelar={() => { cancelar.current = true; }} />}
      <h1>Exportar resultados</h1>
      {!svc.hayDatos() ? <p className="vacio">Sin datos no se generan cifras: cargue datos primero.</p> : <>
        <div className="pasos-guia">
          <div className="paso"><h3>1. Período y vista</h3>
            <div className="filtros-analitica">
              <label>Período <select value={presetSel ?? ''} onChange={(x) => { if (x.target.value) setDesde(dia(hasta, -Number(x.target.value))); }}>{PRESETS.map(([n, t]) => <option key={n} value={n}>{t}</option>)}<option value="">Personalizado</option></select></label>
              <label>Desde <CampoFecha etiqueta="Desde" valor={desde} cambiar={setDesde} /></label>
              <label>Hasta (inclusive) <CampoFecha etiqueta="Hasta (inclusive)" valor={hasta} cambiar={(v) => { const n = presetSel; setHasta(v); if (n) setDesde(dia(v, -n)); }} /></label>
              <label>Vista <select value={vista} onChange={(x) => setVista(x.target.value as 'ORIGINAL')}><option value="REEXPRESADA">Reexpresada (todo lo registrado)</option><option value="ORIGINAL">Original (lo conocido a una fecha)</option></select></label>
              {vista === 'ORIGINAL' && <label>Conocido hasta el <CampoFecha etiqueta="Conocido hasta el" valor={conocido} cambiar={setConocido} /></label>}
            </div>
          </div>
          <div className="paso"><h3>2. Corridas a incluir</h3>
            <div className="filtros-analitica">
              <label>Pronóstico <select value={prn} onChange={(x) => setSel({ ...sel, prn: x.target.value })}><option value="">Ninguno</option>{prns.map((c) => <option key={String(c.corrida_id)} value={String(c.corrida_id)}>{String(c.corrida_id)} · {String(c.serie)}</option>)}</select></label>
              <label>Simulación <select value={sim} onChange={(x) => setSel({ ...sel, sim: x.target.value })}><option value="">Ninguna</option>{sims.map((c) => <option key={String(c.run_id)} value={String(c.run_id)}>{String(c.run_id)} · semilla {String(c.semilla)}</option>)}</select></label>
              <label>Evaluación económica <select value={eva} onChange={(x) => setSel({ ...sel, eva: x.target.value })}><option value="">Ninguna</option>{evs.map((c) => <option key={String(c.run_id)} value={String(c.run_id)}>{String(c.run_id)} · {String(c.horizonte_meses)} meses</option>)}</select></label>
            </div>
            <p className="nota">Si elige «Ninguno/Ninguna», el archivo lo indica y no inventa cifras.</p>
          </div>
          <div className="paso"><h3>3. Exportar</h3>
            <div className="botonera">
              <BotonAccion primario permiso="EXPORTAR" onClick={() => exportar('xlsx')}>Excel</BotonAccion>
              <BotonAccion permiso="EXPORTAR" onClick={() => exportar('docx')}>Informe técnico (Word)</BotonAccion>
              <BotonAccion permiso="EXPORTAR" onClick={() => exportar('pptx')}>Presentación ejecutiva (PowerPoint)</BotonAccion>
            </div>
            <p className="nota">Cada archivo lleva su RUN-ID, el conjunto de datos, la vista y las corridas incluidas. Se puede cancelar mientras se genera.</p>
          </div>
          <div className="paso"><h3>4. Libros de resultados</h3>
            <div className="botonera">
              <BotonAccion permiso="EXPORTAR" onClick={() => libro('07')}>Libro de resultados del sistema</BotonAccion>
              <BotonAccion permiso="EXPORTAR" onClick={() => libro('08')}>Libro de analítica</BotonAccion>
              <BotonAccion permiso="EXPORTAR" onClick={() => libro('09')}>Libro de proyecciones y alternativas</BotonAccion>
            </div>
            <p className="nota">El libro de resultados del sistema usa toda la operación registrada. El de analítica usa el período, la vista y el pronóstico de los pasos 1 y 2. El de proyecciones usa la simulación y la evaluación del paso 2.</p>
          </div>
        </div>
      </>}
    </section>
  );
}

function BandaClima() {
  const { svc, ver } = AppCtxUse();
  const l = useMemo(() => svc.ultimaLecturaClima(), [svc, ver]);
  if (!l) return null;
  const vigente = String(l.vigente_hasta) > svc.repo.reloj();
  const n = (v: unknown) => fmtNum(Number(v), 1);
  return (
    <div className={'banda-clima' + (vigente ? '' : ' vencida')} role="status" aria-label="Última lectura de clima">
      <span className="bc-punto">Clima {String(l.referencia)}</span>
      <span className="bc-dato"><strong>{n(l.temperatura_c)} °C</strong></span>
      <span className="bc-dato">Lluvia prevista hoy <strong>{l.lluvia_hoy_mm == null ? 'N/D' : `${n(l.lluvia_hoy_mm)} mm`}</strong>{l.prob_lluvia_pct != null && <> · probabilidad <strong>{String(l.prob_lluvia_pct)} %</strong></>}</span>
      <span className="bc-dato" title="Lluvia caída en los últimos 15 minutos antes de la consulta">Lloviendo ahora: <strong>{Number(l.precipitacion_mm) > 0 ? `sí (${n(l.precipitacion_mm)} mm)` : 'no'}</strong></span>
      <span className="bc-dato">Viento <strong>{n(l.viento_kmh)} km/h</strong></span>
      <span className="bc-nota">Observado {String(l.observado_en ?? '').slice(11, 16) || '—'} · {vigente ? `vigente hasta ${String(l.vigente_hasta).slice(11, 16)}` : 'lectura vencida: consulte de nuevo en Datos → Clima'} · Open-Meteo. No prueba que una vía esté transitable.</span>
    </div>
  );
}
