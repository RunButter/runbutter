'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeft, Printer, Pencil, Send, Check, Loader2, Lock, FileDown, FileCode } from 'lucide-react';
import DocumentComposer from '@/components/crm/DocumentComposer';
import { loadInvoiceDocument, loadPublicDocument, convertOffer, type InvoiceDocument } from '@/lib/crm/data';
import SendDocumentModal from '@/components/crm/SendDocumentModal';
import { useDialog } from '@/components/ui/Dialog';
import AppLoading from '@/components/ui/AppLoading';
import InvoiceSheet from '@/components/crm/InvoiceSheet';

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
    <Suspense fallback={<AppLoading />}>
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
  // Editing happens in the same popup the list uses, over this page — it used
  // to be a separate full-page builder. `?edit=1` opens it straight away, which
  // is where the old /edit URL and "Accept → invoice" now land.
  const [editing, setEditing] = useState(search.get('edit') === '1');

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
    if (res.id) router.push(`/documents/${res.id}?edit=1`);
  };

  // FA(3) KSeF XML. Lived only on the old full-page builder.
  const exportKsef = async () => {
    const res = await fetch('/api/ksef/invoice-xml', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privyUserId: privy, invoiceId: id }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); notify(e.error || 'KSeF export failed'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a'); a.href = url; a.download = `${doc?.number || 'faktura'}-fa3.xml`; a.click();
    URL.revokeObjectURL(url);
  };

  if (blocked) {
    return (
      <div className="min-h-screen bg-surface-hover flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-surface rounded-xl ring-1 ring-subtle shadow-sm p-8 text-center">
          <div className="w-10 h-10 mx-auto rounded-full bg-surface-hover flex items-center justify-center mb-3"><Lock className="w-4 h-4 text-tertiary" /></div>
          <h1 className="text-sm font-medium text-primary">This document isn’t available</h1>
          <p className="mt-1.5 text-sm text-secondary leading-relaxed">
            {token
              ? 'The share link is invalid or has been replaced. Ask the sender for a fresh link.'
              : 'Open it from your workspace, or use the share link from the email.'}
          </p>
        </div>
      </div>
    );
  }

  if (!doc) {
    return <AppLoading />;
  }

  const recipient = !!token;                // clean read-only view for clients

  const isOffer = doc.kind === 'offer';

  return (
    <div className="doc-stage min-h-screen bg-surface-hover text-primary">
      {/* The sheet sets the A4 page and its own print rules; this only takes the
          app's chrome off the paper. */}
      <style>{`@media print { .no-print { display: none !important; } .doc-stage { background: #fff !important; min-height: 0 !important; } .doc-wrap { padding: 0 !important; } }`}</style>

      {/* Toolbar */}
      <div className="no-print sticky top-0 z-10 bg-surface/80 backdrop-blur border-b border-subtle">
        <div className="max-w-[210mm] mx-auto px-4 h-14 flex items-center gap-2">
          {recipient ? (
            <span className="text-sm font-semibold text-secondary">{doc.seller?.name || 'Document'} — {isOffer ? 'offer' : 'invoice'} {doc.number || ''}</span>
          ) : (
            <>
              <button onClick={() => router.back()} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-secondary hover:bg-surface-hover"><ArrowLeft className="w-4 h-4" /><span className="sr-only sm:not-sr-only">Back</span></button>
              {/* The status lives here, not on the paper: "sent" and "overdue" are
                  our bookkeeping, not something a customer should read. */}
              {doc.live
                ? doc.status && <span className={`text-3xs font-medium uppercase tracking-widest px-1.5 py-0.5 rounded ring-1 ${STATUS_TONE[doc.status] || 'bg-surface-hover text-secondary ring-subtle'}`}>{doc.status.replace(/_/g, ' ')}</span>
                : <span className="text-3xs font-medium uppercase tracking-widest px-1.5 py-0.5 rounded bg-warning/10 text-warning">Sample</span>}
            </>
          )}
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {!recipient && isOffer && (
              <button onClick={acceptOffer} disabled={!privy || converting} title={!privy ? 'Sign in to accept' : ''}
                className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-success-fg bg-success hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
                {converting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Accept<span className="sr-only sm:not-sr-only"> → invoice</span>
              </button>
            )}
            {!recipient && (
              <>
                <button onClick={() => setEditing(true)} disabled={!privy} title={!privy ? 'Sign in to edit' : ''}
                  className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken disabled:opacity-40 disabled:cursor-not-allowed"><Pencil className="w-3.5 h-3.5" /><span className="sr-only sm:not-sr-only">Edit</span></button>
                {!isOffer && (
                  <button onClick={exportKsef} title="Download FA(3) e-invoice XML"
                    className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken"><FileCode className="w-3.5 h-3.5" /><span className="sr-only sm:not-sr-only">KSeF</span></button>
                )}
                <button onClick={() => setSendOpen(true)} disabled={!privy} title={!privy ? 'Sign in to send' : ''}
                  className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken disabled:opacity-40 disabled:cursor-not-allowed"><Send className="w-3.5 h-3.5" /><span className="sr-only sm:not-sr-only">Send</span></button>
              </>
            )}
            {(() => {
              const pdfToken = token || doc.share_token;
              const pdfHref = pdfToken || !isUuid(id) ? `/api/documents/${id}/pdf${pdfToken ? `?t=${pdfToken}` : ''}` : null;
              return pdfHref ? (
                <a href={pdfHref} className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
                  <FileDown className="w-3.5 h-3.5" /><span className="sr-only sm:not-sr-only">PDF</span>
                </a>
              ) : null;
            })()}
            <button onClick={() => window.print()} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-inverse-fg bg-inverse hover:bg-inverse/90"><Printer className="w-3.5 h-3.5" /> Print<span className="sr-only sm:not-sr-only"> / Save PDF</span></button>
          </div>
        </div>
      </div>

      {/* Document sheet — A4, on screen and on paper */}
      <div className="doc-wrap px-0 py-4 sm:p-8">
        <InvoiceSheet doc={doc} />
        {doc.items.length === 0 && !recipient && (
          <p className="no-print mt-3 text-center text-xs text-tertiary">No line items yet — the document shows its total as one line. Add products or services with Edit.</p>
        )}
      </div>

      {editing && privy && !recipient && (
        <DocumentComposer privyUserId={privy} kind={isOffer ? 'offer' : 'invoice'} id={id}
          onClose={() => { setEditing(false); router.replace(`/documents/${id}`); }}
          onSaved={() => { setEditing(false); router.replace(`/documents/${id}`); reload(); }} />
      )}
      {sendOpen && privy && (
        <SendDocumentModal privyUserId={privy} invoiceId={id} kind={doc.kind} onClose={() => setSendOpen(false)} onSent={() => { setSendOpen(false); reload(); }} />
      )}
    </div>
  );
}
