import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { runSocialDispatcher } from '@/lib/social/dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/posts/dispatch
 * Header: x-cron-secret: <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Shaped exactly like /api/automations/dispatch — same header, same secret,
 * same Render Cron Job every minute. Deliberately identical so operating this
 * product is one pattern learned once rather than five endpoints that each
 * authenticate differently.
 *
 * (Note the two cron secrets are NOT interchangeable: automations, newsletters,
 * sequences and this use the service-role key in `x-cron-secret`; finance
 * reminders and the Excel sweep use CRON_SECRET.)
 *
 * Publishing "now" also runs through here: publish_post_now only marks targets
 * due, so there is one code path that can reach a platform and one place the
 * at-most-once rule has to hold.
 */
export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected || secret !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const stats = await runSocialDispatcher(createAdminClient(), 25);
    return NextResponse.json({ ok: true, ...stats });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'dispatch failed' }, { status: 500 });
  }
}
