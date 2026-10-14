// Booking emails — SERVER ONLY. Every message a booking sends, in one place.
//
// The visitor gets: the confirmation (with the link to reschedule or cancel), a
// reminder a day before, and a note when anything changes. The host gets: a new
// booking, a cancellation, a reschedule. Times are written in the READER'S zone —
// the visitor's browser zone for them, the page's zone for the host — with the
// zone named, because "14:00" in an email between two countries is a guess.
//
// When the host has Google Calendar connected, Google sends the real invitation
// and its updates, so the visitor's emails carry no .ics file (two invitations
// for one meeting is how people end up in two calendars). Without Google, the
// confirmation attaches one and a cancellation attaches the matching CANCEL.
//
// Best-effort like every other sender here: no RESEND_API_KEY, no email, and the
// booking still stands. A failed send never fails the booking it was about.
import { Resend } from 'resend';
import { bookingIcs, googleCalendarLink } from '@/lib/booking/ics';
import { manageLink, siteOrigin } from '@/lib/booking/token';

/** The shape booking_mail_json (0135) returns. */
export interface BookingMail {
  id: string;
  title: string;
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  notes?: string | null;
  starts_at: string;
  ends_at: string;
  status?: string;
  join_url?: string | null;
  attendee_tz?: string | null;
  google_event_id?: string | null;
  host_privy?: string | null;
  slug?: string | null;
  location?: string | null;
  location_detail?: string | null;
  timezone?: string | null;
  host_name?: string | null;
  host_email?: string | null;
  company_name?: string | null;
  from_name?: string | null;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const para = (s: unknown) => esc(s).replace(/\n/g, '<br/>');

function fromAs(name: string | null | undefined): string {
  const raw = process.env.RESEND_FROM || 'RunButter <notifications@runbutter.app>';
  const addr = /<([^>]+)>/.exec(raw)?.[1] || raw.trim();
  const clean = String(name || '').replace(/["<>\r\n]/g, '').trim().slice(0, 60);
  return clean ? `"${clean}" <${addr}>` : raw;
}

function validTz(tz: string | null | undefined): string | null {
  if (!tz) return null;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return tz; } catch { return null; }
}

/** "Tue 20 Oct 2026, 14:00–14:30 (Europe/Warsaw)" */
export function whenText(start: string, end: string, tz: string | null | undefined): string {
  const zone = validTz(tz) || 'UTC';
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(start));
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${day}, ${t.format(new Date(start))}–${t.format(new Date(end))} (${zone.replace(/_/g, ' ')})`;
}

/** Where the meeting happens, as one line a person can act on. */
export function whereText(b: BookingMail, forHost = false): string {
  switch (b.location) {
    case 'google_meet': return b.join_url ? `Google Meet: ${b.join_url}` : `Video call — ${forHost ? 'no Meet link was created (connect Google Calendar)' : `${b.host_name || 'the host'} will send the link`}`;
    case 'phone': return forHost ? `Phone call — call ${b.phone || 'them'}` : `Phone call — ${b.host_name || 'the host'} will call you${b.phone ? ` at ${b.phone}` : ''}`;
    case 'in_person': return b.location_detail ? `In person: ${b.location_detail}` : 'In person';
    case 'link': return b.join_url || b.location_detail ? `Online: ${b.join_url || b.location_detail}` : 'Online';
    default: return '';
  }
}

function shell(inner: string, footer = ''): string {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b;line-height:1.55">${inner}${footer ? `<p style="margin:24px 0 0;font-size:12px;color:#71717a">${footer}</p>` : ''}</div>`;
}
const button = (href: string, label: string, primary = true) =>
  `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;${primary ? 'background:#18181b;color:#fff' : 'background:#f4f4f5;color:#18181b'};padding:10px 18px;border-radius:999px;text-decoration:none;font-size:14px">${esc(label)}</a>`;

function detailsTable(rows: [string, string | null | undefined][]): string {
  return `<table style="border-collapse:collapse;font-size:14px;margin:12px 0">${rows.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#71717a;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${para(v)}</td></tr>`).join('')}</table>`;
}

async function send(p: {
  to: string | null | undefined; subject: string; html: string; text: string;
  fromName?: string | null; replyTo?: string | null; ics?: string | null;
}): Promise<boolean> {
  if (!process.env.RESEND_API_KEY || !p.to) return false;
  try {
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: fromAs(p.fromName), to: p.to, subject: p.subject, html: p.html, text: p.text,
      ...(p.replyTo ? { replyTo: p.replyTo } : {}),
      ...(p.ics ? { attachments: [{ filename: 'invite.ics', content: Buffer.from(p.ics, 'utf8'), contentType: 'text/calendar; charset=utf-8' }] } : {}),
    });
    return !error;
  } catch { return false; }
}

const icsFor = (b: BookingMail, cancelled = false) => bookingIcs({
  id: b.id, start: b.starts_at, end: b.ends_at,
  title: `${b.title}${b.host_name ? ` with ${b.host_name}` : ''}`,
  description: [whereText(b), `Reschedule or cancel: ${manageLink(b.id)}`].filter(Boolean).join('\n'),
  location: b.join_url || (b.location === 'in_person' ? b.location_detail || undefined : undefined) || undefined,
  url: b.join_url || undefined,
  sequence: Math.floor(Date.now() / 1000),
  cancelled,
});

const visitorTz = (b: BookingMail) => validTz(b.attendee_tz) || validTz(b.timezone) || 'UTC';
const hostTz = (b: BookingMail) => validTz(b.timezone) || 'UTC';
const withWhom = (b: BookingMail) => [b.host_name, b.company_name].filter(Boolean).join(', ');

/** To the visitor: it is booked (or moved), here is how to join and how to change it. */
export async function mailVisitorConfirmed(b: BookingMail, opts: { googleInvite: boolean; rescheduled?: boolean }): Promise<boolean> {
  const when = whenText(b.starts_at, b.ends_at, visitorTz(b));
  const where = whereText(b);
  const manage = manageLink(b.id);
  const gcal = googleCalendarLink({ id: b.id, start: b.starts_at, end: b.ends_at, title: `${b.title}${b.host_name ? ` with ${b.host_name}` : ''}`, description: `${where}\n\nReschedule or cancel: ${manage}`, location: b.join_url || b.location_detail || undefined });
  const verb = opts.rescheduled ? 'Rescheduled' : 'Confirmed';
  return send({
    to: b.email, fromName: b.from_name, replyTo: b.host_email,
    subject: `${verb}: ${b.title} — ${when.split(' (')[0]}`,
    ics: opts.googleInvite ? null : icsFor(b),
    html: shell(`<p style="margin:0 0 4px;font-size:13px;color:#71717a">${esc(verb)}</p>
      <h1 style="margin:0 0 4px;font-size:20px;font-weight:600">${esc(b.title)}</h1>
      <p style="margin:0 0 12px;color:#52525b">${esc(withWhom(b))}</p>
      ${detailsTable([['When', when], ['Where', where]])}
      <p style="margin:16px 0 0">${b.join_url ? button(b.join_url, 'Join') : ''}${button(gcal, 'Add to Google Calendar', !b.join_url)}${button(manage, 'Reschedule or cancel', false)}</p>`,
      `${opts.googleInvite ? 'A calendar invitation was sent separately. ' : 'The invitation is attached for Outlook and Apple Calendar. '}The reschedule link is yours — keep it to yourself. Replying to this email reaches ${esc(b.host_name || 'the host')}.`),
    text: `${verb}: ${b.title}\n${withWhom(b)}\n\nWhen: ${when}\n${where ? `Where: ${where}\n` : ''}\nReschedule or cancel: ${manage}\n`,
  });
}

/** To the host: someone booked, cancelled or moved a meeting. */
export async function mailHost(b: BookingMail, kind: 'new' | 'cancelled' | 'rescheduled', reason?: string | null): Promise<boolean> {
  const when = whenText(b.starts_at, b.ends_at, hostTz(b));
  const head = kind === 'new' ? 'New booking' : kind === 'cancelled' ? 'Cancelled' : 'Rescheduled';
  const url = `${siteOrigin()}/calendar/booking`;
  return send({
    to: b.host_email, fromName: 'RunButter', replyTo: b.email,
    subject: `${head}: ${b.name} — ${when.split(' (')[0]}`,
    html: shell(`<p style="margin:0 0 4px;font-size:13px;color:#71717a">${esc(head)} · ${esc(b.title)}</p>
      <h1 style="margin:0 0 12px;font-size:20px;font-weight:600">${esc(b.name)}${b.company ? ` <span style="color:#71717a;font-weight:400">· ${esc(b.company)}</span>` : ''}</h1>
      ${detailsTable([['When', when], ['Where', whereText(b, true)], ['Email', b.email], ['Phone', b.phone], ['Notes', b.notes], ['Reason', kind === 'cancelled' ? reason : null]])}
      <p style="margin:16px 0 0">${button(url, 'Open bookings')}</p>`,
      'Replying to this email reaches the person who booked.'),
    text: `${head}: ${b.name}${b.company ? ` (${b.company})` : ''}\n${b.title}\nWhen: ${when}\nEmail: ${b.email}\n${b.phone ? `Phone: ${b.phone}\n` : ''}${b.notes ? `Notes: ${b.notes}\n` : ''}${kind === 'cancelled' && reason ? `Reason: ${reason}\n` : ''}\n${url}\n`,
  });
}

/** To the visitor: it was cancelled — by them (a receipt) or by the host. */
export async function mailVisitorCancelled(b: BookingMail, opts: { by: 'host' | 'visitor'; reason?: string | null; googleInvite: boolean }): Promise<boolean> {
  const when = whenText(b.starts_at, b.ends_at, visitorTz(b));
  const again = b.slug ? `${siteOrigin()}/book/${b.slug}` : null;
  const lead = opts.by === 'host' ? `${b.host_name || 'The host'} cancelled this meeting.` : 'You cancelled this meeting.';
  return send({
    to: b.email, fromName: b.from_name, replyTo: b.host_email,
    subject: `Cancelled: ${b.title} — ${when.split(' (')[0]}`,
    ics: opts.googleInvite ? null : icsFor(b, true),
    html: shell(`<p style="margin:0 0 4px;font-size:13px;color:#71717a">Cancelled</p>
      <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;text-decoration:line-through">${esc(b.title)}</h1>
      <p style="margin:0 0 8px">${esc(lead)}</p>
      ${detailsTable([['When', when], ['Reason', opts.by === 'host' ? opts.reason : null]])}
      ${again ? `<p style="margin:16px 0 0">${button(again, 'Book another time')}</p>` : ''}`),
    text: `Cancelled: ${b.title}\n${lead}\nWhen: ${when}\n${opts.by === 'host' && opts.reason ? `Reason: ${opts.reason}\n` : ''}${again ? `\nBook another time: ${again}\n` : ''}`,
  });
}

/** To the visitor, about a day before. */
export async function mailVisitorReminder(b: BookingMail): Promise<boolean> {
  const when = whenText(b.starts_at, b.ends_at, visitorTz(b));
  const where = whereText(b);
  const manage = manageLink(b.id);
  return send({
    to: b.email, fromName: b.from_name, replyTo: b.host_email,
    subject: `Reminder: ${b.title} — ${when.split(' (')[0]}`,
    html: shell(`<p style="margin:0 0 4px;font-size:13px;color:#71717a">Reminder</p>
      <h1 style="margin:0 0 4px;font-size:20px;font-weight:600">${esc(b.title)}</h1>
      <p style="margin:0 0 12px;color:#52525b">${esc(withWhom(b))}</p>
      ${detailsTable([['When', when], ['Where', where]])}
      <p style="margin:16px 0 0">${b.join_url ? button(b.join_url, 'Join') : ''}${button(manage, 'Reschedule or cancel', !b.join_url)}</p>`),
    text: `Reminder: ${b.title}\n${withWhom(b)}\n\nWhen: ${when}\n${where ? `Where: ${where}\n` : ''}\nReschedule or cancel: ${manage}\n`,
  });
}
