// Pantalla «Exportar resultados»: los tres Excel de resultados en un solo lugar, con su contenido y el filtro que aplican.
import { filas } from '../nucleo/bd.js';
import { mostrarFH } from '../nucleo/fechas.js';
import { esc } from '../nucleo/formato.js';
import { filtroActual, exportarLibro } from './vistaIndicadores.js';
import { exportar09, ultimaSimulacion } from './vistaSimulacion.js';
import { exportacionesSesion } from './exportaciones.js';

export async function vistaExportar(c, ctx) {
  if (!ctx.hayDatos()) { c.innerHTML = '<section class="tarjeta vacia"><h1>Exportar resultados</h1><p>No hay datos. Vaya a «Inicio» y pulse «Cargar demostración».</p></section>'; return; }
  const f = filtroActual();
  const carga = filas('SELECT * FROM carga ORDER BY id DESC LIMIT 1')[0] || {};
  const sim = ultimaSimulacion();
  const hechas = exportacionesSesion();
  const tarjeta = (n, titulo, desc, hojas, base, id) => `<article class="tarjeta exp-tarjeta">
      <div class="exp-cab"><span class="exp-num">${n}</span><div><h2 class="exp-tit">Excel ${n} · ${titulo}</h2><p class="subtexto">${desc}</p></div></div>
      <ul class="exp-hojas">${hojas.map(h => `<li>${esc(h)}</li>`).join('')}</ul>
      <p class="exp-base"><strong>Se basa en:</strong> ${base}</p>
      <button type="button" class="btn exportar grande ancho" id="${id}">⬇ Exportar Excel ${n}</button></article>`;
  c.innerHTML = `<div class="pila">
    <section class="tarjeta"><div class="cab-tarjeta"><div><h1>Exportar resultados</h1><p class="subtexto" style="margin:4px 0 0">Genera los libros Excel de resultados con los datos confirmados. Cada libro incluye una hoja META con versión, corte, filtros, identificador y origen de los datos.</p></div>
      <button type="button" class="btn" id="b-ir-ind">Cambiar el período en «Indicadores»</button></div>
      <div class="franja-periodo"><span><strong>Período aplicado:</strong> ${esc(f.equipo || 'Todos los equipos')} · ${esc(mostrarFH(f.desde))} a ${esc(mostrarFH(f.hasta))} · corte ${esc(mostrarFH(f.corte))}</span><span class="subtexto">Datos de origen: ${esc(carga.archivo || '—')} · SHA-256 ${esc((carga.sha256 || '').slice(0, 12))}…</span></div></section>
    <div class="exp-rejilla">
      ${tarjeta('07', 'Resultados operativos', 'Lo que resultó de operar el sistema.', ['Paradas y tramos con minutos del período', 'Órdenes, entregas y reservas', 'Movimientos con saldo y existencias al corte', 'Tareas preventivas, ejecuciones y acciones', 'Totales de control con fórmulas'], 'el período aplicado', 'b-exp07')}
      ${tarjeta('08', 'Analítica', 'Las cuatro analíticas con sus datos de origen y criterios.', ['Indicadores con numerador y denominador', 'Descriptiva e histograma de esperas', 'Diagnóstica: Pareto por modo y por demora', 'Predictiva con validación', 'Prescriptiva por pieza'], 'el período aplicado', 'b-exp08')}
      ${tarjeta('09', 'Proyección y control', 'Escenarios A/B, incertidumbre y trazabilidad acción → indicador → seguimiento.', ['Parámetros, semilla y horizonte', 'Escenarios y percentiles', 'Sensibilidad de la decisión', 'Réplicas (conciliación por fórmula)', 'Trazabilidad de acciones'],
        sim ? `la corrida <strong>${esc(sim.id)}</strong> · pieza ${esc(sim.pieza)} · semilla ${esc(sim.semilla)} · ${esc(sim.repeticiones)} réplicas · ${esc(sim.horizonte)} días` : 'aún no hay simulación en esta sesión: se simulará la pieza 0103 con los valores del historial antes de exportar', 'b-exp09')}
    </div>
    <section class="tarjeta"><h2>Exportaciones de esta sesión</h2>
      ${hechas.length ? `<table class="tabla" id="tabla-exportaciones"><thead><tr><th>Hora</th><th>Libro</th><th>Archivo</th><th>Identificador</th></tr></thead><tbody>${hechas.map(x => `<tr><td class="nw">${x.hora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</td><td>Excel ${esc(x.libro)}</td><td>${esc(x.nombre)}</td><td>${esc(x.id)}</td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Todavía no se exportó nada en esta sesión. Los archivos se guardan en la carpeta de descargas.</p>'}
    </section></div>`;
  c.querySelector('#b-ir-ind').onclick = () => ctx.irA('indicadores');
  c.querySelector('#b-exp07').onclick = async () => { await exportarLibro(ctx, '07'); vistaExportar(c, ctx); };
  c.querySelector('#b-exp08').onclick = async () => { await exportarLibro(ctx, '08'); vistaExportar(c, ctx); };
  c.querySelector('#b-exp09').onclick = async () => { await exportar09(ctx); ctx.irA('exportar'); };
}
