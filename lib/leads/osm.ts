// Finding businesses on OpenStreetMap — the data source behind Find leads.
//
// ── WHY OPENSTREETMAP AND NOT GOOGLE MAPS ───────────────────────────────────
// Google's terms forbid scraping Maps, and its Places API forbids storing the
// results ("no pre-fetching, caching, indexing or storing of Content" beyond
// the place id) — so a lead list built from either is a breach the day it is
// saved, and a scraper running from our servers is blocked within the week.
// OpenStreetMap data is ODbL: free, keyless, and storable, on the condition
// that the attribution is shown, which the screen does.
//
// ── TWO PUBLIC SERVICES, BOTH WITH RULES ────────────────────────────────────
// Nominatim (place names → coordinates) allows ONE request per second, an
// identifying User-Agent, and no autocomplete. It is called once per search,
// spaced here per process, and cached. Overpass (the business query) asks for
// under 10,000 queries a day per user of the public instance. Both are
// replaceable for a self-hoster or a busy deployment: OSM_NOMINATIM_URL and
// OSM_OVERPASS_URL.
//
// ── NOTHING TYPED REACHES THE QUERY AS SYNTAX ───────────────────────────────
// Tags come from lib/leads/categories.ts. The optional name filter is reduced
// to letters, digits and spaces before it is placed inside a regex, so there is
// no character left that means anything to Overpass QL or to the regex.
import { CATEGORY_BY_KEY, categoryLabelFor, type LeadCategory } from './categories';

