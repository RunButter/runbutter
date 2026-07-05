import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/automations/dispatch
 * Header: x-cron-secret: <SUPABASE_SERVICE_ROLE_KEY>
 *
 * Drains the automation_events outbox: for each pending event, finds the
 * matching enabled rules and runs their actions (fire webhook, send email,
 * create/update a record). Point pg_cron (via pg_net) or a Render Cron Job at
 * this URL every minute. In-DB actions run as the rule's owner; webhooks/email
 * run here in Node. Best-effort per action — a failing action is logged, the
 * event still completes so it isn't retried forever.
 */
export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret');
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected || secret !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: events, error } = await admin.rpc('claim_automation_events', { p_max: 25 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let processed = 0, actionsRun = 0;
  for (const ev of (events as any[]) || []) {
    try {
      const { data: rules } = await admin.rpc('get_event_automations', { p_workspace: ev.workspace_id, p_object: ev.object, p_event: ev.event });
      for (const rule of (rules as any[]) || []) {
        if (!conditionsPass(rule.conditions || [], ev.payload || {})) continue;
        for (const action of (rule.actions || []) as any[]) {
          const res = await runAction(admin, ev, rule, action);
          actionsRun++;
          await admin.rpc('log_automation_run', {
            p_workspace: ev.workspace_id, p_automation: rule.id, p_name: rule.name,
            p_action: action.type, p_status: res.ok ? 'ok' : 'error', p_detail: res.detail,
          });
        }
      }
      await admin.rpc('complete_automation_event', { p_id: ev.id, p_status: 'done' });
      processed++;
    } catch (e: any) {
      await admin.rpc('complete_automation_event', { p_id: ev.id, p_status: 'error' });
    }
  }
  return NextResponse.json({ ok: true, processed, actionsRun });
}

// ── condition evaluation ──────────────────────────────────────────────────────
function conditionsPass(conds: any[], payload: Record<string, any>): boolean {
  return conds.every((c) => {
    const actual = payload[c.field];
    const val = c.value;
    switch (c.op) {
      case 'eq': return String(actual ?? '') === String(val ?? '');
      case 'neq': return String(actual ?? '') !== String(val ?? '');
      case 'contains': return String(actual ?? '').toLowerCase().includes(String(val ?? '').toLowerCase());
      case 'gt': return Number(actual) > Number(val);
      case 'lt': return Number(actual) < Number(val);
      case 'empty': return actual === null || actual === undefined || actual === '';
      case 'not_empty': return !(actual === null || actual === undefined || actual === '');
      default: return true;
    }
  });
}

// {{field}} → payload value
function tmpl(s: string | undefined, payload: Record<string, any>): string {
  return String(s ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => String(payload[k] ?? ''));
}

// deep-template a data object's string values
function tmplObj(obj: Record<string, any>, payload: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = typeof v === 'string' ? tmpl(v, payload) : v;
  return out;
}

async function runAction(admin: any, ev: any, rule: any, action: any): Promise<{ ok: boolean; detail: string }> {
  try {
    const cfg = action.config || {};
    if (action.type === 'send_webhook') {
      let url: string | null = cfg.url || null;
      if (!url && cfg.connection_id) {
        const { data } = await admin.rpc('get_connection_url', { p_workspace: ev.workspace_id, p_id: cfg.connection_id });
        url = data as string;
      }
      if (!url) return { ok: false, detail: 'No webhook URL / connection' };
      const body = { event: ev.event, object: ev.object, automation: rule.name, record: ev.payload };
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { ok: r.ok, detail: `POST ${r.status} · ${cfg.label || url.slice(0, 40)}` };
    }

    if (action.type === 'send_email') {
      const key = process.env.RESEND_API_KEY;
      if (!key) return { ok: false, detail: 'RESEND_API_KEY not set' };
      const to = tmpl(cfg.to, ev.payload);
      if (!to) return { ok: false, detail: 'No recipient' };
      const from = process.env.RESEND_FROM || 'HireBTR <notifications@hirebtr.com>';
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject: tmpl(cfg.subject || 'Notification from HireBTR', ev.payload), html: tmpl(cfg.body || '', ev.payload).replace(/\n/g, '<br>') }),
      });
      return { ok: r.ok, detail: `Email ${r.status} → ${to}` };
    }

    if (action.type === 'create_record') {
      const { data, error } = await admin.rpc('create_record', { p_privy: rule.owner_privy, p_workspace: ev.workspace_id, p_object: cfg.object, p_data: tmplObj(cfg.data || {}, ev.payload) });
      return error ? { ok: false, detail: error.message } : { ok: true, detail: `Created ${cfg.object} ${data}` };
    }

    if (action.type === 'update_record') {
      const { error } = await admin.rpc('update_record', { p_privy: rule.owner_privy, p_object: ev.object, p_id: ev.record_id, p_data: tmplObj(cfg.data || {}, ev.payload) });
      return error ? { ok: false, detail: error.message } : { ok: true, detail: `Updated ${ev.object}` };
    }

    return { ok: false, detail: `Unknown action ${action.type}` };
  } catch (e: any) {
    return { ok: false, detail: e?.message || 'Action failed' };
  }
}
