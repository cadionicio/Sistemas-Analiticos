/**
 * Skill "ingesta" — importador de VENTAS Y UTILIDAD.
 * Excel → detección de encabezado → mapeo por sinónimos → validación fila a fila →
 * reglas de calidad → tablas canónicas (dataset, producto, venta) + mapeo, hallazgos y bitácora.
 * Contrato: devuelve estado DATOS_VALIDADOS o DATOS_INCOMPLETOS (nunca inventa datos).
 */
import type { SqlValue } from 'sql.js';
import type { BaseDatos } from '../db/db';
import { leerLibro, type Hoja } from './excel';
import { detectarFilaEncabezado, faltantes, type CampoVenta, type MapeoColumna } from './mapeo';
import { Acumulador, indiceCalidad, medianaMAD, type Hallazgo } from './calidad';
import { aFechaISO, aNumero, normalizar, sha256 } from '../util/util';
import { registrarUso } from '../bitacora';

export interface ResumenIngestaVentas {
  datasetId: number;
  estado: 'DATOS_VALIDADOS' | 'DATOS_INCOMPLETOS';
  archivo: string;
  hash: string;
  hoja: string;
  filaEncabezado: number;
  mapeo: MapeoColumna[];
  faltantes: CampoVenta[];
  filasOrigen: number;
  filasValidas: number;
  filasRechazadas: number;
  productos: number;
  clientes: number;
  fechaMin: string | null;
  fechaMax: string | null;
  ultimoMesCerrado: string | null;
  mesesCerrados: number;
  totalSoles: number;
  totalUtilidad: number;
  hallazgos: Hallazgo[];
  indiceCalidad: number;
  duracionMs: number;
}

interface FilaVenta {
  fila: number; n: number | null; fecha: string; ruc: string | null; cliente: string | null; direccion: string | null;
  departamento: string | null; sku: string; soles: number; volumen: number | null; utilidad: number;
}

export interface OpcionesIngesta {
  nombre?: string;
  mapeoManual?: MapeoColumna[]; // correcciones del asistente de mapeo
  hoja?: string;
}

