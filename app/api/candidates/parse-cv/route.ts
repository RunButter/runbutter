import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { extractResume } from '@/lib/extract-text';

// pdf.js / mammoth need the Node runtime (not Edge).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/candidates/parse-cv
 * Body: { candidateId: string, cvUrl: string }
 *
 * Downloads the uploaded CV, extracts clean text (zero-cost, no LLM),
 * regex-harvests email/phone, and stores it on the candidate row so the
 * native Postgres FTS index can serve Boolean keyword search.
 *
 * Designed to be called fire-and-forget right after upload — it never blocks
 * the candidate's application flow.
 */
export async function POST(req: NextRequest) {
  try {
    const { candidateId, cvUrl } = await req.json();

    if (!candidateId || !cvUrl) {
      return NextResponse.json(
        { error: 'candidateId and cvUrl are required' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Fetch the uploaded file bytes (cv_url is a public storage URL).
    const fileRes = await fetch(cvUrl);
    if (!fileRes.ok) {
      return NextResponse.json(
        { error: `Could not fetch CV (${fileRes.status})` },
        { status: 502 }
      );
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const fileName = cvUrl.split('?')[0].split('/').pop() || 'cv';

    const { text, email, phone } = await extractResume(buffer, fileName);

    // Only overwrite phone/email if we found one AND the row is missing it.
    const { data: existing } = await admin
      .from('candidates')
      .select('phone, email')
      .eq('id', candidateId)
      .single();

    const update: Record<string, unknown> = {
      resume_raw_text: text,
      resume_parsed_at: new Date().toISOString(),
    };
    if (phone && !existing?.phone) update.phone = phone;
    // email is required on insert, so only fill if somehow blank
    if (email && !existing?.email) update.email = email;

    const { error } = await admin
      .from('candidates')
      .update(update)
      .eq('id', candidateId);

    if (error) {
      console.error('parse-cv update error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      chars: text.length,
      harvested: { email: !!email, phone: !!phone },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'parse-cv failed';
    console.error('parse-cv error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
