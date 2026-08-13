import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { checkFeature, planDeniedBody } from '@/lib/plans-server';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { executeProposed } from '@/lib/agents/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/agents/approve { privyUserId, workspaceId, runId }
// Executes the writes a 'suggest' agent proposed. Tenancy is enforced: the run
// must belong to the caller's workspace, which get_ai_secret's membership check
// confirms before anything runs.
export async function POST(req: Request) {
  const rl = rateLimit(`agents:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId, runId } = b || {};
  if (!privyUserId || !workspaceId || !runId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();

  // Confirm membership (raises NOT_A_MEMBER otherwise) before touching the run.
  const { error: memErr } = await admin.rpc('get_ai_secret', { p_privy: privyUserId, p_workspace: workspaceId });
  if (memErr && /NOT_A_MEMBER/.test(memErr.message)) return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });

  const { data: runRow, error: rErr } = await admin.rpc('get_agent_run_row', { p_id: runId });
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
  const run = runRow as any;
  if (!run || run.workspace_id !== workspaceId) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  if (run.status !== 'awaiting_approval') return NextResponse.json({ error: 'This run has nothing awaiting approval' }, { status: 400 });

  /**
   * The plan gate applies to AGENTS, not to the copilot.
   *
   * It used to sit at the top of this route and refuse before the run was even
   * read — which was right while agents were the only thing that proposed
   * writes, and became wrong the moment the copilot did too (0102). A copilot
   * run carries `agent_id = null`, and gating it would mean the copilot could
   * offer a change on the free plan and then refuse to apply it: the worst
   * possible place to meet an upgrade wall, one click after saying yes.
   *
   * Read from the RUN rather than from the request, so a client cannot claim
   * its agent run is a copilot run to get round the gate.
   */
  if (run.agent_id) {
    const planDenied = await checkFeature(workspaceId, 'aiAgents');
    if (planDenied) return NextResponse.json(planDeniedBody(planDenied), { status: 402 });
  }

  const proposed = Array.isArray(run.proposed) ? run.proposed : [];
  const ctx = { admin, workspace: workspaceId, privy: privyUserId };
  const results = await executeProposed(ctx, proposed);

  const steps = [...(Array.isArray(run.steps) ? run.steps : []), { type: 'approved', results }];
  const summary = `Applied ${results.length} approved change(s).`;
  await admin.rpc('finish_agent_run', {
    p_id: runId, p_status: 'done', p_steps: steps, p_proposed: [], p_result: `${run.result}\n\n${summary}`.trim(),
  });

  return NextResponse.json({ ok: true, results });
}
