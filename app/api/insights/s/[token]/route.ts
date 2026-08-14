import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/insights/s/<token> — read one published snapshot.
 *
 * Its own route rather than /api/rpc because that proxy rejects a tokenless
 * request (verifyPrivyToken returns `invalid` with no token), and this page is
 * read by people who have never signed in. The alternative — granting anon
 * EXECUTE and adding a keep_public entry, the way get_post_public works — would
 * mean declaring a keep_public array in a migration newer than 0105, which
 * check:grants would then read INSTEAD of 0105's twenty-name list. One route
 * with the service-role client avoids both problems.
 *
 * IT CANNOT RETURN ANYTHING BUT THE SNAPSHOT. get_insight_public takes a token
 * and nothing else — no workspace, no user, no object — so there is no argument
 * an attacker can vary to widen it, and the row it reads is a frozen jsonb blob
 * computed at publish time. There is no path from here to a business table.
 *
 * A bad, revoked or expired token is 404 in all three cases. Telling them apart
 * would confirm that a token once existed.
 */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  // Tighter than the app's own ceiling: this endpoint is reachable by anyone
  // with a URL, and the only thing worth doing to it in bulk is guessing.
  const rl = rateLimit(`insight-public:${clientIp(req)}`, 60);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const token = String(params.token || '');
  if (!/^[a-f0-9]{32}$/.test(token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data, error } = await createAdminClient().rpc('get_insight_public', { p_token: token });
  if (error) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(data, {
    // A snapshot is immutable, but the view counter is not, and a shared link
    // getting cached by an intermediary would under-report reach. Short and
    // private rather than immutable.
    headers: { 'cache-control': 'private, max-age=30' },
  });
}
