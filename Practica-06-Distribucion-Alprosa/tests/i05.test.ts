// Pruebas de I05: analítica descriptiva, diagnóstica, predictiva y prescriptiva sobre la historia sintética (Excel 06) y casos construidos.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { Repo } from '../src/core/db';
import { validarConjunto } from '../src/core/contrato';
import { confirmarCarga } from '../src/core/carga';
import * as D from '../src/core/dominio';
import * as P from '../src/core/permisos';
import * as K from '../src/core/kpi';
import * as F from '../src/core/pronostico';
import * as G from '../src/core/diagnostico';
import * as C from '../src/core/costos';
import { aHojas } from '../src/core/demo';
import { tablasExcel06, tablasHistoria, HISTORIA_CORTE } from '../src/core/historia';

let SQL: SqlJsStatic, repo: Repo, hechos: K.PedidoH[];
const AHORA = '2026-11-14T10:00:00-05:00';
const I = (d: string, h = '00:00') => `${d}T${h}:00-05:00`;
function cargar() {
  repo = Repo.iniciar(new SQL.Database()); repo.reloj = () => AHORA;
  P.asegurarUsuarios(repo); repo.transaccion(() => D.asegurarParametros(repo));
  const { errores, datos } = validarConjunto(aHojas(tablasExcel06()));
  if (errores.length) throw new Error(JSON.stringify(errores.slice(0, 2)));
  confirmarCarga(repo, 'U01', datos, { hash: 'h', nombre: '06', bytes: 0, datasetId: '06' });
  hechos = K.cargarHechos(repo);
}
beforeAll(async () => { SQL = await initSqlJs(); cargar(); });

/** Pedido sintético mínimo para casos exactos. */
function hp(id: string, o: Partial<K.PedidoH> & { acept?: [string, string, number][]; kg?: number } = {}): K.PedidoH {
  const lineas = o.lineas ?? [{ linea: 1, producto: 'P03', sol: 100000, comp: 100000, noAt: 0, motivoNoAt: null, kgMil: 1000 }];
  return { id, fuente: 'HISTORIA', cliente: 'CLI-001', destino: 'DES-001', region: 'Arequipa', remoto: false, fechaPedido: I('2026-03-02', '09:00'), registrado: I('2026-03-02', '09:05'),
    ini: I('2026-03-04', '08:00'), fin: I('2026-03-06', '18:00'), tipo: 'FIRME', cancelado: null, motivoCancel: null, prioridad: 'NORMAL', lineas, devol: [], etapas: [],
    entregas: (o.acept ?? []).map(([oc, reg, q], k) => ({ id: `${id}-E${k + 1}`, intento: k + 1, ocurrido: oc, registrado: reg, estado: q > 0 ? 'TOTAL' : 'FALLIDO', motivo: q > 0 ? null : 'Cliente ausente', linea: q > 0 ? 1 : null, acept: q, rech: 0 })), ...o };
}
const F0: K.Filtros = { desde: I('2026-03-01'), hasta: I('2026-03-09'), corte: AHORA };
const kpi = (hs: K.PedidoH[], id: string, f = F0) => K.indicadores(hs, f).find((k) => k.id === id)!;

