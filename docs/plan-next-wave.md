# Next wave — plan

Seven asks, checked against what the repo actually has and what the licences
actually allow. Two of them collapse into one piece of work, one of them cannot
be done the way it was described, and the rest are real.

## Findings that change the plan

**Postiz is AGPL-3.0.** Verified against
`gitroomhq/postiz-app/LICENSE` — GNU Affero v3, including the §13 network
clause. This is the same wall as listmonk and Mautic: copying a file, a schema
or a provider adapter out of it would relicense RunButter off MIT. So item 3 is
**not** "port their post studio". Two legal routes remain, and the plan takes
the second:

- *Integrate, don't absorb* — run Postiz as a separate self-hosted service and
  call its public API. Legal (mere aggregation), but it means our users deploy
  a second app, a second Postgres and a second set of OAuth apps. That is the
  opposite of "one relational core".
- *Build native publishing* — our own OAuth + scheduler against the platform
  APIs, reading Postiz only as a **feature spec** (concepts are not
  copyrightable). More work, stays MIT, stays one database. **This is the plan.**

**`trycompai/crm` is MIT** — borrowable, and the interesting parts are
architectural rather than code: an evidence ledger with no confidence scores, a
per-record "Agent" tab showing research steps live, list state (filters/sort/
page) carried in the URL so a view is a shareable link, and agent skills as
versioned markdown. Three of those four map onto things we already have
(`agents`, `skills` = 0068, `search_files`).

**`thinking-orbs` is MIT, zero runtime dependencies, React ≥18 peer, dual
ESM/CJS with types.** Items 6 and 7 are the same package — `orbs.jakubantalik.com`
is its demo site. One task, not two.

**YC's RFS** is pointing at *"software for agents"* and *"the AI operating
system for companies"* — machine-readable surfaces (API, MCP, CLI) that an
agent can discover and use without a human clicking. We are unusually close to
this already: `/api/mcp` and `lib/agents/tools.ts` are one shared, tenancy-safe
executor over 19 tools. The gap is not capability, it is **discoverability and
autonomy** — an agent has to be told what exists, and it only acts when a human
opens the page.

---

## The work, in dependency order

### 1 · Loading orbs (foundation — do first)
`npm i thinking-orbs`. Wrap it once as `components/ui/Thinking.tsx` so the
vendor API never leaks into 40 files, mapping our states to theirs
(`searching` for FTS and sanctions, `composing` for agent runs and post
generation, `working` for imports/sync/extraction, `breathing` for idle
polling). Replace `Loader2 className="animate-spin"` **only where a wait is
genuinely open-ended** — an agent turn, a file extraction, an Excel sync, a
sanctions screen. A 200 ms button spinner stays a spinner; a 64px orb on a
button press is worse, not better. Ship the inline 20px preset for table rows.

*Touches:* `components/crm/{SanctionsPanel,ImportModal,ExcelSync,SkillsSection,
SegmentBuilder,SequenceBuilder,MindMapCanvas,PostBoard}.tsx`, the agent runner
UI, `app/(crm)/docs`.
*Note:* `package-lock.json` MUST be committed — dependencies changed, and
Render's `npm ci` fails otherwise.

### 2 · Docs become a document workspace (migration 0081)
Today `docs` is title + markdown body, no types, no images — and chat has no
attachments either. Both are one storage decision away.

- `documents.kind` — `note | doc | sheet | canvas` — driving which editor
  mounts. Not a file-format field: we are not writing a .docx parser. **Export**
  to PDF rides on `pdf-lib`, already installed and already client-side.
- **Images in docs and in chat**, on the same private bucket `/files` uses
  (0065). One upload path, one signed-URL reader, two call sites. Chat messages
  get an `attachments jsonb[]`; a doc embeds by reference. Because it is the
  same bucket, an image dropped in chat is **already** in FTS-indexed storage.
- **Notes + todo** as the light `kind`, with a checkbox block that persists —
  this is the shadcn-kit inspiration, taken as an interaction pattern rather
  than a dependency (`shadcnuikit.com` is a paid template; do not vendor it).
- The kanban we already have — `PostBoard`, `/projects/board`,
  `/dashboard/pipeline` all use `@dnd-kit`. Reuse, do not add a third board.

*Guard:* the private bucket is private for a reason. Every read goes through a
signed URL minted server-side after a workspace-membership check — never a
public URL pasted into markdown.

