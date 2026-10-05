// Run one saved agent on a task — the ONE way an agent run starts.
//
// /api/agents/run (a person pressing Run) and the `run_agent` tool (the Copilot
// or a manager agent handing work on) both come here, so a delegated run gets
// exactly what a manual one gets: the workspace's own key, the agent's own tool
// list and autonomy, its skills, a transcript row, live steps and token
// accounting. A second copy of this for delegation would be the place a check
// quietly went missing.
import { openSecret } from '@/lib/crypto/secrets';
import { defaultModel, type AIProvider } from '@/lib/ai/providers';
import { runAgent, type AgentDef, type SkillDef, type RunOutcome } from '@/lib/agents/runner';

export interface AgentRunRequest {
  admin: any;
  workspace: string;
  privy: string;
  agentId: string;
  task: string;
  /** A client-minted id, so the browser can start polling before the run returns. */
  runId?: string | null;
  /**
   * How many agents deep this run is. A person's run is 0; an agent started by
   * the `run_agent` tool is 1, and may not start another. Without a ceiling a
   * manager told to "get the team on it" can fan out into a loop that spends a
   * workspace's whole AI budget before anyone looks.
   */
  depth?: number;
}

export type AgentRunResult =
  | { ok: true; runId: string | null; agentName: string; model: string; outcome: RunOutcome }
  | { ok: false; status: number; error: string };

export async function executeAgentRun(req: AgentRunRequest): Promise<AgentRunResult> {
  const { admin, workspace, privy, agentId, task } = req;

  const { data: secret, error: secErr } = await admin.rpc('get_ai_secret', { p_privy: privy, p_workspace: workspace });
  if (secErr) return { ok: false, status: /NOT_A_MEMBER/.test(secErr.message) ? 403 : 500, error: secErr.message };
  if (!secret) return { ok: false, status: 400, error: 'No AI provider configured. Add a key in Settings → AI keys.' };

  let apiKey: string;
  try { apiKey = openSecret((secret as any).cipher, (secret as any).iv, (secret as any).tag); }
  catch { return { ok: false, status: 500, error: 'Could not decrypt the stored AI key.' }; }

  const { data: agentRow, error: aErr } = await admin.rpc('get_agent_full', { p_workspace: workspace, p_id: agentId });
  if (aErr) return { ok: false, status: 500, error: aErr.message };
  if (!agentRow) return { ok: false, status: 404, error: 'Agent not found' };
  const agent = agentRow as AgentDef & { enabled?: boolean; skill_ids?: string[] };
  if (agent.enabled === false) return { ok: false, status: 400, error: 'This agent is disabled' };

  const provider = (secret as any).provider as AIProvider;
  const model = agent.model || (secret as any).model || defaultModel(provider, 'balanced');
  const baseUrl = (secret as any).base_url || undefined;

  const { data: runId } = await admin.rpc('create_agent_run', {
    p_workspace: workspace, p_agent_id: agentId, p_agent_name: agent.name, p_task: task, p_privy: privy,
    p_id: req.runId ?? null,
  });

  let skills: SkillDef[] = [];
  const skillIds: string[] = agent.skill_ids || [];
  if (skillIds.length) {
    const { data: sRows, error: sErr } = await admin.rpc('get_agent_skills', { p_workspace: workspace, p_ids: skillIds });
    if (sErr) return { ok: false, status: 500, error: sErr.message };
    skills = Array.isArray(sRows) ? (sRows as SkillDef[]) : [];
  }

  const ctx = {
    admin, workspace, privy,
    agentId, agentName: agent.name, runId: (runId as string) ?? null,
    depth: req.depth ?? 0,
  };
  // Stream each step into the run row so a browser can watch (0095). Progress
  // is a nicety — the runner swallows a failed write rather than the run.
  const onStep = runId
    ? async (step: any, replaceLast?: boolean) => {
        await admin.rpc('append_agent_run_step', { p_id: runId, p_step: step, p_replace_last: !!replaceLast });
      }
    : undefined;

  const outcome = await runAgent(ctx, agent, provider, apiKey, model, baseUrl, task, skills, onStep);

  await admin.rpc('finish_agent_run', {
    p_id: runId, p_status: outcome.status,
    p_steps: outcome.steps, p_proposed: outcome.proposed, p_result: outcome.result,
    // What the provider counted, plus the model that did it — the same agent on
    // two models is not a comparable cost.
    p_input_tokens: outcome.usage.input, p_output_tokens: outcome.usage.output,
    p_cached_tokens: outcome.usage.cached, p_model: model,
  });

  return { ok: true, runId: (runId as string) ?? null, agentName: agent.name, model, outcome };
}
