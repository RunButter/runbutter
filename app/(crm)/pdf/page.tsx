'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCenter, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import {
  FileText, Loader2, Download, ShieldCheck, RotateCw, Trash2, Stamp,
  Image as ImageIcon, Scissors, CheckSquare, Square, Undo2, X,
} from 'lucide-react';
import {
  loadPdf, composePdf, watermarkPdf, imagesToPdf, downloadBytes,
  type LoadedPdf, type ComposedPage,
} from '@/lib/pdf/toolkit';
import { openForRender, renderThumbnail } from '@/lib/pdf/render';
import PageTile, { type EditorPage } from '@/components/pdf/PageTile';
import EmptyState from '@/components/ui/EmptyState';

/**
 * Visual PDF editor.
 *
 * Everything is one page grid rather than a menu of separate operations:
 * merging is dropping a second file, splitting is selecting pages, deleting is
 * removing tiles, reordering is dragging. The old range syntax ("1-3, 5, 9-")
 * asked people to describe an edit they could simply have made.
 *
 * Still entirely in the browser — see lib/pdf/toolkit.ts.
 */
export default function PdfToolsPage() {
  const [files, setFiles] = useState<LoadedPdf[]>([]);
  const [pages, setPages] = useState<EditorPage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [wmText, setWmText] = useState('');
  const lastClicked = useRef<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, {
    // Without a small threshold every click registers as a drag and selecting
    // a page becomes impossible.
    activationConstraint: { distance: 4 },
  }));

  const multiFile = files.length > 1;

  const addFiles = useCallback(async (accepted: File[]) => {
    setError('');
    for (const file of accepted) {
      let loaded: LoadedPdf;
      try {
        loaded = await loadPdf(file);
      } catch {
        setError(`${file.name} could not be opened — it may be corrupt or password-protected.`);
        continue;
      }

      // Append placeholders immediately so the grid reacts at once, then fill
      // thumbnails in as they render. A 200-page file would otherwise look
      // frozen for several seconds.
      let fileIndex = 0;
      setFiles((prev) => { fileIndex = prev.length; return [...prev, loaded]; });
      const placeholders: EditorPage[] = Array.from({ length: loaded.pageCount }, (_, i) => ({
        key: `${loaded.name}-${fileIndex}-${i}-${Math.random().toString(36).slice(2, 8)}`,
        fileIndex, pageIndex: i, rotation: 0, thumb: null, sourceName: loaded.name,
      }));
      setPages((prev) => [...prev, ...placeholders]);

      try {
        const doc = await openForRender(loaded.bytes);
        for (let i = 0; i < loaded.pageCount; i++) {
          const { url } = await renderThumbnail(doc, i + 1);
          setPages((prev) => prev.map((p) => (p.key === placeholders[i].key ? { ...p, thumb: url } : p)));
        }
      } catch {
        setError(`Previews could not be generated for ${file.name}. You can still reorder and export it.`);
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: addFiles,
    accept: { 'application/pdf': ['.pdf'] },
    noClick: true,     // the grid is the drop target; a stray click must not open a picker
  });

  // Shift-click selects a range, matching every file manager people already use.
  const toggle = (key: string, shiftKey: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClicked.current) {
        const a = pages.findIndex((p) => p.key === lastClicked.current);
        const b = pages.findIndex((p) => p.key === key);
        if (a >= 0 && b >= 0) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(pages[i].key);
          return next;
        }
      }
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    lastClicked.current = key;
  };

  const targetKeys = useCallback(
    (key?: string) => (key ? [key] : selected.size ? [...selected] : pages.map((p) => p.key)),
    [selected, pages],
  );

  const rotate = (key?: string) => {
    const keys = new Set(targetKeys(key));
    setPages((prev) => prev.map((p) => (keys.has(p.key) ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
  };

  const remove = (key?: string) => {
    const keys = new Set(targetKeys(key));
    setPages((prev) => prev.filter((p) => !keys.has(p.key)));
    setSelected((prev) => { const n = new Set(prev); keys.forEach((k) => n.delete(k)); return n; });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setPages((prev) => {
      const from = prev.findIndex((p) => p.key === active.id);
      const to = prev.findIndex((p) => p.key === over.id);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
  };

  const toComposed = (list: EditorPage[]): ComposedPage[] =>
    list.map((p) => ({ fileIndex: p.fileIndex, pageIndex: p.pageIndex, rotation: p.rotation }));

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError('');
    try { await fn(); } catch (e: any) { setError(e?.message || 'Something went wrong.'); }
    setBusy('');
  };

  // Export uses the selection when there is one, the whole document otherwise —
  // so "extract these pages" needs no separate mode.
  const exportPages = () => run('export', async () => {
    const list = selected.size ? pages.filter((p) => selected.has(p.key)) : pages;
    downloadBytes(await composePdf(files, toComposed(list)), selected.size ? 'selected-pages.pdf' : 'document.pdf');
  });

  const splitEach = () => run('split', async () => {
    const list = selected.size ? pages.filter((p) => selected.has(p.key)) : pages;
    const width = String(list.length).length;
    for (let i = 0; i < list.length; i++) {
      const bytes = await composePdf(files, toComposed([list[i]]));
      // Staggered: browsers throttle a burst of programmatic downloads.
      setTimeout(() => downloadBytes(bytes, `page-${String(i + 1).padStart(width, '0')}.pdf`), i * 300);
    }
  });

  const applyWatermark = () => run('watermark', async () => {
    const composed = await composePdf(files, toComposed(pages));
    const stamped = await watermarkPdf(
      { name: 'document.pdf', bytes: composed.buffer.slice(composed.byteOffset, composed.byteOffset + composed.byteLength) as ArrayBuffer, pageCount: pages.length },
      { text: wmText },
    );
    downloadBytes(stamped, 'watermarked.pdf');
  });

  const addImages = async (accepted: File[]) => run('images', async () => {
    downloadBytes(await imagesToPdf(accepted), 'images.pdf');
  });

  const reset = () => { setFiles([]); setPages([]); setSelected(new Set()); setError(''); lastClicked.current = null; };

  const allSelected = pages.length > 0 && selected.size === pages.length;
  const activePage = useMemo(() => pages.find((p) => p.key === dragging) ?? null, [pages, dragging]);
  const scope = selected.size ? `${selected.size} selected` : `all ${pages.length}`;

  return (
    <>
      <header className="h-16 shrink-0 flex items-center gap-3 px-6 border-b border-subtle">
        <h1 className="text-md font-medium text-primary">PDF editor</h1>
        <span className="inline-flex items-center gap-1.5 text-2xs font-semibold text-success bg-success/10 rounded-md px-2 py-0.5">
          <ShieldCheck className="w-3 h-3" /> Runs in your browser
        </span>
        {pages.length > 0 && (
          <span className="text-2xs text-tertiary tabular-nums">{pages.length} pages · {files.length} file{files.length === 1 ? '' : 's'}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={open} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-medium text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
            Add PDFs
          </button>
          {pages.length > 0 && (
            <button onClick={exportPages} disabled={!!busy}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-50">
              {busy === 'export' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Save PDF
            </button>
          )}
        </div>
      </header>

      <div {...getRootProps()} className="flex-1 overflow-y-auto p-4 2xl:p-6 outline-none">
        <input {...getInputProps()} />

        {pages.length === 0 ? (
          <div className={`max-w-xl mx-auto mt-10 rounded-xl border border-dashed p-10 text-center transition-colors ${
            isDragActive ? 'border-accent bg-accent/5' : 'border-subtle'
          }`}>
            <EmptyState icon={FileText}
              title={isDragActive ? 'Drop them here' : 'Drop PDFs to start'}
              description="Pages appear as thumbnails. Drag to reorder, click to select, then save. Nothing is uploaded — the file is opened and rewritten in this tab."
              action={<button onClick={open} className="h-8 px-3 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">Choose files</button>} />
          </div>
        ) : (
          <div className="max-w-6xl mx-auto space-y-3">
            {/* Compact inline controls — flat by the elevation rule (no ring,
                no shadow); only the page cards below are raised. */}
            <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-canvas/90 backdrop-blur-sm flex flex-wrap items-center gap-1">
              <button onClick={() => setSelected(allSelected ? new Set() : new Set(pages.map((p) => p.key)))}
                className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-secondary hover:bg-surface-hover">
                {allSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                {allSelected ? 'Deselect' : 'Select all'}
              </button>

              <span className="w-px h-4 bg-subtle mx-1" aria-hidden />

              <button onClick={() => rotate()} title={`Rotate ${scope}`}
                className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-secondary hover:bg-surface-hover">
                <RotateCw className="w-3.5 h-3.5" /> Rotate
              </button>
              <button onClick={() => remove()} title={`Delete ${scope}`}
                className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-secondary hover:text-danger hover:bg-danger/10">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
              <button onClick={splitEach} disabled={!!busy} title={`One file per page (${scope})`}
                className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-secondary hover:bg-surface-hover disabled:opacity-40">
                {busy === 'split' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />} Split
              </button>

              <span className="w-px h-4 bg-subtle mx-1" aria-hidden />

              <input value={wmText} onChange={(e) => setWmText(e.target.value)} placeholder="Watermark…"
                aria-label="Watermark text"
                className="h-7 w-32 px-2 text-xs rounded-md bg-surface-hover text-primary placeholder:text-tertiary outline-none focus:ring-2 focus:ring-accent/30" />
              <button onClick={applyWatermark} disabled={!!busy || !wmText.trim()}
                className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-secondary hover:bg-surface-hover disabled:opacity-40">
                {busy === 'watermark' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Stamp className="w-3.5 h-3.5" />} Stamp
              </button>

              {/* Scope is stated once, here, instead of repeated on every button. */}
              <span className="ml-auto flex items-center gap-1">
                <span className="text-2xs text-tertiary tabular-nums px-1">
                  {selected.size ? `${selected.size} selected` : `${pages.length} pages`}
                </span>
                <button onClick={reset} className="h-7 px-2 inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-tertiary hover:bg-surface-hover">
                  <Undo2 className="w-3.5 h-3.5" /> Clear
                </button>
              </span>
            </div>

            {error && (
              <p className="flex items-start gap-1.5 text-xs text-danger">
                <X className="w-3.5 h-3.5 shrink-0 mt-px" /><span>{error}</span>
              </p>
            )}

            <DndContext sensors={sensors} collisionDetection={closestCenter}
              onDragStart={(e: DragStartEvent) => setDragging(String(e.active.id))} onDragEnd={onDragEnd}>
              <SortableContext items={pages.map((p) => p.key)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2.5">
                  {pages.map((p, i) => (
                    <PageTile key={p.key} page={p} index={i} selected={selected.has(p.key)} multiFile={multiFile}
                      onToggle={toggle} onRotate={(k) => rotate(k)} onDelete={(k) => remove(k)} />
                  ))}
                </div>
              </SortableContext>
              <DragOverlay>
                {activePage?.thumb && (
                  <img src={activePage.thumb} alt="" style={{ transform: `rotate(${activePage.rotation}deg)` }}
                    className="w-28 rounded-lg ring-2 ring-accent shadow-popover" />
                )}
              </DragOverlay>
            </DndContext>

            <div className="pt-3 border-t border-subtle">
              <label className="inline-flex items-center gap-1.5 text-xs text-tertiary hover:text-secondary cursor-pointer">
                <ImageIcon className="w-3.5 h-3.5" /> Convert JPEGs or PNGs to a PDF
                <input type="file" accept="image/jpeg,image/png" multiple className="hidden"
                  onChange={(e) => { const f = Array.from(e.target.files || []); if (f.length) addImages(f); }} />
              </label>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
