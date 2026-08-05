# RunButter — the open company OS

One relational workspace for the whole company: **Sales · Finance · Marketing · Projects · HR**, plus Docs, Automations, and an open integration layer (REST, webhooks, MCP). Built to run cheaply: Postgres does the heavy lifting, and there are **no platform LLM costs** — AI features run on each workspace's own API keys.

**MIT licensed** — fork it, sell it, run it. No open-core, no AGPL, no
"community edition".

```bash
git clone https://github.com/CasperCrypto/hirebtr.git runbutter && cd runbutter
cp .env.docker.example .env
node scripts/gen-keys.mjs --env >> .env    # secrets, generated
#  ↳ then paste a free Privy app id into .env (dashboard.privy.io, 2 min)
docker compose up
```

That is Postgres, PostgREST, storage, all 104 migrations and the app —
five containers, one command, no SQL pasted anywhere. Open
<http://localhost:3000>.

Authentication is [Privy](https://dashboard.privy.io) and it is hosted; there is
no way around that in this stack, so it is said here rather than discovered
halfway through. Everything else — your data, your files, your API — stays on
your machine.

## What's inside

| Pillar | Highlights |
|---|---|
| **Sales** | People, companies, deals pipeline, offers → invoices, products, VAT/NIP autofill |
| **Finance** | Invoices & expenses, bank-ledger transactions with rule-based reconciliation, analytics, PDF documents, e-signatures, KSeF (PL) e-invoice export |
| **Marketing** | Campaigns, **newsletters** with AI drafting, **live segments** + lead scoring, **drip sequences**, post studio & content board, custom forms, short links, privacy-friendly web analytics, source tracking |
| **Projects** | Projects, issues, roadmap, board, mind maps |
| **HR (full ATS)** | Positions, candidate pipeline, Big-5 + work-style assessments, Talent Treasury, team-fit simulator, interviews (Google Calendar), onboarding & pulse checks, GDPR anonymization |
| **Docs & Files** | Markdown editor with BYO-AI assist (Claude, OpenAI, Gemini, OpenRouter, or any OpenAI-compatible endpoint); uploads are text-extracted and full-text searchable next to the ledger |
| **Chat** | Channels beside the work, with public/private visibility decided by a single SQL predicate. Agents can post too |
| **Agents** | Give an agent a role, scoped tools and reusable skill packs. Runs on your own AI key; proposes writes for approval unless you let it run |
| **Automate** | Trigger → filter → action rules, incoming webhooks, schedules, signed + retried outgoing webhooks, AI steps |
| **Integrations** | REST API (`/api/v1`), inbound hooks, **MCP server** (`/api/mcp`), and **Excel** — a read-only CSV feed you paste into Power Query, or a two-way Microsoft Graph sync |

## Stack

Next.js 14 (App Router) · React · Tailwind · Supabase (Postgres) · [Privy](https://privy.io) auth · Stripe · Resend. Runs anywhere Node runs (the hosted version lives on Render).

## Self-hosting

Two ways: everything in Docker, or bring your own Supabase. Nothing is shared
with the hosted service either way.

| Service | Needed? | Free? | What it's for |
|---|---|---|---|
| **Postgres** | Required | — | Included in `docker compose`, or bring a Supabase project |
| **Privy** | Required | Yes | Sign-in (email / Google) |
| Resend | Optional | Yes (100/day) | Candidate & status emails |
| Stripe | Optional | Yes | Billing / paid plans |
| Google Cloud | Optional | Yes | Calendar interview scheduling |

Everything optional **degrades gracefully** — the app runs fine without it.
### Docker (everything local)

The quick start above. `docker compose up` brings up Postgres, PostgREST,
storage, the migrations and the app. Only Privy is external.

### Bring your own Supabase

If you would rather use hosted Postgres:

1. **Privy**: free app at dashboard.privy.io. Copy the App ID and add your
   origin (e.g. `http://localhost:3000`) to its allowed list.
2. **Supabase**: create a project, then apply the schema — **one command, not
   104 files pasted by hand**:

   ```bash
   # Project settings → Database → Connection string → Session pooler
   # NOTE: port 5432 (session), NOT 6543 (transaction) — migrations need session state
   DATABASE_URL='postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres' \
     npm run migrate
   ```

   `npm run migrate:status` shows what is applied and what is pending. It is
   idempotent, it records what it has done, and each file runs in its own
   transaction — so a failure leaves nothing half-applied.
3. **Env**: copy `.env.example` → `.env.local` and fill in the Required block.
4. `npm install && npm run dev` (or `npm run build && npm start`).
5. **Optional cron jobs.** Each one powers a feature that is simply inert without
   it — nothing breaks, but nothing fires either. Add only the ones you use:

   | Endpoint | How often | Auth header | Drives |
   |---|---|---|---|
   | `POST /api/automations/dispatch` | every minute | `x-cron-secret: $SUPABASE_SERVICE_ROLE_KEY` | Scheduled automations (event and webhook triggers already fire instantly) |
   | `POST /api/newsletters/send` | every minute | `x-cron-secret: $SUPABASE_SERVICE_ROLE_KEY` | Newsletter delivery — **nothing mails without it** |
   | `POST /api/sequences/run` | every minute | `x-cron-secret: $SUPABASE_SERVICE_ROLE_KEY` | Drip steps, enrolment, the stale sweep and the lead-score refresh |
   | `POST /api/finance/reminders/run` | daily | `$CRON_SECRET` | Overdue-invoice reminders (also off per workspace until an owner enables them) |
   | `GET /api/excel/sync` | every 15 min | `Authorization: Bearer $CRON_SECRET` | Two-way Excel sync. Manual "Sync now" works without it |

   If you send newsletters, also set `NEXT_PUBLIC_SITE_URL` (or every unsubscribe
   and tracking link points at the wrong host) and `RESEND_WEBHOOK_SECRET` with a
   Resend webhook on `/api/newsletters/webhook` for `email.bounced` /
   `email.complained` — without it bounces never suppress, which is how a sending
   domain gets burned.

**Don't want to self-host?** Just sign up at [runbutter.app](https://runbutter.app) — same app, zero setup.

## Agents

Give an agent a role in plain words, tick the tools and record types it may
touch, and decide how far it goes. **26 tools** — records, finance, files,
compliance screening, hiring, web analytics — with the writing ones clearly
marked. It runs on **your own** API key (Claude, OpenAI, Gemini, OpenRouter, or
any OpenAI-compatible endpoint); there is no token markup and no AI credit.

- **Suggest mode is the default.** Every write is a proposal showing the exact
  record and the exact change, and nothing lands until you approve it.
- **Tenancy is enforced in SQL**, not in the prompt. Tool calls go through the
  same server-side functions the UI uses, with the workspace derived from a
  verified session — an agent cannot be talked into another tenant's data.
- **Only one tool leaves the workspace**, and it can only reach connections an
  owner already saved. The agent sends by id and never supplies a URL.
- Agents can run on a schedule, write findings back onto the record with the
  source attached, and share reusable skill packs.

Eight prebuilt agents ship in the gallery (finance controller, collections,
recruiting, contract reader, compliance, and more) — full write-up at
[runbutter.app/ai-agents](https://runbutter.app/ai-agents).

### Connect your own agent (MCP)

```json
{ "mcpServers": { "runbutter": {
    "type": "http", "url": "https://your-domain.com/api/mcp",
    "headers": { "Authorization": "Bearer hb_..." } } } }
```

The same tools, through the same executor — not a thinner read-only mirror.
Create the `hb_...` API key under **Settings → Integrations**; a read-scoped key
stays read-only there too. The same key works for the REST API
(`GET/POST /api/v1/records`).

## Security model

- Auth is Privy (signed ES256 JWTs). All authenticated data access goes through `/api/rpc`, which verifies the token server-side and never trusts a client-supplied identity.
- Workspace AI keys and integration secrets are encrypted at rest (AES-256-GCM).
- Public endpoints are rate-limited and body-capped; outbound fetches of user URLs pass an SSRF guard.
- Found something? See [SECURITY.md](SECURITY.md) — please report privately.

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [MIT](LICENSE).
