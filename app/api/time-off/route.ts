import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, tooMany } from '@/lib/security/http';
import { kickDispatcher } from '@/lib/automations/kick';
import { siteOrigin } from '@/lib/support/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/time-off — HR → Time & leave (0136).
 *
 *   { action: 'request', workspaceId, data: { type_id, start_date, end_date, half_start, half_end, note, user?, force? } }
 *   { action: 'decide',  id, status: 'approved' | 'rejected', note }
 *   { action: 'cancel',  id }
 *
 * A route rather than three lines in /api/rpc's ALLOWED because each of these
 * tells someone: a request emails the owners/admins, a decision emails the
 * person, an admin withdrawing somebody's leave emails them. Every rule —
 * who may approve, the allowance, overlaps — is in SQL against the VERIFIED
 * Privy id. Email is best-effort: no RESEND_API_KEY, no email, same result.
 */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fmt = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
const span = (r: any) => (r.start_date === r.end_date ? fmt(r.start_date) : `${fmt(r.start_date)} – ${fmt(r.end_date)}`);
const daysText = (n: number) => `${Number(n)} working day${Number(n) === 1 ? '' : 's'}`;

async function mail(to: string | string[], subject: string, lines: string[], cta: string): Promise<void> {
  const list = (Array.isArray(to) ? to : [to]).filter((x) => typeof x === 'string' && /@/.test(x)).slice(0, 20);
  if (!process.env.RESEND_API_KEY || !list.length) return;
  const url = `${siteOrigin()}/time/off`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18181b;line-height:1.55">
    ${lines.map((l, i) => `<p style="margin:0 0 ${i === 0 ? 12 : 6}px;${i === 0 ? 'font-size:17px' : 'color:#52525b;font-size:14px'}">${esc(l)}</p>`).join('')}
    <p style="margin:20px 0 0"><a href="${url}" style="background:#18181b;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-size:14px">${esc(cta)}</a></p></div>`;
  try {
    await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.RESEND_FROM || 'RunButter <notifications@runbutter.app>',
      to: list, subject, html, text: `${lines.join('\n')}\n\n${cta}: ${url}\n`,
    });
  } catch { /* best-effort */ }
}

const STATUS: Record<string, number> = { FORBIDDEN: 403, NOT_FOUND: 404, NOT_A_MEMBER: 403 };

export async function POST(req: Request) {
  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ error: v.status === 'unavailable' ? 'Sign-in could not be checked just now. Try again.' : 'Sign in again.' },
      { status: v.status === 'unavailable' ? 503 : 401 });
  }
  const rl = rateLimit(`time-off:${v.userId}`, 30);
  if (!rl.ok) return tooMany(rl.retryAfterS);
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const admin = createAdminClient();
  const uuid = (x: any) => (typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x) ? x : null);
  const fail = (m: string) => {
    const code = Object.keys(STATUS).find((k) => m.includes(k));
    return NextResponse.json({ error: m }, { status: code ? STATUS[code] : 400 });
  };

  if (b?.action === 'request') {
    const ws = uuid(b.workspaceId);
    if (!ws) return NextResponse.json({ error: 'No workspace.' }, { status: 400 });
    const { data, error } = await admin.rpc('request_leave', { p_privy: v.userId, p_workspace: ws, p_data: b.data || {} });
    if (error) return fail(error.message);
    const r = data as any;
    if (r.needs_approval && Array.isArray(r.approvers) && r.approvers.length) {
      await mail(r.approvers, `${r.name} asked for time off: ${span(r)}`,
        [`${r.name} asked for time off.`, `${r.type} · ${span(r)} · ${daysText(r.days)}`, ...(r.note ? [`“${r.note}”`] : [])],
        'Review the request');
    }
    kickDispatcher(admin);   // "when time off is requested" automations
    return NextResponse.json({ request: { id: r.id, status: r.status, days: r.days } });
  }

  const id = uuid(b?.id);
  if (!id) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });

  if (b?.action === 'decide') {
    const status = b.status === 'rejected' ? 'rejected' : 'approved';
    const { data, error } = await admin.rpc('decide_leave', { p_privy: v.userId, p_id: id, p_status: status, p_note: String(b.note || '').slice(0, 500) });
    if (error) return fail(error.message);
    const r = data as any;
    await mail(r.email, `Your time off was ${status === 'approved' ? 'approved' : 'declined'}: ${span(r)}`,
      [`Your time off was ${status === 'approved' ? 'approved' : 'declined'}${r.decided_by_name ? ` by ${r.decided_by_name}` : ''}.`,
        `${r.type} · ${span(r)} · ${daysText(r.days)}`, ...(r.decision_note ? [`“${r.decision_note}”`] : [])],
      'Open time off');
    kickDispatcher(admin);
    return NextResponse.json({ request: { id: r.id, status: r.status } });
  }

  if (b?.action === 'cancel') {
    const { data, error } = await admin.rpc('cancel_leave', { p_privy: v.userId, p_id: id });
    if (error) return fail(error.message);
    const r = data as any;
    // Withdrawing your own needs no email; an admin withdrawing yours does.
    if (!r.cancelled_by_owner) {
      await mail(r.email, `Your time off was cancelled: ${span(r)}`,
        ['An admin cancelled your time off.', `${r.type} · ${span(r)}`], 'Open time off');
    }
    kickDispatcher(admin);
    return NextResponse.json({ request: { id: r.id, status: r.status } });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
