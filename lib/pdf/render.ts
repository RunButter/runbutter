'use client';

// Page thumbnails, rendered locally with pdf.js.
//
// pdf-lib can restructure a document but cannot RASTERISE one — it has no
// renderer at all. Showing someone their actual pages therefore needs a second
// library, and pdf.js is the only serious option (Apache-2.0, so fine next to
// MIT). It still runs entirely in the tab: adding a preview must not turn a
// tool whose whole selling point is "your files never upload" into one that
// ships them somewhere.

import type { PDFDocumentProxy } from 'pdfjs-dist';

// pdf.js is ~1 MB and only this page needs it, so it is imported on first use
// rather than at module scope — otherwise every route pays for it.
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      // Served from our own origin, copied out of node_modules at build time by
      // scripts/copy-pdf-worker.mjs. Deliberately NOT a CDN URL: that breaks
      // offline and leaks to a third party that a PDF is being opened, which
      // would undercut the whole "nothing leaves your browser" promise.
      // Deliberately NOT `new URL(..., import.meta.url)` either — webpack emits
      // it, then Terser tries to minify an ES module as a script and the build
      // fails. See the script for the full story.
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/**
 * Open a document for rendering.
 *
 * The bytes are COPIED first: pdf.js transfers the buffer it is given to the
 * worker, which detaches it, and the same ArrayBuffer is still needed later by
 * pdf-lib to build the output. Without the copy the export silently produces an
 * empty file once a thumbnail has been drawn.
 */
export async function openForRender(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  return pdfjs.getDocument({ data: bytes.slice(0) }).promise;
}

/** Render one page to a data URL, scaled to fit `maxWidth`. */
export async function renderThumbnail(
  doc: PDFDocumentProxy, pageNumber: number, maxWidth = 220,
): Promise<{ url: string; width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  // Cap the pixel budget: a poster-sized page at scale 1 is enormous, and these
  // are thumbnails.
  const scale = Math.min(maxWidth / base.width, 2);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a canvas context to render the preview.');

  // Pages are transparent by default; without this they render as dark
  // rectangles in dark mode instead of looking like paper.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();

  return { url: canvas.toDataURL('image/jpeg', 0.72), width: canvas.width, height: canvas.height };
}
