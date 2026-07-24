# RunButter — Marketing & Feature Kit

> Your source of truth for launch copy, feature lists, competitive positioning,
> and social/Product Hunt material. Everything below is real and shipped unless
> a line is explicitly marked *(roadmap)* or *(caveat)*.
> Domain: **runbutter.app** · Repo: **github.com/RunButter/runbutter** · License: **MIT**

---

## 1. Positioning in one line

**RunButter is the open-source company OS — run sales, finance, marketing, projects and hiring in one workspace, with AI agents that actually do the work, and no per-token AI bill.**

Category: *Business OS / all-in-one work platform* (think Twenty + Notion + a light ERP + an ATS, but one relational core and open source).

---

## 2. Elevator pitches (pick by context)

**5 words:** Run your whole company, smoothly.

**One sentence:** RunButter puts your CRM, finances, marketing, projects and hiring on one relational database, adds AI agents that read and update it for you, and is fully open source with no AI token markup.

**Short paragraph:** Most companies glue together a CRM, an accounting tool, a social scheduler, a project board, and an ATS — five subscriptions that never talk to each other. RunButter is one workspace where a company, a person, a deal, an invoice, a campaign and a candidate are all connected records. It's built on native Postgres (so search, matching and reporting cost nothing per query), it's MIT-licensed and self-hostable, and it ships an AI agent layer plus an MCP server so both humans and AI can drive the same governed tools.

---

## 3. The wedge — why RunButter is different

Four things almost nobody combines:

1. **One relational core, not a bundle.** Sales, finance, marketing, projects and HR share the same records. A deal knows its company; an invoice knows its client; a candidate becomes a team member. No integrations to maintain between your own tools.

2. **AI agents with a governance layer — BYO key, no markup.** You bring your own Claude/OpenAI/Gemini key, so there is zero per-token cost from us. Agents are scoped (which tools, which objects), bounded (step caps), and safe by default (they *propose* writes for approval; you opt trusted ones into autonomy). Every run is logged.

3. **The same tools power humans, external AI, and in-app agents.** One verified tool layer sits behind the UI, a REST API, signed webhooks, and a native **MCP server**. Point Claude Desktop, Cursor, Zapier — or RunButter's own agents — at the identical, tenancy-safe endpoints. "Your users might be agents too" is literally how it's built.

4. **Open source + no lock-in.** MIT license, your own Supabase and Privy, cookieless first-party analytics, GDPR controls, and you can export any list to CSV in one click. Own your data end to end.

---

## 4. Competitive landscape & advantages

| You'd otherwise use… | RunButter replaces / unifies it | Our edge |
|---|---|---|
| HubSpot / Salesforce (CRM) | Sales CRM + deal pipeline | Connected to finance & projects; open source; no seat-gouging |
| QuickBooks / Xero (finance) | Invoices, expenses, bank ledger + reconciliation | Same records as your CRM; branded PDF + EU e-invoicing |
| Buffer / Hootsuite (social) | Post studio + client review | **Pixel-faithful previews + Figma-style pinned comments + shareable client review links** — rare combo |
| Linear / Jira (projects) | Projects, issues, roadmap, board | In the same workspace as everything else |
| Greenhouse / Lever (ATS) | Full recruiting suite | **Skills + Big-5 personality matching, Talent Treasury, team-fit simulator** built in |
| Zapier / Make (automation) | Automations + webhooks + schedules | Native, no metered task pricing; plus an MCP server |
| Plausible (analytics) | Cookieless web analytics | First-party, no cookie banner, in-product |
| A separate "AI copilot" SaaS | AI agents + AI docs | **BYO key = no per-token markup**, agents act on real data with approval gates |

**The honest headline:** there are great point tools for each of these. There are very few products that put *all* of them on one relational core, add a **governed AI-agent layer on your own key**, and ship it **open source**. That intersection is the whole pitch.

---

## 5. Full feature inventory

