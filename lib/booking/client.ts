'use client';

import { rpc } from '@/lib/rpc';
import type { Weekly } from '@/lib/booking/slots';

// The team side of booking pages (0135), for the browser. Pages and the list of
// bookings go through /api/rpc; cancelling goes through /api/booking/cancel,
// because it also removes the Google event and emails the visitor.

export type BookingLocation = 'google_meet' | 'phone' | 'in_person' | 'link' | 'none';

export interface BookingPage {
  id: string; owner_privy: string; slug: string; title: string; description: string | null;
  duration_min: number; step_min: number; location: BookingLocation; location_detail: string | null;
  timezone: string; weekly: Weekly; buffer_before: number; buffer_after: number;
  min_notice_min: number; horizon_days: number; max_per_day: number | null;
  create_deal: boolean; ask_phone: boolean; ask_company: boolean; notify_email: string | null;
  enabled: boolean; mine?: boolean; host_name?: string | null; upcoming?: number;
}

export interface BookingRow {
  id: string; title: string; name: string; email: string; phone: string | null; company: string | null;
  notes: string | null; starts_at: string; ends_at: string; status: 'confirmed' | 'cancelled';
  join_url: string | null; page: string | null; page_slug: string | null;
  person_id: string | null; deal_id: string | null; host_name: string | null; cancel_reason: string | null;
}

export const LOCATIONS: { value: BookingLocation; label: string; hint: string }[] = [
  { value: 'google_meet', label: 'Google Meet', hint: 'A Meet link is created when Google Calendar is connected (Settings → Integrations).' },
  { value: 'phone', label: 'Phone call', hint: 'The person leaves their number; you call them.' },
  { value: 'in_person', label: 'In person', hint: 'Shown on the page before booking.' },
  { value: 'link', label: 'Your own video link', hint: 'Zoom, Teams, Whereby… the same link for every booking.' },
  { value: 'none', label: 'Decide later', hint: 'Nothing is shown about where.' },
];

const MESSAGES: Record<string, string> = {
  BAD_SLUG: 'The address may use lowercase letters, digits and dashes (4–50 characters).',
  SLUG_RESERVED: 'That address is reserved — pick another.',
  SLUG_TAKEN: 'That address is taken — pick another.',
  BAD_TIMEZONE: 'Pick a time zone from the list.',
  TITLE_REQUIRED: 'Give the page a title.',
  FORBIDDEN: 'Only the host or an owner/admin can change this page.',
  NOT_FOUND: 'That page no longer exists.',
};
const NOT_SET_UP = /booking_|does not exist|PGRST202/i;
export const explainBooking = (m: string) => {
  const code = Object.keys(MESSAGES).find((k) => m.includes(k));
  if (code) return MESSAGES[code];
  return NOT_SET_UP.test(m) ? 'Booking pages need migration 0135 — run it in Supabase.' : m;
};

export async function loadBookingPages(privy: string, ws: string): Promise<{ pages?: BookingPage[]; error?: string }> {
  const { data, error } = await rpc('get_booking_pages', { p_privy: privy, p_workspace: ws });
  return error ? { error: explainBooking(error.message) } : { pages: (data as BookingPage[]) || [] };
}

export async function saveBookingPage(privy: string, ws: string, data: Partial<BookingPage>): Promise<{ page?: BookingPage; error?: string }> {
  const { data: out, error } = await rpc('save_booking_page', { p_privy: privy, p_workspace: ws, p_data: data });
  return error ? { error: explainBooking(error.message) } : { page: out as BookingPage };
}

export async function deleteBookingPage(privy: string, id: string): Promise<{ error?: string }> {
  const { error } = await rpc('delete_booking_page', { p_privy: privy, p_id: id });
  return error ? { error: explainBooking(error.message) } : {};
}

export async function loadBookings(privy: string, ws: string, from: Date, to: Date): Promise<{ rows?: BookingRow[]; error?: string }> {
  const { data, error } = await rpc('get_bookings', { p_privy: privy, p_workspace: ws, p_from: from.toISOString(), p_to: to.toISOString() });
  return error ? { error: explainBooking(error.message) } : { rows: (data as BookingRow[]) || [] };
}

export async function cancelBooking(id: string, reason: string): Promise<{ error?: string }> {
  try {
    const res = await fetch('/api/booking/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, reason }),
    });
    const d = await res.json().catch(() => ({}));
    return res.ok ? {} : { error: d.error || 'Could not cancel.' };
  } catch (e: any) { return { error: e?.message || 'Could not cancel.' }; }
}

/** A slug from a title: "Intro call" → "intro-call". */
export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

export const embedCode = (origin: string, slug: string) =>
  `<iframe src="${origin}/book/${slug}?embed=1" style="width:100%;min-height:720px;border:0" title="Book a meeting" loading="lazy"></iframe>`;
