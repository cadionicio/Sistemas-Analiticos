// I06: pantallas de Simulación Monte Carlo y de Alternativas / EVA dentro de Analítica.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, BotonAccion, formulario, PanelProgreso, CampoFecha, CampoMes } from './comunes';
import { M, E, K } from './servicio';
import { HISTORIA_CORTE } from '../core/historia';
import { fmtNum } from '../core/util';

const n1 = (x: number | null | undefined, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? 'N/D' : fmtNum(x, d));
const soles = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? 'N/D' : 'S/ ' + fmtNum(x, 0));

// ================================================================== Simulación
export function Simulacion() {
  const { svc, usuario, accion, ver, aviso } = useApp();
  const modelos = useMemo(() => M.modelos(svc.repo), [svc, ver]);
  const ids = [...new Set(modelos.map((m) => String(m.modelo_id)))];
  const [modeloId, setModeloId] = useState('MOD-BASE');
  const vig = useMemo(() => { try { return M.modeloVigente(svc.repo, ids.includes(modeloId) ? modeloId : ids[0]); } catch { return null; } }, [svc, ver, modeloId]);
  const corridas = useMemo(() => M.corridasSim(svc.repo), [svc, ver]);
  const [verRun, setVerRun] = useState<string | null>(null);
  const [planSel, setPlanSel] = useState(0);
  const [prog, setProg] = useState<{ hechas: number; total: number; texto: string } | null>(null);
  const cancelar = useRef(false);
  const actual = verRun ?? String(corridas.find((c) => c.estado === 'COMPLETA')?.run_id ?? '');
  const corrida = useMemo(() => (actual ? M.corridaSim(svc.repo, actual) : null), [svc, ver, actual]);
  if (!vig) return <p className="vacio">Cargue datos primero (Datos → Carga de datos → Cargar demostración).</p>;
  const p = vig.parametros;

  const simular = async () => {
    cancelar.current = false;
    setProg({ hechas: 0, total: p.iteraciones, texto: 'Preparando los tres planes (sin modificar datos)…' });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const base = M.construirPlanes(svc.repo, p.holgura_por_pedido_h);
      setProg({ hechas: 0, total: p.iteraciones, texto: 'Simulando…' });
      const r = await M.simularPorBloques(base.planes, base.servicios, p, { progreso: (h) => setProg({ hechas: h, total: p.iteraciones, texto: `Iteración ${fmtNum(h, 0)} de ${fmtNum(p.iteraciones, 0)}` }), cancelado: () => cancelar.current });
      setProg(null);
      const id = await svc.op('corrida de simulación', () => M.guardarCorridaSim(svc.repo, usuario, vig, base.planes, base.servicios, r));
      setVerRun(id);
      await accion(async () => {}, r.cancelada ? `Simulación CANCELADA en la iteración ${r.hechas}: se registró ${id} como cancelada, sin resultados. Las corridas completas anteriores no cambian.` : `Simulación completa: ${id}.`);
    } catch (e) { setProg(null); aviso('error', (e as Error).message); }
  };
  const editar = async () => {
    const x = await formulario(`Nueva versión de ${vig.nombre}`, [
      { id: 'it', tipo: 'numero', etiqueta: 'Iteraciones', unidad: 'iteraciones', inicial: String(p.iteraciones), minMil: 10000, maxMil: 20000000 },
      { id: 'se', tipo: 'numero', etiqueta: 'Semilla', unidad: 'entero', inicial: String(p.semilla), maxMil: 4294967295000 },
      { id: 'pc', tipo: 'numero', etiqueta: 'Probabilidad de cierre de un corredor por día', unidad: '0 a 1', inicial: String(p.prob_cierre).replace('.', ','), maxMil: 1000 },
      { id: 'fd', tipo: 'numero', etiqueta: 'Factor de duración de los tramos', unidad: 'veces', inicial: String(p.factor_duracion).replace('.', ','), minMil: 1, maxMil: 5000 },
      { id: 'hg', tipo: 'numero', etiqueta: 'Holgura del despacho por pedido', unidad: 'horas', inicial: String(p.holgura_por_pedido_h), maxMil: 240000 },
      { id: 'sc', tipo: 'opcion', etiqueta: 'Dependencia entre servicios', inicial: p.shock_comun ? '1' : '0', opciones: [{ valor: '1', texto: 'Shock común por corredor y día', detalle: 'Un cierre o incidencia afecta a todos los servicios y pedidos de ese corredor ese día' }, { valor: '0', texto: 'Independencia', detalle: 'Cada servicio sortea por separado (subestima bloqueos compartidos)' }] },
      { id: 'mo', tipo: 'motivo', etiqueta: 'Motivo del cambio', opciones: ['Ensayo de sensibilidad', 'Nuevos datos de tiempos', 'Corrección de un parámetro'] },
    ], { explicacion: 'Se crea una VERSIÓN nueva del modelo. Las corridas ya guardadas conservan la versión con la que se hicieron.', aceptar: 'Crear versión' });
    if (!x) return;
    const nuevo = { ...p, iteraciones: Math.round(Number(x.it) / 1000), semilla: Math.round(Number(x.se) / 1000), prob_cierre: Number(x.pc) / 1000, factor_duracion: Number(x.fd) / 1000, holgura_por_pedido_h: Number(x.hg) / 1000, shock_comun: x.sc === '1' };
    accion(async () => { const r = await svc.op('versión de modelo', () => M.modificarModelo(svc.repo, usuario, vig.modelo_id, nuevo, x.mo)); return `Modelo ${r.modelo_id} pasa a la versión ${r.version}.`; });
  };
  const clonar = async () => {
    const x = await formulario('Clonar modelo', [{ id: 'n', tipo: 'texto', etiqueta: 'Nombre del modelo nuevo', minLargo: 3, ejemplo: 'Modelo temporada de lluvias', inicial: `Copia de ${vig.nombre}` }], { explicacion: 'El modelo nuevo recibe un ID nuevo y copia los parámetros vigentes.', aceptar: 'Clonar' });
    if (x) accion(async () => { const r = await svc.op('clonar modelo', () => M.clonarModelo(svc.repo, usuario, vig.modelo_id, x.n)); setModeloId(r.modelo_id); return `Modelo clonado: ${r.modelo_id}.`; });
  };
  const r = corrida?.resultado;
  const repetida = corrida ? corridas.filter((c) => c.estado === 'COMPLETA' && c.run_id !== corrida.run_id && c.entrada_hash === corrida.entrada_hash) : [];
  return (
    <>
      {prog && <PanelProgreso titulo="Simulación Monte Carlo" texto={prog.texto} hechas={prog.hechas} total={prog.total} cancelar={() => { cancelar.current = true; }} />}
      <div className="pasos-guia">
        <div className="paso"><h3>1. Modelo</h3>
          <label>Modelo <select value={vig.modelo_id} onChange={(x) => setModeloId(x.target.value)}>{ids.map((i) => <option key={i} value={i}>{i} — {String(modelos.find((m) => m.modelo_id === i)?.nombre)}</option>)}</select></label>
          <p className="nota">Versión vigente: <strong>v{vig.version}</strong> · {fmtNum(p.iteraciones, 0)} iteraciones · semilla {p.semilla} · cierre {n1(p.prob_cierre * 100)} %/día · holgura {p.holgura_por_pedido_h} h · {p.shock_comun ? 'shock común por corredor y día' : 'independencia'}</p>
          <div className="botonera"><BotonAccion permiso="SIMULAR" onClick={editar}>Cambiar parámetros</BotonAccion><BotonAccion permiso="SIMULAR" onClick={clonar}>Clonar modelo</BotonAccion></div>
        </div>
        <div className="paso"><h3>2. Simular</h3>
          <p className="nota">Se comparan tres planes para los pedidos abiertos con los MISMOS sorteos: despacho por pedido (referencia), consolidado por destino y anticipado. No se modifica ningún pedido ni reserva.</p>
          <BotonAccion primario permiso="SIMULAR" onClick={simular}>Simular los 3 planes</BotonAccion>
        </div>
      </div>
      {corrida && <div className="detalle">
        <h2>Corrida {corrida.run_id} {corrida.estado === 'CANCELADA' && <span className="chip cancelado">Cancelada</span>}</h2>
        <p className="nota">Modelo {corrida.modelo_id} v{corrida.modelo_version} · semilla {corrida.parametros.semilla} · {fmtNum(corrida.parametros.iteraciones, 0)} iteraciones · creada {corrida.creada_en.slice(0, 16).replace('T', ' ')} · huella de entrada {corrida.entrada_hash.slice(0, 12)}…</p>
        {repetida.length > 0 && <p className="alerta-suave">Misma entrada y semilla que {repetida.map((c) => String(c.run_id)).join(', ')}: los resultados son idénticos (reproducible).</p>}
        {!r ? <p className="vacio">Corrida cancelada en la iteración {corrida.iteraciones_completas}: no tiene resultados válidos y no reemplaza a ninguna corrida completa.</p> : <>
          <div className="tarjetas-plan">{r.planes.map((pl, i) => (
            <div key={pl.criterio} className={'tarjeta-plan' + (i === 0 ? ' referencia' : '')}>
              <h3>{pl.nombre}{i === 0 ? ' · referencia' : ''}</h3>
              <dl>
                <dt>OTIF esperado</dt><dd>{n1(pl.a_tiempo.media)} %</dd>
                <dt>Rango P5 – P95</dt><dd>{n1(pl.a_tiempo.p5)} – {n1(pl.a_tiempo.p95)} %</dd>
                <dt>IC 95 % de la media</dt><dd>{n1(pl.a_tiempo.ic95[0], 2)} – {n1(pl.a_tiempo.ic95[1], 2)} %</dd>
                <dt>Prob. de incumplir*</dt><dd>{n1(pl.prob_incumplimiento * 100)} %</dd>
                <dt>Retraso P95</dt><dd>{n1(pl.retraso_h.p95)} h</dd>
                <dt>Costo medio</dt><dd>{soles(pl.costo.media)}</dd>
                <dt>Costo P5 – P95</dt><dd>{soles(pl.costo.p5)} – {soles(pl.costo.p95)}</dd>
                <dt>kg no atendidos (media)</dt><dd>{n1(pl.kg_no_atendido.media)}</dd>
                <dt>Servicios físicos · pedidos</dt><dd>{pl.servicios} · {pl.pedidos}</dd>
              </dl>
            </div>))}
          </div>
          <p className="nota">* Promedio, entre pedidos con ruta factible, de la probabilidad de llegar fuera de su ventana. «P5 – P95» es la dispersión de los resultados entre iteraciones; «IC 95 % de la media» es la precisión del promedio. No son lo mismo.</p>
          <h3>Diferencias contra la referencia (misma iteración, mismos sorteos)</h3>
          <table><thead><tr><th>Plan</th><th className="num">Δ OTIF medio</th><th className="num">Δ OTIF P5 – P95</th><th className="num">Δ costo medio</th></tr></thead>
            <tbody>{r.diferencias.map((d) => <tr key={d.contra}><td>{r.planes.find((x) => x.criterio === d.contra)!.nombre}</td><td className="num">{n1(d.a_tiempo.media, 2)} pp</td><td className="num">{n1(d.a_tiempo.p5, 2)} – {n1(d.a_tiempo.p95, 2)} pp</td><td className="num">{soles(d.costo.media)}</td></tr>)}</tbody></table>
          <p className="nota">{r.correlacion}</p>
          <h3>Por pedido</h3>
          <label>Plan <select value={planSel} onChange={(x) => setPlanSel(Number(x.target.value))}>{r.planes.map((pl, i) => <option key={pl.criterio} value={i}>{pl.nombre}</option>)}</select></label>
          <div className="desplazable"><table className="tabla-pedidos-sim"><thead><tr><th>Pedido</th><th>Destino</th><th className="num">kg</th><th className="num">Prob. a tiempo</th><th className="num">Prob. no atendido</th><th className="num">Retraso P95</th><th>Llegada P50</th><th>Llegada P95</th><th>Ventana hasta</th><th>Observación</th></tr></thead>
            <tbody>{r.planes[planSel].por_pedido.map((x) => <tr key={x.pedido} className={x.factible ? '' : 'no-factible'}><td>{x.pedido}</td><td>{x.destino}{x.remoto ? ' (remoto)' : ''}</td><td className="num">{n1(x.kg)}</td><td className="num">{n1(x.prob_a_tiempo * 100)} %</td><td className="num">{n1(x.prob_no_atendido * 100)} %</td>
              <td className="num">{n1(x.retraso_p95)} h</td><td>{x.llegada_p50 ?? '—'}</td><td>{x.llegada_p95 ?? '—'}</td><td>{x.ventana_fin.slice(0, 16).replace('T', ' ')}</td><td>{x.motivo || ''}</td></tr>)}</tbody></table></div>
          <details className="ayuda"><summary>Cómo se generan los números (reproducibilidad)</summary><p>{r.orden_extraccion}</p><p>Duración de cada tramo: distribución triangular (mínimo, más probable, máximo) del enlace × factor de duración; incidencia Bernoulli con retraso adicional; cierre total del corredor en el día con la probabilidad del modelo. Si una carga pierde su salida, toma la siguiente del mismo tramo (conexión perdida) y suma costo de reprogramación y espera.</p>
            <ul>{['La capacidad (kg) se respeta al planificar y al reprogramar: lo que no cabe en las salidas siguientes queda no atendido.', 'Distribuciones y probabilidades sintéticas y editables, no datos reales de Alprosa.'].map((t) => <li key={t}>{t}</li>)}</ul></details>
        </>}
      </div>}
      <h2>Corridas guardadas</h2>
      {!corridas.length ? <p className="vacio">Aún no hay corridas. Pulse «Simular los 3 planes».</p> : <table><thead><tr><th>Corrida</th><th>Creada</th><th>Modelo</th><th className="num">Semilla</th><th className="num">Iteraciones</th><th>Estado</th><th>Huella</th><th></th></tr></thead>
        <tbody>{corridas.map((c) => <tr key={String(c.run_id)} className={String(c.run_id) === actual ? 'seleccionada' : ''}><td>{String(c.run_id)}</td><td>{String(c.creada_en).slice(0, 16).replace('T', ' ')}</td><td>{String(c.modelo_id)} v{String(c.modelo_version)}</td><td className="num">{String(c.semilla)}</td>
          <td className="num">{String(c.iteraciones_completas)} / {String(c.iteraciones)}</td><td>{c.estado === 'COMPLETA' ? <span className="chip completado">Completa</span> : <span className="chip cancelado">Cancelada</span>}</td><td className="mono">{String(c.entrada_hash).slice(0, 10)}</td>
          <td><button className="mini" onClick={() => setVerRun(String(c.run_id))}>Ver</button></td></tr>)}</tbody></table>}
    </>
  );
}

