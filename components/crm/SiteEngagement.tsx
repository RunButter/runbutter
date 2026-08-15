'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2, Target, Filter, Radio } from 'lucide-react';
import { rpc } from '@/lib/rpc';
import { useDialog } from '@/components/ui/Dialog';

/**
 * Engagement, goals and funnels for one site.
 *
 * Its own file because the analytics page already owns site creation, the
 * snippet, the KPI row and the geo tables, and a screen that does six things is
 * where the seventh gets bolted on badly. Same reasoning as ObjectCards.
 *
 * ── EVERY NUMBER HERE IS DERIVED, NOT COLLECTED ─────────────────────────────
 * 0120 computes visits from the pageviews already stored, so these appear
 * populated for a site's whole history the day the migration runs — not from
 * zero. Nothing about the snippet had to change for the sessions half.
 *
 * ── IT SAYS "NOT ENABLED" RATHER THAN SHOWING ZEROS ─────────────────────────
 * Before 0120 the functions do not exist. A bounce rate of 0% and "no visits"
 * are indistinguishable on screen and one of them is a lie, so a missing
 * function is reported as a missing function.
 */

interface Bucket { label: string; value: number }
interface Sessions {
  visits: number; visitors: number; pageviews: number;
  views_per_visit: number | null; bounce_rate: number | null; avg_seconds: number | null;
  entry_pages: Bucket[]; exit_pages: Bucket[];
}
interface Goal { id: string; name: string; kind: 'event' | 'path'; match: string; conversions: number; rate: number | null }
interface Funnel { id: string; name: string; goal_ids: string[] }
interface FunnelResult { id: string; name: string; entered: number; steps: { goal_id: string; name: string; visitors: number; rate: number | null }[] }

const duration = (s: number | null) => {
  if (s === null || s === undefined) return '—';
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
};

const isMissing = (e: any) =>
  e?.code === 'PGRST202' || /get_site_sessions|get_site_config|get_site_goals/.test(e?.message || '');

