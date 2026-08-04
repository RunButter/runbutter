import type { SupabaseClient } from '@supabase/supabase-js';
import { openSecret } from '@/lib/crypto/secrets';
import { PROVIDERS, type AIProvider } from '@/lib/ai/providers';
import { runAgent, type AgentDef, type SkillDef } from '@/lib/agents/runner';

/**
 * Agents that run without being asked.
 *
 * This is the difference between "we have agents" and an agentic CRM. Until
 * now an agent only acted when a person opened /agents and typed a task, which
 * makes it a chat window with tools. A scheduled agent wakes up, looks at the
 * workspace, and writes what it found onto the records — and the next person to
 * open a company sees the notes.
 *
 * AUTONOMY IS UNCHANGED BY THIS. A `suggest` agent still only proposes; it just
 * proposes unprompted, and the proposal waits for approval exactly as it does
 * from the UI. Scheduling changes WHEN an agent thinks, not what it is allowed
 * to do.
 *
 * THE RUN IS ATTRIBUTED TO A REAL PERSON — the workspace member who has the AI
 * key — because there is no such thing as an unattributed actor here. Tool
 * tenancy is derived from `p_privy` in SQL, so an unattributed run would either
 * see nothing or need a bypass, and a bypass is how one tenant's agent ends up
 * reading another's data.
 */

const defaultModel = (p: string) => PROVIDERS.find((x) => x.id === p)?.models[0] || '';

interface DueAgent { id: string; workspace_id: string; name: string; task: string }

export interface ScheduledStats { claimed: number; ran: number; skipped: number; failed: number }

export async function runScheduledAgents(admin: SupabaseClient, limit = 5): Promise<ScheduledStats> {
  const stats: ScheduledStats = { claimed: 0, ran: 0, skipped: 0, failed: 0 };

  // Claims and stamps last_run_at in one statement — see claim_due_agents. A
  // double claim would spend the customer's own AI credit twice on one task.
  const { data, error } = await admin.rpc('claim_due_agents', { p_limit: limit });
  if (error) throw new Error(error.message);
  const due = (Array.isArray(data) ? data : []) as DueAgent[];
  stats.claimed = due.length;

  for (const a of due) {
    try {
      // Whose key, and therefore whose permissions. `get_workspace_ai_owner`
      // returns the member the run is attributed to; without one there is no
      // key to spend and no identity to act as, so the agent simply does not
      // run — silently, because a workspace with no AI key configured has not
      // asked for anything and does not need an error every hour.
      const { data: owner } = await admin.rpc('get_workspace_ai_owner', { p_workspace: a.workspace_id });
      const privy = (owner as any)?.privy_user_id;
      if (!privy) { stats.skipped++; continue; }

      const { data: secret } = await admin.rpc('get_ai_secret', { p_privy: privy, p_workspace: a.workspace_id });
      if (!secret) { stats.skipped++; continue; }

      let apiKey: string;
      try { apiKey = openSecret((secret as any).cipher, (secret as any).iv, (secret as any).tag); }
      catch { stats.failed++; continue; }

      const { data: agentRow } = await admin.rpc('get_agent_full', { p_workspace: a.workspace_id, p_id: a.id });
      if (!agentRow) { stats.skipped++; continue; }
      const agent = agentRow as AgentDef & { enabled?: boolean };
      if (agent.enabled === false) { stats.skipped++; continue; }

      const provider = (secret as any).provider as AIProvider;
      const model = agent.model || (secret as any).model || defaultModel(provider);
      const baseUrl = (secret as any).base_url || undefined;

      const { data: runId } = await admin.rpc('create_agent_run', {
        p_workspace: a.workspace_id, p_agent_id: a.id, p_agent_name: a.name,
        // Labelled in the transcript. Someone reading the run history has to be
        // able to tell "the schedule did this" from "a colleague asked for it".
        p_task: `[scheduled] ${a.task}`, p_privy: privy,
      });

      let skills: SkillDef[] = [];
      const skillIds: string[] = (agent as any).skill_ids || [];
      if (skillIds.length) {
        const { data: sRows } = await admin.rpc('get_agent_skills', { p_workspace: a.workspace_id, p_ids: skillIds });
        skills = Array.isArray(sRows) ? (sRows as SkillDef[]) : [];
      }

      const ctx = {
        admin, workspace: a.workspace_id, privy,
        agentId: a.id, agentName: a.name, runId: (runId as string) ?? null,
      };
      const outcome = await runAgent(ctx, agent, provider, apiKey, model, baseUrl, a.task, skills);

      await admin.rpc('finish_agent_run', {
        p_id: runId, p_status: outcome.status,
        p_steps: outcome.steps, p_proposed: outcome.proposed, p_result: outcome.result,
      });
      stats.ran++;
    } catch {
      // One agent's failure must not stop the sweep — the others are due too.
      // `last_run_at` is already stamped, so a persistently failing agent waits
      // for its next slot instead of retrying every minute all day.
      stats.failed++;
    }
  }

  return stats;
}
