import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Providers from './providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'hirebtr.com - AI-Powered Recruitment Assessment',
  description: 'Hire better with pixel-perfect candidate assessments, personality tests, and cognitive evaluations',
  icons: {
    icon: 'data:image/svg+xml,%3Csvg width="32" height="32" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"%3E%3Cg fill="%234F46E5"%3E%3Crect x="10" y="10" width="20" height="20" /%3E%3Crect x="30" y="20" width="20" height="20" /%3E%3Crect x="50" y="30" width="20" height="20" /%3E%3Crect x="70" y="40" width="20" height="20" /%3E%3Crect x="50" y="50" width="20" height="20" /%3E%3Crect x="30" y="60" width="20" height="20" /%3E%3Crect x="10" y="70" width="20" height="20" /%3E%3C/g%3E%3C/svg%3E',
    shortcut: '/favicon.ico',
    apple: '/favicon.ico',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
