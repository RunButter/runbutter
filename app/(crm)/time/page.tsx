'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { ChevronLeft, ChevronRight, DollarSign, Loader2, Pencil, Play, Plus, Square, Trash2 } from 'lucide-react';
import AppLoading from '@/components/ui/AppLoading';
import { useDialog } from '@/components/ui/Dialog';
import { getWorkspace } from '@/lib/crm/data';
import { cn } from '@/lib/utils';
import { addDays, fmtMinutes, localDay, parseDuration, weekStart } from '@/lib/time/units';
import { deleteEntry, loadPickers, loadTime, saveEntry, startTimer, stopTimer, type TimeData, type TimeEntry } from '@/lib/time/client';

/**
 * HR → Time & leave → Timesheet (0136). A timer for "what am I doing now",
 * a week of entries for "what did I do", and the fields that make an hour
 * billable: a project, a client and a rate. Reports turns billable hours into
 * an invoice; this screen only records them.
 *
 * One running timer per person is a database rule, so starting a second one
 * stops the first — on this screen, in another tab, or from the Copilot.
 */

interface Draft { id?: string; day: string; duration: string; description: string; project_id: string; company_id: string; billable: boolean; rate: string }
const blankDraft = (day: string): Draft => ({ day, duration: '', description: '', project_id: '', company_id: '', billable: false, rate: '' });

function Elapsed({ entry }: { entry: TimeEntry }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const secs = entry.minutes * 60 + Math.max(0, Math.floor((now - new Date(entry.timer_started_at || now).getTime()) / 1000));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  return <span className="font-mono tabular-nums">{h}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>;
}

