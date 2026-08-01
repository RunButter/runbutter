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
 *
 * SPREADSHEET FEED. Excel's "Get Data → From Web" cannot send an Authorization
 * header from its dialog, so the key may also arrive as `?key=`, with
 * `&format=csv` for a table Power Query reads directly. Two rules bound that:
 *
 *   1. a query-string key must have scope 'read' (0078)
 *   2. a query-string key can NEVER write, whatever its scope
 *
 * Rule 2 is the structural one — a URL leaks into history, forwarded mail and
 * screen shares, so the transport itself is treated as untrusted rather than
 * trusting the user to have pasted the right kind of key.
 */
interface Ctx {
  admin: ReturnType<typeof createAdminClient>;
  workspace: string;
  privy: string;
  scope: 'full' | 'read';
  fromQuery: boolean;
}

async function auth(req: Request): Promise<Ctx | null> {
  const header = req.headers.get('authorization') || '';
  let key = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : (req.headers.get('x-api-key') || '').trim();
  let fromQuery = false;
  if (!key) {
    key = (new URL(req.url).searchParams.get('key') || '').trim();
    fromQuery = !!key;
  }
  if (!key) return null;
  const hash = createHash('sha256').update(key).digest('hex');
  const admin = createAdminClient();
  const { data } = await admin.rpc('resolve_api_key', { p_hash: hash });
  if (!data) return null;
  const scope = ((data as any).scope === 'read' ? 'read' : 'full') as 'full' | 'read';
  // Rule 1: a full-access key pasted into a URL is refused outright rather than
  // silently downgraded — the user should go and make a read key.
  if (fromQuery && scope !== 'read') return null;
  return { admin, workspace: (data as any).workspace_id as string, privy: (data as any).owner_privy as string, scope, fromQuery };
}

const ALLOWED = new Set(['people', 'companies', 'invoices', 'expenses', 'transactions', 'products', 'campaigns', 'projects', 'issues', 'offers', 'assets']);

export async function GET(req: Request) {
  const rl = rateLimit(`v1:${clientIp(req)}`, 120);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  const ctx = await auth(req);
  if (!ctx) return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const object = params.get('object') || '';
  if (!ALLOWED.has(object)) return NextResponse.json({ error: `Unknown object. Allowed: ${[...ALLOWED].join(', ')}` }, { status: 400 });
  const rpcObject = object === 'offers' ? 'invoices' : object;
  const { data, error } = await ctx.admin.rpc('list_records', { p_privy: ctx.privy, p_workspace: ctx.workspace, p_object: rpcObject });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let rows = (data as any[]) || [];
  if (object === 'offers') rows = rows.filter((r) => r.kind === 'offer');
  else if (object === 'invoices') rows = rows.filter((r) => r.kind !== 'offer');
  if ((params.get('format') || '').toLowerCase() === 'csv') return csvResponse(object, rows);
  return NextResponse.json({ object, count: rows.length, data: rows });
}

export async function POST(req: Request) {
  const rl = rateLimit(`v1:${clientIp(req)}`, 120);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  const ctx = await auth(req);
  if (!ctx) return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  // Rule 2: the transport decides, not the scope. A key that arrived in a URL
  // never writes, so a leaked feed link can only ever read.
  if (ctx.fromQuery || ctx.scope === 'read') {
    return NextResponse.json({ error: 'This key is read-only. Use a full-access key sent as an Authorization header to create records.' }, { status: 403 });
  }
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

// ── CSV ──────────────────────────────────────────────────────────────────────
// Power Query will happily parse JSON, but only after the user drills into a
// record and clicks "To Table" — several steps most people never find. A CSV
// lands as a table on the first click, so this is the shape the feed serves.

/** Values a spreadsheet cell can hold as-is. Objects/arrays get JSON-encoded. */
function cell(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * RFC 4180 quoting. A field is quoted when it contains a comma, a quote, a CR
 * or an LF; embedded quotes are doubled.
 */
function esc(v: any): string {
  const s = cell(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvResponse(object: string, rows: any[]) {
  // Column order is the union of keys in first-seen order, not the keys of
  // row[0]: rows come from JSONB and a later row can carry a field an earlier
  // one omitted. Dropping it would silently truncate the sheet.
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r || {})) if (!cols.includes(k)) cols.push(k);
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r?.[c])).join(','));
  // CRLF and a UTF-8 BOM: without the BOM, Excel on Windows opens the file in
  // the system codepage and mangles every non-ASCII name.
  const body = '﻿' + lines.join('\r\n') + '\r\n';
  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `inline; filename="${object}.csv"`,
      // The point of the feed is "Refresh All" showing today's numbers.
      'cache-control': 'no-store',
    },
  });
}
