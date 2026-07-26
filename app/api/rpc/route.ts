import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyPrivyToken } from '@/lib/auth/privy-verify';
import { rateLimit, clientIp, tooMany } from '@/lib/security/http';

// Authenticated RPC proxy.
//
// WHY: the app used to call Supabase RPCs straight from the browser, passing
// p_privy / p_privy_user_id as a plain argument. With the anon key public,
// anyone could invoke those functions with someone else's Privy DID and read
// that tenant's data. This route closes the hole: the caller's identity is
// taken from the SIGNED Privy token (lib/auth/privy-verify), and whatever
// identity argument the client sent is overwritten before the call — the
// client's value is never trusted. Pair with migration 0040, which revokes
// anon EXECUTE on these functions so the browser path stops working entirely.
//
// Degraded mode mirrors authorizePrivy: if Privy's JWKS is unreachable we log
// and pass the claimed identity through, so an auth.privy.io outage does not
// take the whole product down with it.

const IDENTITY_ARGS = ['p_privy', 'p_privy_user_id'] as const;

// Every function callable through the proxy. Anything not listed is rejected,
// so a leaked function name in the schema is not automatically reachable.
const ALLOWED = new Set([
  // workspace / CRM core
  'get_my_workspace', 'list_my_workspaces', 'set_active_workspace',
  'list_records', 'get_record', 'create_record', 'update_record',
  'delete_record', 'import_records', 'get_pipeline_by_kind', 'move_pipeline_record',
  'get_finance_summary', 'get_finance_analytics', 'get_project', 'get_roadmap',
  'get_members', 'set_member_role', 'remove_member', 'get_invoice_document', 'save_invoice_items',
  'convert_offer_to_invoice', 'get_transactions_ledger', 'create_bank_account',
  'get_bank_accounts', 'delete_bank_account', 'reconcile_transaction',
  'suggest_transaction_matches', 'update_transactions_bulk', 'get_workspace_branding',
  'save_workspace_branding', 'get_nav_activity', 'get_treasury_dataset',
  // marketing sites
  'create_site', 'delete_site', 'get_sites', 'get_site_stats', 'get_posts', 'get_post',
  'save_post', 'add_post_comment', 'set_post_comment_resolved',
  // automations + integrations
  'get_automations', 'get_automation_by_id', 'save_automation', 'delete_automation',
  'set_automation_enabled', 'get_automation_runs', 'get_event_automations',
  'get_connections', 'get_connection', 'save_connection', 'delete_connection',
  'create_api_key', 'get_api_keys', 'revoke_api_key', 'get_webhook_endpoints',
  'upsert_webhook_endpoint', 'delete_webhook_endpoint', 'get_webhook_deliveries',
  // docs + AI providers
  'get_docs', 'get_doc', 'save_doc', 'delete_doc', 'get_ai_providers',
  'store_ai_provider', 'delete_ai_provider', 'set_ai_provider_meta',
  // HR / ATS
  'get_message_templates', 'upsert_message_template', 'delete_message_template',
  'get_tracking_links', 'get_source_attribution', 'create_tracking_link',
  'get_my_team', 'get_onboarding_tasks', 'set_onboarding_task', 'record_pulse',
  'get_candidates_for_recruiter', 'search_candidates_for_recruiter',
  'get_candidate_details', 'get_pipeline_board', 'log_candidate_message',
  // HR crown-jewel table access (0041) — recruiter side, verified proxy only
  'hr_overview_data', 'hr_analytics_data', 'hr_candidate_activity',
  'hr_update_candidate_status', 'hr_seed_demo_result', 'hr_google_connected',
  // HR management: browser-reachable reads + candidate add/delete (0044).
  // Interview schedule/edit/cancel run through /api/hr/interviews (0045), not
  // here, because they orchestrate Google Meet + the candidate email server-side.
  'hr_list_interviews', 'hr_create_candidate', 'hr_delete_candidate', 'hr_list_positions_min',
  // Agents (0043)
  'get_agents', 'save_agent', 'set_agent_enabled', 'delete_agent', 'get_agent_runs',
  // Scheduled reports (0052)
  'get_report_schedules', 'save_report_schedule', 'delete_report_schedule',
  // E-signatures (0053) — browser reads; create/sign run server-side in /api/sign/*
  'get_sign_documents', 'void_sign_document',
  // Custom Forms (0054) — owner side; public get_public_form/submit_form are anon/server
  'get_forms', 'get_form', 'save_form', 'delete_form', 'get_form_submissions',
  // URL shortener (0055) — owner side; register_short_click is anon/redirect route
  'get_short_links', 'create_short_link', 'delete_short_link',
  // Cal.com connector (0056) — owner side; webhook route uses cal_resolve/cal_log server-side
  'get_cal_connection', 'save_cal_connection', 'get_meetings',
  // Chat assistant (0057) — owner side; save via /api/assistant/save, webhooks server-side
  'get_assistant_channels', 'delete_assistant_channel',
  // Sanctions screening (0058) — screen_sanctions writes an audit row, so it is
  // deliberately not named get_*: lib/rpc must never serve it from cache.
  // The list refresh runs service-side in /api/sanctions/refresh.
  'screen_sanctions', 'get_sanctions_status', 'get_sanctions_screenings',
]);

function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('rpc proxy: SUPABASE_SERVICE_ROLE_KEY missing — falling back to anon key (breaks once 0040 revokes anon)');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  // Abuse ceiling, not a quota — an active dashboard fires bursts of a few
  // dozen calls per page, so 300/min per IP is far above legitimate use.
  const rl = rateLimit(`rpc:${clientIp(req)}`, 300);
  if (!rl.ok) return tooMany(rl.retryAfterS);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ data: null, error: { message: 'Invalid JSON body' } }, { status: 400 });
  }

  const fn = typeof body?.fn === 'string' ? body.fn : '';
  const args = body?.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};
  if (!ALLOWED.has(fn)) {
    return NextResponse.json({ data: null, error: { message: `Function not allowed: ${fn}` } }, { status: 403 });
  }

  const v = await verifyPrivyToken(req);
  if (v.status === 'invalid') {
    return NextResponse.json({ data: null, error: { message: 'Your session is invalid or expired. Sign in again.' } }, { status: 401 });
  }
  if (v.status === 'verified') {
    for (const k of IDENTITY_ARGS) if (k in args) args[k] = v.userId;
  } else {
    // JWKS unreachable — same availability-over-strictness call as authorizePrivy.
    console.warn('rpc proxy degraded (JWKS unreachable): passing claimed identity through');
  }

  const { data, error } = await db().rpc(fn, args);
  return NextResponse.json({
    data: data ?? null,
    error: error ? { message: error.message, code: (error as any).code ?? null, details: (error as any).details ?? null } : null,
  });
}
