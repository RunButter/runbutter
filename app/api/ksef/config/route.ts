import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { saveTenantKsefToken } from '@/lib/ksef/service';

export const runtime = 'nodejs';

/**
 * POST /api/ksef/config  Body: { privyUserId, nip, token, environment? }
 * Store a tenant's KSeF credentials (NIP + token). The token is AES-256-GCM
 * encrypted before it touches the DB. Owner/admin only.
 */
export async function POST(req: Request) {
  try {
    const { privyUserId, nip, token, environment } = await req.json();
    if (!privyUserId || !nip || !token) {
      return NextResponse.json({ error: 'privyUserId, nip and token are required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: acct } = await admin
      .from('accounts')
      .select('workspace_id, role')
      .eq('privy_user_id', privyUserId)
      .order('created_at')
      .limit(1)
      .maybeSingle();

    if (!acct) return NextResponse.json({ error: 'No workspace for this user' }, { status: 403 });
    if (!['owner', 'admin'].includes(acct.role)) {
      return NextResponse.json({ error: 'Only an owner or admin can set KSeF credentials' }, { status: 403 });
    }

    await saveTenantKsefToken(acct.workspace_id, String(nip).replace(/[^0-9]/g, ''), String(token).trim(), environment || 'test');
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('ksef config error:', e);
    return NextResponse.json({ error: e?.message || 'Failed to save KSeF config' }, { status: 500 });
  }
}
