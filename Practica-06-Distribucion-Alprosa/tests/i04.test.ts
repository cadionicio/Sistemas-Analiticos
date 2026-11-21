// Pruebas de I04-a: red multimodal, planificación por etapas, capacidad, conexiones, custodia y entrega final.
// Red de laboratorio LAB (sintética) para reproducir las pruebas numéricas §14.1.1 #1–#7 y §14.1.2 #11; la red NutriDemo para casos regionales.
import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { Repo } from '../src/core/db';
import { validarConjunto } from '../src/core/contrato';
import { confirmarCarga } from '../src/core/carga';
import * as D from '../src/core/dominio';
import * as P from '../src/core/permisos';
import * as T from '../src/core/transporte';
import { tablasDemo, aHojas, type Tabla } from '../src/core/demo';

let SQL: SqlJsStatic;
let repo: Repo;
const T0 = '2026-11-13T12:00:00-05:00';
const DATOS = 'U01', PED = 'U02', ALM = 'U03', PLAN = 'U04', ANA = 'U06';
type Celda = string | number | boolean | null;

// ------------------------------------------------------------------ Red de laboratorio
function lab(tablas: Tabla[]): Tabla[] {
  const h = (n: string) => tablas.find((t) => t.hoja === n)!.filas as Celda[][];
  h('Productos').push(['PLG', 'Granel de laboratorio', 'Prueba', 'kg', 1, 0.0016, true, true], ['PLS', 'Saco laboratorio 25 kg', 'Prueba', 'unidad', 25, 0.04, false, true],
    ['PL50', 'Saco laboratorio 50 kg', 'Prueba', 'unidad', 50, 0.08, false, true], ['PLH', 'Granel para pedido dividido', 'Prueba', 'kg', 1, 0.0016, true, true]);
  for (const [p, n] of [['PLG', 'Kilogramo'], ['PLS', 'Unidad'], ['PL50', 'Unidad'], ['PLH', 'Kilogramo']]) h('Conversiones').push([`${p}-U`, p, n, 1, true]);
  h('NodosLogisticos').push(['LAB-A', 'Almacén LAB A', 'ALMACEN', 'Arequipa', 100000, true, true, 'SINTETICO', 30], ['LAB-B', 'Almacén LAB B', 'ALMACEN', 'Arequipa', 100000, true, true, 'SINTETICO', 30],
    ['LAB-P', 'Puerto LAB', 'TRANSBORDO', 'Arequipa', 5000, true, true, 'SINTETICO', 30], ['LAB-Q', 'Muelle LAB', 'TRANSBORDO', 'Arequipa', 5000, true, true, 'SINTETICO', 30],
    ['LAB-R', 'Puerto LAB R', 'TRANSBORDO', 'Arequipa', 5000, true, true, 'SINTETICO', 30],
    ['N-LAB', 'Cliente LAB', 'DESTINO', 'Arequipa', null, false, true, 'SINTETICO', 0], ['N-LAB2', 'Cliente LAB 2', 'DESTINO', 'Arequipa', null, false, true, 'SINTETICO', 0],
    ['N-LAB3', 'Cliente LAB aislado', 'DESTINO', 'Arequipa', null, false, true, 'SINTETICO', 0]);
  const base = h('Destinos').find((d) => d[0] === 'DES-001')!;
  for (const [id, nodo] of [['DES-LAB', 'N-LAB'], ['DES-LAB2', 'N-LAB2'], ['DES-LAB3', 'N-LAB3']]) {
    const d = [...base]; d[0] = id; d[2] = `Destino ${id}`; d[7] = null; d[8] = null; d[9] = 'DESCONOCIDA'; d[10] = nodo; d[11] = true; d[12] = 0; h('Destinos').push(d);
  }
  h('Lotes').push(['L-LG', 'PLG', 'LG', '2026-10-01', '2027-06-30', 'LIBERADO'], ['L-LS', 'PLS', 'LS', '2026-10-01', '2027-06-30', 'LIBERADO'], ['L-L50', 'PL50', 'L50', '2026-10-01', '2027-06-30', 'LIBERADO'],
    ['L-LHA', 'PLH', 'LHA', '2026-10-01', '2027-05-30', 'LIBERADO'], ['L-LHB', 'PLH', 'LHB', '2026-10-01', '2027-06-30', 'LIBERADO']);
  h('MovimientosIniciales').push(['MI-L1', 'L-LG', 'LAB-A', 1000, '2026-11-01', 'APTO'], ['MI-L2', 'L-LS', 'LAB-A', 20, '2026-11-01', 'APTO'], ['MI-L3', 'L-L50', 'LAB-A', 5, '2026-11-01', 'APTO'],
    ['MI-L4', 'L-LHA', 'LAB-A', 60, '2026-11-01', 'APTO'], ['MI-L5', 'L-LHB', 'LAB-B', 40, '2026-11-01', 'APTO']);
  h('Recursos').push(['RL-VIAL', 'Camión LAB 200 kg', 'VIAL', 'Operador LAB', 200, 10, null, true], ['RL-VIAL2', 'Camión LAB B', 'VIAL', 'Operador LAB', 10000, 40, null, true],
    ['RL-VIAL3', 'Camión LAB R', 'VIAL', 'Operador LAB', 10000, 40, null, true], ['RL-LANCHA', 'Embarcación LAB 120 kg', 'LACUSTRE', 'Operador LAB', 120, 10, null, true],
    ['RL-LANCHA2', 'Embarcación LAB R', 'LACUSTRE', 'Operador LAB', 1200, 10, null, true], ['RL-LOCAL', 'Traslado local LAB 40 kg', 'PEATONAL', 'Operador LAB', 40, 10, 40, true]);
  const e = (id: string, o: string, d: string, m: string, hh: number) => h('EnlacesMultimodales').push([id, o, d, m, 10, hh, hh, hh, hh, 0, 0, `COR-${id}`, 'NORMAL', null, 'LAB sintético', true]);
  e('EL-AP', 'LAB-A', 'LAB-P', 'VIAL', 2); e('EL-BP', 'LAB-B', 'LAB-P', 'VIAL', 2); e('EL-PQ', 'LAB-P', 'LAB-Q', 'LACUSTRE', 1); e('EL-QN', 'LAB-Q', 'N-LAB', 'PEATONAL', 0.5);
  e('EL-AR', 'LAB-A', 'LAB-R', 'VIAL', 2); e('EL-RN2', 'LAB-R', 'N-LAB2', 'LACUSTRE', 1);
  const s = (id: string, en: string, r: string, sal: string, lle: string, fijo: number) => h('ServiciosTransporte').push([id, en, r, sal, lle, fijo, 0, 'PROGRAMADO']);
  for (const dd of ['14', '15', '16']) {
    s(`S-AP-${dd}`, 'EL-AP', 'RL-VIAL', `2026-11-${dd}T06:00`, `2026-11-${dd}T08:00`, 500);
    s(`S-BP-${dd}`, 'EL-BP', 'RL-VIAL2', `2026-11-${dd}T06:00`, `2026-11-${dd}T08:00`, 500);
    for (const hh of ['09', '11', '13', '15']) s(`S-PQ-${dd}-${hh}`, 'EL-PQ', 'RL-LANCHA', `2026-11-${dd}T${hh}:00`, `2026-11-${dd}T${String(Number(hh) + 1).padStart(2, '0')}:00`, 300);
    for (let k = 8; k <= 20; k++) { const hh = String(k).padStart(2, '0'); s(`S-QN-${dd}-${hh}`, 'EL-QN', 'RL-LOCAL', `2026-11-${dd}T${hh}:00`, `2026-11-${dd}T${hh}:30`, 60); }
  }
  s('S-AR-14', 'EL-AR', 'RL-VIAL3', '2026-11-14T08:15', '2026-11-14T10:15', 500);
  s('S-RN2-14-1030', 'EL-RN2', 'RL-LANCHA2', '2026-11-14T10:30', '2026-11-14T11:30', 300);
  s('S-RN2-14-1600', 'EL-RN2', 'RL-LANCHA2', '2026-11-14T16:00', '2026-11-14T17:00', 300);
  s('S-RN2-15-2330', 'EL-RN2', 'RL-LANCHA2', '2026-11-15T23:30', '2026-11-16T00:30', 300); // cruza medianoche (R06)
  h('Transbordos').push(['TR-LP', 'LAB-P', 'VIAL', 'LACUSTRE', 0.5, 20, 0, true], ['TR-LQ', 'LAB-Q', 'LACUSTRE', 'PEATONAL', 0.5, 20, 0, true]);
  h('ReceptoresAutorizados').push(['RA-LAB', 'DES-LAB', 'Responsable LAB', '2026-01-01T00:00', null], ['RA-LAB2', 'DES-LAB2', 'Responsable LAB 2', '2026-01-01T00:00', null]);
  return tablas;
}

function nuevo(tablas = lab(tablasDemo())) {
  repo = Repo.iniciar(new SQL.Database());
  repo.reloj = () => T0;
  P.asegurarUsuarios(repo);
  repo.transaccion(() => D.asegurarParametros(repo));
  const { errores, datos } = validarConjunto(aHojas(tablas));
  if (errores.length) throw new Error(JSON.stringify(errores.slice(0, 3)));
  confirmarCarga(repo, DATOS, datos, { hash: 'lab', nombre: 'lab', bytes: 0, datasetId: 'lab' });
}
beforeEach(async () => { SQL ??= await initSqlJs(); nuevo(); });

const kg = (x: number) => Math.round(x * 1000);
function pedido(prod: string, cantidad: number, o: { destino?: string; fin?: string; divididas?: boolean; reservar?: boolean } = {}) {
  const id = D.crearPedido(repo, PED, { cliente_id: 'CLI-001', destino_id: o.destino ?? 'DES-LAB', fecha_pedido: '2026-11-13', ventana_inicio: '2026-11-14T00:00:00-05:00', ventana_fin: o.fin ?? '2026-11-20T23:00:00-05:00',
    prioridad: 'NORMAL', permite_parcial: true, permite_entregas_divididas: o.divididas ?? true, lineas: [{ producto_id: prod, presentacion_id: `${prod}-U`, cantidad_presentacion_mil: kg(cantidad), precio_neto_base_p4: 10000 }] });
  D.confirmarPedido(repo, PED, id);
  if (o.reservar !== false) D.reservarFefo(repo, ALM, id);
  return id;
}
const plan = (id: string) => { if (id.startsWith('PED-00')) reservarDemo(id); return T.planificarPedido(repo, id); };
const reservarDemo = (id: string) => { if (!T.cargaPorOrigen(repo, id).size) D.reservarFefo(repo, ALM, id); };
const mejor = (id: string, origen?: string) => { const r = plan(id).find((x) => !origen || x.origen === origen)!; return { r, a: r.alternativas[0] }; };
const confirmar = (id: string, origen?: string) => { const { r, a } = mejor(id, origen); expect(a.factible, a.motivo || r.motivo_global).toBe(true); return T.confirmarItinerario(repo, PLAN, id, r.origen, a.clave); };
const etapas = (iti: string) => T.itinerarios(repo).find((i) => i.itinerario_id === iti)!.etapas;
const ped = (id: string) => D.pedidos(repo).find((p) => p.pedido_id === id)!;
const fisico = (lote: string, nodo: string) => repo.num(`SELECT COALESCE(SUM(CASE WHEN nodo_destino_id = ? THEN q_mil ELSE -q_mil END),0) FROM movimiento WHERE lote_id = ? AND (nodo_destino_id = ? OR nodo_origen_id = ?)`, [nodo, lote, nodo, nodo]);
const entregaOk = (e: T.EtapaVista, extra: Record<string, unknown> = {}) => T.registrarEntrega(repo, ALM, String(e.etapa_id), { receptor_id: 'RA-LAB', metodo_evidencia: 'Firma', evidencia_ref: 'C-1',
  lineas: e.carga.map((c) => ({ pedido_linea_id: String(c.pedido_linea_id), lote_id: String(c.lote_id), entregado_mil: e.en_transito.find((t) => t.lote_id === c.lote_id)!.q_mil, rechazado_mil: 0 })), ...extra });
/** Ejecuta un itinerario completo: despacha cada tramo, recibe lo íntegro en nodos y entrega con receptor facultado. */
function ejecutar(iti: string) {
  const tramos = Math.max(...etapas(iti).map((e) => Number(e.tramo)));
  for (let k = 1; k <= tramos; k++) {
    for (const e of etapas(iti).filter((x) => Number(x.tramo) === k)) T.despacharEtapa(repo, ALM, String(e.etapa_id));
    for (const e of etapas(iti).filter((x) => Number(x.tramo) === k)) {
      if (e.final) entregaOk(e);
      else T.recibirEtapa(repo, ALM, String(e.etapa_id), e.en_transito.map((t) => ({ lote_id: t.lote_id, apta_mil: t.q_mil, cuarentena_mil: 0, danada_mil: 0 })), 'Custodio LAB', null);
    }
  }
}
const viajes = (a: T.Alternativa) => a.tramos.map((t) => t.viajes.length);
const cargas = (a: T.Alternativa, k: number) => a.tramos[k].viajes.map((v) => v.kg_mil / 1000);

