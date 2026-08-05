import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { runSetupChecks, obsoletePresent } from '@/lib/setup-checks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health/config — which parts of this instance are configured.
 *
 * OWNERS AND ADMINS ONLY. What it returns is a map of which integrations exist,
 * which is exactly the shape of a reconnaissance answer: "no Stripe webhook, no
 * bounce handling, no master key" tells someone where to push. It is behind a
 * verified Privy token AND an owner/admin row, not merely behind sign-in.
 *
 * BOOLEANS ONLY. No values, no prefixes, no last-four. A screen that shows
 * `sk_live_…4f2` to prove a key is right is a screen that shows a key, and it
 * ends up in a support screenshot.
 */
export async function GET(req: Request) {
  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified' || !v.userId) {
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('accounts')
    .select('role')
    .eq('privy_user_id', v.userId)
    .in('role', ['owner', 'admin'])
    .limit(1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return NextResponse.json({ error: 'Owners and admins only.' }, { status: 403 });
  }

  const checks = runSetupChecks();
  return NextResponse.json({
    checks: checks.map(({ key, group, level, enables, breaks, present, missingAlso }) => ({
      key, group, level, enables, breaks, present, missingAlso,
    })),
    obsolete: obsoletePresent(),
    summary: {
      required: checks.filter((c) => c.level === 'required' && !c.present).length,
      recommended: checks.filter((c) => c.level === 'recommended' && !c.present).length,
      features: checks.filter((c) => c.level === 'feature' && c.present).length,
    },
  });
}
