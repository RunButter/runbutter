'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useDropzone } from 'react-dropzone';
import {
  FolderOpen, Search, Loader2, Upload, Trash2, ExternalLink, RefreshCw,
  FileText, FileSpreadsheet, Image as ImageIcon, File as FileIcon, X, AlertCircle,
} from 'lucide-react';
import { getWorkspace, type WorkspaceContext } from '@/lib/crm/data';
import { useDialog } from '@/components/ui/Dialog';
import EmptyState from '@/components/ui/EmptyState';
import Badge, { type Tone } from '@/components/ui/Badge';
import {
  loadFiles, searchFiles, uploadFile, extractFile, fileUrl, deleteFile,
  splitSnippet, formatBytes, STATUS_LABEL,
  type FileRow, type FileHit, type ExtractStatus,
} from '@/lib/files/client';

/**
 * Company files — storage that becomes DATA.
 *
 * The screen is built around the search box rather than a folder tree, because
 * the point of keeping files here instead of in Dropbox is that their CONTENTS
 * are in the same Postgres as the ledger: "which contract mentions
 * auto-renewal" is a query, not a morning of opening PDFs.
 */

const STATUS_TONE: Record<ExtractStatus, Tone> = {
  pending: 'neutral', text_layer: 'success', ocr: 'success',
  vision: 'success', failed: 'danger', skipped: 'warning',
};

function iconFor(name: string, mime: string | null) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if ((mime || '').startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff'].includes(ext)) return ImageIcon;
  if (['csv', 'tsv', 'xlsx', 'xls'].includes(ext)) return FileSpreadsheet;
  if (['pdf', 'docx', 'doc', 'txt', 'md'].includes(ext)) return FileText;
  return FileIcon;
}

