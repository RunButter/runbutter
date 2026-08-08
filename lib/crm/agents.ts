'use client';

import { getAccessToken } from '@privy-io/react-auth';
import { rpc } from '@/lib/rpc';

export interface Agent {
  id: string; name: string; role: string; instructions: string;
  provider: string; model: string;
  allowed_tools: string[]; allowed_objects: string[];
  autonomy: 'suggest' | 'auto'; max_steps: number; enabled: boolean;
  skill_ids: string[];
  /**
   * Unattended runs (0084). Coarse on purpose — hourly/daily/weekly plus a UTC
   * hour, not a cron expression: the value of the feature is "it ran without
   * me", and a cron field turns that into a syntax to debug.
   *
   * A schedule does NOT change autonomy. A `suggest` agent still only proposes;
   * it just proposes unprompted.
   */
  schedule: AgentSchedule; schedule_hour: number; schedule_task: string;
  last_run_at?: string | null;
}

export type AgentSchedule = 'off' | 'hourly' | 'daily' | 'weekly';

export const SCHEDULE_LABEL: Record<AgentSchedule, string> = {
  off: 'Only when asked',
  hourly: 'Every hour',
  daily: 'Once a day',
  weekly: 'Once a week',
};

export interface AgentRun {
  id: string; agent_id: string | null; agent_name: string; task: string;
  status: 'running' | 'done' | 'error' | 'awaiting_approval';
  steps: any[]; proposed: any[]; result: string;
  created_at: string; finished_at: string | null;
}

// These used to be declared here by hand, and the hand-written READ_TOOLS held
// four names while the executor had nineteen — so the builder's picker could not
// grant an agent finance, files, candidate or analytics tools at all. They now
// come from the one catalogue both sides read.
export {
  READ_TOOLS, WRITE_TOOLS, AGENT_OBJECTS, DEFAULT_TOOLS,
  TOOL_CATALOG, TOOL_GROUPS, toolLabel, isWriteTool,
  type ToolInfo, type ToolGroup,
} from '@/lib/agents/catalog';
import { DEFAULT_TOOLS as FALLBACK_TOOLS } from '@/lib/agents/catalog';

export async function listAgents(privy: string, ws: string): Promise<Agent[]> {
  const { data } = await rpc('get_agents', { p_privy: privy, p_workspace: ws });
  return Array.isArray(data) ? data : [];
}

export async function saveAgent(privy: string, ws: string, a: Partial<Agent> & { id?: string | null }): Promise<{ id: string | null; error: any }> {
  const { data, error } = await rpc('save_agent', {
    p_privy: privy, p_workspace: ws, p_id: a.id ?? null,
    p_name: a.name || 'New agent', p_role: a.role || '', p_instructions: a.instructions || '',
    p_provider: a.provider || '', p_model: a.model || '',
    // The look-don't-touch default, not every read tool — an agent saved without
    // an explicit tool list should not silently arrive holding the ledger.
    p_allowed_tools: a.allowed_tools?.length ? a.allowed_tools : FALLBACK_TOOLS,
    p_allowed_objects: a.allowed_objects || [],
    p_autonomy: a.autonomy || 'suggest', p_max_steps: a.max_steps || 12,
    p_skill_ids: a.skill_ids || [],
    p_schedule: a.schedule || 'off',
    p_schedule_hour: typeof a.schedule_hour === 'number' ? a.schedule_hour : 9,
    p_schedule_task: a.schedule_task || '',
  });
  return { id: data ?? null, error };
}

export async function setAgentEnabled(privy: string, ws: string, id: string, enabled: boolean) {
  return rpc('set_agent_enabled', { p_privy: privy, p_workspace: ws, p_id: id, p_enabled: enabled });
}

export async function deleteAgent(privy: string, ws: string, id: string) {
  return rpc('delete_agent', { p_privy: privy, p_workspace: ws, p_id: id });
}

export async function listRuns(privy: string, ws: string): Promise<AgentRun[]> {
  const { data } = await rpc('get_agent_runs', { p_privy: privy, p_workspace: ws });
  return Array.isArray(data) ? data : [];
}

/**
 * Token spend by agent over a window (0096).
 *
 * `cached` is a SUBSET of `input`, never an addition — adding them
 * double-counts the cheap half of the bill. `unreported` is the number of runs
 * whose provider returned no usage at all, which the panel has to show: without
 * it a confident total would be missing an unknown share of the spend.
 */
export interface AgentUsageRow {
  agent_id: string | null; name: string; model: string;
  runs: number; input: number; output: number; cached: number;
}
export interface AgentUsage {
  days: number;
  totals: { runs: number; input: number; output: number; cached: number; unreported: number };
  by_agent: AgentUsageRow[];
}

export async function getAgentUsage(privy: string, ws: string, days = 30): Promise<AgentUsage | null> {
  const { data, error } = await rpc('get_agent_usage', { p_privy: privy, p_workspace: ws, p_days: days });
  // A missing function means 0096 has not been run. The panel hides itself
  // rather than showing an error over a feature nobody asked for yet.
  if (error || !data) return null;
  return data as AgentUsage;
}

// Run / approve go through dedicated verified routes (they use the BYO AI key).
async function post(path: string, body: any): Promise<any> {
  const token = await getAccessToken().catch(() => null);
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || `Request failed (${res.status})`);
  return j;
}

/**
 * `runId` is minted HERE, by the caller, and sent with the task.
 *
 * The route does not answer until the whole loop has finished, so an id that
 * came back in the response would arrive exactly when the live view stopped
 * being useful. Naming the run up front is what lets `getAgentRun` poll it from
 * the first second. `create_agent_run` (0095) falls back to a server id rather
 * than writing into an existing row, so a chosen id can never collide its way
 * into somebody else's run.
 */
export function runAgentTask(privy: string, ws: string, agentId: string, task: string, runId?: string) {
  return post('/api/agents/run', { privyUserId: privy, workspaceId: ws, agentId, task, runId });
}

/**
 * One run, by id — what the modal polls while the loop is still going (0095).
 *
 * Returns null both for "not found" and for a run in another workspace, which
 * is the same answer on purpose: a poll that could tell those apart would
 * confirm which run ids exist. A null here means "nothing to show yet", and the
 * caller keeps polling — the row appears a moment after the request starts.
 */
export async function getAgentRun(privy: string, runId: string): Promise<AgentRun | null> {
  const { data, error } = await rpc('get_agent_run', { p_privy: privy, p_id: runId });
  if (error || !data) return null;
  return data as AgentRun;
}

export function approveRun(privy: string, ws: string, runId: string) {
  return post('/api/agents/approve', { privyUserId: privy, workspaceId: ws, runId });
}
