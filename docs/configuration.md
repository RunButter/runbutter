# Configuration

Every variable, what it switches on, and what happens without it.
`.env.example` is the same list in file form.

**The rule everything follows:** a missing optional variable disables a feature
and says so in the UI. It never fails silently and it never crashes a page.

## Required — the app does not run without these

| Variable | What breaks without it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Nothing loads. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Nothing loads. |
| `SUPABASE_SERVICE_ROLE_KEY` | Every authenticated read and write. `/api/rpc` calls Postgres with this key after verifying your Privy token; without it there is no data path at all. **Server-side only** — it bypasses row-level security on every table. |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Login. There is no hardcoded fallback, and `npm run build` needs a well-formed value to prerender pages. |

## Strongly recommended

| Variable | What it does |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | The public origin. Every unsubscribe link, email tracking pixel, short link, OAuth redirect and signed callback is built from it. Wrong value = links pointing at the wrong host, and OAuth grants landing somewhere you don't control. Never derived from the request `Host` header, deliberately. |
| `SECRETS_MASTER_KEY` | Seals AI keys, social tokens and Excel tokens at rest (AES-256-GCM). Optional: falls back to a key derived from the service-role key — which means rotating that key makes existing secrets undecryptable. Set it explicitly in production. |
| `CRON_SECRET` | Authenticates the finance-reminder and Excel sweeps. Without it those endpoints **refuse to run** — an unauthenticated endpoint that emails your customers is not a safe default. |

## Email — Resend

| Variable | Notes |
|---|---|
| `RESEND_API_KEY` | Without it nothing is emailed: no candidate mail, no invoice reminders, no newsletters. |
| `RESEND_FROM` | The From address, e.g. `RunButter <hello@yourdomain.com>`. The domain must be verified in Resend. |
| `RESEND_WEBHOOK_SECRET` | Verifies the bounce/complaint webhook on `/api/newsletters/webhook`. Without it bounces never suppress, which is how a sending domain gets burned. |

## Billing — Stripe (optional)

| Variable | Notes |
|---|---|
| `STRIPE_SECRET_KEY` | Without it, checkout returns 503 and the plan pages say billing is off. |
| `STRIPE_WEBHOOK_SECRET` | The **only** thing that upgrades a plan after payment. With a placeholder, checkout completes at Stripe and nothing changes in the app — silently. Point a Stripe webhook at `/api/webhook/stripe` for `checkout.session.completed` and paste its signing secret here. |
| `NEXT_PUBLIC_STRIPE_TEAM_PRICE_ID` | Price id for the Team plan. **Per seat** — create a recurring price; checkout sends the seat count as the quantity. |
| `NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID` | Same, for Business. |

`NEXT_PUBLIC_*` values are inlined into the browser bundle at build time, so
changing a price id needs a redeploy, not just a restart. The older
`..._STARTER_PRICE_ID` / `..._PRO_PRICE_ID` names are still read as a fallback.

Self-hosters generally skip all of this and set plans directly in the database:
`update companies set plan = 'business' where id = '…';` — the workspace follows
automatically (migration 0090).

## Calendar — Google (optional)

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. Connected per
recruiter, used only to create and sync the interview events RunButter itself
creates. It never reads the rest of a calendar.

## Social publishing (optional)

`LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`, `X_CLIENT_ID` / `X_CLIENT_SECRET`.
Register `<NEXT_PUBLIC_SITE_URL>/api/social/callback/<provider>` as the redirect
URI on each platform. Scheduled posts also need a cron on `/api/posts/dispatch`.

LinkedIn issues no refresh token to standard apps, so a connection eventually
expires and the UI asks you to reconnect. That is LinkedIn's behaviour, not a bug.

## Two-way Excel sync (optional)

`MS_CLIENT_ID`, `MS_CLIENT_SECRET`, optionally `MS_TENANT_ID`. Needs
`CRON_SECRET` for the sweep. The read-only CSV feed for Excel needs none of
this — it works with an API key alone.

## File text extraction (optional)

`MINERU_URL` / `MINERU_TOKEN` for OCR of scanned documents, self-hosted. Text
PDFs, Word files and images with embedded text are handled locally with no
service at all. There is deliberately no metered OCR API here.

## Analytics (optional)

`NEXT_PUBLIC_ANALYTICS_SITE_ID` and `ANALYTICS_SALT` for the built-in,
cookieless pipeline. `UMAMI_*` only if you deploy Umami — see
[umami-deploy.md](./umami-deploy.md), and read the first paragraph before you
do, because you probably don't need it.

## e-Invoicing, Poland (optional)

`KSEF_BASE_URL`, `KSEF_PUBLIC_KEY_PEM`, `KSEF_MASTER_KEY`. Only relevant if you
issue Polish e-invoices.

## AI

There is no AI variable, on purpose. Model provider keys are **per workspace**,
added in the app under Account → AI keys, encrypted at rest, and spent by the
workspace that owns them. A platform-wide key would mean a platform-wide bill
and a platform-wide blast radius.

## Team vault — no configuration

Deliberately nothing to set. The vault's encryption key is derived in the
browser from a workspace passphrase and never reaches the server, so there is no
variable to configure and `SECRETS_MASTER_KEY` is not involved. Apply migration
`0118` and it works. See [The team vault](./vault.md).

## Cron jobs

See the table in [Install](./install.md#e-cron-jobs-only-for-the-features-you-use).
The two secrets are not interchangeable: automations, newsletters, sequences,
posts and agents use the **service-role key** in `x-cron-secret`; finance
reminders and the Excel sweep use **`CRON_SECRET`**.