export default function FilesPage() {
  const { confirm: confirmDialog, notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<WorkspaceContext | null>(null);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FileHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Per-file spinner keys, so one row re-indexing doesn't freeze the others.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState<string[]>([]);

  const mark = (id: string, on: boolean) =>
    setBusy((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });

  const load = useCallback(async () => {
    if (!privy) { setLoading(false); return; }
    const w = await getWorkspace(privy);
    setWs(w);
    if (w) {
      const { files, error: err } = await loadFiles(privy, w.id);
      setRows(files);
      setError(err || '');
    }
    setLoading(false);
  }, [privy]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  // Debounced search. Clearing the box drops back to the full list rather than
  // showing zero results for an empty query.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (!q || !privy || !ws) { setHits(null); setSearching(false); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const { hits: found, error: err } = await searchFiles(privy, ws.id, q);
      setHits(found);
      if (err) setError(err);
      setSearching(false);
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query, privy, ws]);

  const onDrop = useCallback(async (accepted: File[]) => {
    if (!privy || !ws || accepted.length === 0) return;
    setError('');
    setUploading(accepted.map((f) => f.name));

    for (const file of accepted) {
      const { id, error: err } = await uploadFile(file, privy, ws.id);
      if (err || !id) { setError(err || `${file.name} could not be uploaded.`); continue; }
      // Show the row at once, then index it. Waiting for extraction before the
      // file appears would make a large upload look like nothing happened.
      setUploading((prev) => prev.filter((n) => n !== file.name));
      await load();
      mark(id, true);
      await extractFile(id, privy);
      mark(id, false);
      await load();
    }
    setUploading([]);
  }, [privy, ws, load]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({ onDrop, noClick: true });

  const reindex = async (row: FileRow) => {
    if (!privy) return;
    mark(row.id, true);
    const { error: err, status, note } = await extractFile(row.id, privy);
    mark(row.id, false);
    await load();
    if (err) notify({ title: 'Could not index this file', body: err });
    else if (status && status !== 'text_layer' && status !== 'ocr' && note) notify({ title: row.name, body: note });
  };

  const open_ = async (id: string) => {
    if (!privy) return;
    mark(id, true);
    const { url, error: err } = await fileUrl(id, privy);
    mark(id, false);
    if (err || !url) { notify({ title: 'Could not open the file', body: err || 'No link was returned.' }); return; }
    window.open(url, '_blank', 'noopener');
  };

  const remove = async (row: FileRow) => {
    if (!privy) return;
    if (!await confirmDialog({
      title: `Delete ${row.name}?`,
      body: 'The file and its extracted text are removed permanently.',
      danger: true, confirmLabel: 'Delete',
    })) return;
    mark(row.id, true);
    const { error: err } = await deleteFile(row.id, privy);
    mark(row.id, false);
    if (err) { notify({ title: 'Could not delete', body: err }); return; }
    setQuery('');
    load();
  };

  const indexed = useMemo(() => rows.filter((r) => r.has_content).length, [rows]);

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-6 border-b border-subtle">
        <h1 className="text-md font-semibold text-primary">Files</h1>
        <span className="text-2xs font-semibold text-tertiary bg-surface-hover rounded-md px-1.5 py-0.5 tabular-nums">{rows.length}</span>
        {privy && ws && (
          <button
            onClick={open}
            className="ml-auto h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" /> Upload
          </button>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6 2xl:p-8" {...getRootProps()}>
        <input {...getInputProps()} />
        <div className="max-w-5xl space-y-4">
          <p className="text-sm text-secondary -mt-1">
            Contracts, invoices and CVs — stored privately and searched by what&apos;s <em>inside</em> them,
            not just by filename. {indexed > 0 && <span className="text-tertiary">{indexed} of {rows.length} indexed.</span>}
          </p>

          {/* Search leads: it is the reason this screen exists. */}
          <div className="relative">
            <Search className="w-4 h-4 text-tertiary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search inside every file — try auto-renewal, or &quot;notice period&quot;"
              className="w-full h-9 pl-9 pr-9 rounded-lg bg-surface text-sm text-primary placeholder:text-tertiary ring-1 ring-subtle shadow-sm focus:outline-none focus:ring-accent"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-tertiary hover:text-secondary"
                aria-label="Clear search"
              >
                {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-danger/10 text-danger px-3 py-2 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-px" /> <span>{error}</span>
            </div>
          )}

          {isDragActive && (
            <div className="rounded-xl border-2 border-dashed border-accent bg-accent/5 px-4 py-8 text-center text-sm font-medium text-accent">
              Drop to upload
            </div>
          )}

          {uploading.length > 0 && (
            <div className="card-surface divide-y divide-subtle">
              {uploading.map((name) => (
                <div key={name} className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-secondary">
                  <Loader2 className="w-4 h-4 animate-spin text-tertiary shrink-0" />
                  <span className="truncate">Uploading {name}…</span>
                </div>
              ))}
            </div>
          )}

          {loading ? (
            <div className="h-32 flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : !privy ? (
            <EmptyState icon={FolderOpen} title="Sign in to see your files" />
          ) : hits ? (
            hits.length === 0 && !searching ? (
              <EmptyState
                icon={Search}
                title={`Nothing matches “${query.trim()}”`}
                description="Only files that were indexed can be searched by content — scans need OCR."
              />
            ) : (
              <div className="card-surface divide-y divide-subtle">
                {hits.map((hit) => (
                  <button
                    key={hit.id}
                    onClick={() => open_(hit.id)}
                    className="w-full text-left px-3 py-3 hover:bg-surface-hover transition-colors first:rounded-t-xl last:rounded-b-xl"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-tertiary shrink-0" />
                      <span className="text-sm font-medium text-primary truncate">{hit.name}</span>
                      <ExternalLink className="w-3 h-3 text-tertiary shrink-0" />
                    </div>
                    {hit.snippet && (
                      <p className="mt-1 pl-6 text-xs text-secondary leading-relaxed">
                        {splitSnippet(hit.snippet).map((part, i) =>
                          part.match
                            ? <mark key={i} className="bg-accent/15 text-primary rounded px-0.5">{part.text}</mark>
                            : <span key={i}>{part.text}</span>,
                        )}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No files yet"
              description="Drop a contract, invoice or CV here. PDFs and Word documents are read and made searchable automatically."
              action={
                <button onClick={open} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm">
                  <Upload className="w-3.5 h-3.5" /> Choose a file
                </button>
              }
            />
          ) : (
            <div className="card-surface divide-y divide-subtle">
              {rows.map((row) => {
                const Icon = iconFor(row.name, row.mime_type);
                const spinning = busy.has(row.id);
                return (
                  <div key={row.id} className="group flex items-center gap-3 px-3 py-2.5">
                    <Icon className="w-4 h-4 text-tertiary shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-primary truncate">{row.name}</p>
                      <p className="text-2xs text-tertiary tabular-nums truncate">
                        {formatBytes(row.size_bytes)}
                        {row.page_count ? ` · ${row.page_count} page${row.page_count === 1 ? '' : 's'}` : ''}
                        {' · '}{new Date(row.created_at).toLocaleDateString('en-GB')}
                        {row.linked_object ? ` · ${row.linked_object}` : ''}
                      </p>
                    </div>

                    <Badge tone={STATUS_TONE[row.extract_status]} className="shrink-0 normal-case">
                      {STATUS_LABEL[row.extract_status]}
                    </Badge>

                    {/* Actions stay visible on touch and on keyboard focus — a
                        hover-only row is unusable on a phone. */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      {spinning ? (
                        <Loader2 className="w-4 h-4 animate-spin text-tertiary mx-1.5" />
                      ) : (
                        <>
                          <button onClick={() => open_(row.id)} title="Open" aria-label={`Open ${row.name}`}
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-tertiary hover:text-primary hover:bg-surface-hover">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => reindex(row)} title="Re-index" aria-label={`Re-index ${row.name}`}
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-tertiary hover:text-primary hover:bg-surface-hover">
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => remove(row)} title="Delete" aria-label={`Delete ${row.name}`}
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-tertiary hover:text-danger hover:bg-surface-hover">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Extraction credits. MinerU's licence requires this disclosure to be
              in the product interface when it is used for OCR — see
              docs/file-extraction.md. */}
          {rows.length > 0 && !hits && (
            <p className="text-2xs text-tertiary leading-relaxed">
              Text is extracted locally with <span className="text-secondary">pdf-parse</span> and{' '}
              <span className="text-secondary">mammoth</span>, and indexed with Postgres full-text search — no
              per-page fees and nothing sent to a third party. Scans and photos need OCR, provided by a
              self-hosted <a href="https://github.com/opendatalab/MinerU" target="_blank" rel="noreferrer"
                className="text-secondary underline decoration-subtle hover:text-primary">MinerU</a>{' '}
              instance when one is configured.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
