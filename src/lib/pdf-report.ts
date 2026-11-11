import PDFDocument from 'pdfkit';
import { formatDate } from './labels';
export type PdfSection = {
  heading: string;
  kpis?: [label: string, value: string][];
  table?: { columns: string[]; rows: string[][] };
};
export type PdfReport = {
  title: string;
  organizationName: string;
  generatedBy: string;
  generatedAt: Date;
  filters: string[];
  sections: PdfSection[];
  notice?: string;
};
const MARGIN = 40;
const FOOTER = 28;
const INK = '#1f2933';
const MUTED = '#5f6c7b';
const LINE = '#cbd2d9';
const SHADE = '#eef1f4';
// Helvetica is a built-in PDF font limited to WinAnsi: anything else would print garbage.
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const unsupported = new RegExp(`[^\\x20-\\x7E\\u00A0-\\u00FF${WIN_ANSI_EXTRA}]+`, 'g');
export const pdfText = (value: string) =>
  value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(unsupported, '?')
    .trim();
// Each column gets at least the width of its longest unbreakable word; the rest follows content length.
function columnWidths(columns: string[], rows: string[][], total: number, size: number) {
  const pad = 3;
  const char = size * 0.56;
  const cells = (i: number) => [columns[i], ...rows.map((row) => row[i] ?? '')].map(pdfText);
  const minimum = columns.map(
    (_, i) =>
      Math.max(
        ...cells(i).flatMap((cell) => cell.split(' ').map((word) => Math.min(14, word.length))),
      ) *
        char +
      pad * 2 +
      1,
  );
  const need = minimum.reduce((a, b) => a + b, 0);
  if (need >= total) return minimum.map((w) => (w / need) * total);
  const weights = columns.map((_, i) =>
    Math.min(28, Math.max(5, ...cells(i).map((cell) => cell.length))),
  );
  const sum = weights.reduce((a, b) => a + b, 0);
  return minimum.map((w, i) => w + ((total - need) * weights[i]) / sum);
}
export async function renderReportPdf(report: PdfReport): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    info: { Title: pdfText(report.title), Author: pdfText(report.organizationName) },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - MARGIN - FOOTER;
  const ensure = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };
  const text = (value: string, size: number, font = 'Helvetica', color = INK) =>
    doc.font(font).fontSize(size).fillColor(color).text(pdfText(value), MARGIN, doc.y, { width });
  text(report.organizationName.toUpperCase(), 8, 'Helvetica-Bold', MUTED);
  doc.moveDown(0.2);
  text(report.title, 18, 'Helvetica-Bold');
  doc.moveDown(0.4);
  for (const filter of report.filters) text(filter, 9, 'Helvetica', MUTED);
  text(
    `Gerado em ${formatDate(report.generatedAt)} por ${report.generatedBy}`,
    9,
    'Helvetica',
    MUTED,
  );
  doc.moveDown(0.6);
  if (report.notice) {
    const padded = width - 16;
    const height =
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .heightOfString(pdfText(report.notice), { width: padded }) + 12;
    ensure(height);
    const top = doc.y;
    doc.rect(MARGIN, top, width, height).fillAndStroke(SHADE, LINE);
    doc.fillColor(INK).text(pdfText(report.notice), MARGIN + 8, top + 6, { width: padded });
    doc.y = top + height + 8;
  }
  for (const section of report.sections) {
    ensure(60);
    doc.moveDown(0.4);
    text(section.heading, 13, 'Helvetica-Bold');
    doc
      .moveTo(MARGIN, doc.y + 2)
      .lineTo(MARGIN + width, doc.y + 2)
      .strokeColor(LINE)
      .lineWidth(0.6)
      .stroke();
    doc.moveDown(0.5);
    if (section.kpis?.length) {
      const perRow = 3;
      const cell = width / perRow;
      for (let start = 0; start < section.kpis.length; start += perRow) {
        const group = section.kpis.slice(start, start + perRow);
        const heights = group.map(
          ([label, value]) =>
            doc
              .font('Helvetica')
              .fontSize(8)
              .heightOfString(pdfText(label), { width: cell - 10 }) +
            doc
              .font('Helvetica-Bold')
              .fontSize(13)
              .heightOfString(pdfText(value), { width: cell - 10 }) +
            8,
        );
        const height = Math.max(...heights);
        ensure(height);
        const top = doc.y;
        group.forEach(([label, value], i) => {
          const x = MARGIN + i * cell;
          doc.font('Helvetica').fontSize(8).fillColor(MUTED);
          doc.text(pdfText(label), x, top, { width: cell - 10 });
          doc.font('Helvetica-Bold').fontSize(13).fillColor(INK);
          doc.text(pdfText(value), x, doc.y + 1, { width: cell - 10 });
        });
        doc.y = top + height;
      }
      doc.moveDown(0.4);
    }
    if (section.table) {
      const { columns, rows } = section.table;
      const size = columns.length > 7 ? 6.5 : 8;
      const widths = columnWidths(columns, rows, width, size);
      const pad = 3;
      const measure = (cells: string[], font: string) =>
        Math.max(
          ...cells.map((value, i) =>
            doc
              .font(font)
              .fontSize(size)
              .heightOfString(pdfText(value ?? ''), { width: widths[i] - pad * 2 }),
          ),
        ) +
        pad * 2;
      const draw = (cells: string[], font: string, fill?: string) => {
        const height = measure(cells, font);
        const top = doc.y;
        if (fill) doc.rect(MARGIN, top, width, height).fill(fill);
        let x = MARGIN;
        cells.forEach((value, i) => {
          doc.font(font).fontSize(size).fillColor(INK);
          doc.text(pdfText(value ?? ''), x + pad, top + pad, { width: widths[i] - pad * 2 });
          x += widths[i];
        });
        doc
          .moveTo(MARGIN, top + height)
          .lineTo(MARGIN + width, top + height)
          .strokeColor(LINE)
          .lineWidth(0.4)
          .stroke();
        doc.y = top + height;
      };
      ensure(measure(columns, 'Helvetica-Bold') + measure(rows[0] ?? [], 'Helvetica'));
      draw(columns, 'Helvetica-Bold', SHADE);
      for (const row of rows) {
        if (doc.y + measure(row, 'Helvetica') > bottom()) {
          doc.addPage();
          draw(columns, 'Helvetica-Bold', SHADE);
        }
        draw(row, 'Helvetica');
      }
      if (!rows.length) text('Nenhum registro para estes filtros.', 9, 'Helvetica', MUTED);
      doc.moveDown(0.6);
    }
  }
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // The footer sits inside the bottom margin, which would otherwise trigger a new page.
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(`Página ${i + 1} de ${range.count}`, MARGIN, doc.page.height - MARGIN, {
        width,
        align: 'right',
        lineBreak: false,
      });
  }
  doc.end();
  return done;
}