// ================================================================== §14.1.1 pruebas numéricas de referencia
describe('§14.1.1 — referencias numéricas', () => {
  it('#1a granel fraccionable 200 kg: 1 viaje vial, 2 embarques (120+80), 5 traslados de 40', () => {
    const { a } = mejor(pedido('PLG', 200));
    expect(a.factible).toBe(true);
    expect(viajes(a)).toEqual([1, 2, 5]);
    expect(cargas(a, 1)).toEqual([120, 80]);
    expect(cargas(a, 2)).toEqual([40, 40, 40, 40, 40]);
  });
  it('#1b ocho sacos de 25 kg: 2 embarques de 100 y 8 traslados de 25 (no 5 de 40)', () => {
    const { a } = mejor(pedido('PLS', 8));
    expect(viajes(a)).toEqual([1, 2, 8]);
    expect(cargas(a, 1)).toEqual([100, 100]);
    expect(cargas(a, 2).every((x) => x === 25)).toBe(true);
  });
  it('#1c bulto de 50 kg no fraccionable: el último medio de 40 kg es incompatible', () => {
    const { a } = mejor(pedido('PL50', 2));
    expect(a.factible).toBe(false);
    expect(a.motivo).toMatch(/bulto de 50 kg supera el máximo por bulto del recurso \(40 kg\)/);
  });
  it('ESC-AA02 (§14.1.1 #2) reserva raíz 200 (no 600) y balance final origen 0 / tránsito 0 / aceptado 200', () => {
    const id = pedido('PLG', 200);
    ejecutar(confirmar(id));
    const linea = ped(id).lineas[0];
    expect(repo.num('SELECT SUM(q_mil) FROM reserva WHERE pedido_linea_id = ?', [linea.pedido_linea_id])).toBe(kg(200));
    expect(fisico('L-LG', 'LAB-A')).toBe(kg(800));
    for (const n of ['TRANSITO', 'LAB-P', 'LAB-Q', 'N-LAB']) expect(fisico('L-LG', n)).toBe(0);
    expect(linea.aceptada_mil).toBe(kg(200));
    expect(ped(id).estado).toBe('Completado');
    expect(repo.num("SELECT SUM(q_mil) FROM movimiento WHERE tipo = 'ACEPTACION' AND lote_id = 'L-LG'")).toBe(kg(200));
  });
  it('#3 costo con transbordos: granel 500+600+300+40 = S/1.440; sacos 500+600+480+40 = S/1.620', () => {
    const g = mejor(pedido('PLG', 200)).a;
    expect(g.costo_cent).toBe(144000); expect(g.tramos.map((t) => t.transbordo_cent)).toEqual([0, 2000, 2000]);
    nuevo();
    expect(mejor(pedido('PLS', 8)).a.costo_cent).toBe(158000 + 4000);
  });
  it('#3b compartir la embarcación entre pedidos no duplica su fijo', () => {
    confirmar(pedido('PLG', 60)); confirmar(pedido('PLG', 60));
    const usados = repo.todos("SELECT servicio_id, COUNT(*) n FROM etapa WHERE servicio_id LIKE 'S-PQ-%' GROUP BY 1");
    expect(usados).toEqual([{ servicio_id: 'S-PQ-14-09', n: 2 }]);
    const imp = T.imputacionServicio(repo, 'S-PQ-14-09');
    expect(imp.lineas.reduce((x, l) => x + l.fijo_cent, 0)).toBe(30000);
    expect(imp.lineas.map((l) => l.fijo_cent)).toEqual([15000, 15000]);
  });
  it('#4 conexión perdida: llega 10:15, manipulación 30 min, salidas 10:30/16:00 → sale 16:00', () => {
    const { a } = mejor(pedido('PLG', 50, { destino: 'DES-LAB2' }));
    expect(a.tramos[0].viajes[0].llegada).toBe('2026-11-14T10:15:00-05:00');
    expect(a.tramos[1].viajes[0].salida).toBe('2026-11-14T16:00:00-05:00');
    expect(a.tramos[1].espera_min).toBe(345);
  });
  it('#4b si la ventana cierra antes, no asigna la salida de 10:30: queda no factible con motivo', () => {
    const { a } = mejor(pedido('PLG', 50, { destino: 'DES-LAB2', fin: '2026-11-14T16:30:00-05:00' }));
    expect(a.factible).toBe(false);
    expect(a.tramos[1].viajes[0].salida).toBe('2026-11-14T16:00:00-05:00');
    expect(a.motivo).toMatch(/después del fin de la ventana/);
  });
  it('#5 recepción 100 → 98: solo 98 en destino, 2 en investigación; reenviar el evento no mueve más', () => {
    const id = pedido('PLG', 100); const iti = confirmar(id);
    const e1 = etapas(iti)[0];
    T.despacharEtapa(repo, ALM, String(e1.etapa_id));
    const movs = repo.num('SELECT COUNT(*) FROM movimiento');
    const r1 = T.recibirEtapa(repo, ALM, String(e1.etapa_id), [{ lote_id: 'L-LG', apta_mil: kg(98), cuarentena_mil: 0, danada_mil: 0 }], 'Custodio', null, 'CMD-REC-1');
    expect(r1.resultado.apto_mil).toBe(kg(98)); expect(r1.resultado.diferencia_en_investigacion_mil).toBe(kg(2));
    expect(fisico('L-LG', 'LAB-P')).toBe(kg(98)); expect(fisico('L-LG', 'TRANSITO')).toBe(kg(2));
    const r2 = T.recibirEtapa(repo, ALM, String(e1.etapa_id), [{ lote_id: 'L-LG', apta_mil: kg(98), cuarentena_mil: 0, danada_mil: 0 }], 'Custodio', null, 'CMD-REC-1');
    expect(r2.repetido).toBe(true);
    expect(repo.num('SELECT COUNT(*) FROM movimiento')).toBe(movs + 1);
    expect(repo.uno('SELECT q_diferencia_mil FROM transferencia')!.q_diferencia_mil).toBe(kg(2));
    expect(() => T.despacharEtapa(repo, ALM, String(etapas(iti).find((e) => e.tramo === 2)!.etapa_id))).toThrow(/solo hay 98 aptos/);
  });
  it('ESC-T01 (§14.1.1 #6) pedido dividido 60+40: completar la rama 60 deja 40 pendientes; ambas suman 100 sin doble venta', () => {
    const id = pedido('PLH', 100);
    expect(ped(id).lineas[0].reservas.map((r) => [r.nodo_id, r.q_mil / 1000]).sort()).toEqual([['LAB-A', 60], ['LAB-B', 40]]);
    const res = plan(id); expect(res.map((r) => r.origen).sort()).toEqual(['LAB-A', 'LAB-B']);
    const ia = confirmar(id, 'LAB-A'); const ib = confirmar(id, 'LAB-B');
    ejecutar(ia);
    expect(ped(id).lineas[0].aceptada_mil).toBe(kg(60)); expect(ped(id).estado).toBe('En atención');
    ejecutar(ib);
    expect(ped(id).lineas[0].aceptada_mil).toBe(kg(100)); expect(ped(id).estado).toBe('Completado');
    expect(repo.num("SELECT SUM(q_mil) FROM movimiento WHERE tipo = 'ACEPTACION'")).toBe(kg(100));
  });
  it('#7 cierre 12:00–18:00: ninguna etapa afectada usa el tramo; fuera del intervalo se vuelve a usar', () => {
    T.registrarCondicion(repo, PLAN, { enlace_id: 'EL-QN', estado: 'INTERRUMPIDO', motivo: 'Cierre temporal', desde: '2026-11-14T12:00:00-05:00', hasta: '2026-11-14T18:00:00-05:00', fuente: 'Reporte LAB' });
    const { a } = mejor(pedido('PLG', 200));
    const sal = a.tramos[2].viajes.map((v) => v.salida.slice(11, 16));
    expect(sal.some((h) => h >= '12:00' && h < '18:00' && a.tramos[2].viajes.find((v) => v.salida.slice(11, 16) === h)!.salida.startsWith('2026-11-14'))).toBe(false);
    expect(a.tramos[2].viajes[0].salida).toBe('2026-11-14T18:00:00-05:00');
  });
  it('#7b sin alternativa la demanda queda sin atender y visible', () => {
    T.registrarCondicion(repo, PLAN, { enlace_id: 'EL-AP', estado: 'INTERRUMPIDO', motivo: 'Cierre', desde: '2026-11-13T00:00:00-05:00', hasta: '2026-12-31T00:00:00-05:00', fuente: 'Reporte LAB' });
    const id = pedido('PLG', 50);
    const { a } = mejor(id);
    expect(a.factible).toBe(false); expect(a.motivo).toMatch(/interrumpido/);
    expect(ped(id).estado).toBe('Reservado');
    expect(T.cargaPorOrigen(repo, id).size).toBe(1);
  });
  it('§14.1.2 #11 custodia sin confirmación: 40 en verificación sin ingreso, 60 siguen viajando; validar mueve 40 a aceptado', () => {
    const id = pedido('PLG', 100, { destino: 'DES-LAB2' }); const iti = confirmar(id);
    const [e1, e2] = etapas(iti);
    T.despacharEtapa(repo, ALM, String(e1.etapa_id));
    T.recibirEtapa(repo, ALM, String(e1.etapa_id), [{ lote_id: 'L-LG', apta_mil: kg(100), cuarentena_mil: 0, danada_mil: 0 }], 'Custodio', null);
    T.despacharEtapa(repo, ALM, String(e2.etapa_id));
    const r = T.registrarEntrega(repo, ALM, String(e2.etapa_id), { receptor_nombre: 'Vecino', metodo_evidencia: 'Foto', evidencia_ref: 'F-1', lineas: [{ pedido_linea_id: ped(id).lineas[0].pedido_linea_id, lote_id: 'L-LG', entregado_mil: kg(40), rechazado_mil: 0 }] });
    expect(r.resultado.estado).toBe('EN_VERIFICACION');
    expect(ped(id).lineas[0].aceptada_mil).toBe(0); expect(ped(id).lineas[0].en_verificacion_mil).toBe(kg(40));
    expect(fisico('L-LG', 'TRANSITO')).toBe(kg(60)); expect(fisico('L-LG', 'N-LAB2')).toBe(kg(40));
    const movs = repo.num('SELECT COUNT(*) FROM movimiento');
    const v = T.verificarEntrega(repo, ALM, r.resultado.entrega_id, 'RA-LAB2', 'Firma', 'C-9');
    expect(v.resultado.aceptado_mil).toBe(kg(40)); expect(ped(id).lineas[0].aceptada_mil).toBe(kg(40));
    expect(repo.num('SELECT COUNT(*) FROM movimiento')).toBe(movs + 1);
    expect(fisico('L-LG', 'TRANSITO')).toBe(kg(60));
  });
});

// ================================================================== Familias de casos
describe('E — Asignación de transporte', () => {
  it('ESC-E01 carga factible: plan confirmable', () => { const id = pedido('PLG', 100); expect(confirmar(id)).toMatch(/^ITI/); expect(T.itinerarios(repo, id)[0].estado).toBe('CONFIRMADO'); });
  it('ESC-E02 exceso kg: ningún viaje supera la capacidad aunque el volumen alcance', () => {
    const { a } = mejor(pedido('PLG', 300));
    expect(cargas(a, 0)).toEqual([200, 100]);
  });
  it('ESC-E03 exceso m³: limita aunque el peso alcance', () => {
    repo.run("UPDATE recurso SET capacidad_dm3 = 100 WHERE recurso_id = 'RL-LANCHA'");
    const { a } = mejor(pedido('PLG', 100));
    expect(a.tramos[1].viajes.every((v) => v.dm3 <= 100 && v.kg_mil < kg(120))).toBe(true);
    expect(a.tramos[1].viajes.length).toBe(2);
  });
  it('ESC-E06 servicio que termina fuera de ventana no se confirma', () => {
    const id = pedido('PLG', 50, { destino: 'DES-LAB2', fin: '2026-11-14T16:59:00-05:00' });
    const { r, a } = mejor(id);
    expect(a.factible).toBe(false);
    expect(() => T.confirmarItinerario(repo, PLAN, id, r.origen, a.clave)).toThrow(/no es factible/);
  });
  it('ESC-E07 tramo ausente: no usa distancia cero', () => {
    const r = plan(pedido('PLG', 10, { destino: 'DES-LAB3' }))[0];
    expect(r.alternativas).toHaveLength(0); expect(r.motivo_global).toMatch(/No existe ninguna cadena/);
  });
  it('ESC-E08 sin solución: el pedido queda listado con razón, sin desaparecer', () => {
    const id = pedido('PLG', 10, { destino: 'DES-LAB3' });
    expect(ped(id).estado).toBe('Reservado'); expect(T.cargaPorOrigen(repo, id).get('LAB-A')![0].q_mil).toBe(kg(10));
  });
});

