import { useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { useApp, Pestanas, BotonAccion, formulario, claseEstado, CampoFecha, fechaValida } from './comunes';
import { D, K, F, G, A, E, MIME } from './servicio';
import { Lineas, Pareto, Leyenda } from './graficos';
import { Simulacion, Alternativas } from './Simulacion';
import { HISTORIA_CORTE, HISTORIA_INICIO } from '../core/historia';
import { fmtNum } from '../core/util';

type Sub = 'panel' | 'diagnostico' | 'pronostico' | 'simulacion' | 'alternativas' | 'recomendaciones';
const L = (iso: string) => iso.slice(0, 10);
/** Suma días a una fecha «AAAA-MM-DD» (hora de Lima). Una fecha inválida se devuelve tal cual: nunca lanza error al dibujar. */
const masDias = (fecha: string, d: number) => { const t = Date.parse(fecha + 'T00:00:00-05:00'); return Number.isNaN(t) ? fecha : new Date(t + d * 86400000 - 5 * 3600000).toISOString().slice(0, 10); };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** Meses completos disponibles, del más reciente al más antiguo. */
const mesesDisponibles = (desde: string, hasta: string) => { const r: { valor: string; texto: string }[] = []; let [a, m] = [Number(hasta.slice(0, 4)), Number(hasta.slice(5, 7))]; const fin = desde.slice(0, 7);
  for (let i = 0; i < 36; i++) { const v = `${a}-${String(m).padStart(2, '0')}`; if (v < fin) break; r.push({ valor: v, texto: `${MESES[m - 1]} ${a}` }); m--; if (m === 0) { m = 12; a--; } } return r; };
const ultimoDia = (am: string) => { const [a, m] = am.split('-').map(Number); return `${am}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const aIso = (fecha: string) => fecha + 'T00:00:00-05:00';
const vNum = (v: number | null, u: string) => (v === null ? 'N/D' : u === '%' ? `${fmtNum(v, 1)} %` : u === 'S/ por kg' ? `S/ ${fmtNum(v, 3)}` : `${fmtNum(v, u === 'horas' ? 0 : 1)} ${u}`);

interface Estado { desde: string; hastaIncl: string; gran: 'dia' | 'semana' | 'mes'; region: string; producto: string; modo: string; remoto: '' | 'si' | 'no'; vista: 'REEXPRESADA' | 'ORIGINAL'; corte: string }

export function Analitica() {
  const { svc, usuario, ver } = useApp();
  const items = ([['panel', 'Panel: histórico, actual y futuro'], ['diagnostico', 'Diagnóstico'], ['pronostico', 'Pronóstico'], ['simulacion', 'Simulación'], ['alternativas', 'Alternativas y EVA'], ['recomendaciones', 'Recomendaciones']] as [Sub, string][]).map(([id, nombre]) => ({ id, nombre, oculto: !svc.ve(usuario, `analitica.${id}` as 'analitica.panel') }));
  const [elegida, setSub] = useState<Sub>('panel');
  const sub = items.find((i) => i.id === elegida && !i.oculto) ? elegida : items.find((i) => !i.oculto)!.id;
  const hechos = useMemo(() => K.cargarHechos(svc.repo), [svc, ver]);
  const ahora = svc.repo.reloj();
  const [e, setE] = useState<Estado>({ desde: masDias(L(HISTORIA_CORTE), -91), hastaIncl: masDias(L(HISTORIA_CORTE), -1), gran: 'semana', region: '', producto: '', modo: '', remoto: '', vista: 'REEXPRESADA', corte: L(ahora) });
  const [errorRango, setErrorRango] = useState<string | null>(null);
  const filtros: K.Filtros = { desde: aIso(e.desde), hasta: aIso(masDias(e.hastaIncl, 1)), granularidad: e.gran, region: e.region || undefined, producto: e.producto || undefined, modo: e.modo || undefined,
    remoto: e.remoto ? e.remoto === 'si' : undefined, vista: e.vista, corte: e.vista === 'ORIGINAL' ? aIso(masDias(e.corte, 1)) : ahora };
  const rangoOk = fechaValida(e.desde) && fechaValida(e.hastaIncl) && e.desde <= e.hastaIncl;
  const regiones = [...new Set(hechos.map((h) => h.region))].sort();
  const productos = svc.repo.todos('SELECT producto_id, nombre_generico FROM producto ORDER BY 1');
  const rangoDe = (dias: number | 'todo') => ({ desde: dias === 'todo' ? HISTORIA_INICIO : masDias(L(HISTORIA_CORTE), -dias), hastaIncl: dias === 'todo' ? L(ahora) : masDias(L(HISTORIA_CORTE), -1) });
  const preset = (dias: number | 'todo') => { setE({ ...e, ...rangoDe(dias) }); setErrorRango(null); };
  const PRESETS: [number | 'todo', string][] = [[28, 'Últimas 4 semanas'], [91, '13 semanas'], [364, '52 semanas'], ['todo', 'Todo (historia + operación)']];
  const presetActivo = PRESETS.find(([d]) => { const r = rangoDe(d); return r.desde === e.desde && r.hastaIncl === e.hastaIncl; })?.[0];
  const meses = mesesDisponibles(HISTORIA_INICIO, L(ahora));
  const mesActivo = meses.find((m) => e.desde === `${m.valor}-01` && e.hastaIncl === ultimoDia(m.valor))?.valor ?? '';
  return (
    <section>
      <Pestanas etiqueta="Analítica" actual={sub} cambiar={setSub} items={items} />
      {(sub === 'panel' || sub === 'diagnostico') && <div className="filtros-analitica" role="group" aria-label="Filtros de la analítica">
        <div className="periodos" role="group" aria-label="Período rápido">
          <span className="rotulo">Período:</span>
          {PRESETS.map(([d, t]) => <button key={String(d)} type="button" className={'chip-periodo' + (presetActivo === d ? ' activo' : '')} aria-pressed={presetActivo === d} onClick={() => preset(d)}>{t}</button>)}
          <label className="mes-completo">o un mes completo <select value={mesActivo} onChange={(x) => { if (x.target.value) { setE({ ...e, desde: `${x.target.value}-01`, hastaIncl: ultimoDia(x.target.value) }); setErrorRango(null); } }}>
            <option value="">— elegir mes —</option>{meses.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}</select></label>
        </div>
        <label>Desde <CampoFecha etiqueta="Desde" valor={e.desde} cambiar={(v) => { setE({ ...e, desde: v }); setErrorRango(null); }} /></label>
        <label>Hasta (inclusive) <CampoFecha etiqueta="Hasta (inclusive)" valor={e.hastaIncl} cambiar={(v) => { setE({ ...e, hastaIncl: v }); setErrorRango(null); }} /></label>
        <label>Agrupar por <select value={e.gran} onChange={(x) => setE({ ...e, gran: x.target.value as 'semana' })}><option value="dia">Día</option><option value="semana">Semana</option><option value="mes">Mes</option></select></label>
        <label>Región <select value={e.region} onChange={(x) => setE({ ...e, region: x.target.value })}><option value="">Todas</option>{regiones.map((r) => <option key={r}>{r}</option>)}</select></label>
        <label>Producto <select value={e.producto} onChange={(x) => setE({ ...e, producto: x.target.value })}><option value="">Todos</option>{productos.map((p) => <option key={String(p.producto_id)} value={String(p.producto_id)}>{String(p.producto_id)} — {String(p.nombre_generico)}</option>)}</select></label>
        <label>Medio <select value={e.modo} onChange={(x) => setE({ ...e, modo: x.target.value })}><option value="">Todos</option>{['VIAL', 'VIAL_LIGERO', 'LACUSTRE', 'FLUVIAL', 'ANIMAL', 'PEATONAL', 'AEREO'].map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Destinos <select value={e.remoto} onChange={(x) => setE({ ...e, remoto: x.target.value as '' })}><option value="">Todos</option><option value="si">Solo remotos</option><option value="no">Solo no remotos</option></select></label>
        <label>Vista <select value={e.vista} onChange={(x) => setE({ ...e, vista: x.target.value as 'ORIGINAL' })}><option value="REEXPRESADA">Reexpresada (todo lo registrado hasta hoy)</option><option value="ORIGINAL">Original (lo conocido a una fecha)</option></select></label>
        {e.vista === 'ORIGINAL' && <label>Conocido hasta el <CampoFecha etiqueta="Conocido hasta el" valor={e.corte} cambiar={(v) => setE({ ...e, corte: v })} /></label>}
        <p className="nota filtro-resumen">Rango interno [{e.desde} 00:00, {masDias(e.hastaIncl, 1)} 00:00) hora de Lima · {e.vista === 'ORIGINAL' ? `Vista ORIGINAL: solo lo registrado hasta el ${e.corte}` : 'Vista REEXPRESADA: incluye registros tardíos'} · Historia sintética cerrada hasta {L(HISTORIA_CORTE)}; después, operación registrada en la aplicación.</p>
        {(!rangoOk || errorRango) && <p className="error-campo" role="alert">{errorRango ?? 'La fecha «desde» debe ser anterior o igual a «hasta». No se calcula nada hasta corregirla.'}</p>}
      </div>}
      {rangoOk && sub === 'panel' && <Panel hechos={hechos} f={filtros} e={e} />}
      {rangoOk && sub === 'diagnostico' && <Diagnostico hechos={hechos} f={filtros} />}
      {sub === 'pronostico' && <Pronostico hechos={hechos} />}
      {sub === 'simulacion' && <Simulacion />}
      {sub === 'alternativas' && <Alternativas />}
      {sub === 'recomendaciones' && <Recomendaciones hechos={hechos} />}
    </section>
  );
}

// ------------------------------------------------------------------ Panel
function Panel({ hechos, f, e }: { hechos: K.PedidoH[]; f: K.Filtros; e: Estado }) {
  const { svc, accion, ver } = useApp();
  const ind = useMemo(() => K.indicadores(hechos, f), [hechos, JSON.stringify(f)]);
  const serie = useMemo(() => K.serieOTIF(hechos, f), [hechos, JSON.stringify(f)]);
  const [det, setDet] = useState<string | null>(null);
  const universo = useMemo(() => det ? K.universoOTIF(hechos, f) : [], [det, hechos, JSON.stringify(f)]);
  const actual = useMemo(() => {
    const ps = D.pedidos(svc.repo);
    return { abiertos: ps.filter((p) => !['Completado', 'Cancelado', 'Cerrado parcial', 'Borrador'].includes(p.estado)).length, atrasados: ps.filter((p) => p.atrasado).length,
      enCamino: svc.repo.num("SELECT COUNT(*) FROM etapa WHERE estado = 'DESPACHADA'"), verificacion: svc.repo.num("SELECT COUNT(*) FROM entrega WHERE estado = 'EN_VERIFICACION'"),
      alertas: A.alertas(svc.repo).length, alertasAltas: A.alertas(svc.repo).filter((a) => a.severidad === 'ALTA').length };
  }, [svc, ver]);
  const futuro = useMemo(() => svc.repo.todos(`SELECT i.pedido_id, i.entrega_prevista, p.ventana_fin FROM itinerario i JOIN pedido p USING (pedido_id) WHERE i.estado IN ('CONFIRMADO','EN_EJECUCION') ORDER BY i.entrega_prevista`), [svc, ver]);
  const exportar = () => accion(async () => {
    const wb = new ExcelJS.Workbook(); wb.creator = 'Sistema de Distribución Alprosa (demostrativo)';
    const h = wb.addWorksheet('Indicadores');
    h.addRow(['Vista', f.vista === 'ORIGINAL' ? `ORIGINAL según conocimiento al ${e.corte}` : 'REEXPRESADA (todo lo registrado hasta la exportación)']);
    h.addRow(['Rango', `[${e.desde}, ${masDias(e.hastaIncl, 1)}) hora de Lima`]); h.addRow(['Filtros', `Región: ${e.region || 'todas'} · Producto: ${e.producto || 'todos'} · Medio: ${e.modo || 'todos'} · Destinos: ${e.remoto || 'todos'}`]);
    h.addRow(['Exportado', svc.repo.reloj()]); h.addRow(['Datos', 'Historia sintética (no son datos reales de Alprosa) + operación registrada']); h.addRow([]);
    h.addRow(['Indicador', 'Valor', 'Unidad', 'Numerador', 'Denominador', 'n', 'Definición', 'Inclusión']).font = { bold: true };
    for (const k of ind) h.addRow([k.nombre, k.valor === null ? 'N/D' : Math.round(k.valor * 1000) / 1000, k.unidad, Math.round(k.numerador * 1000) / 1000, Math.round(k.denominador * 1000) / 1000, k.n, k.definicion, k.inclusion]);
    h.columns.forEach((c, i) => { c.width = [30, 12, 12, 14, 14, 8, 70, 60][i] ?? 14; });
    const s = wb.addWorksheet('Serie OTIF'); s.addRow(['Período', 'OTIF %', 'Pedidos OTIF', 'Pedidos elegibles', 'Fill rate %']).font = { bold: true };
    for (const x of serie) s.addRow([x.periodo, x.otif === null ? 'N/D' : Math.round(x.otif * 10) / 10, x.num, x.den, x.fill === null ? 'N/D' : Math.round(x.fill * 10) / 10]);
    const st = svc.repo.reloj().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1_$2');
    svc.descargar(`Analitica_${f.vista === 'ORIGINAL' ? 'ORIGINAL_' + e.corte : 'REEXPRESADA'}_${st}.xlsx`, await wb.xlsx.writeBuffer() as ArrayBuffer, MIME.xlsx);
  }, 'Vista exportada con el mismo rango, filtros y rótulo de vista que en pantalla.');
  return (
    <>
      <div className="tres-tiempos">
        <div className="bloque-tiempo actual"><h3>Ahora (operación registrada)</h3>
          <p><strong>{actual.abiertos}</strong> pedidos abiertos · <strong className={actual.atrasados ? 'texto-alerta' : ''}>{actual.atrasados}</strong> atrasados · <strong>{actual.enCamino}</strong> etapas en camino · <strong>{actual.verificacion}</strong> entregas en verificación</p>
          <p className={actual.alertasAltas ? 'texto-alerta' : 'nota'}>Alertas vigentes en TODO el sistema (sin filtros): {actual.alertas} ({actual.alertasAltas} graves). Los filtros del panel no ocultan alertas.</p></div>
        <div className="bloque-tiempo futuro"><h3>Próximo (planificado)</h3>
          {futuro.length ? <p><strong>{futuro.length}</strong> entrega(s) planificadas · <strong className={futuro.some((x) => String(x.entrega_prevista) > String(x.ventana_fin)) ? 'texto-alerta' : ''}>{futuro.filter((x) => String(x.entrega_prevista) > String(x.ventana_fin)).length}</strong> prevista(s) fuera de ventana. Pronóstico de demanda: pestaña «Pronóstico».</p> : <p className="nota">No hay itinerarios confirmados.</p>}</div>
      </div>
      <div className="barra"><h2>Histórico del rango elegido</h2><BotonAccion permiso="EXPORTAR" onClick={exportar}>Exportar esta vista (Excel)</BotonAccion></div>
      <div className="tarjetas-kpi">
        {ind.map((k) => (
          <button key={k.id} className={'tarjeta-kpi' + (det === k.id ? ' activa' : '')} onClick={() => setDet(det === k.id ? null : k.id)} title={k.definicion}>
            <span className="kpi-nombre">{k.nombre}</span>
            <span className="kpi-valor">{vNum(k.valor, k.unidad)}</span>
            <span className="kpi-frac">{k.valor === null ? `Sin denominador (${fmtNum(k.denominador, 0)}): N/D, no cero` : `${fmtNum(k.numerador, k.unidad === 'S/ por kg' ? 2 : 0)} / ${fmtNum(k.denominador, k.unidad === '%' && k.id === 'utilizacion' ? 0 : 0)}`} · n = {k.n}</span>
            <span className="kpi-ver">{det === k.id ? 'Ocultar detalle ▴' : 'Ver detalle ▾'}</span>
          </button>
        ))}
      </div>
      {det && (() => { const k = ind.find((x) => x.id === det)!; return <div className="detalle"><h3>{k.nombre}</h3><p><strong>Definición:</strong> {k.definicion}</p><p><strong>Universo:</strong> {k.inclusion}</p>
        {['otif', 'puntualidad_intento', 'fill_rate', 'intentos_fallidos'].includes(k.id) && <>
          <p className="nota">Pedidos del universo ({universo.length}). Los que no cumplen muestran su causa REGISTRADA (no es causa raíz confirmada).</p>
          <div className="tabla-scroll"><table><thead><tr><th>Pedido</th><th>Fuente</th><th>Destino</th><th>Compromiso</th><th>Resultado</th><th>Causa registrada / exclusión</th></tr></thead>
            <tbody>{universo.slice(0, 300).map((p) => <tr key={p.id}><td>{p.id}</td><td>{p.fuente === 'HISTORIA' ? 'Historia' : 'Operación'}</td><td>{p.destino} ({p.region})</td><td>{p.fin.slice(0, 16).replace('T', ' ')}</td>
              <td>{p.elegible ? <span className={'chip ' + (p.otif ? 'completado' : 'atrasado')}>{p.otif ? 'OTIF' : 'No OTIF'}</span> : <span className="chip borrador">Excluido</span>}</td><td>{p.elegible ? p.causa : p.motivoExclusion}</td></tr>)}</tbody></table></div>
          {universo.length > 300 && <p className="nota">Se muestran 300 de {universo.length}; exporte para ver todos.</p>}
        </>}</div>; })()}
      <h3>OTIF y fill rate por {e.gran === 'dia' ? 'día' : e.gran} (porcentajes recalculados desde numerador y denominador)</h3>
      <Leyenda items={[{ nombre: 'OTIF %', color: '#2e7d5b' }, { nombre: 'Fill rate %', color: '#1f6fb2' }]} />
      <Lineas etiquetas={serie.map((s) => s.periodo)} series={[{ nombre: 'OTIF %', puntos: serie.map((s) => s.otif), color: '#2e7d5b' }, { nombre: 'Fill rate %', puntos: serie.map((s) => s.fill), color: '#1f6fb2' }]} unidad="%" />
      {serie.length > 0 && <div className="tabla-scroll"><table><thead><tr><th>Período</th><th className="num">OTIF</th><th className="num">OTIF / elegibles</th><th className="num">Fill rate</th></tr></thead>
        <tbody>{serie.map((s) => <tr key={s.periodo}><td>{s.periodo}</td><td className="num">{s.otif === null ? 'N/D' : `${fmtNum(s.otif, 1)} %`}</td><td className="num">{s.num} / {s.den}</td><td className="num">{s.fill === null ? 'N/D' : `${fmtNum(s.fill, 1)} %`}</td></tr>)}</tbody></table></div>}
    </>
  );
}

// ------------------------------------------------------------------ Diagnóstico
function Diagnostico({ hechos, f }: { hechos: K.PedidoH[]; f: K.Filtros }) {
  const { svc, usuario, accion, ver } = useApp();
  const pa = useMemo(() => K.pareto(hechos, f), [hechos, JSON.stringify(f)]);
  const [dim, setDim] = useState<'region' | 'remoto' | 'modo' | 'destino'>('remoto');
  const conc = useMemo(() => K.concentracion(hechos, f, dim), [hechos, JSON.stringify(f), dim]);
  const [causaSel, setCausaSel] = useState<string | null>(null);
  const [corteEm, setCorteEm] = useState(f.hasta.slice(0, 10));
  const puente = useMemo(() => K.puenteOTIF(hechos, f, aIso(corteEm)), [hechos, JSON.stringify(f), corteEm]);
  const cadenas = useMemo(() => G.analisis(svc.repo), [svc, ver]);
  return (
    <>
      <h2>Pareto de causas registradas de incumplimiento (n = {pa.n})</h2>
      <p className="nota">{pa.advertencia} «Sin causa registrada» se muestra aparte para no esconder la falta de información. Pulse una fila para ver sus pedidos.</p>
      <Pareto filas={pa.filas} />
      <table><thead><tr><th>Causa registrada</th><th className="num">Pedidos</th><th className="num">%</th><th className="num">Acumulado</th></tr></thead>
        <tbody>{pa.filas.map((r) => <tr key={r.causa} className={'clicable' + (causaSel === r.causa ? ' seleccionada' : '')} onClick={() => setCausaSel(causaSel === r.causa ? null : r.causa)}><td>{r.causa}</td><td className="num">{r.n}</td><td className="num">{fmtNum(r.pct, 1)} %</td><td className="num">{fmtNum(r.acumulado, 1)} %</td></tr>)}</tbody></table>
      {causaSel && <p className="nota">Pedidos con «{causaSel}»: {pa.filas.find((x) => x.causa === causaSel)?.pedidos.join(', ')}</p>}
      <h2>¿Dónde se concentra el incumplimiento?</h2>
      <div className="barra"><label>Ver por <select value={dim} onChange={(x) => setDim(x.target.value as 'region')}><option value="remoto">Remotos / no remotos</option><option value="region">Región</option><option value="modo">Medio del último tramo</option><option value="destino">Destino</option></select></label></div>
      <table><thead><tr><th>{({ remoto: 'Grupo', region: 'Región', modo: 'Medio', destino: 'Destino' })[dim]}</th><th className="num">Pedidos elegibles</th><th className="num">No OTIF</th><th className="num">OTIF</th></tr></thead>
        <tbody>{conc.map((c) => <tr key={c.clave}><td>{c.clave}</td><td className="num">{c.n}</td><td className="num">{c.fallas}</td><td className="num">{c.otif === null ? 'N/D' : `${fmtNum(c.otif, 1)} %`}</td></tr>)}</tbody></table>
      <p className="nota">Un promedio global puede esconder diferencias: compare siempre por segmento con el tamaño de muestra.</p>
      <h2>Informe emitido vs reexpresado (registros tardíos)</h2>
      <div className="barra"><label>Fecha de emisión del informe original <CampoFecha etiqueta="Fecha de emisión del informe original" valor={corteEm} cambiar={setCorteEm} /></label></div>
      <p>OTIF ORIGINAL (conocido al {corteEm}): <strong>{puente.original.valor === null ? 'N/D' : `${fmtNum(puente.original.valor, 1)} %`}</strong> ({puente.original.num}/{puente.original.den}) → REEXPRESADO: <strong>{puente.reexpresada.valor === null ? 'N/D' : `${fmtNum(puente.reexpresada.valor, 1)} %`}</strong> ({puente.reexpresada.num}/{puente.reexpresada.den}). {puente.nota}</p>
      {puente.cambios.length > 0 && <div className="tabla-scroll"><table><thead><tr><th>Pedido</th><th>En el informe original</th><th>Reexpresado</th><th>Motivo</th></tr></thead><tbody>{puente.cambios.slice(0, 50).map((c) => <tr key={c.pedido_id}><td>{c.pedido_id}</td><td>{c.antes}</td><td>{c.despues}</td><td>{c.motivo}</td></tr>)}</tbody></table></div>}
      <div className="barra"><h2>Cadenas causales (hipótesis → evidencia → conclusión)</h2>
        <BotonAccion onClick={async () => { const x = await formulario('Nueva hipótesis de causa', [
          { id: 'ent', tipo: 'texto', etiqueta: 'Pedido o etapa afectada', ejemplo: 'H-00123 o PED-0041' }, { id: 'hecho', tipo: 'texto', etiqueta: 'Hecho observado', ejemplo: 'Se aceptó 20 h después del compromiso', minLargo: 10 },
          { id: 'evento', tipo: 'texto', etiqueta: 'Evento o dependencia que lo explica', ejemplo: 'La lancha de las 09:00 salió sin la carga', minLargo: 10 }, { id: 'causa', tipo: 'texto', etiqueta: 'Causa candidata (hipótesis)', minLargo: 10 },
          { id: 'alt', tipo: 'texto', etiqueta: 'Alternativa o acción propuesta', opcional: true }], { explicacion: 'Se crea como HIPÓTESIS PENDIENTE: no es causa raíz hasta reunir evidencia y que otra persona la valide.', aceptar: 'Crear hipótesis' });
          if (x) accion(async () => { await svc.op('hipótesis de causa', () => G.crearAnalisis(svc.repo, usuario, { indicador: 'OTIF por pedido', entidad: 'pedido', entidad_id: x.ent, hecho: x.hecho, evento: x.evento, causa_candidata: x.causa, alternativa: x.alt })); }, 'Hipótesis registrada.'); }}>Nueva hipótesis</BotonAccion></div>
      {!cadenas.length ? <p className="vacio">No hay cadenas causales registradas.</p> : cadenas.map((c) => (
        <div key={String(c.analisis_id)} className="cadena">
          <div className="cadena-cab"><span className={'chip ' + ({ HIPOTESIS_PENDIENTE: 'confirmado', EN_VALIDACION: 'en-atencion', CONFIRMADA: 'completado', REFUTADA: 'cancelado', NO_CONCLUYENTE: 'borrador' } as Record<string, string>)[String(c.estado)]}>{G.NOMBRE_ESTADO[c.estado as G.EstadoCausa]}</span> <strong>{String(c.entidad_id)}</strong> · {String(c.indicador)} · propuesta por {String(c.creado_por)}</div>
          <ol className="cadena-pasos">
            <li><strong>Hecho:</strong> {String(c.hecho)}</li><li><strong>Evento que lo explica:</strong> {String(c.evento)}</li><li><strong>Causa candidata:</strong> {String(c.causa_candidata)}</li>
            <li><strong>Evidencia:</strong><ul>{c.evidencias.map((v) => <li key={String(v.evidencia_id)} className={v.sentido === 'A_FAVOR' ? 'ev-favor' : 'ev-contra'}>{v.sentido === 'A_FAVOR' ? 'A favor' : 'En contra'}: {String(v.descripcion)} <span className="nota">(fuente: {String(v.fuente)})</span></li>)}{!c.evidencias.length && <li className="nota">Sin evidencia todavía.</li>}</ul></li>
            <li><strong>Conclusión:</strong> {String(c.conclusion ?? '— pendiente —')}</li><li><strong>Alternativa vinculada:</strong> {String(c.alternativa ?? '—')}</li>
          </ol>
          {!['CONFIRMADA', 'REFUTADA'].includes(String(c.estado)) && <div className="botonera">
            <BotonAccion onClick={async () => { const x = await formulario('Agregar evidencia', [{ id: 's', tipo: 'opcion', etiqueta: 'Sentido', opciones: [{ valor: 'A_FAVOR', texto: 'A favor de la hipótesis' }, { valor: 'EN_CONTRA', texto: 'En contra de la hipótesis' }] }, { id: 'd', tipo: 'texto', etiqueta: 'Qué muestra la evidencia', minLargo: 10 }, { id: 'f', tipo: 'texto', etiqueta: 'Fuente verificable', ejemplo: 'Guía 0045, registro de salidas del muelle', minLargo: 3 }], { aceptar: 'Agregar' });
              if (x) accion(async () => { await svc.op('evidencia', () => G.agregarEvidencia(svc.repo, usuario, String(c.analisis_id), { sentido: x.s as 'A_FAVOR', descripcion: x.d, fuente: x.f })); }, 'Evidencia agregada.'); }}>Agregar evidencia</BotonAccion>
            <BotonAccion onClick={async () => { const x = await formulario('Cambiar estado del análisis', [{ id: 'a', tipo: 'opcion', etiqueta: 'Nuevo estado', opciones: [{ valor: 'EN_VALIDACION', texto: 'En validación' }, { valor: 'CONFIRMADA', texto: 'Causa confirmada', detalle: 'Exige evidencia a favor, ninguna en contra y otra persona que valide' }, { valor: 'REFUTADA', texto: 'Refutada', detalle: 'Exige evidencia en contra' }, { valor: 'NO_CONCLUYENTE', texto: 'No concluyente' }] }, { id: 'm', tipo: 'texto', etiqueta: 'Motivo del cambio', minLargo: 5 }, { id: 'c', tipo: 'texto', etiqueta: 'Conclusión (obligatoria para confirmar)', opcional: true }], { aceptar: 'Cambiar estado' });
              if (x) accion(async () => { await svc.op('estado de causa', () => G.cambiarEstadoCausa(svc.repo, usuario, String(c.analisis_id), x.a as G.EstadoCausa, x.m, x.c || undefined)); }, 'Estado actualizado.'); }}>Cambiar estado</BotonAccion>
          </div>}
        </div>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ Pronóstico
function Pronostico({ hechos }: { hechos: K.PedidoH[] }) {
  const { svc, usuario, accion, ver } = useApp();
  const productos = svc.repo.todos('SELECT producto_id, nombre_generico, unidad_base FROM producto ORDER BY 1');
  const regiones = [...new Set(hechos.map((h) => h.region))].sort();
  const [o, setO] = useState({ producto: 'P01', segmento: '', horizonte: '8', corte: L(HISTORIA_CORTE) });
  const [r, setR] = useState<ReturnType<typeof F.pronosticar> | null>(null);
  const corridas = useMemo(() => svc.repo.todos('SELECT * FROM corrida_pronostico ORDER BY creada_en DESC LIMIT 30'), [svc, ver]);
  const escs = useMemo(() => svc.repo.todos('SELECT * FROM escenario_demanda ORDER BY creado_en DESC'), [svc, ver]);
  const [promo, setPromo] = useState('');
  const [desemp, setDesemp] = useState<ReturnType<typeof F.revisarDesempeno> | null>(null);
  const esc = escs.find((x) => x.escenario_id === promo && (!x.producto_id || x.producto_id === r?.serie.split(' · ')[0]));
  const factorPromo = (sem: string): number => { if (!esc) return 1; let d = 0; for (let i = 0; i < 7; i++) { const dia = new Date(Date.parse(sem + 'T12:00:00Z') + i * 86400000).toISOString().slice(0, 10); if (dia >= String(esc.desde) && dia < String(esc.hasta)) d++; } return 1 + (Number(esc.aumento_pct) / 100) * (d / 7); };
  const registrarPromo = async () => {
    const x = await formulario('Registrar una promoción comunicada (supuesto)', [
      { id: 'n', tipo: 'texto', etiqueta: 'Nombre', minLargo: 3, ejemplo: 'Promoción de verano P01' },
      { id: 'p', tipo: 'select', etiqueta: 'Producto', opciones: [{ valor: '', texto: 'Todos los productos' }, ...productos.map((p) => ({ valor: String(p.producto_id), texto: `${p.producto_id} — ${p.nombre_generico}` }))], inicial: o.producto },
      { id: 'd', tipo: 'fecha', etiqueta: 'Desde', minimo: L(HISTORIA_CORTE) }, { id: 'h', tipo: 'fecha', etiqueta: 'Hasta (no incluido)', minimo: L(HISTORIA_CORTE) },
      { id: 'a', tipo: 'numero', etiqueta: 'Aumento de la demanda', unidad: '%', maxMil: 500000 },
      { id: 'f', tipo: 'texto', etiqueta: 'Fuente (quién la comunicó)', minLargo: 3, ejemplo: 'Área comercial, correo del 02/11' }], { explicacion: 'Es un escenario de intervención: se muestra aparte y NO se usa para entrenar el pronóstico.', aceptar: 'Registrar' });
    if (x) accion(async () => { const id = await svc.op('escenario de demanda', () => E.crearEscenarioDemanda(svc.repo, usuario, { nombre: x.n, producto_id: x.p || null, desde: x.d, hasta: x.h, aumento_pct: Number(x.a) / 1000, fuente: x.f })); setPromo(id); return `Escenario ${id} registrado.`; });
  };
  const unidad = String(productos.find((p) => p.producto_id === o.producto)?.unidad_base ?? '');
  const u = unidad === 'kg' ? 'kg' : 'unidades';
  const seg = o.segmento.startsWith('R:') ? { region: o.segmento.slice(2) } : o.segmento === 'remotos' ? { remoto: true } : o.segmento === 'noremotos' ? { remoto: false } : {};
  const ejecutar = () => accion(async () => { const h = Number(o.horizonte); if (!Number.isInteger(h) || h < 1) throw new Error('El horizonte debe ser de al menos 1 semana (más allá de 8 semanas el pronóstico es solo REFERENCIA).'); setR(F.pronosticar(svc.repo, hechos, { producto: o.producto, ...seg, corte: aIso(o.corte), horizonte: h })); });
  const k = (x: number | null) => (x === null ? 'N/D' : fmtNum(x / 1000, 1));
  return (
    <>
      <p className="nota">Se pronostica la demanda SOLICITADA (no lo entregado). Se comparan tres métodos y se elige el de menor error DESPUÉS de medirlo en las últimas 8 semanas, usando en cada semana solo lo que se sabía en esa fecha.</p>
      <div className="filtros-analitica">
        <label>Producto <select value={o.producto} onChange={(x) => setO({ ...o, producto: x.target.value })}>{productos.map((p) => <option key={String(p.producto_id)} value={String(p.producto_id)}>{String(p.producto_id)} — {String(p.nombre_generico)}</option>)}</select></label>
        <label>Segmento <select value={o.segmento} onChange={(x) => setO({ ...o, segmento: x.target.value })}><option value="">Todas las regiones</option><option value="remotos">Solo destinos remotos</option><option value="noremotos">Solo no remotos</option>{regiones.map((r2) => <option key={r2} value={`R:${r2}`}>Región {r2}</option>)}</select></label>
        <label>Horizonte <select value={[4, 8, 13, 26, 52].includes(Number(o.horizonte)) ? o.horizonte : 'otro'} onChange={(x) => setO({ ...o, horizonte: x.target.value === 'otro' ? String(Math.max(1, Math.ceil((Date.parse(L(HISTORIA_CORTE) + 'T12:00:00Z') + 105 * 7 * 86400000 - Date.parse(o.corte + 'T12:00:00Z')) / (7 * 86400000)))) : x.target.value })}>{[4, 8, 13, 26, 52].map((h) => <option key={h} value={h}>{h} semanas{h > 8 ? ' (extensión no validada)' : ''}</option>)}<option value="otro">Hasta una fecha…</option></select></label>
        {![4, 8, 13, 26, 52].includes(Number(o.horizonte)) && <label>Pronosticar hasta <CampoFecha etiqueta="Pronosticar hasta" min={o.corte} max="9999-12-31" valor={new Date(Date.parse(o.corte + 'T12:00:00Z') + Number(o.horizonte) * 7 * 86400000).toISOString().slice(0, 10)} cambiar={(v) => setO({ ...o, horizonte: String(Math.max(1, Math.ceil((Date.parse(v + 'T12:00:00Z') - Date.parse(o.corte + 'T12:00:00Z')) / (7 * 86400000)))) })} /> <span className="nota">{o.horizonte} semanas</span></label>}
        <label>Corte (datos hasta) <CampoFecha etiqueta="Corte (datos hasta)" valor={o.corte} cambiar={(v) => setO({ ...o, corte: v })} /></label>
        <label>Escenario de promoción <select value={promo} onChange={(x) => setPromo(x.target.value)}><option value="">Ninguno</option>{escs.map((x) => <option key={String(x.escenario_id)} value={String(x.escenario_id)}>{String(x.nombre)} (+{String(x.aumento_pct)} %{x.producto_id ? ', ' + String(x.producto_id) : ''})</option>)}</select></label>
        <BotonAccion primario onClick={ejecutar}>Calcular pronóstico</BotonAccion>
        <BotonAccion permiso="SIMULAR" onClick={registrarPromo}>Registrar promoción</BotonAccion>
      </div>
      {r && <div className="detalle">
        <h2>{r.serie} — corte {r.corte.slice(0, 10)}</h2>
        <p className="nota">{r.protocolo}</p>
        {r.advertencias.length > 0 && <ul className="advertencias">{r.advertencias.map((a) => <li key={a}>{a}</li>)}</ul>}
        <Leyenda items={[{ nombre: `Observado (${u})`, color: '#2e7d5b' }, { nombre: 'Pronóstico', color: '#e08600', punteada: true }, ...(esc ? [{ nombre: 'Con promoción (supuesto)', color: '#7b3fb5', punteada: true }] : []), { nombre: 'Atípico (punto rojo)', color: '#c62828' }]} />
        {promo && !esc && <p className="alerta-suave">El escenario elegido es de otro producto: no se aplica a esta serie.</p>}
        {esc && <p className="alerta-suave">Escenario «{String(esc.nombre)}»: +{String(esc.aumento_pct)} % del {String(esc.desde)} al {String(esc.hasta)}. Fuente: {String(esc.fuente)}. Es un SUPUESTO de intervención: no se usa para entrenar ni para medir el error del pronóstico.</p>}
        {(() => { const et = [...r.historia.map((p) => p.semana), ...r.prediccion.map((p) => p.semana)]; const nH = r.historia.length;
          // El pronóstico arranca en el último dato observado para que la línea sea continua (no hay salto visual entre historia y futuro)
          const ultimo = r.historia.at(-1)?.valor ?? null;
          const enlace = (i: number) => (i === nH - 1 && ultimo !== null ? ultimo / 1000 : null);
          return <Lineas etiquetas={et} separador={nH} series={[{ nombre: 'Observado', puntos: [...r.historia.map((p) => (p.valor === null ? null : p.valor / 1000)), ...r.prediccion.map(() => null)], color: '#2e7d5b', marcas: [...r.historia.map((p) => !!p.atipico), ...r.prediccion.map(() => false)] },
            { nombre: 'Pronóstico', puntos: [...r.historia.map((_, i) => enlace(i)), ...r.prediccion.map((p) => p.valor / 1000)], color: '#e08600', punteada: true },
            ...(esc ? [{ nombre: 'Con promoción (supuesto)', puntos: [...r.historia.map((_, i) => enlace(i)), ...r.prediccion.map((p) => (p.valor * factorPromo(p.semana)) / 1000)], color: '#7b3fb5', punteada: true }] : [])]}
            banda={{ inf: [...r.historia.map(() => null), ...r.prediccion.map((p) => (p.p10 === null ? null : p.p10 / 1000))], sup: [...r.historia.map(() => null), ...r.prediccion.map((p) => (p.p90 === null ? null : p.p90 / 1000))], color: '#e08600' }} unidad={u} />; })()}
        <p className="nota">Los huecos en la línea observada son semanas SIN DATOS (faltantes), no demanda cero.</p>
        {r.metricas && <table><thead><tr><th>Método</th><th className="num">MAE ({u})</th><th className="num">WAPE</th><th className="num">Semanas evaluadas</th><th></th></tr></thead>
          <tbody>{(['INGENUO', 'PM4', 'SES'] as const).map((m) => <tr key={m} className={r.elegido === m ? 'seleccionada' : ''}><td>{({ INGENUO: 'Ingenuo (última semana)', PM4: 'Promedio móvil 4 semanas', SES: `Suavizamiento exponencial (alfa ${r.alfa})` })[m]}</td>
            <td className="num">{k(r.metricas![m].mae)}</td><td className="num">{r.metricas![m].wape === null ? 'N/D' : `${fmtNum(r.metricas![m].wape!, 1)} %`}</td><td className="num">{r.metricas![m].n}</td><td>{r.elegido === m ? 'Elegido (menor error medido)' : ''}</td></tr>)}</tbody></table>}
        <table><thead><tr><th>Semana</th><th className="num">Pronóstico ({u})</th>{esc && <th className="num">Con promoción (supuesto)</th>}<th className="num">P10</th><th className="num">P90</th><th>Tipo</th></tr></thead>
          <tbody>{r.prediccion.map((p) => <tr key={p.semana}><td>{p.semana}</td><td className="num">{k(p.valor)}</td>{esc && <td className="num">{k(p.valor * factorPromo(p.semana))}</td>}<td className="num">{k(p.p10)}</td><td className="num">{k(p.p90)}</td><td>{({ VALIDADO: 'Horizonte evaluado', EXTENSION: 'Extensión por hipótesis', REFERENCIA: 'Referencia simple (poca historia)' })[p.tipo]}</td></tr>)}</tbody></table>
        <div className="botonera"><BotonAccion onClick={() => accion(async () => { await svc.op('corrida de pronóstico', () => F.guardarCorrida(svc.repo, usuario, r)); }, 'Corrida guardada: queda con su corte, parámetros y métricas, y no se sobrescribe.')}>Guardar esta corrida</BotonAccion>
          <BotonAccion onClick={async () => { const x = await formulario('Repartir una semana en días', [{ id: 'tot', tipo: 'numero', etiqueta: `Total de la semana (${u})`, unidad: u, inicial: fmtNum((r.prediccion[0]?.valor ?? 0) / 1000, 0) }, { id: 'pes', tipo: 'texto', etiqueta: 'Pesos lunes a domingo (7 números separados por espacio)', inicial: '1 1 1 1 1 0,5 0', ejemplo: '1 1 1 1 1 0,5 0' }, { id: 'cer', tipo: 'texto', etiqueta: 'Días cerrados (1=lunes … 7=domingo), opcional', opcional: true, ejemplo: '7' }], { explicacion: 'El total se conserva; los pesos se normalizan sobre los días habilitados.', aceptar: 'Repartir' });
            if (x) accion(async () => { const pes = x.pes.split(/\s+/).map((v) => Number(v.replace(',', '.'))); const cer = (x.cer || '').split(/\s+/).filter(Boolean).map((v) => Number(v) - 1); const d = F.desagregarSemana(Number(x.tot) / 1000, pes, cer); return `Lun–Dom: ${d.dias.join(' · ')} (total ${d.total} ${u}). ${d.regla}`; }); }}>Repartir en días</BotonAccion></div>
      </div>}
      <h2>Corridas guardadas</h2>
      {!corridas.length ? <p className="vacio">Aún no hay corridas guardadas.</p> : <table><thead><tr><th>Creada</th><th>Serie</th><th>Corte</th><th>Método</th><th>Estado</th><th>Motor</th></tr></thead>
        <tbody>{corridas.map((c) => <tr key={String(c.corrida_id)}><td>{String(c.creada_en).slice(0, 16).replace('T', ' ')}</td><td>{String(c.serie)}</td><td>{String(c.corte).slice(0, 10)}</td><td>{String(c.metodo_elegido ?? '—')}</td>
          <td>{F.estadoCorrida(svc.repo, String(c.corrida_id)) === 'VENCIDA' ? <span className="chip atrasado">Vencida: revalidar</span> : <span className="chip completado">Vigente</span>}</td><td>{String(c.version_motor)}</td></tr>)}</tbody></table>}
      {corridas.length > 0 && <div className="botonera"><button onClick={() => setDesemp(F.revisarDesempeno(svc.repo, hechos))}>Revisar desempeño de las corridas</button></div>}
      {desemp && <table><thead><tr><th>Serie</th><th>Corridas (corte: WAPE realizado)</th><th>Resultado</th></tr></thead>
        <tbody>{desemp.map((d) => <tr key={d.serie}><td>{d.serie}</td><td>{d.corridas.map((c) => `${c.corte.slice(0, 10)}: ${c.wape === null ? (c.semanas ? 'N/D' : 'aún sin semanas observadas') : fmtNum(c.wape, 1) + ' %'}`).join(' · ')}</td>
          <td>{d.revisar ? <span className="chip atrasado">Revisar: error sobre 50 % en dos cortes</span> : <span className="chip completado">Sin alerta</span>}</td></tr>)}</tbody></table>}
    </>
  );
}

// ------------------------------------------------------------------ Recomendaciones
function Recomendaciones({ hechos }: { hechos: K.PedidoH[] }) {
  const { svc, usuario, accion, ver } = useApp();
  const lista = useMemo(() => svc.repo.todos("SELECT * FROM recomendacion ORDER BY CASE estado WHEN 'PROPUESTA' THEN 0 ELSE 1 END, creada_en DESC"), [svc, ver]);
  const NOMBRE: Record<string, string> = { LOTE_SIN_VIDA_UTIL: 'Lote sin vida útil suficiente', SIN_RUTA_FACTIBLE: 'Sin ruta factible / capacidad insuficiente', RIESGO_ATRASO: 'Riesgo alto de atraso', OCUPACION_BAJA: 'Ocupación baja', COSTO_CRECIENTE: 'Costo creciente', DATOS_INSUFICIENTES: 'Datos insuficientes', REVISION_MODELO: 'Revisar el modelo de pronóstico' };
  return (
    <>
      <div className="barra"><p className="nota">Cada recomendación muestra la regla, los valores que la dispararon, la alternativa, su impacto y sus restricciones. Usted decide: aceptar o rechazar no cambia ningún plan automáticamente.</p>
        <BotonAccion primario onClick={() => accion(async () => {
          const cortas = ['P10'].filter((p) => F.pronosticar(svc.repo, hechos, { producto: p, corte: HISTORIA_CORTE }).n_obs < 26).map((p) => `Demanda ${p}`);
          const revision = F.revisarDesempeno(svc.repo, hechos).filter((x) => x.revisar).map((x) => ({ serie: x.serie, wapes: x.corridas.filter((c) => c.semanas).slice(-2).map((c) => `${c.corte.slice(0, 10)}: ${fmtNum(c.wape!, 1)} %`).join(' y ') }));
          const n = await svc.op('recomendaciones', () => G.actualizarRecomendaciones(svc.repo, { pronosticosSinHistoria: cortas, revisionModelo: revision })); return `${n} recomendación(es) nueva(s).`; })}>Evaluar reglas ahora</BotonAccion></div>
      {!lista.length ? <p className="vacio">Sin recomendaciones. Pulse «Evaluar reglas ahora».</p> : lista.map((r) => (
        <div key={String(r.recomendacion_id)} className="recomendacion">
          <div className="cadena-cab"><span className={'chip ' + claseEstado(r.estado === 'PROPUESTA' ? 'Confirmado' : r.estado === 'ACEPTADA' ? 'Completado' : 'Borrador')}>{({ PROPUESTA: 'Propuesta', ACEPTADA: 'Aceptada', RECHAZADA: 'Rechazada' } as Record<string, string>)[String(r.estado)]}</span> <strong>{NOMBRE[String(r.regla)] ?? String(r.regla)}</strong> · {String(r.entidad)} {String(r.entidad_id)}</div>
          <dl className="rec-detalle"><dt>Valores</dt><dd>{String(r.valores)}</dd><dt>Alternativa</dt><dd>{String(r.alternativa)}</dd><dt>Impacto</dt><dd>{String(r.impacto)}</dd><dt>Restricciones</dt><dd>{String(r.restricciones)}</dd>
            {r.estado !== 'PROPUESTA' && <><dt>Decisión</dt><dd>{String(r.decidida_por)} · {String(r.motivo)}</dd></>}</dl>
          {r.estado === 'PROPUESTA' && <div className="botonera">
            {[true, false].map((ac) => <BotonAccion key={String(ac)} permiso="PLANIFICAR" onClick={async () => { const x = await formulario(ac ? 'Aceptar recomendación' : 'Rechazar recomendación', [{ id: 'm', tipo: 'motivo', etiqueta: 'Motivo', opciones: ac ? ['Se aplicará manualmente en Planificación', 'Coincide con lo observado en campo'] : ['El cliente no acepta el cambio', 'Restricción no considerada por la regla', 'Datos de la regla desactualizados'] }], { explicacion: 'La decisión queda registrada. Ningún plan cambia automáticamente.', aceptar: ac ? 'Aceptar' : 'Rechazar' });
              if (x) accion(async () => { await svc.op('decisión de recomendación', () => G.decidirRecomendacion(svc.repo, usuario, String(r.recomendacion_id), ac, x.m)); }, 'Decisión registrada.'); }}>{ac ? 'Aceptar' : 'Rechazar'}</BotonAccion>)}
          </div>}
        </div>
      ))}
      <p className="nota">El efecto económico de cada alternativa se cuantifica en Analítica → Alternativas y EVA.</p>
    </>
  );
}
