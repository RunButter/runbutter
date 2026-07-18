'use client';

import { getAccessToken } from '@privy-io/react-auth';
import { rpc } from '@/lib/rpc';

export interface Agent {
  id: string; name: string; role: string; instructions: string;
  provider: string; model: string;
  allowed_tools: string[]; allowed_objects: string[];
  autonomy: 'suggest' | 'auto'; max_steps: number; enabled: boolean;
}

export interface AgentRun {
  id: string; agent_id: string | null; agent_name: string; task: string;
  status: 'running' | 'done' | 'error' | 'awaiting_approval';
  steps: any[]; proposed: any[]; result: string;
  created_at: string; finished_at: string | null;
}

export const READ_TOOLS = ['list_objects', 'list_records', 'search_records', 'get_record'];
export const WRITE_TOOLS = ['create_record', 'update_record'];
export const AGENT_OBJECTS = ['companies', 'people', 'invoices', 'offers', 'expenses', 'transactions', 'products', 'campaigns', 'projects', 'issues', 'assets'];

export async function listAgents(privy: string, ws: string): Promise<Agent[]> {
  const { data } = await rpc('get_agents', { p_privy: privy, p_workspace: ws });
  return Array.isArray(data) ? data : [];
}

export async function saveAgent(privy: string, ws: string, a: Partial<Agent> & { id?: string | null }): Promise<{ id: string | null; error: any }> {
  const { data, error } = await rpc('save_agent', {
    p_privy: privy, p_workspace: ws, p_id: a.id ?? null,
    p_name: a.name || 'New agent', p_role: a.role || '', p_instructions: a.instructions || '',
    p_provider: a.provider || '', p_model: a.model || '',
    p_allowed_tools: a.allowed_tools || READ_TOOLS,
    p_allowed_objects: a.allowed_objects || [],
    p_autonomy: a.autonomy || 'suggest', p_max_steps: a.max_steps || 12,
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

export function runAgentTask(privy: string, ws: string, agentId: string, task: string) {
  return post('/api/agents/run', { privyUserId: privy, workspaceId: ws, agentId, task });
}

export function approveRun(privy: string, ws: string, runId: string) {
  return post('/api/agents/approve', { privyUserId: privy, workspaceId: ws, runId });
}