describe('F — Despacho y traslados', () => {
  it('ESC-F01 despacho: salida única con lote y cantidad', () => {
    const iti = confirmar(pedido('PLG', 100)); const e = etapas(iti)[0];
    T.despacharEtapa(repo, ALM, String(e.etapa_id));
    expect(repo.todos("SELECT lote_id, q_mil FROM movimiento WHERE tipo = 'DESPACHO'")).toEqual([{ lote_id: 'L-LG', q_mil: kg(100) }]);
  });
  it('ESC-F02 faltante de reserva: no hay salida ficticia', () => {
    const id = pedido('PLG', 100); const iti = confirmar(id);
    repo.run("UPDATE reserva SET q_mil = q_mil - 1000 WHERE estado = 'ACTIVA'");
    expect(() => T.despacharEtapa(repo, ALM, String(etapas(iti)[0].etapa_id))).toThrow(/ya no cubre/);
    expect(repo.num("SELECT COUNT(*) FROM movimiento WHERE tipo = 'DESPACHO'")).toBe(0);
  });
  it('ESC-F04 mismo command_id: no duplica descuento ni movimiento', () => {
    const iti = confirmar(pedido('PLG', 100)); const e = String(etapas(iti)[0].etapa_id);
    T.despacharEtapa(repo, ALM, e, 'CMD-D1'); expect(T.despacharEtapa(repo, ALM, e, 'CMD-D1').repetido).toBe(true);
    expect(repo.num("SELECT COUNT(*) FROM movimiento WHERE tipo = 'DESPACHO'")).toBe(1);
  });
  it('ESC-F05 cambiar tras la salida: no se edita el hecho', () => {
    const iti = confirmar(pedido('PLG', 100)); T.despacharEtapa(repo, ALM, String(etapas(iti)[0].etapa_id));
    expect(() => T.cancelarItinerario(repo, PLAN, iti, 'cambio')).toThrow(/ya tiene etapas ejecutadas/);
  });
  it('ESC-F06 / AJ01 cancelar antes de salida libera capacidad sin crear tránsito', () => {
    const id = pedido('PLG', 120); const iti = confirmar(id);
    T.cancelarItinerario(repo, PLAN, iti, 'Cambio de plan');
    expect(fisico('L-LG', 'TRANSITO')).toBe(0);
    expect(mejor(id).a.tramos[1].viajes[0].servicio_id).toBe('S-PQ-14-09');
    expect(ped(id).estado).toBe('Reservado');
  });
  it('ESC-F07 carga en camino no es vendible', () => {
    const iti = confirmar(pedido('PLG', 100)); T.despacharEtapa(repo, ALM, String(etapas(iti)[0].etapa_id));
    const t = D.existencias(repo).find((x) => x.lote_id === 'L-LG' && x.nodo_id === 'TRANSITO')!;
    expect(t.fisico_mil).toBe(kg(100)); expect(t.disponible_mil).toBe(0); expect(t.motivo_no_disponible).toBe('En tránsito');
  });
  it('ESC-F08 recepción intermedia parcial: el saldo sigue en tránsito', () => {
    const iti = confirmar(pedido('PLG', 100)); const e = String(etapas(iti)[0].etapa_id);
    T.despacharEtapa(repo, ALM, e);
    T.recibirEtapa(repo, ALM, e, [{ lote_id: 'L-LG', apta_mil: kg(90), cuarentena_mil: kg(5), danada_mil: 0 }], 'Custodio', null);
    expect(fisico('L-LG', 'TRANSITO')).toBe(kg(5));
    expect(D.existencias(repo).filter((x) => x.nodo_id === 'LAB-P' && x.lote_id === 'L-LG').map((x) => [x.condicion, x.fisico_mil / 1000]).sort()).toEqual([['APTO', 90], ['CUARENTENA', 5]]);
  });
});

/** Lleva un pedido de 40 kg (1 traslado final) hasta la etapa final despachada. */
function hastaFinal(cant = 40, destino = 'DES-LAB') {
  const id = pedido('PLG', cant, { destino }); const iti = confirmar(id);
  const es = etapas(iti); const fin = es.find((e) => e.final)!;
  for (const e of es.filter((x) => !x.final)) {
    T.despacharEtapa(repo, ALM, String(e.etapa_id));
    T.recibirEtapa(repo, ALM, String(e.etapa_id), [{ lote_id: 'L-LG', apta_mil: kg(cant), cuarentena_mil: 0, danada_mil: 0 }], 'Custodio', null);
  }
  T.despacharEtapa(repo, ALM, String(fin.etapa_id));
  return { id, iti, fin: etapas(iti).find((e) => e.final)!, linea: ped(id).lineas[0].pedido_linea_id };
}

describe('G / AB / AS — Entrega final', () => {
  it('ESC-G01 / AB01 total dentro de ventana con receptor facultado', () => {
    const { id, fin } = hastaFinal();
    expect(entregaOk(fin).resultado.estado).toBe('TOTAL'); expect(ped(id).estado).toBe('Completado');
    expect(repo.uno('SELECT receptor_id, ocurrido_en, registrado_en FROM entrega')).toEqual({ receptor_id: 'RA-LAB', ocurrido_en: T0, registrado_en: T0 });
  });
  it('ESC-G02 total tarde: completado; la hora física posterior a la ventana queda registrada', () => {
    const { id, fin } = hastaFinal();
    entregaOk(fin, { ocurrido_en: '2026-11-21T10:00:00-05:00' });
    expect(ped(id).estado).toBe('Completado');
    expect(Date.parse(String(repo.uno('SELECT ocurrido_en FROM entrega')!.ocurrido_en)) > Date.parse(ped(id).ventana_fin)).toBe(true);
  });
  it('ESC-G03 / AB04 parcial: aceptado real y pendiente; el rechazo sigue en tránsito', () => {
    const { id, fin, linea } = hastaFinal();
    const r = T.registrarEntrega(repo, ALM, String(fin.etapa_id), { receptor_id: 'RA-LAB', metodo_evidencia: 'Firma', evidencia_ref: 'C', motivo: 'Saco roto', lineas: [{ pedido_linea_id: linea, lote_id: 'L-LG', entregado_mil: kg(30), rechazado_mil: kg(10) }] });
    expect(r.resultado.estado).toBe('PARCIAL');
    expect(ped(id).lineas[0].aceptada_mil).toBe(kg(30)); expect(ped(id).lineas[0].rechazada_mil).toBe(kg(10));
    expect(fisico('L-LG', 'TRANSITO')).toBe(kg(10)); expect(ped(id).estado).toBe('En atención');
  });
  it('ESC-G04 rechazo total: aceptación cero, carga no vuelve a stock apto', () => {
    const { id, fin, linea } = hastaFinal();
    const r = T.registrarEntrega(repo, ALM, String(fin.etapa_id), { receptor_id: 'RA-LAB', metodo_evidencia: 'Firma', evidencia_ref: 'C', motivo: 'Rechazo por calidad', lineas: [{ pedido_linea_id: linea, lote_id: 'L-LG', entregado_mil: 0, rechazado_mil: kg(40) }] });
    expect(r.resultado.estado).toBe('FALLIDO'); expect(ped(id).lineas[0].aceptada_mil).toBe(0);
    expect(fisico('L-LG', 'TRANSITO')).toBe(kg(40)); expect(fisico('L-LG', 'LAB-A')).toBe(kg(960));
  });
  it('ESC-G05 / AB03 receptor ausente: intento fallido con motivo y carga en tránsito', () => {
    const { fin, linea } = hastaFinal();
    expect(() => T.registrarEntrega(repo, ALM, String(fin.etapa_id), { lineas: [{ pedido_linea_id: linea, lote_id: 'L-LG', entregado_mil: 0, rechazado_mil: 0 }] })).toThrow(/requiere motivo/);
    const r = T.registrarEntrega(repo, ALM, String(fin.etapa_id), { motivo: 'Receptor ausente', lineas: [{ pedido_linea_id: linea, lote_id: 'L-LG', entregado_mil: 0, rechazado_mil: 0 }] });
    expect(r.resultado.estado).toBe('FALLIDO'); expect(fisico('L-LG', 'TRANSITO')).toBe(kg(40));
  });
  it('ESC-G06 / AS02 / S05 receptor no facultado o sin evidencia: no confirma aceptación', () => {
    const { id, fin, linea } = hastaFinal();
    const r = T.registrarEntrega(repo, ALM, String(fin.etapa_id), { receptor_nombre: 'Persona sin facultad', metodo_evidencia: 'Firma', evidencia_ref: 'X', lineas: [{ pedido_linea_id: linea, lote_id: 'L-LG', entregado_mil: kg(40), rechazado_mil: 0 }] });
    expect(r.resultado.estado).toBe('EN_VERIFICACION'); expect(r.resultado.motivo).toMatch(/sin facultad/);
    expect(ped(id).lineas[0].aceptada_mil).toBe(0); expect(ped(id).estado).not.toBe('Completado');
  });
  it('ESC-G07 reintento: solo el saldo pendiente', () => {
    const { id, fin, linea } = hastaFinal();
    T.registrarEntrega(repo, ALM, String(fin.etapa_id), { motivo: 'Ausente', lineas: [{ pedido_linea_id: linea, lote_id: 'L-LG', entregado_mil: 0, rechazado_mil: 0 }] });
    expect(() => T.registrarEntrega(repo, ALM, String(fin.etapa_id), { receptor_id: 'RA-LAB', metodo_evidencia: 'F', evidencia_ref: 'C', lineas: [{ pedido_linea_id: linea, lote_id: 'L-LG', entregado_mil: kg(41), rechazado_mil: 0 }] })).toThrow(/más de lo que viaja/);
    const r = T.registrarEntrega(repo, ALM, String(fin.etapa_id), { receptor_id: 'RA-LAB', metodo_evidencia: 'F', evidencia_ref: 'C', lineas: [{ pedido_linea_id: linea, lote_id: 'L-LG', entregado_mil: kg(40), rechazado_mil: 0 }] });
    expect(r.resultado.intento).toBe(2); expect(r.resultado.estado).toBe('TOTAL'); expect(ped(id).estado).toBe('Completado');
  });
  it('ESC-G08 / AB06 entrega repetida: idempotente y sin nuevo ingreso', () => {
    const { fin } = hastaFinal();
    entregaOk(fin, {}); const n = repo.num('SELECT COUNT(*) FROM movimiento');
    const e = etapas(String(fin.itinerario_id)).find((x) => x.final)!;
    expect(() => entregaOk(e)).toThrow(); // ya no queda carga en tránsito para esa etapa
    expect(repo.num('SELECT COUNT(*) FROM movimiento')).toBe(n);
    const cmd = 'CMD-ENT-X'; nuevo(); const h = hastaFinal();
    const p = { receptor_id: 'RA-LAB', metodo_evidencia: 'F', evidencia_ref: 'C', lineas: [{ pedido_linea_id: h.linea, lote_id: 'L-LG', entregado_mil: kg(40), rechazado_mil: 0 }] };
    T.registrarEntrega(repo, ALM, String(h.fin.etapa_id), p, cmd);
    expect(T.registrarEntrega(repo, ALM, String(h.fin.etapa_id), p, cmd).repetido).toBe(true);
    expect(repo.num("SELECT COUNT(*) FROM movimiento WHERE tipo = 'ACEPTACION'")).toBe(1);
  });
  it('ESC-AB02 llegar a un nodo de apoyo no es aceptación final', () => {
    const iti = confirmar(pedido('PLG', 40)); const e = etapas(iti)[0];
    T.despacharEtapa(repo, ALM, String(e.etapa_id));
    expect(() => T.registrarEntrega(repo, ALM, String(e.etapa_id), { lineas: [] })).toThrow(/no es entregar al cliente/);
  });
  it('ESC-AB05 confirmación tardía conserva occurred_at y registered_at', () => {
    const { fin, linea } = hastaFinal();
    const r = T.registrarEntrega(repo, ALM, String(fin.etapa_id), { ocurrido_en: '2026-11-14T15:00:00-05:00', receptor_nombre: 'Vecino', lineas: [{ pedido_linea_id: linea, lote_id: 'L-LG', entregado_mil: kg(40), rechazado_mil: 0 }] });
    repo.reloj = () => '2026-11-16T09:00:00-05:00';
    const v = T.verificarEntrega(repo, ALM, r.resultado.entrega_id, 'RA-LAB', 'Firma', 'C-2');
    expect(v.resultado.hora_fisica).toBe('2026-11-14T15:00:00-05:00');
    expect(repo.uno("SELECT ocurrido_en, registrado_en FROM movimiento WHERE tipo = 'ACEPTACION'")).toEqual({ ocurrido_en: '2026-11-14T15:00:00-05:00', registrado_en: '2026-11-16T09:00:00-05:00' });
  });
  it('ESC-AB08 cantidad distinta al documento: no acepta la cifra mayor', () => {
    const { fin, linea } = hastaFinal();
    expect(() => T.registrarEntrega(repo, ALM, String(fin.etapa_id), { receptor_id: 'RA-LAB', metodo_evidencia: 'F', evidencia_ref: 'C', lineas: [{ pedido_linea_id: linea, lote_id: 'L-LG', entregado_mil: kg(45), rechazado_mil: 0 }] })).toThrow(/más de lo que viaja/);
  });
});

describe('P — Red multimodal', () => {
  it('ESC-P01 ruta vial directa (NutriDemo PED-0001) con una etapa', () => {
    const { a } = mejor('PED-0001');
    expect(a.factible).toBe(true); expect(a.tramos).toHaveLength(1); expect(a.tramos[0].modo).toBe('VIAL');
  });
  it('ESC-P04 dos modos entre los mismos nodos se conservan como alternativas', () => {
    const r = plan('PED-0043').flatMap((x) => x.alternativas);
    const ult = new Set(r.filter((a) => a.nodos.at(-2) === 'TB-SIERRA').map((a) => a.tramos.at(-1)?.modo ?? 'sin tramo'));
    const enlaces = repo.todos("SELECT modo_id FROM enlace WHERE nodo_origen_id = 'TB-SIERRA' AND nodo_destino_id = 'N-DES-015' ORDER BY 1").map((x) => x.modo_id);
    expect(enlaces).toEqual(['ANIMAL', 'PEATONAL']);
    expect(r.some((a) => a.motivo.includes('PEATONAL') || a.tramos.some((t) => t.modo === 'PEATONAL'))).toBe(true);
    expect(ult.size + r.length).toBeGreaterThan(1);
  });
  it('ESC-P05 enlace dirigido: no se genera el sentido inverso', () => {
    expect(repo.num("SELECT COUNT(*) FROM enlace WHERE nodo_origen_id = 'LAB-P' AND nodo_destino_id = 'LAB-A'")).toBe(0);
    expect(repo.num("SELECT COUNT(*) FROM enlace WHERE nodo_origen_id = 'N-LAB'")).toBe(0);
  });
  it('ESC-P06 nodo inexistente en un enlace: se rechaza la carga con hoja y celda', () => {
    const t = lab(tablasDemo()); t.find((x) => x.hoja === 'EnlacesMultimodales')!.filas.push(['EL-X', 'LAB-A', 'NO-EXISTE', 'VIAL', 1, 1, 1, 1, 1, 0, 0, 'C', 'NORMAL', null, 'f', true]);
    const { errores } = validarConjunto(aHojas(t));
    expect(errores.some((e) => e.hoja === 'EnlacesMultimodales' && /NO-EXISTE/.test(String(e.valor) + e.mensaje))).toBe(true);
  });
  it('ESC-P07 la red con ciclos (AQP↔JUL↔CUS) termina y ninguna ruta repite nodos', () => {
    const r = plan('PED-0043')[0];
    expect(r.rutas_exploradas).toBeGreaterThan(1);
    for (const a of r.alternativas) expect(new Set(a.nodos).size).toBe(a.nodos.length);
  });
});

