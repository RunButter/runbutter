'use client';

/**
 * Turning a PDF into something else, in the browser.
 *
 * The rest of `/pdf` rearranges pages with pdf-lib. These two do the other
 * thing people want from a PDF — get the pixels out, or get the words out —
 * and they run in the tab for the same reason everything else on that page
 * does: a contract or an invoice should not travel to a conversion service to
 * come back as a PNG.
 *
 * No new dependency. `pdfjs-dist` is already installed and already renders the
 * page thumbnails (`lib/pdf/render.ts`), which is most of the work for images;
 * the text layer it exposes is most of the work for markdown.
 */

import { openForRender } from '@/lib/pdf/render';

export type ImageFormat = 'png' | 'jpeg';

export interface RenderedPage { name: string; bytes: Uint8Array; width: number; height: number }

/**
 * Render pages to images.
 *
 * `scale` is a multiplier on the PDF's own point size, where 1 is 72 dpi. The
 * caller passes a dpi and this converts, because "150 dpi" is a thing people
 * know they want and "scale 2.08" is not.
 *
 * The pixel budget is capped per page. A0 poster pages exist, and 300 dpi on
 * one is a 100-megapixel canvas that will either fail to allocate or take the
 * tab down — a quietly smaller image beats a crashed browser.
 */
export async function pagesToImages(
  bytes: ArrayBuffer,
  indices: number[],
  opts: { dpi?: number; format?: ImageFormat; quality?: number; baseName?: string } = {},
): Promise<RenderedPage[]> {
  const { dpi = 150, format = 'png', quality = 0.9, baseName = 'page' } = opts;
  const doc = await openForRender(bytes);
  const out: RenderedPage[] = [];
  const MAX_PIXELS = 24_000_000;

  try {
    for (const i of indices) {
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      let scale = dpi / 72;
      const pixels = base.width * scale * base.height * scale;
      if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);

      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get a canvas context to render the page.');

      // PDF pages are transparent. Without this a JPEG comes out with a black
      // background and a PNG looks fine until somebody prints it.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      page.cleanup();

      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob(res, format === 'png' ? 'image/png' : 'image/jpeg', format === 'jpeg' ? quality : undefined));
      if (!blob) throw new Error(`Page ${i + 1} could not be encoded.`);

      out.push({
        name: `${baseName}-${String(i + 1).padStart(3, '0')}.${format}`,
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width: canvas.width, height: canvas.height,
      });

      // Release the backing store before the next page. Without this a
      // fifty-page export holds every canvas at once.
      canvas.width = 0; canvas.height = 0;
    }
  } finally {
    doc.destroy();
  }
  return out;
}

// ── Markdown ────────────────────────────────────────────────────────────────

interface Line { y: number; size: number; text: string }

/**
 * A PDF's words, as markdown.
 *
 * WHAT THIS IS AND IS NOT. A PDF has no headings, no paragraphs and no lists —
 * it has glyphs at coordinates. Everything below is inference from position and
 * size, which is the only information there is. It recovers reading order,
 * paragraph breaks and heading levels, and it does NOT recover tables: columns
 * are spatial, and turning them back into rows needs the layout analysis that
 * `lib/pdf/inspect.ts` does with a native library on the server. Saying so is
 * better than emitting a mangled table that looks deliberate.
 *
 * A scanned page has no text layer at all and yields nothing. The caller is
 * told which pages were empty rather than handed a short file with no
 * explanation.
 */
export async function pdfToMarkdown(
  bytes: ArrayBuffer,
  opts: { pageBreaks?: boolean } = {},
): Promise<{ markdown: string; emptyPages: number[] }> {
  const doc = await openForRender(bytes);
  const chunks: string[] = [];
  const emptyPages: number[] = [];

  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();

      // Group glyph runs into lines by their baseline. PDFs emit text in
      // whatever order the producer felt like, so position is the only reliable
      // ordering — sorting by it is what turns two columns of runs back into
      // readable lines.
      const byLine = new Map<number, { size: number; items: { x: number; str: string }[] }>();
      for (const item of content.items as any[]) {
        const str = String(item.str ?? '');
        if (!str.trim()) continue;
        const t = item.transform || [1, 0, 0, 1, 0, 0];
        // Round the baseline: glyphs on one visual line differ by fractions of
        // a point, and an exact key would make every word its own line.
        const y = Math.round(t[5] * 2) / 2;
        const size = Math.abs(item.height || t[3] || 12);
        const row = byLine.get(y) || { size, items: [] };
        row.size = Math.max(row.size, size);
        row.items.push({ x: t[4], str });
        byLine.set(y, row);
      }

      const lines: Line[] = [...byLine.entries()]
        .sort((a, b) => b[0] - a[0])          // PDF y grows upward, so descending is top-down
        .map(([y, row]) => ({
          y, size: row.size,
          text: row.items.sort((a, b) => a.x - b.x).map((i) => i.str).join('').replace(/\s+/g, ' ').trim(),
        }))
        .filter((l) => l.text);

      page.cleanup();
      if (!lines.length) { emptyPages.push(p); continue; }

      // Body size is the MEDIAN, not the mean: one 48pt title would drag a mean
      // upward far enough that nothing after it reads as a heading.
      const sizes = lines.map((l) => l.size).sort((a, b) => a - b);
      const body = sizes[Math.floor(sizes.length / 2)] || 12;

      const md: string[] = [];
      let prevY: number | null = null;
      for (const line of lines) {
        // A gap bigger than a line and a half is a paragraph break. Smaller
        // gaps are just leading and must not split a sentence.
        if (prevY !== null && prevY - line.y > line.size * 1.8) md.push('');
        prevY = line.y;

        const ratio = line.size / body;
        // Only SHORT lines become headings. A whole paragraph set slightly
        // large is a large paragraph, not an eighty-word `##`.
        const short = line.text.length <= 80;
        if (short && ratio >= 1.6) md.push(`# ${line.text}`);
        else if (short && ratio >= 1.25) md.push(`## ${line.text}`);
        else if (short && ratio >= 1.1) md.push(`### ${line.text}`);
        else if (/^[•▪●·–—-]\s+/.test(line.text)) md.push(line.text.replace(/^[•▪●·–—-]\s+/, '- '));
        else md.push(line.text);
      }

      chunks.push(md.join('\n').replace(/\n{3,}/g, '\n\n').trim());
    }
  } finally {
    doc.destroy();
  }

  const sep = opts.pageBreaks ? '\n\n---\n\n' : '\n\n';
  return { markdown: chunks.filter(Boolean).join(sep).trim(), emptyPages };
}
