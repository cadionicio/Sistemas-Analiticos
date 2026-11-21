// I08 — Revisión completa: casos que el registro I07 marcaba sin evidencia y que el sistema ya resuelve.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { Repo } from '../src/core/db';
import { validarConjunto } from '../src/core/contrato';
import { confirmarCarga } from '../src/core/carga';
import * as D from '../src/core/dominio';
import * as P from '../src/core/permisos';
import * as T from '../src/core/transporte';
import * as O from '../src/core/operacion';
import * as M from '../src/core/simulacion';
import * as E from '../src/core/economia';
import { aHojas } from '../src/core/demo';
import { tablasExcel06 } from '../src/core/historia';

let SQL: SqlJsStatic, repo: Repo;
let reloj = '2026-11-14T10:00:00-05:00';
const ALM = 'U03', PLA = 'U04';
beforeAll(async () => { SQL = await initSqlJs(); });
beforeEach(() => {
  reloj = '2026-11-14T10:00:00-05:00';
  repo = Repo.iniciar(new SQL.Database()); repo.reloj = () => reloj;
  P.asegurarUsuarios(repo); repo.transaccion(() => D.asegurarParametros(repo));
  const { datos } = validarConjunto(aHojas(tablasExcel06()));
  confirmarCarga(repo, 'U01', datos, { hash: 'h', nombre: '06', bytes: 0, datasetId: '06' });
});
const etapas = (iti: string) => T.itinerarios(repo).find((i) => i.itinerario_id === iti)!.etapas;
/** Lleva un pedido de un solo tramo hasta tener la etapa final despachada. */
function hastaEtapaFinal(pedido = 'PED-0015') {
  D.reservarFefo(repo, ALM, pedido);
  const r = T.planificarPedido(repo, pedido)[0];
  const a = r.alternativas.find((x) => x.factible && x.tramos.length === 1)!;
  const iti = T.confirmarItinerario(repo, PLA, pedido, r.origen, a.clave);
  const e = etapas(iti)[0]; T.despacharEtapa(repo, ALM, String(e.etapa_id));
  const ef = etapas(iti)[0];
  const destino = String(repo.uno('SELECT destino_id FROM pedido WHERE pedido_id = ?', [pedido])!.destino_id);
  return { ef, destino, lineas: ef.carga.map((c) => ({ pedido_linea_id: String(c.pedido_linea_id), lote_id: String(c.lote_id), entregado_mil: ef.en_transito.find((t) => t.lote_id === c.lote_id)!.q_mil, rechazado_mil: 0 })) };
}
const receptor = (id: string, destino: string, desde: string, hasta: string | null) => repo.run('INSERT INTO receptor_autorizado VALUES (?,?,?,?,?,NULL)', [id, destino, 'Delegado ficticio ' + id, desde, hasta]);

