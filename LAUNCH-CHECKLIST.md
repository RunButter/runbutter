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
- Git URL `github.com/CasperCrypto/hirebtr` → `github.com/RunButter/runbutter` **(placeholder — adjust in step 2 if your org name differs)**
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
   git remote add origin https://github.com/RunButter/runbutter.git
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
- ⚠️ **`NEXT_PUBLIC_PRIVY_APP_ID = cmlqpi7i600630cjlgazh281n`** — the hardcoded
  fallback was REMOVED for open-sourcing. If this env var isn't set in Render,
  **login breaks** (Privy can't init) and server-side token verification fails
  closed. Set it before deploying the rebrand. (It's a public value, not a secret.)
- Keep: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SECRETS_MASTER_KEY`.
- `NEXT_PUBLIC_ANALYTICS_SITE_ID = a0f643e7-6b67-4290-8a8d-72f65cf7e341` — also
  no longer hardcoded; set it to keep your own web analytics working (optional).
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
  `supabase-schema.sql` → the root `add-*.sql` → `supabase/migrations/0001…0045` in
  order, enable `pg_cron` + `unaccent`, then put the new URL/anon/service keys in Render.
- **Storage → allowed origins / redirect**: add `https://runbutter.app`.

---

## 6. Google OAuth (Calendar interviews)

> `Error 400: redirect_uri_mismatch` means the callback URL the app sent is not
> registered on the OAuth client. The app derives it from the host you loaded it
> from — `https://<host>/api/auth/google/callback` — so **every host you use must
> be registered**, including the raw `*.onrender.com` URL and localhost.
> The Google error page's "see error details" shows the exact rejected URI.

**a. Enable the API** — APIs & Services → **Library** → "Google Calendar API" → **Enable**.

**b. Credentials** → your **OAuth 2.0 Web client** (must be the one whose id is
`GOOGLE_CLIENT_ID` in Render — check the project picker is the right project):

*Authorized redirect URIs* (exact, no trailing slash):
```
https://runbutter.app/api/auth/google/callback
https://www.runbutter.app/api/auth/google/callback
https://<your-service>.onrender.com/api/auth/google/callback
http://localhost:3000/api/auth/google/callback
```
*Authorized JavaScript origins*: `https://runbutter.app`, `https://www.runbutter.app`,
`http://localhost:3000`

**c. OAuth consent screen** — add `runbutter.app` to **Authorized domains**; point
app name / homepage / privacy / terms at the new domain. Scopes used:
`calendar.events` + `calendar.readonly` (both **sensitive**).

**d. Publishing status — the 7-day trap.** While the app is in **Testing**, add your
Google account under **Test users** or consent fails. But testing-mode refresh
tokens are **revoked after 7 days**, so the calendar connection silently breaks
weekly and every recruiter has to reconnect. For a real launch either publish to
**Production** (sensitive scopes → Google verification) or use **Internal** user
type if you have a Google Workspace org.

**e. Render**: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` must match this client.
`GOOGLE_REDIRECT_URI` is only a fallback (the app computes the URI per request) —
set it to `https://runbutter.app/api/auth/google/callback` for consistency.

Changes usually apply within minutes; Google warns they can take a few hours.

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

## 9. Logo / brand art  **[done]**
- Real butter logo wired in: `public/logo.svg` (mark) drives `components/Logo.tsx`;
  full favicon set in `public/` + `app/icon.svg`; OpenGraph/Twitter cards point at
  `public/logo.png`. Raw design exports live in `RunButter.app/` (gitignored).
- Optional polish later: a proper 1200×630 OG image (currently the square logo).

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
