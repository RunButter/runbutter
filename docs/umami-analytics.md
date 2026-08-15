# Web analytics on Umami

RunButter's web analytics can be served by a self-hosted [Umami](https://github.com/umami-software/umami)
instead of the built-in `site_events` pipeline (migrations 0027/0029/0030).

## Why not Plausible

Plausible CE is **AGPL-3.0**, which is a wall rather than a preference: shipping
or modifying it inside an MIT product forces the whole product to AGPL. It was
read as a feature spec instead — the questions its dashboard answers — and 0120
answers them in Postgres, written from scratch. The conventions it made standard
(a 30-minute session gap, a bounce as a one-pageview visit) are conventions, not
code, and matching them is what makes a number comparable to one somebody
already knows from another tool.

## Why Umami and not Plausible

| | Umami | Plausible CE |
|---|---|---|
| Licence | **MIT** — white-labelling inside an MIT product is unambiguous | AGPL-3.0 — modifications must be published |
| Storage | **PostgreSQL** (or MySQL) | ClickHouse **plus** its own Postgres |
| Runtime | one Node process, ~512 MB | Elixir/Phoenix + ClickHouse, ~4 GB realistic |

Plausible is the faster engine at tens of millions of events. Neither of those
advantages outweighs the licence friction and the second database technology at
RunButter's scale.

## What you lose, and what stays

The built-in pipeline is **not removed**. It keeps collecting for any site
without a `umami_website_id`, and its history stays queryable through
`get_site_stats` forever. The swap is per-site and reversible — clear the
column and that site reads from Postgres again.

**This page's original reason no longer applies.** Umami was added because the
built-in pipeline could not compute session metrics — bounce rate, visit
duration, funnels — and countries and browsers came later in 0062. Migration
**0120 computes all of it locally**: visits, bounce rate, visit duration, entry
and exit pages, custom events, goals, funnels and a live visitor count. And
because visits are derived from the events already stored rather than stamped at
ingest, they appear for a site's whole history the day you apply it.

So the honest position today: **you almost certainly do not need this.** Umami
is still supported, still per-site, still reversible, and worth deploying only
if you want its own retention controls and query tooling, or you are already
running it. Otherwise it is a second application and a second database for
questions Postgres is already answering.

What you give up by moving a site to Umami: analytics events no longer live in
the same database as `leads`, `campaigns` and `deals`, so you cannot SQL-join a
pageview to a deal — and goals and funnels are the built-in ones or Umami's, not
both. That join is the built-in pipeline's structural advantage, and it is a
larger one now than when this page was written.

## Deploying Umami

Umami needs its own Postgres database. **Do not point it at the Supabase
database RunButter uses** — Umami runs its own Prisma migrations and manages its
own schema; sharing one database means two migration systems in one namespace.

### Render

Add a service from Umami's Docker image and a Postgres instance alongside it:

```yaml
# render.yaml — add to the existing blueprint
services:
  - type: web
    name: umami
    runtime: image
    image:
      url: docker.io/umamisoftware/umami:postgresql-latest
    envVars:
      - key: DATABASE_URL
        fromDatabase: { name: umami-db, property: connectionString }
      - key: APP_SECRET
        generateValue: true          # rotating this invalidates all sessions
      - key: TRACKER_SCRIPT_NAME
        value: script                # keep in sync with the snippet the app renders

databases:
  - name: umami-db
    plan: basic-256mb
```

First boot creates an `admin` user with password `umami`. **Change it before
pointing anything at the instance** — the API credential below is
instance-wide.

### Docker Compose (local or a VPS)

```bash
docker run -d --name umami -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/umami \
  -e APP_SECRET="$(openssl rand -hex 32)" \
  docker.io/umamisoftware/umami:postgresql-latest
```

## Wiring it to RunButter

1. Run **migration 0059** in the Supabase SQL editor.
2. Set the env vars below on the RunButter service.
3. Open **Marketing → Web analytics**, pick a site, press **Collect with Umami**.
4. **Re-paste the snippet.** It changes — the two collectors are different
   services, and leaving the old `t.js` tag in place records into the old
   pipeline while the dashboard reads Umami, which looks like "no data".

### Environment variables

| Var | Required | Notes |
|---|---|---|
| `UMAMI_URL` | yes | e.g. `https://umami.runbutter.app`, no trailing slash |
| `UMAMI_API_KEY` | preferred | Rotatable without touching the admin password |
| `UMAMI_USERNAME` / `UMAMI_PASSWORD` | fallback | Used only when no API key is set |

Set either the API key **or** the username/password pair. `umamiConfigured()`
returns false without one, and every site silently keeps using the built-in
pipeline — so a half-finished setup degrades instead of breaking.

## Security notes

The Umami credential is **instance-wide**: whoever holds it can read and delete
every website on the box. It therefore never reaches the browser.

- `lib/analytics/umami.ts` is server-only.
- `/api/analytics/stats` and `/api/analytics/site` verify a Privy session, then
  re-check workspace membership in Postgres via `get_site_umami` /
  `link_site_umami` before any Umami call.
- The Umami website id always comes from the `sites` row, never from the
  request — a client cannot ask for another tenant's website by id.

Unlike `/api/rpc`, these routes do **not** fail open when Privy's JWKS is
unreachable: there is no claimed identity to fall back on. During a Privy
outage the dashboard falls back to the built-in pipeline rather than exposing
data to an unverified caller.

## Verifying

`/api/analytics/stats` returns `{ available: false, reason }` rather than an
error for every "not set up" case, so you can tell them apart:

| `reason` | Meaning |
|---|---|
| `not_configured` | No `UMAMI_URL` / credential on this deployment |
| `migration_pending` | 0059 hasn't been run |
| `not_linked` | Site exists but was never connected to Umami |

A `502` means Umami itself is unreachable or rejected the credential.