describe('I — Definiciones de indicadores', () => {
  it('ESC-I01 / AE06 sin registros: vacío explícito y N/D, sin ceros inventados', () => {
    const f = { desde: I('2020-01-01'), hasta: I('2020-02-01'), corte: AHORA };
    expect(kpi(hechos, 'otif', f)).toMatchObject({ valor: null, numerador: 0, denominador: 0 });
    expect(K.serieOTIF(hechos, f)).toEqual([]);
  });
  it('ESC-I02 cero elegibles: OTIF N/D', () => {
    expect(kpi([hp('A', { cancelado: I('2026-03-03'), motivoCancel: 'Desiste' })], 'otif').valor).toBeNull();
  });
  it('ESC-I03 cero kg aceptados: costo por kg N/D', () => {
    expect(kpi([hp('A', { etapas: [{ id: 'A-T1', tramo: 1, modo: 'VIAL', origen: 'ALM-AQP', destino: 'N', servicio: 'S1', salPlan: I('2026-03-05'), salReal: I('2026-03-05'), llePlan: I('2026-03-05'), lleReal: I('2026-03-05'), kg: 100, cap: 1000, perdida: false, est: 5000, real: 5200, motivo: null }] })], 'costo_kg').valor).toBeNull();
  });
  it('ESC-I04 cancelación: antes del compromiso se excluye; después del vencimiento no mejora el OTIF', () => {
    const u = K.universoOTIF([hp('A', { cancelado: I('2026-03-03') }), hp('B', { cancelado: I('2026-03-08') })], F0);
    expect(u.map((p) => [p.id, p.elegible, p.otif])).toEqual([['A', false, null], ['B', true, false]]);
  });
  it('ESC-I05 varios intentos: un solo pedido en OTIF; el reintento tardío no lo vuelve puntual', () => {
    const p = hp('A', { acept: [[I('2026-03-06', '10:00'), I('2026-03-06', '10:30'), 0], [I('2026-03-07', '11:00'), I('2026-03-07', '11:30'), 100000]] });
    expect(kpi([p], 'otif')).toMatchObject({ numerador: 0, denominador: 1 });
    expect(kpi([p], 'intentos_fallidos').numerador).toBe(1);
  });
  it('ESC-I06 unidades distintas: el fill rate convierte cada presentación a kg', () => {
    const p = hp('A', { lineas: [{ linea: 1, producto: 'P01', sol: 2000, comp: 2000, noAt: 0, motivoNoAt: null, kgMil: 25000 }, { linea: 2, producto: 'P03', sol: 50000, comp: 50000, noAt: 0, motivoNoAt: null, kgMil: 1000 }] });
    p.entregas = [{ id: 'e', intento: 1, ocurrido: I('2026-03-05'), registrado: I('2026-03-05'), estado: 'PARCIAL', motivo: null, linea: 1, acept: 1000, rech: 0 }, { id: 'e', intento: 1, ocurrido: I('2026-03-05'), registrado: I('2026-03-05'), estado: 'PARCIAL', motivo: null, linea: 2, acept: 50000, rech: 0 }];
    expect(kpi([p], 'fill_rate')).toMatchObject({ valor: 75, numerador: 75, denominador: 100 });
  });
  it('ESC-I07 costo común: lo imputado + no asignado = costo total', () => {
    const r = C.repartirCentavos(10001, [{ id: 'A', peso: 1 }, { id: 'B', peso: 1 }, { id: 'C', peso: 1 }]);
    expect(r.reduce((a, x) => a + x.cent, 0)).toBe(10001);
  });
  it('ESC-I08 / AE05 períodos: semana y mes conservan numeradores y denominadores; % se recalcula', () => {
    const f = { desde: I('2026-01-05'), hasta: I('2026-03-02'), corte: AHORA };
    const s = K.serieOTIF(hechos, { ...f, granularidad: 'semana' }), m = K.serieOTIF(hechos, { ...f, granularidad: 'mes' });
    const tot = (x: { num: number; den: number }[]) => x.reduce((a, y) => [a[0] + y.num, a[1] + y.den], [0, 0]);
    expect(tot(s)).toEqual(tot(m)); expect(tot(m)).toEqual([kpi(hechos, 'otif', f).numerador, kpi(hechos, 'otif', f).denominador]);
    for (const x of m) expect(x.otif).toBeCloseTo((x.num / x.den) * 100, 9);
  });
});

