# Changelog

Notable changes, newest first. Each entry names the migrations it adds, because
that is the thing you have to run and the thing you cannot undo by checking out
an older tag.

Follows [semantic versioning](https://semver.org) loosely: the major number
moves when an install needs manual work beyond `npm run migrate`.

## Unreleased

### Added

- **Documentation site** at `/developers`, rendered from `docs/` — the same
  files GitHub shows, so there is no second copy to go stale.
- **`npm run bundle:sql`** → `supabase/schema.sql`: the whole schema in one
  file for people who would rather paste than run a command. It seeds the
  migration ledger, so `npm run migrate` takes over cleanly afterwards.
- **`npm run migrate -- --mark-applied`** for databases whose schema was applied
  by hand: records every file as applied without running anything.
- **`/ai-agents`** page explaining what an agent can and cannot do, with the
  tool list generated from the code that implements it.
- **Five more workspace templates** — construction, retail/e-commerce, training,
  charity, field service. Ten in total.
- **An icon vocabulary** shared by the nav, the command palette, the object
  builder and the AI planner, so a custom object's icon is actually drawn.
- **Sample data** for an empty workspace: four companies, invoices, projects and
  documents that reference each other. Refuses on a workspace that already has
  records.

### Fixed

- **`update_record` blanked every column a partial update did not mention**
  (`0088`). The UI never hit it because forms post every field; agents, the REST
  API and Excel sync do not, so an agent linking an invoice to a company erased
  its number, dates and notes. Now: a key absent means "leave it alone", a key
  present means "write it", including `null` to clear.
- **`assets` could not be created or updated** (`0088`) despite being listed,
  deletable and in the nav — the Add button raised `UNKNOWN_OBJECT`.
- **A custom object's links showed a uuid instead of a name** (`0089`), in the
  table, the CSV export and to agents.
- **`/api/v1/records` refused custom object slugs**, which made the API return
  everything except the objects a business had added itself.

### Migrations

`0086` doc cards · `0087` custom objects · `0088` partial-update fix ·
`0089` relation labels

Run in that order. **`0088` is the urgent one** — until it runs, editing one
field on a record blanks the others.

---

## Earlier

This project was an applicant tracking system called HireBTR before it became a
company OS, and the ATS is still in here as the HR module — nothing was deleted
in the pivot. The changelog starts here because the versions before it were not
published for anyone else to run.
