'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Trash2, Loader2, Percent, StickyNote } from 'lucide-react';
import {
  loadInvoiceDocument, getRecord, loadRecords, createRecord, updateRecord, saveInvoiceItems,
} from '@/lib/crm/data';
import SearchSelect from './SearchSelect';
import { useDialog } from '@/components/ui/Dialog';

/**
 * Create or edit an invoice / offer in ONE popup.
 *
 * There used to be three ways in and none of them was good: "New" created an
 * EMPTY record straight away and navigated out of the app to a full-page
 * builder (so closing the tab left a blank draft behind), "Edit" opened the
 * generic field form with a bare amount box, and line items lived in a third
 * modal behind a "Products" button. This is all three, in the order someone
 * writes an invoice: who, when, what, total. Nothing is written until Save.
 *
 * The full-page builder at /documents/[id]/edit still exists for sending,
 * KSeF export and accepting an offer — this replaces how a document is MADE,
 * not what happens to it afterwards.
 */

interface Line { product_id: string; description: string; quantity: string; unit_price: string; discount_pct: string; tax_rate: string }
interface Opt { id: string; name: string }
interface Prod { id: string; name: string; unit_price: number; image?: string | null }

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date((iso || today()) + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
  a && b ? Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000) : null;

/**
 * The next number in whatever series the workspace already uses.
 * "INV-2026-009" → "INV-2026-010"; padding is kept. Nothing to go on → INV-0001.
 */
export function nextNumber(existing: (string | null | undefined)[], prefix: string): string {
  let best: { head: string; n: number; width: number } | null = null;
  for (const raw of existing) {
    const m = String(raw || '').match(/^(.*?)(\d+)$/);
    if (!m) continue;
    const n = parseInt(m[2], 10);
    if (!best || n > best.n) best = { head: m[1], n, width: m[2].length };
  }
  if (!best) return `${prefix}-0001`;
  return best.head + String(best.n + 1).padStart(best.width, '0');
}

// The VAT rate somebody used last time. Almost every business bills one rate,
// and typing 23 into every new invoice is the definition of busywork.
const VAT_KEY = 'rb-doc-vat';
const rememberedVat = () => { try { return localStorage.getItem(VAT_KEY) || '0'; } catch { return '0'; } };

const blank = (tax = '0'): Line => ({ product_id: '', description: '', quantity: '1', unit_price: '', discount_pct: '0', tax_rate: tax });

const field = 'w-full h-9 px-3 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm outline-none focus:ring-2 focus:ring-accent/30';
const cell = 'w-full h-8 px-2 text-sm rounded-md bg-transparent ring-1 ring-transparent hover:ring-subtle focus:bg-surface focus:ring-2 focus:ring-accent/30 outline-none tabular-nums';
const label = 'block text-xs font-medium text-secondary mb-1.5';

// On a phone the description takes its own row and the numbers sit under it;
// from sm: up it is one row per line, like the printed document.
const cols = (discount: boolean) => discount
  ? 'grid-cols-[4rem_1fr_4rem_4rem_2rem] sm:grid-cols-[1fr_4rem_6.5rem_4rem_4rem_6.5rem_2rem]'
  : 'grid-cols-[4rem_1fr_4rem_2rem] sm:grid-cols-[1fr_4rem_6.5rem_4rem_6.5rem_2rem]';

