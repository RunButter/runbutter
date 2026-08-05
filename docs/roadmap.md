# Roadmap

What is shipped, what is being worked on, and what has been deliberately
declined. Kept honest: a line moves to "shipped" when it works, not when it is
started.

## Shipped

**The core** — Sales (companies, people, pipeline, offers → invoices, products),
Finance (invoices, expenses, bank ledger with rule-based reconciliation, PDF
documents, e-signatures, KSeF), Marketing (campaigns, newsletters, live
segments, lead scoring, drip sequences, forms, short links, cookieless
analytics, social publishing), Projects (projects, issues, board, roadmap, mind
maps), HR (the full ATS: positions, pipeline, Big-5 and work-style assessments,
interviews, onboarding), Docs & Files (four doc kinds, browser-side export,
text extraction and full-text search), Chat, Automations.

**Agentic** — 26 tools behind one executor shared by in-app agents and MCP,
reusable skills, notes written back onto records, scheduled unattended runs, and
a gallery of eight prebuilt agents.

**A general tool, not five verticals** — custom objects (JSONB, no DDL), the
workspace builder that turns a description of a business into a reviewable plan,
and ten trade templates.

**Self-hosting** — `npm run migrate`, a one-file `supabase/schema.sql`,
`docker compose up`, generated keys.

## Next

- **Packaging for people who are not us.** A hosted demo anyone can click into
  without signing up; screen recordings in the README; a first-run experience
  that explains the product without a manual.
- **More trades.** Ten templates is a start, not a library. Hospitality,
  veterinary, legal, events, gyms are all obvious gaps. These are cheap to add
  and someone in the trade always improves them — see
  [Contributing](./contributing.md).
- **Reporting.** Scheduled PDF reports exist; a builder for them does not.
- **Mobile.** Everything is responsive; nothing is designed phone-first yet.

## Considered and declined

Kept here because "why doesn't it do X" deserves an answer that is not silence:

- **Per-token AI billing / platform AI keys.** AI runs on your key. A platform
  key means a platform bill, a platform rate limit and a platform blast radius.
- **Metered third-party APIs** for search, enrichment, OCR or sanctions
  screening. Public data plus local computation, every time.
- **A formula engine in `sheet` docs.** A sheet is a markdown table on purpose.
  Live data in a real spreadsheet is what the Excel sync is for, and a
  half-built formula engine here would be worse than either.
- **Two-way delete in the Excel sync.** A filter, a sort and a cleared row are
  indistinguishable from a deletion over Microsoft's API. Deleting stays
  something you do deliberately, in the app.
- **Realtime chat over Supabase Realtime.** It would need anon-key RLS policies
  on `messages`, which would undo the `/api/rpc` proxy. If polling ever needs
  replacing, the answer is an SSE endpoint, not open RLS.
- **Down-migrations.** One that drops a column is a data-loss button disguised
  as an undo; one that does not is theatre. Restore from a backup and check out
  the matching tag.
- **A confidence score on agent notes.** A number beside a guess is how a
  hallucination gets trusted. Notes carry a checkable source instead.

## Influencing it

The roadmap follows what people actually run into. An issue that describes a
business and what it cannot do today is worth more than a feature name — several
of the items above started that way.
