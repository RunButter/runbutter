import { NextResponse } from 'next/server';
import { handleOAuthCallback } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'runbutter.app';
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    const baseUrl = `${protocol}://${host}`;

    try {
        const { searchParams } = new URL(request.url);
        const code = searchParams.get('code');
        const state = searchParams.get('state'); // Contains injected { userId, companyId }
        const errorParam = searchParams.get('error');

        // Target redirect destination
        const settingsUrl = new URL('/dashboard/settings', baseUrl);

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
        const redirectUri = `${baseUrl}/api/auth/google/callback`;
        
        await handleOAuthCallback(code, state, redirectUri);

        // Success redirect back to Settings page
        settingsUrl.searchParams.set('success', 'google_connected');
        return NextResponse.redirect(settingsUrl);
    } catch (error: any) {
        console.error('Google Callback Route Error:', error);
        const fallbackUrl = new URL('/dashboard/settings', baseUrl);
        fallbackUrl.searchParams.set('error', 'google_auth_exception');
        return NextResponse.redirect(fallbackUrl);
    }
}
