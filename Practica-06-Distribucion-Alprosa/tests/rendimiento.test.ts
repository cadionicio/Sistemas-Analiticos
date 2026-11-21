// I07: metas medidas de volumen y rendimiento (BI01, BI02, BI04, BI08, O04, AL07). Mide, no extrapola: 5 años de historia sintética.
import { it, expect } from 'vitest';
import fs from 'node:fs';
import initSqlJs from 'sql.js';
import { Repo } from '../src/core/db';
import { validarConjunto } from '../src/core/contrato';
import { confirmarCarga } from '../src/core/carga';
import * as D from '../src/core/dominio';
import * as P from '../src/core/permisos';
import * as K from '../src/core/kpi';
import * as F from '../src/core/pronostico';
import * as M from '../src/core/simulacion';
import * as X from '../src/core/exportar';
import { aHojas } from '../src/core/demo';
import { tablasExcel06, HISTORIA_CORTE } from '../src/core/historia';

const t = <T>(fn: () => T) => { const a = performance.now(); const r = fn(); return { r, ms: performance.now() - a }; };
const ta = async <T>(fn: () => Promise<T>) => { const a = performance.now(); const r = await fn(); return { r, ms: performance.now() - a }; };
/** Fecha desplazada k años (364·k días) conservando el desfase «-05:00». */
const despl = (col: string, k: number) => `CASE WHEN ${col} IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%S', substr(${col},1,19), '-${364 * k} days') || substr(${col},20) END`;

