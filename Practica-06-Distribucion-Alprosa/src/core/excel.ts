// Lectura de Excel por nombre de hoja/columna y generación de la plantilla (ExcelJS).
import ExcelJS from 'exceljs';
import { tablasExcel06 } from './historia';
import type { HojaCruda, Celda } from './contrato';
import { CONTRATO, VERSION_CONTRATO } from './contrato';
import { DATASET_DEMO_ID, type Tabla } from './demo';

function valorCelda(c: ExcelJS.Cell): Celda {
  const v = c.value as unknown;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('formula' in o || 'sharedFormula' in o) return { formula: String(o.formula ?? o.sharedFormula) };
    if ('richText' in o) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in o) return String(o.text);
    if ('error' in o) return '#ERROR';
  }
  return String(v);
}

export async function leerExcel(buf: ArrayBuffer): Promise<HojaCruda[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const hojas: HojaCruda[] = [];
  wb.eachSheet((ws) => {
    const encabezados: string[] = [];
    const colDe: Record<number, string> = {};
    ws.getRow(1).eachCell({ includeEmpty: false }, (c, col) => {
      const t = String(valorCelda(c) ?? '');
      encabezados.push(t);
      colDe[col] = t.normalize('NFC').trim();
    });
    const filas: HojaCruda['filas'] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (n === 1) return;
      const celdas: HojaCruda['filas'][number]['celdas'] = {};
      for (const [col, nombre] of Object.entries(colDe)) {
        const c = row.getCell(Number(col));
        celdas[nombre] = { valor: valorCelda(c), ref: c.address };
      }
      if (Object.values(celdas).some((x) => x.valor !== null && x.valor !== '')) filas.push({ fila: n, celdas });
    });
    hojas.push({ nombre: ws.name, encabezados, filas });
  });
  return hojas;
}

export async function generarPlantilla(tablas: Tabla[] = tablasExcel06(), datasetId = DATASET_DEMO_ID): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema de Distribución — Alprosa';
  const leeme = wb.addWorksheet('LEEME');
  leeme.columns = [{ header: 'seccion', key: 'seccion', width: 28 }, { header: 'descripcion', key: 'descripcion', width: 120 }];
  [
    ['Empresa', 'NutriDemo Distribución S.A.C. — DATOS SINTÉTICOS. No son cifras de Alprosa.'],
    ['Versión de contrato', VERSION_CONTRATO], ['Conjunto', datasetId],
    ['Lectura', 'Por nombre de hoja y de columna; el orden no importa. Columnas obligatorias faltantes o duplicadas invalidan la carga. Columnas o hojas desconocidas se ignoran con advertencia.'],
    ['Política', 'Importación atómica: un solo error impide confirmar y se listan todos los errores por hoja/celda. Reimportar el mismo archivo no duplica.'],
    ['Unidades', 'Cantidades en unidad base del producto (3 decimales); volumen en m³ (6 decimales); precios en PEN por unidad base (4 decimales).'],
    ['Fechas', 'Fechas de Excel o AAAA-MM-DD; instantes AAAA-MM-DDTHH:MM en hora de Lima (UTC−05:00).'],
    ['Códigos territoriales', 'Se escriben como TEXTO y pertenecen a un catálogo FICTICIO declarado; no son códigos oficiales.'],
    ['Formato numérico', 'Celdas numéricas reales; los separadores visibles dependen de la configuración regional de Windows (DEC-I01-D9).'],
    ['Estados', 'Pedidos.estado solo admite BORRADOR o CONFIRMADO; los demás estados se derivan de cantidades y hechos.'],
    ...CONTRATO.map((h) => [`Hoja ${h.hoja}`, `${h.opcional ? '(opcional) ' : '(obligatoria) '}${h.desc}. Columnas: ${h.columnas.map((c) => c.nombre + (c.opcional ? '?' : '')).join(', ')}`]),
  ].forEach(([s, d]) => leeme.addRow({ seccion: s, descripcion: d }));
  leeme.getRow(1).font = { bold: true };
  for (const t of tablas) {
    const ws = wb.addWorksheet(t.hoja);
    ws.addRow(t.cols);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const spec = CONTRATO.find((s) => s.hoja === t.hoja)!;
    t.cols.forEach((c, j) => {
      const col = ws.getColumn(j + 1), cs = spec.columnas.find((x) => x.nombre === c);
      col.width = Math.max(14, c.length + 3);
      if (cs?.tipo === 'decimal3') col.numFmt = '#,##0.000';
      if (cs?.tipo === 'decimal4') col.numFmt = '#,##0.0000';
      if (cs?.tipo === 'decimal6') col.numFmt = '0.000000';
      if (cs?.tipo === 'codigo') col.numFmt = '@';
    });
    for (const f of t.filas) ws.addRow(f as ExcelJS.CellValue[]);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.cols.length } };
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
