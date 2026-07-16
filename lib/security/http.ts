// Shared HTTP hardening helpers for server routes.
//
// isSafeOutboundUrl — SSRF guard for every server-side fetch of a USER-supplied
// URL (webhook deliveries, AI custom base URLs, CSV imports). Blocks non-http(s)
// schemes and private/link-local/loopback hosts, incl. the cloud metadata IP.
// Hostname-literal checks only: full DNS-rebinding protection would need
// resolver pinning, which is out of scope — this stops the practical cases.
//
// readJsonCapped — body-size-capped JSON parsing for PUBLIC ingest routes, so
// an unauthenticated 100 MB POST can't balloon memory or the database.

export function isSafeOutboundUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(String(raw || '')); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h === '[::]' || h === '::1' || h === '[::1]') return false;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return false;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h.startsWith('[') /* other IPv6 literals: fc00::/7 fe80::/10 etc. */) {
    const v6 = h.slice(1, -1);
    if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(v6) || v6 === '::' ) return false;
  }
  return true;
}

// rateLimit — fixed-window per-key limiter for public routes. In-memory and
// per-instance (Render runs one persistent Node server), so treat the limits
// as abuse ceilings, not precise quotas.
const buckets = new Map<string, { n: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs = 60_000): { ok: boolean; retryAfterS: number } {
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return { ok: true, retryAfterS: 0 };
  }
  if (b.n >= limit) return { ok: false, retryAfterS: Math.max(1, Math.ceil((b.reset - now) / 1000)) };
  b.n++;
  return { ok: true, retryAfterS: 0 };
}

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

export function tooMany(retryAfterS: number) {
  return new Response(JSON.stringify({ error: 'Too many requests. Slow down and retry.' }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': String(retryAfterS) },
  });
}

export interface CappedJson { ok: true; data: any }
export interface CappedJsonError { ok: false; status: number; error: string }

export async function readJsonCapped(req: Request, maxBytes: number): Promise<CappedJson | CappedJsonError> {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > maxBytes) return { ok: false, status: 413, error: `Body too large (max ${Math.round(maxBytes / 1024)} KB)` };
  let text: string;
  try { text = await req.text(); } catch { return { ok: false, status: 400, error: 'Unreadable body' }; }
  if (text.length > maxBytes) return { ok: false, status: 413, error: `Body too large (max ${Math.round(maxBytes / 1024)} KB)` };
  if (!text.trim()) return { ok: true, data: {} };
  try { return { ok: true, data: JSON.parse(text) }; } catch { return { ok: false, status: 400, error: 'Invalid JSON' }; }
}
