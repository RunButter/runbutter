# RunButter — Project Context (Claude Code)

**RunButter** (formerly HireBTR) — an open-source **company OS**, MIT. One relational Postgres core
across **Sales · Finance · Marketing · Projects · HR** (+ Docs, Automate, Team). Live at **runbutter.app**.

> **Hard rule:** the original ATS is the **HR module** — keep it. Nothing is deleted in the pivot.
> Its motto still stands for that module: *hire better by skills and personality.*

## Stack
- Next.js 14 (App Router), React, **Tailwind v3**, **Geist** font. Local repo name: `talent-insight`.
- **Supabase** (Postgres). Auth via **Privy** (NOT Supabase Auth).
- Stripe (billing), Resend (email), Google Calendar (interviews), @dnd-kit (kanban), Chart.js (radar),
  cmdk + Radix (shadcn primitives), pdf-lib + signature_pad (e-sign).

## Deploy
- **`git push upstream main`** → Render auto-deploys. `upstream` = `CasperCrypto/hirebtr` (**LIVE**);
  `origin` = `CasperCrypto/talent-insight` is a stale mirror.
- Supabase ref **`obrvuwajxbxiihfhthwx`**. Migrations live in `supabase/migrations/00NN_*.sql` and are run
  **by hand** in the Supabase SQL Editor (no service-role key locally). Check with `supabase/verify-migrations.sql`.
- **Migrations through 0057 are applied** (confirmed 2026-07-24). Don't report them as pending.
  **0058_sanctions.sql is PENDING** — run it in the SQL editor, then hit "Update list" once in a
  company's detail panel (or POST `/api/sanctions/refresh`) to ingest the OFAC data.
  **0059_umami.sql is PENDING** — only needed if you deploy Umami (`docs/umami-analytics.md`).
  **0060_careers_page.sql is PENDING** — public careers page + the slug that later becomes a subdomain.
  **0061_branding_expanded.sql is PENDING** — branding beyond invoices; also REVOKES the anon grant
  0024 left on `get/save_workspace_branding`, so run it or branding stays anon-callable.

## Critical conventions
- **`supabase.rpc()` returns `{ data, error }` — it never throws.** Always check `error` (recurring bug
  source). It's a `PromiseLike`, so **no `.catch()`** — use `.then(ok, err)`.
- **Auth pattern:** `set_config('app.current_privy_user_id', user.id, false)` then **`SECURITY DEFINER`
  RPCs** taking `p_privy text`. Anon EXECUTE is revoked (0046), so they only work through the
  **`/api/rpc` proxy**, which verifies the Privy JWT and calls as `service_role`.
- **Workspace resolution:** new-platform pages resolve via the **`accounts`** table (`get_my_workspace`
  → `effective_workspace`, latest def in **0051**). The HR half uses `hr_company_id()` off
  `company_users`. `workspace_id == company_id` (same uuid, 0005 sync trigger).
- **Never `.maybeSingle()` on `company_users` by `privy_user_id`** — a user can belong to several
  companies, and it throws "multiple rows returned". Use `.limit(1)`. This broke sign-in once.
- **CRUD monolith** (`list/get/create/update/delete_record`) is redefined IN FULL per migration —
  extend the latest def rather than adding a parallel one. New subsystems get **dedicated RPCs**.
- **Migrations** are idempotent (`create or replace`, `add column if not exists`) and end with
  `notify pgrst, 'reload schema';`.
- **Cost rule:** never add LLM/API calls to resume parsing or scoring. Resume search = Postgres FTS
  (`tsvector` + GIN). AI features are **BYO key** only.
- **Sample fallback:** `lib/crm/*.ts` loaders return sample data + `live:false` when unauthenticated or
  an RPC is missing → amber "Sample" badge.
- Psychometrics: discrete int columns on the latest `assessment_results`
  (overall/personality/work_style/screening_score) + Big-5 in `personality_data` JSONB.

## Information architecture (nav order is deliberate — `lib/crm/registry.ts`)
- **HR** owns the **Careers page** (`/dashboard/careers`): the address, the copy, and which roles are
  public. It sits next to Positions because it is a hiring surface, not configuration.
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
- Geist Sans/Mono, 13px base, **weights capped at 600**, `--radius: 0.75rem`.
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
- **Web analytics — Umami (0059, optional)** — `docs/umami-analytics.md`. Chosen over Plausible
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

## Verifying changes
- `npx tsc --noEmit` for types; **`npm run build` is the definitive check** (it's what Render runs).
  In a fresh cloud clone run `npm ci` first, and note the build needs a **well-formed**
  `NEXT_PUBLIC_PRIVY_APP_ID` or every page fails to prerender.
- SQL migrations can be checked for real: `initdb`/`pg_ctl` as the `postgres` user (PG 16 is installed),
  stub `workspaces` + `is_workspace_member`, then run the migration and exercise the RPCs.
  **Don't build while the dev server is running** — it clobbers `.next`.
- Most UI sits behind Privy login, which the preview can't do. What works: drop a temporary page under
  `app/`, render the **real component** with mock props, check computed styles, then delete it.
- **To test a theme, set `localStorage['hb-theme']` and reload** — toggling the `.dark` class live races
  `useThemeSync()` and returns mixed readings.

## Commits
**This file IS committed** so cloud/web sessions (which clone from GitHub and never see local files)
start with context. Keep it accurate; it is the first thing every session reads.
Exclude `tsconfig.tsbuildinfo`, `.claude/`, `HANDOFF.md`. Exclude `package-lock.json`
**except when dependencies changed** — then it MUST be committed, or Render's `npm ci` fails and the old
build keeps serving (this silently blocked two deploys). End commit bodies with the `Co-Authored-By`
trailer. Standing rule: **commit + push after every finished task, don't ask.**

## Known open issues
1. **`STRIPE_WEBHOOK_SECRET` is a placeholder** on Render → paid checkouts don't auto-upgrade plans.
2. **Onboarding provisioning is fragile** — company creation still uses client-side anon inserts into
   `companies`/`company_users`, and the 0005 triggers that create the workspace + `accounts` row are
   exception-safe, so a failure leaves a user with **no workspace, silently**. Real fix: a server-side,
   Privy-verified `ensure_workspace` RPC. (Login routing is fixed; the fragility underneath is not.)
3. **Automations dispatcher needs a cron** for scheduled triggers (event/webhook triggers fire instantly).
4. **No cognitive test exists** — `cognitive_score`/`cognitive_data` are stored null and hidden in the UI.
   Market "skills + Big-5", never "cognitive/IQ".
5. **RLS is still open on the legacy ATS tables** (`companies`/`company_users` are anon-readable/writable).

## Plan matrix (`lib/plans.ts` is the source of truth)
Free: 1 pos / 25 cand / pipeline + assessments + status emails.
Starter $99: 5 / 250 / + Treasury, resume search, source tracking, email templates, branding.
Professional $299: 25 / 2500 / + interviews, My Team, Team Fit, advanced analytics, GDPR controls.
Enterprise: unlimited / + HRIS export, SSO. (Test with `UPDATE companies SET plan='enterprise' WHERE …`.)

## Env vars
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
**`NEXT_PUBLIC_PRIVY_APP_ID`** (login breaks without it — no hardcoded fallback), `RESEND_API_KEY`,
Stripe + Google keys. `SECRETS_MASTER_KEY` is optional (falls back to a key derived from the service-role key).
