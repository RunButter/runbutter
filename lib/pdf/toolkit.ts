// PDF editing operations, running on pdf-lib — the library already in the
// dependency list for invoices and e-sign.
//
// WHY IN THE BROWSER: the obvious build here is "call iLovePDF / Stirling".
// Both mean uploading the customer's signed contracts, payroll runs and bank
// statements to a third party (or paying to host one). pdf-lib does the same
// page-level work locally, so a file dropped on this page never leaves the tab
// — no upload, no key, no per-operation cost, no data-processing agreement to
// sign. That's a feature to advertise, not just an implementation detail.
//
// The honest limit: pdf-lib restructures documents, it does not re-encode
// image or font streams. Merging, splitting, rotating, reordering and stamping
// are exact; "make this 10 MB scan smaller" is NOT possible here and is
// deliberately not offered — that needs Ghostscript-class tooling server-side.

import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

export interface LoadedPdf {
  name: string;
  bytes: ArrayBuffer;
  pageCount: number;
}

/** Read a File into a parsed handle, so the UI can show page counts up front. */
export async function loadPdf(file: File): Promise<LoadedPdf> {
  const bytes = await file.arrayBuffer();
  // Encrypted-but-openable files are common (banks stamp permissions on
  // statements); we only need structural access, so don't refuse them.
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return { name: file.name, bytes, pageCount: doc.getPageCount() };
}

/**
 * Parse a human page range — "1-3, 5, 9-" — into ZERO-based indices, in the
 * order written, so "3,1" really does put page 3 first. Out-of-range and
 * malformed parts are dropped rather than throwing: the field updates on every
 * keystroke and "1-" is a valid thing to be halfway through typing.
 */
export function parsePageRange(input: string, pageCount: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const push = (oneBased: number) => {
    const i = oneBased - 1;
    if (i >= 0 && i < pageCount && !seen.has(i)) { seen.add(i); out.push(i); }
  };

  for (const part of String(input || '').split(',')) {
    const chunk = part.trim();
    if (!chunk) continue;
    const m = chunk.match(/^(\d+)?\s*-\s*(\d+)?$/);
    if (m) {
      const from = m[1] ? parseInt(m[1], 10) : 1;
      const to = m[2] ? parseInt(m[2], 10) : pageCount;
      if (from <= to) for (let p = from; p <= to; p++) push(p);
      else for (let p = from; p >= to; p--) push(p);       // "5-2" reverses
    } else if (/^\d+$/.test(chunk)) {
      push(parseInt(chunk, 10));
    }
  }
  return out;
}

/** Everything except the given indices, in document order. */
export function invertSelection(indices: number[], pageCount: number): number[] {
  const drop = new Set(indices);
  return Array.from({ length: pageCount }, (_, i) => i).filter((i) => !drop.has(i));
}

/** Concatenate documents in the given order. */
export async function mergePdfs(files: LoadedPdf[]): Promise<Uint8Array> {
  if (files.length === 0) throw new Error('Add at least one PDF to merge.');
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return out.save();
}

/** A new document containing only `indices`, in the order given. */
export async function extractPages(file: LoadedPdf, indices: number[]): Promise<Uint8Array> {
  if (indices.length === 0) throw new Error('That range does not match any pages.');
  const src = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  for (const p of pages) out.addPage(p);
  return out.save();
}

/** One single-page document per page — for "burst this into separate files". */
export async function splitToPages(file: LoadedPdf): Promise<{ name: string; bytes: Uint8Array }[]> {
  const src = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
  const stem = file.name.replace(/\.pdf$/i, '');
  const width = String(src.getPageCount()).length;
  const out: { name: string; bytes: Uint8Array }[] = [];
  for (const i of src.getPageIndices()) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    out.push({ name: `${stem}-${String(i + 1).padStart(width, '0')}.pdf`, bytes: await doc.save() });
  }
  return out;
}

/**
 * Rotate `indices` by a relative amount. Relative, not absolute, because a
 * scanned batch is often already at 90° and the user means "turn it further".
 */
export async function rotatePages(file: LoadedPdf, indices: number[], turn: 90 | 180 | 270): Promise<Uint8Array> {
  if (indices.length === 0) throw new Error('That range does not match any pages.');
  const doc = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  for (const i of indices) {
    const current = pages[i].getRotation().angle;
    pages[i].setRotation(degrees((current + turn) % 360));
  }
  return doc.save();
}

/** Drop pages. Refuses to empty the document — an empty PDF won't open. */
export async function deletePages(file: LoadedPdf, indices: number[]): Promise<Uint8Array> {
  if (indices.length === 0) throw new Error('That range does not match any pages.');
  const keep = invertSelection(indices, file.pageCount);
  if (keep.length === 0) throw new Error('That would delete every page — keep at least one.');
  return extractPages(file, keep);
}

/** One page in the visual editor: where it came from, and how it's been turned. */
export interface ComposedPage {
  /** Index into the `files` array passed to composePdf. */
  fileIndex: number;
  /** Zero-based page index within that file. */
  pageIndex: number;
  /** Extra rotation applied on top of the page's own, in degrees. */
  rotation: number;
}

