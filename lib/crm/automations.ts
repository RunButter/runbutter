// Data layer for the Automations engine + integration layer (migration 0032).
// Privy pattern via getWorkspace(); Sample fallback so the pages always render.
import { supabase } from '@/lib/supabase';
import { getWorkspace } from './data';
import { rpc } from '@/lib/rpc';

export type AutomationEvent = 'created' | 'updated';
export type TriggerType = 'event' | 'webhook' | 'schedule';
export interface Schedule { every: 'minute' | 'hour' | 'day'; at?: string }
export interface Condition { field: string; op: string; value: string }
export interface Action { type: string; config: Record<string, any> }
export interface Automation {
  id: string; name: string; enabled: boolean; trigger_type: TriggerType;
  object: string; event: AutomationEvent; conditions: Condition[]; actions: Action[];
  webhook_token?: string | null; schedule?: Schedule | null; updated_at?: string;
}
export interface AutomationRun { id: string; automation_name: string | null; action_type: string | null; status: string; detail: string | null; created_at: string }
export interface Connection { id: string; label: string; kind: string; url: string; is_active: boolean; secret?: string }
export interface WebhookDelivery { id: string; url: string | null; status: string; response_code: number | null; attempts: number; detail: string | null; created_at: string }
export interface ApiKey { id: string; name: string; prefix: string; scope?: 'full' | 'read'; last_used_at: string | null; revoked: boolean; created_at: string }

export interface Template { key: string; name: string; desc: string; tone: string; automation: Partial<Automation> }

// Popular starter recipes (Activepieces/Zapier style). Cover event, incoming
// webhook, and schedule triggers × webhook / email / create-record actions.
export const TEMPLATES: Template[] = [
  { key: 'new-person', name: 'New contact → Slack/Zapier', desc: 'When a person is added, POST them to a webhook.', tone: 'text-secondary bg-surface-sunken',
    automation: { name: 'New contact → webhook', trigger_type: 'event', object: 'people', event: 'created', conditions: [], actions: [{ type: 'send_webhook', config: {} }] } },
  { key: 'invoice-paid', name: 'Invoice paid → notify', desc: 'When an invoice is marked paid, ping your team.', tone: 'text-secondary bg-surface-sunken',
    automation: { name: 'Invoice paid → notify', trigger_type: 'event', object: 'invoices', event: 'updated', conditions: [{ field: 'status', op: 'eq', value: 'paid' }], actions: [{ type: 'send_webhook', config: {} }] } },
  { key: 'invoice-overdue', name: 'Overdue invoice → email', desc: 'Email a reminder when an invoice goes overdue.', tone: 'text-secondary bg-surface-sunken',
    automation: { name: 'Overdue → email reminder', trigger_type: 'event', object: 'invoices', event: 'updated', conditions: [{ field: 'status', op: 'eq', value: 'overdue' }], actions: [{ type: 'send_email', config: { subject: 'Invoice {{number}} is overdue', body: 'Hi — invoice {{number}} for {{amount}} is now overdue.' } }] } },
  { key: 'big-txn', name: 'Large transaction → alert', desc: 'Get pinged when a big transaction lands.', tone: 'text-secondary bg-surface-sunken',
    automation: { name: 'Large transaction alert', trigger_type: 'event', object: 'transactions', event: 'created', conditions: [{ field: 'amount', op: 'gt', value: '10000' }], actions: [{ type: 'send_webhook', config: {} }] } },
  { key: 'inbound-lead', name: 'Incoming webhook → new contact', desc: 'Give a form or tool a URL that creates a person.', tone: 'text-secondary bg-surface-sunken',
    automation: { name: 'Inbound lead → create contact', trigger_type: 'webhook', object: 'people', event: 'created', conditions: [], actions: [{ type: 'create_record', config: { object: 'people', data: { first_name: '{{first_name}}', last_name: '{{last_name}}', email: '{{email}}' }, _data: '{\n  "first_name": "{{first_name}}",\n  "last_name": "{{last_name}}",\n  "email": "{{email}}"\n}' } }] } },
  { key: 'daily-digest', name: 'Daily schedule → webhook', desc: 'Fire a webhook every day — e.g. a digest to Slack.', tone: 'text-secondary bg-surface-sunken',
    automation: { name: 'Daily digest', trigger_type: 'schedule', object: 'people', event: 'created', conditions: [], schedule: { every: 'day' }, actions: [{ type: 'send_webhook', config: {} }] } },
  { key: 'ai-brief', name: 'New contact → AI brief → Slack', desc: 'AI writes a two-line brief on each new contact, then posts it.', tone: 'text-secondary bg-surface-sunken',
    automation: { name: 'AI brief on new contact', trigger_type: 'event', object: 'people', event: 'created', conditions: [], actions: [
      { type: 'ask_ai', config: { prompt: 'Write a two-sentence brief on {{first_name}} {{last_name}} ({{title}}, source: {{source}}) for the team.' } },
      { type: 'send_webhook', config: {} },
    ] } },
];

