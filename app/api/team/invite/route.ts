import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { createInvite } from '@/lib/team/invite';

export const runtime = 'nodejs';

// POST /api/team/invite { email, fullName, role }
// Authentication lives here; everything else (who may invite, the seat limit,
// the email) lives in lib/team/invite.ts, which the Copilot's invite_member
// tool also uses — so neither road can skip a check the other makes.
export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit(`invite:${clientIp(req)}`, 30);
    if (!rl.ok) return tooMany(rl.retryAfterS);

    const v = await verifyPrivyToken(req);
    if (v.status !== 'verified') {
      return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
    }

    const { email, fullName, role } = await req.json();
    const res = await createInvite(createAdminClient(), v.userId, { email, fullName, role });
    if (!res.ok) return NextResponse.json(res.body ?? { error: res.error }, { status: res.status });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Invite API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
