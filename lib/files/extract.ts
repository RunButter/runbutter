// Turn an uploaded file into searchable text. Server-side only (Node runtime).
//
// THREE TIERS, cheapest first, and only the first two are ever guaranteed:
//   1. text_layer — a PDF that already contains text, or a DOCX, or anything
//      textual. Handled locally by pdf-parse / mammoth / a UTF-8 decode. Free.
//   2. ocr — a scan or a photo. Needs a real OCR stack, which we do NOT bundle
//      and do NOT call as a metered service. The backend is PLUGGABLE and
//      self-hosted: either MinerU (MINERU_URL) or any OpenAI-compatible vision
//      endpoint (OCR_API_URL), which is how vLLM and SGLang serve models like
//      Baidu's Unlimited-OCR and DeepSeek-OCR; otherwise…
//   3. skipped — …the file is stored and listed, just not searchable by content.
//      That is an honest outcome, not a failure: nothing is lost, and the status
//      column says exactly why the body is empty.
//
// Consistent with the cost rule in CLAUDE.md: no per-call API is contacted here.

import mammoth from 'mammoth';
import { pdfText } from '@/lib/pdf/server-text';
import { inspectPdf, pdfMarkdown, preferMarkdown } from '@/lib/pdf/inspect';

export type ExtractStatus = 'text_layer' | 'ocr' | 'vision' | 'skipped' | 'failed';

export interface Extraction {
  text: string;
  status: ExtractStatus;
  pages: number | null;
  /**
   * Why this file is not fully searchable, in a sentence, shown under the file
   * name in the Files list. Set on 'failed' and 'skipped', and also on a
   * 'text_layer' file that is PARTLY a scan — success with a caveat is still a
   * caveat, and the caveat is the part somebody needs to act on.
   */
  error: string | null;
}

/** Cap what goes in the tsvector's source column. Postgres itself caps the vector at 1MB. */
const MAX_CHARS = 800_000;

/**
 * Below this many characters per page a PDF is a scan, not a document.
 * Scanners often leave a stray header or page number in the text layer, so
 * "is the text layer empty" has to be a threshold rather than a length check.
 */
const SCAN_CHARS_PER_PAGE = 40;

const TEXTUAL_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'xml', 'yml', 'yaml', 'log'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'bmp', 'heic'];

export const extOf = (name: string) => (name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Collapse whitespace and drop control characters so FTS tokens stay clean. */
function clean(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS);
}

/**
 * Which OCR backend, if any, this deployment has been pointed at.
 *
 * Both are self-hosted and neither is metered by us — the workspace runs the
 * service and we send it bytes, which is the same arrangement as MinerU has
 * always been. `vision` is preferred when both are set: the models served this
 * way (Unlimited-OCR, DeepSeek-OCR) read layout and tables far better than a
 * classical pipeline. It does, however, need an NVIDIA GPU, whereas MinerU has
 * a CPU-only backend — which is exactly why both stay supported.
 */
export type OcrBackend = 'vision' | 'mineru' | null;
export function ocrBackend(): OcrBackend {
  if (process.env.OCR_API_URL) return 'vision';
  if (process.env.MINERU_URL) return 'mineru';
  return null;
}
/** Whether ANY OCR backend is configured. Drives the UI's honesty about scans. */
export const ocrConfigured = () => ocrBackend() !== null;

/**
 * Hand a file to a self-hosted MinerU instance.
 *
 * MinerU is Apache-2.0 with additional conditions; one of them requires that a
 * service using it discloses that fact in the product interface. See
 * docs/file-extraction.md and the credit rendered on the Files screen — this
 * comment alone would not satisfy it.
 *
 * Its API has moved around between releases, so both the request and the reply
 * are handled loosely: we post multipart under the two field names it has used
 * and accept whichever Markdown key comes back.
 */