export default function TimesheetPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const dialog = useDialog();
  const [ws, setWs] = useState<string | null>(null);
  const [week, setWeek] = useState(() => weekStart(localDay()));
  const [who, setWho] = useState<string | null>(null);   // null = me
  const [data, setData] = useState<TimeData | null>(null);
  const [pick, setPick] = useState<{ projects: { id: string; name: string }[]; companies: { id: string; name: string }[] }>({ projects: [], companies: [] });
  const [timer, setTimer] = useState({ description: '', project_id: '', company_id: '', billable: false, rate: '' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const reload = useCallback(async () => {
    if (!privy || !ws) return;
    const r = await loadTime(privy, ws, week, addDays(week, 6), who);
    if (r.error) setError(r.error); else { setData(r.data!); setError(''); }
  }, [privy, ws, week, who]);

  useEffect(() => { if (privy) getWorkspace(privy).then((w) => w?.id ? setWs(w.id) : setError('No workspace found.')); }, [privy]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (privy && ws) loadPickers(privy, ws).then(setPick); }, [privy, ws]);

  if (!ready) return <AppLoading />;
  if (!privy) return <div className="page-pad text-sm text-tertiary">Sign in to track time.</div>;

  const mine = !who || who === privy;
  const running = data?.running || null;
  const byDay = (d: string) => (data?.entries || []).filter((e) => e.day === d);
  const total = (list: TimeEntry[]) => list.reduce((s, e) => s + (e.running_minutes ?? e.minutes), 0);
  const weekTotal = total(data?.entries || []);
  const weekBillable = total((data?.entries || []).filter((e) => e.billable));
  const today = localDay();

  const run = async (fn: () => Promise<{ error?: string }>) => {
    setBusy(true); setError('');
    const r = await fn();
    setBusy(false);
    if (r.error) { setError(r.error); return false; }
    await reload();
    return true;
  };
  const start = () => run(() => startTimer(privy, ws!, { ...timer, rate: timer.billable ? timer.rate : '', day: localDay() }));
  const stop = () => run(() => stopTimer(privy, ws!));
  const resume = (e: TimeEntry) => run(() => startTimer(privy, ws!, { id: e.id, day: localDay() }));
  const remove = async (e: TimeEntry) => {
    if (!(await dialog.confirm({ title: 'Delete this time?', body: `${fmtMinutes(e.minutes)}${e.description ? ` — ${e.description}` : ''}`, confirmLabel: 'Delete', danger: true }))) return;
    run(() => deleteEntry(privy, e.id));
  };
  const saveDraft = async () => {
    if (!draft) return;
    const minutes = parseDuration(draft.duration);
    if (minutes === null || minutes <= 0 || minutes > 1440) { setError('Enter a duration like 1:30, 1.5h or 90m.'); return; }
    const ok = await run(() => saveEntry(privy, ws!, {
      ...(draft.id ? { id: draft.id } : { day: draft.day, ...(who && who !== privy ? { user: who } : {}) }),
      day: draft.day, minutes, description: draft.description, project_id: draft.project_id, company_id: draft.company_id,
      billable: draft.billable, rate: draft.billable ? draft.rate : '',
    }));
    if (ok) setDraft(null);
  };
  const edit = (e: TimeEntry) => setDraft({
    id: e.id, day: e.day, duration: fmtMinutes(e.minutes), description: e.description || '', project_id: e.project_id || '',
    company_id: e.company_id || '', billable: e.billable, rate: e.rate != null ? String(e.rate) : '',
  });

  const field = 'h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm outline-none focus:ring-2 focus:ring-accent/30 min-w-0';
  const weekLabel = `${new Date(`${week}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${new Date(`${addDays(week, 6)}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });
  // A function, not a component: defined inside render, a component would
  // remount on every keystroke and close an open dropdown.
  const pickers = (v: { project_id: string; company_id: string }, set: (p: Partial<Draft>) => void) => (
    <>
      <select aria-label="Project" className={cn(field, 'w-full sm:w-40')} value={v.project_id} onChange={(e) => set({ project_id: e.target.value })}>
        <option value="">No project</option>{pick.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <select aria-label="Client" className={cn(field, 'w-full sm:w-40')} value={v.company_id} onChange={(e) => set({ company_id: e.target.value })}>
        <option value="">No client</option>{pick.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </>
  );

  const editor = (d: Draft) => (
    <div className="px-4 py-3 bg-surface-sunken/60 flex flex-wrap items-center gap-2">
      <input autoFocus className={cn(field, 'w-24')} placeholder="1:30" aria-label="Duration" value={d.duration}
        onChange={(e) => setDraft({ ...d, duration: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveDraft(); }} />
      <input className={cn(field, 'flex-1 min-w-[180px]')} placeholder="What was it?" aria-label="Description" maxLength={500} value={d.description}
        onChange={(e) => setDraft({ ...d, description: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveDraft(); }} />
      {pickers(d, (p) => setDraft({ ...d, ...p }))}
      <label className="flex items-center gap-1.5 text-sm text-secondary"><input type="checkbox" checked={d.billable} onChange={(e) => setDraft({ ...d, billable: e.target.checked })} />Billable</label>
      {d.billable && <input className={cn(field, 'w-24')} placeholder="Rate/h" inputMode="decimal" aria-label="Hourly rate" value={d.rate} onChange={(e) => setDraft({ ...d, rate: e.target.value.replace(/[^0-9.]/g, '') })} />}
      <button onClick={saveDraft} disabled={busy} className="h-9 px-3 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">Save</button>
      <button onClick={() => setDraft(null)} className="h-9 px-3 rounded-lg text-sm text-secondary hover:bg-surface-hover">Cancel</button>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="h-14 shrink-0 flex items-center gap-2 page-x">
        <h1 className="text-base font-medium text-primary mr-auto">Timesheet</h1>
        {data?.is_admin && data.people && (
          <select aria-label="Whose time" className="h-8 px-2 text-sm rounded-lg bg-surface ring-1 ring-subtle" value={who || ''} onChange={(e) => { setWho(e.target.value || null); setDraft(null); }}>
            <option value="">My time</option>
            {data.people.filter((p) => p.user !== privy).map((p) => <option key={p.user} value={p.user}>{p.name}</option>)}
          </select>
        )}
        <div className="flex items-center gap-1">
          <button aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))} className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:bg-surface-hover"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => setWeek(weekStart(localDay()))} className="h-8 px-2.5 rounded-lg text-sm text-secondary hover:bg-surface-hover whitespace-nowrap">{weekLabel}</button>
          <button aria-label="Next week" onClick={() => setWeek(addDays(week, 7))} className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:bg-surface-hover"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto page-pad space-y-4">
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}

        {mine && (
          <section className="card-surface p-3 flex flex-wrap items-center gap-2">
            {running ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full bg-danger animate-pulse" aria-hidden />
                <span className="text-lg text-primary"><Elapsed entry={running} /></span>
                <span className="min-w-0 flex-1 text-sm text-secondary truncate">
                  {running.description || 'No description'}{running.project ? ` · ${running.project}` : ''}{running.company ? ` · ${running.company}` : ''}
                </span>
                <button onClick={stop} disabled={busy} className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold bg-danger text-white disabled:opacity-50">
                  <Square className="w-3.5 h-3.5 fill-current" />Stop</button>
              </>
            ) : (
              <>
                <input className={cn(field, 'flex-1 min-w-[200px]')} placeholder="What are you working on?" maxLength={500} value={timer.description}
                  onChange={(e) => setTimer({ ...timer, description: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') start(); }} />
                {pickers(timer, (p) => setTimer({ ...timer, ...(p as any) }))}
                <button type="button" aria-pressed={timer.billable} title="Billable" onClick={() => setTimer({ ...timer, billable: !timer.billable })}
                  className={cn('h-9 w-9 rounded-md flex items-center justify-center ring-1', timer.billable ? 'bg-success/10 text-success ring-success/30' : 'text-tertiary ring-subtle hover:text-secondary')}>
                  <DollarSign className="w-4 h-4" /></button>
                {timer.billable && <input className={cn(field, 'w-24')} placeholder="Rate/h" inputMode="decimal" aria-label="Hourly rate" value={timer.rate} onChange={(e) => setTimer({ ...timer, rate: e.target.value.replace(/[^0-9.]/g, '') })} />}
                <button onClick={start} disabled={busy || !ws} className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}Start</button>
              </>
            )}
          </section>
        )}

        <section className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {days.map((d) => {
            const t = total(byDay(d));
            return (
              <a key={d} href={`#day-${d}`} className={cn('card-surface px-2 py-2 text-center', d === today && 'ring-2 ring-accent/40')}>
                <p className="text-3xs uppercase tracking-wide text-tertiary">{new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })} {+d.slice(8)}</p>
                <p className={cn('text-sm tabular-nums', t ? 'text-primary font-medium' : 'text-tertiary')}>{fmtMinutes(t)}</p>
              </a>
            );
          })}
          <div className="card-surface px-2 py-2 text-center col-span-4 sm:col-span-1">
            <p className="text-3xs uppercase tracking-wide text-tertiary">Week</p>
            <p className="text-sm tabular-nums text-primary font-medium">{fmtMinutes(weekTotal)}</p>
            {weekBillable > 0 && <p className="text-3xs text-success">{fmtMinutes(weekBillable)} billable</p>}
          </div>
        </section>

        {!data ? <AppLoading /> : days.map((d) => {
          const list = byDay(d);
          return (
            <section key={d} id={`day-${d}`} className="card-surface overflow-hidden">
              <div className="h-11 px-4 flex items-center gap-2 border-b border-subtle">
                <h2 className={cn('text-sm', d === today ? 'text-primary font-medium' : 'text-secondary')}>{dayLabel(d)}</h2>
                <span className="text-xs text-tertiary tabular-nums">{list.length ? fmtMinutes(total(list)) : ''}</span>
                <button onClick={() => setDraft(blankDraft(d))} className="ml-auto h-8 px-2.5 inline-flex items-center gap-1 rounded-lg text-xs text-secondary hover:bg-surface-hover"><Plus className="w-3.5 h-3.5" />Add time</button>
              </div>
              {draft && !draft.id && draft.day === d && editor(draft)}
              {list.length === 0 && !(draft && !draft.id && draft.day === d) && <p className="px-4 py-3 text-sm text-tertiary">Nothing logged.</p>}
              <ul className="divide-y divide-subtle">
                {list.map((e) => draft?.id === e.id ? <li key={e.id}>{editor(draft)}</li> : (
                  <li key={e.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-primary truncate">{e.description || <span className="text-tertiary">No description</span>}</p>
                      <p className="text-xs text-tertiary truncate flex items-center gap-1.5">
                        {e.project && <><span className="w-2 h-2 rounded-full shrink-0" style={{ background: e.project_color || '#6366f1' }} />{e.project}</>}
                        {e.company && <span>{e.project ? '· ' : ''}{e.company}</span>}
                        {e.billable && <span className="text-success">· billable{e.rate != null ? ` ${e.rate}/h` : ''}</span>}
                        {e.invoice_number && <Link href={`/documents/${e.invoice_id}`} className="text-accent hover:underline">· on {e.invoice_number}</Link>}
                      </p>
                    </div>
                    <span className={cn('text-sm tabular-nums', e.timer_started_at ? 'text-danger' : 'text-primary')}>
                      {e.timer_started_at ? <Elapsed entry={e} /> : fmtMinutes(e.minutes)}</span>
                    <div className="flex items-center gap-0.5">
                      {mine && !e.timer_started_at && <button aria-label="Continue" title="Continue" onClick={() => resume(e)} className="w-8 h-8 rounded-md flex items-center justify-center text-tertiary hover:text-primary hover:bg-surface-hover"><Play className="w-3.5 h-3.5" /></button>}
                      {!e.invoice_id && !e.timer_started_at && <button aria-label="Edit" onClick={() => edit(e)} className="w-8 h-8 rounded-md flex items-center justify-center text-tertiary hover:text-primary hover:bg-surface-hover"><Pencil className="w-3.5 h-3.5" /></button>}
                      {!e.invoice_id && !e.timer_started_at && <button aria-label="Delete" onClick={() => remove(e)} className="w-8 h-8 rounded-md flex items-center justify-center text-tertiary hover:text-danger hover:bg-surface-hover"><Trash2 className="w-3.5 h-3.5" /></button>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
