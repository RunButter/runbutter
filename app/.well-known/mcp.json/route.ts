import { NextResponse } from 'next/server';
import { TOOL_CATALOG, TOOL_GROUPS, WRITE_TOOLS } from '@/lib/agents/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /.well-known/mcp.json — the machine-readable "what is here".
 *
 * YC's request for startups asks for software agents can discover and start
 * using without a human clicking through a signup. We already had the hard
 * half: /api/mcp exposes one tenancy-safe executor over the same tools the
 * in-app agents use. What was missing was any way to FIND it — an agent had to
 * be told the endpoint existed and be handed a list of tools out of band.
 *
 * So this is the index. No credential is required to read it and none is
 * exposed by it: it is a public description of an API surface, exactly like the
 * OpenAPI document of a paid service. Everything it points at still requires a
 * scoped API key, and a read-scoped key still cannot write (0078).
 *
 * Generated from lib/agents/catalog.ts — the ONE tool list — rather than
 * hand-written. A hand-written copy is precisely how the builder's tool picker
 * fell sixteen tools behind the executor once already.
 */
export async function GET() {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');

  return NextResponse.json({
    name: 'RunButter',
    description:
      'An open-source company OS: sales, finance, marketing, projects and HR on one relational Postgres core. ' +
      'These tools read and write real business records — companies, people, deals, invoices, expenses, ' +
      'candidates and files — inside a single workspace.',
    documentation: base ? `${base}/settings/integrations` : undefined,
    license: 'MIT',
    servers: [{
      type: 'http',
      url: base ? `${base}/api/mcp` : '/api/mcp',
      transport: 'streamable-http',
      authentication: {
        type: 'bearer',
        // Said plainly because it is the thing an agent gets wrong: the key is
        // per workspace, is created by a human, and carries a scope that the
        // server enforces on every call.
        description:
          'An API key created in Settings → Integrations, sent as `Authorization: Bearer hb_…`. ' +
          'Keys are scoped: a read-scoped key is rejected on any write tool, and a key sent in a ' +
          'query string can never write whatever its scope.',
      },
    }],
    tools: TOOL_CATALOG.map((t) => ({
      name: t.name,
      title: t.label,
      group: t.group,
      // The single most useful field for an agent deciding whether it may
      // proceed unattended: a write tool from a `suggest` agent produces a
      // proposal a human has to approve, not an effect.
      write: Boolean(t.write),
    })),
    toolGroups: TOOL_GROUPS,
    writeTools: WRITE_TOOLS,
    notes: [
      'Tenancy is enforced in SQL, not in the tool layer. A key can only ever reach its own workspace.',
      'Agents in this product have three autonomy levels; a suggest-mode agent proposes writes for human approval.',
      'add_record_note requires a checkable `source` and has no confidence field — record observed facts, never guesses.',
      'screen_sanctions returns status "no_data" when no list has been imported. That is not "clear".',
    ],
  }, {
    // Cacheable: it changes only when the tool catalogue does, and an agent
    // discovering the surface should not be paying for a cold render.
    headers: { 'cache-control': 'public, max-age=300, s-maxage=3600' },
  });
}
