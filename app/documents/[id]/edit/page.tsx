'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeft, Printer, Send, Check, Plus, Trash2, Loader2, Eye } from 'lucide-react';
import {
  loadInvoiceDocument, getRecord, loadRecords, updateRecord, saveInvoiceItems, convertOffer,
  type InvoiceDocument,
} from '@/lib/crm/data';
import SendDocumentModal from '@/components/crm/SendDocumentModal';

const fmt = (n: number, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n || 0);

interface Row { product_id: string; description: string; quantity: string; unit_price: string; discount_pct: string; tax_rate: string }
interface Opt { id: string; name: string }
interface Prod { id: string; name: string; unit_price: number }

const cellInput = 'w-full bg-transparent hover:bg-slate-50 focus:bg-white rounded px-1.5 py-1 text-[13px] outline-none focus:ring-1 focus:ring-primary-400 tabular-nums';

export default function DocumentBuilder() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [doc, setDoc] = useState<InvoiceDocument | null>(null);
  const [header, setHeader] = useState({ number: '', organization_id: '', status: 'draft', issued_at: '', due_at: '', notes: '' });
  const [rows, setRows] = useState<Row[]>([]);
  const [companies, setCompanies] = useState<Opt[]>([]);
  const [products, setProducts] = useState<Prod[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [converting, setConverting] = useState(false);

  const load = useCallback(async () => {
    const d = await loadInvoiceDocument(privy, id);
    setDoc(d);
    setRows((d.items || []).map((it) => ({
      product_id: it.product_id || '', description: it.description || it.product || '',
      quantity: String(it.quantity ?? 1), unit_price: String(it.unit_price ?? 0),
      discount_pct: String(it.discount_pct ?? 0), tax_rate: String(it.tax_rate ?? 0),
    })));
    const rec = privy ? await getRecord(privy, 'invoices', id) : null;
    setHeader({
      number: rec?.number || d.number || '', organization_id: rec?.organization_id || '',
      status: rec?.status || d.status || 'draft', issued_at: rec?.issued_at || d.issued_at || '',
      due_at: rec?.due_at || d.due_at || '', notes: rec?.notes ?? d.notes ?? '',
    });
    loadRecords(privy, 'companies').then((r) => setCompanies(r.rows.map((c: any) => ({ id: c.id, name: c.name }))));
    loadRecords(privy, 'products').then((r) => setProducts(r.rows.map((p: any) => ({ id: p.id, name: p.name, unit_price: +p.unit_price || 0 }))));
  }, [privy, id]);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  const totals = useMemo(() => {
    let subtotal = 0, discount = 0, tax = 0;
    for (const r of rows) {
      const gross = (Number(r.quantity) || 0) * (Number(r.unit_price) || 0);
      const d = gross * (Number(r.discount_pct) || 0) / 100;
      const net = gross - d;
      subtotal += gross; discount += d; tax += net * (Number(r.tax_rate) || 0) / 100;
    }
    return { subtotal, discount, net: subtotal - discount, tax, total: subtotal - discount + tax };
  }, [rows]);

  const setH = (patch: Partial<typeof header>) => { setHeader((h) => ({ ...h, ...patch })); setSaved(false); };
  const setRow = (i: number, patch: Partial<Row>) => { setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); setSaved(false); };
  const removeRow = (i: number) => { setRows((rs) => rs.filter((_, idx) => idx !== i)); setSaved(false); };
  const addCustom = () => { setRows((rs) => [...rs, { product_id: '', description: '', quantity: '1', unit_price: '0', discount_pct: '0', tax_rate: rs[rs.length - 1]?.tax_rate || '0' }]); setSaved(false); };
  const addProduct = (pid: string) => {
    const p = products.find((x) => x.id === pid); if (!p) return;
    setRows((rs) => [...rs, { product_id: p.id, description: p.name, quantity: '1', unit_price: String(p.unit_price), discount_pct: '0', tax_rate: rs[rs.length - 1]?.tax_rate || '0' }]);
    setSaved(false);
  };

  const save = async () => {
    if (!privy) return;
    setSaving(true);
    await updateRecord(privy, 'invoices', id, {
      number: header.number, organization_id: header.organization_id, status: header.status,
      issued_at: header.issued_at, due_at: header.due_at, notes: header.notes,
    });
    const items = rows.filter((r) => r.description.trim() || Number(r.unit_price) > 0)
      .map((r) => ({ product_id: r.product_id || undefined, description: r.description, quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0, discount_pct: Number(r.discount_pct) || 0, tax_rate: Number(r.tax_rate) || 0 }));
    await saveInvoiceItems(privy, id, items);
    setSaving(false); setSaved(true);
    load();
  };

  const acceptOffer = async () => {
    if (!privy) return;
    setConverting(true);
    const res = await convertOffer(privy, id);
    setConverting(false);
    if (res.error) { alert(res.error); return; }
    if (res.id) router.push(`/documents/${res.id}/edit`);
  };

  if (!doc) return <div className="min-h-screen flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const isOffer = doc.kind === 'offer';
  const title = isOffer ? 'Offer' : 'Invoice';
  const accent = doc.seller?.accent_color || '#6366F1';
  const STATUSES = isOffer ? ['draft', 'sent', 'accepted', 'declined'] : ['draft', 'sent', 'paid', 'overdue'];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center gap-2">
          <button onClick={() => router.back()} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-slate-600 hover:bg-slate-100"><ArrowLeft className="w-4 h-4" /> Back</button>
          <span className="text-sm font-bold text-slate-700">{title} builder</span>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${doc.live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{doc.live ? 'Live' : 'Sample'}</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => router.push(`/documents/${id}`)} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"><Eye className="w-3.5 h-3.5" /> Preview</button>
            {isOffer && (
              <button onClick={acceptOffer} disabled={!privy || converting} title={!privy ? 'Sign in' : ''}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {converting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Accept → invoice
              </button>
            )}
            <button onClick={() => setSendOpen(true)} disabled={!privy} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"><Send className="w-3.5 h-3.5" /> Send</button>
            <button onClick={save} disabled={!privy || saving} title={!privy ? 'Sign in to save' : ''}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : null} {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Editable document sheet */}
      <div className="max-w-4xl mx-auto p-4 sm:p-8">
        <div className="bg-white rounded-xl ring-1 ring-slate-200 shadow-sm p-8 sm:p-10" style={{ borderTop: `4px solid ${accent}` }}>
          {/* Header */}
          <div className="flex items-start justify-between gap-6 pb-6 border-b border-slate-100">
            <div className="flex items-center gap-3">
              {doc.seller?.logo_url ? <img src={doc.seller.logo_url} alt="" className="w-11 h-11 rounded-lg object-contain" /> : <div className="w-11 h-11 rounded-lg" style={{ background: accent }} />}
              <div>
                <div className="text-lg font-black tracking-tight">{doc.seller?.name || 'Your company'}</div>
                <div className="text-[12px] text-slate-400 whitespace-pre-line">{doc.seller?.address || 'hirebtr.com'}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black tracking-tight">{title}</div>
              <input value={header.number} onChange={(e) => setH({ number: e.target.value })} placeholder={`${isOffer ? 'OFF' : 'INV'}-0001`}
                className="text-[13px] font-semibold text-slate-500 text-right bg-transparent hover:bg-slate-50 focus:bg-white rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary-400 w-28" />
              <div className="mt-1">
                <select value={header.status} onChange={(e) => setH({ status: e.target.value })}
                  className="text-[11px] font-bold uppercase tracking-widest text-slate-500 bg-slate-50 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-primary-400 capitalize">
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Parties + dates */}
          <div className="grid sm:grid-cols-3 gap-6 py-6">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">{isOffer ? 'Prepared for' : 'Bill to'}</div>
              <select value={header.organization_id} onChange={(e) => setH({ organization_id: e.target.value })}
                className="w-full text-[14px] font-bold text-slate-800 bg-transparent hover:bg-slate-50 focus:bg-white rounded px-1.5 py-1 outline-none focus:ring-1 focus:ring-primary-400">
                <option value="">{doc.buyer?.name || '— select client —'}</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">{isOffer ? 'Issued' : 'Invoice date'}</div>
              <input type="date" value={header.issued_at || ''} onChange={(e) => setH({ issued_at: e.target.value })} className={cellInput} />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">{isOffer ? 'Valid until' : 'Due date'}</div>
              <input type="date" value={header.due_at || ''} onChange={(e) => setH({ due_at: e.target.value })} className={cellInput} />
            </div>
          </div>

          {/* Positions */}
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-200">
                <th className="text-left py-2">Description</th>
                <th className="text-right py-2 w-16">Qty</th>
                <th className="text-right py-2 w-28">Unit price</th>
                <th className="text-right py-2 w-16">Disc%</th>
                <th className="text-right py-2 w-16">VAT%</th>
                <th className="text-right py-2 w-28">Amount</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-400">No positions yet — add a product or a custom line below.</td></tr>}
              {rows.map((r, i) => {
                const amount = (Number(r.quantity) || 0) * (Number(r.unit_price) || 0) * (1 - (Number(r.discount_pct) || 0) / 100);
                return (
                  <tr key={i} className="border-b border-slate-100 group">
                    <td className="py-1"><input value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} placeholder="Item / service" className={cellInput + ' text-left font-medium text-slate-800'} /></td>
                    <td className="py-1"><input type="number" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} className={cellInput + ' text-right'} /></td>
                    <td className="py-1"><input type="number" value={r.unit_price} onChange={(e) => setRow(i, { unit_price: e.target.value })} className={cellInput + ' text-right'} /></td>
                    <td className="py-1"><input type="number" value={r.discount_pct} onChange={(e) => setRow(i, { discount_pct: e.target.value })} className={cellInput + ' text-right'} /></td>
                    <td className="py-1"><input type="number" value={r.tax_rate} onChange={(e) => setRow(i, { tax_rate: e.target.value })} className={cellInput + ' text-right'} /></td>
                    <td className="py-1 text-right tabular-nums font-semibold text-slate-800 pr-1.5">{fmt(amount, doc.currency)}</td>
                    <td className="py-1 text-center"><button onClick={() => removeRow(i)} aria-label="Remove" className="p-1 rounded text-slate-300 hover:text-rose-600 opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Add row */}
          <div className="flex items-center gap-2 mt-3">
            <select value="" onChange={(e) => { addProduct(e.target.value); e.target.value = ''; }}
              className="h-8 px-2 text-[12px] rounded-md bg-white ring-1 ring-slate-200 text-slate-600 outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">+ Add product / service…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmt(p.unit_price, doc.currency)}</option>)}
            </select>
            <button onClick={addCustom} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"><Plus className="w-3.5 h-3.5" /> Custom line</button>
          </div>

          {/* Totals */}
          <div className="flex justify-end pt-5">
            <div className="w-full sm:w-72 space-y-1.5">
              <div className="flex justify-between text-[13px] text-slate-500"><span>Subtotal</span><span className="tabular-nums">{fmt(totals.subtotal, doc.currency)}</span></div>
              {totals.discount > 0 && <div className="flex justify-between text-[13px] text-emerald-600"><span>Discount</span><span className="tabular-nums">−{fmt(totals.discount, doc.currency)}</span></div>}
              {totals.tax > 0 && <div className="flex justify-between text-[13px] text-slate-500"><span>VAT</span><span className="tabular-nums">{fmt(totals.tax, doc.currency)}</span></div>}
              <div className="flex justify-between text-[15px] font-black pt-2 border-t border-slate-200"><span>{isOffer ? 'Estimated total' : 'Total due'}</span><span className="tabular-nums" style={{ color: accent }}>{fmt(totals.total, doc.currency)}</span></div>
            </div>
          </div>

          {/* Notes */}
          <div className="mt-8 pt-6 border-t border-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Notes</div>
            <textarea value={header.notes} onChange={(e) => setH({ notes: e.target.value })} rows={2} placeholder="Payment terms, delivery, thanks…"
              className="w-full text-[13px] text-slate-600 bg-transparent hover:bg-slate-50 focus:bg-white rounded px-1.5 py-1 outline-none focus:ring-1 focus:ring-primary-400 resize-none" />
          </div>
        </div>
        {!privy && <p className="text-center text-[12px] text-amber-600 mt-3">Sign in to save — this is a sample preview.</p>}
      </div>

      {sendOpen && privy && (
        <SendDocumentModal privyUserId={privy} invoiceId={id} kind={doc.kind} onClose={() => setSendOpen(false)} onSent={() => setSendOpen(false)} />
      )}
    </div>
  );
}