### Workspace foundation
- **One relational core** — every object (company, person, deal, invoice, campaign, project, candidate…) is a connected record in one Postgres database.
- **Home dashboard** — cash in bank, net profit, open pipeline, and candidate stats at a glance.
- **Global design system** — clean, keyboard-first, **light & dark mode** across every surface.
- **Live global search** (⌘K).
- **Roles & permissions** — owner / admin / member; workspace-scoped isolation.
- **Import & export** — CSV or Google Sheets in with automatic column matching; export any list to CSV in one click.
- **Bulk actions** — select, categorize, export, delete across every object list.

### Sales CRM
- **Deal pipeline** — drag-and-drop kanban stages.
- **Companies & People** — relational contacts, linked to deals, invoices and more.
- **Products** — catalogue with unit pricing.
- **Offers → Invoices** — build a quote, get it accepted, convert to an invoice in one click.
- **Company autofill** — look up a client by VAT (EU VIES) or Polish NIP (MF Biała lista) and autofill name/address/tax id. No API keys needed.

### Finance
- **Invoices & expenses** — full records with statuses (draft/sent/paid/overdue).
- **Branded PDF documents** — invoices and offers with your logo and legal details.
- **Bank transaction ledger** — a Midday-style ledger with inflow/outflow, categories, methods.
- **Automatic reconciliation** — rule-based matching of incoming payments to the right invoice.
- **Finance analytics** — revenue vs costs, net, over any period.
- **KSeF e-invoicing (Poland)** — export compliant FA(3) XML e-invoices straight from your documents. *(Phase 1: export. Live token submission is roadmap.)*

### Documents & e-signature
- **Built-in e-signatures** — send a document for signature via a tokenized link; the signer draws or
  types their name, no account needed. Stored in a private bucket, audit-stamped. Built on pdf-lib +
  signature_pad (MIT) — not a wrapper around someone else's service.
- **Branded PDF documents** — invoices and offers with your logo, legal details and bank info.
- **Scheduled reports** — weekly/monthly PDF summaries emailed to a recipient list on a cron.

### Marketing  ★ (coordination is a signature strength)
- **Campaigns** — budget, spend, leads by channel.
- **Post studio** — compose a social post and preview it **pixel-faithfully** as it will look on **Instagram, Facebook, X, and LinkedIn**.
- **Figma-style pinned comments** — click anywhere on the post mockup to drop a numbered pin and leave a comment. Perfect for a marketing team (or client) reviewing a draft together.
- **Shareable client review links** — send a tokenized public link; a client or stakeholder can review and comment on the post **without an account**. Resolve comments as you address them.
- **Approval workflow** — draft → in review → approved → published status on every post.
- **Web analytics** — **cookieless, first-party** visitor tracking (visitors, pageviews, top pages, referrers, live now). No cookie banner needed.
- **Source tracking** — generate per-channel tracking links with UTM capture; see which source actually converts to applicants/customers, with click→apply→hire attribution.
- **Short links** — your own branded link shortener with click tracking, so every campaign link is measurable.
- **Custom forms** — build a public form, share it, and have every submission land as a record in your
  workspace (lead capture, contact, applications) with no third-party form tool.

### Projects
- **Projects & issues** — records with status, priority, due dates.
- **Board** — kanban view of issues.
- **Roadmap** — a Gantt-lite timeline across projects.

### HR / Recruiting  ★ (very advanced — a full ATS, not a bolt-on)
- **Positions** — create a role with a custom screening assessment (multiple-choice + open-ended questions).
- **Public apply flow** — branded application page with CV/résumé drag-and-drop upload.
- **Assessments** — candidates take a **Big-5 personality** assessment plus **work-style** preferences and **skills screening** MCQs. Scores are discrete columns; Big-5 stored as structured data. *(Caveat: there is no separate "cognitive IQ" test — market the Big-5 + skills, not a cognitive score.)*
- **Neuro-profile matching** — each position picks a target profile (hard-tech / aggressive-sales / creative-chaos / operations-monk) and candidates get an alignment % against it, visualised on a radar chart.
- **Hiring pipeline** — drag-and-drop stages from applied → hired, with automatic status-change emails to candidates.
- **Talent Treasury** — a faceted explorer over your *entire* candidate pool: filter by score thresholds, source, status, position; sort and surface the best fits you already have.
- **Team-Fit simulator** — model how a candidate would fit alongside your existing team's profiles.
- **Résumé search** — full-text search across résumé text, powered by Postgres FTS (tsvector + GIN). **Zero AI cost** — it's a database query, not an LLM call.
- **Interviews** — schedule via **Google Calendar** (with Meet links), plus a **Cal.com connector** that
  pulls booked meetings into the workspace.
