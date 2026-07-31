import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One-click unsubscribe. GET renders a confirmation page; POST is what Gmail and
 * Yahoo call directly via List-Unsubscribe-Post.
 *
 * BOTH verbs unsubscribe. That looks wrong — a GET should not mutate — but the
 * alternative is worse here: the requirement from the mailbox providers is that
 * clicking the link in their UI removes the person without a further step, and
 * a "click here to confirm" page in front of it is exactly what they treat as
 * non-compliant. The token is single-purpose, unguessable and only ever
 * unsubscribes, so the usual objection (a prefetcher causing damage) costs the
 * subscriber nothing they did not already ask for by clicking.
 */
async function unsubscribe(token: string, newsletterId: string | null) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('newsletter_unsubscribe', {
    p_token: token, p_newsletter: newsletterId,
  });
  if (error) return { ok: false as const, email: null };
  return { ok: Boolean((data as any)?.ok), email: (data as any)?.email ?? null };
}

function page(title: string, body: string) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:440px;margin:15vh auto;background:#fff;border-radius:12px;padding:32px;text-align:center;">
<h1 style="margin:0 0 10px;font-size:19px;font-weight:600;color:#18181b;">${title}</h1>
<p style="margin:0;font-size:15px;line-height:24px;color:#71717a;">${body}</p>
</div></body></html>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const n = new URL(req.url).searchParams.get('n');
  const r = await unsubscribe(params.token, n);
  return r.ok
    ? page('Unsubscribed', `${r.email ? r.email + ' has' : 'You have'} been removed from this mailing list. You will not receive further newsletters.`)
    : page('Link not recognised', 'This unsubscribe link is invalid or has already been used. If you keep receiving mail, reply to any message and we will remove you.');
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const n = new URL(req.url).searchParams.get('n');
  await unsubscribe(params.token, n);
  // One-Click expects a 200 with no body to parse.
  return new NextResponse(null, { status: 200 });
}
