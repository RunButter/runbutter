// A calendar file for one booking, and an "Add to Google Calendar" link — pure,
// ZERO imports, so the booking page builds the same file in the browser that the
// confirmation email attaches.
//
// METHOD:PUBLISH, not REQUEST: a REQUEST names an organizer and asks the reader
// to RSVP to them, and there is no mailbox here that would receive the answer.
// When the host has Google connected, Google sends the real invitation (with
// RSVP) and the email carries no file, so the visitor never gets two.
//
// The UID is the booking id, so a reschedule or a cancellation sent later
// updates the same event in the visitor's calendar instead of adding a second.

export interface IcsEvent {
  id: string;
  start: string | Date;
  end: string | Date;
  title: string;
  description?: string;
  location?: string;
  url?: string;
  /** Raised on every change so calendars apply it; seconds since epoch works. */
  sequence?: number;
  cancelled?: boolean;
}

const stamp = (d: string | Date) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// RFC 5545 §3.3.11: backslash, semicolon, comma and newlines are escaped.
const text = (s: string) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// §3.1: lines longer than 75 octets are folded with CRLF + space. Folding on
// UTF-16 units of at most 73 keeps multi-byte characters well under the limit
// for Latin text; a reader unfolds before decoding, so a split never corrupts.
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (parts.length ? 74 : 75)) { parts.push(cur); cur = ch; } else cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export function bookingIcs(e: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RunButter//Booking//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${e.cancelled ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${e.id}@runbutter-booking`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SEQUENCE:${Math.max(0, Math.floor(e.sequence ?? 0))}`,
    `SUMMARY:${text(e.title)}`,
    ...(e.description ? [`DESCRIPTION:${text(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
    ...(e.url && /^https?:\/\//i.test(e.url) ? [`URL:${e.url.replace(/[\r\n]/g, '')}`] : []),
    `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(e.cancelled ? [] : ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER:-PT15M', 'END:VALARM']),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** "Add to Google Calendar" — a public template link, no account of ours involved. */
export function googleCalendarLink(e: IcsEvent): string {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${stamp(e.start)}/${stamp(e.end)}`,
    ...(e.description ? { details: e.description.slice(0, 1500) } : {}),
    ...(e.location ? { location: e.location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}
