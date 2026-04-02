import { NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/google-calendar';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');
        const companyId = searchParams.get('companyId');

        if (!userId || !companyId) {
            return NextResponse.json({ error: 'Missing userId or companyId' }, { status: 400 });
        }

        // Detect the public-facing URL behind proxies like Render
        const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'hirebtr.com';
        const protocol = request.headers.get('x-forwarded-proto') || 'https';
        const redirectUri = `${protocol}://${host}/api/auth/google/callback`;
        
        const authUrl = await getAuthUrl(userId, companyId, redirectUri);
        
        // Redirect the user to Google's OAuth consent screen
        return NextResponse.redirect(authUrl);
    } catch (error: any) {
        console.error('Google Auth Route Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