describe('AS — Evidencia y facultad del receptor final', () => {
  it('ESC-AS01 delegado autorizado para ese lugar y período: aceptación con su identidad', () => {
    const h = hastaEtapaFinal(); receptor('RA-DEL-1', h.destino, '2026-11-01T00:00:00-05:00', '2026-11-30T00:00:00-05:00');
    const r = T.registrarEntrega(repo, ALM, String(h.ef.etapa_id), { receptor_id: 'RA-DEL-1', metodo_evidencia: 'Firma', evidencia_ref: 'GR-1', lineas: h.lineas }).resultado;
    expect(r.estado).toBe('TOTAL');
    expect(repo.uno('SELECT receptor_id FROM entrega WHERE entrega_id = ?', [r.entrega_id])!.receptor_id).toBe('RA-DEL-1');
  });
  it('ESC-AS03 autorización vencida antes de la hora del hecho: no valida, queda en verificación con motivo', () => {
    const h = hastaEtapaFinal(); receptor('RA-DEL-2', h.destino, '2026-11-01T00:00:00-05:00', '2026-11-14T09:00:00-05:00');
    const r = T.registrarEntrega(repo, ALM, String(h.ef.etapa_id), { receptor_id: 'RA-DEL-2', metodo_evidencia: 'Firma', evidencia_ref: 'GR-2', lineas: h.lineas }).resultado;
    expect(r.estado).toBe('EN_VERIFICACION'); expect(r.aceptado_mil).toBe(0); expect(r.motivo).toMatch(/sin facultad vigente/);
  });
  it('ESC-AS04 revocación posterior a una recepción válida: la evidencia histórica se conserva sin duplicar', () => {
    const h = hastaEtapaFinal(); receptor('RA-DEL-3', h.destino, '2026-11-01T00:00:00-05:00', null);
    const r = T.registrarEntrega(repo, ALM, String(h.ef.etapa_id), { receptor_id: 'RA-DEL-3', metodo_evidencia: 'Firma', evidencia_ref: 'GR-3', lineas: h.lineas }).resultado;
    repo.run("UPDATE receptor_autorizado SET vigente_hasta = '2026-11-15T00:00:00-05:00' WHERE receptor_id = 'RA-DEL-3'");
    const e = repo.uno('SELECT estado, receptor_id FROM entrega WHERE entrega_id = ?', [r.entrega_id])!;
    expect([e.estado, e.receptor_id]).toEqual(['TOTAL', 'RA-DEL-3']);
    expect(repo.num('SELECT COUNT(*) FROM entrega WHERE etapa_id = ?', [String(h.ef.etapa_id)])).toBe(1);
  });
  it('ESC-AS05 / V02 adjunto sin receptor identificado: no es prueba de aceptación', () => {
    const h = hastaEtapaFinal();
    const r = T.registrarEntrega(repo, ALM, String(h.ef.etapa_id), { receptor_nombre: 'Persona en el muelle', metodo_evidencia: 'Fotografía', evidencia_ref: 'IMG-1', lineas: h.lineas }).resultado;
    expect(r.estado).toBe('EN_VERIFICACION'); expect(r.en_verificacion_mil).toBeGreaterThan(0);
  });
  it('ESC-AS06 medio alternativo a la firma: se registra método y referencia sin inventar firma', () => {
    const h = hastaEtapaFinal(); receptor('RA-DEL-4', h.destino, '2026-11-01T00:00:00-05:00', null);
    const r = T.registrarEntrega(repo, ALM, String(h.ef.etapa_id), { receptor_id: 'RA-DEL-4', metodo_evidencia: 'Huella digital (no puede firmar)', evidencia_ref: 'ACTA-7', lineas: h.lineas }).resultado;
    expect(r.estado).toBe('TOTAL');
    expect(repo.uno('SELECT metodo_evidencia FROM entrega WHERE entrega_id = ?', [r.entrega_id])!.metodo_evidencia).toBe('Huella digital (no puede firmar)');
  });
  it('ESC-V02 llegar al nodo final sin receptor no se registra como recepción intermedia ni aceptación', () => {
    const h = hastaEtapaFinal();
    expect(() => T.recibirEtapa(repo, ALM, String(h.ef.etapa_id), [{ lote_id: h.lineas[0].lote_id, apta_mil: 1000, cuarentena_mil: 0, danada_mil: 0 }], 'X', null)).toThrow(/etapa final/);
  });
});

