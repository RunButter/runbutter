'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { ChevronLeft, ChevronRight, Video } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import AppLoading from '@/components/ui/AppLoading';
import EmptyState from '@/components/ui/EmptyState';
import { getWorkspace } from '@/lib/crm/data';
import { rpc } from '@/lib/rpc';

/**
 * One calendar over the whole company.
 *
 * ── WHAT MAKES IT WORTH HAVING IS THE MIX, NOT THE GRID ─────────────────────
 * An invoice due Tuesday, an interview Thursday, a post going out Friday and a
 * Cal.com booking somebody made without telling anyone — on the same screen,
 * from one query, because the records were in one database from 0001. That is
 * the product's whole claim, and nothing on screen demonstrated it until now.
 *
 * ── MONTH FOR SHAPE, AGENDA FOR WORK ────────────────────────────────────────
 * Both, and neither alone. A month grid answers "how busy is the 14th"; an
 * agenda answers "what do I do next", and cramming that into 90px cells is what
 * makes most calendars unreadable at exactly the density where they matter.
 *
 * ── COLOURS CARRY MEANING ───────────────────────────────────────────────────
 * Money in and money out are different kinds even though both are rows of
 * `invoices`. "They owe us this Friday" and "we owe this Friday" are opposite
 * facts, and one colour for both would be a chart that lies.
 */

interface Ev {
  kind: string; id: string; title: string; at: string;
  ends_at?: string; all_day?: boolean; href?: string;
  amount?: number; status?: string; platform?: string; project?: string; join_url?: string;
}

const KINDS: Record<string, { label: string; dot: string; chip: string }> = {
  invoice:    { label: 'Money in',   dot: 'bg-success',           chip: 'bg-success/10 text-success' },
  bill:       { label: 'Money out',  dot: 'bg-danger',            chip: 'bg-danger/10 text-danger' },
  issue:      { label: 'Issues',     dot: 'bg-accent',            chip: 'bg-accent/10 text-accent' },
  meeting:    { label: 'Meetings',   dot: 'bg-warning',           chip: 'bg-warning/10 text-warning' },
  interview:  { label: 'Interviews', dot: 'bg-warning',           chip: 'bg-warning/10 text-warning' },
  post:       { label: 'Posts',      dot: 'bg-secondary',         chip: 'bg-surface-hover text-secondary' },
  newsletter: { label: 'Newsletters', dot: 'bg-secondary',        chip: 'bg-surface-hover text-secondary' },
  campaign:   { label: 'Campaigns',  dot: 'bg-tertiary',          chip: 'bg-surface-hover text-tertiary' },
};
const ORDER = ['invoice', 'bill', 'meeting', 'interview', 'issue', 'post', 'newsletter', 'campaign'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * The local calendar day an event falls on.
 *
 * An all-day event carries a bare `YYYY-MM-DD` and MUST NOT go through Date —
 * `new Date('2026-08-20')` is parsed as UTC midnight and renders as the 19th
 * for anyone west of Greenwich, so an invoice due on the 20th would sit in the
 * wrong cell for half the world. Timed events are real instants and are
 * converted properly.
 */
const dayKey = (e: Ev) => (e.all_day ? String(e.at).slice(0, 10) : iso(new Date(e.at)));

const time = (e: Ev) => (e.all_day ? '' :
  new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }));

