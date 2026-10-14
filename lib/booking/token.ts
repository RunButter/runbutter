// The visitor's key to their own booking — SERVER ONLY.
//
// Same design as the support widget (lib/support/token.ts): the visitor has no
// account, so the link that reschedules or cancels carries a secret DERIVED from
// the booking id with the server key. The database keeps only sha256 of it, so
// the confirmation email can be re-sent with a working link while nothing secret
// is stored. A different HMAC label from support's, so a token minted for one can
// never open the other.
import { createHash, createHmac } from 'crypto';
import { siteOrigin } from '@/lib/support/token';

function key(): Buffer {
  const raw = process.env.SECRETS_MASTER_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw) throw new Error('BOOKING_NOT_CONFIGURED');
  return createHmac('sha256', 'runbutter-booking-visitor').update(raw).digest();
}

export const bookingToken = (bookingId: string): string =>
  createHmac('sha256', key()).update(`booking:${bookingId}`).digest('base64url');

export const bookingTokenHash = (token: string): string =>
  createHash('sha256').update(String(token || '')).digest('hex');

/** The page where the visitor reschedules or cancels — from any device. */
export const manageLink = (bookingId: string): string =>
  `${siteOrigin()}/book/manage?b=${bookingId}&t=${bookingToken(bookingId)}`;

export { siteOrigin };
