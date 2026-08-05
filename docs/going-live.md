# Going live

Everything that has to be switched on once, in the order it makes sense to do
it. Each section says what stays broken if you skip it, so you can skip the ones
you genuinely don't need.

The commands assume Render (a **Cron Job** service runs a shell command on a
schedule). On a VPS the same lines go in `crontab -e`; on Vercel they become
`vercel.json` cron entries; GitHub Actions works too.

Two names appear throughout:

- `$SITE` — your public URL, e.g. `https://runbutter.app`
- `$SERVICE_KEY` — the Supabase **service-role** key

---

## 1. `NEXT_PUBLIC_SITE_URL` — do this first

Every unsubscribe link, email tracking pixel, short link, OAuth redirect and
signed callback is built from it. It is deliberately never derived from the
request's `Host` header, because that is attacker-controlled and would let a
forged request mint links pointing anywhere.

```
NEXT_PUBLIC_SITE_URL=https://runbutter.app
```

**`NEXT_PUBLIC_*` is inlined into the browser bundle at build time**, so this
needs a **redeploy**, not a restart. Same for every other `NEXT_PUBLIC_` value
below.

Wrong or missing: newsletter links point at localhost, and social OAuth sends
the grant to a host you don't control.

---

## 2. Cron jobs

Nothing here breaks without them — it simply never fires. Add only what you use.

**Two different secrets, not interchangeable.** Five endpoints authenticate with
the service-role key in an `x-cron-secret` header; three use `CRON_SECRET` as a
bearer token. That split is deliberate: the first group is internal dispatch,
the second group can also be triggered by a signed-in human, and a single shared
secret would mean one leak opened both doors.

### Group A — `x-cron-secret: $SERVICE_KEY`

| What | Schedule | Command |
|---|---|---|
| Newsletters — **nothing mails without it** | `* * * * *` | `curl -fsS -X POST $SITE/api/newsletters/send -H "x-cron-secret: $SERVICE_KEY"` |
| Sequences — drips, enrolment, stale sweep, lead scores | `* * * * *` | `curl -fsS -X POST $SITE/api/sequences/run -H "x-cron-secret: $SERVICE_KEY"` |
| Automations — scheduled triggers only | `* * * * *` | `curl -fsS -X POST $SITE/api/automations/dispatch -H "x-cron-secret: $SERVICE_KEY"` |
| Social posts | `* * * * *` | `curl -fsS -X POST $SITE/api/posts/dispatch -H "x-cron-secret: $SERVICE_KEY"` |
| Scheduled agents | `*/10 * * * *` | `curl -fsS -X POST $SITE/api/agents/dispatch -H "x-cron-secret: $SERVICE_KEY"` |

Event and webhook automation triggers fire instantly and need no cron; only
scheduled ones wait for the dispatcher.

### Group B — `Authorization: Bearer $CRON_SECRET`

| What | Schedule | Command |
|---|---|---|
| Overdue-invoice reminders | `0 8 * * *` | `curl -fsS -X POST $SITE/api/finance/reminders/run -H "Authorization: Bearer $CRON_SECRET"` |
| Two-way Excel sync | `*/15 * * * *` | `curl -fsS $SITE/api/excel/sync -H "Authorization: Bearer $CRON_SECRET"` |

Excel's sweep is a **GET**; everything else here is a POST.

Reminders are also off per workspace until an owner enables them, so an
unconfigured instance mails nobody twice over.

`CRON_SECRET` is any long random string — `openssl rand -base64 32`. Without it
set, both endpoints in Group B **refuse to run**: an unauthenticated URL that
emails your customers is not a safe default.

### One cron job instead of five

Hosts bill per cron service, and five of them is five bills for work that takes
milliseconds. Chain the every-minute ones into a single job:

```bash
curl -fsS -X POST $SITE/api/newsletters/send    -H "x-cron-secret: $SERVICE_KEY";
curl -fsS -X POST $SITE/api/sequences/run       -H "x-cron-secret: $SERVICE_KEY";
curl -fsS -X POST $SITE/api/automations/dispatch -H "x-cron-secret: $SERVICE_KEY";
curl -fsS -X POST $SITE/api/posts/dispatch      -H "x-cron-secret: $SERVICE_KEY";
curl -fsS -X POST $SITE/api/agents/dispatch     -H "x-cron-secret: $SERVICE_KEY"
```

Semicolons, not `&&`: one failing endpoint must not stop the ones after it.

Calling the agent dispatcher every minute rather than every ten is harmless — it
claims only agents that are actually due, so the extra calls do nothing. Same for
all of them: each is a no-op when there is nothing to send.

**Check it worked.** `curl -i` the newsletter endpoint by hand: `200` with a JSON
body means it ran, `401` means the header is wrong. Render's cron log shows the
same. A silent `000` usually means the URL is missing `https://`.

---

## 3. Stripe

Do these in order; the last step is the one everybody forgets.

### a. Products and prices

Create **one recurring price per paid plan** — Team and Business.

**Per seat, not flat.** Checkout sends the seat count as the quantity, so a flat
price bills a thirty-person workspace the same as a solo one. Set the price to
the per-seat amount from `lib/plans.ts` (Team $8, Business $33) and let quantity
do the multiplying.

Copy the two **price** ids (`price_…`, not the product id `prod_…`).

### b. Environment

```
STRIPE_SECRET_KEY=sk_live_…
NEXT_PUBLIC_STRIPE_TEAM_PRICE_ID=price_…
NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID=price_…
```

