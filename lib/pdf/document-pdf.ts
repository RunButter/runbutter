import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import type { InvoiceDocument } from '@/lib/crm/data';
import { documentMath, sellerIdLines, taxLabel, docNum, docQty, docMoney, docDate } from '@/lib/crm/document-math';
import { isSafeOutboundUrl } from '@/lib/security/http';

// Server-side A4 PDF for invoices and offers (pdfkit — no browser needed). It is
// what Send attaches and what the PDF button downloads, so it is the copy a
// customer actually keeps: it is laid out exactly like the A4 sheet on screen
// (components/crm/InvoiceSheet.tsx) and takes every number from the same
// lib/crm/document-math.ts. Roboto is bundled for full Latin-Extended text.
//
// Long documents: the items table repeats its header on each new page and never
// splits a row; the totals, payment and acceptance blocks move to the next page
// whole rather than breaking; every page gets the footer and "Page n of N".

const A4 = { w: 595.28, h: 841.89 };
const ML = 42.5, MR = 42.5, MT = 40;          // 15 mm sides, 14 mm top
const RIGHT = A4.w - MR, W = RIGHT - ML;
const LIMIT = A4.h - 62;                        // content stops here; the footer lives below
const INK = '#111827', MUTED = '#6b7280', LIGHT = '#9ca3af', LINE = '#e5e7eb', SOFT = '#f6f7f9';

function registerFonts(doc: PDFKit.PDFDocument) {
  const dir = path.join(process.cwd(), 'public', 'fonts');
  const reg = path.join(dir, 'Roboto-Regular.ttf');
  const bold = path.join(dir, 'Roboto-Bold.ttf');
  if (fs.existsSync(reg) && fs.existsSync(bold)) {
    doc.registerFont('Body', reg);
    doc.registerFont('Bold', bold);
    return { body: 'Body', bold: 'Bold' };
  }
  return { body: 'Helvetica', bold: 'Helvetica-Bold' }; // fallback (no PL diacritics)
}

// Fetch an image into a Buffer pdfkit can embed (JPEG/PNG only). A URL is the
// workspace's own setting, but it is still fetched by OUR server, so it goes
// through the same outbound check as every other server-side fetch.
async function fetchImage(src?: string | null): Promise<Buffer | null> {
  if (!src) return null;
  try {
    let buf: Buffer | null = null;
    if (/^data:image\/(png|jpe?g);base64,/i.test(src)) {
      buf = Buffer.from(src.split(',')[1], 'base64');
    } else if (/^https?:\/\//i.test(src) && isSafeOutboundUrl(src)) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(src, { signal: ctrl.signal, redirect: 'error' });
      clearTimeout(t);
      if (!res.ok) return null;
      buf = Buffer.from(await res.arrayBuffer());
    }
    if (!buf || buf.length < 8 || buf.length > 5_000_000) return null;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
    return isPng || isJpg ? buf : null; // pdfkit can't embed SVG/WebP
  } catch {
    return null;
  }
}

