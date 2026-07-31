import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Click-tracking links are SIGNED.
 *
 * A tracking redirect that takes a destination as a query parameter is an open
 * redirect: anyone can hand out `runbutter.app/api/n/c/<id>?u=https://evil` and
 * borrow our domain's reputation for a phishing link. Signing the destination
 * with a server-held key means only URLs we actually put in a newsletter can be
 * redirected to.
 *
 * The key derives from the same material as lib/crypto/secrets: an explicit
 * SECRETS_MASTER_KEY if set, otherwise the service-role key. Rotating either
 * invalidates old links, which only breaks click tracking in already-delivered
 * mail — the link still works, it just stops being counted.
 */
function key(): Buffer {
  const raw = process.env.SECRETS_MASTER_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw) throw new Error('No signing key available for newsletter links.');
  return createHmac('sha256', 'runbutter-newsletter-link').update(raw).digest();
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function signUrl(url: string): string {
  return b64url(createHmac('sha256', key()).update(url).digest()).slice(0, 24);
}

export function verifyUrl(url: string, sig: string): boolean {
  const expected = signUrl(url);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig || ''));
  // Length check first: timingSafeEqual throws on a length mismatch rather than
  // returning false, so an attacker could distinguish "wrong length" from
  // "wrong value" by the 500 it produces.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Absolute base for links inside an email. Relative URLs are meaningless there. */
export function siteOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || 'https://runbutter.app';
  return raw.replace(/\/+$/, '');
}

export const unsubscribeUrl = (token: string, newsletterId?: string) =>
  `${siteOrigin()}/api/n/u/${token}${newsletterId ? `?n=${encodeURIComponent(newsletterId)}` : ''}`;

export const openPixelUrl = (deliveryId: string) => `${siteOrigin()}/api/n/o/${deliveryId}`;

export const clickUrl = (deliveryId: string, target: string) =>
  `${siteOrigin()}/api/n/c/${deliveryId}?u=${encodeURIComponent(target)}&s=${signUrl(target)}`;
