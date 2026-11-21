/** Pantallas 3–6 · Análisis descriptivo, diagnóstico, predictivo y prescriptivo (resultados del Super Agente). */
import { registrar, estado, analisisCompleto, repintar, flujoHTML, estadoFlujoActual, trasCambioDeDatos } from '../app';
import { llamar } from '../motor';
import { tarjeta, tarjetaKpi, tabla, vacio, insignia, insigniaEstado, esc, fmtNum, fmtMillones, fmtPct, fmtVar, fmtPp, mesCorto, trasPintar, hallazgos, avisar, confirmar, ayuda } from '../componentes';
import { grafico, opAbanico, opBarras, opLineas, opCascada, tema } from '../graficos';
import type { ResultadoSkill } from '../../core/analitica/contrato';
import type { Hipotesis } from '../../core/analitica/diagnostico';
import type { ProyeccionSerie } from '../../core/analitica/predictivo';

const MM = (v: number) => `${fmtNum(v / 1e6, 1)} M`;
const sinAnalisis = (que: string) => {
  trasPintar(() => document.getElementById('s-1clic')?.addEventListener('click', analisisCompleto));
  return vacio('🤖', `Aún no hay resultados ${que}`, estado.info?.datasets.length ? 'Los datos ya están cargados. Pulse el botón para que el Super Agente ejecute todas las skills (≈ 20–40 s, en segundo plano).' : 'Primero cargue datos en la pantalla <b>Datos</b>.',
    estado.info?.datasets.length ? '<button class="btn primario" id="s-1clic">▶ Análisis completo en 1 clic</button>' : '<a class="btn primario" href="#/datos">🗂 Ir a Datos</a>');
};
let pestana: Record<string, string> = {};
function pestanas(pantalla: string, opciones: { id: string; t: string; ok: boolean }[]): string {
  const disp = opciones.filter((o) => o.ok);
  if (!disp.find((o) => o.id === pestana[pantalla])) pestana[pantalla] = disp[0]?.id ?? '';
  trasPintar(() => document.querySelectorAll<HTMLButtonElement>(`.pestanas[data-p="${pantalla}"] button`).forEach((b) => b.addEventListener('click', () => { pestana[pantalla] = b.dataset.id!; repintar(); })));
  return `<div class="pestanas" data-p="${pantalla}" role="tablist">${disp.map((o) => `<button role="tab" data-id="${o.id}" class="${pestana[pantalla] === o.id ? 'activo' : ''}">${esc(o.t)}</button>`).join('')}</div>`;
}
/** Pie de cada análisis: contrato transversal (trazabilidad del agente). */
export function contrato(r: ResultadoSkill<unknown>): string {
  return `<details class="tarjeta mt"><summary><b>Trazabilidad del agente</b> · skill <code>${esc(r.skill_version)}</code> · ${insigniaEstado(r.status)} · run <code>${r.run_id.slice(0, 8)}</code></summary>
    <div class="grid g2 mt"><dl class="kv"><dt>run_id</dt><dd><code>${r.run_id}</code></dd><dt>Corte (cutoff)</dt><dd>${esc(r.cutoff ?? '—')}</dd><dt>Hash de la fuente</dt><dd><code>${r.source_hash.slice(0, 16)}…</code></dd>
      <dt>Estado del flujo</dt><dd>${insigniaEstado(r.estado_flujo)}</dd><dt>Siguiente acción</dt><dd><code>${esc(r.next_action)}</code></dd><dt>Ejecución</dt><dd>${esc(r.inicio)} → ${esc(r.fin)}</dd></dl>
    <div>${r.validation.length ? `<b>Validaciones</b><ul>${r.validation.map((v) => `<li>${v.ok ? '✔' : '✖'} ${esc(v.regla)}${v.detalle ? ` — ${esc(v.detalle)}` : ''}</li>`).join('')}</ul>` : ''}
      ${r.assumptions.length ? `<b>Supuestos</b><ul>${r.assumptions.map((a) => `<li>${insignia('SUPUESTO', 'warn')} ${esc(a.clave)}: ${esc(a.valor)}</li>`).join('')}</ul>` : ''}
      ${r.warnings.length ? `<b>Advertencias</b><ul>${r.warnings.map((w) => `<li>⚠ ${esc(w)}</li>`).join('')}</ul>` : ''}</div></div></details>`;
}

