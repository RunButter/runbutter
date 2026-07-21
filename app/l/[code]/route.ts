import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public short-link redirect: /l/<code> → the target URL, counting the click.
// A route handler (not a page) so it's a clean 302 with no render.
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const rl = rateLimit(`shortclick:${clientIp(req)}`, 120);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const code = (params.code || '').toLowerCase();
  const home = new URL('/', req.url);
  if (!/^[a-z0-9-]{3,32}$/.test(code)) return NextResponse.redirect(home);

  const { data: target } = await createAdminClient().rpc('register_short_click', { p_code: code });

  // Only ever redirect to a vetted http(s) target (create_short_link enforces
  // the scheme); anything else falls back home rather than honouring it.
  if (typeof target === 'string' && /^https?:\/\//i.test(target)) {
    return NextResponse.redirect(target, 302);
  }
  return NextResponse.redirect(home);
}
