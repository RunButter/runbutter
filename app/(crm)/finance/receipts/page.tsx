'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { AlertTriangle, Camera, Check, FileText, Loader2, Upload, X } from 'lucide-react';
import AppLoading from '@/components/ui/AppLoading';
import { getWorkspace } from '@/lib/crm/data';
import { rpc } from '@/lib/rpc';
import { cn } from '@/lib/utils';
import { OBJECTS } from '@/lib/crm/registry';
import { authHeaders, deleteFile, extractFile, fileUrl, uploadFile } from '@/lib/files/client';
import { likelyDuplicate, receiptNote, validDate } from '@/lib/finance/receipt-read';

/**
 * Finance → Expenses → Scan receipts. Take a photo (or drop PDFs), and each one
 * comes back as a filled-in expense to check: vendor, date, amount, category.
 *
 * Reading is free wherever it can be: an emailed PDF receipt has a text layer
 * and is parsed by regex (lib/finance/receipt-parse.ts); a photo is read by the
 * server's OCR if one is set up, else by the workspace's OWN AI key — and if
 * neither, the form is simply empty beside the picture. Nothing is saved until
 * a person presses Save, and saving files the receipt WITH the expense in one
 * transaction (save_receipt_expense, 0137).
 */

type Phase = 'uploading' | 'reading' | 'ready' | 'saving' | 'saved' | 'failed';
interface Item {
  key: string; file: File; preview: string | null; phase: Phase; error?: string;
  fileId?: string; source?: string; note?: string; expenseId?: string;
  form: { vendor: string; spent_at: string; amount: string; category: string; status: string; notes: string };
}
interface Recent { file_id: string; name: string; mime_type: string | null; expense_id: string; vendor: string | null; amount: number | null; category: string | null; status: string | null; spent_at: string | null }

const SOURCE: Record<string, string> = { text: 'Read from the PDF', ocr: 'Read by OCR', ai: 'Read by your AI key', none: 'Fill it in' };
const CATEGORIES = (OBJECTS.expenses?.form?.find((f) => f.key === 'category')?.options || ['other']) as string[];
const STATUSES = (OBJECTS.expenses?.form?.find((f) => f.key === 'status')?.options || ['pending']) as string[];

