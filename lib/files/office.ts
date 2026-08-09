/**
 * Text out of the Office formats that are really ZIPs of XML.
 *
 * WHY THIS EXISTS. `lib/files/extract.ts` handled PDF, DOCX, images and plain
 * text — and returned `skipped` for `.xlsx` and `.pptx`. On a product whose
 * pitch is that files become data, and with Finance as a core module, an
 * uploaded spreadsheet was invisible to search, invisible to `search_files`,
 * and therefore invisible to every agent. Businesses upload spreadsheets
 * constantly.
 *
 * WHY NOT A LIBRARY, AND WHY NOT A BINARY. The obvious answers are a
 * spreadsheet library or a native Office CLI, and both are far more than this
 * needs. An `.xlsx` is a ZIP containing XML; so is a `.pptx`. We already own a
 * dependency-free ZIP reader (`lib/plugins/unzip.ts`) written for the plugin
 * builder, and the job here is text for a search index — not formulas, not
 * formatting, not a rendering engine. A native addon would also have to be kept
 * in `serverComponentsExternalPackages` AND `outputFileTracingIncludes` or the
 * Docker image ships without it and degrades only in production, which this
 * project has already been bitten by once.
 *
 * WHAT IT DOES NOT DO. It does not evaluate formulas — a cell shows its last
 * cached value, which is what the file actually contains and what a person
 * reading the sheet would see. It does not preserve layout beyond row breaks.
 * It is an indexer, and treating it as a spreadsheet engine would be the same
 * mistake as calling a markdown table a spreadsheet (see `doc kinds`, 0081).
 */

import { unzip } from '@/lib/plugins/unzip';

/**
 * Text out of an OOXML fragment.
 *
 * Deliberately a scan for text runs rather than an XML parse. These documents
 * carry namespaces, drawing markup, revision history and thousands of styling
 * elements; a real parser would build all of it to reach the handful of `<t>`
 * nodes that hold words. The tags that hold text in OOXML are exactly `<t>`
 * (word/sheet strings) and `<a:t>` (drawing and slide text), both of which are
 * leaf elements containing escaped character data and nothing else — so a scan
 * cannot pick up markup by accident.
 */
function textRuns(xml: string): string[] {
  const out: string[] = [];
  const re = /<(?:[a-z]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-z]+:)?t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const s = unescapeXml(m[1]);
    if (s.trim()) out.push(s);
  }
  return out;
}

/** The five predefined entities plus numeric references. */
function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    // Ampersand LAST, or "&amp;lt;" would decode twice into a "<".
    .replace(/&amp;/g, '&');
}

function safeChar(code: number): string {
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** `sheet1.xml` → 1, so sheets come out in the order they appear in the book. */
const numberIn = (path: string): number => {
  const m = path.match(/(\d+)\.xml$/);
  return m ? Number(m[1]) : 0;
};

/**
 * A workbook, as rows of text.
 *
 * Most strings in an `.xlsx` are not in the sheet — they live once in
 * `sharedStrings.xml` and the cells hold an INDEX into it (that is the whole
 * point of the format). A reader that only walked the sheets would return the
 * numbers and none of the words, which is a worse outcome than not indexing at
 * all: search would look like it worked.
 *
 * Row structure is kept because it is what makes a sheet readable as text —
 * "Acme Ltd 1042 4200 overdue" on one line is a record; the same words as a
 * column of fragments is not.
 */
export async function xlsxText(bytes: Buffer): Promise<string> {
  const entries = await unzip(toArrayBuffer(bytes));
  const byPath = new Map(entries.map((e) => [e.path, e.content]));

  const shared = byPath.get('xl/sharedStrings.xml');
  // Each <si> is one string, which may be split across several <t> runs by
  // formatting — they have to be joined, or "Acme Ltd" indexes as two words
  // that never appear together.
  const strings: string[] = [];
  if (shared) {
    const si = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
    let m: RegExpExecArray | null;
    while ((m = si.exec(shared))) strings.push(textRuns(m[1]).join(''));
  }

  const sheets = entries
    .map((e) => e.path)
    .filter((p) => /^xl\/worksheets\/sheet\d*\.xml$/.test(p))
    .sort((a, b) => numberIn(a) - numberIn(b));

  const lines: string[] = [];
  for (const path of sheets) {
    const xml = byPath.get(path) || '';
    const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
    let r: RegExpExecArray | null;
    while ((r = rowRe.exec(xml))) {
      const cells: string[] = [];
      const cellRe = /<c(?:\s([^>]*))?>([\s\S]*?)<\/c>/g;
      let c: RegExpExecArray | null;
      while ((c = cellRe.exec(r[1]))) {
        const attrs = c[1] || '';
        const body = c[2] || '';
        const v = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
        if (/\bt="s"/.test(attrs)) {
          // Shared-string index. A missing entry means a malformed book; skip
          // the cell rather than emitting a bare number that reads as data.
          const i = Number(unescapeXml(v?.[1] ?? ''));
          const s = Number.isInteger(i) ? strings[i] : undefined;
          if (s) cells.push(s);
        } else if (/\bt="inlineStr"/.test(attrs)) {
          const inline = textRuns(body).join('');
          if (inline) cells.push(inline);
        } else if (v) {
          // Numbers, dates and cached formula results, as stored. Dates are
          // serial numbers in xlsx and are left as such: converting one needs
          // the workbook's epoch and its display format, and a date guessed
          // wrong in a search index is worse than the number it came from.
          const raw = unescapeXml(v[1]).trim();
          if (raw) cells.push(raw);
        }
      }
      if (cells.length) lines.push(cells.join('\t'));
    }
  }
  return lines.join('\n');
}

/**
 * A deck, as one block per slide.
 *
 * Speaker notes are included: they routinely hold the numbers and caveats the
 * slide itself leaves out, which is exactly what someone searching a deck six
 * months later is looking for.
 */
export async function pptxText(bytes: Buffer): Promise<string> {
  const entries = await unzip(toArrayBuffer(bytes));
  const byPath = new Map(entries.map((e) => [e.path, e.content]));

  const slides = entries
    .map((e) => e.path)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => numberIn(a) - numberIn(b));

  const out: string[] = [];
  for (const path of slides) {
    const n = numberIn(path);
    const body = textRuns(byPath.get(path) || '').join('\n');
    const notes = textRuns(byPath.get(`ppt/notesSlides/notesSlide${n}.xml`) || '').join('\n');
    const block = [body, notes && `Notes:\n${notes}`].filter(Boolean).join('\n');
    if (block.trim()) out.push(`Slide ${n}\n${block}`);
  }
  return out.join('\n\n');
}

/**
 * A Buffer is a VIEW onto a pool that Node reuses, so `.buffer` is very often a
 * window onto megabytes of unrelated memory rather than this file. Passing it
 * straight to a ZIP reader makes the end-of-central-directory scan search the
 * wrong bytes and fail on files that are perfectly valid.
 */
function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
