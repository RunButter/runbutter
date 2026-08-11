import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase';
import { checkFeature, planDeniedBody } from '@/lib/plans-server';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = 'documents';           // private: contracts are not world-readable
const MAX_BYTES = 15 * 1024 * 1024;

async function ensureBucket(admin: any) {
  const { data } = await admin.storage.getBucket(BUCKET);
  if (!data) await admin.storage.createBucket(BUCKET, { public: false });
}

// Create a signing request: store the PDF privately, register recipients, and
// email each of them a single-use signing link. Identity is the verified Privy
// session; the workspace is resolved from it, never the request body.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`sign:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const v = await verifyPrivyToken(req);
  if (v.status !== 'verified') {
    return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
  }

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 }); }

  const file = form.get('file') as File | null;
  const title = String(form.get('title') || 'Document').slice(0, 200);
  let recipients: { name?: string; email?: string }[] = [];
  try { recipients = JSON.parse(String(form.get('recipients') || '[]')); } catch { /* validated below */ }

  if (!file) return NextResponse.json({ error: 'Attach a PDF to send for signing.' }, { status: 400 });
  if (file.type && file.type !== 'application/pdf') return NextResponse.json({ error: 'Only PDF files can be sent for signing.' }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'PDF must be under 15 MB.' }, { status: 413 });
  recipients = (Array.isArray(recipients) ? recipients : [])
    .filter((r) => r?.email && /.+@.+\..+/.test(r.email))
    .map((r) => ({ name: (r.name || '').trim() || r.email!.trim(), email: r.email!.trim().toLowerCase() }));
  if (!recipients.length) return NextResponse.json({ error: 'Add at least one recipient with a valid email.' }, { status: 400 });

  const admin = createAdminClient();
  const { data: ws } = await admin.rpc('get_my_workspace', { p_privy: v.userId });
  if (!ws?.id) return NextResponse.json({ error: 'No workspace found for your account.' }, { status: 400 });

  // Before the PDF is uploaded, so a refused request leaves nothing in storage.
  const planDenied = await checkFeature(ws.id, 'eSignatures');
  if (planDenied) return NextResponse.json(planDeniedBody(planDenied), { status: 402 });

  // Store the original privately.
  await ensureBucket(admin);
  const path = `${ws.id}/${Date.now()}-${(file.name || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  // Register the document + recipients; get the per-recipient tokens back.
  const { data: created, error } = await admin.rpc('create_sign_document', {
    p_privy: v.userId, p_workspace: ws.id, p_title: title, p_storage_path: path,
    p_source_kind: 'upload', p_source_id: null, p_recipients: recipients,
  });
  if (error || !created?.id) {
    await admin.storage.from(BUCKET).remove([path]).catch(() => {}); // don't orphan the file
    return NextResponse.json({ error: error?.message || 'Could not create the signing request.' }, { status: 400 });
  }

  // Email each signer their link.
  const origin = req.headers.get('x-forwarded-host')
    ? `${req.headers.get('x-forwarded-proto') || 'https'}://${req.headers.get('x-forwarded-host')}`
    : (process.env.NEXT_PUBLIC_APP_URL || 'https://runbutter.app');

  let emailed = 0;
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    for (const r of created.recipients || []) {
      const link = `${origin}/sign/${r.token}`;
      const res = await resend.emails.send({
        from: 'RunButter <no-reply@runbutter.app>',
        to: r.email,
        subject: `Signature requested: ${title} — ${ws.name}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#333;padding:20px;">
            <h2 style="color:#111;">${ws.name} would like your signature</h2>
            <p style="line-height:1.6;">You've been asked to review and sign <b>${title}</b>.</p>
            <div style="text-align:center;margin:28px 0;">
              <a href="${link}" style="background:#4653CE;color:#fff;padding:12px 28px;text-decoration:none;border-radius:8px;font-weight:600;display:inline-block;">Review &amp; sign</a>
            </div>
            <p style="font-size:12px;color:#6B7280;line-height:1.6;">This link is unique to you. If the button doesn't work, paste this into your browser:<br/><span style="word-break:break-all;">${link}</span></p>
          </div>`,
      }).catch(() => ({ error: true } as any));
      if (!res.error) emailed++;
    }
  }

  return NextResponse.json({ id: created.id, recipients: recipients.length, emailed });
}
