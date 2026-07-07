import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

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
  return { status: 202 as const, body: { ok: true, queued: true, automation: (data as any).automation } };
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  let payload: Record<string, any> = {};
  try { payload = await req.json(); } catch { payload = {}; }
  const r = await enqueue(params.token, payload);
  return NextResponse.json(r.body, { status: r.status });
}

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const payload = Object.fromEntries(new URL(req.url).searchParams.entries());
  const r = await enqueue(params.token, payload);
  return NextResponse.json(r.body, { status: r.status });
}
