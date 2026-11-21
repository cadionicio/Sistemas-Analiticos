/**
 * COPILOTO del Super Agente — "Pregúntale a tus datos".
 * Intérprete de intenciones SIN LLM (reglas + plantillas) que responde SOLO con cifras calculadas por las skills
 * y guardadas en la BD. Cada respuesta devuelve sus HECHOS (para un LLM opcional), las cifras permitidas
 * (para el Evaluador de textos) y las fuentes (skill + run_id). Nunca busca en la web.
 */
import type { BaseDatos } from '../db/db';
import type { Resultados } from './resultados';
import { fmtMillones, fmtNum, fmtPct, normalizar } from '../util/util';

export interface Respuesta {
  intencion: string; texto: string; cifras: number[]; fuentes: { skill: string; run_id: string }[];
  hechos: Record<string, unknown>; sugerencias: string[];
}
interface Ctx { R: Resultados; bd: BaseDatos }
type Manejador = (c: Ctx, q: string, extra: { codigo?: string; mes?: string }) => Omit<Respuesta, 'intencion'> | null;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mes = (p: string) => `${MC[+p.slice(5, 7) - 1]} ${p.slice(2, 4)}`;
const pp = (x: number) => `${x >= 0 ? '+' : ''}${fmtNum(x * 100, 2)} pp`;
const vr = (x: number) => `${x >= 0 ? '+' : ''}${fmtNum(x * 100, 1)} %`;
const fu = (r?: { skill: string; run_id: string }) => (r ? [{ skill: r.skill, run_id: r.run_id }] : []);
const SUG = ['¿Cómo va el negocio?', '¿Por qué bajó el margen?', '¿Qué productos pierden dinero?', '¿Cuánto venderemos en los próximos 6 meses?', '¿Qué debo comprar el próximo mes?', '¿Qué productos están por quebrar stock?', '¿Qué debo hacer? (recomendaciones)', '¿Cuál es el impacto económico?'];
const faltaAnalisis = (que: string) => ({ texto: `Aún no hay resultados de ${que}. Pulse **▶ Análisis completo en 1 clic** y vuelva a preguntar.`, cifras: [], fuentes: [], hechos: {}, sugerencias: [] });

