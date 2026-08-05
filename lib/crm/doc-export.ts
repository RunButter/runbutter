'use client';

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { downloadBytes } from '@/lib/pdf/toolkit';
import { parseSheet, sheetToCsv } from '@/lib/crm/doc-formats';

/**
 * Exporting a document — PDF, Word and Markdown, all in the browser.
 *
 * SAME RULE AS /pdf: the file never leaves the machine. A document here is a
 * contract, a payroll note, an offer; shipping it to a conversion service to
 * get a PDF back would be the single most surprising thing this product could
 * do with it. pdf-lib is already a dependency and already draws text, so the
 * only work is a small markdown renderer.
 *
 * WHAT THIS IS NOT: a typesetting engine. Headings, paragraphs, bullets,
 * checkboxes, tables, rules and code — the things the editors can actually
 * produce. Anything fancier belongs in a real document tool, and pretending
 * otherwise produces PDFs that look broken rather than plain.
 *
 * WHY .doc AND NOT .docx. A real .docx is a zip of XML parts and needs a
 * library; an HTML file served as `application/msword` opens in Word, Pages and
 * Google Docs, keeps headings and bold, and costs nothing. It is honest about
 * what it is — the alternative was no Word export at all.
 */

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 56;
const BODY = 11;
const LEADING = 1.45;

interface Ctx { pdf: PDFDocument; page: any; y: number; regular: any; bold: any; mono: any }

function newPage(c: Ctx) {
  c.page = c.pdf.addPage([A4.w, A4.h]);
  c.y = A4.h - MARGIN;
}

/** Reserve vertical space, starting a page when the block would not fit. */
function space(c: Ctx, needed: number) {
  if (c.y - needed < MARGIN) newPage(c);
}

/**
 * WinAnsi is all the standard fonts can encode, and pdf-lib THROWS on anything
 * outside it — so a single em-dash or curly quote from the editor would fail
 * the whole export. Mapped rather than stripped: losing "—" is fine, losing the
 * document is not.
 */
function winAnsi(s: string): string {
  return s
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[•●]/g, '-')
    .replace(/[^\x20-\xFF\n]/g, '');
}

function wrap(text: string, font: any, size: number, maxWidth: number): string[] {
  const words = winAnsi(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) { line = next; continue; }
    if (line) lines.push(line);
    // A single word longer than the column (a URL) is hard-broken rather than
    // allowed to run off the page.
    if (font.widthOfTextAtSize(w, size) > maxWidth) {
      let chunk = '';
      for (const ch of w) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) { lines.push(chunk); chunk = ch; }
        else chunk += ch;
      }
      line = chunk;
    } else line = w;
  }
  if (line) lines.push(line);
  return lines;
}

function drawWrapped(c: Ctx, text: string, opts: {
  size?: number; font?: any; indent?: number; color?: any; gapAfter?: number;
} = {}) {
  const size = opts.size ?? BODY;
  const font = opts.font ?? c.regular;
  const indent = opts.indent ?? 0;
  for (const line of wrap(text, font, size, A4.w - MARGIN * 2 - indent)) {
    space(c, size * LEADING);
    c.y -= size * LEADING;
    c.page.drawText(line, {
      x: MARGIN + indent, y: c.y, size, font,
      color: opts.color ?? rgb(0.13, 0.13, 0.13),
    });
  }
  c.y -= opts.gapAfter ?? 4;
}

function drawTable(c: Ctx, rows: string[][], headers: string[]) {
  const cols = headers.length || 1;
  const width = A4.w - MARGIN * 2;
  const colW = width / cols;
  const pad = 5;
  const size = 9.5;

  const line = (cells: string[], font: any, shade?: boolean) => {
    // Height is set by the tallest cell, so a long value wraps instead of
    // overwriting its neighbour.
    const wrapped = cells.map((v) => wrap(v, font, size, colW - pad * 2));
    const h = Math.max(...wrapped.map((w) => w.length)) * size * 1.3 + pad * 2;
    space(c, h);
    if (shade) c.page.drawRectangle({ x: MARGIN, y: c.y - h, width, height: h, color: rgb(0.95, 0.95, 0.94) });
    wrapped.forEach((lines, i) => lines.forEach((l, j) => {
      c.page.drawText(l, {
        x: MARGIN + i * colW + pad,
        y: c.y - pad - size - j * size * 1.3,
        size, font, color: rgb(0.13, 0.13, 0.13),
      });
    }));
    c.y -= h;
    c.page.drawLine({
      start: { x: MARGIN, y: c.y }, end: { x: MARGIN + width, y: c.y },
      thickness: 0.5, color: rgb(0.85, 0.85, 0.84),
    });
  };

  line(headers, c.bold, true);
  for (const r of rows) line(r, c.regular);
  c.y -= 8;
}

