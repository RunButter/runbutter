# RunButter — Project Context (Claude Code)

**RunButter** (formerly HireBTR) — an open-source **company OS**, MIT. One relational Postgres core
across **Sales · Finance · Marketing · Projects · HR** (+ Docs, Automate, Team). Live at **runbutter.app**.

> **Hard rule:** the original ATS is the **HR module** — keep it. Nothing is deleted in the pivot.
> Its motto still stands for that module: *hire better by skills and personality.*

## Stack
- Next.js 14 (App Router), React, **Tailwind v3**, **Geist** font.
- **Public repo: `RunButter/runbutter`** (MIT). `CasperCrypto/hirebtr` is the private origin the
  hosted app deploys from; the public one is pushed to deliberately, not automatically.
- **Supabase** (Postgres). Auth via **Privy** (NOT Supabase Auth).
- Stripe (billing), Resend (email), Google Calendar (interviews), @dnd-kit (kanban), Chart.js (radar),
  cmdk + Radix (shadcn primitives), pdf-lib + signature_pad (e-sign).

## Deploy
> **This file is PUBLIC** — it ships in an open-source repository. Keep engineering
> context here and keep instance state out: no project refs, no dashboard URLs, no
> "which security migration has not run on production yet". That last one is a map.
- Pushing the default branch triggers the host's auto-deploy.
- Migrations live in `supabase/migrations/00NN_*.sql`. **`npm run migrate` applies them**
  (session pooler, port 5432); `npm run migrate:status` shows what is pending. Applying
  them by hand in the SQL Editor still works — `--mark-applied` reconciles the ledger
  afterwards. Re-run `npm run bundle:sql` after adding one, or CI fails on a stale
  `supabase/schema.sql`.
- **Schema state: 0001–0091 reported applied by the owner; 0092 is NEW and pending.** 0092 is what
  gives the Deals board a create path — until it runs, "New" on `/pipelines/sales/board` returns
  *"Deals need migration 0092"* and the board stays read-only. Do not take that on trust when
  something behaves oddly — paste **`supabase/verify-recent.sql`** into the SQL editor. It probes for
  what each recent migration CREATES rather than reading a version number, so it answers honestly on
  a database that was migrated by hand and has no ledger. 0088 is the one worth confirming: without
  it `update_record` blanks every column a partial update does not mention, and nothing says so.
- **Billing reaches the product through TWO columns.** Stripe writes `companies.plan`; every
  new-platform screen reads `workspaces.plan` (`get_my_workspace`, 0051). 0005's trigger only
  ever copied it AFTER INSERT, so an upgrade never arrived — 0090 adds the update trigger and
  repairs the drift. `companies_plan_check` also predated the pivot and rejected `team`/`business`;
  it now accepts both those and the legacy names, which `normalizePlan()` still maps.
- **Migration conventions that keep biting:**
  - Adding a parameter to a Postgres function creates an **overload**, not a replacement, so a
    signature change must `drop function` first. `save_agent` (0068, 0084), `save_doc` (0081,
    0085, 0086), `post_message` (0081) and `create_api_key` (0078) all do this deliberately.
  - A default that means "unset" must be `null`, not a real value. 0081 gave `save_doc.p_kind` a
    `'doc'` default, which made "I am not saying" indistinguishable from "make it a document" and
    silently converted tables back into docs; 0085 fixed it.
  - Clients should fall back to the older signature when a migration has not run, so the feature
    degrades instead of the screen breaking.
- **Ops each feature needs** (nothing mails, sends or fires without them) — the full table is in
  `docs/install.md`: crons for automations, newsletters, sequences, posts and agents authenticate
  with `x-cron-secret: <service-role key>`; finance reminders and the Excel sweep use `CRON_SECRET`.
  `NEXT_PUBLIC_SITE_URL` decides every unsubscribe link and OAuth redirect. `RESEND_WEBHOOK_SECRET`
  is what makes bounces suppress. `POST /api/sanctions/refresh` once, or screening stays `no_data`.
- `UMAMI_*` env vars only if you deploy Umami.
- **`careers_slug` lives on `companies`, not `workspaces`** — easy to get wrong; the careers page
  resolves the company by slug.
- **This sandbox cannot reach `supabase.co`.** Any data-backed page rendered locally shows its empty
  state (careers 404s, a public form says "isn't available"). That is the network, not a bug — check
  the RPC through the Supabase connector before chasing it.

## Self-hosting
- **`npm run migrate` is now the way to apply schema** — `scripts/migrate.mjs` against any Postgres.
  It applies `supabase/bootstrap.sql`, then `supabase/legacy/*` (**only on an empty database**),
  then every numbered migration, one transaction each, recorded in `schema_migrations`.
  `npm run migrate:status` lists what is pending. **Supabase needs the SESSION pooler (5432)**, not
  the transaction pooler (6543).
- **`supabase/bootstrap.sql`** creates the roles, `auth` schema and `storage.buckets`/`objects` the
  schema assumes exist. Every statement is guarded, so it is a **no-op on real Supabase** — that is
  what removes the branch from the runner. Storage table shapes match `supabase/storage-api`.
- **`docker compose up`** = Postgres + PostgREST + storage + nginx gateway + app. The gateway exists
  because `supabase-js` talks to ONE origin with `/rest/v1/` and `/storage/v1/` prefixes. GoTrue is
  absent on purpose — auth is Privy, which is the one hosted dependency and cannot be removed.
- **`scripts/gen-keys.mjs`** mints the JWT secret and the anon/service keys. Never ship defaults:
  Supabase's own self-host guide publishes a demo `service_role` key that bypasses RLS everywhere.
- `output: 'standalone'` in `next.config.js` is for the Docker image; Render is unaffected.

## Critical conventions
- **`supabase.rpc()` returns `{ data, error }` — it never throws.** Always check `error` (recurring bug
  source). It's a `PromiseLike`, so **no `.catch()`** — use `.then(ok, err)`.
- **Auth pattern:** `set_config('app.current_privy_user_id', user.id, false)` then **`SECURITY DEFINER`
  RPCs** taking `p_privy text`. Anon EXECUTE is revoked (0046), so they only work through the
  **`/api/rpc` proxy**, which verifies the Privy JWT and calls as `service_role`.
- **Workspace resolution:** new-platform pages resolve via the **`accounts`** table (`get_my_workspace`
  → `effective_workspace`, latest def in **0051**). The HR half uses `hr_company_id()` off
  `company_users`. `workspace_id == company_id` (same uuid, 0005 sync trigger).
- **Resolving a company from `company_users` by `privy_user_id` alone is wrong twice over.**
  `.single()` throws "multiple rows returned" for anyone in two companies (broke sign-in once);
  `.limit(1)` **without `ORDER BY`** silently returns an *arbitrary* company, which reads as
  "my positions disappeared" while the careers page (resolving by slug) still shows them.
  HR screens must use **`resolveHrCompany()` / `resolveHrCompanyId()` (`lib/hr/company.ts`)** —
  it mirrors `hr_company_id()` (0051): active workspace first, else the OLDEST membership.
