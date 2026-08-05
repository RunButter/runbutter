// Structure and classification for a PDF, from @firecrawl/pdf-inspector (MIT).
//
// WHY IT SITS BESIDE pdfjs RATHER THAN REPLACING IT. pdfjs-dist has years of
// hardening against malformed real-world PDFs and it is already the engine
// behind the thumbnails in the PDF editor, so its text stays the text of
// record. This adds the two things it does not give us:
//
//   1. WHICH PAGES ARE SCANS. Our previous test was characters-per-page across
//      the whole document, which cannot see inside an average: a two-page
//      contract with a text page and a scanned signature page reads as 216
//      chars/page — comfortably "has a text layer" — and the scanned page is
//      then silently missing from search with nothing anywhere saying so.
//      Measured on exactly that file: the heuristic said "text layer", this
//      says Mixed with page 2 needing OCR.
//   2. TABLES. pdfjs returns a table as "Discovery sprint 1 8,500.00 8,500.00";
//      this returns a markdown table. That is the difference between an agent
//      being able to read an invoice's line items and not.
//
// It is Rust behind napi with prebuilt binaries for linux-x64, macOS-arm64 and
// win-x64, so no toolchain is needed to install it — but it IS a native addon,
// which is why it is in serverComponentsExternalPackages.
//
// EVERY FUNCTION HERE RETURNS null RATHER THAN THROWING. A second parser is
// only worth having if it cannot take the first one down: any failure means the
// caller carries on with exactly the behaviour it had before this file existed.

export type PdfKind = 'TextBased' | 'Scanned' | 'ImageBased' | 'Mixed';

export interface PdfShape {
  kind: PdfKind;
  pageCount: number;
  /** 0-based page indexes with no usable text layer. */
  pagesNeedingOcr: number[];
  /** The library's own confidence, 0–1. */
  confidence: number;
}

let mod: any;
let loadFailed = false;

function inspector(): any | null {
  if (mod) return mod;
  if (loadFailed) return null;
  try {
    // require, not import: this is a CommonJS native addon, and a static import
    // would make the whole module graph depend on a binary that may be missing
    // on an unusual platform.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('@firecrawl/pdf-inspector');
    return mod;
  } catch (e) {
    loadFailed = true;
    console.warn('pdf-inspector unavailable — falling back to text-only extraction:', (e as Error)?.message);
    return null;
  }
}

/** Cheap: samples content streams for text operators. Single-digit milliseconds. */
export function inspectPdf(bytes: Buffer): PdfShape | null {
  const lib = inspector();
  if (!lib) return null;
  try {
    const r = lib.classifyPdf(bytes);
    if (!r?.pdfType) return null;
    return {
      kind: r.pdfType as PdfKind,
      pageCount: Number(r.pageCount) || 0,
      pagesNeedingOcr: Array.isArray(r.pagesNeedingOcr) ? r.pagesNeedingOcr.map(Number) : [],
      confidence: typeof r.confidence === 'number' ? r.confidence : 0,
    };
  } catch {
    return null;
  }
}

/**
 * The document as markdown — headings, paragraphs and tables.
 *
 * Returns null when there is nothing better than plain text to offer, so the
 * caller can keep pdfjs's output without having to compare quality itself.
 */
export function pdfMarkdown(bytes: Buffer): string | null {
  const lib = inspector();
  if (!lib) return null;
  try {
    const r = lib.processPdf(bytes);
    const md = typeof r?.markdown === 'string' ? r.markdown.trim() : '';
    return md || null;
  } catch {
    return null;
  }
}

/**
 * Pick what to index: markdown if it is at least as complete as the text we
 * already have, otherwise the text.
 *
 * THE COMPARISON MATTERS. Two different parsers read the same file, and a
 * markdown conversion that dropped half a page would be a silent regression in
 * search — worse than the flat text it replaced, and invisible because both
 * look plausible. Comparing letters and digits (ignoring the pipes, dashes and
 * hashes markdown adds) means the richer output is only kept when it actually
 * contains the document.
 */
export function preferMarkdown(text: string, markdown: string | null): { body: string; markdown: boolean } {
  if (!markdown) return { body: text, markdown: false };
  const weight = (s: string) => (s.match(/[\p{L}\p{N}]/gu) || []).length;
  const plain = weight(text);
  const rich = weight(markdown);
  // 98%, not 100%: the two parsers legitimately differ by a few characters on
  // ligatures and soft hyphens, and a strict rule would throw away good
  // markdown over a single glyph.
  return rich >= plain * 0.98 ? { body: markdown, markdown: true } : { body: text, markdown: false };
}