const NOMINATIM = (process.env.OSM_NOMINATIM_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const OVERPASS = process.env.OSM_OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const UA = 'RunButter/1.0 (+https://runbutter.app; lead finder)';

/** Most results one search returns. Enough for a city's dentists; a city's shops needs a smaller area. */
export const MAX_RESULTS = 400;
/** Wider than this (in degrees, either way) without a radius is a region, not a place to prospect. */
const MAX_SPAN_DEG = 1.2;

export interface GeoPlace {
  label: string;
  lat: number;
  lon: number;
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
  /** ISO 3166-1 alpha-2, upper case, or ''. */
  country: string;
  /** The town a found business is in when its own address does not say. */
  city: string;
  /** [south, north, west, east] */
  bbox: [number, number, number, number];
  kind: string;
}

export interface FoundPlace {
  /** `node/123` — stable, and what deduplicates a lead found twice. */
  ref: string;
  /** The place on openstreetmap.org: provenance anybody can check. */
  url: string;
  name: string;
  category: string;
  address: string;
  city: string;
  postcode: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  opening_hours: string;
  facebook: string;
  instagram: string;
  lat: number;
  lon: number;
}

export interface SearchInput {
  category: string;
  /** Free text: "Kraków", "Kazimierz, Kraków", "SW1A 1AA". */
  where: string;
  /** 0 or absent = the whole place. */
  radiusKm?: number;
  /** Narrows by business name ("smile" for dentists called Smile…). */
  name?: string;
  /** A place picked from a previous search's alternatives, so the same name is not re-guessed. */
  place?: GeoPlace | null;
  lang?: string;
}

export interface SearchResult {
  place: GeoPlace;
  alternatives: GeoPlace[];
  results: FoundPlace[];
  truncated: boolean;
}

export class LeadSearchError extends Error {}

// ── Small caches ─────────────────────────────────────────────────────────────

function ttlCache<V>(max: number, ttlMs: number) {
  const m = new Map<string, { at: number; v: V }>();
  return {
    get(k: string): V | undefined {
      const hit = m.get(k);
      if (!hit) return undefined;
      if (Date.now() - hit.at > ttlMs) { m.delete(k); return undefined; }
      return hit.v;
    },
    set(k: string, v: V) {
      if (m.size >= max) m.delete(m.keys().next().value as string);
      m.set(k, { at: Date.now(), v });
    },
  };
}

const geoCache = ttlCache<GeoPlace[]>(500, 24 * 3600_000);
const queryCache = ttlCache<{ elements: any[] }>(200, 10 * 60_000);

// Nominatim's policy is one request per second, absolute. Chained so that
// concurrent searches on one server queue rather than burst.
let nominatimChain: Promise<void> = Promise.resolve();
function nominatimSlot(): Promise<void> {
  const next = nominatimChain.then(() => new Promise<void>((r) => setTimeout(r, 1100)));
  const mine = nominatimChain;
  nominatimChain = next;
  return mine;
}

// ── Geocoding ────────────────────────────────────────────────────────────────

export function toGeoPlace(r: any): GeoPlace | null {
  const lat = Number(r?.lat), lon = Number(r?.lon);
  const osmType = r?.osm_type;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (osmType !== 'node' && osmType !== 'way' && osmType !== 'relation') return null;
  const bb = Array.isArray(r?.boundingbox) ? r.boundingbox.map(Number) : [lat, lat, lon, lon];
  const a = r?.address || {};
  return {
    label: String(r?.display_name || r?.name || ''),
    lat, lon, osmType, osmId: Number(r?.osm_id),
    country: String(a.country_code || '').toUpperCase(),
    city: String(a.city || a.town || a.village || a.municipality || a.suburb || r?.name || ''),
    bbox: [bb[0], bb[1], bb[2], bb[3]] as [number, number, number, number],
    kind: String(r?.addresstype || r?.type || ''),
  };
}

export async function geocode(q: string, lang = 'en'): Promise<GeoPlace[]> {
  const query = q.trim().slice(0, 200);
  if (!query) return [];
  const key = `${lang}|${query.toLowerCase()}`;
  const cached = geoCache.get(key);
  if (cached) return cached;

  await nominatimSlot();
  const url = `${NOMINATIM}/search?${new URLSearchParams({
    q: query, format: 'jsonv2', limit: '5', addressdetails: '1',
  })}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json', 'accept-language': lang },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new LeadSearchError('Could not reach the place search. Try again in a moment.');
  }
  if (!res.ok) throw new LeadSearchError(`The place search answered ${res.status}. Try again in a moment.`);
  const rows = await res.json().catch(() => []);
  const places = (Array.isArray(rows) ? rows : []).map(toGeoPlace).filter(Boolean) as GeoPlace[];
  geoCache.set(key, places);
  return places;
}

// ── The Overpass query ───────────────────────────────────────────────────────

/** Letters, digits and spaces only — the one thing put inside the query that a person typed. */
export function safeNameFilter(s: string | undefined): string {
  return String(s || '').normalize('NFC').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

export type Scope =
  | { kind: 'area'; id: number }
  | { kind: 'around'; lat: number; lon: number; m: number }
  | { kind: 'bbox'; s: number; w: number; n: number; e: number };

/**
 * Where to look. A radius is always a circle round the place's centre. Without
 * one, a boundary (a city, a district, a postcode) is searched as an AREA so
 * the results are exactly that place; anything else (a street, a single
 * point) becomes a 2 km circle, because "the whole of a street" is not an
 * answer anybody wants.
 */
export function scopeFor(place: GeoPlace, radiusKm?: number): Scope {
  const km = Number(radiusKm) || 0;
  if (km > 0) return { kind: 'around', lat: place.lat, lon: place.lon, m: Math.round(Math.min(km, 50) * 1000) };
  const [s, n, w, e] = place.bbox;
  if (n - s > MAX_SPAN_DEG || e - w > MAX_SPAN_DEG) {
    throw new LeadSearchError(`${place.label.split(',')[0]} is too big to search whole. Pick a city or district, or choose a distance.`);
  }
  if (place.osmType === 'relation') return { kind: 'area', id: 3_600_000_000 + place.osmId };
  if (place.osmType === 'way' && n - s > 0.002) return { kind: 'area', id: 2_400_000_000 + place.osmId };
  return { kind: 'around', lat: place.lat, lon: place.lon, m: 2000 };
}

const scopeQL = (sc: Scope): string =>
  sc.kind === 'area' ? `(area:${sc.id})`
  : sc.kind === 'around' ? `(around:${sc.m},${sc.lat.toFixed(6)},${sc.lon.toFixed(6)})`
  : `(${sc.s.toFixed(6)},${sc.w.toFixed(6)},${sc.n.toFixed(6)},${sc.e.toFixed(6)})`;

export function buildQuery(cat: LeadCategory, scope: Scope, name?: string, limit = MAX_RESULTS): string {
  const nm = safeNameFilter(name);
  const nameFilter = nm ? `["name"~"${nm}",i]` : '["name"]';
  const where = scopeQL(scope);
  const parts = cat.tags.map(([k, v]) => `  nwr["${k}"="${v}"]${nameFilter}${where};`).join('\n');
  return `[out:json][timeout:25];\n(\n${parts}\n);\nout center tags ${limit};`;
}

async function runOverpass(ql: string): Promise<{ elements: any[] }> {
  const cached = queryCache.get(ql);
  if (cached) return cached;
  let res: Response;
  try {
    res = await fetch(OVERPASS, {
      method: 'POST',
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ data: ql }).toString(),
      signal: AbortSignal.timeout(35_000),
    });
  } catch {
    throw new LeadSearchError('The map database did not answer in time. Try a smaller area.');
  }
  if (res.status === 429 || res.status === 504) {
    throw new LeadSearchError('The map database is busy right now. Try again in a minute.');
  }
  if (!res.ok) throw new LeadSearchError(`The map database answered ${res.status}. Try again in a moment.`);
  const j = await res.json().catch(() => null);
  if (!j || !Array.isArray(j.elements)) throw new LeadSearchError('The map database sent something unreadable. Try again.');
  // A timeout or memory limit inside Overpass still answers 200, with a remark
  // and whatever it managed — a partial list presented as the whole would be
  // the quiet kind of wrong.
  if (typeof j.remark === 'string' && /runtime error|timed out|out of memory/i.test(j.remark)) {
    throw new LeadSearchError('That search was too big to finish. Choose a distance or a smaller place.');
  }
  const out = { elements: j.elements as any[] };
  queryCache.set(ql, out);
  return out;
}

// ── Turning OSM tags into a lead ─────────────────────────────────────────────

const first = (v: string | undefined) => String(v || '').split(';')[0].trim();
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function cleanWebsite(v: string | undefined): string {
  let s = first(v);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!u.hostname.includes('.')) return '';
    return u.toString().slice(0, 500);
  } catch { return ''; }
}

export function cleanEmail(v: string | undefined): string {
  const s = first(v).replace(/^mailto:/i, '').toLowerCase();
  return EMAIL.test(s) && s.length <= 120 ? s : '';
}

export function cleanPhone(v: string | undefined): string {
  const s = first(v).replace(/[^\d+()\-\s./]/g, '').replace(/\s+/g, ' ').trim();
  const digits = s.replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 16 ? s : '';
}

function social(v: string | undefined, host: string): string {
  const s = first(v);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return cleanWebsite(s);
  const handle = s.replace(/^@/, '').replace(/[^\w.\-]/g, '');
  return handle ? `https://www.${host}/${handle}` : '';
}

const isSocialHost = (url: string, host: string) => {
  try { return new URL(url).hostname.replace(/^www\.|^m\./, '').endsWith(host); } catch { return false; }
};

export function toFoundPlace(el: any, place: Pick<GeoPlace, 'city' | 'country'>, categoryLabel?: string): FoundPlace | null {
  const t: Record<string, string> = el?.tags || {};
  const name = String(t.name || t.brand || '').trim();
  if (!name || (el.type !== 'node' && el.type !== 'way' && el.type !== 'relation')) return null;

  const street = [t['addr:street'] || t['addr:place'], t['addr:housenumber']].filter(Boolean).join(' ');
  const city = t['addr:city'] || place.city || '';
  const postcode = t['addr:postcode'] || '';
  const town = [postcode, city].filter(Boolean).join(' ');
  const address = t['addr:full'] || [street, town].filter(Boolean).join(', ');

  let website = cleanWebsite(t.website || t['contact:website'] || t.url);
  let facebook = social(t['contact:facebook'] || t.facebook, 'facebook.com');
  const instagram = social(t['contact:instagram'] || t.instagram, 'instagram.com');
  // A Facebook page in the website tag is common, and it is not a website: the
  // contact finder would only ever be refused by it.
  if (website && isSocialHost(website, 'facebook.com')) { facebook = facebook || website; website = ''; }

  const lat = Number(el.lat ?? el.center?.lat);
  const lon = Number(el.lon ?? el.center?.lon);

  return {
    ref: `${el.type}/${el.id}`,
    url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    name: name.slice(0, 200),
    category: categoryLabelFor(t) || categoryLabel || '',
    address: address.slice(0, 300),
    city: city.slice(0, 120),
    postcode: postcode.slice(0, 20),
    country: String(t['addr:country'] || place.country || '').toUpperCase().slice(0, 2),
    phone: cleanPhone(t.phone || t['contact:phone'] || t['contact:mobile'] || t.mobile),
    email: cleanEmail(t.email || t['contact:email']),
    website,
    opening_hours: String(t.opening_hours || '').slice(0, 200),
    facebook,
    instagram,
    lat: Number.isFinite(lat) ? lat : 0,
    lon: Number.isFinite(lon) ? lon : 0,
  };
}

const richness = (p: FoundPlace) => (p.website ? 2 : 0) + (p.email ? 3 : 0) + (p.phone ? 1 : 0);

/**
 * One business mapped twice — a point for the door and an outline for the
 * building — is one lead. Same name at a DIFFERENT address is a branch, and a
 * branch is a separate lead.
 */
export function dedupePlaces(rows: FoundPlace[]): FoundPlace[] {
  const by = new Map<string, FoundPlace>();
  for (const p of rows) {
    const k = `${p.name.toLowerCase()}|${p.address.toLowerCase() || p.ref}`;
    const prev = by.get(k);
    // Keep the richer one and fill its gaps from the other.
    by.set(k, !prev ? p : richness(p) > richness(prev) ? { ...prev, ...pick(p) } : { ...p, ...pick(prev) });
  }
  return [...by.values()].sort((a, b) => richness(b) - richness(a) || a.name.localeCompare(b.name));
}
const pick = (p: FoundPlace): Partial<FoundPlace> =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== 0));

