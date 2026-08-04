import { sealSecret, openSecret, type Sealed } from '@/lib/crypto/secrets';

/**
 * Social publishing providers.
 *
 * READ THIS FIRST. Postiz (gitroomhq/postiz-app) solves this problem and solves
 * it well — and it is AGPL-3.0. Copying an adapter, a schema or a scheduler out
 * of it would relicense RunButter, which is MIT. So it was read as a FEATURE
 * SPECIFICATION and nothing else. Everything below is written against the
 * platforms' own published APIs. Do not paste code in from there later.
 *
 * ONE INTERFACE, ONE FILE PER PROVIDER. Each platform disagrees about almost
 * everything — the token endpoint, whether refresh tokens exist, what an
 * "account" is, how long a post can be — so the shared parts are exactly three:
 * exchange a code, refresh a token, publish text. Anything a single platform
 * needs beyond that stays inside its own object.
 */

export type ProviderId = 'linkedin' | 'x';

export interface TokenSet {
  accessToken: string;
  /** Absent when the platform does not issue one (or does not re-issue it). */
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
}

export interface RemoteAccount {
  externalId: string;
  displayName: string;
  avatarUrl?: string;
}

export interface PublishResult {
  providerPostId: string;
  url?: string;
}

export interface Provider {
  id: ProviderId;
  label: string;
  /** Set when the platform's client id/secret are configured on this host. */
  configured(): boolean;
  authorizeUrl(state: string, redirectUri: string): string;
  exchange(code: string, redirectUri: string): Promise<TokenSet>;
  /** Throws NO_REFRESH when the platform cannot refresh — the fix is reconnecting. */
  refresh(refreshToken: string): Promise<TokenSet>;
  identify(token: string): Promise<RemoteAccount>;
  publish(token: string, externalId: string, text: string, imageUrl?: string | null): Promise<PublishResult>;
  /** Longest post the platform accepts, so we fail before the network call. */
  maxChars: number;
}

/** Non-2xx bodies are the only useful diagnostic these APIs give; keep them. */
async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.text().catch(() => '');
  return `${fallback} (HTTP ${res.status})${body ? `: ${body.slice(0, 300)}` : ''}`;
}

const expiryFrom = (seconds?: number) =>
  typeof seconds === 'number' && seconds > 0 ? new Date(Date.now() + seconds * 1000) : undefined;

// ── LinkedIn ────────────────────────────────────────────────────────────────
// Shipped first because it is what the people asking for this actually post to.
// LinkedIn's access tokens are long-lived (60 days) and refresh tokens are not
// granted to standard apps, so `refresh` throws and the UI's job is to say
// "reconnect" before expiry rather than to retry silently.
const LINKEDIN_SCOPES = 'openid profile w_member_social';

const linkedin: Provider = {
  id: 'linkedin',
  label: 'LinkedIn',
  maxChars: 3000,
  configured: () => Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),

  authorizeUrl(state, redirectUri) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.LINKEDIN_CLIENT_ID || '',
      redirect_uri: redirectUri,
      state,
      scope: LINKEDIN_SCOPES,
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  },

  async exchange(code, redirectUri) {
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID || '',
        client_secret: process.env.LINKEDIN_CLIENT_SECRET || '',
      }),
    });
    if (!res.ok) throw new Error(await readError(res, 'LinkedIn rejected the authorization code'));
    const j = await res.json();
    return { accessToken: j.access_token, expiresAt: expiryFrom(j.expires_in), scope: LINKEDIN_SCOPES };
  },

  async refresh() {
    // Not a TODO. Standard LinkedIn apps are not issued refresh tokens at all,
    // so pretending to refresh would turn "your connection expired, reconnect"
    // into an unexplained failure every 60 days.
    throw new Error('NO_REFRESH');
  },

  async identify(token) {
    const res = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await readError(res, 'Could not read the LinkedIn profile'));
    const j = await res.json();
    // `sub` is the member URN's id; the posting API wants the full URN.
    return { externalId: `urn:li:person:${j.sub}`, displayName: j.name || j.email || 'LinkedIn', avatarUrl: j.picture };
  },

  async publish(token, externalId, text) {
    const res = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'LinkedIn-Version': '202506',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify({
        author: externalId,
        commentary: text,
        visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
    });
    if (!res.ok) throw new Error(await readError(res, 'LinkedIn refused the post'));
    // The id comes back in a header, not the body.
    const id = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || '';
    return { providerPostId: id, url: id ? `https://www.linkedin.com/feed/update/${id}` : undefined };
  },
};

