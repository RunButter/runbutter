import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Double opt-in confirmation. Only lifts 'unconfirmed' — see newsletter_confirm. */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();
  const { data } = await admin.rpc('newsletter_confirm', { p_token: params.token });
  const ok = Boolean((data as any)?.ok);
  const title = ok ? 'Subscription confirmed' : 'Link not recognised';
  const body = ok
    ? 'Thank you — you are on the list.'
    : 'This confirmation link is invalid or has already been used.';
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
