'use client';

import { PrivyProvider } from '@privy-io/react-auth';

// Public identifier (not a secret) — each deployment sets its own Privy app id.
// dashboard.privy.io → your app → App ID. See .env.example.
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

export default function Providers({ children }: { children: React.ReactNode }) {
  // Self-host guard: without a Privy app the auth SDK can't init. Public pages
  // (the marketing site) still render; only sign-in needs this configured.
  if (!PRIVY_APP_ID) {
    return <>{children}</>;
  }
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
      {children}
    </PrivyProvider>
  );
}
