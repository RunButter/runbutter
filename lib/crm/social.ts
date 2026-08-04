'use client';

import { rpc } from '@/lib/rpc';
import { getAccessToken } from '@privy-io/react-auth';

/**
 * Client side of social publishing (0082/0083).
 *
 * Note what is NOT here: nothing reads or sends a token. The browser names an
 * account by id and the server decides everything else — which is the same
 * boundary `call_connection` draws for agents, for the same reason.
 */

export type SocialProvider = 'linkedin' | 'x';

export interface SocialAccount {
  id: string;
  provider: SocialProvider;
  display_name: string;
  avatar_url: string | null;
  enabled: boolean;
  expired: boolean;
  last_error: string | null;
  created_at: string;
}

export interface PostTarget {
  id: string;
  account_id: string;
  provider: SocialProvider;
  display_name: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';
  scheduled_at: string | null;
  sent_at: string | null;
  provider_url: string | null;
  error: string | null;
}

export const PROVIDER_LABEL: Record<SocialProvider, string> = { linkedin: 'LinkedIn', x: 'X' };
/** Enforced again server-side before the network call; this is just the counter. */
export const PROVIDER_MAX_CHARS: Record<SocialProvider, number> = { linkedin: 3000, x: 280 };

/** 0082/0083 may not be applied yet; the panels say so rather than showing an error. */
const NOT_SET_UP = /schema cache|does not exist|Could not find the function/i;
export const needsMigration = (m?: string) => !!m && NOT_SET_UP.test(m);

export async function loadSocialAccounts(privy: string, ws: string): Promise<{ rows: SocialAccount[]; error?: string }> {
  const { data, error } = await rpc('get_social_accounts', { p_privy: privy, p_workspace: ws });
  if (error) {
    return { rows: [], error: needsMigration(error.message)
      ? 'Social publishing needs migration 0082 — run it in Supabase.'
      : error.message };
  }
  return { rows: Array.isArray(data) ? (data as SocialAccount[]) : [] };
}

/**
 * Ask the server for an authorize URL, then send the browser there.
 *
 * A full navigation rather than a popup: OAuth consent screens routinely break
 * inside popups (platform CSP, blocked openers, mobile), and the callback
 * lands back on Settings → Integrations anyway.
 */
export async function connectSocial(provider: SocialProvider): Promise<{ error?: string }> {
  try {
    const token = await getAccessToken().catch(() => null);
    const res = await fetch(`/api/social/connect/${provider}`, {
      headers: token ? { 'x-privy-token': token } : {},
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.url) return { error: body?.error || `Could not start the ${PROVIDER_LABEL[provider]} connection.` };
    window.location.href = body.url;
    return {};
  } catch (e: any) {
    return { error: e?.message || 'Could not start the connection.' };
  }
}

export async function setSocialAccountEnabled(privy: string, ws: string, id: string, enabled: boolean) {
  const { error } = await rpc('set_social_account_enabled', { p_privy: privy, p_workspace: ws, p_id: id, p_enabled: enabled });
  return error ? { error: error.message } : {};
}

export async function disconnectSocialAccount(privy: string, ws: string, id: string) {
  const { error } = await rpc('delete_social_account', { p_privy: privy, p_workspace: ws, p_id: id });
  return error ? { error: error.message } : {};
}

// ── Targets on a post ───────────────────────────────────────────────────────
export async function loadPostTargets(privy: string, postId: string): Promise<{ rows: PostTarget[]; error?: string }> {
  const { data, error } = await rpc('get_post_targets', { p_privy: privy, p_post: postId });
  if (error) {
    return { rows: [], error: needsMigration(error.message)
      ? 'Publishing needs migration 0083 — run it in Supabase.'
      : error.message };
  }
  return { rows: Array.isArray(data) ? (data as PostTarget[]) : [] };
}

export async function savePostTargets(
  privy: string, ws: string, postId: string, accountIds: string[], scheduledAt: string | null,
): Promise<{ rows: PostTarget[]; error?: string }> {
  const { data, error } = await rpc('set_post_targets', {
    p_privy: privy, p_workspace: ws, p_post: postId,
    p_accounts: accountIds, p_scheduled_at: scheduledAt,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: Array.isArray(data) ? (data as PostTarget[]) : [] };
}

/**
 * Mark this post's pending targets due, then nudge the dispatcher.
 *
 * The nudge is fire-and-forget on purpose. It is an optimisation — the cron
 * would pick the post up within the minute regardless — and making the button
 * wait on a network round trip to a social platform would leave someone staring
 * at a spinner for ten seconds to learn something the status list will tell
 * them anyway.
 */
export async function publishNow(privy: string, ws: string, postId: string): Promise<{ rows: PostTarget[]; error?: string }> {
  const { data, error } = await rpc('publish_post_now', { p_privy: privy, p_workspace: ws, p_post: postId });
  if (error) {
    if (/NOTHING_TO_PUBLISH/.test(error.message)) {
      return { rows: [], error: 'Nothing to publish — pick an account first, or it has already gone out.' };
    }
    return { rows: [], error: error.message };
  }
  fetch('/api/posts/tick', { method: 'POST' }).catch(() => {});
  return { rows: Array.isArray(data) ? (data as PostTarget[]) : [] };
}