export async function buildDocumentPdf(d: InvoiceDocument): Promise<Buffer> {
  const isOffer = d.kind === 'offer';
  const title = isOffer ? 'Offer' : 'Invoice';
  const accent = /^#[0-9a-f]{6}$/i.test(d.seller?.accent_color || '') ? d.seller.accent_color! : INK;
  const cur = d.currency || 'USD';
  const seller = d.seller || { name: 'Your company' };
  const m = documentMath(d);

  const logo = await fetchImage(seller.logo_url);
  const images: (Buffer | null)[] = await Promise.all(m.lines.map((l) => fetchImage(l.image)));

  // Pass our TTF at construction so pdfkit never loads its default Helvetica
  // (whose .afm metrics don't survive bundling).
  const regularPath = path.join(process.cwd(), 'public', 'fonts', 'Roboto-Regular.ttf');
  const doc = new PDFDocument({
    size: 'A4', margin: 0, bufferPages: true,
    ...(fs.existsSync(regularPath) ? { font: regularPath } : {}),
    info: { Title: `${title} ${d.number || ''}`.trim(), Author: seller.name || undefined },
  });
  const F = registerFonts(doc);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const label = (text: string, x: number, y: number, width?: number, align: 'left' | 'right' = 'left') =>
    doc.font(F.bold).fontSize(6.5).fillColor(MUTED).text(text.toUpperCase(), x, y, { width, align, characterSpacing: 0.6, lineBreak: false });
  const hline = (y: number, x1 = ML, x2 = RIGHT, color = LINE, w = 0.6) =>
    doc.moveTo(x1, y).lineTo(x2, y).lineWidth(w).strokeColor(color).stroke();

  let y = MT;
  let inTable = false;
  const ensure = (h: number) => {
    if (y + h <= LIMIT) return;
    doc.addPage({ size: 'A4', margin: 0 });
    y = MT;
    if (inTable) tableHead();
  };

  // ── Header ────────────────────────────────────────────────────────────────
  if (logo) {
    doc.image(logo, ML, y, { fit: [120, 40], valign: 'center' });
  } else {
    doc.roundedRect(ML, y + 2, 34, 34, 8).fill(accent);
    doc.font(F.bold).fontSize(17).fillColor('#ffffff')
      .text((seller.name || '?').trim().charAt(0).toUpperCase(), ML, y + 10, { width: 34, align: 'center', lineBreak: false });
  }
  if (!logo) doc.font(F.bold).fontSize(12).fillColor(INK).text(seller.name || '', ML + 46, y + 12, { width: 260, lineBreak: false, ellipsis: true });
  doc.font(F.bold).fontSize(22).fillColor(INK).text(title, RIGHT - 220, y, { width: 220, align: 'right', lineBreak: false });
  doc.font(F.body).fontSize(10).fillColor(MUTED).text(`No. ${d.number || '—'}`, RIGHT - 220, y + 27, { width: 220, align: 'right', lineBreak: false });
  const flag = d.status === 'draft' ? 'DRAFT' : d.status === 'paid' && !isOffer ? 'PAID' : '';
  if (flag) {
    doc.font(F.bold).fontSize(7).fillColor(flag === 'PAID' ? '#15803d' : MUTED)
      .text(flag, RIGHT - 220, y + 42, { width: 220, align: 'right', characterSpacing: 1, lineBreak: false });
  }
  y += 56;
  hline(y, ML, RIGHT, accent, 1.5);
  y += 14;

  // ── Dates and money, one strip ────────────────────────────────────────────
  const cells: { k: string; v: string; acc?: boolean }[] = [
    { k: 'Issue date', v: docDate(d.issued_at) },
    { k: isOffer ? 'Valid until' : 'Due date', v: docDate(d.due_at) },
    ...(!isOffer && seller.iban ? [{ k: 'Payment', v: 'Bank transfer' }] : []),
    { k: 'Currency', v: cur },
    { k: isOffer ? 'Total' : 'Amount due', v: docMoney(m.total, cur), acc: true },
  ];
  const cw = W / cells.length;
  doc.roundedRect(ML, y, W, 36, 4).lineWidth(0.6).strokeColor(LINE).stroke();
  cells.forEach((c, i) => {
    const x = ML + i * cw;
    if (i) doc.moveTo(x, y).lineTo(x, y + 36).lineWidth(0.6).strokeColor(LINE).stroke();
    label(c.k, x + 9, y + 8, cw - 14);
    doc.font(F.bold).fontSize(9.5).fillColor(c.acc ? accent : INK).text(c.v, x + 9, y + 19, { width: cw - 14, lineBreak: false, ellipsis: true });
  });
  y += 36 + 18;

  // ── Seller and buyer ──────────────────────────────────────────────────────
  const colW = (W - 28) / 2;
  const party = (x: number, head: string, name: string, address: string | null | undefined, ids: string[]) => {
    let py = y;
    label(head, x, py); py += 11;
    doc.font(F.bold).fontSize(10.5).fillColor(INK).text(name || '—', x, py, { width: colW }); py = doc.y + 1;
    if (address) { doc.font(F.body).fontSize(8.5).fillColor(INK).text(address, x, py, { width: colW, lineGap: 1 }); py = doc.y; }
    for (const s of ids) { doc.font(F.body).fontSize(8.5).fillColor(MUTED).text(s, x, py, { width: colW }); py = doc.y; }
    return py;
  };
  const buyer = d.buyer;
  const left = party(ML, isOffer ? 'From' : 'Seller', seller.name, seller.address, sellerIdLines(seller));
  const right = party(ML + colW + 28, isOffer ? 'Prepared for' : 'Buyer', buyer?.name || '—',
    buyer?.address || (buyer?.domain ?? null),
    buyer?.tax_id ? [`${taxLabel(buyer.tax_id, buyer.country)}: ${buyer.tax_id}`] : []);
  y = Math.max(left, right) + 18;

  // ── Items ─────────────────────────────────────────────────────────────────
  const fixed = m.showVat
    ? [{ k: 'qty', w: 30, t: 'Qty' }, { k: 'unit', w: 56, t: 'Unit price' }, { k: 'net', w: 58, t: 'Net' }, { k: 'rate', w: 28, t: 'VAT' }, { k: 'vat', w: 50, t: 'VAT amt' }, { k: 'gross', w: 62, t: `Gross ${cur}` }]
    : [{ k: 'qty', w: 40, t: 'Qty' }, { k: 'unit', w: 80, t: 'Unit price' }, { k: 'gross', w: 90, t: `Amount ${cur}` }];
  const noW = 16;
  const descW = W - noW - fixed.reduce((s, c) => s + c.w, 0) - 6;
  const tableHead = () => {
    doc.rect(ML, y, W, 17).fill(SOFT);
    label('#', ML + 3, y + 6);
    label('Description', ML + noW + 3, y + 6, descW);
    let x = ML + noW + 6 + descW;
    for (const c of fixed) { label(c.t, x, y + 6, c.w - 4, 'right'); x += c.w; }
    hline(y + 17);
    y += 17;
  };
  tableHead();
  inTable = true;
  m.lines.forEach((l, i) => {
    const img = images[i];
    const tx = ML + noW + 3 + (img ? 40 : 0);
    const tw = descW - (img ? 40 : 0);
    doc.font(F.body).fontSize(8.5);
    const th = doc.heightOfString(l.description, { width: tw }) + (l.note ? 11 : 0);
    const rowH = Math.max(img ? 36 : 0, th) + 12;
    ensure(rowH);
    const ty = y + 6;
    doc.font(F.body).fontSize(8.5).fillColor(MUTED).text(String(i + 1), ML + 3, ty, { width: noW, lineBreak: false });
    if (img) doc.image(img, ML + noW + 3, ty, { fit: [32, 32] });
    doc.font(F.body).fontSize(8.5).fillColor(INK).text(l.description, tx, ty, { width: tw });
    if (l.note) doc.font(F.body).fontSize(7.5).fillColor(MUTED).text(l.note, tx, doc.y + 1, { width: tw });
    let x = ML + noW + 6 + descW;
    const val: Record<string, string> = {
      qty: docQty(l.quantity), unit: docNum(l.unit), net: docNum(l.net), rate: `${l.rate}%`, vat: docNum(l.vat),
      gross: docNum(m.showVat ? l.gross : l.net),
    };
    for (const c of fixed) {
      doc.font(c.k === 'gross' ? F.bold : F.body).fontSize(8.5).fillColor(INK)
        .text(val[c.k], x, ty, { width: c.w - 4, align: 'right', lineBreak: false });
      x += c.w;
    }
    y += rowH;
    hline(y);
  });
  inTable = false;
  y += 14;

  // ── VAT summary + totals, never split ─────────────────────────────────────
  const totals: [string, string][] = [
    ...(m.discount > 0 ? [['Subtotal', docMoney(m.subtotal, cur)], ['Discount', `−${docMoney(m.discount, cur)}`]] as [string, string][] : []),
    [m.showVat ? 'Total net' : 'Subtotal', docMoney(m.net, cur)],
    ...(m.showVat ? [['VAT', docMoney(m.vat, cur)]] as [string, string][] : []),
  ];
  const sumH = Math.max(m.showVat ? 16 + m.rates.length * 15 : 0, totals.length * 14 + 34);
  ensure(sumH);
  if (m.showVat) {
    const cols = [{ t: 'VAT rate', w: 44 }, { t: 'Net', w: 64 }, { t: 'VAT', w: 56 }, { t: `Gross ${cur}`, w: 70 }];
    let sx = ML;
    cols.forEach((c, i) => { label(c.t, sx, y, c.w - 4, i ? 'right' : 'left'); sx += c.w; });
    hline(y + 11, ML, ML + 234);
    let ry = y + 15;
    for (const r of m.rates) {
      const vals = [`${r.rate}%`, docNum(r.net), docNum(r.vat), docNum(r.net + r.vat)];
      sx = ML;
      cols.forEach((c, i) => {
        doc.font(F.body).fontSize(8).fillColor(INK).text(vals[i], sx, ry, { width: c.w - 4, align: i ? 'right' : 'left', lineBreak: false });
        sx += c.w;
      });
      ry += 15; hline(ry - 4, ML, ML + 234);
    }
  }
  const tx = RIGHT - 205;
  let ty = y;
  for (const [k, v] of totals) {
    doc.font(F.body).fontSize(9).fillColor(INK).text(k, tx, ty, { width: 110, lineBreak: false });
    doc.text(v, RIGHT - 100, ty, { width: 100, align: 'right', lineBreak: false });
    ty += 14;
  }
  ty += 4;
  doc.rect(tx, ty, 205, 28).fill(SOFT);
  doc.rect(tx, ty, 2.5, 28).fill(accent);
  doc.font(F.bold).fontSize(11).fillColor(INK).text(isOffer ? 'Total' : 'Total due', tx + 12, ty + 9, { width: 90, lineBreak: false });
  doc.font(F.bold).fontSize(11).fillColor(accent).text(docMoney(m.total, cur), RIGHT - 110, ty + 9, { width: 100, align: 'right', lineBreak: false });
  y += sumH + 16;

  // ── Payment ───────────────────────────────────────────────────────────────
  if (!isOffer && seller.iban) {
    ensure(50);
    doc.roundedRect(ML, y, W, 44, 4).lineWidth(0.6).strokeColor(LINE).stroke();
    label('Payment details', ML + 10, y + 8);
    const items: [string, string][] = [
      ...(seller.bank_name ? [['Bank', seller.bank_name]] as [string, string][] : []),
      ['Account (IBAN)', seller.iban], ['Reference', d.number || '—'], ['Pay by', docDate(d.due_at)],
    ];
    const widths = items.map(([, v]) => Math.max(70, doc.font(F.bold).fontSize(8.5).widthOfString(v) + 22));
    let px = ML + 10;
    items.forEach(([k, v], i) => {
      label(k, px, y + 19);
      doc.font(F.bold).fontSize(8.5).fillColor(INK).text(v, px, y + 28, { width: widths[i], lineBreak: false });
      px += widths[i];
    });
    y += 44 + 16;
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  if (d.notes) {
    doc.font(F.body).fontSize(8.5);
    const h = doc.heightOfString(d.notes, { width: W });
    ensure(h + 14);
    label('Notes', ML, y);
    doc.font(F.body).fontSize(8.5).fillColor(INK).text(d.notes, ML, y + 11, { width: W, lineGap: 1 });
    y = doc.y + 16;
  }

  // ── Acceptance (offers) ───────────────────────────────────────────────────
  if (isOffer) {
    ensure(70);
    label('Acceptance', ML, y);
    doc.font(F.body).fontSize(8.5).fillColor(MUTED).text('To accept this offer, sign below or reply to the email it came with.', ML, y + 11, { width: W });
    const sy = y + 50;
    const sw = [(W - 40) * 0.28, (W - 40) * 0.28, (W - 40) * 0.44];
    let sx = ML;
    ['Name', 'Date', 'Signature'].forEach((t, i) => {
      hline(sy, sx, sx + sw[i], INK, 0.6);
      doc.font(F.body).fontSize(7.5).fillColor(MUTED).text(t, sx, sy + 4, { width: sw[i], lineBreak: false });
      sx += sw[i] + 20;
    });
    y = sy + 20;
  }

  // ── Footer and page numbers, on every page ────────────────────────────────
  const footer = seller.footer || [seller.name, seller.address?.split('\n')[0]].filter(Boolean).join(' · ');
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = A4.h - 46;
    hline(fy);
    doc.font(F.body).fontSize(7).fillColor(LIGHT).text(footer, ML, fy + 7, { width: W - 70, lineBreak: false, ellipsis: true });
    doc.font(F.body).fontSize(7).fillColor(LIGHT).text(`Page ${i - range.start + 1} of ${range.count}`, RIGHT - 70, fy + 7, { width: 70, align: 'right', lineBreak: false });
  }

  doc.end();
  return done;
}
