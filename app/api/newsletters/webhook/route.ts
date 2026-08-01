import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/newsletters/webhook — Resend delivery feedback.
 *
 * Point Resend's webhook here for email.bounced and email.complained. A bounce
 * or a complaint is the mail system telling us to stop; recording it is what
 * keeps a sending domain alive, because continuing to mail a hard-bounced
 * address is the fastest way to lose one.
 *
 * RESOLVED BY PROVIDER ID, NOT BY EMAIL. The payload carries Resend's message
 * id, which we stored on the delivery row when we sent it. That maps back to
 * exactly one workspace and one subscriber. Matching on the address instead
 * would be ambiguous the moment two workspaces mail the same person — and would
 * let anyone who could forge a payload suppress an address in a workspace they
 * have nothing to do with.
 *
 * Signature verification is Svix (Resend's provider): the signed content is
 * "<id>.<timestamp>.<body>", HMAC-SHA256 with the base64 secret after the
 * "whsec_" prefix, compared against a space-separated list of "v1,<sig>".
 */

const TOLERANCE_S = 5 * 60;

function verifySvix(secret: string, id: string, ts: string, body: string, header: string): boolean {
  const raw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let keyBytes: Buffer;
  try { keyBytes = Buffer.from(raw, 'base64'); } catch { return false; }
  if (!keyBytes.length) return false;

  const expected = createHmac('sha256', keyBytes).update(`${id}.${ts}.${body}`).digest('base64');
  const exp = Buffer.from(expected);

  // The header can carry several versions; any one matching is a pass.
  for (const part of String(header || '').split(' ')) {
    const [v, sig] = part.split(',');
    if (v !== 'v1' || !sig) continue;
    const got = Buffer.from(sig);
    // Length-check first: timingSafeEqual THROWS on a length mismatch rather
    // than returning false, which would turn a forged signature into a 500.
    if (got.length === exp.length && timingSafeEqual(got, exp)) return true;
  }
  return false;
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'RESEND_WEBHOOK_SECRET not set' }, { status: 500 });

  // Raw body, not req.json(): the signature covers the exact bytes, and
  // re-serialising a parsed object changes them.
  const body = await req.text();
  const id = req.headers.get('svix-id') || '';
  const ts = req.headers.get('svix-timestamp') || '';
  const sig = req.headers.get('svix-signature') || '';

  if (!id || !ts || !sig) return NextResponse.json({ error: 'Missing signature headers' }, { status: 400 });

  // Replay window. Without it a captured request stays valid forever.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!Number.isFinite(age) || age > TOLERANCE_S) {
    return NextResponse.json({ error: 'Timestamp outside tolerance' }, { status: 400 });
  }
  if (!verifySvix(secret, id, ts, body, sig)) {
    return NextResponse.json({ error: 'Bad signature' }, { status: 401 });
  }

  let evt: any;
  try { evt = JSON.parse(body); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const type = String(evt?.type || '');
  const kind = type === 'email.bounced' ? 'bounce' : type === 'email.complained' ? 'complaint' : null;
  // Everything else (delivered, opened, clicked) is acknowledged and ignored:
  // our own pixel and redirect already record opens and clicks, and counting
  // both would double every statistic.
  if (!kind) return NextResponse.json({ ok: true, ignored: type });

  const providerId = String(evt?.data?.email_id || evt?.data?.id || '');
  if (!providerId) return NextResponse.json({ ok: true, ignored: 'no email_id' });

  const admin = createAdminClient();
  const { data: delivery } = await admin
    .from('newsletter_deliveries')
    .select('workspace_id, email')
    .eq('provider_id', providerId)
    .maybeSingle();

  // A bounce for a transactional email we did not send as a newsletter has no
  // delivery row. Acknowledged, so Resend does not retry it forever.
  if (!delivery) return NextResponse.json({ ok: true, ignored: 'unknown delivery' });

  const { error } = await admin.rpc('record_newsletter_feedback', {
    p_email: delivery.email, p_workspace: delivery.workspace_id, p_kind: kind,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, kind });
}
