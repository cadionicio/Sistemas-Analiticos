/**
 * Pruebas del Paso 5: importador del KARDEX (reporte .xls), registro manual y módulo de calidad.
 * Valores esperados calculados de forma INDEPENDIENTE con Python/pandas (tests/fixtures/esperado_kardex.json).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { BaseDatos } from '../src/core/db/db';
import { importarKardex, clasificarMotivo, parsearProducto, hojaAPeriodo, type ResumenIngestaKardex } from '../src/core/ingesta/kardex';
import { registrarMovimientoManual, validarMovimiento } from '../src/core/ingesta/kardex_manual';
import { resumenCalidad, ejemplosRegla } from '../src/core/ingesta/calidad_resumen';
import { importarArchivo } from '../src/core/ingesta/importar';

const esp = JSON.parse(readFileSync('tests/fixtures/esperado_kardex.json', 'utf8'));
const xls = readFileSync('tests/fixtures/kardex.xls');

describe('T-KAR · Funciones del parser', () => {
  it('interpreta los dos formatos de encabezado de producto', () => {
    expect(parsearProducto(' - CE-GC005-216 - PASTILLAS DE CARBURO .785 Ø .216 Ø .315 LG - OPRCLO0000000088'))
      .toEqual({ codigo: 'CE-GC005-216', descripcion: 'PASTILLAS DE CARBURO .785 Ø .216 Ø .315 LG', lote: 'OPRCLO0000000088', familia: 'CE' });
    const p = parsearProducto('TECNOWELD - AL6063-1.80 - ALAMBRE DE ALUMINIO 6063, Ø: 1.80 mm');
    expect(p?.codigo).toBe('AL6063-1.80');
    expect(p?.familia).toBe('AL6063');
  });
  it('clasifica los 15 motivos reales en las clases del modelo', () => {
    expect(clasificarMotivo('Venta', 0, 5)).toBe('SALIDA_VENTA');
    expect(clasificarMotivo('Por Produccion en Planta', 0, 5)).toBe('SALIDA_CONSUMO');
    expect(clasificarMotivo('Ingreso a Almacen de Producto Terminado', 5, 0)).toBe('ENTRADA_PRODUCCION');
    expect(clasificarMotivo('Compras locales', 5, 0)).toBe('ENTRADA_COMPRA');
    expect(clasificarMotivo('Compra del Extranjero', 5, 0)).toBe('ENTRADA_COMPRA');
    expect(clasificarMotivo('Transformacion Salida - DIGITADO', 0, 5)).toBe('TRANSFORMACION');
    expect(clasificarMotivo('Devolucion AUTOMATICA - Produccion', 5, 0)).toBe('ENTRADA_PRODUCCION');
    expect(clasificarMotivo('Por Cambio - Ingreso', 5, 0)).toBe('AJUSTE_DEVOLUCION');
    expect(clasificarMotivo('Ingreso por Garantia', 5, 0)).toBe('AJUSTE_DEVOLUCION');
    expect(clasificarMotivo('MUESTRAS', 0, 1)).toBe('SALIDA_VENTA');
    for (const m of Object.keys(esp.motivos)) expect(clasificarMotivo(m, 1, 0)).not.toBe('OTRO');
  });
  it('periodo desde el nombre de la hoja', () => {
    expect(hojaAPeriodo('12-2009')).toBe('2009-12');
    expect(hojaAPeriodo('01-2009 hasta hoy')).toBeNull();
  });
});

describe('T-KAR · Importación del Kardex real (13 hojas)', () => {
  let bd: BaseDatos; let r: ResumenIngestaKardex;
  beforeAll(async () => {
    bd = await BaseDatos.abrir();
    r = await importarKardex(bd, xls, 'KARDEX MOVIMIENTOS ALMACEN.xls');
  });
  const n = (regla: string) => r.hallazgos.find((h) => h.regla === regla)?.afectados ?? 0;

  it('T-KAR-01 movimientos, bloques, productos, hojas y fechas coinciden con pandas', () => {
    expect(r.estado).toBe('DATOS_VALIDADOS');
    expect(r.hojas).toBe(esp.hojas);
    expect(r.movimientos).toBe(esp.movimientos);
    expect(r.bloques).toBe(esp.bloques);
    expect(r.productos).toBe(esp.productos);
    expect(r.fechaMin).toBe(esp.fechaMin);
    expect(r.fechaMax).toBe(esp.fechaMax);
    expect(r.meses).toBe(18);
    expect(bd.valor<string>('SELECT ultimo_mes_cerrado FROM dataset WHERE id=?', [r.datasetId])).toBe('2010-05'); // junio 2010 incompleto
    expect(r.hallazgos.find((h) => h.regla === 'K11')?.afectados).toBe(177);
  });
  it('T-KAR-02 totales de entradas y salidas reconcilian', () => {
    expect(Math.abs(r.entradas - esp.entradas)).toBeLessThan(0.01);
    expect(Math.abs(r.salidas - esp.salidas)).toBeLessThan(0.01);
    expect(Math.abs(bd.valor<number>('SELECT sum(entrada) FROM kardex_mov') - esp.entradas)).toBeLessThan(0.01);
  });
  it('T-KAR-03 conciliación: saldos que no cuadran (K01), negativos (K02), bloques descuadrados (K03)', () => {
    expect(n('K01')).toBe(esp.K01);
    expect(n('K02')).toBe(esp.K02);
    expect(n('K03')).toBe(esp.K03);
    expect(n('K05')).toBe(esp.K05);
    expect(n('K09')).toBe(esp.K09);
    expect(n('K07')).toBe(esp.K07);
  });
  it('T-KAR-04 continuidad entre meses verificada sin diferencias', () => {
    expect(n('K04')).toBe(0);
    expect(r.hallazgos.find((h) => h.regla === 'K04-OK')?.afectados).toBeGreaterThan(1000);
  });
  it('T-KAR-05 detecta que la hoja "01-2009 hasta hoy" contiene ene–jun 2010', () => {
    const h = r.hallazgos.find((x) => x.regla === 'K06-01-2009 hasta hoy');
    expect(h?.descripcion).toMatch(/2010-01 a 2010-06/);
  });
  it('T-KAR-06 las columnas calculadas de la BD marcan las mismas inconsistencias', () => {
    expect(bd.valor<number>('SELECT count(*) FROM kardex_mov WHERE flag_inconsistente=1')).toBe(esp.K01);
    expect(bd.valor<number>('SELECT count(*) FROM kardex_mov WHERE flag_negativo=1')).toBe(esp.K02);
    expect(bd.valor<number>('SELECT count(*) FROM kardex_bloque WHERE conciliado=0')).toBe(esp.K03);
  });
  it('T-KAR-07 clases de movimiento: conteos por motivo', () => {
    expect(r.porClase.SALIDA_VENTA).toBe(esp.motivos['Venta'] + esp.motivos['MUESTRAS']);
    expect(r.porClase.SALIDA_CONSUMO).toBe(esp.motivos['Por Produccion en Planta']);
    expect(r.porClase.OTRO ?? 0).toBe(0);
  });
  it('T-KAR-08 módulo de calidad: resumen y ejemplos de filas para revisar', () => {
    const q = resumenCalidad(bd, r.datasetId);
    expect(q.tipo).toBe('kardex');
    expect(q.porSeveridad.CRITICA).toBe(1);
    expect(ejemplosRegla(bd, r.datasetId, 'K01').length).toBe(20);
  });
  it('T-KAR-09 registro manual: salida que deja stock negativo se registra con advertencia', () => {
    expect(validarMovimiento({ fecha: '', codigo: '', tipo: 'X' as never, cantidad: 0, motivo: '' })).toHaveLength(5);
    const ent = registrarMovimientoManual(bd, r.datasetId, { fecha: '20/06/2010', codigo: 'NUEVO-001', tipo: 'ENTRADA', cantidad: 10, motivo: 'Compras locales' });
    expect(ent.stock).toBe(10);
    const sal = registrarMovimientoManual(bd, r.datasetId, { fecha: '21/06/2010', codigo: 'NUEVO-001', tipo: 'SALIDA', cantidad: 15, motivo: 'Venta' });
    expect(sal.stock).toBe(-5);
    expect(sal.advertencias[0]).toMatch(/negativo/);
    expect(bd.valor<string>('SELECT clase_mov FROM kardex_mov WHERE id=?', [sal.id])).toBe('SALIDA_VENTA');
    expect(bd.valor<number>('SELECT filas_validas FROM dataset WHERE id=?', [r.datasetId])).toBe(esp.movimientos + 2); // INC-08
  });
  it('T-KAR-10 rendimiento: importa el Kardex completo en menos de 15 s', () => {
    expect(r.duracionMs).toBeLessThan(15000);
  });
});

describe('T-ING · Enrutador de importación', () => {
  it('T-ING-13 importa ambos archivos de la práctica en la misma BD, cada uno como dataset independiente', async () => {
    const bd = await BaseDatos.abrir();
    const a = await importarArchivo(bd, readFileSync('tests/fixtures/ventas.xlsx'), 'ventas.xlsx');
    const b = await importarArchivo(bd, xls, 'kardex.xls');
    expect([a.tipo, b.tipo]).toEqual(['ventas', 'kardex']);
    expect(bd.valor<number>('SELECT count(*) FROM dataset')).toBe(2);
    expect(bd.valor<number>('SELECT count(*) FROM bitacora_uso')).toBe(2);
  });
  it('T-ING-14 rechaza un archivo con formato desconocido con un mensaje claro', async () => {
    const bd = await BaseDatos.abrir();
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2]]), 'x');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    await expect(importarArchivo(bd, buf, 'x.xlsx')).rejects.toThrow(/No se reconoce el formato/);
  });
});