- **CRUD monolith** (`list/get/create/update/delete_record`) is redefined IN FULL per migration —
  extend the latest def rather than adding a parallel one. New subsystems get **dedicated RPCs**.
  - **`update_record` semantics (0088): key ABSENT = leave the column alone; key PRESENT = write it,
    including NULL to clear.** The test is `p_data ? 'field'`. Before 0088 every branch except
    `transactions` used a bare `nullif(p_data->>'x','')`, so a partial update **blanked every field
    it did not mention** — an agent linking an invoice to a company erased its number, dates and
    notes. The UI never hit it because the form posts every field; agents, the REST API and Excel
    sync do not. Keep the `case when p_data ? …` form when adding a column.
  - **`assets` had no create or update branch until 0088** despite being listed, deletable, in the
    nav and having a page — the Add button raised `UNKNOWN_OBJECT`. Check a new object appears in
    ALL FIVE functions.
- **Migrations** are idempotent (`create or replace`, `add column if not exists`) and end with
  `notify pgrst, 'reload schema';`.
- **Cost rule:** never add LLM/API calls to resume parsing or scoring. Resume search = Postgres FTS
  (`tsvector` + GIN). AI features are **BYO key** only.
- **Sample fallback:** `lib/crm/*.ts` loaders return sample data + `live:false` when unauthenticated or
  an RPC is missing → amber "Sample" badge.
- Psychometrics: discrete int columns on the latest `assessment_results`
  (overall/personality/work_style/screening_score) + Big-5 in `personality_data` JSONB.

- **Custom objects (0087)** are what make this a general tool rather than five hardcoded verticals.
  - **JSONB, never DDL.** A SECURITY DEFINER function running `CREATE TABLE` from user input is one
    escaping mistake from arbitrary DDL across every tenant — same reasoning as `segment_match`.
    Rows live in `custom_records.data jsonb`; one GIN index serves every workspace.
  - **The CRUD monolith gained one branch each, at the END.** That ordering is the safety property:
    a custom object can never shadow a built-in, and `reserved_object_slug` refuses the name at
    creation so the collision is impossible rather than merely lost. Because everything downstream
    (agent tools, `/api/mcp`, the CSV feed, Excel sync, imports, `RecordTable`) goes through those
    five functions, a custom object is first-class everywhere for free. **Extend them; never add a
    parallel path.**
  - `coerce_custom_value` **fails closed** — a bad number, date or select option is REJECTED, not
    stored as text, because the CSV feed and agents trust the declared type. URLs are http/https
    only. Undeclared keys are DROPPED so a payload can't widen the row's shape.
  - Deleting a FIELD deliberately leaves the values in `data` — re-adding it brings them back.
    Deleting an OBJECT cascades to fields and rows, which is why it is owner/admin only.
  - `lib/crm/custom.ts` converts a custom object into the **same `ObjectDef`** the registry
    produces, which is why no view needed changing.

- **Workspace builder** (`lib/workspace/*`, `/api/workspace/build`) — describe a business, get a
  plan of objects and fields. **The plan is DATA and creating is a separate act**: the route returns
  a blueprint and writes nothing, and applying it loops the ordinary `save_custom_object` /
  `save_custom_field` calls the manual builder uses. That separation is the security model, not a
  UX preference — the description is untrusted and so is anything a model does with it, so the
  reply is re-validated against the same whitelist SQL enforces and then shown to a person. A
  prompt injection's best outcome is a silly plan somebody declines.
  - **Templates are not a fallback** — they work with no AI key, on the free plan, identically
    every time, AND they are the few-shot examples the model sees, so the two halves cannot drift.
    A template never recreates a built-in; it links to one with a `relation` field.
  - `lib/workspace/blueprint.ts` **must stay import-free of `lib/crm/custom.ts`** — that file is
    `use client` and pulls in the browser Supabase client, which breaks a route handler at
    page-data collection. Next reports it as *"join is on the client"*, which is not a followable
    clue; the field vocabulary lives in `blueprint.ts` for exactly this reason.

## Custom objects + the workspace builder (0087)
- Rows in **`custom_records.data jsonb`**, never a generated table. A `SECURITY DEFINER` function
  running `CREATE TABLE` from user input is one escaping mistake from arbitrary DDL across every
  tenant. One GIN index serves every workspace.
- Values are **coerced against the declared type and fail closed** — a bad number, date or select
  option is rejected, not stored as text — because the CSV feed and the agents trust that type.
  Undeclared keys are dropped, so a payload cannot widen a row's shape.
- A custom object gets **one branch at the END of each of the five CRUD functions**, so a built-in can
  never be shadowed whatever an object is called (`reserved_object_slug` refuses the name anyway).
  Because everything downstream reads those five, a new object is immediately a page, an
  agent tool target, a CSV feed row and an Excel sync target.
  **The nav was the exception, and it was a bug, not a design.** `custom_objects.group_key` was
  written by the create form from day one and read by nothing, so a custom object was reachable
  only from the "Open" button on Settings → Objects. `lib/crm/nav.ts` (`navWithCustomObjects` +
  `useNav`) now folds them into `NAV` for both the rail and ⌘K; the section is a **picker over
  `CUSTOM_OBJECT_GROUPS`**, changeable after creation, and an unrecognised value (the trade
  templates ship `Fleet`, `Practice`, `Orders`…) becomes its own section before Settings rather
  than disappearing. Automate/Settings/Account are deliberately not offered. **If something works for `companies` and
  not for `job_sites`, that is a bug in one of the five, not a missing feature.**
- **0089: a relation resolves to a name in SQL** (`<key>_label` beside the raw uuid).
  `custom_relation_label` is a whitelist CASE, **never dynamic SQL**; an unknown target returns NULL so
  the reader falls back to the raw value. The HR tables are deliberately absent from it — they are
  tenanted by `company_id` through a different resolver.
- **`lib/workspace/blueprint.ts` has ZERO imports on purpose.** The AI builder's prompt is assembled in
  a route handler, and importing `lib/crm/custom.ts` (which is `use client`) breaks the build at
  page-data collection. Field types AND `OBJECT_ICON_NAMES` live there; `lib/crm/object-icons.ts` maps
  those names to components and **throws at import** if one has none.
- **The AI builder returns a PLAN and writes nothing.** `/api/workspace/build` → `normalizeBlueprint`
  → a human reads it → applying is a loop of the same `save_custom_object`/`save_custom_field` calls
  the manual builder uses. That separation is the security model: the description is untrusted, so is
  anything a model does with it, and the worst a prompt injection achieves is a silly plan somebody
  declines.
- **`lib/workspace/templates.ts` = 10 trades**, and they are also the few-shot examples the model is
  shown, so improving a template improves what the AI produces. None recreates a built-in.

## Deals / pipeline records (0092)
- **`pipeline_records` existed from 0001 with no way to insert one.** The stages were seeded, the
  board read them and `move_pipeline_record` reordered them — and nothing in SQL or in the app
  ever created a row. Sales → Deals, the flagship CRM screen, was structurally incapable of
  holding a deal; the New button had no `onClick` for the whole life of the screen. 0092 adds
  `create_pipeline_record` / `update_pipeline_record` / `delete_pipeline_record`.