describe('AY / S — Conteos y recepción repartida', () => {
  const unLote = () => D.existencias(repo).find((x) => x.nodo_id === 'ALM-AQP' && x.condicion === 'APTO' && x.fisico_mil > 5000)!;
  it('ESC-AY01 contar una ubicación con reservas activas no cancela reservas ni crea ingreso', () => {
    D.reservarFefo(repo, ALM, 'PED-0015');
    const res = repo.num("SELECT COUNT(*) FROM reserva WHERE estado = 'ACTIVA'"), mov = repo.num('SELECT COUNT(*) FROM movimiento');
    const l = D.existencias(repo).find((x) => x.reservado_mil > 0)!;
    const c = O.registrarConteo(repo, ALM, { nodo_id: l.nodo_id, lote_id: l.lote_id, contado_mil: l.fisico_mil });
    expect(c.diferencia_mil).toBe(0);
    expect(repo.num("SELECT COUNT(*) FROM reserva WHERE estado = 'ACTIVA'")).toBe(res); expect(repo.num('SELECT COUNT(*) FROM movimiento')).toBe(mov);
  });
  it('ESC-AY02 movimiento legítimo durante el conteo: se compara contra el saldo al instante de corte', () => {
    const l = unLote(); const corte = reloj;
    reloj = '2026-11-14T11:00:00-05:00';
    D.reservarFefo(repo, ALM, 'PED-0015');
    const r = T.planificarPedido(repo, 'PED-0015')[0]; const a = r.alternativas.find((x) => x.factible)!;
    const iti = T.confirmarItinerario(repo, PLA, 'PED-0015', r.origen, a.clave); for (const e of etapas(iti).filter((x) => Number(x.tramo) === 1)) T.despacharEtapa(repo, ALM, String(e.etapa_id));
    const c = O.registrarConteo(repo, ALM, { nodo_id: l.nodo_id, lote_id: l.lote_id, contado_mil: l.fisico_mil, corte });
    expect(c.sistema_mil).toBe(l.fisico_mil); expect(c.diferencia_mil).toBe(0);
  });
  it('ESC-AY04 recuento independiente: se conservan ambas mediciones y la primera no se borra', () => {
    const l = unLote();
    const c1 = O.registrarConteo(repo, ALM, { nodo_id: l.nodo_id, lote_id: l.lote_id, contado_mil: l.fisico_mil - 2000 });
    const c2 = O.registrarConteo(repo, ALM, { nodo_id: l.nodo_id, lote_id: l.lote_id, contado_mil: l.fisico_mil - 1000, recuento_de: c1.conteo_id });
    const filas = repo.todos('SELECT conteo_id, contado_mil, estado, recuento_de FROM conteo WHERE conteo_id IN (?, ?)', [c1.conteo_id, c2.conteo_id]);
    expect(filas).toHaveLength(2);
    expect(filas.find((f) => f.conteo_id === c1.conteo_id)!.contado_mil).toBe(l.fisico_mil - 2000);
    expect(filas.find((f) => f.conteo_id === c2.conteo_id)!.recuento_de).toBe(c1.conteo_id);
    expect(c2.siguiente).toMatch(/solicite el ajuste/);
  });
  it('ESC-AY05 / AY06 diferencias por condición y por lote: no se compensan en el total', () => {
    const ls = D.existencias(repo).filter((x) => x.nodo_id === 'ALM-AQP' && x.condicion === 'APTO' && x.fisico_mil > 5000).slice(0, 2);
    const a = O.registrarConteo(repo, ALM, { nodo_id: 'ALM-AQP', lote_id: ls[0].lote_id, contado_mil: ls[0].fisico_mil - 2000 });
    const b = O.registrarConteo(repo, ALM, { nodo_id: 'ALM-AQP', lote_id: ls[1].lote_id, contado_mil: ls[1].fisico_mil + 2000 });
    expect([a.diferencia_mil, b.diferencia_mil]).toEqual([-2000, 2000]);
    expect(repo.num("SELECT COUNT(*) FROM conteo WHERE estado = 'RECUENTO' AND conteo_id IN (?, ?)", [a.conteo_id, b.conteo_id])).toBe(2);
    const q = O.registrarConteo(repo, ALM, { nodo_id: 'ALM-AQP', lote_id: ls[0].lote_id, condicion: 'CUARENTENA', contado_mil: 0 });
    expect(q.sistema_mil).toBe(0); expect(q.diferencia_mil).toBe(0);
  });
  it('ESC-S08 recepción repartida apta/cuarentena/dañada: conserva la suma y solo lo apto queda disponible', () => {
    D.reservarFefo(repo, ALM, 'PED-0019');
    const r = T.planificarPedido(repo, 'PED-0019')[0]; const a = r.alternativas.find((x) => x.factible && x.tramos.length > 1)!;
    const iti = T.confirmarItinerario(repo, PLA, 'PED-0019', r.origen, a.clave);
    const e1 = etapas(iti).find((x) => Number(x.tramo) === 1)!; T.despacharEtapa(repo, ALM, String(e1.etapa_id));
    const t = etapas(iti).find((x) => Number(x.tramo) === 1)!.en_transito[0];
    const ap = Math.floor(t.q_mil / 2000) * 1000, cu = 1000, da = t.q_mil - ap - cu;
    T.recibirEtapa(repo, ALM, String(e1.etapa_id), [{ lote_id: t.lote_id, apta_mil: ap, cuarentena_mil: cu, danada_mil: da }, ...etapas(iti).find((x) => Number(x.tramo) === 1)!.en_transito.slice(1).map((x) => ({ lote_id: x.lote_id, apta_mil: x.q_mil, cuarentena_mil: 0, danada_mil: 0 }))], 'Custodio', null);
    const nodo = String(e1.nodo_destino_id);
    const ex = D.existencias(repo).filter((x) => x.nodo_id === nodo && x.lote_id === t.lote_id);
    const por = (c: string) => ex.filter((x) => x.condicion === c).reduce((s, x) => s + x.fisico_mil, 0);
    expect([por('APTO'), por('CUARENTENA'), por('DANADO')]).toEqual([ap, cu, da]);
    expect(por('APTO') + por('CUARENTENA') + por('DANADO')).toBe(t.q_mil);
    expect(ex.filter((x) => x.condicion !== 'APTO').every((x) => x.disponible_mil === 0)).toBe(true);
  });
});