// =============================== DESCRIPTIVO ===============================
registrar({ id: 'descriptivo', icono: '📊', menu: 'Análisis descriptivo', titulo: 'Análisis descriptivo', pregunta: '¿Qué pasó? Ventas, utilidad, márgenes, clasificación ABC-XYZ y comportamiento del inventario',
  pintar() {
    const R = estado.R;
    if (!R?.dv && !R?.dk) return sinAnalisis('del análisis descriptivo');
    let html = pestanas('des', [{ id: 'v', t: '💰 Ventas y utilidad', ok: !!R.dv }, { id: 'k', t: '📦 Kardex (almacén)', ok: !!R.dk }]);
    const t = tema();
    if (pestana.des === 'v' && R.dv) {
      const d = R.dv.result;
      html += `<div class="grid g4">
        ${tarjetaKpi({ etiqueta: 'Ventas 12 meses', valor: fmtMillones(d.kpi12.ventas), delta: `${fmtVar(d.variacion.ventas)} vs. 12 meses previos`, sentido: d.variacion.ventas >= 0 ? 'sube' : 'baja' })}
        ${tarjetaKpi({ etiqueta: 'Utilidad operativa 12 meses', valor: fmtMillones(d.kpi12.utilidad), delta: fmtVar(d.variacion.utilidad), sentido: d.variacion.utilidad >= 0 ? 'sube' : 'baja' })}
        ${tarjetaKpi({ etiqueta: 'Ticket promedio', valor: `S/ ${fmtNum(d.kpi12.ticket, 0)}`, delta: `${fmtNum(d.kpi12.transacciones)} transacciones · ${fmtNum(d.kpi12.clientes)} clientes`, formula: 'Ventas ÷ transacciones (12 meses)' })}
        ${tarjetaKpi({ etiqueta: 'Histórico total', valor: fmtMillones(d.totalHistorico.ventas), delta: `utilidad ${fmtMillones(d.totalHistorico.utilidad)} · margen ${fmtPct(d.totalHistorico.margen)}`, formula: `${d.meses.length} meses cerrados (${mesCorto(d.meses[0])} – ${mesCorto(d.cutoff)})` })}
      </div>
      <div class="mt">${tarjeta('Ventas y utilidad operativa por mes', grafico(opLineas(d.serie.map((s) => s.periodo), [{ nombre: 'Ventas S/', datos: d.serie.map((s) => s.soles), area: true }, { nombre: 'Utilidad S/ (eje der.)', datos: d.serie.map((s) => s.utilidad), eje: 1, color: t.s2 }], MM, MM),
        { nombre: 'ventas_utilidad_mensual', tabla: { cols: ['Mes', 'Ventas S/', 'Utilidad S/', 'Volumen', 'Transacciones'], filas: d.serie.map((s) => [mesCorto(s.periodo), s.soles, s.utilidad, s.volumen, s.transacciones]) } }),
        { sub: 'S/ millones · use la rueda del mouse sobre el gráfico para acercar' })}</div>
      <div class="grid g2 mt">
        ${tarjeta('Participación y margen por departamento', tabla(d.departamentos as never[], [{ k: 'departamento', t: 'Departamento' }, { k: 'soles', t: 'Ventas', n: true, f: (v) => fmtMillones(v as number) },
          { k: 'participacion', t: 'Participación', n: true, f: (v) => fmtPct(v as number, 1) }, { k: 'utilidad', t: 'Utilidad', n: true, f: (v) => fmtMillones(v as number, 2) }, { k: 'margen', t: 'Margen', n: true, f: (v) => fmtPct(v as number) }], { nombre: 'departamentos', buscar: false }), { sub: 'Todo el histórico' })}
        ${tarjeta('Índice estacional (1 = mes promedio)', grafico(opBarras(Object.keys(d.indiceEstacional).map((m) => ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][+m - 1]), [{ nombre: 'Índice', datos: Object.values(d.indiceEstacional) }], (x) => fmtNum(x, 2),
          { colorPorValor: (x) => (x >= 1 ? t.s1 : t.s2) }), { nombre: 'indice_estacional', clase: 'bajo', tabla: { cols: ['Mes', 'Índice'], filas: Object.entries(d.indiceEstacional).map(([m, v]) => [m, v]) } }), { sub: 'Venta del mes ÷ promedio anual' })}
      </div>
      <div class="grid g3 mt">
        ${tarjeta('Clasificación ABC (ventas)', abcTabla(d.abc, 'SKU'), { sub: 'A = 80 % de las ventas, B = 15 %, C = 5 %' })}
        ${tarjeta('Variabilidad XYZ', abcTabla(d.xyz, 'SKU', { X: 'CV ≤ 0,5 (estable)', Y: '0,5 < CV ≤ 1,0', Z: 'CV > 1,0 (errática)' }), { sub: 'Coeficiente de variación mensual' })}
        ${tarjeta('Patrón de demanda (Syntetos-Boylan)', abcTabla(d.patrones, 'SKU'), { sub: 'ADI = 1,32 · CV² = 0,49' })}
      </div>
      <div class="grid g2 mt">
        ${tarjeta(`Top ${d.topVentas.length} SKU por ventas`, tabla(d.topVentas as never[], colsSku, { nombre: 'top_ventas', alto: 320 }))}
        ${tarjeta(`Top ${d.topPerdidas.length} SKU con mayor pérdida`, tabla(d.topPerdidas as never[], colsSku, { nombre: 'top_perdidas', alto: 320 }), { sub: `${fmtNum(d.skusConPerdida)} de ${fmtNum(d.skus)} SKU con utilidad acumulada negativa` })}
      </div>
      <div class="mt">${hallazgos([
        { t: 'E', texto: `En los últimos 12 meses (${mesCorto(d.meses.at(-12)!)} – ${mesCorto(d.cutoff)}) las ventas fueron ${fmtMillones(d.kpi12.ventas)} (${fmtVar(d.variacion.ventas)}) y la utilidad ${fmtMillones(d.kpi12.utilidad)} (${fmtVar(d.variacion.utilidad)}): la utilidad cae ${fmtNum(Math.abs(d.variacion.utilidad / (d.variacion.ventas || 1)), 1)} veces más rápido que las ventas.` },
        { t: 'E', texto: `El margen operativo bajó de ${fmtPct(d.kpi12prev.margen)} a ${fmtPct(d.kpi12.margen)} (${fmtPp(d.variacion.margenPp / 100)}).` },
        { t: 'E', texto: `Los 20 SKU más vendidos concentran ${fmtPct(d.concentracionTop20Sku, 1)} de las ventas; ${fmtNum(d.abc.A ?? 0)} SKU (clase A) generan el 80 %.` },
        { t: 'D', texto: `${fmtNum(d.skusConPerdida)} SKU (${fmtPct(d.skusConPerdida / d.skus, 0)} del surtido) acumulan utilidad negativa: posible problema de precios, costos o mezcla (ver Diagnóstico).` },
      ])}</div>${contrato(R.dv)}`;
    }
    if (pestana.des === 'k' && R.dk) {
      const d = R.dk.result;
      html += `<div class="grid g4">
        ${tarjetaKpi({ etiqueta: 'Productos en el Kardex', valor: fmtNum(d.productos), delta: `${d.meses.length} meses · ${fmtNum(d.dias)} días` })}
        ${tarjetaKpi({ etiqueta: 'Salidas totales', valor: fmtNum(d.totales.salidas, 0), unidadMenor: 'unid.', delta: `venta ${fmtNum(d.totales.salVenta, 0)} · consumo ${fmtNum(d.totales.salConsumo, 0)}` })}
        ${tarjetaKpi({ etiqueta: 'Sin salidas en el periodo', valor: fmtNum(d.sinSalidas.length), delta: 'riesgo de obsolescencia', sentido: d.sinSalidas.length ? 'baja' : 'neutro', semaforo: d.sinSalidas.length ? insignia('Alto', 'warn') : '' })}
        ${tarjetaKpi({ etiqueta: 'Cobertura > 180 días', valor: fmtNum(d.coberturaMayor180), delta: `${fmtNum(d.conStockNegativo)} productos con stock negativo`, sentido: 'baja', formula: 'Cobertura = stock final ÷ salida diaria promedio' })}
      </div>
      <div class="grid g21 mt">
        ${tarjeta('Entradas y salidas por mes (por origen)', grafico(opBarras(d.serie.map((s) => s.periodo), [
          { nombre: 'Salida por venta', datos: d.serie.map((s) => s.salVenta), pila: 's', color: t.s1 }, { nombre: 'Salida por consumo/producción', datos: d.serie.map((s) => s.salConsumo), pila: 's', color: t.s3 },
          { nombre: 'Entrada por compra', datos: d.serie.map((s) => s.entCompra), pila: 'e', color: t.s2 }, { nombre: 'Entrada por producción', datos: d.serie.map((s) => s.entProduccion), pila: 'e', color: t.s4 }], (x) => fmtNum(x, 0), { mesesX: true }),
          { nombre: 'kardex_origen_mensual', tabla: { cols: ['Mes', 'Sal. venta', 'Sal. consumo', 'Ent. compra', 'Ent. producción'], filas: d.serie.map((s) => [mesCorto(s.periodo), s.salVenta, s.salConsumo, s.entCompra, s.entProduccion]) } }), { sub: 'Unidades físicas' })}
        <div class="grid">${tarjeta('ABC por volumen de salidas', abcTabla(d.abc, 'productos'))}${tarjeta('Patrón de demanda', abcTabla(d.patrones, 'productos'))}</div>
      </div>
      <div class="mt">${tarjeta('Indicadores por producto', tabla(d.porProducto as never[], [
        { k: 'codigo', t: 'Código' }, { k: 'descripcion', t: 'Descripción' }, { k: 'familia', t: 'Familia' }, { k: 'abc', t: 'ABC' }, { k: 'patron', t: 'Patrón' },
        { k: 'entradas', t: 'Entradas', n: true, f: (v) => fmtNum(v as number, 0) }, { k: 'salidas', t: 'Salidas', n: true, f: (v) => fmtNum(v as number, 0) },
        { k: 'stockFinal', t: 'Stock final', n: true, f: (v) => fmtNum(v as number, 0) }, { k: 'rotacion', t: 'Rotación', n: true, f: (v) => (v == null ? '—' : fmtNum(v as number, 2)) },
        { k: 'coberturaDias', t: 'Cobertura (días)', n: true, f: (v) => (v == null ? '—' : fmtNum(v as number, 0)) }, { k: 'mesesSinStock', t: 'Meses sin stock', n: true, f: (v) => String(v) },
      ], { nombre: 'kardex_por_producto', alto: 420 }), { sub: 'Clic en un encabezado para ordenar · filtre por código, familia o patrón' })}</div>
      <div class="mt">${hallazgos([
        { t: 'E', texto: `${fmtNum(d.productos)} productos en ${d.meses.length} meses cerrados; salidas totales ${fmtNum(d.totales.salidas, 0)} unid. (${fmtPct(d.totales.salConsumo / (d.totales.salidas || 1), 0)} por consumo de producción).` },
        { t: 'E', texto: `${fmtNum(d.patrones.INTERMITENTE ?? 0)} productos intermitentes y ${fmtNum(d.patrones.IRREGULAR ?? 0)} irregulares: requieren métodos Croston/SBA/TSB y no promedios simples.` },
        { t: 'D', texto: `${fmtNum(d.sinSalidas.length)} productos sin salidas y ${fmtNum(d.coberturaMayor180)} con cobertura > 180 días: capital inmovilizado a verificar físicamente.` },
      ])}</div>${contrato(R.dk)}`;
    }
    return html;
  },
});
const colsSku = [{ k: 'sku', t: 'SKU' }, { k: 'soles', t: 'Ventas', n: true, f: (v: unknown) => fmtMillones(v as number, 2) }, { k: 'utilidad', t: 'Utilidad', n: true, f: (v: unknown) => fmtMillones(v as number, 2) }, { k: 'margen', t: 'Margen', n: true, f: (v: unknown) => fmtPct(v as number) }] as never[];
function abcTabla(m: Record<string, number>, u: string, desc: Record<string, string> = {}): string {
  const tot = Object.values(m).reduce((a, b) => a + b, 0) || 1;
  return `<table class="t"><tbody>${Object.entries(m).map(([k, v]) => `<tr><td><b>${esc(k.replace(/_/g, ' '))}</b>${desc[k] ? ` <span class="nota">${desc[k]}</span>` : ''}</td><td class="n">${fmtNum(v)} ${u}</td><td class="n">${fmtPct(v / tot, 0)}</td><td style="width:35%"><div style="height:8px;border-radius:4px;background:var(--s1);width:${(v / tot) * 100}%"></div></td></tr>`).join('')}</tbody></table>`;
}

