// Outgoing webhook delivery. Server-only (uses the admin client).
//
// Companies register their own webhook URLs (Slack / Discord incoming webhooks,
// or a generic JSON endpoint for Zapier / Make / n8n). We POST to them on key
// events. No platform API keys, no cost — the URL belongs to the customer.
//
// Everything here is best-effort and must NEVER throw into the caller: a broken
// or slow webhook can't be allowed to break an application or a status update.

import { createAdminClient } from '@/lib/supabase';

export type WebhookEvent = 'application.created' | 'candidate.stage_changed' | 'candidate.hired';

export interface WebhookPayload {
    candidateName?: string;
    position?: string;
    company?: string;
    status?: string;
    candidateUrl?: string;
}

const DELIVERY_TIMEOUT_MS = 5000;

const EVENT_LABEL: Record<WebhookEvent, string> = {
    'application.created': 'New application',
    'candidate.stage_changed': 'Candidate moved',
    'candidate.hired': 'Candidate hired',
};

/** Human-readable one-liner used for Slack/Discord messages. */
function summaryLine(event: WebhookEvent, p: WebhookPayload): string {
    const who = p.candidateName || 'A candidate';
    const role = p.position ? ` for ${p.position}` : '';
    switch (event) {
        case 'application.created':
            return `🎯 New application — ${who}${role}`;
        case 'candidate.hired':
            return `🏆 Hired — ${who}${role}!`;
        case 'candidate.stage_changed':
            return `➡️ ${who} moved to "${p.status || 'a new stage'}"${role}`;
    }
}

/** Build the per-provider request body. */
function bodyFor(type: string, event: WebhookEvent, p: WebhookPayload): Record<string, unknown> {
    const line = summaryLine(event, p);
    const withLink = p.candidateUrl ? `${line}\n${p.candidateUrl}` : line;

    if (type === 'slack') return { text: withLink };
    if (type === 'discord') return { content: withLink };

    // generic (Zapier / Make / n8n / custom) — structured JSON
    return {
        event,
        event_label: EVENT_LABEL[event],
        message: line,
        candidate_name: p.candidateName ?? null,
        position: p.position ?? null,
        company: p.company ?? null,
        status: p.status ?? null,
        candidate_url: p.candidateUrl ?? null,
        timestamp: new Date().toISOString(),
    };
}

/** POST to a single URL with a hard timeout. Returns true on a 2xx response. */
export async function deliverWebhook(type: string, url: string, event: WebhookEvent, payload: WebhookPayload): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyFor(type, event, payload)),
            signal: controller.signal,
        });
        return res.ok;
    } catch (err) {
        console.error('Webhook delivery failed:', url, err);
        return false;
    } finally {
        clearTimeout(timer);
    }
}

/** Deliver an event to every active endpoint a company has subscribed to it. */
export async function dispatchWebhooks(companyId: string, event: WebhookEvent, payload: WebhookPayload): Promise<void> {
    try {
        const admin = createAdminClient();
        const { data: endpoints, error } = await admin
            .from('webhook_endpoints')
            .select('type, url, events, is_active')
            .eq('company_id', companyId)
            .eq('is_active', true);
        if (error) { console.error('dispatchWebhooks load error:', error); return; }
        if (!endpoints?.length) return;

        await Promise.allSettled(
            endpoints
                .filter((e: any) => !Array.isArray(e.events) || e.events.length === 0 || e.events.includes(event))
                .map((e: any) => deliverWebhook(e.type, e.url, event, payload))
        );
    } catch (err) {
        console.error('dispatchWebhooks failed (non-fatal):', err);
    }
}

/** Resolve a candidate's company/role/company-name and dispatch the right event. */
async function resolveAndDispatch(candidateId: string, event: WebhookEvent, status?: string): Promise<void> {
    try {
        const admin = createAdminClient();
        const { data: c } = await admin
            .from('candidates')
            .select('full_name, company_id, position_id')
            .eq('id', candidateId)
            .single();
        if (!c?.company_id) return;

        const [{ data: pos }, { data: comp }] = await Promise.all([
            c.position_id
                ? admin.from('positions').select('title').eq('id', c.position_id).single()
                : Promise.resolve({ data: null as any }),
            admin.from('companies').select('name').eq('id', c.company_id).single(),
        ]);

        const base = process.env.NEXT_PUBLIC_APP_URL || '';
        await dispatchWebhooks(c.company_id, event, {
            candidateName: c.full_name || undefined,
            position: pos?.title || undefined,
            company: comp?.name || undefined,
            status,
            candidateUrl: base ? `${base}/dashboard/candidates/${candidateId}` : undefined,
        });
    } catch (err) {
        console.error('resolveAndDispatch failed (non-fatal):', err);
    }
}

/** Fire on a new application. */
export function notifyNewApplication(candidateId: string): Promise<void> {
    return resolveAndDispatch(candidateId, 'application.created');
}

/** Fire on a pipeline stage change (uses the "hired" event when applicable). */
export function notifyStageChange(candidateId: string, status: string): Promise<void> {
    const event: WebhookEvent = status === 'hired' ? 'candidate.hired' : 'candidate.stage_changed';
    return resolveAndDispatch(candidateId, event, status);
}