describe('AE — Rangos e intervalos', () => {
  it('ESC-AE01 rango de un día incluye cada evento una sola vez', () => {
    const p = hp('A', { fin: I('2026-03-06', '18:00') });
    expect(K.universoOTIF([p], { desde: I('2026-03-06'), hasta: I('2026-03-07'), corte: AHORA })).toHaveLength(1);
  });
  it('ESC-AE02 rango que cruza meses y año', () => {
    const u = K.universoOTIF(hechos, { desde: I('2025-12-20'), hasta: I('2026-01-10'), corte: AHORA });
    expect(u.length).toBeGreaterThan(0); expect(u.every((p) => p.fin >= I('2025-12-20') && p.fin < I('2026-01-10'))).toBe(true);
  });
  it('ESC-AE03 desde ≥ hasta se rechaza antes de calcular', () => {
    expect(() => K.indicadores(hechos, { desde: I('2026-03-09'), hasta: I('2026-03-09') })).toThrow(/anterior/);
  });
  it('ESC-AE04 un evento exactamente en «hasta» queda fuera y entra en el rango siguiente', () => {
    const p = hp('A', { fin: I('2026-03-09') });
    expect(K.universoOTIF([p], F0)).toHaveLength(0);
    expect(K.universoOTIF([p], { desde: I('2026-03-09'), hasta: I('2026-03-16'), corte: AHORA })).toHaveLength(1);
  });
  it('ESC-AE07 horizonte mayor: escenario rotulado como extensión con su hipótesis', () => {
    const r = F.pronosticar(repo, hechos, { producto: 'P01', corte: HISTORIA_CORTE, horizonte: 52 });
    expect(r.prediccion.slice(8).every((x) => x.tipo === 'EXTENSION')).toBe(true); expect(r.advertencias.join(' ')).toMatch(/EXTENSIÓN por hipótesis/);
  });
  it('ESC-AE08 / AU08 semana a días: conserva el total; normaliza pesos y respeta días cerrados; bloquea lo imposible', () => {
    const d = F.desagregarSemana(100, [1, 1, 1, 1, 1, 0.5, 0.5], [6]);
    expect(d.total).toBe(100); expect(d.dias[6]).toBe(0);
    expect(() => F.desagregarSemana(10, [0, 0, 0, 0, 0, 1, 0], [5])).toThrow(/imposible/);
  });
});

