/** Render del modelo de informe a Word (.docx) con la librería `docx` (100 % en memoria, sin servidor). */
import { AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, Packer, PageBreak, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import type { Bloque, Documento } from './modelo';
import { ecuacionWord } from './formulas';

const AZUL = '0F2A47', AZUL2 = '2A78D6', GRIS = '5B5A55', BORDE = 'D9D8D2';
const FUENTE = 'Calibri';
const deB64 = (u: string) => Uint8Array.from(atob(u.split(',')[1]), (c) => c.charCodeAt(0));
const TAG: Record<string, string> = { '[E]': '0A5C0A', '[D]': '7A5200', '[S]': '1C5CAB' };

/** Texto con etiquetas [E]/[D]/[S] resaltadas y matemática en línea escrita en LaTeX entre $…$ (ecuación nativa de Word). */
function runs(texto: string, opc: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}): (TextRun | ReturnType<typeof ecuacionWord>)[] {
  const m = texto.match(/^\[(E|D|S)\]\s*/);
  const r: (TextRun | ReturnType<typeof ecuacionWord>)[] = [];
  if (m) r.push(new TextRun({ text: `[${m[1]}] `, bold: true, color: TAG[`[${m[1]}]`], font: FUENTE, size: opc.size }));
  (m ? texto.slice(m[0].length) : texto).split(/(\$[^$]+\$)/).forEach((seg) => {
    if (!seg) return;
    r.push(seg.startsWith('$') && seg.endsWith('$') && seg.length > 2 ? ecuacionWord(seg.slice(1, -1)) : new TextRun({ text: seg, font: FUENTE, ...opc }));
  });
  return r;
}
const celda = (t: string, cab: boolean, derecha: boolean, ancho?: number) => new TableCell({
  children: [new Paragraph({ children: runs(t, { bold: cab, color: cab ? 'FFFFFF' : undefined, size: 17 }), alignment: derecha ? AlignmentType.RIGHT : AlignmentType.LEFT })],
  shading: cab ? { type: ShadingType.CLEAR, fill: AZUL, color: 'auto' } : undefined,
  margins: { top: 40, bottom: 40, left: 80, right: 80 }, width: ancho ? { size: ancho, type: WidthType.PERCENTAGE } : undefined,
});
const bordes = { top: { style: BorderStyle.SINGLE, size: 4, color: BORDE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDE }, left: { style: BorderStyle.SINGLE, size: 4, color: BORDE }, right: { style: BorderStyle.SINGLE, size: 4, color: BORDE }, insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: BORDE }, insideVertical: { style: BorderStyle.SINGLE, size: 4, color: BORDE } };

function bloque(b: Bloque): (Paragraph | Table)[] {
  switch (b.t) {
    case 'h1': return [new Paragraph({ text: b.texto, heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } })];
    case 'h2': return [new Paragraph({ text: b.texto, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } })];
    case 'h3': return [new Paragraph({ text: b.texto, heading: HeadingLevel.HEADING_3 })];
    case 'p': return [new Paragraph({ children: runs(b.texto, b.estilo === 'nota' ? { italics: true, color: GRIS, size: 18 } : b.estilo === 'destacado' ? { bold: true, color: AZUL } : {}), spacing: { after: 120 }, alignment: AlignmentType.JUSTIFIED })];
    case 'vinetas': return b.items.map((i) => new Paragraph({ children: runs(i), bullet: { level: 0 }, spacing: { after: 60 } }));
    case 'salto': return [new Paragraph({ children: [new PageBreak()] })];
    case 'imagen': return [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: deB64(b.dataUrl), transformation: { width: 600, height: Math.round(600 * b.alto / b.ancho) } })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: b.pie, italics: true, size: 17, color: GRIS, font: FUENTE })], spacing: { after: 160 } })];
    case 'ecuaciones': return b.items.flatMap((e) => [
      new Paragraph({ children: [new TextRun({ text: e.nombre, bold: true, color: AZUL2, font: FUENTE, size: 20 })], spacing: { before: 120, after: 40 }, keepNext: true }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [ecuacionWord(e.tex)], spacing: { after: e.nota ? 40 : 120 }, keepNext: !!e.nota }),
      ...(e.nota ? [new Paragraph({ children: runs(e.nota, { size: 18, color: GRIS }), spacing: { after: 120 } })] : [])]);
    case 'kpis': return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: bordes, rows: [new TableRow({ children: b.items.map((k) => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: 'EEF4FC', color: 'auto' }, margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: [new Paragraph({ children: [new TextRun({ text: k.et, size: 17, color: GRIS, font: FUENTE })] }), new Paragraph({ children: [new TextRun({ text: k.v, bold: true, size: 30, color: AZUL, font: FUENTE })] }), new Paragraph({ children: [new TextRun({ text: k.d, size: 16, color: GRIS, font: FUENTE })] })] })) })] }),
      new Paragraph({ text: '' })];
    case 'tabla': {
      const num = new Set(b.num ?? []);
      return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: bordes, rows: [
        new TableRow({ tableHeader: true, children: b.cols.map((c, i) => celda(c, true, num.has(i), b.anchos?.[i])) }),
        ...b.filas.map((f) => new TableRow({ children: f.map((v, i) => celda(v, false, num.has(i), b.anchos?.[i])) }))] }), new Paragraph({ text: '', spacing: { after: 80 } })];
    }
  }
}

function portada(d: Documento): Paragraph[] {
  return [
    new Paragraph({ spacing: { before: 1800 }, children: [new TextRun({ text: 'UNIVERSIDAD NACIONAL DE INGENIERÍA · FIIS', bold: true, color: GRIS, size: 20, font: FUENTE })] }),
    new Paragraph({ spacing: { before: 400, after: 200 }, children: [new TextRun({ text: d.titulo, bold: true, size: 48, color: AZUL, font: FUENTE })] }),
    new Paragraph({ spacing: { after: 600 }, children: [new TextRun({ text: d.subtitulo, size: 24, color: AZUL2, font: FUENTE })] }),
    ...d.portada.map(([k, v]) => new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `${k}: `, bold: true, font: FUENTE, size: 22 }), new TextRun({ text: v, font: FUENTE, size: 22 })] })),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

/** Uno o varios documentos (p. ej. v1–v3 del informe ejecutivo) en un solo .docx. */
export async function aWord(docs: Documento[], prefacio: Bloque[] = []): Promise<Uint8Array> {
  const cuerpo: (Paragraph | Table)[] = [...prefacio.flatMap(bloque)];
  docs.forEach((d, i) => { if (i > 0 || prefacio.length) cuerpo.push(new Paragraph({ children: [new PageBreak()] })); cuerpo.push(...portada(d), ...d.bloques.flatMap(bloque)); });
  const doc = new Document({
    creator: 'Dionicio Achachagua Cesar Alonso (20192589B)', title: docs[0].titulo, description: 'Generado por el Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios',
    styles: { default: { document: { run: { font: FUENTE, size: 21 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, color: AZUL, font: FUENTE } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 25, bold: true, color: AZUL2, font: FUENTE } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, font: FUENTE } }] },
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${docs.length > 1 ? 'Informe ejecutivo · versiones v1–v' + docs.length : docs[0].titulo} · v${docs.at(-1)!.version}`, size: 16, color: GRIS, font: FUENTE })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios · Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], size: 16, color: GRIS, font: FUENTE })] })] }) },
      children: cuerpo,
    }],
  });
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}
