# Contributing

The full guide is [CONTRIBUTING.md](../CONTRIBUTING.md) at the repository root.
This page is the short version plus the conventions that are easy to miss.

## Getting set up

[Install](./install.md) — Docker is the fastest way to a working database.
Then `npm run dev`.

Before opening a PR:

```bash
npx tsc --noEmit     # types
npm run build        # the definitive check — it is what production runs
```

## Good first contributions

- **A workspace template for a trade you know.** One file
  (`lib/workspace/templates.ts`), no schema change, and the person who actually
  runs a bakery will do it better than we would. Two to three objects, only what
  that trade has and a general business does not, linking to the built-ins.
- **A translation of an error message that reads badly.**
- **A doc page that was wrong when you followed it.** These are the most useful
  bug reports of all.

## Conventions worth knowing before you write code

**`supabase.rpc()` returns `{ data, error }` and never throws.** Always check
`error`. It is a `PromiseLike`, so `.catch()` does nothing — use `.then(ok, err)`.

**Semantic tokens only.** `bg-surface`, `text-secondary`, `border-subtle` — never
`bg-white` or `text-slate-800`, which is what breaks dark mode. Type sizes come
from the scale in `tailwind.config.js`, never `text-[13px]`.

**Migrations are additive and idempotent**, one file per change, numbered, and
they end with `notify pgrst, 'reload schema';`. Adding a parameter to a Postgres
function creates an *overload* rather than replacing it, so a signature change
has to `drop function` first — say so in the header comment.

**The five CRUD functions are redefined in full**, in a new migration, whenever
one changes. Never add a parallel path. A new object needs a branch in all five —
`assets` was listed, deletable and in the nav for months with no create branch,
because only three of the five had heard of it.

**After a migration that changes the schema:** `npm run bundle:sql` regenerates
`supabase/schema.sql`. CI fails if you forget.

**No fabricated data.** Trends and sparklines render only when the real series
supports them. If a number cannot be computed honestly, the UI says so instead
of showing a plausible one.

**Cost rule.** No LLM or metered API in a core path. Search is Postgres FTS; AI
is bring-your-own-key. A feature that costs money per call is one most
self-hosters cannot switch on.

**Licences.** MIT in, MIT out. Do not copy from AGPL or GPL projects — read them
as feature specs if you like, but nothing lands here from them.

## Commit and PR style

Explain *why* in the commit body, not only what. The most useful commits in this
history describe the failure the change prevents — that is the thing a reader six
months later cannot reconstruct from the diff.

One concern per PR. If a change touches SQL, say in the description which
migration number it adds and whether it is destructive.
