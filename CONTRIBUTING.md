# Contributing to RunButter

Thanks for being here. This file is the ground rules; the longer version, with
reasoning, is [docs/contributing.md](docs/contributing.md).

## Getting a working copy

`docker compose up` is the fastest route to a database — see
[docs/install.md](docs/install.md). Then `npm run dev`.

You need your own Privy app id (free, two minutes). There is no shared dev
database and no seeded account; the app offers to fill an empty workspace with
linked sample data on first run.

## Good first contributions

- **A workspace template for a trade you know** (`lib/workspace/templates.ts`).
  One file, no schema change. Two or three objects, only what that trade has and
  a general business does not, linked to the built-ins.
- **A documentation page that was wrong when you followed it.** Genuinely the
  most valuable bug reports we get.
- **An error message that does not tell you what to do next.**

## Conventions that matter

- **`supabase.rpc()` returns `{ data, error }` and never throws.** Always check
  `error`. It is a `PromiseLike`, so `.catch()` does nothing — use
  `.then(ok, err)`.
- **Authenticated data access goes through `lib/rpc.ts`** (the `/api/rpc`
  proxy). Never call an authenticated Supabase RPC from the browser. A new
  function needs adding to the allowlist in `app/api/rpc/route.ts`; a
  service-role-only function must stay out of it.
- **Semantic colour tokens only** — `bg-surface`, `text-secondary`,
  `border-subtle`. Literal palette classes (`bg-white`, `text-slate-800`) break
  dark mode. Type sizes come from the scale in `tailwind.config.js`, never
  `text-[13px]`.
- **Never use browser `confirm()` / `alert()`** — `useDialog()` from
  `components/ui/Dialog.tsx`.
- **Migrations are additive and idempotent** (`create or replace`,
  `add column if not exists`), one numbered file per change, ending with
  `notify pgrst, 'reload schema';`. Changing a function's signature needs a
  `drop function` first — adding a parameter creates an overload rather than a
  replacement — and the header comment should say so.
- **The five CRUD functions are redefined in full** whenever one changes, never
  shadowed by a parallel function. A new object needs a branch in **all five**.
- **Re-run `npm run bundle:sql`** after any migration; CI fails on a stale
  `supabase/schema.sql`.
- **No LLM or metered API calls in core paths.** Search is Postgres FTS. AI is
  strictly bring-your-own-key. A feature that costs money per call is one most
  self-hosters cannot switch on.
- **No fabricated data.** A trend line renders only when the real series
  supports it. If a number cannot be computed honestly, say so in the UI.
- **Licences: MIT in, MIT out.** Do not copy from AGPL or GPL projects
  (Twenty, Plane, listmonk, Mautic, Postiz). Reading them as feature specs is
  fine; nothing lands here from them.

## Before you open a PR

```bash
npx tsc --noEmit     # must be clean
npm run build        # the definitive check — it is what production runs
```

If you touched UI, look at it in both light and dark mode.

## Pull requests

- One concern per PR.
- Explain **why** in the description, not only what — specifically, what goes
  wrong without the change. That is the part a reader in six months cannot
  reconstruct from the diff.
- Say which migration number you add, and whether it is destructive.
- Don't commit `.env*`, editor folders, or `package-lock.json` churn — but **do**
  commit the lockfile when dependencies genuinely changed, or CI's `npm ci`
  fails.

## Conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Short version: argue about the work,
not the person doing it.

## Security

Do not open a public issue for a vulnerability — [SECURITY.md](SECURITY.md) has
the private path.
