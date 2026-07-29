// Where a request came from and what it was made with — from data the request
// already carries. SERVER ONLY.
//
// NO IP-GEOLOCATION CALL. Every hosted geo API meters per lookup, which breaks
// the cost rule and would put a per-pageview price on analytics. Instead we read
// the headers an edge proxy already attaches. If nothing is in front of the app
// those are absent, and we store null — the dashboard then reports honest
// coverage ("geo on 0% of traffic") rather than presenting a guess as a fact.
//
// To actually get country data on Render: put Cloudflare in front (proxied DNS,
// the orange cloud) and cf-ipcountry appears on every request at no cost.
// The alternative is bundling MaxMind's GeoLite2 database — free, but a ~70 MB
// file that needs refreshing monthly, which is a bigger commitment than a header.

export interface RequestContext {
  country: string | null;
  region: string | null;
  city: string | null;
  browser: string | null;
  os: string | null;
}

const header = (h: Headers, names: string[]): string | null => {
  for (const n of names) {
    const v = h.get(n);
    if (v && v.trim() && v.trim() !== 'XX') return v.trim();   // Cloudflare sends XX when unknown
  }
  return null;
};

/** Two-letter uppercase, or null. Guards against a proxy sending junk. */
function country(h: Headers): string | null {
  const raw = header(h, ['cf-ipcountry', 'x-vercel-ip-country', 'x-geo-country', 'x-country-code', 'fly-client-country']);
  if (!raw) return null;
  const code = raw.toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

// Vercel percent-encodes city names ("San%20Francisco"); Cloudflare does not.
function place(h: Headers, names: string[]): string | null {
  const raw = header(h, names);
  if (!raw) return null;
  let v = raw;
  try { v = decodeURIComponent(raw); } catch { /* keep the raw value */ }
  return v.slice(0, 80) || null;
}

/**
 * Coarse browser + OS from the User-Agent string.
 *
 * Order matters throughout: every Chromium browser claims "Chrome", Edge claims
 * both, and Safari appears in nearly every UA on Apple platforms. So the more
 * specific token has to be tested first or everything collapses into Chrome.
 * Deliberately coarse — this is for a bar chart, not fingerprinting, and a
 * full UA-parsing dependency would be a lot of bytes for one panel.
 */
function agent(ua: string): { browser: string | null; os: string | null } {
  if (!ua) return { browser: null, os: null };

  let browser: string | null = null;
  if (/\bEdg[A-Z]?\//.test(ua)) browser = 'Edge';
  else if (/\bOPR\/|\bOpera\b/.test(ua)) browser = 'Opera';
  else if (/\bSamsungBrowser\//.test(ua)) browser = 'Samsung Internet';
  else if (/\bFirefox\/|\bFxiOS\//.test(ua)) browser = 'Firefox';
  else if (/\bCriOS\//.test(ua)) browser = 'Chrome';
  else if (/\bChrome\//.test(ua)) browser = 'Chrome';
  else if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) browser = 'Safari';
  else if (/\bbot\b|crawler|spider|slurp|bingpreview|headless/i.test(ua)) browser = 'Bot';

  let os: string | null = null;
  // iPadOS 13+ reports itself as Macintosh, so touch-capable Macs are iPads.
  if (/\biPhone\b|\biPod\b/.test(ua)) os = 'iOS';
  else if (/\biPad\b/.test(ua)) os = 'iPadOS';
  else if (/\bAndroid\b/.test(ua)) os = 'Android';
  else if (/\bWindows NT\b/.test(ua)) os = 'Windows';
  else if (/\bCrOS\b/.test(ua)) os = 'ChromeOS';
  else if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) os = 'macOS';
  else if (/\bLinux\b/.test(ua)) os = 'Linux';

  return { browser, os };
}

export function requestContext(req: Request): RequestContext {
  const h = req.headers;
  const { browser, os } = agent(h.get('user-agent') || '');
  return {
    country: country(h),
    region: place(h, ['cf-region', 'x-vercel-ip-country-region', 'x-geo-region']),
    city: place(h, ['cf-ipcity', 'x-vercel-ip-city', 'x-geo-city']),
    browser,
    os,
  };
}

/** Keep only the UTM keys, trimmed — the tracker sends whatever was on the URL. */
export function cleanUtm(input: any): { utm_source: string | null; utm_medium: string | null; utm_campaign: string | null } {
  const pick = (v: any) => {
    const s = String(v ?? '').trim().slice(0, 100);
    return s || null;
  };
  return {
    utm_source: pick(input?.utm_source),
    utm_medium: pick(input?.utm_medium),
    utm_campaign: pick(input?.utm_campaign),
  };
}
