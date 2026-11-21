/** Render del mismo modelo de informe a PDF (jsPDF + autoTable), en memoria. */
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { Bloque, Documento } from './modelo';
import { ecuacionPNG } from './formulas';

/** Matemática en línea ($…$) a texto plano legible con fuentes WinAnsi. */
const plano = (t: string) => t.replace(/\$([^$]+)\$/g, (_m, x: string) => x.replace(/\\bar\{(\w+)\}/g, '$1 media').replace(/\\sigma/g, 'sigma').replace(/\\mu/g, 'mu').replace(/\\alpha/g, 'alfa').replace(/_\{([^}]*)\}/g, '_$1').replace(/\\[a-z]+/g, '').replace(/[{}]/g, ''));

/** Las fuentes estándar de PDF usan WinAnsi: se reemplazan los símbolos que no existen en esa tabla. */
const txt = (s: string) => plano(s).replace(/σ/g, 's').replace(/√/g, 'raíz').replace(/²/g, '^2').replace(/≈/g, '~').replace(/[→⇒]/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=')
  .replace(/−/g, '-').replace(/d̄/g, 'd').replace(/̄/g, '').replace(/[✔✓]/g, 'OK').replace(/[⚠⛔▲▼•]/g, '-').replace(/[^\u0000-ÿ–—‘’“”•…€]/g, '');
const AZUL: [number, number, number] = [15, 42, 71], AZUL2: [number, number, number] = [42, 120, 214], GRIS: [number, number, number] = [91, 90, 85];

export function aPDF(docs: Documento[], prefacio: Bloque[] = []): Uint8Array {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 18, AN = W - 2 * M;
  let y = M;
  const espacio = (h: number) => { if (y + h > H - M - 8) { pdf.addPage(); y = M; } };
  const parrafo = (t: string, tam = 10, estilo: 'normal' | 'bold' | 'italic' = 'normal', color: [number, number, number] = [20, 20, 20], sangria = 0) => {
    pdf.setFont('helvetica', estilo); pdf.setFontSize(tam); pdf.setTextColor(...color);
    const lineas = pdf.splitTextToSize(txt(t), AN - sangria) as string[];
    for (const l of lineas) { espacio(tam * 0.45); pdf.text(l, M + sangria, y); y += tam * 0.45; }
    y += 1.5;
  };
  const render = (b: Bloque) => {
    switch (b.t) {
      case 'h1': y += 3; espacio(14); parrafo(b.texto, 15, 'bold', AZUL); pdf.setDrawColor(...AZUL2); pdf.setLineWidth(0.4); pdf.line(M, y - 2, M + AN, y - 2); y += 2; break;
      case 'h2': espacio(10); parrafo(b.texto, 12, 'bold', AZUL2); break;
      case 'h3': parrafo(b.texto, 11, 'bold'); break;
      case 'p': parrafo(b.texto, b.estilo === 'nota' ? 8.5 : 10, b.estilo === 'nota' ? 'italic' : b.estilo === 'destacado' ? 'bold' : 'normal', b.estilo === 'nota' ? GRIS : b.estilo === 'destacado' ? AZUL : [20, 20, 20]); break;
      case 'vinetas': for (const i of b.items) { pdf.setFontSize(10); espacio(5); pdf.text('•', M + 1, y); parrafo(i, 10, 'normal', [20, 20, 20], 5); } break;
      case 'salto': pdf.addPage(); y = M; break;
      case 'imagen': { const h = AN * b.alto / b.ancho; espacio(h + 8); pdf.addImage(b.dataUrl, 'PNG', M, y, AN, h, undefined, 'FAST'); y += h + 2; parrafo(b.pie, 8.5, 'italic', GRIS); break; }
      case 'ecuaciones': for (const e of b.items) {
        const im = ecuacionPNG(e.tex), w = Math.min(AN * 0.9, im.w * 0.1), h = im.h * 0.1 * (w / (im.w * 0.1));
        espacio(h + 12); parrafo(e.nombre, 10, 'bold', AZUL2);
        pdf.addImage(im.dataUrl, 'PNG', M + (AN - w) / 2, y - 1, w, h, undefined, 'FAST'); y += h + 2;
        if (e.nota) parrafo(e.nota, 8.5, 'normal', GRIS);
      } break;
      case 'kpis': {
        const n = b.items.length, w = (AN - (n - 1) * 3) / n; espacio(24);
        b.items.forEach((k, i) => {
          const x = M + i * (w + 3); pdf.setFillColor(238, 244, 252); pdf.roundedRect(x, y, w, 21, 2, 2, 'F');
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...GRIS); pdf.text(pdf.splitTextToSize(txt(k.et), w - 4)[0], x + 2.5, y + 5);
          pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(...AZUL); pdf.text(txt(k.v), x + 2.5, y + 12.5);
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...GRIS); pdf.text(pdf.splitTextToSize(txt(k.d), w - 4)[0], x + 2.5, y + 18);
        });
        y += 25; break;
      }
      case 'tabla': {
        const num = new Set(b.num ?? []);
        autoTable(pdf, {
          startY: y, margin: { left: M, right: M, top: M, bottom: M + 6 }, head: [b.cols.map(txt)], body: b.filas.map((f) => f.map(txt)),
          styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, lineColor: [217, 216, 210], lineWidth: 0.1, overflow: 'linebreak' },
          headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold' }, alternateRowStyles: { fillColor: [247, 247, 244] },
          columnStyles: Object.fromEntries(b.cols.map((_, i) => [i, { halign: num.has(i) ? 'right' : 'left', ...(b.anchos ? { cellWidth: AN * b.anchos[i] / 100 } : {}) }])),
        });
        y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4; break;
      }
    }
  };
  prefacio.forEach(render);
  docs.forEach((d, i) => {
    if (i > 0 || prefacio.length) { pdf.addPage(); y = M; }
    y = 60;
    parrafo('UNIVERSIDAD NACIONAL DE INGENIERÍA · FIIS', 10, 'bold', GRIS); y += 8;
    parrafo(d.titulo, 22, 'bold', AZUL); parrafo(d.subtitulo, 12, 'normal', AZUL2); y += 14;
    d.portada.forEach(([k, v]) => parrafo(`${k}: ${v}`, 11));
    pdf.addPage(); y = M;
    d.bloques.forEach(render);
  });
  const n = pdf.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    pdf.setPage(p); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...GRIS);
    pdf.text(txt(`Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios · ${docs[0].titulo} · v${docs.at(-1)!.version}`), M, H - 9);
    pdf.text(`Página ${p} de ${n}`, W - M, H - 9, { align: 'right' });
  }
  pdf.setProperties({ title: txt(docs[0].titulo), author: 'Dionicio Achachagua Cesar Alonso (20192589B)', creator: 'Sistema de Analisis de Datos y Predictivo de Gestion de Inventarios' });
  return new Uint8Array(pdf.output('arraybuffer'));
}
