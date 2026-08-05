# Custom objects

The built-ins cover what every business has. Custom objects cover what *yours*
has — vehicles, patients, job sites, cohorts, work orders — without forking
anything.

**Settings → Objects.**

## Three ways to get one

1. **Describe your business.** "We're a haulage firm with 12 vans and 14
   drivers" produces a plan of objects and fields. **The plan is data and
   creating is a separate act**: the route returns a blueprint and writes
   nothing, and applying it loops the same `save_custom_object` /
   `save_custom_field` calls the manual builder uses. That separation is the
   security model — the description is untrusted and so is anything a model does
   with it, so the reply is re-validated against the same whitelist SQL
   enforces and then shown to a person. A prompt injection's best outcome is a
   silly plan somebody declines. Needs an AI key.
2. **Start from a trade.** Ten templates — transport, clinic, manufacturing,
   agency, property, construction, retail, training, charity, field service.
   They work with no AI key, on the free plan, identically every time, and they
   are also the few-shot examples the model is shown, so the two halves cannot
   drift.
3. **Add one by hand.** Name it, pick an icon, add fields.

## Field types

`text` · `long_text` · `number` · `currency` · `date` · `checkbox` ·
`select` (with options) · `email` · `url` · `phone` · `relation`

A `relation` points at another object — built-in or custom — by slug. The value
is stored as an id and **resolved to a name in SQL**, so a table, a CSV export
and an agent all read "Northwind Freight" rather than a uuid.

Exactly one field is **primary**: the one the record is called by, and the one
shown in every picker.

## What a template never does

Recreate a built-in. None of them adds a "Customer" or an "Invoice" — companies,
people, invoices, expenses and projects already exist and already talk to the
ledger, the pipeline and the agents. A template adds only what that trade has
that a general business does not, and links to the built-ins with `relation`
fields. `reserved_object_slug` refuses a built-in name at creation, so a
collision is impossible rather than merely lost.

## Why JSONB and not a table per object

A `SECURITY DEFINER` function running `CREATE TABLE` from user input is one
escaping mistake away from arbitrary DDL across every tenant. Rows live in
`custom_records.data jsonb`; one GIN index serves every workspace.

Values are coerced against the declared type on the way in, and coercion
**fails closed** — a bad number, date or select option is rejected, never stored
as text — because the CSV feed and the agents trust the declared type. URLs are
http/https only. Keys you did not declare are dropped, so a payload cannot widen
a row's shape.

## First-class, not bolted on

A custom object gets one branch in each of the five CRUD functions, at the end.
Because everything downstream reads those five, a custom object is immediately:

- a page with a table, filters and a form
- in the nav, with its own icon
- readable and writable by agents and MCP clients
- in the REST feed and the CSV feed
- syncable to Excel
- importable from CSV or a Google Sheet
- linkable from any other object

There is deliberately no parallel path for custom objects. If something works
for `companies` and not for `job_sites`, that is a bug in one of the five
functions rather than a missing feature.

## Deleting

Deleting a **field** leaves its values in `data` — re-adding the field brings
them back. Deleting an **object** cascades to its fields and rows, which is why
it is owner/admin only and asks twice.
