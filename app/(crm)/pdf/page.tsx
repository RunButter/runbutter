'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  FileText, Loader2, Trash2, ArrowUp, ArrowDown, Download, ShieldCheck,
  Combine, Scissors, Copy, RotateCw, Stamp, Image as ImageIcon, X,
} from 'lucide-react';
import {
  loadPdf, mergePdfs, extractPages, splitToPages, rotatePages, deletePages,
  watermarkPdf, imagesToPdf, parsePageRange, downloadBytes, suffixName,
  type LoadedPdf,
} from '@/lib/pdf/toolkit';
import EmptyState from '@/components/ui/EmptyState';

type Tool = 'merge' | 'split' | 'extract' | 'delete' | 'rotate' | 'watermark' | 'images';

const TOOLS: { id: Tool; label: string; icon: any; hint: string; images?: boolean }[] = [
  { id: 'merge',     label: 'Merge',        icon: Combine,   hint: 'Join every PDF below into one, in the order shown.' },
  { id: 'split',     label: 'Split',        icon: Scissors,  hint: 'Burst the first PDF into one file per page.' },
  { id: 'extract',   label: 'Extract',      icon: Copy,      hint: 'Keep only the pages you list — the rest are dropped.' },
  { id: 'delete',    label: 'Delete pages', icon: Trash2,    hint: 'Remove the pages you list and keep everything else.' },
  { id: 'rotate',    label: 'Rotate',       icon: RotateCw,  hint: 'Turn the listed pages. Applied on top of any existing rotation.' },
  { id: 'watermark', label: 'Watermark',    icon: Stamp,     hint: 'Stamp text diagonally across every page.' },
  { id: 'images',    label: 'Images → PDF', icon: ImageIcon, hint: 'Turn JPEGs and PNGs into a PDF, one image per page.', images: true },
];

interface Result { name: string; bytes: Uint8Array }

