'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';
import { loadRecords, loadInvoiceDocument, saveInvoiceItems, type InvoiceLineItem } from '@/lib/crm/data';

interface Row { product_id: string; description: string; quantity: string; unit_price: string; discount_pct: string; tax_rate: string; image?: string | null }
interface Product { id: string; name: string; unit_price: number; image?: string | null }

const money = (n: number) => '$' + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function InvoiceItemsModal({
  privyUserId, invoiceId, initialItems, onClose, onSaved,
}: {
  privyUserId: string; invoiceId: string; initialItems?: InvoiceLineItem[]; onClose: () => void; onSaved: (total: number) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    (initialItems || []).map((it) => ({
      product_id: it.product_id || '', description: it.description || it.product || '',
      quantity: String(it.quantity ?? 1), unit_price: String(it.unit_price ?? 0),
      discount_pct: String(it.discount_pct ?? 0), tax_rate: String(it.tax_rate ?? 0),
      image: it.image || null,
    }))
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!initialItems);
  const [error, setError] = useState('');

  useEffect(() => {
    loadRecords(privyUserId, 'products').then((res) =>
      setProducts(res.rows.map((p: any) => ({ id: p.id, name: p.name, unit_price: +p.unit_price || 0, image: p.image || null })))
    );
  }, [privyUserId]);

  // When opened without items (e.g. from a list), load the record's current
  // positions so saving doesn't wipe them.
  useEffect(() => {
    if (initialItems) return;
    loadInvoiceDocument(privyUserId, invoiceId).then((d) => {
      setRows((d.items || []).map((it) => ({
        product_id: it.product_id || '', description: it.description || it.product || '',
        quantity: String(it.quantity ?? 1), unit_price: String(it.unit_price ?? 0),
        discount_pct: String(it.discount_pct ?? 0), tax_rate: String(it.tax_rate ?? 0),
        image: it.image || null,
      })));
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    let net = 0, tax = 0;
    for (const r of rows) {
      const n = (Number(r.quantity) || 0) * (Number(r.unit_price) || 0) * (1 - (Number(r.discount_pct) || 0) / 100);
      net += n; tax += n * (Number(r.tax_rate) || 0) / 100;
    }
    return { net, tax, total: net + tax };
  }, [rows]);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const addCustom = () => setRows((rs) => [...rs, { product_id: '', description: '', quantity: '1', unit_price: '0', discount_pct: '0', tax_rate: rs[rs.length - 1]?.tax_rate || '0' }]);
  const addProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    setRows((rs) => [...rs, { product_id: p.id, description: p.name, quantity: '1', unit_price: String(p.unit_price), discount_pct: '0', tax_rate: rs[rs.length - 1]?.tax_rate || '0', image: p.image || null }]);
  };

  const save = async () => {
    setSaving(true); setError('');
    const items = rows
      .filter((r) => r.description.trim() || Number(r.unit_price) > 0)
      .map((r) => ({ product_id: r.product_id || undefined, description: r.description, quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0, discount_pct: Number(r.discount_pct) || 0, tax_rate: Number(r.tax_rate) || 0 }));
    const res = await saveInvoiceItems(privyUserId, invoiceId, items);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved(res.total ?? totals.total);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col bg-white rounded-xl ring-1 ring-slate-200/70 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-slate-200/70">
          <h2 className="text-sm font-bold text-slate-800">Line items</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-12 flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : (<>
          {/* Add controls */}
          <div className="flex items-center gap-2 mb-3">
            <select value="" onChange={(e) => { addProduct(e.target.value); e.target.value = ''; }}
              className="h-8 px-2 text-[12px] rounded-md bg-white ring-1 ring-slate-200 text-slate-600 outline-none focus:ring-2 focus:ring-primary-500">
              <option value="">+ Add product / service…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.unit_price)}</option>)}
            </select>
            <button onClick={addCustom} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"><Plus className="w-3.5 h-3.5" /> Custom line</button>
          </div>

          {/* Rows */}
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_52px_84px_56px_56px_92px_24px] gap-2 px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit</span><span className="text-right">Disc%</span><span className="text-right">VAT%</span><span className="text-right">Amount</span><span />
            </div>
            {rows.length === 0 && <div className="py-8 text-center text-[13px] text-slate-400">No line items. Add a product or a custom line above.</div>}
            {rows.map((r, i) => {
              const amount = (Number(r.quantity) || 0) * (Number(r.unit_price) || 0) * (1 - (Number(r.discount_pct) || 0) / 100);
              return (
                <div key={i} className="grid grid-cols-[1fr_52px_84px_56px_56px_92px_24px] gap-2 items-center">
                  <div className="flex items-center gap-2 min-w-0">
                    {r.image && <img src={r.image} alt="" className="w-8 h-8 rounded object-cover ring-1 ring-slate-200/60 shrink-0" />}
                    <input value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} placeholder="Description"
                      className="flex-1 min-w-0 h-8 px-2 text-[13px] rounded-md bg-white ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-primary-500" />
                  </div>
                  <input type="number" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })}
                    className="h-8 px-1.5 text-[13px] text-right rounded-md bg-white ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-primary-500 tabular-nums" />
                  <input type="number" value={r.unit_price} onChange={(e) => setRow(i, { unit_price: e.target.value })}
                    className="h-8 px-1.5 text-[13px] text-right rounded-md bg-white ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-primary-500 tabular-nums" />
                  <input type="number" value={r.discount_pct} onChange={(e) => setRow(i, { discount_pct: e.target.value })}
                    className="h-8 px-1.5 text-[13px] text-right rounded-md bg-white ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-primary-500 tabular-nums" />
                  <input type="number" value={r.tax_rate} onChange={(e) => setRow(i, { tax_rate: e.target.value })}
                    className="h-8 px-1.5 text-[13px] text-right rounded-md bg-white ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-primary-500 tabular-nums" />
                  <div className="text-[13px] text-right tabular-nums font-semibold text-slate-700">{money(amount)}</div>
                  <button onClick={() => removeRow(i)} aria-label="Remove" className="p-1 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              );
            })}
          </div>

          {error && <p className="mt-3 text-[12px] text-rose-600">{error}</p>}
          </>)}
        </div>

        <div className="shrink-0 flex items-center gap-3 p-3 border-t border-slate-200/70">
          <div className="text-[12px] text-slate-500">
            Net <span className="font-semibold text-slate-700 tabular-nums">{money(totals.net)}</span>
            <span className="mx-1.5 text-slate-300">·</span>VAT <span className="font-semibold text-slate-700 tabular-nums">{money(totals.tax)}</span>
            <span className="mx-1.5 text-slate-300">·</span>Total <span className="font-black text-slate-900 tabular-nums">{money(totals.total)}</span>
          </div>
          <button onClick={onClose} className="ml-auto h-8 px-3 rounded-md text-[13px] font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={save} disabled={saving} className="h-8 px-3 rounded-md text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save items
          </button>
        </div>
      </div>
    </div>
  );
}
