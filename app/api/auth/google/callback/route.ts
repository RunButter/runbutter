import { NextResponse } from 'next/server';
import { handleOAuthCallback } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const code = searchParams.get('code');
        const state = searchParams.get('state'); // Contains injected { userId, companyId }
        const errorParam = searchParams.get('error');

        // Target redirect destination
        const settingsUrl = new URL('/dashboard/settings', request.url);

        if (errorParam) {
            console.error('Google OAuth Error from callback:', errorParam);
            settingsUrl.searchParams.set('error', 'google_auth_failed');
            return NextResponse.redirect(settingsUrl);
        }

        if (!code || !state) {
            settingsUrl.searchParams.set('error', 'missing_oauth_params');
            return NextResponse.redirect(settingsUrl);
        }

        // Process the token exchange and save to database
        const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'hirebtr.com';
        const protocol = request.headers.get('x-forwarded-proto') || 'https';
        const redirectUri = `${protocol}://${host}/api/auth/google/callback`;
        
        await handleOAuthCallback(code, state, redirectUri);

        // Success redirect back to Settings page
        settingsUrl.searchParams.set('success', 'google_connected');
        return NextResponse.redirect(settingsUrl);
    } catch (error: any) {
        console.error('Google Callback Route Error:', error);
        const fallbackUrl = new URL('/dashboard/settings', request.url);
        fallbackUrl.searchParams.set('error', 'google_auth_exception');
        return NextResponse.redirect(fallbackUrl);
    }
}
