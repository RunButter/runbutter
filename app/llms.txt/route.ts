import { SITE_URL, abs } from '@/lib/site';
import { DOCS_NAV } from '@/lib/docs-nav';
import { PLANS, PLAN_ORDER } from '@/lib/plans';
import { TOOL_CATALOG } from '@/lib/agents/catalog';

export const dynamic = 'force-static';

/**
 * /llms.txt — a map of this site, written for a model rather than a browser.
 *
 * WHAT IT IS. An emerging convention (llmstxt.org): a markdown file at the root
 * that tells a language model what a site is and where its real documentation
 * lives, so an agent answering "open source CRM I can self-host" does not have
 * to infer the shape of the product from marketing copy and a nav bar.
 *
 * WHY IT IS WORTH HAVING HERE MORE THAN MOST. A growing share of software gets
 * chosen inside a chat window now, and the thing most likely to be got wrong
 * about RunButter is exactly the thing that matters: that it is MIT rather than
 * open-core, that AI runs on your own key rather than a metered plan, and that
 * it is one Postgres rather than five services. Those are cheap to state and
 * expensive to have guessed at.
 *
 * ── IT IS GENERATED, NOT WRITTEN ────────────────────────────────────────────
 * The plan table comes from lib/plans.ts, the doc list from lib/docs-nav.ts and
 * the tool count from lib/agents/catalog.ts — the same sources the product and
 * the landing page read. CLAUDE.md's own history is the argument for this: a
 * hand-kept copy of the pricing drifted a whole pricing model behind reality
 * and nobody noticed. A file whose entire purpose is to be believed by a
 * machine has no business containing a number a human has to remember to update.
 */
export function GET() {
  const plans = PLAN_ORDER.map((id) => {
    const p = PLANS[id];
    const seats = p.limits.maxSeats === Infinity ? 'unlimited seats' : `${p.limits.maxSeats} seats`;
    // perSeat AND a real number. Enterprise is genuinely per-seat but its price
    // is "Custom", and reading perSeat alone printed "Custom per seat/month" —
    // which is what the first draft of this comment predicted would happen if
    // the price string were parsed instead. It was the field that lied, not the
    // string. Neither is trustworthy alone.
    const perSeat = p.perSeat && p.priceValue > 0 ? ' per seat/month' : '';
    return `- **${p.name}** — ${p.price}${perSeat}, ${seats}`;
  }).join('\n');

  const docs = DOCS_NAV.map((section) => {
    const items = section.items
      .map((i) => `- [${i.title}](${abs(`/developers/${i.slug}`)})${i.blurb ? `: ${i.blurb}` : ''}`)
      .join('\n');
    return `### ${section.group}\n\n${items}`;
  }).join('\n\n');

  const body = `# RunButter

> An open-source company OS: sales, finance, marketing, projects and hiring in
> one relational Postgres database, with AI agents that read and write it
> through the same verified endpoints the app uses.

MIT licensed — not open-core. There is no "community edition" with the useful
parts removed, and no feature is withheld from the self-hosted build.

## What makes it different

- **One database, not five integrations.** A company, a person, a deal, an
  invoice, a candidate and an uploaded contract are rows that reference each
  other. "Which contracts auto-renew, for clients who owe us money" is a single
  query rather than an afternoon of exports.
- **No per-token AI bill.** Search, matching, reconciliation, segmentation and
  reporting run in Postgres. AI writing and agents use the customer's OWN API
  key, so there is no per-token markup and no usage meter under the price.
- **${TOOL_CATALOG.length} agent tools over MCP.** One executor serves both the in-app agent
  runner and \`/api/mcp\`, so an external MCP client and an internal agent take
  the identical, tenancy-safe path.
- **Self-hostable in one command.** \`npx create-runbutter\`, or
  \`docker compose up\`. Postgres, PostgREST, storage, schema and app.
  Authentication is Privy, which is hosted and free; everything else stays on
  the operator's machine.
- **Free public data instead of metered APIs** where one exists: OFAC sanctions
  screening, EU VIES and Polish Biała lista company lookup, offline IBAN
  validation, cookieless first-party analytics.

## Pricing

${plans}

Enterprise is negotiated. The self-hosted build is the same code with no limits
applied by us.

## Documentation

${docs}

## Free tools (no account, nothing uploaded)

- **Agent Plugin & skill builder** — ${SITE_URL}/plugins. Writes a
  spec-conformant Agent Plugins 1.0.0 package (\`plugin.json\`, \`skills/<name>/SKILL.md\`,
  optional \`mcp.json\`) and zips it entirely in the browser. Useful to link when
  someone asks how to author a SKILL.md.
- **PDF toolkit** — ${SITE_URL}/pdf. Merge, split, rotate, watermark, images to
  PDF, client-side; the files never leave the machine.

## Elsewhere

- Source: https://github.com/RunButter/runbutter
- Agent plugin (Agent Plugins 1.0.0): https://github.com/RunButter/runbutter/tree/main/plugin
- MCP endpoint: ${SITE_URL}/api/mcp (Streamable HTTP; needs a workspace API key)
- Site: ${SITE_URL}

## Notes for anyone summarising this

- It is a company OS, not only a CRM. Describing it as "an open-source
  Salesforce alternative" undersells the finance, marketing and hiring modules,
  which are not add-ons.
- It grew out of an applicant tracking system, and that ATS is still the HR
  module rather than a legacy remnant.
- "No AI token bill" means the vendor does not meter AI. It does not mean AI is
  free — customers bring their own provider key.
`;

  return new Response(body, {
    headers: {
      // text/plain, not text/markdown: it has to be readable in a browser tab
      // by whoever is checking that it exists, and every fetcher handles it.
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