// ------------------------------------------------ Intenciones ------------------------------------------------
const INTENCIONES: { id: string; claves: string[]; fn: Manejador }[] = [
  { id: 'ayuda', claves: ['ayuda', 'que puedes', 'que puedo preguntar', 'como funciona', 'hola'], fn: () => ({
    texto: 'Puedo responder con las cifras calculadas por el sistema (sin búsqueda web). Pregunte, por ejemplo:\n' + SUG.map((s) => `• ${s}`).join('\n') + '\n• También puede escribir un código de producto (p. ej. **K00401** o **MATPRIMA-003**).',
    cifras: [], fuentes: [], hechos: {}, sugerencias: SUG.slice(0, 4) }) },
  { id: 'resumen', claves: ['resumen', 'como va', 'situacion', 'estado del negocio', 'como estamos', 'panorama'], fn: ({ R }) => {
    if (!R.dv) return faltaAnalisis('ventas');
    const d = R.dv.result, t = R.pv?.result.series.find((s) => s.serie === 'ventas_soles' && s.nivel === 'total');
    const l = [`• Ventas de los últimos 12 meses (${mes(d.meses.at(-12)!)}–${mes(d.cutoff)}): **${fmtMillones(d.kpi12.ventas)}** (${vr(d.variacion.ventas)} vs. los 12 meses previos).`,
      `• Utilidad operativa: **${fmtMillones(d.kpi12.utilidad)}** (${vr(d.variacion.utilidad)}); margen ${fmtPct(d.kpi12prev.margen)} → **${fmtPct(d.kpi12.margen)}**.`,
      `• ${fmtNum(d.skusConPerdida)} de ${fmtNum(d.skus)} productos tienen utilidad acumulada negativa.`];
    if (t) l.push(`• Proyección de ventas para los próximos 6 meses: **${fmtMillones(t.total.p50)}** (80 %: ${fmtMillones(t.total.p10)} – ${fmtMillones(t.total.p90)}).`);
    if (R.gk) l.push(`• Kardex: ${fmtNum(R.gk.result.conciliacion.saldosNoCuadran)} saldos no cuadran y ${fmtNum(R.gk.result.conciliacion.stockNegativo)} registros con stock negativo.`);
    return { texto: `Resumen del Super Agente [describir_operacion, proyectar_6m]:\n${l.join('\n')}`, cifras: [d.kpi12.ventas, d.variacion.ventas, d.kpi12.utilidad, d.variacion.utilidad, d.kpi12prev.margen, d.kpi12.margen, d.skusConPerdida, d.skus, ...(t ? [t.total.p50, t.total.p10, t.total.p90] : []), ...(R.gk ? [R.gk.result.conciliacion.saldosNoCuadran, R.gk.result.conciliacion.stockNegativo] : [])],
      fuentes: [...fu(R.dv), ...fu(R.pv), ...fu(R.gk)], hechos: { kpi12: d.kpi12, kpi12prev: d.kpi12prev, variacion: d.variacion, skusConPerdida: d.skusConPerdida, proyeccion6m: t?.total, kardex: R.gk?.result.conciliacion },
      sugerencias: ['¿Por qué bajó el margen?', '¿Qué debo hacer?'] };
  } },
  { id: 'por_que', claves: ['por que ', 'porque ', 'causa', 'razon', 'explica', 'motivo'], fn: ({ R }) => {
    if (!R.gv) return faltaAnalisis('diagnóstico');
    const g = R.gv.result;
    const hs = g.hipotesis.filter((h) => h.sustento === 'COMPROBADA' || h.sustento === 'ASOCIATIVA').slice(0, 4);
    return { texto: `Causas con evidencia [diagnosticar_desviacion]:\n• Las ventas variaron **${fmtMillones(g.pvm.total)}**: volumen ${fmtMillones(g.pvm.volumen)}, precio ${fmtMillones(g.pvm.precio)}, mezcla ${fmtMillones(g.pvm.mezcla)}, SKU nuevos ${fmtMillones(g.pvm.nuevos)} y perdidos ${fmtMillones(g.pvm.perdidos)}.\n• En la utilidad pesa más el **margen** (${fmtMillones(g.utilidad.efectoMargen)}) que el volumen (${fmtMillones(g.utilidad.efectoVolumen)}).\n${hs.map((h) => `• ${h.titulo} [${h.sustento}]: ${h.favor}`).join('\n')}\n• Causa raíz (5 porqués): ${g.cincoPorques.causaRaiz}`,
      cifras: [g.pvm.total, g.pvm.volumen, g.pvm.precio, g.pvm.mezcla, g.pvm.nuevos, g.pvm.perdidos, g.utilidad.efectoMargen, g.utilidad.efectoVolumen, ...numerosDe(...hs.map((h) => h.favor), g.cincoPorques.causaRaiz)], fuentes: fu(R.gv),
      hechos: { pvm: g.pvm, utilidad: g.utilidad, hipotesis: hs, causaRaiz: g.cincoPorques.causaRaiz }, sugerencias: ['¿Qué productos pierden dinero?', '¿Qué departamento tiene peor margen?'] };
  } },
  { id: 'perdidas', claves: ['pierden', 'perdida', 'negativ', 'destruyen', 'no rentable', 'pierde dinero'], fn: ({ R }) => {
    if (!R.dv) return faltaAnalisis('ventas');
    const d = R.dv.result, g = R.gv?.result;
    const top = d.topPerdidas.slice(0, 5);
    return { texto: `**${fmtNum(d.skusConPerdida)}** de ${fmtNum(d.skus)} productos (${fmtPct(d.skusConPerdida / d.skus, 0)}) tienen utilidad acumulada negativa [describir_operacion].${g ? ` Los 20 peores concentran ${fmtPct(g.perdidas.top20Participacion, 1)} de la pérdida.` : ''}\nLos 5 con mayor pérdida:\n${top.map((x) => `• **${x.sku}**: ventas ${fmtMillones(x.soles, 2)}, utilidad ${fmtMillones(x.utilidad, 2)} (margen ${fmtPct(x.margen)})`).join('\n')}\nRecomendación: revisar precio, costo de servir o descontinuar (ver Prescriptivo).`,
      cifras: [d.skusConPerdida, d.skus, d.skusConPerdida / d.skus, ...(g ? [g.perdidas.top20Participacion] : []), ...top.flatMap((x) => [x.soles, x.utilidad, x.margen])], fuentes: [...fu(R.dv), ...fu(R.gv)],
      hechos: { skusConPerdida: d.skusConPerdida, skus: d.skus, top5: top }, sugerencias: ['¿Qué debo hacer?', '¿Cuál es el impacto económico?'] };
  } },
  { id: 'departamentos', claves: ['departamento', 'region', 'zona', 'cusco', 'lima', 'ica', 'arequipa', 'piura', 'junin', 'huanuco', 'ayacucho', 'libertad'], fn: ({ R }, q) => {
    if (!R.dv) return faltaAnalisis('ventas');
    const ds = [...R.dv.result.departamentos].sort((a, b) => a.margen - b.margen);
    const uno = ds.find((d) => q.includes(normalizar(d.departamento)));
    const lista = uno ? [uno] : [ds[0], ds[1], ds.at(-1)!];
    return { texto: `${uno ? `Departamento **${uno.departamento}**` : 'Margen por departamento (todo el histórico)'} [describir_operacion]:\n${lista.map((d) => `• **${d.departamento}**: ventas ${fmtMillones(d.soles)}, participación ${fmtPct(d.participacion, 1)}, utilidad ${fmtMillones(d.utilidad, 2)}, margen **${fmtPct(d.margen)}**`).join('\n')}${uno ? '' : `\nEl de menor margen es **${ds[0].departamento}** y el de mayor margen **${ds.at(-1)!.departamento}**.`}`,
      cifras: lista.flatMap((d) => [d.soles, d.participacion, d.utilidad, d.margen]), fuentes: fu(R.dv), hechos: { departamentos: lista }, sugerencias: ['¿Por qué bajó el margen?'] };
  } },
  { id: 'pronostico_utilidad', claves: ['utilidad proyect', 'utilidad futura', 'ganaremos', 'probabilidad de perd', 'riesgo de perd', 'utilidad negativa'], fn: ({ R }) => {
    if (!R.pv) return faltaAnalisis('pronóstico');
    const u = R.pv.result.series.find((s) => s.serie === 'utilidad' && s.nivel === 'total')!;
    return { texto: `Utilidad operativa proyectada ${mes(u.horizonte[0])}–${mes(u.horizonte.at(-1)!)} [proyectar_6m]: **${fmtMillones(u.total.p50)}** (80 %: ${fmtMillones(u.total.p10)} – ${fmtMillones(u.total.p90)}), modelo ${u.modelo}.\nProbabilidad de que la utilidad de los 6 meses sea negativa: **${fmtPct(R.pv.result.probabilidades.utilidad6mNegativa, 1)}**.`,
      cifras: [u.total.p50, u.total.p10, u.total.p90, R.pv.result.probabilidades.utilidad6mNegativa], fuentes: fu(R.pv), hechos: { utilidad6m: u.total, modelo: u.modelo, probUtilidadNegativa: R.pv.result.probabilidades.utilidad6mNegativa }, sugerencias: ['¿Qué escenarios hay?'] };
  } },
  { id: 'pronostico', claves: ['venderemos', 'vendera', 'pronostic', 'proyecc', 'proxim', 'futuro', 'prever', 'forecast', 'estimad'], fn: ({ R }, q, { mes: m }) => {
    if (!R.pv && !R.pk) return faltaAnalisis('pronóstico');
    const kardex = /kardex|salida|almacen|unidades|consumo/.test(q) || !R.pv;
    const s = kardex ? R.pk!.result.total : R.pv!.result.series.find((x) => x.serie === 'ventas_soles' && x.nivel === 'total')!;
    const f = (v: number) => (s.unidad === 'S/' ? fmtMillones(v) : `${fmtNum(v, 0)} unid.`);
    const i = m ? s.horizonte.findIndex((h) => h.slice(5, 7) === m) : -1;
    const cuerpo = i >= 0
      ? `Para **${mes(s.horizonte[i])}** se proyecta **${f(s.porMes[i].p50)}** (80 %: ${f(s.porMes[i].p10)} – ${f(s.porMes[i].p90)}).`
      : `Total ${mes(s.horizonte[0])}–${mes(s.horizonte.at(-1)!)}: **${f(s.total.p50)}** (80 %: ${f(s.total.p10)} – ${f(s.total.p90)}).\nPor mes (P50): ${s.horizonte.map((h, k) => `${mes(h)} ${f(s.porMes[k].p50)}`).join(' · ')}.`;
    return { texto: `${kardex ? 'Salidas del Kardex' : 'Ventas'} proyectadas [proyectar_6m, modelo ${s.modelo} elegido por backtesting, MASE ${fmtNum(s.evaluacion.find((e) => e.modelo === s.modelo)?.maseProm ?? NaN, 3)}]:\n${cuerpo}${m && i < 0 ? `\n(El mes consultado no está en el horizonte ${mes(s.horizonte[0])}–${mes(s.horizonte.at(-1)!)}.)` : ''}`,
      cifras: [s.total.p50, s.total.p10, s.total.p90, ...s.porMes.flatMap((b) => [b.p10, b.p50, b.p90]), s.evaluacion.find((e) => e.modelo === s.modelo)?.maseProm ?? 0], fuentes: fu(kardex ? R.pk : R.pv),
      hechos: { serie: s.serie, horizonte: s.horizonte, porMes: s.porMes, total: s.total, modelo: s.modelo }, sugerencias: ['¿Qué tan confiable es el pronóstico?', '¿Cuál es la utilidad proyectada?'] };
  } },
  { id: 'comprar', claves: ['comprar', 'compra', 'pedir', 'pedido', 'reponer', 'abastec', 'orden'], fn: ({ R }, _q, { mes: m }) => {
    if (!R.pr) return faltaAnalisis('prescriptivo');
    const p = R.pr.result;
    const per = p.planTotal.porMes.find((x) => m && x.periodo.slice(5, 7) === m) ?? p.planTotal.porMes[0];
    const items = p.plan.filter((x) => x.periodo === per.periodo).sort((a, b) => b.cantidad - a.cantidad).slice(0, 8);
    return { texto: `Plan de compras para **${mes(per.periodo)}** [optimizar_plan]: **${fmtNum(per.unidades, 0)} unid.** en ${fmtNum(p.plan.filter((x) => x.periodo === per.periodo).length)} órdenes (Q = máx(0, S − posición de inventario)).\nPrincipales:\n${items.map((x) => `• **${x.codigo}**: ${fmtNum(x.cantidad, 0)} unid.`).join('\n')}\nTotal 6 meses: ${fmtNum(p.planTotal.unidades, 0)} unid. Detalle completo en Prescriptivo.`,
      cifras: [per.unidades, p.plan.filter((x) => x.periodo === per.periodo).length, ...items.map((x) => x.cantidad), p.planTotal.unidades], fuentes: fu(R.pr), hechos: { periodo: per.periodo, unidades: per.unidades, principales: items, total6m: p.planTotal.unidades }, sugerencias: ['¿Qué productos están por quebrar stock?'] };
  } },
  { id: 'quiebres', claves: ['quiebre', 'quebrar', 'agot', 'faltante', 'sin stock', 'desabast', 'urgente'], fn: ({ R }) => {
    if (!R.pr) return faltaAnalisis('prescriptivo');
    const q = R.pr.result.politicas.filter((x) => x.estado === 'QUIEBRE_INMINENTE' || x.estado === 'STOCK_NEGATIVO').sort((a, b) => b.demandaMesPron - a.demandaMesPron);
    return { texto: `**${fmtNum(q.length)}** productos en quiebre inminente o con stock negativo [optimizar_plan]. Los de mayor demanda:\n${q.slice(0, 8).map((x) => `• **${x.codigo}** (clase ${x.clase}): stock ${fmtNum(x.stockActual, 0)}, punto de reorden ${fmtNum(x.rop, 0)}, pedir ${fmtNum(x.qSugerida, 0)} unid.`).join('\n')}\nVer la lista completa en Alertas.`,
      cifras: [q.length, ...q.slice(0, 8).flatMap((x) => [x.stockActual, x.rop, x.qSugerida])], fuentes: fu(R.pr), hechos: { cantidad: q.length, principales: q.slice(0, 8).map((x) => ({ codigo: x.codigo, stock: x.stockActual, rop: x.rop, q: x.qSugerida })) }, sugerencias: ['¿Qué debo comprar el próximo mes?'] };
  } },
  { id: 'sobrestock', claves: ['sobrestock', 'exceso', 'obsole', 'inmoviliz', 'sin movimiento', 'sin salida', 'lento', 'cobertura'], fn: ({ R }) => {
    if (!R.dk) return faltaAnalisis('Kardex');
    const d = R.dk.result, e = R.pr?.result.resumenEstados ?? {};
    return { texto: `Inventario inmovilizado [describir_operacion (Kardex)]:\n• **${fmtNum(d.sinSalidas.length)}** productos sin salidas en todo el periodo${d.sinSalidas.length ? ` (p. ej. ${d.sinSalidas.slice(0, 4).join(', ')})` : ''}.\n• **${fmtNum(d.coberturaMayor180)}** productos con cobertura mayor a 180 días.\n• Estado según la política: ${fmtNum(e.SOBRESTOCK ?? 0)} en sobrestock y ${fmtNum(e.SIN_MOVIMIENTO ?? 0)} sin movimiento.\nAcción sugerida: liquidar o transferir y revisar FEFO/FIFO.`,
      cifras: [d.sinSalidas.length, d.coberturaMayor180, e.SOBRESTOCK ?? 0, e.SIN_MOVIMIENTO ?? 0], fuentes: [...fu(R.dk), ...fu(R.pr)], hechos: { sinSalidas: d.sinSalidas.length, coberturaMayor180: d.coberturaMayor180, estados: e }, sugerencias: ['¿Qué debo hacer?'] };
  } },
  { id: 'kardex', claves: ['kardex', 'conciliac', 'cuadr', 'stock negativo', 'exactitud', 'inventario fisico', 'almacen', 'descuadr'], fn: ({ R }) => {
    if (!R.gk) return faltaAnalisis('diagnóstico del Kardex');
    const c = R.gk.result.conciliacion;
    return { texto: `Confiabilidad del Kardex [diagnosticar_desviacion]:\n• **${fmtNum(c.saldosNoCuadran)}** saldos informados no cuadran con el recálculo (saldo anterior + entradas − salidas).\n• **${fmtNum(c.stockNegativo)}** registros con stock negativo en ${fmtNum(c.productosNegativo)} productos.\n• ${fmtNum(c.bloquesDescuadrados)} bloques de producto descuadrados.\nRecomendación prioritaria: conciliación semanal y conteo cíclico de la clase A antes de automatizar reposiciones.`,
      cifras: [c.saldosNoCuadran, c.stockNegativo, c.productosNegativo, c.bloquesDescuadrados], fuentes: fu(R.gk), hechos: { conciliacion: c }, sugerencias: ['¿Qué productos están por quebrar stock?'] };
  } },
  { id: 'recomendaciones', claves: ['que debo hacer', 'que hago', 'recomend', 'accion', 'propuesta', 'solucion', 'mejorar', 'plan de accion', 'sugier'], fn: ({ R }) => {
    if (!R.pr) return faltaAnalisis('prescriptivo');
    const rs = [...R.pr.result.recomendaciones].sort((a, b) => a.prioridad - b.prioridad);
    const f = (r: typeof rs[number]) => (r.impacto.central == null ? '' : r.unidad === 'S/' ? ` · impacto central ${fmtMillones(r.impacto.central)}/año` : ` · impacto ${fmtNum(r.impacto.central, 0)} unid. eq.`);
    return { texto: `Recomendaciones priorizadas del Super Agente [optimizar_plan] (estado: ${R.pr.estado_flujo}):\n${rs.map((r) => `• **P${r.prioridad} · ${r.titulo}** → ${r.accion.split('.')[0]}. Responsable: ${r.responsable}; plazo: ${r.plazo}${f(r)}.`).join('\n')}`,
      cifras: rs.map((r) => r.impacto.central ?? 0), fuentes: fu(R.pr), hechos: { recomendaciones: rs.map((r) => ({ prioridad: r.prioridad, titulo: r.titulo, responsable: r.responsable, plazo: r.plazo, impactoCentral: r.impacto.central, unidad: r.unidad })) }, sugerencias: ['¿Cuál es el impacto económico?'] };
  } },
  { id: 'impacto', claves: ['impacto', 'beneficio', 'roi', 'ahorro', 'payback', 'retorno', 'cuanto ganar', 'caso de negocio', 'economico'], fn: ({ R }) => {
    if (!R.pr) return faltaAnalisis('prescriptivo');
    const c = R.pr.result.caso;
    return { texto: `Impacto económico estimado [optimizar_plan] (rangos, no promesas):\n• Beneficio recurrente anual: ${fmtMillones(c.recurrente.conservador)} (conservador) / **${fmtMillones(c.recurrente.central)}** (central) / ${fmtMillones(c.recurrente.favorable)} (favorable).\n• Liberación de caja una sola vez: ${fmtMillones(c.cajaUnaVez.central)} (requiere el costo unitario real del Kardex).\n• Costo anual de operación de la solución: S/ ${fmtNum(c.costoOperacion, 0)} (SUPUESTO editable); el ROI es muy sensible a este supuesto.`,
      cifras: [c.recurrente.conservador, c.recurrente.central, c.recurrente.favorable, c.cajaUnaVez.central, c.costoOperacion], fuentes: fu(R.pr), hechos: { caso: c }, sugerencias: ['¿Qué escenarios hay?'] };
  } },
  { id: 'escenarios', claves: ['escenario', 'pesimista', 'optimista', 'simulac', 'monte carlo', 'que pasaria', 'riesgo'], fn: ({ R }) => {
    if (!R.sm) return faltaAnalisis('simulación');
    const s = R.sm.result, l: string[] = [], cf: number[] = [];
    s.ventas?.escenarios.forEach((e) => { l.push(`• ${e.escenario}: utilidad 6 meses P50 **${fmtMillones(e.utilidad6m.p50)}** (P5 ${fmtMillones(e.utilidad6m.p5)} – P95 ${fmtMillones(e.utilidad6m.p95)}), P(pérdida) ${fmtPct(e.probUtilidadNegativa, 1)}`); cf.push(e.utilidad6m.p50, e.utilidad6m.p5, e.utilidad6m.p95, e.probUtilidadNegativa); });
    s.inventario?.escenarios.forEach((e) => { l.push(`• Inventario ${e.escenario}: fill rate **${fmtPct(e.fillRate.media, 1)}**, P(quiebre por producto) ${fmtPct(e.probQuiebreProducto, 1)}`); cf.push(e.fillRate.media, e.probQuiebreProducto); });
    return { texto: `Simulación Monte Carlo [simular_escenarios] · ${fmtNum(s.iteraciones)} iteraciones, semilla ${s.semilla}:\n${l.join('\n')}`, cifras: [...cf, s.iteraciones, s.semilla], fuentes: fu(R.sm), hechos: { ventas: s.ventas?.escenarios.map((e) => ({ escenario: e.escenario, utilidad6m: e.utilidad6m, prob: e.probUtilidadNegativa })), inventario: s.inventario?.escenarios.map((e) => ({ escenario: e.escenario, fillRate: e.fillRate.media, probQuiebre: e.probQuiebre })) }, sugerencias: ['¿Qué variable es la más sensible?'] };
  } },
  { id: 'sensibilidad', claves: ['sensib', 'tornado', 'que variable', 'mas influye', 'factor'], fn: ({ R }) => {
    if (!R.sm?.result.ventas) return faltaAnalisis('simulación');
    const t = [...R.sm.result.ventas.tornado].sort((a, b) => Math.abs(b.alto - b.bajo) - Math.abs(a.alto - a.bajo));
    return { texto: `Sensibilidad de la utilidad 6 meses (P50) [simular_escenarios]:\n${t.map((x) => `• ${x.factor}: de ${fmtMillones(x.bajo)} a ${fmtMillones(x.alto)} (base ${fmtMillones(x.base)})`).join('\n')}\nLa variable más influyente es **${t[0].factor}**.`,
      cifras: [...t.flatMap((x) => [x.bajo, x.alto, x.base]), ...numerosDe(...t.map((x) => x.factor.replace(/(\d),(\d)/g, '$1.$2')))], fuentes: fu(R.sm), hechos: { tornado: t }, sugerencias: [] };
  } },
  { id: 'modelo', claves: ['modelo', 'precision', 'confiable', 'error', 'mase', 'backtest', 'exacto', 'metodo'], fn: ({ R }) => {
    if (!R.pv) return faltaAnalisis('pronóstico');
    const s = R.pv.result.series.find((x) => x.serie === 'ventas_soles' && x.nivel === 'total')!;
    const ev = [...s.evaluacion].filter((e) => e.valido).sort((a, b) => a.maseProm - b.maseProm);
    return { texto: `Confiabilidad del pronóstico de ventas [proyectar_6m]:\n• Se compitieron ${ev.length} modelos con backtesting de origen móvil; ganó **${s.modelo}** con MASE **${fmtNum(ev[0].maseProm, 3)}** (Naive: ${fmtNum(s.evaluacion.find((e) => e.modelo === 'Naive')?.maseProm ?? NaN, 3)}; MASE < 1 = mejor que el ingenuo).\n• Cobertura real del intervalo 80 % en el backtesting: **${fmtPct(s.calibracion.cobertura80, 0)}** (n = ${s.calibracion.n}).\n• Intervalos por bootstrap de residuos con ${fmtNum(R.pv.result.trayectorias)} trayectorias (semilla ${R.pv.result.semilla}).`,
      cifras: [ev.length, ev[0].maseProm, s.evaluacion.find((e) => e.modelo === 'Naive')?.maseProm ?? 0, s.calibracion.cobertura80, s.calibracion.n, R.pv.result.trayectorias, R.pv.result.semilla], fuentes: fu(R.pv), hechos: { modelo: s.modelo, evaluacion: ev.map((e) => ({ modelo: e.modelo, mase: e.maseProm })), cobertura80: s.calibracion.cobertura80 }, sugerencias: [] };
  } },
  { id: 'abc', claves: ['abc', 'xyz', 'clasific', 'pareto', 'mas vend', 'top', 'principales producto', 'estrella'], fn: ({ R }) => {
    if (!R.dv) return faltaAnalisis('ventas');
    const d = R.dv.result;
    return { texto: `Clasificación de productos [describir_operacion]:\n• ABC por ventas: A = **${fmtNum(d.abc.A ?? 0)}**, B = ${fmtNum(d.abc.B ?? 0)}, C = ${fmtNum(d.abc.C ?? 0)} SKU (A concentra el 80 % de las ventas).\n• XYZ por variabilidad: X = ${fmtNum(d.xyz.X ?? 0)}, Y = ${fmtNum(d.xyz.Y ?? 0)}, Z = ${fmtNum(d.xyz.Z ?? 0)}.\n• Los 20 SKU más vendidos concentran ${fmtPct(d.concentracionTop20Sku, 1)} de las ventas. Top 3: ${d.topVentas.slice(0, 3).map((x) => `**${x.sku}** (${fmtMillones(x.soles, 2)})`).join(', ')}.`,
      cifras: [d.abc.A ?? 0, d.abc.B ?? 0, d.abc.C ?? 0, d.xyz.X ?? 0, d.xyz.Y ?? 0, d.xyz.Z ?? 0, d.concentracionTop20Sku, ...d.topVentas.slice(0, 3).map((x) => x.soles)], fuentes: fu(R.dv), hechos: { abc: d.abc, xyz: d.xyz, top3: d.topVentas.slice(0, 3) }, sugerencias: [] };
  } },
  { id: 'patrones', claves: ['intermitente', 'patron', 'syntetos', 'erratic', 'irregular', 'tipo de demanda'], fn: ({ R }) => {
    if (!R.dk) return faltaAnalisis('Kardex');
    const p = R.dk.result.patrones, m = R.pk?.result.modelosElegidos ?? {};
    return { texto: `Patrones de demanda del Kardex (Syntetos-Boylan: ADI 1.32, CV² 0.49) [describir_operacion]:\n${Object.entries(p).map(([k, v]) => `• ${k.replace(/_/g, ' ').toLowerCase()}: **${fmtNum(v)}** productos`).join('\n')}\nModelos elegidos por producto: ${Object.entries(m).map(([k, v]) => `${k} ${v}`).join(', ')}.`,
      cifras: [...Object.values(p), ...Object.values(m)], fuentes: [...fu(R.dk), ...fu(R.pk)], hechos: { patrones: p, modelos: m }, sugerencias: [] };
  } },
  { id: 'supuestos', claves: ['supuesto', 'parametro', 'lead time', 'plazo de suministro', 'nivel de servicio', 'costo de ordenar'], fn: ({ bd }) => {
    const ps = bd.todas<{ clave: string; valor: string; unidad: string; descripcion: string }>('SELECT clave, valor, unidad, descripcion FROM parametro WHERE es_supuesto=1 ORDER BY clave');
    return { texto: `Supuestos vigentes (editables en Configuración; se declaran en cada resultado):\n${ps.map((p) => `• ${p.descripcion}: **${p.valor}** ${p.unidad ?? ''}`).join('\n')}`, cifras: ps.map((p) => Number(p.valor)).filter(isFinite), fuentes: [], hechos: { supuestos: ps }, sugerencias: [] };
  } },
  { id: 'ventas', claves: ['ventas', 'vendimos', 'facturacion', 'ingresos', 'utilidad', 'margen', 'ganancia'], fn: ({ R }) => {
    if (!R.dv) return faltaAnalisis('ventas');
    const d = R.dv.result;
    return { texto: `Últimos 12 meses cerrados (${mes(d.meses.at(-12)!)}–${mes(d.cutoff)}) [describir_operacion]:\n• Ventas **${fmtMillones(d.kpi12.ventas)}** (${vr(d.variacion.ventas)}).\n• Utilidad operativa **${fmtMillones(d.kpi12.utilidad)}** (${vr(d.variacion.utilidad)}).\n• Margen **${fmtPct(d.kpi12.margen)}** (${pp(d.variacion.margenPp / 100)} vs. ${fmtPct(d.kpi12prev.margen)}).\n• ${fmtNum(d.kpi12.transacciones)} transacciones, ${fmtNum(d.kpi12.clientes)} clientes.`,
      cifras: [d.kpi12.ventas, d.variacion.ventas, d.kpi12.utilidad, d.variacion.utilidad, d.kpi12.margen, d.variacion.margenPp / 100, d.kpi12prev.margen, d.kpi12.transacciones, d.kpi12.clientes], fuentes: fu(R.dv), hechos: { kpi12: d.kpi12, kpi12prev: d.kpi12prev, variacion: d.variacion }, sugerencias: ['¿Por qué bajó el margen?'] };
  } },
];