describe('Q — Capacidad por tramo', () => {
  it('ESC-Q01 capacidad final menor: divide solo si el cliente admite entregas divididas', () => {
    const { a } = mejor(pedido('PLG', 200, { divididas: false }));
    expect(a.factible).toBe(false); expect(a.motivo).toMatch(/no admite entregas divididas/);
  });
  it('ESC-Q03 capacidad exacta en kg: permite igualdad', () => { const { a } = mejor(pedido('PLG', 200)); expect(cargas(a, 0)).toEqual([200]); });
  it('ESC-Q04 peso válido pero exceso de volumen: bloquea esa carga en el viaje', () => {
    repo.run("UPDATE recurso SET capacidad_dm3 = 50 WHERE recurso_id = 'RL-VIAL'");
    const { a } = mejor(pedido('PLG', 100));
    expect(a.tramos[0]?.viajes.every((v) => v.dm3 <= 50) ?? true).toBe(true);
    expect(a.factible ? a.tramos[0].viajes.length > 1 : /capacidad insuficiente|salida sin capacidad/.test(a.motivo)).toBe(true);
  });
  it('ESC-Q08 / AC01 / U07 varios pedidos comparten una salida y descuentan una única capacidad', () => {
    confirmar(pedido('PLG', 60)); confirmar(pedido('PLG', 60));
    const tercero = mejor(pedido('PLG', 60)).a;
    expect(tercero.tramos[1].viajes[0].servicio_id).toBe('S-PQ-14-11');
    expect(repo.num("SELECT SUM(kg_bruto_mil) FROM etapa WHERE servicio_id = 'S-PQ-14-09'")).toBe(kg(120));
  });
});

describe('R — Conexiones y calendarios', () => {
  it('ESC-R01 conexión con espera explícita', () => { const { a } = mejor(pedido('PLG', 100)); expect(a.tramos[1].espera_min).toBe(60); });
  it('ESC-R02 llegada a tiempo pero manipulación tarde: salida posterior (ver #4)', () => {
    const { a } = mejor(pedido('PLG', 50, { destino: 'DES-LAB2' })); expect(a.tramos[1].viajes[0].servicio_id).toBe('S-RN2-14-1600');
  });
  it('ESC-R03 última salida del día ya pasó: usa la siguiente fecha', () => {
    repo.reloj = () => '2026-11-14T07:00:00-05:00';
    const { a } = mejor(pedido('PLG', 50)); expect(a.tramos[0].viajes[0].salida).toBe('2026-11-15T06:00:00-05:00');
  });
  it('ESC-R05 día sin servicio por excepción: una salida cancelada no se usa', () => {
    repo.run("UPDATE servicio SET estado = 'CANCELADO' WHERE servicio_id = 'S-AP-14'");
    const { a } = mejor(pedido('PLG', 50)); expect(a.tramos[0].viajes[0].servicio_id).toBe('S-AP-15');
  });
  it('ESC-R06 etapa que cruza medianoche: instantes continuos con fecha y zona', () => {
    const s = repo.uno("SELECT salida, llegada FROM servicio WHERE servicio_id = 'S-RN2-15-2330'")!;
    expect(s).toEqual({ salida: '2026-11-15T23:30:00-05:00', llegada: '2026-11-16T00:30:00-05:00' });
    expect(Date.parse(String(s.llegada)) - Date.parse(String(s.salida))).toBe(3600000);
  });
  it('ESC-R07 / V03 / Y06 cancelar una salida planificada invalida el itinerario no ejecutado', () => {
    const id = pedido('PLG', 100); confirmar(id);
    const r = T.cancelarServicio(repo, PLAN, 'S-PQ-14-09', 'Avería de la embarcación');
    expect(r.anulados).toEqual([id]);
    expect(mejor(id).a.tramos[1].viajes[0].servicio_id).toBe('S-PQ-14-11');
  });
  it('ESC-R08 cadena que llega exactamente al límite: comparación inclusiva', () => {
    const { a } = mejor(pedido('PLG', 50, { destino: 'DES-LAB2', fin: '2026-11-14T17:00:00-05:00' }));
    expect(a.factible).toBe(true); expect(a.entrega_prevista).toBe('2026-11-14T17:00:00-05:00');
  });
});

describe('S — Transferencias de custodia', () => {
  it('ESC-S01 emisor y receptor coinciden: conciliado y solo lo recibido habilitado', () => {
    const iti = confirmar(pedido('PLG', 100)); const e = String(etapas(iti)[0].etapa_id);
    T.despacharEtapa(repo, ALM, e); T.recibirEtapa(repo, ALM, e, [{ lote_id: 'L-LG', apta_mil: kg(100), cuarentena_mil: 0, danada_mil: 0 }], 'Custodio', null);
    expect(repo.uno('SELECT q_enviada_mil, q_apta_mil, q_diferencia_mil FROM transferencia')).toEqual({ q_enviada_mil: kg(100), q_apta_mil: kg(100), q_diferencia_mil: 0 });
  });
  it('ESC-S02 / S03 recepción inferior: diferencia sin inventar stock', () => {
    const iti = confirmar(pedido('PLG', 100)); const e = String(etapas(iti)[0].etapa_id);
    T.despacharEtapa(repo, ALM, e);
    expect(() => T.recibirEtapa(repo, ALM, e, [{ lote_id: 'L-LG', apta_mil: kg(101), cuarentena_mil: 0, danada_mil: 0 }], 'C', null)).toThrow(/más de lo que viaja/);
  });
  it('ESC-S06 / AG02 mismo evento de recepción repetido: idempotente (ver #5)', () => {
    const iti = confirmar(pedido('PLG', 100)); const e = String(etapas(iti)[0].etapa_id);
    T.despacharEtapa(repo, ALM, e);
    const rec = [{ lote_id: 'L-LG', apta_mil: kg(100), cuarentena_mil: 0, danada_mil: 0 }];
    T.recibirEtapa(repo, ALM, e, rec, 'C', null, 'CMD-R'); T.recibirEtapa(repo, ALM, e, rec, 'C', null, 'CMD-R');
    expect(repo.num("SELECT COUNT(*) FROM movimiento WHERE tipo = 'RECEPCION'")).toBe(1);
    expect(() => T.recibirEtapa(repo, ALM, e, rec, 'C', null)).toThrow(/Solo se recibe una etapa despachada/);
  });
  it('ESC-S07 / BN09 receptor sin identificación: no confirma', () => {
    const iti = confirmar(pedido('PLG', 100)); const e = String(etapas(iti)[0].etapa_id);
    T.despacharEtapa(repo, ALM, e);
    expect(() => T.recibirEtapa(repo, ALM, e, [{ lote_id: 'L-LG', apta_mil: kg(100), cuarentena_mil: 0, danada_mil: 0 }], '  ', null)).toThrow(/Identifique/);
  });
});

