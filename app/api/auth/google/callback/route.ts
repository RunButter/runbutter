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

        // Process the token exchange and save to database
        const redirectUri = `${baseUrl}/api/auth/google/callback`;

        await handleOAuthCallback(code, state, redirectUri);

        // Success redirect back to Integrations
        settingsUrl.searchParams.set('google', 'connected');
        return NextResponse.redirect(settingsUrl);
    } catch (error: any) {
        console.error('Google Callback Route Error:', error);
        const fallbackUrl = new URL('/settings/integrations', baseUrl);
        fallbackUrl.searchParams.set('google', 'error');
        return NextResponse.redirect(fallbackUrl);
    }
}
