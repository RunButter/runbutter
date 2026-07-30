import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Hard ceiling per run, independent of the RPC's own limit. A misconfigured
// schedule must not be able to mail an entire ledger in one go — this is the
// difference between a reminder feature and a spam incident.
const MAX_PER_RUN = 40;

const FROM = 'runbutter.app <hello@runbutter.app>';

const DEFAULT_SUBJECT = 'Invoice {{invoice_number}} — {{status_line}}';
const DEFAULT_BODY = `Hi,

This is a reminder about invoice {{invoice_number}} for {{amount}}, due {{due_date}}.

{{status_line}}

If it has already been paid, please ignore this — and thanks.

{{company}}`;

/** Fill {{tokens}}. Unknown tokens are left alone rather than blanked, so a typo is visible. */
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface DueReminder {
  id: string; number: string | null; amount: number | null; due_at: string;
  status: string; company_name: string | null; company_email: string;
  days_overdue: number; stage: number;
  subject: string | null; body: string | null; reply_to: string | null;
}

/**
 * POST /api/finance/reminders/run   { workspace?: uuid }
 *
 * Marks invoices overdue and sends whatever reminders are due.
 *
 * Two ways in: a signed-in owner pressing "Run now", or a scheduler presenting
 * CRON_SECRET. Intended to run daily — the offsets are day-grained, and the
 * unique(invoice, stage) constraint in 0064 makes a repeated run a no-op rather
 * than a second email, so firing it twice is harmless.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`reminders:${clientIp(req)}`, 6);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const cronSecret = process.env.CRON_SECRET;
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const viaCron = !!cronSecret && bearer === cronSecret;

  let privy: string | null = null;
  if (!viaCron) {
    const v = await verifyPrivyToken(req);
    if (v.status !== 'verified') {
      return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
    }
    privy = v.userId;
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 });
  }
  const admin = createAdminClient();

  let body: any = {};
  try { body = await req.json(); } catch { /* body is optional */ }
  let workspace: string | null = typeof body?.workspace === 'string' ? body.workspace : null;

  // A signed-in caller may only run their OWN workspace, whatever they asked
  // for — otherwise this endpoint would mail another tenant's clients.
  if (!viaCron) {
    const { data: ws, error } = await admin.rpc('get_my_workspace', { p_privy: privy });
    if (error || !ws) return NextResponse.json({ error: 'No workspace for your account.' }, { status: 403 });
    workspace = (ws as any).id;
  }
  if (!workspace) {
    return NextResponse.json({ error: 'workspace is required when running via cron.' }, { status: 400 });
  }

  // Status first: a workspace with reminders switched off still wants its
  // dashboard to say "overdue" rather than "sent" indefinitely.
  const { data: marked, error: markError } = await admin.rpc('mark_invoices_overdue', { p_workspace: workspace });
  if (markError) {
    const missing = /does not exist|schema cache/i.test(markError.message);
    return NextResponse.json(
      { error: missing ? 'Run migration 0064 first.' : markError.message },
      { status: missing ? 400 : 500 },
    );
  }

  const { data: due, error: dueError } = await admin.rpc('due_invoice_reminders', {
    p_workspace: workspace, p_limit: MAX_PER_RUN,
  });
  if (dueError) return NextResponse.json({ error: dueError.message }, { status: 500 });

  const queue = (Array.isArray(due) ? due : []) as DueReminder[];
  if (queue.length === 0) {
    return NextResponse.json({ ok: true, marked_overdue: marked ?? 0, sent: 0, failed: 0, results: [] });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({
      error: 'RESEND_API_KEY is not set, so reminders cannot be sent.',
      marked_overdue: marked ?? 0, would_send: queue.length,
    }, { status: 500 });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  let sent = 0, failed = 0;
  const results: { invoice: string; to: string; stage: number; ok: boolean; error?: string }[] = [];

  for (const r of queue) {
    const amount = r.amount == null ? '' : Number(r.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 });
    const due = r.due_at ? new Date(r.due_at).toLocaleDateString('en-GB') : '';
    // The pre-due nudge and the overdue chase must not read the same, or the
    // early one sounds like an accusation.
    const statusLine = r.days_overdue > 0
      ? `It is now ${r.days_overdue} day${r.days_overdue === 1 ? '' : 's'} past due.`
      : `It is due in ${Math.abs(r.days_overdue)} day${Math.abs(r.days_overdue) === 1 ? '' : 's'}.`;

    const vars = {
      invoice_number: r.number || '',
      amount, due_date: due,
      days_overdue: String(Math.max(0, r.days_overdue)),
      company: r.company_name || '',
      status_line: statusLine,
    };

    const subject = render(r.subject || DEFAULT_SUBJECT, vars).slice(0, 200);
    const text = render(r.body || DEFAULT_BODY, vars);
    const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">${
      escapeHtml(text).replace(/\n/g, '<br>')
    }</div>`;

    let error: string | null = null;
    try {
      const { error: sendErr } = await resend.emails.send({
        from: FROM,
        to: [r.company_email],
        subject,
        html,
        ...(r.reply_to ? { replyTo: r.reply_to } : {}),
      });
      if (sendErr) error = sendErr.message || 'Resend rejected the message';
    } catch (e: any) {
      error = e?.message || 'Send failed';
    }

    // Logged either way. A permanently bouncing address must not be retried
    // every single day — the log row is what stops that.
    await admin.rpc('log_invoice_reminder', {
      p_workspace: workspace, p_invoice: r.id, p_stage: r.stage,
      p_to: r.company_email, p_error: error,
    }).then(() => {}, () => {});

    if (error) { failed++; } else { sent++; }
    results.push({ invoice: r.number || r.id, to: r.company_email, stage: r.stage, ok: !error, ...(error ? { error } : {}) });
  }

  return NextResponse.json({ ok: true, marked_overdue: marked ?? 0, sent, failed, results });
}
