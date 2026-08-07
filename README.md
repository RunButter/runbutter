<div align="center">

# RunButter

**The open-source company OS.** Sales · Finance · Marketing · Projects · HR —
one relational Postgres core, with AI agents that work on the same records your
team does.

[Website](https://runbutter.app) ·
[Documentation](https://runbutter.app/developers) ·
[Agents](https://runbutter.app/ai-agents) ·
[Roadmap](docs/roadmap.md) ·
[Discussions](https://github.com/RunButter/runbutter/discussions)

[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
![Postgres](https://img.shields.io/badge/Postgres-16-black.svg)
![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)
![No AI token bill](https://img.shields.io/badge/AI-bring%20your%20own%20key-black.svg)

</div>

---

Most companies run a CRM, an accounting tool, a marketing tool, a project board
and an ATS — five subscriptions that never talk to each other, and one afternoon
a month spent copying between them.

RunButter is one workspace where a company, a person, a deal, an invoice, a
campaign, a project and a candidate are **connected records in one database**.
That is what makes "which contracts auto-renew, for clients who owe us money" a
query instead of an afternoon.

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
one command, no SQL pasted anywhere.

Prefer hosted Postgres? `npm run migrate` applies the schema to any Supabase
project in one command. No terminal at all? Paste
[`supabase/schema.sql`](supabase/schema.sql) into the SQL editor. Full
instructions: **[docs/install.md](docs/install.md)**.

> Authentication is [Privy](https://privy.io) and it is hosted — free, two
> minutes, and there is no way around it in this stack, so it is said here
> rather than discovered halfway through. Everything else stays on your machine.

## What's inside

| Pillar | Highlights |
|---|---|
| **Sales** | People, companies, a drag-and-drop deal pipeline, offers → invoices, products, VAT/NIP autofill |
| **Finance** | Invoices and expenses, a bank ledger with rule-based reconciliation, branded PDFs, e-signatures, KSeF (PL) e-invoices |
| **Marketing** | Campaigns, newsletters, live segments and lead scoring, drip sequences, a post studio that publishes to LinkedIn and X, forms, short links, cookieless analytics |
| **Projects** | Projects, issues, board, roadmap, mind maps |
| **HR (a full ATS)** | Positions and a public careers page, candidate pipeline, Big-5 and work-style assessments, interviews via Google Calendar, onboarding, GDPR tooling |
| **Docs & Files** | Documents, notes, checklists and tables in one editor; export to PDF/Word in the browser; uploads are text-extracted and full-text searchable **next to the ledger** |
| **Agents** | 26 tools behind one executor, reusable skill packs, notes written back onto records, scheduled unattended runs |
| **Automate** | Trigger → filter → action, incoming webhooks, signed and retried outgoing webhooks |
| **Integrations** | REST API, MCP server, and Excel — a read-only CSV feed or a real two-way Microsoft Graph sync |
| **Anything else** | Custom objects: describe your business and get a workspace, or start from one of ten trade templates |

## Three things that make it different

**It costs nothing per query.** Search is Postgres full-text search. Matching,
reconciliation, segmentation and lead scoring are SQL. Company lookup uses the
public VIES and Biała lista registries; sanctions screening ingests the OFAC
lists and matches them locally with `pg_trgm`; IBAN validation is arithmetic;
PDF tools run in your browser so files never upload. There is no meter under the
product.

**AI is bring-your-own-key.** Claude, OpenAI, Gemini, OpenRouter or any
OpenAI-compatible endpoint, added per workspace and sealed at rest. No
per-token markup, no "AI credits", no plan that rations how much thinking you
are allowed. → [docs/agents.md](docs/agents.md)

**Agents are not a second security model.** Every tool call goes through the
same `SECURITY DEFINER` functions the UI uses, with tenancy derived in SQL —
so an agent cannot be talked into another workspace's data, because the query
never had access to it. Writes are proposals until you approve them.
→ [docs/architecture.md](docs/architecture.md)

## Connect an AI client (MCP)

```json
{ "mcpServers": { "runbutter": {
    "type": "http", "url": "https://your-domain.com/api/mcp",
    "headers": { "Authorization": "Bearer hb_..." } } } }
```

Create the key under **Settings → Integrations**. The same key works for the
REST API (`GET/POST /api/v1/records`) and the CSV feed Excel reads directly.
→ [docs/api.md](docs/api.md)

## Stack

Next.js 14 (App Router) · React · Tailwind · Postgres (Supabase or your own) ·
[Privy](https://privy.io) auth · Stripe · Resend. Runs anywhere Node runs.

## Documentation

| | |
|---|---|
| [Install](docs/install.md) | Docker, Supabase + Node, or one SQL file |
| [Configuration](docs/configuration.md) | Every variable and what it switches on |
| [Updating](docs/updating.md) | New code, then new schema |
| [Architecture](docs/architecture.md) | One database, one door |
| [Custom objects](docs/custom-objects.md) | Track what your business actually has |
| [Agents](docs/agents.md) | Roles, tools, and what bounds them |
| [REST API & MCP](docs/api.md) | Keys, scopes, the CSV feed |
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

## Licence

[MIT](LICENSE). Every dependency and data source in here is compatible with
that, and it is checked deliberately: nothing is copied from AGPL or GPL
projects, however good they are.