describe('Auditoría RC1 n.º 2 / RC2 n.º 22 y 24 — reprogramación con capacidad compartida y balance de demanda', () => {
  const sv = (id: string, enlace: string, salida: string, cap: number): M.ServicioSim => ({ servicio_id: id, enlace, corredor: 'C-' + enlace, modo: 'VIAL', salida, llegada: salida, min_min: 60, moda_min: 60, max_min: 60, prob: 0, retraso_min: 0, fijo_cent: 0, kg_p4: 0, cap_kg: cap });
  const tramo = (n: number, enlace: string, servicio: string, salida: string, kg: number) => ({ tramo: n, enlace, modo: 'VIAL', origen: 'X', destino: 'Y', manip_min: 0, viajes: [{ servicio, salida, kg }] });
  const envio = (id: string, kg: number, tramos: M.EnvioSim['tramos'], factible = true): M.EnvioSim => ({ pedido: id, origen: 'A', destino: 'C', region: 'R', remoto: false, kg, ventana_ini: '2026-11-20T00:00:00-05:00', ventana_fin: '2026-11-23T00:00:00-05:00', anticipada: true, factible, motivo: '', tramos });
  const plan = (envios: M.EnvioSim[]): M.PlanSim => ({ criterio: 'POR_PEDIDO', nombre: 'P', descripcion: '', envios, servicios: 1, costo_cent: 0, kg: envios.filter((e) => e.factible).reduce((x, e) => x + e.kg, 0), kg_demanda: envios.reduce((x, e) => x + e.kg, 0) });
  const P0 = { ...M.PARAMETROS_DEFECTO, iteraciones: 10, prob_cierre: 0, horizonte_reprogramacion_h: 48 };
  it('dos cargas de 60 kg pierden su salida y la siguiente admite 100 kg: viaja una completa (60) y la otra queda pendiente entera (60); nunca más de 100', () => {
    const r = M.simular([plan([envio('PA', 60, [tramo(1, 'AB', 'S-CANCELADA', '2026-11-20T08:00', 60)]), envio('PB', 60, [tramo(1, 'AB', 'S-CANCELADA', '2026-11-20T08:00', 60)])])], [sv('S-B', 'AB', '2026-11-20T12:00', 100)], P0);
    expect(r.planes[0].kg_no_atendido.media).toBeCloseTo(60, 6);
    expect(r.planes[0].a_tiempo.media).toBeCloseTo(50, 6);
  });
  it('con capacidad libre suficiente (120) no queda nada pendiente', () => {
    const r = M.simular([plan([envio('PA', 60, [tramo(1, 'AB', 'S-CANCELADA', '2026-11-20T08:00', 60)]), envio('PB', 60, [tramo(1, 'AB', 'S-CANCELADA', '2026-11-20T08:00', 60)])])], [sv('S-B', 'AB', '2026-11-20T12:00', 120)], P0);
    expect(r.planes[0].kg_no_atendido.media).toBe(0);
  });
  it('cadena A→B→C: la sustituta A→B solo admite 40 de 60 ⇒ los 60 quedan pendientes para el cliente y se libera la capacidad de B→C', () => {
    const e = envio('PA', 60, [tramo(1, 'AB', 'S-CANCELADA', '2026-11-20T08:00', 60), tramo(2, 'BC', 'S-BC', '2026-11-21T08:00', 60)]);
    const r = M.simular([plan([e])], [sv('S-AB2', 'AB', '2026-11-20T12:00', 40), sv('S-BC', 'BC', '2026-11-21T08:00', 60)], P0);
    expect(r.planes[0].kg_no_atendido.media).toBeCloseTo(60, 6);
    expect(r.planes[0].a_tiempo.media).toBe(0);
  });
  it('cadena A→B→C con B→C sin servicio: tampoco se acepta nada en destino (60 pendientes)', () => {
    const e = envio('PA', 60, [tramo(1, 'AB', 'S-AB', '2026-11-20T08:00', 60), tramo(2, 'BC', 'S-BC-CANCELADA', '2026-11-21T08:00', 60)]);
    const r = M.simular([plan([e])], [sv('S-AB', 'AB', '2026-11-20T08:00', 100)], P0);
    expect(r.planes[0].kg_no_atendido.media).toBeCloseTo(60, 6);
  });
  it('balance: demanda = no atendido + atendido; 20 de 120 no atendidos = 16,67 % (sin sumar el fallo al denominador)', () => {
    const r = M.simular([plan([envio('PA', 100, [tramo(1, 'AB', 'S-AB', '2026-11-20T08:00', 100)]), envio('PB', 20, [tramo(1, 'AB', 'S-CANCELADA', '2026-11-20T08:00', 20)])])], [sv('S-AB', 'AB', '2026-11-20T08:00', 100)], P0);
    const pl = r.planes[0];
    expect(pl.kg_demanda).toBe(120); expect(pl.kg_no_atendido.media).toBeCloseTo(20, 6);
    expect(E.porcentajeNoAtendido(pl) * 100).toBeCloseTo(16.6667, 3);
    // envío no factible desde el inicio: cuenta en la demanda una sola vez
    const r2 = M.simular([plan([envio('PA', 100, [tramo(1, 'AB', 'S-AB', '2026-11-20T08:00', 100)]), envio('PX', 20, [], false)])], [sv('S-AB', 'AB', '2026-11-20T08:00', 100)], P0);
    expect(E.porcentajeNoAtendido(r2.planes[0]) * 100).toBeCloseTo(16.6667, 3);
    expect(E.porcentajeNoAtendido({ kg_plan: 0, kg_demanda: 0, kg_no_atendido: { media: 0 } })).toBe(0);
  });
});

