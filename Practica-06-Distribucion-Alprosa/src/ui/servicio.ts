// Servicio de aplicación: une SQLite, reglas y almacenamiento. Única puerta de escritura de la interfaz.
// Cada operación que cambia datos se confirma en SQLite y luego se persiste (RN-25).
// @ts-expect-error módulo CommonJS sin tipos propios (WASM embebido para funcionar bajo file://)
import initSqlJsInline from 'sql.js/dist/sql-wasm-inline.js';
import type { SqlJsStatic } from 'sql.js';
import { Repo } from '../core/db';
import { validarConjunto, type ErrorCarga } from '../core/contrato';
import { confirmarCarga, cargaPrevia } from '../core/carga';
import * as D from '../core/dominio';
import * as P from '../core/permisos';
import * as T from '../core/transporte';
import * as S from '../core/sesion';
import * as O from '../core/operacion';
import * as C from '../core/costos';
import * as A from '../core/alertas';
import * as R from '../core/retornables';
import * as K from '../core/kpi';
import * as F from '../core/pronostico';
import * as G from '../core/diagnostico';
import * as M from '../core/simulacion';
import * as E from '../core/economia';
import * as Q from '../core/continuidad';
import * as L from '../core/libros';
import * as RC from '../core/recorrido';
import { aHojas, DATASET_DEMO_ID } from '../core/demo';
import { tablasExcel06 } from '../core/historia';
import { leerExcel, generarPlantilla } from '../core/excel';
import { exportarXlsx, exportarDocx, exportarPptx, exportarLibro, ExportacionCancelada, type Snapshot } from '../core/exportar';
export interface OpcionesExportacion { filtros?: K.Filtros; textoFiltros?: string; pronostico?: string | null; simulacion?: string | null; evaluacion?: string | null }
import { crearAlmacen, descargar, type Almacen, type ResultadoGuardado } from '../platform/almacen';
import { sha256Hex, ahoraLima, nuevoId } from '../core/util';

declare const __BUILD_TIME__: string;
export const BUILD = `0.9.0-RC4-${__BUILD_TIME__}`;
export const MIME = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const sello = () => ahoraLima().slice(0, 16).replace('T', '_').replace(':', '');

export class Servicio {
  sql!: SqlJsStatic; repo!: Repo; almacen!: Almacen; ultimoGuardado?: ResultadoGuardado; errorInicio?: string; migracion?: string;

  async iniciar() {
    this.sql = await (initSqlJsInline as (o?: object) => Promise<SqlJsStatic>)();
    this.almacen = await crearAlmacen();
    const bytes = await this.almacen.cargar().catch(() => null);
    try {
      const db = bytes ? new this.sql.Database(bytes) : new this.sql.Database();
      const vAntes = bytes ? Number(new Repo(db).uno("SELECT valor FROM meta WHERE clave='schema_version'")?.valor ?? 0) : 0;
      if (bytes && vAntes > 0 && vAntes < 7) await this.almacen.guardar(bytes, `copia previa a migración v${vAntes}→v7`);
      this.repo = Repo.iniciar(db);
      if (bytes && vAntes > 0 && vAntes < 7) { this.migracion = `Se actualizó la base de la versión ${vAntes} a la 7 con copia previa; revise los datos pendientes en Datos → Diagnóstico.`; await this.persistir('migración de esquema'); }
    } catch (e) {
      this.errorInicio = 'No se pudo abrir la base guardada: ' + (e as Error).message + ' Se inició una base vacía; la copia anterior sigue en las copias automáticas.';
      this.repo = Repo.iniciar(new this.sql.Database());
    }
    P.asegurarUsuarios(this.repo);
    this.repo.transaccion(() => { D.asegurarParametros(this.repo); S.asegurarCredenciales(this.repo); if (this.hayDatos()) { E.asegurarSupuestos(this.repo); M.asegurarModeloBase(this.repo); } });
    return this;
  }

