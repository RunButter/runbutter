import './globals.css';
import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'hirebtr.com | The open company OS',
  description: 'Run sales, finance, marketing, projects, and people in one clean workspace. Built on Postgres. No AI token bill.',
  icons: {
    icon: 'data:image/svg+xml,%3Csvg width="32" height="32" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg"%3E%3Cg fill="%234F46E5"%3E%3Crect x="10" y="10" width="20" height="20" /%3E%3Crect x="30" y="20" width="20" height="20" /%3E%3Crect x="50" y="30" width="20" height="20" /%3E%3Crect x="70" y="40" width="20" height="20" /%3E%3Crect x="50" y="50" width="20" height="20" /%3E%3Crect x="30" y="60" width="20" height="20" /%3E%3Crect x="10" y="70" width="20" height="20" /%3E%3C/g%3E%3C/svg%3E',
    shortcut: '/favicon.ico',
    apple: '/favicon.ico',
  },
};

// Set the theme class before first paint so there is no light/dark flash.
// Honors a saved choice (hb-theme), else the OS preference.
const NO_FLASH = `(function(){try{var t=localStorage.getItem('hb-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body className="font-sans" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
