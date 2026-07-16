'use client';

import { getAccessToken } from '@privy-io/react-auth';

// Drop-in replacement for `supabase.rpc()` on AUTHENTICATED functions.
// Same `{ data, error }` contract (and like supabase.rpc it never throws),
// but the call goes through /api/rpc, which verifies the Privy token
// server-side and overwrites any p_privy / p_privy_user_id argument with the
// PROVEN identity. Keep truly public functions (apply flow, assessments,
// tracking clicks) on the direct supabase client — candidates have no Privy
// session.

export async function rpc(fn: string, args?: Record<string, any>): Promise<{ data: any; error: any }> {
  try {
    const token = await getAccessToken().catch(() => null);
    const res = await fetch('/api/rpc', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-privy-token': token } : {}),
      },
      body: JSON.stringify({ fn, args: args ?? {} }),
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