- **`get_pipeline_board` is redefined IN FULL in 0092** to join `organizations`. 0002 shipped
  `'company', null` with the comment *"CRM organizations join added with the Sales module"*; 0004
  shipped that module and the join was never added, so a deal attached to a company rendered
  without it. Extend the 0092 definition, don't add a parallel one.
- **Dragging a card used to be a lie.** `onDragEnd` moved it in local state and left a comment
  where the write belonged, so every reorder survived exactly until the next reload. It now calls
  `move_pipeline_record` and **puts the card back** if that fails — the only honest optimistic
  update. `PipelineBoard` writes nothing unless `live` is true, because a sample board's ids do
  not exist in any database.
- **`chk_record_subject` was widened to accept a title.** Requiring a person or a company is right
  for a recruitment record (an applicant IS a person) and wrong for a deal, where "Q4 renewal" is
  a real row that has not been matched to an organization yet.
- `create_pipeline_record` **re-checks the company and the person against the workspace** because
  `pipeline_records.company_id` carries no foreign key (0001 left it loose so Sales could ship
  later). A stage from another pipeline falls back to this pipeline's first stage rather than
  putting the card in a column nobody can see. New cards go to the TOP of their column.
- Card headline is **person → title → company**: a recruitment card IS the candidate's name; a
  deal is its own title with the company as context. Never the same string twice.
- `DEMO_DEALS` seeds the board through `create_pipeline_record` (not `create_record` — a pipeline
  record is not a CRUD object), resolving stages **by name** because the ids are per workspace.

## Agent Plugins (`plugin/`, `lib/plugins/*`)
- **Agent Plugins 1.0.0** (agent-plugins.org) is the vendor-neutral package format — TSC: Amazon,
  Cursor, Microsoft, OpenAI, Vercel. A plugin is a directory: `plugin.json` (only `$schema` + `name`
  required), `skills/<name>/SKILL.md`, `mcp.json`. It is a PACKAGING format only — no registry, no
  distribution, no install mechanism.
- **RunButter already spoke both halves before this existed.** `/api/mcp` is a Streamable HTTP MCP
  server, and skills (0068) already ARE `SKILL.md` with `name`/`description` frontmatter — which is
  why `plugin/` is mostly prose rather than plumbing.
- **A PLUGIN CANNOT CARRY A CREDENTIAL AND THERE IS NOWHERE TO PUT ONE.** Spec §7.2: header values
  are "visible package data, not a portable secret mechanism"; plugins "MUST NOT embed credentials";
  clients "MUST NOT perform placeholder or environment-variable expansion" in urls or headers; and
  v1 "defines no OAuth configuration or portable credential-reference fields". So `mcp.json` names
  the endpoint and the human supplies the key client-side. Don't "improve" this into a one-click
  install — that is a workspace key in a file people commit.
- **The frontmatter `name` MUST equal the skill's directory name**, and a mismatch makes a
  conforming client SKIP the skill in silence. That is the single easiest thing to break here, so
  `npm run check:plugin` is a CI gate rather than a convention.
- **`scripts/check-plugin.mjs` separates SPEC ERRORS from QUALITY WARNINGS**, and the distinction is
  load-bearing: a user's exported skill with a two-line body is valid Agent Plugins and below our
  bar for `plugin/`. Errors always fail; `--strict` (what CI runs on `plugin/`) also fails warnings.
  It never fetches the schemas — the spec forbids clients doing that at load time, and a check that
  breaks when a website is down is a check people start skipping.
- **`lib/plugins/agent-plugin.ts` is the ONE builder**, shared by the repo's plugin and
  `/api/plugins/export`, so a published plugin and an exported one cannot disagree about the format.
  Skill slugs are deduped (`invoice-tone`, `invoice-tone-2`) because two rows can slug to one
  directory, and YAML scalars are quoted + escaped because a skill called `Invoices: overdue` is
  otherwise a parse error whose only symptom is a skipped skill.
- **`lib/plugins/zip.ts` is a hand-written store-only ZIP writer**, no dependency — same call as
  `lib/markdown.ts`. Fixed 1980 timestamps make exports byte-reproducible. It is deliberately not
  Zip64/DEFLATE/encryption capable; if that changes, take a dependency rather than growing it.

## Documentation + the public repo
- **`docs/*.md` is the single source for both surfaces** — GitHub renders it, and `/developers`
  renders the same files through `lib/markdown.ts` at build time. A docs-only copy is how an install
  page ends up right in one place and eighteen months stale in the other.
- It lives at **`/developers`, not `/docs`** — `/docs` is the app's own Docs screen.
- `lib/markdown.ts` is a small renderer rather than a dependency: repo-owned content, reviewed in PRs,
  rendered at build time. It escapes the source anyway. Two things it had to get right —
  a code-span placeholder cannot be a bare number ("12 vans" is not code span 12), and a wrapped list
  item must join the item above it rather than become a paragraph below the list.
- **Settings → Updates** (`/api/version`) shows the running version against GitHub's latest release
  and the commands to update. It **sends nothing about the instance** — no id, no version, no domain —
  and an offline server is told it could not check rather than that it is current. There is no
  telemetry in this project and this is the one place someone would look for some. It deliberately
  does not update anything: an in-app button would mean the app writing to its own source tree, which
  is different on every host and a code-execution primitive if the release check were ever spoofed.
- **Marketing pages** live beside the landing page and share `components/landing/MarketingChrome.tsx`
  (one header/footer, `home` prop only because the section links are hash anchors into `/`).
  `/ai-agents` generates its tool list and gallery FROM `lib/agents/catalog.ts` and
  `lib/agents/templates.ts`, so deleting a tool edits the marketing page. Never hand-type a count.
- **`docs/going-live.md` is the ops runbook** (cron, Stripe, Resend, secrets, publishing).
  `docs/install.md` is the install path. Keep both current — they are what a stranger follows.
- **CI** (`.github/workflows/ci.yml`) = types, build with NO Stripe key, migrations from empty twice,
  and a stale-`schema.sql` check. **Dependabot is deliberately quiet** (monthly, grouped, no
  Next/React/Tailwind majors).
- **`.gitignore` patterns must be anchored** (`/build/`, not `build/`). Unanchored, `build/` matched
  `app/api/workspace/build/` and the AI builder's route was silently never committed — it existed on
  one machine, and every deploy answered that route with an HTML 404, which surfaces as
  `Unexpected token '<', "<!DOCTYPE "...` in the browser.

## Information architecture (nav order is deliberate — `lib/crm/registry.ts`)
- **HR** owns the **Careers page** (`/dashboard/careers`): the address, the copy, and which roles are
  public. It sits next to Positions because it is a hiring surface, not configuration.
