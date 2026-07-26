// Company logos derived from the domain we already store — no API key, no
// account, no enrichment bill.
//
// Both providers below are public favicon endpoints that take a hostname and
// return an image. We ask DuckDuckGo first (no tracking cookies, decent
// coverage) and fall back to Google's, which has the broadest index. If both
// miss, the caller draws initials — see CompanyLogo.
//
// Privacy note worth knowing before this spreads: rendering these sends the
// customer's domain to a third party in the URL. That's a domain, not personal
// data, and it's the same request a browser makes for any favicon — but it is
// why this is opt-outable per workspace rather than hardcoded everywhere.

const PROVIDERS = [
  (d: string, size: number) => `https://icons.duckduckgo.com/ip3/${d}.ico`,
  (d: string, size: number) => `https://www.google.com/s2/favicons?domain=${d}&sz=${size}`,
];

/**
 * Pull a bare hostname out of whatever the domain field actually contains —
 * users type "acme.com", "https://acme.com/pricing", "www.acme.com" and
 * "hello@acme.com" interchangeably.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@')) s = s.slice(s.lastIndexOf('@') + 1);   // an email works too
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');               // drop scheme
  s = s.split(/[/?#]/)[0];                                    // drop path/query
  s = s.replace(/^www\./, '').replace(/:\d+$/, '');           // drop www + port
  // Must look like a real hostname: at least one dot, no spaces, valid charset.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null;
  return s;
}

/** Ordered list of logo URLs to try for a domain. Empty when there's nothing usable. */
export function logoCandidates(domain: string | null | undefined, size = 64): string[] {
  const d = normalizeDomain(domain);
  return d ? PROVIDERS.map((p) => p(d, size)) : [];
}

/** First-choice logo URL, or null. For callers that don't want fallback logic. */
export function logoUrl(domain: string | null | undefined, size = 64): string | null {
  return logoCandidates(domain, size)[0] ?? null;
}

/** Initials fallback — same rule the tables already used for avatars. */
export function initialsOf(name: string): string {
  return (name || '?').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
