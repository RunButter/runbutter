'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Check, Loader2, Plus, X } from 'lucide-react';
import AppLoading from '@/components/ui/AppLoading';
import { useDialog } from '@/components/ui/Dialog';
import TimeOffSettings from '@/components/time/TimeOffSettings';
import { getWorkspace } from '@/lib/crm/data';
import { cn } from '@/lib/utils';
import { leaveDays, localDay } from '@/lib/time/units';
import { leaveAction, loadTimeOff, type LeaveRequest, type TimeOff } from '@/lib/time/client';

/**
 * HR → Time & leave → Time off (0136). What everyone sees: their balance per
 * type, a form to ask, their requests, and who on the team is off. What
 * owners/admins also see: requests waiting for them, and the settings —
 * country holidays, the work week, the types and each person's allowance.
 *
 * The working-day count under the form is a PREVIEW (lib/time/units.ts); the
 * number stored is computed in SQL from the same rule. Sick leave's type is
 * visible only to the person and to admins — SQL decides, not this screen.
 */

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const span = (r: { start_date: string; end_date: string }) => (r.start_date === r.end_date ? fmt(r.start_date) : `${fmt(r.start_date)} – ${fmt(r.end_date)}`);
const num = (n: number) => (Number.isInteger(+n) ? String(+n) : (+n).toFixed(1));
const STATUS: Record<string, string> = { pending: 'bg-warning/10 text-warning', approved: 'bg-success/10 text-success', rejected: 'bg-danger/10 text-danger', cancelled: 'bg-surface-hover text-tertiary' };

