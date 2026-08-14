'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { PrivyProvider } from '@privy-io/react-auth';
import DialogProvider from '@/components/ui/Dialog';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * ── PRIVY IS NOT LOADED ON PUBLIC PAGES ─────────────────────────────────────
 *
 * It used to be, because this provider sits in the root layout and the root
 * layout wraps the marketing site too. Lighthouse put the cost at **679 ms of
 * CPU** on the landing page — 579 ms of it just evaluating scripts — plus
 * ~370 KB of Privy JS, a 161 KB walletconnect wallet directory and a 99 KB
 * Cloudflare Turnstile challenge, all fetched so somebody could read the
 * pricing table. Total Blocking Time was 900 ms, and TBT is worth 30 of the
 * 100 performance points; every other metric on that page was already green.
 *
 * The import stays STATIC and only the mount is skipped, which is the
 * important half: the auth iframe, the walletconnect directory and the
 * Turnstile challenge are all fetched when the provider MOUNTS, not when the
 * module is imported. A `dynamic(..., { ssr: false })` provider would also drop
 * the bundle, and was tried — but a provider wraps the whole app, so a lazily
 * loaded one renders nothing until its chunk arrives: every app page server
 * renders empty and shows a white screen, and a chunk that 404s takes the
 * product down. Not worth the remaining kilobytes.
 *
 * THE LIST IS OF PUBLIC PREFIXES, NOT PRIVATE ONES, and that direction is
 * deliberate. A route missing from here loads Privy and is merely slower; a
 * route wrongly listed here cannot sign in. When this is wrong it should be
 * wrong in the direction that still works.
 */
const PUBLIC_PREFIXES = [
  '/ai-agents', '/plugins', '/terms', '/privacy', '/cookies', '/contact',
  '/developers', '/careers', '/apply', '/forms', '/l/', '/pdf-tools',
  // TRAILING SLASH IS LOAD-BEARING. isPublicPath ends with a bare startsWith(p),
  // so '/i' would also match '/insights' — the signed-in screen — and stop Privy
  // mounting on it. '/l/' carries one for the same reason.
  '/i/', '/r/',
];

/** Public pages render without the auth SDK; everything else gets it. */
function isPublicPath(path: string | null): boolean {
  if (!path) return false;
  if (path === '/') return true;
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`) || path.startsWith(p));
}

// Belt-and-braces theme sync. The inline no-flash script in layout.tsx handles
// the first paint, but it doesn't always execute (statically prerendered routes
// can end up with the <head> script never running), which left a saved dark
// preference rendering light on some pages. This re-asserts the class on mount
// for every route; it's a no-op when the script already did its job.
//
// Returns the resolved preference so the Privy modal can match it — that modal
// renders in its own tree and can't inherit our tokens, so it was stuck light
// on top of a dark app.
function useThemeSync() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('hb-theme');
      const isDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark', isDark);
      setDark(isDark);
    } catch { /* storage blocked — leave whatever the script decided */ }
  }, []);
  return dark;
}

// Public identifier (not a secret) — each deployment sets its own Privy app id.
// dashboard.privy.io → your app → App ID. See .env.example.
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

export default function Providers({ children }: { children: React.ReactNode }) {
  const dark = useThemeSync();
  const pathname = usePathname();

  // DialogProvider wraps everything (incl. public pages) so useDialog() works
  // anywhere without falling back to browser confirm/alert. TooltipProvider sits
  // alongside it so any <Tooltip> works app-wide without a local provider.
  const tree = (
    <TooltipProvider delayDuration={300} skipDelayDuration={200}>
      <DialogProvider>{children}</DialogProvider>
    </TooltipProvider>
  );

  // Self-host guard: without a Privy app the auth SDK can't init. Public pages
  // (the marketing site) still render; only sign-in needs this configured.
  if (!PRIVY_APP_ID) return tree;
  // Nothing on a public page calls usePrivy — checked across every marketing
  // route and component before this landed, because a component that does would
  // throw rather than degrade.
  if (isPublicPath(pathname)) return tree;

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'google'],
        appearance: {
          theme: dark ? 'dark' : 'light',
          // Concrete hex because Privy renders outside our token tree. Keep in
          // step with --accent in globals.css (hsl(234 58% 54%)).
          accentColor: '#4653CE',
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
