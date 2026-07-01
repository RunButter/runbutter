'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeft, Printer, Pencil, Send, Check, Loader2 } from 'lucide-react';
import { loadInvoiceDocument, convertOffer, type InvoiceDocument } from '@/lib/crm/data';
import SendDocumentModal from '@/components/crm/SendDocumentModal';

const fmt = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

const STATUS_TONE: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  sent: 'bg-blue-50 text-blue-700 ring-blue-200',
  overdue: 'bg-rose-50 text-rose-700 ring-rose-200',
  draft: 'bg-slate-100 text-slate-500 ring-slate-200',
  accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  declined: 'bg-rose-50 text-rose-700 ring-rose-200',
};

export default function DocumentPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [doc, setDoc] = useState<InvoiceDocument | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [converting, setConverting] = useState(false);

  const reload = useCallback(() => { loadInvoiceDocument(privy, id).then(setDoc); }, [privy, id]);
  useEffect(() => { if (ready) reload(); }, [ready, reload]);

  const acceptOffer = async () => {
    if (!privy) return;
    setConverting(true);
    const res = await convertOffer(privy, id);
    setConverting(false);
    if (res.error) { alert(res.error); return; }
    if (res.id) router.push(`/documents/${res.id}`);
  };

  if (!doc) {
    return <div className="min-h-screen flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  const isOffer = doc.kind === 'offer';
  const title = isOffer ? 'Offer' : 'Invoice';
  const accent = doc.seller?.accent_color || '#6366F1';
  const subtotal = doc.items.reduce((s, it) => s + (it.line_total || 0), 0);
  const total = doc.items.length ? subtotal : doc.amount; // fall back to header amount if no line items
  const tot = doc.totals;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } .doc-sheet { box-shadow: none !important; margin: 0 !important; border: 0 !important; } } @page { margin: 16mm; }`}</style>

      {/* Toolbar */}
      <div className="no-print sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-2">
          <button onClick={() => router.back()} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-slate-600 hover:bg-slate-100"><ArrowLeft className="w-4 h-4" /> Back</button>
          <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${doc.live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{doc.live ? 'Live' : 'Sample'}</span>
          <div className="ml-auto flex items-center gap-2">
            {isOffer && (
              <button onClick={acceptOffer} disabled={!privy || converting} title={!privy ? 'Sign in to accept' : ''}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {converting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Accept → invoice
              </button>
            )}
            <button onClick={() => router.push(`/documents/${id}/edit`)} disabled={!privy} title={!privy ? 'Sign in to edit' : ''}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"><Pencil className="w-3.5 h-3.5" /> Edit</button>
            <button onClick={() => setSendOpen(true)} disabled={!privy} title={!privy ? 'Sign in to send' : ''}
              className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"><Send className="w-3.5 h-3.5" /> Send</button>
            <button onClick={() => window.print()} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-[13px] font-bold text-white bg-slate-900 hover:bg-slate-800"><Printer className="w-3.5 h-3.5" /> Print / Save PDF</button>
          </div>
        </div>
      </div>

      {/* Document sheet */}
      <div className="max-w-3xl mx-auto p-4 sm:p-8">
        <div className="doc-sheet bg-white rounded-xl ring-1 ring-slate-200 shadow-sm p-8 sm:p-12" style={{ borderTop: `4px solid ${accent}` }}>
          {/* Header */}
          <div className="flex items-start justify-between gap-6 pb-8 border-b border-slate-100">
            <div className="flex items-center gap-3">
              {doc.seller?.logo_url ? (
                <img src={doc.seller.logo_url} alt="" className="w-11 h-11 rounded-lg object-contain" />
              ) : (
                <div className="w-11 h-11 rounded-lg" style={{ background: accent }} />
              )}
              <div>
                <div className="text-lg font-black tracking-tight text-slate-900">{doc.seller?.name || 'Your company'}</div>
                <div className="text-[12px] text-slate-400 whitespace-pre-line">{doc.seller?.address || 'hirebtr.com'}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black tracking-tight text-slate-900">{title}</div>
              <div className="text-[13px] font-semibold text-slate-500 tabular-nums">{doc.number || '—'}</div>
              {doc.status && <span className={`mt-1.5 inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ring-1 capitalize ${STATUS_TONE[doc.status] || 'bg-slate-100 text-slate-500 ring-slate-200'}`}>{doc.status}</span>}
            </div>
          </div>

          {/* Parties + dates */}
          <div className="grid sm:grid-cols-3 gap-6 py-8">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">{isOffer ? 'Prepared for' : 'Bill to'}</div>
              <div className="text-[14px] font-bold text-slate-800">{doc.buyer?.name || '—'}</div>
              {doc.buyer?.domain && <div className="text-[12px] text-slate-500">{doc.buyer.domain}</div>}
              {doc.buyer?.industry && <div className="text-[12px] text-slate-400">{doc.buyer.industry}</div>}
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">{isOffer ? 'Issued' : 'Invoice date'}</div>
              <div className="text-[13px] font-semibold text-slate-700">{fmtDate(doc.issued_at)}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">{isOffer ? 'Valid until' : 'Due date'}</div>
              <div className="text-[13px] font-semibold text-slate-700">{fmtDate(doc.due_at)}</div>
            </div>
          </div>

          {/* Line items */}
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-200">
                <th className="text-left py-2 font-bold">Description</th>
                <th className="text-right py-2 font-bold w-16">Qty</th>
                <th className="text-right py-2 font-bold w-28">Unit price</th>
                <th className="text-right py-2 font-bold w-16">VAT</th>
                <th className="text-right py-2 font-bold w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-slate-400 text-[13px]">No line items yet — add products or services with “Line items”.</td></tr>
              ) : doc.items.map((it, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-3 font-medium text-slate-800">
                    <div className="flex items-center gap-2.5">
                      {it.image && <img src={it.image} alt="" className="w-8 h-8 rounded object-cover ring-1 ring-slate-200/60 shrink-0" />}
                      <span>{it.description || it.product || 'Item'}{!!it.discount_pct && <span className="ml-2 text-[11px] font-semibold text-emerald-600">−{it.discount_pct}%</span>}</span>
                    </div>
                  </td>
                  <td className="py-3 text-right tabular-nums text-slate-600">{it.quantity}</td>
                  <td className="py-3 text-right tabular-nums text-slate-600">{fmt(it.unit_price, doc.currency)}</td>
                  <td className="py-3 text-right tabular-nums text-slate-500">{it.tax_rate ? `${it.tax_rate}%` : '—'}</td>
                  <td className="py-3 text-right tabular-nums font-semibold text-slate-800">{fmt(it.line_total, doc.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end pt-5">
            <div className="w-full sm:w-72 space-y-1.5">
              <div className="flex justify-between text-[13px] text-slate-500"><span>Subtotal</span><span className="tabular-nums">{fmt(tot ? tot.subtotal : total, doc.currency)}</span></div>
              {!!tot && tot.discount > 0 && (
                <div className="flex justify-between text-[13px] text-emerald-600"><span>Discount</span><span className="tabular-nums">−{fmt(tot.discount, doc.currency)}</span></div>
              )}
              {!!tot && tot.tax > 0 && (
                <div className="flex justify-between text-[13px] text-slate-500"><span>VAT</span><span className="tabular-nums">{fmt(tot.tax, doc.currency)}</span></div>
              )}
              <div className="flex justify-between text-[15px] font-black pt-2 border-t border-slate-200"><span className="text-slate-900">{isOffer ? 'Estimated total' : 'Total due'}</span><span className="tabular-nums" style={{ color: accent }}>{fmt(tot ? tot.total : total, doc.currency)}</span></div>
            </div>
          </div>

          {/* Notes */}
          {doc.notes && (
            <div className="mt-8 pt-6 border-t border-slate-100">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Notes</div>
              <p className="text-[13px] text-slate-600 leading-relaxed">{doc.notes}</p>
            </div>
          )}

          {doc.seller?.footer && (
            <div className="mt-8 pt-6 border-t border-slate-100 text-[12px] text-slate-500 leading-relaxed whitespace-pre-line">{doc.seller.footer}</div>
          )}

          <div className="mt-8 pt-6 border-t border-slate-100 text-center text-[11px] text-slate-400">
            {isOffer ? 'This offer is valid until the date above.' : 'Thank you for your business.'} · Generated by hirebtr.com
          </div>
        </div>
      </div>

      {sendOpen && privy && (
        <SendDocumentModal privyUserId={privy} invoiceId={id} kind={doc.kind} onClose={() => setSendOpen(false)} onSent={() => { setSendOpen(false); reload(); }} />
      )}
    </div>
  );
}
