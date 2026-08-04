import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { runSocialDispatcher } from '@/lib/social/dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/posts/tick — the nudge that makes "Publish now" feel immediate.
 *
 * Same shape and same reasoning as /api/automations/tick. Deliberately
 * unauthenticated: it takes NO INPUT and can only process work that a
 * workspace member already queued through `publish_post_now` (which does check
 * membership). Calling it cannot cause a post to exist, cannot choose which
 * post goes out, and cannot make one go out twice — `claim_post_targets` holds
 * that line whoever calls it.
 *
 * The only abuse vector is load, so it is throttled per instance and the batch
 * is capped. The secret-authed /api/posts/dispatch cron stays the guaranteed
 * path for scheduled posts on a quiet day.
 */
const MIN_INTERVAL_MS = 10_000;
let lastRun = 0;
let running = false;

export async function POST() {
  const now = Date.now();
  if (running || now - lastRun < MIN_INTERVAL_MS) return NextResponse.json({ ok: true, skipped: true });
  running = true; lastRun = now;
  try {
    const stats = await runSocialDispatcher(createAdminClient(), 10);
    return NextResponse.json({ ok: true, ...stats });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'tick failed' }, { status: 500 });
  } finally {
    running = false;
  }
}
