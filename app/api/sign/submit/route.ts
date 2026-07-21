import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { stampCertificate, type StampSigner } from '@/lib/sign/stamp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BUCKET = 'documents';

// Record a signature. No session — the single-use token in the body is the
// credential, and the workspace/document are resolved from it server-side.
// When this signature completes the document, stamp the certificate, store the
// signed PDF, and email everyone the final copy.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`signsubmit:${clientIp(req)}`, 20);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: 'This signing link is not valid.' }, { status: 400 });

  const type = body?.type === 'drawn' ? 'drawn' : 'typed';
  const data = typeof body?.data === 'string' ? body.data : '';
  if (!data || (type === 'drawn' && !data.startsWith('data:image'))) {
    return NextResponse.json({ error: 'Add your signature before submitting.' }, { status: 400 });
  }
  if (data.length > 400_000) return NextResponse.json({ error: 'Signature image is too large.' }, { status: 413 });

  const ip = clientIp(req);
  const ua = req.headers.get('user-agent') || '';

  const admin = createAdminClient();
  const { data: res, error } = await admin.rpc('record_signature', {
    p_token: token, p_type: type, p_data: data, p_ip: ip, p_ua: ua,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!res?.ok) return NextResponse.json({ error: 'This link has already been used or is no longer active.' }, { status: 400 });

  // More signers still pending — nothing else to do yet.
  if (!res.complete) return NextResponse.json({ ok: true, complete: false });

  // Last signer: build the certificate onto the original and store it.
  try {
    const dl = await admin.storage.from(BUCKET).download(res.storage_path);
    if (dl.error || !dl.data) throw new Error(dl.error?.message || 'original not found');
    const original = Buffer.from(await dl.data.arrayBuffer());

    const signers: StampSigner[] = (res.signers || []).map((s: any) => ({
      name: s.name, email: s.email, type: s.type, data: s.data, signed_at: s.signed_at, ip: s.ip,
    }));
    const { bytes, sha256 } = await stampCertificate(original, { title: res.title, documentId: res.document_id }, signers);

    const signedPath = res.storage_path.replace(/\.pdf$/i, '') + `-signed.pdf`;
    const up = await admin.storage.from(BUCKET).upload(signedPath, Buffer.from(bytes), { contentType: 'application/pdf', upsert: true });
    if (up.error) throw new Error(up.error.message);

    await admin.rpc('finalize_sign_document', { p_document_id: res.document_id, p_signed_path: signedPath, p_signed_hash: sha256 });

    // Email the signed copy to every signer.
    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'RunButter <no-reply@runbutter.app>',
        to: signers.map((s) => s.email),
        subject: `Signed: ${res.title}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#333;padding:20px;">
            <h2 style="color:#111;">All parties have signed</h2>
            <p style="line-height:1.6;"><b>${res.title}</b> is fully signed. The completed PDF, including the signature certificate, is attached.</p>
            <p style="font-size:12px;color:#6B7280;">Document fingerprint (SHA-256): <span style="word-break:break-all;font-family:monospace;">${sha256}</span></p>
          </div>`,
        attachments: [{ filename: `${res.title.replace(/[^a-z0-9]/gi, '_')}-signed.pdf`, content: Buffer.from(bytes) }],
      }).catch(() => null);
    }

    return NextResponse.json({ ok: true, complete: true });
  } catch (e: any) {
    // The signature IS recorded; only the final assembly failed. Surface it but
    // don't lose the signature — an owner can re-trigger completion later.
    console.error('sign finalize failed:', e);
    return NextResponse.json({ ok: true, complete: true, finalizeError: e?.message || 'Could not assemble the signed PDF.' });
  }
}
