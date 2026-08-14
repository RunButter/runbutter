'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Download, FileText, Loader2 } from 'lucide-react';

/**
 * A client's own account page: their invoices, their documents, your brand.
 *
 * Reads LIVE, unlike the frozen snapshot and data room, because the question it
 * answers is "is my invoice marked paid yet" and a frozen answer to that is
 * worse than none. The safety is that the token IS the query (0111) — nothing
 * about what comes back is controlled from here.
 *
 * No Privy: '/c/' is a public prefix, so a client never meets a login screen.
 */
interface Invoice {
  number: string | null; kind: string; amount: number | null; currency: string | null;
  status: string | null; issued_at: string | null; due_at: string | null;
}
interface PortalFile { id: string; name: string; size: number | null }
interface Portal {
  title: string; note: string; client: string | null;
  invoices: Invoice[]; files: PortalFile[];
  brand?: { name?: string; logo_url?: string | null; accent?: string | null } | null;
}

const money = (n: number | null, c: string | null) =>
  n === null ? '' : `${c || '$'}${Number(n).toLocaleString()}`;

const TONE: Record<string, string> = {
  paid: 'bg-success/10 text-success',
  overdue: 'bg-danger/10 text-danger',
  sent: 'bg-accent/10 text-accent',
  draft: 'bg-surface-sunken text-tertiary',
};

export default function ClientPortalPage() {
  const token = String(useParams().token || '');
  const [p, setP] = useState<Portal | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'gone'>('loading');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/portal/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (cancelled) return; if (j) { setP(j); setState('ok'); } else setState('gone'); })
      .catch(() => { if (!cancelled) setState('gone'); });
    return () => { cancelled = true; };
  }, [token]);

  async function download(f: PortalFile) {
    setBusy(f.id);
    try {
      const res = await fetch(`/api/portal/${encodeURIComponent(token)}/file/${encodeURIComponent(f.id)}`);
      const j = await res.json().catch(() => null);
      if (j?.url) window.location.href = j.url;
    } finally { setBusy(null); }
  }

  if (state === 'loading') {
    return <main className="min-h-screen bg-canvas flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-tertiary" />
    </main>;
  }
  if (state === 'gone' || !p) {
    return <main className="min-h-screen bg-canvas flex items-center justify-center px-6">
      <div className="text-center">
        <h1 className="text-md font-medium text-primary">This page isn’t available</h1>
        <p className="mt-1 text-sm text-secondary">The link may have been replaced or have expired.</p>
      </div>
    </main>;
  }

  const brand = p.brand || {};
  const outstanding = p.invoices
    .filter((i) => i.status !== 'paid' && i.kind !== 'offer')
    .reduce((a, i) => a + (Number(i.amount) || 0), 0);

  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="flex items-center gap-2.5 mb-6">
          {brand.logo_url
            ? <img src={brand.logo_url} alt="" className="w-6 h-6 rounded object-contain" />
            : <span className="w-6 h-6 rounded bg-surface-sunken" />}
          <span className="text-sm font-medium text-secondary">{brand.name || 'Your account'}</span>
        </div>

        <h1 className="text-md font-medium text-primary">{p.title}</h1>
        {p.client && <p className="text-sm text-secondary">{p.client}</p>}
        {p.note && <p className="mt-2 text-sm text-secondary whitespace-pre-wrap">{p.note}</p>}

        {p.invoices.length > 0 && (
          <>
            {outstanding > 0 && (
              <div className="mt-5 rounded-xl bg-surface-sunken p-3">
                <p className="text-2xs text-tertiary">Outstanding</p>
                <p className="text-base font-medium text-primary tabular-nums">
                  {money(outstanding, p.invoices[0]?.currency ?? null)}
                </p>
              </div>
            )}
            <div className="mt-3 card-surface divide-y divide-subtle">
              {p.invoices.map((i, n) => (
                <div key={`${i.number}-${n}`} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-primary truncate">
                      {i.number || '—'}
                      {i.kind === 'offer' && <span className="ml-1.5 text-2xs text-tertiary">quote</span>}
                    </p>
                    <p className="text-2xs text-tertiary tabular-nums">
                      {i.issued_at ? new Date(i.issued_at).toLocaleDateString('en-GB') : ''}
                      {i.due_at ? ` · due ${new Date(i.due_at).toLocaleDateString('en-GB')}` : ''}
                    </p>
                  </div>
                  <span className="text-sm text-primary tabular-nums shrink-0">{money(i.amount, i.currency)}</span>
                  {i.status && (
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded shrink-0 capitalize ${TONE[i.status] || 'bg-surface-sunken text-tertiary'}`}>
                      {i.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {p.files.length > 0 && (
          <>
            <p className="mt-6 text-2xs font-semibold text-secondary">Documents</p>
            <div className="mt-1.5 card-surface divide-y divide-subtle">
              {p.files.map((f) => (
                <button key={f.id} onClick={() => download(f)} disabled={busy === f.id}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-sunken/60 disabled:opacity-50">
                  <FileText className="w-4 h-4 text-tertiary shrink-0" />
                  <span className="flex-1 min-w-0 text-sm text-primary truncate">{f.name}</span>
                  {busy === f.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin text-tertiary shrink-0" />
                    : <Download className="w-3.5 h-3.5 text-tertiary shrink-0" />}
                </button>
              ))}
            </div>
          </>
        )}

        {p.invoices.length === 0 && p.files.length === 0 && (
          <p className="mt-6 text-sm text-secondary">Nothing here yet.</p>
        )}

        <p className="mt-8 text-center text-2xs text-tertiary">
          Powered by <a href="https://runbutter.app" className="text-accent hover:underline">RunButter</a>
        </p>
      </div>
    </main>
  );
}
