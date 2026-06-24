import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
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

  if (isPublicRoute || isApplyRoute || isApiRoute) {
    return res;
  }

  // Authed surfaces: legacy ATS dashboard + the new platform (CRM / HRIS).
  const authedPrefixes = ['/dashboard', '/home', '/objects', '/pipelines', '/projects', '/talent', '/hris', '/finance', '/settings'];
  const needsAuth = authedPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
  if (needsAuth && !isAuthenticated) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/auth/login';
    redirectUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
