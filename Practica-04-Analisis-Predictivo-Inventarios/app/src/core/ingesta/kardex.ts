/**
 * Skill "ingesta" — importador del KARDEX en formato REPORTE (.xls/.xlsx, una hoja por mes).
 * Estructura por bloques:  [encabezado de producto] → SALDO INICIAL>>> → movimientos → TOTAL FINAL >>>
 * Reglas: los saldos se CONCILIAN y las diferencias se REPORTAN (nunca se corrigen en silencio).
 * El periodo se toma de las fechas reales (la hoja "01-2009 hasta hoy" contiene ene–jun 2010).
 */
import type { SqlValue } from 'sql.js';
import type { BaseDatos } from '../db/db';
import { leerLibro, type Hoja } from './excel';
import { Acumulador, indiceCalidad, type Hallazgo } from './calidad';
import { aFechaISO, aNumero, normalizar, sha256 } from '../util/util';
import { registrarUso } from '../bitacora';

export type ClaseMov = 'ENTRADA_COMPRA' | 'ENTRADA_PRODUCCION' | 'SALIDA_VENTA' | 'SALIDA_CONSUMO' | 'TRANSFORMACION' | 'AJUSTE_DEVOLUCION' | 'OTRO';

/** Clasificación de motivos (F1, sección 5.2). */
export function clasificarMotivo(motivo: string, entrada: number, salida: number): ClaseMov {
  const m = normalizar(motivo);
  if (/compra/.test(m)) return 'ENTRADA_COMPRA';
  if (/transformacion/.test(m)) return 'TRANSFORMACION';
  if (/ingreso a almacen de producto terminado|devolucion automatica produccion/.test(m)) return 'ENTRADA_PRODUCCION';
  if (/por produccion en planta|consumo/.test(m)) return 'SALIDA_CONSUMO';
  if (/^venta$|muestras/.test(m)) return 'SALIDA_VENTA';
  if (/devolucion|cambio|garantia|ajuste/.test(m)) return 'AJUSTE_DEVOLUCION';
  if (!m) return entrada > 0 ? 'AJUSTE_DEVOLUCION' : salida > 0 ? 'AJUSTE_DEVOLUCION' : 'OTRO';
  return 'OTRO';
}

/** Interpreta el encabezado de producto: " - CODIGO - DESCRIPCIÓN - LOTE" o "EMPRESA - CODIGO - DESCRIPCIÓN". */
export function parsearProducto(texto: string): { codigo: string; descripcion: string; lote: string | null; familia: string } | null {
  const t = texto.trim();
  const partes = t.replace(/^-\s*/, '').split(/\s+-\s+/);
  let codigo: string, descripcion: string, lote: string | null = null;
  if (/^-/.test(t)) {
    codigo = partes[0]; descripcion = partes.slice(1, partes.length > 2 ? -1 : undefined).join(' - '); lote = partes.length > 2 ? partes.at(-1)! : null;
  } else if (partes.length >= 3) {
    codigo = partes[1]; descripcion = partes.slice(2).join(' - ');
  } else return null;
  codigo = codigo.trim();
  if (!codigo) return null;
  return { codigo, descripcion: descripcion.trim(), lote, familia: codigo.split('-')[0] };
}

export interface ResumenIngestaKardex {
  datasetId: number;
  estado: 'DATOS_VALIDADOS' | 'DATOS_INCOMPLETOS';
  archivo: string; hash: string; hojas: number;
  movimientos: number; bloques: number; productos: number;
  fechaMin: string | null; fechaMax: string | null; meses: number;
  entradas: number; salidas: number;
  porClase: Record<string, number>;
  hallazgos: Hallazgo[]; indiceCalidad: number; duracionMs: number;
}

interface Mov { hoja: string; fila: number; codigo: string; fecha: string; doc: string; item: number | null; e: number; s: number; st: number | null; calc: number; motivo: string; almacen: string | null; sede: string | null; }
interface Bloque { hoja: string; codigo: string; ini: number; finRep: number | null; E: number; S: number; movs: Mov[]; }

/** Ubica las columnas por su encabezado ("Transaccion", "Fecha", "Entrada"...); si no lo halla, usa la posición estándar del reporte. */
function columnas(h: Hoja): Record<string, number> {
  const std = { doc: 0, item: 1, fecha: 2, entrada: 3, salida: 4, stock: 5, ref: 6, motivo: 7, almacen: 8, sede: 9 };
  for (const f of h.filas.slice(0, 15)) {
    const n = (f ?? []).map(normalizar);
    const i = n.indexOf('transaccion');
    if (i >= 0 && n.includes('entrada') && n.includes('salida')) {
      const at = (k: string, d: number) => (n.indexOf(k) >= 0 ? n.indexOf(k) : d);
      return { doc: i, item: i + 1, fecha: at('fecha', 2), entrada: at('entrada', 3), salida: at('salida', 4), stock: at('stock', 5), ref: at('referencia', 6), motivo: at('motivo', 7), almacen: at('almacen', 8), sede: at('sede', 9) };
    }
  }
  return std;
}

