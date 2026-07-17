import './globals.css';
import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import Providers from './providers';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://runbutter.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'RunButter | The open company OS',
  description: 'Run sales, finance, marketing, projects, and people in one clean workspace. Open source, built on Postgres, no AI token bill.',
  applicationName: 'RunButter',
  // app/icon.svg (Next convention) serves the SVG favicon; here we add the
  // .ico for legacy browsers and the apple-touch icon.
  icons: {
    icon: [{ url: '/favicon.ico', sizes: 'any' }],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'RunButter',
    title: 'RunButter | The open company OS',
    description: 'Run your whole company in one clean workspace. Open source, no AI token bill.',
    images: ['/logo.png'],
  },
  twitter: {
    card: 'summary',
    title: 'RunButter | The open company OS',
    description: 'Run your whole company in one clean workspace. Open source, no AI token bill.',
    images: ['/logo.png'],
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