describe('Auditoría RC1 n.º 10 — ESC-BB04 capacidad menor que lo comprometido', () => {
  it('bloquea la activación y lista servicio y pedido; con capacidad suficiente sí activa y audita', () => {
    D.reservarFefo(repo, ALM, 'PED-0015');
    const r = T.planificarPedido(repo, 'PED-0015')[0]; const a = r.alternativas.find((x) => x.factible)!;
    const iti = T.confirmarItinerario(repo, PLA, 'PED-0015', r.origen, a.clave);
    const e = etapas(iti)[0];
    const rec = String(repo.uno('SELECT recurso_id FROM servicio WHERE servicio_id = ?', [String(e.servicio_id)])!.recurso_id);
    const kg = repo.num('SELECT SUM(kg_bruto_mil) FROM etapa WHERE servicio_id = ? AND estado IN (\'PLANIFICADA\',\'DESPACHADA\')', [String(e.servicio_id)]);
    const antes = repo.num('SELECT capacidad_kg_mil FROM recurso WHERE recurso_id = ?', [rec]);
    expect(() => T.cambiarCapacidadRecurso(repo, 'U01', rec, kg - 1000, 'Cambio de unidad')).toThrow(/No se activa.*PED-0015/);
    expect(repo.num('SELECT capacidad_kg_mil FROM recurso WHERE recurso_id = ?', [rec])).toBe(antes);
    T.cambiarCapacidadRecurso(repo, 'U01', rec, kg, 'Cambio de unidad');
    expect(repo.num('SELECT capacidad_kg_mil FROM recurso WHERE recurso_id = ?', [rec])).toBe(kg);
    expect(repo.num("SELECT COUNT(*) FROM auditoria WHERE accion = 'CAMBIAR_CAPACIDAD_RECURSO'")).toBe(1);
  });
});