/** Detalle de un producto (código de ventas o del Kardex). */
function producto({ R, bd }: Ctx, codigo: string): Omit<Respuesta, 'intencion'> | null {
  const vId = bd.valor<number>("SELECT id FROM dataset WHERE tipo='ventas' ORDER BY id DESC LIMIT 1");
  const cod = codigo.toUpperCase();
  const v = vId ? bd.una<{ v: number; u: number; n: number; d: number; ult: string }>('SELECT total(soles) v, total(utilidad) u, count(*) n, count(DISTINCT departamento) d, max(fecha) ult FROM venta WHERE dataset_id=? AND upper(sku)=?', [vId, cod]) : null;
  if (v && v.n > 0) {
    return { texto: `Producto **${cod}** (ventas, todo el histórico) [consulta SQL]:\n• Ventas ${fmtMillones(v.v, 2)} en ${fmtNum(v.n)} transacciones y ${fmtNum(v.d)} departamentos; última venta ${v.ult}.\n• Utilidad ${fmtMillones(v.u, 2)} → margen **${fmtPct(v.v ? v.u / v.v : 0)}**${v.u < 0 ? ' (destruye valor: revisar precio/costo)' : ''}.`,
      cifras: [v.v, v.n, v.d, v.u, v.v ? v.u / v.v : 0], fuentes: [], hechos: { producto: cod, ventas: v.v, utilidad: v.u, transacciones: v.n }, sugerencias: [] };
  }
  const pol = R.pr?.result.politicas.find((x) => x.codigo.toUpperCase() === cod);
  const pk = R.pk?.result.productos.find((x) => x.codigo.toUpperCase() === cod);
  const pd = R.dk?.result.porProducto.find((x) => x.codigo.toUpperCase() === cod);
  if (!pol && !pd) return null;
  const l: string[] = [];
  const cf: number[] = [];
  if (pd) { l.push(`• ${pd.descripcion} · clase ${pd.abc} · patrón ${pd.patron}: salidas ${fmtNum(pd.salidas, 0)} unid., stock final ${fmtNum(pd.stockFinal, 0)}.`); cf.push(pd.salidas, pd.stockFinal); }
  if (pk) { l.push(`• Pronóstico 6 meses (P50): **${fmtNum(pk.total.p50, 0)} unid.** (80 %: ${fmtNum(pk.total.p10, 0)} – ${fmtNum(pk.total.p90, 0)}), modelo ${pk.modelo}.`); cf.push(pk.total.p50, pk.total.p10, pk.total.p90); }
  if (pol) { l.push(`• Política ${pol.politica}: stock de seguridad ${fmtNum(pol.ss, 0)}, punto de reorden ${fmtNum(pol.rop, 0)}, EOQ ${fmtNum(pol.eoq, 0)}; estado **${pol.estado.replace(/_/g, ' ').toLowerCase()}**; pedir ${fmtNum(pol.qSugerida, 0)} unid.`); cf.push(pol.ss, pol.rop, pol.eoq, pol.qSugerida); }
  return { texto: `Producto **${cod}** (Kardex) [describir_operacion, proyectar_6m, optimizar_plan]:\n${l.join('\n')}`, cifras: cf, fuentes: [...fu(R.dk), ...fu(R.pk), ...fu(R.pr)], hechos: { producto: cod, descriptivo: pd, pronostico: pk?.total, politica: pol }, sugerencias: [] };
}

