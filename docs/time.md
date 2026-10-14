# Time & leave

**HR → Time & leave** answers "where did everyone's time go": hours on a
timesheet, days off on the leave side, and billable hours turned into an invoice.

## Timesheet

- **Timer**: type what you are working on, pick a project and a client, press
  *Start*. One timer runs per person — starting another stops the first, in any
  tab or from the Copilot.
- **Add time** on any day: `1:30`, `1.5h`, `90m`, `1h 15m` all work.
- **Billable** with a rate per hour marks time you will charge for. ▶ on an entry
  continues it (on another day it starts a copy, so yesterday's total stays).
- Owners and admins can open anyone's timesheet and fix an entry.

## Reports → invoice

Pick a range (this week, last month…) and see hours by project, client or person,
and a CSV of every entry. **Ready to invoice** lists, per client, the billable
hours not invoiced yet: *Create invoice* makes a draft invoice (a line per project,
or per entry) through the same path as the invoice composer, and marks those
hours billed in the same transaction — an hour is never billed twice. Delete the
invoice and the hours are unbilled again. Entries without a rate take the rate you
type at that moment.

Members see their own time; owners and admins see everyone's.

## Time off

- **Balances** per type — Vacation 20 days a year by default, Sick leave counted
  but not capped, Unpaid, Other. Owners/admins edit the types and each person's
  allowance per year.
- **Request time off**: dates, half days at either end, a note. The count shown is
  working days — your work week minus public holidays. Sick leave (and any type
  set to *no approval*) is booked straight away; the rest waits for an owner or
  admin, who is emailed. The decision is emailed back.
- **Public holidays** are computed for 19 countries (PL, DE, AT, CH, CZ, GB, IE, US,
  FR, BE, NL, LU, ES, PT, IT, SE, NO, DK, FI) — national days only; add your
  region's or a company day off by hand. Changing the holidays or the work week
  recounts everyone's requests.
- **Who is off** is visible to the whole team, and on the company **Calendar**.
  *Why* — the type and the note — only the person and owners/admins see. Sick
  leave is health data; that rule is in the database, not just the screen.
- Approved time off and public holidays **block booking pages** for that person.
- Automations: *when time off is requested / changes to approved*. The note is
  never part of the automation's data.

## Copilot

`list_time_entries`, `log_time` ("log 2 hours on the Acme website yesterday") and
`list_time_off` ("who is off next week?"). Asking for or approving time off stays
a person's click — it emails people.

## Running it

Email needs `RESEND_API_KEY`; without it everything works and nobody is emailed.
Links in emails use `NEXT_PUBLIC_SITE_URL`.
