// The free times on a booking page — pure, ZERO imports, browser and server.
//
// One function decides what is bookable, and both the list a visitor picks from
// and the check before a booking is written call it. Two implementations would
// drift: the page would offer 17:30 and the server would refuse it, or worse,
// accept a time the page never offered (a crafted POST for 03:00 on a Sunday).
//
// Times are computed in the HOST'S time zone, because "Mon–Fri 9–17" is the
// host's working day. A slot is a UTC instant; the visitor's browser shows it in
// the visitor's zone. Daylight saving is handled by converting each wall-clock
// slot on its own day (Intl, no library): a window crossing a DST change gets
// the right instants, and a time that does not exist that night is skipped.
//
// What blocks a slot: outside the weekly hours; within the minimum notice; past
// the horizon; overlapping another booking of the host, buffers included (the
// same test booking_book runs in SQL, 0135); or the day already holding
// `max_per_day` bookings.

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type Weekly = Partial<Record<Weekday, [string, string][]>>;

export interface SlotRules {
  duration_min: number;
  step_min: number;
  timezone: string;
  weekly: Weekly;
  buffer_before?: number;
  buffer_after?: number;
  min_notice_min?: number;
  horizon_days?: number;
  max_per_day?: number | null;
}

/** Another booking of the host: [start, end] as ISO strings or Dates. */
export type Busy = [string | Date, string | Date];

const MIN = 60_000;
const DAY = 86_400_000;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface LocalParts { y: number; m: number; d: number; hh: number; mm: number; weekday: Weekday }

/** The wall-clock date and time of an instant in a zone. */
export function localParts(at: Date, tz: string): LocalParts {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(at)) p[x.type] = x.value;
  return {
    y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute,
    weekday: (p.weekday || '').slice(0, 3).toLowerCase() as Weekday,
  };
}

/** Minutes the zone is ahead of UTC at that instant (Warsaw in summer: 120). */
export function tzOffsetMin(at: Date, tz: string): number {
  const p = localParts(at, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  return Math.round((asUtc - Math.floor(at.getTime() / MIN) * MIN) / MIN);
}

/**
 * The instant at which the clock in `tz` shows this date and minute of the day,
 * or null when that wall time does not exist (the hour skipped in spring). An
 * hour that happens twice in autumn resolves to its first occurrence.
 */
export function zonedTime(y: number, m: number, d: number, minuteOfDay: number, tz: string): Date | null {
  const guess = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  // The offsets in force half a day either side cover both sides of any change.
  const offsets = new Set([tzOffsetMin(new Date(guess - DAY / 2), tz), tzOffsetMin(new Date(guess + DAY / 2), tz), tzOffsetMin(new Date(guess), tz)]);
  const hits = [...offsets].map((o) => guess - o * MIN)
    .filter((t) => wallMatches(new Date(t), y, m, d, minuteOfDay, tz))
    .sort((a, b) => a - b);
  return hits.length ? new Date(hits[0]) : null;
}

function wallMatches(at: Date, y: number, m: number, d: number, minuteOfDay: number, tz: string): boolean {
  const p = localParts(at, tz);
  const want = new Date(Date.UTC(y, m - 1, d, 0, minuteOfDay));
  return p.y === want.getUTCFullYear() && p.m === want.getUTCMonth() + 1 && p.d === want.getUTCDate()
    && p.hh * 60 + p.mm === want.getUTCHours() * 60 + want.getUTCMinutes();
}

const toMin = (hhmm: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm));
  if (!m) return null;
  const v = +m[1] * 60 + +m[2];
  return v >= 0 && v <= 24 * 60 ? v : null;
};

