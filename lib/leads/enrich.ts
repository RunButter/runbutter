// Find a business's public contact details on its OWN website.
//
// OpenStreetMap has a website for many businesses and an email for few. The
// email is usually one click away — on the homepage footer or a Contact page
// — so this reads at most three pages of the site the business itself
// published, the way a person looking for it would.
//
// ── POLITE BY CONSTRUCTION ──────────────────────────────────────────────────
// - robots.txt is read and obeyed, for our name and for `*`. A site that says
//   no gets "this site asks not to be read", never a workaround.
// - One identifying User-Agent with a URL, so an owner can see who called.
// - At most three pages per site, small timeouts, a size cap per page.
//
// ── A URL FROM OPENSTREETMAP IS UNTRUSTED ───────────────────────────────────
// Anyone can edit OSM, so a "website" can point anywhere, including at our own
// network. Every hop (redirects included — they are followed by hand) passes
// isSafeOutboundUrl AND a DNS check that the name does not resolve to a
// private address, which the hostname-only guard cannot see. Only extracted
// emails, phone numbers and social links leave this file; a page body never
// does.
import { isSafeOutboundUrl } from '@/lib/security/http';

const UA = 'Mozilla/5.0 (compatible; RunButterBot/1.0; +https://runbutter.app/developers/lead-finder)';
const PAGE_BYTES = 1_500_000;
const PAGE_TIMEOUT = 8_000;

export interface SiteContacts {
  website: string;
  emails: string[];
  phones: string[];
  facebook: string;
  instagram: string;
  linkedin: string;
  /** Pages actually read, for the record's provenance. */
  checked: string[];
  /** Why nothing could be read, when nothing could. */
  note?: string;
}

// ── Pure extraction (tested against fixtures; no network) ──────────────────

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', commat: '@', period: '.' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITY[e.toLowerCase()] ?? m;
  });
}

const EMAIL_RX = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;
const JUNK_EMAIL = /\.(png|jpe?g|gif|svg|webp|avif|css|js)$|@\dx\.|example\.|sentry|wixpress|domain\.(com|pl)|email\.(com|pl)|yourname|twoj(e)?email|youremail|name@|user@|test@|no-?reply|@(?:sentry|wix|godaddy)\./i;

/**
 * Obfuscations people use to hide an address from bots, in the languages this
 * product is used in: "biuro [at] firma [dot] pl", "biuro(małpa)firma.pl".
 */
function deobfuscate(text: string): string {
  return text
    .replace(/\s*[\[(\{<]\s*(?:at|małpa|malpa|ät)\s*[\])\}>]\s*/gi, '@')
    .replace(/\s*[\[(\{<]\s*(?:dot|kropka|punkt)\s*[\])\}>]\s*/gi, '.');
}

const SOCIAL_SKIP = /sharer|share\.php|\/share|intent\/|\/plugins\/|\/dialog\/|\/tr\?|\/hashtag\//i;

