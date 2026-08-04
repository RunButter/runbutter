import type { SupabaseClient } from '@supabase/supabase-js';
import { providerFor, sealTokens, openSecret, type ProviderId } from './providers';

/**
 * The one place a post reaches a platform.
 *
 * AT-MOST-ONCE, exactly like the newsletter sender (0071) and for the same
 * reason. A target is claimed to 'sending' in SQL BEFORE the provider call, and
 * a claim that never resolves is swept to 'failed' — never back to 'pending'.
 * A post published twice to a company's real audience is a public incident with
 * no undo; a post that did not go out is a support question. Every instinct to
 * add a retry here is the bug this shape exists to prevent.
 *
 * "Publish now" and the scheduler both go through `claim_post_targets`, so
 * there is one code path that can talk to a platform and one place the rule has
 * to hold.
 */

interface Claim {
  id: string;
  post_id: string;
  account_id: string;
  workspace_id: string;
  provider: ProviderId;
  account_enabled: boolean;
  content: string;
  image_url: string | null;
}

export interface DispatchStats { claimed: number; sent: number; failed: number; skipped: number; swept: number }

/**
 * A usable access token, refreshing when it is close to expiry.
 *
 * The 5-minute margin is not superstition: a token that expires mid-request
 * fails the publish, and a failed publish is unrecoverable under at-most-once —
 * we cannot safely retry it, so it is worth refreshing early.
 */
async function accessToken(db: SupabaseClient, accountId: string): Promise<{ token: string; externalId: string }> {
  const { data, error } = await db.rpc('get_social_token', { p_account: accountId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('ACCOUNT_DISABLED');

  const row = data as any;
  const expires = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const fresh = !expires || expires - Date.now() > 5 * 60 * 1000;
  if (fresh && row.access_cipher) {
    return { token: openSecret(row.access_cipher, row.access_iv, row.access_tag), externalId: row.external_id };
  }

  // Expired (or nearly). Some platforms — LinkedIn among them — do not issue
  // refresh tokens at all, so this is a reconnect, not a retry.
  if (!row.refresh_cipher) throw new Error('RECONNECT_REQUIRED');
  const provider = providerFor(row.provider);
  const refreshToken = openSecret(row.refresh_cipher, row.refresh_iv, row.refresh_tag);

  let next;
  try {
    next = await provider.refresh(refreshToken);
  } catch (e: any) {
    // A rejected refresh is a revoked grant far more often than a transient
    // fault, so it is recorded against the account: the fix is a human
    // reconnecting, and the UI can only say that if the row says it.
    throw new Error(e?.message === 'NO_REFRESH' ? 'RECONNECT_REQUIRED' : `RECONNECT_REQUIRED: ${e?.message || 'refresh failed'}`);
  }

  // Persist before returning. X rotates refresh tokens — the old one is dead the
  // moment this succeeds, so losing the new one here would strand the account.
  const sealed = sealTokens(next);
  await db.rpc('save_social_account', {
    p_workspace: row.workspace_id, p_provider: row.provider, p_external_id: row.external_id,
    p_display_name: '', p_avatar_url: null,
    p_access_cipher: sealed.access_cipher, p_access_iv: sealed.access_iv, p_access_tag: sealed.access_tag,
    p_refresh_cipher: sealed.refresh_cipher, p_refresh_iv: sealed.refresh_iv, p_refresh_tag: sealed.refresh_tag,
    p_expires_at: sealed.expires_at, p_scope: sealed.scope, p_privy: null,
  });
  return { token: next.accessToken, externalId: row.external_id };
}

export async function runSocialDispatcher(db: SupabaseClient, limit = 25): Promise<DispatchStats> {
  const stats: DispatchStats = { claimed: 0, sent: 0, failed: 0, skipped: 0, swept: 0 };

  // Sweep first. A stale claim from a crashed run must be resolved before this
  // run claims anything, or the two are indistinguishable in the table.
  const { data: swept } = await db.rpc('sweep_stale_post_targets', { p_minutes: 10 });
  stats.swept = Number(swept) || 0;

  const { data, error } = await db.rpc('claim_post_targets', { p_limit: limit });
  if (error) throw new Error(error.message);
  const claims = (Array.isArray(data) ? data : []) as Claim[];
  stats.claimed = claims.length;

  for (const c of claims) {
    // Disabled between scheduling and sending. Not an error and not a retry:
    // somebody turned the account off on purpose.
    if (!c.account_enabled) {
      await db.rpc('mark_post_target', {
        p_id: c.id, p_status: 'skipped', p_provider_post_id: null, p_provider_url: null,
        p_error: 'The account was disconnected before this went out.',
      });
      stats.skipped++;
      continue;
    }

    try {
      const provider = providerFor(c.provider);
      const text = (c.content || '').trim();
      if (!text) throw new Error('The post has no text.');
      // Checked here rather than at the platform so the error names the limit.
      if (text.length > provider.maxChars) {
        throw new Error(`${provider.label} allows ${provider.maxChars} characters; this post is ${text.length}.`);
      }

      // One read: the token and the platform's own id for the target come out
      // of the same row, and fetching them separately would be a second
      // decrypt for no gain.
      const { token, externalId } = await accessToken(db, c.account_id);
      const res = await provider.publish(token, externalId, text, c.image_url);

      await db.rpc('mark_post_target', {
        p_id: c.id, p_status: 'sent',
        p_provider_post_id: res.providerPostId || null, p_provider_url: res.url || null, p_error: null,
      });
      stats.sent++;
    } catch (e: any) {
      const message = String(e?.message || 'Publishing failed.');
      // Only a grant problem is written back to the account. A rate limit or a
      // rejected body is about this post, and flagging the account for it would
      // tell someone to reconnect a connection that is working.
      if (/RECONNECT_REQUIRED|ACCOUNT_DISABLED/.test(message)) {
        await db.rpc('record_social_account_error', {
          p_account: c.account_id,
          p_error: 'The connection expired or was revoked. Reconnect this account.',
        });
      }
      await db.rpc('mark_post_target', {
        p_id: c.id, p_status: 'failed', p_provider_post_id: null, p_provider_url: null,
        p_error: message.replace(/RECONNECT_REQUIRED:?\s*/, '') || 'Publishing failed.',
      });
      stats.failed++;
    }
  }

  return stats;
}
