import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createAdminClient } from '@/lib/supabase';
import { checkFeature, planDeniedBody } from '@/lib/plans-server';
import { readJsonCapped, rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { hashToken, wwwAuthenticate } from '@/lib/oauth/server';
import { TOOLS as WORKSPACE_TOOLS, callTool, type ToolCtx } from '@/lib/agents/tools';
import { isWriteTool } from '@/lib/agents/catalog';

// MCP advertises the shared workspace tools (JSON-schema shape).
const TOOLS = WORKSPACE_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
const READ_ONLY_TOOLS = TOOLS.filter((t) => !isWriteTool(t.name));

/** Newest first. `initialize` agrees to the client's version only if it is here. */
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MCP server (Model Context Protocol, Streamable HTTP transport).
 * One endpoint — POST /api/mcp — speaking JSON-RPC 2.0, so Claude (Desktop /
 * Code / API), Cursor, and any MCP client can read + write the workspace.
 * Auth: EITHER a workspace API key (Authorization: Bearer hb_…, same as
 * /api/v1) OR an OAuth 2.1 access token (0099). Both resolve to the same
 * shape — a workspace, an owner, a scope — so nothing below this line knows
 * which was used.
 *
 * The API key is for clients that read a config file: Claude Code, Claude
 * Desktop, Cursor. OAuth is for claude.ai's connector flow, which takes a URL
 * and sends the person through a login and has nowhere to paste a key. A 401
 * carries `WWW-Authenticate` pointing at the protected-resource metadata,
 * which is the whole discovery mechanism — without it a connector that gets a
 * 401 has no idea where to send the user.
 *
 * Dependency-free by design: we answer each POST with a single JSON body,
 * which the spec allows in place of an SSE stream; GET (server-initiated
 * streams) is optional and answered 405. Stateless — no session ids needed.
 *
 * Client config (e.g. .mcp.json):
 *   { "mcpServers": { "runbutter": {
 *       "type": "http", "url": "https://runbutter.app/api/mcp",
 *       "headers": { "Authorization": "Bearer hb_..." } } } }
 */

async function auth(req: Request): Promise<(ToolCtx & { scope: 'full' | 'read' }) | null> {
  const header = req.headers.get('authorization') || '';
  const key = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!key) return null;
  const hash = createHash('sha256').update(key).digest('hex');
  const admin = createAdminClient();

  // OAuth first when the prefix says so, API key otherwise. Chosen by PREFIX
  // rather than by trying both, so a failed lookup is one query and a token
  // from one system can never be resolved by the other's table.
  let data: any = null;
  if (key.startsWith('rbt_')) {
    const r = await admin.rpc('oauth_resolve_token', { p_hash: hashToken(key) });
    data = r.data;
  } else {
    const r = await admin.rpc('resolve_api_key', { p_hash: hash });
    data = r.data;
  }
  if (!data) return null;
  // A key's scope (0078) has to hold here too — otherwise a read-only key that
  // cannot write over /api/v1 could simply write over MCP instead.
  const scope = ((data as any).scope === 'read' ? 'read' : 'full') as 'full' | 'read';
  return { admin, workspace: (data as any).workspace_id, privy: (data as any).owner_privy, scope };
}

const rpcResult = (id: any, result: any) => NextResponse.json({ jsonrpc: '2.0', id, result });
const rpcError = (id: any, code: number, message: string, status = 200, headers?: Record<string, string>) =>
  NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status, headers });

export async function POST(req: Request) {
  const rl = rateLimit(`mcp:${clientIp(req)}`, 120);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  const capped = await readJsonCapped(req, 256 * 1024);
  if (!capped.ok) return rpcError(null, -32700, capped.error, capped.status);
  const msg: any = capped.data;
  if (Array.isArray(msg)) return rpcError(null, -32600, 'Batch requests are not supported', 400);
  const { id, method, params } = msg || {};

  // Notifications carry no id and expect no body.
  if (id === undefined || id === null) return new NextResponse(null, { status: 202 });

  if (method === 'initialize') {
    // Return a version WE implement, not whatever the client asked for. Echoing
    // the request back meant a client sending `2099-01-01` was told we spoke it,
    // and the negotiation the field exists for never happened. If the client
    // names a version we support, agree to it; otherwise answer with ours and
    // let the client decide.
    const asked = String(params?.protocolVersion || '');
    const version = SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0];
    return rpcResult(id, {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'runbutter', version: '1.0.0' },
      instructions: 'RunButter business workspace. Use list_objects to discover record types, then list/search/get/create/update_record. Auth is per-workspace via the API key.',
    });
  }
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') {
    // Advertise only what the key can actually do — a client that never sees a
    // write tool won't burn a turn discovering it is forbidden. Unauthenticated
    // discovery still shows the full catalogue, as before.
    const listCtx = await auth(req);
    return rpcResult(id, { tools: listCtx?.scope === 'read' ? READ_ONLY_TOOLS : TOOLS });
  }

  if (method === 'tools/call') {
    const ctx = await auth(req);
    if (!ctx) {
      return rpcError(id, -32001,
        'Not authenticated. Use an OAuth access token, or a workspace API key (Authorization: Bearer hb_…).',
        401, { 'WWW-Authenticate': wwwAuthenticate('invalid_token', 'A valid access token is required') });
    }
    // The gate sits on the CALL, not on discovery. `tools/list` stays open so a
    // client can still describe the product accurately; refusing to list would
    // read as a broken server rather than an unpaid feature.
    const denied = await checkFeature(ctx.workspace, 'apiAccess');
    if (denied) return rpcError(id, -32003, planDeniedBody(denied).error, 402);
    if (ctx.scope === 'read' && isWriteTool(params?.name)) {
      return rpcError(id, -32002, `This API key is read-only, so "${params?.name}" is not permitted. Create a full-access key to write.`, 403);
    }
    try {
      const out = await callTool(ctx, params?.name, params?.arguments || {});
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
    } catch (e: any) {
      return rpcResult(id, { content: [{ type: 'text', text: `Error: ${e?.message || 'tool failed'}` }], isError: true });
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

// Server-initiated SSE streams are optional in the spec — decline politely, but
// still say where to authenticate: some connectors probe with GET first, and a
// bare 405 tells them nothing about the OAuth server.
export async function GET() {
  return new NextResponse('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST', 'WWW-Authenticate': wwwAuthenticate() },
  });
}
