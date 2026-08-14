import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/portal/<token> — one client's own invoices and documents.
 *
 * THE TOKEN IS THE ENTIRE QUERY. get_client_portal takes a token and nothing
 * else: the organisation comes off the stored row and the shape is fixed in
 * SQL, so there is no caller-supplied filter here to get wrong. That is what
 * makes a live read defensible where 0109 and 0110 chose to freeze instead —
 * a client portal exists to answer "is my invoice paid yet", and a frozen
 * answer to that is worse than none.
 *
 * no-store: an invoice's status is the thing they came to check.
 */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  const rl = rateLimit(`portal:${clientIp(req)}`, 60);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const token = String(params.token || '');
  if (!/^[a-f0-9]{32}$/.test(token)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await createAdminClient().rpc('get_client_portal', { p_token: token });
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(data, { headers: { 'cache-control': 'no-store' } });
}