describe('J / AU / BL — Pronóstico', () => {
  it('ESC-J01 / J07 / BL04 historia suficiente: protocolo temporal; los tres métodos se miden en las mismas 8 semanas antes de elegir', () => {
    const r = F.pronosticar(repo, hechos, { producto: 'P01', corte: HISTORIA_CORTE });
    expect(r.n_obs).toBeGreaterThanOrEqual(26); expect(r.backtest).toHaveLength(8);
    expect(new Set(Object.values(r.metricas!).map((m) => m.n)).size).toBe(1);
    const mejor = (['INGENUO', 'PM4', 'SES'] as const).reduce((a, b) => (r.metricas![b].wape! < r.metricas![a].wape! ? b : a));
    expect(r.elegido).toBe(mejor);
  });
  it('ESC-J02 / AU03 / BL02 serie corta: ingenuo con advertencia; sin observaciones: sin pronóstico', () => {
    const r = F.pronosticar(repo, hechos, { producto: 'P10', corte: HISTORIA_CORTE });
    expect(r.n_obs).toBeLessThan(26); expect(r.elegido).toBe('INGENUO'); expect(r.advertencias.join(' ')).toMatch(/Información limitada/);
    expect(r.prediccion.every((p) => p.tipo === 'REFERENCIA')).toBe(true);
    const nada = F.pronosticar(repo, hechos, { producto: 'P02', region: 'Madre de Dios', corte: HISTORIA_CORTE });
    expect(nada.prediccion).toHaveLength(0); expect(nada.protocolo).toMatch(/no hay pronóstico estadístico/);
  });
  it('ESC-J03 todos ceros: pronóstico base cero y WAPE N/D', () => {
    const ceros = Array.from({ length: 30 }, (_, w) => hp('Z' + w, { fechaPedido: new Date(Date.parse(I('2026-01-05', '09:00')) + w * 7 * 86400000 - 5 * 3600000).toISOString().slice(0, 19) + '-05:00', registrado: I('2026-01-01'), lineas: [{ linea: 1, producto: 'P07', sol: 0, comp: 0, noAt: 0, motivoNoAt: null, kgMil: 6000 }] }));
    const r = F.pronosticar(repo, ceros, { producto: 'P07', corte: I('2026-08-03') });
    expect(r.prediccion[0].valor).toBe(0); expect(r.metricas!.INGENUO.wape).toBeNull();
  });
  it('ESC-J04 intermitente: métricas compatibles con ceros, sin MAPE', () => {
    const r = F.pronosticar(repo, hechos, { producto: 'P09', region: 'Madre de Dios', corte: HISTORIA_CORTE });
    expect(r.advertencias.join(' ')).toMatch(/intermitente/); expect(JSON.stringify(r.metricas)).not.toMatch(/mape/i);
  });
  it('ESC-J05 faltante ≠ cero: Ayacucho sin datos 3 semanas', () => {
    const s = F.serieDemanda(repo, hechos, { producto: 'P01', region: 'Ayacucho', hasta: HISTORIA_CORTE });
    expect(s.filter((p) => p.valor === null)).toHaveLength(3); expect(s.some((p) => p.valor === 0)).toBe(true);
  });
  it('ESC-J06 / BL05 atípico: se señala y se conserva', () => {
    const s = F.serieDemanda(repo, hechos, { producto: 'P03', region: 'Arequipa', hasta: HISTORIA_CORTE });
    const a = s.filter((p) => p.atipico); expect(a.length).toBeGreaterThan(0); expect(a.every((p) => p.valor! > 0)).toBe(true);
  });
  it('ESC-J08 / AX02 / BL08 lo registrado después del origen no entrena ese origen', () => {
    const base = F.serieDemanda(repo, hechos, { producto: 'P01', hasta: I('2026-06-01'), conocimiento: I('2026-06-01') });
    const tarde = hp('TARDE', { fechaPedido: I('2026-05-25', '09:00'), registrado: I('2026-06-03'), lineas: [{ linea: 1, producto: 'P01', sol: 999000, comp: 999000, noAt: 0, motivoNoAt: null, kgMil: 25000 }] });
    const con = F.serieDemanda(repo, [...hechos, tarde], { producto: 'P01', hasta: I('2026-06-01'), conocimiento: I('2026-06-01') });
    expect(con).toEqual(base);
    expect(F.serieDemanda(repo, [...hechos, tarde], { producto: 'P01', hasta: I('2026-06-01') }).at(-1)!.valor).toBe(base.at(-1)!.valor! + 999000);
  });
  it('ESC-AU01 demanda censurada: se pronostica lo solicitado (100), no lo entregado (60)', () => {
    const p = hp('C', { fechaPedido: I('2026-03-02', '09:00'), lineas: [{ linea: 1, producto: 'P06', sol: 100000, comp: 60000, noAt: 40000, motivoNoAt: 'Falta de stock', kgMil: 1000 }] });
    const s = F.serieDemanda(repo, [p], { producto: 'P06', hasta: I('2026-03-09') });
    expect(s[0]).toMatchObject({ valor: 100000, censurada: true });
    expect(kpi([p], 'no_atendido').valor).toBe(40);
  });
  it('ESC-AU02 consultas y duplicados no son demanda firme ni entran al OTIF', () => {
    const u = K.universoOTIF([hp('Q', { tipo: 'CONSULTA', cancelado: I('2026-03-02', '12:00') })], F0);
    expect(u[0]).toMatchObject({ elegible: false, motivoExclusion: expect.stringMatching(/Consulta/) });
    expect(F.serieDemanda(repo, [hp('Q', { tipo: 'CONSULTA' })], { producto: 'P03', hasta: I('2026-03-09') })).toEqual([]);
  });
  it('ESC-AU04 kg → bultos solo con mezcla declarada: 100 kg al 50/50 = 2 sacos de 25 y 1 de 50', () => {
    expect(() => F.convertirABultos(100, [])).toThrow(/declare la mezcla/);
    expect(F.convertirABultos(100, [{ presentacion: 'Saco 25', kg_por_bulto: 25, proporcion: 0.5 }, { presentacion: 'Saco 50', kg_por_bulto: 50, proporcion: 0.5 }]).map((x) => x.bultos)).toEqual([2, 1]);
  });
  it('ESC-AU05 productos no equivalentes no se concatenan: la serie de P10 empieza en su primera semana', () => {
    const s = F.serieDemanda(repo, hechos, { producto: 'P10', hasta: HISTORIA_CORTE });
    expect(s[0].semana > '2026-07-01').toBe(true);
  });
  it('ESC-AU07 / BL07 una corrección crea otra corrida; la original se conserva', () => {
    const r = F.pronosticar(repo, hechos, { producto: 'P01', corte: HISTORIA_CORTE });
    const a = F.guardarCorrida(repo, 'U06', r), b = F.guardarCorrida(repo, 'U06', r, { corrige_a: a, motivo: 'Corrección de un dato extremo' });
    expect(repo.num('SELECT COUNT(*) FROM corrida_pronostico WHERE corrida_id IN (?,?)', [a, b])).toBe(2);
    expect(repo.uno('SELECT corrige_a, version_motor FROM corrida_pronostico WHERE corrida_id = ?', [b])).toEqual({ corrige_a: a, version_motor: F.VERSION_MOTOR });
  });
  it('ESC-BL01 / BL09 desempeño por segmento: remotos y no remotos se miden por separado', () => {
    const rem = F.pronosticar(repo, hechos, { producto: 'P01', remoto: true, corte: HISTORIA_CORTE }), no = F.pronosticar(repo, hechos, { producto: 'P01', remoto: false, corte: HISTORIA_CORTE });
    expect(rem.serie).toMatch(/remotos/); expect(no.serie).toMatch(/no remotos/);
    const c = K.concentracion(hechos, { desde: I('2025-11-10'), hasta: I('2026-11-09'), corte: AHORA }, 'remoto');
    expect(c.find((x) => x.clave === 'Remotos')!.otif!).toBeLessThan(c.find((x) => x.clave === 'No remotos')!.otif!);
  });
  it('ESC-BL10 corrida vencida según política: exige revalidar', () => {
    const id = F.guardarCorrida(repo, 'U06', F.pronosticar(repo, hechos, { producto: 'P02', corte: HISTORIA_CORTE }));
    expect(F.estadoCorrida(repo, id)).toBe('VIGENTE');
    repo.reloj = () => '2026-12-05T10:00:00-05:00'; expect(F.estadoCorrida(repo, id)).toBe('VENCIDA'); repo.reloj = () => AHORA;
  });
});

