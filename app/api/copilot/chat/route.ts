import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { openSecret } from '@/lib/crypto/secrets';
import { defaultModel, type AIProvider } from '@/lib/ai/providers';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { runAgent, type PriorTurn } from '@/lib/agents/runner';
import { copilotAgent, type PageContext } from '@/lib/agents/copilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/copilot/chat
 *   { privyUserId, workspaceId, threadId, message, page, runId? }
 *
 * One turn of the copilot conversation: append the person's message, run the
 * tool loop seeded with the thread so far, append the reply.
 *
 * NOT PLAN-GATED, unlike /api/agents/run. Agents are a Business feature because
 * an agent is unattended, scheduled, configurable capacity. The copilot is a
 * person typing a question about their own data on their own key — gating it
 * would make the product's most obvious front door the one that says "upgrade".
 * The BYO key means it costs the platform nothing either way.
 */
export async function POST(req: Request) {
  // Tighter than the agent route's 20: a copilot is typed at, so a burst is a
  // stuck client rather than a person, and every request spends the user's own
  // money on their own key.
  const rl = rateLimit(`copilot:${clientIp(req)}`, 30);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId, threadId } = b || {};
  const message = String(b?.message || '').slice(0, 4000).trim();
  if (!privyUserId || !workspaceId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!threadId) return NextResponse.json({ error: 'A thread is required' }, { status: 400 });
  if (!message) return NextResponse.json({ error: 'Say something first' }, { status: 400 });

  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const admin = createAdminClient();

  // The thread, which is also the ownership check: `get_copilot_thread` raises
  // NOT_FOUND for a thread belonging to anyone else, including a colleague in
  // the same workspace. Done BEFORE the AI key is decrypted — no reason to
  // touch a secret for a request that is about to be refused.
  const { data: thread, error: tErr } = await admin.rpc('get_copilot_thread', {
    p_privy: privyUserId, p_thread: threadId,
  });
  if (tErr) return NextResponse.json({ error: 'Conversation not found' }, { status: /NOT_FOUND/.test(tErr.message) ? 404 : 500 });
  if (!thread) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

  const { data: secret, error: secErr } = await admin.rpc('get_ai_secret', { p_privy: privyUserId, p_workspace: workspaceId });
  if (secErr) return NextResponse.json({ error: secErr.message }, { status: /NOT_A_MEMBER/.test(secErr.message) ? 403 : 500 });
  if (!secret) {
    return NextResponse.json({
      error: 'No AI key yet. Add one in Settings → AI keys — the copilot runs on your own provider key, so nothing is billed here.',
    }, { status: 400 });
  }

  let apiKey: string;
  try { apiKey = openSecret((secret as any).cipher, (secret as any).iv, (secret as any).tag); }
  catch { return NextResponse.json({ error: 'Could not decrypt the stored AI key (was SECRETS_MASTER_KEY changed?).' }, { status: 500 }); }

  const page: PageContext = {
    path: typeof b?.page?.path === 'string' ? b.page.path.slice(0, 200) : undefined,
    label: typeof b?.page?.label === 'string' ? b.page.label.slice(0, 80) : undefined,
    object: typeof b?.page?.object === 'string' ? b.page.object.slice(0, 40) : undefined,
    recordId: typeof b?.page?.recordId === 'string' ? b.page.recordId.slice(0, 40) : undefined,
  };

  // AUTONOMY COMES FROM THE STORED THREAD, never from the request body. The
  // panel has a suggest/auto switch, and that switch writes the thread through
  // `set_copilot_thread` — so a request cannot ask for `auto` on a thread whose
  // owner left it on `suggest`.
  const autonomy: 'suggest' | 'auto' = (thread as any).autonomy === 'auto' ? 'auto' : 'suggest';

  const provider = (secret as any).provider as AIProvider;
  const model = (secret as any).model || defaultModel(provider, 'balanced');
  const baseUrl = (secret as any).base_url || undefined;
  const agent = copilotAgent(model, provider, autonomy, page);

  // The person's message lands FIRST, before the model is called. A run that
  // times out or throws must not lose what they typed — the thread reloading
  // without their own question in it reads as the app having ignored them.
  await admin.rpc('append_copilot_message', {
    p_thread: threadId, p_role: 'user', p_content: message, p_run: null, p_page: page.path || '',
  });

  const { data: hist } = await admin.rpc('get_copilot_history', { p_thread: threadId, p_turns: 12 });
  // The message just written is the last turn, so it is dropped here and passed
  // as the task instead — sending it twice would have the model answer an echo.
  const all: PriorTurn[] = Array.isArray(hist) ? (hist as PriorTurn[]) : [];
  const priorTurns = all.slice(0, Math.max(0, all.length - 1));

  // The browser mints the run id so it can poll for steps from the first
  // second; this response does not arrive until the whole loop is done.
  const wantedId = typeof b?.runId === 'string' && /^[0-9a-f-]{36}$/i.test(b.runId) ? b.runId : null;
  const { data: runId } = await admin.rpc('create_agent_run', {
    p_workspace: workspaceId, p_agent_id: null, p_agent_name: 'Copilot',
    p_task: message, p_privy: privyUserId, p_id: wantedId,
  });

  const ctx = {
    admin, workspace: workspaceId, privy: privyUserId,
    agentId: null, agentName: 'Copilot', runId: (runId as string) ?? null,
  };
  const onStep = runId
    ? async (step: any, replaceLast?: boolean) => {
        await admin.rpc('append_agent_run_step', { p_id: runId, p_step: step, p_replace_last: !!replaceLast });
      }
    : undefined;

  const outcome = await runAgent(ctx, agent, provider, apiKey, model, baseUrl, message, [], onStep, priorTurns);

  await admin.rpc('finish_agent_run', {
    p_id: runId, p_status: outcome.status,
    p_steps: outcome.steps, p_proposed: outcome.proposed, p_result: outcome.result,
    p_input_tokens: outcome.usage.input, p_output_tokens: outcome.usage.output,
    p_cached_tokens: outcome.usage.cached, p_model: model,
  });

  await admin.rpc('append_copilot_message', {
    p_thread: threadId, p_role: 'assistant', p_content: outcome.result, p_run: runId, p_page: '',
  });

  return NextResponse.json({ runId, ...outcome });
}
