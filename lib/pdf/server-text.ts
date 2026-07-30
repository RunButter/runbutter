// Server-side PDF text extraction. Node runtime only.
//
// WHY NOT pdf-parse: it bundles pdf.js 1.10 (2018). That build cannot read a
// PDF that uses OBJECT STREAMS — it throws "Invalid PDF structure" — and object
// streams are what every modern writer emits by default, pdf-lib included. So
// a document exported from RunButter's own PDF tools, or from any current
// version of Word or Acrobat, would come back as a hard failure and its text
// would silently never be indexed.
//
// pdfjs-dist is already a dependency (it renders the thumbnails in the PDF
// editor) and is current, so extraction uses the same engine as the preview.
// The `legacy` build is the one meant for Node.

let cached: any = null;

async function pdfjs() {
  if (!cached) {
    // Dynamic import: the legacy build reaches for browser globals at module
    // scope in some bundler configurations, so it must not load at import time.
    cached = await import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return cached;
}

export interface PdfText { text: string; pages: number }

/**
 * Extract the text layer of a PDF.
 *
 * Throws on a genuinely unreadable file (corrupt, or encrypted with a password
 * we don't have) so the caller can record that distinctly from "this is a scan
 * with no text in it", which returns successfully with an empty string.
 */
export async function pdfText(bytes: Buffer): Promise<PdfText> {
  const { getDocument } = await pdfjs();

  const doc = await getDocument({
    // A copy: pdf.js takes ownership of the buffer it is handed and detaches it.
    data: new Uint8Array(bytes),
    // No eval, no remote fetches — this runs on our server against files the
    // user uploaded, and neither is needed to read text.
    isEvalSupported: false,
    useSystemFonts: false,
    // Only glyph rendering needs the standard font data; without it pdf.js logs
    // one warning per document and extracts the text regardless.
    disableFontFace: true,
  }).promise;

  const parts: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // pdf.js emits one item per text run, with hasEOL marking a line break.
      // Joining everything with spaces would run headings into paragraphs and
      // turn a table into one unreadable line.
      let out = '';
      for (const item of content.items as any[]) {
        if (typeof item?.str !== 'string') continue;
        out += item.str;
        if (item.hasEOL) out += '\n';
        else if (!item.str.endsWith(' ')) out += ' ';
      }
      parts.push(out);
      page.cleanup();
    }
    return { text: parts.join('\n').trim(), pages: doc.numPages };
  } finally {
    // Worker teardown. Without this a long-running server accumulates one
    // detached worker per document parsed.
    await doc.destroy().catch(() => {});
  }
}
