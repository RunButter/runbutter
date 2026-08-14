import type { Metadata } from 'next';

// A data room is somebody's cap table and payroll. Unguessable is not secret,
// and it must never reach an index.
export const metadata: Metadata = {
  title: 'Shared documents',
  robots: { index: false, follow: false, nocache: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