export async function importarKardex(bd: BaseDatos, datos: ArrayBuffer | Uint8Array, archivo: string, nombre = 'Kardex de almacén'): Promise<ResumenIngestaKardex> {
  const t0 = Date.now();
  const hash = await sha256(datos);
  const hojas = leerLibro(datos);
  const acc = new Acumulador();
  const bloques: Bloque[] = [];
  const productos = new Map<string, { descripcion: string; lote: string | null; familia: string }>();

  for (const h of hojas) {
    const c = columnas(h);
    let prod: string | null = null;
    let blk: Bloque | null = null;
    let prev = 0;
    h.filas.forEach((r, i) => {
      const a = r?.[c.doc] == null ? '' : String(r[c.doc]).trim();
      const fecha = aFechaISO(r?.[c.fecha]);
      const na = normalizar(a);
      if (na.startsWith('saldo inicial')) {
        if (!prod) { acc.agregar('K00', 'SALDO INICIAL sin encabezado de producto', 'CRITICA', i + 1); return; }
        blk = { hoja: h.nombre, codigo: prod, ini: aNumero(r[c.stock]) ?? 0, finRep: null, E: 0, S: 0, movs: [] };
        bloques.push(blk); prev = blk.ini; return;
      }
      if (na.startsWith('total final')) { if (blk) blk.finRep = aNumero(r[c.stock]); return; }
      if (fecha && a && blk) {
        const e = aNumero(r[c.entrada]) ?? 0, s = aNumero(r[c.salida]) ?? 0, st = aNumero(r[c.stock]);
        const mv: Mov = { hoja: h.nombre, fila: i + 1, codigo: blk.codigo, fecha, doc: a, item: aNumero(r[c.item]), e, s, st, calc: prev + e - s,
          motivo: r[c.motivo] == null ? '' : String(r[c.motivo]).trim(), almacen: r[c.almacen] == null ? null : String(r[c.almacen]).trim(), sede: r[c.sede] == null ? null : String(r[c.sede]).trim() };
        blk.movs.push(mv); blk.E += e; blk.S += s;
        prev = st ?? mv.calc; return;
      }
      if (a && na !== 'transaccion' && !fecha && (r?.[c.stock] == null || r[c.stock] === '')) {
        const p = parsearProducto(a);
        if (p) { prod = p.codigo; if (!productos.has(p.codigo)) productos.set(p.codigo, p); blk = null; }
      }
    });
  }

  // ---------- Reglas de calidad del Kardex ----------
  const movs = bloques.flatMap((b) => b.movs);
  const hojasRegla = new Map<string, Map<string, number>>();
  const porHoja = (regla: string, hoja: string) => { const mm = hojasRegla.get(regla) ?? new Map<string, number>(); mm.set(hoja, (mm.get(hoja) ?? 0) + 1); hojasRegla.set(regla, mm); };
  for (const b of bloques) {
    let fAnt: string | null = null;
    for (const m of b.movs) {
      if (m.st != null && Math.abs(m.calc - m.st) > 0.01) acc.agregar('K01', 'Saldo que no cuadra: saldo anterior ± movimiento ≠ Stock reportado', 'CRITICA', m.fila); porHoja('K01', m.hoja);
      if (m.st != null && m.st < -1e-9) { acc.agregar('K02', 'Stock negativo', 'ALTA', m.fila); porHoja('K02', m.hoja); }
      if (m.e === 0 && m.s === 0) acc.agregar('K05', 'Movimiento sin cantidad (entrada y salida en cero)', 'BAJA', m.fila);
      if (fAnt && m.fecha < fAnt) acc.agregar('K09', 'Movimiento fuera de orden cronológico en el bloque', 'BAJA', m.fila);
      if (clasificarMotivo(m.motivo, m.e, m.s) === 'OTRO') acc.agregar('K10', 'Motivo no reconocido (clase OTRO)', 'BAJA', m.fila);
      fAnt = m.fecha;
    }
    if (b.finRep != null && Math.abs(b.ini + b.E - b.S - b.finRep) > 0.01) acc.agregar('K03', 'Bloque descuadrado: saldo inicial + entradas − salidas ≠ TOTAL FINAL', 'ALTA');
  }
  // Periodo real de cada bloque y continuidad del saldo entre meses
  const periodoDe = (b: Bloque) => b.movs[0]?.fecha.slice(0, 7) ?? hojaAPeriodo(b.hoja);
  const porProd = new Map<string, Bloque[]>();
  bloques.forEach((b) => porProd.set(b.codigo, [...(porProd.get(b.codigo) ?? []), b]));
  let transiciones = 0;
  for (const lista of porProd.values()) {
    lista.sort((x, y) => (periodoDe(x) ?? '').localeCompare(periodoDe(y) ?? ''));
    for (let i = 1; i < lista.length; i++) {
      transiciones++;
      const ant = lista[i - 1].finRep;
      if (ant != null && Math.abs(ant - lista[i].ini) > 0.01) acc.agregar('K04', 'Discontinuidad: saldo inicial ≠ total final del mes anterior', 'ALTA');
    }
  }
  const sinSalidas = [...porProd.keys()].filter((k) => porProd.get(k)!.every((b) => b.S === 0));
  if (sinSalidas.length) acc.fijar({ regla: 'K07', descripcion: 'Productos sin salidas en todo el periodo (posible exceso u obsolescencia)', severidad: 'INFO', afectados: sinSalidas.length, ejemplos: [], detalle: sinSalidas.slice(0, 30).join(', ') });
  acc.fijar({ regla: 'K08', descripcion: 'Sin costos unitarios: la valorización usa un costo SUPUESTO editable', severidad: 'INFO', afectados: productos.size, ejemplos: [] });
  for (const h of hojas) {
    const esperado = hojaPeriodoNominal(h.nombre);
    const reales = [...new Set(movs.filter((m) => m.hoja === h.nombre).map((m) => m.fecha.slice(0, 7)))].sort();
    if (esperado && reales.length && (reales.length > 1 || reales[0] !== esperado)) {
      acc.fijar({ regla: `K06-${h.nombre}`, descripcion: `La hoja "${h.nombre}" contiene movimientos de ${reales[0]} a ${reales.at(-1)}; se usan las fechas reales`, severidad: 'INFO', afectados: movs.filter((m) => m.hoja === h.nombre).length, ejemplos: [] });
    }
  }
  if (transiciones > 0 && !acc.lista().some((x) => x.regla === 'K04')) {
    acc.fijar({ regla: 'K04-OK', descripcion: `Continuidad de saldos entre meses verificada (${transiciones} transiciones sin diferencias)`, severidad: 'INFO', afectados: transiciones, ejemplos: [] });
  }

  // K11: último mes incompleto (pocos movimientos y la última fecha antes del día 21) → no cuenta como mes cerrado
  const porMes = new Map<string, number>();
  movs.forEach((m) => porMes.set(m.fecha.slice(0, 7), (porMes.get(m.fecha.slice(0, 7)) ?? 0) + 1));
  const mesesOrd = [...porMes.keys()].sort();
  let ultimoCerrado = mesesOrd.at(-1) ?? null;
  if (mesesOrd.length >= 3) {
    const cuentas = [...porMes.values()].sort((x, y) => x - y);
    const med = cuentas.length % 2 ? cuentas[(cuentas.length - 1) / 2] : (cuentas[cuentas.length / 2 - 1] + cuentas[cuentas.length / 2]) / 2;
    const ult = mesesOrd.at(-1)!, ultimaFecha = movs.map((m) => m.fecha).sort().at(-1)!;
    if (porMes.get(ult)! < 0.75 * med && Number(ultimaFecha.slice(8, 10)) <= 20) {
      acc.fijar({ regla: 'K11', descripcion: `Mes incompleto ${ult} (${porMes.get(ult)} movimientos hasta el ${ultimaFecha} vs. mediana ${med}); se excluye del pronóstico`, severidad: 'INFO', afectados: porMes.get(ult)!, ejemplos: [] });
      ultimoCerrado = mesesOrd.at(-2)!;
    }
  }
  const hallazgos = acc.lista();
  for (const h of hallazgos) {
    const mm = hojasRegla.get(h.regla);
    if (mm) h.detalle = 'por hoja: ' + [...mm.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} (${v})`).join(', ');
  }
  const estado = movs.length > 0 ? 'DATOS_VALIDADOS' : 'DATOS_INCOMPLETOS';
  const fechas = movs.map((m) => m.fecha).sort();
  const indice = indiceCalidad(hallazgos.filter((x) => x.regla !== 'K03' && x.regla !== 'K04'), Math.max(movs.length, 1));
  const porClase: Record<string, number> = {};

  // ---------- Persistencia ----------
  const datasetId = bd.transaccion(() => {
    bd.run(`INSERT INTO dataset (nombre, tipo, archivo, hash_sha256, hojas, filas_origen, filas_validas, fecha_min, fecha_max, ultimo_mes_cerrado, estado)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [nombre, 'kardex', archivo, hash, hojas.length, movs.length, movs.length, fechas[0] ?? null, fechas.at(-1) ?? null, ultimoCerrado, estado]);
    const id = bd.ultimoId();
    bd.insertarMuchos('INSERT INTO producto (dataset_id, codigo, descripcion, lote_ref, familia, costo_unit, costo_es_supuesto) VALUES (?,?,?,?,?,NULL,1)',
      [...productos.entries()].map(([k, p]) => [id, k, p.descripcion, p.lote, p.familia]));
    const idProd = new Map(bd.todas<{ id: number; codigo: string }>('SELECT id, codigo FROM producto WHERE dataset_id=?', [id]).map((p) => [p.codigo, p.id]));
    const stB = bd.db.prepare('INSERT INTO kardex_bloque (dataset_id, producto_id, hoja, periodo, saldo_inicial, total_final_reportado, total_final_calculado) VALUES (?,?,?,?,?,?,?)');
    const stM = bd.db.prepare(`INSERT INTO kardex_mov (dataset_id, bloque_id, producto_id, hoja, fila_origen, fecha, documento, tipo_doc, item, entrada, salida,
      stock_reportado, stock_calculado, motivo, clase_mov, almacen, sede) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    try {
      for (const b of bloques) {
        const pid = idProd.get(b.codigo)!;
        stB.run([id, pid, b.hoja, periodoDe(b), b.ini, b.finRep, b.ini + b.E - b.S]);
        const bid = bd.ultimoId();
        for (const m of b.movs) {
          const clase = clasificarMotivo(m.motivo, m.e, m.s);
          porClase[clase] = (porClase[clase] ?? 0) + 1;
          stM.run([id, bid, pid, m.hoja, m.fila, m.fecha, m.doc, tipoDoc(m.doc), m.item, m.e, m.s, m.st, m.calc, m.motivo, clase, m.almacen, m.sede] as SqlValue[]);
        }
      }
    } finally { stB.free(); stM.free(); }
    const filasH: SqlValue[][] = [];
    for (const x of hallazgos) {
      filasH.push([id, x.regla, x.severidad, 'kardex_mov', null, `${x.descripcion} · registros: ${x.afectados}${x.detalle ? ' · ' + x.detalle : ''}`]);
      for (const f of x.ejemplos.slice(0, 20)) filasH.push([id, x.regla, x.severidad, 'kardex_mov', f, x.descripcion]);
    }
    bd.insertarMuchos('INSERT INTO calidad_hallazgo (dataset_id, regla, severidad, entidad, fila_origen, detalle) VALUES (?,?,?,?,?,?)', filasH);
    return id;
  });

  const r: ResumenIngestaKardex = {
    datasetId, estado, archivo, hash, hojas: hojas.length, movimientos: movs.length, bloques: bloques.length, productos: productos.size,
    fechaMin: fechas[0] ?? null, fechaMax: fechas.at(-1) ?? null, meses: new Set(fechas.map((f) => f.slice(0, 7))).size,
    entradas: movs.reduce((s, m) => s + m.e, 0), salidas: movs.reduce((s, m) => s + m.s, 0), porClase, hallazgos, indiceCalidad: indice, duracionMs: Date.now() - t0,
  };
  registrarUso(bd, 'Importar Excel de Kardex', 'Datos', `${archivo}: ${r.movimientos} movimientos, ${r.productos} productos, ${r.bloques} bloques, calidad ${indice}/100`, t0);
  return r;
}

function tipoDoc(doc: string): string {
  const d = doc.toUpperCase();
  if (d.startsWith('GU')) return 'GU';
  const m = d.match(/^([A-Z])\/([A-Z])\//);
  return m ? `${m[1]}/${m[2]}` : d.slice(0, 3);
}

/** "12-2009" → "2009-12"; "01-2009 hasta hoy" → null (periodo abierto: se usan las fechas reales). */
export function hojaAPeriodo(nombre: string): string | null {
  const m = nombre.trim().match(/^(\d{1,2})-(\d{4})$/);
  return m ? `${m[2]}-${m[1].padStart(2, '0')}` : null;
}

/** Periodo nominal que sugiere el nombre de la hoja ("01-2009 hasta hoy" → "2009-01"), para contrastarlo con las fechas reales. */
export function hojaPeriodoNominal(nombre: string): string | null {
  const m = nombre.trim().match(/^(\d{1,2})-(\d{4})/);
  return m ? `${m[2]}-${m[1].padStart(2, '0')}` : null;
}