export default function CalendarPage() {
  const { ready, authenticated, user } = usePrivy();
  const privy = authenticated && user ? user.id : null;
  const [wsId, setWsId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'month' | 'agenda'>('month');
  const [sel, setSel] = useState<string | null>(null);

  // Whole weeks, so the grid never renders a ragged first row and an event in
  // the trailing days of the previous month still appears in the cell it shares.
  const gridStart = useMemo(() => {
    const d = new Date(cursor);
    d.setDate(1 - ((d.getDay() + 6) % 7));   // back to Monday
    return d;
  }, [cursor]);
  const gridEnd = useMemo(() => { const d = new Date(gridStart); d.setDate(d.getDate() + 41); return d; }, [gridStart]);

  useEffect(() => { if (privy) getWorkspace(privy).then((w) => setWsId(w?.id ?? null)); }, [privy]);

  const load = useCallback(async () => {
    if (!privy || !wsId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await rpc('get_calendar', {
      p_privy: privy, p_workspace: wsId, p_from: iso(gridStart), p_to: iso(gridEnd),
    });
    setEvents(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [privy, wsId, gridStart, gridEnd]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => events.filter((e) => !off.has(e.kind)), [events, off]);

  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of shown) {
      if (!e.at) continue;
      const k = dayKey(e);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  }, [shown]);

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) { const d = new Date(gridStart); d.setDate(d.getDate() + i); out.push(d); }
    return out;
  }, [gridStart]);

  const move = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
  const toggle = (k: string) => setOff((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const todayKey = iso(new Date());

  // Present kinds only — a legend offering to filter something the month does
  // not contain is noise, and it changes as you page through the year.
  const present = useMemo(() => ORDER.filter((k) => events.some((e) => e.kind === k)), [events]);

  if (!ready) return <AppLoading />;

  return (
    <>
      <PageHeader title={cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}>
        <div className="flex items-center rounded-md ring-1 ring-subtle overflow-hidden">
          {(['month', 'agenda'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`h-7 px-2.5 text-xs capitalize ${view === v ? 'bg-surface text-primary font-semibold' : 'text-tertiary hover:bg-surface-sunken'}`}>
              {v}
            </button>
          ))}
        </div>
        <button onClick={() => move(-1)} aria-label="Previous month"
          className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><ChevronLeft className="w-4 h-4" /></button>
        <button onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}
          className="h-7 px-2.5 rounded-md text-xs text-secondary ring-1 ring-subtle hover:bg-surface-hover">Today</button>
        <button onClick={() => move(1)} aria-label="Next month"
          className="p-1.5 rounded-md text-tertiary hover:bg-surface-hover"><ChevronRight className="w-4 h-4" /></button>
      </PageHeader>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="page-body p-6 2xl:p-8 flex flex-col gap-4">

          {present.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {present.map((k) => (
                <button key={k} onClick={() => toggle(k)}
                  className={`h-7 px-2.5 inline-flex items-center gap-1.5 rounded-md text-2xs ring-1 ring-subtle transition-opacity
                    ${off.has(k) ? 'opacity-40 text-tertiary' : 'text-secondary'}`}>
                  <span className={`w-2 h-2 rounded-full ${KINDS[k].dot}`} />
                  {KINDS[k].label}
                  <span className="tabular-nums text-tertiary">{events.filter((e) => e.kind === k).length}</span>
                </button>
              ))}
            </div>
          )}

          {loading ? <AppLoading /> : view === 'month' ? (
            <Month days={days} byDay={byDay} month={cursor.getMonth()} todayKey={todayKey}
              sel={sel} onSelect={setSel} />
          ) : (
            <Agenda events={shown} />
          )}

          {!loading && events.length === 0 && (
            <EmptyState title="Nothing scheduled this month"
              description="Invoice due dates, issue deadlines, scheduled posts and newsletters, campaign windows, interviews and Cal.com bookings all appear here automatically." />
          )}

          {sel && view === 'month' && (byDay.get(sel)?.length ?? 0) > 0 && (
            <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-4">
              <h2 className="text-sm font-medium text-primary">
                {new Date(`${sel}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
              </h2>
              <div className="mt-2 flex flex-col gap-1.5">
                {byDay.get(sel)!.map((e) => <Item key={`${e.kind}-${e.id}-${e.title}`} e={e} />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Month({ days, byDay, month, todayKey, sel, onSelect }: {
  days: Date[]; byDay: Map<string, Ev[]>; month: number; todayKey: string;
  sel: string | null; onSelect: (k: string) => void;
}) {
  return (
    <div className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-subtle">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="h-9 flex items-center justify-center text-2xs font-medium text-tertiary">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const k = iso(d);
          const evs = byDay.get(k) || [];
          const dim = d.getMonth() !== month;
          const today = k === todayKey;
          return (
            <button key={k} onClick={() => onSelect(k)}
              className={`min-h-[92px] p-1.5 text-left border-b border-r border-subtle last-in-row:border-r-0 align-top
                ${dim ? 'bg-surface-sunken/40' : ''} ${sel === k ? 'ring-1 ring-inset ring-accent' : ''}
                hover:bg-surface-hover transition-colors`}>
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-2xs tabular-nums
                ${today ? 'bg-accent text-accent-fg font-semibold' : dim ? 'text-tertiary' : 'text-secondary'}`}>
                {d.getDate()}
              </span>
              <div className="mt-1 flex flex-col gap-0.5">
                {evs.slice(0, 3).map((e) => (
                  <div key={`${e.kind}-${e.id}-${e.title}`}
                    className={`flex items-center gap-1 px-1 py-0.5 rounded text-3xs truncate ${KINDS[e.kind]?.chip || 'bg-surface-hover text-secondary'}`}
                    title={e.title}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${KINDS[e.kind]?.dot || 'bg-tertiary'}`} />
                    <span className="truncate">{e.title}</span>
                  </div>
                ))}
                {/* Never a silent truncation: a day with nine things must not
                    look like a day with three. */}
                {evs.length > 3 && (
                  <span className="text-3xs text-tertiary px-1">+{evs.length - 3} more</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Agenda({ events }: { events: Ev[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of events) {
      if (!e.at) continue;
      const k = dayKey(e);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events]);

  if (!groups.length) return null;
  const todayKey = iso(new Date());

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([day, evs]) => (
        <div key={day} className="rounded-2xl bg-surface ring-1 ring-subtle shadow-card p-4">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-tertiary">
            {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            {day === todayKey && <span className="ml-2 text-accent">Today</span>}
          </h3>
          <div className="mt-2 flex flex-col gap-1.5">
            {evs.map((e) => <Item key={`${e.kind}-${e.id}-${e.title}`} e={e} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Item({ e }: { e: Ev }) {
  const inner = (
    <>
      <span className={`w-2 h-2 rounded-full shrink-0 ${KINDS[e.kind]?.dot || 'bg-tertiary'}`} />
      <span className="text-2xs text-tertiary tabular-nums w-14 shrink-0">{time(e) || 'All day'}</span>
      <span className="text-xs text-primary flex-1 min-w-0 truncate">{e.title}</span>
      {e.project && <span className="text-2xs text-tertiary shrink-0">{e.project}</span>}
      {e.platform && <span className="text-2xs text-tertiary capitalize shrink-0">{e.platform}</span>}
      {e.amount != null && (
        <span className={`text-2xs font-semibold tabular-nums shrink-0 ${e.kind === 'bill' ? 'text-danger' : 'text-success'}`}>
          {e.kind === 'bill' ? '−' : ''}{money(e.amount)}
        </span>
      )}
      {e.join_url && (
        <span className="text-2xs text-accent inline-flex items-center gap-1 shrink-0"><Video className="w-3 h-3" /> Join</span>
      )}
    </>
  );

  // The join link wins over the record link: on a meeting card, "join" is what
  // somebody is reaching for, and burying it under a navigation is the mistake
  // every calendar makes at two minutes past the hour.
  if (e.join_url) {
    return (
      <a href={e.join_url} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-hover">{inner}</a>
    );
  }
  if (e.href) {
    return <Link href={e.href} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-hover">{inner}</Link>;
  }
  return <div className="flex items-center gap-2 px-2 py-1.5">{inner}</div>;
}
