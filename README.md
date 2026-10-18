<div align="center">

# RunButter

**The open-source company OS.** Sales · Finance · Marketing · Support · Projects · HR —
one Postgres database, and a copilot that works on the same records your team does.

[Website](https://runbutter.app) ·
[Documentation](https://runbutter.app/developers) ·
[Agents](https://runbutter.app/ai-agents) ·
[Roadmap](docs/roadmap.md) ·
[Discussions](https://github.com/RunButter/runbutter/discussions)

[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
![Postgres](https://img.shields.io/badge/Postgres-16-black.svg)
![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)
![No AI token bill](https://img.shields.io/badge/AI-bring%20your%20own%20key-black.svg)
[![Star on GitHub](https://img.shields.io/github/stars/RunButter/runbutter?style=flat&color=black&label=stars)](https://github.com/RunButter/runbutter/stargazers)

</div>

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/hero-dark.webp" />
  <img src="docs/images/readme/hero-light.webp" alt="The deals board with the copilot open beside it: it read the pipeline, then drafted an invoice, a task and an automation that wait for one click" width="100%" />
</picture>

<p align="center"><sub>Ask in plain words. The copilot reads the same records you see, and anything it wants to change waits for your <b>Apply</b>.</sub></p>

---

Most companies run a CRM, an accounting tool, a marketing tool, a help desk, a
project board, an ATS and a scheduling link — seven subscriptions that never
talk to each other, and an afternoon a month spent copying between them.

RunButter is one workspace where a company, a person, a deal, an invoice, a
chat, a project and a candidate are **connected records in one database**. That
is what makes "which clients who owe us money also booked a call this week" a
question you can ask instead of an afternoon.

**MIT licensed.** Fork it, sell it, run it. No open-core, no AGPL, no "community
edition" with the good parts removed.

## Quick start

```bash
npx create-runbutter
```

That checks your machine, clones, generates every secret, asks for a free Privy
app id and starts the containers. Open <http://localhost:3000>.

<details>
<summary>Or do it by hand</summary>

```bash
git clone https://github.com/RunButter/runbutter.git && cd runbutter
cp .env.docker.example .env
node scripts/gen-keys.mjs --write .env      # secrets, generated in place
#  ↳ paste a free Privy app id into .env (dashboard.privy.io, 2 minutes)
docker compose up
```

</details>

Postgres, PostgREST, storage, the whole schema and the app — five containers,
one command, no SQL pasted anywhere. Automations, reminders and scheduled agents
run on a built-in scheduler, so there is no cron to set up either.

Prefer hosted Postgres? `npm run migrate` applies the schema to any Supabase
project in one command. No terminal at all? Paste
[`supabase/schema.sql`](supabase/schema.sql) into the SQL editor. Full
instructions: **[docs/install.md](docs/install.md)**.

> Authentication is [Privy](https://privy.io) and it is hosted — free, two
> minutes, and there is no way around it in this stack, so it is said here
> rather than discovered halfway through. Everything else stays on your machine.

## A tour

<table>
<tr>
<td width="50%" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/finance-dark.webp" />
  <img src="docs/images/readme/finance-light.webp" alt="Finance overview: revenue, costs, profit and money owed, with twelve months of revenue against costs" />
</picture>
<b>Finance that adds up by itself.</b> Invoices, expenses, a bank ledger with
reconciliation, VAT, branded PDFs, e-signatures and KSeF e-invoices (PL). The
numbers on the dashboard are the invoices — there is no second copy to drift.
</td>
<td width="50%" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/leads-dark.webp" />
  <img src="docs/images/readme/leads-light.webp" alt="Find leads: eight dentists in Kraków with ratings, phones, emails and websites" />
</picture>
<b>Find leads — for free.</b> "Dentists in Kraków" → every one, with phone,
website and often an email, from ~70 million businesses of open map data. No
key, no cost. Check their websites, save the good ones as Leads.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/inbox-dark.webp" />
  <img src="docs/images/readme/inbox-light.webp" alt="Support inbox: a conversation with a customer, an AI reply and an internal note" />
</picture>
<b>A support inbox and a chat for your website.</b> One script tag. Whoever
writes in becomes a person in your CRM; an agent can draft the first reply;
internal notes never reach the customer.
</td>
<td width="50%" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/automations-dark.webp" />
  <img src="docs/images/readme/automations-light.webp" alt="Automations written as sentences: when an invoice's status changes to paid, send an email then add a note" />
</picture>
<b>Automations you can read.</b> <i>When an invoice's status changes to paid →
email them, then add a note.</i> Pickers, not JSON. Email, team chat, AI, hand
it to an agent, webhooks — and a Test button that really runs it.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/sheet-dark.webp" />
  <img src="docs/images/readme/sheet-light.webp" alt="A sheet in Docs: a hiring budget whose totals are SUM and AVERAGE formulas" />
</picture>
<b>Docs, notes, checklists and sheets that calculate.</b> 500+ Excel functions,
running in your browser. Mail merge a letter into one copy per customer. Export
to PDF or Word without the file leaving your machine.
</td>
<td width="50%" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/booking-dark.webp" />
  <img src="docs/images/readme/booking-light.webp" alt="A public booking page: pick a day and a time for a 30-minute intro call" />
</picture>
<b>Booking pages, without Calendly.</b> Your hours, your buffers, a Google Meet
link, reminders, and the person who booked lands in People — with a deal if you
want one.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/time-dark.webp" />
  <img src="docs/images/readme/time-light.webp" alt="Timesheet: a running timer and a week of entries by project and client, most of them billable" />
</picture>
<b>Time tracking that becomes an invoice.</b> A timer, a weekly timesheet, then
"invoice the billable hours" in one click. Time off with allowances, approvals
and public holidays for 19 countries.
</td>
<td width="50%" valign="top">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/survey-dark.webp" />
  <img src="docs/images/readme/survey-light.webp" alt="NPS survey results: score 56 from 103 answers, a score distribution and the comments" />
</picture>
<b>NPS and CSAT, answered in one tap.</b> The score is a link in the email, the
answer is filed on the customer and their company, and an unhappy one can fire
an automation.
</td>
</tr>
</table>

## Everything in it

| | |
|---|---|
| **Copilot & agents** | A copilot beside every screen that reads and writes the same records you do, with suggest/auto per conversation. Agents with their own tools, skills and schedules. Every write is a proposal until a person approves it. The tool list is generated from [`lib/agents/catalog.ts`](lib/agents/catalog.ts) and published at [`/.well-known/mcp.json`](https://runbutter.app/.well-known/mcp.json) — read one of those rather than a number typed into a README |
| **Sales** | People and companies, a deals board and calendar, offers → invoices, products, orders, **find leads** from open map data or Google, **company lookup** by VAT number from national registers across Europe and beyond, **booking pages** |
| **Finance** | Invoices and expenses, **scan a receipt** into an expense, a bank ledger with rule-based reconciliation, KPIs and forecast, cap table, branded PDFs, e-signatures, KSeF (PL) e-invoices, sanctions screening, IBAN checks |
| **Marketing** | Newsletters built from blocks or drafted by AI, live segments and lead scoring, drip sequences, a post studio that publishes to LinkedIn and X, forms, short links, cookieless web analytics, a **design spec** builder for your brand |
| **Support** | A shared inbox fed by a chat widget on your site, AI-drafted replies, **NPS and CSAT surveys** |
| **HR** | A full ATS: positions and a public careers page, candidate pipeline, Big-5 and work-style assessments, interviews via Google Calendar, onboarding, GDPR tooling. **Timesheets** and **time off** |
| **Projects** | Projects, issues, board, roadmap, mind maps |
| **Docs & files** | Documents, notes, checklists and **sheets with formulas**; mail merge; PDF/Word export in the browser; uploads are text-extracted and full-text searchable **next to the ledger** |
| **Automate** | When → only if → then, written as a sentence. Record changes, forms, chats, bookings, schedules and webhooks as triggers; email, chat, notes, AI, agents and signed webhooks as steps |
| **Team** | Team chat with channels, assets, and a password vault the server itself cannot read |
| **Integrations** | REST API, an MCP server (with OAuth, so claude.ai can connect), and Excel — a read-only CSV feed or a real two-way Microsoft Graph sync |
| **Anything else** | Custom objects: describe your business and get a workspace, or start from one of ten trade templates. Every object gets a table, a board, a calendar, CSV import, automations and agent tools the day you create it |

## Three things that make it different

**It costs nothing per query.** Search is Postgres full-text search. Matching,
reconciliation, segmentation and lead scoring are SQL. Leads come from Overture
Maps and OpenStreetMap; company details from public tax and business registers;
sanctions screening ingests the OFAC lists and matches them locally with
`pg_trgm`; public holidays are computed, not fetched; sheets calculate in
WebAssembly in your browser; PDF tools never upload. There is no meter under
the product.

**AI is bring-your-own-key.** Claude, OpenAI, Gemini, OpenRouter or any
OpenAI-compatible endpoint, added per workspace and sealed at rest. No
per-token markup, no "AI credits", no plan that rations how much thinking you
are allowed — and a usage report that shows every token, per feature.
→ [docs/agents.md](docs/agents.md)

**Agents are not a second security model.** Every tool call goes through the
same `SECURITY DEFINER` functions the UI uses, with tenancy derived in SQL —
so an agent cannot be talked into another workspace's data, because the query
never had access to it. Changing the shape of a workspace (a new object, an
automation, a member) is always a proposal, whatever the autonomy setting.
→ [docs/architecture.md](docs/architecture.md)

## Free tools, no account

All client-side, all MIT. Nothing uploads — they exist because they are useful,
and because they are the honest way to show what the rest is like.

| | |
|---|---|
| [**DESIGN.md builder**](https://runbutter.app/brand) | Upload a logo and a brand PDF, get the exact hex codes, type levels and rules out of them. Exports Google's [DESIGN.md](https://github.com/google-labs-code/design.md) format, Tailwind v4, CSS variables. |
| [**Style library**](https://runbutter.app/brand/library) | Complete design systems, free to copy into Claude Code, Cursor or Copilot. |
| [**Agent skill builder**](https://runbutter.app/plugins) | Write a skill, get a spec-conformant Agent Plugins 1.0 package. |
| [**PDF toolkit**](https://runbutter.app/pdf) | Merge, split, rotate, watermark, PDF→images, PDF→Markdown. The files never leave your machine. |
| [**Password generator**](https://runbutter.app/password) | Rejection-sampled, entropy shown, no network. |
| [**AI cost calculator**](https://runbutter.app/ai-cost) | What an agent actually costs to run, per model. |

<table>
<tr>
<td width="50%"><a href="https://runbutter.app/brand"><img src="docs/images/design-studio.png" alt="The design studio: brand tokens on the left, a live preview of a real page on the right" /></a></td>
<td width="50%"><a href="https://runbutter.app/plugins"><img src="docs/images/skill-builder.png" alt="The agent skill builder" /></a></td>
</tr>
</table>

## Connect an AI client (MCP)

```json
{ "mcpServers": { "runbutter": {
    "type": "http", "url": "https://your-domain.com/api/mcp",
    "headers": { "Authorization": "Bearer hb_..." } } } }
```

Create the key under **Settings → Integrations**. On claude.ai, add the URL as a
connector and sign in instead — the server speaks OAuth, so there is no key to
paste. The same key works for the REST API (`GET/POST /api/v1/records`) and the
CSV feed Excel reads directly. → [docs/api.md](docs/api.md)

## Stack

Next.js 14 (App Router) · React · Tailwind · Postgres (Supabase or your own) ·
[Privy](https://privy.io) auth · Stripe · Resend. Runs anywhere Node runs.

## Documentation

| | |
|---|---|
| [Install](docs/install.md) | Docker, Supabase + Node, or one SQL file |
| [Configuration](docs/configuration.md) | Every variable and what it switches on |
| [Going live](docs/going-live.md) | Email, billing, secrets, publishing |
| [Updating](docs/updating.md) | New code, then new schema |
| [Architecture](docs/architecture.md) | One database, one door |
| [Custom objects](docs/custom-objects.md) | Track what your business actually has |
| [Agents](docs/agents.md) | Roles, tools, and what bounds them |
| [REST API & MCP](docs/api.md) | Keys, scopes, the CSV feed |
| [Find leads](docs/lead-finder.md) · [Company lookup](docs/company-lookup.md) | Where the data comes from, and what you may do with it |
| [Booking pages](docs/booking.md) · [Time & leave](docs/time.md) | Scheduling, timesheets, time off |
| [Support inbox](docs/support.md) · [Chat widget](docs/chat-widget.md) · [Surveys](docs/surveys.md) | Talking to customers |
| [Scan receipts](docs/receipts.md) · [Files](docs/file-extraction.md) | Documents that become data |
| [Roadmap](docs/roadmap.md) | Shipped, next, and deliberately declined |

## Contributing

Pull requests welcome — [CONTRIBUTING.md](CONTRIBUTING.md) has the conventions,
and a few of them are load-bearing (idempotent migrations, semantic colour
tokens, no metered APIs in core paths).

**A good first contribution:** a workspace template for a trade you know. One
file, no schema change, and the person who actually runs a bakery will do it
better than we would. → [docs/contributing.md](docs/contributing.md)

Found something broken? [Open an issue](https://github.com/RunButter/runbutter/issues).
Found a vulnerability? [SECURITY.md](SECURITY.md) — privately, please.

<!-- docs/images/social-preview.png is for the repository's SOCIAL PREVIEW, set
     in Settings → General → Social preview. GitHub does not read it from the
     tree, so it has to be uploaded by hand — once. Without it, every link to
     this repo posted anywhere renders as a grey box with a filename.

     The screenshots in docs/images/readme/ use made-up data: every company,
     person and number in them is invented. -->

## If this is useful

**Star it.** It is the whole marketing budget. A star is how the next person
looking for "open source CRM I can self-host" finds out this exists, and it
costs you one click.

Then: run it, break it, and [tell us what broke](https://github.com/RunButter/runbutter/issues).
The most useful issue is the one that starts "I tried to do X and".

## Licence

[MIT](LICENSE). Every dependency and data source in here is compatible with
that, and it is checked deliberately: nothing is copied from AGPL or GPL
projects, however good they are.
