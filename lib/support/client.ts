'use client';

import { rpc } from '@/lib/rpc';

// The team side of the support inbox (0131), for the browser. Reads go through
// /api/rpc; a reply goes through /api/support/reply because it may email the
// visitor, which the database cannot do.

export type SupportStatus = 'open' | 'pending' | 'closed';
export type InboxView = SupportStatus | 'mine' | 'all';

export interface SupportWidget {
  id: string; enabled: boolean; title: string; greeting: string; color: string;
  ask_email: boolean; notify_email: string | null; can_edit: boolean;
}
export interface InboxRow {
  id: string; name: string | null; email: string | null; status: SupportStatus;
  assignee_privy: string | null; subject: string | null; preview: string | null;
  last_message_at: string; unread: boolean;
}
export interface InboxCounts { open: number; pending: number; closed: number; mine: number; unread: number }
export interface ThreadMessage { id: string; kind: 'visitor' | 'team' | 'agent' | 'note'; name: string | null; mine: boolean; body: string; at: string }
export interface Thread {
  id: string; name: string | null; email: string | null; status: SupportStatus;
  assignee_privy: string | null; page_url: string | null; person_id: string | null;
  created_at: string; visitor_seen_at: string | null; messages: ThreadMessage[];
}

const NOT_SET_UP = /support_|does not exist|PGRST202/i;
const explain = (m: string) => (NOT_SET_UP.test(m) ? 'The support inbox needs migration 0131 — run it in Supabase.' : m.replace(/^FORBIDDEN:\s*/, ''));

export async function loadWidget(privy: string, ws: string): Promise<{ widget?: SupportWidget; error?: string }> {
  const { data, error } = await rpc('get_support_widget', { p_privy: privy, p_workspace: ws });
  return error ? { error: explain(error.message) } : { widget: data as SupportWidget };
}

export async function saveWidget(privy: string, ws: string, patch: Partial<SupportWidget>): Promise<{ widget?: SupportWidget; error?: string }> {
  const { data, error } = await rpc('save_support_widget', { p_privy: privy, p_workspace: ws, p_data: patch });
  return error ? { error: explain(error.message) } : { widget: data as SupportWidget };
}

export async function loadInbox(privy: string, ws: string, view: InboxView): Promise<{ rows: InboxRow[]; counts: InboxCounts | null; error?: string }> {
  const { data, error } = await rpc('get_support_inbox', { p_privy: privy, p_workspace: ws, p_view: view }, { quiet: true });
  if (error) return { rows: [], counts: null, error: explain(error.message) };
  return { rows: (data as any)?.rows || [], counts: (data as any)?.counts || null };
}

export async function loadThread(privy: string, ws: string, id: string): Promise<{ thread?: Thread; error?: string }> {
  const { data, error } = await rpc('get_support_thread', { p_privy: privy, p_workspace: ws, p_id: id }, { quiet: true });
  return error ? { error: explain(error.message) } : { thread: data as Thread };
}

export async function setConversation(privy: string, ws: string, id: string, patch: { status?: SupportStatus; assignee?: string | null }) {
  const { error } = await rpc('set_support_conversation', {
    p_privy: privy, p_workspace: ws, p_id: id,
    p_status: patch.status ?? null,
    // undefined = leave it, null = unassign ('' in SQL).
    p_assignee: patch.assignee === undefined ? null : (patch.assignee ?? ''),
  });
  return error ? { error: explain(error.message) } : {};
}

export async function sendReply(privy: string, ws: string, id: string, body: string, note: boolean): Promise<{ error?: string; emailed?: boolean }> {
  try {
    const res = await fetch('/api/support/reply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privyUserId: privy, workspaceId: ws, conversationId: id, body, note }),
    });
    const d = await res.json().catch(() => ({}));
    return res.ok ? { emailed: !!d.emailed } : { error: explain(d.error || 'Could not send.') };
  } catch (e: any) { return { error: e?.message || 'Could not send.' }; }
}

export async function draftReply(privy: string, ws: string, id: string): Promise<{ text?: string; error?: string }> {
  try {
    const res = await fetch('/api/support/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privyUserId: privy, workspaceId: ws, conversationId: id }),
    });
    const d = await res.json().catch(() => ({}));
    return res.ok ? { text: d.text } : { error: d.error || 'Could not draft a reply.' };
  } catch (e: any) { return { error: e?.message || 'Could not draft a reply.' }; }
}

/** The embed snippet for a widget, on this deployment's own origin. */
export const embedSnippet = (origin: string, widgetId: string) =>
  `<script defer src="${origin}/support.js" data-widget="${widgetId}"></script>`;
