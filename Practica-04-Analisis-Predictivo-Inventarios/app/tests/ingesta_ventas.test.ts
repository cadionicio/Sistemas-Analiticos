/**
 * Pruebas de la F2 (Paso 4): BD + importador de VENTAS.
 * Los valores esperados se calcularon de forma INDEPENDIENTE con Python/pandas (tests/fixtures/esperado_ventas.json).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { BaseDatos } from '../src/core/db/db';
import { importarVentas, type ResumenIngestaVentas } from '../src/core/ingesta/ventas';
import { registrarVentaManual, validarVentaManual } from '../src/core/ingesta/manual';
import { mapearVentas, puntuar } from '../src/core/ingesta/mapeo';
import { detectarTipo } from '../src/core/ingesta/detectar';
import { leerLibro } from '../src/core/ingesta/excel';
import { aFechaISO, aNumero, serialExcelAISO, sha256, sha256JS, fmtMillones } from '../src/core/util/util';
import { indiceCalidad } from '../src/core/ingesta/calidad';

const esperado = JSON.parse(readFileSync('tests/fixtures/esperado_ventas.json', 'utf8'));
const xlsx = readFileSync('tests/fixtures/ventas.xlsx');

describe('T-DB · Base de datos', () => {
  it('T-DB-01 crea el esquema v1.0 con 24 tablas y parámetros por defecto', async () => {
    const bd = await BaseDatos.abrir();
    const n = bd.valor<number>("SELECT count(*) FROM sqlite_master WHERE type='table'");
    expect(n).toBe(24);
    expect(bd.valor<string>("SELECT valor FROM parametro WHERE clave='horizonte_meses'")).toBe('6');
  });
  it('T-DB-02 exporta y reabre la BD sin pérdida (persistencia .sqlite)', async () => {
    const bd = await BaseDatos.abrir();
    bd.run("INSERT INTO configuracion VALUES ('tema','oscuro')");
    const bd2 = await BaseDatos.abrir(bd.exportar());
    expect(bd2.valor<string>("SELECT valor FROM configuracion WHERE clave='tema'")).toBe('oscuro');
  });
  it('T-DB-03 revierte la transacción ante un error', async () => {
    const bd = await BaseDatos.abrir();
    expect(() => bd.transaccion(() => { bd.run("INSERT INTO configuracion VALUES ('a','1')"); throw new Error('x'); })).toThrow();
    expect(bd.valor<number>('SELECT count(*) FROM configuracion')).toBe(0);
  });
});

describe('T-UTIL · Utilidades', () => {
  it('convierte series de Excel y textos a fecha ISO sin desfase de zona horaria', () => {
    expect(serialExcelAISO(40179)).toBe('2010-01-01');
    expect(aFechaISO('31/03/2019')).toBe('2019-03-31');
    expect(aFechaISO('2019-02-30')).toBeNull();
  });
  it('interpreta números en formatos peruanos', () => {
    expect(aNumero('S/ 1,234.50')).toBe(1234.5);
    expect(aNumero('1.234,50')).toBe(1234.5);
    expect(aNumero('abc')).toBeNull();
  });
  it('SHA-256: Web Crypto y respaldo JS coinciden (vector "abc" de FIPS 180-4)', async () => {
    const abc = new TextEncoder().encode('abc');
    const h = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(await sha256(abc)).toBe(h);
    expect(sha256JS(abc)).toBe(h);
  });
  it('formato numérico único del PC1', () => {
    expect(fmtMillones(1045600000)).toBe('S/ 1,045.6 M');
  });
});

describe('T-ING · Mapeo y detección', () => {
  it('T-ING-01 mapea los encabezados reales del Excel de ventas', () => {
    const m = mapearVentas(['N°', 'RUC', 'Razon Social Cliente', 'Dirección', 'Departamento', 'Ventas (Soles)', 'Item/Código Producto', 'Venta (Ton)', 'Fecha', 'Utilidad Operativa (Soles)']);
    const campo = (i: number) => m.find((x) => x.indice === i)?.campo;
    expect([campo(0), campo(1), campo(2), campo(3), campo(4), campo(5), campo(6), campo(7), campo(8), campo(9)])
      .toEqual(['n_origen', 'ruc', 'cliente', 'direccion', 'departamento', 'soles', 'sku', 'volumen', 'fecha', 'utilidad']);
  });
  it('T-ING-02 reconoce sinónimos alternativos', () => {
    const m = mapearVentas(['Fec. Emisión', 'Cod. Artículo', 'Importe', 'Ganancia', 'Cantidad']);
    expect(m.map((x) => x.campo).sort()).toEqual(['fecha', 'soles', 'sku', 'utilidad', 'volumen'].sort());
    expect(puntuar('Ventas (Soles)', 'ventas soles')).toBe(1);
  });
  it('T-ING-03 detecta el tipo de cada archivo de la práctica', () => {
    expect(detectarTipo(leerLibro(xlsx))).toBe('ventas');
    expect(detectarTipo(leerLibro(readFileSync('tests/fixtures/kardex.xls')))).toBe('kardex');
  });
});

describe('T-ING · Importación del Excel real de ventas (20 000 filas)', () => {
  let bd: BaseDatos; let r: ResumenIngestaVentas;
  beforeAll(async () => {
    bd = await BaseDatos.abrir();
    r = await importarVentas(bd, xlsx, 'TABLA DATOS MOVIMIENTOS VENTAS Y UTILIDAD.xlsx');
  });
  it('T-ING-04 filas, productos, clientes y rango de fechas coinciden con pandas', () => {
    expect(r.estado).toBe('DATOS_VALIDADOS');
    expect(r.filasOrigen).toBe(esperado.filas);
    expect(r.filasValidas).toBe(esperado.filas);
    expect(r.filasRechazadas).toBe(0);
    expect(r.productos).toBe(esperado.productos);
    expect(r.clientes).toBe(esperado.clientes);
    expect(r.fechaMin).toBe(esperado.fechaMin);
    expect(r.fechaMax).toBe(esperado.fechaMax);
  });
  it('T-ING-05 detecta abril 2019 incompleto → último mes cerrado 2019-03 (111 meses)', () => {
    expect(r.ultimoMesCerrado).toBe(esperado.ultimoMesCerrado);
    expect(r.mesesCerrados).toBe(esperado.mesesCerrados);
    expect(r.hallazgos.find((h) => h.regla === 'V11')?.afectados).toBe(esperado.abril2019);
  });
  it('T-ING-06 totales en soles y utilidad reconcilian con pandas (tolerancia S/ 0.01)', () => {
    expect(Math.abs(r.totalSoles - esperado.totalSoles)).toBeLessThan(0.01);
    expect(Math.abs(r.totalUtilidad - esperado.totalUtilidad)).toBeLessThan(0.01);
    const bdSoles = bd.valor<number>('SELECT sum(soles) FROM venta WHERE dataset_id=?', [r.datasetId]);
    expect(Math.abs(bdSoles - esperado.totalSoles)).toBeLessThan(0.01);
    const mar19 = bd.valor<number>("SELECT sum(soles) FROM venta WHERE periodo='2019-03'");
    expect(Math.abs(mar19 - esperado.soles_2019_03)).toBeLessThan(0.01);
  });
  it('T-ING-07 reglas de calidad: conteos idénticos a pandas', () => {
    const n = (regla: string) => r.hallazgos.find((h) => h.regla === regla)?.afectados ?? 0;
    expect(n('V06')).toBe(esperado.V06);
    expect(n('V07')).toBe(esperado.V07);
    expect(n('V05')).toBe(esperado.V05);
    expect(n('V08')).toBe(esperado.V08);
    expect(n('V09')).toBe(esperado.V09);
    expect(n('V10')).toBe(esperado.V10);
    expect(r.hallazgos.some((h) => h.regla === 'V12')).toBe(true); // unidad ambigua de "Venta (Ton)"
  });
  it('T-ING-08 índice de calidad según la fórmula documentada', () => {
    expect(r.indiceCalidad).toBe(indiceCalidad(r.hallazgos, r.filasOrigen));
    expect(r.indiceCalidad).toBeCloseTo(100 * (1 - 0.2 * esperado.V06 / esperado.filas), 1);
  });
  it('T-ING-09 columnas calculadas: costo y precio implícitos', () => {
    const f = bd.una<{ soles: number; utilidad: number; volumen: number; costo_implicito: number; precio_implicito: number }>(
      'SELECT soles, utilidad, volumen, costo_implicito, precio_implicito FROM venta LIMIT 1');
    expect(f!.costo_implicito).toBeCloseTo(f!.soles - f!.utilidad, 6);
    expect(f!.precio_implicito).toBeCloseTo(f!.soles / f!.volumen, 6);
  });
  it('T-ING-10 guarda mapeo, hallazgos, hash y bitácora de uso', () => {
    expect(bd.valor<number>('SELECT count(*) FROM mapeo_columna WHERE dataset_id=?', [r.datasetId])).toBe(10);
    expect(bd.valor<number>('SELECT count(*) FROM calidad_hallazgo WHERE dataset_id=?', [r.datasetId])).toBeGreaterThan(0);
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(bd.valor<string>('SELECT accion FROM bitacora_uso ORDER BY id DESC LIMIT 1')).toBe('Importar Excel de ventas');
  });
  it('T-ING-11 registro manual: valida, inserta, audita y rechaza datos inválidos', () => {
    expect(validarVentaManual({ fecha: '31/02/2019', sku: '', soles: -1, utilidad: NaN })).toHaveLength(4);
    const id = registrarVentaManual(bd, r.datasetId, { fecha: '15/03/2019', sku: 'K00401', soles: 1000, utilidad: 50, volumen: 100 });
    expect(bd.valor<string>('SELECT origen FROM venta WHERE id=?', [id])).toBe('manual');
    expect(bd.valor<number>("SELECT count(*) FROM auditoria WHERE entidad='venta'")).toBe(1);
    expect(() => registrarVentaManual(bd, r.datasetId, { fecha: 'x', sku: 'A', soles: 1, utilidad: 0 })).toThrow(/fecha/);
  });
  it('T-ING-12 rendimiento: importa 20 000 filas en menos de 15 s', () => {
    expect(r.duracionMs).toBeLessThan(15000);
  });
});