- **Public hiring funnel:** `/careers/<slug>` (all roles) → `/careers/<slug>/<positionId>` (job detail,
  0063) → `/apply/<positionId>` → assessment. The list used to link straight into the form, so nobody
  ever saw `description` — a field captured on every position. Each role having its own URL is also
  what makes `JobPosting` structured data (and therefore Google Jobs) possible.
  `get_careers_position` enforces the same visibility as the index: active AND published, else null,
  so a hidden role can't be reached by guessing its id.
- **Settings** = things that change the workspace for *everyone* (Branding, Members, Plans,
  Integrations, Reports). **Account** = things that are yours alone (AI keys, Assistant).
  **Team** stays people-only (My Team, Directory, Assets) — not settings.
- **Branding is the single place a brand is defined** (`workspaces`, 0024 + 0061) and now covers
  invoices/documents, the careers page + apply form, email, and favicon/social preview.
  HR's careers screen links to it rather than duplicating any of it.
- `save_workspace_branding` writes a key **only when present** in the payload (`p_data ? 'key'`) —
  a partial save must never blank the fields it doesn't mention.

## Design system (see the `design-system` + `shadcn-adoption` memories)
- **Semantic tokens only** — `bg-surface`, `text-secondary`, `border-subtle`, `bg-accent`, `bg-inverse`.
  **Never literal colors** (`bg-white`, `text-slate-800`, `shadow-slate-200/50`) — that's what breaks
  dark mode. Tokens live in `app/globals.css` (`:root` + `.dark`), mapped in `tailwind.config.js`.
- Geist Sans/Mono, `--radius: 1rem`. **Hierarchy comes from SIZE and COLOUR, not weight.**
  Page and card titles are **`font-medium` (500)**; 600 everywhere read as heavy and flat, because
  when every rank is bold none of them is. `font-semibold` is for small emphasis inside a row (a
  status chip, a button); **`font-bold` is not used in the product UI at all**.
- **Type comes from the scale in `tailwind.config.js`, never from `text-[13px]`.**
  `text-3xs` 11 · `text-2xs` 12 · `text-xs` 13 · **`text-sm` 14 = default UI text** · `text-base` 15 ·
  `text-md` 16 (page titles). `lg`+ are Tailwind defaults and belong to marketing.
  The app was ~1000 arbitrary `text-[Npx]` values, so the scale was unchangeable and stayed a full step
  too small (it read as 80% zoom on any desktop). Those are now tokens — **density is one config edit**.
  Don't reintroduce arbitrary px sizes.
- **Desktop rhythm:** page header `h-14` + `px-5` with a `text-base` `<h1>`; modal/drawer headers stay
  `h-12`. Nav rail `w-64`. Table rows `h-11`, table head `h-10`. Page gutters `p-6 2xl:p-8`.
- **App screens cap at `max-w-5xl`**; prose (terms/privacy/careers/landing), modals and document views
  keep a reading measure — widening a paragraph to 1024px makes it worse, not better.
- **Elevation rule:** cards and real form fields (h-9+) are raised — `ring-1 ring-subtle` +
  `shadow-card`/`shadow-sm`. **Compact inline controls stay flat** (filter chips, table-cell inputs,
  h-7 selectors). Deliberate — don't "fix" it.
- **shadcn was added ADDITIVELY on the existing tokens** — `npx shadcn init` was never run, because it
  injects a second, conflicting token vocabulary. `cn()` is in `lib/utils.ts`. Primitives in
  `components/ui/`: `command` (⌘K), `card`, `StatCard`, `dropdown-menu`, `tooltip`, `input`, `textarea`,
  `select`, `label`, `EmptyState`, plus the older `Button`/`Badge`/`Dialog`.
  - `select.tsx` is a **native `<select>`** by choice (no Radix): plain value pickers, keeps the
    `onChange` contract, OS picker on mobile.
  - **Never create `components/ui/dialog.tsx`** — it case-collides with `Dialog.tsx` on Windows.
- **Never use browser `confirm()`/`alert()`** — use `useDialog()` from `components/ui/Dialog.tsx`.
- **No fabricated data.** Trends/sparklines render only when the real series supports them
  (`monthlyMomentum` drops the partial current month). A fake cognitive score was removed for this reason.

## MCP / agent tools (`lib/agents/tools.ts`)
- ONE tool executor is shared by `/api/mcp` and the in-app agent runner, so an external
  MCP client and an agent take the identical, tenancy-safe path. **26 tools**, not just CRUD:
  finance summary/trends/ledger, sanctions screening, IBAN validation, invoice-text parsing,
  analytics, positions, candidate FTS, pipeline boards, file search, research notes, connections.
  The count lives in `lib/agents/catalog.ts` — read it rather than trusting any number written down,
  including this one.
- **Every tool was exercised against a real database** (2026-08): each RPC exists, accepts the
  arguments the executor passes, and returns without raising. Re-do that after touching a signature;
  the executor is thin, so "does the tool work" is almost entirely "does its RPC accept this".
- **Tenancy looks inconsistent and isn't.** `list_records`/`create_record` take `p_workspace`;
  `get_record`/`update_record` derive the caller's workspaces from `p_privy` in SQL
  (`workspace_id = any(my)`). Don't "fix" the latter by inventing an argument.
- `get_pipeline_board` takes a **pipeline id, not a user** — resolve via `get_pipeline_by_kind` first.
- `screen_sanctions` is classified READ despite appending an audit row: it mutates no business
  data, and gating it behind write-approval would stop agents running compliance checks. Its
  `no_data` result is returned with an explicit warning so a model can't report it as "clear".
- The HR RPCs (`search_candidates_for_recruiter`, `get_candidate_details`) are **not in the
  migrations folder** — they live in the DB from the legacy ATS. Verify arg names against real
  call sites in `app/dashboard/candidates/*`, not against the migrations.
- **`lib/agents/catalog.ts` is the ONE tool list** — name, label, group, write-flag. `tools.ts`
  (the executor) can't be imported by a client component because it pulls in the admin client, so
  the builder used to keep a hand-written copy; that copy sat at 4 read tools while the executor
  had nineteen, and the picker rendered the copy — finance, files, candidate and analytics tools were
  **ungrantable**. Both sides import the catalogue now, and `tools.ts` throws at import if a tool
  in `TOOLS` has no catalogue entry. Add a tool in BOTH places or the build fails loudly.
- **Agent gallery** = `lib/agents/templates.ts` (8 prebuilt agents). A template is just a prefilled
  editor payload — not a second save path — and is pinned to `suggest` autonomy on install
  regardless of what it declares.
- **`call_connection` is the ONLY tool that leaves the workspace.** The model picks a saved
  `connections` row **by id and never supplies a URL** — that, not a filter, is what bounds where an
  agent can reach. It is classified WRITE, so a `suggest` agent proposes the payload for approval;
  it reuses `isSafeOutboundUrl` (an owner-saved URL is still not a safe one — 169.254.169.254 would
  turn any agent into a probe of our own network), signs with the connection secret, and logs to
  `webhook_deliveries` next to automation sends. `list_connections` **strips `url` and `secret`** —
  the model sends by id, so putting either into a stored run transcript is a leak for no gain.
  Note this is exposed over `/api/mcp` too, like every other tool.
