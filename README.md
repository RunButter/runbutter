# RunButter — the open company OS

One relational workspace for the whole company: **Sales · Finance · Marketing · Projects · HR**, plus Docs, Automations, and an open integration layer (REST, webhooks, MCP). Built to run cheaply: Postgres does the heavy lifting, and there are **no platform LLM costs** — AI features run on each workspace's own API keys.

```bash
git clone https://github.com/RunButter/runbutter.git
cd runbutter && npm install
cp .env.example .env.local   # fill in Supabase + Privy
npm run dev
```

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

RunButter brings its own database and auth — you supply your own instances
(both have free tiers). Nothing is shared with the hosted service.

| Service | Needed? | Free? | What it's for |
|---|---|---|---|
| **Supabase** | Required | Yes | Postgres database + file storage |
| **Privy** | Required | Yes | Sign-in (email / Google) |
| Resend | Optional | Yes (100/day) | Candidate & status emails |
| Stripe | Optional | Yes | Billing / paid plans |
| Google Cloud | Optional | Yes | Calendar interview scheduling |

Everything optional **degrades gracefully** — the app runs fine without it.
Minimum to boot: Supabase + Privy, about 15 minutes.

1. **Supabase**: create a project, then in the SQL Editor run, in order:
   - `supabase/legacy/supabase-schema.sql` (base ATS schema), then the other
     `supabase/legacy/*.sql` files — see the README in that folder,
   - everything in `supabase/migrations/` in numeric order (`0001` → `0079`),
   - then paste `supabase/verify-migrations.sql` — every row should be ✅.
   - Enable the `pg_cron` and `unaccent` extensions (GDPR auto-anonymization).
   - **Order matters at the end.** `0040`, `0042` and `0077` revoke browser-key
     access and drop the legacy anon policies, so run them only **after** the app
     that expects the locked-down schema is deployed. On a fresh install that is
     automatic if you follow the numeric order; on an existing one, deploy first.
2. **Privy**: create a free app at dashboard.privy.io, copy the App ID, and add
   your domain (e.g. `http://localhost:3000`) to its allowed origins.
3. **Env**: copy `.env.example` → `.env.local`, fill in the Required block
   (Supabase + Privy + app URL). Leave the Optional blocks empty to start.
4. `npm install`, then `npm run dev` (or `npm run build && npm start` in prod).
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

## Connect AI agents (MCP)

```json
{ "mcpServers": { "runbutter": {
    "type": "http", "url": "https://your-domain.com/api/mcp",
    "headers": { "Authorization": "Bearer hb_..." } } } }
```

Create the `hb_...` API key under **Settings → Integrations**. The same key works for the REST API (`GET/POST /api/v1/records`).

## Security model

- Auth is Privy (signed ES256 JWTs). All authenticated data access goes through `/api/rpc`, which verifies the token server-side and never trusts a client-supplied identity.
- Workspace AI keys and integration secrets are encrypted at rest (AES-256-GCM).
- Public endpoints are rate-limited and body-capped; outbound fetches of user URLs pass an SSRF guard.
- Found something? See [SECURITY.md](SECURITY.md) — please report privately.

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [MIT](LICENSE).
