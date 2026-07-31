import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { renderNewsletter, renderText, type TemplateKey, type Brand } from '@/lib/marketing/newsletter-templates';
import { unsubscribeUrl, openPixelUrl, clickUrl } from '@/lib/marketing/newsletter-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/newsletters/send
 * Header: x-cron-secret: <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Drains due newsletters in batches. Point a Render Cron Job here every minute,
 * the same way /api/automations/dispatch is driven.
 *
 * WHY A CRON AND NOT A REQUEST: a five-thousand-recipient send cannot live
 * inside one HTTP request — it would exceed every platform timeout and, worse,
 * a timeout mid-flight would leave the send in an unknown state. Batching makes
 * progress durable: each tick claims a slice, sends it, records the outcome, and
 * the next tick resumes exactly where the last one stopped.
 *
 * The claim/mark protocol is at-most-once by design (see 0071's header): a row
 * is moved to 'sending' BEFORE the provider call, so a crash strands it rather
 * than risking a second copy to a real subscriber.
 */

// Conservative. Resend's default is 2 requests/second on the entry plans, and
// these are sent sequentially with a small gap rather than in parallel — a burst
// that trips the provider's rate limit turns into failed deliveries, which under
// at-most-once are not retried.
const BATCH = 40;
const GAP_MS = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function brandFor(admin: any, workspaceId: string): Promise<Brand> {
  // Read the columns directly rather than through get_workspace_branding, which
  // takes a p_privy and checks membership — there is no member here, this runs
  // as the cron. Adding a service-role branding RPC just for this would be a
  // second definition of the same thing to keep in sync.
  const { data } = await admin
    .from('workspaces')
    .select('name, legal_name, logo_url, accent_color, address, email_footer, email_from_name')
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
  const { data: due, error: dueErr } = await admin.rpc('due_newsletters', { p_limit: 3 });
  if (dueErr) return NextResponse.json({ error: dueErr.message }, { status: 500 });

  const list = Array.isArray(due) ? due : [];
  const report: any[] = [];

  for (const n of list) {
    const { data: batch, error: claimErr } = await admin.rpc('claim_newsletter_batch', {
      p_newsletter: n.id, p_limit: BATCH,
    });
    if (claimErr) { report.push({ id: n.id, error: claimErr.message }); continue; }

    const rows: any[] = Array.isArray(batch) ? batch : [];
    const brand = await brandFor(admin, n.workspace_id);
    const from = process.env.RESEND_FROM || 'RunButter <notifications@runbutter.app>';
    const fromHeader = n.from_name ? `${n.from_name} <${from.replace(/^.*<|>$/g, '')}>` : from;

    let sent = 0, failed = 0;
    for (const d of rows) {
      const unsub = unsubscribeUrl(d.token, n.id);
      const ctx = {
        subject: n.subject || '',
        preheader: n.preheader || '',
        brand,
        content: (n.content || {}) as any,
        unsubscribeUrl: unsub,
        openPixelUrl: openPixelUrl(d.id),
        trackLink: (u: string) => clickUrl(d.id, u),
      };

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromHeader,
            to: d.email,
            reply_to: n.reply_to || undefined,
            subject: n.subject || '(no subject)',
            html: renderNewsletter((n.template || 'plain') as TemplateKey, ctx),
            text: renderText((n.template || 'plain') as TemplateKey, ctx),
            // Gmail and Yahoo require one-click unsubscribe from bulk senders.
            // Without these headers deliverability degrades regardless of how
            // clean the list is — the footer link alone does not satisfy it.
            headers: {
              'List-Unsubscribe': `<${unsub}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          await admin.rpc('mark_newsletter_delivery', { p_id: d.id, p_status: 'sent', p_provider_id: body?.id ?? null, p_error: null });
          sent++;
        } else {
          await admin.rpc('mark_newsletter_delivery', {
            p_id: d.id, p_status: 'failed', p_provider_id: null,
            p_error: `${res.status} ${body?.message || body?.name || 'send failed'}`.slice(0, 400),
          });
          failed++;
        }
      } catch (e: any) {
        await admin.rpc('mark_newsletter_delivery', {
          p_id: d.id, p_status: 'failed', p_provider_id: null,
          p_error: (e?.message || 'network error').slice(0, 400),
        });
        failed++;
      }
      if (GAP_MS) await sleep(GAP_MS);
    }

    const { data: fin } = await admin.rpc('finish_newsletter', { p_id: n.id, p_stale_minutes: 15 });
    report.push({ id: n.id, claimed: rows.length, sent, failed, ...(fin || {}) });
  }

  return NextResponse.json({ ok: true, newsletters: report.length, report });
}
