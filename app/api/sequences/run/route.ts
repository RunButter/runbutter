import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { renderNewsletter, renderText, type TemplateKey, type Brand } from '@/lib/marketing/newsletter-templates';
import { unsubscribeUrl, openPixelUrl, clickUrl } from '@/lib/marketing/newsletter-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/sequences/run
 * Header: x-cron-secret: <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Drives drip sequences. Point a Render Cron Job here every minute, alongside
 * /api/newsletters/send and /api/automations/dispatch.
 *
 * Each tick does three things: sweep claims left by a dead process, enrol anyone
 * who newly qualifies, then execute one step for each due enrolment. Steps are
 * claimed with SKIP LOCKED and are at-most-once — a crash strands a row for the
 * sweeper rather than risking a second copy of the same email.
 */

const BATCH = 40;
const GAP_MS = 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function brandFor(admin: any, workspaceId: string): Promise<Brand> {
  const { data } = await admin
    .from('workspaces')
    .select('name, legal_name, logo_url, accent_color, address, email_footer')
    .eq('id', workspaceId)
    .maybeSingle();
  const b = data || ({} as any);
  return {
    name: b.legal_name || b.name || 'RunButter',
    logoUrl: b.logo_url || null,
    accent: b.accent_color || null,
    address: b.address || null,
    footer: b.email_footer || null,
  };
}

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected || secret !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'RESEND_API_KEY not set' }, { status: 500 });

  const admin = createAdminClient();

  // 1. Sweep first. A row stranded by the previous tick must not block this one.
  const { data: swept } = await admin.rpc('sweep_stale_enrollments', { p_minutes: 15 });

  // 2. Enrol. Segment-entry sequences re-evaluate here, which is what makes a
  //    segment's liveness reach the drip at all.
  const { data: seqs } = await admin.rpc('enabled_sequences');
  let enrolled = 0;
  for (const s of Array.isArray(seqs) ? seqs : []) {
    const { data } = await admin.rpc('enroll_sequence', { p_sequence: (s as any).id, p_limit: 500 });
    enrolled += Number((data as any)?.enrolled ?? 0);
  }

  // 3. Execute due steps.
  const { data: batch, error: claimErr } = await admin.rpc('claim_sequence_steps', { p_limit: BATCH });
  if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 });

  const rows: any[] = Array.isArray(batch) ? batch : [];
  const brands = new Map<string, Brand>();
  let sent = 0, waited = 0, skipped = 0, failed = 0;

  for (const r of rows) {
    // Re-checked at execution time, not just at enrolment: someone can
    // unsubscribe between the two, and continuing to drip at them is both the
    // most irritating possible bug and a compliance problem.
    if (r.subscriber_status !== 'enabled') {
      await admin.rpc('cancel_enrollments_for_subscriber', { p_subscriber: r.subscriber_id });
      skipped++;
      continue;
    }

    const step = r.step;
    if (!step || typeof step !== 'object') {
      // No step at this index — the sequence was shortened under a live
      // enrolment. Completing is right; re-running the last step is not.
      await admin.rpc('advance_enrollment', { p_id: r.enrollment_id, p_wait_days: null, p_error: null });
      skipped++;
      continue;
    }

    if (step.kind === 'wait') {
      await admin.rpc('advance_enrollment', { p_id: r.enrollment_id, p_wait_days: Number(step.days) || 0, p_error: null });
      waited++;
      continue;
    }

    if (step.kind !== 'email') {
      await admin.rpc('advance_enrollment', { p_id: r.enrollment_id, p_wait_days: null, p_error: `Unknown step kind "${step.kind}"` });
      failed++;
      continue;
    }

    // The delivery row IS the deduplication. A null id means one already exists,
    // so this subscriber has had this step — advance without sending.
    const { data: deliveryId } = await admin.rpc('create_sequence_delivery', {
      p_workspace: r.workspace_id, p_newsletter: step.newsletter_id, p_subscriber: r.subscriber_id,
    });
    if (!deliveryId) {
      await admin.rpc('advance_enrollment', { p_id: r.enrollment_id, p_wait_days: null, p_error: null });
      skipped++;
      continue;
    }

    const { data: nl } = await admin
      .from('newsletters')
      .select('subject, preheader, template, content, from_name, reply_to')
      .eq('id', step.newsletter_id)
      .eq('workspace_id', r.workspace_id)
      .maybeSingle();

    if (!nl) {
      await admin.rpc('mark_newsletter_delivery', { p_id: deliveryId, p_status: 'failed', p_provider_id: null, p_error: 'Newsletter missing' });
      await admin.rpc('advance_enrollment', { p_id: r.enrollment_id, p_wait_days: null, p_error: 'Step newsletter no longer exists' });
      failed++;
      continue;
    }

    if (!brands.has(r.workspace_id)) brands.set(r.workspace_id, await brandFor(admin, r.workspace_id));
    const brand = brands.get(r.workspace_id)!;

    const unsub = unsubscribeUrl(r.token);
    const ctx = {
      subject: nl.subject || '',
      preheader: nl.preheader || '',
      brand,
      content: (nl.content || {}) as any,
      unsubscribeUrl: unsub,
      openPixelUrl: openPixelUrl(deliveryId as string),
      trackLink: (u: string) => clickUrl(deliveryId as string, u),
    };

    const from = process.env.RESEND_FROM || 'RunButter <notifications@runbutter.app>';
    const fromHeader = nl.from_name ? `${nl.from_name} <${from.replace(/^.*<|>$/g, '')}>` : from;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromHeader,
          to: r.email,
          reply_to: nl.reply_to || undefined,
          subject: nl.subject || '(no subject)',
          html: renderNewsletter((nl.template || 'plain') as TemplateKey, ctx),
          text: renderText((nl.template || 'plain') as TemplateKey, ctx),
          headers: {
            'List-Unsubscribe': `<${unsub}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        await admin.rpc('mark_newsletter_delivery', { p_id: deliveryId, p_status: 'sent', p_provider_id: body?.id ?? null, p_error: null });
        await admin.rpc('advance_enrollment', { p_id: r.enrollment_id, p_wait_days: null, p_error: null });
        sent++;
      } else {
        const msg = `${res.status} ${body?.message || body?.name || 'send failed'}`.slice(0, 400);
        await admin.rpc('mark_newsletter_delivery', { p_id: deliveryId, p_status: 'failed', p_provider_id: null, p_error: msg });
        await admin.rpc('advance_enrollment', { p_id: r.enrollment_id, p_wait_days: null, p_error: msg });
        failed++;
      }
    } catch (e: any) {
      const msg = (e?.message || 'network error').slice(0, 400);
      await admin.rpc('mark_newsletter_delivery', { p_id: deliveryId, p_status: 'failed', p_provider_id: null, p_error: msg });
      await admin.rpc('advance_enrollment', { p_id: r.enrollment_id, p_wait_days: null, p_error: msg });
      failed++;
    }
    if (GAP_MS) await sleep(GAP_MS);
  }

  return NextResponse.json({
    ok: true, swept: Number(swept ?? 0), enrolled, claimed: rows.length, sent, waited, skipped, failed,
  });
}
