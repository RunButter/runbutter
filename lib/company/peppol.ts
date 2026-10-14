// Peppol Directory — the public register of businesses that receive e-invoices.
//
// Why it is here: Germany (and Spain) confirm a VAT number through VIES and
// never say whose it is, and there is no free register from DE… to a name. But
// a business that receives e-invoices over Peppol publishes a "business card"
// keyed BY ITS VAT NUMBER — participant `9930:de123456789` is the German VAT ID
// DE123456789 — with the registered name, the country, usually the address,
// and often a website and an invoicing contact. Germany's B2B e-invoicing
// obligation (2025) and public-sector XRechnung put a growing share of German
// companies in it. Run by OpenPeppol, public, keyless, no terms against reading
// it; rate-limited by IP with a 429 + Retry-After, which is answered by not
// retrying.
//
// The scheme codes are the Peppol EAS list (docs.peppol.eu/poacc/billing/3.0/
// codelist/eas): only countries checked against it are listed; any other
// country is found through the generic search and VERIFIED, never trusted —
// a hit is accepted only when its participant id or one of its identifiers IS
// the VAT number asked for.
import { cleanEmail, cleanPhone, cleanWebsite } from '@/lib/leads/osm';

const API = 'https://directory.peppol.eu/search/1.0/json';
const UA = 'RunButter/1.0 (+https://runbutter.app; company lookup)';

/** VAT-number schemes in the Peppol EAS code list, by the VIES country code. */
export const PEPPOL_VAT_SCHEME: Record<string, string> = {
  DE: '9930', ES: '9920', BE: '9925', NL: '9944', FR: '9957', LU: '9938',
};

export interface PeppolCard {
  name: string;
  country: string;
  /** Free text the business entered — an address, or sometimes only a town. */
  geo: string;
  website?: string;
  email?: string;
  phone?: string;
  participant: string;
}

const lc = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** True when this match is the business with VAT number `vat` ("DE123456789"). */
export function peppolMatchIs(match: any, vat: string): boolean {
  const want = lc(vat).replace(/[^a-z0-9]/g, '');
  if (!want) return false;
  const bare = want.slice(2);
  const same = (v: unknown) => { const x = lc(v).replace(/[^a-z0-9]/g, ''); return x === want || (bare.length >= 8 && x === bare); };
  const pid = lc(match?.participantID?.value);
  if (same(pid.includes(':') ? pid.slice(pid.indexOf(':') + 1) : pid)) return true;
  for (const e of Array.isArray(match?.entities) ? match.entities : []) {
    for (const id of Array.isArray(e?.identifiers) ? e.identifiers : []) if (same(id?.value)) return true;
  }
  return false;
}

/** One verified match as the fields a company form needs. */
export function peppolCard(match: any, country: string): PeppolCard | null {
  const entities: any[] = Array.isArray(match?.entities) ? match.entities : [];
  const e = entities.find((x) => lc(x?.countryCode) === lc(country)) ?? entities[0];
  if (!e) return null;
  const names: any[] = Array.isArray(e.name) ? e.name : typeof e.name === 'string' ? [{ name: e.name }] : [];
  const name = String(names.find((n) => !n?.language || /^(de|en)$/i.test(n.language))?.name ?? names[0]?.name ?? '').trim();
  if (!name) return null;
  const contacts: any[] = Array.isArray(e.contacts) ? e.contacts : [];
  const email = contacts.map((c) => cleanEmail(String(c?.email || ''))).find(Boolean);
  const phone = contacts.map((c) => cleanPhone(String(c?.phone || ''))).find(Boolean);
  const website = (Array.isArray(e.websites) ? e.websites : []).map((w: any) => cleanWebsite(String(w || ''))).find(Boolean);
  return {
    name: name.slice(0, 200),
    country: String(e.countryCode || country || '').slice(0, 2).toUpperCase(),
    geo: String(e.geoInfo || '').replace(/\s*\n\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, 300),
    website: website || undefined,
    email: email || undefined,
    phone: phone || undefined,
    participant: `${match?.participantID?.scheme ? `${match.participantID.scheme}::` : ''}${match?.participantID?.value || ''}`,
  };
}

/** A geoInfo worth putting in the address box: a street and a number, not just "Berlin". */
export const looksLikeAddress = (s: string) => /\d/.test(s) && /\p{L}{3,}/u.test(s) && s.length >= 8;

async function search(params: Record<string, string>): Promise<any[]> {
  const res = await fetch(`${API}?${new URLSearchParams({ ...params, rpc: '20' })}`, {
    headers: { accept: 'application/json', 'user-agent': UA },
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  });
  if (res.status === 429) throw new Error('rate limited (HTTP 429)');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // An empty result is a 200 with an empty body, not JSON.
  const text = await res.text();
  if (!text.trim()) return [];
  try { const j = JSON.parse(text); return Array.isArray(j?.matches) ? j.matches : []; } catch { return []; }
}

/**
 * The business card of the company with this VAT number, or null. `country` is
 * the VIES code (EL for Greece), `id` the number without the prefix. Throws
 * only when the directory could not be asked — "not in it" is null.
 */
export async function peppolByVat(country: string, id: string): Promise<PeppolCard | null> {
  const cc = String(country || '').toUpperCase();
  const vat = `${cc}${String(id || '').toUpperCase()}`;
  if (!/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(vat)) return null;
  const scheme = PEPPOL_VAT_SCHEME[cc];
  const asks: Promise<any[]>[] = [];
  // Exact: the participant id IS the VAT number in the country's own scheme.
  if (scheme) asks.push(search({ participant: `iso6523-actorid-upis::${scheme}:${vat.toLowerCase()}` }));
  // Registered under another scheme (a GLN, a Leitweg-ID) with the VAT number
  // among its identifiers, or a country with no scheme listed above.
  asks.push(search({ q: vat }));
  const settled = await Promise.allSettled(asks);
  const matches = settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
  if (!matches.length && settled.every((s) => s.status === 'rejected')) {
    throw new Error((settled[0] as PromiseRejectedResult).reason?.message || 'no answer');
  }
  for (const m of matches) {
    if (!peppolMatchIs(m, vat)) continue;
    const card = peppolCard(m, cc === 'EL' ? 'GR' : cc);
    if (card) return card;
  }
  return null;
}
