import { NextResponse } from 'next/server';
import { createCalendarEvent } from '@/lib/google-calendar';
import { createAdminClient } from '@/lib/supabase';

export async function POST(req: Request) {
    try {
        const { candidateId, privyUserId, startTime, durationMinutes } = await req.json();

        if (!candidateId || !privyUserId || !startTime) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const supabase = createAdminClient();

        // 1. Get candidate details to invite them
        const { data: candidate, error: canErr } = await supabase
            .from('candidates')
            .select('email, full_name, company_id')
            .eq('id', candidateId)
            .single();

        if (canErr || !candidate) {
            return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
        }

        // 2. Check if company is Pro
        const { data: company } = await supabase
            .from('companies')
            .select('plan')
            .eq('id', candidate.company_id)
            .single();

        if (company?.plan === 'free') {
            return NextResponse.json({ error: 'Scheduling requires a Pro plan' }, { status: 403 });
        }

        // 3. Create Event Data
        const startDate = new Date(startTime);
        const endDate = new Date(startDate.getTime() + (durationMinutes || 30) * 60000);

        const event = {
            summary: `Interview: ${candidate.full_name}`,
            description: `Automated interview scheduled via TalentInsight.\nCandidate: ${candidate.full_name}\nRole: Candidate Assessment Review`,
            start: startDate.toISOString(),
            end: endDate.toISOString(),
            attendees: [candidate.email],
            conferenceData: true
        };

        const result = await createCalendarEvent(privyUserId, event);

        if (!result) {
            return NextResponse.json({ error: 'Failed to create Google Calendar event. Ensure your Google integration is connected in Settings.' }, { status: 500 });
        }

        // 4. Update Candidate Status and Log
        await supabase
            .from('candidates')
            .update({ status: 'interview_scheduled' })
            .eq('id', candidateId);

        await supabase.from('activity_log').insert({
            company_id: candidate.company_id,
            candidate_id: candidateId,
            action: 'status_updated',
            details: { old_status: 'assessment_completed', new_status: 'interview_scheduled', meetLink: result.meetLink }
        });

        return NextResponse.json({ success: true, ...result });
    } catch (error: any) {
        console.error('Schedule API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
