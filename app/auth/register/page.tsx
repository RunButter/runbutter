'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePrivy, getAccessToken } from '@privy-io/react-auth';
import { loadMyHrCompanies } from '@/lib/crm/data';
import { Users, Building2, Globe, Loader2 } from 'lucide-react';
import Logo from '@/components/Logo';

export default function RegisterPage() {
  const router = useRouter();
  const { ready, authenticated, user, login, logout } = usePrivy();

  const [step, setStep] = useState<'loading' | 'auth' | 'company'>('loading');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [debug, setDebug] = useState('');
  const [subdomainAvailable, setSubdomainAvailable] = useState<boolean | null>(null);
  const [formData, setFormData] = useState({ companyName: '', subdomain: '' });

  // Debug what's happening
  useEffect(() => {
    setDebug(`Ready: ${ready}, Auth: ${authenticated}, User: ${user?.id ? 'exists' : 'null'}`);
  }, [ready, authenticated, user]);

  useEffect(() => {
    if (!ready) return;

    if (!authenticated || !user) {
      setStep('auth');
      return;
    }

    // Authenticated — check for existing company
    const checkUser = async () => {
      try {
        // limit(1), NOT maybeSingle(): someone can belong to more than one
        // company, and maybeSingle() throws "multiple rows returned" for them.
        let data: unknown[] = [];
        try {
          data = await loadMyHrCompanies(user.id);
        } catch (e: unknown) {
          setError(`Membership check failed: ${e instanceof Error ? e.message : 'unknown error'}`);
          setStep('auth');
          return;
        }
        if (data && data.length > 0) {
          router.push('/dashboard');
        } else {
          // No auto-claim by email here. It used to POST { email, privyUserId }
          // to /api/team/claim, which trusted both — anyone could bind their
          // account to a pending invite just by knowing the address. Invites are
          // now redeemed at /auth/accept?token=…, using the single-use token
          // from the invitation email, with identity taken from the verified
          // Privy session. Someone who signs up here without their link simply
          // creates their own workspace, which is the correct outcome.
          setStep('company');
        }
      } catch (err: any) {
        setError(`Error: ${err.message}`);
        setStep('auth');
      }
    };

    checkUser();
  }, [ready, authenticated, user, router]);

  const handleSignIn = async () => {
    setError('');
    try {
      await login();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
    }
  };

  const checkSubdomain = async (subdomain: string) => {
    if (!subdomain || subdomain.length < 3) { setSubdomainAvailable(null); return; }
    // Server-side: `companies` stops being anon-readable in 0077.
    try {
      const res = await fetch(`/api/onboarding/provision?subdomain=${encodeURIComponent(subdomain)}`);
      const j = await res.json();
      setSubdomainAvailable(Boolean(j?.available));
    } catch { setSubdomainAvailable(null); }
  };

  const handleSubdomainChange = (value: string) => {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    setFormData({ ...formData, subdomain: cleaned });
    checkSubdomain(cleaned);
  };

  const handleCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.companyName || !formData.subdomain) { setError('Please fill in all fields'); return; }
    if (!subdomainAvailable) { setError('This subdomain is not available'); return; }
    if (!user) { setError('Not authenticated'); return; }

    setSubmitting(true);
    setError('');

    try {
      const email = user.email?.address ?? user.google?.email ?? '';
      const fullName = user.google?.name ?? email.split('@')[0] ?? 'User';

      // ONE verified server call, replacing three client-side anon INSERTs into
      // companies / company_users / assessment_templates.
      //
      // Beyond closing the write path (those inserts are why company_users had
      // to be anon-writable, which was a tenant bypass — see 0076), this ends
      // the silent half-failure: the old flow could create the company, fail on
      // the membership, and leave someone signed in with no workspace at all.
      const token = await getAccessToken().catch(() => null);
      const res = await fetch('/api/onboarding/provision', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'x-privy-token': token } : {}) },
        body: JSON.stringify({
          privyUserId: user.id,
          companyName: formData.companyName,
          subdomain: formData.subdomain,
          email, fullName,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Could not create your workspace.');

      router.push('/dashboard?welcome=true');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Setup failed.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-accent mx-auto mb-3" />
          <p className="text-sm text-secondary">Checking authentication...</p>
          <p className="text-xs text-tertiary mt-2">{debug}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
      <div className="max-w-md w-full">

        <div className="text-center mb-8">
          <div className="flex justify-center mb-8">
            <Logo />
          </div>
          <h1 className="text-2xl font-medium text-primary mb-2">Create Your Account</h1>
          <p className="text-secondary">Start hiring smarter in minutes</p>
        </div>

        <div className="mb-6 flex items-center justify-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step === 'auth' ? 'bg-accent text-accent-fg' : 'bg-success text-success-fg'}`}>
            {step === 'auth' ? '1' : '✓'}
          </div>
          <div className={`w-16 h-1 ${step === 'company' ? 'bg-accent' : 'bg-strong'}`} />
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step === 'company' ? 'bg-accent text-accent-fg' : 'bg-surface-hover text-secondary'}`}>2</div>
        </div>

        <div className="bg-surface rounded-lg border border-subtle p-8">
          {/* Debug info (Hidden in UI) */}

          {error && (
            <div className="mb-5 p-4 bg-danger/10 border border-danger/30 rounded-lg text-danger text-sm">{error}</div>
          )}

          {step === 'auth' && (
            <div className="space-y-4">
              <p className="text-sm text-secondary text-center mb-6">Create your account to get started</p>

              <button
                onClick={handleSignIn}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-subtle rounded-lg hover:border-strong hover:bg-surface-hover transition font-medium text-secondary"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>

              <button
                onClick={handleSignIn}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-inverse hover:bg-inverse/90 text-inverse-fg rounded-lg transition font-medium"
              >
                Continue with Email
              </button>
              <p className="text-center text-xs text-tertiary">Powered by Privy</p>
            </div>
          )}

          {step === 'company' && (
            <form onSubmit={handleCompanySubmit} className="space-y-5">
              <div className="p-3 bg-success/10 rounded-lg text-center text-sm text-success">
                ✅ Signed in as <strong>{user?.email?.address ?? user?.google?.email ?? 'your account'}</strong>
              </div>

              <div>
                <label className="block text-sm font-medium text-secondary mb-2">Company Name</label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary" />
                  <input
                    type="text"
                    className="w-full pl-10 pr-4 py-3 border border-subtle rounded-lg shadow-sm focus:ring-2 focus:ring-accent/30 focus:border-transparent outline-none"
                    placeholder="Acme Corporation"
                    value={formData.companyName}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-secondary mb-2">Subdomain</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-tertiary" />
                  <input
                    type="text"
                    className="w-full pl-10 pr-4 py-3 border border-subtle rounded-lg shadow-sm focus:ring-2 focus:ring-accent/30 focus:border-transparent outline-none"
                    placeholder="acme"
                    value={formData.subdomain}
                    onChange={(e) => handleSubdomainChange(e.target.value)}
                    required
                    minLength={3}
                  />
                </div>
                <p className="mt-2 text-sm text-secondary">
                  Portal: <span className="font-medium">{formData.subdomain || 'your-company'}.runbutter.app</span>
                </p>
                {formData.subdomain && subdomainAvailable !== null && (
                  <p className={`mt-1 text-sm ${subdomainAvailable ? 'text-success' : 'text-danger'}`}>
                    {subdomainAvailable ? '✓ Available' : '✗ Already taken'}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting || !subdomainAvailable}
                className="w-full py-3 bg-inverse hover:bg-inverse/90 text-inverse-fg font-semibold rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {submitting ? <><Loader2 className="w-5 h-5 animate-spin" /> Creating...</> : 'Launch My Dashboard →'}
              </button>

              <button
                type="button"
                onClick={logout}
                className="w-full text-sm text-tertiary hover:text-secondary transition"
              >
                Use a different account
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-secondary mt-6">
          Already have an account?{' '}
          <Link href="/auth/login" className="text-accent hover:text-accent font-semibold">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
