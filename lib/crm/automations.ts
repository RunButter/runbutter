// Data layer for the Automations engine + integration layer (migration 0032).
// Privy pattern via getWorkspace(); Sample fallback so the pages always render.
import { supabase } from '@/lib/supabase';
import { getWorkspace } from './data';

export type AutomationEvent = 'created' | 'updated';
export interface Condition { field: string; op: string; value: string }
export interface Action { type: string; config: Record<string, any> }
export interface Automation {
  id: string; name: string; enabled: boolean; object: string; event: AutomationEvent;
  conditions: Condition[]; actions: Action[]; updated_at?: string;
}
export interface AutomationRun { id: string; automation_name: string | null; action_type: string | null; status: string; detail: string | null; created_at: string }
export interface Connection { id: string; label: string; kind: string; url: string; is_active: boolean }
export interface ApiKey { id: string; name: string; prefix: string; last_used_at: string | null; revoked: boolean; created_at: string }

const SAMPLE_AUTOMATIONS: Automation[] = [
  { id: 's1', name: 'Won deal → draft invoice', enabled: true, object: 'invoices', event: 'updated', conditions: [{ field: 'status', op: 'eq', value: 'paid' }], actions: [{ type: 'send_webhook', config: { label: 'Slack #finance' } }] },
  { id: 's2', name: 'New candidate → notify Slack', enabled: true, object: 'people', event: 'created', conditions: [], actions: [{ type: 'send_webhook', config: { label: 'Zapier' } }] },
  { id: 's3', name: 'Overdue invoice → email reminder', enabled: false, object: 'invoices', event: 'updated', conditions: [{ field: 'status', op: 'eq', value: 'overdue' }], actions: [{ type: 'send_email', config: {} }] },
];
const SAMPLE_RUNS: AutomationRun[] = [
  { id: 'r1', automation_name: 'New candidate → notify Slack', action_type: 'send_webhook', status: 'ok', detail: 'POST 200 · Zapier', created_at: '2026-07-05T09:12:00Z' },
  { id: 'r2', automation_name: 'Won deal → draft invoice', action_type: 'send_webhook', status: 'ok', detail: 'POST 200 · Slack #finance', created_at: '2026-07-05T08:41:00Z' },
  { id: 'r3', automation_name: 'Overdue invoice → email reminder', action_type: 'send_email', status: 'error', detail: 'RESEND_API_KEY not set', created_at: '2026-07-04T17:03:00Z' },
];
const SAMPLE_CONNECTIONS: Connection[] = [
  { id: 'c1', label: 'Slack #finance', kind: 'slack', url: 'https://hooks.slack.com/services/…', is_active: true },
  { id: 'c2', label: 'Zapier catch hook', kind: 'zapier', url: 'https://hooks.zapier.com/hooks/catch/…', is_active: true },
];

async function ws(privy: string | null): Promise<string | null> {
  if (!privy) return null;
  const w = await getWorkspace(privy);
  return w?.id ?? null;
}

// ── Automations ───────────────────────────────────────────────────────────────
export async function loadAutomations(privy: string | null): Promise<{ rows: Automation[]; live: boolean }> {
  const fallback = { rows: SAMPLE_AUTOMATIONS, live: false };
  const id = await ws(privy);
  if (!privy || !id) return fallback;
  const { data, error } = await supabase.rpc('get_automations', { p_privy: privy, p_workspace: id });
  if (error || !Array.isArray(data)) return fallback;
  return { rows: data as Automation[], live: true };
}

export async function saveAutomation(privy: string, id: string | null, data: Partial<Automation>): Promise<{ id?: string; error?: string }> {
  const wsId = await ws(privy);
  if (!wsId) return { error: 'No workspace found for your account.' };
  const { data: res, error } = await supabase.rpc('save_automation', { p_privy: privy, p_workspace: wsId, p_id: id, p_data: data });
  if (error) return { error: error.message };
  return { id: res as string };
}

export async function setAutomationEnabled(privy: string, id: string, enabled: boolean): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('set_automation_enabled', { p_privy: privy, p_id: id, p_enabled: enabled });
  return error ? { error: error.message } : {};
}

export async function deleteAutomation(privy: string, id: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('delete_automation', { p_privy: privy, p_id: id });
  return error ? { error: error.message } : {};
}

export async function loadAutomationRuns(privy: string | null): Promise<{ rows: AutomationRun[]; live: boolean }> {
  const fallback = { rows: SAMPLE_RUNS, live: false };
  const id = await ws(privy);
  if (!privy || !id) return fallback;
  const { data, error } = await supabase.rpc('get_automation_runs', { p_privy: privy, p_workspace: id, p_limit: 30 });
  if (error || !Array.isArray(data)) return fallback;
  return { rows: data as AutomationRun[], live: true };
}

// ── Connections (outgoing webhooks) ───────────────────────────────────────────
export async function loadConnections(privy: string | null): Promise<{ rows: Connection[]; live: boolean }> {
  const fallback = { rows: SAMPLE_CONNECTIONS, live: false };
  const id = await ws(privy);
  if (!privy || !id) return fallback;
  const { data, error } = await supabase.rpc('get_connections', { p_privy: privy, p_workspace: id });
  if (error || !Array.isArray(data)) return fallback;
  return { rows: data as Connection[], live: true };
}

export async function saveConnection(privy: string, id: string | null, c: { label: string; kind: string; url: string; is_active?: boolean }): Promise<{ id?: string; error?: string }> {
  const wsId = await ws(privy);
  if (!wsId) return { error: 'No workspace found for your account.' };
  const { data, error } = await supabase.rpc('save_connection', { p_privy: privy, p_workspace: wsId, p_id: id, p_label: c.label, p_kind: c.kind, p_url: c.url, p_active: c.is_active ?? true });
  if (error) return { error: error.message };
  return { id: data as string };
}

export async function deleteConnection(privy: string, id: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('delete_connection', { p_privy: privy, p_id: id });
  return error ? { error: error.message } : {};
}

// ── API keys (incoming REST / MCP) ────────────────────────────────────────────
export async function loadApiKeys(privy: string | null): Promise<{ rows: ApiKey[]; live: boolean }> {
  const fallback = { rows: [] as ApiKey[], live: false };
  const id = await ws(privy);
  if (!privy || !id) return fallback;
  const { data, error } = await supabase.rpc('get_api_keys', { p_privy: privy, p_workspace: id });
  if (error || !Array.isArray(data)) return fallback;
  return { rows: data as ApiKey[], live: true };
}

export async function createApiKey(privy: string, name: string): Promise<{ key?: string; error?: string }> {
  const wsId = await ws(privy);
  if (!wsId) return { error: 'No workspace found for your account.' };
  const { data, error } = await supabase.rpc('create_api_key', { p_privy: privy, p_workspace: wsId, p_name: name });
  if (error) return { error: error.message };
  return { key: data as string };
}

export async function revokeApiKey(privy: string, id: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('revoke_api_key', { p_privy: privy, p_id: id });
  return error ? { error: error.message } : {};
}
