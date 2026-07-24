'use client';

import { useState } from 'react';
import { X, Loader2, Send, CheckCircle2 } from 'lucide-react';

export default function SendDocumentModal({
  privyUserId, invoiceId, kind, defaultEmail, onClose, onSent,
}: {
  privyUserId: string; invoiceId: string; kind: string; defaultEmail?: string; onClose: () => void; onSent: () => void;
}) {
  const label = kind === 'offer' ? 'offer' : 'invoice';
  const [to, setTo] = useState(defaultEmail || '');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<false | 'sent' | 'skipped'>(false);

  const send = async () => {
    if (!to.trim()) { setError('Recipient email is required.'); return; }
    setSending(true); setError('');
    try {
      const res = await fetch('/api/finance/send-document', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privyUserId, invoiceId, to: to.trim(), message: message.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Send failed.'); setSending(false); return; }
      setDone(data.skipped ? 'skipped' : 'sent');
      setSending(false);
      setTimeout(onSent, 1100);
    } catch (e: any) {
      setError(e?.message || 'Send failed.'); setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4" onClick={onClose}>
      <div className="w-full max-w-md flex flex-col bg-surface rounded-xl ring-1 ring-subtle shadow-popover" onClick={(e) => e.stopPropagation()}>
        <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-subtle">
          <h2 className="text-sm font-semibold text-primary capitalize">Send {label}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button>
        </div>

        {done ? (
          <div className="p-8 flex flex-col items-center text-center gap-2">
            <CheckCircle2 className="w-9 h-9 text-success" />
            <div className="text-sm font-semibold text-primary">{done === 'sent' ? `${label[0].toUpperCase() + label.slice(1)} sent` : 'Ready to send'}</div>
            <div className="text-[12px] text-tertiary">{done === 'sent' ? `Emailed to ${to}.` : 'Email is not configured (no RESEND_API_KEY) — wire it to deliver.'}</div>
          </div>
        ) : (
          <>
            <div className="p-4 space-y-3">
              <label className="block">
                <span className="block text-[12px] font-semibold text-secondary mb-1">Recipient email <span className="text-danger">*</span></span>
                <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@company.com"
                  className="w-full h-9 px-2.5 text-[13px] rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none" />
              </label>
              <label className="block">
                <span className="block text-[12px] font-semibold text-secondary mb-1">Message <span className="text-tertiary font-normal">(optional)</span></span>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder={`Hi — please find the ${label} attached…`}
                  className="w-full px-2.5 py-2 text-[13px] rounded-md bg-surface ring-1 ring-subtle shadow-sm focus:ring-2 focus:ring-accent/30 outline-none" />
              </label>
              <p className="text-[11px] text-tertiary">A branded {label} summary with a link to view &amp; download the PDF will be emailed. Sending marks it as “sent”.</p>
              {error && <p className="text-[12px] text-danger">{error}</p>}
            </div>
            <div className="shrink-0 flex items-center gap-2 p-3 border-t border-subtle">
              <button onClick={onClose} className="ml-auto h-8 px-3 rounded-md text-[13px] font-medium text-secondary hover:bg-surface-hover">Cancel</button>
              <button onClick={send} disabled={sending} className="h-8 px-3 rounded-md text-[13px] font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 inline-flex items-center gap-1.5 disabled:opacity-50">
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