- **Email templates & candidate messaging** — reusable invite/decline/offer templates with variables; send and log messages per candidate.
- **My Team** — onboarding checklists, weekly **pulse check-ins** (mood), a rule-based manager brief, and retention signals.
- **Directory & Assets** — team directory and company equipment tracking (laptops, licenses, etc.).
- **GDPR controls** — consent logging and automatic anonymization of expired candidates (pg_cron).

### AI Agents  ★ (the headline AI feature)
- **Define an agent** — give it a name, role, and instructions (system prompt), pick a model, and **scope** exactly which tools and which objects it may touch.
- **Run it on a task** — the agent reads and updates your workspace through the same verified endpoints the app uses.
- **BYO key, no markup** — runs on *your* Claude/OpenAI/Gemini/OpenRouter key. Zero per-token cost from RunButter.
- **Safety by default** — in "suggest" mode the agent **proposes** every write for one-click human approval; opt trusted agents into "autonomous" mode, bounded by a per-run step cap and its scoped tools.
- **Full audit log** — every turn, tool call, result and proposed change is recorded per run.
- **Chat assistant** — drive the workspace conversationally from **Telegram**; it runs the same governed
  agent loop and the same verified tools as everything else.

### Automations
- **Trigger → filter → action** rules: when a record is created/updated, an incoming webhook fires, or on a schedule → send email, fire webhooks, create records, or run an AI step.
- **Visual step builder + n8n-style board view.**
- **Signed, retried, logged outgoing webhooks** (Svix-style).
- **Templates** to start fast; instant execution (no waiting on a cron for event/webhook triggers).

### Docs + AI
- **Markdown docs** with an AI writing toolbar (draft/improve/summarize/continue/fix).
- **BYO AI keys** — Claude, OpenAI, Gemini, OpenRouter, or **any OpenAI-compatible endpoint** (Groq, Mistral, DeepSeek, Ollama, LiteLLM…). Keys are **encrypted at rest** (AES-256-GCM).

### Open integrations
- **REST API** (`/api/v1/records`) — list and create records with a workspace API key.
- **Inbound webhooks** — POST to fire an automation from anything.
- **Native MCP server** (`/api/mcp`) — connect Claude Desktop/Code, Cursor, or any MCP client and let AI read/write your workspace over a governed tool interface.
- **Connectors** — Slack, Discord, Zapier, Make, generic webhooks.

### Security & privacy (a selling point, not fine print)
- **Signed-token auth** — every data access goes through server-side functions that verify your session (Privy JWT); the anon key can't touch your tables directly.
- **Per-workspace isolation** (multi-tenant).
- **Encrypted secrets** — BYO AI keys and integration secrets AES-256-GCM at rest.
- **Cookieless analytics**, **GDPR anonymization**, rate-limited public endpoints, SSRF guards on outbound fetches, and a Content-Security-Policy.
- **Open source** — MIT. Audit it, self-host it, own it.

---

## 6. Signature workflows ("a day in RunButter")

1. **Close a deal → invoice → get paid, without switching apps.** Drag a deal to Won → convert its offer to a branded PDF invoice → the bank ledger auto-reconciles the incoming payment to it.

2. **Ship a social post as a team.** Draft a post → preview it exactly as it'll look on Instagram and LinkedIn → drop pinned comments on the mockup for your designer → send a review link to the client → they approve without logging in → mark published.