describe('Auditoría RC1 n.º 11 — contrato semántico declarado (BJ02 / AF08)', () => {
  const conLeeme = async (cambio?: [string, string]) => {
    const ExcelJS = (await import('exceljs')).default;
    const { generarPlantilla, leerExcel } = await import('../src/core/excel');
    const buf = await generarPlantilla();
    if (!cambio) return leerExcel(buf);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    wb.getWorksheet('LEEME')!.eachRow((r) => { if (r.getCell(1).value === cambio[0]) r.getCell(2).value = cambio[1]; });
    return leerExcel(await wb.xlsx.writeBuffer() as ArrayBuffer);
  };
  it('el archivo generado por el sistema declara un contrato compatible y se acepta', async () => {
    const r = validarConjunto(await conLeeme());
    expect(r.errores.filter((e) => e.hoja === 'LEEME')).toEqual([]);
  });
  it('mismos nombres y tipos pero versión de contrato no soportada: se rechaza toda la carga', async () => {
    const r = validarConjunto(await conLeeme(['Versión de contrato', 'X99-v1']));
    expect(r.errores.some((e) => e.hoja === 'LEEME' && /no soportada/.test(e.mensaje))).toBe(true);
  });
  it('unidad o zona horaria declaradas incompatibles: se rechaza sin reinterpretar', async () => {
    expect(validarConjunto(await conLeeme(['Unidades', 'Cantidades en cajas de 12'])).errores.some((e) => /Unidad declarada incompatible/.test(e.mensaje))).toBe(true);
    expect(validarConjunto(await conLeeme(['Fechas', 'Instantes en UTC'])).errores.some((e) => /Zona horaria/.test(e.mensaje))).toBe(true);
  });
  it('ESC-AF08 mismo nombre con bytes distintos: hash nuevo, no se confunde con la carga anterior', async () => {
    const { cargaPrevia } = await import('../src/core/carga');
    expect(cargaPrevia(repo, 'h')).toBeTruthy();          // mismo hash ⇒ «ya cargado»
    expect(cargaPrevia(repo, 'otro-hash')).toBeUndefined(); // mismo nombre «06», otros bytes ⇒ carga nueva con su propio hash
  });
});

describe('Revisión RC2 — casos con regla ya implementada', () => {
  it('ESC-Q02 / ESC-X02 bulto cerrado más pesado que lo que admite el recurso: se bloquea, no se parte por redondeo', () => {
    repo.run('UPDATE recurso SET max_bulto_kg_mil = 1000');
    D.reservarFefo(repo, ALM, 'PED-0015');
    const r = T.planificarPedido(repo, 'PED-0015')[0];
    const txt = JSON.stringify(r);
    expect(r.alternativas.some((a) => a.factible)).toBe(false);
    expect(txt).toMatch(/no se parte un bulto cerrado/);
  });
  it('ESC-AG05 evento hijo antes que el padre: entrega o recepción sin despacho previo se rechaza sin dejar registros huérfanos', () => {
    D.reservarFefo(repo, ALM, 'PED-0019');
    const r = T.planificarPedido(repo, 'PED-0019')[0]; const a = r.alternativas.find((x) => x.factible && x.tramos.length > 1)!;
    const iti = T.confirmarItinerario(repo, PLA, 'PED-0019', r.origen, a.clave);
    const e1 = etapas(iti).find((x) => Number(x.tramo) === 1)!, ef = etapas(iti).find((x) => x.final)!;
    const n0 = repo.num('SELECT COUNT(*) FROM movimiento'), en0 = repo.num('SELECT COUNT(*) FROM entrega');
    expect(() => T.recibirEtapa(repo, ALM, String(e1.etapa_id), [{ lote_id: 'X', apta_mil: 1000, cuarentena_mil: 0, danada_mil: 0 }], 'Custodio', null)).toThrow(/despachada/);
    expect(() => T.registrarEntrega(repo, ALM, String(ef.etapa_id), { receptor_nombre: 'X', lineas: [] })).toThrow(/no fue despachada/);
    expect([repo.num('SELECT COUNT(*) FROM movimiento'), repo.num('SELECT COUNT(*) FROM entrega')]).toEqual([n0, en0]);
  });
});

