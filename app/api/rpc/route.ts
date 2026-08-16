import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverSupabaseUrl } from '@/lib/supabase';
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
  // Deals (0092). pipeline_records had no create path at all until this — the
  // board could be read and reordered but never filled.
  'create_pipeline_record', 'update_pipeline_record', 'delete_pipeline_record',
  'get_finance_summary', 'get_finance_analytics', 'get_project', 'get_roadmap',
  'get_members', 'set_member_role', 'remove_member', 'get_invoice_document', 'save_invoice_items',
  'convert_offer_to_invoice', 'get_transactions_ledger', 'create_bank_account',
  'get_bank_accounts', 'delete_bank_account', 'reconcile_transaction',
  'suggest_transaction_matches', 'update_transactions_bulk', 'get_workspace_branding',
  'save_workspace_branding', 'get_nav_activity', 'get_treasury_dataset',
  // Renaming a workspace (0093). Re-checks owner/admin in SQL, like every other
  // write that changes what the whole workspace sees.
  'rename_workspace',
  // marketing sites
  'create_site', 'delete_site', 'get_sites', 'get_site_stats', 'get_posts', 'get_post',
  'save_post', 'add_post_comment', 'set_post_comment_resolved',
  // automations + integrations
  'get_automations', 'get_automation_by_id', 'save_automation', 'delete_automation',
  'set_automation_enabled', 'get_automation_runs', 'get_event_automations',
  'get_connections', 'get_connection', 'save_connection', 'delete_connection',
  'create_api_key', 'get_api_keys', 'revoke_api_key', 'get_webhook_endpoints',
  'upsert_webhook_endpoint', 'delete_webhook_endpoint', 'get_webhook_deliveries',
  // Excel sync (0079). The three service_role RPCs — claim_excel_links,
  // record_excel_sync, set_excel_table_name — are deliberately ABSENT: a client
  // that could write last_status could hide a failing sync, and one that could
  // claim links could stall the sweep for everyone.
  'get_ms_connection', 'get_excel_links', 'save_excel_link',
  'set_excel_link_enabled', 'delete_excel_link', 'disconnect_microsoft',
  // docs + AI providers
  'get_docs', 'get_doc', 'save_doc', 'delete_doc',
  // 0086. Missing here since the day it shipped: the card's checkbox called it
  // through the proxy, the proxy refused, and ticking an item just failed.
  'toggle_doc_item',
  'get_ai_providers',
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
  // 0094 — positions read/write. The positions screens used the browser client
  // against `positions` and `companies` until 0077 revoked those grants, which
  // surfaced as "permission denied for table companies" on create and an empty
  // list everywhere else. These are the server-side path they never had.
  'hr_list_positions', 'hr_get_position', 'hr_save_position', 'hr_delete_position',
  'hr_get_assessment', 'hr_save_assessment',
  // 0076 — the browser's replacement for reading company_users directly.
  // ensure_workspace is deliberately ABSENT: it PROVISIONS, so it runs
  // server-side in /api/onboarding/provision behind a verified Privy token.
  'get_my_hr_companies',
  // Agents (0043)
  // get_agent_run (0095) reads ONE run by id and is what the browser polls
  // while a run is in flight. append_agent_run_step is deliberately ABSENT —
  // it is service_role only, because a client that could write steps could
  // forge a transcript of work that never happened.
  'get_agents', 'save_agent', 'set_agent_enabled', 'delete_agent', 'get_agent_runs', 'get_agent_run',
  // Token spend by agent (0096). Aggregated in SQL — the runs list caps at 50,
  // so summing it in the browser would report a month's cost from whatever fit.
  'get_agent_usage', 'get_ai_usage',
  // Model prices (0104). A workspace's negotiated rate, its OpenRouter reality,
  // or zero for a self-hosted model. Writes re-check owner/admin in SQL — a
  // price changes every cost figure everyone else reads.
  'get_model_prices', 'save_model_price', 'delete_model_price',
  // Shared insight snapshots (0109). get_insight_public is deliberately ABSENT:
  // it serves readers with no Privy session, and this proxy rejects a tokenless
  // request, so it has its own route holding the service-role client.
  'publish_insight', 'get_insight_snapshots', 'revoke_insight',
  // Data rooms (0110). The two PUBLIC readers are deliberately absent: they
  // serve people with no Privy session and have their own routes.
  'create_data_room', 'get_data_rooms', 'get_data_room_activity', 'revoke_data_room',
  // Client portals (0111). The two public readers have their own routes.
  'create_client_portal', 'get_client_portals', 'revoke_client_portal',
  // Cap table (0122). simulate_round writes nothing — it is a model, and the
  // separation is the same one /api/workspace/build makes.
  'get_cap_table', 'simulate_round', 'list_cap_holders', 'save_cap_holder',
  'save_cap_security', 'delete_cap_security', 'delete_cap_holder', 'set_option_pool',
  // Multi-currency (0121). get_fx_status is a read; set_base_currency re-checks
  // owner/admin in SQL because a reporting currency changes every figure the
  // whole workspace sees. save_fx_rates is deliberately ABSENT — it is
  // service_role only and belongs to /api/fx/refresh, like claim_excel_links.
  'get_fx_status', 'set_base_currency',
  // Web analytics: sessions, goals and funnels on the built-in pipeline (0120).
  // Every one re-checks site membership through site_readable in SQL, so a site
  // id from another workspace raises NOT_ALLOWED rather than returning a shape.
  'get_site_sessions', 'get_site_realtime', 'get_site_goals', 'get_site_funnel',
  'get_site_config', 'save_site_goal', 'delete_site_goal',
  'save_site_funnel', 'delete_site_funnel',
  // The company calendar (0119). One read that unions six tables; every branch
  // is workspace-scoped in SQL, and the HR half is joined through
  // candidates.company_id because `interviews` has no workspace column.
  'get_calendar',
  // Team vault (0118). Every one of these moves OPAQUE blobs — the server has
  // no key and no title column, so allow-listing them exposes ciphertext and
  // nothing else. reset_vault re-checks owner/admin in SQL.
  'get_vault_meta', 'init_vault', 'list_vault_items', 'save_vault_item',
  'delete_vault_item', 'rotate_vault', 'reset_vault',
  // @-mentions (0113).
  'resolve_record_labels', 'search_mentionable',
  // Finance KPIs (0115) and the cash-forecast facts (0116). Reads only —
  // the forecast arithmetic happens in the browser, so nothing here writes.
  'get_finance_kpis', 'get_cash_forecast_basis',
  // Copilot threads (0102). A thread belongs to a PERSON, and every one of
  // these re-checks that in SQL — a colleague in the same workspace gets
  // NOT_FOUND, not a redacted row. append_copilot_message and
  // get_copilot_history are deliberately ABSENT: they are service_role only,
  // because a client that could write assistant turns could forge a transcript
  // of work that never happened.
  'get_copilot_threads', 'get_copilot_thread', 'create_copilot_thread',
  'set_copilot_thread', 'delete_copilot_thread',
  // Skills (0068) — reusable instruction packs attached to agents.
  'get_skills', 'save_skill', 'delete_skill',
  // Post Studio board (0069) — positions + edges for the content-plan canvas.
  'get_post_board', 'save_post_board',
  // Newsletters (0070). The SEND itself is deliberately absent: it runs
  // server-side on a cron in /api/newsletters/send, which holds the Resend key
  // and the per-batch cap. queue_newsletter only materialises delivery rows.
  'get_newsletter_lists', 'save_newsletter_list', 'delete_newsletter_list',
  'get_newsletter_subscribers', 'upsert_newsletter_subscriber',
  'set_newsletter_subscriber_status', 'delete_newsletter_subscriber',
  'get_newsletters', 'get_newsletter', 'save_newsletter', 'delete_newsletter',
  'queue_newsletter', 'cancel_newsletter',
  // Segments (0072). evaluate_segment_filters is a READ that the builder calls
  // on every edit; it is size-capped and shape-checked in SQL, and its filter
  // vocabulary is a whitelist that fails closed — there is no dynamic SQL.
  'get_segments', 'save_segment', 'delete_segment',
  'evaluate_segment_filters', 'sync_segment_to_list',
  // Sequences (0073). Enrolment and step execution are deliberately ABSENT:
  // they run server-side on a cron in /api/sequences/run, which holds the
  // Resend key and the at-most-once claim protocol.
  'get_sequences', 'save_sequence', 'set_sequence_enabled', 'delete_sequence',
  'get_sequence_stats',
  // Lead scoring (0074). The recompute itself is service_role only and runs on
  // the cron — these are just the settings.
  'get_scoring_config', 'save_scoring_config',
  // Team chat (0075). Visibility is decided by can_read_channel inside SQL, so
  // every one of these is safe to expose through the verified proxy.
  // post_agent_message is deliberately ABSENT — it forces author_kind='agent'
  // and is service_role only, so a browser cannot post as an agent.
  'get_channels', 'create_channel', 'delete_channel', 'join_channel', 'leave_channel',
  'add_channel_member', 'get_messages', 'post_message', 'edit_message',
  'delete_message', 'mark_channel_read',
  // Social publishing (0082/0083). get_social_accounts returns display fields
  // only — never a token. save_social_account, get_social_token,
  // record_social_account_error, claim_post_targets, mark_post_target and
  // sweep_stale_post_targets are all deliberately ABSENT: they are service_role
  // and belong to the OAuth callback and the dispatcher. A browser that could
  // read a token could post from anywhere; one that could claim a target could
  // publish twice.
  'get_social_accounts', 'set_social_account_enabled', 'delete_social_account',
  'get_post_targets', 'set_post_targets', 'publish_post_now',
  // Agent research notes (0084). The write is exposed on purpose: a note a
  // human cannot add or correct is a note nobody will trust. claim_due_agents
  // and get_workspace_ai_owner are ABSENT — they belong to the scheduled-agent
  // dispatcher, and a browser that could claim an agent could make it run
  // whenever it liked on someone else's AI credit.
  'get_record_notes', 'add_record_note', 'delete_record_note',
  // Custom objects (0087). Defining an object is a schema change, so every
  // write here re-checks owner/admin in SQL — the proxy only proves WHO is
  // asking, never WHAT they may do. The records themselves need nothing new:
  // they go through list/get/create/update/delete_record, already allowed.
  'get_custom_objects', 'save_custom_object', 'delete_custom_object',
  'save_custom_field', 'delete_custom_field',
  // Editing the BUILT-IN objects (0097) — same rule, same owner/admin check in
  // SQL. get_object_settings is a member-level read because the sidebar calls
  // it on every page; the three writes are not.
  'get_object_settings', 'save_object_override', 'reset_object_override', 'save_builtin_field',
  // Connected apps (0099). Only the two READ/REVOKE calls are here — register,
  // authorize, token and revoke are OAuth endpoints under /oauth/* and run
  // service_role. A browser that could mint a code or resolve a token would be
  // able to issue itself a workspace-wide credential.
  'oauth_list_grants', 'oauth_revoke_grant',
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
  // Careers page (0060) — owner side. get_careers_page is public and is read
  // server-side by the careers route, so it is deliberately NOT listed here.
  'get_careers_settings', 'set_careers_page', 'set_position_published',
  // Invoice reminders (0064) — owner side. The send itself runs server-side in
  // /api/finance/reminders/run, which holds the Resend key and the per-run cap.
  'get_invoice_reminder_settings', 'save_invoice_reminder_settings', 'get_invoice_reminder_log',
  // Files (0065) — reads only. create_file / set_file_content / delete_file are
  // deliberately absent: each has to move a blob in the private bucket too, so
  // they run server-side in /api/files/* where the service-role key lives.
  'get_files', 'get_file', 'search_files',
  // Post schedule (0066). set_post_schedule is a drag-to-reschedule write, kept
  // separate from save_post so moving a card doesn't round-trip the post body.
  'set_post_schedule',
  // Mind maps (0067). The canvas autosaves, so save_mind_map is a write that
  // fires often — it is size-capped and shape-checked in SQL, not here.
  'get_mind_maps', 'get_mind_map', 'create_mind_map', 'save_mind_map', 'delete_mind_map',
]);

function db() {
  // serverSupabaseUrl(), not the NEXT_PUBLIC_ one: in a container the browser's
  // URL points at the app itself. See lib/supabase.ts.
  const url = serverSupabaseUrl();
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
