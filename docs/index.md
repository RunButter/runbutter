# RunButter documentation

RunButter is an open-source **company OS**: sales, finance, marketing, projects
and hiring on one relational Postgres core, with AI agents that work on the same
records your team does. MIT licensed, self-hostable, no per-token AI bill.

## Start here

| I want to… | Read |
|---|---|
| Run it on my own machine or server | [Install](./install.md) |
| Know what every environment variable does | [Configuration](./configuration.md) |
| Move to a newer version safely | [Updating](./updating.md) |
| Understand how it is put together | [Architecture](./architecture.md) |
| Give an AI agent access to my workspace | [Agents](./agents.md) |
| Call it from my own code | [REST API & MCP](./api.md) |
| Track something the built-ins don't cover | [Custom objects](./custom-objects.md) |
| Report a bug, or a security issue | [Support](./support.md) |
| Send a pull request | [Contributing](./contributing.md) |
| See what's next | [Roadmap](./roadmap.md) |

## The shape of it in one paragraph

Everything is one Postgres database. A company, a person, a deal, an invoice, a
campaign, a project and a candidate are rows that reference each other, which is
why "which contracts auto-renew, for clients who owe us money" is a query rather
than an afternoon. The browser never talks to the database directly: every
authenticated read and write goes through `/api/rpc`, which verifies a Privy JWT
server-side and calls a `SECURITY DEFINER` function that derives your workspace
in SQL. Agents and external MCP clients go through the same functions, so they
inherit the same tenancy rules rather than being trusted separately.

## What is not self-hosted

**Authentication is [Privy](https://privy.io)** and it is a hosted service. It
is free, it takes two minutes, and there is no way around it in this stack — so
it is said here rather than discovered halfway through an install. Everything
else — your data, your files, your API, your AI keys — stays where you put it.

Every other integration is optional and degrades honestly: without a Resend key
nothing emails and the UI says so; without Stripe the plan page renders and
checkout does nothing; without an AI key the agent screens explain what is
missing rather than failing.
