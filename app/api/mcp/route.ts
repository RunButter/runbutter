import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createAdminClient } from '@/lib/supabase';
import { runDispatcher } from '@/lib/automations/dispatcher';

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
 *   { "mcpServers": { "hirebtr": {
 *       "type": "http", "url": "https://hirebtr.com/api/mcp",
 *       "headers": { "Authorization": "Bearer hb_..." } } } }
 */

const OBJECTS: Record<string, string> = {
  companies: 'CRM organizations (name, domain, industry, employee_count, tax_id, address, country)',
  people: 'Contacts / candidates (first_name, last_name, email, phone, title, source)',
  invoices: 'Invoices & bills (number, organization_id, direction income|cost, amount, status draft|sent|paid|overdue, issued_at, due_at, notes)',
  offers: 'Sales offers / quotes (same fields as invoices)',
  expenses: 'Expenses (vendor, category, amount, status pending|approved|paid, spent_at, notes)',
  transactions: 'Bank ledger (txn_date, description, amount signed +in/-out, category, method, status posted|pending|excluded)',
  products: 'Products / services (name, sku, unit_price, unit, category, description)',
  campaigns: 'Marketing campaigns (name, channel, status, budget, spend, leads, starts_on, ends_on)',
  projects: 'Projects (name, identifier, status, description)',
  issues: 'Project issues/tasks (title, status backlog|todo|in_progress|done|cancelled, priority, due_date, description)',
  assets: 'Company equipment (name, category laptop|monitor|phone|license|other, serial_number, status available|assigned|repair|retired, assigned_to_person_id)',
};

const TOOLS = [
  { name: 'list_objects', description: 'List the record types available in this HireBTR workspace and their fields.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_records', description: 'List records of an object type (most recent first).', inputSchema: { type: 'object', properties: { object: { type: 'string', enum: Object.keys(OBJECTS) } }, required: ['object'] } },
  { name: 'search_records', description: 'Search records of an object type by a text query (matched across all fields).', inputSchema: { type: 'object', properties: { object: { type: 'string', enum: Object.keys(OBJECTS) }, query: { type: 'string' } }, required: ['object', 'query'] } },
  { name: 'get_record', description: 'Fetch one record by id.', inputSchema: { type: 'object', properties: { object: { type: 'string', enum: Object.keys(OBJECTS) }, id: { type: 'string' } }, required: ['object', 'id'] } },
  { name: 'create_record', description: 'Create a record. `data` uses the object\'s fields (see list_objects).', inputSchema: { type: 'object', properties: { object: { type: 'string', enum: Object.keys(OBJECTS) }, data: { type: 'object' } }, required: ['object', 'data'] } },
  { name: 'update_record', description: 'Update fields on an existing record.', inputSchema: { type: 'object', properties: { object: { type: 'string', enum: Object.keys(OBJECTS) }, id: { type: 'string' }, data: { type: 'object' } }, required: ['object', 'id', 'data'] } },
];

interface Ctx { admin: any; workspace: string; privy: string }

async function auth(req: Request): Promise<Ctx | null> {
  const header = req.headers.get('authorization') || '';
  const key = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!key) return null;
  const hash = createHash('sha256').update(key).digest('hex');
  const admin = createAdminClient();
  const { data } = await admin.rpc('resolve_api_key', { p_hash: hash });
  if (!data) return null;
  return { admin, workspace: (data as any).workspace_id, privy: (data as any).owner_privy };
}

const rpcObject = (o: string) => (o === 'offers' ? 'invoices' : o);

async function listRows(ctx: Ctx, object: string): Promise<any[]> {
  const { data, error } = await ctx.admin.rpc('list_records', { p_privy: ctx.privy, p_workspace: ctx.workspace, p_object: rpcObject(object) });
  if (error) throw new Error(error.message);
  let rows = (data as any[]) || [];
  if (object === 'offers') rows = rows.filter((r) => r.kind === 'offer');
  else if (object === 'invoices') rows = rows.filter((r) => r.kind !== 'offer');
  return rows;
}

async function callTool(ctx: Ctx, name: string, args: any): Promise<any> {
  const object = args?.object as string;
  if (name !== 'list_objects' && !OBJECTS[object]) throw new Error(`Unknown object "${object}". Use one of: ${Object.keys(OBJECTS).join(', ')}`);

  switch (name) {
    case 'list_objects':
      return Object.entries(OBJECTS).map(([k, v]) => ({ object: k, fields: v }));
    case 'list_records':
      return (await listRows(ctx, object)).slice(0, 100);
    case 'search_records': {
      const q = String(args?.query || '').toLowerCase();
      return (await listRows(ctx, object)).filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q))).slice(0, 50);
    }
    case 'get_record': {
      const { data, error } = await ctx.admin.rpc('get_record', { p_privy: ctx.privy, p_object: rpcObject(object), p_id: args.id });
      if (error) throw new Error(error.message);
      return data ?? { error: 'Not found' };
    }
    case 'create_record': {
      const payload = object === 'offers' ? { ...(args.data || {}), kind: 'offer' } : (args.data || {});
      const { data, error } = await ctx.admin.rpc('create_record', { p_privy: ctx.privy, p_workspace: ctx.workspace, p_object: rpcObject(object), p_data: payload });
      if (error) throw new Error(error.message);
      runDispatcher(ctx.admin, 10).catch(() => {});
      return { ok: true, id: data };
    }
    case 'update_record': {
      const { error } = await ctx.admin.rpc('update_record', { p_privy: ctx.privy, p_object: rpcObject(object), p_id: args.id, p_data: args.data || {} });
      if (error) throw new Error(error.message);
      runDispatcher(ctx.admin, 10).catch(() => {});
      return { ok: true, id: args.id };
    }
    default:
      throw new Error(`Unknown tool "${name}"`);
  }
}

const rpcResult = (id: any, result: any) => NextResponse.json({ jsonrpc: '2.0', id, result });
const rpcError = (id: any, code: number, message: string, status = 200) =>
  NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, { status });

export async function POST(req: Request) {
  let msg: any;
  try { msg = await req.json(); } catch { return rpcError(null, -32700, 'Parse error', 400); }
  if (Array.isArray(msg)) return rpcError(null, -32600, 'Batch requests are not supported', 400);
  const { id, method, params } = msg || {};

  // Notifications carry no id and expect no body.
  if (id === undefined || id === null) return new NextResponse(null, { status: 202 });

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: params?.protocolVersion || '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'hirebtr', version: '1.0.0' },
      instructions: 'HireBTR business workspace. Use list_objects to discover record types, then list/search/get/create/update_record. Auth is per-workspace via the API key.',
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
