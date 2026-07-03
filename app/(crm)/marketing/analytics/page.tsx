'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Globe, Users, Eye, Activity, Copy, Check, Plus, Loader2, Code2, RefreshCw, Smartphone, CheckCircle2, Settings2, Trash2, X } from 'lucide-react';
import { loadSites, createSite, deleteSite, loadSiteStats, type Site, type SiteStats } from '@/lib/crm/data';

const PERIODS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

function snippetFor(siteId: string) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://hirebtr.com';
  return `<script defer src="${origin}/t.js" data-site="${siteId}"></script>`;
}

export default function WebAnalytics() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [stats, setStats] = useState<SiteStats | null>(null);
  const [days, setDays] = useState(30);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [managing, setManaging] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const refreshSites = useCallback(async () => {
    const res = await loadSites(privy);
    setSites(res.sites);
    setSiteId((cur) => cur && res.sites.some((s) => s.id === cur) ? cur : (res.sites[0]?.id ?? null));
  }, [privy]);

  const refreshStats = useCallback(async () => {
    setRefreshing(true);
    const s = await loadSiteStats(privy, siteId, days);
    setStats(s);
    setRefreshing(false);
  }, [privy, siteId, days]);

  useEffect(() => { if (ready) refreshSites(); }, [ready, refreshSites]);
  useEffect(() => { if (ready) refreshStats(); }, [ready, refreshStats]);

  // While the snippet hasn't sent its first pageview, poll so the user sees it
  // flip to live without touching anything.
  const waiting = !!stats?.live_flag && stats.pageviews === 0;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(refreshStats, 12000);
    return () => clearInterval(t);
  }, [waiting, refreshStats]);

  const addSite = async () => {
    if (!privy) { setError('Sign in to add a website.'); return; }
    if (!domain.trim()) { setError('Enter your website domain.'); return; }
    setBusy(true); setError('');
    const res = await createSite(privy, domain.trim());
    setBusy(false);
    if (res.error) { setError(res.error.includes('create_site') ? 'Run migration 0027 first.' : res.error); return; }
    // BUG FIX: keep the card open in a success state so the snippet for the
    // NEW site can be copied — it used to vanish straight into the dashboard.
    setJustAdded(domain.trim());
    setDomain('');
    await refreshSites();
    if (res.id) setSiteId(res.id);
    setSnippetOpen(true);
  };

  const removeSite = async (s: Site) => {
    if (!privy) return;
    if (!confirm(`Remove ${s.domain}? This deletes all its collected analytics — this can't be undone.`)) return;
    setRemovingId(s.id);
    const res = await deleteSite(privy, s.id);
    setRemovingId(null);
    if (res.error) { alert(res.error.includes('FORBIDDEN') ? 'Only an owner/admin can remove a website.' : res.error); return; }
    await refreshSites();
  };

  const copySnippet = async () => {
    try { await navigator.clipboard.writeText(snippetFor(siteId || 'YOUR_SITE_ID')); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  const site = sites.find((s) => s.id === siteId) || null;
  const live = stats?.live_flag ?? false;
  const maxPv = useMemo(() => Math.max(1, ...(stats?.series || []).map((p) => p.pageviews)), [stats]);
  const avgDay = stats && stats.series.length ? Math.round(stats.pageviews / stats.series.length) : 0;
  const deviceTotal = (stats?.desktop || 0) + (stats?.mobile || 0);
  const mobilePct = deviceTotal ? Math.round(((stats?.mobile || 0) / deviceTotal) * 100) : 0;

  const cards = stats ? [
    { label: 'Pageviews', value: stats.pageviews.toLocaleString(), sub: `~${avgDay}/day`, icon: Eye, tone: 'text-slate-800' },
    { label: 'Unique visitors', value: stats.visitors.toLocaleString(), sub: 'daily-rotating, cookieless', icon: Users, tone: 'text-emerald-600' },
    { label: 'Live now', value: String(stats.live), sub: 'last 5 minutes', icon: Activity, tone: 'text-fuchsia-600' },
    { label: 'Mobile share', value: deviceTotal ? `${mobilePct}%` : '—', sub: deviceTotal ? `${(stats.desktop).toLocaleString()} desktop · ${(stats.mobile).toLocaleString()} mobile` : 'needs migration 0029', icon: Smartphone, tone: 'text-sky-600' },
  ] : [];

  const showCard = snippetOpen || sites.length === 0;

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">Web analytics</h1>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{live ? 'Live' : 'Sample'}</span>
        {sites.length > 1 && (
          <select value={siteId || ''} onChange={(e) => { setSiteId(e.target.value); setJustAdded(null); }}
            className="h-7 px-2 text-[12px] rounded-md bg-white ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-primary-500">
            {sites.map((s) => <option key={s.id} value={s.id}>{s.domain}</option>)}
          </select>
        )}
        {sites.length === 1 && site && <span className="text-[12px] text-slate-400">{site.domain}</span>}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 ring-1 ring-slate-200/60">
            {PERIODS.map((p) => (
              <button key={p.label} onClick={() => setDays(p.days)}
                className={`h-6 px-2.5 rounded-md text-[11px] font-bold transition-colors ${days === p.days ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{p.label}</button>
            ))}
          </div>
          <button onClick={refreshStats} title="Refresh"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50">
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          {sites.length > 0 && (
            <>
              <button onClick={() => { setSnippetOpen((o) => !o); setJustAdded(null); }}
                className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
                <Code2 className="w-3.5 h-3.5" /> Snippet
              </button>
              <button onClick={() => setManaging(true)}
                className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
                <Settings2 className="w-3.5 h-3.5" /> Manage
              </button>
            </>
          )}
          <button onClick={() => { setSnippetOpen(true); setJustAdded(null); }}
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-bold text-white bg-primary-600 hover:bg-primary-700"><Plus className="w-3.5 h-3.5" /> Add website</button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {!stats ? (
          <div className="h-40 flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="max-w-5xl space-y-6">
            {/* Add-site / snippet card */}
            {showCard && (
              <div className={`rounded-xl bg-white p-5 ${justAdded ? 'ring-2 ring-emerald-400/60' : 'ring-1 ring-slate-200/60'}`}>
                {justAdded ? (
                  <div className="flex items-center gap-2 mb-1"><CheckCircle2 className="w-4 h-4 text-emerald-500" /><h2 className="text-sm font-bold text-slate-800">{justAdded} added — one step left</h2></div>
                ) : (
                  <div className="flex items-center gap-2 mb-1"><Globe className="w-4 h-4 text-primary-600" /><h2 className="text-sm font-bold text-slate-800">Track a website</h2></div>
                )}
                <p className="text-[12px] text-slate-400 mb-4">
                  {justAdded
                    ? <>Paste this line before <code className="text-[11px] bg-slate-100 px-1 rounded">&lt;/body&gt;</code> on your site — stats appear here within seconds of the first visit.</>
                    : <>Add your domain, then paste one line before <code className="text-[11px] bg-slate-100 px-1 rounded">&lt;/body&gt;</code>. Cookieless — no consent banner needed.</>}
                </p>
                {!justAdded && (
                  <div className="flex items-center gap-2 mb-4">
                    <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourcompany.com"
                      onKeyDown={(e) => { if (e.key === 'Enter') addSite(); }}
                      className="h-9 w-64 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
                    <button onClick={addSite} disabled={busy || !privy} title={!privy ? 'Sign in to add' : ''}
                      className="h-9 px-3 rounded-md text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                      {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add
                    </button>
                    {error && <span className="text-[12px] text-rose-600">{error}</span>}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[12px] bg-slate-900 text-slate-100 rounded-lg px-3 py-2.5 overflow-x-auto whitespace-nowrap">{snippetFor(siteId || 'YOUR_SITE_ID')}</code>
                  <button onClick={copySnippet} className="h-9 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                {justAdded && (
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[12px] text-amber-600 inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Waiting for the first pageview — this updates automatically.</span>
                    <button onClick={() => { setJustAdded(null); setSnippetOpen(false); }}
                      className="h-7 px-2.5 rounded-md text-[12px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">Done</button>
                  </div>
                )}
              </div>
            )}

            {/* Waiting-for-data banner (site installed but silent) */}
            {waiting && !showCard && (
              <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200/70 px-4 py-3 flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                <p className="text-[13px] text-amber-700">No pageviews yet for <b>{site?.domain}</b> — install the snippet (button above) and visit your site. This page refreshes automatically.</p>
              </div>
            )}

            {/* KPI cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {cards.map((c) => (
                <div key={c.label} className="rounded-xl bg-white ring-1 ring-slate-200/60 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{c.label}</span>
                    <c.icon className="w-4 h-4 text-slate-300" />
                  </div>
                  <div className={`mt-2 text-2xl font-black tabular-nums ${c.tone}`}>{c.value}</div>
                  <div className="text-[11px] font-medium text-slate-400 truncate">{c.sub}</div>
                  {c.label === 'Mobile share' && deviceTotal > 0 && (
                    <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden flex">
                      <div className="h-full bg-slate-400" style={{ width: `${100 - mobilePct}%` }} />
                      <div className="h-full bg-sky-400" style={{ width: `${mobilePct}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Daily traffic */}
            <div className="rounded-xl bg-white ring-1 ring-slate-200/60 p-5">
              <h2 className="text-sm font-bold text-slate-800 mb-1">Traffic</h2>
              <p className="text-[12px] text-slate-400 mb-4">Pageviews per day · last {days} days</p>
              <div className="flex items-end gap-[2px] h-40">
                {stats.series.map((p) => (
                  <div key={p.day} className="flex-1 group relative">
                    <div className="w-full rounded-t bg-primary-500/80 group-hover:bg-primary-600 transition-colors"
                      style={{ height: `${Math.max(2, (p.pageviews / maxPv) * 152)}px` }}
                      title={`${p.label} — ${p.pageviews} views · ${p.visitors} visitors`} />
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-1.5 text-[10px] text-slate-400 tabular-nums">
                <span>{stats.series[0]?.label}</span>
                <span>{stats.series[stats.series.length - 1]?.label}</span>
              </div>
            </div>

            {/* Top pages + referrers */}
            <div className="grid md:grid-cols-2 gap-3">
              {([['Top pages', stats.top_pages.map((p) => ({ label: p.path, count: p.count }))],
                 ['Referrers', stats.top_referrers.map((r) => ({ label: r.ref, count: r.count }))]] as const).map(([title, rows]) => {
                const max = Math.max(1, ...rows.map((r) => r.count));
                return (
                  <div key={title} className="rounded-xl bg-white ring-1 ring-slate-200/60 p-5">
                    <h2 className="text-sm font-bold text-slate-800 mb-3">{title}</h2>
                    {rows.length === 0 ? (
                      <p className="py-4 text-center text-[12px] text-slate-400">No data yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {rows.map((r) => (
                          <div key={r.label} className="relative flex items-center justify-between px-2 py-1.5 rounded-md overflow-hidden">
                            <div className="absolute inset-y-0 left-0 bg-primary-50 rounded-md" style={{ width: `${(r.count / max) * 100}%` }} />
                            <span className="relative text-[12px] font-medium text-slate-700 truncate pr-3">{r.label}</span>
                            <span className="relative text-[12px] tabular-nums text-slate-500 shrink-0">{r.count.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Manage websites */}
      {managing && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4" onClick={() => setManaging(false)}>
          <div className="w-full max-w-md flex flex-col bg-white rounded-xl ring-1 ring-slate-200/70 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-slate-200/70">
              <h2 className="text-sm font-bold text-slate-800">Websites</h2>
              <button onClick={() => setManaging(false)} aria-label="Close" className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-2 max-h-[50vh] overflow-y-auto">
              {sites.length === 0 && <p className="text-[13px] text-slate-400 text-center py-4">No websites yet.</p>}
              {sites.map((s) => (
                <div key={s.id} className="flex items-center gap-2.5 rounded-lg ring-1 ring-slate-200/70 px-3 py-2.5">
                  <Globe className="w-4 h-4 text-slate-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-slate-800 truncate">{s.domain}</div>
                    {s.created_at && <div className="text-[11px] text-slate-400">added {new Date(s.created_at).toLocaleDateString()}</div>}
                  </div>
                  <button onClick={() => { setSiteId(s.id); setSnippetOpen(true); setManaging(false); }}
                    className="h-7 px-2 rounded-md text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">Snippet</button>
                  <button onClick={() => removeSite(s)} disabled={removingId === s.id} aria-label="Remove"
                    className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40">
                    {removingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              ))}
            </div>
            <div className="shrink-0 flex items-center gap-2 p-3 border-t border-slate-200/70">
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="add another domain…"
                onKeyDown={(e) => { if (e.key === 'Enter') addSite(); }}
                className="flex-1 h-8 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
              <button onClick={async () => { await addSite(); setManaging(false); }} disabled={busy || !privy}
                className="h-8 px-3 rounded-md text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
              </button>
            </div>
            {error && <p className="px-4 pb-3 text-[12px] text-rose-600">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
