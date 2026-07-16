import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createAdminClient } from '@/lib/supabase';
import { runDispatcher } from '@/lib/automations/dispatcher';
import { readJsonCapped, rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public REST bridge for external tools (Zapier "Webhooks", Make "HTTP", n8n,
 * scripts). Authenticate with a workspace API key:
 *   Authorization: Bearer hb_...   (or  x-api-key: hb_...)
 *
 * GET  /api/v1/records?object=people            → list records of an object
 * POST /api/v1/records  { object, data }        → create a record
 *
 * Runs as the key's creator (a workspace member) through the same SECURITY
 * DEFINER RPCs the app uses, so tenancy + validation are identical.
 */
async function auth(req: Request) {
  const header = req.headers.get('authorization') || '';
  const key = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : (req.headers.get('x-api-key') || '').trim();
  if (!key) return null;
  const hash = createHash('sha256').update(key).digest('hex');
  const admin = createAdminClient();
  const { data } = await admin.rpc('resolve_api_key', { p_hash: hash });
  if (!data) return null;
  return { admin, workspace: (data as any).workspace_id as string, privy: (data as any).owner_privy as string };
}

const ALLOWED = new Set(['people', 'companies', 'invoices', 'expenses', 'transactions', 'products', 'campaigns', 'projects', 'issues', 'offers', 'assets']);

export async function GET(req: Request) {
  const rl = rateLimit(`v1:${clientIp(req)}`, 120);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  const ctx = await auth(req);
  if (!ctx) return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  const object = new URL(req.url).searchParams.get('object') || '';
  if (!ALLOWED.has(object)) return NextResponse.json({ error: `Unknown object. Allowed: ${[...ALLOWED].join(', ')}` }, { status: 400 });
  const rpcObject = object === 'offers' ? 'invoices' : object;
  const { data, error } = await ctx.admin.rpc('list_records', { p_privy: ctx.privy, p_workspace: ctx.workspace, p_object: rpcObject });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let rows = (data as any[]) || [];
  if (object === 'offers') rows = rows.filter((r) => r.kind === 'offer');
  else if (object === 'invoices') rows = rows.filter((r) => r.kind !== 'offer');
  return NextResponse.json({ object, count: rows.length, data: rows });
}

export async function POST(req: Request) {
  const rl = rateLimit(`v1:${clientIp(req)}`, 120);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  const ctx = await auth(req);
  if (!ctx) return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  const capped = await readJsonCapped(req, 256 * 1024);
  if (!capped.ok) return NextResponse.json({ error: capped.error }, { status: capped.status });
  const body: any = capped.data;
  const object = body?.object || '';
  if (!ALLOWED.has(object)) return NextResponse.json({ error: `Unknown object. Allowed: ${[...ALLOWED].join(', ')}` }, { status: 400 });
  const payload = object === 'offers' ? { ...(body.data || {}), kind: 'offer' } : (body.data || {});
  const rpcObject = object === 'offers' ? 'invoices' : object;
  const { data, error } = await ctx.admin.rpc('create_record', { p_privy: ctx.privy, p_workspace: ctx.workspace, p_object: rpcObject, p_data: payload });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // fire-and-forget: let any matching automations run promptly (Render keeps
  // the process alive; the tick/cron is the safety net either way)
  runDispatcher(ctx.admin, 10).catch(() => {});
  return NextResponse.json({ ok: true, id: data }, { status: 201 });
}
