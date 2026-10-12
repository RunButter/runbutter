'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import {
  Radar, Search, Loader2, Phone, Mail, Globe, ExternalLink, Check, Download, MailSearch,
  ChevronDown, AlertCircle, Plus,
} from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import AppLoading from '@/components/ui/AppLoading';
import EmptyState from '@/components/ui/EmptyState';
import { getWorkspace } from '@/lib/crm/data';
import type { CustomObject } from '@/lib/crm/custom';
import { LEAD_CATEGORIES, CATEGORY_BY_KEY } from '@/lib/leads/categories';
import { leadValues, type Enrichment } from '@/lib/leads/fields';
import {
  searchLeads, enrichSites, findLeadsObject, setUpLeads, loadSavedIndex, isSaved,
  saveLead, noteProvenance, toCsv,
} from '@/lib/leads/client';
import type { FoundPlace, GeoPlace, SearchResult } from '@/lib/leads/osm';

/**
 * Find leads — businesses of one kind in one place, ready to save and contact.
 *
 * Search (OpenStreetMap) → optionally read each business's own website for a
 * public email → save the chosen ones into Leads, an ordinary custom object in
 * Sales. Everything after saving — the board by status, mail merge for an
 * offer letter, automations, the Copilot — is the product that already exists.
 * See lib/leads/osm.ts for why the source is OpenStreetMap and not Google.
 */

const RADII = [
  { km: 0, label: 'Whole place' }, { km: 1, label: 'Within 1 km' }, { km: 2, label: 'Within 2 km' },
  { km: 5, label: 'Within 5 km' }, { km: 10, label: 'Within 10 km' }, { km: 25, label: 'Within 25 km' },
  { km: 50, label: 'Within 50 km' },
];
const GROUPS = [...new Set(LEAD_CATEGORIES.map((c) => c.group))];
const LAST = 'rb-leads-last';
const ENRICH_BATCH = 10;
const SAVE_CONCURRENCY = 3;

type Index = { sources: Set<string>; names: Set<string>; count: number };
const EMPTY_INDEX: Index = { sources: new Set(), names: new Set(), count: 0 };

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