describe('AX — Hecho, registro y conocimiento', () => {
  it('ESC-AX01 entrega a tiempo registrada tarde: ORIGINAL no la conoce; REEXPRESADA sí', () => {
    const p = hp('A', { acept: [[I('2026-03-06', '12:00'), I('2026-03-12', '09:00'), 100000]] });
    expect(K.universoOTIF([p], { ...F0, vista: 'ORIGINAL', corte: I('2026-03-10') })[0].otif).toBe(false);
    expect(K.universoOTIF([p], { ...F0, vista: 'REEXPRESADA' })[0].otif).toBe(true);
  });
  it('ESC-AX03 informe emitido vs reexpresado con puente de diferencias', () => {
    const p = hp('A', { acept: [[I('2026-03-06', '12:00'), I('2026-03-12', '09:00'), 100000]] });
    const b = K.puenteOTIF([p], F0, I('2026-03-10'));
    expect([b.original.valor, b.reexpresada.valor]).toEqual([0, 100]);
    expect(b.cambios[0]).toMatchObject({ antes: 'No OTIF', despues: 'OTIF', motivo: expect.stringMatching(/registrada después/) });
  });
  it('ESC-AX05 reproducir un informe tal como se conocía a una fecha da el mismo resultado', () => {
    const f = { desde: I('2026-09-01'), hasta: I('2026-10-01'), vista: 'ORIGINAL' as const, corte: I('2026-10-05') };
    expect(K.indicadores(hechos, f)).toEqual(K.indicadores(hechos, f));
  });
  it('§8 una devolución posterior al cierre no reescribe el OTIF', () => {
    const p = hp('A', { acept: [[I('2026-03-05'), I('2026-03-05'), 100000]], devol: [{ linea: 1, q: 30000, ocurrido: I('2026-03-10'), registrado: I('2026-03-10'), motivo: 'Humedad' }] });
    expect(kpi([p], 'otif').valor).toBe(100); expect(kpi([p], 'devoluciones').numerador).toBe(30);
  });
});

