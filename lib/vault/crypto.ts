/**
 * End-to-end encryption for the team vault. Browser only, WebCrypto only.
 *
 * ── THE SERVER MUST NEVER BE ABLE TO READ THIS, AND THAT IS THE FEATURE ─────
 * RunButter already has lib/crypto/secrets.ts, which seals third-party tokens
 * at rest with a server-held key. That is right for an OAuth token the server
 * must USE, and it is the wrong shape for a team's passwords: it means whoever
 * holds the environment can read every credential in every workspace. For a
 * vault, "encrypted at rest" with a server-side key is barely a claim at all —
 * one leaked env file and the ciphertext was decoration.
 *
 * So the key is derived HERE, from a passphrase that is never transmitted, and
 * the server stores three things it cannot use: a salt, an IV, and ciphertext.
 * There is no reset, no recovery and no support path back in. That is the cost,
 * and it is stated on screen rather than discovered later.
 *
 * ── WHAT THIS DOES AND DOES NOT PROTECT AGAINST ─────────────────────────────
 * Protects: a database leak, a stolen backup, a compromised host at rest, an
 * operator reading rows, and every server-side log.
 *
 * Does NOT protect against a compromised server serving modified JavaScript —
 * this page could be replaced with one that phones the passphrase home. That is
 * true of every browser-delivered vault, including the web clients of the
 * dedicated ones, and saying so is the difference between a security claim and
 * marketing. It is why the screen says the vault is for shared team logins and
 * not for the keys to your bank.
 *
 * ── WHOLE-ITEM ENCRYPTION, INCLUDING THE TITLE ──────────────────────────────
 * A row is one ciphertext: title, username, password, URL and notes together.
 * Storing the title in the clear would be convenient for searching and would
 * tell anyone with database access that this workspace has a "Stripe
 * production admin" login — which is most of what an attacker wants to know
 * before they start. Searching and sorting happen after decryption, in memory.
 *
 * ── PBKDF2, 600k, SHA-256 ───────────────────────────────────────────────────
 * WebCrypto ships PBKDF2 natively and nothing else that is suitable; Argon2id
 * would be better and needs a WASM dependency on a page whose whole point is
 * that it is small and auditable. 600,000 iterations is OWASP's current figure
 * for PBKDF2-HMAC-SHA256. The count is STORED per vault, so raising it later
 * upgrades new vaults without breaking old ones.
 */

const ITERATIONS = 600_000;
const KDF = 'PBKDF2';
const HASH = 'SHA-256';
/** Encrypting this exact string is how a wrong passphrase is detected. */
const VERIFIER_PLAINTEXT = 'runbutter-vault-v1';

export interface Sealed { ct: string; iv: string }

export interface VaultItem {
  title: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle(): SubtleCrypto {
  const c = (globalThis as any).crypto;
  if (!c?.subtle) throw new Error('This browser has no WebCrypto. The vault cannot be opened safely here.');
  return c.subtle;
}

const b64 = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};
const unb64 = (s: string) => {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};

export function randomSalt(): string {
  return b64((globalThis as any).crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Passphrase + salt → an AES-GCM key that never leaves this tab.
 *
 * `extractable: false`, so even code running on this page cannot read the key
 * material back out of the CryptoKey — it can only ask WebCrypto to use it.
 */
export async function deriveKey(passphrase: string, salt: string, iterations = ITERATIONS): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(passphrase), KDF, false, ['deriveKey']);
  return subtle().deriveKey(
    { name: KDF, salt: unb64(salt), iterations, hash: HASH },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** A fresh 96-bit IV per encryption. Reusing one under AES-GCM is catastrophic. */
export async function seal(key: CryptoKey, plain: string): Promise<Sealed> {
  const iv = (globalThis as any).crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return { ct: b64(ct), iv: b64(iv) };
}

/**
 * Returns null on failure rather than throwing.
 *
 * GCM authenticates, so a wrong key and a tampered ciphertext are the same
 * event here — and both mean "do not show anything", never "show something
 * approximate". A caller that gets null renders the row as unreadable instead
 * of silently dropping it, so a corrupted item is visible rather than absent.
 */
export async function open(key: CryptoKey, s: Sealed): Promise<string | null> {
  try {
    const out = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, key, unb64(s.ct));
    return dec.decode(out);
  } catch { return null; }
}

export async function sealItem(key: CryptoKey, item: VaultItem): Promise<Sealed> {
  return seal(key, JSON.stringify(item));
}

export async function openItem(key: CryptoKey, s: Sealed): Promise<VaultItem | null> {
  const raw = await open(key, s);
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v as VaultItem : null;
  } catch { return null; }
}

/**
 * The verifier: a known string, encrypted under the vault key.
 *
 * Without it a wrong passphrase would decrypt every item to null and the screen
 * could only say "nothing here" — indistinguishable from an empty vault, at the
 * exact moment somebody is deciding whether their passwords are gone.
 */
export async function makeVerifier(key: CryptoKey): Promise<Sealed> {
  return seal(key, VERIFIER_PLAINTEXT);
}

export async function checkVerifier(key: CryptoKey, v: Sealed): Promise<boolean> {
  return (await open(key, v)) === VERIFIER_PLAINTEXT;
}

export const DEFAULT_ITERATIONS = ITERATIONS;
