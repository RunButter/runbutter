import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { runDispatcher } from '@/lib/automations/dispatcher';
import { readJsonCapped } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Inbound webhook trigger (Activepieces/n8n style).
 *   POST /api/hooks/<token>   { ...any JSON... }
 *
 * Any external tool (Zapier, Make, n8n, a form, a script) can POST here to fire
 * the automation that owns <token>. The JSON body becomes the event payload
 * (referenceable in actions via {{field}}). Fire-and-forget: the dispatcher then
 * runs the actions. Also accepts GET (with query params) for easy testing.
 */
async function enqueue(token: string, payload: Record<string, any>) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('enqueue_webhook_event', { p_token: token, p_payload: payload });
  if (error) return { status: 500 as const, body: { error: error.message } };
  if (!data) return { status: 404 as const, body: { error: 'No active automation for this webhook token' } };
  // Drain a small batch right away so inbound triggers feel instant (the cron
  // /tick remains the safety net if this instance dies mid-run).
  try { await runDispatcher(admin, 10); } catch { /* queued; a later tick/cron picks it up */ }
  return { status: 202 as const, body: { ok: true, queued: true, automation: (data as any).automation } };
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  // Public endpoint: cap the body so junk POSTs can't bloat the events table.
  const body = await readJsonCapped(req, 64 * 1024);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const payload = body.data && typeof body.data === 'object' ? body.data : {};
  const r = await enqueue(params.token, payload);
  return NextResponse.json(r.body, { status: r.status });
}

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const payload = Object.fromEntries(new URL(req.url).searchParams.entries());
  const r = await enqueue(params.token, payload);
  return NextResponse.json(r.body, { status: r.status });
}
