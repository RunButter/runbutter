import { NextResponse } from 'next/server';
import { readJsonCapped, rateLimit, tooMany } from '@/lib/security/http';
import { searchBusinesses, LeadSearchError } from '@/lib/leads/osm';
import { leadsCaller } from '@/lib/leads/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/leads/search  { category, where, radiusKm?, name?, place? }
 *
 * Businesses of one kind in one place, from OpenStreetMap (lib/leads/osm.ts).
 * Reads public data and writes nothing — saving a lead is the ordinary
 * create_record call the browser makes afterwards, so plan limits, tenancy and
 * automations apply exactly as they do to a lead typed in by hand.
 */
export async function POST(req: Request) {
  const who = await leadsCaller(req);
  if (who instanceof Response) return who;

  // Each search is one Nominatim and one or two Overpass calls on public
  // services with fair-use rules; this keeps one account from spending a
  // deployment's share.
  const rl = rateLimit(`leads:search:${who.user}`, 30, 10 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const body = await readJsonCapped(req, 16_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const b = body.data || {};
  const lang = (req.headers.get('accept-language') || 'en').split(',')[0].trim().slice(0, 12) || 'en';

  try {
    const out = await searchBusinesses({
      category: String(b.category || ''),
      where: String(b.where || ''),
      radiusKm: Number(b.radiusKm) || 0,
      name: typeof b.name === 'string' ? b.name : '',
      place: b.place && typeof b.place === 'object' ? b.place : null,
      lang,
    });
    return NextResponse.json(out);
  } catch (e: any) {
    if (e instanceof LeadSearchError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error('leads/search', e);
    return NextResponse.json({ error: 'The search failed. Try again in a moment.' }, { status: 500 });
  }
}
