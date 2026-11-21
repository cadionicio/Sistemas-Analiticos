// I08 — Libros de entregables 07/08/09 generados por el sistema y recorrido operativo de demostración.
import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import ExcelJS from 'exceljs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Repo } from '../src/core/db';
import { validarConjunto } from '../src/core/contrato';
import { confirmarCarga } from '../src/core/carga';
import * as D from '../src/core/dominio';
import * as P from '../src/core/permisos';
import * as K from '../src/core/kpi';
import * as M from '../src/core/simulacion';
import * as E from '../src/core/economia';
import * as F from '../src/core/pronostico';
import * as G from '../src/core/diagnostico';
import * as X from '../src/core/exportar';
import * as L from '../src/core/libros';
import * as RC from '../src/core/recorrido';
import { aHojas } from '../src/core/demo';
import { tablasExcel06, HISTORIA_CORTE } from '../src/core/historia';

let SQL: SqlJsStatic, repo: Repo, rec: RC.ResultadoRecorrido;
const AHORA = '2026-11-14T10:00:00-05:00';
function nuevo() {
  const r = Repo.iniciar(new SQL.Database()); r.reloj = () => AHORA;
  P.asegurarUsuarios(r); r.transaccion(() => D.asegurarParametros(r));
  const { errores, datos } = validarConjunto(aHojas(tablasExcel06()));
  if (errores.length) throw new Error(JSON.stringify(errores.slice(0, 2)));
  confirmarCarga(r, 'U01', datos, { hash: 'h', nombre: '06', bytes: 0, datasetId: 'NUTRIDEMO-06' });
  r.run("INSERT OR REPLACE INTO meta (clave, valor) VALUES ('dataset_id', 'NUTRIDEMO-06')");
  r.transaccion(() => { E.asegurarSupuestos(r); M.asegurarModeloBase(r); });
  return r;
}
const snap = (r: Repo): X.Snapshot => ({ runId: 'RUN-I08', generadoEn: AHORA, datasetId: '06', datasetHash: 'h', build: 'test', modalidad: 'HTML', existencias: D.existencias(r), pedidos: D.pedidos(r) });
beforeAll(async () => { SQL = await initSqlJs(); repo = nuevo(); rec = RC.recorridoDemostracion(repo, 'U01'); });

describe('I08 — Recorrido operativo de demostración', () => {
  it('procesa 6 pedidos con el guion completo y deja la operación registrada', () => {
    expect(Object.values(rec.pedidos)).toEqual(['ENTREGA_COMPLETA', 'RECHAZO_PARCIAL', 'INCIDENCIA_RETRASO', 'ENTREGA_COMPLETA', 'EN_TRANSITO', 'SOLO_PLANIFICADO']);
    for (const t of ['entrega', 'retorno', 'incidencia', 'cargo_transporte', 'movimiento_activo', 'conteo', 'decision_calidad']) expect(repo.num(`SELECT COUNT(*) FROM ${t}`), t).toBeGreaterThan(0);
    expect(repo.num("SELECT COUNT(*) FROM evento_tecnico WHERE codigo = 'RECORRIDO_DEMO'")).toBe(1);
  });
  it('cada paso lo firma el rol que corresponde (no el administrador)', () => {
    const us = repo.todos("SELECT DISTINCT usuario_id u FROM movimiento WHERE tipo <> 'SALDO_APERTURA' AND usuario_id IS NOT NULL").map((x) => String(x.u));
    expect(us).not.toContain('U01');
  });
  it('solo con permiso de datos y una única vez (no sobre operación ya registrada)', () => {
    expect(() => RC.recorridoDemostracion(repo, 'U01')).toThrow(/Ya hay operación/);
    const r2 = nuevo(); expect(() => RC.recorridoDemostracion(r2, 'U06')).toThrow();
  });
});

