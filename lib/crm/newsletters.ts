'use client';

import { rpc } from '@/lib/rpc';
import type { TemplateKey, NewsletterContent } from '@/lib/marketing/newsletter-templates';

export interface NewsletterList {
  id: string; name: string; description: string;
  opt_in: 'single' | 'double'; subscriber_count: number; updated_at?: string;
}

export interface Subscriber {
  id: string; email: string; name: string;
  status: 'enabled' | 'unconfirmed' | 'unsubscribed' | 'bounced' | 'complained';
  person_id: string | null; consent_source: string; consent_at: string | null; created_at: string;
}

export interface NewsletterRow {
  id: string; subject: string; preheader: string; template: TemplateKey;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'paused' | 'cancelled';
  scheduled_at: string | null; started_at: string | null; finished_at: string | null;
  sent_count: number; open_count: number; click_count: number;
  list_ids: string[]; updated_at: string;
}

export interface NewsletterFull extends NewsletterRow {
  content: NewsletterContent; from_name: string; reply_to: string;
}

export async function listNewsletterLists(privy: string, ws: string): Promise<NewsletterList[]> {
  const { data } = await rpc('get_newsletter_lists', { p_privy: privy, p_workspace: ws });
  return Array.isArray(data) ? data : [];
}

export async function saveNewsletterList(privy: string, ws: string, l: Partial<NewsletterList> & { id?: string | null }) {
  return rpc('save_newsletter_list', {
    p_privy: privy, p_workspace: ws, p_id: l.id ?? null,
    p_name: l.name || 'New list', p_description: l.description || '', p_opt_in: l.opt_in || 'single',
  });
}

export const deleteNewsletterList = (privy: string, ws: string, id: string) =>
  rpc('delete_newsletter_list', { p_privy: privy, p_workspace: ws, p_id: id });