// ── The whole search ─────────────────────────────────────────────────────────

export async function searchBusinesses(input: SearchInput): Promise<SearchResult> {
  const cat = CATEGORY_BY_KEY[input.category];
  if (!cat) throw new LeadSearchError('Pick what kind of business to look for.');

  let place = input.place && Number.isFinite(input.place.lat) ? sanitizePlace(input.place) : null;
  let alternatives: GeoPlace[] = [];
  if (!place) {
    if (!input.where?.trim()) throw new LeadSearchError('Say where to look — a city, a district or a postcode.');
    const found = await geocode(input.where, input.lang);
    if (!found.length) throw new LeadSearchError(`Could not find “${input.where.trim()}” on the map. Try adding the country.`);
    place = found[0];
    alternatives = found.slice(1);
  }

  const scope = scopeFor(place, input.radiusKm);
  let { elements } = await runOverpass(buildQuery(cat, scope, input.name));
  // A boundary Overpass has no area for answers EMPTY rather than an error, so
  // an empty area search is retried over the bounding box before it is
  // believed. Rare, but "no dentists in Kraków" is the sort of answer that gets
  // a feature abandoned.
  if (!elements.length && scope.kind === 'area') {
    const [s, n, w, e] = place.bbox;
    ({ elements } = await runOverpass(buildQuery(cat, { kind: 'bbox', s, n, w, e }, input.name)));
  }

  const results = dedupePlaces(
    elements.map((el) => toFoundPlace(el, place!, cat.one)).filter(Boolean) as FoundPlace[],
  );
  return { place, alternatives, results, truncated: elements.length >= MAX_RESULTS };
}

/** A place sent back by the browser is re-validated, never trusted as-is. */
function sanitizePlace(p: GeoPlace): GeoPlace | null {
  const n = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : NaN);
  const lat = n(p.lat), lon = n(p.lon), id = n(p.osmId);
  if (![lat, lon, id].every(Number.isFinite)) return null;
  if (!['node', 'way', 'relation'].includes(p.osmType)) return null;
  const bb = (Array.isArray(p.bbox) ? p.bbox : []).map(n);
  if (bb.length !== 4 || !bb.every(Number.isFinite)) return null;
  return {
    label: String(p.label || '').slice(0, 300), lat, lon, osmType: p.osmType, osmId: Math.trunc(id),
    country: String(p.country || '').replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase(),
    city: String(p.city || '').slice(0, 120),
    bbox: bb as [number, number, number, number], kind: String(p.kind || '').slice(0, 40),
  };
}
