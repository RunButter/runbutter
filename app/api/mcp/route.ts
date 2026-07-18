import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createAdminClient } from '@/lib/supabase';
import { readJsonCapped, rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { TOOLS as WORKSPACE_TOOLS, callTool, type ToolCtx } from '@/lib/agents/tools';

// MCP advertises the shared workspace tools (JSON-schema shape).
const TOOLS = WORKSPACE_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * MCP server (Model Context Protocol, Streamable HTTP transport).
 * One endpoint — POST /api/mcp — speaking JSON-RPC 2.0, so Claude (Desktop /
 * Code / API), Cursor, and any MCP client can read + write the workspace.
 * Auth: the same workspace API keys as /api/v1 (Authorization: Bearer hb_...).
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

async function auth(req: Request): Promise<ToolCtx | null> {
  const header = req.headers.get('authorization') || '';
  const key = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!key) return null;
  const hash = createHash('sha256').update(key).digest('hex');
  const admin = createAdminClient();
  const { data } = await admin.rpc('resolve_api_key', { p_hash: hash });
  if (!data) return null;
  return { admin, workspace: (data as any).workspace_id, privy: (data as any).owner_privy };
}

const rpcResult = (id: any, result: any) => NextResponse.json({ jsonrpc: '2.0', id, result });
const rpcError = (id: any, code: number, message: string, status = 200) =>
  NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status });

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
    return rpcResult(id, {
      protocolVersion: params?.protocolVersion || '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'runbutter', version: '1.0.0' },
      instructions: 'RunButter business workspace. Use list_objects to discover record types, then list/search/get/create/update_record. Auth is per-workspace via the API key.',
    });
  }
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') return rpcResult(id, { tools: TOOLS });

  if (method === 'tools/call') {
    const ctx = await auth(req);
    if (!ctx) return rpcError(id, -32001, 'Invalid or missing API key (Authorization: Bearer hb_...)', 401);
    try {
      const out = await callTool(ctx, params?.name, params?.arguments || {});
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
    } catch (e: any) {
      return rpcResult(id, { content: [{ type: 'text', text: `Error: ${e?.message || 'tool failed'}` }], isError: true });
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

// Server-initiated SSE streams are optional in the spec — decline politely.
export async function GET() {
  return new NextResponse('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
}
