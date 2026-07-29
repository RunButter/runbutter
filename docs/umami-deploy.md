# Deploying Umami (optional)

**Read this first: you may not need it.** Migration 0062 gave the built-in
pipeline countries, cities, browsers, operating systems and campaign
attribution — the things people usually reach for Umami to get. What Umami adds
on top is **sessions**: bounce rate, visit duration, entry/exit pages, funnels
and retention. The built-in pipeline records pageviews, not sessions, so it
cannot produce those.

Deploy Umami if you want session metrics. Skip it if you wanted country data —
you already have that, with no extra service to run and with the events sitting
in the same Postgres as your leads and campaigns.

## The database is ready

The `runbutter-umami-db` Supabase project (`jziegkitndabcldxpmhf`, eu-west-1) is
empty, which is exactly right — Umami runs its own Prisma migrations on first
boot and builds its schema itself. Do not create tables in it by hand; Umami
tracks its own migration state and pre-made tables will make it fail.

### Connection string

Get it from **Supabase → runbutter-umami-db → Connect**, and take the
**session pooler** (port `5432`) or the **direct** connection.

> **Do not use the transaction pooler on port 6543.** Prisma migrations need
> session-level features that pgBouncer's transaction mode does not provide, and
> Umami will fail on first boot with a confusing error. This is the single most
> common way this setup goes wrong.

```
postgresql://postgres.jziegkitndabcldxpmhf:<DB-PASSWORD>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

`<DB-PASSWORD>` is the database password you set when creating the project. If
you don't have it, reset it under **Settings → Database → Database password**.

## Render service

Add to your Render blueprint, or create a service from the image in the
dashboard:

```yaml
services:
  - type: web
    name: umami
    runtime: image
    image:
      url: docker.io/umamisoftware/umami:postgresql-latest
    envVars:
      - key: DATABASE_URL
        sync: false                  # paste the session-pooler URL above
      - key: APP_SECRET
        generateValue: true          # rotating this invalidates all sessions
      - key: TRACKER_SCRIPT_NAME
        value: script                # must match the snippet the app renders
```

First boot creates an `admin` user with password `umami`. **Change it
immediately** — the API credential below is instance-wide.

## Connect it to RunButter

Migration 0059 is already applied, so only the environment variables are
outstanding. On the RunButter service:

| Var | Required | Notes |
|---|---|---|
| `UMAMI_URL` | yes | e.g. `https://umami.runbutter.app`, no trailing slash |
| `UMAMI_API_KEY` | preferred | Rotatable without touching the admin password |
| `UMAMI_USERNAME` / `UMAMI_PASSWORD` | fallback | Used only when no API key is set |

Then: **Marketing → Web analytics → Collect with Umami**, and **re-paste the
snippet**. It changes — the two collectors are different services, and leaving
the old `t.js` tag in place records into the built-in pipeline while the
dashboard reads Umami, which looks exactly like "no data".

Nothing is lost by switching: the built-in pipeline keeps every pageview it has
already recorded, and clearing `sites.umami_website_id` moves a site back.

## Diagnosing

`/api/analytics/stats` distinguishes the failure modes deliberately:

| Response | Meaning |
|---|---|
| `{available:false, reason:'not_configured'}` | No `UMAMI_URL` / credential set |
| `{available:false, reason:'migration_pending'}` | 0059 not applied (it is, so you shouldn't see this) |
| `{available:false, reason:'not_linked'}` | Site exists but was never connected |
| `502` | Umami unreachable or rejected the credential |

**Not verified against a live instance.** The REST contract came from Umami's own
MIT `@umami/api-client` (v0.80) because docs.umami.is is unreachable from CI.
Expect to smoke-test the first dashboard load.
