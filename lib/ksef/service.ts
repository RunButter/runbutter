import { createAdminClient } from '@/lib/supabase';
import { encryptKSeFToken, decryptKSeFToken, encryptChallengePack } from './crypto';

// ============================================================================
// KSeF 2.0 integration service (multi-tenant).
//
// Each tenant = one workspace, with its own NIP + KSeF token (encrypted at rest
// in ksef_configs, service-role only). This module dynamically authenticates on
// behalf of a tenant, caches the short-lived JWT, and sends invoices.
//
// ⚠️ CONTRACT NOTE: KSeF 2.0 is new and its request/response shapes are still
// firming up. Endpoint paths and JSON field names below follow the CIRFMF
// official docs + community references, but MUST be validated against the live
// OpenAPI (https://github.com/CIRFMF/ksef-api) with a real test token before
// production. Every uncertain point is flagged with `VERIFY:`.
// ============================================================================

// Hardcoded test base per requirement. VERIFY: some docs use `/api/v2/` — keep
// this overridable via env so switching test/prod or path prefix is one change.
const KSEF_BASE_URL = (process.env.KSEF_BASE_URL || 'https://api-test.ksef.mf.gov.pl/v2/').replace(/\/?$/, '/');

const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;       // cache JWT for 30 minutes
const EXPIRY_SKEW_MS = 60 * 1000;                 // treat as expired 60s early

interface TenantConfig {
  workspaceId: string;
  nip: string;
  ksefToken: string;                              // decrypted, in-memory only
  environment: string;
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
}

// ── DB layer (service role — bypasses RLS on ksef_configs) ───────────────────

