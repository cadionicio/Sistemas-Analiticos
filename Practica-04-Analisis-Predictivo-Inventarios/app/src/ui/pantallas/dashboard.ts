/** Pantalla 1 · Dashboard ejecutivo: KPI en tiempo real (SQL sobre la BD) + proyección a 6 meses. */
import { registrar, estado, cargarDatosPractica, analisisCompleto, flujoHTML, estadoFlujoActual, repintar } from '../app';
import { llamar } from '../motor';
import { tarjetaKpi, tarjeta, vacio, insignia, insigniaEstado, esc, fmtMillones, fmtNum, fmtPct, fmtVar, fechaPE, mesCorto, trasPintar, hallazgos } from '../componentes';
import { grafico, opAbanico, opBarras, opLineas, tema } from '../graficos';
import type { ProyeccionSerie } from '../../core/analitica/predictivo';

interface KV { cutoff: string; hasta: string; ventana: string; ventas12: number; ventas12prev: number; utilidad12: number; utilidad12prev: number; margen12: number; margen12prev: number;
  transacciones12: number; clientes12: number; skusPerdida: number; skus: number; serie: { periodo: string; soles: number; utilidad: number }[];
  departamentos: { departamento: string; soles: number; utilidad: number; margen: number }[]; listaDepartamentos: string[]; periodoMin: string }
interface KK { movimientos: number; productos: number; inconsistentes: number; negativos: number; serie: { periodo: string; entradas: number; salidas: number }[]; cutoff: string }

const M = (v: number) => fmtMillones(v);
const MM = (v: number) => fmtNum(v / 1e6, 1);

