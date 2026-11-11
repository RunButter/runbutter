'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy, getAccessToken } from '@privy-io/react-auth';
import { Loader2, Sparkles, Copy, Check, Send } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import AppLoading from '@/components/ui/AppLoading';
import { getWorkspace, loadFinanceAnalytics, loadBankAccounts, loadBoard, getMembers } from '@/lib/crm/data';
import { runway, fmtRunway } from '@/lib/finance/runway';
import { gatherMetrics, hasEnough, type InvestorMetrics } from '@/lib/investor/metrics';
import { saveNewsletter } from '@/lib/crm/newsletters';
import { useDialog } from '@/components/ui/Dialog';

/**
 * The monthly investor update, drafted from real numbers.
 *
 * This is the chore every founder puts off, and the reason they put it off is
 * the blank page rather than the writing — the figures are scattered across a
 * ledger, a bank balance and a pipeline, and assembling them takes longer than
 * the prose does. All three already live in this database, which is the whole
 * argument for a company OS over five separate tools.
 *
 * ── THE NUMBERS ARE COMPUTED, THE WORDS ARE WRITTEN ─────────────────────────
 * Every figure is arithmetic over the real ledger (lib/investor/metrics.ts) and
 * is DISPLAYED beside the draft. The model receives those figures and writes
 * the sentences between them; it is never asked what the revenue was. An
 * investor update is forwarded, archived and quoted back next quarter, so a
 * hallucinated number here is the most expensive one this product could
 * produce.
 *
 * What the model cannot know — what shipped, who joined, what help is wanted —
 * is typed by the founder and passed through.
 *
 * Saving creates an ordinary DRAFT newsletter, so sending, the audience and the
 * unsubscribe footer are all the paths that already work. Nothing is sent from
 * here: an investor list is one click from a lot of inboxes.
 */

const money = (n: number | null) => (n === null ? '—' : `$${Math.round(n).toLocaleString()}`);
const pct = (n: number | null) => (n === null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);

