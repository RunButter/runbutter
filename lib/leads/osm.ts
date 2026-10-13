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
const PHOTON = (process.env.OSM_PHOTON_URL || 'https://photon.komoot.io').replace(/\/$/, '');
// Overpass mirrors, tried in order until one answers. ONE public server was not
// enough: overpass-api.de queues and refuses by client IP, and a host like
// Render sends every customer's traffic from a few shared IPs — so other
// people's map apps used up our slots and every search "did not answer in
// time". These instances are listed on the OSM wiki as public and keyless.
// OSM_OVERPASS_URL replaces the list (comma-separated) for a deployment with
// its own server.
const OVERPASS_URLS = (process.env.OSM_OVERPASS_URL || [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
].join(',')).split(',').map((u) => u.trim()).filter(Boolean);
/** Per server. A healthy one answers a city search in a few seconds. */
const OVERPASS_ATTEMPT_MS = 15_000;
const UA = 'RunButter/1.0 (+https://runbutter.app; lead finder)';
// Identify ourselves from the server. A BROWSER must not set User-Agent: some
// browsers then send a CORS preflight these public services may not answer,
// and the browser already identifies the site through its Referer.
const ID: Record<string, string> = typeof window === 'undefined' ? { 'user-agent': UA } : {};

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
  /** Google results carry these; OpenStreetMap has no reviews. */
  rating?: number;
  reviews?: number;
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
  /** Said when the search was narrowed for the person (a large city searched round its centre). */
  note?: string;
}

export class LeadSearchError extends Error {}
/** A question for the person (too big, a whole region, say what) — the answer, never a reason to try elsewhere. */
export class LeadInputError extends LeadSearchError { name = 'LeadInputError'; }
/** Every Overpass server refused; `reasons` says how each one did. */
export class OverpassUnavailable extends LeadSearchError {
  constructor(public reasons: string[]) { super('The map servers did not answer.'); }
}

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