export default function PdfToolsPage() {
  const [tool, setTool] = useState<Tool>('merge');
  const [files, setFiles] = useState<LoadedPdf[]>([]);
  const [images, setImages] = useState<File[]>([]);
  const [range, setRange] = useState('');
  const [turn, setTurn] = useState<90 | 180 | 270>(90);
  const [wmText, setWmText] = useState('CONFIDENTIAL');
  const [wmOpacity, setWmOpacity] = useState(12);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Result[]>([]);

  const def = TOOLS.find((t) => t.id === tool)!;
  const wantsImages = !!def.images;
  const target = files[0] ?? null;      // single-document tools act on the first file
  const usesRange = tool === 'extract' || tool === 'delete' || tool === 'rotate';
  const matched = usesRange && target ? parsePageRange(range, target.pageCount).length : 0;

  const onDrop = useCallback(async (accepted: File[]) => {
    setError(''); setResults([]);
    if (wantsImages) {
      setImages((prev) => [...prev, ...accepted]);
      return;
    }
    const loaded: LoadedPdf[] = [];
    for (const f of accepted) {
      try {
        loaded.push(await loadPdf(f));
      } catch {
        setError(`${f.name} could not be opened — it may be corrupt or password-protected.`);
      }
    }
    setFiles((prev) => [...prev, ...loaded]);
  }, [wantsImages]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: wantsImages
      ? { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'] }
      : { 'application/pdf': ['.pdf'] },
  });

  const move = (i: number, by: number) => setFiles((prev) => {
    const next = [...prev];
    const j = i + by;
    if (j < 0 || j >= next.length) return prev;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const switchTool = (id: Tool) => {
    setTool(id); setError(''); setResults([]);
  };

  const run = async () => {
    setBusy(true); setError(''); setResults([]);
    try {
      if (tool === 'images') {
        setResults([{ name: 'images.pdf', bytes: await imagesToPdf(images) }]);
      } else if (tool === 'merge') {
        if (files.length < 2) throw new Error('Add at least two PDFs to merge.');
        setResults([{ name: 'merged.pdf', bytes: await mergePdfs(files) }]);
      } else {
        if (!target) throw new Error('Add a PDF first.');
        const idx = usesRange ? parsePageRange(range, target.pageCount) : [];
        if (tool === 'split') setResults(await splitToPages(target));
        else if (tool === 'extract') setResults([{ name: suffixName(target.name, 'pages'), bytes: await extractPages(target, idx) }]);
        else if (tool === 'delete') setResults([{ name: suffixName(target.name, 'trimmed'), bytes: await deletePages(target, idx) }]);
        else if (tool === 'rotate') setResults([{ name: suffixName(target.name, 'rotated'), bytes: await rotatePages(target, idx, turn) }]);
        else if (tool === 'watermark') setResults([{ name: suffixName(target.name, 'watermarked'), bytes: await watermarkPdf(target, { text: wmText, opacity: wmOpacity / 100 }) }]);
      }
    } catch (e: any) {
      setError(e?.message || 'Something went wrong processing that file.');
    }
    setBusy(false);
  };

  // Browsers throttle a burst of programmatic downloads, so stagger them.
  const downloadAll = () => results.forEach((r, i) => setTimeout(() => downloadBytes(r.bytes, r.name), i * 300));

  const hasInput = wantsImages ? images.length > 0 : files.length > 0;

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-subtle">
        <h1 className="text-sm font-semibold text-primary flex items-center gap-2">
          <FileText className="w-4 h-4 text-accent" /> PDF tools
        </h1>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-success bg-success/10 rounded-md px-2 py-0.5">
          <ShieldCheck className="w-3 h-3" /> Runs in your browser
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <p className="text-[12px] text-tertiary">
            Files are opened and rewritten locally in this tab — nothing is uploaded, so contracts,
            payroll and statements never touch a server.
          </p>

          {/* Tool picker — compact inline controls, so deliberately flat. */}
          <div className="flex flex-wrap gap-1.5">
            {TOOLS.map((t) => (
              <button key={t.id} onClick={() => switchTool(t.id)}
                className={`h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium transition-colors ${
                  tool === t.id ? 'bg-inverse text-inverse-fg' : 'text-secondary hover:bg-surface-hover'
                }`}>
                <t.icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>

          <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-4 space-y-4">
            <p className="text-[12px] text-secondary">{def.hint}</p>

            <div {...getRootProps()}
              className={`rounded-lg border border-dashed p-6 text-center cursor-pointer transition-colors ${
                isDragActive ? 'border-accent bg-accent/5' : 'border-subtle hover:bg-surface-sunken'
              }`}>
              <input {...getInputProps()} />
              <p className="text-[13px] font-medium text-secondary">
                {isDragActive ? 'Drop them here' : wantsImages ? 'Drop JPEG or PNG files, or click to pick' : 'Drop PDFs here, or click to pick'}
              </p>
            </div>

            {/* Loaded input */}
            {wantsImages ? images.length > 0 && (
              <ul className="divide-y divide-subtle">
                {images.map((img, i) => (
                  <li key={`${img.name}-${i}`} className="flex items-center gap-3 py-2">
                    <ImageIcon className="w-4 h-4 text-tertiary shrink-0" />
                    <span className="text-[13px] text-primary truncate flex-1">{img.name}</span>
                    <button onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                      aria-label={`Remove ${img.name}`} className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : files.length > 0 && (
              <ul className="divide-y divide-subtle">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-3 py-2">
                    <FileText className="w-4 h-4 text-tertiary shrink-0" />
                    <span className="text-[13px] text-primary truncate flex-1">{f.name}</span>
                    <span className="text-[11px] text-tertiary tabular-nums shrink-0">{f.pageCount} {f.pageCount === 1 ? 'page' : 'pages'}</span>
                    {tool === 'merge' && (
                      <>
                        <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"
                          className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                        <button onClick={() => move(i, 1)} disabled={i === files.length - 1} aria-label="Move down"
                          className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                      </>
                    )}
                    <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                      aria-label={`Remove ${f.name}`} className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-danger/10">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Single-document tools ignore the rest of the list — say so rather than silently using file 1. */}
            {!wantsImages && tool !== 'merge' && files.length > 1 && (
              <p className="text-[12px] text-warning">Only the first file ({files[0].name}) is used by this tool.</p>
            )}

            {/* Per-tool options */}
            {usesRange && (
              <div>
                <label className="block text-[12px] font-semibold text-secondary mb-1">Pages</label>
                <input value={range} onChange={(e) => setRange(e.target.value)} placeholder="e.g. 1-3, 5, 9-"
                  className="w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none tabular-nums" />
                <p className="mt-1.5 text-[12px] text-tertiary">
                  {target
                    ? `${matched} of ${target.pageCount} page${target.pageCount === 1 ? '' : 's'} selected. Ranges keep the order you write them.`
                    : 'Add a PDF to choose pages.'}
                </p>
              </div>
            )}

            {tool === 'rotate' && (
              <div>
                <label className="block text-[12px] font-semibold text-secondary mb-1">Turn by</label>
                <div className="flex gap-1.5">
                  {([90, 180, 270] as const).map((d) => (
                    <button key={d} onClick={() => setTurn(d)}
                      className={`h-7 px-2.5 rounded-md text-[12px] font-medium tabular-nums transition-colors ${
                        turn === d ? 'bg-inverse text-inverse-fg' : 'text-secondary hover:bg-surface-hover'
                      }`}>{d}°</button>
                  ))}
                </div>
              </div>
            )}

            {tool === 'watermark' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-semibold text-secondary mb-1">Text</label>
                  <input value={wmText} onChange={(e) => setWmText(e.target.value)}
                    className="w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none" />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-secondary mb-1">Opacity — {wmOpacity}%</label>
                  <input type="range" min={2} max={60} value={wmOpacity} onChange={(e) => setWmOpacity(Number(e.target.value))}
                    className="w-full h-9 accent-accent" />
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button onClick={run} disabled={busy || !hasInput}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 shadow-sm disabled:opacity-50">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Run {def.label.toLowerCase()}
              </button>
              {hasInput && (
                <button onClick={() => { setFiles([]); setImages([]); setResults([]); setError(''); }}
                  className="h-8 px-3 rounded-lg text-[13px] font-medium text-secondary hover:bg-surface-hover">Clear</button>
              )}
            </div>

            {error && <p className="text-[12px] text-danger">{error}</p>}
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div className="rounded-xl bg-surface ring-1 ring-subtle shadow-card p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[12px] font-semibold text-secondary">
                  {results.length} file{results.length === 1 ? '' : 's'} ready
                </h2>
                {results.length > 1 && (
                  <button onClick={downloadAll} className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-accent hover:bg-accent/10">
                    <Download className="w-3.5 h-3.5" /> Download all
                  </button>
                )}
              </div>
              <ul className="divide-y divide-subtle">
                {results.map((r, i) => (
                  <li key={`${r.name}-${i}`} className="flex items-center gap-3 py-2">
                    <FileText className="w-4 h-4 text-tertiary shrink-0" />
                    <span className="text-[13px] text-primary truncate flex-1">{r.name}</span>
                    <span className="text-[11px] text-tertiary tabular-nums shrink-0">{(r.bytes.byteLength / 1024).toFixed(0)} KB</span>
                    <button onClick={() => downloadBytes(r.bytes, r.name)}
                      className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
                      <Download className="w-3.5 h-3.5" /> Save
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!hasInput && results.length === 0 && (
            <EmptyState icon={FileText} title="No files loaded" description="Drop a PDF above to merge, split, rotate, trim or stamp it." />
          )}
        </div>
      </div>
    </>
  );
}
