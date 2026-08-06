# RunButter — Agent Plugin

An [Agent Plugin](https://agent-plugins.org) (specification **1.0.0**) that gives
an agent a whole company to work in: sales pipeline, invoices and bank ledger,
uploaded contracts, hiring, and compliance checks — all on one relational
Postgres core.

Agent Plugins is the vendor-neutral packaging standard whose Technical Steering
Committee is Amazon, Cursor, Microsoft, OpenAI and Vercel. Any client that
supports it can load this directory.

```text
plugin/
├── plugin.json     manifest
├── mcp.json        the RunButter MCP server (Streamable HTTP)
└── skills/         six skills, one directory each
```

## Install

Point your client at this directory, or at the `plugin/` folder of a clone of
[RunButter](https://github.com/RunButter/runbutter). Skills are discovered from
`skills/`; MCP servers from `mcp.json`.

## The API key is not in here, and cannot be

`mcp.json` names the endpoint:

```
https://runbutter.app/api/mcp
```

It carries **no `Authorization` header**, and that is not an oversight. The
specification (§7.2) states that header values are *"visible package data, not a
portable secret mechanism"*, that plugins *"MUST NOT embed credentials"*, and
that clients *"MUST NOT perform placeholder or environment-variable expansion"*
in URLs or headers. Agent Plugins v1 also defines no OAuth or credential
reference fields at all.

So authorization is your client's job. Create a key in RunButter under
**Settings → Integrations → API keys** and add it wherever your client keeps
credentials.

Scope it deliberately. A `read` key covers everything the skills below only
read; give a key write scope only if you intend the agent to change records.
Self-hosting? Change the URL to your own instance.

## The skills

| Skill | For |
| --- | --- |
| `chase-overdue-invoices` | Aged receivables, who owes what, drafting chasers |
| `pipeline-review` | Stalled deals, forecast sanity, what to work on |
| `screen-a-new-client` | Sanctions, registry and IBAN checks before invoicing |
| `reconcile-the-ledger` | Matching bank transactions to invoices and expenses |
| `contract-audit` | Clause search across uploaded documents, joined to finance |
| `weekly-brief` | A short Monday briefing from live data |

They are opinionated on purpose. Each one says what to check *before* acting,
what never to state without evidence, and where to stop and hand back to a
person — because the failure mode of an agent with real financial tools is not
being unhelpful, it is being confidently wrong about money.

## Contributing a skill

Add a directory under `skills/`, write `SKILL.md` with `name` and `description`
frontmatter, and run:

```bash
npm run check:plugin
```

The frontmatter `name` **must** equal the directory name. When it does not, a
conforming client skips the skill without saying why — which is why that rule is
checked in CI rather than trusted.

## Licence

MIT, like RunButter.
