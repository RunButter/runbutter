// Umami REST client — SERVER ONLY.
//
// Contract taken from Umami's own MIT-licensed @umami/api-client (v0.80), not
// from a blog post, because the docs site is unreachable from CI. Two details
// that are easy to get wrong and that the types pin down:
//   • startAt/endAt are epoch MILLISECONDS as numbers, not ISO strings.
//   • the pageviews series returns {t, y} — NOT {x, y} like /metrics does.
//
// Credentials never reach the browser. Umami's token is account-level: whoever
// holds it can read and delete EVERY website on the instance, so it stays in
// this module behind the /api/analytics/* routes, which verify a Privy session
// and re-check workspace membership in Postgres before returning a single number.

const RAW_URL = process.env.UMAMI_URL || '';
const API_KEY = process.env.UMAMI_API_KEY || '';
const USERNAME = process.env.UMAMI_USERNAME || '';
const PASSWORD = process.env.UMAMI_PASSWORD || '';

/** Base without trailing slash. Empty when Umami isn't set up. */
const base = RAW_URL.replace(/\/+$/, '');

/** True when this deployment has an Umami to talk to. */
export function umamiConfigured(): boolean {
  return !!base && (!!API_KEY || (!!USERNAME && !!PASSWORD));
}

// Login tokens are long-lived; re-authenticating on every dashboard load would
// add a round trip to each request and hammer Umami's bcrypt on every poll.
// Cached in module scope and dropped on the first 401 (see request()).
let tokenCache: { value: string; at: number } | null = null;
const TOKEN_TTL_MS = 30 * 60 * 1000;

async function login(): Promise<string | null> {
  if (!base || !USERNAME || !PASSWORD) return null;
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.token === 'string' ? body.token : null;
  } catch {
    return null;
  }
}

async function authHeaders(forceRefresh = false): Promise<Record<string, string> | null> {
  // An API key is the better credential where available: no login round trip
  // and it can be rotated without touching the admin account's password.
  if (API_KEY) return { 'x-umami-api-key': API_KEY };
  if (!forceRefresh && tokenCache && Date.now() - tokenCache.at < TOKEN_TTL_MS) {
    return { authorization: `Bearer ${tokenCache.value}` };
  }
  const token = await login();
  if (!token) return null;
  tokenCache = { value: token, at: Date.now() };
  return { authorization: `Bearer ${token}` };
}

export class UmamiError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

async function request<T>(path: string, init?: RequestInit, retryOn401 = true): Promise<T> {
  if (!base) throw new UmamiError('UMAMI_URL is not set.');
  const headers = await authHeaders();
  if (!headers) throw new UmamiError('Could not authenticate with Umami — check UMAMI_API_KEY or UMAMI_USERNAME/UMAMI_PASSWORD.');

  const res = await fetch(`${base}/api${path}`, {
    ...init,
    headers: { accept: 'application/json', ...headers, ...(init?.headers as any) },
    cache: 'no-store',
  });

  // A cached token that expired server-side looks like a config error unless we
  // retry once with a fresh one.
  if (res.status === 401 && retryOn401 && !API_KEY) {
    tokenCache = null;
    return request<T>(path, init, false);
  }
  if (!res.ok) {
    throw new UmamiError(`Umami responded ${res.status} for ${path}`, res.status);
  }
  return (await res.json()) as T;
}

// Newer Umami wraps list responses in {data, count, page, pageSize}; older ones
// return a bare array. Accept both rather than pinning a version.
function unwrap<T>(payload: any): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (Array.isArray(payload?.data)) return payload.data as T[];
  return [];
}

export interface UmamiWebsite { id: string; name: string; domain: string }

/** Create the website record Umami will accept pageviews for. */
export async function createUmamiWebsite(domain: string, name?: string): Promise<UmamiWebsite> {
  const clean = domain.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  return request<UmamiWebsite>('/websites', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name || clean, domain: clean }),
  });
}

export async function deleteUmamiWebsite(websiteId: string): Promise<void> {
  await request(`/websites/${encodeURIComponent(websiteId)}`, { method: 'DELETE' });
}

