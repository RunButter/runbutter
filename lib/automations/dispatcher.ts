import { createHmac } from 'crypto';

// Server-side dispatcher core, shared by:
//   /api/automations/dispatch  (cron, secret-authed, the reliable path)
//   /api/automations/tick      (throttled public nudge → instant runs, no cron)
//   /api/hooks/[token]         (small drain right after an inbound trigger)
// Drains automation_events → matches rules → runs actions. Record actions go
// through automation_create/update_record (0035) so their writes can't re-fire
// the triggers (recursion guard). Failing webhook/email events retry with
// backoff; events whose rules mutate records don't retry (no duplicate writes).

const MAX_ATTEMPTS = 5;

export interface DispatchStats { processed: number; actionsRun: number; retried: number }

export async function runDispatcher(admin: any, max = 25): Promise<DispatchStats> {
  await admin.rpc('enqueue_scheduled_automations');

  const { data: events, error } = await admin.rpc('claim_automation_events', { p_max: max });
  if (error) throw new Error(error.message);

  const stats: DispatchStats = { processed: 0, actionsRun: 0, retried: 0 };
  for (const ev of (events as any[]) || []) {
    try {
      const rules = await rulesFor(admin, ev);
      let allOk = true, hasMutation = false;
      for (const rule of rules) {
        if (!conditionsPass(rule.conditions || [], ev.payload || {})) continue;
        for (const action of (rule.actions || []) as any[]) {
          if (action.type === 'create_record' || action.type === 'update_record') hasMutation = true;
          const res = await runAction(admin, ev, rule, action);
          if (!res.ok) allOk = false;
          stats.actionsRun++;
          await admin.rpc('log_automation_run', {
            p_workspace: ev.workspace_id, p_automation: rule.id, p_name: rule.name,
            p_action: action.type, p_status: res.ok ? 'ok' : 'error', p_detail: res.detail,
          });
        }
      }
      if (allOk) {
        await admin.rpc('complete_automation_event', { p_id: ev.id, p_status: 'done' });
      } else if (!hasMutation && ev.attempts < MAX_ATTEMPTS) {
        await admin.rpc('retry_automation_event', { p_id: ev.id, p_backoff_seconds: 60 * ev.attempts, p_err: 'action failed, will retry' });
        stats.retried++;
      } else {
        await admin.rpc('complete_automation_event', { p_id: ev.id, p_status: 'error' });
      }
      stats.processed++;
    } catch (e: any) {
      if (ev.attempts < MAX_ATTEMPTS) { await admin.rpc('retry_automation_event', { p_id: ev.id, p_backoff_seconds: 60 * ev.attempts, p_err: e?.message || 'dispatch error' }); stats.retried++; }
      else await admin.rpc('complete_automation_event', { p_id: ev.id, p_status: 'error' });
    }
  }
  return stats;
}

// Webhook/schedule events target one automation; record events match by object+event.
async function rulesFor(admin: any, ev: any): Promise<any[]> {
  if (ev.automation_id) {
    const { data } = await admin.rpc('get_automation_by_id', { p_id: ev.automation_id });
    return data ? [data] : [];
  }
  const { data } = await admin.rpc('get_event_automations', { p_workspace: ev.workspace_id, p_object: ev.object, p_event: ev.event });
  return (data as any[]) || [];
}

function conditionsPass(conds: any[], payload: Record<string, any>): boolean {
  return conds.every((c) => {
    const actual = payload[c.field]; const val = c.value;
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

function tmpl(s: string | undefined, payload: Record<string, any>): string {
  return String(s ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => String(payload[k] ?? ''));
}
function tmplObj(obj: Record<string, any>, payload: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = typeof v === 'string' ? tmpl(v, payload) : v;
  return out;
}
// Svix-style signature: t=<unix>,v1=<hex hmac of "t.body">
function sign(secret: string, body: string): string {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

async function runAction(admin: any, ev: any, rule: any, action: any): Promise<{ ok: boolean; detail: string }> {
  try {
    const cfg = action.config || {};
    if (action.type === 'send_webhook') {
      let url = cfg.url as string | null, secret: string | null = null, connId: string | null = cfg.connection_id || null, label = cfg.label || '';
      if (!url && connId) {
        const { data } = await admin.rpc('get_connection', { p_workspace: ev.workspace_id, p_id: connId });
        if (data) { url = (data as any).url; secret = (data as any).secret; label = label || (data as any).label; }
      }
      if (!url) return { ok: false, detail: 'No webhook URL / connection' };
      const body = JSON.stringify({ event: ev.event, object: ev.object, automation: rule.name, record: ev.payload });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secret) headers['X-HireBTR-Signature'] = sign(secret, body);
      let code = 0, ok = false, detail = '';
      try { const r = await fetch(url, { method: 'POST', headers, body }); code = r.status; ok = r.ok; detail = `POST ${r.status} · ${label || url.slice(0, 36)}`; }
      catch (e: any) { detail = `POST failed · ${e?.message || 'network'}`; }
      await admin.rpc('log_webhook_delivery', { p_workspace: ev.workspace_id, p_connection: connId, p_automation: rule.id, p_url: url, p_status: ok ? 'ok' : 'failed', p_code: code || null, p_attempts: ev.attempts, p_detail: detail });
      return { ok, detail };
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
      const { data, error } = await admin.rpc('automation_create_record', { p_privy: rule.owner_privy, p_workspace: ev.workspace_id, p_object: cfg.object, p_data: tmplObj(cfg.data || {}, ev.payload) });
      return error ? { ok: false, detail: error.message } : { ok: true, detail: `Created ${cfg.object} ${data}` };
    }

    if (action.type === 'update_record') {
      if (!ev.record_id) return { ok: false, detail: 'No record to update (webhook/schedule trigger)' };
      const { error } = await admin.rpc('automation_update_record', { p_privy: rule.owner_privy, p_object: ev.object, p_id: ev.record_id, p_data: tmplObj(cfg.data || {}, ev.payload) });
      return error ? { ok: false, detail: error.message } : { ok: true, detail: `Updated ${ev.object}` };
    }

    return { ok: false, detail: `Unknown action ${action.type}` };
  } catch (e: any) {
    return { ok: false, detail: e?.message || 'Action failed' };
  }
}
