import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { SITE_URL } from '@/lib/site';

/**
 * OAuth 2.1 helpers for the MCP server.
 *
 * Server-only: this imports node:crypto and is used by route handlers.
 *
 * ── WHY OAUTH AT ALL, WHEN API KEYS ALREADY WORK ────────────────────────────
 * `/api/mcp` has authenticated with `Authorization: Bearer hb_…` since it
 * shipped, and that is fine for Claude Code, Claude Desktop and Cursor — they
 * read a config file and can send any header. claude.ai's connector flow
 * cannot: you give it a URL, it discovers the authorization server, and it
 * sends the human through a login. There is nowhere to paste a key. So the
 * server was reachable by developers and by nobody else.
 *
 * Everything here is standards, not invention:
 *   RFC 9728  protected-resource metadata (how a 401 says where to authenticate)
 *   RFC 8414  authorization-server metadata (where authorize/token/register are)
 *   RFC 7591  dynamic client registration (how a client we have never heard of
 *             gets a client_id without an admin doing anything)
 *   RFC 7636  PKCE, required rather than optional — OAuth 2.1 drops implicit
 *             and every public client must prove it asked for its own code
 *   RFC 7009  revocation
 */

/** Same hashing as `api_keys.key_hash` (0078), so one comparison rule exists. */
export const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

/**
 * The S256 challenge for a verifier.
 *
 * base64url of the SHA-256, no padding. `plain` is in the spec and is refused
 * here: a verifier that equals its own challenge protects against nobody who
 * could see the authorization request in the first place.
 */
export const s256 = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');

/**
 * 32 bytes of randomness, base64url.
 *
 * Prefixed so a leaked string is identifiable in a log or a paste — the same
 * reasoning behind `hb_` keys. `rbt_` access, `rbr_` refresh, `rbo_` code.
 */
export const mintToken = (prefix: 'rbt' | 'rbr' | 'rbo') =>
  `${prefix}_${randomBytes(32).toString('base64url')}`;

/** Constant-time string compare, for anything that is a secret. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

export const ISSUER = SITE_URL.replace(/\/$/, '');
export const MCP_RESOURCE = `${ISSUER}/api/mcp`;

/** Access-token lifetime. Short, because refresh rotation is cheap and a stolen access token should expire. */
export const ACCESS_TTL_SECONDS = 3600;

/**
 * The `WWW-Authenticate` header a 401 from the resource server must carry.
 *
 * THIS HEADER IS THE ENTIRE DISCOVERY MECHANISM. Without it a client that gets
 * a 401 has no way to learn where to send the user, and the connector flow ends
 * there with an unexplained failure. RFC 9728 §5.1.
 */
export const wwwAuthenticate = (error?: string, description?: string) =>
  [
    `Bearer realm="runbutter"`,
    `resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`,
    error ? `error="${error}"` : '',
    description ? `error_description="${description.replace(/"/g, "'")}"` : '',
  ].filter(Boolean).join(', ');

/** OAuth error bodies are a fixed shape; getting it wrong makes clients report nothing useful. */
export function oauthError(error: string, description: string, status = 400) {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Is this a redirect target we will send a code to?
 *
 * The registry check (exact match against the client's registered list) happens
 * in SQL. This is the shape check applied at REGISTRATION: https anywhere, plain
 * http only on loopback — a native client legitimately listens on 127.0.0.1 on a
 * random port — plus private-use schemes for desktop and mobile apps.
 */
export function isRegistrableRedirect(u: string): boolean {
  if (typeof u !== 'string' || u.length > 2000) return false;
  let url: URL;
  try { url = new URL(u); } catch { return false; }
  if (url.hash) return false;                       // RFC 6749 §3.1.2: no fragment
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') {
    const h = url.hostname;
    return h === '127.0.0.1' || h === '::1' || h === '[::1]' || h === 'localhost';
  }
  // A private-use scheme (com.example.app:/callback). Must contain a dot, which
  // is what the spec recommends to keep an app from claiming `http`-like names.
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && url.protocol.includes('.');
}

/** The scopes this resource server understands. Two, matching API-key scopes. */
export const SUPPORTED_SCOPES = ['mcp:full', 'mcp:read'] as const;

/** `mcp:read` → the read-only tool set; anything else → full. Unknown scopes narrow, never widen. */
export const normalizeScope = (raw: string | null | undefined): 'full' | 'read' => {
  const parts = String(raw || '').split(/[\s+]+/).filter(Boolean);
  if (parts.length === 0) return 'full';
  return parts.includes('mcp:full') ? 'full' : parts.includes('mcp:read') ? 'read' : 'full';
};