  fallosCopia = 0; ultimaCopiaVerificada: string | null = null;
  private async persistir(motivo: string) {
    let g: ResultadoGuardado;
    try { g = await this.almacen.guardar(this.repo.exportar(), motivo); } catch (e) { g = { guardado: false, respaldo: 'PENDIENTE', detalle: 'No se pudo guardar: ' + (e as Error).message }; }
    this.ultimoGuardado = g;
    if (g.guardado && g.respaldo === 'VERIFICADO') { this.fallosCopia = 0; this.ultimaCopiaVerificada = ahoraLima(); }
    else if (!g.conflicto) { this.fallosCopia++; Q.registrarEvento(this.repo, { nivel: 'ERROR', etapa: 'PERSISTENCIA', codigo: g.guardado ? 'COPIA_PENDIENTE' : 'GUARDADO_FALLIDO', mensaje: g.detalle }); }
    return g;
  }
  salud() { return Q.salud(this.repo, { persistente: this.almacen.persistente, ultimoGuardado: this.ultimoGuardado, fallosCopia: this.fallosCopia, ultimaCopiaVerificada: this.ultimaCopiaVerificada, bytes: this.repo.exportar().byteLength }); }
  /** Abre la copia en un espacio aislado (migrándola en memoria si es antigua) y devuelve qué cambiaría, sin tocar la base activa. */
  previsualizarRestauracion(buf: ArrayBuffer) {
    const t0 = performance.now();
    try {
      const candidata = Repo.iniciar(new this.sql.Database(new Uint8Array(buf)));
      const ok = candidata.uno('PRAGMA integrity_check');
      if (!ok || ok.integrity_check !== 'ok') throw new Error('Integridad dañada.');
      if (candidata.todos('PRAGMA foreign_key_check').length) throw new Error('Referencias huérfanas.');
      return { ok: true as const, candidata, vista: Q.vistaPreviaRestauracion(this.repo, candidata), ms: performance.now() - t0, hash: sha256Hex(new Uint8Array(buf)) };
    } catch (e) {
      return { ok: false as const, detalle: 'Copia rechazada; los datos actuales no cambiaron. ' + (e as Error).message, ms: performance.now() - t0, hash: sha256Hex(new Uint8Array(buf)) };
    }
  }
  /** BD09/BD10: ensayo sin reemplazar nada; se registra duración y antigüedad contra las metas. */
  async ensayarRestauracion(usuario: string, buf: ArrayBuffer) {
    P.exigir(this.repo, usuario, 'RESPALDAR');
    const p = this.previsualizarRestauracion(buf);
    const r = Q.registrarEnsayo(this.repo, usuario, { hash: p.hash, ok: p.ok, duracion_ms: p.ms, corteCopia: p.ok ? p.vista.corteCopia : null, detalle: p.ok ? `Conteos: ${p.vista.filas.map((f) => `${f.tabla} ${f.copia}`).join(', ')}` : p.detalle });
    await this.persistir('ensayo de restauración');
    return { ...r, ok: p.ok, ms: p.ms, detalle: p.ok ? '' : p.detalle };
  }
  descargarPortable(usuario: string) {
    P.exigir(this.repo, usuario, 'RESPALDAR');
    const r = Q.exportacionPortable(this.repo, BUILD);
    descargar(`Exportacion_Portable_${sello()}.json`, r.texto, 'application/json');
    return r;
  }
  descargarAnonimizada(usuario: string) {
    P.exigir(this.repo, usuario, 'RESPALDAR');
    const copia = Repo.iniciar(new this.sql.Database(this.repo.exportar()));
    Q.anonimizar(copia);
    const b = copia.exportar();
    descargar(`Copia_Soporte_Anonimizada_${sello()}.sqlite`, b.slice().buffer as ArrayBuffer, 'application/vnd.sqlite3');
    return { hash: sha256Hex(b) };
  }
  descargarDiagnostico() { descargar(`Paquete_Diagnostico_${sello()}.json`, Q.paqueteDiagnostico(this.repo, BUILD, this.salud()), 'application/json'); }
  /** Ejecuta una operación de dominio y persiste solo si se confirmó. */
  async op<T>(motivo: string, fn: () => T): Promise<T> {
    const r = fn();
    const g = await this.persistir(motivo);
    if (g.conflicto) {
      // AG03/BB03: otra pestaña guardó antes. Se descarta el cambio en memoria y se recargan los datos actuales: no gana el último en silencio.
      await this.recargarDesdeAlmacen();
      throw new Error('Conflicto: otra pestaña guardó cambios antes que esta. Su operación NO se aplicó; la pantalla ya muestra los datos actuales. Revise y repítala si sigue siendo válida.');
    }
    return r;
  }
  async recargarDesdeAlmacen() {
    const bytes = await this.almacen.cargar();
    if (bytes) this.repo = Repo.iniciar(new this.sql.Database(bytes));
  }