export default function TimeOffPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const dialog = useDialog();
  const [ws, setWs] = useState<string | null>(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [d, setD] = useState<TimeOff | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ type_id: string; start_date: string; end_date: string; half_start: boolean; half_end: boolean; note: string; user: string; force: boolean } | null>(null);
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    if (!privy || !ws) return;
    const r = await loadTimeOff(privy, ws, year);
    if (r.error) setError(r.error); else { setD(r.data!); setError(''); }
  }, [privy, ws, year]);
  useEffect(() => { if (privy) getWorkspace(privy).then((w) => w?.id ? setWs(w.id) : setError('No workspace found.')); }, [privy]);
  useEffect(() => { reload(); }, [reload]);

  const holidays = useMemo(() => new Set((d?.holidays || []).map((h) => h.day)), [d]);

  if (!ready) return <AppLoading />;
  if (!privy) return <div className="page-pad text-sm text-tertiary">Sign in to see time off.</div>;
  if (!d) return error ? <div className="page-pad text-sm text-danger">{error}</div> : <AppLoading />;

  const activeTypes = d.types.filter((t) => !t.archived);
  const forUser = form?.user || privy;
  const balancesFor = (u: string) => (u === privy ? d.balances : d.people?.find((p) => p.user === u)?.balances || []);
  const preview = form ? leaveDays(form.start_date, form.end_date || form.start_date, form.half_start, form.half_end, d.settings.work_days, holidays) : 0;
  const bal = form ? balancesFor(forUser).find((b) => b.type_id === form.type_id) : null;
  const left = bal && bal.allowance != null ? bal.allowance - bal.used - bal.pending : null;
  const over = left != null && preview > left;
  const type = form ? d.types.find((t) => t.id === form.type_id) : null;

  const openForm = () => {
    const t = localDay();
    setForm({ type_id: activeTypes[0]?.id || '', start_date: t, end_date: t, half_start: false, half_end: false, note: '', user: '', force: false });
    setNotice(''); setError('');
  };
  const submit = async () => {
    if (!form || !ws) return;
    setBusy(true); setError('');
    const r = await leaveAction({ action: 'request', workspaceId: ws, data: { ...form, end_date: form.end_date || form.start_date, user: form.user || undefined } });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setNotice(r.data?.request?.status === 'approved' ? 'Booked. It is on the calendar.' : 'Sent. You will get an email when it is decided.');
    setForm(null);
    reload();
  };
  const decide = async (r: LeaveRequest, status: 'approved' | 'rejected') => {
    if (status === 'rejected') {
      const ok = await dialog.confirm({ title: `Decline ${r.name}'s request?`, body: `${r.type} · ${span(r)}. They will get an email.`, confirmLabel: 'Decline', danger: true });
      if (!ok) return;
    }
    setBusy(true);
    const x = await leaveAction({ action: 'decide', id: r.id, status });
    setBusy(false);
    if (x.error) setError(x.error); else reload();
  };
  const withdraw = async (r: LeaveRequest) => {
    const ok = await dialog.confirm({ title: 'Withdraw this time off?', body: `${r.type || 'Time off'} · ${span(r)}`, confirmLabel: 'Withdraw', danger: true });
    if (!ok) return;
    const x = await leaveAction({ action: 'cancel', id: r.id });
    if (x.error) setError(x.error); else reload();
  };

  const field = 'w-full h-9 px-2.5 text-sm rounded-md bg-surface ring-1 ring-subtle shadow-sm outline-none focus:ring-2 focus:ring-accent/30';
  const label = 'block text-xs font-semibold text-secondary mb-1';
  const today = localDay();
  const upcoming = d.team.filter((r) => r.end_date >= today).slice(0, 30);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="h-14 shrink-0 flex items-center gap-2 page-x">
        <h1 className="text-base font-medium text-primary mr-auto">Time off</h1>
        <select aria-label="Year" className="h-8 px-2 text-sm rounded-lg bg-surface ring-1 ring-subtle" value={year} onChange={(e) => setYear(+e.target.value)}>
          {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {!form && (
          <button onClick={openForm} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">
            <Plus className="w-4 h-4" />Request time off</button>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto page-pad space-y-5">
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        {notice && <p className="text-sm text-success flex items-center gap-1.5"><Check className="w-4 h-4" />{notice}</p>}

        {form && (
          <section className="card-surface p-5 space-y-4">
            <div className="flex items-center"><h2 className="text-sm font-medium text-primary">Request time off</h2>
              <button onClick={() => setForm(null)} aria-label="Close" className="ml-auto w-8 h-8 rounded-md flex items-center justify-center text-tertiary hover:bg-surface-hover"><X className="w-4 h-4" /></button></div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {d.is_admin && d.people && (
                <label className="block"><span className={label}>For</span>
                  <select className={field} value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })}>
                    <option value="">Me</option>{d.people.filter((p) => p.user !== privy).map((p) => <option key={p.user} value={p.user}>{p.name}</option>)}
                  </select></label>
              )}
              <label className="block"><span className={label}>Type</span>
                <select className={field} value={form.type_id} onChange={(e) => setForm({ ...form, type_id: e.target.value })}>
                  {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></label>
              <label className="block"><span className={label}>From</span>
                <input type="date" className={field} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value, end_date: form.end_date < e.target.value ? e.target.value : form.end_date })} /></label>
              <label className="block"><span className={label}>To</span>
                <input type="date" className={field} min={form.start_date} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={form.half_start} onChange={(e) => setForm({ ...form, half_start: e.target.checked })} />
                {form.start_date === form.end_date ? 'Half a day' : 'First day: from midday'}</label>
              {form.start_date !== form.end_date && (
                <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={form.half_end} onChange={(e) => setForm({ ...form, half_end: e.target.checked })} />Last day: until midday</label>
              )}
            </div>
            <label className="block"><span className={label}>Note <span className="font-normal text-tertiary">(optional — for whoever approves)</span></span>
              <input className={field} maxLength={1000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            <p className={cn('text-sm', over ? 'text-danger' : 'text-secondary')}>
              {preview === 0 ? 'No working days in those dates.' : `${num(preview)} working day${preview === 1 ? '' : 's'}`}
              {left != null && preview > 0 && ` · ${over ? `only ${num(Math.max(0, left))} left` : `${num(left - preview)} left after this`}`}
              {type && preview > 0 && (d.is_admin || !type.needs_approval ? ' · booked straight away' : ' · needs approval')}
            </p>
            {over && d.is_admin && (
              <label className="flex items-center gap-2 text-sm text-primary"><input type="checkbox" checked={form.force} onChange={(e) => setForm({ ...form, force: e.target.checked })} />Allow going over the allowance</label>
            )}
            <div className="flex gap-2">
              <button onClick={submit} disabled={busy || preview === 0 || (over && !(d.is_admin && form.force))}
                className="h-9 px-4 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90 disabled:opacity-40">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{d.is_admin || !type?.needs_approval ? 'Book it' : 'Send request'}</button>
              <button onClick={() => setForm(null)} className="h-9 px-3 rounded-lg text-sm text-secondary hover:bg-surface-hover">Cancel</button>
            </div>
          </section>
        )}

        {d.is_admin && d.pending && d.pending.length > 0 && (
          <section className="card-surface overflow-hidden ring-2 ring-warning/30">
            <div className="h-11 px-4 flex items-center border-b border-subtle"><h2 className="text-sm font-medium text-primary">Waiting for you · {d.pending.length}</h2></div>
            <ul className="divide-y divide-subtle">
              {d.pending.map((r) => (
                <li key={r.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-primary">{r.name} <span className="text-tertiary">· {r.type}</span></p>
                    <p className="text-xs text-secondary">{span(r)} · {num(r.days)} day{r.days === 1 ? '' : 's'}{r.note ? ` · “${r.note}”` : ''}</p>
                  </div>
                  <button disabled={busy} onClick={() => decide(r, 'approved')} className="h-8 px-3 rounded-lg text-sm font-semibold bg-success text-white disabled:opacity-50">Approve</button>
                  <button disabled={busy} onClick={() => decide(r, 'rejected')} className="h-8 px-3 rounded-lg text-sm ring-1 ring-subtle text-secondary hover:bg-surface-hover">Decline</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {d.balances.map((b) => (
            <div key={b.type_id} className="card-surface p-4">
              <p className="text-xs text-secondary flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: b.color }} />{b.name}</p>
              {b.allowance != null ? (
                <>
                  <p className="mt-1 text-xl text-primary font-medium tabular-nums">{num(b.allowance - b.used)}<span className="text-sm text-tertiary font-normal"> / {num(b.allowance)} left</span></p>
                  <div className="mt-2 h-1.5 rounded-full bg-surface-sunken overflow-hidden flex">
                    <div style={{ width: `${Math.min(100, (b.used / Math.max(b.allowance, 0.5)) * 100)}%`, background: b.color }} />
                    <div style={{ width: `${Math.min(100, (b.pending / Math.max(b.allowance, 0.5)) * 100)}%`, background: b.color, opacity: 0.35 }} />
                  </div>
                </>
              ) : <p className="mt-1 text-xl text-primary font-medium tabular-nums">{num(b.used)}<span className="text-sm text-tertiary font-normal"> taken</span></p>}
              {b.pending > 0 && <p className="mt-1 text-2xs text-warning">{num(b.pending)} waiting for approval</p>}
            </div>
          ))}
        </section>

        <div className="grid lg:grid-cols-2 gap-5 items-start">
          <section className="card-surface overflow-hidden">
            <div className="h-11 px-4 flex items-center border-b border-subtle"><h2 className="text-sm font-medium text-primary">Who is off</h2></div>
            {upcoming.length === 0 ? <p className="px-4 py-4 text-sm text-tertiary">Nobody has time off coming up.</p> : (
              <ul className="divide-y divide-subtle">
                {upcoming.map((r) => (
                  <li key={r.id} className="px-4 py-2.5 flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color || '#a1a1aa' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-primary truncate">{r.name}{r.type ? <span className="text-tertiary"> · {r.type}</span> : null}</p>
                      <p className="text-xs text-secondary">{span(r)} · {num(r.days)} day{r.days === 1 ? '' : 's'}</p>
                    </div>
                    {r.start_date <= today && r.end_date >= today && <span className="text-2xs font-semibold rounded-full px-2 py-0.5 bg-accent/10 text-accent">Off today</span>}
                    {r.status === 'pending' && <span className={cn('text-2xs font-semibold rounded-full px-2 py-0.5', STATUS.pending)}>Pending</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card-surface overflow-hidden">
            <div className="h-11 px-4 flex items-center border-b border-subtle"><h2 className="text-sm font-medium text-primary">My requests</h2></div>
            {d.mine.length === 0 ? <p className="px-4 py-4 text-sm text-tertiary">Nothing requested in {year}.</p> : (
              <ul className="divide-y divide-subtle">
                {d.mine.map((r) => (
                  <li key={r.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-primary">{span(r)} <span className="text-tertiary">· {r.type}</span></p>
                      <p className="text-xs text-secondary">{num(r.days)} day{r.days === 1 ? '' : 's'}{r.decided_by_name ? ` · ${r.status} by ${r.decided_by_name}` : ''}{r.decision_note ? ` · “${r.decision_note}”` : ''}</p>
                    </div>
                    <span className={cn('text-2xs font-semibold rounded-full px-2 py-0.5 capitalize', STATUS[r.status])}>{r.status}</span>
                    {(r.status === 'pending' || (r.status === 'approved' && r.start_date > today)) && (
                      <button onClick={() => withdraw(r)} className="text-xs text-secondary hover:text-danger">Withdraw</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {d.is_admin && ws && <TimeOffSettings privy={privy} ws={ws} data={d} onChange={reload} />}
        {!d.is_admin && d.holidays.length > 0 && (
          <p className="text-xs text-tertiary">Public holidays in {year}: {d.holidays.filter((h) => h.day.startsWith(String(year))).map((h) => `${fmt(h.day)} ${h.name}`).join(' · ')}</p>
        )}
      </div>
    </div>
  );
}
