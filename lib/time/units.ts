// Time arithmetic for timesheets and time off — pure, ZERO imports.
//
// `leaveDays` is the browser's preview of what leave_working_days (0136)
// computes in SQL. The server's number is the one stored; this one is what the
// person sees before pressing Request, and the tests hold the two to the same
// cases so the preview never promises a balance the server will refuse.

/** "1:30", "1.5", "1,5h", "90m", "1h 15m", "2h" → minutes; null if unreadable. */
export function parseDuration(input: string): number | null {
  const s = String(input || '').trim().toLowerCase().replace(',', '.');
  if (!s) return null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,2}):([0-5]\d)$/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m(?:in)?)?$/))) return Math.round(+m[1] * 60 + (m[2] ? +m[2] : 0));
  if ((m = s.match(/^(\d+)\s*m(?:in)?$/))) return +m[1];
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) {
    // A bare number: hours when it reads like hours ("1.5", "8"), minutes when big ("45", "90").
    const n = +m[1];
    return n <= 16 ? Math.round(n * 60) : Math.round(n);
  }
  return null;
}

/** 90 → "1:30". */
export const fmtMinutes = (min: number | null | undefined): string => {
  const v = Math.max(0, Math.round(Number(min) || 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

/** 90 → "1.5" (hours, for money and reports). */
export const hours = (min: number) => Math.round((Number(min) || 0) / 60 * 100) / 100;

/** The local calendar date of a Date ("2026-10-14"), in the browser's zone. */
export const localDay = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday of the week containing `day` ("YYYY-MM-DD"). */
export function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday of a date string, 1 = Monday … 7 = Sunday. */
export const isoDow = (day: string) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Working days in [start, end] — the SQL rule, for the preview. */
export function leaveDays(start: string, end: string, halfStart: boolean, halfEnd: boolean, workDays: number[], holidays: Set<string>): number {
  if (!start || !end || end < start) return 0;
  const work = (d: string) => workDays.includes(isoDow(d)) && !holidays.has(d);
  let n = 0;
  for (let d = start, i = 0; d <= end && i < 400; d = addDays(d, 1), i++) if (work(d)) n++;
  if (start === end) return work(start) && (halfStart || halfEnd) ? 0.5 : n;
  if (halfStart && work(start)) n -= 0.5;
  if (halfEnd && work(end)) n -= 0.5;
  return Math.max(0, n);
}
