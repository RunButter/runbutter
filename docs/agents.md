# Agents

An agent is a role, a set of tools, and how much rope you give it. There is no
graph to draw and no framework to learn.

## The Copilot

The copilot is the same machinery you meet first: a panel docked to the right of
every screen that can read and write the workspace while you work.

It knows **which screen you are on**, so "chase these" resolves to the invoices
in front of you rather than asking which ones you mean. It reaches the whole
product — deals, records, documents and to-do lists, newsletters, social posts,
team chat, the hiring pipeline — through the same functions the screens
themselves call, so it can never reach further than your own account can.

**Changes wait for you.** A conversation starts in *Suggest*: writes are recorded
as proposals and applied when you press Apply. Switch that conversation to *Auto*
and they execute as it goes. The switch is per conversation, because "draft me a
plan" and "tidy these invoices" want different answers.

Two things it deliberately cannot do, whatever mode it is in:

- **Create an agent or an automation.** Both are actors that run unattended with
  permissions somebody chose. Making one is a decision, not a convenience.
- **Add a new record type without asking.** `propose_object` returns a plan for a
  person to approve even in Auto — a wrong record is one row, a wrong object is a
  table, a page, a nav entry and an agent tool target.

Conversations belong to **you**, not the workspace. A colleague cannot read
yours, even sharing a workspace: a thread holds whatever you typed into it.

Each turn is an ordinary agent run, so the transcript, the approval flow and the
token accounting are the same ones described below.

## Making one

**Agents → New agent.**

1. **Role and instructions** — plain words, the way you would brief a new hire:
   what it is responsible for, what it must never assume, how to report back.
2. **Tools** — tick what it may use. Writing tools are marked.
3. **Objects** — which record types it may touch. A collections agent reads
   invoices and writes notes; it cannot open a candidate file, because that box
   is not ticked.
4. **Autonomy** — `suggest` (default) proposes every write for approval;
   `auto` lets it finish on its own, inside a step limit you set.

**Agents → Gallery** has eight working configurations — finance controller,
collections, marketing analyst, recruiting, contract reader, compliance, sales
follow-up, morning briefing. Installing one is just a prefilled editor, and
every template is pinned to `suggest` on install regardless of what it declares.

## The tools

| Group | Tools |
|---|---|
| Records | list record types · list · search · read one · **create** · **update** |
| Research | read research notes · **record a finding** |
| Finance | money in/out · monthly trends · bank ledger · validate an IBAN · parse invoice text |
| Compliance | screen against sanctions · sanctions list status |
| Files | search file contents · list files · read a file |
| Marketing | list websites · website analytics |
| Hiring | open positions · search candidates · read a candidate · pipeline board |
| Connections | list connections · **send to a connection** |

**Bold** = writes, and needs approval in `suggest` mode.

`lib/agents/catalog.ts` is the single source of truth for this list. The
executor throws at import if a tool has no catalogue entry, so the builder's
picker and the executor cannot drift — they did once, and sixteen tools were
ungrantable for a while as a result.

`screen_sanctions` counts as a read even though it appends to its own audit
trail: it changes no business data, and gating a compliance check behind
write-approval would stop agents running them at all. Its `no_data` result —
"nothing has been imported yet" — is returned with an explicit warning so a
model cannot report it as "clear".

## What bounds an agent

- **Tenancy is in SQL.** Every tool derives the workspace from the verified
  caller. An agent cannot be talked into another tenant's data, because the
  query never had access to it.
- **`call_connection` is the only tool that leaves the workspace**, and the
  model picks a saved connection **by id and never supplies a URL**. That, not a
  filter, is what bounds where an agent can reach. It reuses the SSRF guard —
  an owner-saved URL is still not automatically a safe one —
  and `list_connections` strips the URL and secret, because putting either into
  a stored transcript is a leak for no gain.
- **Your key, your bill.** Claude, OpenAI, Gemini, OpenRouter, or any
  OpenAI-compatible endpoint, added per workspace and sealed at rest.

## Memory: notes on a record

`add_record_note` writes a finding onto the record itself. Two deliberate
choices:

- **`source` is required and there is no confidence column.** A URL or a tool
  name is checkable; `0.87` is not, and a number beside a guess is how a
  hallucination gets trusted. A blank source is refused rather than defaulted.
- **People write notes through the same call.** Research a human cannot correct
  is research nobody trusts, and a parallel human-notes table would split the
  record in half.

## Where the copilot ends and an agent begins

They share every mechanism and differ in one way that matters: **who starts it.**
You start the copilot and watch it. A schedule starts an agent and nobody
watches. That is why an agent has a narrow tool list and a fixed job, and why
the copilot cannot create one.

If you want something to happen at 3am, it is an agent. If you want an answer
now, it is the copilot.

## Working unattended

An agent can carry a standing task and a cadence: `hourly`, `daily` or `weekly`
plus a UTC hour. Coarse on purpose — the value is "it ran without me", and a
cron field turns that into a syntax to debug. A schedule with an empty task is
stored as off.

**Scheduling does not change autonomy.** A `suggest` agent with a daily schedule
leaves proposals waiting for you; it does not start acting overnight.

Needs a cron on `POST /api/agents/dispatch` (every ~10 minutes) with
`x-cron-secret: <service-role key>`. Runs are claimed *before* they execute, so
a crash cannot become a hot loop retrying every minute all day.

## Skills

A skill is a reusable instruction pack — how your company writes to clients, how
you qualify a lead, your close checklist — attachable to any agent.

`suggested_tools` on a skill is **a hint for the UI, never a grant**. The
runner's tool list comes from the agent alone.

`/api/skills/import` reads a public GitHub `SKILL.md` and **returns a preview
without storing anything**: imported text lands in a system prompt, so a person
picks what to save.

## From outside

The same tools are exposed over MCP at `/api/mcp` — see [REST API & MCP](./api.md).
