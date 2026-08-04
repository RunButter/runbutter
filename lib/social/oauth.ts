import crypto from 'crypto';

/**
 * The OAuth `state` for a social connect.
 *
 * It has to survive a round trip through a third party and come back trusted,
 * because it is what tells the callback which workspace to attach the grant to.
 * An unsigned state means anyone who can hit the callback can name a workspace
 * — and the thing being written there is a credential that posts publicly.
 *
 * So it is HMAC-signed with a server secret and carries its own expiry. No
 * session table, no cookie: the callback verifies the signature and reads the
 * payload back out.
 *
 * X additionally needs a PKCE `code_verifier`, and the verifier IS this state
 * string (challenge method `plain`). That is safe here precisely because the
 * state is unforgeable without the server secret — the property PKCE wants from
 * a verifier is exactly the property the HMAC already provides. It also means
 * the callback can rebuild the verifier from what the platform hands back,
 * with nothing stored in between.
 */

function secret(): string {
  const s = process.env.SECRETS_MASTER_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('The server has no signing key. Set SECRETS_MASTER_KEY.');
  return s;
}

// base64url so the value survives a query string without re-encoding.
const b64u = (b: Buffer | string) =>
  (Buffer.isBuffer(b) ? b : Buffer.from(b)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export interface OAuthState {
  workspaceId: string;
  privyUserId: string;
  provider: string;
  /** Epoch seconds. Ten minutes is longer than any real consent screen. */
  exp: number;
}

export function signState(s: Omit<OAuthState, 'exp'>, ttlSeconds = 600): string {
  const payload: OAuthState = { ...s, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const body = b64u(JSON.stringify(payload));
  const mac = b64u(crypto.createHmac('sha256', secret()).update(body).digest());
  return `${body}.${mac}`;
}

/** Null on any tampering, malformed input, or expiry — never a partial answer. */
export function verifyState(state: string | null): OAuthState | null {
  if (!state) return null;
  const [body, mac] = state.split('.');
  if (!body || !mac) return null;

  const expected = b64u(crypto.createHmac('sha256', secret()).update(body).digest());
  // Constant-time, and length-checked first because timingSafeEqual throws on a
  // length mismatch rather than returning false.
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;

  try {
    const p = JSON.parse(unb64u(body).toString('utf8')) as OAuthState;
    if (!p.workspaceId || !p.privyUserId || !p.provider) return null;
    if (typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch { return null; }
}

/**
 * The redirect URI registered with each platform.
 *
 * Read from NEXT_PUBLIC_SITE_URL rather than the request, on purpose: an
 * attacker-controlled Host header would otherwise decide where the platform
 * sends the code, and the code is what becomes a posting credential.
 */
export function redirectUri(provider: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  if (!base) throw new Error('NEXT_PUBLIC_SITE_URL is not set — the OAuth redirect would point at the wrong host.');
  return `${base}/api/social/callback/${provider}`;
}
