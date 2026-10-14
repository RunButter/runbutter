'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { Download, FileText, Loader2 } from 'lucide-react';
import AppLoading from '@/components/ui/AppLoading';
import StatCard from '@/components/ui/StatCard';
import { getWorkspace } from '@/lib/crm/data';
import { cn } from '@/lib/utils';
import { addDays, fmtMinutes, hours, localDay, weekStart } from '@/lib/time/units';
import { invoiceEntries, loadTime, type TimeData, type TimeEntry } from '@/lib/time/client';

/**
 * HR → Time & leave → Reports (0136). Hours by person, project or client for a
 * range, and the billable hours nobody has invoiced yet — per client, one
 * button to turn them into a draft invoice (invoice_time_entries: one
 * transaction, so an hour is never billed twice). Members see their own time;
 * owners/admins see everyone's.
 */

type Group = 'person' | 'project' | 'client';
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const monthEnd = (d: string) => { const x = new Date(`${d.slice(0, 7)}-01T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1); x.setUTCDate(0); return x.toISOString().slice(0, 10); };
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  // A cell that starts like a formula is CSV injection in someone's Excel.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export default function TimeReportsPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [ws, setWs] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const today = localDay();
  const [range, setRange] = useState({ from: monthStart(today), to: monthEnd(today) });
  const [group, setGroup] = useState<Group>('project');
  const [data, setData] = useState<TimeData | null>(null);
  const [error, setError] = useState('');
  const [bill, setBill] = useState<{ company: string; rate: string; group: 'project' | 'entry' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ id: string; number: string; total: number; hours: number } | null>(null);

  const reload = useCallback(async () => {
    if (!privy || !ws) return;
    // Owners/admins read everyone's; a member asks for their own ('*' would be refused in SQL).
    const r = await loadTime(privy, ws, range.from, range.to, admin ? '*' : null);
    if (r.error) setError(r.error); else { setData(r.data!); setError(''); }
  }, [privy, ws, range, admin]);
  useEffect(() => {
    if (privy) getWorkspace(privy).then((w) => {
      if (!w?.id) { setError('No workspace found.'); return; }
      setAdmin(w.role === 'owner' || w.role === 'admin');
      setWs(w.id);
    });
  }, [privy]);
  useEffect(() => { reload(); }, [reload]);

  const entries = data?.entries || [];
  const minutesOf = (e: TimeEntry) => e.running_minutes ?? e.minutes;
  const amountOf = (e: TimeEntry) => (e.billable && e.rate != null ? (minutesOf(e) / 60) * e.rate : 0);
  const rows = useMemo(() => {
    const m = new Map<string, { label: string; color?: string | null; minutes: number; billable: number; amount: number }>();
    for (const e of entries) {
      const key = group === 'person' ? e.privy_user_id : group === 'project' ? e.project_id || '' : e.company_id || '';
      const label = group === 'person' ? e.name : group === 'project' ? e.project || 'No project' : e.company || 'No client';
      const r = m.get(key) || { label, color: group === 'project' ? e.project_color : null, minutes: 0, billable: 0, amount: 0 };
      r.minutes += minutesOf(e); if (e.billable) r.billable += minutesOf(e); r.amount += amountOf(e);
      m.set(key, r);
    }
    return [...m.values()].sort((a, b) => b.minutes - a.minutes);
  }, [entries, group]);
  // Unbilled: billable, has a client, not invoiced, not running.
  const unbilled = useMemo(() => {
    const m = new Map<string, { company: string; name: string; ids: string[]; minutes: number; amount: number; noRate: number }>();
    for (const e of entries) {
      if (!e.billable || !e.company_id || e.invoice_id || e.timer_started_at || e.minutes <= 0) continue;
      const r = m.get(e.company_id) || { company: e.company_id, name: e.company || 'Client', ids: [], minutes: 0, amount: 0, noRate: 0 };
      r.ids.push(e.id); r.minutes += e.minutes; r.amount += amountOf(e); if (e.rate == null) r.noRate++;
      m.set(e.company_id, r);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount || b.minutes - a.minutes);
  }, [entries]);
  const billableNoClient = entries.filter((e) => e.billable && !e.company_id && !e.invoice_id).length;

  if (!ready) return <AppLoading />;
  if (!privy) return <div className="page-pad text-sm text-tertiary">Sign in to see time reports.</div>;

  const totalMin = entries.reduce((s, e) => s + minutesOf(e), 0);
  const billMin = entries.filter((e) => e.billable).reduce((s, e) => s + minutesOf(e), 0);
  const billAmt = entries.reduce((s, e) => s + amountOf(e), 0);
  const unbilledAmt = unbilled.reduce((s, u) => s + u.amount, 0);
  const presets: [string, { from: string; to: string }][] = [
    ['This week', { from: weekStart(today), to: addDays(weekStart(today), 6) }],
    ['Last week', { from: addDays(weekStart(today), -7), to: addDays(weekStart(today), -1) }],
    ['This month', { from: monthStart(today), to: monthEnd(today) }],
    ['Last month', { from: monthStart(addDays(monthStart(today), -1)), to: monthEnd(addDays(monthStart(today), -1)) }],
  ];

  const exportCsv = () => {
    const head = ['Date', 'Person', 'Hours', 'Description', 'Project', 'Client', 'Billable', 'Rate', 'Amount', 'Invoice'];
    const lines = entries.map((e) => [e.day, e.name, hours(minutesOf(e)), e.description, e.project, e.company, e.billable ? 'yes' : 'no', e.rate ?? '', amountOf(e) ? amountOf(e).toFixed(2) : '', e.invoice_number || ''].map(csvCell).join(','));
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `time-${range.from}-${range.to}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const createInvoice = async () => {
    if (!bill || !ws) return;
    const u = unbilled.find((x) => x.company === bill.company);
    if (!u) return;
    setBusy(true); setError('');
    const r = await invoiceEntries(privy, ws, u.company, u.ids, bill.rate ? Number(bill.rate) : null, bill.group);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    setMade({ id: r.data!.invoice_id, number: r.data!.number, total: r.data!.total, hours: r.data!.hours });
    setBill(null);
    reload();
  };

  const field = 'h-8 px-2 text-sm rounded-lg bg-surface ring-1 ring-subtle outline-none focus:ring-2 focus:ring-accent/30';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="h-14 shrink-0 flex items-center gap-2 page-x">
        <h1 className="text-base font-medium text-primary mr-auto">Time reports</h1>
        <button onClick={exportCsv} disabled={!entries.length} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm ring-1 ring-subtle text-secondary hover:bg-surface-hover disabled:opacity-40"><Download className="w-4 h-4" />CSV</button>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto page-pad space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {presets.map(([l, r]) => (
            <button key={l} onClick={() => setRange(r)} className={cn('h-8 px-3 rounded-lg text-sm', range.from === r.from && range.to === r.to ? 'bg-inverse text-inverse-fg' : 'ring-1 ring-subtle text-secondary hover:bg-surface-hover')}>{l}</button>
          ))}
          <input type="date" aria-label="From" className={field} value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
          <span className="text-tertiary text-sm">–</span>
          <input type="date" aria-label="To" className={field} value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
          {data && <span className="text-xs text-tertiary">{data.is_admin ? 'Everyone' : 'Your time'}</span>}
        </div>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        {made && (
          <p className="text-sm text-success flex flex-wrap items-center gap-2"><FileText className="w-4 h-4" />Draft invoice {made.number} — {made.hours} h, {money(made.total)}.
            <Link href={`/documents/${made.id}`} className="underline">Open it</Link></p>
        )}

        {!data ? <AppLoading /> : (
          <>
            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Hours" value={fmtMinutes(totalMin)} />
              <StatCard label="Billable" value={fmtMinutes(billMin)} />
              <StatCard label="Billable amount" value={money(billAmt)} />
              <StatCard label="Not invoiced yet" value={money(unbilledAmt)} />
            </section>

            {unbilled.length > 0 && (
              <section className="card-surface overflow-hidden">
                <div className="h-11 px-4 flex items-center border-b border-subtle"><h2 className="text-sm font-medium text-primary">Ready to invoice</h2></div>
                <ul className="divide-y divide-subtle">
                  {unbilled.map((u) => (
                    <li key={u.company} className="px-4 py-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <p className="min-w-0 flex-1 text-sm text-primary">{u.name}</p>
                        <span className="text-sm tabular-nums text-secondary">{fmtMinutes(u.minutes)} h</span>
                        <span className="text-sm tabular-nums text-primary">{money(u.amount)}{u.noRate ? <span className="text-warning"> + {u.noRate} without a rate</span> : null}</span>
                        {bill?.company !== u.company && (
                          <button onClick={() => { setBill({ company: u.company, rate: '', group: 'project' }); setMade(null); }}
                            className="h-8 px-3 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse hover:bg-inverse/90">Create invoice</button>
                        )}
                      </div>
                      {bill?.company === u.company && (
                        <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-surface-sunken">
                          {u.noRate > 0 && <input autoFocus aria-label="Rate for entries without one" inputMode="decimal" placeholder="Rate/h for the rest" className={cn(field, 'w-40')}
                            value={bill.rate} onChange={(e) => setBill({ ...bill, rate: e.target.value.replace(/[^0-9.]/g, '') })} />}
                          <select aria-label="Lines" className={field} value={bill.group} onChange={(e) => setBill({ ...bill, group: e.target.value as any })}>
                            <option value="project">One line per project</option><option value="entry">One line per entry</option>
                          </select>
                          <button onClick={createInvoice} disabled={busy || (u.noRate > 0 && !Number(bill.rate))}
                            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-inverse-fg bg-inverse disabled:opacity-40">
                            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Create draft</button>
                          <button onClick={() => setBill(null)} className="h-8 px-3 rounded-lg text-sm text-secondary hover:bg-surface-hover">Cancel</button>
                          <span className="text-2xs text-tertiary w-full">A draft invoice for {u.name}; the hours are marked as billed. Delete the invoice to un-bill them.</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {billableNoClient > 0 && <p className="text-xs text-warning">{billableNoClient} billable entr{billableNoClient === 1 ? 'y has' : 'ies have'} no client — set one on the timesheet to invoice {billableNoClient === 1 ? 'it' : 'them'}.</p>}

            <section className="card-surface overflow-hidden">
              <div className="h-11 px-4 flex items-center gap-2 border-b border-subtle">
                <h2 className="text-sm font-medium text-primary mr-auto">Breakdown</h2>
                {(['project', 'client', 'person'] as Group[]).filter((g) => g !== 'person' || data.is_admin).map((g) => (
                  <button key={g} onClick={() => setGroup(g)} className={cn('h-7 px-2.5 rounded-md text-xs capitalize', group === g ? 'bg-inverse text-inverse-fg' : 'text-secondary hover:bg-surface-hover')}>{g}</button>
                ))}
              </div>
              {rows.length === 0 ? <p className="px-4 py-4 text-sm text-tertiary">No time in this range.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-tertiary"><th className="px-4 py-2 font-normal">{group === 'person' ? 'Person' : group === 'project' ? 'Project' : 'Client'}</th>
                    <th className="px-4 py-2 font-normal text-right">Hours</th><th className="px-4 py-2 font-normal text-right max-sm:hidden">Billable</th><th className="px-4 py-2 font-normal text-right">Amount</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.label} className="border-t border-subtle">
                        <td className="px-4 py-2 text-primary"><span className="flex items-center gap-2 min-w-0">{r.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />}<span className="truncate">{r.label}</span></span></td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtMinutes(r.minutes)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-secondary max-sm:hidden">{fmtMinutes(r.billable)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.amount ? money(r.amount) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
