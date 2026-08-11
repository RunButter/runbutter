import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health — is this instance actually working?
 *
 * WHY IT EXISTS. Every self-hoster wants one, every uptime checker needs one,
 * and a container orchestrator will restart a pod without one. There was none,
 * so the only way to know an instance was healthy was to open it in a browser
 * and look — which does not scale to three in the morning.
 *
 * IT CHECKS, IT DOES NOT GUESS. A route that returns `{ ok: true }` because it
 * managed to run is worse than nothing: it stays green while the database is
 * unreachable, which is the one failure it exists to catch. So it actually
 * reaches Postgres and actually reaches storage, and reports each separately.
 *
 * IT LEAKS NOTHING. No versions, no project ids, no hostnames, no env, no row
 * counts — this endpoint is unauthenticated by necessity (a checker cannot log
 * in) and anything it returns is public. `error` carries a SHORT reason so an
 * operator learns something, and never the raw driver message, which routinely
 * contains connection strings.
 *
 * 503 WHEN THE DATABASE IS DOWN. A load balancer needs the status code to mean
 * something; an instance that cannot reach Postgres cannot serve a single page
 * and should be taken out of rotation. Storage being down is degraded, not
 * dead — most screens still work — so that stays 200 and says so.
 */

const TIMEOUT_MS = 4000;

/** Bounded, because a health check that hangs is an outage of its own. */
async function withTimeout<T>(p: Promise<T>, label: string): Promise<{ ok: boolean; ms: number; error?: string }> {
  const started = Date.now();
  try {
    await Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS)),
    ]);
    return { ok: true, ms: Date.now() - started };
  } catch (e: any) {
    // Deliberately short and generic. A driver error can contain the connection
    // string, and this response is public.
    const raw = String(e?.message || '');
    return { ok: false, ms: Date.now() - started, error: /timed out/.test(raw) ? `${label} timed out` : `${label} unreachable` };
  }
}

export async function GET() {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    // Missing or malformed Supabase env. The single most common broken
    // self-host, and worth naming precisely because the fix is obvious.
    return NextResponse.json(
      { status: 'error', database: { ok: false, error: 'not configured' }, storage: { ok: false, error: 'not configured' } },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  // One cheap, indexed read. `head: true` asks for no rows at all — this proves
  // the connection and the credential without moving a customer's data through
  // a public endpoint.
  const database = await withTimeout(
    (async () => {
      const { error } = await admin.from('workspaces').select('id', { head: true, count: 'exact' }).limit(1);
      if (error) throw new Error(error.message);
    })(),
    'database',
  );

  const storage = await withTimeout(
    (async () => {
      const { error } = await admin.storage.listBuckets();
      if (error) throw new Error(error.message);
    })(),
    'storage',
  );

  const status = !database.ok ? 'error' : !storage.ok ? 'degraded' : 'ok';

  return NextResponse.json(
    { status, database, storage },
    {
      status: database.ok ? 200 : 503,
      // Never cached. A cached health check reports the past, which is the one
      // thing it must not do.
      headers: { 'cache-control': 'no-store' },
    },
  );
}
