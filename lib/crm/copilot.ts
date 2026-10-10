'use client';

import { describeTrigger, actionLabel } from '@/lib/automations/vocab';
import { getAccessToken } from '@privy-io/react-auth';
import { rpc } from '@/lib/rpc';

/**
 * The Copilot's client half (0102).
 *
 * Reads go through the /api/rpc proxy like every other browser call; the TURN
 * goes to /api/copilot/chat, because it decrypts the workspace's AI key and
 * writes assistant messages — neither of which a browser may do.
 */

export interface CopilotStep {
  type: 'thought' | 'tool' | 'error' | 'approved';
  text?: string; name?: string; args?: any; result?: any;
  status?: 'running'; message?: string; results?: any[];
}

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  page_path: string;
  created_at: string;
  run_id: string | null;
  /** From the joined run. Null on a user turn, and on an assistant turn whose run was deleted. */
  status: string | null;
  steps: CopilotStep[] | null;
  proposed: { name: string; args: any }[] | null;
}

export interface CopilotThread {
  id: string; title: string; autonomy: 'suggest' | 'auto';
  messages: CopilotMessage[];
}
export interface CopilotThreadRow {
  id: string; title: string; autonomy: 'suggest' | 'auto'; updated_at: string;
}

/**
 * Every read returns null on error rather than throwing.
 *
 * A workspace that has not run 0102 has no `copilot_threads`, and the panel
 * has to degrade to "not available yet" rather than crashing the app shell it
 * is mounted inside — it renders on every screen, so an exception here would
 * take the whole product down rather than one page.
 */
export async function listThreads(privy: string, ws: string): Promise<CopilotThreadRow[] | null> {
  const { data, error } = await rpc('get_copilot_threads', { p_privy: privy, p_workspace: ws, p_limit: 30 });
  if (error || !Array.isArray(data)) return null;
  return data as CopilotThreadRow[];
}

export async function loadThread(privy: string, id: string): Promise<CopilotThread | null> {
  const { data, error } = await rpc('get_copilot_thread', { p_privy: privy, p_thread: id });
  if (error || !data) return null;
  return data as CopilotThread;
}

export async function newThread(privy: string, ws: string, autonomy: 'suggest' | 'auto'): Promise<string | null> {
  const { data, error } = await rpc('create_copilot_thread', { p_privy: privy, p_workspace: ws, p_autonomy: autonomy });
  if (error || typeof data !== 'string') return null;
  return data;
}

export async function setThread(privy: string, id: string, patch: { title?: string; autonomy?: 'suggest' | 'auto' }): Promise<void> {
  await rpc('set_copilot_thread', {
    p_privy: privy, p_thread: id,
    p_title: patch.title ?? null, p_autonomy: patch.autonomy ?? null,
  });
}

export async function removeThread(privy: string, id: string): Promise<void> {
  await rpc('delete_copilot_thread', { p_privy: privy, p_thread: id });
}

/**
 * The live run, polled while a turn is in flight (0095).
 *
 * NO p_workspace. get_agent_run derives the caller's workspaces from p_privy in
 * SQL, and PostgREST resolves functions by argument NAME — so passing a third
 * argument did not widen the query, it failed to match any function at all.
 * Every poll returned PGRST202, pollRun returned null on the error, and the
 * live step list never moved: the panel sat on "working…" until the turn
 * finished and the whole run arrived at once. Failing closed is why it looked
 * like latency rather than a bug.
 */
export async function pollRun(privy: string, runId: string): Promise<{ status: string; steps: CopilotStep[] } | null> {
  const { data, error } = await rpc('get_agent_run', { p_privy: privy, p_id: runId });
  if (error || !data) return null;
  const d = data as any;
  return { status: d.status, steps: Array.isArray(d.steps) ? d.steps : [] };
}

async function post(path: string, body: any): Promise<any> {
  const token = await getAccessToken().catch(() => null);
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { error: json?.error || `Request failed (${res.status})` };
  return json;
}

export interface TurnResult {
  runId?: string;
  status?: 'done' | 'error' | 'awaiting_approval';
  result?: string;
  proposed?: { name: string; args: any }[];
  error?: string;
}

export function send(privy: string, ws: string, threadId: string, message: string, page: any, runId: string): Promise<TurnResult> {
  return post('/api/copilot/chat', { privyUserId: privy, workspaceId: ws, threadId, message, page, runId });
}

export function approve(privy: string, ws: string, runId: string): Promise<{ ok?: boolean; results?: any[]; error?: string }> {
  return post('/api/agents/approve', { privyUserId: privy, workspaceId: ws, runId });
}

/**
 * A tool call, in words.
 *
 * `create_record {object: 'companies'}` is what happened and not what to show
 * someone — a transcript that reads like a stack trace is a transcript people
 * stop reading, and the whole value of suggest mode is that a person actually
 * looks at what is proposed before saying yes.
 */
/**
 * "companies" → "company", not "companie".
 *
 * Object slugs are plural and every one of these strings reads "a <singular>",
 * so a bare `replace(/s$/,'')` is wrong on the most common object in the
 * product. `people` is irregular and is the second most common, so it is worth
 * naming rather than leaving to a rule.
 */
