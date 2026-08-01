import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { getToken } from '@/lib/excel/graph';
import { syncLink, liveIO } from '@/lib/excel/sync';
import { readJsonCapped, rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Run the Excel sync (0079).
 *
 *   POST { linkId }            → sync one link now, as the signed-in member
 *   GET  (with CRON_SECRET)    → sweep every enabled link, oldest first
 *
 * The two paths differ only in who they run as. Both go through the same
 * engine, so a manual "Sync now" and the cron cannot drift apart in behaviour —
 * which is the failure this route is shaped to avoid, since a user debugging a
 * sheet will always try the button first.
 */

async function ownerOf(admin: any, connectionId: string): Promise<string | null> {
  const { data } = await admin.from('ms_connections').select('privy_user_id').eq('id', connectionId).maybeSingle();
  return data?.privy_user_id ?? null;
}

async function runOne(admin: any, link: any): Promise<{ ok: boolean; rowsOut: number; rowsIn: number; error?: string }> {
  try {
    const { token } = await getToken(link.workspace_id, link.connection_id);
    // The member who created the link is who the record RPCs run as, so a
    // spreadsheet edit is subject to the same validation and tenancy as an
    // edit made in the app.
    const privy = link.created_by_privy || (await ownerOf(admin, link.connection_id));
    if (!privy) throw new Error('The member who linked this sheet is no longer in the workspace.');

    const io = liveIO({
      admin, workspace: link.workspace_id, privy, linkId: link.id,
      token, driveId: link.drive_id, itemId: link.item_id, sheet: link.worksheet,
    });
    const res = await syncLink(io, link);
    await admin.rpc('record_excel_sync', {
      p_id: link.id, p_status: 'ok', p_error: null, p_out: res.rowsOut, p_in: res.rowsIn,
    });
    return { ok: true, rowsOut: res.rowsOut, rowsIn: res.rowsIn };
  } catch (e: any) {
    const message = e?.message === 'NOT_CONNECTED'
      ? 'Microsoft is not connected, or the connection expired. Reconnect in Integrations.'
      : (e?.message || 'Sync failed.');
    // Recorded, not just logged: a sync that quietly stops is worse than one
    // that fails loudly, because the sheet keeps showing plausible old numbers.
    await admin.rpc('record_excel_sync', { p_id: link.id, p_status: 'error', p_error: message, p_out: 0, p_in: 0 });
    return { ok: false, rowsOut: 0, rowsIn: 0, error: message };
  }
}

export async function POST(req: Request) {
  const rl = rateLimit(`xlsync:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });

  const capped = await readJsonCapped(req, 8 * 1024);
  if (!capped.ok) return NextResponse.json({ error: capped.error }, { status: capped.status });
  const linkId = (capped.data as any)?.linkId;
  if (!linkId) return NextResponse.json({ error: 'linkId is required' }, { status: 400 });

  const admin = createAdminClient();
  const { data: ws } = await admin.rpc('get_my_workspace', { p_privy: v.userId });
  const workspaceId = (ws as any)?.id;
  if (!workspaceId) return NextResponse.json({ error: 'No workspace found for your account.' }, { status: 400 });

  // Scoped to the caller's workspace, so a known link id from another tenant
  // simply isn't found.
  const { data: link } = await admin
    .from('excel_links').select('*').eq('id', linkId).eq('workspace_id', workspaceId).maybeSingle();
  if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 });

  const res = await runOne(admin, link);
  return NextResponse.json(res, { status: res.ok ? 200 : 502 });
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || new URL(req.url).searchParams.get('secret') || '';
  // Without a configured secret the sweep is closed, not open: an
  // unauthenticated endpoint that writes into people's workbooks is not a safe
  // default.
  if (!secret || given !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  // SKIP LOCKED inside the RPC, so two overlapping ticks never write the same
  // sheet at once.
  const { data, error } = await admin.rpc('claim_excel_links', { p_limit: 20 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const links = (data as any[]) || [];
  const results = [];
  for (const claimed of links) {
    // claim_excel_links returns only the sync fields; the row is re-read for
    // created_by_privy rather than widening what the claim exposes.
    const { data: full } = await admin.from('excel_links').select('*').eq('id', claimed.id).maybeSingle();
    if (!full) continue;
    results.push({ id: full.id, file: full.file_name, ...(await runOne(admin, full)) });
  }
  return NextResponse.json({ ran: results.length, results });
}
