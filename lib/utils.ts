import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// The shadcn/ui class helper: merge conditional classes (clsx) and let later
// Tailwind utilities win over earlier conflicting ones (tailwind-merge). Every
// shadcn-style primitive uses this. Kept here so `npx shadcn add <x>` drops
// components in and finds cn() at the expected path.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A calendar date for display: "30 Sep 2026" in the reader's own language.
 *
 * Two bugs in the `new Date(v).toLocaleDateString()` it replaces. A date-only
 * string parses as UTC MIDNIGHT, so anyone west of Greenwich saw every due date
 * a day early. And the numeric form is ambiguous — 03/04/2026 is March to one
 * reader and April to the next — where a month NAME is not.
 */
export function fmtDay(v: string | number | Date | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const dateOnly = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const d = dateOnly ? new Date(`${v}T00:00:00Z`) : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}),
  });
}
