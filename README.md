# RunButter — the open company OS

One relational workspace for the whole company: **Sales · Finance · Marketing · Projects · HR**, plus Docs, Automations, and an open integration layer (REST, webhooks, MCP). Built to run cheaply: Postgres does the heavy lifting, and there are **no platform LLM costs** — AI features run on each workspace's own API keys.

```bash
git clone https://github.com/runbutter/runbutter.git
cd runbutter && npm install
cp .env.example .env.local   # fill in Supabase + Privy
npm run dev
```

## What's inside

| Pillar | Highlights |
|---|---|
| **Sales** | People, companies, deals pipeline, offers → invoices, products |
| **Finance** | Invoices & expenses, bank-ledger transactions with rule-based reconciliation, analytics, PDF documents, KSeF (PL) e-invoice export |
| **Marketing** | Campaigns, posts/content planner, privacy-friendly web analytics, source tracking |
| **Projects** | Projects, issues, roadmap, board |
| **HR (full ATS)** | Positions, candidate pipeline, Big-5 + work-style assessments, Talent Treasury, team-fit simulator, interviews (Google Calendar), onboarding & pulse checks, GDPR anonymization |
| **Docs** | Markdown editor with BYO-AI assist (Claude, OpenAI, Gemini, OpenRouter, or any OpenAI-compatible endpoint) |
| **Automate** | Trigger → filter → action rules, incoming webhooks, schedules, signed + retried outgoing webhooks, AI steps |
| **Integrations** | REST API (`/api/v1`), inbound hooks, **MCP server** (`/api/mcp`) so AI agents can read/write the workspace |

## Stack

Next.js 14 (App Router) · React · Tailwind · Supabase (Postgres) · [Privy](https://privy.io) auth · Stripe · Resend. Runs anywhere Node runs (the hosted version lives on Render).

## Self-hosting

1. **Supabase**: create a project, then in the SQL Editor run, in order:
   - `supabase-schema.sql` (base ATS schema), then the root `add-*.sql` modules,
   - everything in `supabase/migrations/` in numeric order (`0001` → `0040`).
   - Paste `supabase/verify-migrations.sql` afterwards — every row should be ✅.
   - Note `0040_lock_rpcs.sql` must run **after** the app is deployed (it cuts browser-key access to RPCs that the app now proxies server-side).
2. **Privy**: create an app at dashboard.privy.io, copy the App ID.
3. **Env**: copy `.env.example` → `.env.local` and fill in the required block. Everything else (Stripe, Resend, Google Calendar, analytics, KSeF) is optional and degrades gracefully.
4. `npm run dev`, or `npm run build && npm start` in production.
5. Optional cron for scheduled automations (event/webhook triggers already fire instantly):
   `POST /api/automations/dispatch` with header `x-cron-secret: $SUPABASE_SERVICE_ROLE_KEY`, every minute.

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
