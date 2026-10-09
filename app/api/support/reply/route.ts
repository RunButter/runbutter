import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { authorizePrivy } from '@/lib/auth/privy-verify';
import { sendSupportReply } from '@/lib/support/reply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/support/reply  { privyUserId, workspaceId, conversationId, body, note? }
 *
 * A route rather than /api/rpc because a reply has a side effect the database
 * cannot have: emailing a visitor who has closed the tab.
 */
export async function POST(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const { privyUserId, workspaceId, conversationId } = b || {};
  if (!privyUserId || !workspaceId || !conversationId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  const auth = await authorizePrivy(req, privyUserId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 });

  const r = await sendSupportReply(createAdminClient(), {
    privy: privyUserId, workspace: workspaceId, conversation: conversationId,
    body: String(b?.body || ''), kind: b?.note ? 'note' : 'team',
  });
  if (!r.ok) {
    const status = /NOT_A_MEMBER/.test(r.error) ? 403 : /NOT_FOUND/.test(r.error) ? 404 : /EMPTY_MESSAGE/.test(r.error) ? 400 : 500;
    return NextResponse.json({ error: /EMPTY_MESSAGE/.test(r.error) ? 'Write a reply first.' : r.error }, { status });
  }
  return NextResponse.json(r);
}