  meta(clave: string) { return this.repo.uno('SELECT valor FROM meta WHERE clave = ?', [clave])?.valor as string | undefined; }
  hayDatos() { return this.repo.num('SELECT COUNT(*) FROM producto') > 0; }
  usuarios() {
    return this.repo.todos('SELECT * FROM usuario WHERE usuario_id <> ? ORDER BY usuario_id', ['LEGADO']).map((u) => ({
      usuario_id: String(u.usuario_id), nombre_ficticio: String(u.nombre_ficticio), activo: Number(u.activo), compartida: Number(u.compartida),
      desactivado_en: u.desactivado_en as string | null, motivo_desactivacion: u.motivo_desactivacion as string | null, roles: P.rolesVigentes(this.repo, String(u.usuario_id)) }));
  }
  puede(usuario: string, accion: P.Accion) { return P.puede(this.repo, usuario, accion); }

  puedeRecorrer() { return RC.puedeRecorrer(this.repo); }
  async recorridoDemostracion(usuario: string) { return this.op('recorrido operativo de demostración', () => this.repo.transaccion(() => RC.recorridoDemostracion(this.repo, usuario))); }
  async cargarDemostracion(usuario: string) {
    const t = tablasExcel06();
    const hash = sha256Hex(new TextEncoder().encode(JSON.stringify(t)));
    return this.cargarHojas(aHojas(t), { hash, nombre: 'Demostración NutriDemo (recurso empaquetado)', bytes: 0, datasetId: DATASET_DEMO_ID }, usuario);
  }
  async cargarArchivo(nombre: string, buf: ArrayBuffer, usuario: string) {
    const hash = sha256Hex(new Uint8Array(buf)); // huella ANTES de leer
    const previa = cargaPrevia(this.repo, hash);
    if (previa) return { estado: 'YA_CARGADO' as const, errores: [] as ErrorCarga[], advertencias: [] as string[], hash, detalle: `Archivo ya cargado el ${previa.registrado_en}; no se duplicó nada.` };
    let hojas;
    try { hojas = await leerExcel(buf); } catch (e) {
      return { estado: 'RECHAZADO' as const, hash, advertencias: [], detalle: 'No es un libro Excel válido.', errores: [{ hoja: '', celda: '', fila: '' as const, columna: '', valor: nombre, mensaje: 'No se pudo leer como .xlsx: ' + (e as Error).message }] };
    }
    // El conjunto se identifica por lo que DECLARA su LEEME (empresa sintética NutriDemo + versión de contrato), no por el nombre del archivo
    const dec = new Map((hojas.find((h) => h.nombre === 'LEEME')?.filas ?? []).map((f) => { const v = Object.entries(f.celdas); const k = v.find(([c]) => /secci/i.test(c))?.[1]?.valor ?? v[0]?.[1]?.valor; const d = v.find(([c]) => /descrip/i.test(c))?.[1]?.valor ?? v[1]?.[1]?.valor; return [String(k ?? '').trim(), String(d ?? '').trim()]; }));
    const esDemo = /NutriDemo/i.test(dec.get('Empresa') ?? '') && /SINT[ÉE]TICOS/i.test(dec.get('Empresa') ?? '');
    const datasetId = esDemo ? `NUTRIDEMO-ARCHIVO-${dec.get('Versión de contrato') || 'sin-version'}-${hash.slice(0, 12)}` : 'IMPORTADO-' + hash.slice(0, 12);
    return this.cargarHojas(hojas, { hash, nombre, bytes: buf.byteLength, datasetId }, usuario, true);
  }
  private async cargarHojas(hojas: Parameters<typeof validarConjunto>[0], info: { hash: string; nombre: string; bytes: number; datasetId: string }, usuario: string, externo = false) {
    P.exigir(this.repo, usuario, 'CARGAR_DATOS');
    const { errores, advertencias, datos } = validarConjunto(hojas, { exigirLeeme: externo });
    if (errores.length) return { estado: 'RECHAZADO' as const, errores, advertencias, hash: info.hash, detalle: `${errores.length} error(es). No se confirmó ningún registro.` };
    if (this.hayDatos()) await this.persistir('copia previa a reemplazo de datos');
    try { confirmarCarga(this.repo, usuario, datos, info); this.repo.transaccion(() => { S.asegurarCredenciales(this.repo); E.asegurarSupuestos(this.repo); M.asegurarModeloBase(this.repo); }); if (this.repo.num('SELECT COUNT(*) FROM hist_pedido')) G.sembrarCadenaDemo(this.repo, K.cargarHechos(this.repo), 'U06'); }
    catch (e) { return { estado: 'RECHAZADO' as const, errores: [{ hoja: '', celda: '', fila: '' as const, columna: '', valor: '', mensaje: (e as Error).message }], advertencias, hash: info.hash, detalle: 'No se confirmó ningún registro.' }; }
    const g = await this.persistir('carga confirmada');
    return { estado: 'CONFIRMADO' as const, errores: [], advertencias, hash: info.hash, detalle: 'Carga confirmada. ' + g.detalle };
  }