describe('Revisión RC2 — revalidación y conteos', () => {
  it('ESC-F03 al despachar se revalida el lote: bloqueado o sin vida útil suficiente en destino ⇒ no se despacha', () => {
    D.reservarFefo(repo, ALM, 'PED-0015');
    const r = T.planificarPedido(repo, 'PED-0015')[0]; const a = r.alternativas.find((x) => x.factible && x.tramos.length === 1)!;
    const iti = T.confirmarItinerario(repo, PLA, 'PED-0015', r.origen, a.clave);
    const e = etapas(iti)[0], lote = String(e.carga[0].lote_id);
    repo.run("UPDATE lote SET fecha_vencimiento = '2026-11-14' WHERE lote_id = ?", [lote]);
    const mov = repo.num('SELECT COUNT(*) FROM movimiento');
    expect(() => T.despacharEtapa(repo, ALM, String(e.etapa_id))).toThrow(/vida útil mínima.*revalide FEFO/);
    repo.run("UPDATE lote SET fecha_vencimiento = '2028-01-01', estado_lote = 'BLOQUEADO' WHERE lote_id = ?", [lote]);
    expect(() => T.despacharEtapa(repo, ALM, String(e.etapa_id))).toThrow(/LIBERADO/);
    expect(repo.num('SELECT COUNT(*) FROM movimiento')).toBe(mov);
  });
  it('ESC-AY03 la misma ubicación y lote no se cuenta dos veces con un conteo abierto: se exige recuento', () => {
    const l = D.existencias(repo).find((x) => x.nodo_id === 'ALM-AQP' && x.condicion === 'APTO' && x.fisico_mil > 5000)!;
    const c1 = O.registrarConteo(repo, ALM, { nodo_id: l.nodo_id, lote_id: l.lote_id, contado_mil: l.fisico_mil - 1000 });
    expect(() => O.registrarConteo(repo, ALM, { nodo_id: l.nodo_id, lote_id: l.lote_id, contado_mil: l.fisico_mil - 1000 })).toThrow(/RECUENTO/);
    expect(O.registrarConteo(repo, ALM, { nodo_id: l.nodo_id, lote_id: l.lote_id, contado_mil: l.fisico_mil - 1000, recuento_de: c1.conteo_id }).diferencia_mil).toBe(-1000);
  });
  it('ESC-AY07 mercadería en camino contada en el nodo: no se toma como existencia y se avisa conciliar al recibir', () => {
    D.reservarFefo(repo, ALM, 'PED-0019');
    const r = T.planificarPedido(repo, 'PED-0019')[0]; const a = r.alternativas.find((x) => x.factible && x.tramos.length > 1)!;
    const iti = T.confirmarItinerario(repo, PLA, 'PED-0019', r.origen, a.clave);
    const e1 = etapas(iti).find((x) => Number(x.tramo) === 1)!; T.despacharEtapa(repo, ALM, String(e1.etapa_id));
    const t = etapas(iti).find((x) => Number(x.tramo) === 1)!.en_transito[0];
    const c = O.registrarConteo(repo, ALM, { nodo_id: String(e1.nodo_destino_id), lote_id: t.lote_id, contado_mil: t.q_mil });
    expect(c.sistema_mil).toBe(0); expect(c.en_camino_mil).toBe(t.q_mil);
    expect(c.siguiente).toMatch(/en camino.*no son existencia recibida/);
    expect(D.existencias(repo).filter((x) => x.nodo_id === String(e1.nodo_destino_id) && x.lote_id === t.lote_id).reduce((s2, x) => s2 + x.fisico_mil, 0)).toBe(0);
  });
});

