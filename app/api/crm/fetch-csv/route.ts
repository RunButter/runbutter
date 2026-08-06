import { NextResponse } from 'next/server';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { isSafeOutboundUrl, rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';

/**
 * Fetches a public CSV URL server-side, because the browser cannot: a Google
 * Sheets "Publish to web → CSV" link has no CORS headers.
 *
 * TWO THINGS THIS GOT WRONG, both found in the 2026-08 sweep.
 *
 * 1. IT WAS UNAUTHENTICATED. Anyone on the internet could POST a URL and have
 *    this server fetch it and hand back the body — an open proxy wearing your
 *    domain and your IP reputation. It now requires a signed-in caller. There is
 *    no workspace check on purpose: the URL is the user's own and nothing is
 *    written; being signed in is the whole requirement.
 *
 * 2. `redirect: 'follow'` DEFEATED THE GUARD. Checking the hostname once and
 *    then letting fetch follow redirects means a perfectly public URL can answer
 *    302 → http://169.254.169.254/ and the server obediently fetches the cloud
 *    metadata endpoint. The check has to happen on EVERY hop, which means
 *    following them by hand. Google's own CSV links redirect, so refusing
 *    redirects outright would break the feature this exists for.
 */
const MAX_HOPS = 4;
const MAX_BYTES = 5_000_000;

export async function POST(req: Request) {
  const rl = rateLimit(`fetchcsv:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ error: 'Sign in again to import from a URL.' }, { status: 401 });
  }

  let url: string;
  try { ({ url } = await req.json()); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!url || typeof url !== 'string') return NextResponse.json({ error: 'url required' }, { status: 400 });

  let next = url;
  try {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      // Re-validated at every hop, which is the entire point.
      if (!isSafeOutboundUrl(next) || !next.startsWith('https:')) {
        return NextResponse.json({ error: 'Only public https URLs are allowed.' }, { status: 400 });
      }

      const res = await fetch(next, { redirect: 'manual', signal: AbortSignal.timeout(15000) });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) return NextResponse.json({ error: 'The URL redirected to nowhere.' }, { status: 502 });
        // Relative Location headers are legal and common.
        next = new URL(location, next).toString();
        continue;
      }

      if (!res.ok) return NextResponse.json({ error: `Fetch failed (${res.status})` }, { status: 502 });

      const text = await res.text();
      if (text.length > MAX_BYTES) return NextResponse.json({ error: 'File too large (>5MB)' }, { status: 413 });
      return NextResponse.json({ text });
    }
    return NextResponse.json({ error: 'Too many redirects.' }, { status: 502 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not fetch that URL.' }, { status: 500 });
  }
}
