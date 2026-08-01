'use client';

import { rpc } from '@/lib/rpc';

export interface Channel {
  id: string; name: string; topic: string; is_private: boolean;
  linked_object: string | null; linked_id: string | null;
  joined: boolean; unread: number; updated_at: string;
}

export interface Message {
  id: string; author_privy: string; author_name: string;
  author_kind: 'user' | 'agent' | 'system';
  body: string; deleted: boolean; edited_at: string | null; created_at: string;
}

export async function listChannels(privy: string, ws: string): Promise<Channel[]> {
  const { data } = await rpc('get_channels', { p_privy: privy, p_workspace: ws });
  return Array.isArray(data) ? data : [];
}

export async function createChannel(
  privy: string, ws: string, name: string,
  opts: { topic?: string; isPrivate?: boolean; object?: string | null; id?: string | null } = {},
): Promise<{ id: string | null; error?: string }> {
  const { data, error } = await rpc('create_channel', {
    p_privy: privy, p_workspace: ws, p_name: name, p_topic: opts.topic || '',
    p_private: Boolean(opts.isPrivate), p_object: opts.object ?? null, p_id: opts.id ?? null,
  });
  if (error) return { id: null, error: error.message };
  return { id: (data as any) ?? null };
}

export const deleteChannel = (privy: string, ws: string, id: string) =>
  rpc('delete_channel', { p_privy: privy, p_workspace: ws, p_id: id });

export const joinChannel = (privy: string, id: string) =>
  rpc('join_channel', { p_privy: privy, p_id: id });

export const leaveChannel = (privy: string, id: string) =>
  rpc('leave_channel', { p_privy: privy, p_id: id });

export async function listMessages(
  privy: string, channel: string, before?: string | null, limit = 50,
): Promise<Message[]> {
  const { data } = await rpc('get_messages', {
    p_privy: privy, p_channel: channel, p_before: before ?? null, p_limit: limit,
  });
  return Array.isArray(data) ? data : [];
}

export async function postMessage(
  privy: string, channel: string, body: string, authorName: string,
): Promise<{ id: string | null; error?: string }> {
  const { data, error } = await rpc('post_message', {
    p_privy: privy, p_channel: channel, p_body: body, p_author_name: authorName,
  });
  if (!error) return { id: (data as any) ?? null };
  if (/EMPTY_MESSAGE/.test(error.message)) return { id: null, error: 'Write something first.' };
  if (/NO_ACCESS/.test(error.message)) return { id: null, error: 'You no longer have access to this channel.' };
  return { id: null, error: error.message };
}

export const editMessage = (privy: string, id: string, body: string) =>
  rpc('edit_message', { p_privy: privy, p_id: id, p_body: body });

export const deleteMessage = (privy: string, id: string) =>
  rpc('delete_message', { p_privy: privy, p_id: id });

export const markChannelRead = (privy: string, channel: string) =>
  rpc('mark_channel_read', { p_privy: privy, p_channel: channel });

/**
 * How often the open channel re-fetches.
 *
 * Polling, not a websocket. Supabase Realtime pushes Postgres changes to the
 * BROWSER using the anon key and RLS policies, and this project revokes
 * anon/authenticated everywhere and routes reads through the verified /api/rpc
 * proxy (0040/0046). Opening RLS on `messages` purely to get a socket would
 * reintroduce the hole that proxy closed. Four seconds is well inside what reads
 * as live in a team channel; the honest upgrade is a server-side SSE endpoint,
 * not loosened RLS.
 */
export const POLL_MS = 4000;

/** Group consecutive messages from the same author within five minutes. */
export function groupMessages(msgs: Message[]): Message[][] {
  const out: Message[][] = [];
  for (const m of msgs) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    const near = prev
      && prev.author_privy === m.author_privy
      && prev.author_kind === m.author_kind
      && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
    if (near) last.push(m); else out.push([m]);
  }
  return out;
}
