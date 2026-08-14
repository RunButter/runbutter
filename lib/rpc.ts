'use client';

import { getAccessToken } from '@privy-io/react-auth';

// Drop-in replacement for `supabase.rpc()` on AUTHENTICATED functions.
// Same `{ data, error }` contract (and like supabase.rpc it never throws),
// but the call goes through /api/rpc, which verifies the Privy token
// server-side and overwrites any p_privy / p_privy_user_id argument with the
// PROVEN identity. Keep truly public functions (apply flow, assessments,
// tracking clicks) on the direct supabase client — candidates have no Privy
// session.
//
// PERFORMANCE — why the caching below exists:
// the proxy is a security necessity, but it makes every read two hops
// (browser → our server → Postgres) instead of one. Nothing was cached, so
// switching tabs re-fetched the same rows every time and paid the full round
// trip again. Reads are now briefly memoised and identical concurrent reads are
// de-duplicated; any write flushes the cache, so a stale row cannot survive a
// mutation.

const READ_TTL_MS = 20_000;

// Read-only by naming convention (matches the ALLOWED list in /api/rpc).
// Anything not matched is treated as a mutation — deliberately conservative,
// because wrongly caching a write is far worse than a cache miss.
const READ_RE = /^(get|list|search|suggest)_/;
const isRead = (fn: string) => READ_RE.test(fn);

type Result = { data: any; error: any };
const cache = new Map<string, { at: number; value: Result }>();
const inflight = new Map<string, Promise<Result>>();

/** Drop every memoised read. Called after any mutation. */
export function clearRpcCache() {
  cache.clear();
  inflight.clear();
}

// getAccessToken() runs on every single RPC; memoise briefly so a burst of
// parallel loaders doesn't hit the Privy SDK once per call. Far under the
// token's own lifetime, and the SDK still handles refresh.
const TOKEN_TTL_MS = 30_000;
let tokenMemo: { at: number; value: string | null } | null = null;

async function cachedToken(): Promise<string | null> {
  if (tokenMemo && Date.now() - tokenMemo.at < TOKEN_TTL_MS) return tokenMemo.value;
  const value = await getAccessToken().catch(() => null);
  tokenMemo = { at: Date.now(), value };
  return value;
}

/**
 * A FAILED READ MUST NOT LOOK LIKE AN EMPTY ONE.
 *
 * `rpc()` resolves on failure and never throws, so `const { data } = await
 * rpc(…)` compiles, runs, and renders an empty list for a load that broke.
 * Thirty-four call sites in this repo do exactly that, and it is not a
 * hypothetical: Settings → Integrations rendered "no integrations" for months
 * while the three functions behind it did not exist in the database at all. The
 * screen was not empty, it was broken, and nothing on it said so.
 *
 * Fixing thirty-four return types would touch every caller of every loader. This
 * is the systemic half instead: any READ that fails announces itself, so the
 * shell can say "this did not load" over the top of whatever empty state the
 * page drew. It costs nothing at the call sites and it covers code nobody has
 * written yet, which is the part a one-time sweep cannot do.
 *
 * READS ONLY. A write already has an owner — the caller that awaited it and
 * shows `notify(error)` — and announcing those too would produce two messages
 * for one failure.
 *
 * SESSION ERRORS ARE SKIPPED. Signed out, every read fails, and that case is
 * already answered honestly by the amber "Sample" badge; a red banner behind it
 * would be alarming and redundant. What is left is what this is for: a missing
 * function, a bad argument, a 500, a dropped network.
 */
export const RPC_READ_FAILED = 'rb:rpc-read-failed';
export interface RpcReadFailure { fn: string; message: string }

const isSessionError = (m: string) => /session|sign in|unauthor|401|403/i.test(m);

function announceReadFailure(fn: string, error: any) {
  if (typeof window === 'undefined') return;
  const message = String(error?.message || 'Request failed');
  if (isSessionError(message)) return;
  // console too: the banner is for the person, this is for whoever is debugging.
  console.error(`rpc read failed: ${fn}`, error);
  window.dispatchEvent(new CustomEvent<RpcReadFailure>(RPC_READ_FAILED, { detail: { fn, message } }));
}

async function call(fn: string, args: Record<string, any>): Promise<Result> {
  try {
    const token = await cachedToken();
    const res = await fetch('/api/rpc', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-privy-token': token } : {}),
      },
      body: JSON.stringify({ fn, args }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      return { data: null, error: j?.error ?? { message: `rpc ${fn} failed (HTTP ${res.status})` } };
    }
    return { data: j?.data ?? null, error: j?.error ?? null };
  } catch (e: any) {
    return { data: null, error: { message: e?.message || `rpc ${fn}: network error` } };
  }
}

export async function rpc(fn: string, args?: Record<string, any>): Promise<Result> {
  const a = args ?? {};

  // Writes are never cached, and they invalidate everything that was.
  if (!isRead(fn)) {
    const out = await call(fn, a);
    clearRpcCache();
    return out;
  }

  const key = `${fn}:${JSON.stringify(a)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.value;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const out = await call(fn, a);
    // Only successful reads are cached — an error must not stick around and
    // keep a screen broken for the rest of the TTL.
    if (!out.error) cache.set(key, { at: Date.now(), value: out });
    else announceReadFailure(fn, out.error);
    return out;
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}
