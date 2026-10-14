'use client';

import { clearRpcCache, rpc } from '@/lib/rpc';

// HR → Time & leave (0136), for the browser. Timesheets and the leave
// settings go through /api/rpc; asking for, approving and withdrawing time off
// go through /api/time-off, because each of those emails somebody.

export interface TimeEntry {
  id: string; privy_user_id: string; name: string; day: string; minutes: number;
  timer_started_at: string | null; running_minutes: number | null;
  description: string | null; project_id: string | null; project: string | null; project_color: string | null;
  issue_id: string | null; issue: string | null; company_id: string | null; company: string | null;
  billable: boolean; rate: number | null; invoice_id: string | null; invoice_number: string | null;
}
export interface TimeData { entries: TimeEntry[]; running: TimeEntry | null; is_admin: boolean; people: { user: string; name: string }[] | null }

export interface LeaveType { id: string; name: string; color: string; paid: boolean; allowance_days: number | null; needs_approval: boolean; archived: boolean; position: number }
export interface Balance { type_id: string; name: string; color: string; allowance: number | null; overridden: boolean; used: number; pending: number }
export interface LeaveRequest {
  id: string; user: string; name: string; start_date: string; end_date: string; half_start: boolean; half_end: boolean;
  days: number; status: 'pending' | 'approved' | 'rejected' | 'cancelled'; created_at: string; decided_at: string | null;
  decided_by_name: string | null; type_id?: string; type?: string; color?: string; note?: string | null; decision_note?: string | null;
}
export interface TimeOff {
  year: number; is_admin: boolean; me: string;
  settings: { country: string | null; work_days: number[] };
  types: LeaveType[]; holidays: { day: string; name: string }[];
  balances: Balance[]; mine: LeaveRequest[]; team: LeaveRequest[];
  pending: LeaveRequest[] | null;
  people: { user: string; name: string; role: string; balances: Balance[] }[] | null;
}

const MESSAGES: Record<string, string> = {
  NO_WORKING_DAYS: 'Those dates have no working days in them.',
  OVERLAPS: 'You already have time off on some of those days.',
  BAD_DATES: 'The end date is before the start.',
  TOO_LONG: 'One request can cover up to a year.',
  BAD_TYPE: 'Pick a type of leave.',
  ALREADY_DECIDED: 'Someone already decided this one.',
  ALREADY_STARTED: 'It has already started — ask an admin to change it.',
  INVOICED: 'This time is on an invoice. Delete the invoice to change it.',
  RATE_REQUIRED: 'Some entries have no rate — enter one.',
  ENTRIES_CHANGED: 'Some of that time changed or was billed meanwhile. Reload and try again.',
  NOTHING_TO_BILL: 'Nothing to bill.',
  BAD_COMPANY: 'That client is not in this workspace.',
  BAD_PROJECT: 'That project is not in this workspace.',
  NO_WORK_DAYS: 'Keep at least one working day.',
  FORBIDDEN: 'Only an owner or admin can do that.',
  NAME_REQUIRED: 'Give it a name.',
  DAY_REQUIRED: 'Pick a day.',
};
const NOT_SET_UP = /time_|leave_|does not exist|PGRST202/i;
export function explainTime(m: string): string {
  const over = /OVER_ALLOWANCE: ([\d.]+) day\(s\) left in (\d{4})/.exec(m);
  if (over) return `That is more than the ${over[1]} day(s) left in ${over[2]}.`;
  const code = Object.keys(MESSAGES).find((k) => m.includes(k));
  if (code) return MESSAGES[code];
  return NOT_SET_UP.test(m) ? 'Time & leave needs migration 0136 — run it in Supabase.' : m;
}

type R<T> = Promise<{ data?: T; error?: string }>;
async function call<T>(fn: string, args: Record<string, any>): R<T> {
  const { data, error } = await rpc(fn, args);
  return error ? { error: explainTime(error.message || String(error)) } : { data: data as T };
}

// ── Timesheets ──
export const loadTime = (privy: string, ws: string, from: string, to: string, user: string | null) =>
  call<TimeData>('get_time_entries', { p_privy: privy, p_workspace: ws, p_from: from, p_to: to, p_user: user });
export const saveEntry = (privy: string, ws: string, data: Record<string, any>) =>
  call<TimeEntry>('save_time_entry', { p_privy: privy, p_workspace: ws, p_data: data });
export const deleteEntry = (privy: string, id: string) => call<null>('delete_time_entry', { p_privy: privy, p_id: id });
export const startTimer = (privy: string, ws: string, data: Record<string, any>) =>
  call<TimeEntry>('start_timer', { p_privy: privy, p_workspace: ws, p_data: data });
export const stopTimer = (privy: string, ws: string) => call<TimeEntry | null>('stop_timer', { p_privy: privy, p_workspace: ws });
export const invoiceEntries = (privy: string, ws: string, company: string, ids: string[], rate: number | null, group: 'project' | 'entry') =>
  call<{ invoice_id: string; number: string; total: number; hours: number; entries: number }>('invoice_time_entries',
    { p_privy: privy, p_workspace: ws, p_company: company, p_ids: ids, p_rate: rate, p_group: group });

/** Projects and client companies, for the pickers. */
export async function loadPickers(privy: string, ws: string): Promise<{ projects: { id: string; name: string }[]; companies: { id: string; name: string }[] }> {
  const [p, c] = await Promise.all([
    rpc('list_records', { p_privy: privy, p_workspace: ws, p_object: 'projects' }, { quiet: true }),
    rpc('list_records', { p_privy: privy, p_workspace: ws, p_object: 'companies' }, { quiet: true }),
  ]);
  const rows = (d: any) => (Array.isArray(d) ? d : Array.isArray(d?.rows) ? d.rows : []) as any[];
  return {
    projects: rows(p.data).map((r) => ({ id: r.id, name: r.name || 'Untitled' })).sort((a, b) => a.name.localeCompare(b.name)),
    companies: rows(c.data).map((r) => ({ id: r.id, name: r.name || 'Untitled' })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ── Time off ──
export const loadTimeOff = (privy: string, ws: string, year: number) => call<TimeOff>('get_time_off', { p_privy: privy, p_workspace: ws, p_year: year });
export const saveLeaveSettings = (privy: string, ws: string, data: Record<string, any>) =>
  call<{ country: string | null; work_days: number[] }>('save_leave_settings', { p_privy: privy, p_workspace: ws, p_data: data });
export const saveLeaveType = (privy: string, ws: string, data: Partial<LeaveType>) =>
  call<LeaveType>('save_leave_type', { p_privy: privy, p_workspace: ws, p_data: data });
export const deleteLeaveType = (privy: string, id: string) => call<string>('delete_leave_type', { p_privy: privy, p_id: id });
export const setAllowance = (privy: string, ws: string, user: string, type: string, year: number, days: number | null) =>
  call<null>('set_leave_allowance', { p_privy: privy, p_workspace: ws, p_user: user, p_type: type, p_year: year, p_days: days });
export const setHolidays = (privy: string, ws: string, year: number, days: { day: string; name: string }[]) =>
  call<number>('set_public_holidays', { p_privy: privy, p_workspace: ws, p_year: year, p_days: days });

/** Ask for, decide or withdraw time off — the route emails whoever needs to know. */
export async function leaveAction(body: Record<string, any>): Promise<{ data?: any; error?: string }> {
  try {
    const res = await fetch('/api/time-off', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    clearRpcCache();
    return res.ok ? { data: d } : { error: explainTime(d.error || 'Something went wrong.') };
  } catch (e: any) { return { error: e?.message || 'Something went wrong.' }; }
}
