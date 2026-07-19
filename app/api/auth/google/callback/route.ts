import { NextResponse } from 'next/server';
import { handleOAuthCallback } from '@/lib/google-calendar';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { createAdminClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'runbutter.app';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const baseUrl = `${protocol}://${host}`;

    try {
        const { searchParams } = new URL(request.url);
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        const errorParam = searchParams.get('error');

        // Land back on the Integrations page (Automate → Integrations in the nav).
        const settingsUrl = new URL('/settings/integrations', baseUrl);

        if (errorParam) {
            console.error('Google OAuth Error from callback:', errorParam);
            settingsUrl.searchParams.set('google', 'error');
            return NextResponse.redirect(settingsUrl);
        }

        if (!code || !state) {
            settingsUrl.searchParams.set('google', 'error');
            return NextResponse.redirect(settingsUrl);
        }

        // CSRF check: `state` must equal the nonce we set when starting the flow.
        // Without this, anyone could replay a consent code they obtained with
        // their own Google account and have it bound to another user's workspace.
        const expected = request.headers.get('cookie')?.match(/(?:^|;\s*)g_oauth_state=([^;]+)/)?.[1];
        if (!expected || expected !== state) {
            settingsUrl.searchParams.set('google', 'error');
            return NextResponse.redirect(settingsUrl);
        }

        // Identity comes from the signed Privy session on THIS request, never
        // from anything Google echoed back to us.
        const v = await verifyPrivyToken(request);
        if (v.status !== 'verified') {
            const login = new URL('/auth/login', baseUrl);
            login.searchParams.set('redirectTo', '/settings/integrations');
            return NextResponse.redirect(login);
        }

        const admin = createAdminClient();
        const { data: cu } = await admin
            .from('company_users')
            .select('company_id')
            .eq('privy_user_id', v.userId)
            .limit(1)
            .maybeSingle();
        if (!cu?.company_id) {
            settingsUrl.searchParams.set('google', 'nocompany');
            return NextResponse.redirect(settingsUrl);
        }

        // Process the token exchange and save to database
        const redirectUri = `${baseUrl}/api/auth/google/callback`;

        await handleOAuthCallback(code, v.userId, cu.company_id, redirectUri);

        // Success redirect back to Integrations; burn the one-time nonce.
        settingsUrl.searchParams.set('google', 'connected');
        const done = NextResponse.redirect(settingsUrl);
        done.cookies.set('g_oauth_state', '', { path: '/api/auth/google', maxAge: 0 });
        return done;
    } catch (error: any) {
        console.error('Google Callback Route Error:', error);
        const fallbackUrl = new URL('/settings/integrations', baseUrl);
        fallbackUrl.searchParams.set('google', 'error');
        return NextResponse.redirect(fallbackUrl);
    }
}
