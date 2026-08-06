---
name: chase-overdue-invoices
description: Find invoices that are past their due date, work out who owes what and for how long, and draft a chaser for each one. Use when asked about overdue payments, debtors, aged receivables, or "who hasn't paid us".
---

# Chase overdue invoices

## Find them

Call `get_finance_summary` first — it returns the outstanding total, so you know
whether there is anything to chase before listing anything.

Then `list_records` with `object: "invoices"`. An invoice is overdue when
`status` is `overdue`, or when `status` is `sent` and `due_at` is in the past.
Check both: `overdue` is set by a sweep, so a freshly-lapsed invoice is still
`sent` and would otherwise be missed.

## Order by what actually matters

Sort by **days late × amount**, not by amount alone. A 90-day-late 2,000 is a
worse problem than a 5-day-late 20,000, because age predicts non-payment and a
few days usually means the payment run has not happened yet.

## Before drafting anything

Look up the client with `get_record` on the invoice's `organization_id`, then
`get_record_notes` on it. Someone may have already agreed a payment plan or
noted a dispute. Chasing a client who was promised until the 30th is worse than
not chasing at all, and the note is the only place that agreement exists.

## Draft, do not send

Produce one message per invoice with the number, the amount, the due date and
the days elapsed. Match tone to age: under 14 days is a reminder that assumes an
oversight; over 60 days states the position and asks for a payment date.

Never claim a payment has not arrived without checking `get_ledger` for a
matching credit first — reconciliation runs on a schedule, so money can be in
the account and not yet against the invoice. Chasing someone who has paid costs
more than the invoice is worth.

Then stop and show your drafts. Sending is a human decision.