- **Team chat (0075).** `can_read_channel` is the SINGLE visibility predicate — every read and write
  calls it, because scattering that rule is how a private channel eventually leaks. `post_agent_message`
  is service_role only and forces `author_kind='agent'`, so a browser can never post as an agent and a
  reader can always tell a bot from a person. Chat POLLS (4s) rather than using Supabase Realtime:
  Realtime needs anon-key RLS policies on `messages`, which would undo the /api/rpc proxy. Don't
  "upgrade" it by opening RLS — write an SSE endpoint instead.
- **Agentic CRM (0084).** Two changes turn "we have agents" into an agentic CRM: an agent can keep
  notes on a record, and it can work without being asked.
  - **`record_notes.source` is NOT NULL and there is NO confidence column** — deliberately, and
    don't add one. A URL or a tool name is checkable; `0.87` is not, and a number beside a guess is
    how a hallucination gets trusted. `add_record_note` refuses a blank source rather than
    defaulting it. The tool description tells the model the same thing in the same words.
  - Notes are writable by PEOPLE too, through the same RPC. Research a human cannot correct is
    research nobody trusts, and a parallel human-notes table would split the record in half.
  - **Schedules are coarse on purpose** — `hourly|daily|weekly` + a UTC hour, not cron. The value is
    "it ran without me"; a cron field turns that into a syntax to debug. A schedule with an empty
    task is stored as `off`, and an unknown value falls back to `off` (never to a cadence nobody
    chose). **Autonomy is unchanged by scheduling**: a `suggest` agent still only proposes.
  - `claim_due_agents` stamps `last_run_at` at **claim** time, not completion — a run that crashes
    must not become a hot loop retrying every minute all day. `get_workspace_ai_owner` decides whose
    key and whose permissions an unattended run uses; there is no unattributed actor, because every
    tool derives tenancy from `p_privy` in SQL.
  - **`/.well-known/mcp.json`** is generated from `lib/agents/catalog.ts`, never hand-written — a
    hand-written copy is exactly how the tool picker fell sixteen tools behind once already.
  - **List state lives in the URL** (`lib/crm/list-url.ts`, `?q=…&f.status=…`) so a view is a link
    an agent can hand back. Flat and readable rather than a base64 blob, because people and models
    both read these.
- **Social publishing (0082/0083)** is a NATIVE build. **Postiz is AGPL-3.0** (verified against its
  LICENSE) — same wall as listmonk and Mautic, so it was read as a *feature spec* and nothing was
  copied. Running it alongside as a separate service is legal but means a second app and a second
  Postgres per self-hoster, which is the opposite of the one-core pitch.
  - **Sending is at-most-once, copied from newsletters.** A target is claimed to `sending` BEFORE
    the provider call; a stale claim is swept to **`failed`, never back to `pending`**;
    `unique (post_id, account_id)` is what makes a duplicate structurally impossible. A post sent
    twice to a real audience is a public incident with no undo. **Don't turn this into a retry.**
  - `publish_post_now` does NOT send — it only marks targets due. Both it and the cron go through
    `claim_post_targets`, so exactly one code path can reach a platform.
  - Tokens are **sealed at rest** and no browser-reachable RPC returns one. `get_social_token`,
    `save_social_account`, `record_social_account_error`, `claim_post_targets`, `mark_post_target`
    and `sweep_stale_post_targets` are service_role and deliberately absent from `/api/rpc`'s
    ALLOWED — same rule as `claim_excel_links`.
  - The OAuth `state` is **HMAC-signed** (`lib/social/oauth.ts`) and carries the workspace. The
    callback is unauthenticated by necessity (a top-level navigation from linkedin.com), so that
    signature is the entire boundary. For X it doubles as the PKCE verifier — sound precisely
    because it is unforgeable without the server secret, and it means nothing has to be stored
    between the two legs. The redirect URI comes from `NEXT_PUBLIC_SITE_URL`, never the request
    Host, or an attacker's header would decide where the code lands.
  - **LinkedIn issues no refresh token** to standard apps, so `refresh()` throws `NO_REFRESH` on
    purpose and the UI says "reconnect". X rotates refresh tokens on every use, which is why
    `save_social_account` upserts and `coalesce`s the refresh columns — a provider that omits one
    must not blank the one already held.
- **Doc kinds (0081 + 0085)** are `doc | note | todo | sheet`, and **every one stores markdown in
  the same `body` column** — a todo is `- [ ]` lines, a sheet is a markdown table. That is what
  keeps every kind openable in every editor, exportable by one path, and found by one query, and it
  is why adding a kind is a CHECK change rather than a schema change. Switching kind is a VIEW
  change, not a conversion. A kind the editor cannot render is a bug waiting, so `DOC_KINDS` and
  `docs_kind_check` move together. **`sheet` is a table, NOT a spreadsheet** — no formulas; live
  data in a real spreadsheet is 0078/0079, and a half-built formula engine here would be worse.
  Export (`lib/crm/doc-export.ts`) is PDF/Word/Markdown **entirely in the browser**, same rule as
  `/pdf`: a contract never goes to a conversion service. The PDF renderer maps non-WinAnsi
  characters rather than stripping them (pdf-lib THROWS on them, so one curly quote would fail the
  whole export), and deliberately drops images — they are `rb-file:` ids into a private bucket.
- **Attachments & doc kinds (0081)** — an attachment is a **`files.id`, never a URL**. Everything
  else already existed in 0065 (private bucket, upload route, membership-checked signed URL, FTS),
  so nothing here uploads or serves bytes; an image dropped in chat is already indexed, and
  deleting the file removes it everywhere at once. A signed URL stored in a doc body would break
  within the hour AND persist a read capability into exports and agent transcripts — so the body
  holds **`rb-file:<uuid>`** (`lib/files/embeds.ts`), which survives markdown round-tripping the way
  a `data-*` attribute would not, and the URL is minted per reader per render.
  `sanitize_attachments` is what stops a foreign `file_id` leaking another tenant's file NAME into a
  channel; the client's `name`/`size` are ignored and snapshotted server-side like `author_name`.
  `edit_message` deliberately cannot change attachments — the picture everyone replied to must not
  change after the fact. Doc kinds are **`doc` | `note` only**: a kind the editor can't render is a
  bug waiting, and sheets/canvases already exist as Excel sync and Maps.
- **Lead scoring (0074)** stores a DECAYED engagement score on `newsletter_subscribers.score`,
  refreshed in batches by `/api/sequences/run`. Stored rather than computed because segments filter
  on it and a per-row decayed sum would be quadratic against 0072's EXISTS predicates. 0074
  **redefines `segment_match` in full** (adds the `score` field) and `get_newsletter_subscribers`
  (selects it) — extend those definitions, don't add parallel ones. Scope is newsletter engagement
  only; form/page signals are excluded because matching an anonymous visitor to a subscriber is a
  guess.