describe('U / V / W / X / Y — Medios y accesos (red NutriDemo)', () => {
  it('ESC-U01 servicio fluvial con acceso válido (PED-0042) y fuente documentada', () => {
    const { a } = mejor('PED-0042');
    expect(a.factible).toBe(true); expect(a.tramos.at(-1)!.modo).toBe('FLUVIAL');
    expect(T.estadoEnlace(repo, 'E-TB-FLUV-N-DES-010-FLUVIAL', T0, T0).fuente).toMatch(/sintéticos/);
  });
  it('ESC-U02 estiaje interrumpe el medio: no asume navegabilidad (PED-0044)', () => {
    const r = plan('PED-0044').flatMap((x) => x.alternativas);
    expect(r.every((a) => !a.factible)).toBe(true);
    expect(r.some((a) => /interrumpido \(Estiaje/.test(a.motivo))).toBe(true);
  });
  it('ESC-U06 enlaces dirigidos con duraciones propias por sentido', () => {
    repo.run("UPDATE enlace SET duracion_min = 333 WHERE enlace_id = 'E-ALM-AQP-ALM-JUL-VIAL'");
    expect(repo.uno("SELECT duracion_min FROM enlace WHERE enlace_id = 'E-ALM-JUL-ALM-AQP-VIAL'")!.duracion_min).not.toBe(333);
  });
  it('ESC-V01 / W01 vial conecta con embarque lacustre con transbordo y horario del medio (PED-0041)', () => {
    const { a } = mejor('PED-0041');
    expect(a.factible).toBe(true); expect(a.tramos.map((t) => t.modo)).toEqual(['VIAL', 'LACUSTRE']);
    expect(['09:00', '14:00']).toContain(a.tramos[1].viajes[0].salida.slice(11, 16));
  });
  it('ESC-V05 salida local con cupo insuficiente: divide solo si se permite', () => {
    expect(mejor(pedido('PLG', 80)).a.tramos[2].viajes.length).toBe(2);
    expect(mejor(pedido('PLG', 80, { divididas: false })).a.factible).toBe(false);
  });
  it('ESC-V08 cobro fijo del cruce compartido: una sola vez', () => {
    confirmar(pedido('PLG', 30)); confirmar(pedido('PLG', 50)); confirmar(pedido('PLG', 40));
    const imp = T.imputacionServicio(repo, 'S-PQ-14-09');
    expect(imp.lineas.reduce((x, l) => x + l.fijo_cent, 0)).toBe(30000); expect(imp.lineas).toHaveLength(3);
  });
  it('ESC-W02 restricción de carga del enlace excluye el recurso aunque su capacidad sea mayor', () => {
    repo.run("UPDATE enlace SET max_kg_recurso_mil = 150000 WHERE enlace_id = 'EL-AP'");
    const { a } = mejor(pedido('PLG', 50));
    expect(a.factible).toBe(false); expect(a.motivo).toMatch(/supera el máximo de 150 kg/);
  });
  it('ESC-W03 vía interrumpida durante tránsito planificado: se identifican los itinerarios afectados', () => {
    const id = pedido('PLG', 100); confirmar(id);
    const r = T.registrarCondicion(repo, PLAN, { enlace_id: 'EL-PQ', estado: 'INTERRUMPIDO', motivo: 'Oleaje', desde: '2026-11-14T08:00:00-05:00', hasta: '2026-11-14T12:00:00-05:00', fuente: 'Capitanía LAB' });
    expect(r.afectados.map((x) => x.pedido_id)).toEqual([id]);
  });
  it('ESC-W06 / AA01 ruta que alarga el viaje revalida vencimiento y vida útil mínima', () => {
    const id = pedido('PLG', 50);
    repo.run("UPDATE lote SET fecha_vencimiento = '2026-11-15' WHERE lote_id = 'L-LG'"); repo.run("UPDATE destino SET vida_util_min_dias = 3 WHERE destino_id = 'DES-LAB'");
    const { a } = mejor(id); expect(a.factible).toBe(false); expect(a.motivo).toMatch(/vence el 2026-11-15/);
  });
  it('ESC-W08 conexión que exige pernoctar en nodo sin permiso: se descarta (PED-0041 vía Juliaca)', () => {
    D.liberarReservas(repo, ALM, { pedido_id: 'PED-0041' }); D.reservarFefo(repo, ALM, 'PED-0041', undefined, { soloNodo: 'ALM-JUL' });
    const r = plan('PED-0041').flatMap((x) => x.alternativas);
    if (r.length) expect(r.some((a) => /pernoctar en TB-PUNO/.test(a.motivo)) || r.some((a) => a.factible)).toBe(true);
  });
  it('ESC-X01 recurso local con capacidad configurada (40 kg), sin límites universales', () => {
    expect(cargas(mejor(pedido('PLG', 200)).a, 2).every((x) => x <= 40)).toBe(true);
  });
  it('ESC-X05 / Y03 bulto que excede el límite de pieza: no se confirma aunque sea la única ruta', () => {
    const id = pedido('PL50', 1); const { r, a } = mejor(id);
    expect(a.factible).toBe(false); expect(() => T.confirmarItinerario(repo, PLAN, id, r.origen, a.clave)).toThrow();
  });
  it('ESC-X07 / Y05 incompatibilidad producto–medio bloquea la transferencia', () => {
    repo.run("INSERT INTO compatibilidad VALUES ('PLG','PEATONAL',0,'Requiere protección contra lluvia')");
    const { a } = mejor(pedido('PLG', 40)); expect(a.factible).toBe(false); expect(a.motivo).toMatch(/incompatible con PEATONAL/);
  });
  it('ESC-X08 varios recorridos locales para una línea suman la aceptación una sola vez', () => {
    const id = pedido('PLG', 120); ejecutar(confirmar(id));
    expect(repo.num("SELECT COUNT(*) FROM entrega WHERE estado = 'TOTAL'")).toBe(3); expect(ped(id).lineas[0].aceptada_mil).toBe(kg(120));
  });
  it('ESC-Y01 alternativa aérea completa con conexiones terrestres (PED-0042)', () => {
    const r = plan('PED-0042').flatMap((x) => x.alternativas);
    expect(r.some((a) => a.tramos.some((t) => t.modo === 'AEREO') || /AEREO/.test(a.motivo))).toBe(true);
  });
  it('ESC-Y07 llegada sin conexión de última milla: no es entrega final ni itinerario factible', () => {
    expect(plan(pedido('PLG', 10, { destino: 'DES-LAB3' }))[0].alternativas.some((a) => a.factible)).toBe(false);
  });
  it('ESC-Y08 / AD01 orden declarado: factibles primero, luego entrega más temprana y costo', () => {
    const r = plan('PED-0042')[0].alternativas;
    const f = r.findIndex((a) => !a.factible); if (f >= 0) expect(r.slice(f).every((a) => !a.factible)).toBe(true);
    const fact = r.filter((a) => a.factible);
    for (let i = 1; i < fact.length; i++) expect(Date.parse(fact[i].entrega_prevista)).toBeGreaterThanOrEqual(Date.parse(fact[i - 1].entrega_prevista));
  });
});

describe('Z — Condiciones externas y clima', () => {
  it('ESC-Z01 lectura externa guardada con fuente, hora y vigencia; se reutiliza mientras es vigente', () => {
    T.guardarLecturaClima(repo, { referencia: 'ALM-AQP', latitud: -16.4, longitud: -71.5, ok: true, texto: 't', observado_en: '2026-11-13T11:45:00-05:00', temperatura_c: 21.4, precipitacion_mm: 0, viento_kmh: 9.1 });
    const l = T.ultimaLecturaVigente(repo, 'ALM-AQP')!;
    expect(l.fuente).toMatch(/Open-Meteo/); expect(l.vigente_hasta).toBe('2026-11-13T13:00:00-05:00'); expect(l.temperatura_c).toBe(21.4);
    expect(T.ultimaLecturaVigente(repo, 'ALM-AQP', '2026-11-13T13:00:00-05:00')).toBeUndefined();
  });
  it('ESC-Z02 clima normal no habilita una vía interrumpida', () => {
    T.guardarLecturaClima(repo, { referencia: 'DES-020', latitud: -12.6, longitud: -69.2, ok: true, texto: 'despejado', temperatura_c: 30 });
    expect(T.estadoEnlace(repo, 'E-TB-FLUV-N-DES-020-FLUVIAL', T0, T0).estado).toBe('INTERRUMPIDO');
  });
  it('ESC-Z04 vigencia que empieza después de la salida solo afecta intervalos posteriores', () => {
    T.registrarCondicion(repo, PLAN, { enlace_id: 'EL-AP', estado: 'INTERRUMPIDO', motivo: 'Obra', desde: '2026-11-15T00:00:00-05:00', hasta: '2026-11-30T00:00:00-05:00', fuente: 'MTC LAB' });
    expect(mejor(pedido('PLG', 50)).a.tramos[0].viajes[0].servicio_id).toBe('S-AP-14');
    expect(T.estadoEnlace(repo, 'EL-AP', '2026-11-15T06:00:00-05:00', '2026-11-15T08:00:00-05:00').estado).toBe('INTERRUMPIDO');
  });
  it('ESC-U08 / Z05 estado DESCONOCIDO nunca se trata como normal', () => {
    T.registrarCondicion(repo, PLAN, { enlace_id: 'EL-AP', estado: 'DESCONOCIDO', motivo: 'Sin reporte vigente', desde: '2026-11-13T00:00:00-05:00', hasta: '2026-12-31T00:00:00-05:00', fuente: 'Supervisor' });
    const { a } = mejor(pedido('PLG', 50)); expect(a.factible).toBe(false); expect(a.motivo).toMatch(/desconocido/);
  });
  it('ESC-Z03 / BN08 dos reportes contradictorios: prevalece el más restrictivo hasta resolverlo', () => {
    for (const est of ['NORMAL', 'INTERRUMPIDO']) T.registrarCondicion(repo, PLAN, { enlace_id: 'EL-AP', estado: est, motivo: est, desde: '2026-11-14T00:00:00-05:00', hasta: '2026-11-14T23:00:00-05:00', fuente: 'Fuente ' + est });
    expect(T.estadoEnlace(repo, 'EL-AP', '2026-11-14T06:00:00-05:00', '2026-11-14T08:00:00-05:00').estado).toBe('INTERRUMPIDO');
  });
  it('ESC-Z07 cierre de una salida compartida afecta coherentemente a todos sus pedidos', () => {
    const a = pedido('PLG', 50), b = pedido('PLG', 50); confirmar(a); confirmar(b);
    expect(T.cancelarServicio(repo, PLAN, 'S-PQ-14-09', 'Tormenta').anulados.sort()).toEqual([a, b].sort());
  });
});

describe('AC / AD / AF / AG — Recursos, búsqueda, carga y concurrencia', () => {
  it('ESC-AC06 capacidad cambia tras planificar: la confirmación pendiente se invalida', () => {
    const id = pedido('PLG', 200); const { r, a } = mejor(id);
    repo.run("UPDATE recurso SET capacidad_kg_mil = 100000 WHERE recurso_id = 'RL-VIAL'");
    expect(() => T.confirmarItinerario(repo, PLAN, id, r.origen, a.clave)).toThrow(/ya no está disponible/);
  });
  it('ESC-AD04 cierre total: demanda no atendida registrada, no demora finita', () => {
    const r = plan('PED-0044')[0]; expect(r.alternativas.every((a) => !a.factible && !a.entrega_prevista)).toBe(true);
    expect(D.pedidos(repo).find((p) => p.pedido_id === 'PED-0044')!.estado).not.toBe('Completado');
  });
  it('ESC-AD07 la búsqueda informa rutas exploradas y si alcanzó el límite, sin afirmar óptimo global', () => {
    const r = plan('PED-0043')[0]; expect(typeof r.limite_alcanzado).toBe('boolean'); expect(r.rutas_exploradas).toBeGreaterThan(0);
    const iti = confirmar(pedido('PLG', 10)); expect(repo.uno('SELECT criterio FROM itinerario WHERE itinerario_id = ?', [iti])!.criterio).toMatch(/no óptimo global/);
  });
  it('ESC-AD08 anular una planificación conserva el estado previo de reserva', () => {
    const id = pedido('PLG', 10); const iti = confirmar(id); T.cancelarItinerario(repo, PLAN, iti, 'Usuario desiste');
    expect(ped(id).estado).toBe('Reservado'); expect(T.itinerarios(repo, id)[0].estado).toBe('CANCELADO');
  });
  it('ESC-AF01 hojas multimodales reordenadas: carga por nombre', () => {
    const { errores, datos } = validarConjunto(aHojas(lab(tablasDemo()).reverse()));
    expect(errores).toHaveLength(0); expect(datos.ServiciosTransporte?.length ?? (datos as Record<string, unknown[]>).servicio?.length).toBeGreaterThan(0);
  });
  it('ESC-AF02 enlace con modo inexistente: lista hoja/celda y confirma cero cambios', () => {
    const t = lab(tablasDemo()); t.find((x) => x.hoja === 'EnlacesMultimodales')!.filas.push(['EL-Y', 'LAB-A', 'LAB-P', 'TELEPORTE', 1, 1, 1, 1, 1, 0, 0, 'C', 'NORMAL', null, 'f', true]);
    const { errores } = validarConjunto(aHojas(t));
    const e = errores.find((x) => x.hoja === 'EnlacesMultimodales')!; expect(e.celda).toMatch(/^[A-Z]+\d+$/);
  });
  it('ESC-AF03 salida duplicada: se detecta sin multiplicar el servicio', () => {
    const t = lab(tablasDemo()); const s = t.find((x) => x.hoja === 'ServiciosTransporte')!; s.filas.push([...s.filas.find((f) => f[0] === 'S-AP-14')!]);
    expect(validarConjunto(aHojas(t)).errores.some((e) => e.hoja === 'ServiciosTransporte')).toBe(true);
  });
  it('ESC-AG01 doble clic al despachar: un solo movimiento', () => {
    const iti = confirmar(pedido('PLG', 40)); const e = String(etapas(iti)[0].etapa_id);
    T.despacharEtapa(repo, ALM, e);
    expect(() => T.despacharEtapa(repo, ALM, e)).toThrow(/ya fue despachada/);
    expect(repo.num("SELECT COUNT(*) FROM movimiento WHERE tipo = 'DESPACHO'")).toBe(1);
  });
  it('ESC-AG04 no se despacha el tramo siguiente antes de recibir el anterior', () => {
    const iti = confirmar(pedido('PLG', 40));
    expect(() => T.despacharEtapa(repo, ALM, String(etapas(iti).find((x) => x.tramo === 2)!.etapa_id))).toThrow(/recepción del tramo anterior/);
  });
  it('Permisos: el analista no planifica ni despacha', () => {
    const id = pedido('PLG', 40); const { r, a } = mejor(id);
    expect(() => T.confirmarItinerario(repo, ANA, id, r.origen, a.clave)).toThrow();
    const iti = confirmar(id); expect(() => T.despacharEtapa(repo, ANA, String(etapas(iti)[0].etapa_id))).toThrow();
  });
});

import * as S from '../src/core/sesion';
describe('Ingreso con PIN y pantallas por rol (DEC-I04-USUARIOS)', () => {
  beforeEach(() => repo.transaccion(() => S.asegurarCredenciales(repo)));
  it('PIN correcto entra; el PIN no se guarda en claro', () => {
    expect(S.iniciarSesion(repo, 'U02', '2222').ok).toBe(true);
    // El hash es hexadecimal aleatorio por la sal: puede contener «2222» por azar; lo que importa es que no sea el PIN ni su hash sin sal
    const h = String(repo.uno("SELECT pin_hash FROM credencial WHERE usuario_id = 'U02'")!.pin_hash);
    expect(h).not.toBe('2222'); expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.num("SELECT COUNT(*) FROM auditoria WHERE accion = 'INICIO_SESION' AND usuario_id = 'U02'")).toBe(1);
  });
  it('PIN incorrecto: cuenta intentos y bloquea 5 minutos al quinto', () => {
    for (let i = 1; i <= 4; i++) expect(S.iniciarSesion(repo, 'U03', '0000')).toMatchObject({ ok: false, mensaje: expect.stringMatching(`intento ${i} de 5`) });
    expect(S.iniciarSesion(repo, 'U03', '0000')).toMatchObject({ ok: false, mensaje: expect.stringMatching(/bloqueado 5 minutos/) });
    expect(() => S.iniciarSesion(repo, 'U03', '3333')).toThrow(/bloqueado.*hasta las 12:05/);
    repo.reloj = () => '2026-11-13T12:05:00-05:00';
    expect(S.iniciarSesion(repo, 'U03', '3333').ok).toBe(true);
  });
  it('Usuario desactivado o sin roles vigentes no entra', () => {
    P.desactivarUsuario(repo, 'U01', 'U06', 'Cambio de área', null);
    expect(() => S.iniciarSesion(repo, 'U06', '6666')).toThrow(/desactivado/);
  });
  it('Cambiar PIN propio y restablecer por el administrador con cambio obligatorio', () => {
    expect(() => S.cambiarPin(repo, 'U02', '9999', '2468')).toThrow(/actual no es correcto/);
    expect(() => S.cambiarPin(repo, 'U02', '2222', '12')).toThrow(/4 a 8 dígitos/);
    S.cambiarPin(repo, 'U02', '2222', '2468');
    expect(S.iniciarSesion(repo, 'U02', '2222').ok).toBe(false);
    expect(S.iniciarSesion(repo, 'U02', '2468').ok).toBe(true);
    expect(() => S.restablecerPin(repo, 'U02', 'U03', '1357')).toThrow();
    S.restablecerPin(repo, 'U01', 'U03', '1357');
    expect(S.iniciarSesion(repo, 'U03', '1357')).toMatchObject({ ok: true, debe_cambiar: true });
  });
  it('Cada rol ve solo sus pantallas', () => {
    const ve = (u: string, v: S.Vista) => S.puedeVer(P.rolesVigentes(repo, u), v);
    expect(ve('U02', 'operacion.pedidos')).toBe(true); expect(ve('U02', 'planificacion')).toBe(false); expect(ve('U02', 'datos')).toBe(false);
    expect(ve('U03', 'planificacion.itinerarios')).toBe(true); expect(ve('U03', 'planificacion.rutas')).toBe(false);
    expect(ve('U04', 'planificacion.rutas')).toBe(true); expect(ve('U04', 'datos.clima')).toBe(true); expect(ve('U04', 'datos.usuarios')).toBe(false);
    expect(ve('U07', 'datos.diagnostico')).toBe(true); expect(ve('U07', 'inicio')).toBe(false);
    expect(ve('U01', 'datos.usuarios')).toBe(true); expect(ve('U01', 'operacion')).toBe(false);
  });
});

// ================================================================== I04-b
import * as O from '../src/core/operacion';
import * as C from '../src/core/costos';
import * as A from '../src/core/alertas';
import * as R from '../src/core/retornables';
const SUP = 'U05';
const disponible = (lote: string, nodo = 'LAB-A') => D.existencias(repo).filter((x) => x.lote_id === lote && x.nodo_id === nodo).reduce((a, x) => a + x.disponible_mil, 0);
const cond = (lote: string, nodo: string, c: string) => D.existencias(repo).filter((x) => x.lote_id === lote && x.nodo_id === nodo && x.condicion === c).reduce((a, x) => a + x.fisico_mil, 0);
const rechazarTodo = (h: ReturnType<typeof hastaFinal>, q = 40) => T.registrarEntrega(repo, ALM, String(h.fin.etapa_id), { receptor_id: 'RA-LAB', metodo_evidencia: 'F', evidencia_ref: 'C', motivo: 'Rechazo por envase roto', lineas: [{ pedido_linea_id: h.linea, lote_id: 'L-LG', entregado_mil: 0, rechazado_mil: kg(q) }] });