  existencias() { return D.existencias(this.repo); }
  pedidos() { return D.pedidos(this.repo); }

  /** Fotografía coherente para exportar: se toma COMPLETA al pulsar el botón; cambiar filtros después no la altera (AK05). */
  snapshot(o: OpcionesExportacion = {}): Snapshot {
    const repo = this.repo;
    const s: Snapshot = { runId: nuevoId('RUN'), generadoEn: ahoraLima(), datasetId: this.meta('dataset_id') ?? '(sin datos)', datasetHash: this.meta('dataset_hash') ?? '(sin datos)',
      build: BUILD, modalidad: this.almacen.modalidad, existencias: this.existencias(), pedidos: this.pedidos() };
    if (o.filtros && this.hayDatos()) {
      const f = { ...o.filtros };
      const hechos = K.cargarHechos(repo);
      const pa = K.pareto(hechos, f);
      s.analitica = { vista: f.vista ?? 'REEXPRESADA', conocidoHasta: f.vista === 'ORIGINAL' ? f.corte ?? null : null, desde: f.desde, hasta: f.hasta, filtros: o.textoFiltros ?? 'sin filtros',
        indicadores: K.indicadores(hechos, f), serie: K.serieOTIF(hechos, { ...f, granularidad: f.granularidad ?? 'mes' }).map((x) => ({ periodo: x.periodo, num: x.num, den: x.den, otif: x.otif, fill: x.fill })),
        pareto: { n: pa.n, filas: pa.filas.map((x) => ({ causa: x.causa, n: x.n, pct: x.pct, acumulado: x.acumulado })) },
        causas: G.analisis(repo).map((x) => ({ analisis_id: String(x.analisis_id), hipotesis: String(x.causa_candidata), estado: String(x.estado), evidencias: x.evidencias.length })) };
    }
    if (o.pronostico) {
      const c = repo.uno('SELECT * FROM corrida_pronostico WHERE corrida_id = ?', [o.pronostico]);
      if (c) s.pronostico = { corrida_id: String(c.corrida_id), serie: String(c.serie), corte: String(c.corte), metodo: c.metodo_elegido as string | null, metricas: JSON.parse(String(c.metricas)), prediccion: JSON.parse(String(c.prediccion)) };
    }
    if (o.simulacion) {
      const c = M.corridaSim(repo, o.simulacion);
      if (c && c.resultado) s.simulacion = { run_id: String(c.run_id), modelo: `${c.modelo_id} v${c.modelo_version}`, parametros: c.parametros, resultado: c.resultado, creada_en: String(c.creada_en) };
    }
    if (o.evaluacion) { const ev = E.evaluacionGuardada(repo, o.evaluacion); if (ev) s.evaluacion = { run_id: o.evaluacion, ev, creada_en: '' }; }
    s.itinerarios = repo.todos(`SELECT i.pedido_id, i.itinerario_id, i.estado, e.tramo, e.viaje, en.modo_id modo, e.nodo_origen_id origen, e.nodo_destino_id destino, e.servicio_id, e.kg_bruto_mil, e.estado etapa_estado, e.final
      FROM etapa e JOIN itinerario i USING (itinerario_id) JOIN servicio sv ON sv.servicio_id = e.servicio_id JOIN enlace en ON en.enlace_id = sv.enlace_id ORDER BY i.pedido_id, i.version, e.tramo, e.viaje`)
      .map((r) => ({ pedido_id: String(r.pedido_id), itinerario_id: String(r.itinerario_id), estado: String(r.estado), tramo: Number(r.tramo), viaje: Number(r.viaje), modo: String(r.modo), origen: String(r.origen), destino: String(r.destino), servicio_id: String(r.servicio_id), kg: Number(r.kg_bruto_mil) / 1000, etapa_estado: String(r.etapa_estado), final: r.final === 1 }));
    s.aceptado = repo.todos(`SELECT p.pedido_id, SUM((pl.q_solicitada_mil - pl.q_cancelada_mil) * pr.peso_kg_por_unidad_mil) / 1e6 sol,
        COALESCE((SELECT SUM(ed.aceptado_mil * pr2.peso_kg_por_unidad_mil) FROM entrega_detalle ed JOIN pedido_linea pl2 USING (pedido_linea_id) JOIN producto pr2 ON pr2.producto_id = pl2.producto_id WHERE pl2.pedido_id = p.pedido_id), 0) / 1e6 acep
      FROM pedido p JOIN pedido_linea pl USING (pedido_id) JOIN producto pr USING (producto_id) GROUP BY p.pedido_id ORDER BY p.pedido_id`).map((r) => ({ pedido_id: String(r.pedido_id), solicitado_kg: Number(r.sol), aceptado_kg: Number(r.acep) }));
    s.costos = repo.todos("SELECT DISTINCT servicio_id FROM etapa WHERE estado <> 'CANCELADA' ORDER BY 1").map((x) => {
      const im = T.imputacionServicio(repo, String(x.servicio_id));
      const sv = repo.uno('SELECT tarifa_fija_cent FROM servicio WHERE servicio_id = ?', [x.servicio_id])!;
      const ped = (et: string) => String(repo.uno('SELECT i.pedido_id FROM etapa e JOIN itinerario i USING (itinerario_id) WHERE etapa_id = ?', [et])?.pedido_id ?? '');
      const fijo = Number(sv.tarifa_fija_cent);
      return { servicio_id: im.servicio_id, fijo_cent: fijo, total_cent: fijo + im.lineas.reduce((a, l) => a + l.variable_cent, 0), no_asignado_cent: fijo - im.fijo_cent,
        lineas: im.lineas.map((l) => ({ etapa_id: l.etapa_id, pedido_id: ped(l.etapa_id), kg: l.kg_mil / 1000, fijo_cent: l.fijo_cent, variable_cent: l.variable_cent })) };
    });
    s.recomendaciones = repo.todos('SELECT regla, entidad_id, estado, valores, alternativa FROM recomendacion ORDER BY creada_en DESC').map((r) => ({ regla: String(r.regla), entidad_id: String(r.entidad_id), estado: String(r.estado), valores: String(r.valores), alternativa: String(r.alternativa) }));
    return s;
  }
  // ------------------------------------------------------------------ Libros 07/08/09 (I09 los genera con el sistema congelado)
  async exportarLibroN(usuario: string, n: '07' | '08' | '09', o: OpcionesExportacion, ctl?: { progreso?: (t: string, i: number, n: number) => void; cancelado?: () => boolean }) {
    P.exigir(this.repo, usuario, 'EXPORTAR');
    if (n === '08' && !o.filtros) throw new Error('Elija el período y la vista (paso 1).');
    // El libro de resultados del sistema es global (toda la operación); sus metadatos lo dicen y no muestran filtros que no aplica.
    const s = this.snapshot(n === '07' ? {} : n === '08' ? { filtros: o.filtros, textoFiltros: o.textoFiltros, pronostico: o.pronostico } : { filtros: o.filtros, textoFiltros: o.textoFiltros, simulacion: o.simulacion, evaluacion: o.evaluacion });
    const hojas = n === '07' ? L.hojas07(this.repo) : n === '08' ? L.hojas08(this.repo, { filtros: o.filtros!, pronostico: o.pronostico }) : L.hojas09(this.repo, o.simulacion ?? null, o.evaluacion ?? null);
    let i = 0;
    const control = { paso: async (t: string) => { if (ctl?.cancelado?.()) throw new ExportacionCancelada(); ctl?.progreso?.(t, ++i, hojas.length + 2); await new Promise((r) => setTimeout(r, 0)); } };
    const titulos = { '07': '07 — Resultados del sistema (operación registrada)', '08': '08 — Resultados de la analítica (descriptiva, diagnóstica, predictiva y prescriptiva)', '09': '09 — Proyecciones y alternativas de mejora' };
    const nombres = { '07': '07_Resultados_Sistema.xlsx', '08': '08_Resultados_Analitica.xlsx', '09': '09_Proyecciones_Alternativas_Mejora.xlsx' };
    try {
      const alcance = n === '07' ? { texto: 'Toda la operación registrada en el sistema al momento de generar (no aplica período, vista ni corridas).', incluir: [] }
        : n === '08' ? { texto: `Período, vista y pronóstico elegidos en Resultados. ${o.textoFiltros ?? ''}`, incluir: ['Vista de la analítica', 'Rango analizado', 'Filtros', 'Corrida de pronóstico'] }
        : { texto: `Simulación y evaluación económica elegidas en Resultados; intervalo proyectado: ${s.evaluacion ? `${s.evaluacion.ev.demanda.meses[0]?.mes ?? '—'} a ${s.evaluacion.ev.demanda.meses.at(-1)?.mes ?? '—'}` : 'sin evaluación'}.`, incluir: ['Rango analizado', 'Corrida de simulación', 'Evaluación económica'] };
      const b = await exportarLibro(titulos[n], s, hojas, control, alcance);
      if (ctl?.cancelado?.()) throw new ExportacionCancelada();
      descargar(nombres[n], b, MIME.xlsx);
      Q.registrarEvento(this.repo, { nivel: 'INFO', etapa: 'EXPORTACION', codigo: 'LIBRO_' + n, mensaje: nombres[n] + ' generado', run_id: s.runId });
      return { nombre: nombres[n], runId: s.runId, hojas: hojas.length };
    } catch (e) {
      Q.registrarEvento(this.repo, { nivel: e instanceof ExportacionCancelada ? 'INFO' : 'ERROR', etapa: 'EXPORTACION', codigo: 'LIBRO_' + n + (e instanceof ExportacionCancelada ? '_CANCELADO' : '_FALLIDO'), mensaje: (e as Error).message, run_id: s.runId });
      throw e;
    }
  }
  /** Exporta con avance y cancelación: un archivo incompleto NUNCA se descarga (N08, AK06). */
  async exportar(usuario: string, tipo: 'xlsx' | 'docx' | 'pptx', logoPng?: Uint8Array, o: OpcionesExportacion = {}, ctl?: { progreso?: (t: string, i: number, n: number) => void; cancelado?: () => boolean }) {
    P.exigir(this.repo, usuario, 'EXPORTAR');
    const s = this.snapshot(o), st = sello();
    const total = tipo === 'xlsx' ? 13 : tipo === 'docx' ? 7 : 8;
    let i = 0;
    const control = { paso: async (t: string) => { if (ctl?.cancelado?.()) throw new ExportacionCancelada(); ctl?.progreso?.(t, ++i, total); await new Promise((r) => setTimeout(r, 0)); } };
    const etiqueta = s.analitica ? (s.analitica.vista === 'ORIGINAL' ? '_ORIGINAL' : '_REEXPRESADA') : '';
    let datos: Blob | ArrayBuffer | Uint8Array, nombre: string, mime: string;
    try {
      if (tipo === 'xlsx') { datos = await exportarXlsx(s, control); nombre = `Resultados_Distribucion${etiqueta}_${st}.xlsx`; mime = MIME.xlsx; }
      else if (tipo === 'docx') { datos = await exportarDocx(s, logoPng, control); nombre = `Informe_Tecnico_Distribucion${etiqueta}_${st}.docx`; mime = MIME.docx; }
      else { datos = await exportarPptx(s, logoPng, control); nombre = `Presentacion_Ejecutiva_Distribucion${etiqueta}_${st}.pptx`; mime = MIME.pptx; }
    } catch (e) {
      // BH01: se registra la etapa y el RUN-ID; no se descarga nada y la última exportación válida no cambia
      Q.registrarEvento(this.repo, { nivel: e instanceof ExportacionCancelada ? 'INFO' : 'ERROR', etapa: 'EXPORTACION', codigo: e instanceof ExportacionCancelada ? 'EXPORTACION_CANCELADA' : 'EXPORTACION_FALLIDA', mensaje: `${tipo}: ${(e as Error).message}`, run_id: s.runId });
      throw e;
    }
    if (ctl?.cancelado?.()) throw new ExportacionCancelada();
    descargar(nombre, datos as Blob, mime);
    Q.registrarEvento(this.repo, { nivel: 'INFO', etapa: 'EXPORTACION', codigo: 'EXPORTACION_OK_' + tipo.toUpperCase(), mensaje: `${nombre} generado`, run_id: s.runId });
    return { runId: s.runId, nombre };
  }
  descargar(nombre: string, datos: ArrayBuffer, mime: string) { descargar(nombre, datos, mime); }
  async plantilla() { descargar('Plantilla_Carga_Distribucion.xlsx', await generarPlantilla(), MIME.xlsx); }

