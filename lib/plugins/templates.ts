/**
 * The starting points — and, deliberately, the few-shot examples.
 *
 * ZERO IMPORTS IN THIS FILE, for the reason `lib/workspace/blueprint.ts` has
 * none: it is read both by a `use client` component and by a route handler, and
 * anything it pulls in that touches the browser Supabase client breaks the build
 * at page-data collection, where Next reports it as "join is on the client" and
 * hands you no followable clue.
 *
 * The templates are ALSO what the generator is shown before it writes anything.
 * That is the point of keeping one copy: improving a template improves what the
 * AI produces, and the two halves cannot drift into disagreeing about what a
 * good skill looks like. Every one of them scores 100 against `lint.ts` — a
 * template that failed our own linter would be teaching the opposite of what the
 * panel beside it says.
 */

export interface TemplateResource { path: string; purpose: string; content: string }
export interface TemplateSkill {
  name: string; description: string; instructions: string;
  whenToUse: string; allowedTools: string; resources: TemplateResource[];
}

/**
 * The second level of progressive disclosure, offered as one click.
 *
 * `reference.md` and `examples.md` are the two the docs themselves use, and
 * they are the two that actually change how a skill behaves: they let the
 * instructions stay short (which is what keeps a skill reliable) while the long
 * material sits one hop away, read only when the model decides it needs it.
 */
export const RESOURCE_PRESETS: { label: string; res: TemplateResource }[] = [
  {
    label: 'reference.md',
    res: {
      path: 'reference.md',
      purpose: 'Full detail — read when the summary in this file is not enough.',
      content: `# Reference

Put the long material here: the full API, the complete field list, the edge
cases, the table nobody memorises.

This file is NOT read every time the skill runs. It is read when the model
decides it needs it, which is why it can be long without costing anything.
`,
    },
  },
  {
    label: 'examples.md',
    res: {
      path: 'examples.md',
      purpose: 'Worked examples of the expected output. Read before producing one.',
      content: `# Examples

## Good

> A real example of the output you want, in full.

Why it works: …

## Bad

> A real example of the output you do NOT want.

Why it fails: …
`,
    },
  },
];

/**
 * The section structure a skill body actually wants.
 *
 * Taken from what the widely-used collections converge on (addyosmani/agent-skills
 * runs every one of its 24 skills through Overview → When to use → Process →
 * Rationalizations → Red flags → Verification). The two nobody thinks to write
 * are the ones that do the most work:
 *
 *  - RATIONALIZATIONS pre-empts the excuses a model talks itself into. "The
 *    tests are probably fine" is the sentence that precedes a broken deploy,
 *    and naming it in the skill is what stops it.
 *  - VERIFICATION turns a description into something checkable. Without it a
 *    skill can report success having done nothing.
 *
 * Offered as a scaffold rather than enforced: a two-line skill is legitimate,
 * and a builder that demands seven headings for it is a form, not a tool.
 */
export const BODY_SCAFFOLD = `## Overview

What this covers, in two or three sentences.

## When to use this

- Trigger: the situation that should bring you here.
- Not for: the neighbouring case this is NOT about.

## Process

1. First step, stated as an instruction.
2. Second step.
3. Third step.

## Rationalizations

Excuses to refuse, and what to do instead:

- "It is probably fine" -> check it, then say what you checked.
- "The user did not ask for that" -> if it is part of the task, do it.

## Red flags

Stop if any of these is true:

- A number you cannot show the source of.
- A step you skipped and did not mention.

## Verification

Before reporting done:

- [ ] Every step above actually ran.
- [ ] Anything skipped is named explicitly.
`;

