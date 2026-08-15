import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { sendPush } from '@/lib/push/send';

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

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_client_portal', { p_token: token });
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Throttled to one an hour in SQL (0114). The client's NAME is the point —
  // "somebody opened a portal" is not worth a buzz; "Acme opened theirs" is.
  try {
    const { data: notice } = await admin.rpc('client_portal_open_notice', { p_token: token });
    if (notice) {
      await sendPush((notice as any).workspace_id, {
        title: `${(notice as any).client} opened their account page`,
        body: 'They can see their invoices and documents.',
        url: '/objects/companies', tag: `portal-${token.slice(0, 8)}`,
      }, (notice as any).privy);
    }
  } catch { /* never cost the client their invoices */ }

  return NextResponse.json(data, { headers: { 'cache-control': 'no-store' } });
}