describe('I08 — Libro 07 (resultados del sistema)', () => {
  let h: X.HojaLibro[], wb: ExcelJS.Workbook, buf: ArrayBuffer;
  beforeAll(async () => { h = L.hojas07(repo); buf = await X.exportarLibro('07', snap(repo), h); wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); });
  it('contiene las 14 hojas de operación con datos', () => {
    expect(h.map((x) => x.nombre)).toEqual(['Pedidos', 'Reservas', 'Flujos', 'Saldos', 'Conciliacion', 'Itinerarios', 'Etapas', 'Custodias', 'Entregas', 'Retornos', 'Incidencias', 'CostosTransporte', 'Retornables', 'CalidadConteos']);
    for (const x of h) expect(x.filas.length, x.nombre).toBeGreaterThan(0);
    for (const n of ['LEEME', 'Metadatos', 'Diccionario', 'Pedidos']) expect(wb.getWorksheet(n), n).toBeTruthy();
  });
  it('la conciliación movimientos ↔ saldo físico cuadra en todas las filas', () => {
    const c = h.find((x) => x.nombre === 'Conciliacion')!;
    expect(c.filas.every((f) => f.conciliado === 'sí')).toBe(true);
  });
  it('las cantidades salen en unidades de usuario (no milésimas) y la fila TOTAL es fórmula', () => {
    const ws = wb.getWorksheet('Pedidos')!;
    const cab = (ws.getRow(1).values as unknown[]).slice(1).map(String);
    expect(cab).toContain('solicitada'); expect(cab).not.toContain('solicitada_mil');
    const col = cab.indexOf('solicitada') + 1, ult = ws.rowCount;
    const tot = ws.getRow(ult).getCell(col).value as { formula: string; result: number };
    expect(tot.formula).toMatch(/^SUM\(/);
    const suma = D.pedidos(repo).flatMap((p) => p.lineas).reduce((a, l) => a + l.solicitada_mil, 0) / 1000;
    expect(tot.result).toBeCloseTo(suma, 6);
  });
});

describe('I08 — Libros 08 y 09', () => {
  it('08 trae las cuatro capas con datos y pronóstico para todos los productos', async () => {
    const h = L.hojas08(repo, { filtros: { desde: '2025-11-10T00:00:00-05:00', hasta: HISTORIA_CORTE } });
    for (const n of ['Indicadores', 'SerieSemanal', 'SerieMensual', 'Pareto', 'Concentracion', 'Pronostico_Metodos', 'Pronostico_Semanas', 'Recomendaciones']) expect(h.find((x) => x.nombre === n)?.filas.length, n).toBeGreaterThan(0);
    const prods = new Set(h.find((x) => x.nombre === 'Pronostico_Metodos')!.filas.map((f) => String(f.serie)));
    expect(prods.size).toBe(repo.num('SELECT COUNT(*) FROM producto WHERE activo = 1'));
    expect(h.find((x) => x.nombre === 'Indicadores')!.filas).toHaveLength(12);
  });
  it('09 sin corridas: hojas vacías con aviso, nunca cifras inventadas', async () => {
    const h = L.hojas09(repo, null, null);
    expect(h.every((x) => x.filas.length === 0)).toBe(true);
  });
  it('09 con simulación y evaluación guardadas: EVA del libro = EVA del motor', async () => {
    const pl = M.construirPlanes(repo); const sim = M.simular(pl.planes, pl.servicios, { ...M.PARAMETROS_DEFECTO, iteraciones: 200 });
    const mv = M.modeloVigente(repo, 'MOD-BASE')!; const simId = M.guardarCorridaSim(repo, 'U06', { modelo_id: String(mv.modelo_id), version: Number(mv.version), parametros: { ...M.PARAMETROS_DEFECTO, iteraciones: 200 } }, pl.planes, pl.servicios, { cancelada: false, hechas: 200, resultado: sim });
    const ev = E.evaluar(repo, K.cargarHechos(repo), { corte: HISTORIA_CORTE, sim, simRunId: String(simId) });
    const evId = E.guardarEvaluacion(repo, 'U06', ev);
    const h = L.hojas09(repo, String(simId), String(evId));
    for (const n of ['Demanda', 'Simulacion', 'SimulacionPedidos', 'Alternativas', 'EVA_Mensual', 'Comparador', 'Sensibilidad', 'Supuestos']) expect(h.find((x) => x.nombre === n)!.filas.length, n).toBeGreaterThan(0);
    expect(h.find((x) => x.nombre === 'Alternativas')!.filas[0].eva).toBeCloseTo(ev.escenarios[0].eva!, 6);
    expect(h.find((x) => x.nombre === 'Simulacion')!.filas).toHaveLength(3);
  });
});

