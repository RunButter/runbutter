// The free search: Overture Maps first, OpenStreetMap as the backup.
//
// Shared by /api/leads/search and the Copilot's find_businesses, so the screen
// and the agent cannot disagree about where free leads come from. Overture
// (lib/leads/overture.ts) carries phone, website and email far more often and
// reads from S3, which nobody rations; OpenStreetMap's public servers refused
// our host's shared IPs in production. OSM still answers when Overture cannot
// — an outage, or a category it has nothing for in that place.
import {
  geocode, sanitizePlace, scopeFor, searchBusinesses, BIG_CITY_KM, LeadSearchError,
  type GeoPlace, type SearchResult,
} from './osm';
import { searchOverture, categoryMatcher, textMatcher, OvertureAreaTooBig, type Box } from './overture';
import { rectAround } from './places';
import { CATEGORY_BY_KEY } from './categories';

export interface FreeSearchInput {
  category?: string;
  /** Any kind of business in words, instead of a category. */
  query?: string;
  where: string;
  radiusKm?: number;
  name?: string;
  place?: GeoPlace | null;
  lang?: string;
  limit?: number;
}

export type FreeSearchResult = SearchResult & { source: 'overture' | 'osm' };

/** Letters, digits and a little punctuation — it becomes a matcher, never syntax. */
export const cleanQuery = (s: unknown) => String(s || '').replace(/[^\p{L}\p{N}&'’ .,-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export async function searchFree(input: FreeSearchInput): Promise<FreeSearchResult> {
  const cat = CATEGORY_BY_KEY[String(input.category || '')];
  const typed = cleanQuery(input.query);
  if (!cat && !typed) throw new LeadSearchError('Say what kind of business to look for.');

  let place = input.place && Number.isFinite(input.place.lat) ? sanitizePlace(input.place) : null;
  let alternatives: GeoPlace[] = [];
  if (!place) {
    if (!input.where?.trim()) throw new LeadSearchError('Say where to look — a city, a district or a postcode.');
    const found = await geocode(input.where, input.lang);
    if (!found.length) throw new LeadSearchError(`Could not find “${input.where.trim()}” on the map. Try adding the country.`);
    place = found[0];
    alternatives = found.slice(1);
  }

  const scope = scopeFor(place, input.radiusKm); // a whole region asks for something smaller
  const [s, n, w, e] = place.bbox;
  const box: Box = scope.kind === 'around'
    ? (({ s: S, n: N, w: W, e: E }) => ({ s: S, n: N, w: W, e: E }))(rectAround(scope.lat, scope.lon, scope.m / 1000))
    : scope.kind === 'bbox' ? { s: scope.s, n: scope.n, w: scope.w, e: scope.e } : { s, n, w, e };
  const narrowed = scope.kind === 'around' && !(Number(input.radiusKm) > 0) && scope.m === BIG_CITY_KM * 1000;
  const label = place.label.split(',')[0];
  const notes: string[] = narrowed
    ? [`${label} is large, so this searched within ${BIG_CITY_KM} km of its centre. Pick a district, or a distance from an address, to search elsewhere in it.`]
    : [];

  const match = cat ? categoryMatcher(cat.key) : textMatcher(typed);
  if (!match) throw new LeadSearchError('Say what kind of business to look for, in a word or two.');

  let unreachable = false;
  try {
    const r = await searchOverture({ box, match, name: input.name, limit: input.limit, fallbackCategory: cat?.one || typed });
    if (r.results.length || !cat) {
      if (r.matched > r.results.length) notes.push(`Showing ${r.results.length} of ${r.matched}. Choose a distance or a district to see the others.`);
      return {
        place, alternatives, results: r.results, truncated: r.matched > r.results.length, source: 'overture',
        ...(notes.length ? { note: notes.join(' ') } : {}),
      };
    }
  } catch (err) {
    if (err instanceof OvertureAreaTooBig) throw new LeadSearchError(err.message);
    console.error('leads/overture', err);
    unreachable = true;
  }

  // The backup: OpenStreetMap, for a listed category only (its tags are fixed).
  if (!cat) {
    throw new LeadSearchError('The open business data could not be reached just now. Try again in a minute, or pick a kind of business from the list.');
  }
  const osm = await searchBusinesses({ category: cat.key, where: input.where, radiusKm: input.radiusKm, name: input.name, place, lang: input.lang });
  return {
    ...osm, alternatives: osm.alternatives.length ? osm.alternatives : alternatives, source: 'osm',
    note: [osm.note, unreachable ? 'The open business data could not be reached, so these are from OpenStreetMap.' : ''].filter(Boolean).join(' ') || undefined,
  };
}
