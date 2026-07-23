// Generic PDF renderer for reports (pdfkit, server-only).
//
// Deliberately knows nothing about any specific section — it draws the shared
// ReportBlock shape. That is what lets a brand new feature appear in reports by
// adding one registry entry: if it returns stats and a table, it renders.

import PDFDocument from 'pdfkit';
import type { ReportBlock } from './registry';

const INK = '#111111';
const MUTED = '#6B7280';
const LINE = '#E5E7EB';
const ACCENT = '#4653CE';

export interface ReportMeta {
  workspaceName: string;
  title: string;
  from: Date;
  to: Date;
  generatedAt?: Date;
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function renderReportPdf(meta: ReportMeta, blocks: ReportBlock[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // ── Header ──────────────────────────────────────────────────────────────
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text(meta.title, left, 48);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
       .text(`${meta.workspaceName}  ·  ${fmtDate(meta.from)} – ${fmtDate(meta.to)}`, { width });
    doc.moveDown(0.4);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor(LINE).lineWidth(1).stroke();
    doc.moveDown(0.8);

    if (!blocks.length) {
      doc.fillColor(MUTED).fontSize(11)
         .text('No data for the selected sections in this period.', { width });
    }

    for (const block of blocks) {
      ensureSpace(doc, 120);

      doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(block.title, left, doc.y, { width });
      doc.moveDown(0.5);

      // Stats: a wrapping row of cards.
      if (block.stats?.length) {
        const perRow = Math.min(block.stats.length, 4);
        const gap = 10;
        const cardW = (width - gap * (perRow - 1)) / perRow;
        let x = left;
        let rowTop = doc.y;
        block.stats.forEach((s, i) => {
          if (i > 0 && i % perRow === 0) { rowTop += 56; x = left; ensureSpace(doc, 60, rowTop); }
          doc.roundedRect(x, rowTop, cardW, 48, 6).fillColor('#F9FAFB').fill();
          doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
             .text(s.label.toUpperCase(), x + 10, rowTop + 9, { width: cardW - 20, characterSpacing: 0.4 });
          doc.fillColor(INK).font('Helvetica-Bold').fontSize(14)
             .text(s.value, x + 10, rowTop + 22, { width: cardW - 20, lineBreak: false });
          if (s.hint) {
            doc.fillColor(MUTED).font('Helvetica').fontSize(7)
               .text(s.hint, x + 10, rowTop + 39, { width: cardW - 20, lineBreak: false });
          }
          x += cardW + gap;
        });
        doc.y = rowTop + 48 + 14;
      }

      // Table.
      if (block.table?.rows?.length) {
        const cols = block.table.columns;
        const colW = width / cols.length;
        ensureSpace(doc, 40);

        let y = doc.y;
        doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
        cols.forEach((c, i) => {
          doc.text(String(c).toUpperCase(), left + i * colW, y, {
            width: colW - 6, align: i === 0 ? 'left' : 'right', lineBreak: false,
          });
        });
        y += 14;
        doc.moveTo(left, y - 4).lineTo(right, y - 4).strokeColor(LINE).lineWidth(0.5).stroke();

        doc.font('Helvetica').fontSize(9).fillColor(INK);
        for (const row of block.table.rows.slice(0, 25)) {
          if (y > doc.page.height - doc.page.margins.bottom - 30) {
            doc.addPage(); y = doc.page.margins.top;
          }
          row.forEach((cell, i) => {
            doc.fillColor(i === 0 ? INK : MUTED).text(String(cell ?? ''), left + i * colW, y, {
              width: colW - 6, align: i === 0 ? 'left' : 'right', lineBreak: false, ellipsis: true,
            });
          });
          y += 15;
        }
        doc.y = y + 6;
      }

      if (block.note) {
        ensureSpace(doc, 30);
        doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(8)
           .text(block.note, left, doc.y, { width });
        doc.moveDown(0.4);
      }

      doc.moveDown(0.8);
    }

    // ── Footer on every page ────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // The footer sits BELOW the bottom margin, and pdfkit starts a fresh page
      // whenever content crosses that line — so drawing it naively appends a
      // blank page per footer (a one-block report came out three pages long).
      // Drop the margin for the duration of the write, then put it back.
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;

      const y = doc.page.height - 34;
      doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
         .text(
           `Generated by RunButter · ${fmtDate(meta.generatedAt ?? new Date())}`,
           left, y, { width: width / 2, lineBreak: false },
         );
      doc.fillColor(MUTED)
         .text(`${i + 1} / ${range.count}`, left + width / 2, y, { width: width / 2, align: 'right', lineBreak: false });

      doc.page.margins.bottom = bottom;
    }

    doc.end();
  });
}

// pdfkit has no "will this fit" helper; page-break before we start something tall.
function ensureSpace(doc: PDFKit.PDFDocument, needed: number, atY?: number) {
  const y = atY ?? doc.y;
  if (y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
    doc.y = doc.page.margins.top;
  }
}
