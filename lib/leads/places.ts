// Google Places API (New) — the live, official Google Maps data, on the
// workspace's OWN key.
//
// Why this exists beside OpenStreetMap and the self-hosted scraper: it is the
// one source that is complete, current to the day, worldwide, and reachable
// from any server — an API call with a key is not a bot, so nothing blocks it.
// Phone, website, opening hours, rating and review count come back with every
// result. It is metered, so each workspace brings its own key and pays Google
// directly (Google gives every key a free monthly allowance), exactly like the
// AI keys. Nothing here runs without one.
//
// ── GETTING PAST 60 ─────────────────────────────────────────────────────────
// Text Search returns at most 60 places per query (three pages of 20). A city
// has more dentists than that, so the area is searched as a quadtree: an area
// that comes back FULL (60) is split into four and each quarter searched again,
// until nothing is full, the tiles are a few hundred metres across, or the
// call budget the person chose is spent. Every page is one billed call, and
// the result says how many were used.
//
// Google's terms: Places content may be shown to the person who searched;
// STORING it beyond the place id is restricted. The screen says so next to the
// choice, and saving is the person's decision — same as the scraper.
import { cleanWebsite, type FoundPlace } from './osm';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

// Phone, website, hours and rating are what make a lead, and they put every
// call in the Text Search "Enterprise" SKU — the same price whichever of them
// is asked for, so all of them are asked for.
const FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents',
  'places.location', 'places.googleMapsUri', 'places.businessStatus', 'places.primaryTypeDisplayName',
  'places.nationalPhoneNumber', 'places.internationalPhoneNumber', 'places.websiteUri',
  'places.rating', 'places.userRatingCount', 'places.regularOpeningHours.weekdayDescriptions',
  'nextPageToken',
].join(',');

const PAGE = 20;
const FULL = 60;
/** A tile narrower than this (degrees, ~300 m) is not split again. */
const MIN_TILE_DEG = 0.003;

export const PLACES_DEPTHS = {
  quick: { calls: 3, label: 'Top 60', hint: 'up to 3 Google searches' },
  city: { calls: 30, label: 'Whole area', hint: 'up to 30 Google searches' },
  deep: { calls: 90, label: 'Every street', hint: 'up to 90 Google searches' },
} as const;
export type PlacesDepth = keyof typeof PLACES_DEPTHS;

export interface Rect { s: number; w: number; n: number; e: number }

export class PlacesError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}

/** Google's error, said in words a person can act on. */
export function placesErrorMessage(status: number, body: any): string {
  const msg = String(body?.error?.message || '');
  const reason = JSON.stringify(body?.error?.details || '');
  if (/API_KEY_INVALID|API key not valid/i.test(msg + reason)) return 'Google says this API key is not valid. Check it was copied whole.';
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(msg + reason)) return 'Turn on “Places API (New)” for this key’s project in Google Cloud console, then try again.';
  if (/billing/i.test(msg)) return 'This key’s Google Cloud project has no billing account. Google asks for one even within the free monthly allowance.';
  if (/referer|referrer|API_KEY_HTTP_REFERRER_BLOCKED|IP address/i.test(msg + reason)) return 'This key is restricted to websites or other IP addresses. Use a key restricted to the Places API instead.';
  if (/API_KEY_SERVICE_BLOCKED|blocked/i.test(msg + reason)) return 'This key is not allowed to call the Places API. Add “Places API (New)” to its API restrictions.';
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return 'This key’s Google quota is used up for now. Raise it in Google Cloud console, or try later.';
  return `Google answered ${status}${msg ? `: ${msg.slice(0, 200)}` : '.'}`;
}

async function call(key: string, body: Record<string, unknown>): Promise<{ places: any[]; next?: string }> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'x-goog-fieldmask': FIELDS },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new PlacesError('Google did not answer. Try again in a moment.', 502);
  }
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new PlacesError(placesErrorMessage(res.status, j), res.status === 429 ? 429 : 422);
  return { places: Array.isArray(j?.places) ? j.places : [], next: typeof j?.nextPageToken === 'string' ? j.nextPageToken : undefined };
}

const comp = (p: any, type: string, short = false): string => {
  const c = (Array.isArray(p?.addressComponents) ? p.addressComponents : []).find((x: any) => Array.isArray(x?.types) && x.types.includes(type));
  return String((short ? c?.shortText : c?.longText) || '');
};

