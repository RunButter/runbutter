import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { sealSecret, secretHint } from '@/lib/crypto/secrets';
import { readJsonCapped, rateLimit, tooMany } from '@/lib/security/http';
import { leadsCaller } from '@/lib/leads/route-auth';
import { checkPlacesKey } from '@/lib/leads/places';
import { gmapsEnabled } from '@/lib/leads/gmaps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Find leads' data sources and the workspace's key for the paid one (0134).
 *
 *   GET    ?workspace=<id>                      → { google: { connected, hint, from } , scraper }
 *   POST   { workspace, key }                   → checks the key with Google, then seals and saves it
 *   DELETE ?workspace=<id>                      → forgets it
 *
 * Saving and removing are owner/admin only, enforced in SQL. The key is sealed
 * here and never returned — the screen gets a four-character hint.
 */
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

function sqlError(msg: string) {
  if (/FORBIDDEN/.test(msg)) return NextResponse.json({ error: 'Only an owner or admin can connect or remove the Google key.' }, { status: 403 });
  if (/NOT_A_MEMBER/.test(msg)) return NextResponse.json({ error: 'You are not a member of this workspace.' }, { status: 403 });
  if (/data_source|PGRST202|does not exist/i.test(msg)) return NextResponse.json({ error: 'Database migration 0134 has not been run yet, so a key cannot be saved.' }, { status: 503 });
  return NextResponse.json({ error: msg }, { status: 500 });
}

export async function GET(req: Request) {
  const who = await leadsCaller(req);
  if (who instanceof Response) return who;
  const ws = new URL(req.url).searchParams.get('workspace') || '';
  const server = !!(process.env.GOOGLE_PLACES_API_KEY || '').trim();
  let row: { hint?: string } | undefined;
  let migrated = true;
  if (isUuid(ws)) {
    const { data, error } = await createAdminClient().rpc('get_data_source_keys', { p_privy: who.user, p_workspace: ws });
    if (error) {
      if (/NOT_A_MEMBER/.test(error.message)) return sqlError(error.message);
      migrated = false;
    } else row = (Array.isArray(data) ? data : []).find((r: any) => r?.source === 'google_places');
  }
  return NextResponse.json({
    google: { connected: !!row || server, hint: row?.hint || '', from: row ? 'workspace' : server ? 'server' : null, migrated },
    scraper: gmapsEnabled(),
  });
}

export async function POST(req: Request) {
  const who = await leadsCaller(req);
  if (who instanceof Response) return who;
  const rl = rateLimit(`leads:sources:${who.user}`, 10, 10 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  const body = await readJsonCapped(req, 4_000);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  const ws = String(body.data?.workspace || '');
  const key = String(body.data?.key || '').trim();
  if (!isUuid(ws)) return NextResponse.json({ error: 'No workspace.' }, { status: 400 });
  if (!/^[A-Za-z0-9_\-]{20,120}$/.test(key)) return NextResponse.json({ error: 'That does not look like a Google API key (they start with “AIza”).' }, { status: 400 });

  // Check the role BEFORE spending a call on Google for somebody who cannot save.
  const admin = createAdminClient();
  const role = await admin.rpc('data_source_admin', { p_privy: who.user, p_workspace: ws });
  if (role.error) return sqlError(role.error.message);

  const bad = await checkPlacesKey(key);
  if (bad) return NextResponse.json({ error: bad }, { status: 422 });

  const sealed = sealSecret(key);
  const { error } = await admin.rpc('save_data_source_key', {
    p_privy: who.user, p_workspace: ws, p_source: 'google_places',
    p_cipher: sealed.cipher, p_iv: sealed.iv, p_tag: sealed.tag, p_hint: secretHint(key),
  });
  if (error) return sqlError(error.message);
  return NextResponse.json({ ok: true, hint: secretHint(key) });
}

export async function DELETE(req: Request) {
  const who = await leadsCaller(req);
  if (who instanceof Response) return who;
  const ws = new URL(req.url).searchParams.get('workspace') || '';
  if (!isUuid(ws)) return NextResponse.json({ error: 'No workspace.' }, { status: 400 });
  const { error } = await createAdminClient().rpc('delete_data_source_key', { p_privy: who.user, p_workspace: ws, p_source: 'google_places' });
  if (error) return sqlError(error.message);
  return NextResponse.json({ ok: true });
}
