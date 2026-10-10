import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { processEvent } from '@/lib/automations/dispatcher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/automations/test  { privyUserId, workspaceId, automationId }
 *
 * "Does this work?" answered in one click. test_automation (0132) queues an
 * event against the LATEST real record of the trigger's object; this claims
 * exactly that event and runs it now, returning each action's result.
 *
 * Emails, chat posts, webhooks, AI and agents really happen — that is what
 * there is to test. Creating or updating records does NOT: a test that edits
 * your latest invoice is not a test. Those actions report what they would do.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`automation-test:${clientIp(req)}`, 10);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId, automationId } = b || {};
  if (!privyUserId || !workspaceId || !automationId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();
  const { data: t, error } = await admin.rpc('test_automation', { p_privy: privyUserId, p_workspace: workspaceId, p_id: automationId });
  if (error) {
    const status = /NOT_A_MEMBER|FORBIDDEN/.test(error.message) ? 403 : /NOT_FOUND/.test(error.message) ? 404 : 500;
    return NextResponse.json({ error: error.message.replace(/^FORBIDDEN:\s*/, '') }, { status });
  }
  const { data: ev, error: cErr } = await admin.rpc('claim_automation_event', { p_id: (t as any).event });
  if (cErr || !ev) return NextResponse.json({ error: cErr?.message || 'The test event was picked up by another run — check Recent runs.' }, { status: 409 });

  const { results } = await processEvent(admin, ev);
  return NextResponse.json({ ok: results.every((r) => r.ok), sample: (t as any).sample, results });
}