export function singular(slug: string): string {
  const s = String(slug || '').replace(/_/g, ' ').trim();
  if (!s) return '';
  const irregular: Record<string, string> = { people: 'person', children: 'child' };
  if (irregular[s]) return irregular[s];
  if (/ss$/i.test(s)) return s;              // "address" is not a plural
  if (/[^aeiou]ies$/i.test(s)) return s.slice(0, -3) + 'y';
  // x/z/ch/sh always took an -es to become plural, so -es always comes off.
  if (/(xes|zes|ches|shes)$/i.test(s)) return s.slice(0, -2);
  // "-ses" is genuinely ambiguous — "addresses" is address+es and "expenses" is
  // expense+s — and both are real objects here. The test that decides it: drop
  // the "es" and see whether what is left ends in a doubled s. "addresses" →
  // "address" (keep), "expenses" → "expens" (wrong, so drop only the "s" and
  // get "expense"). Worth the four lines: `expens` shipped in a proposal card
  // is the kind of wrong that makes people doubt the rest of the sentence.
  if (/ses$/i.test(s)) return /ss$/i.test(s.slice(0, -2)) ? s.slice(0, -2) : s.slice(0, -1);
  return s.replace(/s$/i, '');
}

/** "an issue", "a deal" — the approval card is read by a person, and "a issue" reads like a bug. */
const an = (w: string) => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;

export function describeCall(name: string, args: any): string {
  const obj = args?.object ? String(args.object).replace(/_/g, ' ') : '';
  const one = singular(args?.object || '');
  const label = (a: any) => a?.data?.name || a?.data?.title || a?.data?.number || a?.name || '';
  switch (name) {
    case 'create_record': return `Create ${an(one)}${label(args) ? ` — ${label(args)}` : ''}`;
    case 'update_record': return `Update ${an(one)}`;
    case 'add_record_note': return `Add a note to ${an(one || 'record')}`;
    case 'propose_object': return `Create a new record type — ${args?.plural || args?.slug || 'object'}`;
    case 'propose_agent': return `${args?.id ? 'Change' : 'Create'} the agent “${args?.name || 'New agent'}”${Array.isArray(args?.tools) ? ` with ${args.tools.length} tools` : ''}`;
    case 'run_agent': return `Hand a task to an agent${args?.task ? ` — “${String(args.task).slice(0, 80)}”` : ''}`;
    case 'reply_conversation': return args?.note ? 'Add an internal note to a support conversation' : `Reply to a customer: “${String(args?.body || '').slice(0, 80)}${String(args?.body || '').length > 80 ? '…' : ''}”`;
    case 'save_order': return `Draft an order${Array.isArray(args?.items) ? ` with ${args.items.length} line${args.items.length === 1 ? '' : 's'}` : ''}${args?.customer ? ` for ${args.customer}` : ''}`;
    case 'save_position': return `${args?.id ? 'Update' : 'Open'} the role “${args?.title || 'untitled'}”${args?.is_published ? ' and publish it on the careers page' : ''}`;
    case 'save_form': return `${args?.id ? 'Update' : 'Build'} the form “${args?.name || 'Form'}”`;
    case 'create_short_link': return `Create a short link to ${args?.target || 'a URL'}`;
    case 'save_segment': return `Save the audience segment “${args?.name || 'Segment'}”`;
    case 'save_cap_holder': return `Add ${args?.name || 'a holder'} to the cap table${args?.security?.kind ? ` with ${args.security.kind}` : ''}`;
    case 'invite_member': return `Invite ${args?.email || 'someone'} as ${args?.role || 'member'}`;
    case 'set_member_role': return `Make ${args?.name || 'a member'} ${args?.role || ''}${args?.from ? ` (was ${args.from})` : ''}`;
    case 'update_workspace': {
      const parts = [args?.name && `rename to “${args.name}”`, args?.branding && `update branding (${Object.keys(args.branding).join(', ')})`, Array.isArray(args?.hidden_modules) && `hide ${args.hidden_modules.length} module${args.hidden_modules.length === 1 ? '' : 's'}`].filter(Boolean);
      return `Company settings: ${parts.join('; ') || 'no change'}`;
    }
    case 'propose_automation': {
      // The approved card is the same sentence the Automations screen shows.
      // Live steps carry the model's raw args (`trigger`, `every`); the stored
      // proposal carries the normalised shape — read both.
      const a = { trigger_type: args?.trigger_type || args?.trigger || 'event', object: args?.object || '', event: args?.event || 'created',
        conditions: args?.conditions || [], schedule: args?.schedule || (args?.every ? { every: args.every, at: args.at, day: args.day } : null) };
      return `Automation “${args?.name || 'Untitled'}”: ${describeTrigger(a)} → ${(args?.actions || []).map((x: any) => actionLabel(x?.type).toLowerCase()).join(', then ')}`;
    }
    case 'propose_field': return `Add a ${args?.type || ''} field “${args?.label || ''}” to ${String(args?.object || '').replace(/_/g, ' ')}`;
    case 'save_document': {
      const n = Array.isArray(args?.lines) ? args.lines.length : 0;
      const what = args?.kind === 'offer' ? 'offer' : 'invoice';
      return `${args?.id ? 'Update' : 'Draft'} an ${what}${n ? ` with ${n} line${n === 1 ? '' : 's'}` : ''}`;
    }
    case 'call_connection': return `Send data to a saved connection`;
    case 'list_records': return `List ${obj || 'records'}`;
    case 'search_records': return `Search ${obj || 'records'}${args?.q ? ` for “${args.q}”` : ''}`;
    case 'get_record': return `Read one ${one || 'record'}`;
    case 'list_objects': return 'Look at the record types';
    case 'search_files': return `Search files${args?.q ? ` for “${args.q}”` : ''}`;
    case 'get_finance_summary': return 'Read money in and out';
    case 'screen_sanctions': return `Screen ${args?.name || 'a name'} against sanctions lists`;
    default: return name.replace(/_/g, ' ');
  }
}