describe('§8.3 Diagnóstico causal y prescripción', () => {
  beforeEach(() => cargar());
  it('La demostración siembra una cadena: hecho → evento → causa candidata → evidencia → EN VALIDACIÓN', () => {
    const id = G.sembrarCadenaDemo(repo, hechos, 'U06')!;
    const a = G.analisis(repo).find((x) => x.analisis_id === id)!;
    expect(a.estado).toBe('EN_VALIDACION'); expect(a.evidencias.length).toBe(2); expect(String(a.evento)).toMatch(/conexión perdida/);
  });
  it('No se confirma sin evidencia a favor, con evidencia en contra o por la misma persona que la propuso', () => {
    const id = G.crearAnalisis(repo, 'U06', { indicador: 'OTIF', entidad: 'pedido', entidad_id: 'H-00010', hecho: 'Llegó tarde 20 h', evento: 'Lancha salió sin la carga', causa_candidata: 'Margen corto en el muelle' });
    expect(() => G.cambiarEstadoCausa(repo, 'U05', id, 'CONFIRMADA', 'x', 'c')).toThrow(/sin evidencia a favor/);
    G.agregarEvidencia(repo, 'U06', id, { sentido: 'A_FAVOR', descripcion: '12 de 15 casos', fuente: 'HistEtapas' });
    expect(() => G.cambiarEstadoCausa(repo, 'U06', id, 'CONFIRMADA', 'ok', 'Margen corto')).toThrow(/persona distinta/);
    G.agregarEvidencia(repo, 'U05', id, { sentido: 'EN_CONTRA', descripcion: 'En temporada seca no ocurre', fuente: 'Registro de salidas' });
    expect(() => G.cambiarEstadoCausa(repo, 'U05', id, 'CONFIRMADA', 'ok', 'Margen corto')).toThrow(/en contra/);
    G.cambiarEstadoCausa(repo, 'U05', id, 'NO_CONCLUYENTE', 'Evidencia mixta');
    expect(G.analisis(repo).find((x) => x.analisis_id === id)!.historial.map((h) => h.a)).toEqual(['HIPOTESIS_PENDIENTE', 'NO_CONCLUYENTE']);
  });
  it('El Pareto muestra «Sin causa registrada» y advierte que no confirma causa raíz', () => {
    const p = K.pareto(hechos, { desde: I('2025-11-10'), hasta: I('2026-11-09'), corte: AHORA });
    expect(p.filas.some((x) => x.causa === 'Sin causa registrada')).toBe(true); expect(p.advertencia).toMatch(/no confirma causa raíz/);
    expect(p.filas.reduce((a, x) => a + x.n, 0)).toBe(p.n); expect(p.filas.at(-1)!.acumulado).toBeCloseTo(100, 6);
  });
  it('Regla prescriptiva: lote sin vida útil suficiente; aceptar no cambia la reserva', () => {
    D.reservarFefo(repo, 'U03', 'PED-0001');
    repo.run("UPDATE destino SET vida_util_min_dias = 400 WHERE destino_id = 'DES-001'");
    expect(G.actualizarRecomendaciones(repo)).toBeGreaterThan(0);
    const r = repo.uno("SELECT * FROM recomendacion WHERE regla = 'LOTE_SIN_VIDA_UTIL'")!;
    expect(String(r.valores)).toMatch(/vence/); expect(G.actualizarRecomendaciones(repo)).toBe(0); // sin duplicar
    const antes = repo.num("SELECT COUNT(*) FROM reserva WHERE estado = 'ACTIVA'");
    G.decidirRecomendacion(repo, 'U04', String(r.recomendacion_id), true, 'Se aplicará manualmente');
    expect(repo.num("SELECT COUNT(*) FROM reserva WHERE estado = 'ACTIVA'")).toBe(antes);
    expect(() => G.decidirRecomendacion(repo, 'U04', String(r.recomendacion_id), true, 'otra vez')).toThrow(/ya fue decidida/);
  });
});

describe('Excel 06 (historia sintética)', () => {
  it('Es determinista: misma semilla, mismas filas', () => {
    expect(JSON.stringify(tablasHistoria())).toBe(JSON.stringify(tablasHistoria()));
  });
  it('Cubre 52 semanas cerradas antes del corte, con faltantes, censura, intermitencia y producto nuevo', () => {
    const fechas = hechos.filter((p) => p.fuente === 'HISTORIA').map((p) => p.fechaPedido).sort();
    expect(fechas[0] >= '2025-11-10').toBe(true); expect(fechas.at(-1)! < HISTORIA_CORTE).toBe(true);
    expect(repo.num('SELECT COUNT(*) FROM hist_sin_datos')).toBe(3);
    expect(repo.num('SELECT COUNT(*) FROM hist_linea WHERE no_atendido_mil > 0')).toBeGreaterThan(0);
  });
});
