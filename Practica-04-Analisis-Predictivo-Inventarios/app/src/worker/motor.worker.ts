/**
 * MOTOR del sistema (Web Worker): contiene la BD y ejecuta el Super Agente en segundo plano.
 * La interfaz nunca se congela: los cálculos pesados (pronóstico, Monte Carlo) corren aquí.
 * Protocolo: { id, metodo, args } → { id, ok, resultado | error } y eventos { tipo: 'progreso', ... }.
 */
/// <reference lib="webworker" />
import { BaseDatos } from '../core/db/db';
import { importarArchivo } from '../core/ingesta/importar';
import { importarVentas } from '../core/ingesta/ventas';
import { resumenCalidad } from '../core/ingesta/calidad_resumen';
import { registrarVentaManual, type VentaManual } from '../core/ingesta/manual';
import { registrarMovimientoManual, type MovimientoManual } from '../core/ingesta/kardex_manual';
import { describirVentas, describirKardex } from '../core/analitica/descriptivo';
import { diagnosticarVentas, diagnosticarKardex } from '../core/analitica/diagnostico';
import { proyectarVentas, proyectarKardex } from '../core/analitica/predictivo';
import { optimizarPlan, asegurarParametros } from '../core/analitica/prescriptivo';
import { simularEscenarios, type OpcionesSim } from '../core/analitica/montecarlo';
import { evaluarDescriptivoVentas, evaluarDescriptivoKardex, evaluarDiagnosticoVentas } from '../core/agentes/evaluador';
import type { ResultadoSkill } from '../core/analitica/contrato';
import { mesMas } from '../core/analitica/contrato';
import { registrarUso, auditar } from '../core/bitacora';
import { responder, verificarCifras } from '../core/agentes/copiloto';
import { ahoraLima, sha256 } from '../core/util/util';
import type { MapeoColumna } from '../core/ingesta/mapeo';
import { leerLibro } from '../core/ingesta/excel';
import * as XLSX from 'xlsx';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let bd: BaseDatos;
let wasm = '';
const ultimoArchivo = new Map<number, { datos: Uint8Array; nombre: string; hoja?: string; filaEncabezado?: number; mapeo?: MapeoColumna[] }>();

import type { Resultados } from '../core/agentes/resultados';
export type { Resultados };
let R: Resultados = {};

const progreso = (paso: string, estado: string, pct: number, detalle = '') => ctx.postMessage({ tipo: 'progreso', paso, estado, pct, detalle });
const idDe = (tipo: 'ventas' | 'kardex') => bd.valor<number>('SELECT id FROM dataset WHERE tipo=? ORDER BY id DESC LIMIT 1', [tipo]) ?? null;
const invalidar = () => { if (R.generadoEn) { R.desactualizado = true; guardarR(); } };
/** Los resultados vigentes se guardan en la BD: al reabrir el EXE (o una BD respaldada) se recuperan sin recalcular. */
function guardarR() { if (R.generadoEn) bd.run("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('resultados_vigentes', ?)", [JSON.stringify(R)]); }
function cargarR() {
  const j = bd.valor<string>("SELECT valor FROM configuracion WHERE clave='resultados_vigentes'");
  try { R = j ? JSON.parse(j) : {}; } catch { R = {}; }
}

