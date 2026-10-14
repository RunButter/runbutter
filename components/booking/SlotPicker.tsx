'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Globe, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dayKey, validZone } from '@/lib/booking/slots';

/**
 * Month grid + the times of the chosen day, in the VISITOR'S time zone.
 *
 * Shared by the booking page and the reschedule screen, so picking a time looks
 * and behaves the same both ways. The slots arrive as UTC instants from the
 * server (lib/booking/slots.ts decided them in the host's zone); everything
 * here is display — grouping by the visitor's calendar day and formatting.
 */

export function onColor(hex: string | null | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#18181b' : '#ffffff';
}

export const brandColor = (hex: string | null | undefined) => (/^#[0-9a-f]{6}$/i.test(hex || '') ? hex! : '#18181b');

export function browserZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

function zoneList(extra: string[]): string[] {
  let all: string[] = [];
  try { all = (Intl as any).supportedValuesOf?.('timeZone') || []; } catch { /* old browser */ }
  return Array.from(new Set([...extra.filter(validZone), ...all, 'UTC'])).sort();
}

export const fmtTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

export const fmtLongDay = (iso: string, tz: string) =>
  new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

const MONTH_MS = 31 * 86_400_000;

export default function SlotPicker({ loadSlots, tz, onTz, hostTz, onPick, accent, selected }: {
  /** Slots (ISO) starting in [from, to). */
  loadSlots: (from: Date, to: Date) => Promise<string[]>;
  tz: string;
  onTz: (tz: string) => void;
  hostTz?: string;
  onPick: (iso: string) => void;
  accent?: string | null;
  selected?: string | null;
}) {
  const color = brandColor(accent);
  const fg = onColor(color);
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(() => ({ y: today.getFullYear(), m: today.getMonth() }));
  const [slots, setSlots] = useState<Record<string, string[]>>({});   // "y-m" → ISO[]
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const jumped = useRef(false);
  const mk = `${month.y}-${month.m}`;

  const fetchMonth = useCallback(async (y: number, m: number) => {
    // A day of margin either side: the visitor's calendar day can start in the
    // previous UTC day, and the grid groups by the visitor's day.
    const from = new Date(Date.UTC(y, m, 1) - 86_400_000);
    const to = new Date(Date.UTC(y, m + 1, 1) + 86_400_000);
    return loadSlots(from, to);
  }, [loadSlots]);

  useEffect(() => {
    if (slots[mk]) return;
    let live = true;
    setLoading(true); setError('');
    fetchMonth(month.y, month.m).then((s) => {
      if (!live) return;
      setSlots((prev) => ({ ...prev, [mk]: s }));
    }, (e) => { if (live) setError(e?.message || 'Times could not be loaded.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [mk, month.y, month.m, slots, fetchMonth]);

  // Group this month's slots by the visitor's calendar day.
  const byDay = useMemo(() => {
    const out = new Map<string, string[]>();
    const prefix = `${month.y}-${String(month.m + 1).padStart(2, '0')}-`;
    for (const iso of slots[mk] || []) {
      const k = dayKey(new Date(iso), tz);
      if (!k.startsWith(prefix)) continue;
      out.set(k, [...(out.get(k) || []), iso]);
    }
    return out;
  }, [slots, mk, month, tz]);

  // Nothing this month on first open → show the next month that has something.
  useEffect(() => {
    if (jumped.current || loading || !slots[mk]) return;
    jumped.current = true;
    if (byDay.size === 0) setMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }));
  }, [loading, slots, mk, byDay]);

  // Pick the first open day of the month when the current pick is not in it.
  useEffect(() => {
    if (day && byDay.has(day)) return;
    const first = Array.from(byDay.keys()).sort()[0] || null;
    setDay(first);
  }, [byDay, day]);

  const first = new Date(Date.UTC(month.y, month.m, 1));
  const lead = (first.getUTCDay() + 6) % 7;                       // Monday-first
  const days = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const canBack = month.y > today.getFullYear() || (month.y === today.getFullYear() && month.m > today.getMonth());
  const farAhead = Date.UTC(month.y, month.m, 1) - Date.now() > 13 * MONTH_MS;
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const zones = useMemo(() => zoneList([tz, hostTz || '', browserZone()]), [tz, hostTz]);
  const times = day ? byDay.get(day) || [] : [];

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_200px]">
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-base text-primary font-medium">{monthLabel}</p>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous month" disabled={!canBack}
              onClick={() => setMonth(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}
              className="w-8 h-8 rounded-full flex items-center justify-center text-secondary hover:bg-surface-hover disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
            <button type="button" aria-label="Next month" disabled={farAhead}
              onClick={() => setMonth(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}
              className="w-8 h-8 rounded-full flex items-center justify-center text-secondary hover:bg-surface-hover disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="text-3xs uppercase tracking-wide text-tertiary py-1">{d}</span>)}
          {cells.map((d, i) => {
            if (!d) return <span key={i} />;
            const k = `${month.y}-${String(month.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const open = byDay.has(k);
            const on = k === day;
            return (
              <button key={i} type="button" disabled={!open} onClick={() => setDay(k)}
                aria-pressed={on} aria-label={`${d}${open ? ', times available' : ''}`}
                className={cn('aspect-square max-h-11 w-full mx-auto rounded-full text-sm flex items-center justify-center transition-shadow',
                  open ? 'font-semibold text-primary ring-strong hover:ring-2' : 'text-tertiary cursor-default opacity-60')}
                style={on ? { background: color, color: fg } : open ? { background: `${color}1f` } : undefined}>
                {d}
              </button>
            );
          })}
        </div>
        {loading && <p className="mt-3 text-xs text-tertiary flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading times…</p>}
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        {!loading && !error && slots[mk] && byDay.size === 0 && (
          <p className="mt-3 text-xs text-tertiary">No free times in {monthLabel}. Try the next month.</p>
        )}
        <label className="mt-4 flex items-center gap-2 text-xs text-secondary">
          <Globe className="w-3.5 h-3.5 shrink-0" />
          <span className="sr-only">Time zone</span>
          <select value={tz} onChange={(e) => onTz(e.target.value)}
            className="min-w-0 flex-1 h-8 rounded-lg bg-transparent text-xs text-secondary outline-none hover:bg-surface-hover px-1">
            {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
      </div>
      <div className="min-w-0">
        {day && (
          <>
            <p className="text-sm text-primary mb-2">{fmtLongDay(times[0] || `${day}T12:00:00Z`, tz)}</p>
            <div className="grid grid-cols-3 md:grid-cols-1 gap-2 p-0.5 md:max-h-[340px] md:overflow-y-auto md:pr-1.5">
              {times.map((iso) => (
                <button key={iso} type="button" onClick={() => onPick(iso)}
                  className={cn('h-10 rounded-lg text-sm font-semibold ring-1 transition-shadow hover:ring-2', iso === selected ? '' : 'text-primary ring-strong')}
                  style={iso === selected ? { background: color, color: fg, ['--tw-ring-color' as any]: color } : undefined}>
                  {fmtTime(iso, tz)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
