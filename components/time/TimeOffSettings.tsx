'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react';
import { useDialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/utils';
import { HOLIDAY_COUNTRIES, holidaysFor, type Holiday } from '@/lib/time/holidays';
import { deleteLeaveType, saveLeaveSettings, saveLeaveType, setAllowance, setHolidays, type TimeOff } from '@/lib/time/client';

/**
 * Time off settings, owner/admin only (the SQL refuses everyone else): the
 * country's public holidays for a year — COMPUTED in the browser by
 * lib/time/holidays.ts, shown, editable, then saved — the work week, the leave
 * types, and each person's allowance where it differs from the type's.
 */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function TimeOffSettings({ privy, ws, data, onChange }: { privy: string; ws: string; data: TimeOff; onChange: () => void }) {
  const dialog = useDialog();
  const [open, setOpen] = useState(!data.settings.country && data.holidays.length === 0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [country, setCountry] = useState(data.settings.country || '');
  const yearHolidays = useMemo(() => data.holidays.filter((h) => h.day.startsWith(String(data.year))), [data]);
  const [list, setList] = useState<Holiday[] | null>(null);   // unsaved edit of this year's list
  const [add, setAdd] = useState({ day: '', name: '' });
  const [newType, setNewType] = useState('');
  const shown = list ?? yearHolidays;

  const act = async (key: string, fn: () => Promise<{ error?: string }>) => {
    setBusy(key); setError('');
    const r = await fn();
    setBusy('');
    if (r.error) { setError(r.error); return false; }
    onChange();
    return true;
  };
  const loadCountry = async (code: string) => {
    setCountry(code);
    if (!code) return;
    await act('country', () => saveLeaveSettings(privy, ws, { country: code }));
    setList(holidaysFor(code, data.year));
  };
  const saveList = async () => {
    if (await act('holidays', () => setHolidays(privy, ws, data.year, shown))) setList(null);
  };
  const toggleDay = (n: number) => {
    const next = data.settings.work_days.includes(n) ? data.settings.work_days.filter((x) => x !== n) : [...data.settings.work_days, n];
    act('week', () => saveLeaveSettings(privy, ws, { work_days: next }));
  };
  const removeType = async (id: string, name: string) => {
    if (!(await dialog.confirm({ title: `Remove “${name}”?`, body: 'A type somebody has used is archived instead, so their history stays.', confirmLabel: 'Remove', danger: true }))) return;
    act(`type-${id}`, () => deleteLeaveType(privy, id));
  };

  const field = 'h-8 px-2 text-sm rounded-md bg-surface ring-1 ring-subtle outline-none focus:ring-2 focus:ring-accent/30 min-w-0';
  const capped = data.types.filter((t) => !t.archived && t.allowance_days != null);
  const note = HOLIDAY_COUNTRIES.find((c) => c.code === country)?.note;

  return (
    <section className="card-surface overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full h-11 px-4 flex items-center gap-2 text-left hover:bg-surface-hover">
        <h2 className="text-sm font-medium text-primary">Settings</h2>
        <span className="text-xs text-tertiary truncate">holidays, work week, types, allowances</span>
        <ChevronDown className={cn('ml-auto w-4 h-4 text-tertiary transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="p-4 pt-2 space-y-6 border-t border-subtle">
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}

          <div className="space-y-3">
            <h3 className="text-sm font-medium text-primary">Public holidays {data.year}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Country" className={cn(field, 'w-64')} value={country} onChange={(e) => loadCountry(e.target.value)}>
                <option value="">Pick a country…</option>
                {HOLIDAY_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
              {country && <button onClick={() => setList(holidaysFor(country, data.year))} className="h-8 px-3 rounded-md text-sm ring-1 ring-subtle text-secondary hover:bg-surface-hover">Reload {data.year}</button>}
              {list && (
                <button onClick={saveList} disabled={!!busy} className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-inverse-fg bg-inverse disabled:opacity-40">
                  {busy === 'holidays' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Save {shown.length} holidays</button>
              )}
            </div>
            {note && <p className="text-2xs text-tertiary">{note}</p>}
            {list && <p className="text-2xs text-warning">Not saved yet. Saving replaces {data.year}’s list and recounts everyone’s time off.</p>}
            <ul className="grid sm:grid-cols-2 gap-x-6 text-sm">
              {shown.map((h) => (
                <li key={h.day} className="flex items-center gap-2 py-1">
                  <span className="w-28 shrink-0 text-secondary tabular-nums">{fmt(h.day)}</span>
                  <span className="min-w-0 flex-1 truncate text-primary">{h.name}</span>
                  <button aria-label={`Remove ${h.name}`} onClick={() => setList(shown.filter((x) => x.day !== h.day))} className="w-7 h-7 rounded-md flex items-center justify-center text-tertiary hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              ))}
              {shown.length === 0 && <li className="text-tertiary py-1">None yet — pick a country, or add your own days.</li>}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" aria-label="Day" className={field} min={`${data.year}-01-01`} max={`${data.year}-12-31`} value={add.day} onChange={(e) => setAdd({ ...add, day: e.target.value })} />
              <input aria-label="Name" className={cn(field, 'w-56')} placeholder="Company day off" maxLength={80} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
              <button disabled={!add.day.startsWith(String(data.year))} onClick={() => { setList([...shown.filter((x) => x.day !== add.day), { day: add.day, name: add.name || 'Company day off' }].sort((a, b) => a.day.localeCompare(b.day))); setAdd({ day: '', name: '' }); }}
                className="h-8 px-3 inline-flex items-center gap-1 rounded-md text-sm ring-1 ring-subtle text-secondary hover:bg-surface-hover disabled:opacity-40"><Plus className="w-3.5 h-3.5" />Add day</button>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-primary">Work week</h3>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((name, i) => {
                const on = data.settings.work_days.includes(i + 1);
                return <button key={name} onClick={() => toggleDay(i + 1)} disabled={!!busy} aria-pressed={on}
                  className={cn('h-8 w-12 rounded-md text-sm ring-1', on ? 'bg-inverse text-inverse-fg ring-transparent' : 'text-secondary ring-subtle hover:bg-surface-hover')}>{name}</button>;
              })}
            </div>
            <p className="text-2xs text-tertiary">Only these days count as time off. Changing them recounts every request.</p>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-primary">Types of leave</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-tertiary">
                  <th className="py-1.5 pr-3 font-normal">Name</th><th className="py-1.5 pr-3 font-normal">Days a year</th>
                  <th className="py-1.5 pr-3 font-normal">Needs approval</th><th className="py-1.5 pr-3 font-normal">Paid</th><th /></tr></thead>
                <tbody>
                  {data.types.filter((t) => !t.archived).map((t) => (
                    <tr key={t.id} className="border-t border-subtle">
                      <td className="py-1.5 pr-3"><div className="flex items-center gap-2">
                        <input type="color" aria-label="Colour" value={t.color} onChange={(e) => act(`c-${t.id}`, () => saveLeaveType(privy, ws, { id: t.id, color: e.target.value }))} className="w-6 h-6 rounded bg-transparent cursor-pointer" />
                        <input aria-label="Type name" defaultValue={t.name} maxLength={60} className={cn(field, 'w-40')} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && act(`n-${t.id}`, () => saveLeaveType(privy, ws, { id: t.id, name: e.target.value }))} />
                      </div></td>
                      <td className="py-1.5 pr-3"><input aria-label="Days a year" inputMode="decimal" defaultValue={t.allowance_days ?? ''} placeholder="No limit" className={cn(field, 'w-24')}
                        onBlur={(e) => { const v = e.target.value.trim(); const cur = t.allowance_days == null ? '' : String(t.allowance_days); if (v !== cur) act(`a-${t.id}`, () => saveLeaveType(privy, ws, { id: t.id, allowance_days: v === '' ? null : Number(v) } as any)); }} /></td>
                      <td className="py-1.5 pr-3"><input type="checkbox" aria-label="Needs approval" checked={t.needs_approval} onChange={(e) => act(`p-${t.id}`, () => saveLeaveType(privy, ws, { id: t.id, needs_approval: e.target.checked }))} /></td>
                      <td className="py-1.5 pr-3"><input type="checkbox" aria-label="Paid" checked={t.paid} onChange={(e) => act(`q-${t.id}`, () => saveLeaveType(privy, ws, { id: t.id, paid: e.target.checked }))} /></td>
                      <td className="py-1.5 text-right"><button aria-label={`Remove ${t.name}`} onClick={() => removeType(t.id, t.name)} className="w-7 h-7 rounded-md inline-flex items-center justify-center text-tertiary hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-2">
              <input className={cn(field, 'w-56')} placeholder="New type, e.g. Parental leave" maxLength={60} value={newType} onChange={(e) => setNewType(e.target.value)} />
              <button disabled={!newType.trim()} onClick={async () => { if (await act('new', () => saveLeaveType(privy, ws, { name: newType.trim() }))) setNewType(''); }}
                className="h-8 px-3 inline-flex items-center gap-1 rounded-md text-sm ring-1 ring-subtle text-secondary hover:bg-surface-hover disabled:opacity-40"><Plus className="w-3.5 h-3.5" />Add</button>
            </div>
          </div>

          {capped.length > 0 && data.people && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-primary">Allowances {data.year}</h3>
              <p className="text-2xs text-tertiary">Blank uses the type’s default. Used days are approved time off this year.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-tertiary"><th className="py-1.5 pr-3 font-normal">Person</th>
                    {capped.map((t) => <th key={t.id} className="py-1.5 pr-3 font-normal whitespace-nowrap">{t.name}</th>)}</tr></thead>
                  <tbody>
                    {data.people.map((p) => (
                      <tr key={p.user} className="border-t border-subtle">
                        <td className="py-1.5 pr-3 text-primary whitespace-nowrap">{p.name}</td>
                        {capped.map((t) => {
                          const b = p.balances.find((x) => x.type_id === t.id);
                          return (
                            <td key={t.id} className="py-1.5 pr-3">
                              <div className="flex items-center gap-1.5">
                                <input aria-label={`${p.name} ${t.name} allowance`} inputMode="decimal" className={cn(field, 'w-16')} placeholder={String(t.allowance_days)}
                                  defaultValue={b?.overridden ? String(b.allowance) : ''}
                                  onBlur={(e) => { const v = e.target.value.trim(); const cur = b?.overridden ? String(b.allowance) : ''; if (v !== cur) act(`al-${p.user}-${t.id}`, () => setAllowance(privy, ws, p.user, t.id, data.year, v === '' ? null : Number(v))); }} />
                                <span className="text-2xs text-tertiary whitespace-nowrap">{b ? `${b.used} used` : ''}</span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
