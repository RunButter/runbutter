'use client';

import { PrivyProvider } from '@privy-io/react-auth';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId="cmlqpi7i600630cjlgazh281n"
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
