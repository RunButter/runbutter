# Architecture

The short version: **Postgres does the work, the app is a thin skin over
functions, and every caller — browser, agent, MCP client, spreadsheet — comes
through the same door.**

## The stack

| Layer | What |
|---|---|
| App | Next.js 14 (App Router), React, Tailwind, Geist |
| Data | Postgres (Supabase, or your own) |
| Auth | [Privy](https://privy.io) — hosted, ES256 JWTs |
| Files | Supabase Storage / storage-api, private buckets, signed URLs per read |
| Email | Resend (optional) |
| Billing | Stripe (optional) |

## The one rule: nothing talks to the database directly

The browser holds an anon key that can do almost nothing — `0046` revokes
`EXECUTE` from `anon` on the functions that matter. Instead:

```
browser  ──▶  /api/rpc  ──▶  SECURITY DEFINER function  ──▶  tables
              │
              └─ verifies the Privy JWT server-side,
                 overwrites p_privy with the verified id,
                 calls as service_role
```

The client cannot supply its own identity, because the proxy overwrites it. Each
function then derives the caller's workspace **in SQL** — `is_workspace_member`,
`workspace_role`, or `workspace_id = any(my)` — so tenancy is a property of the
query, not of the code that built it.

This is why agents are not a separate security surface. They call the same
functions with the same `p_privy`, so an agent cannot reach data its operator
cannot reach, no matter what a document told it to do.

## The CRUD monolith

Five functions — `list_records`, `get_record`, `create_record`, `update_record`,
`delete_record` — serve every object, built-in and custom. Adding an object
means adding a branch to each of the five.

That looks like a code smell and is the opposite. Because everything downstream
goes through those five — the tables, the forms, the CSV feed, the Excel sync,
the agent tools, `/api/mcp`, the import path — a new object is first-class in all
of them for free, and there is exactly one place where tenancy and validation
live. The convention is: **redefine them in full in a new migration; never add a
parallel path.**

Two rules inside them are worth knowing:

- **A key absent from the payload means "leave it alone"; a key present means
  "write it", including `null` to clear.** The test is `p_data ? 'field'`. The
  earlier form — `nullif(p_data->>'x','')` — blanked every column a partial
  update did not mention. The UI never hit it because forms post every field;
  agents, the REST API and Excel sync do not. Fixed in `0088`.
- **A custom object's links resolve to names in SQL** (`0089`), so a table, a
  CSV export and an agent all read "Northwind Freight" rather than a uuid.

## Custom objects

Rows in `custom_records.data jsonb`, not generated tables. A `SECURITY DEFINER`
function running `CREATE TABLE` from user input is one escaping mistake away
from arbitrary DDL across every tenant, so there is no DDL: one GIN index serves
every workspace, and values are coerced against the declared type on the way in.
Coercion **fails closed** — a bad number, date or select option is rejected, not
stored as text — because the CSV feed and the agents trust the declared type.

See [Custom objects](./custom-objects.md).

## Cost model

There is no usage meter under the product, and that is a design constraint
rather than a pricing decision:

- Search is Postgres full-text search (`tsvector` + GIN), not a search service.
- Candidate matching, reconciliation, segmentation and lead scoring are SQL.
- Company lookup is PL Biała lista + EU VIES; sanctions screening is the public
  OFAC lists ingested locally and matched with `pg_trgm`; IBAN validation is
  ISO 13616 arithmetic; geo analytics come from edge headers. All keyless.
- PDF tools run in the browser, so files never upload to a converter.
- AI is bring-your-own-key.

The rule for contributions: **prefer public data plus local computation over a
metered API.** A feature that adds a per-call cost to every install is a feature
most self-hosters cannot turn on.

## Sending things once

Newsletters and social posts both claim a row to `sending` **before** the
provider call, and a stale claim is swept to `failed` — never back to `pending`.
A unique constraint on `(campaign, recipient)` makes a duplicate structurally
impossible. A message sent twice to a real audience is a public incident with no
undo; a message missed is a support question. Do not turn these into retries.

## Design system

Semantic tokens only — `bg-surface`, `text-secondary`, `border-subtle` — because
literal colours (`bg-white`, `text-slate-800`) are what break dark mode. Type
comes from a scale in `tailwind.config.js`, never `text-[13px]`. Hierarchy comes
from size and colour, not weight: page and card titles are `font-medium`, and
`font-bold` is not used in the product UI at all.

## Repository map

```
app/                Next.js routes. (crm)/ is the signed-in shell.
  api/rpc           the proxy every authenticated call goes through
  api/v1, api/mcp   the public REST feed and the MCP server
components/         React components; components/ui is the primitive layer
lib/
  agents/           the tool catalogue and the one executor behind agents + MCP
  crm/              object registry, loaders, custom objects
  workspace/        blueprints, vertical templates, the AI workspace builder
  excel/, marketing/, finance/, pdf/, files/
supabase/
  migrations/       numbered, idempotent, applied in order
  legacy/           the original ATS schema, only run on an empty database
  bootstrap.sql     roles + auth/storage objects a bare Postgres lacks (no-op on Supabase)
  schema.sql        generated: all of the above in one file
scripts/            migrate, bundle-sql, gen-keys
docs/               this documentation
```
