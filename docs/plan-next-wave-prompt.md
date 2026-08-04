# Prompt — paste this into a fresh Claude Code session

> Ships with `docs/plan-next-wave.md`. That file is the reasoning; this is the
> instruction. Run the phases in order, in separate sessions if they get long.

---

Read `CLAUDE.md` first — it is the contract, not background reading. Then read
`docs/plan-next-wave.md` for the reasoning behind what follows.

Work through the five phases below **in order**. After each phase: `npx tsc
--noEmit`, then `npm run build`, then commit and push to `main`. Do not ask
before committing — that is the standing rule.

## Non-negotiables

- **Semantic tokens only.** `bg-surface`, `text-secondary`, `border-subtle`,
  `bg-accent`, `bg-inverse`. Never `bg-white`, never `text-slate-800` — that is
  what breaks dark mode. Type comes from the scale (`text-3xs`…`text-md`),
  never `text-[13px]`.
- **`supabase.rpc()` returns `{ data, error }` and never throws.** Check
  `error`. No `.catch()` — use `.then(ok, err)`.
- **Every new RPC** is `SECURITY DEFINER`, takes `p_privy text`, and is added to
  `/api/rpc`'s `ALLOWED` — unless it is cron-only, in which case it is
  service_role and stays *out* of `ALLOWED`.
- **Migrations** are idempotent and end `notify pgrst, 'reload schema';`. Verify
  each one for real against a scratch PG 16 (`initdb`/`pg_ctl` as `postgres`,
  stub `workspaces` + `is_workspace_member`, run it, exercise the RPCs). This
  sandbox cannot reach `supabase.co`, so that is the only real check available.
- **No new per-call LLM or metered API spend.** AI is BYO-key. Free/public data
  and local computation over anything that meters.
- **No fabricated data** in any UI, including landing-page previews. Sample data
  is labelled as sample.
- **Licences.** Postiz is AGPL-3.0, listmonk AGPL-3.0, Mautic GPL-3.0,
  shadcnuikit a paid template. Do not copy code, schema or adapters from any of
  them — RunButter is MIT and stays MIT. Concepts and feature lists only.
- Commit `package-lock.json` whenever dependencies change, or Render's `npm ci`
  fails and the old build keeps serving.

---

## Phase 1 — Loading orbs

`npm i thinking-orbs` (MIT, zero runtime deps, React ≥18 peer, dual ESM/CJS).

Create `components/ui/Thinking.tsx` as the only file that imports the package.
Expose our own vocabulary so the vendor API never spreads:

```tsx
<Thinking kind="searching" | "composing" | "working" | "idle" size="inline" | "avatar" />
```

Map: `searching` → candidate FTS, `search_files`, sanctions screening ·
`composing` → agent turns, post generation · `working` → imports, Excel sync,
file extraction · `idle` → poll-waiting states.

Then replace `Loader2 … animate-spin` **only where the wait is open-ended**:
`components/crm/{SanctionsPanel,ImportModal,ExcelSync,SkillsSection,
SegmentBuilder,SequenceBuilder,MindMapCanvas,PostBoard}.tsx`, the agent runner,
and `app/(crm)/docs/*`. Leave short button spinners alone — a 64px orb on a
200 ms save is worse than what is there now.

Confirm it is SSR-safe under App Router (it claims to be) and that it respects
`prefers-reduced-motion`; if it does not, gate it in our wrapper.

## Phase 2 — Docs as a document workspace (`0081`)

Today `documents` is title + body, and neither docs nor chat accept images.

1. `alter table documents add column if not exists kind text not null default
   'doc'` — `note | doc | sheet | canvas`, driving which editor mounts. This is
   not a file-format column; do not write a .docx parser. Export to PDF uses
   `pdf-lib`, already installed, already client-side.
2. **Images, on the existing private `/files` bucket (0065)** — one upload
   path, one server-minted signed-URL reader gated on workspace membership.
   Never a public URL. Two call sites:
   - docs — embed by reference in the body
   - chat — `messages.attachments jsonb` (0075). Reads and writes still go
     through `can_read_channel`, which stays the single visibility predicate.
     `post_agent_message` stays service_role.
