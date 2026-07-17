import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import type { InvoiceDocument } from '@/lib/crm/data';

// Server-side A4 PDF for invoices/offers (pdfkit — no browser needed).
// Mirrors the web document: accent bar, logo, seller identity, bill-to, line
// items (big product images on OFFERS only; invoices stay formal), totals,
// payment and footer. Roboto is bundled for full Latin-Extended (Polish) text.

const A4 = { w: 595.28, h: 841.89 };
const M = 48; // page margin
const GRAY = '#64748b', DARK = '#0f172a', LIGHT = '#94a3b8', LINE = '#e2e8f0';

const fmtMoney = (n: number, cur = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

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

// Fetch an image into a Buffer pdfkit can embed (JPEG/PNG only).
async function fetchImage(src?: string | null): Promise<Buffer | null> {
  if (!src) return null;
  try {
    let buf: Buffer | null = null;
    if (/^data:image\/(png|jpe?g);base64,/i.test(src)) {
      buf = Buffer.from(src.split(',')[1], 'base64');
    } else if (/^https?:\/\//i.test(src)) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(src, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return null;
      buf = Buffer.from(await res.arrayBuffer());
    }
    if (!buf || buf.length < 8) return null;
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
  const accent = d.seller?.accent_color || '#6366F1';
  const cur = d.currency || 'USD';

  // Pre-fetch images (logo + product images for offers).
  const logo = await fetchImage(d.seller?.logo_url);
  const itemImages: (Buffer | null)[] = isOffer
    ? await Promise.all(d.items.map((it) => fetchImage(it.image)))
    : d.items.map(() => null);

  // Pass our TTF at construction so pdfkit never loads its default Helvetica
  // (whose .afm metrics don't survive bundling).
  const regularPath = path.join(process.cwd(), 'public', 'fonts', 'Roboto-Regular.ttf');
  const doc = new PDFDocument({
    size: 'A4', margin: 0,
    ...(fs.existsSync(regularPath) ? { font: regularPath } : {}),
    info: { Title: `${title} ${d.number || ''}`.trim() },
  });
  const F = registerFonts(doc);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const right = A4.w - M;
  let y = 0;

  // Accent bar
  doc.rect(0, 0, A4.w, 8).fill(accent);
  y = M;

  // Header: logo + seller (left) · title + number + status (right)
  if (logo) {
    doc.image(logo, M, y, { fit: [40, 40] });
  } else {
    doc.roundedRect(M, y, 40, 40, 6).fill(accent);
  }
  const sx = M + 52;
  doc.font(F.bold).fontSize(14).fillColor(DARK).text(d.seller?.name || 'Your company', sx, y, { width: 280 });
  let sy = y + 18;
  if (d.seller?.address) { doc.font(F.body).fontSize(8.5).fillColor(GRAY).text(d.seller.address, sx, sy, { width: 280 }); sy = doc.y + 2; }
  const ids = [
    d.seller?.tax_id && `NIP: ${d.seller.tax_id}`,
    d.seller?.vat_id && `VAT: ${d.seller.vat_id}`,
    d.seller?.reg_no && `Reg: ${d.seller.reg_no}`,
    d.seller?.bdo && `BDO: ${d.seller.bdo}`,
  ].filter(Boolean).join('  ·  ');
  if (ids) { doc.font(F.body).fontSize(8).fillColor(LIGHT).text(ids, sx, sy, { width: 280 }); sy = doc.y; }

  doc.font(F.bold).fontSize(22).fillColor(DARK).text(title, right - 200, y - 2, { width: 200, align: 'right' });
  doc.font(F.body).fontSize(10).fillColor(GRAY).text(d.number || '—', right - 200, y + 24, { width: 200, align: 'right' });
  if (d.status) {
    doc.font(F.bold).fontSize(8).fillColor(accent).text(d.status.toUpperCase(), right - 200, y + 40, { width: 200, align: 'right', characterSpacing: 1 });
  }
  y = Math.max(sy, y + 56) + 18;

  doc.moveTo(M, y).lineTo(right, y).lineWidth(0.75).strokeColor(LINE).stroke();
  y += 18;

  // Parties + dates
  const col2 = M + 240, col3 = M + 360;
  doc.font(F.bold).fontSize(7.5).fillColor(LIGHT).text((isOffer ? 'PREPARED FOR' : 'BILL TO'), M, y, { characterSpacing: 0.8 });
  doc.font(F.bold).fontSize(11).fillColor(DARK).text(d.buyer?.name || '—', M, y + 12, { width: 220 });
  let by = doc.y + 1;
  if (d.buyer?.address) { doc.font(F.body).fontSize(8.5).fillColor(GRAY).text(d.buyer.address, M, by, { width: 220 }); by = doc.y + 1; }
  if (d.buyer?.tax_id) { doc.font(F.body).fontSize(8.5).fillColor(LIGHT).text(`${String(d.buyer.tax_id).replace(/[^0-9]/g, '').length === 10 && (d.buyer.country || 'PL') === 'PL' ? 'NIP' : 'VAT'}: ${d.buyer.tax_id}`, M, by, { width: 220 }); by = doc.y; }

  doc.font(F.bold).fontSize(7.5).fillColor(LIGHT).text(isOffer ? 'ISSUED' : 'INVOICE DATE', col2, y, { characterSpacing: 0.8 });
  doc.font(F.body).fontSize(10).fillColor(DARK).text(fmtDate(d.issued_at), col2, y + 12);
  doc.font(F.bold).fontSize(7.5).fillColor(LIGHT).text(isOffer ? 'VALID UNTIL' : 'DUE DATE', col3, y, { characterSpacing: 0.8 });
  doc.font(F.body).fontSize(10).fillColor(DARK).text(fmtDate(d.due_at), col3, y + 12);
  y = Math.max(by, y + 30) + 20;

  // Items table
  const cols = { qtyR: M + 320, unitR: M + 392, vatR: M + 428, amtR: right };
  doc.font(F.bold).fontSize(7.5).fillColor(LIGHT);
  doc.text('DESCRIPTION', M, y, { characterSpacing: 0.8 });
  doc.text('QTY', cols.qtyR - 40, y, { width: 40, align: 'right', characterSpacing: 0.8 });
  doc.text('UNIT PRICE', cols.unitR - 66, y, { width: 66, align: 'right', characterSpacing: 0.8 });
  doc.text('VAT', cols.vatR - 32, y, { width: 32, align: 'right', characterSpacing: 0.8 });
  doc.text('AMOUNT', cols.amtR - 70, y, { width: 70, align: 'right', characterSpacing: 0.8 });
  y += 12;
  doc.moveTo(M, y).lineTo(right, y).lineWidth(0.75).strokeColor(LINE).stroke();
  y += 8;

  d.items.forEach((it, i) => {
    const img = itemImages[i];
    const rowH = img ? 46 : 20;
    if (y + rowH > A4.h - 160) { doc.addPage({ size: 'A4', margin: 0 }); y = M; } // simple page-break guard

    let dx = M;
    if (img) { doc.image(img, M, y, { fit: [38, 38] }); dx = M + 46; }
    const label = `${it.description || it.product || 'Item'}${it.discount_pct ? `  (−${it.discount_pct}%)` : ''}`;
    const ty = img ? y + 13 : y;
    doc.font(F.body).fontSize(9.5).fillColor(DARK).text(label, dx, ty, { width: cols.qtyR - 46 - dx, ellipsis: true, height: 12 });
    doc.font(F.body).fontSize(9.5).fillColor(GRAY);
    doc.text(String(it.quantity), cols.qtyR - 40, ty, { width: 40, align: 'right' });
    doc.text(fmtMoney(it.unit_price, cur), cols.unitR - 66, ty, { width: 66, align: 'right' });
    doc.text(it.tax_rate ? `${it.tax_rate}%` : '—', cols.vatR - 32, ty, { width: 32, align: 'right' });
    doc.font(F.bold).fontSize(9.5).fillColor(DARK).text(fmtMoney(it.line_total, cur), cols.amtR - 70, ty, { width: 70, align: 'right' });
    y += rowH;
    doc.moveTo(M, y - 4).lineTo(right, y - 4).lineWidth(0.5).strokeColor('#f1f5f9').stroke();
  });

  // Totals
  y += 8;
  const t = d.totals || { subtotal: d.items.reduce((s, it) => s + (it.line_total || 0), 0) || d.amount, discount: 0, net: 0, tax: 0, total: d.amount };
  const totalRow = (label: string, val: string, opts: { bold?: boolean; color?: string } = {}) => {
    doc.font(opts.bold ? F.bold : F.body).fontSize(opts.bold ? 11 : 9.5).fillColor(opts.color || (opts.bold ? DARK : GRAY));
    doc.text(label, right - 220, y, { width: 130 });
    doc.text(val, right - 90, y, { width: 90, align: 'right' });
    y += opts.bold ? 18 : 14;
  };
  totalRow('Subtotal', fmtMoney(t.subtotal, cur));
  if (t.discount > 0) totalRow('Discount', `−${fmtMoney(t.discount, cur)}`, { color: '#059669' });
  if (t.tax > 0) totalRow('VAT', fmtMoney(t.tax, cur));
  doc.moveTo(right - 220, y).lineTo(right, y).lineWidth(0.75).strokeColor(LINE).stroke();
  y += 6;
  totalRow(isOffer ? 'Estimated total' : 'Total due', fmtMoney(t.total || d.amount, cur), { bold: true, color: accent });

  // Payment + notes + footer
  y += 14;
  if (d.seller?.iban) {
    doc.font(F.bold).fontSize(7.5).fillColor(LIGHT).text('PAYMENT', M, y, { characterSpacing: 0.8 });
    doc.font(F.body).fontSize(9).fillColor(DARK).text(`${d.seller.bank_name ? `${d.seller.bank_name} · ` : ''}${d.seller.iban}`, M, y + 11);
    y = doc.y + 14;
  }
  if (d.notes) {
    doc.font(F.bold).fontSize(7.5).fillColor(LIGHT).text('NOTES', M, y, { characterSpacing: 0.8 });
    doc.font(F.body).fontSize(9).fillColor(GRAY).text(d.notes, M, y + 11, { width: right - M });
    y = doc.y + 14;
  }
  if (d.seller?.footer) {
    doc.font(F.body).fontSize(8.5).fillColor(GRAY).text(d.seller.footer, M, y, { width: right - M });
    y = doc.y + 10;
  }
  doc.font(F.body).fontSize(7.5).fillColor(LIGHT).text(
    `${isOffer ? 'This offer is valid until the date above.' : 'Thank you for your business.'}  ·  Generated by runbutter.app`,
    M, A4.h - M + 10, { width: right - M, align: 'center' },
  );

  doc.end();
  return done;
}
