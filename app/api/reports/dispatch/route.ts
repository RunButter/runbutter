import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase';
import { buildReport, periodFor } from '@/lib/reports/build';
import { SECTION_IDS } from '@/lib/reports/registry';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Sends every report schedule that is currently due.
 *
 * Auth: `x-cron-secret: <SUPABASE_SERVICE_ROLE_KEY>` — the same contract as
 * /api/automations/dispatch, so ONE cron job can drive both.
 *
 * Point a Render Cron Job (or pg_cron via pg_net) at this every 15 minutes:
 *     curl -s -X POST https://runbutter.app/api/reports/dispatch \
 *          -H "x-cron-secret: $SUPABASE_SERVICE_ROLE_KEY"
 *
 * Frequency of the tick does not matter much: due_report_schedules() only
 * returns a schedule once per period (it checks last_sent_at), so extra ticks
 * are cheap no-ops and a missed tick still delivers late rather than never.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const db = createAdminClient();
  const { data: due, error } = await db.rpc('due_report_schedules');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const schedules: any[] = Array.isArray(due) ? due : [];
  if (!schedules.length) return NextResponse.json({ ok: true, due: 0, sent: 0 });

  if (!process.env.RESEND_API_KEY) {
    // Nothing to send with. Don't mark them sent — they'll go out once a key exists.
    return NextResponse.json({ ok: false, due: schedules.length, sent: 0, error: 'RESEND_API_KEY not configured' });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  let sent = 0;
  const failures: { id: string; error: string }[] = [];

  for (const s of schedules) {
    try {
      if (!s.privy) throw new Error('workspace has no members to attribute the report to');
      const sections = (Array.isArray(s.sections) ? s.sections : []).filter((x: string) => SECTION_IDS.includes(x));
      if (!sections.length) throw new Error('no known sections selected');

      const { from, to } = periodFor(s.frequency === 'monthly' ? 'monthly' : 'weekly');
      const { pdf } = await buildReport({
        db, workspaceId: s.workspace_id, workspaceName: s.workspace_name || 'Workspace',
        privy: s.privy, sectionIds: sections, from, to, title: s.name,
      });

      const period = s.frequency === 'monthly' ? 'Monthly' : 'Weekly';
      const label = to.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

      const { error: mailErr } = await resend.emails.send({
        from: 'RunButter <no-reply@runbutter.app>',
        to: s.recipients,
        subject: `${period} report — ${s.workspace_name} (${label})`,
        html: `
          <div style="font-family: sans-serif; max-width:600px; margin:0 auto; color:#333; padding:20px;">
            <h2 style="color:#111; font-size:20px;">${s.name}</h2>
            <p style="line-height:1.6;">Your ${period.toLowerCase()} report for <b>${s.workspace_name}</b> is attached as a PDF.</p>
            <p style="line-height:1.6; color:#6B7280; font-size:13px;">
              Covering ${from.toLocaleDateString('en-GB')} – ${to.toLocaleDateString('en-GB')}.
            </p>
            <hr style="border:0; border-top:1px solid #E5E7EB; margin:24px 0;" />
            <p style="font-size:12px; color:#6B7280;">
              Sent automatically by RunButter. Change or stop these in Workspace → Reports.
            </p>
          </div>`,
        attachments: [{ filename: `report-${to.toISOString().slice(0, 10)}.pdf`, content: pdf }],
      });
      if (mailErr) throw new Error(mailErr.message);

      await db.rpc('mark_report_sent', { p_id: s.id });
      sent++;
    } catch (e: any) {
      // One bad schedule must not stop the rest. It stays unmarked and is
      // retried on the next tick.
      console.error(`report schedule ${s.id} failed:`, e);
      failures.push({ id: s.id, error: e?.message || 'unknown' });
    }
  }

  return NextResponse.json({ ok: failures.length === 0, due: schedules.length, sent, failures });
}