3. **Hire by skills *and* personality.** Post a role with a screening quiz → candidates apply and take a Big-5 + skills assessment → sort your Talent Treasury by fit → simulate team fit → schedule the interview via Google Calendar → move them down the pipeline (status emails send automatically).

4. **Put an AI agent on the busywork.** Create a "Collections" agent scoped to invoices → "find overdue invoices and draft a follow-up task for each" → it proposes the changes → you click Approve. Or let a trusted agent run autonomously within a step limit.

5. **Let external AI drive it.** Point Claude Desktop at your MCP endpoint → "add ACME as a company and log a deal for €40k" → it happens through the same verified, tenancy-safe tools.

---

## 7. Copy bank — ready to paste

### Product Hunt
- **Name:** RunButter
- **Tagline (60 char):** The open-source company OS with AI agents, no token bill
- **Alt taglines:**
  - Run your whole company, smooth as butter
  - One workspace for sales, finance, marketing, projects & hiring
  - Open-source business OS + AI agents on your own key
- **Description:**
  > RunButter is the open-source company OS. Sales, finance, marketing, projects and hiring live on one relational core — a company, an invoice, a campaign and a candidate are all connected records, not five apps you glue together.
  >
  > It ships an AI agent layer that runs on *your* API key (no per-token markup): scope what each agent can touch, and it proposes changes for your approval or runs autonomously within limits. The same governed tools power a REST API and a native MCP server, so Claude, Cursor or Zapier can drive your workspace too.
  >
  > Built on native Postgres (search and matching cost nothing per query), MIT-licensed, self-hostable, cookieless analytics, GDPR controls. Free plan, or clone the repo.
- **Maker's first comment:**
  > Hey PH 👋 We were tired of paying for five disconnected SaaS tools that never talk to each other, then paying *again* for an "AI copilot" with a per-token markup. So we built RunButter: one relational workspace for the whole company, with AI agents that run on your own key. It's fully open source (MIT) — clone it, self-host it, own your data. The marketing post studio (pixel-faithful previews + client review links) and the skills-and-personality ATS are the parts people don't expect in an "all-in-one." Happy to answer anything!

### X / Twitter launch thread
1. We just open-sourced RunButter — the company OS.\n\nSales, finance, marketing, projects & hiring in ONE relational workspace. Plus AI agents that run on your own key (no token bill).\n\nMIT licensed. 🧵
2. The problem: you run your company across 5 tools that don't talk. CRM here, invoices there, a social scheduler, a project board, an ATS. Integrations rot. Data is scattered.\n\nRunButter makes a company, a deal, an invoice, a campaign and a candidate the SAME connected records.
3. AI agents, done right:\n• bring your own Claude/GPT/Gemini key → no per-token markup\n• scope which tools + objects each agent can touch\n• it PROPOSES writes for your approval by default\n• or runs autonomously within a step limit\n• every run is logged
4. The same governed tools power the UI, a REST API, and a native MCP server. Point Claude Desktop or Cursor at your workspace and let it read/write through the exact same tenancy-safe endpoints. Your users can be humans OR agents.
5. Marketing teams: compose a post, preview it pixel-faithfully on IG/FB/X/LinkedIn, drop Figma-style pinned comments, and send a client review link they can approve without an account.
6. Hiring: a real ATS with skills + Big-5 personality matching, a Talent Treasury to mine your whole pool, a team-fit simulator, and résumé search that runs in Postgres (zero AI cost).
7. Built on native Postgres, cookieless first-party analytics, GDPR controls, encrypted BYO keys, MIT license. Free hosted plan or self-host in minutes.\n\n⭐ github.com/RunButter/runbutter\n🧈 runbutter.app

