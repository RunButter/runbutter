import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { runDispatcher } from '@/lib/automations/dispatcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/automations/dispatch
 * Header: x-cron-secret: <SUPABASE_SERVICE_ROLE_KEY>
 *
 * The reliable path: point pg_cron (via pg_net) or a Render Cron Job here every
 * minute. Enqueues due scheduled automations and drains the outbox (see
 * lib/automations/dispatcher). The app also nudges /api/automations/tick after
 * mutations, so most runs feel instant even before the cron exists.
 */
export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected || secret !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const stats = await runDispatcher(createAdminClient(), 25);
    return NextResponse.json({ ok: true, ...stats });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'dispatch failed' }, { status: 500 });
  }
}
