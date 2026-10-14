'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { ArrowLeft, Check, Copy, ExternalLink, Loader2, Send } from 'lucide-react';
import AppLoading from '@/components/ui/AppLoading';
import StatCard from '@/components/ui/StatCard';
import { useDialog } from '@/components/ui/Dialog';
import { getWorkspace } from '@/lib/crm/data';
import { rpc } from '@/lib/rpc';
import { cn } from '@/lib/utils';
import { deleteSurvey, headline, loadResults, saveSurvey, sendSurvey, type Survey, type SurveyResults } from '@/lib/surveys/client';

/**
 * One survey (0138): results, who to ask, the share link, and its wording.
 * Every answer row links to the person and the company it came from.
 */

type Tab = 'results' | 'send' | 'share' | 'settings';
const BUCKET: Record<string, string> = { promoter: 'bg-success', passive: 'bg-warning', detractor: 'bg-danger' };
const bucketOf = (kind: string, n: number) => (kind === 'csat' ? (n >= 4 ? 'promoter' : n === 3 ? 'passive' : 'detractor') : n >= 9 ? 'promoter' : n >= 7 ? 'passive' : 'detractor');
const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function SurveyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const dialog = useDialog();
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [ws, setWs] = useState<{ id: string; role: string } | null>(null);
  const [tab, setTab] = useState<Tab>('results');
  const [r, setR] = useState<SurveyResults | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'promoter' | 'passive' | 'detractor'>('all');
  const [draft, setDraft] = useState<Partial<Survey>>({});
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState('');
  // Send
  const [people, setPeople] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [company, setCompany] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [force, setForce] = useState(false);
  const [sent, setSent] = useState<{ created: number; sent: number; skipped: Record<string, number> } | null>(null);

  const reload = useCallback(async () => {
    if (!privy) return;
    const x = await loadResults(privy, id, null, null);
    if (x.error) setError(x.error); else { setR(x.results!); setDraft(x.results!.survey); }
  }, [privy, id]);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => { if (privy) getWorkspace(privy).then((w) => w?.id && setWs({ id: w.id, role: w.role })); }, [privy]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    if (tab !== 'send' || people || !privy || !ws) return;
    // list_records('people') carries the company NAME, which is all the filter needs.
    rpc('list_records', { p_privy: privy, p_workspace: ws.id, p_object: 'people' })
      .then((p) => setPeople(Array.isArray(p.data) ? p.data : []));
  }, [tab, people, privy, ws]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (people || []).filter((p) => {
      if (company && (p.company || '') !== company) return false;
      if (!needle) return true;
      return [p.name, p.email, p.company].filter(Boolean).join(' ').toLowerCase().includes(needle);
    }).slice(0, 1000);
  }, [people, q, company]);
  const companyNames = useMemo(() => [...new Set((people || []).map((p) => p.company).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)), [people]);

  if (!ready) return <AppLoading />;
  if (!privy) return <div className="page-pad text-sm text-tertiary">Sign in to see this survey.</div>;
  if (!r) return error ? <div className="page-pad text-sm text-danger">{error}</div> : <AppLoading />;

  const s = r.survey;
  const viewer = ws?.role === 'viewer';
  const counts = { promoter: 0, passive: 0, detractor: 0 };
  for (const x of r.responses) counts[x.bucket]++;
  const total = r.responses.length;
  const h = headline(s.kind, counts.promoter, counts.detractor, total);
  const maxBar = Math.max(1, ...Object.values(r.distribution || {}));
  const link = `${origin}/survey/${s.id}`;
  const embed = `<iframe src="${link}?embed=1" style="width:100%;min-height:420px;border:0" title="Survey" loading="lazy"></iframe>`;
  const copy = async (t: string, k: string) => { try { await navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied(''), 1500); } catch {} };
  const save = async (patch?: Partial<Survey>) => {
    if (!ws) return;
    setBusy(true); setError('');
    const x = await saveSurvey(privy, ws.id, { id: s.id, ...(patch ?? draft) });
    setBusy(false);
    if (x.error) setError(x.error); else reload();
  };
  const remove = async () => {
    if (!(await dialog.confirm({ title: `Delete “${s.name}”?`, body: 'Its answers are deleted with it. The notes already on people and companies stay.', confirmLabel: 'Delete', danger: true }))) return;
    const x = await deleteSurvey(privy, s.id);
    if (x.error) setError(x.error); else router.push('/surveys');
  };
  const send = async () => {
    if (!ws || !picked.size) return;
    setBusy(true); setError(''); setSent(null);
    const x = await sendSurvey(ws.id, s.id, [...picked], force);
    setBusy(false);
    if (x.error) { setError(x.error); return; }
    setSent(x.data!); setPicked(new Set()); reload();
  };
  const withEmail = shown.filter((p) => p.email);
  const field = 'w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm outline-none focus:ring-2 focus:ring-accent/30';
  const SKIP: Record<string, string> = { no_email: 'no email', opted_out: 'opted out', suppressed: 'bounced or unsubscribed', recent: 'asked in the last 30 days', not_found: 'not found' };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="h-14 shrink-0 flex items-center gap-2 page-x">
        <Link href="/surveys" aria-label="All surveys" className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:bg-surface-hover"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="text-base font-medium text-primary truncate">{s.name}</h1>
        <span className="text-2xs uppercase tracking-wide text-tertiary">{s.kind}</span>
        {!s.enabled && <span className="text-2xs font-semibold rounded-full px-2 py-0.5 bg-surface-hover text-tertiary">Off</span>}
      </header>
      <div className="shrink-0 page-x">
        <div className="inline-flex max-w-full overflow-x-auto no-scrollbar items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5">
          {(['results', 'send', 'share', 'settings'] as Tab[]).filter((t) => !viewer || t === 'results' || t === 'share').map((t) => (
            <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}
              className={cn('h-8 px-3 rounded-md text-sm whitespace-nowrap', tab === t ? 'bg-surface text-primary shadow-sm font-medium' : 'text-tertiary hover:text-secondary')}>{({ results: 'Results', send: 'Send by email', share: 'Share', settings: 'Settings' } as Record<Tab, string>)[t]}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto page-pad space-y-5">
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}

        {tab === 'results' && (
          <>
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label={h.label === 'NPS' ? 'Net Promoter Score' : 'Satisfied'} value={h.value} />
              <StatCard label="Answers" value={String(total)} />
              <StatCard label="Response rate" value={r.invites ? `${Math.round((r.responses.filter((x) => x.source === 'email').length / r.invites) * 100)}%` : '—'} />
              <StatCard label={s.kind === 'nps' ? 'Promoters · detractors' : 'Happy · unhappy'} value={`${counts.promoter} · ${counts.detractor}`} />
            </section>
            <section className="card-surface p-4">
              <h2 className="text-sm font-medium text-primary mb-3">Scores</h2>
              <div className="flex items-end gap-1.5 h-32">
                {Object.entries(r.distribution || {}).sort((a, b) => +a[0] - +b[0]).map(([k, n]) => (
                  <div key={k} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <span className="text-2xs text-tertiary tabular-nums">{n || ''}</span>
                    <div className={cn('w-full rounded-t', BUCKET[bucketOf(s.kind, +k)])} style={{ height: `${Math.max(2, (n / maxBar) * 90)}px`, opacity: n ? 1 : 0.25 }} />
                    <span className="text-2xs text-secondary tabular-nums">{k}</span>
                  </div>
                ))}
              </div>
              {r.trend.length > 1 && (
                <p className="mt-3 text-xs text-secondary">By month: {r.trend.map((t) => `${t.month} ${s.kind === 'nps' ? Math.round(((t.promoters - t.detractors) / Math.max(1, t.responses)) * 100) : `${t.average}/5`}`).join(' · ')}</p>
              )}
            </section>
            <section className="card-surface overflow-hidden">
              <div className="h-11 px-4 flex items-center gap-1 border-b border-subtle">
                <h2 className="text-sm font-medium text-primary mr-auto">Answers</h2>
                {(['all', 'detractor', 'passive', 'promoter'] as const).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={cn('h-7 px-2.5 rounded-md text-xs capitalize', filter === f ? 'bg-inverse text-inverse-fg' : 'text-secondary hover:bg-surface-hover')}>
                    {f === 'all' ? 'All' : `${f}s`}</button>
                ))}
              </div>
              {r.responses.length === 0 ? <p className="px-4 py-4 text-sm text-tertiary">No answers yet. Send it by email or share the link.</p> : (
                <ul className="divide-y divide-subtle">
                  {r.responses.filter((x) => filter === 'all' || x.bucket === filter).map((x) => (
                    <li key={x.id} className="px-4 py-3 flex items-start gap-3">
                      <span className={cn('w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-sm font-semibold text-white', BUCKET[x.bucket])}>{x.score}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-primary truncate">
                          {x.person_id ? <Link href={`/objects/people?ref=${x.person_id}`} className="hover:underline">{x.name || x.email}</Link> : (x.name || x.email || 'Anonymous')}
                          {x.company && <>{' · '}{x.company_id ? <Link href={`/objects/companies?ref=${x.company_id}`} className="text-secondary hover:underline">{x.company}</Link> : x.company}</>}
                        </p>
                        {x.comment && <p className="text-sm text-secondary whitespace-pre-line">“{x.comment}”</p>}
                        <p className="text-2xs text-tertiary">{fmt(x.created_at)} · {x.source === 'email' ? 'from email' : 'from link'}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {tab === 'send' && (
          <section className="card-surface p-4 space-y-3">
            <p className="text-sm text-secondary">Each person gets an email with the question and the scale — one tap answers it. Nobody is asked twice in 30 days, and people who opted out, bounced or unsubscribed are skipped.</p>
            {sent && (
              <p className="text-sm text-success flex flex-wrap items-center gap-1.5"><Check className="w-4 h-4" />Sent {sent.sent} of {sent.created}.
                {Object.entries(sent.skipped || {}).filter(([, n]) => n > 0).map(([k, n]) => <span key={k} className="text-secondary"> · {n} skipped: {SKIP[k] || k}</span>)}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <input className={cn(field, 'flex-1 min-w-[200px]')} placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
              <select className={cn(field, 'w-auto')} value={company} onChange={(e) => setCompany(e.target.value)}>
                <option value="">All companies</option>
                {companyNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            {!people ? <Loader2 className="w-4 h-4 animate-spin text-tertiary" /> : (
              <>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <button onClick={() => setPicked(new Set([...picked, ...withEmail.slice(0, 500).map((p) => p.id)]))} className="text-accent hover:underline">Select {Math.min(500, withEmail.length)} shown with an email</button>
                  {picked.size > 0 && <button onClick={() => setPicked(new Set())} className="text-secondary hover:underline">Clear</button>}
                  <span className="text-tertiary">{picked.size} selected</span>
                </div>
                <ul className="max-h-[360px] overflow-y-auto divide-y divide-subtle rounded-lg ring-1 ring-subtle">
                  {shown.map((p) => {
                    return (
                      <li key={p.id}>
                        <label className={cn('px-3 py-2 flex items-center gap-3 text-sm', !p.email && 'opacity-50')}>
                          <input type="checkbox" disabled={!p.email} checked={picked.has(p.id)}
                            onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(p.id); else n.delete(p.id); setPicked(n); }} />
                          <span className="min-w-0 flex-1 truncate text-primary">{p.name || p.email || 'Unnamed'}
                            {p.company && <span className="text-tertiary"> · {p.company}</span>}</span>
                          <span className="text-xs text-tertiary truncate max-sm:hidden">{p.email || 'no email'}</span>
                        </label>
                      </li>
                    );
                  })}
                  {shown.length === 0 && <li className="px-3 py-3 text-sm text-tertiary">Nobody matches.</li>}
                </ul>
                <label className="flex items-center gap-2 text-sm text-secondary"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />Ask again even if they were asked in the last 30 days</label>
                <button onClick={send} disabled={busy || !picked.size || !s.enabled}
                  className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Send to {picked.size}</button>
                {!s.enabled && <p className="text-xs text-warning">The survey is off — switch it on in Settings to send it.</p>}
              </>
            )}
          </section>
        )}

        {tab === 'share' && (
          <section className="card-surface p-4 space-y-4">
            <div className="space-y-2">
              <p className="text-sm text-primary">A link anyone can answer — for a website, a receipt, a QR code.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 text-xs font-mono bg-surface-sunken rounded-lg px-3 py-2 truncate">{link}</code>
                <button onClick={() => copy(link, 'l')} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs ring-1 ring-subtle text-secondary hover:bg-surface-hover">{copied === 'l' ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}Copy</button>
                <a href={link} target="_blank" rel="noreferrer noopener" className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs ring-1 ring-subtle text-secondary hover:bg-surface-hover"><ExternalLink className="w-3.5 h-3.5" />Open</a>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-primary">On your website</p>
              <div className="flex items-stretch gap-2">
                <code className="flex-1 min-w-0 text-xs font-mono bg-inverse text-inverse-fg rounded-lg px-3 py-2.5 overflow-x-auto whitespace-nowrap">{embed}</code>
                <button onClick={() => copy(embed, 'e')} className="shrink-0 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs ring-1 ring-subtle text-secondary hover:bg-surface-hover">{copied === 'e' ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}Copy</button>
              </div>
            </div>
            <p className="text-xs text-tertiary">Link answers are matched to People by email when the person gives one.</p>
          </section>
        )}

        {tab === 'settings' && (
          <section className="card-surface p-4 space-y-4 max-w-2xl">
            <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Name (for you)</span>
              <input className={field} maxLength={120} value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            {total === 0 && (
              <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Scale</span>
                <select className={field} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as any })}>
                  <option value="nps">NPS — 0 to 10, how likely to recommend</option><option value="csat">CSAT — 1 to 5, how satisfied</option>
                </select></label>
            )}
            <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Question</span>
              <input className={field} maxLength={300} value={draft.question || ''} onChange={(e) => setDraft({ ...draft, question: e.target.value })} /></label>
            <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Follow-up question <span className="font-normal text-tertiary">(blank = asks what to improve, or what they like, by score)</span></span>
              <input className={field} maxLength={300} value={draft.followup_question || ''} onChange={(e) => setDraft({ ...draft, followup_question: e.target.value })} /></label>
            <label className="block"><span className="block text-xs font-semibold text-secondary mb-1">Thank-you message</span>
              <input className={field} maxLength={500} value={draft.thank_you || ''} placeholder="Thank you — that helps." onChange={(e) => setDraft({ ...draft, thank_you: e.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={draft.enabled !== false} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />Accepting answers</label>
            <div className="flex gap-2">
              <button onClick={() => save()} disabled={busy} className="h-9 px-4 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">Save</button>
              <button onClick={remove} className="ml-auto h-9 px-3 rounded-lg text-sm text-danger hover:bg-danger/10">Delete survey</button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