- **Sequences (0073)** are drips with a per-subscriber cursor. A step's email points at a **draft**
  newsletter and sending writes a normal `newsletter_deliveries` row — that is what gives dedupe,
  tracking and unsubscribe for free, and it means a newsletter already SENT as a campaign must not
  be reused in a drip (everyone who got it would be silently skipped). `create_sequence_delivery`
  returning NULL means "already sent, skip" — never treat it as an error. 0073 also **redefines
  `newsletter_unsubscribe` and `record_newsletter_feedback` in full** so opting out or bouncing
  cancels live enrolments; 0071's versions predate sequences and would leave a drip running.
- **Segments (0072)** filter subscribers live. `segment_match` is a whitelist CASE, **never dynamic
  SQL** — a SECURITY DEFINER function building `EXECUTE` from user values is one escaping mistake
  from arbitrary SQL across every tenant. An unknown field/op returns FALSE (fails closed); making
  it return true would silently widen a send's audience. The numeric operand is parsed with a strict
  `^\d{1,6}$` match, not by stripping non-digits — a UUID value (used by `on_list`) becomes a
  32-digit number that overflows `int` and crashes the whole evaluation.
- **Newsletters (0070/0071)** are a NATIVE build, not a port. listmonk is **AGPL-3.0** and Mautic
  is **GPL-3.0** — copying either would force this whole product off MIT, so don't "just borrow a
  file" from them. Concepts only.
  - Sending is **at-most-once on purpose**: a delivery moves to `sending` BEFORE the provider call,
    and a stale claim is swept to `failed`, never back to `pending`. A duplicate to a whole list is
    a public incident; a miss is a support question. Don't "fix" this into a retry.
  - `uq_nl_deliveries (newsletter_id, subscriber_id)` is what makes double-sending structurally
    impossible. The batch claim uses `FOR UPDATE SKIP LOCKED` inside a data-modifying CTE —
    `RETURNING ... INTO` there raises on any batch larger than one row.
  - Re-importing a CSV **never** re-enables an unsubscribed address, and never overwrites the
    original consent record.
  - Click links are **HMAC-signed** (`lib/marketing/newsletter-links.ts`). An unsigned tracking
    redirect is an open redirect that lends our domain to phishing.
- **Skills (0068)** are reusable instruction packs on `agents.skill_ids uuid[]`. `suggested_tools`
  is a **hint for the UI, never a grant**: the runner's tool list comes from the agent alone, and
  `skillBlock()` must never touch `allowed`. `/api/skills/import` reads public GitHub SKILL.md
  files and **returns a preview without storing anything** — imported text lands in a system
  prompt, so a human picks what to save.

## Free-data features (no key, no per-call cost)
Same rule as the cost rule above: prefer public/government data + local computation over metered APIs.
- **Company lookup** — PL Biała lista + EU VIES (`/api/company-lookup`). Both keyless.
- **Sanctions screening (0058)** — OFAC SDN + Consolidated CSVs ingested into `sanctions_entities`
  by `/api/sanctions/refresh`, matched with **pg_trgm** in `screen_sanctions`. Deliberately NOT a
  hosted screening API (all of them meter per query *and* need a commercial data licence).
  - `sanctions_normalize()` is IMMUTABLE and transliterates **before** stripping punctuation —
    otherwise "Åcme" screens as "CME". `search_text`/`norm_name`/`norm_aliases` are trigger-derived,
    never written by the ingest route, so normalisation can't drift.
  - The prefilter is `<%` (word_similarity), **not** `%`. Whole-string similarity against a
    name+12-aliases blob is ~0.2, so `%` returned "clear" for an entity's own name.
  - `status:'no_data'` (nothing imported) is never collapsed into `'clear'`.
  - OFAC's host **403s without a User-Agent header** — the single most common silent-ingest failure.
- **Email hygiene** (`lib/marketing/email-hygiene.ts`) — syntax + vendored disposable list + role
  detection + MX/A lookup over `node:dns`, gating `/api/forms/submit`. **Fails OPEN** on DNS
  timeouts, accepts no-MX-but-has-A (RFC 5321 §5.1), and treats a typo suggestion as a question
  ("Use gmail.com" / "Keep what I typed") — a false positive must never lock someone out of a form.
- **Web analytics geo (0062)** — countries/cities/browsers/OS/UTM on the **built-in** pipeline.
  Geo comes from **edge headers only** (`cf-ipcountry`, `x-vercel-ip-*` — see
  `lib/marketing/request-context.ts`); there is no IP-geolocation API call, because every one of
  them meters per lookup. `runbutter.app` is Cloudflare-proxied, so country arrives free; if it
  stays empty, enable Cloudflare's *Add visitor location headers* managed transform.
  `geo_coverage` reports the % of rows that actually have a country — "Unknown" is kept as its own
  bucket rather than dropped, so the country list can't look authoritative when it isn't.
  UA parsing order matters: Edge/Opera/Samsung all claim "Chrome", and iPadOS claims "Macintosh".
- **Web analytics — Umami (0059, optional)** — `docs/umami-deploy.md` + `docs/umami-analytics.md`.
  **Only worth deploying for SESSION metrics** (bounce rate, visit duration, funnels); 0062 already
  covers countries/cities/browsers/OS locally. Umami's DB is the `runbutter-umami-db` Supabase
  project — leave it EMPTY, Umami runs its own Prisma migrations, and use the **session pooler
  (5432)**, never the transaction pooler (6543), or those migrations fail. Chosen over Plausible
  because Umami is **MIT** (Plausible CE is AGPL-3.0) and runs on Postgres + one Node process
  rather than Elixir + ClickHouse. The built-in `site_events` pipeline is **NOT removed**: it
  serves any site without `sites.umami_website_id`, keeps its history, and the swap is per-site
  and reversible. The Umami credential is instance-wide, so it stays server-side and
  `/api/analytics/*` re-checks workspace membership in Postgres before every call.
- **IBAN validation** (`lib/finance/iban.ts`) — ISO 13616 mod-97 + length table, entirely local.
- **Company logos** (`lib/crm/logo.ts`) — favicon endpoints keyed off the `domain` we already store,
  initials fallback via `CompanyLogo`.
- **PDF tools** (`/pdf`, `lib/pdf/toolkit.ts`) — merge/split/extract/delete/rotate/watermark/images→PDF
  on the already-installed `pdf-lib`, **in the browser**, so files never upload. pdf-lib restructures
  documents but does not re-encode streams, so **compression is not offered** — don't add it here.
- **Spreadsheet feed (0078)** — `GET /api/v1/records?object=…&format=csv&key=hb_…` + the
  **Connect to Excel** panel in Settings → Integrations. Excel's "Get Data → From Web" can't send an
  Authorization header from its dialog, so the key rides in the query string, bounded by two rules:
  a **query-string key must be scope `read`** (else 401), and a **query-string key can never write**
  (403 on POST) *whatever* its scope — the transport is untrusted, not just the credential. The same
  scope is enforced on `/api/mcp`, or a read key could simply write there instead. CSV, not JSON,
  because Power Query turns JSON into a table only after several steps most people never find; it
  carries a **UTF-8 BOM** (else Excel/Windows mangles non-ASCII names) and CRLF, and columns are the
  **union of keys in first-seen order** — `Object.keys(rows[0])` silently truncates the sheet when a
  later JSONB row carries a field the first one omitted.
