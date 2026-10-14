// The key in a survey email's links — SERVER ONLY. Same design as booking
// (lib/booking/token.ts) and the support widget: HMAC of the invite id with the
// server key, only its sha256 stored, a label of its own so a token minted for
// one feature can never open another.
import { createHash, createHmac } from 'crypto';
import { siteOrigin } from '@/lib/support/token';

function key(): Buffer {
  const raw = process.env.SECRETS_MASTER_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw) throw new Error('SURVEYS_NOT_CONFIGURED');
  return createHmac('sha256', 'runbutter-survey-invite').update(raw).digest();
}

export const inviteToken = (inviteId: string): string =>
  createHmac('sha256', key()).update(`survey:${inviteId}`).digest('base64url');

export const inviteTokenHash = (token: string): string =>
  createHash('sha256').update(String(token || '')).digest('hex');

/** The page an emailed button opens; `score` records that answer on arrival. */
export const surveyLink = (surveyId: string, inviteId: string, extra: Record<string, string | number> = {}): string => {
  const q = new URLSearchParams({ i: inviteId, t: inviteToken(inviteId), ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])) });
  return `${siteOrigin()}/survey/${surveyId}?${q}`;
};

export { siteOrigin };
