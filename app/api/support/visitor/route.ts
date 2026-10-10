import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase';
import { kickDispatcher } from '@/lib/automations/kick';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { visitorToken, tokenHash } from '@/lib/support/token';
import { notifyTeam } from '@/lib/support/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/support/visitor — everything the chat widget does, for a visitor
 * with no account.
 *
 *   { action: 'config',   widget }
 *   { action: 'start',    widget, name, email, body, page }  → { conversation, token }
 *   { action: 'send',     conversation, token, body }
 *   { action: 'poll',     conversation, token, after }
 *   { action: 'identify', conversation, token, name, email }
 *
 * Called SAME-ORIGIN from the widget's iframe (/support/<id>), so there is no
 * CORS surface at all: the customer's website only ever loads a script tag and
 * an iframe, never this endpoint. The conversation id is minted HERE, because
 * the visitor's token is derived from it (lib/support/token.ts) — and the
 * database is handed only the token's hash.
 */

const ERRORS: Record<string, [number, string]> = {
  WIDGET_NOT_FOUND: [404, 'This chat is not available.'],
  NOT_FOUND: [404, 'That conversation could not be opened. Start a new one.'],
  EMPTY_MESSAGE: [400, 'Write a message first.'],
  EMAIL_REQUIRED: [400, 'Add your email so we can reply.'],
  BAD_EMAIL: [400, 'That email address does not look right.'],
  TOO_MANY_MESSAGES: [429, 'This conversation is full. Start a new one.'],
};

function fail(message: string) {
  const code = Object.keys(ERRORS).find((k) => message.includes(k));
  const [status, error] = code ? ERRORS[code] : [500, 'Something went wrong. Try again.'];
  return NextResponse.json({ error }, { status });
}

const uuid = (v: any) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

/**
 * GET /api/support/visitor?widget=<id> — the launcher's look, for support.js.
 *
 * The ONE cross-origin read here, because the script runs on the customer's
 * website before any iframe exists. It returns what the launcher shows and
 * nothing else — a colour and a title of a widget somebody switched on — so it
 * is open to every origin; a disabled or unknown widget answers 404, which is
 * what makes switching it off in Settings remove the button from the site.
 */
export async function GET(req: Request) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60' };
  const rl = rateLimit(`support-read:${clientIp(req)}`, 120);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  const widget = uuid(new URL(req.url).searchParams.get('widget'));
  if (!widget) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: cors });
  const { data, error } = await createAdminClient().rpc('support_widget_public', { p_widget: widget });
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: cors });
  const d = data as any;
  return NextResponse.json({ widget: { color: d.color, title: d.title } }, { headers: cors });
}

export async function POST(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const action = String(b?.action || '');
  const ip = clientIp(req);

  // Generous for reading, tight for writing: a poll every few seconds is
  // normal, a new conversation every few seconds is not.
  const rl = action === 'poll' || action === 'config'
    ? rateLimit(`support-read:${ip}`, 120)
    : action === 'start' ? rateLimit(`support-start:${ip}`, 5) : rateLimit(`support-write:${ip}`, 30);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const admin = createAdminClient();
  try {
    if (action === 'config') {
      const widget = uuid(b?.widget);
      if (!widget) return fail('WIDGET_NOT_FOUND');
      const { data, error } = await admin.rpc('support_widget_public', { p_widget: widget });
      if (error) return fail(error.message);
      if (!data) return fail('WIDGET_NOT_FOUND');
      return NextResponse.json({ widget: data });
    }

    if (action === 'start') {
      const widget = uuid(b?.widget);
      if (!widget) return fail('WIDGET_NOT_FOUND');
      const id = randomUUID();
      const token = visitorToken(id);
      const body = String(b?.body || '');
      const { data, error } = await admin.rpc('support_start', {
        p_id: id, p_widget: widget, p_token_hash: tokenHash(token),
        p_name: String(b?.name || ''), p_email: String(b?.email || ''),
        p_body: body, p_page: String(b?.page || ''),
      });
      if (error) return fail(error.message);
      const d = data as any;
      await notifyTeam({ to: d?.notify_email, company: d?.company || '', conversationId: id,
        name: b?.name, email: b?.email, body, isNew: true });
      kickDispatcher(admin); // "when a chat conversation is added" automations
      return NextResponse.json({ conversation: id, token });
    }

    const conversation = uuid(b?.conversation);
    const token = typeof b?.token === 'string' ? b.token : '';
    if (!conversation || !token) return fail('NOT_FOUND');
    const hash = tokenHash(token);

    if (action === 'poll') {
      const after = typeof b?.after === 'string' && !Number.isNaN(Date.parse(b.after)) ? b.after : null;
      const { data, error } = await admin.rpc('support_poll', { p_conversation: conversation, p_token_hash: hash, p_after: after });
      if (error) return fail(error.message);
      return NextResponse.json(data);
    }

    if (action === 'send') {
      const body = String(b?.body || '');
      const { data, error } = await admin.rpc('support_send', { p_conversation: conversation, p_token_hash: hash, p_body: body });
      if (error) return fail(error.message);
      // Announce a customer writing back to something the team thought was
      // handled. Every message of a live chat would be noise.
      const was = (data as any)?.was;
      if (was === 'pending' || was === 'closed') {
        const { data: w } = await admin.from('support_widgets').select('notify_email').eq('workspace_id', (data as any).workspace).maybeSingle();
        const { data: c } = await admin.from('support_conversations').select('name,email').eq('id', conversation).maybeSingle();
        const { data: ws } = await admin.from('workspaces').select('name').eq('id', (data as any).workspace).maybeSingle();
        await notifyTeam({ to: (w as any)?.notify_email, company: (ws as any)?.name || '', conversationId: conversation,
          name: (c as any)?.name, email: (c as any)?.email, body, isNew: false });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'identify') {
      const { error } = await admin.rpc('support_identify', {
        p_conversation: conversation, p_token_hash: hash, p_name: String(b?.name || ''), p_email: String(b?.email || ''),
      });
      if (error) return fail(error.message);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    if (/SUPPORT_NOT_CONFIGURED/.test(String(e?.message))) {
      return NextResponse.json({ error: 'Chat is not configured on this server.' }, { status: 503 });
    }
    return fail(String(e?.message || ''));
  }
}
