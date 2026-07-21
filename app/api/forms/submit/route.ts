import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public form submission. No session — anyone can submit a published form. The
// submit_form RPC (SECURITY DEFINER, anon-granted) creates exactly one lead + one
// submission row it fully controls, so this endpoint can't be used to touch
// anything else. We add the real IP server-side for the audit trail.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`formsubmit:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const data = body?.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : null;
  if (!/^[a-z0-9]{4,32}$/.test(slug)) return NextResponse.json({ error: 'Unknown form.' }, { status: 400 });
  if (!data) return NextResponse.json({ error: 'Nothing to submit.' }, { status: 400 });

  // Cap payload: at most 40 fields, each value trimmed to a sane size.
  const clean: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (n++ >= 40) break;
    clean[String(k).slice(0, 100)] = String(v ?? '').slice(0, 2000);
  }

  const admin = createAdminClient();
  const { data: res, error } = await admin.rpc('submit_form', { p_slug: slug, p_data: clean, p_ip: clientIp(req) });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!res?.ok) return NextResponse.json({ error: 'This form is no longer accepting responses.' }, { status: 400 });

  return NextResponse.json({ ok: true, message: res.message || 'Thanks — we\'ll be in touch.' });
}
