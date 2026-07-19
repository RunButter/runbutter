import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';

// Redeem a team invite.
//
// This used to take { email, privyUserId } from the request body with no auth
// whatsoever, and attach whatever Privy id it was handed to the pending
// company_users row matching that email. Anyone who knew an invited address
// could join that workspace with the assigned role — frequently admin or owner.
//
// Now the caller's identity comes from a verified Privy token, and the invite
// is located by the single-use token that was mailed to them. Knowing an email
// address proves nothing and gets you nowhere.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`claim:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ claimed: false, error: 'Sign in to accept this invitation.' }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ claimed: false, error: 'Invalid body' }, { status: 400 });
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ claimed: false, error: 'This invitation link is not valid.' }, { status: 400 });
  }

  const db = createAdminClient();
  const { data, error } = await db.rpc('redeem_invite', { p_token: token, p_privy: v.userId });
  if (error) return NextResponse.json({ claimed: false, error: error.message }, { status: 400 });

  if (!data?.ok) {
    return NextResponse.json(
      { claimed: false, error: 'This invitation has already been used or is no longer valid.' },
      { status: 400 },
    );
  }

  return NextResponse.json({
    claimed: true,
    alreadyMember: !!data.already_member,
    companyName: data.company_name ?? null,
    role: data.role ?? null,
  });
}