async function fetchTenantConfig(tenantId: string): Promise<TenantConfig> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('ksef_configs')
    .select('nip, token_cipher, token_iv, token_tag, environment, access_token, access_token_expires_at')
    .eq('workspace_id', tenantId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load KSeF config: ${error.message}`);
  if (!data) throw new Error(`No KSeF configuration for tenant ${tenantId}`);

  return {
    workspaceId: tenantId,
    nip: data.nip,
    ksefToken: decryptKSeFToken(data.token_cipher, data.token_iv, data.token_tag),
    environment: data.environment,
    accessToken: data.access_token,
    accessTokenExpiresAt: data.access_token_expires_at,
  };
}

/** Persist (encrypt) a tenant's KSeF token. Called from the admin-gated config API. */
export async function saveTenantKsefToken(tenantId: string, nip: string, plainToken: string, environment = 'test'): Promise<void> {
  const enc = encryptKSeFToken(plainToken);
  const admin = createAdminClient();
  const { error } = await admin.from('ksef_configs').upsert({
    workspace_id: tenantId, nip,
    token_cipher: enc.cipher, token_iv: enc.iv, token_tag: enc.tag,
    environment, access_token: null, access_token_expires_at: null, // invalidate any cached JWT
  });
  if (error) throw new Error(`Failed to save KSeF config: ${error.message}`);
}

async function cacheAccessToken(tenantId: string, accessToken: string, expiresAt: Date): Promise<void> {
  const admin = createAdminClient();
  await admin.from('ksef_configs')
    .update({ access_token: accessToken, access_token_expires_at: expiresAt.toISOString() })
    .eq('workspace_id', tenantId);
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function ksefFetch(path: string, init: RequestInit & { bearer?: string } = {}) {
  const { bearer, headers, ...rest } = init;
  const res = await fetch(KSEF_BASE_URL + path.replace(/^\//, ''), {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(headers || {}),
    },
  });
  return res;
}

async function readJson(res: Response) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

// ── Public key ────────────────────────────────────────────────────────────────

/**
 * The MF/KSeF RSA public key. Prefer an env-provided PEM (KSEF_PUBLIC_KEY_PEM);
 * otherwise fetch it from the KSeF certificates endpoint.
 * VERIFY: exact endpoint + response encoding of the certificate.
 */
async function getPublicKeyPem(): Promise<string> {
  const fromEnv = process.env.KSEF_PUBLIC_KEY_PEM;
  if (fromEnv && fromEnv.includes('BEGIN')) return fromEnv;

  const res = await ksefFetch('security/public-key-certificates');
  if (!res.ok) throw new Error(`Could not fetch KSeF public key (HTTP ${res.status})`);
  const body = await readJson(res);
  // VERIFY: the field/shape holding the certificate (array of certs; base64 DER).
  const certB64 = Array.isArray(body) ? body[0]?.certificate ?? body[0] : body.certificate ?? body.publicKey;
  if (!certB64) throw new Error('KSeF public key response not understood — set KSEF_PUBLIC_KEY_PEM instead');
  return `-----BEGIN CERTIFICATE-----\n${String(certB64).replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----`;
}

// ── Authentication lifecycle ─────────────────────────────────────────────────

/**
 * Full asymmetric challenge-response handshake for a tenant.
 * Returns { accessToken, expiresAt }.
 */
async function authenticate(cfg: TenantConfig): Promise<{ accessToken: string; expiresAt: Date }> {
  // Step 1 — request an auth challenge for this NIP.
  // VERIFY: exact body. KSeF 2.0 typically uses a contextIdentifier { type, identifier }.
  const challengeRes = await ksefFetch('auth/challenge', {
    method: 'POST',
    body: JSON.stringify({ contextIdentifier: { type: 'onip', identifier: cfg.nip } }),
  });
  if (!challengeRes.ok) throw new Error(`KSeF challenge failed (HTTP ${challengeRes.status})`);
  const challengeBody = await readJson(challengeRes);
  const challenge: string = challengeBody.challenge;
  // The challenge timestamp → Unix ms. VERIFY: field name ("timestamp") + format.
  const timestampMs = new Date(challengeBody.timestamp).getTime();
  if (!challenge || Number.isNaN(timestampMs)) throw new Error('KSeF challenge response missing challenge/timestamp');

  // Steps 2 & 3 — build `token|timestampMs` and RSA-OAEP(SHA-256) encrypt it.
  const publicKeyPem = await getPublicKeyPem();
  const encryptedToken = encryptChallengePack(cfg.ksefToken, timestampMs, publicKeyPem);

  // Step 4 — init the token session (HTTP 202). Returns a temporary
  // authenticationToken + a referenceNumber to poll.
  const initRes = await ksefFetch('auth/ksef-token', {
    method: 'POST',
    body: JSON.stringify({ challenge, encryptedToken }),
  });
  if (!initRes.ok && initRes.status !== 202) throw new Error(`KSeF token init failed (HTTP ${initRes.status})`);
  const initBody = await readJson(initRes);
  const referenceNumber: string = initBody.referenceNumber;
  const operationalToken: string | undefined = initBody.authenticationToken?.token;
  if (!referenceNumber || !operationalToken) throw new Error('KSeF token init response missing referenceNumber/authenticationToken');

  // Step 5 — poll auth status with the temporary operational token as Bearer.
  await pollAuthStatus(referenceNumber, operationalToken);

  // Step 6 — redeem the final access JWT. VERIFY: endpoint + response fields.
  const redeemRes = await ksefFetch('auth/token/redeem', { method: 'POST', bearer: operationalToken });
  if (!redeemRes.ok) throw new Error(`KSeF token redeem failed (HTTP ${redeemRes.status})`);
  const redeemBody = await readJson(redeemRes);
  const accessToken: string = redeemBody.accessToken?.token ?? redeemBody.accessToken;
  if (!accessToken) throw new Error('KSeF redeem response missing accessToken');

  return { accessToken, expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS) };
}

/** Poll GET /auth/{ref} until the authentication is confirmed (or times out). */
async function pollAuthStatus(referenceNumber: string, operationalToken: string, tries = 8, delayMs = 1500): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const res = await ksefFetch(`auth/${referenceNumber}`, { method: 'GET', bearer: operationalToken });
    if (res.ok) {
      const body = await readJson(res);
      // VERIFY: success shape. KSeF uses a status/processingCode; 200 == success.
      const code = body.status?.code ?? body.processingCode;
      if (code === undefined || code === 200 || body.authenticationFinished === true) return;
      if (code >= 400) throw new Error(`KSeF authentication rejected (code ${code})`);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error('KSeF authentication timed out while polling status');
}

// ── Cache-aware token retrieval ──────────────────────────────────────────────

/**
 * Return a valid KSeF access JWT for the tenant. Cache-first: reuse the stored
 * token while it's still valid, otherwise run the handshake and cache the result.
 */
export async function getAccessToken(tenantId: string): Promise<string> {
  const cfg = await fetchTenantConfig(tenantId);

  if (cfg.accessToken && cfg.accessTokenExpiresAt) {
    const validUntil = new Date(cfg.accessTokenExpiresAt).getTime();
    if (validUntil - EXPIRY_SKEW_MS > Date.now()) return cfg.accessToken; // cache hit
  }

  const { accessToken, expiresAt } = await authenticate(cfg);
  await cacheAccessToken(tenantId, accessToken, expiresAt);
  return accessToken;
}

// ── Invoice sending ──────────────────────────────────────────────────────────

/**
 * Send an FA(3) invoice XML to KSeF for a tenant, handling token caching/refresh
 * automatically. Returns the KSeF reference number to track the UPO.
 *
 * VERIFY: KSeF 2.0 invoice submission is session-based and (for online sessions)
 * the invoice is symmetrically encrypted before upload. This template posts the
 * raw XML to an invoice endpoint to show the orchestration; wire the real
 * session-open → encrypt → send → UPO flow per the official spec.
 */
export async function sendInvoiceToKSeF(tenantId: string, invoiceXmlString: string): Promise<{ referenceNumber: string }> {
  try {
    const accessToken = await getAccessToken(tenantId);

    const res = await ksefFetch('sessions/online/invoices', {
      method: 'POST',
      bearer: accessToken,
      body: JSON.stringify({ invoice: Buffer.from(invoiceXmlString, 'utf8').toString('base64') }),
    });
    const body = await readJson(res);
    if (!res.ok) throw new Error(`KSeF invoice send failed (HTTP ${res.status}): ${body.message || body.raw || ''}`);

    const referenceNumber: string = body.referenceNumber ?? body.elementReferenceNumber;
    if (!referenceNumber) throw new Error('KSeF invoice send response missing referenceNumber');
    return { referenceNumber };
  } catch (err: any) {
    // Surface a clean error; never leak the token or crypto details.
    throw new Error(`sendInvoiceToKSeF[${tenantId}]: ${err.message}`);
  }
}
