import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { openSecret } from '@/lib/crypto/secrets';
import { PROVIDERS, type AIProvider } from '@/lib/ai/providers';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { runAgent, type AgentDef } from '@/lib/agents/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/agents/run { privyUserId, workspaceId, agentId, task }
// Runs the agent's tool-use loop on the workspace's BYO AI key. Verified by the
// Privy token; the key + agent are read with the service role.
const defaultModel = (p: string) => PROVIDERS.find((x) => x.id === p)?.models[0] || '';

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

  const admin = createAdminClient();

  // BYO key (also validates workspace membership — raises NOT_A_MEMBER otherwise).
  const { data: secret, error: secErr } = await admin.rpc('get_ai_secret', { p_privy: privyUserId, p_workspace: workspaceId });
  if (secErr) return NextResponse.json({ error: secErr.message }, { status: /NOT_A_MEMBER/.test(secErr.message) ? 403 : 500 });
  if (!secret) return NextResponse.json({ error: 'No AI provider configured. Add a key in Settings → AI keys.' }, { status: 400 });

  let apiKey: string;
  try { apiKey = openSecret((secret as any).cipher, (secret as any).iv, (secret as any).tag); }
  catch { return NextResponse.json({ error: 'Could not decrypt the stored AI key.' }, { status: 500 }); }

  const { data: agentRow, error: aErr } = await admin.rpc('get_agent_full', { p_workspace: workspaceId, p_id: agentId });
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (!agentRow) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  const agent = agentRow as AgentDef & { enabled?: boolean };
  if (agent.enabled === false) return NextResponse.json({ error: 'This agent is disabled' }, { status: 400 });

  const provider = (secret as any).provider as AIProvider;
  const model = agent.model || (secret as any).model || defaultModel(provider);
  const baseUrl = (secret as any).base_url || undefined;

  const { data: runId } = await admin.rpc('create_agent_run', {
    p_workspace: workspaceId, p_agent_id: agentId, p_agent_name: agent.name, p_task: task, p_privy: privyUserId,
  });

  const ctx = { admin, workspace: workspaceId, privy: privyUserId };
  const outcome = await runAgent(ctx, agent, provider, apiKey, model, baseUrl, task);

  await admin.rpc('finish_agent_run', {
    p_id: runId, p_status: outcome.status,
    p_steps: outcome.steps, p_proposed: outcome.proposed, p_result: outcome.result,
  });

  return NextResponse.json({ runId, ...outcome });
}
