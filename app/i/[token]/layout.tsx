import type { Metadata } from 'next';

// A shared chart is somebody's revenue by client. It is unguessable, not
// secret, and it must never appear in a search index.
export const metadata: Metadata = {
  title: 'Shared report',
  robots: { index: false, follow: false, nocache: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
