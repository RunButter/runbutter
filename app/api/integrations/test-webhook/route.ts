import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { signWebhook } from '@/lib/automations/dispatcher';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { isSafeOutboundUrl } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/test-webhook  { privyUserId, connectionId }
 * Sends a signed SAMPLE payload to one of the workspace's webhook connections
 * and logs the delivery. This is what Zapier / Make / n8n setup flows wait for:
 * a sample event to map fields against, without having to trigger a real rule.
 * Membership is enforced by the SECURITY DEFINER get_connections RPC.
 */
export async function POST(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, connectionId } = b || {};
  if (!privyUserId || !connectionId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();
  const { data: ws, error: wsErr } = await admin.rpc('get_my_workspace', { p_privy: privyUserId });
  if (wsErr || !ws) return NextResponse.json({ error: 'No workspace for this account' }, { status: 401 });
  const workspaceId = (ws as any).id;

  const { data: conns, error: cErr } = await admin.rpc('get_connections', { p_privy: privyUserId, p_workspace: workspaceId });
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 403 });
  const conn = ((conns as any[]) || []).find((c) => c.id === connectionId);
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
  if (!isSafeOutboundUrl(conn.url)) return NextResponse.json({ error: 'Blocked: private/unsafe webhook URL' }, { status: 400 });

  const body = JSON.stringify({
    event: 'test', object: 'test', automation: 'Test from RunButter',
    record: { id: '00000000-0000-4000-8000-000000000000', name: 'Sample record', amount: 123.45, status: 'sample', email: 'sample@runbutter.app' },
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (conn.secret) headers['X-RunButter-Signature'] = signWebhook(conn.secret, body);

  let code = 0, ok = false, detail = '';
  try {
    const r = await fetch(conn.url, { method: 'POST', headers, body });
    code = r.status; ok = r.ok; detail = `Test POST ${r.status}`;
  } catch (e: any) {
    detail = `Test POST failed: ${e?.message || 'network error'}`;
  }
  await admin.rpc('log_webhook_delivery', {
    p_workspace: workspaceId, p_connection: conn.id, p_automation: null, p_url: conn.url,
    p_status: ok ? 'ok' : 'failed', p_code: code || null, p_attempts: 1, p_detail: detail,
  }).then(() => {}, () => {});

  return NextResponse.json({ ok, status: code || null, detail });
}