registrar({ id: 'dashboard', icono: '🏠', menu: 'Dashboard ejecutivo', titulo: 'Dashboard ejecutivo', pregunta: '¿Cómo va el negocio? Últimos 12 meses cerrados vs. 12 meses previos y proyección a 6 meses',
  async pintar() {
    if (!estado.info?.datasets.length) {
      trasPintar(() => document.getElementById('d-practica')?.addEventListener('click', cargarDatosPractica));
      return vacio('📊', 'Aún no hay datos en la base de datos', 'Cargue los dos Excel de la práctica (vienen incluidos en el sistema) o sus propios archivos en la pantalla <b>Datos</b>. Luego pulse <b>▶ Análisis completo en 1 clic</b>.',
        `<button class="btn primario" id="d-practica">📥 Cargar datos de la práctica</button><a class="btn" href="#/datos">🗂 Ir a Datos</a>`);
    }
    const f = estado.filtros;
    const t0 = performance.now();
    const k = await llamar<{ calculadoEn: string; ventas?: KV; kardex?: KK }>('kpis', f);
    const ms = performance.now() - t0;
    const R = estado.R;
    const v = k.ventas, kx = k.kardex;
    let html = '';

    // ---- Filtros globales ----
    if (v) {
      html += `<div class="filtros" id="filtros">
        <label class="campo">Departamento<select id="f-dep"><option value="">Todos</option>${v.listaDepartamentos.map((d) => `<option ${f.departamento === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
        <label class="campo">Desde<input type="month" id="f-desde" min="${v.periodoMin}" max="${v.cutoff}" value="${f.desde ?? v.periodoMin}"/></label>
        <label class="campo">Hasta (fin de la ventana de 12 meses)<input type="month" id="f-hasta" min="${v.periodoMin}" max="${v.cutoff}" value="${f.hasta ?? v.cutoff}"/></label>
        <button class="btn chico" id="f-limpiar">Limpiar filtros</button>
        <span style="flex:1"></span>
        <span class="nota">KPI recalculados con SQL en ${fmtNum(ms, 0)} ms · ${fechaPE(k.calculadoEn)}</span></div>`;
      trasPintar(() => {
        const upd = () => { estado.filtros = { departamento: (document.getElementById('f-dep') as HTMLSelectElement).value || undefined,
          desde: (document.getElementById('f-desde') as HTMLInputElement).value || undefined, hasta: (document.getElementById('f-hasta') as HTMLInputElement).value || undefined }; repintar(); };
        ['f-dep', 'f-desde', 'f-hasta'].forEach((id) => document.getElementById(id)!.addEventListener('change', upd));
        document.getElementById('f-limpiar')!.addEventListener('click', () => { estado.filtros = {}; repintar(); });
      });
    }

    // ---- KPI de ventas ----
    if (v) {
      const dv = v.ventas12 / (v.ventas12prev || NaN) - 1, du = v.utilidad12 / (v.utilidad12prev || NaN) - 1, dm = v.margen12 - v.margen12prev;
      const shareP = v.skusPerdida / (v.skus || 1);
      html += `<div class="grid g4">
        ${tarjetaKpi({ id: 'kpi-ventas', etiqueta: `Ventas 12 meses${f.departamento ? ` · ${f.departamento}` : ''}`, valor: M(v.ventas12), delta: `${fmtVar(dv)} vs. ${M(v.ventas12prev)}`, sentido: dv >= 0 ? 'sube' : 'baja', formula: `Σ ventas S/ de ${v.ventana} (12 meses cerrados) comparado con los 12 meses previos` })}
        ${tarjetaKpi({ id: 'kpi-utilidad', etiqueta: 'Utilidad operativa 12 meses', valor: M(v.utilidad12), delta: `${fmtVar(du)} vs. ${M(v.utilidad12prev)}`, sentido: du >= 0 ? 'sube' : 'baja', formula: 'Σ utilidad operativa S/ de los 12 meses cerrados' })}
        ${tarjetaKpi({ id: 'kpi-margen', etiqueta: 'Margen operativo', valor: fmtPct(v.margen12), delta: `${dm >= 0 ? '+' : ''}${fmtNum(dm * 100, 2)} pp vs. ${fmtPct(v.margen12prev)}`, sentido: dm >= 0 ? 'sube' : 'baja', formula: 'Margen = utilidad operativa ÷ ventas (12 meses)' })}
        ${tarjetaKpi({ id: 'kpi-perdida', etiqueta: 'Productos con utilidad negativa', valor: fmtNum(v.skusPerdida), unidadMenor: `de ${fmtNum(v.skus)}`, delta: `${fmtNum(shareP * 100, 0)} % del surtido`,
          semaforo: shareP > 0.25 ? insignia('Crítico', 'crit') : shareP > 0.1 ? insignia('Alto', 'warn') : insignia('Normal', 'ok'), formula: 'N.º de SKU cuya utilidad acumulada en el rango filtrado es < 0' })}
      </div>`;

      // Serie + proyección
      const serieP = R?.pv?.result.series.find((s) => s.serie === 'ventas_soles' && (f.departamento ? s.clave === f.departamento : s.nivel === 'total')) as ProyeccionSerie | undefined;
      const hist = v.serie.map((x) => ({ periodo: x.periodo, valor: x.soles })).filter((x) => x.periodo <= v.cutoff);
      const usarProy = serieP && !f.hasta && !f.desde;
      const tablaSerie = { cols: ['Mes', 'Ventas S/', 'Utilidad S/'], filas: v.serie.map((x) => [mesCorto(x.periodo), x.soles, x.utilidad]) };
      const graf = usarProy
        ? grafico(opAbanico(hist, serieP!.horizonte, serieP!.porMes, (x) => `S/ ${MM(x)} M`), { nombre: 'venta_mensual_proyeccion', clase: 'alto',
            tabla: { cols: ['Mes', 'Real S/', 'P10', 'P50', 'P90'], filas: [...hist.slice(-24).map((h) => [mesCorto(h.periodo), h.valor, '', '', '']), ...serieP!.horizonte.map((p, i) => [mesCorto(p) + ' (proy.)', '', serieP!.porMes[i].p10, serieP!.porMes[i].p50, serieP!.porMes[i].p90])] } })
        : grafico(opLineas(v.serie.map((x) => x.periodo), [{ nombre: 'Ventas S/', datos: v.serie.map((x) => x.soles) }, { nombre: 'Utilidad S/', datos: v.serie.map((x) => x.utilidad), eje: 1 }], (x) => `${MM(x)} M`, (x) => `${MM(x)} M`), { nombre: 'venta_mensual', clase: 'alto', tabla: tablaSerie });
      const sub = usarProy
        ? `¿Qué pasó y qué pasará? · S/ millones · banda = intervalo 80 % (P10–P90) y 95 % · modelo <b>${esc(serieP!.modelo)}</b> elegido por backtesting · P50 6 meses <b>${M(serieP!.total.p50)}</b> (${M(serieP!.total.p10)} – ${M(serieP!.total.p90)})`
        : R?.pv ? 'Con filtros de fecha se muestra solo la historia; quite los filtros de fecha para ver la proyección.' : 'Ejecute <b>▶ Análisis completo en 1 clic</b> para agregar la proyección a 6 meses (P10–P50–P90).';

      const deps = [...v.departamentos].sort((a, b) => a.margen - b.margen);
      const t = tema();
      html += `<div class="grid g21 mt">
        ${tarjeta('Venta mensual y proyección a 6 meses', graf, { sub })}
        ${tarjeta('Margen operativo por departamento', grafico(opBarras(deps.map((d) => d.departamento), [{ nombre: 'Margen', datos: deps.map((d) => d.margen) }], (x) => `${fmtNum(x * 100, 2)} %`,
          { horizontal: true, etiquetas: true, colorPorValor: (x) => (x < 0.01 ? t.crit : x < 0.03 ? t.warn : t.s1) }), { nombre: 'margen_departamento', clase: 'alto', alClic: (p) => { estado.filtros = { ...estado.filtros, departamento: p.name }; repintar(); },
          tabla: { cols: ['Departamento', 'Ventas S/', 'Utilidad S/', 'Margen %'], filas: deps.map((d) => [d.departamento, d.soles, d.utilidad, d.margen * 100]) } }),
          { sub: '¿Dónde se pierde margen? · clic en una barra para filtrar el tablero' })}
      </div>`;
    }

    // ---- Estado del Super Agente + alertas ----
    const al = R?.pr ? await llamar<{ tipo: string; severidad: string; entidad: string; mensaje: string }[]>('alertas') : [];
    const skills = R ? [R.dv, R.gv, R.pv, R.dk, R.gk, R.pk, R.pr, R.sm].filter(Boolean) : [];
    const agente = `${flujoHTML(estadoFlujoActual())}
      ${skills.length ? `<table class="t mt"><thead><tr><th>Skill</th><th>Estado</th><th>run_id</th></tr></thead><tbody>${skills.map((s) => `<tr><td>${esc(s!.skill)}</td><td>${insigniaEstado(s!.status)}</td><td><code>${s!.run_id.slice(0, 8)}</code></td></tr>`).join('')}</tbody></table>`
        : `<p class="nota">Aún no se ejecuta el análisis.</p><button class="btn primario" id="d-1clic">▶ Análisis completo en 1 clic</button>`}`;
    trasPintar(() => document.getElementById('d-1clic')?.addEventListener('click', analisisCompleto));
    const listaAl = al.length ? `<div class="alertas-lista">${al.slice(0, 7).map((a) => `<div class="a">${insigniaEstado(a.severidad === 'ALTA' ? 'CRITICA' : a.severidad === 'MEDIA' ? 'MEDIA' : 'BAJA', a.severidad === 'ALTA' ? 'Alta' : a.severidad === 'MEDIA' ? 'Media' : 'Info')}<div>${esc(a.mensaje)}</div></div>`).join('')}</div><a href="#/alertas" class="nota">Ver las ${fmtNum(al.length)} alertas →</a>`
      : '<p class="nota">Las alertas (quiebre inminente, sobrestock, inconsistencias, margen negativo) aparecen tras el análisis completo.</p>';

    // ---- Kardex ----
    if (kx) {
      const pk = R?.pk?.result.total;
      const serieK = kx.serie.filter((x) => x.periodo <= kx.cutoff);
      const grafK = pk
        ? grafico(opAbanico(pk.historia, pk.horizonte, pk.porMes, (x) => fmtNum(x, 0), 24), { nombre: 'kardex_salidas_proyeccion', tabla: { cols: ['Mes', 'Salidas unid.', 'P10', 'P50', 'P90'], filas: [...pk.historia.map((h) => [mesCorto(h.periodo), h.valor, '', '', '']), ...pk.horizonte.map((p, i) => [mesCorto(p) + ' (proy.)', '', pk.porMes[i].p10, pk.porMes[i].p50, pk.porMes[i].p90])] } })
        : grafico(opBarras(serieK.map((x) => x.periodo), [{ nombre: 'Entradas', datos: serieK.map((x) => x.entradas) }, { nombre: 'Salidas', datos: serieK.map((x) => x.salidas), color: tema().s2 }], (x) => fmtNum(x, 0), { mesesX: true }),
          { nombre: 'kardex_entradas_salidas', tabla: { cols: ['Mes', 'Entradas', 'Salidas'], filas: serieK.map((x) => [mesCorto(x.periodo), x.entradas, x.salidas]) } });
      html += `<div class="grid g4 mt">
        ${tarjetaKpi({ etiqueta: 'Movimientos de Kardex', valor: fmtNum(kx.movimientos), delta: `${fmtNum(kx.productos)} productos · corte ${mesCorto(kx.cutoff)}`, formula: 'Registros de entrada/salida importados + registros manuales' })}
        ${tarjetaKpi({ etiqueta: 'Saldos que no cuadran', valor: fmtNum(kx.inconsistentes), delta: 'saldo informado ≠ saldo recalculado', sentido: kx.inconsistentes ? 'baja' : 'neutro', semaforo: kx.inconsistentes ? insignia('Crítico', 'crit') : insignia('OK', 'ok'), formula: 'Regla K04: stock informado vs. stock anterior + entrada − salida' })}
        ${tarjetaKpi({ etiqueta: 'Registros con stock negativo', valor: fmtNum(kx.negativos), delta: 'físicamente imposible', sentido: kx.negativos ? 'baja' : 'neutro', semaforo: kx.negativos ? insignia('Alto', 'warn') : insignia('OK', 'ok'), formula: 'Regla K05: stock recalculado < 0' })}
        ${tarjetaKpi({ etiqueta: 'Salidas proyectadas 6 meses (P50)', valor: pk ? fmtNum(pk.total.p50, 0) : '—', unidadMenor: pk ? 'unid.' : '', delta: pk ? `P10–P90: ${fmtNum(pk.total.p10, 0)} – ${fmtNum(pk.total.p90, 0)}` : 'tras el análisis completo', formula: 'Suma de 6 meses de la proyección de salidas totales (bootstrap, 10 000 trayectorias)' })}
      </div>
      <div class="grid g21 mt">
        ${tarjeta(pk ? 'Kardex: salidas mensuales y proyección a 6 meses' : 'Kardex: entradas y salidas por mes', grafK, { sub: pk ? `Unidades · modelo <b>${esc(pk.modelo)}</b> · horizonte ${pk.horizonte.map(mesCorto).join(', ')}` : 'Unidades físicas por mes (meses cerrados)' })}
        ${tarjeta('Alertas del Super Agente', listaAl, { sub: 'Priorizadas por severidad' })}
      </div>`;
      html += `<div class="grid g2 mt">${tarjeta('Estado del Super Agente', agente, { sub: 'Máquina de estados y resultado de cada skill (contrato transversal)' })}${tarjeta('Resumen del agente', resumenAgente(v), {})}</div>`;
    } else {
      html += `<div class="grid g2 mt">${tarjeta('Alertas del Super Agente', listaAl, { sub: 'Priorizadas por severidad' })}${tarjeta('Estado del Super Agente', agente, {})}</div>`;
    }
    return html;
  },
});

function resumenAgente(v?: KV): string {
  const R = estado.R;
  if (!R?.dv || !v) return '<p class="nota">El resumen en lenguaje natural se genera con los resultados del análisis completo.</p>';
  const d = R.dv.result, g = R.gv?.result, p = R.pv?.result, pr = R.pr?.result;
  const tot = p?.series.find((s) => s.serie === 'ventas_soles' && s.nivel === 'total');
  const items: { t: 'E' | 'D' | 'S'; texto: string }[] = [
    { t: 'E', texto: `Ventas de 12 meses <b>${fmtMillones(d.kpi12.ventas)}</b> (${fmtVar(d.variacion.ventas)}); utilidad <b>${fmtMillones(d.kpi12.utilidad)}</b> (${fmtVar(d.variacion.utilidad)}); margen ${fmtPct(d.kpi12prev.margen)} → <b>${fmtPct(d.kpi12.margen)}</b>.` },
  ];
  if (g) items.push({ t: 'D', texto: `La caída de ventas se explica por <b>volumen</b> (${fmtMillones(g.pvm.volumen)}) y no por precio (${fmtMillones(g.pvm.precio)}); la mezcla aporta ${fmtMillones(g.pvm.mezcla)}. ${fmtNum(g.perdidas.skus)} SKU con pérdida.` });
  if (tot) items.push({ t: 'E', texto: `Proyección ${tot.horizonte.map(mesCorto)[0]}–${mesCorto(tot.horizonte.at(-1)!)}: <b>${fmtMillones(tot.total.p50)}</b> (80 %: ${fmtMillones(tot.total.p10)} – ${fmtMillones(tot.total.p90)}); P(utilidad 6 m < 0) = ${fmtPct(p!.probabilidades.utilidad6mNegativa, 1)}.` });
  if (pr) items.push({ t: 'S', texto: `${pr.recomendaciones.length} recomendaciones priorizadas; beneficio recurrente estimado ${fmtMillones(pr.caso.recurrente.conservador)} / <b>${fmtMillones(pr.caso.recurrente.central)}</b> / ${fmtMillones(pr.caso.recurrente.favorable)} por año (conservador/central/favorable).` });
  return hallazgos(items, 'Lo que el agente concluye (cifras del motor, sin LLM)');
}
