---
name: reconcile-the-ledger
description: Match bank transactions against invoices and expenses, explain what could not be matched, and flag duplicates. Use for month-end close, bookkeeping questions, or "does the bank agree with our books".
---

# Reconcile the ledger

## Read before proposing

`get_ledger` returns bank transactions with their reconciliation state.
`get_finance_summary` and `get_finance_trends` give the totals the ledger should
add up to. Start by stating the gap: matched, unmatched, and how much each side
is worth. A reconciliation that does not begin with the size of the problem is
just a list.

## Matching

The app already suggests matches. Your value is in the ones it cannot resolve:

- **Part payments.** One invoice, several credits. Sum before concluding
  anything is missing.
- **Merged payments.** One credit covering several invoices — very common from
  larger clients, and it looks like an unexplained overpayment.
- **Currency and fees.** A credit short by a few units is usually a transfer
  fee, not a shortfall.
- **Timing.** A payment near a period boundary can be correct and still make the
  month look wrong.

## Duplicates

Flag two transactions with the same amount, counterparty and a date within a few
days of each other. Say "these look like the same payment recorded twice" — do
not delete anything. Deleting a real transaction is materially worse than
leaving a suspected duplicate for someone to look at.

## What to report

For every unmatched item: the amount, the date, the counterparty and your best
hypothesis. "Unmatched" alone sends someone back to the raw data you already
read.

Never state a reconciled balance you did not compute from the ledger you
actually read. If the tools returned partial data, say which part is missing —
a number presented as complete when it is not is the one output that can cause
real financial harm here.
