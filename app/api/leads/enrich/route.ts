import { NextResponse } from 'next/server';
import { readJsonCapped, rateLimit, tooMany } from '@/lib/security/http';
import { findContacts, type SiteContacts } from '@/lib/leads/enrich';
import { leadsCaller } from '@/lib/leads/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/leads/enrich  { websites: string[] }  (max 10)
 *
 * Reads each business's own website for a public email, phone and social
 * links (lib/leads/enrich.ts: robots.txt obeyed, three pages at most, every
 * hop checked against private addresses). Returns what was found per site and
 * stores nothing.
 */
const PER_REQUEST = 10;
const CONCURRENCY = 3;

export async function POST(req: Request) {
  const who = await leadsCaller(req);
  if (who instanceof Response) return who;

  const body = await readJsonCapped(req, 32_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const list: string[] = Array.isArray(body.data?.websites)
    ? [...new Set<string>(body.data.websites.map((x: any) => String(x || '').trim()).filter(Boolean))].slice(0, PER_REQUEST)
    : [];
  if (!list.length) return NextResponse.json({ results: [] });

  // Counted per SITE, not per request: this is the part that costs other
  // people's servers something.
  const rl = rateLimit(`leads:enrich:${who.user}`, 200, 60 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  for (let i = 1; i < list.length; i++) {
    const more = rateLimit(`leads:enrich:${who.user}`, 200, 60 * 60_000);
    if (!more.ok) { list.length = i; break; }
  }

  const results: SiteContacts[] = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      try { results[i] = await findContacts(list[i]); }
      catch { results[i] = { website: list[i], emails: [], phones: [], facebook: '', instagram: '', linkedin: '', checked: [], note: 'Could not read this site.' }; }
    }
  }));
  return NextResponse.json({ results });
}
