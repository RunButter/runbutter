// The visitor's key to their own conversation — SERVER ONLY.
//
// A visitor has no account, so the conversation is opened by a secret. It is
// DERIVED, not random: HMAC-SHA256(server key, conversation id). That is what
// lets a reply email carry a link straight back into the thread without the
// secret being stored anywhere — the database keeps only sha256(token), and
// recomputing the token needs the server key.
//
// Rotating SECRETS_MASTER_KEY (or the service-role key it falls back to)
// therefore invalidates every open visitor link. That is the right failure: a
// leaked key should close the door, and a visitor can always start again.
import { createHash, createHmac } from 'crypto';

function key(): Buffer {
  const raw = process.env.SECRETS_MASTER_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  // No key means no secret worth the name. Refuse rather than HMAC with ''.
  if (!raw) throw new Error('SUPPORT_NOT_CONFIGURED');
  return createHmac('sha256', 'runbutter-support-visitor').update(raw).digest();
}

export const visitorToken = (conversationId: string): string =>
  createHmac('sha256', key()).update(`support:${conversationId}`).digest('base64url');

export const tokenHash = (token: string): string =>
  createHash('sha256').update(String(token || '')).digest('hex');

export const siteOrigin = (): string =>
  (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://runbutter.app').replace(/\/+$/, '');

/** A link that reopens this conversation for the visitor, from any device. */
export const conversationLink = (widgetId: string, conversationId: string): string =>
  `${siteOrigin()}/support/${widgetId}?c=${conversationId}&t=${visitorToken(conversationId)}`;
