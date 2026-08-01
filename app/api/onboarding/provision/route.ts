import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/onboarding/provision { privyUserId, companyName, subdomain, email, fullName }
 * GET  /api/onboarding/provision?subdomain=foo   → { available: boolean }
 *
 * Replaces three client-side anon INSERTs (companies, company_users,
 * assessment_templates) in app/auth/register with one verified server call.
 *
 * Two things this fixes at once:
 *
 *  • THE WRITE PATH. `company_users` being anon-writable is a tenant-isolation
 *    bypass — hr_company_id() resolved from it alone, so a forged row read
 *    another company's candidates. Onboarding was the only legitimate reason
 *    that policy existed; with provisioning here, 0077 can close it.
 *
 *  • THE SILENT FAILURE. The old flow could create the company, fail on the
 *    membership insert, and leave someone signed in with no workspace and no
 *    error worth showing. ensure_workspace() does all of it in one transaction,
 *    so it cannot half-succeed.
 */
export async function POST(req: Request) {
  const rl = rateLimit(`provision:${clientIp(req)}`, 10);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId } = b || {};
  if (!privyUserId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // The identity is taken from the SIGNED token, never from the body — the same
  // rule /api/rpc enforces. Without this, provisioning would let anyone create
  // a company owned by someone else's Privy DID.
  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const { data, error } = await createAdminClient().rpc('ensure_workspace', {
    p_privy: privyUserId,
    p_company_name: String(b?.companyName || '').slice(0, 120),
    p_subdomain: String(b?.subdomain || '').slice(0, 63),
    p_email: String(b?.email || '').slice(0, 200),
    p_full_name: String(b?.fullName || '').slice(0, 120),
  });

  if (error) {
    const m = error.message || '';
    if (/SUBDOMAIN_TAKEN/.test(m)) return NextResponse.json({ error: 'That address is already taken.' }, { status: 409 });
    if (/BAD_SUBDOMAIN/.test(m)) return NextResponse.json({ error: 'Use at least two letters or numbers.' }, { status: 400 });
    if (/NO_IDENTITY/.test(m)) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    return NextResponse.json({ error: m || 'Could not create the workspace.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...(data as any) });
}

export async function GET(req: Request) {
  const rl = rateLimit(`provision:${clientIp(req)}`, 60);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  const sub = new URL(req.url).searchParams.get('subdomain') || '';
  if (sub.length < 2) return NextResponse.json({ available: false });
  // Unauthenticated on purpose: this is a signup-form availability check, and
  // it leaks only whether a subdomain exists — which the public careers page
  // reveals anyway. Rate-limited so it can't be used to enumerate cheaply.
  const { data } = await createAdminClient().rpc('subdomain_available', { p_subdomain: sub });
  return NextResponse.json({ available: Boolean(data) });
}
