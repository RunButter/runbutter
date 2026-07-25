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

## Verifying changes
- `npx tsc --noEmit` for types; **`npm run build` is the definitive check** (it's what Render runs).
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