Redeploy — the price ids are `NEXT_PUBLIC_`, so they are baked into the bundle.

Changing your pricing later means **new prices in Stripe and new ids here**;
Stripe prices are immutable, which is why this is a redeploy rather than a
dashboard edit.

### c. Webhook — the step that decides whether anyone gets what they paid for

Stripe → Developers → Webhooks → Add endpoint:

- **URL:** `$SITE/api/webhook/stripe`
- **Event:** `checkout.session.completed`

Copy the **signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET` and
redeploy.

This webhook is the only thing that upgrades a plan. With a placeholder secret,
the customer pays at Stripe, comes back to a success page, and nothing changes
in the app — silently. The request is rejected as unsigned and there is nothing
in the UI to notice.

### d. Check the whole path

Stripe test mode → run a checkout with card `4242 4242 4242 4242` → then:

```sql
select c.plan as company_plan, w.plan as workspace_plan
  from companies c join workspaces w on w.id = c.id
 where c.id = 'THE_COMPANY_ID';
```

**Both** columns must show the new plan. Stripe writes `companies.plan`, the CRM
reads `workspaces.plan`, and migration **0090** is what keeps them together — if
the second column is stale, 0090 has not run.

Stripe's webhook page shows the delivery and the response code. A `503` means
billing is not configured on the instance; a `400` means the signing secret is
wrong.

---

## 4. Resend — sending, and bounce handling

### a. Verify a domain

Resend → Domains → add yours → add the DNS records it gives you. Then:

```
RESEND_API_KEY=re_…
RESEND_FROM="RunButter <hello@yourdomain.com>"
```

The From address must be on the verified domain.

### b. The bounce webhook

Resend → Webhooks → Add endpoint:

- **URL:** `$SITE/api/newsletters/webhook`
- **Events:** `email.bounced` and `email.complained`

Copy the signing secret into `RESEND_WEBHOOK_SECRET`.

Requests are verified with Resend's Svix signature (`svix-id`, `svix-timestamp`,
`svix-signature`). Without the secret set, the endpoint answers `500` and every
bounce is dropped on the floor.

**Why this is not optional if you send campaigns.** A bounce that never suppresses
is an address you keep mailing. Mailbox providers read repeated hard bounces as
the behaviour of a list you did not clean, and that is how a sending domain gets
burned — after which your invoice reminders stop arriving too.

---

## 5. Sanctions screening — one POST, once

The OFAC lists are ingested into your own database and matched locally, so
screening costs nothing per query. It just needs the data:

```bash
curl -fsS -X POST $SITE/api/sanctions/refresh -H "Authorization: Bearer $CRON_SECRET"
```

Or press **Update list** on the Compliance screen while signed in.

Until then screening returns `status: no_data` — never `clear`, deliberately.
"We have not checked" and "we checked and found nothing" are different answers
and the difference matters in an audit.

Refresh it monthly if you rely on it: `0 3 1 * *` with the same command. OFAC's
host returns 403 without a User-Agent header, which the route sets — a manual
`curl` straight to OFAC will fail where the app succeeds.

---

## 6. `SECRETS_MASTER_KEY`

Seals AI keys, social tokens and Excel tokens at rest (AES-256-GCM).

```bash
openssl rand -base64 32
```

```
SECRETS_MASTER_KEY=<that value>
```

Set it **explicitly**. Without it the key is derived from
`SUPABASE_SERVICE_ROLE_KEY`, which works until the day that key changes — a
rotation, or moving to a different Supabase project — and then everything sealed
with the old one is undecryptable. Nothing is lost that cannot be re-entered:
people re-add their AI keys and reconnect LinkedIn. But they will not know why,
and the error arrives at the worst moment.

**Rotating this key has the same effect.** If you set it after secrets already
exist, anything sealed under the derived key stops opening. Do it early, or
accept one round of re-entry.

---

## 7. The public repository

```bash
git remote add public https://github.com/RunButter/runbutter.git
git push public main
```

Then, on that repository:

1. **Enable Discussions** — the issue form links there for questions.
2. **Check Actions is enabled**, so CI runs on pull requests.
3. Add the description and topics: `crm`, `erp`, `open-source`, `nextjs`,
   `postgres`, `ai-agents`, `mcp`, `self-hosted`.
4. **Publish a release:**

   ```bash
   git tag v1.1.0
   git push public v1.1.0
   ```

   Then GitHub → Releases → Draft a new release → pick the tag → paste the
   Unreleased section of [CHANGELOG.md](../CHANGELOG.md) as the notes.

   **Settings → Updates has nothing to compare against until a release exists** —
   it asks GitHub for the latest one, so with none published it correctly reports
   that it could not check.

---

## 8. Try the container stack once

```bash
cp .env.docker.example .env
node scripts/gen-keys.mjs --env >> .env
#  ↳ paste a Privy app id into .env
docker compose up
```

Not for production — to confirm the path a stranger takes on their first day
actually works, before a stranger does. Five containers come up and the app is
on <http://localhost:3000>.

Worth doing even if you never self-host, because it is the first thing anyone
who finds the repository will run.

---

## The order I would do it in

1. `NEXT_PUBLIC_SITE_URL` + `CRON_SECRET` + `SECRETS_MASTER_KEY`, one redeploy.
2. Resend domain and webhook — before sending anything to a real list.
3. Cron jobs for the features you actually use.
4. Stripe, all four steps, tested in test mode.
5. Sanctions refresh, if you screen.
6. Repo, release, Docker — when the product side is settled.
