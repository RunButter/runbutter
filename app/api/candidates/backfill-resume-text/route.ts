import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { extractResume } from '@/lib/extract-text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/candidates/backfill-resume-text
 * Header: x-backfill-secret: <SUPABASE_SERVICE_ROLE_KEY>
 * Body (optional): { limit?: number }  // default 25 per call
 *
 * One-off / repeatable job to extract text for candidates that already have a
 * cv_url but no resume_raw_text yet (i.e. everyone who applied before this
 * feature shipped). Call repeatedly until { remaining: 0 }.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-backfill-secret');
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  let limit = 25;
  try {
    const body = await req.json();
    if (typeof body?.limit === 'number') limit = Math.min(Math.max(body.limit, 1), 100);
  } catch {
    /* no body is fine */
  }

  // Candidates with a CV but no extracted text yet.
  const { data: rows, error } = await admin
    .from('candidates')
    .select('id, cv_url, phone, email')
    .not('cv_url', 'is', null)
    .is('resume_raw_text', null)
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let processed = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    try {
      const fileRes = await fetch(row.cv_url as string);
      if (!fileRes.ok) {
        failed++;
        continue;
      }
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      const fileName = (row.cv_url as string).split('?')[0].split('/').pop() || 'cv';
      const { text, phone } = await extractResume(buffer, fileName);

      const update: Record<string, unknown> = {
        resume_raw_text: text,
        resume_parsed_at: new Date().toISOString(),
      };
      if (phone && !row.phone) update.phone = phone;

      const { error: upErr } = await admin
        .from('candidates')
        .update(update)
        .eq('id', row.id);
      if (upErr) failed++;
      else processed++;
    } catch (e) {
      console.error('backfill row failed', row.id, e);
      failed++;
    }
  }

  // How many still need processing after this batch?
  const { count: remaining } = await admin
    .from('candidates')
    .select('id', { count: 'exact', head: true })
    .not('cv_url', 'is', null)
    .is('resume_raw_text', null);

  return NextResponse.json({ ok: true, processed, failed, remaining: remaining ?? 0 });
}