export default function ReceiptsPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [ws, setWs] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [existing, setExisting] = useState<any[]>([]);
  const [recent, setRecent] = useState<Recent[] | null>(null);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const patchForm = (key: string, p: Partial<Item['form']>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, form: { ...x.form, ...p } } : x)));

  const loadSide = useCallback(async (w: string, p: string) => {
    const [ex, rc] = await Promise.all([
      rpc('list_records', { p_privy: p, p_workspace: w, p_object: 'expenses' }),
      rpc('get_receipts', { p_privy: p, p_workspace: w, p_limit: 60 }, { quiet: true }),
    ]);
    setExisting(Array.isArray(ex.data) ? ex.data : []);
    setRecent(rc.error ? [] : (rc.data as Recent[]) || []);
  }, []);
  useEffect(() => {
    if (!privy) return;
    getWorkspace(privy).then((w) => { if (!w?.id) { setError('No workspace found.'); return; } setWs(w.id); loadSide(w.id, privy); });
  }, [privy, loadSide]);

  const readOne = async (it: Item) => {
    if (!privy || !ws) return;
    const up = await uploadFile(it.file, privy, ws, null, null);
    if (up.error || !up.id) { patch(it.key, { phase: 'failed', error: up.error || 'Upload failed.' }); return; }
    patch(it.key, { fileId: up.id, phase: 'reading' });
    await extractFile(up.id, privy);   // text layer / OCR; a failure here just means "no text"
    try {
      const res = await fetch('/api/receipts/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ fileId: up.id, workspaceId: ws }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not read it.');
      const f = d.fields || {};
      patch(it.key, {
        phase: 'ready', source: d.source, note: d.note,
        form: {
          vendor: f.vendor || '', spent_at: validDate(f.date) || new Date().toISOString().slice(0, 10),
          amount: f.amount != null ? String(f.amount) : '', category: f.category && CATEGORIES.includes(f.category) ? f.category : 'other',
          status: 'pending', notes: receiptNote({ invoice_number: f.invoice_number, vat_id: f.vat_id, tax: f.tax, currency: f.currency }),
        },
      });
    } catch (e: any) {
      patch(it.key, { phase: 'ready', source: 'none', note: e?.message || 'Could not read it — fill it in.' });
    }
  };

  const add = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files).filter((f) => /^image\//.test(f.type) || f.type === 'application/pdf').slice(0, 20);
    if (!list.length) { setError('Add a photo (JPG, PNG, HEIC exported as JPG) or a PDF.'); return; }
    setError('');
    const next: Item[] = list.map((file) => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, file, phase: 'uploading',
      preview: /^image\//.test(file.type) ? URL.createObjectURL(file) : null,
      form: { vendor: '', spent_at: new Date().toISOString().slice(0, 10), amount: '', category: 'other', status: 'pending', notes: '' },
    }));
    setItems((xs) => [...next, ...xs]);
    // One at a time: a phone uploading ten photos at once stalls all ten.
    (async () => { for (const it of next) await readOne(it); })();
  };

  const save = async (it: Item) => {
    if (!privy || !ws || !it.fileId) return;
    const amount = Number(it.form.amount.replace(',', '.'));
    if (!it.form.vendor.trim() || !(amount > 0)) { patch(it.key, { error: 'Vendor and amount are needed.' }); return; }
    patch(it.key, { phase: 'saving', error: undefined });
    const { data, error: e } = await rpc('save_receipt_expense', {
      p_privy: privy, p_workspace: ws, p_file: it.fileId,
      p_data: { vendor: it.form.vendor.trim(), amount, spent_at: it.form.spent_at, category: it.form.category, status: it.form.status, notes: it.form.notes },
    });
    if (e) {
      const m = String(e.message || e);
      patch(it.key, { phase: 'ready', error: /ALREADY_FILED/.test(m) ? 'This receipt is already filed as an expense.' : /LIMIT/.test(m) ? 'Your plan’s record limit is reached.' : /does not exist|PGRST202/.test(m) ? 'Receipts need migration 0137 — run it in Supabase.' : m });
      return;
    }
    patch(it.key, { phase: 'saved', expenseId: (data as any)?.id });
    loadSide(ws, privy);
  };
  const discard = async (it: Item) => {
    setItems((xs) => xs.filter((x) => x.key !== it.key));
    if (it.preview) URL.revokeObjectURL(it.preview);
    if (it.fileId && privy && it.phase !== 'saved') await deleteFile(it.fileId, privy);
  };
  const open = async (fileId: string) => {
    if (!privy) return;
    const r = await fileUrl(fileId, privy);
    if (r.url) window.open(r.url, '_blank', 'noopener,noreferrer'); else setError(r.error || 'Could not open the file.');
  };

  if (!ready) return <AppLoading />;
  if (!privy) return <div className="page-pad text-sm text-tertiary">Sign in to scan receipts.</div>;

  const field = 'w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm outline-none focus:ring-2 focus:ring-accent/30';
  const label = 'block text-xs font-semibold text-secondary mb-1';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="h-14 shrink-0 flex items-center gap-2 page-x">
        <h1 className="text-base font-medium text-primary mr-auto">Receipts</h1>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto page-pad space-y-5">
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}

        <section
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
          className={cn('card-surface p-6 sm:p-8 text-center border-2 border-dashed transition-colors', drag ? 'border-accent bg-accent/5' : 'border-transparent')}>
          <p className="text-base text-primary">Snap or drop receipts</p>
          <p className="mt-1 text-sm text-secondary max-w-md mx-auto">Each one becomes an expense to check — vendor, date, amount and category filled in, the receipt kept with it.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button onClick={() => camRef.current?.click()} className="h-10 px-4 inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90"><Camera className="w-4 h-4" />Take a photo</button>
            <button onClick={() => pickRef.current?.click()} className="h-10 px-4 inline-flex items-center gap-2 rounded-lg text-sm ring-1 ring-subtle text-primary hover:bg-surface-hover"><Upload className="w-4 h-4" />Choose files</button>
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          <input ref={pickRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </section>

        {items.map((it) => {
          const dup = it.phase === 'ready' ? likelyDuplicate({ vendor: it.form.vendor, amount: Number(it.form.amount.replace(',', '.')) || null, date: it.form.spent_at }, existing) : null;
          return (
            <section key={it.key} className="card-surface overflow-hidden">
              <div className="grid md:grid-cols-[220px_minmax(0,1fr)]">
                <div className="bg-surface-sunken flex items-center justify-center min-h-[140px] max-h-[320px] overflow-hidden">
                  {it.preview ? <img src={it.preview} alt={it.file.name} className="w-full h-full object-contain max-h-[320px]" />
                    : <div className="text-center p-4"><FileText className="w-8 h-8 mx-auto text-tertiary" /><p className="mt-2 text-xs text-secondary break-all">{it.file.name}</p></div>}
                </div>
                <div className="p-4 space-y-3 min-w-0">
                  <div className="flex items-center gap-2">
                    {(it.phase === 'uploading' || it.phase === 'reading' || it.phase === 'saving') && <Loader2 className="w-4 h-4 animate-spin text-tertiary" />}
                    <p className="text-sm text-primary truncate">
                      {it.phase === 'uploading' ? 'Uploading…' : it.phase === 'reading' ? 'Reading the receipt…' : it.phase === 'saving' ? 'Saving…'
                        : it.phase === 'failed' ? 'Upload failed' : it.phase === 'saved' ? 'Saved as an expense' : SOURCE[it.source || 'none']}
                    </p>
                    {it.phase === 'saved' && <Check className="w-4 h-4 text-success" />}
                    <button aria-label="Remove" onClick={() => discard(it)} className="ml-auto w-8 h-8 rounded-md flex items-center justify-center text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
                  </div>
                  {it.phase === 'failed' && <p className="text-sm text-danger">{it.error}</p>}
                  {it.note && it.phase === 'ready' && <p className="text-xs text-secondary">{it.note}</p>}
                  {(it.phase === 'ready' || it.phase === 'saving') && (
                    <>
                      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <label className="block sm:col-span-2"><span className={label}>Vendor</span>
                          <input className={field} maxLength={120} value={it.form.vendor} onChange={(e) => patchForm(it.key, { vendor: e.target.value })} /></label>
                        <label className="block"><span className={label}>Date</span>
                          <input type="date" className={field} value={it.form.spent_at} onChange={(e) => patchForm(it.key, { spent_at: e.target.value })} /></label>
                        <label className="block"><span className={label}>Amount</span>
                          <input inputMode="decimal" className={field} value={it.form.amount} onChange={(e) => patchForm(it.key, { amount: e.target.value.replace(/[^0-9.,]/g, '') })} /></label>
                        <label className="block"><span className={label}>Category</span>
                          <select className={field} value={it.form.category} onChange={(e) => patchForm(it.key, { category: e.target.value })}>
                            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select></label>
                        <label className="block"><span className={label}>Status</span>
                          <select className={field} value={it.form.status} onChange={(e) => patchForm(it.key, { status: e.target.value })}>
                            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select></label>
                        <label className="block sm:col-span-2"><span className={label}>Notes</span>
                          <input className={field} maxLength={500} value={it.form.notes} onChange={(e) => patchForm(it.key, { notes: e.target.value })} /></label>
                      </div>
                      {dup && <p className="text-xs text-warning flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />Looks like an expense you already have — <Link href={`/objects/expenses?ref=${dup}`} className="underline">check it</Link> before saving.</p>}
                      {it.error && <p className="text-sm text-danger">{it.error}</p>}
                      <div className="flex gap-2">
                        <button onClick={() => save(it)} disabled={it.phase === 'saving'} className="h-9 px-4 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">Save expense</button>
                        <button onClick={() => discard(it)} className="h-9 px-3 rounded-lg text-sm text-secondary hover:bg-surface-hover">Discard</button>
                      </div>
                    </>
                  )}
                  {it.phase === 'saved' && (
                    <p className="text-sm text-secondary">{it.form.vendor} · {it.form.amount} · {it.form.spent_at} — <Link href={`/objects/expenses?ref=${it.expenseId}`} className="underline">open the expense</Link></p>
                  )}
                </div>
              </div>
            </section>
          );
        })}

        <section className="card-surface overflow-hidden">
          <div className="h-11 px-4 flex items-center border-b border-subtle">
            <h2 className="text-sm font-medium text-primary">Filed receipts</h2>
            <Link href="/objects/expenses" className="ml-auto text-xs text-secondary hover:text-primary">All expenses</Link>
          </div>
          {recent === null ? <div className="p-4"><Loader2 className="w-4 h-4 animate-spin text-tertiary" /></div>
            : recent.length === 0 ? <p className="px-4 py-4 text-sm text-tertiary">No receipts yet.</p> : (
              <ul className="divide-y divide-subtle">
                {recent.map((r) => (
                  <li key={r.file_id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <button onClick={() => open(r.file_id)} className="w-8 h-8 rounded-md bg-surface-sunken flex items-center justify-center text-tertiary hover:text-primary" aria-label={`Open ${r.name}`}><FileText className="w-4 h-4" /></button>
                    <div className="min-w-0 flex-1">
                      <Link href={`/objects/expenses?ref=${r.expense_id}`} className="text-sm text-primary hover:underline truncate block">{r.vendor || 'Expense'}</Link>
                      <p className="text-xs text-tertiary truncate">{r.spent_at || ''}{r.category ? ` · ${r.category}` : ''}{r.status ? ` · ${r.status}` : ''}</p>
                    </div>
                    <span className="text-sm tabular-nums text-primary">{r.amount != null ? Number(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>
      </div>
    </div>
  );
}
