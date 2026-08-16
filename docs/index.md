# RunButter documentation

RunButter is an open-source **company OS**: sales, finance, marketing, projects
and hiring on one relational Postgres core, with AI agents that work on the same
records your team does. MIT licensed, self-hostable, no per-token AI bill.

## The Copilot

A panel docked beside every screen that reads and writes your workspace on your
own AI key. It knows which screen you are on, it proposes changes rather than
making them, and every step it took is on the record. See
[Agents & the Copilot](./agents.md).

## Start here

| I want to… | Read |
|---|---|
| Run it on my own machine or server | [Install](./install.md) |
| Know what every environment variable does | [Configuration](./configuration.md) |
| Switch on cron, Stripe, email and the rest | [Going live](./going-live.md) |
| Move to a newer version safely | [Updating](./updating.md) |
| Understand how it is put together | [Architecture](./architecture.md) |
| Give an AI agent access to my workspace | [Agents](./agents.md) |
| Call it from my own code | [REST API & MCP](./api.md) |
| Track something the built-ins don't cover | [Custom objects](./custom-objects.md) |
| Keep the team's shared logins somewhere safe | [The team vault](./vault.md) |
| Report a bug, or a security issue | [Support](./support.md) |
| Send a pull request | [Contributing](./contributing.md) |
| See what's next | [Roadmap](./roadmap.md) |

## One calendar, because it is one database

Invoices due, bills to pay, issue deadlines, scheduled posts and newsletters,
campaign start and end dates, interviews and Cal.com bookings all appear on the
same grid — not because they were synced from five apps, but because they are
rows in one Postgres database and the calendar is a single query over them.
Money coming in and money going out are different colours, deliberately: "they
owe us this Friday" and "we owe this Friday" are opposite facts.

It reads only. An interview is still created in Hiring, where it also books
Google Meet and emails the candidate; a post is still scheduled in Marketing. A
second write path would be a second place for those rules to drift.

## Money you can ask questions of

**Finance → KPIs** answers what a founder actually gets asked: what is owed and
how late (ageing measured from the due date), how long clients take to pay, how
concentrated the revenue is, and what a lead costs. It deliberately does not
report MRR, ARR, churn, LTV, CAC or marketing ROI — this product holds no
subscription model and nothing links a campaign to an invoice, so each would be
an approximation that reads as a fact.

**Finance → Forecast** projects cash forward and lets you push on it: hire two
people from March, lose your biggest client, get paid three weeks sooner. The
server returns facts — cash, monthly history, open invoices by date, inferred run
rates — and the arithmetic runs in your browser, so every assumption stays
visible and editable rather than arriving as an authority. There is no
confidence interval attached, because a probability computed from a few months
of one company's history is decoration on a guess.

## Web analytics, without a second product

Cookieless and first-party from 0027, and since 0120 it answers the questions
that used to need a separate analytics app: **visits, bounce rate, visit
duration, entry and exit pages, custom events, goals, funnels and who is on the
site right now** — beside countries, cities, browsers, OS and UTM.

Visits are derived from the pageviews already stored rather than stamped at
collection, so applying the migration fills in a site's whole history rather
than starting from zero. One honest limitation, stated because it is real: the
visitor id rotates daily to keep the pipeline cookieless, so a visit cannot span
midnight UTC.

A goal is a page (`/thanks`, `/blog/*`) or a custom event the snippet sends with
`runbutter('Signup')`. Goals count **visitors**, not events — a form submitted
three times is one conversion. A funnel counts each step only for visitors who
reached it *after* the previous one, so the numbers can only fall; counting
steps independently produces funnels that widen, which tells you nothing except
that the chart is wrong.

Umami is still supported and is now genuinely optional — see
[Umami analytics](./umami-analytics.md) for why you probably no longer want it.

## Who owns the company

**Finance → Cap table** holds shares, options with real vesting schedules, SAFEs
and convertible notes, and models what a priced round does to everybody.

Three things it refuses to fudge:

- **A SAFE gets no ownership percentage.** It converts at a price that does not
  exist until a round does, and a percentage beside a SAFE is the classic
  homemade-cap-table lie. They are listed separately with their cap and discount
  and only become shares inside the round model.
- **Both percentages are shown.** "Of issued shares" is what a founder means;
  "fully diluted", including granted options *and* the unissued pool, is what an
  investor means. They differ by a lot.
- **Vesting is computed, never stored**, from the schedule and a date, rounded
  down. A stored vested count goes stale silently every day, and rounding up
  hands out equity nobody earned.

A SAFE converts at the **better of** its cap and its discount — the holder gets
the lower price and therefore more shares. Getting that backwards is the classic
modelling error and it always favours the founder, which is why nobody catches
it until the lawyers do.

It models **ownership only**: no liquidation preferences, participation,
anti-dilution or pro-rata. Those change an exit rather than the ownership line,
and half-modelling them produces a confident wrong number.

## Money in more than one currency

`currency` has been a column on invoices, expenses, transactions and bank
accounts since the first schema — and until 0121 nothing converted, so a €1,000
invoice and a $1,000 invoice were added together and reported as 2,000. Every
workspace picks a reporting currency, and every finance figure is converted into
it at the rate **on the transaction's own date**, never today's, so last
quarter's revenue does not quietly change every morning.

Rates come from the European Central Bank's daily reference feed: public,
keyless, unmetered, and published by the institution that sets them. Same rule
as OFAC for sanctions and VIES for VAT.

**An unknown rate is never treated as 1:1.** That would turn 5,000 JPY into
5,000 USD and report it with total confidence. Unconvertible amounts are summed
separately, named on screen with their currencies, and excluded from the totals
— a smaller, honest number with the gap stated beside it.

## The shape of it in one paragraph

Everything is one Postgres database. A company, a person, a deal, an invoice, a
campaign, a project and a candidate are rows that reference each other, which is
why "which contracts auto-renew, for clients who owe us money" is a query rather
than an afternoon. The browser never talks to the database directly: every
authenticated read and write goes through `/api/rpc`, which verifies a Privy JWT
server-side and calls a `SECURITY DEFINER` function that derives your workspace
in SQL. Agents and external MCP clients go through the same functions, so they
inherit the same tenancy rules rather than being trusted separately.

## What is not self-hosted

**Authentication is [Privy](https://privy.io)** and it is a hosted service. It
is free, it takes two minutes, and there is no way around it in this stack — so
it is said here rather than discovered halfway through an install. Everything
else — your data, your files, your API, your AI keys — stays where you put it.

Every other integration is optional and degrades honestly: without a Resend key
nothing emails and the UI says so; without Stripe the plan page renders and
checkout does nothing; without an AI key the agent screens explain what is
missing rather than failing.