export async function listSubscribers(
  privy: string, ws: string, opts: { list?: string | null; query?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: Subscriber[]; total: number }> {
  const { data } = await rpc('get_newsletter_subscribers', {
    p_privy: privy, p_workspace: ws, p_list: opts.list ?? null,
    p_query: opts.query ?? null, p_limit: opts.limit ?? 50, p_offset: opts.offset ?? 0,
  });
  const d = data as any;
  return { rows: Array.isArray(d?.rows) ? d.rows : [], total: Number(d?.total ?? 0) };
}

export async function addSubscriber(
  privy: string, ws: string, email: string, name: string, list: string | null, source = 'manual',
): Promise<{ error?: string }> {
  const { error } = await rpc('upsert_newsletter_subscriber', {
    p_privy: privy, p_workspace: ws, p_email: email, p_name: name,
    p_list: list, p_source: source, p_ip: null, p_status: 'enabled',
  });
  if (!error) return {};
  if (/BAD_EMAIL/.test(error.message)) return { error: `"${email}" is not a valid email address.` };
  return { error: error.message };
}

export const setSubscriberStatus = (privy: string, ws: string, id: string, status: Subscriber['status']) =>
  rpc('set_newsletter_subscriber_status', { p_privy: privy, p_workspace: ws, p_id: id, p_status: status });

export const deleteSubscriber = (privy: string, ws: string, id: string) =>
  rpc('delete_newsletter_subscriber', { p_privy: privy, p_workspace: ws, p_id: id });

export async function listNewsletters(privy: string, ws: string): Promise<NewsletterRow[]> {
  const { data } = await rpc('get_newsletters', { p_privy: privy, p_workspace: ws });
  return Array.isArray(data) ? data : [];
}

export async function getNewsletter(privy: string, ws: string, id: string): Promise<NewsletterFull | null> {
  const { data } = await rpc('get_newsletter', { p_privy: privy, p_workspace: ws, p_id: id });
  return (data as any) ?? null;
}

export async function saveNewsletter(
  privy: string, ws: string, n: Partial<NewsletterFull> & { id?: string | null },
): Promise<{ id: string | null; error?: string }> {
  const { data, error } = await rpc('save_newsletter', {
    p_privy: privy, p_workspace: ws, p_id: n.id ?? null,
    p_subject: n.subject ?? '', p_preheader: n.preheader ?? '',
    p_template: n.template ?? 'plain', p_content: n.content ?? {},
    p_from_name: n.from_name ?? '', p_reply_to: n.reply_to ?? '',
    p_list_ids: n.list_ids ?? [],
  });
  if (!error) return { id: (data as any) ?? null };
  if (/ALREADY_SENT/.test(error.message)) return { id: null, error: 'This newsletter has already started sending and can no longer be edited.' };
  if (/CONTENT_TOO_LARGE/.test(error.message)) return { id: null, error: 'This newsletter is too large to save.' };
  return { id: null, error: error.message };
}

export async function deleteNewsletter(privy: string, ws: string, id: string): Promise<{ error?: string }> {
  const { error } = await rpc('delete_newsletter', { p_privy: privy, p_workspace: ws, p_id: id });
  if (!error) return {};
  if (/ALREADY_SENT/.test(error.message)) return { error: 'A newsletter that has been sent is kept, so its delivery history stays explicable.' };
  return { error: error.message };
}

/** Materialise the audience and schedule. `when` null = as soon as the cron runs. */
export async function queueNewsletter(
  privy: string, ws: string, id: string, when: string | null,
): Promise<{ queued?: number; error?: string }> {
  const { data, error } = await rpc('queue_newsletter', {
    p_privy: privy, p_workspace: ws, p_id: id, p_when: when,
  });
  if (!error) return { queued: Number((data as any)?.queued ?? 0) };
  if (/NO_LISTS/.test(error.message)) return { error: 'Choose at least one list before sending.' };
  if (/ALREADY_SENT/.test(error.message)) return { error: 'This newsletter has already been sent.' };
  return { error: error.message };
}

export const cancelNewsletter = (privy: string, ws: string, id: string) =>
  rpc('cancel_newsletter', { p_privy: privy, p_workspace: ws, p_id: id });

/**
 * Draft a newsletter from a brief on the workspace's own AI key. Returns the
 * draft for a human to edit — it never saves and never sends.
 */
export async function draftNewsletter(
  privy: string, ws: string, template: TemplateKey, brief: string,
): Promise<{ draft?: { subject: string; preheader: string; content: NewsletterContent }; error?: string }> {
  const { getAccessToken } = await import('@privy-io/react-auth');
  const token = await getAccessToken().catch(() => null);
  const res = await fetch('/api/newsletters/draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
    body: JSON.stringify({ privyUserId: privy, workspaceId: ws, template, brief }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { error: j?.error || `Draft failed (${res.status})` };
  return { draft: j.draft };
}

/**
 * Parse a pasted CSV or newline list into { email, name } pairs.
 *
 * Local, not a dependency and not a server round-trip: the whole point is that
 * someone can paste a column straight out of a spreadsheet. Accepts "email",
 * "email,name", "name,email" and "Name <email>", skips a header row (it has no
 * valid address on it, so the same filter handles it), and de-duplicates
 * case-insensitively — the same address twice must not produce two upserts.
 */
export function parseSubscriberPaste(text: string): { email: string; name: string }[] {
  const seen = new Set<string>();
  const out: { email: string; name: string }[] = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    let email = '', name = '';
    const angled = line.match(/^(.*?)<([^>]+)>$/);
    if (angled) {
      name = angled[1].trim().replace(/^["']|["']$/g, '');
      email = angled[2].trim();
    } else {
      const parts = line.split(/[,;\t]/).map((p) => p.trim().replace(/^["']|["']$/g, ''));
      email = parts.find((p) => p.includes('@')) || '';
      name = parts.filter((p) => p !== email).join(' ').trim();
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ email, name });
  }
  return out;
}