// =============================== DIAGNÓSTICO ===============================
const tablaHip = (h: Hipotesis[], nombre: string) => tabla(h as never[], [
  { k: 'problemaId', t: 'Prob.', f: (v) => (v ? `#${v}` : '—') }, { k: 'titulo', t: 'Problema / hipótesis', f: (v, r) => `<b>${esc(v)}</b><div class="nota">${esc((r as Hipotesis).hipotesis)}</div>` },
  { k: 'categoria', t: '6M' }, { k: 'favor', t: 'Evidencia a favor', f: (v) => `<span class="nota">${esc(v)}</span>` }, { k: 'contra', t: 'En contra', f: (v) => `<span class="nota">${esc(v)}</span>` },
  { k: 'sustento', t: 'Sustento', f: (v) => insigniaEstado(v as string) }, { k: 'contribucion', t: 'Contribución', n: true, f: (v, r) => (v == null ? '—' : (r as Hipotesis).unidad === 'S/' ? fmtMillones(v as number, 2) : `${fmtNum(v as number, 2)} ${esc((r as Hipotesis).unidad ?? '')}`) },
], { nombre, alto: 520 });
const ishikawa = (m: Record<string, string[]>) => `<div class="grid g3">${Object.entries(m).map(([k, v]) => `<div class="tarjeta" style="padding:10px 12px"><b>${esc(k)}</b><ul style="margin:4px 0 0;padding-left:18px;font-size:12.5px">${v.length ? v.map((x) => `<li>${esc(x)}</li>`).join('') : '<li class="nota">sin causas con evidencia</li>'}</ul></div>`).join('')}</div>`;

