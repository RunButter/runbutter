// What happens around a booking — SERVER ONLY. The SQL (0135) decides whether
// a booking may exist; this does the outside-world half: the Google Calendar
// event, the emails, the automation nudge. Every route that books, moves or
// cancels comes through here, so the visitor and the host hear the same thing
// whichever button was pressed.
import { createCalendarEvent, updateCalendarEvent, cancelCalendarEvent } from '@/lib/google-calendar';
import { kickDispatcher } from '@/lib/automations/kick';
import { freeSlots, isFreeSlot, withoutInterval, type Busy, type SlotRules } from '@/lib/booking/slots';
import { mailHost, mailVisitorCancelled, mailVisitorConfirmed, mailVisitorReminder, whereText, type BookingMail } from '@/lib/booking/email';

const DAY = 86_400_000;

/** A page as booking_public returns it. */
export interface PublicPage extends SlotRules {
  id: string; slug: string; title: string; description?: string | null;
  location: string; location_detail?: string | null;
  ask_phone: boolean; ask_company: boolean;
  host?: { name?: string; avatar?: string | null } | null;
  company?: { name?: string; logo?: string | null; accent?: string | null } | null;
  busy?: Busy[];
}

/** The page and the host's busy times around [from, to]; null when there is no such page. */
export async function loadPage(admin: any, slug: string, from: Date, to: Date): Promise<PublicPage | null> {
  // A day either side, so a max-per-day count sees the whole of the edge days.
  const { data, error } = await admin.rpc('booking_public', {
    p_slug: slug, p_from: new Date(from.getTime() - DAY).toISOString(), p_to: new Date(to.getTime() + DAY).toISOString(),
  });
  if (error) throw new Error(error.message);
  return (data as PublicPage) || null;
}

export function pageSlots(page: PublicPage, from: Date, to: Date, exclude?: { start: string; end: string }): string[] {
  const busy = exclude ? withoutInterval(page.busy || [], exclude.start, exclude.end) : (page.busy || []);
  return freeSlots(page, busy, from, to).map((d) => d.toISOString());
}

export function slotIsFree(page: PublicPage, start: Date, exclude?: { start: string; end: string }): boolean {
  const busy = exclude ? withoutInterval(page.busy || [], exclude.start, exclude.end) : (page.busy || []);
  return isFreeSlot(page, busy, start);
}

/** The public page without anything the slot engine needed but a visitor does not. */
export function publicView(page: PublicPage) {
  const { busy: _busy, ...rest } = page;
  return rest;
}

function eventText(b: BookingMail): string {
  return [
    `${b.name} <${b.email}>`,
    b.company ? `Company: ${b.company}` : '',
    b.phone ? `Phone: ${b.phone}` : '',
    b.notes ? `\n${b.notes}` : '',
    '\nBooked through RunButter.',
  ].filter(Boolean).join('\n');
}

/** Booked: Google event (if the host connected Google), emails, automations. */
export async function afterBooked(admin: any, b: BookingMail): Promise<BookingMail> {
  let googleInvite = false;
  if (b.host_privy) {
    const ev = await createCalendarEvent(b.host_privy, {
      summary: `${b.title} — ${b.name}`,
      description: eventText(b),
      start: b.starts_at, end: b.ends_at,
      attendees: [b.email],
      conferenceData: b.location === 'google_meet',
    }).catch(() => null);
    if (ev?.eventId) {
      googleInvite = true;
      const { error } = await admin.rpc('booking_set_google', { p_id: b.id, p_event: ev.eventId, p_join_url: ev.meetLink || '' });
      if (!error) b = { ...b, google_event_id: ev.eventId, join_url: ev.meetLink || b.join_url };
    }
  }
  await Promise.all([mailVisitorConfirmed(b, { googleInvite }), mailHost(b, 'new')]);
  kickDispatcher(admin);   // "when a booking is added" automations
  return b;
}

export async function afterCancelled(admin: any, b: BookingMail & { cancelled_by?: string }, reason?: string | null): Promise<void> {
  const googleInvite = !!(b.google_event_id && b.host_privy);
  if (googleInvite) await cancelCalendarEvent(b.host_privy!, b.google_event_id!).catch(() => false);
  const by = b.cancelled_by === 'host' ? 'host' : 'visitor';
  await Promise.all([
    mailVisitorCancelled(b, { by, reason, googleInvite }),
    by === 'visitor' ? mailHost(b, 'cancelled', reason) : Promise.resolve(false),
  ]);
  kickDispatcher(admin);
}

export async function afterRescheduled(admin: any, b: BookingMail): Promise<void> {
  const googleInvite = !!(b.google_event_id && b.host_privy)
    && await updateCalendarEvent(b.host_privy!, b.google_event_id!, { start: b.starts_at, end: b.ends_at }).catch(() => false);
  await Promise.all([mailVisitorConfirmed(b, { googleInvite, rescheduled: true }), mailHost(b, 'rescheduled')]);
  kickDispatcher(admin);
}

/** Reminders a day ahead. Claimed in SQL before sending, so never twice. */
export async function sendBookingReminders(admin: any, limit = 25): Promise<{ sent: number }> {
  const { data, error } = await admin.rpc('booking_due_reminders', { p_limit: limit });
  if (error) throw new Error(error.message);
  let sent = 0;
  for (const b of (Array.isArray(data) ? data : []) as BookingMail[]) if (await mailVisitorReminder(b)) sent++;
  return { sent };
}

/** What the visitor's own screens may see of a booking. */
export function visitorView(b: any) {
  if (!b) return null;
  return {
    id: b.id, title: b.title, name: b.name, email: b.email, phone: b.phone, company: b.company, notes: b.notes,
    starts_at: b.starts_at, ends_at: b.ends_at, status: b.status, join_url: b.join_url,
    location: b.location, location_detail: b.location_detail, timezone: b.timezone, attendee_tz: b.attendee_tz,
    host_name: b.host_name, company_name: b.company_name, slug: b.slug,
    where: whereText(b as BookingMail),
  };
}

/** SQL error codes → what a visitor should read. */
export const BOOKING_ERRORS: Record<string, [number, string]> = {
  PAGE_NOT_FOUND: [404, 'This booking page is not available.'],
  NOT_FOUND: [404, 'That booking could not be found. Check the link in your email.'],
  BAD_EMAIL: [400, 'That email address does not look right.'],
  NAME_REQUIRED: [400, 'Add your name.'],
  PHONE_REQUIRED: [400, 'Add a phone number.'],
  TOO_SOON: [409, 'That time is too soon now. Pick another.'],
  TOO_FAR: [409, 'That time is too far ahead. Pick another.'],
  SLOT_TAKEN: [409, 'Someone just took that time. Pick another.'],
  DAY_FULL: [409, 'That day just filled up. Pick another day.'],
  ALREADY_CANCELLED: [409, 'This booking is already cancelled.'],
  ALREADY_HAPPENED: [409, 'This meeting has already started.'],
  BAD_RANGE: [400, 'That range is too long.'],
};

export function bookingError(message: string): [number, string] {
  const code = Object.keys(BOOKING_ERRORS).find((k) => String(message).includes(k));
  return code ? BOOKING_ERRORS[code] : [500, 'Something went wrong. Try again.'];
}
