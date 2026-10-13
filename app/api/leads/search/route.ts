import { NextResponse } from 'next/server';
import { readJsonCapped, rateLimit, tooMany } from '@/lib/security/http';
import { LeadSearchError } from '@/lib/leads/osm';
import { searchFree } from '@/lib/leads/free';
import { leadsCaller } from '@/lib/leads/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The first search after a deploy reads the open data's index (~7 s).
export const maxDuration = 60;

/**
 * POST /api/leads/search  { category | query, where, radiusKm?, name?, place? }
 *
 * Businesses of one kind in one place, free: Overture Maps open data first,
 * OpenStreetMap as the backup (lib/leads/free.ts).
 * Reads public data and writes nothing — saving a lead is the ordinary
 * create_record call the browser makes afterwards, so plan limits, tenancy and
 * automations apply exactly as they do to a lead typed in by hand.
 */
export async function POST(req: Request) {
  const who = await leadsCaller(req);
  if (who instanceof Response) return who;

  // Each search is one geocoder call on a public service with fair-use rules,
  // and up to a few hundred range reads of the open data; this keeps one
  // account from spending a deployment's share.
  const rl = rateLimit(`leads:search:${who.user}`, 30, 10 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const body = await readJsonCapped(req, 16_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const b = body.data || {};
  const lang = (req.headers.get('accept-language') || 'en').split(',')[0].trim().slice(0, 12) || 'en';

  try {
    const out = await searchFree({
      category: String(b.category || ''),
      query: typeof b.query === 'string' ? b.query : '',
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
