# Roadmap — Newsletters, Marketing Automation, Team Chat

Status: **plan**. Phase 1 data model is built (0070); everything else below is unbuilt.

---

## 0. The licence finding, first, because it changes the brief

The request was to *integrate the code* of listmonk and Mautic. That is not possible:

| Project | Licence | Verified from |
|---|---|---|
| listmonk | **AGPL-3.0** | `knadh/listmonk` `LICENSE` |
| Mautic | **GPL-3.0** | `mautic/mautic` `LICENSE.txt` |

Both are strong copyleft. Linking or copying either into RunButter would oblige us to release
**the whole product** under AGPL/GPL. That is not a preference we can be granted an exception to —
it is the licence those projects chose, and it is the mechanism by which they protect themselves
from exactly this. Copying "just a few files" is the same problem in a smaller box.

AGPL is the more aggressive of the two: it triggers on *network use*, so even running a modified
listmonk as a hosted service obliges source release. Since RunButter is a hosted product, there is
no "we only use it internally" carve-out.

**What is safe:** ideas, feature sets, information architecture, database *concepts*, UX. Those are
not copyrightable. Everything below is a native implementation of ideas these projects proved out.

Mautic is also PHP/Symfony and listmonk is Go — neither drops into Next.js regardless of licence.

---

## 1. What we already have (this is more than half of it)

| Capability | Where | Reusable for this? |
|---|---|---|
| Transactional email | Resend, `lib/status-emails.ts`, reminders route | Yes — the send path |
| Automation engine | 0032/0033: triggers, conditions, actions, outbox, retry, dispatcher | Yes — the sequencing spine |
| Outbound webhooks | `connections` + `send_webhook` + SSRF guard | Yes |
| Lead capture | Forms (0054) + email hygiene gating | Yes — the subscribe endpoint |
| Click tracking | Short links (0055) | Yes — link rewriting |
| Web analytics | `site_events` / Umami (0059) | Yes — attribution |
| Contacts | `people` object | Yes — subscriber ↔ person link |
| Campaigns | `campaigns` object | Yes — grouping |
| Brand (logo, colours, email) | `workspaces` branding, 0024 + 0061 | Yes — template theming |
| AI, BYO key | agents, `ask_ai` action, `lib/ai/providers.ts` | Yes — the AI builder |

**What is genuinely missing** is subscriber state, a campaign send pipeline, open/click attribution
per recipient, unsubscribe machinery, and multi-step sequences with waits.

---

## 2. Phase 1 — Newsletter core *(data model built in 0070)*

### Design decisions worth stating

**Subscribers are not `people` rows.** A subscriber is an *email address* with consent state; a
person is a human in the CRM. One person can hold two addresses, and a newsletter signup should not
silently manufacture a CRM contact. `subscribers` therefore keys on `(workspace_id, email)` and
carries a nullable `person_id` so the two can be joined when they are in fact the same party.

**Consent is a record, not a boolean.** `consent_source`, `consent_at` and `consent_ip` are stored
because under GDPR the obligation is to *demonstrate* consent, and a lone `subscribed = true` proves
nothing about where it came from.

**One delivery row per (newsletter, subscriber), with a unique constraint.** This is the single
most important table in a mailer. It makes a send resumable after a crash, and it makes
double-sending structurally impossible rather than merely unlikely — the worst failure a mailing
tool has, because it is public, irreversible and lands in the inbox of every customer at once.

**Sending is batched through a cron, not a request.** A 5,000-recipient send cannot live inside one
HTTP request. It reuses the pattern already proven by `/api/automations/dispatch` and the invoice
reminder runner: claim a batch, send, mark, repeat.

**Unsubscribe is one click and needs no login.** An unguessable per-subscriber token, plus the
`List-Unsubscribe` and `List-Unsubscribe-Post` headers. This is not a nicety: Gmail and Yahoo
require one-click unsubscribe for bulk senders, and without it deliverability collapses.

