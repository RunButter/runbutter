import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { kickDispatcher } from '@/lib/automations/kick';
import { inviteTokenHash } from '@/lib/surveys/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/surveys/answer — the respondent's side, no account.
 *
 *   { action: 'get',    survey, invite?, token? }
 *   { action: 'answer', survey, invite?, token?, score, comment?, email? }
 *   { action: 'optout', survey, invite, token }
 *
 * With an invite, the token from the email is the key (sha256 compared in
 * SQL) and answering again changes the answer. Without one it is the share
 * link: one response per submit, rate-limited per IP, with a honeypot.
 * Same-origin from /survey/<id>, so no CORS surface.
 */
const ERR: Record<string, [number, string]> = {
  NOT_FOUND: [404, 'This survey is not available.'],
  SURVEY_OFF: [410, 'This survey has closed.'],
  BAD_SCORE: [400, 'Pick a score.'],
};
const fail = (m: string) => { const k = Object.keys(ERR).find((x) => m.includes(x)); const [s, e] = k ? ERR[k] : [500, 'Something went wrong. Try again.']; return NextResponse.json({ error: e }, { status: s }); };
const uuid = (x: any) => (typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x) ? x : null);

export async function POST(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const action = String(b?.action || '');
  const ip = clientIp(req);
  const rl = action === 'get' ? rateLimit(`survey-read:${ip}`, 120) : rateLimit(`survey-write:${ip}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  const survey = uuid(b?.survey), invite = uuid(b?.invite);
  const token = typeof b?.token === 'string' ? b.token.slice(0, 200) : '';
  if (!survey) return fail('NOT_FOUND');
  const admin = createAdminClient();
  const hash = invite && token ? inviteTokenHash(token) : '';

  if (action === 'get') {
    const { data, error } = invite && token
      ? await admin.rpc('survey_by_invite', { p_invite: invite, p_token_hash: hash })
      : await admin.rpc('survey_public', { p_survey: survey });
    if (error) return fail(error.message);
    if (!data || (data as any).id !== survey) return fail('NOT_FOUND');
    return NextResponse.json({ survey: data });
  }

  if (action === 'optout') {
    if (!invite || !token) return fail('NOT_FOUND');
    const { error } = await admin.rpc('survey_opt_out', { p_invite: invite, p_token_hash: hash });
    if (error) return fail(error.message);
    return NextResponse.json({ ok: true });
  }

  if (action === 'answer') {
    if (b?.website) return NextResponse.json({ ok: true });   // honeypot
    const score = Number.isInteger(b?.score) ? b.score : Number.isInteger(Number(b?.score)) ? Number(b.score) : null;
    const comment = typeof b?.comment === 'string' ? b.comment.slice(0, 2000) : null;
    const { data, error } = invite && token
      ? await admin.rpc('survey_answer_invite', { p_invite: invite, p_token_hash: hash, p_score: score, p_comment: comment })
      : await admin.rpc('survey_answer_link', { p_survey: survey, p_score: score, p_comment: comment, p_email: typeof b?.email === 'string' ? b.email.slice(0, 200) : null });
    if (error) return fail(error.message);
    kickDispatcher(admin);   // "when a survey is answered" automations
    return NextResponse.json({ ok: true, bucket: (data as any)?.bucket });
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
