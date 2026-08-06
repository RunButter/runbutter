---
name: screen-a-new-client
description: Run the checks that should happen before invoicing a new client — sanctions screening, company registry lookup, and IBAN validation. Use when onboarding a customer, before a first invoice, or when asked to verify a company or bank account.
---

# Screen a new client

## Sanctions first

Call `get_sanctions_status` before `screen_sanctions`. If nothing has been
imported, screening returns `no_data`, which is **not** a clear result — it
means the question was never asked. Say so plainly; do not report an unscreened
name as clean. The fix is an OFAC list refresh, which is an administrator
action, not something you can do.

With data present, `screen_sanctions` fuzzy-matches the name and its aliases.
Treat any hit as a question for a human, never as a verdict: sanctions matching
is deliberately loose, and common names produce matches that are not the person.
Report the matched entity, the score, and what you think it is.

## Then the company

`validate_iban` checks a bank account offline — the ISO 13616 checksum and the
country's length rule. It proves the number is well-formed and belongs to the
country it claims. It does **not** prove the account exists or belongs to this
client, and saying otherwise gives false comfort on exactly the check that
matters for fraud.

For the company registry, the app's own lookup covers EU VAT (VIES) and the
Polish Biała lista. If you have a VAT or NIP number, say it can be verified
there rather than guessing at the company's details.

## Write it down

Put the outcome on the record with `add_record_note`: what you checked, what it
returned, and the date. Six months later "was this client screened?" has to be
answerable, and a chat transcript is not an audit trail.

## The order matters

Screen before the first invoice, not after. A compliance check that runs once
money has moved is a report, not a control.
