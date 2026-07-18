'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import DialogProvider from '@/components/ui/Dialog';

// Public identifier (not a secret) — each deployment sets its own Privy app id.
// dashboard.privy.io → your app → App ID. See .env.example.
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

export default function Providers({ children }: { children: React.ReactNode }) {
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
          theme: 'light',
          accentColor: '#4F46E5',
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
