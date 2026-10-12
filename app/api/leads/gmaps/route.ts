import { NextResponse } from 'next/server';
import { readJsonCapped, rateLimit, tooMany } from '@/lib/security/http';
import { geocode, sanitizePlace, LeadSearchError, type GeoPlace } from '@/lib/leads/osm';
import { CATEGORY_BY_KEY } from '@/lib/leads/categories';
import { gmapsEnabled, startGmapsJob, readGmapsJob, GmapsError } from '@/lib/leads/gmaps';
import { leadsCaller } from '@/lib/leads/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Google Maps results through the OPERATOR'S OWN scraper (lib/leads/gmaps.ts).
 * Off unless GMAPS_SCRAPER_URL is set; the screen asks GET first and shows the
 * choice only when this says it is on.
 *
 *   GET                       → { enabled }
 *   POST { category | query, where, name?, place? } → { job, place }   (starts a search)
 *   GET  ?job=<id>&country=XX → { status, results? , error? } (comes back for it)
 *
 * Like the OpenStreetMap search it writes nothing: saving is the browser's own
 * create_record call afterwards.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const job = url.searchParams.get('job');
  if (!job) return NextResponse.json({ enabled: gmapsEnabled() });

  const who = await leadsCaller(req);
  if (who instanceof Response) return who;
  const rl = rateLimit(`leads:gmaps:poll:${who.user}`, 120, 10 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  const country = (url.searchParams.get('country') || '').replace(/[^A-Za-z]/g, '').slice(0, 2);
  try {
    return NextResponse.json(await readGmapsJob(who.user, job, country));
  } catch (e: any) {
    if (e instanceof GmapsError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error('leads/gmaps poll', e);
    return NextResponse.json({ error: 'Could not read the search. Try again in a moment.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!gmapsEnabled()) return NextResponse.json({ error: 'Google Maps search is not set up on this server.' }, { status: 404 });
  const who = await leadsCaller(req);
  if (who instanceof Response) return who;

  // A scraper job runs a real browser for minutes on the operator's machine.
  const rl = rateLimit(`leads:gmaps:${who.user}`, 6, 60 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const body = await readJsonCapped(req, 16_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const b = body.data || {};
  const lang = (req.headers.get('accept-language') || 'en').split(',')[0].trim().slice(0, 2).toLowerCase() || 'en';

  try {
    const cat = CATEGORY_BY_KEY[String(b.category || '')];
    const typed = String(b.query || '').replace(/[^\p{L}\p{N}&'’ .,-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!cat && !typed) throw new LeadSearchError('Say what kind of business to look for.');
    let place: GeoPlace | null = b.place && typeof b.place === 'object' ? sanitizePlace(b.place) : null;
    if (!place) {
      const where = String(b.where || '').trim();
      if (!where) throw new LeadSearchError('Say where to look — a city, a district or a postcode.');
      place = (await geocode(where, lang))[0] || null;
      if (!place) throw new LeadSearchError(`Could not find “${where}” on the map. Try adding the country.`);
    }
    // Letters, digits and spaces only, same as the OpenStreetMap name filter —
    // it becomes a search box entry on the scraper, never anything else.
    const name = String(b.name || '').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    const town = place.label.split(',').slice(0, 2).map((s) => s.trim()).filter(Boolean).join(', ');
    const query = `${name ? `${name} ` : ''}${typed || cat!.one.toLowerCase()} in ${town}`;
    const job = await startGmapsJob(who.user, { query, lang, lat: place.lat, lon: place.lon });
    return NextResponse.json({ job, place, query });
  } catch (e: any) {
    if (e instanceof LeadSearchError || e instanceof GmapsError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error('leads/gmaps', e);
    return NextResponse.json({ error: 'The search could not start. Try again in a moment.' }, { status: 500 });
  }
}
