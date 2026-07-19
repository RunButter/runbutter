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
  // Link previews point at a static public/og.png (1200x630). Generating the
  // card via app/opengraph-image.tsx was tried and reverted: Next 14's bundled
  // @vercel/og cannot load its default font on Windows (it builds an invalid
  // `.\file:\C:\...ttf` URL), so the route 500s locally and could not be
  // verified before deploy — not a risk worth taking on the one asset every
  // shared link renders.
  //
  // og.png replaced logo.png, a 4000x4000 square that scrapers cropped to an
  // unreadable centre. metadataBase above makes these absolute, which Slack
  // and LinkedIn require.
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'RunButter',
    title: 'RunButter | The open company OS',
    description: 'Run your whole company in one clean workspace. Open source, no AI token bill.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'RunButter — your whole company, one clean workspace' }],
  },
  twitter: {
    // summary_large_image = the wide banner card. Plain 'summary' renders a
    // small square thumbnail no matter how good the image is.
    card: 'summary_large_image',
    title: 'RunButter | The open company OS',
    description: 'Run your whole company in one clean workspace. Open source, no AI token bill.',
    images: [{ url: '/og.png', alt: 'RunButter — your whole company, one clean workspace' }],
  },
};

// Set the theme class before first paint so there is no light/dark flash.
// Honors a saved choice (hb-theme), else the OS preference.
const NO_FLASH = `(function(){try{var t=localStorage.getItem('hb-theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`;

// Font vars live on <body>, NOT <html>: the no-flash script adds the `dark`
// class to <html>, and if React also manages that element's className it
// reconciles on hydration and strips `dark` — a saved dark preference then
// rendered light. Keeping <html> free of React-owned attributes avoids that.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans`} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