async function viaMineru(bytes: Buffer, name: string, mime: string): Promise<Extraction> {
  const base = (process.env.MINERU_URL || '').replace(/\/+$/, '');
  const url = `${base}/file_parse`;

  const form = new FormData();
  // Copy into a plain ArrayBuffer: a Buffer's backing store is typed as
  // ArrayBufferLike, which Blob won't take.
  const blob = new Blob([new Uint8Array(bytes)], { type: mime || 'application/octet-stream' });
  form.append('files', blob, name);
  form.append('file', blob, name);
  // 'auto' lets MinerU decide between its OCR and text pipelines. 'pipeline' is
  // the CPU-only backend — the GPU backends are not assumed to exist.
  form.append('parse_method', 'auto');
  form.append('backend', 'pipeline');
  form.append('return_md', 'true');

  // A scan of a long document genuinely takes minutes. Bounded so a hung
  // service cannot pin the route open until the platform timeout.
  const abort = AbortSignal.timeout(180_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST', body: form, signal: abort,
      ...(process.env.MINERU_TOKEN ? { headers: { authorization: `Bearer ${process.env.MINERU_TOKEN}` } } : {}),
    });
  } catch (e: any) {
    const timedOut = e?.name === 'TimeoutError' || /abort/i.test(e?.message || '');
    return {
      text: '', status: 'failed', pages: null,
      error: timedOut ? 'OCR timed out after 3 minutes.' : `OCR service unreachable at ${base}.`,
    };
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    return { text: '', status: 'failed', pages: null, error: `OCR service returned HTTP ${res.status}. ${detail}`.trim() };
  }

  const body: any = await res.json().catch(() => null);
  if (!body) return { text: '', status: 'failed', pages: null, error: 'OCR service returned a non-JSON reply.' };

  // Shapes seen across releases: { md_content }, { results: { <name>: { md_content } } },
  // { results: [ { md_content } ] }.
  const first = (o: any): string => {
    if (!o) return '';
    if (typeof o === 'string') return o;
    for (const k of ['md_content', 'markdown', 'md', 'content', 'text']) {
      if (typeof o[k] === 'string' && o[k].trim()) return o[k];
    }
    const nested = o.results ?? o.result ?? o.data;
    if (Array.isArray(nested)) return nested.map(first).find(Boolean) || '';
    if (nested && typeof nested === 'object') return Object.values(nested).map(first).find(Boolean) || '';
    return '';
  };

  const text = clean(first(body));
  if (!text) return { text: '', status: 'failed', pages: null, error: 'OCR produced no text for this file.' };
  return { text, status: 'ocr', pages: null, error: null };
}

/**
 * Hand an IMAGE to an OpenAI-compatible vision endpoint.
 *
 * This is the shape vLLM and SGLang expose, so it works unchanged against
 * Baidu's Unlimited-OCR (MIT, built on DeepSeek-OCR) and any other vision model
 * served the same way. Nothing here is specific to one model beyond OCR_MODEL,
 * which is why the integration is a generic endpoint rather than a named one.
 *
 * IMAGES ONLY, deliberately. These servers accept image content parts, not PDF
 * bytes, and rasterising a PDF server-side would mean pulling in a native canvas
 * dependency. A scanned PDF therefore still routes to MinerU — see extractFile.
 */
