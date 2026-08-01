import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Hostnames that are the product itself, never a tenant. Kept in sync with
// careers_slug_reserved() in migration 0060 — that function is the enforcement
// point (nobody can claim these slugs); this list is the routing counterpart.
const APP_HOSTS = new Set(['www', 'app', 'api', 'admin', 'staging', 'dev', 'preview', 'runbutter', 'hirebtr']);

/**
 * Tenant subdomain → careers page.
 *
 * acme.runbutter.app  →  /careers/acme, rewritten (not redirected) so the
 * branded hostname stays in the address bar.
 *
 * This is inert until wildcard DNS (*.runbutter.app) and a wildcard certificate
 * are pointed at the app — until then nothing resolves here and every careers
 * page is served from the /careers/<slug> path, which works today. Shipping the
 * rewrite now means turning subdomains on is a DNS change, not a deploy.
 *
 * ROOT_DOMAIN must be set for this to activate; without it a Host header could
 * not be split reliably (preview URLs, localhost:3000, Render's *.onrender.com).
 */
function careersSubdomain(req: NextRequest): string | null {
  const root = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
  if (!root) return null;
  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0];
  if (!host.endsWith(`.${root}`)) return null;

  const label = host.slice(0, -(root.length + 1));
  // Only a single label — "a.b.runbutter.app" is not a tenant, and treating it
  // as one would let a nested host shadow a real page.
  if (!label || label.includes('.') || APP_HOSTS.has(label)) return null;
  if (!/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/.test(label)) return null;
  return label;
}

export async function middleware(req: NextRequest) {
  const tenant = careersSubdomain(req);
  if (tenant) {
    const url = req.nextUrl.clone();
    // Only the site root maps to the careers index; /apply/... and assets must
    // keep working on the tenant host, so leave every other path alone.
    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = `/careers/${tenant}`;
      return NextResponse.rewrite(url);
    }
  }

  let res = NextResponse.next({
    request: {
      headers: req.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          req.cookies.set({ name, value, ...options });
          res = NextResponse.next({ request: { headers: req.headers } });
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          req.cookies.set({ name, value: '', ...options });
          res = NextResponse.next({ request: { headers: req.headers } });
          res.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  // For Privy, we check for the 'privy-token' cookie which is set after login
  const privyToken = req.cookies.get('privy-token')?.value;
  const privySession = req.cookies.get('privy-session')?.value;

  const isAuthenticated = !!(privyToken || privySession);

  const { pathname } = req.nextUrl;

  const publicRoutes = [
    '/',
    '/auth/login',
    '/auth/register',
    '/auth/forgot-password',
    '/pricing',
    '/about',
    '/contact',
  ];

  const isPublicRoute = publicRoutes.some((route) => pathname === route || pathname.startsWith(route + '/'));
  const isApplyRoute = pathname.startsWith('/apply');
  const isApiRoute = pathname.startsWith('/api');
  // Careers pages are public by definition — they exist to be indexed and
  // linked from job boards, so they must never hit the auth gate.
  const isCareersRoute = pathname.startsWith('/careers');

  if (isPublicRoute || isApplyRoute || isApiRoute || isCareersRoute) {
    return res;
  }

  // Authed surfaces: legacy ATS dashboard + the new platform (CRM / HRIS).
  const authedPrefixes = ['/dashboard', '/home', '/objects', '/pipelines', '/projects', '/talent', '/hris', '/finance', '/marketing', '/settings', '/docs'];
  const needsAuth = authedPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (needsAuth && !isAuthenticated) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/auth/login';
    redirectUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Bare /dashboard is an OLD post-login landing from when this was only an
  // ATS. It now goes to the company OS home; recruiting is one module, reached
  // from the nav, and opening the whole product on it made every non-recruiter
  // think they were in the wrong app. Deep ATS links (/dashboard/overview,
  // /dashboard/candidates, …) are untouched.
  // Done in middleware so it fires before the client dashboard layout's auth
  // gate, which would otherwise swallow a page-level redirect.
  if (pathname === '/dashboard') {
    const url = req.nextUrl.clone();
    url.pathname = '/home';
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
