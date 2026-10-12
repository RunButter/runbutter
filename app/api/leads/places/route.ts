import { NextResponse } from 'next/server';
import { readJsonCapped, rateLimit, tooMany } from '@/lib/security/http';
import { geocode, sanitizePlace, LeadSearchError, type GeoPlace } from '@/lib/leads/osm';
import { CATEGORY_BY_KEY } from '@/lib/leads/categories';
import { searchPlaces, rectAround, PlacesError, PLACES_DEPTHS, type PlacesDepth, type Rect } from '@/lib/leads/places';
import { placesKeyFor } from '@/lib/leads/places-key';
import { leadsCaller } from '@/lib/leads/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/leads/places  { workspace, category? | query?, where, place?, name?, radiusKm?, depth? }
 *
 * Live Google Maps data through the official Places API, on the workspace's
 * own key (lib/leads/places.ts). Returns the same shape as the OpenStreetMap
 * search, so the screen, saving and the website check do not care which
 * source a result came from. Writes nothing.
 */
const LANG = /^[a-z]{2}$/;

export async function POST(req: Request) {
  const who = await leadsCaller(req);
  if (who instanceof Response) return who;
  // Each search is up to 90 billed calls on the workspace's key.
  const rl = rateLimit(`leads:places:${who.user}`, 30, 60 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const body = await readJsonCapped(req, 16_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const b = body.data || {};
  const lang = (req.headers.get('accept-language') || 'en').split(',')[0].trim().slice(0, 2).toLowerCase();

  const k = await placesKeyFor(who.user, String(b.workspace || ''));
  if (!k) return NextResponse.json({ error: 'Connect a Google API key first.', needsKey: true }, { status: 412 });
  if ('error' in k) return NextResponse.json({ error: k.error }, { status: k.status });

  try {
    const cat = CATEGORY_BY_KEY[String(b.category || '')];
    // Free text is the point of Google as a source: "solar installer",
    // "wedding photographer" — anything a person would type into Maps.
    const typed = String(b.query || '').replace(/[^\p{L}\p{N}&'’ .,-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    const name = String(b.name || '').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    const what = typed || cat?.one.toLowerCase() || '';
    if (!what) throw new LeadSearchError('Say what kind of business to look for.');
    const query = [name, what].filter(Boolean).join(' ');

    let place: GeoPlace | null = b.place && typeof b.place === 'object' ? sanitizePlace(b.place) : null;
    const where = String(b.where || '').trim().slice(0, 200);
    if (!place && !where) throw new LeadSearchError('Say where to look — a city, a district or a postcode.');
    let alternatives: GeoPlace[] = [];
    if (!place) {
      // The map's geocoder gives the AREA to tile. If it is down, Google still
      // answers "dentist in Kraków" by itself — just without the tiling.
      const found = await geocode(where, lang).catch(() => [] as GeoPlace[]);
      place = found[0] || null;
      alternatives = found.slice(1);
    }
    const radius = Number(b.radiusKm) || 0;
    const rect: Rect | null = place
      ? radius > 0 ? rectAround(place.lat, place.lon, radius) : { s: place.bbox[0], n: place.bbox[1], w: place.bbox[2], e: place.bbox[3] }
      : null;
    const depth: PlacesDepth = (String(b.depth) in PLACES_DEPTHS ? String(b.depth) : 'quick') as PlacesDepth;

    const out = await searchPlaces({
      key: k.key, query, rect, where, depth,
      lang: LANG.test(lang) ? lang : 'en', region: place?.country || undefined,
      fallbackCategory: cat?.one || typed,
    });

    const notes = [
      out.saturated ? (depth === 'deep'
        ? 'Google has more here than this search reached. Pick a district, or a distance from an address.'
        : 'Google has more here than this search reached. Choose “Whole area” or “Every street” to go further.') : '',
      !place ? `Searched Google for “${query} in ${where}” directly — the map could not outline that place.` : '',
    ].filter(Boolean);
    return NextResponse.json({
      place: place || { label: where, lat: 0, lon: 0, osmType: 'node', osmId: 0, country: '', city: where, bbox: [0, 0, 0, 0], kind: 'text' },
      alternatives,
      results: out.results,
      truncated: out.saturated,
      calls: out.calls,
      keyFrom: k.from,
      query,
      ...(notes.length ? { note: notes.join(' ') } : {}),
    });
  } catch (e: any) {
    if (e instanceof LeadSearchError) return NextResponse.json({ error: e.message }, { status: 422 });
    if (e instanceof PlacesError) return NextResponse.json({ error: e.message }, { status: e.status === 429 ? 429 : 422 });
    console.error('leads/places', e);
    return NextResponse.json({ error: 'The search failed. Try again in a moment.' }, { status: 500 });
  }
}