describe('RC4 — defecto 26: LEEME externo completo y por encabezado', () => {
  type Cambio = { quitar?: string[]; vaciar?: string[]; version?: string; invertir?: boolean };
  const archivo = async (c: Cambio = {}) => {
    const ExcelJS = (await import('exceljs')).default;
    const { generarPlantilla, leerExcel } = await import('../src/core/excel');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await generarPlantilla());
    const ws = wb.getWorksheet('LEEME')!;
    const filas: [string, string][] = [];
    ws.eachRow((r, i) => { if (i > 1) filas.push([String(r.getCell(1).value ?? ''), String(r.getCell(2).value ?? '')]); });
    const nuevas = filas.filter(([k]) => !(c.quitar ?? []).includes(k)).map(([k, v]) => [k, (c.vaciar ?? []).includes(k) ? '' : k === 'Versión de contrato' && c.version ? c.version : v] as [string, string]);
    wb.removeWorksheet(ws.id);
    const n = wb.addWorksheet('LEEME');
    n.addRow(c.invertir ? ['descripcion', 'seccion'] : ['seccion', 'descripcion']);
    for (const [k, v] of nuevas) n.addRow(c.invertir ? [v, k] : [k, v]);
    return leerExcel(await wb.xlsx.writeBuffer() as ArrayBuffer);
  };
  const errLeeme = async (c: Cambio) => validarConjunto(await archivo(c), { exigirLeeme: true }).errores.filter((e) => e.hoja === 'LEEME').map((e) => `${e.columna}: ${e.mensaje}`);
  it('completo: sin errores de LEEME (también con las columnas intercambiadas)', async () => {
    expect(await errLeeme({})).toEqual([]);
    expect(await errLeeme({ invertir: true })).toEqual([]);
  });
  it('sin «Unidades», sin «Fechas» o sin ambos: se rechaza e indica el campo que falta', async () => {
    expect((await errLeeme({ quitar: ['Unidades'] })).join()).toMatch(/Unidades.*no declara «Unidades»/);
    expect((await errLeeme({ quitar: ['Fechas'] })).join()).toMatch(/Fechas.*no declara «Fechas»/);
    const ambos = await errLeeme({ quitar: ['Unidades', 'Fechas'] });
    expect(ambos.some((x) => x.startsWith('Unidades'))).toBe(true); expect(ambos.some((x) => x.startsWith('Fechas'))).toBe(true);
  }, 30000);
  it('valores vacíos y versión vacía o desconocida: se rechazan', async () => {
    expect((await errLeeme({ vaciar: ['Unidades'] })).join()).toMatch(/fila vacía/);
    expect((await errLeeme({ vaciar: ['Fechas'] })).join()).toMatch(/fila vacía/);
    expect((await errLeeme({ vaciar: ['Versión de contrato'] })).join()).toMatch(/Versión de contrato/);
    expect((await errLeeme({ version: 'I05-v5' })).join()).toMatch(/no soportada/);
    expect((await errLeeme({ invertir: true, quitar: ['Fechas'] })).join()).toMatch(/Fechas/);
  }, 30000);
  it('el recurso interno empaquetado (sin LEEME) sigue siendo la única excepción delimitada', async () => {
    const { aHojas } = await import('../src/core/demo');
    const { tablasExcel06 } = await import('../src/core/historia');
    expect(validarConjunto(aHojas(tablasExcel06())).errores).toEqual([]);
    expect(validarConjunto(aHojas(tablasExcel06()), { exigirLeeme: true }).errores.some((e) => /Falta la hoja LEEME/.test(e.mensaje))).toBe(true);
  });
  it('el 06 real (SHA fa47c899…) se acepta sin errores como archivo externo', async () => {
    const fs = await import('node:fs'); const crypto = await import('node:crypto');
    const ruta = process.env.ARCHIVO_06 ?? '/mnt/user-data/outputs/I07_sistema/06_Informacion_Carga.xlsx';
    if (!fs.existsSync(ruta)) { console.warn('06 real no disponible: NO EJECUTADA'); return; }
    const buf = fs.readFileSync(ruta);
    expect(crypto.createHash('sha256').update(buf).digest('hex')).toBe('fa47c8998265cb6598b155d48bd0cf9a2a4cd0a974fbdb8f7666f04b6051ee92');
    const { leerExcel } = await import('../src/core/excel');
    const r = validarConjunto(await leerExcel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer), { exigirLeeme: true });
    expect(r.errores).toEqual([]);
  });
});
