import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, tooMany } from '@/lib/security/http';
import { inviteToken, inviteTokenHash } from '@/lib/surveys/token';
import { surveyEmail } from '@/lib/surveys/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /api/surveys/send { workspaceId, surveyId, personIds[], force? }
 *
 * Mints an invite per person (id + hash of its derived token), lets SQL decide
 * who may be asked (create_survey_invites, 0138: no email, opted out, bounced,
 * asked in the last 30 days), then emails the ones it accepted. Membership and
 * role are checked in SQL against the VERIFIED Privy id. Without
 * RESEND_API_KEY nothing is emailed and the screen says so — the invites stay
 * unsent, so a resend later does not trip the 30-day rule.
 */
export async function POST(req: Request) {
  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ error: v.status === 'unavailable' ? 'Sign-in could not be checked just now. Try again.' : 'Sign in again.' },
      { status: v.status === 'unavailable' ? 503 : 401 });
  }
  const rl = rateLimit(`surveys-send:${v.userId}`, 10, 10 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Email is not set up on this server (RESEND_API_KEY), so surveys cannot be sent. The share link still works.' }, { status: 400 });
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const uuid = (x: any) => (typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x) ? x : null);
  const ws = uuid(b?.workspaceId), survey = uuid(b?.surveyId);
  const people: string[] = Array.isArray(b?.personIds) ? [...new Set<string>(b.personIds.map(uuid).filter(Boolean) as string[])] : [];
  if (!ws || !survey) return NextResponse.json({ error: 'Missing survey.' }, { status: 400 });
  if (!people.length) return NextResponse.json({ error: 'Pick who to ask.' }, { status: 400 });
  if (people.length > 500) return NextResponse.json({ error: 'Up to 500 people at a time.' }, { status: 400 });

  const invites = people.map((person_id) => { const id = randomUUID(); return { id, person_id, token_hash: inviteTokenHash(inviteToken(id)) }; });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('create_survey_invites', { p_privy: v.userId, p_workspace: ws, p_survey: survey, p_invites: invites, p_force: !!b?.force });
  if (error) {
    const m = error.message;
    const msg = /SURVEY_OFF/.test(m) ? 'This survey is switched off.' : /FORBIDDEN/.test(m) ? 'Viewers cannot send surveys.' : /NOT_FOUND|NOT_A_MEMBER/.test(m) ? 'Survey not found.' : m;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const d = data as any;
  const s = d.survey;
  const from = `"${String(d.from_name || s.company?.name || 'Team').replace(/["<>\r\n]/g, '').slice(0, 60)}" <${(/<([^>]+)>/.exec(process.env.RESEND_FROM || '')?.[1]) || (process.env.RESEND_FROM || 'notifications@runbutter.app')}>`;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const emails = (d.invites as any[]).map((i) => {
    const m = surveyEmail({ surveyId: survey, inviteId: i.id, firstName: i.first_name, kind: s.kind, question: s.question, company: s.company?.name || '', accent: s.company?.accent });
    return { id: i.id, msg: { from, to: i.email, subject: m.subject, html: m.html, text: m.text, ...(d.reply_to ? { replyTo: d.reply_to } : {}),
      headers: { 'List-Unsubscribe': `<${m.unsubscribe}>` } } };
  });
  const sent: string[] = [];
  for (let k = 0; k < emails.length; k += 100) {
    const chunk = emails.slice(k, k + 100);
    try {
      const r: any = await (resend as any).batch.send(chunk.map((e) => e.msg));
      if (!r?.error) sent.push(...chunk.map((e) => e.id));
    } catch { /* this chunk stays unsent; the count says so */ }
  }
  if (sent.length) await admin.rpc('mark_survey_sent', { p_ids: sent });
  return NextResponse.json({ created: d.created, sent: sent.length, skipped: d.skipped });
}
