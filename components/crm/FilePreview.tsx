'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Download, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { fileUrl, type FileRow } from '@/lib/files/client';

/**
 * Look at a file without leaving the screen.
 *
 * The list gave you a name and a download button, so "is this the right
 * contract" cost a round trip through the OS file manager. This renders the
 * three families that matter — images, PDFs and text — and is honest about the
 * rest rather than pretending to preview a .docx it cannot read.
 *
 * ── THE PDF IS RENDERED HERE, NOT LINKED ────────────────────────────────────
 * lib/pdf/convert.ts already turns pages into images in the browser, so a
 * preview needs no server, no conversion service and no iframe pointed at a
 * signed URL. It also means the pages are pixels we produced rather than a
 * plugin's chrome, which is what makes it look like part of the app.
 *
 * ONE PAGE AT A TIME. Rendering forty pages of a contract to canvas on open is
 * seconds of blocked main thread for a look at page one; pages are rendered as
 * they are asked for and kept.
 *
 * The signed URL is minted on open and never stored — it is a live read
 * capability for a private file, and it expires on its own.
 */

const EXT = (name: string) => (name.split('.').pop() || '').toLowerCase();
const isImage = (row: FileRow) =>
  (row.mime_type || '').startsWith('image/') ||
  ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(EXT(row.name));
const isText = (row: FileRow) =>
  (row.mime_type || '').startsWith('text/') || ['txt', 'md', 'csv', 'json', 'log'].includes(EXT(row.name));
const isPdf = (row: FileRow) => EXT(row.name) === 'pdf' || row.mime_type === 'application/pdf';

export default function FilePreview({ row, privy, onClose }: {
  row: FileRow; privy: string | null; onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [pages, setPages] = useState<Record<number, string>>({});
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(row.page_count || 0);
  const [loading, setLoading] = useState(true);
  // The decoded PDF, kept so paging does not re-download the file. A ref rather
  // than state: it must not trigger a render, and it must die with this modal —
  // a module-level cache would hold another file's bytes after close.
  const pdfBytes = useRef<ArrayBuffer | null>(null);

  // Escape closes, like every other overlay in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!privy) { setError('Sign in to open this file.'); setLoading(false); return; }
    let cancelled = false;
    let objectUrls: string[] = [];

    (async () => {
      const r = await fileUrl(row.id, privy);
      if (cancelled) return;
      if (!r.url) { setError(r.error || 'Could not open this file.'); setLoading(false); return; }
      setUrl(r.url);

      try {
        if (isText(row)) {
          const res = await fetch(r.url);
          const body = await res.text();
          if (!cancelled) setText(body.slice(0, 200_000));
        } else if (isPdf(row)) {
          const bytes = await (await fetch(r.url)).arrayBuffer();
          if (cancelled) return;
          const { pagesToImages } = await import('@/lib/pdf/convert');
          const [first] = await pagesToImages(bytes, [0], { dpi: 110, format: 'png' });
          if (cancelled || !first) return;
          const blobUrl = URL.createObjectURL(new Blob([first.bytes as any], { type: 'image/png' }));
          objectUrls.push(blobUrl);
          setPages({ 0: blobUrl });
          pdfBytes.current = bytes;
          if (!total) setTotal(row.page_count || 1);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'This file could not be previewed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; pdfBytes.current = null; objectUrls.forEach(URL.revokeObjectURL); };
  }, [row, privy]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function goto(n: number) {
    if (n < 0 || (total && n >= total) || pages[n]) { if (pages[n]) setPage(n); return; }
    setPage(n);
    const bytes = pdfBytes.current;
    if (!bytes) return;
    const { pagesToImages } = await import('@/lib/pdf/convert');
    const [p] = await pagesToImages(bytes, [n], { dpi: 110, format: 'png' });
    if (!p) return;
    setPages((prev) => ({ ...prev, [n]: URL.createObjectURL(new Blob([p.bytes as any], { type: 'image/png' })) }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-full flex flex-col bg-surface rounded-2xl ring-1 ring-subtle shadow-lg"
        onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 px-4 flex items-center gap-2 border-b border-subtle">
          <p className="text-sm font-medium text-primary truncate">{row.name}</p>
          {url && (
            <a href={url} download={row.name}
              className="ml-auto h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-2xs font-semibold text-secondary hover:text-primary hover:bg-surface-sunken">
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          )}
          <button onClick={onClose} aria-label="Close"
            className={`h-7 w-7 inline-flex items-center justify-center rounded-md text-tertiary hover:text-primary ${url ? '' : 'ml-auto'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4 bg-surface-sunken/40">
          {loading && <div className="h-64 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-tertiary" /></div>}
          {!loading && error && <p className="text-sm text-danger text-center py-10">{error}</p>}

          {!loading && !error && isImage(row) && url && (
            <img src={url} alt={row.name} className="max-w-full mx-auto rounded-lg" />
          )}

          {!loading && !error && isText(row) && (
            <pre className="text-2xs text-primary whitespace-pre-wrap font-mono leading-relaxed">{text}</pre>
          )}

          {!loading && !error && isPdf(row) && (
            pages[page]
              ? <img src={pages[page]} alt={`Page ${page + 1}`} className="max-w-full mx-auto rounded-lg shadow-sm" />
              : <div className="h-64 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-tertiary" /></div>
          )}

          {/* Saying so beats an empty box. A .docx has no browser renderer that
              does not involve uploading it somewhere, which this product does
              not do with contracts. */}
          {!loading && !error && !isImage(row) && !isText(row) && !isPdf(row) && (
            <p className="text-sm text-secondary text-center py-10">
              No preview for this file type — download it to open.
            </p>
          )}
        </div>

        {isPdf(row) && total > 1 && (
          <div className="h-11 shrink-0 px-4 flex items-center justify-center gap-3 border-t border-subtle">
            <button onClick={() => goto(page - 1)} disabled={page === 0} aria-label="Previous page"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-secondary hover:bg-surface-sunken disabled:opacity-30">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-2xs text-tertiary tabular-nums">Page {page + 1} of {total}</span>
            <button onClick={() => goto(page + 1)} disabled={page + 1 >= total} aria-label="Next page"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-secondary hover:bg-surface-sunken disabled:opacity-30">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