/** The shape the existing dashboard already renders — see lib/crm/data.ts. */
export interface NormalizedStats {
  pageviews: number; visitors: number; live: number;
  desktop: number; mobile: number;
  series: { day: string; label: string; pageviews: number; visitors: number }[];
  top_pages: { path: string; count: number }[];
  top_referrers: { ref: string; count: number }[];
  /** Umami extras the built-in pipeline never had. */
  bounce_rate: number | null;
  avg_duration_s: number | null;
  countries: { code: string; count: number }[];
  browsers: { name: string; count: number }[];
}

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });

/**
 * Everything the dashboard needs, in one call.
 *
 * Each sub-request is independent, so they run in parallel and a failure in one
 * breakdown (say, countries) degrades that panel instead of blanking the whole
 * page — the headline numbers matter more than the long tail.
 */
export async function getUmamiStats(websiteId: string, days: number): Promise<NormalizedStats> {
  const endAt = Date.now();
  const startAt = endAt - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const q = `startAt=${startAt}&endAt=${endAt}`;
  const metric = (type: string, limit = 10) =>
    request<any>(`/websites/${encodeURIComponent(websiteId)}/metrics?${q}&type=${type}&limit=${limit}`)
      .then((r) => unwrap<{ x: string; y: number }>(r), () => []);

  const [stats, series, active, urls, referrers, devices, countries, browsers] = await Promise.all([
    request<any>(`/websites/${encodeURIComponent(websiteId)}/stats?${q}`),
    request<any>(`/websites/${encodeURIComponent(websiteId)}/pageviews?${q}&unit=day&timezone=UTC`)
      .then((r) => r, () => ({ pageviews: [], sessions: [] })),
    request<any>(`/websites/${encodeURIComponent(websiteId)}/active`).then((r) => r, () => null),
    metric('url'), metric('referrer'), metric('device', 5), metric('country'), metric('browser', 5),
  ]);

  // Series: pageviews and sessions come back as separate arrays keyed by `t`.
  const sessionsAt = new Map<string, number>();
  for (const p of (series?.sessions ?? [])) sessionsAt.set(String(p.t), Number(p.y) || 0);
  const out = (series?.pageviews ?? []).map((p: any) => {
    const t = String(p.t);
    const day = t.slice(0, 10);
    return { day, label: dayLabel(t), pageviews: Number(p.y) || 0, visitors: sessionsAt.get(t) ?? 0 };
  });

  const deviceCount = (needle: string) =>
    devices.filter((d) => String(d.x || '').toLowerCase() === needle).reduce((n, d) => n + (Number(d.y) || 0), 0);

  const visits = Number(stats?.visits?.value) || 0;
  const bounces = Number(stats?.bounces?.value) || 0;
  const totaltime = Number(stats?.totaltime?.value) || 0;

  // active is {x: n} per the client's WebsiteActive type, but has been a
  // single-element array in some releases — accept either.
  const live = Array.isArray(active) ? Number(active[0]?.x) || 0 : Number(active?.x) || 0;

  return {
    pageviews: Number(stats?.pageviews?.value) || 0,
    visitors: Number(stats?.visitors?.value) || 0,
    live,
    desktop: deviceCount('desktop'),
    mobile: deviceCount('mobile'),
    series: out,
    top_pages: urls.map((u) => ({ path: String(u.x || '/'), count: Number(u.y) || 0 })),
    top_referrers: referrers
      .filter((r) => String(r.x || '').trim() !== '')
      .map((r) => ({ ref: String(r.x), count: Number(r.y) || 0 })),
    // Rates are meaningless without a denominator — null, not 0, when no visits.
    bounce_rate: visits > 0 ? Math.round((bounces / visits) * 100) : null,
    avg_duration_s: visits > 0 ? Math.round(totaltime / visits) : null,
    countries: countries.map((c) => ({ code: String(c.x || '').toUpperCase(), count: Number(c.y) || 0 })),
    browsers: browsers.map((b) => ({ name: String(b.x || ''), count: Number(b.y) || 0 })),
  };
}

/** The tag a customer pastes on their site. */
export function umamiSnippet(websiteId: string): string {
  return `<script defer src="${base}/script.js" data-website-id="${websiteId}"></script>`;
}