/** Clasifica la intención por palabras clave (normalizadas) y responde con plantillas. */
export function responder(ctx: Ctx, pregunta: string): Respuesta {
  const q = ` ${normalizar(pregunta)} `;
  const extra: { codigo?: string; mes?: string } = {};
  const mCod = pregunta.match(/\b([A-Z][A-Z0-9]*(?:-[A-Z0-9./]+)+|K\d{5})\b/i);
  if (mCod) extra.codigo = mCod[1];
  const iMes = MESES.findIndex((m) => q.includes(` ${m} `) || q.includes(` ${m}`));
  if (iMes >= 0) extra.mes = String(iMes + 1).padStart(2, '0');
  if (/proximo mes|mes que viene|siguiente mes/.test(q)) extra.mes = undefined;
  if (extra.codigo) { const r = producto(ctx, extra.codigo); if (r) return { intencion: 'producto', ...r }; }
  let mejor: { id: string; fn: Manejador; p: number } | null = null;
  for (const it of INTENCIONES) {
    const p = it.claves.reduce((s, k) => s + (q.includes(k) ? k.length : 0), 0);
    if (p > 0 && (!mejor || p > mejor.p)) mejor = { id: it.id, fn: it.fn, p };
  }
  if (!mejor) return { intencion: 'desconocida', texto: 'No encontré esa pregunta entre las que puedo responder con los datos del sistema. Pruebe con alguna de estas:\n' + SUG.map((s) => `• ${s}`).join('\n'), cifras: [], fuentes: [], hechos: {}, sugerencias: SUG.slice(0, 4) };
  const r = mejor.fn(ctx, q, extra)!;
  return { intencion: mejor.id, ...r };
}

