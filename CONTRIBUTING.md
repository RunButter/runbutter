# Contributing to RunButter

Thanks for helping! A few ground rules keep the codebase healthy:

## Setup

See the Self-hosting section of the README. You need your own Supabase
project + Privy app; there is no shared dev database.

## Conventions that matter here

- **`supabase.rpc()` returns `{ data, error }` and never throws.** Always
  check `error`. It's a `PromiseLike`, so use `.then(ok, err)`, not `.catch()`.
- **Authenticated data access goes through `lib/rpc.ts`** (the `/api/rpc`
  proxy) — never call an authed Supabase RPC directly from the browser, and
  add new function names to the allowlist in `app/api/rpc/route.ts` plus the
  revoke list in the latest lock migration.
- **Migrations are idempotent** (`create or replace`, `if not exists`) and end
  with `notify pgrst, 'reload schema';`. Add a presence row to
  `supabase/verify-migrations.sql` for each new migration.
- **No LLM/API calls in core paths** (resume parsing, scoring, search). AI is
  strictly bring-your-own-key.
- Don't copy code from AGPL projects (Twenty, Plane) — this repo is MIT.

## PRs

- Keep them focused; one concern per PR.
- `npx tsc --noEmit` must pass with 0 errors.
- Don't commit `package-lock.json` churn, `.env*`, or editor folders.