function host(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

/** Everything a contact finder wants from one page. */
export function extractContacts(html: string, pageUrl: string): {
  emails: string[]; phones: string[]; facebook: string; instagram: string; linkedin: string; contactLinks: string[];
} {
  const decoded = decodeEntities(html);
  const emails: string[] = [];
  const push = (e: string) => {
    const v = e.trim().replace(/^mailto:/i, '').split('?')[0].toLowerCase().replace(/\.$/, '');
    if (v.length <= 80 && /^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/.test(v) && !JUNK_EMAIL.test(v) && !emails.includes(v)) emails.push(v);
  };

  // mailto: first — the address the site deliberately made clickable.
  for (const m of decoded.matchAll(/href\s*=\s*["']\s*mailto:([^"'>\s]+)/gi)) {
    try { push(decodeURIComponent(m[1])); } catch { push(m[1]); }
  }
  // Then visible text, scripts and styles removed (a JS bundle is full of
  // things shaped like addresses), obfuscations undone.
  const text = deobfuscate(
    decoded.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ').replace(/<[^>]+>/g, ' '),
  );
  for (const m of text.matchAll(EMAIL_RX)) push(m[0]);

  const phones: string[] = [];
  for (const m of decoded.matchAll(/href\s*=\s*["']\s*tel:([^"'>]+)/gi)) {
    const p = decodeURIComponent(m[1]).replace(/[^\d+()\-\s]/g, '').trim();
    const digits = p.replace(/\D/g, '');
    if (digits.length >= 6 && digits.length <= 16 && !phones.includes(p)) phones.push(p);
  }

  let facebook = '', instagram = '', linkedin = '';
  const contactLinks: string[] = [];
  const self = host(pageUrl);
  for (const m of decoded.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let abs: URL;
    try { abs = new URL(m[1].trim(), pageUrl); } catch { continue; }
    if (abs.protocol !== 'https:' && abs.protocol !== 'http:') continue;
    const h = abs.hostname.replace(/^www\.|^m\./, '').toLowerCase();
    const href = abs.toString();
    if (SOCIAL_SKIP.test(href)) continue;
    if (!facebook && (h === 'facebook.com' || h.endsWith('.facebook.com')) && abs.pathname.length > 1) facebook = href;
    else if (!instagram && h === 'instagram.com' && abs.pathname.length > 1) instagram = href;
    else if (!linkedin && h.endsWith('linkedin.com') && /^\/(company|in|school)\//.test(abs.pathname)) linkedin = href;
    else if (h === self) {
      const label = m[2].replace(/<[^>]+>/g, ' ');
      if (/(contact|kontakt|impressum|imprint|o-nas|o_nas|about|nous-contacter|contacto|contatti)/i.test(abs.pathname + ' ' + label)) {
        abs.hash = '';
        const clean = abs.toString();
        if (clean !== pageUrl && !contactLinks.includes(clean)) contactLinks.push(clean);
      }
    }
  }

  return { emails, phones, facebook, instagram, linkedin, contactLinks: contactLinks.slice(0, 4) };
}

/** Addresses on the business's own domain first: info@theirsite beats a web designer's credit. */
export function rankEmails(emails: string[], website: string): string[] {
  const site = host(website).split('.').slice(-2).join('.');
  const score = (e: string) => {
    const d = e.split('@')[1] || '';
    if (site && (d === site || d.endsWith(`.${site}`))) return 0;
    if (/^(gmail|googlemail|outlook|hotmail|yahoo|icloud|wp|o2|onet|interia|op|gmx|web|t-online)\./.test(d)) return 1;
    return 2;
  };
  return [...emails].sort((a, b) => score(a) - score(b)).slice(0, 5);
}

// ── robots.txt ───────────────────────────────────────────────────────────────

interface Rule { allow: boolean; rx: RegExp; len: number }

/** The rules that apply to us: our own group if there is one, else `*`. */
export function parseRobots(txt: string): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let cur: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur || (field !== 'allow' && field !== 'disallow')) continue;
    if (field === 'disallow' && !value) continue; // "Disallow:" with nothing = allow all
    const rx = new RegExp('^' + value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    cur.rules.push({ allow: field === 'allow', rx, len: value.length });
  }
  const ours = groups.find((g) => g.agents.some((a) => a.includes('runbutterbot')));
  const any = groups.find((g) => g.agents.includes('*'));
  return (ours || any)?.rules ?? [];
}

/** Longest matching rule wins; a tie goes to Allow (RFC 9309). */
export function robotsAllows(rules: Rule[], path: string): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!r.rx.test(path)) continue;
    if (!best || r.len > best.len || (r.len === best.len && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

// ── Network ──────────────────────────────────────────────────────────────────

function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.includes(':')) {
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(v);
  }
  const p = v.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n))) return true;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254)
    || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168)
    || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
}