/**
 * Build one document from an arbitrary, reordered selection of pages across
 * several files.
 *
 * This is what the visual editor exports through, and it subsumes merge,
 * split, extract, delete and reorder — all of those are just different page
 * lists. Source documents are loaded once each rather than per page, because a
 * 200-page reorder would otherwise re-parse the same file 200 times.
 */
export async function composePdf(files: LoadedPdf[], pages: ComposedPage[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('No pages selected — an empty PDF cannot be opened.');
  const out = await PDFDocument.create();

  const sources = new Map<number, PDFDocument>();
  for (const p of pages) {
    if (!sources.has(p.fileIndex)) {
      const f = files[p.fileIndex];
      if (!f) throw new Error('A page refers to a file that is no longer loaded.');
      sources.set(p.fileIndex, await PDFDocument.load(f.bytes, { ignoreEncryption: true }));
    }
  }

  // copyPages is batched per source: pdf-lib dedupes shared resources (fonts,
  // images) within a single call, so one call per file keeps the output from
  // ballooning when many pages come from the same document.
  const byFile = new Map<number, number[]>();
  for (const p of pages) byFile.set(p.fileIndex, [...(byFile.get(p.fileIndex) || []), p.pageIndex]);

  const copied = new Map<string, any>();
  for (const [fileIndex, indices] of byFile) {
    const pagesFromFile = await out.copyPages(sources.get(fileIndex)!, indices);
    indices.forEach((pageIndex, i) => copied.set(`${fileIndex}:${pageIndex}:${i}`, pagesFromFile[i]));
  }

  // Walk the caller's order, taking each file's copies in the order they were
  // requested — this is what allows the same page to appear twice.
  const cursor = new Map<number, number>();
  for (const p of pages) {
    const i = cursor.get(p.fileIndex) ?? 0;
    cursor.set(p.fileIndex, i + 1);
    const page = copied.get(`${p.fileIndex}:${p.pageIndex}:${i}`);
    if (!page) throw new Error('Internal error assembling the document.');
    if (p.rotation % 360 !== 0) {
      page.setRotation(degrees((page.getRotation().angle + p.rotation) % 360));
    }
    out.addPage(page);
  }
  return out.save();
}

export interface WatermarkOptions {
  text: string;
  /** 0.02–1. Low values are the point: readable, but not obscuring the content. */
  opacity?: number;
  /** Degrees counter-clockwise. 45 reads as a classic diagonal stamp. */
  angle?: number;
  /** Font size in points; defaults to a size scaled off the page width. */
  size?: number;
}

/** Stamp text diagonally across every page. */
export async function watermarkPdf(file: LoadedPdf, opts: WatermarkOptions): Promise<Uint8Array> {
  const text = opts.text.trim();
  if (!text) throw new Error('Enter the watermark text.');
  const doc = await PDFDocument.load(file.bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const opacity = Math.min(1, Math.max(0.02, opts.opacity ?? 0.12));
  const angle = opts.angle ?? 45;

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    // Default to roughly 70% of the page diagonal so the stamp spans the page
    // whatever its size, then clamp so a long word doesn't overflow.
    const diagonal = Math.sqrt(width * width + height * height);
    let size = opts.size ?? Math.min(72, (diagonal * 0.7) / Math.max(text.length, 1) * 1.6);
    let textWidth = font.widthOfTextAtSize(text, size);
    while (textWidth > diagonal * 0.9 && size > 6) {
      size -= 2;
      textWidth = font.widthOfTextAtSize(text, size);
    }
    const rad = (angle * Math.PI) / 180;
    // Rotation in pdf-lib pivots on the anchor, so offset the anchor by half
    // the rotated text vector to land the stamp's centre on the page's centre.
    page.drawText(text, {
      x: width / 2 - (textWidth / 2) * Math.cos(rad) + (size / 2) * Math.sin(rad),
      y: height / 2 - (textWidth / 2) * Math.sin(rad) - (size / 2) * Math.cos(rad),
      size,
      font,
      color: rgb(0.4, 0.4, 0.45),
      opacity,
      rotate: degrees(angle),
    });
  }
  return doc.save();
}

/** JPEG/PNG files → one PDF, one image per page, each page sized to its image. */
export async function imagesToPdf(files: File[]): Promise<Uint8Array> {
  if (files.length === 0) throw new Error('Add at least one image.');
  const doc = await PDFDocument.create();
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const isPng = /\.png$/i.test(file.name) || file.type === 'image/png';
    // pdf-lib only embeds JPEG and PNG; anything else is rejected up front by
    // the picker, but say so clearly if one slips through.
    let image;
    try {
      image = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch {
      throw new Error(`${file.name} is not a JPEG or PNG.`);
    }
    const page = doc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  return doc.save();
}

/** Trigger a browser download for generated bytes. */
export function downloadBytes(bytes: Uint8Array, filename: string) {
  // Copy into a fresh ArrayBuffer: pdf-lib can hand back a view over a larger
  // pooled buffer, and Blob would then include the surrounding bytes.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on the next tick — revoking synchronously can cancel the download
  // in Safari before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Suffix a filename before its extension: "a.pdf" + "merged" → "a-merged.pdf". */
export function suffixName(name: string, suffix: string): string {
  return `${name.replace(/\.pdf$/i, '')}-${suffix}.pdf`;
}
