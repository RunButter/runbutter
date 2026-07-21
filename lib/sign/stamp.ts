// Stamps a signature certificate onto a signed PDF (pdf-lib, MIT, server-only).
//
// v1 approach: rather than a drag-and-drop field editor, we append a dedicated
// "Signature Certificate" page to the original document listing every signer
// with their method, timestamp and IP, and embedding drawn signatures as
// images. This is a legitimate, widely used lightweight-e-sign pattern — the
// original content is untouched and the certificate is tamper-evident via the
// SHA-256 the caller records over the final bytes.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'crypto';

export interface StampSigner {
  name: string;
  email: string;
  type?: string | null;        // 'drawn' | 'typed'
  data?: string | null;        // PNG data URL (drawn) or the typed name
  signed_at?: string | null;
  ip?: string | null;
}

export interface StampResult { bytes: Uint8Array; sha256: string }

const INK = rgb(0.07, 0.07, 0.07);
const MUTED = rgb(0.42, 0.42, 0.46);
const LINE = rgb(0.9, 0.9, 0.92);

export async function stampCertificate(
  originalPdf: Uint8Array | Buffer,
  meta: { title: string; documentId: string },
  signers: StampSigner[],
): Promise<StampResult> {
  const doc = await PDFDocument.load(originalPdf);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const page = doc.addPage([595, 842]); // A4 portrait, points
  const { width, height } = page.getSize();
  const M = 48;
  let y = height - M;

  page.drawText('Signature Certificate', { x: M, y: y - 6, size: 20, font: bold, color: INK });
  y -= 30;
  page.drawText(meta.title, { x: M, y, size: 11, font, color: MUTED });
  y -= 16;
  page.drawText(`Document ID: ${meta.documentId}`, { x: M, y, size: 8, font, color: MUTED });
  y -= 20;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: LINE });
  y -= 28;

  for (const s of signers) {
    // Page-break before a signer block that wouldn't fit.
    if (y < 160) { y = height - M; doc.addPage([595, 842]); }

    page.drawText(s.name, { x: M, y, size: 12, font: bold, color: INK });
    y -= 15;
    page.drawText(s.email, { x: M, y, size: 10, font, color: MUTED });
    y -= 18;

    // Drawn signature image, if present and decodable.
    if (s.type === 'drawn' && s.data?.startsWith('data:image')) {
      try {
        const b64 = s.data.split(',')[1] ?? '';
        const png = Uint8Array.from(Buffer.from(b64, 'base64'));
        const img = await doc.embedPng(png);
        const scaled = img.scaleToFit(180, 60);
        page.drawImage(img, { x: M, y: y - scaled.height, width: scaled.width, height: scaled.height });
        y -= scaled.height + 6;
      } catch { /* fall through to typed line */ }
    } else if (s.data) {
      // Typed signature rendered in an italic-feeling large font.
      page.drawText(s.data, { x: M, y: y - 18, size: 20, font: bold, color: INK });
      y -= 30;
    }

    const when = s.signed_at ? new Date(s.signed_at).toUTCString() : 'unknown time';
    page.drawText(`Signed ${when}${s.ip ? `  ·  IP ${s.ip}` : ''}  ·  method: ${s.type || 'typed'}`,
      { x: M, y, size: 8, font, color: MUTED });
    y -= 14;
    page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.5, color: LINE });
    y -= 24;
  }

  if (y > 60) {
    page.drawText('Signed with RunButter. This certificate records the signers, their intent, and the time and origin of each signature.',
      { x: M, y: 48, size: 7.5, font, color: MUTED, maxWidth: width - M * 2, lineHeight: 11 });
  }

  const bytes = await doc.save();
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { bytes, sha256 };
}