- **Two-way Excel sync (0079)** — `lib/excel/{graph,sync}.ts`, the **Two-way Excel sync** panel, and
  `MS_CLIENT_ID`/`MS_CLIENT_SECRET`. Complements 0078 rather than replacing it: the feed is for
  people who want data in a sheet, this is for teams whose sheet IS the working surface. `GET
  /api/excel/sync` with `CRON_SECRET` sweeps; "Sync now" runs one link as the signed-in member.
  - **The conflict rule is the feature, and it lives only in `syncLink()`.** Graph exposes no
    per-cell timestamps, so a three-way merge is unavailable at any price. Inbound runs FIRST (a
    person editing a cell is the latest intent), then outbound rewrites the sheet from the DB.
  - **A row deleted in Excel NEVER deletes the record.** A filter, a sort that pushed rows out of
    the table range, and a cleared row are indistinguishable from a deletion over the API. Don't
    "finish" this into a two-way delete. A stale id in the sheet is likewise never resurrected.
  - Reads/writes go through a real Excel **table**, not a range, so a user's own sorting, filtering
    and extra columns survive; those extra columns are ignored on the way in, never sent.
  - `sameValue()` exists because Excel round-trips are lossy — a `'12345'` zip returns as the number
    `12345`. Comparing raw would mark every row edited and rewrite the whole DB on every sync.
  - Tokens are **sealed at rest** (`lib/crypto/secrets.ts`), unlike the older `integration_tokens`
    rows: a `Files.ReadWrite` grant opens every workbook that person can open.
  - `claim_excel_links`, `record_excel_sync` and `set_excel_table_name` are **service_role only** and
    deliberately absent from `/api/rpc`'s ALLOWED — a client that could write `last_status` could
    hide a failing sync.
- **Files that become data (0065)** — `docs/file-extraction.md`. `/files` uploads to a **private**
  bucket, extracts text, and indexes it with Postgres FTS *in the same database as the ledger*, which
  is the entire pitch: "which contracts auto-renew, for clients who owe us money" is one join.
  - **Never use `pdf-parse`.** It bundles pdf.js 1.10, which throws `Invalid PDF structure` on any PDF
    with **object streams** — the default for pdf-lib and for current Word/Pages/Acrobat. Use
    **`lib/pdf/server-text.ts`** (`pdfjs-dist`, already a dep). `lib/extract-text.ts` was switched over
    for the same reason: modern PDF CVs were being stored with empty `resume_raw_text`. The package
    was finally **uninstalled** in the 2026-08 audit — it was still in `dependencies`, imported by
    nothing, and the Files screen was crediting it in the UI.
  - **`lib/pdf/inspect.ts` (`@firecrawl/pdf-inspector`, MIT) sits BESIDE pdfjs, never replacing it.**
    It answers the two questions pdfjs cannot: WHICH pages are scans, and what the tables were.
    - The old scan test was characters-per-page across the whole document, and an average cannot see
      inside itself — a text page plus a scanned signature page measured 216 chars/page and passed as
      fully indexed, so the scanned page was missing from search with nothing saying so. `Mixed` now
      indexes the text pages AND names the ones that need OCR.
    - Markdown (tables intact) is kept only when it carries **≥98% of the letters and digits** pdfjs
      found. Two parsers on one file: markdown that quietly dropped half a page would be a worse index
      than the flat text it replaced, invisibly.
    - Every function returns **null rather than throwing**, so a missing binary or a corrupt file falls
      back to exactly the previous behaviour. It is a native addon: it must stay in
      `serverComponentsExternalPackages` AND in `outputFileTracingIncludes`, or the Docker image ships
      without it and degrades only in production.
  - **`extract_error` is shown in the UI** (under the file name). It was recorded from the start and
    displayed nowhere, so "No text" appeared with the reason sitting in the database.
  - OCR for scans is **opt-in, self-hosted MinerU** (`MINERU_URL`), never a metered OCR API. MinerU's
    licence **requires** the credit rendered on the Files screen — keep it.
  - `extract_status='skipped'` is an honest answer with a reason, never collapsed into success; the
    `search_files` agent tool warns when nothing is indexed so an agent can't report a clause absent
    from a file it never read.
  - `search_files` uses the **`simple`** tsvector config (PL/DE/EN in one workspace) and returns
    `ts_headline` snippets delimited with `«»` — rendered as React nodes, never as HTML.