export const TEMPLATES: { label: string; skill: TemplateSkill }[] = [
  {
    label: 'House writing style',
    skill: {
      name: 'House writing style',
      description: 'How we write to customers. Use for any outbound email, changelog entry or release note. Not for internal notes or code comments.',
      instructions: `## Rules

Write the way a competent colleague talks.

- Lead with the answer, then the reason. Never the other way round.
- One idea per sentence. Cut every adverb that is not load-bearing.
- Name things exactly: "invoice 1042", not "your recent invoice".
- Never apologise for something that did not happen, and never say "we
  understand your frustration".
- If you do not know, say so and say who does.

Banned: "seamless", "leverage", "reach out", "circle back", "at your earliest
convenience", exclamation marks.

## Output

Plain text, no headings. A subject line under 50 characters, then at most three
short paragraphs. No sign-off block — the sending client adds one.

## Examples

> Subject: Your March invoice is ready
>
> Invoice 1042 went out this morning, due 1 April. Nothing has changed since
> February except the seat count, which is now 14.
>
> Reply here if that count is wrong and I will reissue it.

Why it works: the answer is the first sentence, every number is exact, there is
one question, and nothing is padded.

## Verification

Before sending:

- [ ] The subject says what happened, not "Update".
- [ ] Every name and number is one you can point at a source for.
- [ ] No banned word survived.`,
      whenToUse: '', allowedTools: '', resources: [],
    },
  },
  {
    label: 'Invoice reminder tone',
    skill: {
      name: 'Invoice reminder tone',
      description: 'How this company chases an unpaid invoice. Use when writing any payment reminder, first notice through final. Not for a first invoice, a quote or a dispute.',
      instructions: `## Stages

First reminder (1–14 days late): assume an oversight. Friendly, three
sentences, no consequences mentioned.

Second (15–30): state the invoice number, the original due date and the days
outstanding. Ask directly when it will be paid. Still no threats.

Final (30+): factual and short. State the amount, the terms that were agreed,
and what happens next according to those terms.

Always:
- Name the invoice number and the original due date.
- Attach or link the invoice itself.
- Check for a partial payment before writing — chasing the full amount after
  someone has paid most of it is the fastest way to lose them.

Never: offer a discount, offer a payment plan, or imply the debt is disputed.
Those are decisions a person makes.

## Output

An email. Subject line naming the invoice number, then three to six sentences of
prose — never a bulleted list. A reminder that looks like a form gets treated
like one.

## Verification

Before sending:

- [ ] The invoice number and the original due date both appear.
- [ ] The payment status was checked, not assumed.
- [ ] The stage matches the days outstanding.

If the payment status cannot be read, do not send. Say the status is unknown and
stop — chasing an invoice somebody already paid costs more than a late reminder
does.`,
      whenToUse: 'When the user asks to chase a payment, mentions an overdue invoice, or asks for a reminder email.',
      allowedTools: '',
      resources: [{
        path: 'examples.md',
        purpose: 'Worked reminders at each stage. Read before writing one.',
        content: `# Examples

## First reminder — 6 days late

> Subject: Invoice 1042
>
> Hi Marta — invoice 1042 (due 1 March, $4,200) is still showing as unpaid on
> our side. I have attached it again in case it went astray. Could you let me
> know when it is likely to go out?

Why it works: names the invoice and the original date, assumes an oversight,
asks one question, and does not mention consequences.

## Final notice — 44 days late

> Subject: Invoice 1042, 44 days overdue
>
> Hi Marta — invoice 1042 for $4,200 was due on 1 March and is now 44 days
> outstanding. Our agreed terms are net 30, after which the account is placed
> on hold. I would rather not do that. Can you confirm a payment date this week?

Why it works: factual, states the agreed terms rather than inventing a threat,
and still leaves a way out.

## Bad

> Subject: URGENT!! Payment overdue!!!
>
> We understand your frustration but we must insist on immediate payment.

Why it fails: invented frustration, exclamation marks, no invoice number, no
date, and no specific ask.
`,
      }],
    },
  },
  {
    label: 'Weekly numbers review',
    skill: {
      name: 'Weekly numbers review',
      description: 'How to read the week and what counts as worth flagging. Use for any recurring numbers summary or status report. Not for a one-off question about a single metric.',
      instructions: `## Rules

Report only what moved, and say by how much against what baseline.

- Compare to the same weekday range last week, not to a rolling average — the
  average hides a weekend.
- Never report a percentage without the absolute number underneath it. "Up 50%"
  on a base of four is noise.
- Drop the current partial period. A month three days in is not a data point.
- If a number cannot be computed, say the number is missing. Do not substitute
  a similar one and do not estimate.

Flag, in this order: anything overdue, anything that changed by more than a
third, anything that stopped moving entirely.

## Output

A markdown table — metric, this week, last week, change — then at most three
bullets under it saying what to do about the rows worth acting on. Nothing else.

## Examples

> | Metric | This week | Last week | Change |
> |---|---|---|---|
> | Signups | 41 | 33 | +8 |
> | Overdue invoices | 6 | 2 | +4 |
> | Demo bookings | — | 12 | not available |
>
> - Overdue invoices tripled in a week; four of the six are one customer.
> - Demo bookings could not be read this week, so the number is missing rather
>   than zero.

Why it works: absolute numbers beside every change, a missing value shown as
missing, and the commentary only covers rows that need a decision.

## Verification

Before reporting:

- [ ] Every percentage has its absolute number beside it.
- [ ] The current partial period was dropped.
- [ ] Nothing that could not be computed was quietly filled in.`,
      whenToUse: 'When asked for a weekly summary, a Monday update, or "how did we do".',
      allowedTools: '', resources: [],
    },
  },
];