export default function DocumentComposer({
  privyUserId, kind, id, existingNumbers = [], onClose, onSaved,
}: {
  privyUserId: string;
  kind: 'invoice' | 'offer';
  /** null = new document. */
  id: string | null;
  /** Numbers already on screen, to continue the series. */
  existingNumbers?: (string | null | undefined)[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { confirm } = useDialog();
  const isOffer = kind === 'offer';
  const noun = isOffer ? 'offer' : 'invoice';

  const [loading, setLoading] = useState(!!id);
  const [currency, setCurrency] = useState('USD');
  const [number, setNumber] = useState(id ? '' : nextNumber(existingNumbers, isOffer ? 'OFF' : 'INV'));
  const [client, setClient] = useState('');
  const [status, setStatus] = useState('draft');
  const [issued, setIssued] = useState(today());
  const [due, setDue] = useState(addDays(today(), isOffer ? 30 : 14));
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [lines, setLines] = useState<Line[]>(() => [blank(id ? '0' : rememberedVat())]);
  const [showDiscount, setShowDiscount] = useState(false);
  const [companies, setCompanies] = useState<Opt[]>([]);
  const [products, setProducts] = useState<Prod[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = useRef(false);
  const touch = () => { dirty.current = true; };

  useEffect(() => {
    loadRecords(privyUserId, 'companies').then((r) => setCompanies(r.rows.map((c: any) => ({ id: c.id, name: c.name }))));
    loadRecords(privyUserId, 'products').then((r) => setProducts(r.rows.map((p: any) => ({ id: p.id, name: p.name, unit_price: +p.unit_price || 0, image: p.image || null }))));
  }, [privyUserId]);

  // Editing: the document carries the lines; the record carries the raw
  // organization_id the picker needs (the document only has the buyer's name).
  useEffect(() => {
    if (!id) return;
    (async () => {
      const [d, rec] = await Promise.all([loadInvoiceDocument(privyUserId, id), getRecord(privyUserId, 'invoices', id)]);
      setCurrency(d.currency || 'USD');
      setNumber(rec?.number || d.number || '');
      setClient(rec?.organization_id || '');
      setStatus(rec?.status || d.status || 'draft');
      setIssued(rec?.issued_at || d.issued_at || '');
      setDue(rec?.due_at || d.due_at || '');
      const n = rec?.notes ?? d.notes ?? '';
      setNotes(n); setShowNotes(!!n);
      const ls = (d.items || []).map((it) => ({
        product_id: it.product_id || '', description: it.description || it.product || '',
        quantity: String(it.quantity ?? 1), unit_price: String(it.unit_price ?? ''),
        discount_pct: String(it.discount_pct ?? 0), tax_rate: String(it.tax_rate ?? 0),
      }));
      setLines(ls.length ? ls : [blank()]);
      setShowDiscount(ls.some((l) => Number(l.discount_pct) > 0));
      setLoading(false);
    })();
  }, [id, privyUserId]);

  const money = useMemo(() => {
    const f = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    return (n: number) => f.format(n || 0);
  }, [currency]);

  const lineNet = (l: Line) =>
    (Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.discount_pct) || 0) / 100);

  const totals = useMemo(() => {
    let net = 0, tax = 0;
    for (const l of lines) { const n = lineNet(l); net += n; tax += n * (Number(l.tax_rate) || 0) / 100; }
    return { net, tax, total: net + tax };
  }, [lines]);

  const setLine = (i: number, patch: Partial<Line>) => { touch(); setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l))); };
  const removeLine = (i: number) => { touch(); setLines((ls) => (ls.length === 1 ? [blank(ls[0].tax_rate)] : ls.filter((_, k) => k !== i))); };
  const lastTax = () => lines[lines.length - 1]?.tax_rate || '0';
  const addLine = () => { touch(); setLines((ls) => [...ls, blank(lastTax())]); };
  // Picking a product fills the first EMPTY line rather than always appending,
  // so starting from the blank line does not leave an empty row above it.
  const addProduct = (pid: string) => {
    const p = products.find((x) => x.id === pid); if (!p) return;
    touch();
    const line: Line = { ...blank(lastTax()), product_id: p.id, description: p.name, unit_price: String(p.unit_price) };
    setLines((ls) => {
      const empty = ls.findIndex((l) => !l.description.trim() && !l.unit_price);
      return empty >= 0 ? ls.map((l, k) => (k === empty ? line : l)) : [...ls, line];
    });
  };

  const filled = lines.filter((l) => l.description.trim() || Number(l.unit_price) > 0);
  const canSave = filled.length > 0 && !saving && !loading;

  const closing = useRef(false);
  const close = async () => {
    if (closing.current) return;
    closing.current = true;
    const ok = !dirty.current || await confirm({ title: `Discard this ${noun}?`, body: 'Nothing has been saved.', confirmLabel: 'Discard', danger: true });
    closing.current = false;
    if (ok) onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!canSave) return;
    setSaving(true); setError('');
    const header = {
      number: number.trim(), organization_id: client, status,
      issued_at: issued, due_at: due, notes: showNotes ? notes : '',
      amount: Math.round(totals.total * 100) / 100,
    };
    let docId = id;
    if (docId) {
      const r = await updateRecord(privyUserId, 'invoices', docId, header);
      if (r.error) { setSaving(false); setError(r.error); return; }
    } else {
      const r = await createRecord(privyUserId, isOffer ? 'offers' : 'invoices', { ...header, direction: 'income' });
      if (r.error || !r.id) { setSaving(false); setError(r.error || `Could not create the ${noun}.`); return; }
      docId = r.id;
    }
    const items = filled.map((l) => ({
      product_id: l.product_id || undefined, description: l.description.trim(),
      quantity: Number(l.quantity) || 0, unit_price: Number(l.unit_price) || 0,
      discount_pct: showDiscount ? Number(l.discount_pct) || 0 : 0, tax_rate: Number(l.tax_rate) || 0,
    }));
    const it = await saveInvoiceItems(privyUserId, docId!, items);
    setSaving(false);
    // The header is already saved by now; say exactly which half failed.
    if (it.error) { setError(`Saved the ${noun}, but not its lines: ${it.error}`); return; }
    try { if (items[0]) localStorage.setItem(VAT_KEY, String(items[0].tax_rate)); } catch { /* per-viewer nicety only */ }
    onSaved(docId!);
  };

  const STATUSES = isOffer ? ['draft', 'sent', 'accepted', 'declined'] : ['draft', 'sent', 'paid', 'overdue'];
  const term = daysBetween(issued, due);
  const TERMS = isOffer ? [14, 30, 60] : [7, 14, 30];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-3 sm:p-6" onMouseDown={close}>
      <div role="dialog" aria-modal="true" aria-label={id ? `Edit ${noun}` : `New ${noun}`}
        className="w-full max-w-3xl max-h-[92vh] flex flex-col bg-surface rounded-xl ring-1 ring-subtle shadow-popover"
        onMouseDown={(e) => e.stopPropagation()}>

        <div className="h-12 shrink-0 flex items-center gap-3 px-5 border-b border-subtle">
          <h2 className="text-base font-medium text-primary">{id ? `Edit ${noun}` : `New ${noun}`}</h2>
          {id && (
            <select value={status} onChange={(e) => { touch(); setStatus(e.target.value); }} aria-label="Status"
              className="h-7 px-2 text-xs rounded-md bg-surface-sunken text-secondary outline-none focus:ring-2 focus:ring-accent/30 capitalize">
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <button onClick={close} aria-label="Close" className="ml-auto p-1.5 rounded-md text-tertiary hover:bg-surface-hover hover:text-secondary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-tertiary" /></div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
            {/* Who and when */}
            <div className="grid sm:grid-cols-[1fr_11rem] gap-4">
              <div>
                <span className={label}>{isOffer ? 'Prepared for' : 'Bill to'}</span>
                <SearchSelect options={companies} value={client} onChange={(v) => { touch(); setClient(v); }}
                  placeholder="Choose a client…" emptyLabel="No client yet" allowClear />
              </div>
              <label>
                <span className={label}>Number</span>
                <input value={number} onChange={(e) => { touch(); setNumber(e.target.value); }} className={field + ' tabular-nums'} />
              </label>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <label>
                <span className={label}>{isOffer ? 'Date' : 'Issue date'}</span>
                <input type="date" value={issued} onChange={(e) => { touch(); const v = e.target.value; if (term !== null && v) setDue(addDays(v, term)); setIssued(v); }} className={field} />
              </label>
              <div>
                <span className={label}>{isOffer ? 'Valid until' : 'Due date'}</span>
                <div className="flex items-center gap-2">
                  <input type="date" value={due} onChange={(e) => { touch(); setDue(e.target.value); }} className={field} aria-label={isOffer ? 'Valid until' : 'Due date'} />
                  <div className="flex items-center gap-0.5 rounded-md bg-surface-sunken p-0.5 shrink-0">
                    {TERMS.map((d) => (
                      <button key={d} type="button" onClick={() => { touch(); setDue(addDays(issued, d)); }}
                        className={`h-7 px-2 rounded text-xs font-medium tabular-nums transition-colors ${term === d ? 'bg-surface text-primary shadow-sm' : 'text-tertiary hover:text-secondary'}`}>
                        {d}d
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* What */}
            <div>
              <div className="flex items-center mb-1.5">
                <span className="text-xs font-medium text-secondary">Items</span>
                <button type="button" onClick={() => { touch(); setShowDiscount((v) => !v); }}
                  className={`ml-auto h-6 px-2 inline-flex items-center gap-1 rounded text-xs transition-colors ${showDiscount ? 'text-primary bg-surface-sunken' : 'text-tertiary hover:text-secondary'}`}>
                  <Percent className="w-3 h-3" /> Discounts
                </button>
              </div>

              <div className="rounded-lg ring-1 ring-subtle overflow-hidden">
                <div className={`grid ${cols(showDiscount)} gap-1 px-2 h-8 items-center bg-surface-sunken text-2xs font-medium text-tertiary`}>
                  <span className="hidden sm:block px-2">Description</span>
                  <span className="px-2 text-right">Qty</span>
                  <span className="px-2 text-right">Price</span>
                  {showDiscount && <span className="px-2 text-right">Disc %</span>}
                  <span className="px-2 text-right">VAT %</span>
                  <span className="hidden sm:block px-2 text-right">Amount</span>
                  <span />
                </div>
                {lines.map((l, i) => (
                  <div key={i}
                    className={`group grid ${cols(showDiscount)} gap-1 px-2 py-1 items-center border-t border-subtle first:border-t-0 sm:first:border-t`}>
                    <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value, product_id: '' })}
                      placeholder="Item or service" aria-label="Description" className={cell + ' text-primary col-span-full sm:col-span-1'} autoFocus={!id && i === 0} />
                    <input type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label="Quantity" className={cell + ' text-right'} />
                    <input type="number" min="0" step="any" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} placeholder="0.00" aria-label="Price" className={cell + ' text-right'} />
                    {showDiscount && <input type="number" min="0" max="100" step="any" value={l.discount_pct} onChange={(e) => setLine(i, { discount_pct: e.target.value })} aria-label="Discount %" className={cell + ' text-right'} />}
                    <input type="number" min="0" step="any" value={l.tax_rate} onChange={(e) => setLine(i, { tax_rate: e.target.value })} aria-label="VAT %" className={cell + ' text-right'} />
                    <span className="hidden sm:block px-2 text-right text-sm tabular-nums text-primary truncate">{money(lineNet(l))}</span>
                    <button type="button" onClick={() => removeLine(i)} aria-label="Remove line"
                      className="h-7 w-7 inline-flex items-center justify-center rounded text-tertiary hover:text-danger hover:bg-danger/10 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 mt-2">
                <button type="button" onClick={addLine}
                  className="h-8 px-2.5 shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-secondary hover:bg-surface-hover">
                  <Plus className="w-3.5 h-3.5" /> Add line
                </button>
                {products.length > 0 && (
                  <div className="w-60 min-w-0">
                    <SearchSelect value="" onChange={addProduct} clearOnPick placeholder="Add from products…"
                      options={products.map((p) => ({ id: p.id, name: p.name, hint: money(p.unit_price), image: p.image }))}
                      buttonClassName="!h-8 !text-xs" />
                  </div>
                )}
              </div>
            </div>

            {showNotes ? (
              <label className="block">
                <span className={label}>Note</span>
                <textarea value={notes} onChange={(e) => { touch(); setNotes(e.target.value); }} rows={3}
                  placeholder="Payment terms, bank details, thanks…"
                  className="w-full px-3 py-2 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm outline-none focus:ring-2 focus:ring-accent/30 resize-none" />
              </label>
            ) : (
              <button type="button" onClick={() => setShowNotes(true)}
                className="h-7 -ml-1 px-1.5 inline-flex items-center gap-1.5 rounded text-xs text-tertiary hover:text-secondary">
                <StickyNote className="w-3.5 h-3.5" /> Add a note
              </button>
            )}
          </div>
        )}

        <div className="shrink-0 border-t border-subtle px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-baseline gap-4 text-xs text-tertiary tabular-nums">
            <span>Net <span className="text-secondary">{money(totals.net)}</span></span>
            <span>VAT <span className="text-secondary">{money(totals.tax)}</span></span>
            <span className="text-sm text-secondary">Total <span className="text-md font-medium text-primary">{money(totals.total)}</span></span>
          </div>
          {error && <p className="basis-full order-last text-xs text-danger">{error}</p>}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={close} className="h-8 px-3 rounded-md text-sm font-medium text-secondary hover:bg-surface-hover">Cancel</button>
            <button onClick={save} disabled={!canSave}
              title={filled.length === 0 ? 'Add at least one line' : ''}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium bg-inverse text-inverse-fg hover:bg-inverse/90 disabled:opacity-40">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {id ? 'Save changes' : `Create ${noun}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