export default function SiteEngagement({ privy, siteId, days }: {
  privy: string | null; siteId: string | null; days: number;
}) {
  const { confirm } = useDialog();
  const [sessions, setSessions] = useState<Sessions | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [visitors, setVisitors] = useState(0);
  const [config, setConfig] = useState<{ funnels: Funnel[]; seen_events: Bucket[] } | null>(null);
  const [funnelId, setFunnelId] = useState<string | null>(null);
  const [funnel, setFunnel] = useState<FunnelResult | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [err, setErr] = useState('');
  // Inline forms rather than a prompt dialog. There is no prompt() primitive in
  // components/ui/Dialog, and the browser's own is banned here — but the better
  // reason is that a goal needs TWO fields and a hint about what a match looks
  // like, which is more than a one-line box can carry honestly.
  const [newGoal, setNewGoal] = useState<{ name: string; match: string } | null>(null);
  const [newFunnel, setNewFunnel] = useState<string | null>(null);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - (days - 1));
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: iso(from), to: iso(to) };
  }, [days]);

  const load = useCallback(async () => {
    if (!privy || !siteId) { setLoading(false); return; }
    setLoading(true); setErr('');
    const args = { p_privy: privy, p_site: siteId, p_from: range.from, p_to: range.to };
    const [s, g, c] = await Promise.all([
      rpc('get_site_sessions', args, { quiet: true }),
      rpc('get_site_goals', args, { quiet: true }),
      rpc('get_site_config', { p_privy: privy, p_site: siteId }, { quiet: true }),
    ]);
    if (isMissing(s.error) || isMissing(c.error)) { setUnavailable(true); setLoading(false); return; }
    setUnavailable(false);
    setSessions((s.data as Sessions) ?? null);
    setGoals(((g.data as any)?.goals as Goal[]) ?? []);
    setVisitors(Number((g.data as any)?.visitors ?? 0));
    setConfig((c.data as any) ?? { funnels: [], seen_events: [] });
    setLoading(false);
  }, [privy, siteId, range]);

  useEffect(() => { load(); }, [load]);

  // The one number worth refreshing on its own — nobody watches a bounce rate
  // change, and everybody watches this one.
  useEffect(() => {
    if (!privy || !siteId || unavailable) return;
    let dead = false;
    const tick = async () => {
      const { data } = await rpc('get_site_realtime', { p_privy: privy, p_site: siteId }, { quiet: true });
      if (!dead) setLive(data ? Number((data as any).current ?? 0) : null);
    };
    tick();
    const t = setInterval(tick, 20000);
    return () => { dead = true; clearInterval(t); };
  }, [privy, siteId, unavailable]);

  useEffect(() => {
    const first = config?.funnels?.[0]?.id ?? null;
    setFunnelId((cur) => (cur && config?.funnels.some((f) => f.id === cur) ? cur : first));
  }, [config]);

  useEffect(() => {
    if (!privy || !siteId || !funnelId) { setFunnel(null); return; }
    let dead = false;
    rpc('get_site_funnel', {
      p_privy: privy, p_site: siteId, p_funnel: funnelId, p_from: range.from, p_to: range.to,
    }, { quiet: true }).then(({ data }) => { if (!dead) setFunnel((data as FunnelResult) ?? null); });
    return () => { dead = true; };
  }, [privy, siteId, funnelId, range]);

  const saveGoal = async () => {
    if (!privy || !siteId || !newGoal) return;
    const { name, match } = newGoal;
    if (!name.trim() || !match.trim()) { setErr('A goal needs a name and something to match.'); return; }
    // A leading slash means a page; anything else is a custom event name. One
    // rule, visible in the hint beside the field, rather than a kind selector
    // nobody would read.
    const kind = match.trim().startsWith('/') ? 'path' : 'event';
    const { error } = await rpc('save_site_goal', {
      p_privy: privy, p_site: siteId, p_id: null, p_name: name.trim(), p_kind: kind, p_match: match.trim(),
    });
    if (error) { setErr(error.message); return; }
    setNewGoal(null); setErr('');
    load();
  };

  const removeGoal = async (g: Goal) => {
    if (!privy || !siteId) return;
    if (!(await confirm({ title: `Delete “${g.name}”?`, body: 'Any funnel using it keeps its other steps.', confirmLabel: 'Delete', danger: true }))) return;
    await rpc('delete_site_goal', { p_privy: privy, p_site: siteId, p_id: g.id });
    load();
  };

  const saveFunnel = async () => {
    if (!privy || !siteId || !newFunnel?.trim()) return;
    // Order IS the funnel, and it is taken from the goals in the order shown on
    // screen — which is the order they were created. Reordering is the next
    // thing this needs; guessing an order would be worse than an obvious one.
    const { error } = await rpc('save_site_funnel', {
      p_privy: privy, p_site: siteId, p_id: null, p_name: newFunnel.trim(),
      p_goal_ids: goals.map((g) => g.id),
    });
    if (error) { setErr(error.message === 'FUNNEL_TOO_SHORT' ? 'A funnel needs at least two goals.' : error.message); return; }
    setNewFunnel(null); setErr('');
    load();
  };

  if (!siteId) return null;

  if (unavailable) {
    return (
      <div className="card-surface p-5">
        <h2 className="text-base font-medium text-primary">Engagement, goals and funnels</h2>
        <p className="mt-1 text-2xs text-tertiary">
          Not enabled on this server yet — migration 0120 has not been applied. Once it is, visits,
          bounce rate and visit duration appear for this site&rsquo;s whole history, computed from the
          pageviews already stored. Nothing needs re-collecting.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-primary">Engagement</h2>
            <p className="mt-0.5 text-2xs text-tertiary">
              A visit is a run of pageviews with no gap over 30 minutes. A bounce is a visit with one page.
            </p>
          </div>
          {live !== null && (
            <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-success/10 text-success text-2xs font-semibold">
              <Radio className="w-3 h-3" /> {live} now
            </span>
          )}
        </div>

        {loading ? <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-tertiary" /></div> : (
          <>
            <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Mini label="Visits" value={sessions ? sessions.visits.toLocaleString() : '—'} />
              <Mini label="Views per visit" value={sessions?.views_per_visit != null ? String(sessions.views_per_visit) : '—'} />
              <Mini label="Bounce rate" value={sessions?.bounce_rate != null ? `${sessions.bounce_rate}%` : '—'}
                sub={sessions?.bounce_rate == null ? 'no visits yet' : undefined} />
              <Mini label="Visit duration" value={duration(sessions?.avg_seconds ?? null)}
                sub="bounces included" />
            </div>

            <div className="mt-4 grid sm:grid-cols-2 gap-4">
              <PageList title="Entry pages" note="Where visits start" rows={sessions?.entry_pages ?? []} />
              <PageList title="Exit pages" note="Where they end" rows={sessions?.exit_pages ?? []} />
            </div>
          </>
        )}
      </div>

      <div className="card-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-primary inline-flex items-center gap-1.5">
              <Target className="w-4 h-4 text-tertiary" /> Goals
            </h2>
            <p className="mt-0.5 text-2xs text-tertiary">
              Counted once per visitor, so a form submitted three times is one conversion.
            </p>
          </div>
          <button onClick={() => { setNewGoal({ name: '', match: '' }); setErr(''); }}
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-2xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken">
            <Plus className="w-3 h-3" /> Goal
          </button>
        </div>

        {err && <p className="mt-2 text-2xs text-danger">{err}</p>}

        {newGoal && (
          <form onSubmit={(e) => { e.preventDefault(); saveGoal(); }}
            className="mt-3 rounded-lg bg-surface-sunken ring-1 ring-subtle p-3 flex flex-col sm:flex-row gap-2 sm:items-end">
            <label className="flex-1 min-w-0">
              <span className="text-2xs text-secondary">Name</span>
              <input value={newGoal.name} onChange={(e) => setNewGoal({ ...newGoal, name: e.target.value })}
                autoFocus placeholder="Signed up" aria-label="Goal name"
                className="mt-1 w-full h-8 px-2 rounded-md bg-surface ring-1 ring-subtle text-xs text-primary" />
            </label>
            <label className="flex-1 min-w-0">
              <span className="text-2xs text-secondary">Page or event</span>
              <input value={newGoal.match} onChange={(e) => setNewGoal({ ...newGoal, match: e.target.value })}
                placeholder="/thanks   ·   /blog/*   ·   Signup" aria-label="Page path or event name"
                className="mt-1 w-full h-8 px-2 rounded-md bg-surface ring-1 ring-subtle text-xs text-primary font-mono" />
            </label>
            <div className="flex gap-1.5">
              <button type="submit" className="h-8 px-3 rounded-md text-xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">Add</button>
              <button type="button" onClick={() => { setNewGoal(null); setErr(''); }}
                className="h-8 px-3 rounded-md text-xs text-secondary hover:bg-surface-hover">Cancel</button>
            </div>
          </form>
        )}
        {newGoal && (
          <p className="mt-1.5 text-3xs text-tertiary">
            Starts with <code className="text-secondary">/</code> → a page, and <code className="text-secondary">*</code> matches
            anything. Otherwise it is the name you pass to <code className="text-secondary">runbutter(&apos;…&apos;)</code>.
          </p>
        )}

        {goals.length === 0 ? (
          <div className="mt-3">
            <p className="text-2xs text-tertiary">
              No goals yet. A goal is a path (<code className="text-secondary">/thanks</code>,{' '}
              <code className="text-secondary">/blog/*</code>) or a custom event your site sends with{' '}
              <code className="text-secondary">runbutter(&apos;Signup&apos;)</code>.
            </p>
            {(config?.seen_events?.length ?? 0) > 0 && (
              <p className="mt-2 text-2xs text-secondary">
                Events already arriving: {config!.seen_events.map((e) => e.label).join(', ')}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-3 divide-y divide-subtle">
            {goals.map((g) => (
              <div key={g.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-primary truncate">{g.name}</p>
                  <p className="text-3xs text-tertiary truncate">
                    {g.kind === 'path' ? 'page' : 'event'} · <code>{g.match}</code>
                  </p>
                </div>
                <span className="text-xs font-semibold text-primary tabular-nums">{g.conversions.toLocaleString()}</span>
                <span className="text-2xs text-tertiary tabular-nums w-14 text-right">
                  {g.rate != null ? `${g.rate}%` : '—'}
                </span>
                <button onClick={() => removeGoal(g)} aria-label={`Delete ${g.name}`}
                  className="p-1.5 rounded-md text-tertiary hover:text-danger hover:bg-surface-hover">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <p className="pt-2 text-3xs text-tertiary">Rate is against {visitors.toLocaleString()} visitors in this period.</p>
          </div>
        )}
      </div>

      <div className="card-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium text-primary inline-flex items-center gap-1.5">
              <Filter className="w-4 h-4 text-tertiary" /> Funnels
            </h2>
            <p className="mt-0.5 text-2xs text-tertiary">
              Each step counts only visitors who reached it <em>after</em> the one before, so the numbers can only fall.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(config?.funnels?.length ?? 0) > 1 && (
              <select value={funnelId ?? ''} onChange={(e) => setFunnelId(e.target.value)} aria-label="Funnel"
                className="h-7 px-2 rounded-md bg-surface-sunken ring-1 ring-subtle text-2xs text-primary">
                {config!.funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}
            <button onClick={() => { setNewFunnel(''); setErr(''); }} disabled={goals.length < 2}
              title={goals.length < 2 ? 'Add at least two goals first' : undefined}
              className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-2xs font-semibold text-secondary ring-1 ring-subtle hover:bg-surface-sunken disabled:opacity-40">
              <Plus className="w-3 h-3" /> Funnel
            </button>
          </div>
        </div>

        {newFunnel !== null && (
          <form onSubmit={(e) => { e.preventDefault(); saveFunnel(); }}
            className="mt-3 rounded-lg bg-surface-sunken ring-1 ring-subtle p-3 flex gap-2 items-end">
            <label className="flex-1 min-w-0">
              <span className="text-2xs text-secondary">Name</span>
              <input value={newFunnel} onChange={(e) => setNewFunnel(e.target.value)} autoFocus
                placeholder="Signup funnel" aria-label="Funnel name"
                className="mt-1 w-full h-8 px-2 rounded-md bg-surface ring-1 ring-subtle text-xs text-primary" />
            </label>
            <button type="submit" className="h-8 px-3 rounded-md text-xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">Create</button>
            <button type="button" onClick={() => { setNewFunnel(null); setErr(''); }}
              className="h-8 px-3 rounded-md text-xs text-secondary hover:bg-surface-hover">Cancel</button>
          </form>
        )}
        {newFunnel !== null && (
          <p className="mt-1.5 text-3xs text-tertiary">
            Steps are your goals in the order listed above: {goals.map((g) => g.name).join(' → ')}
          </p>
        )}

        {!funnel ? (
          <p className="mt-3 text-2xs text-tertiary">
            No funnel yet. Add two or more goals in the order people should hit them, then create a funnel from them.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {funnel.steps.map((s, i) => {
              const prev = i > 0 ? funnel.steps[i - 1].visitors : s.visitors;
              const dropped = prev - s.visitors;
              return (
                <div key={`${s.goal_id}-${i}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-2xs text-tertiary tabular-nums w-4">{i + 1}</span>
                    <span className="text-xs text-primary flex-1 min-w-0 truncate">{s.name}</span>
                    <span className="text-xs font-semibold text-primary tabular-nums">{s.visitors.toLocaleString()}</span>
                    <span className="text-2xs text-tertiary tabular-nums w-12 text-right">{s.rate != null ? `${s.rate}%` : '—'}</span>
                  </div>
                  <div className="mt-1 ml-6 h-2 rounded-full bg-surface-hover overflow-hidden">
                    <div className="h-full bg-accent rounded-full transition-all duration-300"
                      style={{ width: `${s.rate ?? 0}%` }} />
                  </div>
                  {/* The drop-off is the number anybody is actually looking for;
                      making people subtract two figures is the commonest way a
                      funnel chart wastes its own space. */}
                  {i > 0 && dropped > 0 && (
                    <p className="mt-0.5 ml-6 text-3xs text-tertiary">
                      {dropped.toLocaleString()} dropped off here
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-surface-sunken ring-1 ring-subtle p-3">
      <p className="text-2xs text-tertiary">{label}</p>
      <p className="mt-0.5 text-base font-medium text-primary tabular-nums">{value}</p>
      {sub && <p className="text-3xs text-tertiary">{sub}</p>}
    </div>
  );
}

function PageList({ title, note, rows }: { title: string; note: string; rows: Bucket[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      <h3 className="text-2xs font-semibold text-secondary">{title}</h3>
      <p className="text-3xs text-tertiary">{note}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-2xs text-tertiary">No visits in this period.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          {rows.map((r) => (
            <div key={r.label} className="relative flex items-center gap-2 h-6 px-2 rounded-md overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-accent/10 rounded-md"
                style={{ width: `${(r.value / max) * 100}%` }} />
              <span className="relative text-2xs text-secondary flex-1 min-w-0 truncate">{r.label}</span>
              <span className="relative text-2xs text-primary tabular-nums shrink-0">{r.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
