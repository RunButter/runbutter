'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeft, Printer, Pencil, Send, Check, Loader2, Lock, FileDown } from 'lucide-react';
import { loadInvoiceDocument, loadPublicDocument, convertOffer, type InvoiceDocument } from '@/lib/crm/data';
import SendDocumentModal from '@/components/crm/SendDocumentModal';
import { useDialog } from '@/components/ui/Dialog';

const fmt = (n: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

const STATUS_TONE: Record<string, string> = {
  paid: 'bg-success/10 text-success ring-success/30',
  sent: 'bg-accent/10 text-accent ring-accent/30',
  overdue: 'bg-danger/10 text-danger ring-danger/30',
  draft: 'bg-surface-hover text-secondary ring-subtle',
  accepted: 'bg-success/10 text-success ring-success/30',
  declined: 'bg-danger/10 text-danger ring-danger/30',
};

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export default function DocumentPage() {
  const { notify } = useDialog();
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>}>
      <DocumentInner />
    </Suspense>
  );
}

function DocumentInner() {
  const { notify } = useDialog();
  const params = useParams();
  const router = useRouter();
  const search = useSearchParams();
  const id = String(params.id);
  const token = search.get('t');            // share-link (recipient) mode
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [doc, setDoc] = useState<InvoiceDocument | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [converting, setConverting] = useState(false);

  const reload = useCallback(() => {
    if (token) {
      // Recipient view: token is the authorisation — never fall back to a sample.
      loadPublicDocument(id, token).then((d) => { if (d) setDoc(d); else setBlocked(true); });
    } else {
      loadInvoiceDocument(privy, id).then((d) => {
        // Real ids must never silently render the sample document.
        if (isUuid(id) && !d.live) setBlocked(true);
        else setDoc(d);
      });
    }
  }, [privy, id, token]);
  useEffect(() => { if (ready) reload(); }, [ready, reload]);

  const acceptOffer = async () => {
    if (!privy) return;
    setConverting(true);
    const res = await convertOffer(privy, id);
    setConverting(false);
    if (res.error) { notify(res.error); return; }
    if (res.id) router.push(`/documents/${res.id}`);
  };

  if (blocked) {
    return (
      <div className="min-h-screen bg-surface-hover flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-surface rounded-xl ring-1 ring-subtle shadow-sm p-8 text-center">
          <div className="w-10 h-10 mx-auto rounded-full bg-surface-hover flex items-center justify-center mb-3"><Lock className="w-4 h-4 text-tertiary" /></div>
          <h1 className="text-sm font-medium text-primary">This document isn’t available</h1>
          <p className="mt-1.5 text-[13px] text-secondary leading-relaxed">
            {token
              ? 'The share link is invalid or has been replaced. Ask the sender for a fresh link.'
              : 'Open it from your workspace, or use the share link from the email.'}
          </p>
        </div>
      </div>
    );
  }

  if (!doc) {
    return <div className="min-h-screen flex items-center justify-center text-tertiary"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  const recipient = !!token;                // clean read-only view for clients

  const isOffer = doc.kind === 'offer';
  const title = isOffer ? 'Offer' : 'Invoice';
  const accent = doc.seller?.accent_color || '#4653CE';
  const subtotal = doc.items.reduce((s, it) => s + (it.line_total || 0), 0);
  const total = doc.items.length ? subtotal : doc.amount; // fall back to header amount if no line items
  const tot = doc.totals;

  return (
    <div className="min-h-screen bg-surface-hover text-primary">
      <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } .doc-sheet { box-shadow: none !important; margin: 0 !important; border: 0 !important; } } @page { margin: 16mm; }`}</style>

      {/* Toolbar */}
      <div className="no-print sticky top-0 z-10 bg-surface/80 backdrop-blur border-b border-subtle">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-2">
          {recipient ? (
            <span className="text-[13px] font-semibold text-secondary">{doc.seller?.name || 'Document'} — {isOffer ? 'offer' : 'invoice'} {doc.number || ''}</span>
          ) : (
            <>
              <button onClick={() => router.back()} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-secondary hover:bg-surface-hover"><ArrowLeft className="w-4 h-4" /> Back</button>
              <span className={`text-[10px] font-medium uppercase tracking-widest px-1.5 py-0.5 rounded ${doc.live ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>{doc.live ? 'Live' : 'Sample'}</span>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            {!recipient && isOffer && (
              <button onClick={acceptOffer} disabled={!privy || converting} title={!privy ? 'Sign in to accept' : ''}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-success-fg bg-success hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {converting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Accept → invoice
              </button>
            )}
            {!recipient && (
              <>
                <button onClick={() => router.push(`/documents/${id}/edit`)} disabled={!privy} title={!privy ? 'Sign in to edit' : ''}
                  className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken disabled:opacity-40 disabled:cursor-not-allowed"><Pencil className="w-3.5 h-3.5" /> Edit</button>
                <button onClick={() => setSendOpen(true)} disabled={!privy} title={!privy ? 'Sign in to send' : ''}
                  className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken disabled:opacity-40 disabled:cursor-not-allowed"><Send className="w-3.5 h-3.5" /> Send</button>
              </>
            )}
            {(() => {
              const pdfToken = token || doc.share_token;
              const pdfHref = pdfToken || !isUuid(id) ? `/api/documents/${id}/pdf${pdfToken ? `?t=${pdfToken}` : ''}` : null;
              return pdfHref ? (
                <a href={pdfHref} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[13px] font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
                  <FileDown className="w-3.5 h-3.5" /> PDF
                </a>
              ) : null;
            })()}
            <button onClick={() => window.print()} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-inverse-fg bg-inverse hover:bg-inverse/90"><Printer className="w-3.5 h-3.5" /> Print / Save PDF</button>
          </div>
        </div>
      </div>

      {/* Document sheet */}
      <div className="max-w-3xl mx-auto p-4 sm:p-8">
        <div className="doc-sheet bg-surface rounded-xl ring-1 ring-subtle shadow-sm p-8 sm:p-12" style={{ borderTop: `4px solid ${accent}` }}>
          {/* Header */}
          <div className="flex items-start justify-between gap-6 pb-8 border-b border-subtle">
            <div className="flex items-center gap-3">
              {doc.seller?.logo_url ? (
                <img src={doc.seller.logo_url} alt="" className="w-11 h-11 rounded-lg object-contain" />
              ) : (
                <div className="w-11 h-11 rounded-lg" style={{ background: accent }} />
              )}
              <div>
                <div className="text-lg font-semibold tracking-tight text-primary">{doc.seller?.name || 'Your company'}</div>
                <div className="text-[12px] text-tertiary whitespace-pre-line">{doc.seller?.address || 'runbutter.app'}</div>
                {(() => {
                  const ids = [
                    doc.seller?.tax_id && `NIP: ${doc.seller.tax_id}`,
                    doc.seller?.vat_id && `VAT: ${doc.seller.vat_id}`,
                    doc.seller?.reg_no && `Reg: ${doc.seller.reg_no}`,
                    doc.seller?.bdo && `BDO: ${doc.seller.bdo}`,
                  ].filter(Boolean).join(' · ');
                  return ids ? <div className="text-[11px] text-tertiary tabular-nums mt-0.5">{ids}</div> : null;
                })()}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold tracking-tight text-primary">{title}</div>
              <div className="text-[13px] font-semibold text-secondary tabular-nums">{doc.number || '—'}</div>
              {doc.status && <span className={`mt-1.5 inline-block text-[10px] font-medium uppercase tracking-widest px-2 py-0.5 rounded ring-1 capitalize ${STATUS_TONE[doc.status] || 'bg-surface-hover text-secondary ring-subtle'}`}>{doc.status}</span>}
            </div>
          </div>

          {/* Parties + dates */}
          <div className="grid sm:grid-cols-3 gap-6 py-8">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-1.5">{isOffer ? 'Prepared for' : 'Bill to'}</div>
              <div className="text-[14px] font-medium text-primary">{doc.buyer?.name || '—'}</div>
              {doc.buyer?.address && <div className="text-[12px] text-secondary whitespace-pre-line">{doc.buyer.address}</div>}
              {doc.buyer?.tax_id && <div className="text-[12px] text-tertiary tabular-nums">{String(doc.buyer.tax_id).replace(/[^0-9]/g, '').length === 10 && (doc.buyer.country || 'PL') === 'PL' ? 'NIP' : 'VAT'}: {doc.buyer.tax_id}</div>}
              {!doc.buyer?.address && doc.buyer?.domain && <div className="text-[12px] text-secondary">{doc.buyer.domain}</div>}
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-1.5">{isOffer ? 'Issued' : 'Invoice date'}</div>
              <div className="text-[13px] font-semibold text-secondary">{fmtDate(doc.issued_at)}</div>
            </div>
            <div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-1.5">{isOffer ? 'Valid until' : 'Due date'}</div>
              <div className="text-[13px] font-semibold text-secondary">{fmtDate(doc.due_at)}</div>
            </div>
          </div>

          {/* Line items */}
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[10px] font-medium uppercase tracking-widest text-tertiary border-b border-subtle">
                <th className="text-left py-2 font-medium">Description</th>
                <th className="text-right py-2 font-medium w-16">Qty</th>
                <th className="text-right py-2 font-medium w-28">Unit price</th>
                <th className="text-right py-2 font-medium w-16">VAT</th>
                <th className="text-right py-2 font-medium w-28">Amount</th>
              </tr>
            </thead>
            <tbody>
              {doc.items.length === 0 ? (
                <tr><td colSpan={5} className="py-8 text-center text-tertiary text-[13px]">No line items yet — add products or services with “Line items”.</td></tr>
              ) : doc.items.map((it, i) => (
                <tr key={i} className="border-b border-subtle">
                  <td className="py-3 font-medium text-primary">
                    {/* Offers sell — big product visuals. Invoices stay formal — no images. */}
                    <div className="flex items-center gap-3">
                      {isOffer && it.image && (
                        <img src={it.image} alt="" className="w-16 h-16 rounded-lg object-cover ring-1 ring-subtle shadow-sm shrink-0" />
                      )}
                      <span>{it.description || it.product || 'Item'}{!!it.discount_pct && <span className="ml-2 text-[11px] font-semibold text-success">−{it.discount_pct}%</span>}</span>
                    </div>
                  </td>
                  <td className="py-3 text-right tabular-nums text-secondary">{it.quantity}</td>
                  <td className="py-3 text-right tabular-nums text-secondary">{fmt(it.unit_price, doc.currency)}</td>
                  <td className="py-3 text-right tabular-nums text-secondary">{it.tax_rate ? `${it.tax_rate}%` : '—'}</td>
                  <td className="py-3 text-right tabular-nums font-semibold text-primary">{fmt(it.line_total, doc.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="flex justify-end pt-5">
            <div className="w-full sm:w-72 space-y-1.5">
              <div className="flex justify-between text-[13px] text-secondary"><span>Subtotal</span><span className="tabular-nums">{fmt(tot ? tot.subtotal : total, doc.currency)}</span></div>
              {!!tot && tot.discount > 0 && (
                <div className="flex justify-between text-[13px] text-success"><span>Discount</span><span className="tabular-nums">−{fmt(tot.discount, doc.currency)}</span></div>
              )}
              {!!tot && tot.tax > 0 && (
                <div className="flex justify-between text-[13px] text-secondary"><span>VAT</span><span className="tabular-nums">{fmt(tot.tax, doc.currency)}</span></div>
              )}
              <div className="flex justify-between text-[15px] font-semibold pt-2 border-t border-subtle"><span className="text-primary">{isOffer ? 'Estimated total' : 'Total due'}</span><span className="tabular-nums" style={{ color: accent }}>{fmt(tot ? tot.total : total, doc.currency)}</span></div>
            </div>
          </div>

          {/* Notes */}
          {doc.notes && (
            <div className="mt-8 pt-6 border-t border-subtle">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-1.5">Notes</div>
              <p className="text-[13px] text-secondary leading-relaxed">{doc.notes}</p>
            </div>
          )}

          {doc.seller?.iban && (
            <div className="mt-8 pt-6 border-t border-subtle">
              <div className="text-[10px] font-medium uppercase tracking-widest text-tertiary mb-1.5">Payment</div>
              <p className="text-[13px] text-secondary tabular-nums">{doc.seller.bank_name ? `${doc.seller.bank_name} · ` : ''}{doc.seller.iban}</p>
            </div>
          )}
          {doc.seller?.footer && (
            <div className="mt-8 pt-6 border-t border-subtle text-[12px] text-secondary leading-relaxed whitespace-pre-line">{doc.seller.footer}</div>
          )}

          <div className="mt-8 pt-6 border-t border-subtle text-center text-[11px] text-tertiary">
            {isOffer ? 'This offer is valid until the date above.' : 'Thank you for your business.'} · Generated by runbutter.app
          </div>
        </div>
      </div>

      {sendOpen && privy && (
        <SendDocumentModal privyUserId={privy} invoiceId={id} kind={doc.kind} onClose={() => setSendOpen(false)} onSent={() => { setSendOpen(false); reload(); }} />
      )}
    </div>
  );
}