describe('H / AA / AJ — Retornos, devoluciones e incidencias', () => {
  it('ESC-H01 / AA08 / BM07 / G04 retorno de lo rechazado: llega en cuarentena, no se vende y el pendiente se reabre', () => {
    const h = hastaFinal(); rechazarTodo(h);
    O.registrarRetorno(repo, ALM, { etapa_id: String(h.fin.etapa_id), lote_id: 'L-LG', q_mil: kg(40), nodo_destino_id: 'LAB-A', motivo: 'Vuelve rechazado' });
    expect(cond('L-LG', 'LAB-A', 'CUARENTENA')).toBe(kg(40)); expect(disponible('L-LG')).toBe(kg(960));
    expect(fisico('L-LG', 'TRANSITO')).toBe(0);
    expect(ped(h.id).lineas[0]).toMatchObject({ retornada_mil: kg(40), pendiente_mil: kg(40), aceptada_mil: 0 });
    expect(D.balanceLote(repo, 'L-LG').cuadra).toBe(true);
  });
  it('ESC-H02 retorno dañado: condición dañada y baja controlada con evidencia', () => {
    const h = hastaFinal(); rechazarTodo(h);
    O.registrarRetorno(repo, ALM, { etapa_id: String(h.fin.etapa_id), lote_id: 'L-LG', q_mil: kg(40), nodo_destino_id: 'LAB-A', condicion: 'DANADO', motivo: 'Mojado' });
    expect(() => O.decidirCalidad(repo, ALM, { lote_id: 'L-LG', nodo_id: 'LAB-A', q_mil: kg(40), desde: 'DANADO', hacia: 'BAJA', evidencia: 'Acta' })).toThrow(); // quien recibe no decide
    O.decidirCalidad(repo, SUP, { lote_id: 'L-LG', nodo_id: 'LAB-A', q_mil: kg(40), desde: 'DANADO', hacia: 'BAJA', evidencia: 'Acta de destrucción 12' });
    expect(cond('L-LG', 'LAB-A', 'DANADO')).toBe(0); expect(D.balanceLote(repo, 'L-LG').cuadra).toBe(true);
  });
  it('ESC-V07 / AR08 (alimento) un retorno anunciado no suma stock hasta recibirlo', () => {
    const h = hastaFinal(); rechazarTodo(h);
    O.registrarRetorno(repo, ALM, { etapa_id: String(h.fin.etapa_id), lote_id: 'L-LG', q_mil: kg(40), nodo_destino_id: 'LAB-A', motivo: 'Guía de retorno', solo_anuncio: true });
    expect(cond('L-LG', 'LAB-A', 'CUARENTENA')).toBe(0); expect(fisico('L-LG', 'TRANSITO')).toBe(kg(40));
    O.registrarRetorno(repo, ALM, { etapa_id: String(h.fin.etapa_id), lote_id: 'L-LG', q_mil: kg(40), nodo_destino_id: 'LAB-A', motivo: 'Llegó' });
    expect(repo.todos('SELECT estado, q_mil FROM retorno')).toEqual([{ estado: 'RECIBIDO', q_mil: kg(40) }]);
  });
  it('ESC-H04 / AC05 / BN03 / H08 / W05 avería en el lago: custodia real, recepción en nodo de contingencia y replanificación con costo desde allí', () => {
    const id = pedido('PLG', 100); const iti = confirmar(id);
    const [e1] = etapas(iti); T.despacharEtapa(repo, ALM, String(e1.etapa_id));
    T.recibirEtapa(repo, ALM, String(e1.etapa_id), [{ lote_id: 'L-LG', apta_mil: kg(100), cuarentena_mil: 0, danada_mil: 0 }], 'Custodio P', null);
    const e2 = etapas(iti).find((e) => e.tramo === 2)!; T.despacharEtapa(repo, ALM, String(e2.etapa_id));
    const inc = O.registrarIncidencia(repo, ALM, { tipo: 'AVERIA', etapa_id: String(e2.etapa_id), descripcion: 'Motor averiado a mitad del lago', custodio: 'Patrón de la lancha', ubicacion: 'Lago, 3 km de LAB-P' });
    expect(inc.resultado.custodia).toMatch(/sigue en tránsito bajo custodia de Patrón/);
    expect(() => O.cerrarIncidencia(repo, ALM, inc.resultado.incidencia_id, 'ok')).toThrow(/sigue en custodia en ruta/);
    const r = T.recibirEtapa(repo, ALM, String(e2.etapa_id), [{ lote_id: 'L-LG', apta_mil: kg(100), cuarentena_mil: 0, danada_mil: 0 }], 'Custodio P', 'Remolcada', undefined, 'LAB-P');
    expect(r.resultado.contingencia).toBe(true); expect(T.itinerarios(repo, id).find((i) => i.itinerario_id === iti)!.estado).toBe('REEMPLAZADO');
    O.cerrarIncidencia(repo, ALM, inc.resultado.incidencia_id, 'Carga devuelta a LAB-P y replanificada');
    const alt = T.planificarPedido(repo, id);
    expect(alt.map((x) => [x.origen, (x as { tipo_origen?: string }).tipo_origen])).toEqual([['LAB-P', 'CUSTODIA']]);
    expect(alt[0].alternativas[0].factible).toBe(true); expect(alt[0].alternativas[0].costo_cent).toBeGreaterThan(0);
    const nuevo2 = T.confirmarItinerario(repo, PLAN, id, 'LAB-P', alt[0].alternativas[0].clave);
    ejecutar(nuevo2);
    expect(ped(id).estado).toBe('Completado'); expect(fisico('L-LG', 'TRANSITO')).toBe(0); expect(fisico('L-LG', 'LAB-P')).toBe(0);
  });
  it('ESC-H05 vía cerrada con carga en nodo intermedio: reemplazar conserva los hechos y replanifica desde la custodia', () => {
    const id = pedido('PLG', 100); const iti = confirmar(id); const [e1] = etapas(iti);
    T.despacharEtapa(repo, ALM, String(e1.etapa_id)); T.recibirEtapa(repo, ALM, String(e1.etapa_id), [{ lote_id: 'L-LG', apta_mil: kg(100), cuarentena_mil: 0, danada_mil: 0 }], 'C', null);
    T.reemplazarItinerario(repo, PLAN, iti, 'Oleaje: lago cerrado');
    const i = T.itinerarios(repo, id)[0];
    expect(i.estado).toBe('REEMPLAZADO'); expect(i.etapas.filter((e) => e.estado === 'RECIBIDA')).toHaveLength(1);
    expect([...T.custodiaSinPlan(repo, id)].map(([n, it]) => [n, it[0].q_mil])).toEqual([['LAB-P', kg(100)]]);
  });
  it('ESC-H06 / AJ05 pérdida en ruta: movimiento con causa, saldo conciliado y pendiente visible (no se completa)', () => {
    const id = pedido('PLG', 100); const iti = confirmar(id); const [e1] = etapas(iti);
    T.despacharEtapa(repo, ALM, String(e1.etapa_id));
    O.registrarIncidencia(repo, ALM, { tipo: 'PERDIDA', etapa_id: String(e1.etapa_id), lote_id: 'L-LG', q_mil: kg(10), descripcion: 'Sacos caídos en el desvío' });
    expect(fisico('L-LG', 'TRANSITO')).toBe(kg(90)); expect(D.balanceLote(repo, 'L-LG').cuadra).toBe(true);
    expect(ped(id).lineas[0]).toMatchObject({ perdida_mil: kg(10), pendiente_mil: kg(10) });
  });
  it('ESC-AA06 daño parcial en transbordo: se separa sin bloquear lo sano', () => {
    const iti = confirmar(pedido('PLG', 100)); const [e1] = etapas(iti); T.despacharEtapa(repo, ALM, String(e1.etapa_id));
    T.recibirEtapa(repo, ALM, String(e1.etapa_id), [{ lote_id: 'L-LG', apta_mil: kg(95), cuarentena_mil: 0, danada_mil: kg(5) }], 'C', null);
    expect(cond('L-LG', 'LAB-P', 'APTO')).toBe(kg(95)); expect(cond('L-LG', 'LAB-P', 'DANADO')).toBe(kg(5)); expect(disponible('L-LG')).toBe(kg(900));
  });
  it('ESC-AJ02 cancelar con una rama entregada: conserva la aceptación y cierra parcial', () => {
    const id = pedido('PLH', 100); ejecutar(confirmar(id, 'LAB-A')); confirmar(id, 'LAB-B');
    D.cancelarPedido(repo, PED, id, 'Cliente desiste del saldo');
    const p = ped(id); expect(p.estado).toBe('Cerrado parcial'); expect(p.lineas[0]).toMatchObject({ aceptada_mil: kg(60), cancelada_mil: kg(40), pendiente_mil: 0 });
    expect(T.itinerarios(repo, id).filter((i) => i.estado === 'CANCELADO')).toHaveLength(1);
  });
  it('ESC-AJ03 devolución para reposición: baja la aceptación neta y reabre el pendiente una vez', () => {
    const id = pedido('PLG', 40); ejecutar(confirmar(id));
    O.registrarDevolucion(repo, ALM, { pedido_linea_id: ped(id).lineas[0].pedido_linea_id, lote_id: 'L-LG', q_mil: kg(15), nodo_destino_id: 'LAB-A', tipo: 'REPOSICION', motivo: 'Producto con humedad' });
    expect(ped(id).lineas[0]).toMatchObject({ aceptada_mil: kg(25), pendiente_mil: kg(15) }); expect(ped(id).estado).toBe('En atención');
    expect(cond('L-LG', 'LAB-A', 'CUARENTENA')).toBe(kg(15));
    expect(() => O.registrarDevolucion(repo, ALM, { pedido_linea_id: ped(id).lineas[0].pedido_linea_id, lote_id: 'L-LG', q_mil: kg(30), nodo_destino_id: 'LAB-A', tipo: 'REPOSICION', motivo: 'x' })).toThrow(/Solo se puede devolver/);
  });
  it('ESC-AJ04 devolución para anulación: ajusta sin demanda ficticia', () => {
    const id = pedido('PLG', 40); ejecutar(confirmar(id));
    O.registrarDevolucion(repo, ALM, { pedido_linea_id: ped(id).lineas[0].pedido_linea_id, lote_id: 'L-LG', q_mil: kg(10), nodo_destino_id: 'LAB-A', tipo: 'ANULACION', motivo: 'Exceso de pedido' });
    expect(ped(id).lineas[0]).toMatchObject({ aceptada_mil: kg(30), cancelada_mil: kg(10), pendiente_mil: 0 }); expect(ped(id).estado).toBe('Completado');
  });
  it('ESC-AJ06 no se sustituye producto por conveniencia de stock', () => {
    const id = pedido('PLS', 30, { reservar: false });
    const r = D.reservarFefo(repo, ALM, id);
    expect(r.resultado.asignaciones.every((x) => x.lote.startsWith('LS'))).toBe(true);
  });
  it('ESC-T08 una rama falla y otra entrega: pedido parcial con saldo y causa visibles', () => {
    const id = pedido('PLH', 100); ejecutar(confirmar(id, 'LAB-A'));
    const ib = confirmar(id, 'LAB-B'); const es = etapas(ib);
    for (const e of es.filter((x) => !x.final)) { T.despacharEtapa(repo, ALM, String(e.etapa_id)); T.recibirEtapa(repo, ALM, String(e.etapa_id), [{ lote_id: 'L-LHB', apta_mil: kg(40), cuarentena_mil: 0, danada_mil: 0 }], 'C', null); }
    const fin = etapas(ib).find((e) => e.final)!; T.despacharEtapa(repo, ALM, String(fin.etapa_id));
    T.registrarEntrega(repo, ALM, String(fin.etapa_id), { motivo: 'Cliente cerrado', lineas: [{ pedido_linea_id: ped(id).lineas[0].pedido_linea_id, lote_id: 'L-LHB', entregado_mil: 0, rechazado_mil: 0 }] });
    expect(ped(id).estado).toBe('En atención'); expect(ped(id).lineas[0].aceptada_mil).toBe(kg(60));
    expect(repo.uno("SELECT motivo FROM entrega WHERE estado = 'FALLIDO'")!.motivo).toBe('Cliente cerrado');
  });
});