/** One Places result as a lead row. Null for a business Google marks permanently closed. */
export function googleToFoundPlace(p: any, fallbackCategory = ''): FoundPlace | null {
  const id = String(p?.id || '');
  const name = String(p?.displayName?.text || '').trim();
  if (!id || !name) return null;
  if (p?.businessStatus === 'CLOSED_PERMANENTLY') return null;
  const maps = String(p?.googleMapsUri || '');
  return {
    ref: `google/${id}`,
    url: /^https:\/\/(maps\.google\.com|www\.google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl)/i.test(maps)
      ? maps : `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(id)}`,
    name: name.slice(0, 200),
    category: String(p?.primaryTypeDisplayName?.text || fallbackCategory).slice(0, 80),
    address: String(p?.formattedAddress || '').slice(0, 300),
    city: (comp(p, 'locality') || comp(p, 'postal_town') || comp(p, 'administrative_area_level_2')).slice(0, 120),
    postcode: comp(p, 'postal_code').slice(0, 20),
    country: comp(p, 'country', true).slice(0, 2).toUpperCase(),
    phone: String(p?.internationalPhoneNumber || p?.nationalPhoneNumber || '').slice(0, 40),
    email: '', // Google does not publish emails; Check websites finds them.
    website: cleanWebsite(p?.websiteUri),
    opening_hours: (Array.isArray(p?.regularOpeningHours?.weekdayDescriptions) ? p.regularOpeningHours.weekdayDescriptions : []).join('; ').slice(0, 500),
    facebook: '', instagram: '',
    lat: Number(p?.location?.latitude) || 0,
    lon: Number(p?.location?.longitude) || 0,
    rating: Number.isFinite(Number(p?.rating)) && p?.rating !== undefined ? Number(p.rating) : undefined,
    reviews: Number.isFinite(Number(p?.userRatingCount)) && p?.userRatingCount !== undefined ? Number(p.userRatingCount) : undefined,
  };
}

/** The four quarters of a rectangle. */
export function quarter(r: Rect): Rect[] {
  const mLat = (r.s + r.n) / 2, mLon = (r.w + r.e) / 2;
  return [
    { s: r.s, w: r.w, n: mLat, e: mLon }, { s: r.s, w: mLon, n: mLat, e: r.e },
    { s: mLat, w: r.w, n: r.n, e: mLon }, { s: mLat, w: mLon, n: r.n, e: r.e },
  ];
}

/** A square around a point, for "within N km". */
export function rectAround(lat: number, lon: number, km: number): Rect {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return { s: lat - dLat, n: lat + dLat, w: lon - dLon, e: lon + dLon };
}

export interface PlacesSearch {
  key: string;
  /** What to look for, in words: "dentist", "wedding photographer", "Smile dentist". */
  query: string;
  /** Where. Without it, the place name goes into the query and Google decides. */
  rect?: Rect | null;
  /** Used only when there is no rect: "dentist in Kraków". */
  where?: string;
  lang?: string;
  region?: string;
  depth?: PlacesDepth;
  fallbackCategory?: string;
}

export interface PlacesResult { results: FoundPlace[]; calls: number; saturated: boolean }

export async function searchPlaces(s: PlacesSearch, fetchPage = call): Promise<PlacesResult> {
  const budget = PLACES_DEPTHS[s.depth || 'quick']?.calls ?? 3;
  const base: Record<string, unknown> = {
    pageSize: PAGE,
    ...(s.lang && /^[a-z]{2}(-[A-Z]{2})?$/.test(s.lang) ? { languageCode: s.lang } : {}),
    ...(s.region && /^[A-Z]{2}$/.test(s.region) ? { regionCode: s.region.toLowerCase() } : {}),
  };
  const found = new Map<string, FoundPlace>();
  let calls = 0;
  let saturated = false;
  const queue: (Rect | null)[] = [s.rect ?? null];

  while (queue.length && calls < budget) {
    const rect = queue.shift()!;
    const body: Record<string, unknown> = {
      ...base,
      textQuery: rect ? s.query : `${s.query} in ${s.where || ''}`.trim(),
      ...(rect ? { locationRestriction: { rectangle: { low: { latitude: rect.s, longitude: rect.w }, high: { latitude: rect.n, longitude: rect.e } } } } : {}),
    };
    let token: string | undefined;
    let inTile = 0;
    do {
      if (calls >= budget) break;
      calls++;
      const page = await fetchPage(s.key, token ? { ...body, pageToken: token } : body);
      inTile += page.places.length;
      for (const p of page.places) {
        const f = googleToFoundPlace(p, s.fallbackCategory);
        if (f && !found.has(f.ref)) found.set(f.ref, f);
      }
      token = page.next;
    } while (token);
    // The budget ran out with a next page still waiting: there was more.
    if (token) saturated = true;
    // A full tile means there were more than Google would show: split it.
    if (inTile >= FULL && rect) {
      if (rect.n - rect.s > MIN_TILE_DEG && rect.e - rect.w > MIN_TILE_DEG) queue.push(...quarter(rect));
      else saturated = true;
    } else if (inTile >= FULL) saturated = true;
  }
  if (queue.length) saturated = true;
  const results = [...found.values()].sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0));
  return { results, calls, saturated };
}

/** A key that works: one cheap call (IDs only, the Essentials SKU). */
export async function checkPlacesKey(key: string): Promise<string | null> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'x-goog-fieldmask': 'places.id' },
      body: JSON.stringify({ textQuery: 'coffee', pageSize: 1 }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return null;
    return placesErrorMessage(res.status, await res.json().catch(() => null));
  } catch {
    return 'Google did not answer, so the key could not be checked. Try again in a moment.';
  }
}