## Verifying changes
- `npx tsc --noEmit` for types; **`npm run build` is the definitive check** (it's what Render runs).
  In a fresh cloud clone run `npm ci` first, and note the build needs a **well-formed**
  `NEXT_PUBLIC_PRIVY_APP_ID` or every page fails to prerender.
- SQL migrations can be checked for real: `initdb`/`pg_ctl` as the `postgres` user (PG 16 is installed),
  then `DATABASE_URL=… npm run migrate` and exercise the RPCs. **Don't build while the dev server is
  running** — it clobbers `.next`.
- **The audit that finds silent breakage:** build that database, then compare every `rpc('name', {args})`
  call site in the repo against `pg_proc` by name AND argument name. Four defects came out of one run —
  two report sections passing an argument their function does not take, a browser call missing from the
  `/api/rpc` allowlist, and a whole route that did not exist. All four failed *closed*, so nothing ever
  reported them. Worth re-running after any migration that changes a signature.
- **CI runs the migrations from empty on every push**, twice (idempotency), and fails on a stale
  `supabase/schema.sql`. A green CI means the schema applies to a stranger's database, which is the
  thing nobody tests by hand twice.
- Most UI sits behind Privy login, which the preview can't do. What works: drop a temporary page under
  `app/`, render the **real component** with mock props, check computed styles, then delete it.
- **To test a theme, set `localStorage['hb-theme']` and reload** — toggling the `.dark` class live races
  `useThemeSync()` and returns mixed readings.

## Commits
**This file IS committed** so cloud/web sessions (which clone from GitHub and never see local files)
start with context. Keep it accurate; it is the first thing every session reads.
**Before publishing history, scan it** — `git log --all --diff-filter=A --name-only` for `.env`-shaped
files and a `git grep` for key-shaped strings across `git rev-list --all`. Done 2026-08 over all 147
commits: clean, no `.env` ever committed. Publishing a repo publishes every commit, and a key deleted
in commit 40 is still readable in commit 12.
Exclude `tsconfig.tsbuildinfo`, `.claude/`, `HANDOFF.md`. Exclude `package-lock.json`
**except when dependencies changed** — then it MUST be committed, or Render's `npm ci` fails and the old
build keeps serving (this silently blocked two deploys). End commit bodies with the `Co-Authored-By`
trailer. Standing rule: **commit + push after every finished task, don't ask.**

### Two repos, one set of commits
- **`CasperCrypto/hirebtr` is the working repo.** Render deploys from it, cloud sessions clone it,
  every commit lands here first. **`RunButter/runbutter` is the same code, published.**
- There is **no second set of commits**. The public repo is a copy of `main` — you never "commit to
  the org", you push the commits you already made to a second remote. `npm run publish:oss` does it
  (adds the `public` remote on first use, pushes `origin` first so the public copy can never be
  ahead of what Render is serving, and **refuses a non-fast-forward** — force-pushing a public repo
  rewrites history under everyone who cloned or forked it).
- **`"Already up to date"` is not evidence that you are up to date.** An old local clone had
  `origin` = `CasperCrypto/talent-insight` (the stale mirror), so `git pull` reported success while
  sitting ~100 commits behind, and publishing from it would have pushed months-old code to the
  public repo. `publish:oss` therefore **refuses to run unless `origin` is `CasperCrypto/hirebtr`**,
  and prints the URL it actually found. The scripts are **Node, never bash** — this is run from
  PowerShell, where a `.sh` is not executable and `bash` is on PATH only if Git for Windows was
  installed with that option.
- A cloud session can only reach the repo it was started from: `add_repo` refuses cross-owner adds,
  so a session on `CasperCrypto/hirebtr` **cannot push to `RunButter/runbutter`**. Publishing is a
  one-command local step, by design of the sandbox rather than by choice.
- **`.github/workflows/mirror.yml` automates it** once `PUBLIC_REPO_TOKEN` is set (see
  `docs/going-live.md`), so nobody has to open a terminal. It **refuses to push when the public repo
  is ahead** — which happens the first time a contributor's PR merges there, and force-pushing would
  delete their merged work while reporting success.
- **THE MIRROR IS A BRIDGE AND IT EXPIRES.** It is one-way, so it is safe only while contributions
  arrive through this repo. The moment PRs land on `RunButter/runbutter`, two repos stop being
  tenable: move cloud sessions to the org repo, archive this one, and delete `mirror.yml`,
  `publish:oss` and this whole section.
- **The sandbox working tree sometimes rolls back to an old commit mid-session** (seen repeatedly,
  always to the same commit). Pushed work is safe; recover with
  `git fetch origin <branch> && git reset --hard origin/<branch>`, then `npm install` and recreate
  `.env.local`. Symptom: `scripts/` suddenly holds one file and `npm run migrate` "does not exist".

## Known open issues
1. **Billing needs `STRIPE_WEBHOOK_SECRET` to be a real signing secret.** With a placeholder,
   checkout completes at Stripe and the plan never upgrades, silently — the webhook is the only
   thing that writes the new plan. Test and live mode have DIFFERENT signing secrets.
   Three more things learned the hard way, all in `docs/going-live.md`:
   - **Never construct an SDK client at module scope.** `new Stripe(undefined)` throws, Next
     evaluates route modules while collecting page data, and an instance with no Stripe key could
     not BUILD. `lib/billing/stripe.ts` resolves per request and returns null; callers answer 503.
     The Dockerfile used to pass a fake key to get past it, which hid the bug from us and left it
     in place for everyone else.
   - **Price ids are `NEXT_PUBLIC_STRIPE_TEAM_PRICE_ID` / `..._BUSINESS_...`** (old
     `STARTER`/`PRO` names still read as a fallback). `NEXT_PUBLIC_*` is inlined at build time, so
     changing one is a redeploy. A `prod_…` id where a `price_…` belongs is caught with a message
     that says which is which.
   - **The webhook trusts `session.metadata.plan`** — our own checkout sets it — and falls back to
     price ids, then to the CHEAPEST paid tier. It used to default to the most expensive one
     whenever it could not recognise a price.
2. ~~Onboarding provisioning is fragile~~ — **fixed by 0076.** `ensure_workspace()` creates company +
   membership + template + `accounts` row in ONE transaction behind a verified Privy token
   (`/api/onboarding/provision`), so it cannot half-succeed and leave someone with no workspace. It is
   also idempotent, so a double-submitted form no longer makes two companies.
3. **Automations dispatcher needs a cron** for scheduled triggers (event/webhook triggers fire instantly).
4. **No cognitive test exists** — `cognitive_score`/`cognitive_data` are stored null and hidden in the UI.
   Market "skills + Big-5", never "cognitive/IQ".
5. ~~RLS open on the legacy ATS tables~~ — **fixed by 0076 + 0077.** `company_users` was
   anon-WRITABLE and `hr_company_id()` resolved from it alone, so a forged row read another
   tenant's candidates, CVs and assessment results. 0076 hardens the resolver to cross-check
   `accounts` (so the bypass dies even with the policies open) and moves provisioning server-side;
   0077 drops the policies. **0077 must run only AFTER the app carrying 0076's client changes is
   deployed** — it is the point of no return, and running it early breaks login and registration.
   0076 also fixes a latent bug it exposed: `redeem_invite` never created an `accounts` row, so
   every invited member would have been locked out by the hardening.

## Plan matrix (`lib/plans.ts` is the source of truth)
This section was stale for a long time — it still described the ATS-era
Starter $99 / Professional $299 tiers, which no longer exist in code. The real
tiers are **per seat**, priced for a whole-company tool rather than a recruiter
seat, and the landing page renders them straight from `lib/plans.ts`:

| Plan | Price | Seats | Records | Positions | Candidates | Automations | E-sign/mo |
|---|---|---|---|---|---|---|---|
| Free | $0 | 2 | 500 | 1 | 25 | 0 | 0 |
| Team | $8/seat | ∞ | 25,000 | 10 | 1,000 | 20 | 10 |
| Business | $33/seat | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |
| Enterprise | Custom | ∞ | ∞ | ∞ | ∞ | ∞ | ∞ |

Team adds automations, e-signatures, forms and short links; Business adds AI
agents, the REST API + MCP, attribution and scheduled reports; Enterprise adds
SSO/SAML and the audit log. Test with `UPDATE companies SET plan='business' WHERE …`.
**Don't restate these numbers anywhere else** — that is how this drifted. The
landing page reads `PLANS`; anything new should too.

## Env vars
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
**`NEXT_PUBLIC_PRIVY_APP_ID`** (login breaks without it — no hardcoded fallback), `RESEND_API_KEY`,
Stripe + Google keys. `SECRETS_MASTER_KEY` is optional (falls back to a key derived from the service-role key).
**`.env.example` is the full list and says what breaks without each one** — it was 17 vars short and
is now complete (verified by diffing `process.env` usage against it). The ones most often missed:
`NEXT_PUBLIC_SITE_URL` (every unsubscribe and tracking link points at the wrong host without it),
`CRON_SECRET` (the reminder and Excel sweeps refuse to run — an unauthenticated endpoint that mails
customers or writes into workbooks is not a safe default), `RESEND_WEBHOOK_SECRET`, and
`MS_CLIENT_ID`/`MS_CLIENT_SECRET` for the Excel sync.
**The two cron secrets are NOT interchangeable:** automations/newsletters/sequences authenticate with
`x-cron-secret: <service-role key>`; finance reminders and `/api/excel/sync` use `CRON_SECRET`.