/** Markdown → PDF bytes. Deliberately narrow — see the header. */
export async function markdownToPdf(title: string, body: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const c: Ctx = {
    pdf, page: null, y: 0,
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier),
  };
  newPage(c);

  if (title.trim()) drawWrapped(c, title, { size: 20, font: c.bold, gapAfter: 14 });

  let inCode = false;
  let tableBuf: string[] = [];
  const flushTable = () => {
    if (!tableBuf.length) return;
    const { headers, rows } = parseSheet(tableBuf.join('\n'));
    drawTable(c, rows, headers);
    tableBuf = [];
  };

  for (const raw of body.split('\n')) {
    const line = raw.replace(/\t/g, '  ');

    if (/^\s*```/.test(line)) { flushTable(); inCode = !inCode; c.y -= 4; continue; }
    if (inCode) { drawWrapped(c, line || ' ', { size: 9, font: c.mono, indent: 10, gapAfter: 0 }); continue; }

    // A table is buffered until it ends, because column widths depend on the
    // whole block — drawing row by row would give every row its own layout.
    if (line.includes('|') && line.trim().startsWith('|')) { tableBuf.push(line); continue; }
    flushTable();

    if (!line.trim()) { c.y -= 6; continue; }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      c.y -= 6;
      drawWrapped(c, h[2], { size: [17, 14, 12][h[1].length - 1], font: c.bold, gapAfter: 6 });
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      space(c, 12); c.y -= 8;
      c.page.drawLine({
        start: { x: MARGIN, y: c.y }, end: { x: A4.w - MARGIN, y: c.y },
        thickness: 0.5, color: rgb(0.85, 0.85, 0.84),
      });
      c.y -= 8; continue;
    }

    const task = /^(\s*)[-*]\s+\[([ xX])\]\s?(.*)$/.exec(line);
    if (task) {
      const indent = Math.floor(task[1].length / 2) * 14;
      const done = task[2].toLowerCase() === 'x';
      // A real box, not "[x]" as text: a printed checklist has to be tickable
      // by hand, which is most of the point of printing one.
      space(c, BODY * LEADING);
      const boxY = c.y - BODY * LEADING + 2;
      c.page.drawRectangle({
        x: MARGIN + indent, y: boxY, width: 8, height: 8,
        borderWidth: 0.8, borderColor: rgb(0.45, 0.45, 0.45),
        color: done ? rgb(0.2, 0.2, 0.2) : undefined,
      });
      drawWrapped(c, stripInline(task[3]), {
        indent: indent + 14, gapAfter: 1,
        color: done ? rgb(0.5, 0.5, 0.5) : undefined,
      });
      continue;
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      drawWrapped(c, `• ${stripInline(bullet[2])}`, { indent: Math.floor(bullet[1].length / 2) * 14, gapAfter: 1 });
      continue;
    }

    const ordered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      drawWrapped(c, `${ordered[2]}. ${stripInline(ordered[3])}`, { indent: Math.floor(ordered[1].length / 2) * 14, gapAfter: 1 });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      drawWrapped(c, stripInline(line.replace(/^\s*>\s?/, '')), { indent: 14, color: rgb(0.4, 0.4, 0.4) });
      continue;
    }

    drawWrapped(c, stripInline(line));
  }
  flushTable();

  return pdf.save();
}

/**
 * Drop the inline syntax the renderer cannot express.
 *
 * Standard fonts cannot switch weight mid-line without splitting the run, which
 * is a lot of machinery to make one word bold — and removing the markers reads
 * far better than leaving `**like this**` in a printed document. Image
 * references are dropped rather than fetched: they are `rb-file:` ids pointing
 * at a private bucket, and an export that silently downloaded them would put
 * the whole point of that bucket at risk.
 */
function stripInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

// ── Word ────────────────────────────────────────────────────────────────────

const htmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Minimal markdown → HTML, enough for Word to keep the structure. */
function markdownToHtml(body: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const inline = (s: string) => htmlEscape(s)
    .replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>')
    .replace(/(\*|_)(.*?)\1/g, '<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  for (const raw of body.split('\n')) {
    const line = raw.replace(/\t/g, '  ');
    if (!line.trim()) { closeList(); continue; }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    const task = /^\s*[-*]\s+\[([ xX])\]\s?(.*)$/.exec(line);
    if (task) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      const done = task[1].toLowerCase() === 'x';
      // A character, not a checkbox input: Word does not render form controls
      // from pasted HTML, and an empty square is what a printed list needs.
      out.push(`<li>${done ? '&#9745;' : '&#9744;'} ${done ? `<s>${inline(task[2])}</s>` : inline(task[2])}</li>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(bullet[1])}</li>`); continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(ordered[1])}</li>`); continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

export function downloadWord(title: string, body: string) {
  const html = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
<title>${htmlEscape(title)}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45}
h1{font-size:20pt}h2{font-size:15pt}h3{font-size:13pt}
table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px}</style>
</head><body><h1>${htmlEscape(title)}</h1>${markdownToHtml(body)}</body></html>`;

  // application/msword on a .doc extension: Word, Pages and Google Docs all
  // open this and keep the structure. See the header for why not real .docx.
  download(new Blob([html], { type: 'application/msword' }), `${safeName(title)}.doc`);
}

// ── Plumbing ────────────────────────────────────────────────────────────────

export const safeName = (s: string) =>
  (s.trim() || 'document').replace(/[^\w\s.-]+/g, '').replace(/\s+/g, '-').slice(0, 60) || 'document';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  // Revoked on a delay, not immediately: Safari cancels an in-flight download
  // when the object URL disappears under it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadPdf(title: string, body: string) {
  downloadBytes(await markdownToPdf(title, body), `${safeName(title)}.pdf`);
}

export function downloadMarkdown(title: string, body: string) {
  download(new Blob([`# ${title}\n\n${body}`], { type: 'text/markdown;charset=utf-8' }), `${safeName(title)}.md`);
}

export function downloadCsv(title: string, body: string) {
  download(new Blob([sheetToCsv(parseSheet(body))], { type: 'text/csv;charset=utf-8' }), `${safeName(title)}.csv`);
}
