# Support, bugs and security

## Reporting a bug

Open an issue: **[github.com/RunButter/runbutter/issues](https://github.com/RunButter/runbutter/issues)**

What makes a report actionable, in rough order of usefulness:

1. **What you did, what happened, what you expected.** Three sentences beats
   three paragraphs.
2. **How you run it** — Docker, Supabase + Node, or the hosted app — and the
   version (Settings → Updates, or `git rev-parse --short HEAD`).
3. **The exact error.** Browser console for a screen, server logs for a 500,
   the SQL error for a migration. A screenshot of a stack trace is fine.
4. **Whether it reproduces on a fresh workspace.** This one saves the most time,
   because it separates "the feature is broken" from "this workspace's data is
   unusual".

The issue form asks for these. Please don't paste keys, tokens or a real
customer's data into an issue — redact them; nobody needs them to help.

## Before you file

- **Migration failed?** Check the port: the session pooler is 5432, the
  transaction pooler is 6543, and migrations need the former. This is the most
  common failure by a wide margin.
- **Feature does nothing?** Most features that "do nothing" are waiting on a
  cron job or an environment variable. [Configuration](./configuration.md) says
  which, per feature.
- **Nothing emails?** No `RESEND_API_KEY`, or no cron on the sender.
- **`npm run migrate:status`** tells you whether your schema is actually current.

## Security issues

**Do not open a public issue.** See [SECURITY.md](../SECURITY.md) for the
private disclosure path.

Worth reporting even if you are unsure: anything that lets one workspace read or
write another's data, anything that lets an unauthenticated caller reach an
authenticated function, and anything that would put a secret into a place a
non-admin can read — an export, a log line, an agent transcript.

## Asking a question

**[GitHub Discussions](https://github.com/RunButter/runbutter/discussions)** for
"how do I…", "should this work like this", and ideas. Issues are for things that
are broken.

## Requesting a feature

Open an issue and say what you are trying to do, not only what you want built.
The most useful feature requests here have described a business — "we run a
driving school and need X" — and ended up as a workspace template or a change to
one of the five CRUD functions rather than the specific thing that was asked for.

Two things get declined consistently, so they are worth stating up front:

- **Anything that adds a per-call cost to every install.** Metered APIs for
  search, enrichment, OCR or screening. The alternative is nearly always public
  data plus local computation, which is how company lookup, sanctions screening,
  IBAN validation and the PDF tools work.
- **Anything that copies code from an AGPL or GPL project.** listmonk, Mautic
  and Postiz are all fine to read as feature specs and impossible to borrow
  from — this project is MIT and staying that way.
