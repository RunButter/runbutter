'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { Users, Loader2 } from 'lucide-react';
import Logo from '@/components/Logo';

export default function LoginPage() {
  const router = useRouter();
  const { ready, authenticated, login, logout } = usePrivy();

  // If already fully authenticated with a company, go to dashboard
  useEffect(() => {
    if (ready && authenticated) {
      router.push('/dashboard');
    }
  }, [ready, authenticated, router]);

  const handleLogin = async () => {
    try {
      // Clear any stale session first, then open fresh login
      await logout();
      await login();
    } catch {
      // If logout fails (no session), just login directly
      await login();
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
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
          <h1 className="text-2xl font-medium text-primary mb-2">Welcome Back</h1>
          <p className="text-secondary">Sign in to your account</p>
        </div>

        <div className="bg-surface rounded-lg border border-subtle p-8">

          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-subtle rounded-lg hover:border-strong hover:bg-surface-hover transition font-medium text-secondary mb-4"
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
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-inverse hover:bg-inverse/90 text-inverse-fg rounded-lg transition font-medium"
          >
            Continue with Email
          </button>

          <p className="text-center text-xs text-tertiary mt-4">
            Powered by Privy — secure, passwordless login
          </p>
        </div>

        <p className="text-center text-sm text-secondary mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/auth/register" className="text-accent hover:text-accent font-semibold">
            Sign up for free
          </Link>
        </p>
      </div>
    </div>
  );
}