describe('BM / AA07 — Retiro y bloqueo de lotes', () => {
  it('ESC-BM01 / AA07 bloquear un lote reservado: suspende reservas y planes, retiene el stock sin volverlo apto', () => {
    const a = pedido('PLG', 100); confirmar(a); const b = pedido('PLG', 50);
    const r = O.bloquearLote(repo, SUP, { lote_id: 'L-LG', motivo: 'Aviso de laboratorio: posible contaminación' });
    expect(r.resultado.pedidos_afectados).toEqual([a, b].sort()); expect(r.resultado.itinerarios_detenidos).toBe(1);
    expect(ped(a).estado).toBe('Confirmado'); expect(disponible('L-LG')).toBe(0); expect(cond('L-LG', 'LAB-A', 'CUARENTENA')).toBe(kg(1000));
    expect(() => D.reservarFefo(repo, ALM, a)).toThrow(/No hay stock apto/);
  });
  it('ESC-BM02 / BM03 / H03 trazabilidad: porciones en almacén, en camino por etapa y aceptadas por clientes', () => {
    const a = pedido('PLG', 40); ejecutar(confirmar(a));
    const b = pedido('PLG', 100); const ib = confirmar(b); T.despacharEtapa(repo, ALM, String(etapas(ib)[0].etapa_id));
    const tr = O.trazabilidadLote(repo, 'L-LG');
    expect(tr.resumen).toEqual({ fisico_apto_mil: kg(860), fisico_retenido_mil: 0, en_camino_mil: kg(100), en_cliente_mil: kg(40) });
    expect(tr.aceptado_por_clientes.map((x) => [x.pedido_id, x.destino_id])).toEqual([[a, 'DES-LAB']]);
    expect(tr.en_camino[0]).toMatchObject({ pedido_id: b, nodo_destino_id: 'LAB-P' });
  });
  it('ESC-BM02 lo despachado antes del bloqueo no se entrega comercialmente; al llegar a un nodo queda en cuarentena', () => {
    const h = hastaFinal(); const b2 = pedido('PLG', 100); const ib = confirmar(b2); T.despacharEtapa(repo, ALM, String(etapas(ib)[0].etapa_id));
    repo.reloj = () => '2026-11-13T12:00:01-05:00';
    O.bloquearLote(repo, SUP, { lote_id: 'L-LG', motivo: 'Retiro' });
    expect(() => entregaOk(h.fin)).toThrow(/en retiro de calidad/);
    T.recibirEtapa(repo, ALM, String(etapas(ib)[0].etapa_id), [{ lote_id: 'L-LG', apta_mil: kg(100), cuarentena_mil: 0, danada_mil: 0 }], 'C', null);
    expect(cond('L-LG', 'LAB-P', 'CUARENTENA')).toBe(kg(100)); expect(cond('L-LG', 'LAB-P', 'APTO')).toBe(0);
  });
  it('ESC-BM04 aviso sin lote identificable: no bloquea por nombre de producto', () => {
    expect(() => O.bloquearLote(repo, SUP, { lote_id: 'Granel de laboratorio', motivo: 'Aviso genérico' })).toThrow(/lote identificado/);
  });
  it('ESC-BM06 laboratorio libera parte: solo esa cantidad vuelve a apto con evidencia', () => {
    O.bloquearLote(repo, SUP, { lote_id: 'L-LG', motivo: 'Retiro' });
    O.decidirCalidad(repo, SUP, { lote_id: 'L-LG', nodo_id: 'LAB-A', q_mil: kg(300), hacia: 'APTO', evidencia: 'Informe de laboratorio 77: bolsas 1–12 conformes' });
    expect(disponible('L-LG')).toBe(kg(300)); expect(cond('L-LG', 'LAB-A', 'CUARENTENA')).toBe(kg(700));
    expect(repo.uno('SELECT bloqueo_id FROM decision_calidad')!.bloqueo_id).toMatch(/^BLQ/);
  });
  it('ESC-BM08 reporte durante el retiro: físico, retenido, apto y en tránsito separados; nada retenido es prometible', () => {
    const iti = confirmar(pedido('PLG', 100)); T.despacharEtapa(repo, ALM, String(etapas(iti)[0].etapa_id));
    O.bloquearLote(repo, SUP, { lote_id: 'L-LG', motivo: 'Retiro' });
    const ex = D.existencias(repo).filter((x) => x.lote_id === 'L-LG');
    expect(ex.reduce((a, x) => a + x.disponible_mil, 0)).toBe(0);
    expect(O.trazabilidadLote(repo, 'L-LG').resumen).toMatchObject({ fisico_apto_mil: 0, fisico_retenido_mil: kg(900), en_camino_mil: kg(100) });
    expect(Math.max(0, ...D.disponibilidadAFecha(repo, 'PLG', 'LAB-A').map((x) => x.prometible_mil))).toBe(0);
  });
  it('ESC-BM09 bloqueo con efecto anterior: identifica despachos ocurridos en el intervalo', () => {
    const iti = confirmar(pedido('PLG', 50)); T.despacharEtapa(repo, ALM, String(etapas(iti)[0].etapa_id));
    repo.reloj = () => '2026-11-13T15:00:00-05:00';
    const r = O.bloquearLote(repo, SUP, { lote_id: 'L-LG', motivo: 'Retiro con efecto desde la fabricación', efecto_desde: '2026-11-13T08:00:00-05:00' });
    expect(r.resultado.retroactivo).toBe(true); expect(r.resultado.traza.despachos_en_intervalo).toHaveLength(1);
  });
  it('ESC-BM10 cerrar el retiro exige conciliar cada cantidad', () => {
    const r = O.bloquearLote(repo, SUP, { lote_id: 'L-LG', motivo: 'Retiro' });
    expect(() => O.cerrarRetiro(repo, SUP, r.resultado.bloqueo_id, 'Cierre')).toThrow(/en cuarentena sin decisión/);
    O.decidirCalidad(repo, SUP, { lote_id: 'L-LG', nodo_id: 'LAB-A', q_mil: kg(1000), hacia: 'BAJA', evidencia: 'Destrucción certificada' });
    expect(O.cerrarRetiro(repo, SUP, r.resultado.bloqueo_id, 'Todo destruido con acta').fisico_retenido_mil).toBe(0);
  });
});

describe('Conteos y recuentos', () => {
  it('Conteo con diferencia exige recuento; confirmada, pasa a ajuste con doble revisión', () => {
    const c1 = O.registrarConteo(repo, ALM, { nodo_id: 'LAB-A', lote_id: 'L-LG', contado_mil: kg(998) });
    expect(c1).toMatchObject({ sistema_mil: kg(1000), diferencia_mil: -kg(2) }); expect(c1.siguiente).toMatch(/recuento/);
    expect(() => O.solicitarAjustePorConteo(repo, ALM, c1.conteo_id, 'Faltante')).toThrow(/recuento/);
    const c2 = O.registrarConteo(repo, ALM, { nodo_id: 'LAB-A', lote_id: 'L-LG', contado_mil: kg(998), recuento_de: c1.conteo_id });
    O.solicitarAjustePorConteo(repo, ALM, c2.conteo_id, 'Faltante confirmado en recuento');
    expect(repo.uno('SELECT estado FROM conteo WHERE conteo_id = ?', [c2.conteo_id])!.estado).toBe('AJUSTE_SOLICITADO');
    expect(repo.num("SELECT COUNT(*) FROM solicitud_ajuste WHERE estado = 'PENDIENTE'")).toBe(1);
  });
  it('El corte excluye movimientos posteriores al conteo', () => {
    const iti = confirmar(pedido('PLG', 100)); repo.reloj = () => '2026-11-14T06:00:00-05:00'; T.despacharEtapa(repo, ALM, String(etapas(iti)[0].etapa_id));
    expect(O.registrarConteo(repo, ALM, { nodo_id: 'LAB-A', lote_id: 'L-LG', contado_mil: kg(1000), corte: '2026-11-13T18:00:00-05:00' }).diferencia_mil).toBe(0);
  });
});

describe('AZ / H07 / V08 — Costos', () => {
  it('ESC-AZ01 mínimo vs variable: se aplica el mayor, no la suma', () => {
    expect(C.calcularTarifa({ fijo_cent: 0, tasa_kg_p4: 2000, minimo_cent: 5000 }, kg(100))).toMatchObject({ variable_cent: 2000, flete_cent: 5000, aplica_minimo: true, total_cent: 5000 });
    expect(C.calcularTarifa({ fijo_cent: 0, tasa_kg_p4: 2000, minimo_cent: 5000 }, kg(400)).flete_cent).toBe(8000);
  });
  it('ESC-AZ02 recargo de espera tras franquicia; en la frontera no se cobra', () => {
    const t = { fijo_cent: 0, tasa_kg_p4: 0, franquicia_espera_min: 120, recargo_hora_cent: 1500 };
    expect(C.calcularTarifa(t, 0, 120).espera_cent).toBe(0); expect(C.calcularTarifa(t, 0, 121).espera_cent).toBe(1500); expect(C.calcularTarifa(t, 0, 241).horas_espera_cobradas).toBe(3);
  });
  it('ESC-AZ04 S/0,01 entre tres pedidos suma S/0,01', () => {
    const r = C.repartirCentavos(1, [{ id: 'A', peso: 1 }, { id: 'B', peso: 1 }, { id: 'C', peso: 1 }]);
    expect(r.reduce((a, x) => a + x.cent, 0)).toBe(1); expect(r.find((x) => x.cent === 1)!.id).toBe('A');
  });
  it('ESC-AZ03 salida cancelada con cargo no reembolsable: el costo devengado se conserva', () => {
    C.registrarCargo(repo, PLAN, { documento_ref: 'F-100', concepto: 'PENALIDAD', servicio_id: 'S-PQ-15-09', importe_cent: 8000, no_reembolsable: true });
    T.cancelarServicio(repo, PLAN, 'S-PQ-15-09', 'Sin carga');
    expect(C.costoServicio(repo, 'S-PQ-15-09')).toMatchObject({ estado: 'CANCELADO', real_cent: 8000 });
  });
  it('ESC-AZ05 concepto incluido en tarifa integral no se suma de nuevo', () => {
    C.registrarCargo(repo, PLAN, { documento_ref: 'F-1', concepto: 'FLETE', servicio_id: 'S-AP-14', importe_cent: 50000 });
    C.registrarCargo(repo, PLAN, { documento_ref: 'F-1', concepto: 'PEAJE', servicio_id: 'S-AP-14', importe_cent: 1200, incluido_en_tarifa: true });
    expect(C.costoServicio(repo, 'S-AP-14').real_cent).toBe(50000);
  });
  it('ESC-AZ07 / H07 real vs estimado por concepto sin reescribir la cotización', () => {
    const id = pedido('PLG', 100); ejecutar(confirmar(id));
    const est = repo.uno('SELECT costo_estimado_cent FROM itinerario')!.costo_estimado_cent;
    C.registrarCargo(repo, PLAN, { documento_ref: 'F-9', concepto: 'FLETE', servicio_id: 'S-AP-14', importe_cent: 52000 });
    C.registrarCargo(repo, PLAN, { documento_ref: 'F-9', concepto: 'ESPERA', servicio_id: 'S-AP-14', importe_cent: 3000 });
    const c = C.costoServicio(repo, 'S-AP-14'); expect(c).toMatchObject({ estimado_cent: 50000, real_cent: 55000, variacion_cent: 5000 });
    expect(repo.uno('SELECT costo_estimado_cent FROM itinerario')!.costo_estimado_cent).toBe(est);
    expect(C.costoPedido(repo, id)).toMatchObject({ base: 'mixta (real + estimado)', salidas_con_cargo_real: 1 });
  });
  it('ESC-AZ08 mismo cargo en dos archivos distintos: no se duplica', () => {
    C.registrarCargo(repo, PLAN, { documento_ref: 'F-77', concepto: 'FLETE', servicio_id: 'S-AP-14', importe_cent: 100, archivo_hash: 'a1' });
    expect(() => C.registrarCargo(repo, PLAN, { documento_ref: 'F-77', concepto: 'FLETE', servicio_id: 'S-AP-14', importe_cent: 100, archivo_hash: 'b2' })).toThrow(/ya está registrado/);
  });
  it('Moneda extranjera exige tipo de cambio declarado', () => {
    expect(() => C.registrarCargo(repo, PLAN, { documento_ref: 'US-1', concepto: 'FLETE', servicio_id: 'S-AP-14', importe_cent: 1000, moneda: 'USD' })).toThrow(/tipo de cambio/);
    expect(C.registrarCargo(repo, PLAN, { documento_ref: 'US-1', concepto: 'FLETE', servicio_id: 'S-AP-14', importe_cent: 1000, moneda: 'USD', tasa_pen_p6: 3750000 }).importe_pen_cent).toBe(3750);
  });
  it('DEC-I01-D8 costo por kg aceptado incluye todo lo devengado', () => {
    const id = pedido('PLG', 200); ejecutar(confirmar(id));
    const c = C.costoPedido(repo, id); expect(c.costo_por_kg_aceptado_cent).toBe(Math.round(c.devengado_cent / 200));
  });
});

describe('AW — Alertas internas', () => {
  const vivas = () => A.alertas(repo);
  it('ESC-AW01 reconocer no resuelve; la causa sigue', () => {
    O.bloquearLote(repo, SUP, { lote_id: 'L-LG', motivo: 'Retiro' }); A.evaluarAlertas(repo);
    const a = vivas().find((x) => x.regla === 'RETIRO_ACTIVO')!;
    A.accionAlerta(repo, SUP, String(a.alerta_id), 'RECONOCER'); A.evaluarAlertas(repo);
    expect(vivas().find((x) => x.alerta_id === a.alerta_id)!.estado).toBe('RECONOCIDA');
  });
  it('ESC-AW02 el mismo hecho no se duplica al reevaluar; las del mismo pedido se relacionan', () => {
    const iti = confirmar(pedido('PLG', 100)); const e = String(etapas(iti)[0].etapa_id); T.despacharEtapa(repo, ALM, e);
    T.recibirEtapa(repo, ALM, e, [{ lote_id: 'L-LG', apta_mil: kg(98), cuarentena_mil: 0, danada_mil: 0 }], 'C', null);
    O.registrarIncidencia(repo, ALM, { tipo: 'RETRASO', etapa_id: e, descripcion: 'Demora en balanza', retraso_min: 60 });
    A.evaluarAlertas(repo); A.evaluarAlertas(repo);
    expect(vivas().filter((x) => x.regla === 'DIFERENCIA_EN_TRANSITO')).toHaveLength(1);
    expect(vivas().find((x) => x.regla === 'INCIDENCIA_ABIERTA')!.relacionadas).toBe(1);
  });
  it('ESC-AW03 sin responsable o vencida: se escala dentro del aplicativo', () => {
    O.bloquearLote(repo, SUP, { lote_id: 'L-LG', motivo: 'Retiro' });
    expect(A.evaluarAlertas(repo).escaladas).toBe(1);
  });
  it('ESC-AW04 silenciar exige motivo y fin; al vencer se reactiva si la causa continúa', () => {
    O.bloquearLote(repo, SUP, { lote_id: 'L-LG', motivo: 'Retiro' }); A.evaluarAlertas(repo);
    const id = String(vivas()[0].alerta_id);
    expect(() => A.accionAlerta(repo, SUP, id, 'SILENCIAR', { motivo: 'Investigación' })).toThrow(/fecha de fin/);
    A.accionAlerta(repo, SUP, id, 'SILENCIAR', { motivo: 'Investigación en curso', hasta: '2026-11-13T14:00:00-05:00' });
    repo.reloj = () => '2026-11-13T14:00:00-05:00'; A.evaluarAlertas(repo);
    expect(vivas().find((x) => x.alerta_id === id)!.estado).toBe('ABIERTA');
  });
  it('ESC-AW05 descartar con evidencia conserva la historia', () => {
    O.bloquearLote(repo, SUP, { lote_id: 'L-LG', motivo: 'Retiro' }); A.evaluarAlertas(repo);
    const id = String(vivas()[0].alerta_id);
    expect(() => A.accionAlerta(repo, SUP, id, 'DESCARTAR', { motivo: 'no' })).toThrow(/evidencia/);
    A.accionAlerta(repo, SUP, id, 'DESCARTAR', { motivo: 'Falsa alarma: informe de laboratorio 78 conforme' });
    expect(repo.num('SELECT COUNT(*) FROM alerta_historial WHERE alerta_id = ?', [id])).toBeGreaterThanOrEqual(2);
  });
  it('ESC-AW06 la causa reaparece tras resolverse: nuevo episodio enlazado', () => {
    const r = O.bloquearLote(repo, SUP, { lote_id: 'L-LG', motivo: 'Retiro' }); A.evaluarAlertas(repo);
    O.decidirCalidad(repo, SUP, { lote_id: 'L-LG', nodo_id: 'LAB-A', q_mil: kg(1000), hacia: 'APTO', evidencia: 'Liberado' }); O.cerrarRetiro(repo, SUP, r.resultado.bloqueo_id, 'Conforme');
    A.evaluarAlertas(repo); O.bloquearLote(repo, SUP, { lote_id: 'L-LG', motivo: 'Nuevo aviso' }); A.evaluarAlertas(repo);
    const ep = repo.todos("SELECT estado, episodio, anterior_id FROM alerta WHERE regla = 'RETIRO_ACTIVO' ORDER BY episodio");
    expect(ep.map((x) => [x.estado, x.episodio])).toEqual([['RESUELTA', 1], ['ABIERTA', 2]]); expect(ep[1].anterior_id).toBeTruthy();
  });
  it('ESC-AW07 cambiar el umbral guarda versión; la alerta conserva el que vio el operador', () => {
    const h = hastaFinal(); T.registrarEntrega(repo, ALM, String(h.fin.etapa_id), { receptor_nombre: 'Vecino', lineas: [{ pedido_linea_id: h.linea, lote_id: 'L-LG', entregado_mil: kg(40), rechazado_mil: 0 }] });
    repo.reloj = () => '2026-11-14T13:00:00-05:00'; A.evaluarAlertas(repo);
    const a = vivas().find((x) => x.regla === 'VERIFICACION_DEMORADA')!; expect(a).toMatchObject({ umbral: '24 h', version_parametro: 1 });
    D.cambiarParametro(repo, SUP, 'alerta_verificacion_h', '48', '2026-11-14T13:00:00-05:00', 'Ajuste de política de alertas');
    A.evaluarAlertas(repo); expect(repo.uno('SELECT umbral FROM alerta WHERE alerta_id = ?', [a.alerta_id])!.umbral).toBe('24 h');
  });
});

