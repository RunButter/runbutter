# Install

Three ways, in order of how little you have to know:

1. **[Docker](#1-docker)** — everything local, one command.
2. **[Supabase + Node](#2-supabase--node)** — hosted Postgres, run the app yourself.
3. **[Paste one SQL file](#3-no-terminal-paste-one-file)** — if you would rather not
   run a migration command at all.

All three need the same one hosted thing: a **Privy app id**, for sign-in.

---

## 0. Privy (2 minutes, required, free)

1. Sign up at [dashboard.privy.io](https://dashboard.privy.io) and create an app.
2. Copy the **App ID**.
3. In the app's settings, add the origin you will use — `http://localhost:3000`
   for a laptop, your real domain in production.

Login does not work without this and there is no fallback anywhere in the code.
A wrong value fails at the login screen, not at build time.

---

## 1. Docker

```bash
git clone https://github.com/RunButter/runbutter.git && cd runbutter
cp .env.docker.example .env
node scripts/gen-keys.mjs --write .env    # generates the secrets
#  ↳ paste your Privy app id into .env as PRIVY_APP_ID
docker compose up
```

Open <http://localhost:3000>.

That brings up five containers: Postgres, PostgREST, the storage API, an nginx
gateway and the app, plus a one-shot container that applies the schema. The
gateway exists because `supabase-js` expects a single origin serving both
`/rest/v1/` and `/storage/v1/`.

**Never ship the example keys.** `scripts/gen-keys.mjs` mints a JWT secret and
the anon/service keys; the service key bypasses row-level security on every
table. Supabase's own self-host guide publishes a demo `service_role` key, and
instances that keep it are wide open to anyone who has read that page.

`PUBLIC_SUPABASE_URL` is baked into the browser bundle at build time, so if you
change it you need `docker compose build app` again.

---

## 2. Supabase + Node

The path most people use in production. Nothing is shared with the hosted
service.

### a. Create the project

Create a project at [supabase.com](https://supabase.com). Any region, free tier
is fine to start.

### b. Apply the schema — one command

```bash
git clone https://github.com/RunButter/runbutter.git && cd runbutter
npm install

# Supabase → Project settings → Database → Connection string → Session pooler
# NOTE: port 5432 (session), NOT 6543 (transaction).
DATABASE_URL='postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres' \
  npm run migrate
```

That applies `supabase/bootstrap.sql`, then the legacy ATS schema (only on an
empty database), then every numbered migration — each in its own transaction,
each recorded in a `schema_migrations` table.

- `npm run migrate:status` lists what is applied and what is pending.
- It is safe to re-run. A file that already applied is skipped.
- A failure leaves nothing half-applied, and tells you which file it was.

> **Why the session pooler.** The transaction pooler on port 6543 gives you a
> different backend per statement. Migrations set session state and open
> transactions that span statements, so they fail there in ways that read as
> random. This is the single most common install problem.

### c. Point the app at it

```bash
cp .env.example .env.local
```

Fill in the four required values:

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page |
| `SUPABASE_SERVICE_ROLE_KEY` | same page — server-only, never expose it |
| `NEXT_PUBLIC_PRIVY_APP_ID` | the Privy app id from step 0 |

Everything else is optional. [Configuration](./configuration.md) says exactly
what each one switches on and what breaks without it.

### d. Run it

```bash
npm run dev          # or: npm run build && npm start
```

### e. Cron jobs (only for the features you use)

Several features are inert without a scheduler — nothing breaks, nothing fires.
Add only the ones you need. On Render/Fly/Railway these are cron services; on a
VPS, `crontab` with `curl`.

| Endpoint | How often | Auth header | Drives |
|---|---|---|---|
| `POST /api/automations/dispatch` | every minute | `x-cron-secret: $SUPABASE_SERVICE_ROLE_KEY` | Scheduled automations (event and webhook triggers already fire instantly) |
| `POST /api/newsletters/send` | every minute | `x-cron-secret: $SUPABASE_SERVICE_ROLE_KEY` | Newsletter delivery — **nothing mails without it** |
| `POST /api/sequences/run` | every minute | `x-cron-secret: $SUPABASE_SERVICE_ROLE_KEY` | Drip steps, enrolment, stale sweep, lead-score refresh |
| `POST /api/posts/dispatch` | every minute | `x-cron-secret: $SUPABASE_SERVICE_ROLE_KEY` | Scheduled social posts |
| `POST /api/agents/dispatch` | every 10 minutes | `x-cron-secret: $SUPABASE_SERVICE_ROLE_KEY` | Scheduled agents |
| `POST /api/finance/reminders/run` | daily | `Authorization: Bearer $CRON_SECRET` | Overdue-invoice reminders |
| `GET /api/excel/sync` | every 15 minutes | `Authorization: Bearer $CRON_SECRET` | Two-way Excel sync |

**The two secrets are not interchangeable.** Automations, newsletters,
sequences, posts and agents authenticate with the service-role key in
`x-cron-secret`; finance reminders and the Excel sweep use `CRON_SECRET`.

---

## 3. No terminal: paste one file

If you would rather not run a migration command, `supabase/schema.sql` is the
entire schema in one file, generated from the same migrations.

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the contents of [`supabase/schema.sql`](../supabase/schema.sql).
3. Run it. It is a lot of SQL — give it a minute or two.

It is only for a **new, empty database**. The last statement records every file
as applied, so if you later want `npm run migrate` for updates, it picks up
exactly where the paste left off instead of trying to replay everything.

Regenerate it after adding a migration with `npm run bundle:sql` — never edit it
by hand.

---

## After the install

- Sign up in the app; the first sign-up creates your workspace.
- An empty workspace offers **"Add sample data"** — four companies, invoices,
  projects and documents that reference each other, so the connections are
  visible before you type anything. It refuses on a workspace that already has
  records, deliberately: sample data mixed into real data is indistinguishable
  from it a week later.
- **Settings → Integrations** is where API keys, MCP and Excel live.
- **Account → AI keys** is where you add your own model provider key. There is
  no platform key; nothing AI works until you add yours, and it spends your
  credit, not ours.

## When something is wrong

| Symptom | Cause |
|---|---|
| Migrations fail with odd errors | Transaction pooler (6543) instead of session (5432) |
| Login screen does nothing | `NEXT_PUBLIC_PRIVY_APP_ID` missing, or the origin is not on Privy's allowed list |
| Build fails on every page | Same — a well-formed Privy app id is needed at build time to prerender |
| Newsletter says sent, nothing arrives | No cron on `/api/newsletters/send`, or no `RESEND_API_KEY` |
| Unsubscribe links point at the wrong host | `NEXT_PUBLIC_SITE_URL` not set |
| Sanctions screening returns `no_data` | `POST /api/sanctions/refresh` once to ingest the OFAC lists |

More in [Support](./support.md).
