// Pantalla «Preventivo»: estado de cada tarea, próximo vencimiento y registro de ejecución.
import { filas } from '../nucleo/bd.js';
import { mostrarFH, mostrarF, isoAMs, msAIso, ahoraIso } from '../nucleo/fechas.js';
import { fmtConteo, esc } from '../nucleo/formato.js';
import * as op from '../nucleo/operaciones.js';
import { formulario, ahoraLocalInput } from './dom.js';
import { cumplimientoCriticas } from '../nucleo/analitica.js';
import { fmtMagnitud } from '../nucleo/formato.js';

let tareaSel = null;

export async function vistaPreventivo(c, ctx) {
  if (!ctx.hayDatos()) { c.innerHTML = '<section class="tarjeta vacia"><h1>Preventivo</h1><p>No hay datos. Vaya a «Inicio» y pulse «Cargar demostración».</p></section>'; return; }
  const u = ctx.usuario();
  const ts = op.estadoTareas();
  const venc = ts.filter(t => t.estado[0] === 'error').length;
  const porV = ts.filter(t => t.estado[0] === 'alerta').length;
  const ini = (filas('SELECT periodo_desde FROM carga ORDER BY id DESC LIMIT 1')[0]?.periodo_desde || ahoraIso().slice(0, 10)) + 'T00:00:00-05:00';
  const cu = cumplimientoCriticas({ equipo: 'P-01', desde: ini, hasta: ahoraIso(), corte: ahoraIso() });
  const vencCrit = ts.filter(t => t.critica && t.estado[0] === 'error').length;
  c.innerHTML = `<div class="pila">
    <section class="tarjeta encabezado-vista"><h1>Preventivo</h1><span class="subtexto">Estado al ${esc(mostrarF(ahoraIso().slice(0, 10)))}</span></section>
    <section class="tarjeta"><div class="kpis">
      <div class="kpi"><span>Tareas preventivas</span><strong>${fmtConteo(ts.length)}</strong><small>${fmtConteo(ts.filter(t => t.critica).length)} críticas</small></div>
      <div class="kpi ${venc ? 'error' : 'ok'}"><span>Tareas vencidas hoy</span><strong>${fmtConteo(venc)}</strong><small>${venc ? esc(ts.filter(t => t.estado[0] === 'error').map(t => t.codigo + (t.critica ? ' (crítica)' : '')).join(', ')) : 'ninguna'}</small></div>
      <div class="kpi ${porV ? 'alerta' : 'ok'}"><span>Por vencer (3 días)</span><strong>${fmtConteo(porV)}</strong></div>
      <div class="kpi ${cu.porcentaje === null ? '' : vencCrit ? 'alerta' : cu.porcentaje >= 90 ? 'ok' : 'error'}"><span>Cumplimiento de tareas críticas</span><strong>${cu.porcentaje === null ? '—' : fmtMagnitud(cu.porcentaje, 1) + ' %'}</strong><small>${fmtConteo(cu.a_tiempo)} a tiempo de ${fmtConteo(cu.vencibles)} vencimientos desde el inicio de los datos · meta supuesta 90 %</small></div>
    </div></section>
    <section class="tarjeta"><h2>Tareas</h2><div class="tabla-centro"><table class="tabla" id="tabla-tareas"><thead><tr><th>Tarea</th><th>Descripción</th><th>Modo que previene</th><th>Frecuencia</th><th>Crítica</th><th>Responsable</th><th>Último vencimiento atendido</th><th>Próximo vencimiento</th><th>Estado</th></tr></thead><tbody>
      ${ts.map(t => `<tr class="clic${tareaSel === t.codigo ? ' sel' : ''}" data-tarea="${esc(t.codigo)}" data-estado="${t.estado[1]}"><td>${esc(t.codigo)}</td><td>${esc(t.descripcion)}</td><td>${esc(t.modo_codigo)} · ${esc(t.modo_nombre)}</td><td class="num">${fmtConteo(t.frecuencia_dias)} días</td><td>${t.critica ? 'Sí' : 'No'}</td><td>${esc(t.responsable)}</td>
        <td>${t.ultima ? esc(mostrarF(t.ultima.fecha_vencimiento)) : '—'}</td><td><strong>${esc(mostrarF(t.proximo))}</strong></td><td><span class="pildora ${t.estado[0]}">${t.estado[1]}${t.diasPara < 0 ? ` · ${-t.diasPara} días` : ''}</span></td></tr>`).join('')}
    </tbody></table></div></section></div>`;
  c.querySelectorAll('tr[data-tarea]').forEach(tr => tr.onclick = () => { tareaSel = tareaSel === tr.dataset.tarea ? null : tr.dataset.tarea; vistaPreventivo(c, ctx); });
  if (tareaSel) {
    const tr = c.querySelector(`tr[data-tarea="${tareaSel}"]`);
    const t = ts.find(x => x.codigo === tareaSel);
    if (tr && t) {
      const ejs = filas('SELECT * FROM ejecucion_preventiva WHERE tarea_codigo=? ORDER BY fecha_vencimiento DESC LIMIT 12', [t.codigo]);
      const det = document.createElement('tr'); det.className = 'detalle';
      det.innerHTML = `<td colspan="9"><div class="encabezado-vista"><h3 style="margin:0">${esc(t.codigo)} · ${esc(t.descripcion)}</h3>
          <button type="button" class="btn principal" id="b-ejec" ${op.puede(u, 'ejecutar_preventivo') ? '' : `disabled title="Corresponde a ${op.quienPuede('ejecutar_preventivo')}"`}>Registrar ejecución</button></div>
        <p class="subtexto">Justificación de la frecuencia: ${esc(t.justificacion)} · Criterio de aceptación: ${esc(t.criterio_aceptacion)}</p>
        <table class="tabla"><thead><tr><th>Ejecución</th><th>Vencimiento</th><th>Ejecutada</th><th>Oportunidad</th><th>Resultado</th><th>Orden</th><th>Evidencia</th></tr></thead><tbody>
        ${ejs.map(e => { const tarde = e.fecha_ejecucion && e.fecha_ejecucion.slice(0, 10) > e.fecha_vencimiento; return `<tr><td>${esc(e.codigo)}</td><td>${esc(mostrarF(e.fecha_vencimiento))}</td><td>${esc(mostrarFH(e.fecha_ejecucion))}</td><td>${tarde ? '<span class="pildora alerta">Fuera de fecha</span>' : '<span class="pildora ok">A tiempo</span>'}</td><td>${e.resultado === 'CONFORME' ? '<span class="pildora ok">Conforme</span>' : '<span class="pildora error">No conforme</span>'}</td><td>${esc(e.orden_codigo || '')}</td><td>${esc(e.evidencia)}</td></tr>`; }).join('')}
        </tbody></table></td>`;
      tr.after(det);
      det.querySelector('#b-ejec').onclick = async e => {
        e.stopPropagation();
        const ahora = ahoraLocalInput();
        const v = await formulario({
          titulo: `Registrar ejecución · ${t.codigo}`, intro: '<p>El trabajo preventivo se registra como mantenimiento programado, separado de las paradas no planificadas.</p>',
          campos: [
            { id: 'vencimiento', etiqueta: 'Vencimiento que se atiende', tipo: 'fecha', valor: t.proximo },
            { id: 'inicio', etiqueta: 'Inicio', tipo: 'fechahora', valor: msAIso(Date.now() - 3600e3).slice(0, 16) },
            { id: 'fin', etiqueta: 'Fin', tipo: 'fechahora', valor: ahora },
            { id: 'resultado', etiqueta: 'Resultado', tipo: 'select', opciones: [['CONFORME', 'Conforme con el criterio de aceptación'], ['NO_CONFORME', 'No conforme']] },
            { id: 'evidencia', etiqueta: 'Evidencia de ejecución', tipo: 'texto', valor: `Checklist ${t.codigo} firmado` },
          ],
        });
        if (v) await ctx.operar(op.registrarEjecucionPreventiva, { tarea: t.codigo, ...v }, { ok: r => `Ejecución ${r.ejecucion} registrada con la orden ${r.orden}.`, motivo: 'Preventivo ' + t.codigo });
      };
    }
  }
}
