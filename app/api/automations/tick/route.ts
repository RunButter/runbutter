import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { runDispatcher } from '@/lib/automations/dispatcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/automations/tick — an unauthenticated "nudge" that drains the
 * automation outbox. The app pings it (fire-and-forget) after record
 * mutations, so automations run within seconds even with NO cron configured.
 *
 * Deliberately public: it takes no input and only processes work that DB
 * triggers already queued — the same thing the cron does. The only abuse
 * vector is load, so it's throttled per instance (Render runs a persistent
 * Node server) and caps the batch size. The secret-authed /dispatch cron
 * remains the guaranteed path for schedules on quiet days.
 */
const MIN_INTERVAL_MS = 15_000;
let lastRun = 0;
let running = false;

export async function POST() {
  const now = Date.now();
  if (running || now - lastRun < MIN_INTERVAL_MS) return NextResponse.json({ ok: true, skipped: true });
  running = true; lastRun = now;
  try {
    const stats = await runDispatcher(createAdminClient(), 15);
    return NextResponse.json({ ok: true, ...stats });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'tick failed' }, { status: 500 });
  } finally {
    running = false;
  }
}
