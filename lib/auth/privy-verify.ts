import { createPublicKey, verify as cryptoVerify } from 'crypto';

// Server-side verification of Privy auth tokens (ES256 JWTs in the
// `privy-token` cookie), dependency-free via Privy's public JWKS.
//
// WHY: our API routes used to trust a `privyUserId` field in the request body.
// Anyone who learned a victim's Privy DID could act as them against those
// routes. Verifying the signed token closes that: the id we act on now comes
// from a signature only Privy can produce.
//
// Policy (see authorizePrivy): invalid / missing / mismatched token → reject;
// verification INFRASTRUCTURE unavailable (JWKS unreachable) → allow degraded,
// so an auth.privy.io outage can't take our API down with it.

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || 'cmlqpi7i600630cjlgazh281n';
const JWKS_URL = `https://auth.privy.io/api/v1/apps/${APP_ID}/jwks.json`;
const JWKS_TTL_MS = 10 * 60 * 1000;

let jwksCache: { keys: any[]; at: number } | null = null;

async function getJwks(): Promise<any[] | null> {
  if (jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  try {
    const r = await fetch(JWKS_URL, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return jwksCache?.keys ?? null;
    const d = await r.json();
    jwksCache = { keys: d.keys || [], at: Date.now() };
    return jwksCache.keys;
  } catch {
    return jwksCache?.keys ?? null;   // stale cache beats nothing
  }
}

const b64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function tokenFrom(req: Request): string | null {
  const header = req.headers.get('x-privy-token');
  if (header) return header.trim();
  const cookies = req.headers.get('cookie') || '';
  const m = cookies.match(/(?:^|;\s*)privy-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export type PrivyVerify =
  | { status: 'verified'; userId: string }
  | { status: 'invalid'; reason: string }
  | { status: 'unavailable'; reason: string };

export async function verifyPrivyToken(req: Request): Promise<PrivyVerify> {
  const token = tokenFrom(req);
  if (!token) return { status: 'invalid', reason: 'No auth token on the request' };
  const parts = token.split('.');
  if (parts.length !== 3) return { status: 'invalid', reason: 'Malformed token' };

  let header: any, payload: any;
  try {
    header = JSON.parse(b64u(parts[0]).toString('utf8'));
    payload = JSON.parse(b64u(parts[1]).toString('utf8'));
  } catch {
    return { status: 'invalid', reason: 'Undecodable token' };
  }
  if (header.alg !== 'ES256') return { status: 'invalid', reason: `Unexpected alg ${header.alg}` };

  const keys = await getJwks();
  if (!keys || keys.length === 0) return { status: 'unavailable', reason: 'JWKS unreachable' };
  const jwk = keys.find((k) => !header.kid || k.kid === header.kid) || keys[0];

  let ok = false;
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' } as any);
    ok = cryptoVerify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: 'ieee-p1363' }, b64u(parts[2]));
  } catch {
    return { status: 'invalid', reason: 'Signature check failed' };
  }
  if (!ok) return { status: 'invalid', reason: 'Bad signature' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now - 60) return { status: 'invalid', reason: 'Token expired' };
  if (payload.iss && payload.iss !== 'privy.io') return { status: 'invalid', reason: 'Wrong issuer' };
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.aud && !aud.includes(APP_ID)) return { status: 'invalid', reason: 'Wrong audience' };
  const sub = String(payload.sub || '');
  if (!sub.startsWith('did:privy:')) return { status: 'invalid', reason: 'No subject' };
  return { status: 'verified', userId: sub };
}

// Route-level policy: does this request prove it belongs to `claimedId`?
export async function authorizePrivy(req: Request, claimedId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const v = await verifyPrivyToken(req);
  if (v.status === 'verified') {
    return v.userId === claimedId
      ? { ok: true }
      : { ok: false, status: 403, error: 'Auth token does not match the requested user.' };
  }
  if (v.status === 'unavailable') {
    console.warn(`privy-verify degraded: ${v.reason}`);
    return { ok: true };
  }
  return { ok: false, status: 401, error: 'Your session is invalid or expired. Sign in again.' };
}
