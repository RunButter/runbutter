# RunButter — go-public launch checklist

Everything needed to take the codebase public as **RunButter** on **runbutter.app**,
from a new (non-personal) GitHub org. Code steps marked **[done]** are already in
this branch (`rebrand/runbutter`). The rest are yours — they live in your accounts
and dashboards, not the repo.

---

## 0. Code rename  **[done in `rebrand/runbutter`]**
- Brand text `HireBTR`/`hirebtr` → `RunButter`/`runbutter` (200 spots, 107 files)
- Domain `hirebtr.com` → `runbutter.app` everywhere (emails, legal pages, MCP snippet)
- MCP server key `"hirebtr"` → `"runbutter"`, package name, page `<title>`, Logo wordmark → `runbutter.app`
- Git URL `github.com/CasperCrypto/hirebtr` → `github.com/runbutter/runbutter` **(placeholder — adjust in step 2 if your org name differs)**
- **Preserved on purpose:** the `hb_` API-key prefix (SQL-generated; old keys keep
  resolving) and `hb-*` localStorage keys (renaming just resets saved theme/nav).
  Optional later: add a migration to make new keys `rb_`.

Typecheck + production build pass. Review the branch, then merge to `main`.

---

## 1. GitHub — new org + repo
1. Create a GitHub **organization** (e.g. `runbutter`) — not your personal account.
   Free plan is fine for a public repo.
2. Create an **empty public repo** `runbutter/runbutter` (no README/license — the repo already has them).
3. Point this repo at it and push:
   ```bash
   git remote remove upstream                # drop CasperCrypto/hirebtr
   git remote add origin https://github.com/runbutter/runbutter.git
   git checkout main && git merge rebrand/runbutter
   git push -u origin main
   ```
   (If the org/repo name isn't `runbutter/runbutter`, do a find-replace of that
   string in the repo first — it appears in the README, landing, and docs.)
4. Repo **Settings**: add topics, a description, set the website to `https://runbutter.app`.
5. Confirm the **gitleaks** Action runs green on the first push (it scans full history — history is already verified clean of secrets).
6. Add branch protection on `main` (require PR + the secret-scan check) before inviting contributors.

> ⚠️ **Do NOT commit any real secret.** `.env*` is gitignored; only `.env.example`
> (placeholders) is tracked. Double-check `git log -p | grep -i key` shows nothing real.

---

## 2. Domain — runbutter.app
1. Register **runbutter.app** (it's a real gTLD; `.app` is HSTS-preloaded, so it is
   **HTTPS-only** — fine, Render serves HTTPS).
2. In Render → your service → **Settings → Custom Domains**: add `runbutter.app`
   and `www.runbutter.app`.
3. At your DNS provider, add the records Render shows (an `ALIAS`/`A` for the apex
   and a `CNAME` for `www`). Wait for Render to issue the TLS cert.
4. Set the primary domain; redirect `www` → apex (or vice-versa).

---

## 3. Render (hosting) — env + domain
Update the running service (or create a fresh one from the new repo):
- `NEXT_PUBLIC_APP_URL = https://runbutter.app`
- Keep: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SECRETS_MASTER_KEY`, `NEXT_PUBLIC_PRIVY_APP_ID`.
- **Still pending from before:** real `STRIPE_WEBHOOK_SECRET` (see §7) and a
  **cron** hitting `POST /api/automations/dispatch` with header
  `x-cron-secret: <SUPABASE_SERVICE_ROLE_KEY>` every minute (scheduled automations).

---

## 4. Privy (auth) — **breaks login if skipped**
Privy allow-lists origins; the new domain must be added or sign-in fails.
1. dashboard.privy.io → your app → **Settings → Domains / Allowed origins**:
   add `https://runbutter.app` (and `https://www.runbutter.app`).
2. Update any redirect/login URLs to the new domain.
3. `NEXT_PUBLIC_PRIVY_APP_ID` is unchanged (same app). If you'd rather start a
   fresh Privy app for the new brand, create it and swap the id in Render.

---

## 5. Supabase (database)
You can keep the existing project or start clean.
- **Keep it:** nothing brand-specific is stored, so no rename needed. Just make sure
  **migrations `0039`→`0042` are run** (still outstanding — the security lockdown),
  then `verify-migrations.sql` shows ✅ through row 42.
- **Fresh project (recommended for a clean public launch):** create it, run
  `supabase-schema.sql` → the root `add-*.sql` → `supabase/migrations/0001…0042` in
  order, enable `pg_cron` + `unaccent`, then put the new URL/anon/service keys in Render.
- **Storage → allowed origins / redirect**: add `https://runbutter.app`.

---

## 6. Google OAuth (Calendar interviews)
Google Cloud Console → **APIs & Services → Credentials → your OAuth client**:
- **Authorized redirect URIs**: add `https://runbutter.app/api/auth/google/callback`
- **Authorized JS origins**: add `https://runbutter.app`
- Update `GOOGLE_REDIRECT_URI` in Render to match.

---

## 7. Stripe (billing)
1. Dashboard → **Developers → Webhooks**: add endpoint
   `https://runbutter.app/api/webhook/stripe`, subscribe to the checkout/subscription events.
2. Copy its **Signing secret** → set `STRIPE_WEBHOOK_SECRET` in Render (replaces the
   placeholder; without it, paid checkouts never auto-upgrade a plan).
3. If you keep test price IDs, update `NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID` /
   `..._PRO_PRICE_ID`. Update the business/brand name on your Stripe account.

---

## 8. Resend (email)
1. resend.com → **Domains**: add & verify `runbutter.app` (DKIM/SPF DNS records).
2. Set `RESEND_FROM = "RunButter <notifications@runbutter.app>"` in Render.
   (Outgoing candidate/status emails already reference the new domain in code.)

---

## 9. Logo / brand art  (optional but visible)
- The current mark is the pixel-arrow in `components/Logo.tsx` (now follows the
  accent/mono token) and the favicon data-URI in `app/layout.tsx` (still hardcoded
  `#4F46E5`). Swap both when you have the real RunButter logo.
- The landing hero uses a monochrome ASCII field — no logo art needed there.

---

## 10. Flip it live
1. Merge `rebrand/runbutter` → `main`, push to the new `origin`.
2. Point Render at the new repo/branch; confirm a clean deploy on `runbutter.app`.
3. Smoke-test **signed in**: login (Privy), create a record, the AI-key settings,
   a webhook test — the flows I can't test here without a real session.
4. Make the GitHub repo **public**. Announce.

---

### One-glance dependency order
`code merge` → `new Supabase (or run 0039–0042)` → `Render env + domain` →
`Privy origins` → `Google/Stripe/Resend URLs` → `deploy` → `repo public`.
Login won't work until **Privy origins** (§4) include the new domain — do that before smoke-testing.