// ------------------------------------------------ Evaluador de textos ------------------------------------------------
/**
 * Verifica que cada número de un texto (p. ej. redactado por un LLM) exista entre las cifras calculadas por el motor,
 * en cualquiera de sus presentaciones (valor, millones, porcentaje, miles), con tolerancia de redondeo.
 */
/** '1,045.6' → 1045.6 (coma de miles); '1,5' → 1.5 (coma decimal). */
const aNum = (t: string) => Number(/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.'));
const CONSTANTES_METODO = new Set([80, 95, 20, 180, 36, 1.32, 0.49]); // + umbrales ADI/CV² de Syntetos-Boylan
/** Números contenidos en textos generados por el propio motor (p. ej. la evidencia de una hipótesis): también son cifras del motor. */
export const numerosDe = (...t: string[]) => t.join(' ').match(/-?\d[\d,]*(?:\.\d+)?/g)?.map((x) => Number(x.replace(/,/g, ''))).filter(isFinite) ?? [];
export function verificarCifras(texto: string, permitidas: number[]): { ok: boolean; noVerificadas: string[] } {
  const base = permitidas.filter((x) => isFinite(x));
  const variantes = base.flatMap((v) => [v, v / 1e6, v * 100, v / 1e3, Math.abs(v), Math.abs(v) / 1e6, Math.abs(v) * 100]);
  const limpio = texto.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\w* \d{2}\b/gi, ' ').replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\b[A-Z][A-Z0-9]*(?:-[A-Z0-9./()"]+)+|\bK\d{5}\b/gi, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\bP\d+(\.\d+)?\b/g, ' ');
  const nums = limpio.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  const noVer: string[] = [];
  for (const t of nums) {
    const n = aNum(t);
    if (!isFinite(n) || (Number.isInteger(n) && Math.abs(n) <= 12)) continue; // ordinales, meses y conteos pequeños
    if (CONSTANTES_METODO.has(n)) continue; // niveles y umbrales del método (intervalo 80 %/95 %, top 20, 180 días, 36 meses)
    const dec = (t.split(/[.]|,(?!\d{3}\b)/)[1] ?? '').length;
    const tol = Math.max(0.5 * 10 ** -dec, Math.abs(n) * 0.002);
    if (!variantes.some((v) => Math.abs(Math.abs(v) - Math.abs(n)) <= tol)) noVer.push(t);
  }
  return { ok: noVer.length === 0, noVerificadas: noVer };
}
