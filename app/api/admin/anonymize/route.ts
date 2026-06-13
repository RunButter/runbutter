import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/anonymize
 * Header: x-cron-secret: <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Runs the GDPR/RODO anonymization routine for ALL companies (scrubs PII +
 * raw resume text from candidates past each company's retention window).
 * Use this as a scheduled job (e.g. a Render Cron Job hitting this URL) when
 * pg_cron isn't enabled on your Supabase project. Returns rows affected.
 */
export async function POST(req: Request) {
    const secret = req.headers.get('x-cron-secret');
    const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!expected || secret !== expected) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const admin = createAdminClient();
        const { data, error } = await admin.rpc('anonymize_expired_candidates');
        if (error) throw error;
        return NextResponse.json({ ok: true, anonymized: data ?? 0 });
    } catch (error: any) {
        console.error('anonymize route error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