async function viaVisionApi(bytes: Buffer, mime: string): Promise<Extraction> {
  const base = (process.env.OCR_API_URL || '').replace(/\/+$/, '');
  const model = process.env.OCR_MODEL || 'unlimited-ocr';
  const url = `${base}/chat/completions`;
  const dataUri = `data:${mime || 'image/png'};base64,${bytes.toString('base64')}`;

  // A long document on a busy GPU genuinely takes minutes.
  const abort = AbortSignal.timeout(180_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: abort,
      headers: {
        'content-type': 'application/json',
        ...(process.env.OCR_API_KEY ? { authorization: `Bearer ${process.env.OCR_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model,
        // Deterministic: this is transcription, not writing. A creative decode
        // invents plausible-looking line items on an invoice, which is worse
        // than no text at all.
        temperature: 0,
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Transcribe this document to Markdown. Preserve tables and reading order. Output only the document content, with no commentary.' },
            { type: 'image_url', image_url: { url: dataUri } },
          ],
        }],
      }),
    });
  } catch (e: any) {
    const timedOut = e?.name === 'TimeoutError' || /abort/i.test(e?.message || '');
    return {
      text: '', status: 'failed', pages: null,
      error: timedOut ? 'OCR timed out after 3 minutes.' : `OCR endpoint unreachable at ${base}.`,
    };
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    return { text: '', status: 'failed', pages: null, error: `OCR endpoint returned HTTP ${res.status}. ${detail}`.trim() };
  }

  const body: any = await res.json().catch(() => null);
  const text = clean(body?.choices?.[0]?.message?.content ?? '');
  if (!text) return { text: '', status: 'failed', pages: null, error: 'OCR returned no text for this file.' };
  return { text, status: 'ocr', pages: null, error: null };
}

/**
 * Extract text from an uploaded file.
 *
 * Never throws — every failure path returns a status and a sentence the UI can
 * show, because the file itself is already stored by the time this runs and
 * losing the upload over a parse error would be the worse bug.
 */
export async function extractFile(bytes: Buffer, name: string, mime = ''): Promise<Extraction> {
  const ext = extOf(name);
  const isPdf = ext === 'pdf' || mime === 'application/pdf';
  const isDocx = ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const isImage = IMAGE_EXT.includes(ext) || mime.startsWith('image/');
  const isTextual = TEXTUAL_EXT.includes(ext) || mime.startsWith('text/') || mime === 'application/json';

  try {
    if (isPdf) {
      const data = await pdfText(bytes);
      const pages = data.pages || null;
      const flat = clean(data.text);

      // Markdown when it is genuinely richer — tables survive as tables, which
      // is what makes an invoice's line items readable to search and to agents.
      const { body } = preferMarkdown(flat, pdfMarkdown(bytes));
      const text = clean(body);

      // Which pages are scans, rather than an average over all of them. The old
      // test was characters-per-page across the document, and an average cannot
      // see a scanned signature page hiding behind two pages of text.
      const shape = inspectPdf(bytes);
      const thin = shape
        ? shape.kind === 'Scanned' || shape.kind === 'ImageBased'
        : text.length < (pages || 1) * SCAN_CHARS_PER_PAGE;

      // A document that is PART scan: the text pages are indexed and searchable,
      // and the missing ones are NAMED. Reporting this as a clean success is how
      // a contract's signature page quietly never appears in a search, with
      // nothing anywhere to suggest it is missing.
      if (!thin && shape?.kind === 'Mixed' && shape.pagesNeedingOcr.length) {
        const list = shape.pagesNeedingOcr.map((p) => p + 1).join(', ');
        if (process.env.MINERU_URL) {
          const ocr = await viaMineru(bytes, name, 'application/pdf');
          // OCR of the whole file covers the scanned pages; if it failed, keep
          // the text we already have rather than losing both.
          if (ocr.status === 'ocr' && ocr.text) return { ...ocr, pages: ocr.pages ?? pages };
          return {
            text, status: 'text_layer', pages,
            error: `Indexed the text pages. Page${shape.pagesNeedingOcr.length > 1 ? 's' : ''} ${list} ${shape.pagesNeedingOcr.length > 1 ? 'are scans' : 'is a scan'} and OCR did not run, so ${shape.pagesNeedingOcr.length > 1 ? 'their' : 'its'} content is not searchable.`,
          };
        }
        return {
          text, status: 'text_layer', pages,
          error: `Indexed the text pages. Page${shape.pagesNeedingOcr.length > 1 ? 's' : ''} ${list} ${shape.pagesNeedingOcr.length > 1 ? 'are scans' : 'is a scan'} — set MINERU_URL to make ${shape.pagesNeedingOcr.length > 1 ? 'them' : 'it'} searchable too.`,
        };
      }

      if (!thin) return { text, status: 'text_layer', pages, error: null };
      // MinerU takes a whole PDF; the vision endpoint takes images, so a scan
      // needs MinerU even when a vision backend is also configured.
      if (process.env.MINERU_URL) {
        const ocr = await viaMineru(bytes, name, 'application/pdf');
        // A failed OCR attempt on a scan still knows the page count.
        return { ...ocr, pages: ocr.pages ?? pages };
      }
      return {
        text, status: 'skipped', pages,
        error: ocrBackend() === 'vision'
          ? 'This PDF is a scan. The configured OCR endpoint reads images, not PDFs — set MINERU_URL to handle scanned PDFs, or upload the pages as images.'
          : 'This PDF is a scan with no text layer. Configure an OCR backend to make it searchable.',
      };
    }

    if (isDocx) {
      const { value } = await mammoth.extractRawText({ buffer: bytes });
      return { text: clean(value || ''), status: 'text_layer', pages: null, error: null };
    }

    if (isTextual) {
      return { text: clean(bytes.toString('utf8')), status: 'text_layer', pages: null, error: null };
    }

    if (isImage) {
      const backend = ocrBackend();
      if (backend === 'vision') return viaVisionApi(bytes, mime || 'image/png');
      if (backend === 'mineru') return viaMineru(bytes, name, mime || 'image/png');
      return {
        text: '', status: 'skipped', pages: null,
        error: 'Images need OCR to be searchable. Configure an OCR backend to enable it.',
      };
    }

    if (ext === 'doc') {
      return { text: '', status: 'skipped', pages: null, error: 'Legacy .doc is not readable. Save it as .docx or PDF.' };
    }

    return { text: '', status: 'skipped', pages: null, error: `No text extractor for .${ext || 'this file type'}.` };
  } catch (e: any) {
    // Encrypted PDFs land here, which is the common case worth naming.
    const msg = String(e?.message || 'Extraction failed');
    return {
      text: '', status: 'failed', pages: null,
      error: /password|encrypt/i.test(msg) ? 'The file is password-protected, so its text cannot be read.' : msg,
    };
  }
}