### LinkedIn post
> We open-sourced RunButter — an all-in-one company OS.
>
> Running a company across a CRM, an accounting tool, a social scheduler, a project board and an ATS means five subscriptions that never share data. RunButter puts them on one relational core, so your deal knows its company, your invoice knows its client, and your candidate becomes a team member.
>
> What makes it different:
> • AI agents that run on your own API key — no per-token markup — and propose changes for approval before they act
> • The same governed tools behind the UI, a REST API, and a native MCP server (so Claude/Cursor can drive it too)
> • A marketing studio with pixel-faithful previews + client review links
> • A real ATS with skills + personality matching
> • MIT licensed, self-hostable, cookieless analytics, GDPR built in
>
> Free plan or clone the repo 👉 runbutter.app

### Short feature tweets (rotate these)
- "Convert an accepted quote into a branded PDF invoice in one click — then watch the bank ledger auto-reconcile the payment to it. Same workspace, zero glue. 🧈"
- "Your marketing team can drop Figma-style comments on a social post mockup, then send the client a review link they approve without an account. That's coordination."
- "Hire by skills AND personality: Big-5 + work-style assessment, neuro-profile fit %, and a Talent Treasury to mine your whole candidate pool."
- "AI agents on your OWN key = no per-token markup. Scope their tools, approve their writes, or let trusted ones run. Every action logged."
- "One MCP endpoint. Point Claude Desktop at your workspace and say 'add ACME and log a €40k deal.' It happens through the same verified tools the app uses."
- "Résumé search that costs nothing per query — it's Postgres full-text search, not an LLM. Cheap by design."
- "Cookieless, first-party web analytics built into your workspace. No cookie banner, no third-party trackers."

### Show HN
- **Title:** Show HN: RunButter – open-source company OS with governed AI agents (MIT)
- **Blurb:** One relational workspace for sales, finance, marketing, projects and hiring. AI agents run on your own key (no token markup) and act through the same verified tools exposed via REST + a native MCP server. Postgres core, Next.js, Supabase, Privy. Self-hostable. Feedback welcome.

---

## 8. Taglines & headline variants (bank)
- Run your whole company, smooth as butter.
- The open-source company OS.
- Five tools, one workspace, zero glue.
- AI agents on your own key. No token bill.
- One core for sales, finance, marketing, projects and people.
- Your company, running smooth.
- Where your company runs — and your agents work.

---

## 9. Pricing & business model

**MIT, and self-hosting gets everything.** We sell the hosted service — managed infra, updates,
support — not a crippled build. Gating governs runbutter.app only.

**Per seat, because a company OS is used by the whole company.** A flat per-company price charges a
30-person customer the same as a 3-person one.

| Plan | Price | Seats / records | What unlocks |
|---|---|---|---|
| **Free** | $0 | 2 seats · 500 records | The relational core: sales, finance, projects, hiring, docs |
| **Team** | **$15** /seat/mo | unlimited seats · 25,000 records | Automations & webhooks, branding, e-sign, post studio, short links, forms, web analytics |
| **Business** | **$39** /seat/mo | unlimited | **AI agents**, **REST API + MCP**, scheduled reports, advanced analytics & attribution, GDPR controls |
| **Enterprise** | Custom | unlimited | SSO/SAML, audit log, dedicated support & SLA |

**What we never gate:** the relational core — companies, people, deals, invoices, projects, issues,
the pipeline, CSV export. That's the first impression; charging for it would kill adoption.
**What we charge for:** scale (seats, records, volume), automation & AI, and governance.

*Why AI agents are a paid tier and not a cost centre:* they run on the customer's own API key, so
serving them costs us nothing per token — high perceived value, ~zero COGS.

## 10. Keep it honest (so the launch survives scrutiny)
- Say **"skills + Big-5 personality"**, not "cognitive/IQ testing" — the cognitive score isn't a real test.
- **KSeF** is export today; live submission is roadmap. Say "export compliant e-invoices."
- **Agents** are shipped and governed; the end-to-end tool-run has had limited live testing — demo "suggest/approve" mode first.
- **Plan limits** are enforced on ATS positions/candidates; enforcement across every new-platform object is still being tightened.
- Everything else above is built and demoable. Lead with the marketing studio, the ATS, and the agent governance model — those are the "wait, it does that?" moments.
