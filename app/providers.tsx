'use client';

import { useEffect, useState } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import DialogProvider from '@/components/ui/Dialog';

// Belt-and-braces theme sync. The inline no-flash script in layout.tsx handles
// the first paint, but it doesn't always execute (statically prerendered routes
// can end up with the <head> script never running), which left a saved dark
// preference rendering light on some pages. This re-asserts the class on mount
// for every route; it's a no-op when the script already did its job.
//
// Returns the resolved preference so the Privy modal can match it — that modal
// renders in its own tree and can't inherit our tokens, so it was stuck light
// on top of a dark app.
function useThemeSync() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('hb-theme');
      const isDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark', isDark);
      setDark(isDark);
    } catch { /* storage blocked — leave whatever the script decided */ }
  }, []);
  return dark;
}

// Public identifier (not a secret) — each deployment sets its own Privy app id.
// dashboard.privy.io → your app → App ID. See .env.example.
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

export default function Providers({ children }: { children: React.ReactNode }) {
  const dark = useThemeSync();

  // DialogProvider wraps everything (incl. public pages) so useDialog() works
  // anywhere without falling back to browser confirm/alert.
  const tree = <DialogProvider>{children}</DialogProvider>;

  // Self-host guard: without a Privy app the auth SDK can't init. Public pages
  // (the marketing site) still render; only sign-in needs this configured.
  if (!PRIVY_APP_ID) return tree;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'google'],
        appearance: {
          theme: dark ? 'dark' : 'light',
          // Concrete hex because Privy renders outside our token tree. Keep in
          // step with --accent in globals.css (hsl(234 58% 54%)).
          accentColor: '#4653CE',
          logo: undefined,
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          // createOnLogin removed to fix type error
        },
      }}
    >
      {tree}
    </PrivyProvider>
  );
}