export default function FindLeadsPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;

  const [ws, setWs] = useState<{ id: string; role: string } | null>(null);
  const [obj, setObj] = useState<CustomObject | null>(null);
  const [objState, setObjState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupErr, setSetupErr] = useState('');
  const [index, setIndex] = useState<Index>(EMPTY_INDEX);

  const [category, setCategory] = useState('');
  const [where, setWhere] = useState('');
  const [radius, setRadius] = useState(0);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);

  const [enrich, setEnrich] = useState<Record<string, Enrichment>>({});
  const [enriching, setEnriching] = useState<{ done: number; total: number } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [only, setOnly] = useState({ website: false, phone: false, email: false, hideSaved: false });
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  // The last search, so coming back to the screen does not start from nothing.
  useEffect(() => {
    try {
      const l = JSON.parse(localStorage.getItem(LAST) || 'null');
      if (l?.category && CATEGORY_BY_KEY[l.category]) setCategory(l.category);
      if (typeof l?.where === 'string') setWhere(l.where);
      if (Number.isFinite(l?.radius)) setRadius(l.radius);
    } catch { /* first visit */ }
  }, []);

  const refreshIndex = useCallback(async (p: string, w: string) => setIndex(await loadSavedIndex(p, w)), []);

  useEffect(() => {
    if (!privy) { setObjState('missing'); return; }
    let dead = false;
    getWorkspace(privy).then(async (w) => {
      if (!w || dead) return;
      setWs({ id: w.id, role: w.role });
      const { obj: o } = await findLeadsObject(privy, w.id);
      if (dead) return;
      setObj(o);
      setObjState(o ? 'ready' : 'missing');
      if (o) refreshIndex(privy, w.id);
    }).catch(() => setObjState('missing'));
    return () => { dead = true; };
  }, [privy, refreshIndex]);

  const canSetUp = ws?.role === 'owner' || ws?.role === 'admin';

  const setUp = async () => {
    if (!privy || !ws) return;
    setSetupBusy(true); setSetupErr('');
    const r = await setUpLeads(privy, ws.id, obj);
    setSetupBusy(false);
    if (r.error || !r.obj) { setSetupErr(r.error || 'Could not set up Leads.'); return; }
    setObj(r.obj); setObjState('ready');
    refreshIndex(privy, ws.id);
  };

  const run = async (place?: GeoPlace | null) => {
    if (!category) { setError('Pick what kind of business to look for.'); return; }
    if (!place && !where.trim()) { setError('Say where to look — a city, a district or a postcode.'); return; }
    setBusy(true); setError(''); setSaveMsg(null);
    try { localStorage.setItem(LAST, JSON.stringify({ category, where, radius })); } catch { /* private mode */ }
    const r = await searchLeads({ category, where, radiusKm: radius, name, place: place ?? null });
    setBusy(false);
    if ('error' in r) { setError(r.error); return; }
    // Picking an alternative keeps the others on offer, the first guess included.
    if (place && result) {
      const all = [result.place, ...result.alternatives].filter((g) => g.osmId !== place.osmId);
      r.alternatives = all;
    }
    setResult(r); setSelected(new Set()); setEnrich({});
  };

  // ── What is on screen ──────────────────────────────────────────────────────
  const emailOf = (p: FoundPlace) => p.email || enrich[p.ref]?.emails?.[0] || '';
  const phoneOf = (p: FoundPlace) => p.phone || enrich[p.ref]?.phones?.[0] || '';
  const saved = useCallback((p: FoundPlace) => isSaved(index, p), [index]);

  const rows = useMemo(() => (result?.results || []).filter((p) =>
    (!only.website || p.website) && (!only.phone || phoneOf(p)) && (!only.email || emailOf(p)) && (!only.hideSaved || !saved(p)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [result, only, enrich, saved]);

  const stats = useMemo(() => {
    const all = result?.results || [];
    return {
      total: all.length,
      website: all.filter((p) => p.website).length,
      phone: all.filter((p) => phoneOf(p)).length,
      email: all.filter((p) => emailOf(p)).length,
      saved: all.filter((p) => saved(p)).length,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, enrich, saved]);

  const chosen = rows.filter((p) => selected.has(p.ref));
  const allChosen = rows.length > 0 && rows.every((p) => selected.has(p.ref));
  const toggleAll = () => setSelected(allChosen ? new Set() : new Set(rows.map((p) => p.ref)));
  const toggle = (ref: string) => setSelected((s) => { const n = new Set(s); n.has(ref) ? n.delete(ref) : n.add(ref); return n; });

  // ── Read websites for emails ───────────────────────────────────────────────
  const canEnrich = chosen.filter((p) => p.website && !p.email && !enrich[p.ref]);
  const findEmails = async () => {
    const targets = canEnrich;
    if (!targets.length) return;
    setEnriching({ done: 0, total: targets.length });
    setEnrich((e) => {
      const n = { ...e };
      for (const p of targets) n[p.ref] = { state: 'loading', emails: [], phones: [], facebook: '', instagram: '', checked: [] };
      return n;
    });
    for (let i = 0; i < targets.length; i += ENRICH_BATCH) {
      const batch = targets.slice(i, i + ENRICH_BATCH);
      const r = await enrichSites(batch.map((p) => p.website));
      setEnrich((e) => {
        const n = { ...e };
        batch.forEach((p, k) => {
          const got = 'error' in r ? null : r.results[k];
          n[p.ref] = got
            ? { state: 'done', emails: got.emails, phones: got.phones, facebook: got.facebook, instagram: got.instagram, checked: got.checked, note: got.note }
            : { state: 'done', emails: [], phones: [], facebook: '', instagram: '', checked: [], note: 'error' in r ? r.error : 'Could not read this site.' };
        });
        return n;
      });
      setEnriching({ done: Math.min(i + batch.length, targets.length), total: targets.length });
      if ('error' in r) { setError(r.error); break; }
    }
    setEnriching(null);
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const toSave = chosen.filter((p) => !saved(p));
  const save = async () => {
    if (!privy || !ws || !obj || !toSave.length) return;
    setSaveMsg(null);
    setSaving({ done: 0, total: toSave.length });
    let ok = 0, failed = 0, stop = '';
    let next = 0;
    const newSources: string[] = [];
    await Promise.all(Array.from({ length: SAVE_CONCURRENCY }, async () => {
      while (next < toSave.length && !stop) {
        const p = toSave[next++];
        const e = enrich[p.ref];
        const r = await saveLead(privy, ws.id, obj, leadValues(p, e));
        if (r.id) {
          ok++; newSources.push(p.url);
          noteProvenance(privy, ws.id, r.id, p, e).catch(() => {});
        } else if (r.limit) { stop = r.error || 'Your plan’s record limit is reached.'; }
        else failed++;
        setSaving((s) => s && { ...s, done: s.done + 1 });
      }
    }));
    setSaving(null);
    setIndex((ix) => ({ ...ix, sources: new Set([...ix.sources, ...newSources]), count: ix.count + ok }));
    setSelected(new Set());
    if (stop) setSaveMsg({ tone: 'warn', text: `Saved ${ok}. ${stop}` });
    else setSaveMsg({ tone: failed ? 'warn' : 'ok', text: `Saved ${ok} lead${ok === 1 ? '' : 's'}${failed ? `, ${failed} could not be saved` : ''}.` });
  };

  const download = () => {
    const list = chosen.length ? chosen : rows;
    const csv = toCsv(list.map((p) => leadValues(p, enrich[p.ref])));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const cat = CATEGORY_BY_KEY[category]?.key || 'leads';
    a.download = `${cat}-${(result?.place.city || 'area').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (!ready) return <AppLoading label="Opening Find leads…" />;

  const cat = CATEGORY_BY_KEY[category];
  const working = !!enriching || !!saving;

  return (
    <>
      <PageHeader title="Find leads" subtitle="Businesses on the map, ready to contact">
        {obj && (
          <Link href="/objects/leads"
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm text-secondary ring-1 ring-subtle bg-surface hover:bg-surface-hover">
            Your leads <span className="text-tertiary tabular-nums">{index.count}</span>
          </Link>
        )}
      </PageHeader>

      <div className="flex-1 overflow-auto page-pad space-y-4">
        {/* ── Setup ─────────────────────────────────────────────────────── */}
        {privy && objState === 'missing' && (
          <div className="card-surface p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-primary">Save leads into your workspace</p>
              <p className="text-xs text-tertiary mt-0.5">
                Leads you save go into a Leads list under Sales — a table, a board by status, and mail merge for offer letters.
                {canSetUp ? ' Setting it up adds that list once.' : ' Ask an owner or admin to set it up. Until then you can search and download results as CSV.'}
              </p>
              {setupErr && <p className="text-xs text-danger mt-1">{setupErr}</p>}
            </div>
            {canSetUp && (
              <button onClick={setUp} disabled={setupBusy}
                className="h-9 px-3 shrink-0 inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
                {setupBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Set up Leads
              </button>
            )}
          </div>
        )}

        {/* ── Search ────────────────────────────────────────────────────── */}
        <form onSubmit={(e) => { e.preventDefault(); run(); }}
          className="card-surface p-3 sm:p-4 grid gap-2.5 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_auto] sm:items-end">
          <label className="block min-w-0">
            <span className="block text-2xs text-tertiary mb-1">What</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-field" aria-label="Kind of business">
              <option value="">Kind of business…</option>
              {GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {LEAD_CATEGORIES.filter((c) => c.group === g).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="block text-2xs text-tertiary mb-1">Where</span>
            <input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Kraków, a district or a postcode"
              className="input-field" aria-label="Where to look" />
          </label>
          <label className="block min-w-0">
            <span className="block text-2xs text-tertiary mb-1">Area</span>
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="input-field" aria-label="Search area">
              {RADII.map((r) => <option key={r.km} value={r.km}>{r.label}</option>)}
            </select>
          </label>
          <label className="block min-w-0 sm:col-span-2 sm:order-2">
            <span className="block text-2xs text-tertiary mb-1">Name contains <span className="text-tertiary/70">(optional)</span></span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. dental"
              className="input-field !h-9" aria-label="Name contains" />
          </label>
          <button type="submit" disabled={busy || !privy}
            className="sm:order-1 h-10 px-4 inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Search
          </button>
          {!privy && <p className="sm:order-3 sm:col-span-4 text-xs text-tertiary">Sign in to search.</p>}
          {error && <p className="sm:order-3 sm:col-span-4 text-xs text-danger flex items-start gap-1.5"><AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />{error}</p>}
        </form>

        {/* ── Results ───────────────────────────────────────────────────── */}
        {!result && !busy && (
          <div className="card-surface">
            <EmptyState icon={Radar} title="Find businesses to sell to"
              description="Pick a kind of business and a place. You get names, addresses, phones and websites, can find emails on each business’s own website, and save the ones you want as leads." />
          </div>
        )}

        {result && (
          <>
            <div className="space-y-1.5">
              <p className="text-sm text-primary">
                <span className="font-medium tabular-nums">{stats.total}</span> {(cat?.label || 'businesses').toLowerCase()} in{' '}
                <span className="font-medium">{result.place.label.split(',').slice(0, 2).join(',')}</span>
              </p>
              <p className="text-xs text-tertiary">
                {stats.website} with a website · {stats.phone} with a phone · {stats.email} with an email
                {stats.saved > 0 && <> · {stats.saved} already in your leads</>}
                {result.truncated && <> · showing the first {stats.total} — choose a distance to narrow it</>}
              </p>
              {result.note && <p className="text-xs text-warning">{result.note}</p>}
              {result.alternatives.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-2xs text-tertiary">Not this place?</span>
                  {result.alternatives.slice(0, 4).map((g) => (
                    <button key={`${g.osmType}/${g.osmId}`} onClick={() => run(g)} disabled={busy}
                      className="h-6 px-2 rounded-md text-2xs text-secondary ring-1 ring-subtle bg-surface hover:bg-surface-hover max-w-[16rem] truncate">
                      {g.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {saveMsg && (
              <div className={`card-surface px-3 py-2.5 text-sm flex flex-wrap items-center gap-x-3 gap-y-1 ${saveMsg.tone === 'ok' ? 'text-success' : 'text-warning'}`}>
                <span className="flex items-center gap-1.5">{saveMsg.tone === 'ok' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}{saveMsg.text}</span>
                <Link href="/objects/leads" className="text-xs text-accent hover:underline">Open Leads</Link>
                {saveMsg.tone === 'warn' && /plan|limit|upgrade/i.test(saveMsg.text) && (
                  <Link href="/settings/plans" className="text-xs text-accent hover:underline">See plans</Link>
                )}
              </div>
            )}

            <div className="card-surface overflow-hidden">
              {/* Sticky so the actions stay in reach down a list of four hundred,
                  and at the TOP rather than the bottom so they never sit under
                  the copilot button on a phone. */}
              <div className="sticky top-0 z-10 bg-surface border-b border-subtle px-3 sm:px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <label className="inline-flex items-center gap-2 text-xs text-secondary">
                  <input type="checkbox" checked={allChosen} onChange={toggleAll} disabled={!rows.length} className="accent-accent w-4 h-4" />
                  {selected.size ? `${chosen.length} selected` : 'Select all'}
                </label>
                <div className="flex flex-wrap items-center gap-1">
                  {([['website', 'Website'], ['phone', 'Phone'], ['email', 'Email'], ['hideSaved', 'Not saved']] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setOnly((o) => ({ ...o, [k]: !o[k] }))} aria-pressed={only[k]}
                      className={`h-6 px-2 rounded-md text-2xs ring-1 ${only[k] ? 'bg-inverse text-inverse-fg ring-transparent' : 'text-secondary ring-subtle hover:bg-surface-hover'}`}>
                      {k === 'hideSaved' ? label : `Has ${label.toLowerCase()}`}
                    </button>
                  ))}
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <button onClick={findEmails} disabled={!canEnrich.length || working}
                    title="Reads each selected business’s own website for a public email address"
                    className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs text-secondary ring-1 ring-subtle bg-surface hover:bg-surface-hover disabled:opacity-40">
                    {enriching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MailSearch className="w-3.5 h-3.5" />}
                    {enriching ? `Reading websites ${enriching.done}/${enriching.total}` : `Find emails${canEnrich.length ? ` (${canEnrich.length})` : ''}`}
                  </button>
                  <button onClick={download} disabled={!rows.length}
                    className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs text-secondary ring-1 ring-subtle bg-surface hover:bg-surface-hover disabled:opacity-40">
                    <Download className="w-3.5 h-3.5" /> CSV
                  </button>
                  <button onClick={save} disabled={!obj || !toSave.length || working}
                    title={!obj ? 'Set up Leads first' : undefined}
                    className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {saving ? `Saving ${saving.done}/${saving.total}` : `Save to Leads${toSave.length ? ` (${toSave.length})` : ''}`}
                  </button>
                </div>
              </div>

              {rows.length === 0 ? (
                <EmptyState icon={Radar}
                  title={stats.total ? 'Nothing matches these filters' : `No ${(cat?.label || 'businesses').toLowerCase()} found here`}
                  description={stats.total
                    ? 'Turn a filter off to see more.'
                    : 'OpenStreetMap is mapped by volunteers, so coverage varies by place. Try a larger area, a nearby city, or a related kind of business.'} />
              ) : (
                <ul className="divide-y divide-subtle">
                  {rows.map((p) => (
                    <ResultRow key={p.ref} p={p} e={enrich[p.ref]} saved={saved(p)}
                      checked={selected.has(p.ref)} onToggle={() => toggle(p.ref)} />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        <BeforeYouContact />

        <p className="text-2xs text-tertiary">
          Business data ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="underline hover:text-secondary">
            OpenStreetMap contributors
          </a>, available under the Open Database License. Emails are read only from each business’s own website, and only where its robots.txt allows.
        </p>
      </div>
    </>
  );
}

function ResultRow({ p, e, saved, checked, onToggle }: {
  p: FoundPlace; e?: Enrichment; saved: boolean; checked: boolean; onToggle: () => void;
}) {
  const email = p.email || e?.emails?.[0] || '';
  const phone = p.phone || e?.phones?.[0] || '';
  const fromSite = !p.email && !!e?.emails?.[0];
  return (
    <li className={`flex items-start gap-3 px-3 sm:px-4 py-3 ${checked ? 'bg-accent/5' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select ${p.name}`}
        className="accent-accent w-4 h-4 mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-primary truncate">{p.name}</span>
          {saved && <span className="shrink-0 text-3xs font-semibold text-success bg-success/10 rounded px-1.5 py-0.5">Saved</span>}
        </div>
        <p className="text-xs text-tertiary truncate">{[p.category, p.address].filter(Boolean).join(' · ')}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-secondary">
          {phone && <a href={`tel:${phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1 hover:text-primary"><Phone className="w-3 h-3 text-tertiary" />{phone}</a>}
          {email && (
            <a href={`mailto:${email}`} className="inline-flex items-center gap-1 hover:text-primary min-w-0"
              title={fromSite ? `Found on ${e?.checked.join(', ')}` : undefined}>
              <Mail className="w-3 h-3 text-tertiary shrink-0" /><span className="truncate">{email}</span>
              {fromSite && <span className="text-3xs text-tertiary">· from website</span>}
            </a>
          )}
          {p.website && (
            <a href={p.website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 hover:text-primary min-w-0">
              <Globe className="w-3 h-3 text-tertiary shrink-0" /><span className="truncate max-w-[14rem]">{hostOf(p.website)}</span>
            </a>
          )}
          {e?.state === 'loading' && <span className="inline-flex items-center gap-1 text-tertiary"><Loader2 className="w-3 h-3 animate-spin" />Reading website…</span>}
          {e?.state === 'done' && !e.emails.length && e.note && <span className="text-tertiary">{e.note}</span>}
          {!phone && !email && !p.website && <span className="text-tertiary">No contact details on the map</span>}
        </div>
      </div>
      <a href={p.url} target="_blank" rel="noopener noreferrer" title="View on OpenStreetMap" aria-label={`View ${p.name} on OpenStreetMap`}
        className="p-1.5 -m-1 rounded-md text-tertiary hover:text-secondary hover:bg-surface-hover shrink-0">
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </li>
  );
}

/**
 * The rules are the part people get wrong, and they differ by country, so the
 * screen says so plainly rather than implying a found email is a licence to
 * send. Written as a summary with the honest caveat, not as legal advice.
 */
function BeforeYouContact() {
  return (
    <details className="card-surface group">
      <summary className="list-none cursor-pointer px-4 py-3 flex items-center gap-2 text-sm text-primary">
        <AlertCircle className="w-4 h-4 text-tertiary shrink-0" />
        Before you contact them
        <ChevronDown className="w-4 h-4 ml-auto text-tertiary transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 text-xs text-secondary space-y-2 leading-relaxed">
        <p>
          <span className="text-primary">Rules for unsolicited offers differ by country.</span> In Poland, for example, sending an offer by
          email or calling to sell needs the recipient’s prior consent — even when the recipient is a business. In the US, and in the UK for
          limited companies, business email is allowed if every message says who you are and offers a clear way to opt out.
        </p>
        <p>
          A printed letter is allowed almost everywhere. <span className="text-primary">Mail merge</span> in Docs turns one offer into a
          letter for every lead you select.
        </p>
        <p>
          A sole trader’s name and contact details are personal data under GDPR. Keep what you use, delete what you don’t, and if someone
          asks where you got their details, the answer is saved on each lead: open it and look at its notes.
        </p>
        <p className="text-tertiary">This is a summary to point you in the right direction, not legal advice.</p>
      </div>
    </details>
  );
}
