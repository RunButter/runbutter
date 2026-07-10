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
