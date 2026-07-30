'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy, getAccessToken } from '@privy-io/react-auth';
import { Loader2, ShieldCheck, Check } from 'lucide-react';

// Client half of the accept flow: sign in with Privy, then redeem the token.
// The claim only ever sends the token — identity is taken from the verified
// Privy session server-side, so this cannot be used to join on someone
// else's behalf.

const ROLE_COPY: Record<string, string> = {
  owner: 'full control of the workspace, including billing',
  admin: 'manage members, settings, and all records',
  member: 'work across the records you are given access to',
  viewer: 'read-only access',
};

export default function AcceptInvite({
  token, companyName, role,
}: { token: string; companyName: string; role: string }) {
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const redeem = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const authToken = await getAccessToken().catch(() => null);
      const res = await fetch('/api/team/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authToken ? { 'x-privy-token': authToken } : {}) },
        body: JSON.stringify({ token }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.claimed) {
        setError(j?.error || 'Could not accept this invitation.');
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/dashboard?welcome=true'), 900);
    } catch (e: any) {
      setError(e?.message || 'Network error.');
    } finally {
      setBusy(false);
    }
  }, [token, router]);

  // Signing in is the only action the user takes; redeem follows automatically.
  useEffect(() => {
    if (ready && authenticated && !busy && !done && !error) redeem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated]);

  return (
    <div className="w-full max-w-md rounded-xl bg-surface border border-subtle p-8">
      <div className="flex items-center gap-2 text-2xs font-medium uppercase tracking-widest text-tertiary">
        <ShieldCheck className="w-3.5 h-3.5 text-accent" /> Team invitation
      </div>

      <h1 className="mt-3 text-xl font-medium tracking-tight text-primary">
        Join {companyName} on RunButter
      </h1>
      <p className="mt-2 text-sm text-secondary leading-relaxed">
        You&rsquo;ve been invited as <span className="font-medium text-primary capitalize">{role}</span>
        {ROLE_COPY[role] ? ` — you'll be able to ${ROLE_COPY[role]}.` : '.'}
      </p>

      {error && (
        <div className="mt-5 rounded-lg bg-danger/10 ring-1 ring-danger/30 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      <div className="mt-6">
        {done ? (
          <div className="flex items-center justify-center gap-2 h-10 text-sm font-medium text-success">
            <Check className="w-4 h-4" /> You&rsquo;re in — opening {companyName}…
          </div>
        ) : !ready ? (
          <div className="flex items-center justify-center h-10 text-tertiary"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : authenticated ? (
          <button
            onClick={redeem}
            disabled={busy}
            className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {busy ? 'Joining…' : `Join ${companyName}`}
          </button>
        ) : (
          <button
            onClick={login}
            className="w-full h-10 inline-flex items-center justify-center rounded-md bg-inverse text-inverse-fg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Sign in to accept
          </button>
        )}
      </div>

      <p className="mt-4 text-2xs text-tertiary text-center leading-relaxed">
        Sign in with any method — the invitation is tied to this link, not to how you sign in.
      </p>
    </div>
  );
}