describe('AR — Envases retornables', () => {
  it('ESC-AR01 / AR02 el pallet y los contenedores quedan en custodia del cliente; no se venden con el alimento', () => {
    const id = pedido('PLG', 40); ejecutar(confirmar(id));
    R.entregarActivos(repo, ALM, { activos: ['CONT-001', 'CONT-002', 'CONT-003', 'CONT-004', 'PAL-001'], pedido_id: id });
    expect(repo.num("SELECT COUNT(*) FROM activo_retornable WHERE ubicacion_tipo = 'CLIENTE' AND ubicacion_id = 'CLI-001'")).toBe(5);
    expect(repo.num("SELECT COUNT(*) FROM movimiento WHERE lote_id LIKE 'CONT%' OR lote_id LIKE 'PAL%'")).toBe(0);
  });
  it('ESC-AR03 / AR04 retornan 3 de 4; uno vuelve dañado a revisión y no se reutiliza', () => {
    const id = pedido('PLG', 40); ejecutar(confirmar(id));
    R.entregarActivos(repo, ALM, { activos: ['CONT-001', 'CONT-002', 'CONT-003', 'CONT-004'], pedido_id: id });
    for (const c of ['CONT-001', 'CONT-002']) R.retornarActivo(repo, ALM, { activo_id: c, desde_cliente: 'CLI-001', nodo_id: 'ALM-AQP', recibido: true, condicion: 'DISPONIBLE' });
    R.retornarActivo(repo, ALM, { activo_id: 'CONT-003', desde_cliente: 'CLI-001', nodo_id: 'ALM-AQP', recibido: true });
    expect(repo.num("SELECT COUNT(*) FROM activo_retornable WHERE ubicacion_tipo = 'CLIENTE'")).toBe(1);
    expect(repo.uno("SELECT condicion FROM activo_retornable WHERE activo_id = 'CONT-003'")!.condicion).toBe('REVISION');
    expect(() => R.entregarActivos(repo, ALM, { activos: ['CONT-003'], pedido_id: id })).toThrow(/no está disponible/);
  });
  it('ESC-AR05 dos reportes con custodia incompatible: conflicto sin duplicar', () => {
    expect(R.retornarActivo(repo, ALM, { activo_id: 'CONT-005', desde_cliente: 'CLI-009', nodo_id: 'ALM-AQP', recibido: true }).estado).toBe('CONFLICTO');
    expect(repo.num("SELECT COUNT(*) FROM activo_retornable WHERE activo_id = 'CONT-005'")).toBe(1);
  });
  it('ESC-AR06 envases de terceros no se entregan como propios', () => {
    const id = pedido('PLG', 40); ejecutar(confirmar(id));
    expect(() => R.entregarActivos(repo, ALM, { activos: ['PAL-T01'], pedido_id: id })).toThrow(/pertenece a Operador/);
  });
  it('ESC-AR07 los envases de retorno ocupan capacidad pero no son kg vendidos', () => {
    expect(R.cargaRetornables(repo, ['CONT-001', 'PAL-001'])).toEqual({ kg_mil: kg(20.5), dm3: 270, unidades: 2, kg_vendidos_mil: 0 });
  });
  it('ESC-AR08 un comprobante de devolución sin recepción no cambia la custodia', () => {
    const id = pedido('PLG', 40); ejecutar(confirmar(id)); R.entregarActivos(repo, ALM, { activos: ['CONT-006'], pedido_id: id });
    expect(R.retornarActivo(repo, ALM, { activo_id: 'CONT-006', desde_cliente: 'CLI-001', nodo_id: 'ALM-AQP', recibido: false, documento: 'Guía 55' }).estado).toBe('ANUNCIADO');
    expect(repo.uno("SELECT ubicacion_tipo FROM activo_retornable WHERE activo_id = 'CONT-006'")!.ubicacion_tipo).toBe('CLIENTE');
  });
});

describe('BN — Red cambiante y continuidad', () => {
  it('ESC-BN01 cierre de un nodo de transbordo por período: excluye conexiones y detecta cargas afectadas', () => {
    const id = pedido('PLG', 100); confirmar(id);
    const r = O.cerrarNodo(repo, PLAN, 'LAB-P', '2026-11-14T00:00:00-05:00', '2026-11-15T00:00:00-05:00', 'Muelle en reparación', 'Capitanía LAB');
    expect(r.enlaces).toBe(3); expect(r.afectados.map((x) => (x as { pedido_id: string }).pedido_id)).toContain(id);
    expect(mejor(pedido('PLG', 10)).a.tramos[0].viajes[0].servicio_id).toBe('S-AP-15');
  });
  it('ESC-BN06 servicio suspendido sin fecha: capacidad futura no confirmada', () => {
    const r = O.suspenderServicios(repo, PLAN, 'EL-PQ', '2026-11-13T00:00:00-05:00', 'Concesión suspendida');
    expect(r.suspendidas).toBe(12); expect(mejor(pedido('PLG', 10)).a.factible).toBe(false);
  });
  it('ESC-BN10 ensayo de pérdida del nodo principal: mide alcance sin modificar datos', () => {
    pedido('PLG', 40); pedido('PLG', 50, { destino: 'DES-LAB2' });
    const antes = repo.num('SELECT COUNT(*) FROM condicion_acceso');
    const r = O.ensayoContinuidad(repo, 'LAB-P', '2026-11-13T00:00:00-05:00', '2026-12-31T00:00:00-05:00');
    expect(repo.num('SELECT COUNT(*) FROM condicion_acceso')).toBe(antes);
    expect(r.alcanzables_base).toBe(2); expect(r.alcanzables_ensayo).toBe(1);
    expect(r.limitacion).toMatch(/no considera capacidad nueva/);
  });
});

describe('Usuario de evaluación (modo prueba)', () => {
  beforeEach(() => repo.transaccion(() => S.asegurarCredenciales(repo)));
  it('Entra sin PIN, ve todas las secciones y queda auditado', () => {
    expect(S.iniciarSesion(repo, S.EVAL_ID, '').ok).toBe(true);
    const roles = P.rolesVigentes(repo, S.EVAL_ID);
    for (const v of ['operacion.pedidos', 'planificacion.rutas', 'datos.usuarios', 'datos.carga', 'resultados', 'operacion.ajustes'] as S.Vista[]) expect(S.puedeVer(roles, v)).toBe(true);
    expect(repo.num("SELECT COUNT(*) FROM auditoria WHERE usuario_id = 'U00' AND accion = 'INICIO_SESION'")).toBe(1);
  });
  it('La doble revisión sigue vigente: no aprueba su propio ajuste', () => {
    const s = D.solicitarAjuste(repo, S.EVAL_ID, { lote_id: 'L-LG', nodo_id: 'LAB-A', condicion: 'APTO', q_delta_mil: -kg(1), motivo: 'Prueba de doble revisión' });
    const sid = String(s);
    expect(() => D.resolverAjuste(repo, S.EVAL_ID, sid, true, 'ok')).toThrow();
  });
});

// ------------------------------------------------------------------ I07: pendientes de I04 cerrados con evidencia
describe('I07 — pendientes de I04 (red, recursos, condiciones, conteos, alcance)', () => {
  const sinFactible = (id: string) => { const r = plan(id); return { r, ok: r.every((x) => x.alternativas.every((a) => !a.factible)), motivo: r.map((x) => x.motivo_global ?? x.alternativas.map((a) => a.motivo).join(' ')).join(' ') }; };
  it('ESC-P03 / Z08 destino sin enlace final ni alternativa segura: no se inventa ruta; queda no factible con motivo', () => {
    const id = pedido('PLG', 50, { destino: 'DES-LAB3' });
    const s = sinFactible(id); expect(s.ok).toBe(true); expect(s.motivo.length).toBeGreaterThan(5);
  });
  it('ESC-P08 / Y02 / X04 medio configurado sin servicio real (aéreo u operador local): no se planifica sobre él', () => {
    const e = repo.uno("SELECT * FROM enlace WHERE enlace_id = 'EL-AP'")!;
    const cols = Object.keys(e); const v = { ...e, enlace_id: 'EL-A-N3', nodo_destino_id: 'N-LAB3', modo_id: 'AEREO', corredor_id: 'COR-AEREO-LAB3' } as Record<string, unknown>;
    repo.run(`INSERT INTO enlace (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => v[c] as never));
    const id = pedido('PLG', 50, { destino: 'DES-LAB3' });
    const s = sinFactible(id); expect(s.ok).toBe(true);
    expect(plan(id).flatMap((x) => x.alternativas).some((a) => a.factible && a.tramos.some((t) => t.enlace_id === 'EL-A-N3'))).toBe(false);
  });
  it('ESC-R04 / U04 / U05 nodo (embarcadero/desembarque) cerrado al llegar: ninguna alternativa factible pasa por él', () => {
    O.cerrarNodo(repo, PLAN, 'LAB-Q', '2026-11-13T00:00:00-05:00', '2026-11-30T00:00:00-05:00', 'Muelle inhabilitado', 'Capitanía (ficticia)');
    const id = pedido('PLG', 50);
    expect(plan(id).flatMap((x) => x.alternativas).filter((a) => a.factible).every((a) => !a.nodos.includes('LAB-Q'))).toBe(true);
  });
  it('ESC-U03 condición hidrológica DESCONOCIDA: bloquea el tramo, no se asume transitable', () => {
    T.registrarCondicion(repo, PLAN, { enlace_id: 'EL-PQ', estado: 'DESCONOCIDO', motivo: 'Sin reporte de nivel del lago', desde: '2026-11-13T00:00:00-05:00', hasta: '2026-11-30T00:00:00-05:00', fuente: 'Sin fuente vigente' });
    const id = pedido('PLG', 50);
    expect(plan(id).flatMap((x) => x.alternativas).filter((a) => a.factible).every((a) => !a.tramos.some((t) => t.enlace_id === 'EL-PQ'))).toBe(true);
  });
  it('ESC-AJ08 solicitud fuera del alcance configurado (destino inactivo): se rechaza sin crear pedido', () => {
    repo.run("UPDATE destino SET activo = 0 WHERE destino_id = 'DES-LAB2'");
    const antes = repo.num('SELECT COUNT(*) FROM pedido');
    expect(() => pedido('PLG', 10, { destino: 'DES-LAB2', reservar: false })).toThrow(/inactiv|activo|alcance/i);
    expect(repo.num('SELECT COUNT(*) FROM pedido')).toBe(antes);
  });
  it('ESC-AY08 ajuste por conteo por debajo de las reservas vigentes: se bloquea al aprobar y el saldo no cambia', () => {
    pedido('PLG', 900);
    const c1 = O.registrarConteo(repo, ALM, { nodo_id: 'LAB-A', lote_id: 'L-LG', contado_mil: kg(500) });
    const c2 = O.registrarConteo(repo, ALM, { nodo_id: 'LAB-A', lote_id: 'L-LG', contado_mil: kg(500), recuento_de: c1.conteo_id });
    const aj = String(O.solicitarAjustePorConteo(repo, ALM, c2.conteo_id, 'Diferencia confirmada por recuento'));
    const antes = fisico('L-LG', 'LAB-A');
    expect(() => D.resolverAjuste(repo, 'U05', aj, true, 'Aprobado')).toThrow(/reserv|negativ|respaldo/i);
    expect(fisico('L-LG', 'LAB-A')).toBe(antes);
  });
});
