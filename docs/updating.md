# Updating

Updating RunButter is two steps: **new code, then new schema.** In that order,
always — a migration usually assumes the app that ships with it.

## Node install (Supabase or any Postgres)

```bash
git pull
npm ci                       # not `npm install` — reproduces the lockfile exactly
npm run migrate              # applies only what is missing
npm run build && npm start   # or restart your host's service
```

`npm run migrate:status` first if you want to see what it would do. It prints
every file with a ✓ or a "pending", and applies nothing.

## Docker install

```bash
git pull
docker compose build
docker compose up -d
```

The `migrate` container runs the same runner on startup, so the schema follows
the image. `docker compose logs migrate` shows what it applied.

## What "in the app" tells you

**Settings → Updates** shows the version you are running, the latest published
release, and what changed. It asks GitHub's public releases API from the server,
caches the answer, and sends nothing about your instance — no telemetry, no
instance id, no phone-home. If your server has no outbound internet it simply
says it could not check.

## Rules the update path relies on

- **Migrations are additive and idempotent.** `create or replace`,
  `add column if not exists`. Re-running one is a no-op, and the runner skips
  files it has already recorded.
- **Nothing is destructive without saying so.** A migration that drops or
  rewrites something says it in its header comment and in the release notes.
  There are a few — for example, the ones that replace a function with an extra
  argument have to `drop function` first, because adding a parameter in Postgres
  creates an *overload* rather than a replacement.
- **One transaction per file.** A failure rolls that file back and stops. You
  are never left half-way through a migration; you are left before it.
- **The ledger is the truth.** `schema_migrations` records name, checksum and
  time. If you edit a migration that has already run, the runner notices the
  checksum changed and says so rather than silently ignoring it.

## Going from a hand-applied database to the runner

If you applied migrations by pasting them into the SQL editor, `schema_migrations`
is empty and a plain `npm run migrate` would re-apply every file. That is *safe*
— they are idempotent — but it is slow and it looks alarming.

If your database is **already up to date** with the code you have checked out:

```bash
npm run migrate -- --mark-applied
```

That records every file as applied, with the real checksums, and runs nothing.
From then on `npm run migrate` applies only what is genuinely new.

It is deliberately a flag you type rather than something the runner guesses. A
migration recorded as applied that never ran is a broken schema that reports
itself healthy, so nobody should be able to get there by accident. If you are
**not** sure your database is current, don't use it — `npm run migrate` and let
the files re-apply.

> The legacy ATS files are skipped on any database that already has tables, so
> `--mark-applied` on an existing install marks the numbered migrations only.
> That is correct: those files already ran, long ago, and re-recording them
> would claim the runner had seen them.

## Downgrading

There is no down-migration path, deliberately. A down migration that drops a
column is a data-loss button disguised as an undo, and one that does not is
theatre. If you need to go back, restore the database from a backup and check
out the matching tag — which is why the release notes name the migrations each
version adds.

## Before a big update

Take a backup. On Supabase that is Database → Backups; on your own Postgres,
`pg_dump`. Every schema change here is designed to be safe, but "designed to be"
is not the same as "your data, on your machine, on a Tuesday".
