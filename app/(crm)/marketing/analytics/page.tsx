'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Globe, Users, Eye, Activity, Copy, Check, Plus, Loader2 } from 'lucide-react';
import { loadSites, createSite, loadSiteStats, type Site, type SiteStats } from '@/lib/crm/data';

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
  const [adding, setAdding] = useState(false);
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const refreshSites = useCallback(async () => {
    const res = await loadSites(privy);
    setSites(res.sites);
    setSiteId((cur) => cur && res.sites.some((s) => s.id === cur) ? cur : (res.sites[0]?.id ?? null));
  }, [privy]);

  useEffect(() => { if (ready) refreshSites(); }, [ready, refreshSites]);
  useEffect(() => {
    if (!ready) return;
    loadSiteStats(privy, siteId, days).then(setStats);
  }, [ready, privy, siteId, days]);

  const addSite = async () => {
    if (!privy) { setError('Sign in to add a website.'); return; }
    if (!domain.trim()) { setError('Enter your website domain.'); return; }
    setBusy(true); setError('');
    const res = await createSite(privy, domain.trim());
    setBusy(false);
    if (res.error) { setError(res.error.includes('create_site') ? 'Run migration 0027 first.' : res.error); return; }
    setDomain(''); setAdding(false);
    await refreshSites();
    if (res.id) setSiteId(res.id);
  };

  const copySnippet = async () => {
    try { await navigator.clipboard.writeText(snippetFor(siteId || 'YOUR_SITE_ID')); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  const site = sites.find((s) => s.id === siteId) || null;
  const live = stats?.live_flag ?? false;
  const maxPv = useMemo(() => Math.max(1, ...(stats?.series || []).map((p) => p.pageviews)), [stats]);
  const avgDay = stats && stats.series.length ? Math.round(stats.pageviews / stats.series.length) : 0;

  const cards = stats ? [
    { label: 'Pageviews', value: stats.pageviews.toLocaleString(), sub: `~${avgDay}/day`, icon: Eye, tone: 'text-slate-800' },
    { label: 'Unique visitors', value: stats.visitors.toLocaleString(), sub: 'daily-rotating, cookieless', icon: Users, tone: 'text-emerald-600' },
    { label: 'Live now', value: String(stats.live), sub: 'last 5 minutes', icon: Activity, tone: 'text-fuchsia-600' },
  ] : [];

  return (
    <>
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-slate-200/70">
        <h1 className="text-sm font-bold text-slate-800">Web analytics</h1>
        <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${live ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{live ? 'Live' : 'Sample'}</span>
        {sites.length > 1 && (
          <select value={siteId || ''} onChange={(e) => setSiteId(e.target.value)}
            className="h-7 px-2 text-[12px] rounded-md bg-white ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-primary-500">
            {sites.map((s) => <option key={s.id} value={s.id}>{s.domain}</option>)}
          </select>
        )}
        {site && <span className="text-[12px] text-slate-400">{site.domain}</span>}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 ring-1 ring-slate-200/60">
            {PERIODS.map((p) => (
              <button key={p.label} onClick={() => setDays(p.days)}
                className={`h-6 px-2.5 rounded-md text-[11px] font-bold transition-colors ${days === p.days ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>{p.label}</button>
            ))}
          </div>
          <button onClick={() => setAdding((a) => !a)}
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-bold text-white bg-primary-600 hover:bg-primary-700"><Plus className="w-3.5 h-3.5" /> Add website</button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {!stats ? (
          <div className="h-40 flex items-center justify-center text-slate-300"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="max-w-5xl space-y-6">
            {/* Add-site / snippet card */}
            {(adding || sites.length === 0) && (
              <div className="rounded-xl bg-white ring-1 ring-slate-200/60 p-5">
                <div className="flex items-center gap-2 mb-1"><Globe className="w-4 h-4 text-primary-600" /><h2 className="text-sm font-bold text-slate-800">Track a website</h2></div>
                <p className="text-[12px] text-slate-400 mb-4">Add your domain, then paste one line before <code className="text-[11px] bg-slate-100 px-1 rounded">&lt;/body&gt;</code>. Cookieless — no consent banner needed.</p>
                <div className="flex items-center gap-2 mb-4">
                  <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourcompany.com"
                    className="h-9 w-64 px-2.5 text-[13px] rounded-md bg-white ring-1 ring-slate-200 focus:ring-2 focus:ring-primary-500 outline-none" />
                  <button onClick={addSite} disabled={busy || !privy} title={!privy ? 'Sign in to add' : ''}
                    className="h-9 px-3 rounded-md text-[13px] font-bold text-white bg-primary-600 hover:bg-primary-700 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add
                  </button>
                  {error && <span className="text-[12px] text-rose-600">{error}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-[12px] bg-slate-900 text-slate-100 rounded-lg px-3 py-2.5 overflow-x-auto whitespace-nowrap">{snippetFor(siteId || 'YOUR_SITE_ID')}</code>
                  <button onClick={copySnippet} className="h-9 px-2.5 inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            {/* KPI cards */}
            <div className="grid grid-cols-3 gap-3">
              {cards.map((c) => (
                <div key={c.label} className="rounded-xl bg-white ring-1 ring-slate-200/60 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{c.label}</span>
                    <c.icon className="w-4 h-4 text-slate-300" />
                  </div>
                  <div className={`mt-2 text-2xl font-black tabular-nums ${c.tone}`}>{c.value}</div>
                  <div className="text-[11px] font-medium text-slate-400">{c.sub}</div>
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
    </>
  );
}