describe('I08 — Recálculo real de los libros (LibreOffice)', () => {
  it('07 y 08: totales recalculados con valores alterados = valores del sistema, sin errores', async () => {
    const soffice = ['/usr/bin/soffice', '/usr/bin/libreoffice'].find((x) => fs.existsSync(x));
    if (!soffice) { console.warn('LibreOffice no disponible: PENDIENTE'); return; }
    for (const [n, h] of [['07', L.hojas07(repo)], ['08', L.hojas08(repo, { filtros: { desde: '2025-11-10T00:00:00-05:00', hasta: HISTORIA_CORTE } })]] as const) {
      const buf = await X.exportarLibro(n, snap(repo), h);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc08-'));
      fs.mkdirSync(path.join(dir, 'perfil', 'user'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'perfil', 'user', 'registrymodifications.xcu'), '<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item></oor:items>');
      const alt = new ExcelJS.Workbook(); await alt.xlsx.load(buf);
      alt.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => { const v = cell.value as { formula?: string }; if (v && typeof v === 'object' && 'formula' in v) cell.value = { formula: v.formula!, result: -123456 }; })));
      const ent = path.join(dir, 'e.xlsx'); await alt.xlsx.writeFile(ent); const out = path.join(dir, 'o'); fs.mkdirSync(out);
      execFileSync(soffice, ['--headless', `-env:UserInstallation=file://${dir}/perfil`, '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', out, ent], { timeout: 120000, stdio: 'ignore' });
      const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path.join(out, 'e.xlsx'));
      const orig = new ExcelJS.Workbook(); await orig.xlsx.load(buf);
      let f = 0;
      orig.eachSheet((ws) => ws.eachRow((row, r) => row.eachCell((cell, c) => {
        const v = cell.value as { formula?: string; result?: unknown }; if (!v || typeof v !== 'object' || !('formula' in v)) return; f++;
        const nv = wb.getWorksheet(ws.name)!.getRow(r).getCell(c).value as { result?: unknown } | number;
        const res = typeof nv === 'object' && nv !== null ? (nv as { result?: unknown }).result : nv;
        expect(String(res)).not.toMatch(/#(REF|DIV|VALUE|NAME|N\/A)/);
        if (typeof v.result === 'number') expect(Number(res), `${n}/${ws.name}!${r},${c}`).toBeCloseTo(v.result, 4);
      })));
      expect(f, n).toBeGreaterThanOrEqual(n === '07' ? 20 : 5);
    }
  }, 300000);
});

