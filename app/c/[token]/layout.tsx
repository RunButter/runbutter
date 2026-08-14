import type { Metadata } from 'next';

// Somebody's invoices. Unguessable is not secret, and it must never be indexed.
export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false, nocache: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
