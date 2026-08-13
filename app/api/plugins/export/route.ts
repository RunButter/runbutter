import { createAdminClient } from '@/lib/supabase';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { pluginSlug, type SkillSource } from '@/lib/plugins/agent-plugin';
import { PLATFORMS, platformById } from '@/lib/plugins/platforms';
import { zipSync } from '@/lib/plugins/zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/plugins/export  { privyUserId, workspaceId, skillIds?, includeMcp? }
 *   → a .zip that is a conformant Agent Plugins 1.0.0 package.
 *
 * The other half of the standard. `/api/skills/import` already READS SKILL.md
 * files out of a public repo; this writes a whole plugin out, so a workspace's
 * skills can be installed in Cursor, VS Code, Codex or anything else that
 * speaks the format — and published as a repo like any other plugin.
 *
 * NO CREDENTIAL GOES IN THE ZIP, and there is nowhere to put one. Spec §7.2:
 * header values are "visible package data, not a portable secret mechanism",
 * plugins "MUST NOT embed credentials", and clients "MUST NOT perform
 * placeholder or environment-variable expansion" in urls or headers. So the
 * mcp.json names the endpoint and the person adds their own key on the other
 * side. An export that shipped a working key would be a workspace credential in
 * a file people commit to git and paste into issues.
 *
 * Server-side rather than in the browser because the skills come from
 * `get_skills`, which is SECURITY DEFINER and only reachable as service_role —
 * the same reason every other read goes through a verified route.
 */

const MAX_SKILLS = 100;

export async function POST(req: Request) {
  const rl = rateLimit(`pluginexport:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { privyUserId, workspaceId, skillIds, includeMcp = true } = b || {};
  // The target layout. The in-app export always built the portable Agent Plugin
  // while the public builder at /plugins offered four; same skills, same
  // builder, different directory shape — so there was no reason for the one
  // inside the product to be the limited one. An unknown id falls back to the
  // portable format rather than failing: a bad value should not cost somebody
  // their export.
  const requested = String(b?.platform || 'agent-plugin');
  const platform = platformById(PLATFORMS.find((p) => p.id === requested)?.id ?? 'agent-plugin');
  if (!privyUserId || !workspaceId) return json({ error: 'Not signed in' }, 401);

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return json({ error: auth.error }, auth.status || 401);

  const admin = createAdminClient();

  // get_skills raises NOT_A_MEMBER itself, so this read IS the tenancy check —
  // there is no second place for that rule to be wrong.
  const { data: skills, error } = await admin.rpc('get_skills', {
    p_privy: privyUserId, p_workspace: workspaceId,
  });
  if (error) {
    const denied = /NOT_A_MEMBER/.test(error.message);
    return json({ error: denied ? 'You are not a member of that workspace.' : error.message }, denied ? 403 : 500);
  }

  const all: any[] = Array.isArray(skills) ? skills : [];
  const wanted = Array.isArray(skillIds) && skillIds.length
    ? all.filter((s) => skillIds.includes(s.id))
    : all;

  if (!wanted.length) {
    return json({ error: 'No skills to export. Add one in the Skills library first.' }, 400);
  }

  // Workspace name only for the plugin name — nothing else about the workspace
  // travels in the package.
  const { data: ws } = await admin.rpc('get_my_workspace', { p_privy: privyUserId });
  const rawName = (ws as any)?.name || 'workspace';
  const name = pluginSlug(`${rawName}-skills`);

  const sources: SkillSource[] = wanted.slice(0, MAX_SKILLS).map((s) => ({
    name: s.name || 'skill',
    description: s.description || '',
    instructions: s.instructions || '',
    suggested_tools: Array.isArray(s.suggested_tools) ? s.suggested_tools : [],
  }));

  const site = (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || '').replace(/\/+$/, '');
  const origin = site || new URL(req.url).origin;

  const files = platform.build({
    manifest: {
      name,
      version: '0.1.0',
      description: `Agent skills exported from the ${rawName} workspace on RunButter.`,
      homepage: origin,
      license: 'MIT',
      keywords: ['runbutter', 'skills'],
    },
    skills: sources,
    mcpUrl: includeMcp ? `${origin}/api/mcp` : undefined,
  });
  // Appended rather than passed in: `BuildInput` is deliberately narrower than
  // `buildPlugin`'s options, because a platform decides its own layout and an
  // `extraFiles` escape hatch is how a caller starts putting files where a
  // layout did not intend them. A README at the archive root is safe in all
  // four, so it is added here where that judgement is visible.
  files.push({ path: 'README.md', content: readme(name, origin, sources.length, includeMcp) });

  const zip = zipSync(files);
  // A Uint8Array view can be a window onto a larger buffer; slicing to its own
  // ArrayBuffer is what stops a Response sending trailing bytes that are not
  // part of the archive.
  const body = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${name}.zip"`,
      'content-length': String(zip.byteLength),
      'cache-control': 'no-store',
    },
  });
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function readme(name: string, origin: string, count: number, mcp: boolean): string {
  return `# ${name}

${count} agent skill${count === 1 ? '' : 's'} exported from RunButter, packaged as an
[Agent Plugin](https://agent-plugins.org) (specification 1.0.0).

## Install

Point any client that supports Agent Plugins at this directory. Skills are
discovered from \`skills/\`, and MCP servers from \`mcp.json\`.

${mcp ? `## Connecting the MCP server

\`mcp.json\` names the RunButter MCP endpoint:

    ${origin}/api/mcp

**It does not include an API key, and it cannot.** The Agent Plugins
specification is explicit that header values are visible package data and that
plugins must not embed credentials (§7.2), and clients are forbidden from
expanding environment variables in URLs or headers. Add your own key in your
client's own credential store, or paste it into your local copy of this file —
somewhere that is not committed.

Create a key in RunButter under **Settings → Integrations → API keys**. A
\`read\` key is enough for anything that only reads; give a key write scope only
if you intend the agent to change records.
` : ''}
## Licence

The skills are yours. This package is MIT licensed like RunButter itself.
`;
}