const metodos: Record<string, (...a: never[]) => unknown> = {
  async iniciar(wasmUrl: string, bytes?: Uint8Array) {
    wasm = wasmUrl;
    bd = await BaseDatos.abrir(bytes, wasmUrl);
    asegurarParametros(bd);
    cargarR();
    return info();
  },
  info,
  async importar(datos: Uint8Array, nombre: string) {
    const r = await importarArchivo(bd, datos, nombre);
    const id = r.resumen.datasetId;
    ultimoArchivo.set(id, r.tipo === 'ventas' ? { datos, nombre, hoja: r.resumen.hoja, filaEncabezado: r.resumen.filaEncabezado, mapeo: r.resumen.mapeo } : { datos, nombre });
    invalidar();
    return r;
  },
  async reimportarVentasConMapeo(datasetId: number, mapeo: MapeoColumna[]) {
    const a = ultimoArchivo.get(datasetId);
    if (!a) throw new Error('El archivo original ya no está en memoria; vuelva a cargarlo.');
    const r = await importarVentas(bd, a.datos, a.nombre, { mapeoManual: mapeo });
    ultimoArchivo.set(r.datasetId, { ...a, hoja: r.hoja, filaEncabezado: r.filaEncabezado, mapeo: r.mapeo });
    auditar(bd, 'mapeo_columna', String(r.datasetId), 'UPDATE', null, mapeo);
    invalidar();
    return r;
  },
  /** Asistente de mapeo: encabezados del archivo original y mapeo vigente. */
  encabezados(datasetId: number) {
    const a = ultimoArchivo.get(datasetId);
    if (!a || a.hoja == null) return null;
    const h = leerLibro(a.datos).find((x) => x.nombre === a.hoja);
    const fila = (h?.filas[(a.filaEncabezado ?? 1) - 1] ?? [])  // filaEncabezado es 1-based.map((x) => (x == null ? '' : String(x)));
    return { archivo: a.nombre, hoja: a.hoja, fila: a.filaEncabezado ?? 1, encabezados: fila, mapeo: a.mapeo ?? [] };
  },
  /** Exporta tablas a un libro Excel en memoria (el usuario elige dónde guardarlo). */
  exportarXlsx(hojas: { nombre: string; filas: Record<string, unknown>[] }[]) {
    const wb = XLSX.utils.book_new();
    const usados = new Set<string>();
    for (const h of hojas) {
      let n = h.nombre.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Hoja';
      for (let i = 2; usados.has(n); i++) n = `${n.slice(0, 28)} ${i}`;
      usados.add(n);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(h.filas.length ? h.filas : [{ '(sin datos)': '' }]), n);
    }
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
  },
  /** "Datos de demostración": ventas SINTÉTICAS (rotuladas como tales) para explorar el sistema sin archivos. */
  async generarDemo() {
    let x = 20260928; const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
    const deps = ['DEMO Norte', 'DEMO Centro', 'DEMO Sur', 'DEMO Oriente'];
    const filas: Record<string, unknown>[] = [];
    for (let m = 0; m < 36; m++) {
      const anio = 2023 + Math.floor(m / 12), mes = (m % 12) + 1, est = 1 + 0.15 * Math.sin((mes / 12) * 2 * Math.PI);
      for (let i = 0; i < 90; i++) {
        const sku = `DEMO-${String(1 + Math.floor(rnd() ** 1.6 * 60)).padStart(3, '0')}`;
        const soles = Math.round(800 + rnd() * 9000 * est * (1 + m / 72));
        const margen = 0.06 - 0.05 * rnd() - (sku.endsWith('7') ? 0.08 : 0);
        filas.push({ Fecha: `${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`, 'Codigo producto': sku,
          'Venta soles': soles, Cantidad: Math.round(soles / (40 + rnd() * 20)), 'Utilidad operativa': Math.round(soles * margen),
          RUC: `2060000${String(Math.floor(rnd() * 400)).padStart(4, '0')}`, Cliente: `Cliente DEMO ${1 + Math.floor(rnd() * 400)}`, Departamento: deps[Math.floor(rnd() * deps.length)] });
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filas), 'DEMO sintetico');
    const datos = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    return metodos.importar(datos as never, 'DATOS_DEMOSTRACION_SINTETICOS.xlsx' as never);
  },
  datasets: () => bd.todas('SELECT * FROM dataset ORDER BY id'),
  calidad: (id: number) => resumenCalidad(bd, id),
  mapeo: (id: number) => bd.todas('SELECT columna_origen, campo_canonico, confianza, confirmado FROM mapeo_columna WHERE dataset_id=? ORDER BY id', [id]),
  ventaManual(v: VentaManual) { const id = idDe('ventas'); if (!id) throw new Error('Primero cargue un Excel de ventas.'); const r = registrarVentaManual(bd, id, v); invalidar(); return r; },
  movimientoManual(m: MovimientoManual) { const id = idDe('kardex'); if (!id) throw new Error('Primero cargue un Kardex.'); const r = registrarMovimientoManual(bd, id, m); invalidar(); return r; },
  ultimosRegistrosManuales: () => ({
    ventas: bd.todas("SELECT id, fecha, sku, soles, utilidad, departamento FROM venta WHERE origen='manual' ORDER BY id DESC LIMIT 10"),
    kardex: bd.todas("SELECT m.id, m.fecha, p.codigo, m.entrada, m.salida, m.stock_calculado stock, m.motivo FROM kardex_mov m JOIN producto p ON p.id=m.producto_id WHERE m.origen='manual' ORDER BY m.id DESC LIMIT 10"),
  }),
  /** KPI en tiempo real del tablero (se recalculan con SQL al cambiar filtros o datos). */
  kpis(f: { departamento?: string; desde?: string; hasta?: string }) {
    const id = idDe('ventas');
    const k = idDe('kardex');
    const out: Record<string, unknown> = { calculadoEn: new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 19).replace('T', ' ') };
    if (id) {
      const cutoff = bd.valor<string>('SELECT ultimo_mes_cerrado FROM dataset WHERE id=?', [id]);
      const hasta = f.hasta && f.hasta < cutoff ? f.hasta : cutoff;
      const desde12 = mesMas(hasta, -11), desdePrev = mesMas(hasta, -23), hastaPrev = mesMas(hasta, -12);
      const dep = f.departamento ? ' AND departamento=?' : '';
      const pr = (a: string, b: string) => [id, a, b, ...(f.departamento ? [f.departamento] : [])];
      const q = (a: string, b: string) => bd.una<{ v: number; u: number; n: number; c: number }>(`SELECT total(soles) v, total(utilidad) u, count(*) n, count(DISTINCT ruc) c FROM venta WHERE dataset_id=? AND periodo BETWEEN ? AND ?${dep}`, pr(a, b))!;
      const a = q(desde12, hasta), b = q(desdePrev, hastaPrev);
      const desde = f.desde ?? bd.valor<string>('SELECT min(periodo) FROM venta WHERE dataset_id=?', [id]);
      out.ventas = {
        cutoff, hasta, ventana: `${desde12} a ${hasta}`,
        ventas12: a.v, ventas12prev: b.v, utilidad12: a.u, utilidad12prev: b.u, margen12: a.v ? a.u / a.v : 0, margen12prev: b.v ? b.u / b.v : 0,
        transacciones12: a.n, clientes12: a.c,
        skusPerdida: bd.valor<number>(`SELECT count(*) FROM (SELECT sku, sum(utilidad) u FROM venta WHERE dataset_id=? AND periodo BETWEEN ? AND ?${dep} GROUP BY sku HAVING u<0)`, pr(desde, hasta)),
        skus: bd.valor<number>(`SELECT count(DISTINCT sku) FROM venta WHERE dataset_id=? AND periodo BETWEEN ? AND ?${dep}`, pr(desde, hasta)),
        serie: bd.todas(`SELECT periodo, total(soles) soles, total(utilidad) utilidad FROM venta WHERE dataset_id=? AND periodo BETWEEN ? AND ?${dep} GROUP BY periodo ORDER BY periodo`, pr(desde, hasta)),
        departamentos: bd.todas('SELECT departamento, total(soles) soles, total(utilidad) utilidad, total(utilidad)/total(soles) margen FROM venta WHERE dataset_id=? AND periodo BETWEEN ? AND ? GROUP BY 1 ORDER BY margen', [id, desde, hasta]),
        listaDepartamentos: bd.todas<{ d: string }>('SELECT DISTINCT departamento d FROM venta WHERE dataset_id=? ORDER BY 1', [id]).map((x) => x.d),
        periodoMin: bd.valor<string>('SELECT min(periodo) FROM venta WHERE dataset_id=?', [id]),
      };
    }
    if (k) {
      out.kardex = {
        movimientos: bd.valor<number>('SELECT count(*) FROM kardex_mov WHERE dataset_id=?', [k]),
        productos: bd.valor<number>('SELECT count(*) FROM producto WHERE dataset_id=?', [k]),
        inconsistentes: bd.valor<number>("SELECT count(*) FROM kardex_mov WHERE dataset_id=? AND flag_inconsistente=1 AND origen='excel'", [k]),
        negativos: bd.valor<number>('SELECT count(*) FROM kardex_mov WHERE dataset_id=? AND flag_negativo=1', [k]),
        serie: bd.todas('SELECT periodo, total(entrada) entradas, total(salida) salidas FROM kardex_mov WHERE dataset_id=? GROUP BY periodo ORDER BY periodo', [k]),
        cutoff: bd.valor<string>('SELECT ultimo_mes_cerrado FROM dataset WHERE id=?', [k]),
      };
    }
    return out;
  },
  /** "Análisis completo en 1 clic": el Coordinador ejecuta las skills en orden y reporta la máquina de estados. */
  analisisCompleto(op: OpcionesSim = {}) {
    const t0 = Date.now();
    const v = idDe('ventas'), k = idDe('kardex');
    if (!v && !k) throw new Error('No hay datos cargados. Use "Cargar datos de la práctica" o cargue un Excel en la pantalla Datos.');
    R = {};
    progreso('RECIBIDO', 'OK', 2, 'Solicitud recibida por el Coordinador');
    progreso('DATOS_VALIDADOS', 'OK', 6, `Datasets: ${[v && 'ventas', k && 'kardex'].filter(Boolean).join(' + ')}`);
    if (v) {
      progreso('ANALIZADO', 'EN_CURSO', 10, 'describir_operacion (ventas)'); R.dv = describirVentas(bd, v);
      progreso('ANALIZADO', 'EN_CURSO', 16, 'diagnosticar_desviacion (ventas)'); R.gv = diagnosticarVentas(bd, v, R.dv.result);
      progreso('EVALUADO', 'EN_CURSO', 20, 'Evaluador independiente (ventas)'); evaluarDescriptivoVentas(bd, R.dv); evaluarDiagnosticoVentas(bd, R.gv, R.dv.result);
      progreso('ANALIZADO', 'EN_CURSO', 28, 'proyectar_6m (ventas: 12 series, 10 000 trayectorias)'); R.pv = proyectarVentas(bd, v);
    }
    if (k) {
      progreso('ANALIZADO', 'EN_CURSO', 40, 'describir_operacion (Kardex)'); R.dk = describirKardex(bd, k); evaluarDescriptivoKardex(bd, R.dk);
      progreso('ANALIZADO', 'EN_CURSO', 46, 'diagnosticar_desviacion (Kardex)'); R.gk = diagnosticarKardex(bd, k, R.dk.result);
      progreso('ANALIZADO', 'EN_CURSO', 52, 'proyectar_6m (Kardex: 244 productos)'); R.pk = proyectarKardex(bd, k);
    }
    progreso('PROPUESTO', 'EN_CURSO', 72, 'optimizar_plan (políticas, plan de compras, recomendaciones)');
    R.pr = optimizarPlan(bd, k, R.dk?.result ?? null, R.pk?.result ?? null, v, R.dv?.result ?? null, R.gv?.result ?? null);
    progreso('PROPUESTO', 'EN_CURSO', 80, 'simular_escenarios (Monte Carlo)');
    R.sm = simularEscenarios(bd, R.pr.result, k, v, op);
    R.generadoEn = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
    R.desactualizado = false;
    registrarUso(bd, 'Análisis completo en 1 clic', 'Dashboard', `Super Agente: 5 skills + Evaluador · ${((Date.now() - t0) / 1000).toFixed(1)} s`, t0);
    guardarR();
    progreso('PROPUESTO', 'OK', 100, `Listo en ${((Date.now() - t0) / 1000).toFixed(1)} s · pendiente de aprobación del usuario`);
    return resumenResultados();
  },
  /** Copiloto del Super Agente: responde con plantillas sobre los resultados vigentes (sin LLM, sin web). */
  preguntar(texto: string) {
    const t0 = Date.now();
    const r = responder({ R, bd }, String(texto ?? '').slice(0, 500));
    registrarUso(bd, 'Pregunta al copiloto', 'Copiloto IA', `${r.intencion}: ${String(texto).slice(0, 120)}`, t0);
    return r;
  },
  /** Evaluador de textos: verifica las cifras de una redacción (p. ej. de un LLM) contra las del motor. */
  verificarTexto: (texto: string, cifras: number[]) => verificarCifras(texto, cifras),
  /**
   * Registra una versión de informe (técnico, ejecutivo o presentación) con control de cambios automático:
   * compara las cifras clave con la versión anterior, lista los parámetros editados y si cambiaron los aportes del usuario.
   */
  cambiosInforme(tipo: 'tecnico' | 'ejecutivo' | 'presentacion', resumen: Record<string, [string, number, string]>, aportes: string) {
    const prev = bd.una<{ version: number; generado_en: string; contenido_json: string; aportes_usuario: string }>(
      'SELECT version, generado_en, contenido_json, aportes_usuario FROM informe WHERE tipo=? ORDER BY version DESC LIMIT 1', [tipo]);
    const version = (prev?.version ?? 0) + 1;
    const cambios: string[] = [];
    if (!prev) cambios.push('Versión inicial generada por el Super Agente a partir de los resultados vigentes.');
    else {
      let pr: { resumen?: Record<string, [string, number, string]> } = {};
      try { pr = JSON.parse(prev.contenido_json); } catch { /* versión sin resumen */ }
      for (const [k, [et, v, txt]] of Object.entries(resumen)) {
        const a = pr.resumen?.[k];
        if (!a) cambios.push(`Nuevo indicador: ${et} = ${txt}.`);
        else if (Math.abs(a[1] - v) > 1e-9 * Math.max(1, Math.abs(v))) cambios.push(`${et}: ${a[2]} → ${txt}.`);
      }
      for (const x of bd.todas<{ ts: string; entidad_id: string; antes_json: string; despues_json: string }>("SELECT ts, entidad_id, antes_json, despues_json FROM auditoria WHERE entidad='parametro' AND ts > ? ORDER BY ts", [prev.generado_en]))
        cambios.push(`Parámetro ${x.entidad_id}: ${JSON.parse(x.antes_json ?? 'null')} → ${JSON.parse(x.despues_json ?? 'null')} (${x.ts.replace('T', ' ')}).`);
      for (const x of bd.todas<{ ts: string; despues_json: string }>("SELECT ts, despues_json FROM auditoria WHERE entidad='ejecucion' AND accion='APROBAR' AND ts > ?", [prev.generado_en]))
        cambios.push(`Propuesta del Super Agente aprobada por el usuario (${x.ts.replace('T', ' ')}): ${JSON.parse(x.despues_json).comentario}.`);
      if ((prev.aportes_usuario ?? '') !== aportes) cambios.push(aportes ? 'Se incorporaron o actualizaron los «Aportes del usuario».' : 'Se retiraron los «Aportes del usuario».');
      if (cambios.length === 0) cambios.push('Sin cambios en cifras, parámetros ni aportes respecto a la versión anterior (regeneración).');
    }
    return { version, cambios, fecha: ahoraLima() };
  },
  /** Guarda la versión del informe (contenido completo + huella SHA-256) con su control de cambios. */
  async guardarInforme(tipo: 'tecnico' | 'ejecutivo' | 'presentacion', version: number, fecha: string, cambios: string[], aportes: string, contenidoJson: string) {
    const hash = await sha256(new TextEncoder().encode(contenidoJson));
    const runs = [R.dv, R.gv, R.pv, R.dk, R.gk, R.pk, R.pr, R.sm].filter(Boolean).map((r) => ({ skill: r!.skill, run_id: r!.run_id, status: r!.status }));
    bd.run('INSERT INTO informe (tipo, version, generado_en, cambios, aportes_usuario, runs_json, contenido_json, hash) VALUES (?,?,?,?,?,?,?,?)',
      [tipo, version, fecha, cambios.join('\n'), aportes, JSON.stringify(runs), contenidoJson, hash]);
    auditar(bd, 'informe', `${tipo} v${version}`, 'INSERT', null, { hash: hash.slice(0, 16), cambios: cambios.length });
    registrarUso(bd, `Generar ${tipo === 'presentacion' ? 'presentación' : `informe ${tipo}`} v${version}`, 'Informes y presentación', `${cambios.length} cambios · hash ${hash.slice(0, 12)}`, Date.now());
    return hash;
  },
  informes: () => bd.todas('SELECT id, tipo, version, generado_en, cambios, aportes_usuario, hash, length(contenido_json) bytes FROM informe ORDER BY tipo, version DESC'),
  informeContenido: (tipo: string, version: number) => bd.una<{ contenido_json: string; cambios: string; aportes_usuario: string; generado_en: string; hash: string; runs_json: string }>(
    'SELECT contenido_json, cambios, aportes_usuario, generado_en, hash, runs_json FROM informe WHERE tipo=? AND version=?', [tipo, version]),
  resultados: () => R,
  resumenResultados,
  simular(op: OpcionesSim) {
    if (!R.pr) throw new Error('Ejecute primero el análisis completo (el Monte Carlo usa las políticas del prescriptivo).');
    R.sm = simularEscenarios(bd, R.pr.result, idDe('kardex'), idDe('ventas'), op);
    guardarR();
    return R.sm;
  },
  aprobar(comentario: string) {
    const runs = [R.dv, R.gv, R.pv, R.dk, R.gk, R.pk, R.pr, R.sm].filter(Boolean) as ResultadoSkill<unknown>[];
    for (const r of runs) { bd.run("UPDATE ejecucion SET estado_flujo='APROBADO' WHERE run_id=?", [r.run_id]); r.estado_flujo = 'APROBADO'; }
    auditar(bd, 'ejecucion', runs.map((r) => r.run_id.slice(0, 8)).join(','), 'APROBAR', null, { comentario });
    guardarR();
    registrarUso(bd, 'Aprobar propuesta del Super Agente', 'Prescriptivo', comentario, Date.now());
    return runs.length;
  },
  parametros: () => bd.todas('SELECT clave, valor, unidad, es_supuesto, descripcion, actualizado_en FROM parametro ORDER BY clave'),
  guardarParametro(clave: string, valor: string) {
    const antes = bd.valor<string>('SELECT valor FROM parametro WHERE clave=?', [clave]);
    if (!isFinite(Number(valor))) throw new Error('El valor debe ser numérico.');
    bd.run("UPDATE parametro SET valor=?, actualizado_en=strftime('%Y-%m-%dT%H:%M:%S','now','localtime') WHERE clave=?", [valor, clave]);
    auditar(bd, 'parametro', clave, 'UPDATE', antes, valor);
    registrarUso(bd, `Editar parámetro ${clave}`, 'Configuración', `${antes} → ${valor}`, Date.now());
    invalidar();
    return true;
  },
  configuracion: () => Object.fromEntries(bd.todas<{ clave: string; valor: string }>('SELECT clave, valor FROM configuracion').map((x) => [x.clave, x.valor])),
  guardarConfiguracion(clave: string, valor: string) { bd.run('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?,?)', [clave, valor]); return true; },
  bitacora: () => bd.todas('SELECT id, ts_inicio, ts_fin, duracion_ms, pantalla, accion, detalle FROM bitacora_uso ORDER BY id'),
  registrarUso(accion: string, pantalla: string, detalle: string, inicioMs: number) { registrarUso(bd, accion, pantalla, detalle, inicioMs); return true; },
  alertas: () => bd.todas(`SELECT a.tipo, a.severidad, a.entidad, a.mensaje, a.creada_en FROM alerta a WHERE a.run_id = (SELECT run_id FROM alerta ORDER BY id DESC LIMIT 1)
     ORDER BY CASE a.severidad WHEN 'ALTA' THEN 1 ELSE 2 END, a.tipo`),
  ejecuciones: () => bd.todas('SELECT run_id, skill, skill_version, dataset_id, cutoff, status, estado_flujo, inicio, fin FROM ejecucion ORDER BY inicio DESC LIMIT 50'),
  consulta(sql: string, params: never[] = []) {
    if (!/^\s*select/i.test(sql)) throw new Error('Solo se permiten consultas de lectura (SELECT).');
    return bd.todas(sql, params);
  },
  exportarBD: () => bd.exportar(),
  async abrirBD(bytes: Uint8Array) {
    const nueva = await BaseDatos.abrir(bytes, wasm);
    if (!nueva.existeTabla('dataset')) throw new Error('El archivo no es una base de datos del sistema.');
    bd = nueva; asegurarParametros(bd); cargarR();
    registrarUso(bd, 'Abrir base de datos', 'Configuración', `${bd.valor<number>('SELECT count(*) FROM dataset')} datasets`, Date.now());
    return info();
  },
  async nuevaBD() { bd = await BaseDatos.abrir(undefined, wasm); asegurarParametros(bd); R = {}; ultimoArchivo.clear(); return info(); },
};

