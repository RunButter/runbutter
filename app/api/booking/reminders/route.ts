import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { sendBookingReminders } from '@/lib/booking/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/booking/reminders — Header: x-cron-secret: <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Emails the visitors whose meeting is about a day away. The built-in scheduler
 * (lib/scheduler/internal-cron.ts) already does this on any long-lived server;
 * this route is for serverless hosts, same secret as the automations cron.
 */
export async function POST(req: Request) {
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected || req.headers.get('x-cron-secret') !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, ...(await sendBookingReminders(createAdminClient(), 50)) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'reminders failed' }, { status: 500 });
  }
}