### 3 · Landing: feature windows (no migration)
Five new preview windows, in the existing `ProductPreview` idiom, revealed on
scroll with the `Reveal` variants already built: **Post studio**, **PDF tools**,
**Web analytics**, **Mind maps**, **Personality chart**. Two rules, both learned
the hard way on this page:

- **No fabricated data.** Every number, chart and row in a preview must be
  plausible sample data explicitly framed as a sample — the same standard as
  the amber "Sample" badge in `lib/crm/*`.
- **Real components where cheap.** The radar chart and the mind-map canvas can
  render for real with mock props; a screenshot of them will drift the moment
  the component changes.

Watch the stacking bug that already bit once: `Reveal`'s transform ends when
the animation does, so anything blurred behind a revealed window needs
`-z-[1]` and the window's wrapper needs `relative`.

### 4 · Native social publishing (migrations 0082–0083)
Postiz as spec, not as source. Order matters — this is the biggest item.

1. `social_accounts` — per-workspace OAuth grants, tokens **sealed at rest**
   via `lib/crypto/secrets.ts` (the same reasoning as 0079's `ms_connections`:
   a posting grant that leaks posts as the company).
2. `post_targets` — a post fans out to N accounts; per-target status, provider
   id, error. The existing `posts` row stays the authored content.
3. `/api/posts/dispatch` on `x-cron-secret`, mirroring
   `/api/automations/dispatch` exactly — same auth, same Render Cron shape, so
   ops learns one pattern.
4. **At-most-once, like newsletters.** Claim to `sending` before the provider
   call; sweep a stale claim to `failed`, never back to `pending`. A duplicate
   post to a company's real audience is a public incident.
5. Providers behind one interface, shipped one at a time — LinkedIn and X
   first (the two our users actually asked for), each a file under
   `lib/social/providers/`.

Start with **1 + 2 + a manual "post now"**; the scheduler is worthless until a
single post can reach a single account.

### 5 · Agentic CRM (migration 0084)
The YC gap is autonomy and discoverability, so build those, not a new agent.

- **Agent tab per record.** `/objects/companies/<id>` gets a tab showing what
  the agent did, when, and from which source. Backed by an `record_agent_notes`
  table with a **source column that is never optional** — trycompai's "observed
  facts, no confidence scores" rule is the right one, and it is the difference
  between research and a hallucination with a percentage on it.
- **Scheduled agents.** `agents` gains a cron field; `/api/agents/run` joins
  the dispatcher family. This is the actual "agentic" step — today an agent
  only acts when someone opens a page. Autonomy stays gated: a `suggest` agent
  still only proposes, it just proposes without being asked.
- **URL-carried list state** on `/objects/*` — filters, sort and page in the
  query string. Small, and it makes every view a link an agent can hand back.
- **Discovery for agents** — `/.well-known/mcp.json` plus a plain-language tool
  index, so an MCP client can find the 19 tools without reading our docs. This
  is literally what the RFS asks for and it is a day's work on top of
  `lib/agents/catalog.ts`.

*Do not* add per-call LLM spend anywhere in this. AI stays BYO-key.

---

## Sequence

```
1 orbs ──┐
         ├─→ 3 landing windows (uses orbs in previews)
2 docs ──┘
         └─→ 4 social publishing ─→ 5 agentic CRM
```

1 and 2 are independent and can land in either order. 3 wants 1 done. 4 is the
long pole. 5 builds on 4's dispatcher pattern.

## Migrations this adds

| # | What | Depends on |
|---|---|---|
| 0081 | `documents.kind`, attachments on docs + chat | 0075 (chat), 0065 (bucket) |
| 0082 | `social_accounts` | 0069 (post board) |
| 0083 | `post_targets` + dispatch claim | 0082 |
| 0084 | `record_agent_notes`, agent schedules | 0068 (skills) |

Every one idempotent, ending `notify pgrst, 'reload schema';`. Every new RPC
added to `/api/rpc`'s `ALLOWED` — except the cron-only ones, which stay
service_role and stay out of it, like `claim_excel_links`.

## Explicitly out of scope

- Vendoring anything from Postiz, listmonk, Mautic or shadcnuikit.
- A second kanban implementation.
- Confidence scores on agent research.
- Any metered API for social posting, OCR, or enrichment.
