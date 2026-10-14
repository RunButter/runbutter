# Booking pages

A link your customers open to book a meeting with you — like Calendly, but in the
same database as your CRM. A booking makes the person a contact in **People**,
puts the meeting on the company **Calendar**, emails both sides, and can open a
deal in the sales pipeline.

## Make a page

1. **Calendar → Booking pages → New page.**
2. Give it a title ("Intro call"), an address (`/book/anna-intro`), a length and
   where it happens:
   - **Google Meet** — a Meet link is created for each booking when the host has
     Google Calendar connected (Settings → Integrations). Without it, the
     confirmation says the host will send the link.
   - **Phone call** — the person leaves their number.
   - **In person** — the address is shown on the page.
   - **Your own video link** — Zoom, Teams, Whereby: the same link every time.
3. Set your **hours** per weekday (several ranges a day are fine) and your time
   zone. Visitors see the times in **their own** time zone.
4. Optional: start times every 15/30/60 minutes, minimum notice, how far ahead,
   breaks before and after, the most bookings per day, ask for company or phone,
   create a deal, and where new-booking emails go (blank = the host's sign-in
   email).

Share the link, or press **Embed** for an iframe to put on your website:

```html
<iframe src="https://YOUR-DOMAIN/book/anna-intro?embed=1" style="width:100%;min-height:720px;border:0" title="Book a meeting"></iframe>
```

## What a booking does

| | |
|---|---|
| **People** | The person is matched by email, or added (source `booking`). Over the plan's record limit the booking still happens, unlinked. |
| **Calendar** | The meeting appears in Month and Agenda. A cancelled one disappears. |
| **Google Calendar** | When the host connected Google: an event on their calendar with the visitor invited (and a Meet link). Moved and deleted with the booking. |
| **Deals** | With *Create a deal* on: a card at the top of the first stage, named after the page and their company. |
| **Emails** | Visitor: confirmation (with **Add to Google Calendar** and an `.ics` for Outlook/Apple when Google did not already send an invite), a reminder about a day before, and a note if anything changes. Host: new booking, cancelled, rescheduled. |
| **Automations** | *When a booking is added / changes* — with `{{name}}`, `{{email}}`, `{{company}}`, `{{phone}}`, `{{start}}`, `{{page}}`. Cal.com bookings fire the same trigger. |
| **Copilot** | `list_bookings` reads them. It cannot book or cancel — both email a real person. |

The visitor reschedules or cancels from the link in their email
(`/book/manage?b=…&t=…`); a team member cancels from the Booking pages screen
and can give a reason, which is sent to the visitor.

## How availability works

Free times = the page's weekly hours, minus the host's other bookings (from any
of their pages, with the breaks), minus anything inside the minimum notice or
past the horizon, minus days that already hold *most per day*.

**Your Google Calendar is not read.** RunButter only ever writes the events it
creates — that is a promise in the privacy policy, and the Google permission it
asks for is `calendar.events`, not read access to your calendar. So block time
off by changing your hours (or switching the page off), not in Google.

Two people picking the same time at the same second: the database takes a lock
per host and re-checks, so exactly one of them gets it and the other is asked to
pick again.

## Running it

- **Email** needs `RESEND_API_KEY` (and `RESEND_FROM`). Without it bookings
  still work; nobody is emailed.
- **Reminders** go out from the built-in scheduler on any long-lived server
  (Render, Docker, `next start`). On a serverless host, call
  `POST /api/booking/reminders` every 5–10 minutes with
  `x-cron-secret: <service-role key>`.
- **Links in emails** use `NEXT_PUBLIC_SITE_URL`.
- The visitor's reschedule link is derived from `SECRETS_MASTER_KEY` (or the
  service-role key). Rotating it closes every open link — people can still book
  again.

## Security notes

- The visitor has no account. Their key is `HMAC(server key, booking id)`; the
  database stores only its SHA-256, so the email link works without a secret
  being stored anywhere.
- The public page never sees the host's account id or notify address; the manage
  link never sees the Google event id, the person or the deal.
- A time the page does not offer (outside the hours, off the grid) is refused
  before anything is written — the same function decides what is shown and what
  is accepted.
- Booking is rate-limited per IP, has a honeypot field, and refuses an email
  address whose domain does not receive mail (a likely typo is asked about once).
- `/book/*` is the only path besides `/support/*` that may be framed by another
  site. Neither page does anything the visitor did not type.
