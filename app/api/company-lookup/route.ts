import { NextResponse } from 'next/server';
import { readJsonCapped, rateLimit, tooMany } from '@/lib/security/http';
import { lookupCompany, LookupError } from '@/lib/company/lookup';
import { leadsCaller } from '@/lib/leads/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/company-lookup  { country?, taxId?, website?, name? }  (at least one)
 *
 * Everything public about a company from its tax number — see
 * lib/company/lookup.ts for which register answers what. Returns the facts
 * with a source per field; stores nothing. The form fills itself from this
 * and a person saves it, through the ordinary create_record.
 *
 * It was open to anyone before, which was tolerable for two register calls and
 * is not for a route that now also reads a website on our servers: a verified
 * sign-in, and a per-account limit that also keeps the Ministry of Finance's
 * daily quota for real lookups.
 */
export async function POST(req: Request) {
  const who = await leadsCaller(req);
  if (who instanceof Response) return who;
  const rl = rateLimit(`company-lookup:${who.user}`, 40, 10 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const body = await readJsonCapped(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const { country, taxId, website, name } = body.data || {};

  try {
    const company = await lookupCompany({
      country: String(country || ''), taxId: String(taxId || ''),
      website: typeof website === 'string' ? website : '', name: typeof name === 'string' ? name : '',
    });
    return NextResponse.json({ ok: true, company });
  } catch (e: any) {
    if (e instanceof LookupError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error('company-lookup:', e);
    return NextResponse.json({ error: 'The lookup failed. Try again in a moment.' }, { status: 500 });
  }
}
