import crypto from 'crypto';

// Generic secret-box for third-party credentials (e.g. users' BYO AI provider
// keys) at rest. AES-256-GCM, mirroring lib/ksef/crypto.ts. Master key from the
// environment only — SECRETS_MASTER_KEY, falling back to KSEF_MASTER_KEY so a
// single `openssl rand -base64 32` covers both. Never persisted, never returned
// to the client (only a short hint like "…a1b2" is ever shown).
const ALGO = 'aes-256-gcm';

function masterKey(): Buffer {
  const raw = process.env.SECRETS_MASTER_KEY || process.env.KSEF_MASTER_KEY;
  if (!raw) throw new Error('SECRETS_MASTER_KEY (or KSEF_MASTER_KEY) is not configured');
  const key = /^[A-Fa-f0-9]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('master key must decode to exactly 32 bytes (AES-256)');
  return key;
}

export interface Sealed { cipher: string; iv: string; tag: string }

export function sealSecret(plain: string): Sealed {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, masterKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { cipher: enc.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64') };
}

export function openSecret(cipher: string, iv: string, tag: string): string {
  const d = crypto.createDecipheriv(ALGO, masterKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(cipher, 'base64')), d.final()]).toString('utf8');
}

// Last 4 chars, for a non-sensitive display hint.
export const secretHint = (key: string) => '…' + key.slice(-4);
