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
  // Kubernetes service DNS. `.cluster.local` is caught by `.local` above, but
  // the shortened forms a search domain resolves are not: `myapi.myns.svc` and
  // `kubernetes.default` both have a dot and neither is a public name. The
  // second is the cluster API server, which is the classic in-pod SSRF target.
  //
  // This cannot be complete — a pod's search domains make almost any short name
  // resolvable, and no in-process check can enumerate them. Network policy is
  // the real boundary; this closes the names that are worth typing.
  if (h.endsWith('.svc') || h === 'kubernetes.default' || h.endsWith('.kubernetes.default')) return false;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h.startsWith('[') /* other IPv6 literals: fc00::/7 fe80::/10 etc. */) {
    const v6 = h.slice(1, -1);
    if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(v6) || v6 === '::' ) return false;
  }
  // A SINGLE-LABEL HOSTNAME IS AN INTERNAL SERVICE.
  //
  // `http://ollama:11434` passed every check above — it is not localhost, has
  // no private-range prefix because it is not an IP at all, and does not end in
  // .local or .internal. Inside Docker or Kubernetes that name resolves to a
  // service on the internal network, so `http://redis:6379`,
  // `http://postgres:5432` and `http://minio:9000` were all reachable by
  // anything using this guard — which includes `call_connection`, the tool an
  // agent can aim, and the automations dispatcher.
  //
  // Nothing on the public internet is dotless: a reachable name needs a TLD.
  // Bracketed IPv6 literals are exempt because they have no dots by nature and
  // the private ranges above already cover them. This also happens to close
  // integer-form addresses like http://2130706433/, which is 127.0.0.1.
  if (!h.startsWith('[') && !h.includes('.')) return false;
  return true;
}

/**
 * ── Local models ────────────────────────────────────────────────────────────
 *
 * `isSafeOutboundUrl` rejects every private host, which is right for the URLs
 * an AGENT or an AUTOMATION reaches: an owner-saved webhook pointing at
 * 169.254.169.254 turns any agent into a probe of our own network, and that
 * guard must not move. But it also blocked the one case where a private host is
 * the whole point — a company running its own model.
 *
 * `http://ollama:11434` is exactly correct on a self-hosted RunButter, where the
 * app is already inside the customer's network and there is one tenant. It is
 * exactly wrong on runbutter.app, where our servers cannot reach a customer's
 * LAN anyway, so allowing it would buy nothing and add SSRF risk against our own
 * infrastructure.
 *
 * So this is opt-in per deployment and empty by default:
 *
 *   AI_ALLOWED_HOSTS=ollama:11434,vllm.internal:8000,192.168.1.50:1234
 *
 * AN ALLOWLIST, NOT A BOOLEAN. A flag saying "allow private hosts" would also
 * open the cloud metadata endpoints, which are the single most valuable target
 * on any hosted machine — one request to 169.254.169.254 returns the instance's
 * IAM credentials. Naming the hosts you actually run keeps that closed, and the
 * metadata addresses below are refused even when somebody lists them.
 *
 * It is used ONLY for the AI base URL. `call_connection`, the automations
 * dispatcher, the CSV fetcher and the webhook tester all keep the strict guard,
 * because those are URLs a model or a rule can aim.
 */

/** Refused whatever the allowlist says. Credentials live behind these. */
const METADATA_HOSTS = new Set([
  '169.254.169.254',           // AWS, GCP, Azure, DigitalOcean, Oracle
  'metadata.google.internal',
  'metadata',
  '100.100.100.100',           // Alibaba Cloud
  '[fd00:ec2::254]',           // AWS IMDS over IPv6
  '192.0.0.192',               // Oracle Cloud legacy
]);

/** `host` or `host:port`, comma or whitespace separated. */
function aiAllowlist(): { host: string; port: string }[] {
  return (process.env.AI_ALLOWED_HOSTS || '')
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .map((e) => {
      // Only split on the LAST colon, so a bare IPv6 literal is not mangled.
      const i = e.lastIndexOf(':');
      const looksPorted = i > 0 && /^\d+$/.test(e.slice(i + 1));
      return looksPorted
        ? { host: e.slice(0, i).replace(/^\[|\]$/g, ''), port: e.slice(i + 1) }
        : { host: e.replace(/^\[|\]$/g, ''), port: '' };
    });
}

/**
 * May an AI base URL point here?
 *
 * True for anything the ordinary guard already allows, plus anything the
 * deployment explicitly listed. An entry with no port matches any port on that
 * host; an entry with one must match exactly.
 */
export function isAllowedAiHost(raw: string): boolean {
  let u: URL;
  try { u = new URL(String(raw || '')); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // Checked before the allowlist, not after: this is the one rule an operator
  // must not be able to switch off by typing the wrong thing into an env var.
  if (METADATA_HOSTS.has(host) || METADATA_HOSTS.has(u.hostname.toLowerCase())) return false;

  if (isSafeOutboundUrl(raw)) return true;

  return aiAllowlist().some((e) => e.host === host && (!e.port || e.port === u.port));
}

/** For an error message that tells someone what to do rather than what failed. */
export const aiAllowlistIsEmpty = () => aiAllowlist().length === 0;


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