registrar({ id: 'diagnostico', icono: '🔎', menu: 'Análisis diagnóstico', titulo: 'Análisis diagnóstico', pregunta: '¿Por qué pasó? Causa raíz con evidencia: precio-volumen-mezcla, pérdidas, Ishikawa 6M y 5 porqués',
  pintar() {
    const R = estado.R;
    if (!R?.gv && !R?.gk) return sinAnalisis('del análisis diagnóstico');
    let html = pestanas('dia', [{ id: 'v', t: '💰 Ventas y utilidad', ok: !!R.gv }, { id: 'k', t: '📦 Kardex (almacén)', ok: !!R.gk }]);
    if (pestana.dia === 'v' && R.gv) {
      const g = R.gv.result;
      html += `<div class="grid g21">
        ${tarjeta('¿Por qué cambiaron las ventas? Descomposición precio-volumen-mezcla', grafico(opCascada([
          { nombre: 'Precio', valor: g.pvm.precio }, { nombre: 'Volumen', valor: g.pvm.volumen }, { nombre: 'Mezcla', valor: g.pvm.mezcla }, { nombre: 'SKU nuevos', valor: g.pvm.nuevos }, { nombre: 'SKU perdidos', valor: g.pvm.perdidos }, { nombre: 'Variación total', valor: g.pvm.total, total: true }], MM),
          { nombre: 'pvm', tabla: { cols: ['Efecto', 'S/'], filas: Object.entries(g.pvm).map(([k, v]) => [k, v]) } }), { sub: `${esc(g.ventana.anterior)} → ${esc(g.ventana.actual)} · S/ · reconcilia exactamente con la variación total` })}
        ${tarjeta('¿Por qué cayó la utilidad?', `<dl class="kv"><dt>Efecto volumen</dt><dd>${fmtMillones(g.utilidad.efectoVolumen)} ${ayuda('Δ ventas × margen anterior')}</dd><dt>Efecto margen</dt><dd><b>${fmtMillones(g.utilidad.efectoMargen)}</b> ${ayuda('Δ margen × ventas actuales')}</dd><dt>Total</dt><dd>${fmtMillones(g.utilidad.total)}</dd>
          <dt>SKU con pérdida</dt><dd>${fmtNum(g.perdidas.skus)} · ${fmtMillones(g.perdidas.total)} (el top 20 explica ${fmtPct(g.perdidas.top20Participacion, 0)})</dd><dt>Meses con utilidad negativa</dt><dd>${g.mesesUtilidadNegativa}</dd>
          <dt>Anomalías (MAD)</dt><dd>${g.anomaliasUtilidad.length ? g.anomaliasUtilidad.map(mesCorto).join(', ') : 'ninguna'}</dd><dt>Correlación precio–margen</dt><dd>r = ${fmtNum(g.correlacionPrecioMargen, 2)}</dd></dl>`)}
      </div>
      <div class="mt">${tarjeta('Problemas críticos: hipótesis con evidencia (ayuda base, PDF 01)', tablaHip(g.hipotesis, 'hipotesis_ventas'), { sub: 'Sustento: COMPROBADA (dato directo) · ASOCIATIVA (correlación) · A VERIFICAR (falta dato) · SIN EVIDENCIA' })}</div>
      <div class="grid g2 mt">
        ${tarjeta('Variación de utilidad por departamento', tabla(g.departamentos as never[], [{ k: 'departamento', t: 'Departamento' }, { k: 'deltaUtilidad', t: 'Δ utilidad', n: true, f: (v) => fmtMillones(v as number, 2) }, { k: 'margenAnterior', t: 'Margen ant.', n: true, f: (v) => fmtPct(v as number) }, { k: 'margenActual', t: 'Margen act.', n: true, f: (v) => fmtPct(v as number) }], { nombre: 'delta_departamento', buscar: false }))}
        ${tarjeta('5 porqués', `<p><b>Problema:</b> ${esc(g.cincoPorques.problema)}</p><ol>${g.cincoPorques.porques.map((p) => `<li>${esc(p)}</li>`).join('')}</ol><p><b>Causa raíz:</b> ${esc(g.cincoPorques.causaRaiz)}</p>`)}
      </div>
      <div class="mt">${tarjeta('Diagrama de Ishikawa (6M)', ishikawa(g.ishikawa))}</div>
      <div class="mt">${hallazgos(g.hipotesis.filter((h) => h.sustento === 'COMPROBADA' || h.sustento === 'ASOCIATIVA').slice(0, 5).map((h) => ({ t: h.sustento === 'COMPROBADA' ? 'E' as const : 'D' as const, texto: `<b>${esc(h.titulo)}</b>: ${esc(h.favor)}` })))}</div>${contrato(R.gv)}`;
    }
    if (pestana.dia === 'k' && R.gk) {
      const g = R.gk.result;
      html += `<div class="grid g4">
        ${tarjetaKpi({ etiqueta: 'Saldos que no cuadran', valor: fmtNum(g.conciliacion.saldosNoCuadran), delta: `${fmtNum(g.conciliacion.bloquesDescuadrados)} bloques descuadrados`, sentido: 'baja', semaforo: insignia('Crítico', 'crit') })}
        ${tarjetaKpi({ etiqueta: 'Registros con stock negativo', valor: fmtNum(g.conciliacion.stockNegativo), delta: `${fmtNum(g.conciliacion.productosNegativo)} productos`, sentido: 'baja' })}
        ${tarjetaKpi({ etiqueta: 'Obsolescencia', valor: fmtNum(g.obsolescencia.sinSalidas), unidadMenor: 'sin salidas', delta: `${fmtNum(g.obsolescencia.coberturaMayor180)} con cobertura > 180 días` })}
        ${tarjetaKpi({ etiqueta: 'Consumo vs. ingreso de producto terminado', valor: `r = ${fmtNum(g.produccion.correlacionConsumoVsIngresoPT, 2)}`, delta: `ratio ${fmtNum(g.produccion.ratioConsumoIngresoPT, 2)}`, formula: 'Correlación mensual entre salidas por consumo y entradas por producción' })}
      </div>
      <div class="mt">${tarjeta('Problemas críticos del almacén: hipótesis con evidencia', tablaHip(g.hipotesis, 'hipotesis_kardex'))}</div>
      <div class="mt">${tarjeta('Diagrama de Ishikawa (6M) · Kardex', ishikawa(g.ishikawa))}</div>
      <div class="mt">${hallazgos([
        { t: 'E', texto: `${fmtNum(g.conciliacion.saldosNoCuadran)} saldos informados no cuadran con el recálculo y hay ${fmtNum(g.conciliacion.stockNegativo)} registros con stock negativo: el Kardex no es confiable sin conciliación.` },
        { t: 'E', texto: `Consumo y producción están correlacionados (r = ${fmtNum(g.produccion.correlacionConsumoVsIngresoPT, 2)}): la hipótesis de desbalance producción–consumo queda DESCARTADA por los datos.` },
        { t: 'S', texto: 'Conciliar el Kardex (conteo cíclico de clase A) antes de automatizar reposiciones; ver Prescriptivo y Mejores prácticas.' },
      ])}</div>${contrato(R.gk)}`;
    }
    return html;
  },
});

