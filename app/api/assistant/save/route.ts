import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { tgSetWebhook } from '@/lib/assistant/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Save an assistant channel and (for Telegram) register the inbound webhook with
// Telegram in the same step, so connecting a bot is one action. Identity + the
// workspace come from the verified Privy session, never the body.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`asstsave:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });

  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const platform = ['telegram', 'slack', 'whatsapp'].includes(b?.platform) ? b.platform : 'telegram';
  const autonomy = b?.autonomy === 'suggest' ? 'suggest' : 'auto';
  const allowedSenders = Array.isArray(b?.allowedSenders)
    ? b.allowedSenders.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 50) : [];
  const botToken = typeof b?.botToken === 'string' ? b.botToken.trim() : '';

  const admin = createAdminClient();
  const { data: ws } = await admin.rpc('get_my_workspace', { p_privy: v.userId });
  if (!ws?.id) return NextResponse.json({ error: 'No workspace found for your account.' }, { status: 400 });

  const { data: saved, error } = await admin.rpc('save_assistant_channel', {
    p_privy: v.userId, p_workspace: ws.id, p_id: b?.id ?? null, p_platform: platform,
    p_bot_token: botToken, p_allowed_senders: allowedSenders, p_autonomy: autonomy, p_enabled: b?.enabled !== false,
  });
  if (error || !saved?.id) return NextResponse.json({ error: error?.message?.replace(/_/g, ' ').toLowerCase() || 'Could not save.' }, { status: 400 });

  // Register the Telegram webhook if we have a bot token (freshly supplied, or
  // already stored from a previous save).
  let webhookRegistered: boolean | null = null;
  let registerError: string | undefined;
  if (platform === 'telegram') {
    const { data: ch } = await admin.rpc('resolve_assistant_channel', { p_token: saved.webhook_token });
    const activeToken = botToken || ch?.bot_token;
    if (activeToken) {
      const host = req.headers.get('x-forwarded-host')
        ? `${req.headers.get('x-forwarded-proto') || 'https'}://${req.headers.get('x-forwarded-host')}`
        : (process.env.NEXT_PUBLIC_APP_URL || 'https://runbutter.app');
      const url = `${host}/api/assistant/telegram/${saved.webhook_token}`;
      const reg = await tgSetWebhook(activeToken, url, ch?.webhook_secret || saved.webhook_secret);
      webhookRegistered = reg.ok;
      if (!reg.ok) registerError = reg.error;
    }
  }

  return NextResponse.json({ id: saved.id, webhookRegistered, registerError });
}
