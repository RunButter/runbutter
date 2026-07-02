import crypto from 'crypto';

// ============================================================================
// KSeF crypto helpers
//  - AES-256-GCM to protect each tenant's KSeF token at rest.
//  - RSA-OAEP (SHA-256 / MGF1) to encrypt the challenge pack for KSeF auth.
// The AES master key is read from the environment only (never persisted).
//   Generate one with:  openssl rand -base64 32
// ============================================================================

const AES_ALGO = 'aes-256-gcm';

/** Decode KSEF_MASTER_KEY (base64 or hex) into a 32-byte AES-256 key. */
function getMasterKey(): Buffer {
  const raw = process.env.KSEF_MASTER_KEY;
  if (!raw) throw new Error('KSEF_MASTER_KEY is not configured');
  const key = /^[A-Fa-f0-9]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('KSEF_MASTER_KEY must decode to exactly 32 bytes (AES-256)');
  return key;
}

export interface EncryptedToken {
  cipher: string; // base64 ciphertext
  iv: string;     // base64 96-bit IV
  tag: string;    // base64 GCM auth tag (required to decrypt/verify integrity)
}

/**
 * Encrypt a plaintext KSeF token with AES-256-GCM.
 * A fresh, cryptographically-secure 96-bit IV is generated per call — never reuse
 * an IV with the same key. Returns the ciphertext, IV and auth tag (all base64).
 */
export function encryptKSeFToken(plainToken: string): EncryptedToken {
  const iv = crypto.randomBytes(12); // 96-bit IV is the recommended size for GCM
  const cipher = crypto.createCipheriv(AES_ALGO, getMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { cipher: encrypted.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64') };
}

/**
 * Decrypt an AES-256-GCM token. GCM requires the auth tag (unlike CBC) — passing
 * it in lets us both decrypt AND verify the ciphertext wasn't tampered with; a
 * mismatch throws.
 */
export function decryptKSeFToken(encryptedData: string, iv: string, tag: string): string {
  const decipher = crypto.createDecipheriv(AES_ALGO, getMasterKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedData, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Build and RSA-encrypt the KSeF challenge pack.
 * KSeF expects the string  `token|timestampMs`  encrypted with RSAES-OAEP
 * (SHA-256 hash + MGF1) using the Ministry of Finance public key, then Base64.
 * @param ksefToken     the tenant's decrypted KSeF token
 * @param timestampMs   Unix time in milliseconds (from the challenge response)
 * @param publicKeyPem  the KSeF public key in PEM (or DER wrapped) form
 */
export function encryptChallengePack(ksefToken: string, timestampMs: number, publicKeyPem: string): string {
  const payload = Buffer.from(`${ksefToken}|${timestampMs}`, 'utf8');
  const encrypted = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    payload,
  );
  return encrypted.toString('base64');
}