// ── X ───────────────────────────────────────────────────────────────────────
// OAuth 2.0 with PKCE and rotating refresh tokens: every refresh returns a NEW
// refresh token and invalidates the old one, which is why save_social_account
// upserts rather than inserting.
const X_SCOPES = 'tweet.read tweet.write users.read offline.access';

function xBasicAuth(): string {
  const id = process.env.X_CLIENT_ID || '';
  const secret = process.env.X_CLIENT_SECRET || '';
  return Buffer.from(`${id}:${secret}`).toString('base64');
}

const x: Provider = {
  id: 'x',
  label: 'X',
  maxChars: 280,
  configured: () => Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET),

  authorizeUrl(state, redirectUri) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.X_CLIENT_ID || '',
      redirect_uri: redirectUri,
      state,
      scope: X_SCOPES,
      // PKCE is mandatory on X. The verifier is derived from `state` (see
      // lib/social/oauth.ts) rather than stored, so the callback can rebuild it
      // without a session table — and because `state` is HMAC-signed, a
      // verifier cannot be forged without the server secret.
      code_challenge: state,
      code_challenge_method: 'plain',
    });
    return `https://twitter.com/i/oauth2/authorize?${q}`;
  },

  async exchange() {
    // X needs a PKCE verifier, which the shared three-argument signature has no
    // slot for. Throwing beats accepting the call and sending an empty verifier,
    // which fails at the platform with a message nobody can act on.
    throw new Error('Use exchangeCode() for X — its token exchange requires a PKCE verifier.');
  },

  async refresh(refreshToken) {
    const res = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${xBasicAuth()}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    if (!res.ok) throw new Error(await readError(res, 'X refused to refresh the connection'));
    const j = await res.json();
    return {
      accessToken: j.access_token, refreshToken: j.refresh_token,
      expiresAt: expiryFrom(j.expires_in), scope: j.scope || X_SCOPES,
    };
  },

  async identify(token) {
    const res = await fetch('https://api.twitter.com/2/users/me?user.fields=profile_image_url', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await readError(res, 'Could not read the X account'));
    const j = await res.json();
    return {
      externalId: j.data?.id, displayName: j.data?.username ? `@${j.data.username}` : 'X',
      avatarUrl: j.data?.profile_image_url,
    };
  },

  async publish(token, _externalId, text) {
    const res = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(await readError(res, 'X refused the post'));
    const j = await res.json();
    const id = j.data?.id || '';
    return { providerPostId: id, url: id ? `https://x.com/i/web/status/${id}` : undefined };
  },
};

export const PROVIDERS: Record<ProviderId, Provider> = { linkedin, x };
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function providerFor(id: string): Provider {
  const p = PROVIDERS[id as ProviderId];
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

/**
 * X's token exchange needs a PKCE verifier the shared interface has no slot
 * for. Rather than widening `exchange` for every provider, the one that needs
 * it gets its own entry point.
 */
export async function exchangeCode(
  id: ProviderId, code: string, redirectUri: string, verifier: string,
): Promise<TokenSet> {
  if (id !== 'x') return providerFor(id).exchange(code, redirectUri);
  const res = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${xBasicAuth()}` },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(await readError(res, 'X rejected the authorization code'));
  const j = await res.json();
  return {
    accessToken: j.access_token, refreshToken: j.refresh_token,
    expiresAt: expiryFrom(j.expires_in), scope: j.scope || X_SCOPES,
  };
}

/** Column-shaped sealed token, ready for save_social_account. */
export function sealTokens(t: TokenSet) {
  const a: Sealed = sealSecret(t.accessToken);
  const r = t.refreshToken ? sealSecret(t.refreshToken) : null;
  return {
    access_cipher: a.cipher, access_iv: a.iv, access_tag: a.tag,
    refresh_cipher: r?.cipher ?? null, refresh_iv: r?.iv ?? null, refresh_tag: r?.tag ?? null,
    expires_at: t.expiresAt?.toISOString() ?? null,
    scope: t.scope ?? null,
  };
}

export { openSecret };
