'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';
import { loadRecords, saveInvoiceItems, type InvoiceLineItem } from '@/lib/crm/data';

interface Row { product_id: string; description: string; quantity: string; unit_price: string }
interface Product { id: string; name: string; unit_price: number }

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
    }))
  );
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadRecords(privyUserId, 'products').then((res) =>
      setProducts(res.rows.map((p: any) => ({ id: p.id, name: p.name, unit_price: +p.unit_price || 0 })))
    );
  }, [privyUserId]);

  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_price) || 0), 0), [rows]);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));
  const addCustom = () => setRows((rs) => [...rs, { product_id: '', description: '', quantity: '1', unit_price: '0' }]);
  const addProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    setRows((rs) => [...rs, { product_id: p.id, description: p.name, quantity: '1', unit_price: String(p.unit_price) }]);
  };

  const save = async () => {
    setSaving(true); setError('');
    const items = rows
      .filter((r) => r.description.trim() || Number(r.unit_price) > 0)
      .map((r) => ({ product_id: r.product_id || undefined, description: r.description, quantity: Number(r.quantity) || 0, unit_price: Number(r.unit_price) || 0 }));
    const res = await saveInvoiceItems(privyUserId, invoiceId, items);
    setSaving(false);
    if (res.error) { setError(res.error); return; }
    onSaved(res.total ?? total);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col bg-white rounded-xl ring-1 ring-slate-200/70 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-slate-200/70">
          <h2 className="text-sm font-bold text-slate-800">Line items</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
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
            <div className="grid grid-cols-[1fr_72px_104px_104px_28px] gap-2 px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span><span />
            </div>
            {rows.length === 0 && <div className="py-8 text-center text-[13px] text-slate-400">No line items. Add a product or a custom line above.</div>}
            {rows.map((r, i) => {
              const amount = (Number(r.quantity) || 0) * (Number(r.unit_price) || 0);
              return (
                <div key={i} className="grid grid-cols-[1fr_72px_104px_104px_28px] gap-2 items-center">
                  <input value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} placeholder="Description"
                    className="h-8 px-2 text-[13px] rounded-md bg-white ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-primary-500" />
                  <input type="number" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })}
                    className="h-8 px-2 text-[13px] text-right rounded-md bg-white ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-primary-500 tabular-nums" />
                  <input type="number" value={r.unit_price} onChange={(e) => setRow(i, { unit_price: e.target.value })}
                    className="h-8 px-2 text-[13px] text-right rounded-md bg-white ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-primary-500 tabular-nums" />
                  <div className="text-[13px] text-right tabular-nums font-semibold text-slate-700">{money(amount)}</div>
                  <button onClick={() => removeRow(i)} aria-label="Remove" className="p-1 rounded-md text-slate-300 hover:text-rose-600 hover:bg-rose-50"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              );
            })}
          </div>

          {error && <p className="mt-3 text-[12px] text-rose-600">{error}</p>}
        </div>

        <div className="shrink-0 flex items-center gap-3 p-3 border-t border-slate-200/70">
          <div className="text-[13px] text-slate-500">Total <span className="font-black text-slate-900 tabular-nums">{money(total)}</span></div>
          <button onClick={onClose} className="ml-auto h-8 px-3 rounded-md text-[13px] font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={save} disabled={saving} className="h-8 px-3 rounded-md text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-50">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save items
          </button>
        </div>
      </div>
    </div>
  );
}