export default function InvestorUpdatePage() {
  const { notify } = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<{ id: string; name: string } | null>(null);
  const [metrics, setMetrics] = useState<InvestorMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const [highlights, setHighlights] = useState('');
  const [asks, setAsks] = useState('');
  const [draft, setDraft] = useState<{ subject: string; summary: string; sections: { heading: string; body: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!privy) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const w = await getWorkspace(privy);
      if (cancelled || !w) { setLoading(false); return; }
      setWs({ id: w.id, name: w.name });

      // Six months asked for, three averaged — the same window RunwayCard uses,
      // so the number here and the number on the dashboard cannot disagree.
      // loadFinanceAnalytics already carries `outstanding`, so there is no
      // second finance call to disagree with it.
      const [fin, bank, board, members] = await Promise.all([
        loadFinanceAnalytics(privy, 6),
        loadBankAccounts(privy),
        loadBoard(privy, 'sales', 'sales'),
        getMembers(privy, w.id).catch(() => []),
      ]);
      if (cancelled) return;

      // Sample accounts must not become a cash figure in an investor update.
      const cash = bank.live && bank.accounts.length
        ? bank.accounts.reduce((a: number, x: any) => a + (Number(x.balance) || 0), 0)
        : null;
      const r = cash !== null ? runway(fin.series || [], cash) : null;

      // Open deals only — a won deal is revenue and a lost one is nothing, and
      // counting either as pipeline is the oldest way to flatter a board.
      const open = (board.records || []).filter((x: any) => (x.status || 'active') === 'active');

      setMetrics(gatherMetrics({
        series: fin.series || [],
        cash,
        outstanding: fin.live ? fin.outstanding : null,
        runwayMonths: r?.months ?? null,
        burn: r?.burn ?? null,
        pipelineValue: board.live ? open.reduce((a: number, x: any) => a + (Number(x.amount) || 0), 0) : null,
        pipelineCount: board.live ? open.length : null,
        headcount: Array.isArray(members) && members.length ? members.length : null,
        live: fin.live,
      }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [privy]);

  const generate = useCallback(async () => {
    if (!privy || !ws || !metrics) return;
    setBusy(true); setError('');
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch('/api/investor/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
        body: JSON.stringify({ privyUserId: privy, workspaceId: ws.id, company: ws.name, metrics, highlights, asks }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j?.error || `Request failed (${res.status})`); return; }
      setDraft(j);
    } catch (e: any) {
      setError(e?.message || 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, [privy, ws, metrics, highlights, asks]);

  const asText = useMemo(() => {
    if (!draft) return '';
    return [draft.summary, ...draft.sections.map((s) => `\n${s.heading}\n${s.body}`)].join('\n');
  }, [draft]);

  async function saveAsNewsletter() {
    if (!privy || !ws || !draft) return;
    setSaving(true);
    // A DRAFT, with no audience attached. Sending stays a decision made on the
    // send screen, in front of the list it is going to.
    const res = await saveNewsletter(privy, ws.id, {
      subject: draft.subject, preheader: draft.summary.slice(0, 140),
      template: 'plain', content: { body: asText } as any,
      from_name: ws.name, reply_to: '', list_ids: [],
    });
    setSaving(false);
    if (res.error) notify(res.error);
    else notify('Saved as a draft newsletter. Add your investor list on the Newsletters screen when you are ready to send.');
  }

  if (!ready || loading) return <AppLoading label="Reading your numbers…" />;

  return (
    <>
      <PageHeader title="Investor update" />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="page-body p-6 2xl:p-8 flex flex-col gap-5">

          {/* The figures, first and checkable. The draft is downstream of these. */}
          <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-5">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-medium text-primary">
                {metrics?.period ? `Figures for ${metrics.period}` : 'Figures'}
              </h2>
              <span className="text-2xs text-tertiary">computed from your ledger — check them before you send</span>
            </div>

            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <Stat label="Revenue" value={money(metrics?.revenue ?? null)} sub={metrics?.growthPct !== null && metrics?.growthPct !== undefined ? `${pct(metrics.growthPct)} MoM` : undefined} />
              <Stat label="Costs" value={money(metrics?.costs ?? null)} />
              <Stat label="Net" value={money(metrics?.net ?? null)} />
              <Stat label="Cash" value={money(metrics?.cash ?? null)} />
              <Stat label="Runway" value={metrics?.runwayMonths != null ? fmtRunway(metrics.runwayMonths) : '—'} sub={metrics?.burn ? `${money(metrics.burn)}/mo burn` : undefined} />
              <Stat label="Outstanding" value={money(metrics?.outstanding ?? null)} />
              <Stat label="Open pipeline" value={money(metrics?.pipelineValue ?? null)} sub={metrics?.pipelineCount != null ? `${metrics.pipelineCount} deals` : undefined} />
              <Stat label="Headcount" value={metrics?.headcount != null ? String(metrics.headcount) : '—'} />
            </div>

            {/* What could NOT be computed, said out loud. A dash with no
                explanation reads as a bug; this reads as a fact about the data. */}
            {metrics?.missing.length ? (
              <ul className="mt-3 space-y-0.5">
                {metrics.missing.map((m) => <li key={m} className="text-2xs text-tertiary">· {m}</li>)}
              </ul>
            ) : null}
          </div>

          <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-5">
            <h2 className="text-sm font-medium text-primary">What the numbers don’t say</h2>
            <p className="mt-0.5 text-2xs text-tertiary">
              What shipped, who joined, what went wrong, what you want help with. This is the half no model can know.
            </p>
            <textarea value={highlights} onChange={(e) => setHighlights(e.target.value)} rows={4}
              placeholder="Shipped the new onboarding. Hired a second engineer. Lost the Globex deal on pricing."
              className="mt-2 w-full p-3 text-xs bg-surface-sunken rounded-lg ring-1 ring-subtle text-primary placeholder:text-tertiary outline-none focus:ring-2 focus:ring-accent/30 resize-none" />
            <textarea value={asks} onChange={(e) => setAsks(e.target.value)} rows={2}
              placeholder="Asks: intros to fintech CTOs, and a senior React contractor for Q4."
              className="mt-2 w-full p-3 text-xs bg-surface-sunken rounded-lg ring-1 ring-subtle text-primary placeholder:text-tertiary outline-none focus:ring-2 focus:ring-accent/30 resize-none" />

            <div className="mt-3 flex items-center gap-2">
              <button onClick={generate} disabled={busy || !privy || !metrics || !hasEnough(metrics)}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-inverse text-inverse-fg text-xs font-semibold disabled:opacity-40">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {draft ? 'Rewrite' : 'Write the update'}
              </button>
              {metrics && !hasEnough(metrics) && (
                <span className="text-2xs text-tertiary">Add some invoices or a bank balance first.</span>
              )}
            </div>
            {error && <p className="mt-2 text-xs text-danger">{error}</p>}
          </div>

          {draft && (
            <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-5">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-medium text-primary min-w-0 truncate">{draft.subject}</h2>
                <button onClick={() => { navigator.clipboard?.writeText(`${draft.subject}\n\n${asText}`); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="ml-auto h-7 px-2 inline-flex items-center gap-1 rounded-md text-2xs font-semibold text-secondary hover:text-primary hover:bg-surface-sunken shrink-0">
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
                </button>
                <button onClick={saveAsNewsletter} disabled={saving}
                  className="h-7 px-2 inline-flex items-center gap-1 rounded-md text-2xs font-semibold text-accent hover:bg-accent/10 shrink-0 disabled:opacity-40">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Save as draft
                </button>
              </div>

              <p className="mt-2 text-sm text-secondary leading-relaxed whitespace-pre-wrap">{draft.summary}</p>
              {draft.sections.map((s) => (
                <div key={s.heading} className="mt-4">
                  <h3 className="text-xs font-semibold text-primary">{s.heading}</h3>
                  <p className="mt-1 text-sm text-secondary leading-relaxed whitespace-pre-wrap">{s.body}</p>
                </div>
              ))}

              <p className="mt-5 text-2xs text-tertiary">
                Read it against the figures above before sending. Nothing is sent from this screen.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-surface-sunken p-3">
      <p className="text-2xs text-tertiary">{label}</p>
      <p className="mt-0.5 text-base font-medium text-primary tabular-nums">{value}</p>
      {sub && <p className="text-2xs text-tertiary tabular-nums">{sub}</p>}
    </div>
  );
}
