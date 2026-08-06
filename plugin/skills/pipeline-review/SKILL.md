---
name: pipeline-review
description: Review the sales pipeline for stalled deals, missing amounts and unrealistic forecasts, and produce a short prioritised list. Use for weekly pipeline reviews, forecast questions, or "what should I be working on".
---

# Pipeline review

## Get the board

`get_hiring_pipeline` is the recruiting board — not this one. For deals, use
`list_records` with `object: "deals"`, or read the pipeline through the record
tools; each row carries `stage`, `amount`, `status` and when it entered its
current stage.

## What to look for, in order

1. **Stalled.** Anything that has sat in one stage longer than that stage's
   normal dwell time. Compute the median per stage from the board you have
   rather than assuming a number — a 30-day proposal stage is healthy in one
   business and dead in another.
2. **No amount.** A deal without a value cannot be forecast and is usually a
   deal nobody has qualified.
3. **No recent contact.** `get_record_notes` on the company gives the last
   touch. Silence is the strongest single predictor of a lost deal.
4. **Close dates in the past.** Either it closed and nobody moved it, or the
   date was optimistic and has never been revisited.

## Reporting

Give at most ten items, each one line: what it is, what is wrong, and the single
next action. A review that lists forty problems gets read once and never acted
on.

State the weighted total separately from the raw total, and say which stages you
weighted and how. Do not invent probabilities per stage — if the workspace has
no historical conversion data, say the weighting is a convention and not a
measurement.

## Do not

Do not move deals between stages. Stage is a claim about reality that the person
who owns the deal makes. Propose the move and let them make it.