// =============================== PREDICTIVO ===============================
let serieSel = 'ventas_soles|total|*';
let prodSel = '';
registrar({ id: 'predictivo', icono: '📈', menu: 'Análisis predictivo', titulo: 'Análisis predictivo (6 meses)', pregunta: '¿Qué pasará? Proyección mensual con intervalos P10–P50–P90, modelo elegido por backtesting',
  async pintar() {
    const R = estado.R;
    if (!R?.pv && !R?.pk) return sinAnalisis('del pronóstico');
    const series: ProyeccionSerie[] = [...(R.pv?.result.series ?? []), ...(R.pk ? [R.pk.result.total] : [])];
    const clave = (s: ProyeccionSerie) => `${s.serie}|${s.nivel}|${s.clave}`;
    const nombre = (s: ProyeccionSerie) => s.serie === 'ventas_soles' ? (s.nivel === 'total' ? 'Ventas S/ · total' : `Ventas S/ · ${s.clave}`) : s.serie === 'utilidad' ? 'Utilidad operativa S/ · total' : s.serie === 'volumen' ? 'Volumen · total' : 'Kardex · salidas totales (unid.)';
    const s = series.find((x) => clave(x) === serieSel) ?? series[0];
    serieSel = clave(s);
    const esS = s.unidad === 'S/';
    const fmt = (x: number) => (esS ? `S/ ${fmtNum(x / 1e6, 1)} M` : fmtNum(x, 0));
    let html = `<div class="filtros"><label class="campo">Serie a proyectar<select id="p-serie">${series.map((x) => `<option value="${esc(clave(x))}" ${clave(x) === serieSel ? 'selected' : ''}>${esc(nombre(x))}</option>`).join('')}</select></label>
      <span class="nota">Horizonte: ${s.horizonte.map(mesCorto).join(', ')} · ${fmtNum(R.pv?.result.trayectorias ?? R.pk!.result.trayectorias)} trayectorias · semilla ${R.pv?.result.semilla ?? R.pk!.result.semilla}</span></div>`;
    trasPintar(() => document.getElementById('p-serie')!.addEventListener('change', (e) => { serieSel = (e.target as HTMLSelectElement).value; repintar(); }));
    const naive = s.evaluacion.find((e) => e.modelo === 'Naive');
    const mejor = s.evaluacion.find((e) => e.modelo === s.modelo);
    html += `<div class="grid g4">
      ${tarjetaKpi({ etiqueta: 'Total 6 meses (P50)', valor: esS ? fmtMillones(s.total.p50) : fmtNum(s.total.p50, 0), unidadMenor: esS ? '' : 'unid.', delta: `80 %: ${fmt(s.total.p10)} – ${fmt(s.total.p90)}`, formula: 'Mediana de la suma de 6 meses sobre 10 000 trayectorias simuladas (bootstrap de residuos)' })}
      ${tarjetaKpi({ etiqueta: 'Modelo elegido', valor: s.modelo, delta: Object.entries(s.params).map(([k, v]) => `${k} = ${fmtNum(v, 2)}`).join(' · ') || 'sin parámetros', formula: 'Seleccionado por menor MASE promedio en backtesting con origen móvil (no se usa MAPE)' })}
      ${tarjetaKpi({ etiqueta: 'Error de backtesting (MASE)', valor: fmtNum(mejor?.maseProm ?? NaN, 3), delta: `Naive: ${fmtNum(naive?.maseProm ?? NaN, 3)} · ${s.mejorQueNaive ? 'mejor que el ingenuo' : 'no supera al ingenuo'}`, sentido: s.mejorQueNaive ? 'sube' : 'baja', semaforo: s.mejorQueNaive ? insignia('Apto', 'ok') : insignia('Revisar', 'warn'), formula: 'MASE < 1: mejor que el pronóstico ingenuo estacional' })}
      ${tarjetaKpi({ etiqueta: 'Cobertura empírica P10–P90', valor: fmtPct(s.calibracion.cobertura80, 0), delta: s.calibracion.factor > 1 ? `calibrado ×${fmtNum(s.calibracion.factor, 1)} (antes ${fmtPct(s.calibracion.coberturaAntes, 0)})` : `n = ${s.calibracion.n} casos de backtesting`, formula: 'Porcentaje de valores reales del backtesting que cayeron dentro del intervalo del 80 %' })}
    </div>
    <div class="mt">${tarjeta(`Proyección · ${nombre(s)}`, grafico(opAbanico(s.historia, s.horizonte, s.porMes, fmt), { nombre: `pronostico_${s.serie}_${s.clave}`, clase: 'alto',
      tabla: { cols: ['Mes', 'P2.5', 'P10', 'P50', 'P90', 'P97.5'], filas: s.horizonte.map((p, i) => [mesCorto(p), s.porMes[i].p025, s.porMes[i].p10, s.porMes[i].p50, s.porMes[i].p90, s.porMes[i].p975]) } }),
      { sub: 'Historia de los últimos 36 meses + abanico de probabilidad. Pase el mouse para ver los percentiles.' })}</div>
    <div class="grid g2 mt">
      ${tarjeta('Pronóstico mensual con intervalos', tabla(s.horizonte.map((p, i) => ({ mes: mesCorto(p), ...s.porMes[i] })) as never[], [{ k: 'mes', t: 'Mes' }, ...[['p025', 'P2.5'], ['p10', 'P10'], ['p50', 'P50'], ['p90', 'P90'], ['p975', 'P97.5']].map(([k, t]) => ({ k, t, n: true, f: (v: unknown) => fmt(v as number) }))] as never[], { nombre: `pronostico_mensual_${s.serie}`, buscar: false }))}
      ${tarjeta('Competencia de modelos (backtesting con origen móvil)', tabla(s.evaluacion.map((e) => ({ modelo: e.modelo, mase: e.maseProm, valido: e.valido, elegido: e.modelo === s.modelo })) as never[], [
        { k: 'modelo', t: 'Modelo', f: (v, r) => `${esc(v)} ${(r as { elegido: boolean }).elegido ? insignia('Elegido', 'ok') : ''}` }, { k: 'mase', t: 'MASE promedio', n: true, f: (v) => (isFinite(v as number) ? fmtNum(v as number, 3) : '—') },
        { k: 'valido', t: 'Válido', f: (v) => (v ? '✔' : '✖ historia insuficiente') }], { nombre: 'backtesting_modelos', buscar: false }), { sub: 'Menor MASE = mejor. Naive, Naive estacional, media móvil, SES, Holt, Holt-Winters, Croston, SBA, TSB' })}
    </div>`;
    const hs: { t: 'E' | 'D' | 'S'; texto: string }[] = [
      { t: 'E', texto: `Para ${mesCorto(s.horizonte[0])}–${mesCorto(s.horizonte.at(-1)!)} se proyecta <b>${fmt(s.total.p50)}</b> (P50), con 80 % de probabilidad entre ${fmt(s.total.p10)} y ${fmt(s.total.p90)}.` },
      { t: 'E', texto: `Modelo ${esc(s.modelo)} elegido entre ${s.evaluacion.filter((e) => e.valido).length} candidatos por menor MASE (${fmtNum(mejor?.maseProm ?? NaN, 3)}).` },
    ];
    if (R.pv && s.serie !== 'kardex') hs.push({ t: 'D', texto: `Probabilidad de que la utilidad de los próximos 6 meses sea negativa: ${fmtPct(R.pv.result.probabilidades.utilidad6mNegativa, 1)}; de que las ventas sean menores que los últimos 6 meses: ${fmtPct(R.pv.result.probabilidades.ventas6mMenorQueUltimos6m, 0)}.` });
    if (s.calibracion.factor > 1) hs.push({ t: 'D', texto: `El intervalo se amplió ×${fmtNum(s.calibracion.factor, 1)} porque la cobertura inicial (${fmtPct(s.calibracion.coberturaAntes, 0)}) era menor al 75 % (calibración empírica).` });
    html += `<div class="mt">${hallazgos(hs)}</div>`;

    // Pronóstico por producto (Kardex)
    if (R.pk) {
      const pk = R.pk.result;
      const filas = pk.productos.map((p) => ({ codigo: p.codigo, patron: p.patron, modelo: p.modelo, mase: p.mase, naive: p.mejorQueNaive, hist: p.demandaMediaHist, p10: p.total.p10, p50: p.total.p50, p90: p.total.p90 }));
      if (!prodSel || !filas.find((f) => f.codigo === prodSel)) prodSel = [...filas].sort((a, b) => b.p50 - a.p50)[0]?.codigo ?? '';
      const pr = pk.productos.find((p) => p.codigo === prodSel);
      let graf = '';
      if (pr) {
        const hist = await llamar<{ periodo: string; valor: number }[]>('consulta', "SELECT periodo, total(salida) valor FROM kardex_mov WHERE producto_id=? AND origen='excel' AND periodo<=? GROUP BY periodo ORDER BY periodo", [pr.pid, pk.cutoff]);
        graf = hist.length ? grafico(opAbanico(hist, pk.horizonte, pr.porMes, (x) => fmtNum(x, 0), 24), { nombre: `pronostico_${pr.codigo}` }) : '<p class="nota">Sin historia de salidas.</p>';
      }
      html += `<div class="grid g12 mt">
        ${tarjeta('Modelos elegidos (Kardex)', `<table class="t"><tbody>${Object.entries(pk.modelosElegidos).sort((a, b) => b[1] - a[1]).map(([m, n]) => `<tr><td>${esc(m)}</td><td class="n">${n} productos</td></tr>`).join('')}</tbody></table>
          <label class="campo mt">Producto a graficar<select id="p-prod">${[...filas].sort((a, b) => a.codigo.localeCompare(b.codigo)).map((f) => `<option ${f.codigo === prodSel ? 'selected' : ''}>${esc(f.codigo)}</option>`).join('')}</select></label>`, { sub: 'Croston/SBA/TSB para demanda intermitente' })}
        ${tarjeta(`Proyección de salidas · ${esc(prodSel)}`, graf, { sub: pr ? `Patrón ${esc(pr.patron)} · modelo ${esc(pr.modelo)} · P50 6 meses ${fmtNum(pr.total.p50, 0)} unid.` : '' })}
      </div>
      <div class="mt">${tarjeta('Pronóstico a 6 meses por producto', tabla(filas as never[], [
        { k: 'codigo', t: 'Código' }, { k: 'patron', t: 'Patrón' }, { k: 'modelo', t: 'Modelo' }, { k: 'mase', t: 'MASE', n: true, f: (v) => (isFinite(v as number) ? fmtNum(v as number, 3) : '—') },
        { k: 'naive', t: '¿Mejor que ingenuo?', f: (v) => (v ? '✔' : '—') }, { k: 'hist', t: 'Demanda media/mes', n: true, f: (v) => fmtNum(v as number, 1) },
        { k: 'p10', t: 'P10 6m', n: true, f: (v) => fmtNum(v as number, 0) }, { k: 'p50', t: 'P50 6m', n: true, f: (v) => fmtNum(v as number, 0) }, { k: 'p90', t: 'P90 6m', n: true, f: (v) => fmtNum(v as number, 0) }], { nombre: 'pronostico_productos', alto: 380 }))}</div>`;
      trasPintar(() => document.getElementById('p-prod')?.addEventListener('change', (e) => { prodSel = (e.target as HTMLSelectElement).value; repintar(); }));
    }
    html += (R.pv ? contrato(R.pv) : '') + (R.pk ? contrato(R.pk) : '');
    return html;
  },
});