it('Metas medidas con 5 años de historia', async () => {
  const SQL = await initSqlJs();
  const repo = Repo.iniciar(new SQL.Database()); repo.reloj = () => '2026-11-15T10:00:00-05:00';
  P.asegurarUsuarios(repo); repo.transaccion(() => D.asegurarParametros(repo));
  const carga = t(() => { const { datos } = validarConjunto(aHojas(tablasExcel06())); confirmarCarga(repo, 'U01', datos, { hash: 'h', nombre: '06', bytes: 0, datasetId: '06' }); });
  // Cuatro años más copiando la historia con IDs y fechas desplazadas
  const amp = t(() => repo.transaccion(() => {
    for (let k = 1; k <= 4; k++) {
      const s = `'-Y${k}'`;
      repo.run(`INSERT INTO hist_pedido SELECT pedido_id || ${s}, cliente_id, destino_id, region, remoto, substr(${despl('fecha_pedido || \'T00:00:00-05:00\'', k)},1,10), ${despl('registrado_en', k)}, ${despl('compromiso_inicio', k)}, ${despl('compromiso_fin', k)}, prioridad, tipo_demanda, ${despl('cancelado_en', k)}, motivo_cancelacion, origen_nodo, modo_final, tramos FROM hist_pedido WHERE pedido_id NOT LIKE '%-Y%'`);
      repo.run(`INSERT INTO hist_linea SELECT pedido_id || ${s}, linea, producto_id, solicitado_mil, comprometido_mil, no_atendido_mil, motivo_no_atendido FROM hist_linea WHERE pedido_id NOT LIKE '%-Y%'`);
      repo.run(`INSERT INTO hist_entrega SELECT entrega_id || ${s}, pedido_id || ${s}, intento, ${despl('ocurrido_en', k)}, ${despl('registrado_en', k)}, estado, motivo, linea, aceptado_mil, rechazado_mil FROM hist_entrega WHERE pedido_id NOT LIKE '%-Y%'`);
      repo.run(`INSERT INTO hist_etapa SELECT etapa_id || ${s}, pedido_id || ${s}, tramo, modo_id, nodo_origen_id, nodo_destino_id, servicio_ref, ${despl('salida_plan', k)}, ${despl('salida_real', k)}, ${despl('llegada_plan', k)}, ${despl('llegada_real', k)}, kg_mil, capacidad_kg_mil, conexion_perdida, costo_estimado_cent, costo_real_cent, motivo_retraso FROM hist_etapa WHERE pedido_id NOT LIKE '%-Y%'`);
    }
  }));
  const pedidosH = repo.num('SELECT COUNT(*) FROM hist_pedido');
  const bytes = repo.exportar();
  const apertura = t(() => Repo.iniciar(new SQL.Database(bytes)));
  const hechos = t(() => K.cargarHechos(repo));
  const f5 = { desde: '2021-11-15T00:00:00-05:00', hasta: HISTORIA_CORTE, corte: repo.reloj(), granularidad: 'mes' as const };
  const kpi5 = t(() => K.indicadores(hechos.r, f5));
  const serie = t(() => K.serieOTIF(hechos.r, { ...f5, granularidad: 'semana' }));
  const pareto = t(() => K.pareto(hechos.r, f5));
  const busqueda = t(() => repo.todos("SELECT * FROM hist_pedido WHERE destino_id = 'DES-010' AND compromiso_fin >= '2023-01-01' ORDER BY compromiso_fin"));
  const pron = t(() => F.pronosticar(repo, hechos.r, { producto: 'P01', corte: HISTORIA_CORTE }));
  const planes = t(() => M.construirPlanes(repo));
  const sim = t(() => M.simular(planes.r.planes, planes.r.servicios, { ...M.PARAMETROS_DEFECTO, iteraciones: 1000 }));
  const snap: X.Snapshot = { runId: 'RUN-PERF', generadoEn: repo.reloj(), datasetId: '06', datasetHash: 'h', build: 'perf', modalidad: 'HTML', existencias: D.existencias(repo), pedidos: D.pedidos(repo),
    analitica: { vista: 'REEXPRESADA', conocidoHasta: null, desde: f5.desde, hasta: f5.hasta, filtros: '5 años', indicadores: kpi5.r, serie: serie.r, pareto: pareto.r, causas: [] } };
  const xlsx = await ta(() => X.exportarXlsx(snap));
  // BI04: índice que acelera una consulta pero cuesta en la carga
  const sinIdx = t(() => repo.todos("SELECT COUNT(*) FROM hist_pedido WHERE destino_id = 'DES-010'"));
  const insSin = t(() => repo.transaccion(() => { for (let i = 0; i < 2000; i++) repo.run("INSERT INTO hist_sin_datos VALUES ('R" + i + "','2020-01-01','prueba')"); }));
  repo.run('CREATE INDEX ix_prueba_destino ON hist_pedido(destino_id)'); repo.run('CREATE INDEX ix_prueba_sd ON hist_sin_datos(motivo)');
  const conIdx = t(() => repo.todos("SELECT COUNT(*) FROM hist_pedido WHERE destino_id = 'DES-010'"));
  const insCon = t(() => repo.transaccion(() => { for (let i = 0; i < 2000; i++) repo.run("INSERT INTO hist_sin_datos VALUES ('S" + i + "','2020-01-01','prueba')"); }));
  // BI08: dos «sesiones» calculan el mismo panel sobre la misma base: resultados idénticos (sin mezclar)
  const s1 = K.indicadores(K.cargarHechos(repo), f5), s2 = K.indicadores(K.cargarHechos(repo), f5);
  expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));

  const filas: [string, string, number, number, string][] = [
    ['BI01', 'Carga del Excel 06 (validación + confirmación)', carga.ms, 10000, 'ms'],
    ['BI01', `Base con ${pedidosH} pedidos históricos (5 años): tamaño`, bytes.byteLength / 1048576, 100, 'MB'],
    ['BI01', 'Apertura de la base (5 años)', apertura.ms, 5000, 'ms'],
    ['BI01', 'Reconstrucción de hechos (historia + operación)', hechos.ms, 5000, 'ms'],
    ['BI01', 'Panel de 12 indicadores sobre 5 años', kpi5.ms, 3000, 'ms'],
    ['BI02', 'Serie semanal de 5 años (≈260 períodos)', serie.ms, 3000, 'ms'],
    ['BI01', 'Pareto de causas sobre 5 años', pareto.ms, 3000, 'ms'],
    ['BI01', 'Búsqueda filtrada de pedidos por destino', busqueda.ms, 500, 'ms'],
    ['BI01', 'Pronóstico P01 (3 métodos + evaluación cronológica)', pron.ms, 3000, 'ms'],
    ['O04', 'Construcción de 3 planes (ensayo aislado)', planes.ms, 10000, 'ms'],
    ['O04', 'Simulación Monte Carlo 1000 iteraciones × 3 planes', sim.ms, 15000, 'ms'],
    ['AL07', 'Exportación Excel de 5 años', xlsx.ms, 10000, 'ms'],
    ['BI04', 'Consulta por destino SIN índice', sinIdx.ms, 500, 'ms'],
    ['BI04', 'Consulta por destino CON índice', conIdx.ms, 500, 'ms'],
    ['BI04', '2000 inserciones SIN índice adicional', insSin.ms, 3000, 'ms'],
    ['BI04', '2000 inserciones CON índice adicional', insCon.ms, 3000, 'ms'],
  ];
  const csv = ['caso;medicion;resultado;meta;unidad;cumple', ...filas.map(([c, m, v, meta, u]) => `${c};${m};${v.toFixed(2).replace('.', ',')};${meta};${u};${v <= meta ? 'SÍ' : 'NO'}`)].join('\n');
  fs.writeFileSync(process.env.SALIDA_METAS ?? '/tmp/METAS_MEDIDAS_I07.csv', '﻿' + csv);
  console.log(csv);
  expect(pedidosH).toBeGreaterThan(6000);
  expect(filas.filter(([, , v, meta]) => v > meta).map(([c, m]) => `${c} ${m}`)).toEqual([]);
}, 600000);