3. `kind='note'` gets a persisted checkbox block — notes + todo. Interaction
   pattern only; vendor nothing.
4. Reuse `@dnd-kit`, already used by `PostBoard`, `/projects/board` and
   `/dashboard/pipeline`. Do not add a third board implementation.

## Phase 3 — Landing feature windows

Add five preview windows in the existing `ProductPreview` idiom, revealed with
the `Reveal` variants already built (`up | left | right | zoom | fade`):
**Post studio · PDF tools · Web analytics · Mind maps · Personality chart**.

- Render the **real components** with mock props wherever cheap — the radar
  chart and `MindMapCanvas` both can. A screenshot drifts; a component does not.
- Every preview must be responsive at 390px with **no horizontal scroll**. The
  usual culprit is flex/grid `min-width:auto` — reach for `min-w-0`.
- Stacking: `Reveal`'s transform ends when the animation does, which drops its
  child out of its own stacking context. Anything blurred behind a revealed
  window needs `-z-[1]` and the `Reveal` needs `className="relative"`. This
  already washed out the product window once.
- Keep the page fast — `content-visibility: auto` on below-fold sections, and
  do not add a chart library that is not already a dependency.

Verify with headless Chromium at 390 / 768 / 1440 in **both** themes. To test a
theme set `localStorage['hb-theme']` and reload — toggling `.dark` live races
`useThemeSync()`.

## Phase 4 — Native social publishing (`0082`, `0083`)

Postiz is a **feature spec**. Read its docs, not its source.

`0082` — `social_accounts`: per-workspace OAuth grants, tokens **sealed at
rest** with `lib/crypto/secrets.ts` (same reasoning as 0079's `ms_connections`
— a leaked posting grant posts as the company).

`0083` — `post_targets`: one authored `posts` row fans out to N accounts, each
with its own status, provider id and error.

`/api/posts/dispatch`, authed with `x-cron-secret: <service-role key>`, shaped
exactly like `/api/automations/dispatch` so ops learns one pattern. **Sending is
at-most-once**, copied from newsletters: claim to `sending` *before* the
provider call, sweep a stale claim to `failed`, **never back to `pending`**. A
duplicate post to a company's real audience is a public incident. A unique
constraint on `(post_id, account_id)` is what makes it structural.

Providers behind one interface in `lib/social/providers/`, one file each.
**Ship LinkedIn and X first**, and ship a manual "post now" before the
scheduler — a scheduler is worthless until one post reaches one account.

## Phase 5 — Agentic CRM (`0084`)

YC's RFS asks for software agents can use without a human clicking. We are
close; the gap is autonomy and discovery.

1. **Agent tab per record.** `record_agent_notes` — what the agent observed,
   when, and **from which source, never nullable**. Observed facts only: no
   confidence scores. A percentage next to a guess is how a hallucination gets
   trusted. Surface it as a tab on `/objects/*/<id>`.
2. **Scheduled agents.** Add a cron field to `agents`; `/api/agents/run` joins
   the dispatcher family with the same `x-cron-secret` auth. Autonomy stays
   gated — a `suggest` agent still only proposes, it just proposes unprompted.
3. **URL-carried list state** on `/objects/*` — filters, sort, page in the
   query string, so a view is a shareable link an agent can hand back.
4. **Discovery** — `/.well-known/mcp.json` plus a plain-language tool index
   generated from `lib/agents/catalog.ts` (the one tool list; `tools.ts` already
   throws at import if the two drift). Do not hand-write a second copy.

Tenancy is not negotiable and is not uniform by accident:
`list_records`/`create_record` take `p_workspace`; `get_record`/`update_record`
derive workspaces from `p_privy` in SQL. Do not "fix" the latter by inventing an
argument.

---

## When each phase is done

Report: what shipped, what needs a migration run in the Supabase SQL editor,
what needs a new Render Cron Job or env var, and anything you could not verify
because the sandbox has no `supabase.co` and no Privy login.