// =============================== PRESCRIPTIVO ===============================
registrar({ id: 'prescriptivo', icono: '✅', menu: 'Análisis prescriptivo', titulo: 'Análisis prescriptivo', pregunta: '¿Qué debemos hacer? Políticas de inventario, plan de compras y recomendaciones con impacto económico',
  pintar() {
    const R = estado.R;
    if (!R?.pr) return sinAnalisis('del análisis prescriptivo');
    const p = R.pr.result;
    const t = tema();
    const aprobado = R.pr.estado_flujo === 'APROBADO';
    let html = `<div class="tarjeta" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">${flujoHTML(estadoFlujoActual())}<span style="flex:1"></span>
      ${aprobado ? insignia('Propuesta aprobada por el usuario (registrada en auditoría)', 'ok') : `<input type="text" id="ap-com" placeholder="Comentario de aprobación (opcional)" size="34"/><button class="btn primario" id="ap-btn">✔ Aprobar propuesta</button>`}</div>
    <div class="grid g4 mt">
      ${tarjetaKpi({ etiqueta: 'Beneficio recurrente anual (central)', valor: fmtMillones(p.caso.recurrente.central), delta: `conservador ${fmtMillones(p.caso.recurrente.conservador)} · favorable ${fmtMillones(p.caso.recurrente.favorable)}`, formula: 'Suma de recomendaciones en S/ con impacto recurrente; rangos 10/25/40 % de recuperación' })}
      ${tarjetaKpi({ etiqueta: 'Liberación de caja (una vez)', valor: p.caso.cajaUnaVez.central ? fmtMillones(p.caso.cajaUnaVez.central) : 'S/ 0.0 M', delta: p.caso.cajaUnaVez.favorable ? `conservador ${fmtMillones(p.caso.cajaUnaVez.conservador)} · favorable ${fmtMillones(p.caso.cajaUnaVez.favorable)}` : 'Se calcula al ingresar el costo unitario real del Kardex (hoy SUPUESTO = 1)', formula: 'Reducción de sobrestock valorizada a costo; el Kardex no trae costos' })}
      ${tarjetaKpi({ etiqueta: 'ROI · Payback', valor: p.caso.roi == null ? '—' : `${fmtNum(p.caso.roi, 1)} ×`, delta: `payback ${p.caso.paybackMeses == null ? '—' : p.caso.paybackMeses < 0.1 ? '< 0.1 meses' : fmtNum(p.caso.paybackMeses, 1) + ' meses'} · muy sensible al SUPUESTO de costo de operación (${fmtSoles0(p.caso.costoOperacion)}/año, editable)`, formula: 'ROI = beneficio neto central ÷ costo anual de operación. El costo de operación es un SUPUESTO: ajústelo en Configuración' })}
      ${tarjetaKpi({ etiqueta: 'Plan de compras 6 meses', valor: fmtNum(p.planTotal.unidades, 0), unidadMenor: 'unid.', delta: `${fmtNum(p.plan.length)} órdenes · costo ${fmtNum(p.planTotal.costo, 0)} (unid. equivalentes)`, formula: 'Q = max(0, S − posición de inventario) por mes; costo en unidades equivalentes porque el Kardex no tiene costos' })}
    </div>
    <div class="mt">${tarjeta('Recomendaciones priorizadas del Super Agente', tabla(p.recomendaciones as never[], [
      { k: 'prioridad', t: '#', n: true, f: (v) => String(v) }, { k: 'titulo', t: 'Recomendación', f: (v, r) => `<b>${esc(v)}</b><div class="nota">${esc((r as { evidencia: string }).evidencia)}</div>` },
      { k: 'accion', t: 'Acción', f: (v) => `<span style="font-size:12px">${esc(v)}</span>` }, { k: 'responsable', t: 'Responsable' }, { k: 'plazo', t: 'Plazo' }, { k: 'kpi', t: 'KPI' },
      { k: 'impacto', t: 'Impacto (cons. / central / fav.)', n: true, f: (v, r) => { const i = v as { conservador: number | null; central: number | null; favorable: number | null }; const u = (r as { unidad: string }).unidad;
        const f = (x: number | null) => (x == null ? '—' : u === 'S/' ? fmtMillones(x, 2) : `${fmtNum(x, 0)}`); return `${f(i.conservador)} / <b>${f(i.central)}</b> / ${f(i.favorable)}${u !== 'S/' ? '<div class="nota">unid. equivalentes</div>' : ''}`; },
        exp: (r) => (r as { impacto: { central: number | null } }).impacto.central },
      { k: 'dataset', t: 'Fuente' }], { nombre: 'recomendaciones', alto: 520 }), { sub: 'Cada recomendación enlaza evidencia → acción → responsable → plazo → KPI de seguimiento' })}</div>
    <div class="grid g2 mt">
      ${tarjeta('Estado del inventario por producto', grafico(opBarras(Object.keys(p.resumenEstados).map((e) => e.replace(/_/g, ' ').toLowerCase()), [{ nombre: 'Productos', datos: Object.values(p.resumenEstados) }], (x) => fmtNum(x, 0),
        { horizontal: true, etiquetas: true, colorPorValor: () => t.s1 }), { nombre: 'estado_inventario', clase: 'bajo', tabla: { cols: ['Estado', 'Productos'], filas: Object.entries(p.resumenEstados).map(([k, v]) => [k, v]) } }), { sub: 'Posición de inventario vs. punto de reorden y stock objetivo' })}
      ${tarjeta('Plan de compras por mes', grafico(opBarras(p.planTotal.porMes.map((m) => m.periodo), [{ nombre: 'Unidades', datos: p.planTotal.porMes.map((m) => m.unidades) }], (x) => fmtNum(x, 0), { mesesX: true, etiquetas: true }),
        { nombre: 'plan_compras_mes', clase: 'bajo', tabla: { cols: ['Mes', 'Unidades', 'Costo (unid. eq.)'], filas: p.planTotal.porMes.map((m) => [mesCorto(m.periodo), m.unidades, m.costo]) } }), { sub: 'Asignación con presupuesto (programación lineal: mochila fraccionaria)' })}
    </div>
    <div class="mt">${tarjeta('Políticas de inventario por producto', tabla(p.politicas as never[], [
      { k: 'codigo', t: 'Código' }, { k: 'clase', t: 'ABC' }, { k: 'patron', t: 'Patrón' }, { k: 'politica', t: 'Política' }, { k: 'nivelServicio', t: 'Nivel serv.', n: true, f: (v) => fmtPct(v as number, 0) },
      { k: 'ss', t: 'Stock seg.', n: true, f: (v) => fmtNum(v as number, 0) }, { k: 'rop', t: 'Punto reorden', n: true, f: (v) => fmtNum(v as number, 0) }, { k: 'eoq', t: 'EOQ', n: true, f: (v) => fmtNum(v as number, 0) },
      { k: 'sObjetivo', t: 'S objetivo', n: true, f: (v) => fmtNum(v as number, 0) }, { k: 'stockActual', t: 'Stock', n: true, f: (v) => fmtNum(v as number, 0) }, { k: 'qSugerida', t: 'Q sugerida', n: true, f: (v) => fmtNum(v as number, 0) },
      { k: 'coberturaDias', t: 'Cobertura días', n: true, f: (v) => (v == null ? '—' : fmtNum(v as number, 0)) }, { k: 'estado', t: 'Estado', f: (v) => insigniaEstado(v as string) }], { nombre: 'politicas_inventario', alto: 420 }),
      { sub: `SS = z·√(LT·σd² + d̄²·σLT²) · ROP = d̄·LT + SS · EOQ = √(2DS/H) · LT = ${fmtNum(p.parametros.LT, 0)} días (σ ${fmtNum(p.parametros.sLT, 0)}) ${insignia('SUPUESTO', 'warn')} editable en Configuración` })}</div>
    <div class="mt">${hallazgos([
      ...p.recomendaciones.slice(0, 3).map((r) => ({ t: 'S' as const, texto: `<b>${esc(r.titulo)}</b> → ${esc(r.accion)} (${esc(r.responsable)}, ${esc(r.plazo)}).` })),
      { t: 'D', texto: `Los impactos son rangos (conservador/central/favorable), no promesas: dependen de supuestos editables (${Object.keys(p.parametros).length} parámetros) y de la ejecución.` },
    ])}</div>${contrato(R.pr)}`;
    trasPintar(() => document.getElementById('ap-btn')?.addEventListener('click', async () => {
      if (!(await confirmar('¿Aprueba la propuesta del Super Agente? Quedará registrada en la auditoría con fecha y hora, y el estado de todas las skills pasará a <b>APROBADO</b>.'))) return;
      const n = await llamar<number>('aprobar', (document.getElementById('ap-com') as HTMLInputElement).value || 'Aprobado por el usuario');
      estado.R = await llamar('resultados'); await trasCambioDeDatos();
      avisar(`✔ Propuesta aprobada (${n} resultados en estado APROBADO).`, 'ok'); repintar();
    }));
    return html;
  },
});
const fmtSoles0 = (v: number) => `S/ ${fmtNum(v, 0)}`;