  respaldar(usuario: string) {
    P.exigir(this.repo, usuario, 'RESPALDAR');
    const bytes = this.repo.exportar();
    const nombre = `Respaldo_Distribucion_${sello()}.sqlite`;
    descargar(nombre, bytes.slice().buffer as ArrayBuffer, 'application/vnd.sqlite3');
    return { nombre, hash: sha256Hex(bytes) };
  }
  async restaurar(usuario: string, buf: ArrayBuffer, motivo = 'Restauración') {
    P.exigir(this.repo, usuario, 'RESPALDAR');
    Q.registrarEvento(this.repo, { nivel: 'AVISO', etapa: 'RESTAURACION', codigo: 'RESTAURACION_SOLICITADA', mensaje: `Restauración solicitada por ${usuario}: ${motivo}` });
    let candidata: Repo;
    try {
      candidata = Repo.iniciar(new this.sql.Database(new Uint8Array(buf)));
      const ok = candidata.uno('PRAGMA integrity_check');
      if (!ok || ok.integrity_check !== 'ok') throw new Error('Integridad dañada.');
      if (candidata.todos('PRAGMA foreign_key_check').length) throw new Error('Referencias huérfanas.');
    } catch (e) {
      return { ok: false, detalle: 'Respaldo rechazado; los datos actuales no cambiaron. ' + (e as Error).message };
    }
    await this.persistir('copia previa a restauración');
    this.repo = candidata;
    P.asegurarUsuarios(this.repo);
    this.repo.transaccion(() => S.asegurarCredenciales(this.repo));
    const g = await this.persistir('restauración');
    return { ok: true, detalle: 'Restauración completa. ' + g.detalle };
  }
  /** Clima: reutiliza la lectura guardada si sigue vigente; si no, consulta (solo EXE) y la guarda. */
  async clima(referencia: string, lat: number, lon: number, forzar = false) {
    const prev = T.ultimaLecturaVigente(this.repo, referencia);
    if (prev && !forzar) return { reutilizada: true, lectura: prev };
    if (!this.almacen.clima) throw new Error('La consulta de clima solo está disponible en el EXE con internet.');
    const r = await this.almacen.clima(lat, lon);
    if (!r.ok) throw new Error(r.texto);
    await this.op('lectura de clima', () => T.guardarLecturaClima(this.repo, { referencia, latitud: lat, longitud: lon, ok: true, texto: r.texto, observado_en: r.observado ? r.observado + ':00-05:00' : null, temperatura_c: r.temperatura ?? null, precipitacion_mm: r.precipitacion ?? null, lluvia_hoy_mm: r.lluvia_hoy ?? null, prob_lluvia_pct: r.prob_lluvia ?? null, viento_kmh: r.viento ?? null }));
    return { reutilizada: false, lectura: T.ultimaLecturaVigente(this.repo, referencia)! };
  }
  async ingresar(usuarioId: string, pin: string) { const r = S.iniciarSesion(this.repo, usuarioId, pin); await this.persistir(r.ok ? 'inicio de sesión' : 'intento de ingreso fallido'); return r; }
  rolesDe(usuarioId: string) { return P.rolesVigentes(this.repo, usuarioId); }
  ve(usuarioId: string | null, v: S.Vista) { return !!usuarioId && S.puedeVer(this.rolesDe(usuarioId), v); }
  ultimaLecturaClima() { return this.repo.uno("SELECT * FROM lectura_clima WHERE resultado='OK' ORDER BY consultado_en DESC LIMIT 1"); }
}
export { D, P, T, S, O, C, A, R, K, F, G, M, E, Q };
