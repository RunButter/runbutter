import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { checkFeature, planDeniedBody } from '@/lib/plans-server';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { executeAgentRun } from '@/lib/agents/delegate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/agents/run { privyUserId, workspaceId, agentId, task }
// Runs the agent's tool-use loop on the workspace's BYO AI key. Verified by the
// Privy token; the key + agent are read with the service role.

export async function POST(req: Request) {
  const rl = rateLimit(`agents:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId, agentId } = b || {};
  const task = String(b?.task || '').slice(0, 4000);
  if (!privyUserId || !workspaceId || !agentId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!task.trim()) return NextResponse.json({ error: 'A task is required' }, { status: 400 });

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  // AI agents are a Business feature: the /agents page was gated in the React
  // tree and this route was not. Checked before the AI key is decrypted — no
  // reason to touch a secret for a call that is about to be refused.
  const planDenied = await checkFeature(workspaceId, 'aiAgents');
  if (planDenied) return NextResponse.json(planDeniedBody(planDenied), { status: 402 });

  // Everything below the auth line is shared with the `run_agent` tool, so a
  // run a person starts and a run an agent delegates are the same run.
  const wantedId = typeof b?.runId === 'string' && /^[0-9a-f-]{36}$/i.test(b.runId) ? b.runId : null;
  const res = await executeAgentRun({ admin: createAdminClient(), workspace: workspaceId, privy: privyUserId, agentId, task, runId: wantedId });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  const { runId, outcome } = res;
  return NextResponse.json({ runId, ...outcome });
}