/** Photon (komoot) answers in GeoJSON; the same OSM objects, a different shape. */
export function photonToGeoPlace(f: any): GeoPlace | null {
  const p = f?.properties || {};
  const [lon, lat] = Array.isArray(f?.geometry?.coordinates) ? f.geometry.coordinates.map(Number) : [NaN, NaN];
  const osmType = p.osm_type === 'R' ? 'relation' : p.osm_type === 'W' ? 'way' : p.osm_type === 'N' ? 'node' : null;
  if (!osmType || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // extent is [minLon, maxLat, maxLon, minLat]
  const ex = Array.isArray(p.extent) ? p.extent.map(Number) : null;
  const bbox: [number, number, number, number] = ex && ex.length === 4 ? [ex[3], ex[1], ex[0], ex[2]] : [lat, lat, lon, lon];
  const label = [p.name, p.city && p.city !== p.name ? p.city : '', p.state, p.country].filter(Boolean).join(', ');
  return {
    label, lat, lon, osmType, osmId: Number(p.osm_id),
    country: String(p.countrycode || '').toUpperCase(),
    city: String(p.city || (/^(city|town|village)$/.test(p.type || '') ? p.name : '') || p.name || ''),
    bbox, kind: String(p.type || p.osm_value || ''),
  };
}

async function nominatim(query: string, lang: string): Promise<GeoPlace[] | null> {
  await nominatimSlot();
  const url = `${NOMINATIM}/search?${new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', addressdetails: '1' })}`;
  try {
    const res = await fetch(url, {
      headers: { ...ID, accept: 'application/json', 'accept-language': lang },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) { console.error(`leads/geocode: Nominatim answered ${res.status}`); return null; }
    const rows = await res.json().catch(() => null);
    return Array.isArray(rows) ? (rows.map(toGeoPlace).filter(Boolean) as GeoPlace[]) : null;
  } catch (e: any) {
    console.error('leads/geocode: Nominatim unreachable —', e?.cause?.code || e?.message);
    return null;
  }
}

async function photon(query: string, lang: string): Promise<GeoPlace[] | null> {
  // Photon speaks a handful of languages; anything else falls back to default.
  const l = /^(en|de|fr|it)$/.test(lang.slice(0, 2)) ? lang.slice(0, 2) : 'default';
  const url = `${PHOTON}/api/?${new URLSearchParams({ q: query, limit: '5', ...(l !== 'default' ? { lang: l } : {}) })}`;
  try {
    const res = await fetch(url, { headers: { ...ID, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    return Array.isArray(j?.features) ? (j.features.map(photonToGeoPlace).filter(Boolean) as GeoPlace[]) : null;
  } catch { return null; }
}

/**
 * Place name → place, anywhere in the world. Nominatim first; Photon (the same
 * OpenStreetMap data, served by komoot) when Nominatim is unreachable or
 * refuses — a shared hosting IP can be throttled by one service and not the
 * other, and a search that cannot even find "Lagos" is not a global feature.
 */
export async function geocode(q: string, lang = 'en'): Promise<GeoPlace[]> {
  const query = q.trim().slice(0, 200);
  if (!query) return [];
  const key = `${lang}|${query.toLowerCase()}`;
  const cached = geoCache.get(key);
  if (cached) return cached;

  const places = (await nominatim(query, lang)) ?? (await photon(query, lang));
  if (!places) throw new LeadSearchError('Could not reach the place search. Try again in a moment.');
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
/** Kinds of place that are a region, not somewhere to prospect street by street. */
const REGION = /^(country|state|region|province|county|state_district|archipelago|continent)$/i;
/** How far round the centre a city too large to search whole is searched. */
export const BIG_CITY_KM = 15;

export function scopeFor(place: GeoPlace, radiusKm?: number): Scope {
  const km = Number(radiusKm) || 0;
  if (km > 0) return { kind: 'around', lat: place.lat, lon: place.lon, m: Math.round(Math.min(km, 50) * 1000) };
  const [s, n, w, e] = place.bbox;
  if (n - s > MAX_SPAN_DEG || e - w > MAX_SPAN_DEG) {
    // Istanbul, Sydney, Chongqing and Tokyo are each one "city" wider than a
    // whole country's worth of queries; refusing them made the feature useless
    // for exactly the markets with the most businesses. A city becomes a
    // circle round its centre (and says so); a country or region still asks
    // for something smaller, because its centre is not a place.
    if (REGION.test(place.kind)) {
      throw new LeadInputError(`${place.label.split(',')[0]} is a whole region. Pick a city or district in it, or choose a distance.`);
    }
    return { kind: 'around', lat: place.lat, lon: place.lon, m: BIG_CITY_KM * 1000 };
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
  // A small timeout and maxsize are not just limits: Overpass admits a query
  // only if the server has room for what it DECLARES, so a modest declaration
  // gets in on a busy server where the defaults (180 s, 512 MB) are refused.
  return `[out:json][timeout:18][maxsize:67108864];\n(\n${parts}\n);\nout center tags ${limit};`;
}

/** The server that answered last is asked first next time. */
let preferred = 0;

async function runOverpass(ql: string): Promise<{ elements: any[] }> {
  const cached = queryCache.get(ql);
  if (cached) return cached;

  const tried: string[] = [];
  for (let i = 0; i < OVERPASS_URLS.length; i++) {
    const idx = (preferred + i) % OVERPASS_URLS.length;
    const url = OVERPASS_URLS[idx];
    const host = (() => { try { return new URL(url).host; } catch { return url; } })();
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { ...ID, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ data: ql }).toString(),
        signal: AbortSignal.timeout(OVERPASS_ATTEMPT_MS),
      });
    } catch (e: any) {
      tried.push(`${host}: ${e?.name === 'TimeoutError' ? `no answer in ${OVERPASS_ATTEMPT_MS / 1000} s` : e?.cause?.code || e?.message || 'unreachable'}`);
      continue;
    }
    // Busy, rate-limited, or down: the next server may well be fine.
    if (res.status === 429 || res.status >= 500) { tried.push(`${host}: HTTP ${res.status}`); continue; }
    if (!res.ok) { tried.push(`${host}: HTTP ${res.status}`); continue; }
    const j = await res.json().catch(() => null);
    if (!j || !Array.isArray(j.elements)) { tried.push(`${host}: unreadable answer`); continue; }
    // Overpass reports its own failures inside a 200, with a remark. "Too
    // busy" is the server's problem, so try another; a query that ran out of
    // time or memory is the query's, and would fail everywhere. Either way a
    // partial list is never shown as the whole.
    if (typeof j.remark === 'string' && /runtime error|timed out|out of memory|too busy/i.test(j.remark)) {
      if (/too busy|Dispatcher_Client|rate_limited/i.test(j.remark)) { tried.push(`${host}: busy`); continue; }
      throw new LeadSearchError('That search was too big to finish. Choose a distance or a smaller place.');
    }
    preferred = idx;
    const out = { elements: j.elements as any[] };
    queryCache.set(ql, out);
    return out;
  }
  // Said in the server log with the reason per server, because "did not
  // answer" alone is what made this hard to diagnose the first time.
  console.error('leads/overpass: every server failed —', tried.join('; '));
  throw new OverpassUnavailable(tried);
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

// ── When Overpass is out of reach: the same map, through Nominatim ─────────────
//
// In production EVERY public Overpass server refused the hosting provider's
// shared IPs ("map servers are busy"), while Nominatim — which geocoded the
// place in the same request — answered. Nominatim also searches businesses: a
// type word ("dentist") inside a bounding box returns the dentists there, and
// `extratags` carries their phone, website and opening hours. It returns at
// most 40 a page, so this is a smaller search than Overpass, said as such, and
// it is spaced like every other Nominatim call. Results are kept only when
// their OSM class/type is one of the category's own tag pairs, so a street
// called "Dentist" never becomes a lead.

const NOMINATIM_PAGES = 2;

function viewboxFor(place: GeoPlace, scope: Scope): string {
  if (scope.kind === 'around') {
    const dLat = scope.m / 111_320;
    const dLon = scope.m / (111_320 * Math.max(0.2, Math.cos((scope.lat * Math.PI) / 180)));
    return [scope.lon - dLon, scope.lat + dLat, scope.lon + dLon, scope.lat - dLat].map((x) => x.toFixed(6)).join(',');
  }
  const [s, n, w, e] = place.bbox;
  return [w, n, e, s].map((x) => x.toFixed(6)).join(',');
}

/** A Nominatim search hit, as the Overpass element toFoundPlace already reads. */
export function nominatimToElement(r: any): any | null {
  const type = r?.osm_type, id = Number(r?.osm_id);
  if (!['node', 'way', 'relation'].includes(type) || !Number.isFinite(id)) return null;
  const a = r.address || {};
  const cls = r.category || r.class;
  return {
    type, id, lat: Number(r.lat), lon: Number(r.lon),
    tags: {
      ...(r.extratags || {}),
      ...(cls && r.type ? { [cls]: r.type } : {}),
      name: r.name || r.namedetails?.name || '',
      'addr:street': a.road || a.pedestrian || '', 'addr:housenumber': a.house_number || '',
      'addr:postcode': a.postcode || '', 'addr:city': a.city || a.town || a.village || a.municipality || '',
      'addr:country': String(a.country_code || '').toUpperCase(),
    },
  };
}

async function nominatimPlaces(cat: LeadCategory, place: GeoPlace, scope: Scope, name: string, lang: string): Promise<any[]> {
  const phrases = [...new Set(cat.tags.map(([, v]) => v.replace(/_/g, ' ')))].slice(0, 2);
  const wanted = (r: any) => cat.tags.some(([k, v]) => (r.category || r.class) === k && r.type === v);
  const nm = safeNameFilter(name).toLowerCase();
  const out: any[] = [];
  const seen = new Set<string>();
  for (const phrase of phrases) {
    const exclude: string[] = [];
    for (let page = 0; page < NOMINATIM_PAGES; page++) {
      await nominatimSlot();
      const params = new URLSearchParams({
        q: phrase, format: 'jsonv2', limit: '40', addressdetails: '1', extratags: '1',
        viewbox: viewboxFor(place, scope), bounded: '1',
        ...(exclude.length ? { exclude_place_ids: exclude.join(',') } : {}),
      });
      let rows: any[] = [];
      try {
        const res = await fetch(`${NOMINATIM}/search?${params}`, {
          headers: { ...ID, accept: 'application/json', 'accept-language': lang },
          signal: AbortSignal.timeout(10_000),
        });
        rows = res.ok ? await res.json().catch(() => []) : [];
      } catch { rows = []; }
      if (!Array.isArray(rows) || !rows.length) break;
      for (const r of rows) {
        if (r.place_id) exclude.push(String(r.place_id));
        if (!wanted(r)) continue;
        if (nm && !String(r.name || '').toLowerCase().includes(nm)) continue;
        const el = nominatimToElement(r);
        const key = el ? `${el.type}/${el.id}` : '';
        if (el && !seen.has(key)) { seen.add(key); out.push(el); }
      }
      if (rows.length < 40) break;
    }
  }
  return out;
}

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
  let elements: any[] = [];
  let fallbackNote = '';
  try {
    ({ elements } = await runOverpass(buildQuery(cat, scope, input.name)));
    // A boundary Overpass has no area for answers EMPTY rather than an error, so
    // an empty area search is retried over the bounding box before it is
    // believed. Rare, but "no dentists in Kraków" is the sort of answer that
    // gets a feature abandoned.
    if (!elements.length && scope.kind === 'area') {
      const [s, n, w, e] = place.bbox;
      ({ elements } = await runOverpass(buildQuery(cat, { kind: 'bbox', s, n, w, e }, input.name)));
    }
  } catch (err) {
    if (!(err instanceof OverpassUnavailable)) throw err;
    elements = await nominatimPlaces(cat, place, scope, input.name || '', input.lang || 'en');
    if (!elements.length) {
      // Say exactly what each server did: "busy" alone is what made this hard
      // to diagnose from a screenshot.
      throw new LeadSearchError(`The map servers did not answer (${err.reasons.join('; ')}), and the backup search found nothing. Try again in a few minutes.`);
    }
    fallbackNote = `The main map servers were busy, so this is a smaller search (up to ${NOMINATIM_PAGES * 40} per kind of business). Search again later for the full list.`;
  }

  const results = dedupePlaces(
    elements.map((el) => toFoundPlace(el, place!, cat.one)).filter(Boolean) as FoundPlace[],
  );
  const narrowed = scope.kind === 'around' && !(Number(input.radiusKm) > 0) && scope.m === BIG_CITY_KM * 1000;
  const notes = [
    narrowed ? `${place.label.split(',')[0]} is large, so this searched within ${BIG_CITY_KM} km of its centre. Pick a district, or a distance from an address, to search elsewhere in it.` : '',
    fallbackNote,
  ].filter(Boolean);
  return {
    place, alternatives, results, truncated: elements.length >= MAX_RESULTS,
    ...(notes.length ? { note: notes.join(' ') } : {}),
  };
}

/** A place sent back by the browser is re-validated, never trusted as-is. */
export function sanitizePlace(p: GeoPlace): GeoPlace | null {
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
