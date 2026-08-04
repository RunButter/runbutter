import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { runScheduledAgents } from '@/lib/agents/scheduled';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/agents/dispatch
 * Header: x-cron-secret: <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Same header, same secret and same Render Cron shape as
 * /api/automations/dispatch and /api/posts/dispatch — deliberately identical so
 * operating this product is one pattern learned once.
 *
 * Every ten minutes is plenty: the coarsest schedule is hourly, and each run
 * spends the workspace's own AI credit, so sweeping every minute would only
 * add load without making anything happen sooner.
 *
 * The batch is small (5) because an agent turn is slow — several model calls —
 * and a long sweep risks the platform's request timeout. claim_due_agents
 * stamps last_run_at at claim time, so a truncated sweep picks up where it left
 * off rather than re-running the same agents.
 */
export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected || secret !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const stats = await runScheduledAgents(createAdminClient(), 5);
    return NextResponse.json({ ok: true, ...stats });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'dispatch failed' }, { status: 500 });
  }
}
