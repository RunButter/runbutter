import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getAuthUrl } from '@/lib/google-calendar';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { createAdminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// Starts the Google Calendar OAuth flow. Identity comes from the signed Privy
// token (privy-token cookie on this top-level navigation) — not from query
// params, which the caller could forge to bind a calendar to someone else's
// company. Legacy ?userId/?companyId are honoured ONLY in the degraded case
// where Privy's JWKS is unreachable, mirroring the rest of our auth policy.
export async function GET(request: Request) {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'runbutter.app';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const baseUrl = `${protocol}://${host}`;
    const back = (reason: string) => {
        const u = new URL('/settings/integrations', baseUrl);
        u.searchParams.set('google', reason);
        return NextResponse.redirect(u);
    };

    try {
        const { searchParams } = new URL(request.url);
        const v = await verifyPrivyToken(request);

        let userId = '';
        if (v.status === 'verified') userId = v.userId;
        else if (v.status === 'unavailable') userId = searchParams.get('userId') || ''; // JWKS down → degrade
        // 'invalid' → no identity → bounce to login
        if (!userId) {
            const login = new URL('/auth/login', baseUrl);
            login.searchParams.set('redirectTo', '/settings/integrations');
            return NextResponse.redirect(login);
        }

        // Calendar tokens are keyed to the user's HR company; resolve it server-side.
        const admin = createAdminClient();
        const { data: cu } = await admin
            .from('company_users')
            .select('company_id')
            .eq('privy_user_id', userId)
            .order('created_at', { ascending: true })   // deterministic: no ORDER BY = arbitrary company
            .limit(1)
            .maybeSingle();
        const companyId = cu?.company_id || searchParams.get('companyId') || '';
        if (!companyId) return back('nocompany');

        // Single-use CSRF nonce: it goes to Google as `state` and into an
        // httpOnly cookie. The callback only proceeds if the two match, which
        // stops a forged callback from binding someone else's Google account.
        const nonce = randomBytes(16).toString('hex');
        const redirectUri = `${baseUrl}/api/auth/google/callback`;
        const authUrl = await getAuthUrl(nonce, redirectUri);

        const res = NextResponse.redirect(authUrl);
        res.cookies.set('g_oauth_state', nonce, {
            httpOnly: true,
            secure: protocol === 'https',
            sameSite: 'lax', // sent on Google's top-level redirect back to us
            path: '/api/auth/google',
            maxAge: 600,
        });
        return res;
    } catch (error: any) {
        console.error('Google Auth Route Error:', error);
        return back('error');
    }
}