// ================================================================== Alternativas y EVA
export function Alternativas() {
  const { svc, usuario, accion, ver, aviso } = useApp();
  const hechos = useMemo(() => K.cargarHechos(svc.repo), [svc, ver]);
  const sims = useMemo(() => M.corridasSim(svc.repo).filter((c) => c.estado === 'COMPLETA'), [svc, ver]);
  const escs = useMemo(() => E.escenariosDemanda(svc.repo), [svc, ver]);
  const sup = useMemo(() => svc.repo.todos('SELECT * FROM supuesto_economico ORDER BY rowid'), [svc, ver]);
  const guardadas = useMemo(() => E.evaluaciones(svc.repo), [svc, ver]);
  const [corteEva, setCorteEva] = useState(HISTORIA_CORTE.slice(0, 10));
  const corteIso = corteEva + 'T00:00:00-05:00';
  const primero = E.primerMesCompleto(corteIso);
  const [o, setO] = useState({ sim: '', escenario: '', desde: primero, hasta: E.sumarMeses(primero, 11) });
  useEffect(() => { if (o.desde < primero) setO((x) => ({ ...x, desde: primero, hasta: x.hasta < primero ? E.sumarMeses(primero, 11) : x.hasta })); }, [primero]); // eslint-disable-line
  const nMeses = E.difMeses(o.desde, o.hasta) + 1;
  const [comb, setComb] = useState<E.AltId[]>(['CONSOLIDACION', 'TERCERIZACION']);
  const [pesos, setPesos] = useState<E.Pesos>({ ...E.PESOS_DEFECTO });
  const [ev, setEv] = useState<E.Evaluacion | null>(null);
  const [det, setDet] = useState<string | null>(null);
  const simId = o.sim || String(sims[0]?.run_id ?? '');
  const suma = Math.round(Object.values(pesos).reduce((a, b) => a + b, 0) * 100);
  const calcular = () => accion(async () => {
    const sim = simId ? M.corridaSim(svc.repo, simId)?.resultado ?? null : null;
    setEv(E.evaluar(svc.repo, hechos, { corte: corteIso, desdeMes: o.desde, hastaMes: o.hasta, sim, simRunId: simId || null, combinar: comb.length >= 2 ? comb : undefined, pesos, escenarioDemanda: o.escenario || null }));
  });
  const NOMBRE_PESO: Record<keyof E.Pesos, string> = { eva: 'EVA', otif: 'OTIF', retraso: 'Retraso P95', costo: 'Costo + penalización', no_atendido: 'Demanda no atendida' };
  const editarSupuesto = async (f: Record<string, unknown>) => {
    const x = await formulario(`Supuesto: ${String(f.descripcion)}`, [{ id: 'v', tipo: 'numero', etiqueta: `Valor (${String(f.unidad)})`, unidad: String(f.unidad), inicial: f.valor === null ? '' : String(f.valor).replace('.', ','), minMil: -1e15 }], { explicacion: `Fuente: ${String(f.fuente)}. El cambio se valida antes de guardarse (por ejemplo, el WACC debe estar entre 0 y 1).`, aceptar: 'Guardar' });
    if (x) accion(async () => { await svc.op('supuesto económico', () => E.guardarSupuesto(svc.repo, usuario, String(f.clave), Number(x.v) / 1000)); setEv(null); return 'Supuesto actualizado. Pulse «Calcular evaluación» de nuevo.'; });
  };
  if (!sup.length) return <p className="vacio">Cargue datos primero (Datos → Carga de datos → Cargar demostración).</p>;
  const best = ev?.comparador.orden[0];
  return (
    <>
      <div className="pasos-guia">
        <div className="paso"><h3>1. Datos de entrada</h3>
          <div className="filtros-analitica">
            <label>Corrida de simulación <select value={simId} onChange={(x) => setO({ ...o, sim: x.target.value })}><option value="">Sin simulación (solo historia)</option>{sims.map((c) => <option key={String(c.run_id)} value={String(c.run_id)}>{String(c.run_id)} · semilla {String(c.semilla)}</option>)}</select></label>
            <label>Demanda <select value={o.escenario} onChange={(x) => setO({ ...o, escenario: x.target.value })}><option value="">Pronóstico base</option>{escs.map((e) => <option key={String(e.escenario_id)} value={String(e.escenario_id)}>{String(e.nombre)} (+{String(e.aumento_pct)} %)</option>)}</select></label>
            <label>Corte de la evaluación <CampoFecha etiqueta="Corte de la evaluación" min={HISTORIA_CORTE.slice(0, 10)} max="9999-12-31" valor={corteEva} cambiar={setCorteEva} /></label>
            <label>Desde el mes <CampoMes etiqueta="Desde el mes" min={primero} valor={o.desde} cambiar={(v) => setO({ ...o, desde: v, hasta: v > o.hasta ? v : o.hasta })} /></label>
            <label>Hasta el mes <CampoMes etiqueta="Hasta el mes" min={o.desde} valor={o.hasta} cambiar={(v) => setO({ ...o, hasta: v })} /></label>
            <span className="nota">{nMeses} {nMeses === 1 ? 'mes' : 'meses'} · {nMeses === 12 ? 'EVA anual' : 'EVA del período'}</span>
          </div>
        </div>
        <div className="paso"><h3>2. Combinación (opcional)</h3>
          <div className="checks">{E.ALTERNATIVAS.filter((a) => a.id !== 'BASE').map((a) => <label key={a.id} className="check"><input type="checkbox" checked={comb.includes(a.id)} onChange={(x) => setComb(x.target.checked ? [...comb, a.id] : comb.filter((c) => c !== a.id))} />{a.nombre}</label>)}</div>
          <p className="nota">Con 2 o más marcadas se calcula su combinación aplicando todos los cambios a la vez.</p>
        </div>
        <div className="paso"><h3>3. Pesos del comparador</h3>
          <div className="pesos">{(Object.keys(pesos) as (keyof E.Pesos)[]).map((k) => <label key={k}>{NOMBRE_PESO[k]}: {Math.round(pesos[k] * 100)} %<input type="range" min={0} max={100} step={5} value={Math.round(pesos[k] * 100)} onChange={(x) => setPesos({ ...pesos, [k]: Number(x.target.value) / 100 })} /></label>)}</div>
          <p className={'suma-pesos' + (suma !== 100 ? ' mal' : '')}>Suma: {suma} % {suma !== 100 ? '— debe ser 100 %' : '✓'}</p>
          <button className="mini" onClick={() => setPesos({ ...E.PESOS_DEFECTO })}>Restablecer pesos</button>
        </div>
      </div>
      <div className="botonera"><BotonAccion primario permiso="EVALUAR_ECONOMIA" onClick={calcular}>Calcular evaluación</BotonAccion>
        {ev && <BotonAccion permiso="EVALUAR_ECONOMIA" onClick={() => accion(async () => { const id = await svc.op('evaluación económica', () => E.guardarEvaluacion(svc.repo, usuario, ev)); return `Evaluación guardada: ${id}. Puede exportarla en Resultados.`; })}>Guardar evaluación</BotonAccion>}</div>
      {ev && <div className="detalle">
        <h2>Resultado — {ev.horizonte_meses} meses desde {ev.demanda.meses[0].mes} · demanda: {ev.demanda.escenario}</h2>
        <div className={'conclusion' + (ev.comparador.fragil.length ? ' fragil' : '')}>{ev.comparador.conclusion}</div>
        <p className="nota">{ev.convencion}</p>
        <div className="desplazable"><table className="tabla-eva"><thead><tr><th>Alternativa</th><th className="num">Ingresos</th><th className="num">Costo logístico</th><th className="num">EBIT</th><th className="num">NOPAT</th><th className="num">Capital promedio</th><th className="num">Cargo de capital</th><th className="num">EVA</th><th className="num">ΔEVA</th><th className="num">OTIF</th><th className="num">Retraso P95</th><th className="num">No atendido</th><th>¿Cumple restricciones?</th><th className="num">Puntaje</th></tr></thead>
          <tbody>{ev.escenarios.map((x) => { const f = ev.comparador.filas.find((y) => y.id === x.id)!; return (
            <tr key={x.id} className={'clicable' + (f.factible ? '' : ' no-factible') + (x.id === best ? ' mejor' : '')} onClick={() => setDet(det === x.id ? null : x.id)}>
              <td>{x.nombre}</td><td className="num">{soles(x.ingresos)}</td><td className="num">{soles(x.costo_logistico)}</td><td className="num">{soles(x.ebit)}</td><td className="num">{soles(x.nopat)}</td><td className="num">{soles(x.capital_promedio)}</td><td className="num">{soles(x.cargo_capital)}</td>
              <td className="num">{x.eva === null ? 'NO CALCULABLE' : soles(x.eva)}</td><td className="num">{soles(x.delta_eva)}</td><td className="num">{n1(x.servicio.otif_pct)} %</td><td className="num">{n1(x.servicio.retraso_p95_h)} h</td><td className="num">{fmtNum(x.kg_no_atendido, 0)} kg</td>
              <td>{f.factible ? (f.dominada_por ? `Sí (dominada por «${f.dominada_por}»)` : 'Sí') : 'No: ' + f.motivo}</td><td className="num">{f.puntaje === null ? '—' : fmtNum(f.puntaje, 3)}</td></tr>); })}</tbody></table></div>
        <p className="nota">Pulse una fila para ver sus cambios físicos y su tabla mensual. {ev.comparador.advertencia}</p>
        {det && (() => { const x = ev.escenarios.find((y) => y.id === det)!; return <div className="detalle"><h3>{x.nombre}</h3><p>{x.descripcion}</p><ul>{x.cambios.map((c) => <li key={c}>{c}</li>)}</ul>
          <p className="nota">Servicio: {x.servicio.fuente}. Inversión {soles(x.inversion)} · caja liberada {soles(x.caja_liberada)} (reduce capital; no se suma al EBIT).{x.motivo ? ' ' + x.motivo : ''}</p>
          <div className="desplazable"><table><thead><tr><th>Mes</th><th className="num">kg demanda</th><th className="num">kg aceptados</th><th className="num">Ingresos</th><th className="num">Costo producto</th><th className="num">Costo logístico</th><th className="num">Otros</th><th className="num">Depreciación</th><th className="num">EBIT</th><th className="num">Impuesto</th><th className="num">NOPAT</th><th className="num">Capital cierre</th><th>Demanda</th></tr></thead>
            <tbody>{x.meses.map((m) => <tr key={m.mes}><td>{m.mes}</td><td className="num">{fmtNum(m.kg_demanda, 0)}</td><td className="num">{fmtNum(m.kg_aceptado, 0)}</td><td className="num">{soles(m.ingresos)}</td><td className="num">{soles(m.costo_producto)}</td><td className="num">{soles(m.costo_logistico)}</td><td className="num">{soles(m.otros + m.implementacion)}</td><td className="num">{soles(m.depreciacion)}</td><td className="num">{soles(m.ebit)}</td><td className="num">{soles(m.impuesto)}</td><td className="num">{soles(m.nopat)}</td><td className="num">{soles(m.capital_cierre)}</td><td>{m.extension ? 'Extensión' : 'Validada'}</td></tr>)}</tbody></table></div></div>; })()}
        {ev.combinacion && <div className="detalle"><h3>Combinación sin doble conteo</h3>
          <table><tbody><tr><td>Suma de los ΔEVA individuales</td><td className="num">{soles(ev.combinacion.suma_individual)}</td></tr><tr><td>ΔEVA de la combinación (cambios aplicados a la vez)</td><td className="num">{soles(ev.combinacion.escenario.delta_eva)}</td></tr><tr><td><strong>Solapamiento (ahorro que se habría contado dos veces)</strong></td><td className="num"><strong>{soles(ev.combinacion.solapamiento)}</strong></td></tr></tbody></table>
          <p className="nota">{ev.combinacion.explicacion}</p></div>}
        <h3>Sensibilidad del ΔEVA</h3>
        <div className="desplazable"><table><thead><tr><th>Alternativa</th><th className="num">Base</th><th className="num">Demanda −10 %</th><th className="num">Demanda +10 %</th><th className="num">Transporte +10 %</th><th className="num">Transporte −10 %</th><th className="num">WACC +2 pp</th><th className="num">WACC −2 pp</th></tr></thead>
          <tbody>{ev.sensibilidad.filter((x) => x.id !== 'BASE').map((x) => <tr key={x.id}><td>{x.nombre}</td>{[x.base, x.demanda_menos10, x.demanda_mas10, x.tarifa_mas10, x.tarifa_menos10, x.wacc_mas2, x.wacc_menos2].map((v, i) => <td key={i} className="num">{soles(v)}</td>)}</tr>)}</tbody></table></div>
        <details className="ayuda"><summary>Demanda usada y limitaciones</summary><p>{ev.demanda.nota}</p><ul>{ev.limitaciones.map((l) => <li key={l}>{l}</li>)}</ul></details>
      </div>}
      <h2>Supuestos (editables)</h2>
      <table><thead><tr><th>Supuesto</th><th className="num">Valor</th><th>Unidad</th><th>Fuente</th><th></th></tr></thead>
        <tbody>{sup.map((f) => <tr key={String(f.clave)}><td>{String(f.descripcion)}</td><td className="num">{f.valor === null ? <span className="chip atrasado">Falta</span> : fmtNum(Number(f.valor), Math.abs(Number(f.valor)) < 10 ? 2 : 0)}</td><td>{String(f.unidad)}</td><td>{String(f.fuente)}</td>
          <td><button className="mini" onClick={() => (svc.puede(usuario, 'EVALUAR_ECONOMIA') ? editarSupuesto(f) : aviso('error', 'Su perfil no permite cambiar supuestos.'))}>Editar</button></td></tr>)}</tbody></table>
      <h2>Evaluaciones guardadas</h2>
      {!guardadas.length ? <p className="vacio">Aún no hay evaluaciones guardadas.</p> : <table><thead><tr><th>Evaluación</th><th>Creada</th><th>Simulación</th><th>Demanda</th><th className="num">Meses</th></tr></thead>
        <tbody>{guardadas.map((g) => <tr key={String(g.run_id)}><td>{String(g.run_id)}</td><td>{String(g.creada_en).slice(0, 16).replace('T', ' ')}</td><td>{String(g.sim_run_id ?? '—')}</td><td>{String(g.escenario_demanda)}</td><td className="num">{String(g.horizonte_meses)}</td></tr>)}</tbody></table>}
    </>
  );
}