### Still to build in phase 1
- [ ] `/api/newsletters/send` — batch claim + Resend + delivery marking (cron-driven)
- [ ] Open pixel + click redirect that write to `newsletter_events`
- [ ] `/u/[token]` one-click unsubscribe page + `List-Unsubscribe` headers
- [ ] Resend bounce/complaint webhook → mark subscriber `bounced` / `complained`
- [ ] UI: lists, subscribers, import CSV, newsletter composer, send/schedule, per-send stats
- [ ] 3 templates (below)
- [ ] AI builder (below)

### The three templates
Deliberately three, not thirty. Each is a token-themed layout, not a drag-and-drop page builder:
1. **Plain** — a letter. One column, text, one call to action. The highest-deliverability format and
   the one most B2B newsletters should actually use.
2. **Announcement** — hero image, headline, body, button. For launches.
3. **Digest** — repeating title/blurb/link blocks. For roundups.

All three read `workspaces` branding (logo, accent, footer address), so a workspace's newsletters
match its invoices and careers page without configuring anything twice.

### The AI builder
BYO key only, per the cost rule — no metered calls on our account. Give it a brief plus the
workspace's own recent newsletters as tone reference; it drafts subject line, preheader and body
into the chosen template. **It drafts, it does not send.** The composer is the approval step, the
same way agents propose writes rather than making them.

---

## 3. Phase 2 — Marketing automation (the Mautic ideas)

Our automation engine already does triggers → conditions → actions with an outbox and retries. Three
things are missing, in order of value:

**1. Segments.** A saved filter over subscribers/people that evaluates live ("opened nothing in 90
days", "country = PL and status = customer"). Everything else in this phase depends on it. Mautic's
real lesson is that segments, not campaigns, are the primitive.

**2. Sequences (drip).** Our automations fire once on an event. A sequence is an ordered list of
steps with **waits** — "day 0 welcome, day 3 case study, day 7 ask for a call". That needs a
per-contact cursor (`sequence_enrollments`: which step, when due), which the existing dispatcher can
drain on the same cron. This is the single biggest gap between "automations" and "marketing
automation".

**3. Lead scoring.** Points per action (opened, clicked, visited pricing, submitted form), decaying
over time, exposed as a field on the person. Cheap once events exist, and it is what makes a
"Sales follow-up" agent actually useful.

Deliberately **not** doing: Mautic's landing-page builder (we have Forms + careers + sites), its
own CRM (we are one), or its plugin marketplace.

---

## 4. Phase 3 — Team chat

A Slack-style channel surface inside the workspace, in the Team group.

**Why it is worth building rather than integrating:** the value is not chat — it is chat *attached to
records*. A thread on an invoice, a candidate, a deal. Slack cannot do that because it does not know
what an invoice is. That also means the messy parts of a chat product (presence, huge history,
mobile push, threading depth) are not where the value is, so v1 can be small.

**Shape:**
- `channels` (workspace-scoped, optional `linked_object`/`linked_id` — the record it belongs to)
- `channel_members`, `messages`, `message_reads`
- Realtime via Supabase Postgres changes (already available; no new infra)
- Mentions → the existing notification path
- Agents post as members, so an agent's run summary lands in `#finance` instead of a runs table

**Explicitly deferred:** threads, huge file uploads (Files already exists — link, don't re-upload),
voice, external federation.

`assistant_channels` (0057) already exists for the AI assistant and is **not** this — that is a
DM with a bot, not a team channel. They should converge later; they should not be conflated now.

---

## 5. Suggested order

1. Phase 1 send pipeline + unsubscribe (a newsletter tool that cannot send is nothing)
2. Phase 1 UI + templates
3. Phase 1 AI builder
4. Phase 2 segments → sequences → scoring
5. Phase 3 chat

Chat is last not because it is least valuable but because it is the most self-contained — it can be
built at any point without blocking the rest, and nothing else depends on it.