export async function importarVentas(bd: BaseDatos, datos: ArrayBuffer | Uint8Array, archivo: string, op: OpcionesIngesta = {}): Promise<ResumenIngestaVentas> {
  const t0 = Date.now();
  const hash = await sha256(datos);
  const hojas: Hoja[] = leerLibro(datos);
  const hoja = hojas.find((h) => h.nombre === op.hoja) ?? hojas[0];
  const det = detectarFilaEncabezado(hoja.filas);
  const mapeo = op.mapeoManual ?? det.mapeo;
  const falt = faltantes(mapeo);
  const col = (c: CampoVenta) => mapeo.find((m) => m.campo === c)?.indice;
  const acc = new Acumulador();
  const validas: FilaVenta[] = [];
  let filasOrigen = 0;

  if (falt.length === 0) {
    const txt = (r: unknown[], c: CampoVenta) => {
      const i = col(c);
      const v = i == null ? null : r[i];
      return v == null || String(v).trim() === '' ? null : String(v).trim();
    };
    const num = (r: unknown[], c: CampoVenta) => {
      const i = col(c);
      return i == null ? null : aNumero(r[i]);
    };
    const vistos = new Set<string>();
    for (let i = det.fila + 1; i < hoja.filas.length; i++) {
      const r = hoja.filas[i] ?? [];
      if (r.every((v) => v == null || String(v).trim() === '')) continue; // fila vacía
      filasOrigen++;
      const filaExcel = i + 1;
      const fecha = aFechaISO(r[col('fecha')!]);
      const sku = txt(r, 'sku');
      const soles = num(r, 'soles');
      const utilidad = num(r, 'utilidad');
      let rechazada = false;
      if (!fecha) { acc.agregar('V01', 'Fecha vacía o inválida (fila rechazada)', 'CRITICA', filaExcel); rechazada = true; }
      if (!sku) { acc.agregar('V02', 'Código de producto vacío (fila rechazada)', 'CRITICA', filaExcel); rechazada = true; }
      if (soles == null) { acc.agregar('V03', 'Venta en soles no numérica (fila rechazada)', 'CRITICA', filaExcel); rechazada = true; }
      if (utilidad == null) { acc.agregar('V04', 'Utilidad no numérica (fila rechazada)', 'CRITICA', filaExcel); rechazada = true; }
      if (rechazada) continue;
      const volumen = num(r, 'volumen');
      const fv: FilaVenta = {
        fila: filaExcel, n: num(r, 'n_origen'), fecha: fecha!, ruc: txt(r, 'ruc'), cliente: txt(r, 'cliente'), direccion: txt(r, 'direccion'),
        departamento: txt(r, 'departamento'), sku: sku!, soles: soles!, volumen, utilidad: utilidad!,
      };
      if (fv.soles <= 0) acc.agregar('V05', 'Venta menor o igual a cero', 'ALTA', filaExcel);
      if (Math.abs(fv.utilidad) > Math.abs(fv.soles)) acc.agregar('V06', '|Utilidad| mayor que la venta (verosimilitud)', 'MEDIA', filaExcel);
      if (fv.utilidad < 0) acc.agregar('V07', 'Utilidad operativa negativa (hallazgo de negocio, no error)', 'INFO', filaExcel);
      if (volumen == null || volumen <= 0) acc.agregar('V09', 'Volumen vacío o no positivo', 'BAJA', filaExcel);
      const clave = [fv.fecha, fv.ruc, fv.sku, fv.soles, fv.volumen, fv.utilidad].join('|');
      if (vistos.has(clave)) acc.agregar('V08', 'Registro duplicado (misma fecha, cliente, producto e importes)', 'ALTA', filaExcel);
      vistos.add(clave);
      validas.push(fv);
    }
    // Valores atípicos robustos en la venta (|z| > 3,5 con MAD)
    const { mediana, mad } = medianaMAD(validas.map((v) => v.soles));
    if (mad > 0) for (const v of validas) if (Math.abs(0.6745 * (v.soles - mediana) / mad) > 3.5) acc.agregar('V10', 'Venta atípica (|z robusto| > 3,5)', 'BAJA', v.fila);
  }

  // Meses: ¿el último está incompleto? (menos del 25 % de la mediana de filas por mes)
  const porMes = new Map<string, number>();
  validas.forEach((v) => porMes.set(v.fecha.slice(0, 7), (porMes.get(v.fecha.slice(0, 7)) ?? 0) + 1));
  const meses = [...porMes.keys()].sort();
  let ultimoCerrado = meses.at(-1) ?? null;
  if (meses.length >= 3) {
    const med = medianaMAD([...porMes.values()]).mediana;
    const ult = meses.at(-1)!;
    if (porMes.get(ult)! < 0.25 * med) {
      acc.fijar({ regla: 'V11', descripcion: `Mes incompleto ${ult} (${porMes.get(ult)} filas vs. mediana ${med}); se excluye del pronóstico`, severidad: 'INFO', afectados: porMes.get(ult)!, ejemplos: [] });
      ultimoCerrado = meses.at(-2)!;
    }
  }
  // Unidad del volumen ambigua (encabezado dice toneladas pero las magnitudes no son plausibles)
  const mv = mapeo.find((m) => m.campo === 'volumen');
  if (mv && /\bton\b/.test(normalizar(mv.columnaOrigen))) {
    const medVol = medianaMAD(validas.map((v) => v.volumen ?? 0)).mediana;
    if (medVol > 1000) acc.fijar({ regla: 'V12', descripcion: `Unidad ambigua en "${mv.columnaOrigen}" (mediana ${Math.round(medVol).toLocaleString('en-US')}): se trata como "volumen reportado"`, severidad: 'INFO', afectados: validas.length, ejemplos: [] });
  }
  if (falt.length) acc.fijar({ regla: 'V00', descripcion: `Faltan columnas obligatorias: ${falt.join(', ')}`, severidad: 'CRITICA', afectados: hoja.filas.length, ejemplos: [] });

  const hallazgos = acc.lista();
  const rechazadas = filasOrigen - validas.length;
  const estado = falt.length || validas.length === 0 ? 'DATOS_INCOMPLETOS' : 'DATOS_VALIDADOS';
  const fechas = validas.map((v) => v.fecha).sort();
  const indice = indiceCalidad(hallazgos.filter((h) => h.regla !== 'V00'), Math.max(filasOrigen, 1));

  // ---------- Persistencia (una sola transacción) ----------
  const datasetId = bd.transaccion(() => {
    bd.run(
      `INSERT INTO dataset (nombre, tipo, archivo, hash_sha256, hojas, filas_origen, filas_validas, fecha_min, fecha_max, ultimo_mes_cerrado, estado)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [op.nombre ?? 'Ventas y Utilidad', 'ventas', archivo, hash, hojas.length, filasOrigen, validas.length, fechas[0] ?? null, fechas.at(-1) ?? null, ultimoCerrado, estado],
    );
    const id = bd.ultimoId();
    const skus = [...new Set(validas.map((v) => v.sku))].sort();
    bd.insertarMuchos('INSERT INTO producto (dataset_id, codigo, descripcion, familia) VALUES (?,?,?,?)', skus.map((s) => [id, s, null, null]));
    const idProd = new Map(bd.todas<{ id: number; codigo: string }>('SELECT id, codigo FROM producto WHERE dataset_id=?', [id]).map((p) => [p.codigo, p.id]));
    bd.insertarMuchos(
      `INSERT INTO venta (dataset_id, n_origen, fecha, ruc, cliente, direccion, departamento, producto_id, sku, soles, volumen, utilidad, origen)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'excel')`,
      validas.map((v) => [id, v.n, v.fecha, v.ruc, v.cliente, v.direccion, v.departamento, idProd.get(v.sku)!, v.sku, v.soles, v.volumen, v.utilidad] as SqlValue[]),
    );
    bd.insertarMuchos('INSERT INTO mapeo_columna (dataset_id, columna_origen, campo_canonico, confianza, confirmado) VALUES (?,?,?,?,?)',
      mapeo.map((m) => [id, m.columnaOrigen, m.campo, m.confianza, op.mapeoManual ? 1 : 0]));
    const filasH: SqlValue[][] = [];
    for (const h of hallazgos) {
      filasH.push([id, h.regla, h.severidad, 'venta', null, `${h.descripcion} · registros: ${h.afectados}`]);
      for (const f of h.ejemplos.slice(0, 20)) filasH.push([id, h.regla, h.severidad, 'venta', f, h.descripcion]);
    }
    bd.insertarMuchos('INSERT INTO calidad_hallazgo (dataset_id, regla, severidad, entidad, fila_origen, detalle) VALUES (?,?,?,?,?,?)', filasH);
    return id;
  });

  const resumen: ResumenIngestaVentas = {
    datasetId, estado, archivo, hash, hoja: hoja.nombre, filaEncabezado: det.fila + 1, mapeo, faltantes: falt,
    filasOrigen, filasValidas: validas.length, filasRechazadas: rechazadas,
    productos: new Set(validas.map((v) => v.sku)).size, clientes: new Set(validas.map((v) => v.ruc ?? v.cliente)).size,
    fechaMin: fechas[0] ?? null, fechaMax: fechas.at(-1) ?? null, ultimoMesCerrado: ultimoCerrado,
    mesesCerrados: ultimoCerrado ? meses.filter((m) => m <= ultimoCerrado!).length : 0,
    totalSoles: validas.reduce((s, v) => s + v.soles, 0), totalUtilidad: validas.reduce((s, v) => s + v.utilidad, 0),
    hallazgos, indiceCalidad: indice, duracionMs: Date.now() - t0,
  };
  registrarUso(bd, 'Importar Excel de ventas', 'Datos', `${archivo}: ${validas.length} filas válidas, ${rechazadas} rechazadas, calidad ${indice}/100`, t0);
  return resumen;
}
