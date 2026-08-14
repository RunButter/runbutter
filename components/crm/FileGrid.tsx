'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText, ImageIcon, FileSpreadsheet, FileType, File as FileIcon, Loader2 } from 'lucide-react';
import { fileUrl, type FileRow } from '@/lib/files/client';

/**
 * Files as things you can see, rather than a list of names.
 *
 * The list view told you a file existed and nothing about what was in it, so
 * finding the right contract meant opening four. A grid with real thumbnails
 * answers "which one is it" at a glance, which is the entire job of this screen.
 *
 * ── SIGNED URLS ARE MINTED LAZILY, AND THAT IS NOT AN OPTIMISATION ──────────
 * The bucket is private and every read is a short-lived signed URL (0065). A
 * grid of sixty files would otherwise mint sixty capabilities on mount — most
 * of them for tiles nobody scrolls to — and each one is a live read token for
 * somebody's contract. An IntersectionObserver means a URL exists only for what
 * is actually on screen, and they expire on their own.
 *
 * ── ONLY IMAGES GET A REAL THUMBNAIL ────────────────────────────────────────
 * A PDF thumbnail means downloading the file and rendering page one, per tile.
 * That is seconds of main-thread work and megabytes of transfer for a preview
 * somebody may not want, so PDFs get a typed placeholder here and a real render
 * when opened. The honest version of "visual" is not "render everything".
 */

const EXT = (name: string) => (name.split('.').pop() || '').toLowerCase();

const isImage = (row: FileRow) =>
  (row.mime_type || '').startsWith('image/') ||
  ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(EXT(row.name));

function iconFor(row: FileRow) {
  const e = EXT(row.name);
  if (isImage(row)) return ImageIcon;
  if (e === 'pdf') return FileType;
  if (['xlsx', 'xls', 'csv', 'numbers'].includes(e)) return FileSpreadsheet;
  if (['doc', 'docx', 'txt', 'md', 'rtf', 'pages'].includes(e)) return FileText;
  return FileIcon;
}

/** A tint per family, so the grid reads as sorted even before you read a name. */
function toneFor(row: FileRow): string {
  const e = EXT(row.name);
  if (isImage(row)) return 'bg-accent/10 text-accent';
  if (e === 'pdf') return 'bg-danger/10 text-danger';
  if (['xlsx', 'xls', 'csv'].includes(e)) return 'bg-success/10 text-success';
  return 'bg-surface-sunken text-tertiary';
}

function Thumb({ row, privy }: { row: FileRow; privy: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const Icon = iconFor(row);

  useEffect(() => {
    if (!isImage(row) || !privy || url || failed) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      fileUrl(row.id, privy).then((r) => (r.url ? setUrl(r.url) : setFailed(true)));
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [row, privy, url, failed]);

  return (
    <div ref={ref} className={`aspect-[4/3] rounded-lg overflow-hidden flex items-center justify-center ${url ? 'bg-surface-sunken' : toneFor(row)}`}>
      {url
        ? <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" onError={() => { setUrl(null); setFailed(true); }} />
        : <Icon className="w-7 h-7 opacity-70" />}
    </div>
  );
}

export default function FileGrid({ rows, privy, busy, onOpen, actions }: {
  rows: FileRow[];
  privy: string | null;
  busy: Set<string>;
  onOpen: (row: FileRow) => void;
  /** Row actions (download, delete…) rendered into each tile's footer. */
  actions?: (row: FileRow) => React.ReactNode;
}) {
  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
      {rows.map((row) => (
        <div key={row.id}
          className="group card-surface p-2 flex flex-col gap-2 hover:ring-strong transition-shadow">
          <button onClick={() => onOpen(row)} className="text-left outline-none" aria-label={`Open ${row.name}`}>
            <Thumb row={row} privy={privy} />
          </button>
          <div className="min-w-0 px-0.5">
            <p className="text-xs font-medium text-primary truncate" title={row.name}>{row.name}</p>
            <p className="text-2xs text-tertiary tabular-nums truncate">
              {new Date(row.created_at).toLocaleDateString('en-GB')}
              {row.page_count ? ` · ${row.page_count}p` : ''}
            </p>
            {/* The reason lives with the file, exactly as it does in the list —
                "this is a scan" is the thing that explains an empty search. */}
            {row.extract_error && (
              <p className="text-2xs text-warning line-clamp-2 mt-0.5">{row.extract_error}</p>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-0.5 px-0.5 pb-0.5">
              {busy.has(row.id) && <Loader2 className="w-3.5 h-3.5 animate-spin text-tertiary" />}
              {actions(row)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