export function webhookUrl(token?: string | null): string {
  if (!token) return '';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://runbutter.app';
  return `${origin}/api/hooks/${token}`;
}

const SAMPLE_AUTOMATIONS: Automation[] = [
  { id: 's1', name: 'Invoice paid → Slack', enabled: true, trigger_type: 'event', object: 'invoices', event: 'updated', conditions: [{ field: 'status', op: 'eq', value: 'paid' }], actions: [{ type: 'send_webhook', config: { label: 'Slack #finance' } }] },
  { id: 's2', name: 'New contact → notify Zapier', enabled: true, trigger_type: 'event', object: 'people', event: 'created', conditions: [], actions: [{ type: 'send_webhook', config: { label: 'Zapier' } }] },
  { id: 's3', name: 'Inbound lead → create contact', enabled: true, trigger_type: 'webhook', object: 'people', event: 'created', conditions: [], webhook_token: 'hook_sampletoken', actions: [{ type: 'create_record', config: { object: 'people' } }] },
  { id: 's4', name: 'Daily digest → webhook', enabled: false, trigger_type: 'schedule', object: 'people', event: 'created', conditions: [], schedule: { every: 'day' }, actions: [{ type: 'send_webhook', config: {} }] },
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
  const { data, error } = await rpc('get_automations', { p_privy: privy, p_workspace: id });
  if (error || !Array.isArray(data)) return fallback;
  return { rows: data as Automation[], live: true };
}

export async function saveAutomation(privy: string, id: string | null, data: Partial<Automation>): Promise<{ id?: string; error?: string }> {
  const wsId = await ws(privy);
  if (!wsId) return { error: 'No workspace found for your account.' };
  const { data: res, error } = await rpc('save_automation', { p_privy: privy, p_workspace: wsId, p_id: id, p_data: data });
  if (error) return { error: error.message };
  return { id: res as string };
}

export async function setAutomationEnabled(privy: string, id: string, enabled: boolean): Promise<{ error?: string }> {
  const { error } = await rpc('set_automation_enabled', { p_privy: privy, p_id: id, p_enabled: enabled });
  return error ? { error: error.message } : {};
}

export async function deleteAutomation(privy: string, id: string): Promise<{ error?: string }> {
  const { error } = await rpc('delete_automation', { p_privy: privy, p_id: id });
  return error ? { error: error.message } : {};
}

export async function loadAutomationRuns(privy: string | null): Promise<{ rows: AutomationRun[]; live: boolean }> {
  const fallback = { rows: SAMPLE_RUNS, live: false };
  const id = await ws(privy);
  if (!privy || !id) return fallback;
  const { data, error } = await rpc('get_automation_runs', { p_privy: privy, p_workspace: id, p_limit: 30 });
  if (error || !Array.isArray(data)) return fallback;
  return { rows: data as AutomationRun[], live: true };
}