function info() {
  return {
    tablas: bd.valor<number>("SELECT count(*) FROM sqlite_master WHERE type='table'"),
    datasets: bd.todas('SELECT id, nombre, tipo, archivo, filas_validas, fecha_min, fecha_max, ultimo_mes_cerrado, estado, cargado_en FROM dataset ORDER BY id'),
    hayResultados: !!R.generadoEn, desactualizado: !!R.desactualizado,
  };
}

function resumenResultados() {
  const est = (r?: ResultadoSkill<unknown>) => (r ? { run_id: r.run_id, skill: r.skill, status: r.status, estado_flujo: r.estado_flujo, warnings: r.warnings } : null);
  return { generadoEn: R.generadoEn, desactualizado: R.desactualizado, skills: [est(R.dv), est(R.gv), est(R.pv), est(R.dk), est(R.gk), est(R.pk), est(R.pr), est(R.sm)].filter(Boolean) };
}

ctx.onmessage = async (ev: MessageEvent<{ id: number; metodo: string; args: unknown[] }>) => {
  const { id, metodo, args } = ev.data;
  try {
    const fn = metodos[metodo];
    if (!fn) throw new Error(`Método desconocido: ${metodo}`);
    const resultado = await (fn as (...a: unknown[]) => unknown)(...(args ?? []));
    ctx.postMessage({ id, ok: true, resultado });
  } catch (e) {
    ctx.postMessage({ id, ok: false, error: (e as Error).message ?? String(e) });
  }
};