/** The calendar day ("2026-10-20") an instant falls on in a zone. */
export function dayKey(at: Date, tz: string): string {
  const p = localParts(at, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** True when `tz` is a zone this runtime knows. */
export function validZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return !!tz; } catch { return false; }
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/**
 * Every bookable start between `from` and `to` (UTC instants, ascending).
 * `busy` is the host's other bookings; `now` is passed in so a test — and the
 * server and the browser — agree on what "now" is.
 */
export function freeSlots(rules: SlotRules, busy: Busy[], from: Date, to: Date, now: Date = new Date()): Date[] {
  const tz = validZone(rules.timezone) ? rules.timezone : 'UTC';
  const duration = clampInt(rules.duration_min, 5, 480, 30);
  const step = clampInt(rules.step_min, 5, 240, duration);
  const before = clampInt(rules.buffer_before, 0, 240, 0) * MIN;
  const after = clampInt(rules.buffer_after, 0, 240, 0) * MIN;
  const earliest = now.getTime() + clampInt(rules.min_notice_min, 0, 43200, 0) * MIN;
  const latest = now.getTime() + clampInt(rules.horizon_days, 1, 365, 30) * DAY;
  const lo = Math.max(from.getTime(), earliest);
  const hi = Math.min(to.getTime(), latest + 1);
  if (hi <= lo) return [];

  const taken = busy
    .map(([s, e]) => [new Date(s).getTime(), new Date(e).getTime()] as [number, number])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s);
  const perDay = new Map<string, number>();
  if (rules.max_per_day) for (const [s] of taken) { const k = dayKey(new Date(s), tz); perDay.set(k, (perDay.get(k) || 0) + 1); }

  const out: Date[] = [];
  // Walk the host's calendar days that the range touches, plus one either side
  // so a zone far from UTC never loses its first or last day. Calendar
  // arithmetic on UTC dates: stepping 24 hours of real time would skip a day
  // across a spring-forward night.
  const first = localParts(new Date(lo), tz);
  const last = localParts(new Date(hi), tz);
  for (let du = Date.UTC(first.y, first.m - 1, first.d) - DAY; du <= Date.UTC(last.y, last.m - 1, last.d) + DAY; du += DAY) {
    const cd = new Date(du);
    const y = cd.getUTCFullYear(); const mo = cd.getUTCMonth() + 1; const d = cd.getUTCDate();
    const key = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (rules.max_per_day && (perDay.get(key) || 0) >= rules.max_per_day) continue;
    const windows = (rules.weekly?.[WEEKDAYS[(cd.getUTCDay() + 6) % 7]] || []) as [string, string][];
    for (const w of windows) {
      const a = toMin(w?.[0]); const b = toMin(w?.[1]);
      if (a === null || b === null || b <= a) continue;
      const windowEnd = b === 24 * 60 ? zonedTime(y, mo, d + 1, 0, tz) : zonedTime(y, mo, d, b, tz);
      if (!windowEnd) continue;
      for (let m = a; m + duration <= b; m += step) {
        const start = zonedTime(y, mo, d, m, tz);
        if (!start) continue;   // the hour the clocks skip
        const s = start.getTime();
        const e = s + duration * MIN;
        if (s < lo || s >= hi || e > windowEnd.getTime()) continue;
        if (taken.some(([bs, be]) => bs < e + after && be > s - before)) continue;
        out.push(start);
      }
    }
  }
  // Dedupe and order: adjacent days can both produce the same instant at the
  // day-walk's edges.
  const seen = new Set<number>();
  return out.filter((d) => (seen.has(d.getTime()) ? false : (seen.add(d.getTime()), true)))
    .sort((x, y) => x.getTime() - y.getTime());
}

/** True when `start` is one of the times the page offers right now. */
export function isFreeSlot(rules: SlotRules, busy: Busy[], start: Date, now: Date = new Date()): boolean {
  const s = start.getTime();
  if (!Number.isFinite(s)) return false;
  return freeSlots(rules, busy, new Date(s - DAY), new Date(s + DAY), now).some((d) => d.getTime() === s);
}

/** Drop one busy interval — the visitor's own booking, when they reschedule it. */
export function withoutInterval(busy: Busy[], start: string | Date, end: string | Date): Busy[] {
  const s = new Date(start).getTime(); const e = new Date(end).getTime();
  const i = busy.findIndex(([a, b]) => new Date(a).getTime() === s && new Date(b).getTime() === e);
  return i < 0 ? busy : [...busy.slice(0, i), ...busy.slice(i + 1)];
}