async function resolvesPublic(hostname: string): Promise<boolean> {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return !isPrivateIp(hostname);
  try {
    const dns = await import('node:dns');
    const addrs = await dns.promises.lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch { return false; }
}

async function safeGet(url: string, maxBytes: number, timeoutMs: number): Promise<{ status: number; body: string; url: string; type: string } | null> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    if (!isSafeOutboundUrl(current)) return null;
    if (!(await resolvesPublic(new URL(current).hostname))) return null;
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: 'text/html,text/plain;q=0.9,*/*;q=0.5', 'accept-language': 'en,pl;q=0.8,de;q=0.6' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { return null; }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return null;
      try { current = new URL(loc, current).toString(); } catch { return null; }
      continue;
    }
    const type = res.headers.get('content-type') || '';
    if (!res.body) return { status: res.status, body: '', url: current, type };
    // Capped read: a "website" that is a 2 GB file must not become our problem.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < maxBytes) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done || !value) break;
      chunks.push(value); size += value.byteLength;
    }
    reader.cancel().catch(() => {});
    const buf = new Uint8Array(Math.min(size, maxBytes));
    let off = 0;
    for (const c of chunks) { const n = Math.min(c.byteLength, buf.length - off); buf.set(c.subarray(0, n), off); off += n; if (off >= buf.length) break; }
    return { status: res.status, body: new TextDecoder('utf-8', { fatal: false }).decode(buf), url: current, type };
  }
  return null;
}

const robotsCache = new Map<string, { at: number; rules: Rule[] | 'all' }>();

async function robotsFor(origin: string): Promise<Rule[] | 'all'> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < 3600_000) return hit.rules;
  const r = await safeGet(`${origin}/robots.txt`, 256_000, 4_000);
  // No file (4xx) = no rules. A server error is read as "not now" — the
  // conservative reading, and the one Google uses.
  const rules: Rule[] | 'all' = !r ? [] : r.status >= 500 ? 'all' : r.status >= 400 ? [] : parseRobots(r.body);
  if (robotsCache.size > 2000) robotsCache.clear();
  robotsCache.set(origin, { at: Date.now(), rules });
  return rules;
}

const allowed = (rules: Rule[] | 'all', url: string) =>
  rules !== 'all' && robotsAllows(rules, new URL(url).pathname + new URL(url).search);

/** Homepage, then up to two contact pages it links to. */
export async function findContacts(website: string): Promise<SiteContacts> {
  const out: SiteContacts = { website, emails: [], phones: [], facebook: '', instagram: '', linkedin: '', checked: [] };
  let start: URL;
  try { start = new URL(website); } catch { return { ...out, note: 'Not a valid website address.' }; }
  if (!isSafeOutboundUrl(start.toString())) return { ...out, note: 'Not a public website.' };

  const rules = await robotsFor(start.origin);
  if (!allowed(rules, start.toString())) return { ...out, note: 'This site asks not to be read by bots.' };

  const home = await safeGet(start.toString(), PAGE_BYTES, PAGE_TIMEOUT);
  if (!home) return { ...out, note: 'The website did not answer.' };
  if (home.status >= 400) return { ...out, note: `The website answered ${home.status}.` };
  if (home.type && !/html|text\/plain/i.test(home.type)) return { ...out, note: 'The website is not a web page.' };
  out.checked.push(home.url);

  const merge = (x: ReturnType<typeof extractContacts>) => {
    for (const e of x.emails) if (!out.emails.includes(e)) out.emails.push(e);
    for (const p of x.phones) if (!out.phones.includes(p)) out.phones.push(p);
    out.facebook ||= x.facebook; out.instagram ||= x.instagram; out.linkedin ||= x.linkedin;
  };
  const first = extractContacts(home.body, home.url);
  merge(first);

  // A homepage that already shows an address on its own domain is enough;
  // reading two more pages to confirm it is load on somebody else's server.
  const siteDomain = host(home.url).split('.').slice(-2).join('.');
  const haveOwn = out.emails.some((e) => (e.split('@')[1] || '').endsWith(siteDomain));
  if (!haveOwn) {
    for (const link of first.contactLinks.slice(0, 2)) {
      if (!allowed(rules, link)) continue;
      const page = await safeGet(link, PAGE_BYTES, PAGE_TIMEOUT);
      if (!page || page.status >= 400) continue;
      out.checked.push(page.url);
      merge(extractContacts(page.body, page.url));
    }
  }

  out.emails = rankEmails(out.emails, home.url);
  out.phones = out.phones.slice(0, 3);
  if (!out.emails.length && !out.phones.length) out.note = 'No email or phone on the pages read.';
  return out;
}