describe('Auditoría RC1 n.º 7, 8 y 9 — intervalos libres y libro 08 fiel a la selección', () => {
  it('EVA por intervalo libre de meses (3 meses desde un mes posterior) y rechazo de intervalos incoherentes', () => {
    const h = K.cargarHechos(repo);
    const primero = E.primerMesCompleto(HISTORIA_CORTE);
    const ev = E.evaluar(repo, h, { corte: HISTORIA_CORTE, desdeMes: E.sumarMeses(primero, 2), hastaMes: E.sumarMeses(primero, 4) });
    expect(ev.horizonte_meses).toBe(3);
    expect(ev.demanda.meses.map((m) => m.mes)).toEqual([E.sumarMeses(primero, 2), E.sumarMeses(primero, 3), E.sumarMeses(primero, 4)]);
    expect(ev.convencion).toMatch(/EVA DEL PERÍODO \(3 meses/);
    const largo = E.evaluar(repo, h, { corte: HISTORIA_CORTE, desdeMes: primero, hastaMes: E.sumarMeses(primero, 47) });
    expect(largo.horizonte_meses).toBe(48);
    expect(() => E.evaluar(repo, h, { corte: HISTORIA_CORTE, desdeMes: E.sumarMeses(primero, 3), hastaMes: primero })).toThrow(/anterior/);
  });
  it('08 aplica vista ORIGINAL y corte de conocimiento, incluye la corrida de pronóstico elegida y el contenido de las evidencias', () => {
    const h = K.cargarHechos(repo);
    const pr = F.pronosticar(repo, h, { producto: 'P01', corte: HISTORIA_CORTE, horizonte: 12 });
    const cid = F.guardarCorrida(repo, 'U06', pr);
    G.sembrarCadenaDemo(repo, h, 'U06');
    const libro = L.hojas08(repo, { filtros: { desde: '2026-08-03T00:00:00-05:00', hasta: HISTORIA_CORTE, vista: 'ORIGINAL', corte: '2026-10-01T00:00:00-05:00' }, pronostico: String(cid) });
    expect(libro.find((x) => x.nombre === 'Indicadores')!.descripcion).toMatch(/vista ORIGINAL \(conocido hasta 2026-10-01\)/);
    const el = libro.find((x) => x.nombre === 'Pronostico_Elegido')!;
    expect(el.filas).toHaveLength(12); expect(el.descripcion).toContain(String(cid));
    // La cadena causal se creó el 14/11 (después del corte 01/10): en la vista ORIGINAL no puede aparecer
    expect(libro.find((x) => x.nombre === 'CadenasCausales')!.filas).toHaveLength(0);
    expect(libro.find((x) => x.nombre === 'Evidencias')!.filas).toHaveLength(0);
    expect(libro.find((x) => x.nombre === 'PuenteVistas')!.descripcion).toMatch(/Mismo período elegido: informe emitido \(ORIGINAL al 2026-10-01\)/);
    // Corte posterior a la creación: aparece con lo conocido entonces; una evidencia registrada DESPUÉS del corte no aparece
    const id = String(repo.uno('SELECT analisis_id FROM causa_analisis')!.analisis_id);
    const reloj0 = repo.reloj; repo.reloj = () => '2026-11-16T09:00:00-05:00';
    G.agregarEvidencia(repo, 'U06', id, { sentido: 'EN_CONTRA', descripcion: 'Evidencia registrada después del corte', fuente: 'Prueba' });
    repo.reloj = reloj0;
    const alCorte = L.hojas08(repo, { filtros: { desde: '2026-08-03T00:00:00-05:00', hasta: HISTORIA_CORTE, vista: 'ORIGINAL', corte: '2026-11-15T00:00:00-05:00' } });
    const ev1 = alCorte.find((x) => x.nombre === 'Evidencias')!.filas.map((f) => String(f.descripcion));
    expect(alCorte.find((x) => x.nombre === 'CadenasCausales')!.filas).toHaveLength(1);
    expect(ev1.some((d) => /después del corte/.test(d))).toBe(false);
    expect(alCorte.find((x) => x.nombre === 'Recomendaciones')!.filas.every((f) => f.estado !== 'DETECTADA (sin revisar)')).toBe(true);
    const hoy = L.hojas08(repo, { filtros: { desde: '2026-08-03T00:00:00-05:00', hasta: HISTORIA_CORTE } });
    expect(hoy.find((x) => x.nombre === 'Evidencias')!.filas.some((f) => /después del corte/.test(String(f.descripcion)))).toBe(true);
  });
});

describe('RC3 — EVA con corte posterior y sin tope', () => {
  it('corte de evaluación posterior a la historia y 60 meses: calcula, rotula EXTENSIÓN y conserva convención', () => {
    const h = K.cargarHechos(repo);
    const corte = '2026-11-30T00:00:00-05:00';
    const ev = E.evaluar(repo, h, { corte, desdeMes: E.primerMesCompleto(corte), hastaMes: E.sumarMeses(E.primerMesCompleto(corte), 59) });
    expect(ev.demanda.meses[0].mes).toBe('2026-12');
    expect(ev.horizonte_meses).toBe(60);
    expect(ev.demanda.meses.some((m) => m.extension)).toBe(true);
    expect(Number.isFinite(ev.escenarios[0].eva ?? NaN)).toBe(true);
  });
});

describe('RC4 — defecto 7: intervalo mensual de más de 360 meses', () => {
  it('2026-12 a 2061-11 (420 meses): meses inicial y final exactos, todos presentes, EVA finito y EXTENSIÓN rotulada', () => {
    const h = K.cargarHechos(repo);
    const t0 = Date.now();
    const ev = E.evaluar(repo, h, { corte: HISTORIA_CORTE, desdeMes: '2026-12', hastaMes: '2061-11' });
    expect(ev.horizonte_meses).toBe(420);
    expect(ev.demanda.meses[0].mes).toBe('2026-12'); expect(ev.demanda.meses.at(-1)!.mes).toBe('2061-11');
    expect(ev.escenarios[0].meses).toHaveLength(420);
    expect(Number.isFinite(ev.escenarios[0].eva ?? NaN)).toBe(true);
    expect(ev.demanda.meses.at(-1)!.extension).toBe(true);
    expect(Date.now() - t0).toBeLessThan(20000);
  });
});

describe('RC4 — defecto 23: conclusión y validador al corte', () => {
  it('NO_CONCLUYENTE antes del corte y CONFIRMADA después (otra conclusión y otro validador): ORIGINAL muestra solo lo conocido al corte', async () => {
    const r = nuevo(); r.reloj = () => '2026-10-05T10:00:00-05:00';
    const id = G.crearAnalisis(r, 'U06', { indicador: 'OTIF', entidad: 'pedido', entidad_id: 'PED-0001', hecho: 'Llegó tarde', evento: 'Conexión perdida', causa_candidata: 'Margen corto en transbordo', alternativa: 'Salida antes' });
    G.agregarEvidencia(r, 'U06', id, { sentido: 'A_FAVOR', descripcion: 'Evidencia previa', fuente: 'Historia' });
    G.agregarEvidencia(r, 'U06', id, { sentido: 'EN_CONTRA', descripcion: 'Evidencia en contra previa', fuente: 'Operador' });
    r.reloj = () => '2026-10-10T10:00:00-05:00';
    G.cambiarEstadoCausa(r, 'U05', id, 'NO_CONCLUYENTE', 'Evidencia mixta', 'Conclusión A: no concluyente con la evidencia disponible');
    r.reloj = () => '2026-11-12T10:00:00-05:00';
    r.run("DELETE FROM causa_evidencia WHERE analisis_id = ? AND sentido = 'EN_CONTRA'", [id]); // la evidencia en contra se resolvió (simulación del caso)
    G.cambiarEstadoCausa(r, 'U04', id, 'CONFIRMADA', 'Validación con operador', 'Conclusión B: causa confirmada');
    r.reloj = () => AHORA;
    const filtrosO = { desde: '2026-08-03T00:00:00-05:00', hasta: HISTORIA_CORTE, vista: 'ORIGINAL' as const, corte: '2026-11-01T00:00:00-05:00' };
    const o = L.hojas08(r, { filtros: filtrosO });
    const c = o.find((x) => x.nombre === 'CadenasCausales')!.filas.find((f) => f.analisis_id === id)!;
    expect(c.estado).toBe('NO_CONCLUYENTE');
    expect(c.conclusion).toBe('Conclusión A: no concluyente con la evidencia disponible');
    expect(c.validado_por).toBe('U05');
    const hist = o.find((x) => x.nombre === 'Evidencias')!.filas.filter((f) => f.analisis_id === id && f.evidencia_id === '(cambio de estado)').map((f) => String(f.sentido));
    expect(hist.some((x) => /CONFIRMADA/.test(x))).toBe(false);
    expect(o.find((x) => x.nombre === 'PuenteVistas')!.descripcion).toMatch(/Mismo período elegido: informe emitido \(ORIGINAL al 2026-11-01\)/);
    const re = L.hojas08(r, { filtros: { desde: filtrosO.desde, hasta: filtrosO.hasta } });
    const cr = re.find((x) => x.nombre === 'CadenasCausales')!.filas.find((f) => f.analisis_id === id)!;
    expect([cr.estado, cr.conclusion, cr.validado_por]).toEqual(['CONFIRMADA', 'Conclusión B: causa confirmada', 'U04']);
  });
  it('si la bitácora no conserva la conclusión de esa fecha, se rotula «No disponible al corte» y no se copia la actual', async () => {
    const r = nuevo(); r.reloj = () => '2026-10-05T10:00:00-05:00';
    const id = G.crearAnalisis(r, 'U06', { indicador: 'OTIF', entidad: 'pedido', entidad_id: 'PED-0002', hecho: 'h', evento: 'e', causa_candidata: 'c', alternativa: 'a' });
    G.agregarEvidencia(r, 'U06', id, { sentido: 'A_FAVOR', descripcion: 'ev', fuente: 'f' });
    G.agregarEvidencia(r, 'U06', id, { sentido: 'EN_CONTRA', descripcion: 'ev2', fuente: 'f' });
    r.reloj = () => '2026-10-10T10:00:00-05:00';
    G.cambiarEstadoCausa(r, 'U05', id, 'NO_CONCLUYENTE', 'mixta', 'Conclusión A');
    r.run("UPDATE auditoria SET detalle = json_remove(detalle, '$.conclusion') WHERE accion = 'CAMBIAR_ESTADO_CAUSA'"); // registro antiguo sin conclusión
    r.reloj = () => '2026-11-12T10:00:00-05:00';
    r.run("DELETE FROM causa_evidencia WHERE analisis_id = ? AND sentido = 'EN_CONTRA'", [id]);
    G.cambiarEstadoCausa(r, 'U04', id, 'CONFIRMADA', 'ok', 'Conclusión B');
    r.reloj = () => AHORA;
    const c = L.hojas08(r, { filtros: { desde: '2026-08-03T00:00:00-05:00', hasta: HISTORIA_CORTE, vista: 'ORIGINAL', corte: '2026-11-01T00:00:00-05:00' } }).find((x) => x.nombre === 'CadenasCausales')!.filas.find((f) => f.analisis_id === id)!;
    expect(c.conclusion).toBe(L.NO_DISPONIBLE);
    expect(c.validado_por).toBe('U05');
  });
  it('recomendación creada antes del corte y decidida después: ORIGINAL la muestra como propuesta, sin la decisión posterior', () => {
    const r = nuevo(); r.reloj = () => '2026-10-05T10:00:00-05:00';
    r.run("INSERT INTO recomendacion (recomendacion_id, regla, entidad, entidad_id, estado, valores, alternativa, impacto, restricciones, creada_en, decidida_por, decidida_en, motivo) VALUES ('REC-T','BL01','producto','P01','ACEPTADA','{}','x','y','z','2026-10-05T10:00:00-05:00','U05','2026-11-10T10:00:00-05:00','posterior')");
    r.reloj = () => AHORA;
    const rec = L.hojas08(r, { filtros: { desde: '2026-08-03T00:00:00-05:00', hasta: HISTORIA_CORTE, vista: 'ORIGINAL', corte: '2026-11-01T00:00:00-05:00' } }).find((x) => x.nombre === 'Recomendaciones')!.filas.find((f) => f.regla === 'BL01' && f.entidad_id === 'P01')!;
    expect(rec.estado).toMatch(/PROPUESTA/); expect(rec.decidida_por).toBe(''); expect(rec.motivo).toBe('');
  });
});
