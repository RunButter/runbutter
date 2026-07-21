import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { runAssistant, senderAllowed, type AssistantChannel } from '@/lib/assistant/core';
import { tgSend } from '@/lib/assistant/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;      // the agent loop can take a few seconds

// Telegram inbound webhook. Telegram POSTs each message here and echoes the
// secret_token we configured in the X-Telegram-Bot-Api-Secret-Token header — we
// verify it. The URL token only names the channel; the secret is the credential.
// Always answer 200 so Telegram doesn't retry-storm; errors go back as chat text.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const rl = rateLimit(`asst:${clientIp(req)}`, 60);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const token = (params.token || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const { data } = await admin.rpc('resolve_assistant_channel', { p_token: token });
  const channel = data as AssistantChannel | null;
  if (!channel?.workspace_id || channel.platform !== 'telegram' || !channel.enabled || !channel.bot_token) {
    return NextResponse.json({ ok: true });
  }

  // Verify Telegram's secret header before doing anything.
  if (req.headers.get('x-telegram-bot-api-secret-token') !== channel.webhook_secret) {
    return NextResponse.json({ ok: true });   // silently drop unauthenticated calls
  }

  let update: any;
  try { update = await req.json(); } catch { return NextResponse.json({ ok: true }); }
  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = typeof message?.text === 'string' ? message.text : '';
  if (!chatId || !text) return NextResponse.json({ ok: true });

  const fromId = message?.from?.id;
  const username = message?.from?.username;

  // Authorisation: only allowlisted senders may operate the workspace.
  if (!senderAllowed(channel, chatId, fromId, username)) {
    await tgSend(channel.bot_token, chatId,
      `You're not authorised to use this assistant yet.\n\nAsk the workspace owner to add your Telegram ID in RunButter → Assistant:\n\n  ${fromId ?? chatId}`);
    return NextResponse.json({ ok: true });
  }

  const reply = await runAssistant(admin, channel, text);
  await tgSend(channel.bot_token, chatId, reply);
  return NextResponse.json({ ok: true });
}
