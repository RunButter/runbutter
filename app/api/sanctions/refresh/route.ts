import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';
import { OFAC_SOURCES, fetchOfacFile, buildEntities, type OfacEntity } from '@/lib/sanctions/ofac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Three CSVs per source, ~50k rows total, written in batches. Well past the
// default serverless budget, so ask for the long ceiling explicitly.
export const maxDuration = 300;

const BATCH = 500;

/**
 * POST /api/sanctions/refresh — pull the current OFAC lists into Postgres.
 *
 * Runs as service_role because sanctions_entities is reference data that no
 * tenant owns. Two ways in:
 *   • a signed-in user pressing "Update list"
 *   • a scheduled caller presenting CRON_SECRET as a bearer token
 * Anonymous callers are refused — the data is public, but the bandwidth and
 * the write amplification are ours.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`sanctions-refresh:${clientIp(req)}`, 4);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  const cronSecret = process.env.CRON_SECRET;
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const viaCron = !!cronSecret && bearer === cronSecret;

  if (!viaCron) {
    const v = await verifyPrivyToken(req);
    if (v.status !== 'verified') {
      return NextResponse.json({ error: 'Your session is invalid or expired. Sign in again.' }, { status: 401 });
    }
  }

  // createAdminClient() silently falls back to the anon key, which cannot write
  // this table — fail loudly here instead of reporting a successful no-op.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY — the list cannot be updated.' }, { status: 500 });
  }
  const admin = createAdminClient();

  const report: { source: string; count?: number; removed?: number; error?: string }[] = [];

  for (const src of OFAC_SOURCES) {
    // Marks this pass. Anything left over from a previous sync is a delisting,
    // and delistings matter as much as additions — a stale entry means flagging
    // a counterparty who is no longer sanctioned.
    const syncedAt = new Date().toISOString();
    try {
      const [prim, alt, add] = await Promise.all([
        fetchOfacFile(src.files.prim),
        fetchOfacFile(src.files.alt),
        fetchOfacFile(src.files.add),
      ]);

      const entities = buildEntities(src, prim, alt, add);
      if (entities.length === 0) throw new Error('Parsed 0 entities — refusing to replace the existing list.');

      for (let i = 0; i < entities.length; i += BATCH) {
        const rows = entities.slice(i, i + BATCH).map((e: OfacEntity) => ({ ...e, updated_at: syncedAt }));
        // search_text / norm_name / norm_aliases are filled by the trigger in
        // 0058 — deliberately not computed here, so normalisation can never
        // drift between ingest and screening.
        const { error } = await admin
          .from('sanctions_entities')
          .upsert(rows, { onConflict: 'source,source_uid' });
        if (error) throw new Error(`write failed at row ${i}: ${error.message}`);
      }

      const { count: removed, error: delError } = await admin
        .from('sanctions_entities')
        .delete({ count: 'exact' })
        .eq('source', src.source)
        .lt('updated_at', syncedAt);
      if (delError) throw new Error(`cleanup failed: ${delError.message}`);

      await admin.rpc('record_sanctions_sync', { p_source: src.source, p_count: entities.length, p_error: null });
      report.push({ source: src.source, count: entities.length, removed: removed ?? 0 });
    } catch (e: any) {
      const message = e?.message || 'Refresh failed';
      // Record the failure so the UI can show "last attempt failed" instead of
      // an unexplained stale timestamp. Keep going: one list being down is no
      // reason to skip the other.
      await admin.rpc('record_sanctions_sync', { p_source: src.source, p_count: 0, p_error: message })
        .then(() => {}, () => {});
      report.push({ source: src.source, error: message });
    }
  }

  const ok = report.some((r) => typeof r.count === 'number');
  return NextResponse.json({ ok, sources: report }, { status: ok ? 200 : 502 });
}