export async function loadWebhookDeliveries(privy: string | null): Promise<{ rows: WebhookDelivery[]; live: boolean }> {
  const id = await ws(privy);
  if (!privy || !id) return { rows: [], live: false };
  const { data, error } = await rpc('get_webhook_deliveries', { p_privy: privy, p_workspace: id, p_limit: 20 });
  if (error || !Array.isArray(data)) return { rows: [], live: false };
  return { rows: data as WebhookDelivery[], live: true };
}

// ── Connections (outgoing webhooks) ───────────────────────────────────────────
export async function loadConnections(privy: string | null): Promise<{ rows: Connection[]; live: boolean }> {
  const fallback = { rows: SAMPLE_CONNECTIONS, live: false };
  const id = await ws(privy);
  if (!privy || !id) return fallback;
  const { data, error } = await rpc('get_connections', { p_privy: privy, p_workspace: id });
  if (error || !Array.isArray(data)) return fallback;
  return { rows: data as Connection[], live: true };
}

export async function saveConnection(privy: string, id: string | null, c: { label: string; kind: string; url: string; is_active?: boolean }): Promise<{ id?: string; error?: string }> {
  const wsId = await ws(privy);
  if (!wsId) return { error: 'No workspace found for your account.' };
  const { data, error } = await rpc('save_connection', { p_privy: privy, p_workspace: wsId, p_id: id, p_label: c.label, p_kind: c.kind, p_url: c.url, p_active: c.is_active ?? true });
  if (error) return { error: error.message };
  return { id: data as string };
}

export async function deleteConnection(privy: string, id: string): Promise<{ error?: string }> {
  const { error } = await rpc('delete_connection', { p_privy: privy, p_id: id });
  return error ? { error: error.message } : {};
}

// ── API keys (incoming REST / MCP) ────────────────────────────────────────────
export async function loadApiKeys(privy: string | null): Promise<{ rows: ApiKey[]; live: boolean }> {
  const fallback = { rows: [] as ApiKey[], live: false };
  const id = await ws(privy);
  if (!privy || !id) return fallback;
  const { data, error } = await rpc('get_api_keys', { p_privy: privy, p_workspace: id });
  if (error || !Array.isArray(data)) return fallback;
  return { rows: data as ApiKey[], live: true };
}

export async function createApiKey(privy: string, name: string, scope: 'full' | 'read' = 'full'): Promise<{ key?: string; error?: string }> {
  const wsId = await ws(privy);
  if (!wsId) return { error: 'No workspace found for your account.' };
  const { data, error } = await rpc('create_api_key', { p_privy: privy, p_workspace: wsId, p_name: name, p_scope: scope });
  if (error) return { error: error.message };
  return { key: data as string };
}

// ── Spreadsheet feed (Excel / Sheets / Power BI) ──────────────────────────────
// The objects worth pulling into a spreadsheet. Deliberately the same list the
// REST bridge allows, minus nothing — if it is readable over the API it is
// readable as a table.
export const FEED_OBJECTS = [
  'people', 'companies', 'invoices', 'offers', 'expenses', 'transactions',
  'products', 'campaigns', 'projects', 'issues', 'assets',
] as const;

/**
 * The URL a user pastes into Excel's "From Web" box.
 *
 * The key travels in the query string because Power Query's basic dialog cannot
 * send an Authorization header — that is the whole reason read-only scopes
 * exist (0078). Absolute, because Excel has no notion of "this site".
 */
export function feedUrl(object: string, key: string): string {
  const base = typeof window !== 'undefined'
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_SITE_URL || 'https://runbutter.app');
  return `${base}/api/v1/records?object=${encodeURIComponent(object)}&format=csv&key=${encodeURIComponent(key)}`;
}

export async function revokeApiKey(privy: string, id: string): Promise<{ error?: string }> {
  const { error } = await rpc('revoke_api_key', { p_privy: privy, p_id: id });
  return error ? { error: error.message } : {};
}
