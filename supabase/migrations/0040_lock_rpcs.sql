-- ============================================================================
-- RunButter Platform Core — 0040_lock_rpcs.sql
-- THE security lockdown. Every authenticated RPC used to be EXECUTE-able by
-- the public anon key with a caller-supplied p_privy — so anyone who read the
-- client code could pass someone else's Privy DID and read that tenant's
-- data. The app now calls these through /api/rpc, which verifies the SIGNED
-- Privy token server-side and runs on the service-role key. This migration
-- revokes public/anon/authenticated EXECUTE on all of them (and on the
-- server-only automation/AI internals), leaving only service_role.
--
-- ⚠️ RUN ORDER MATTERS: deploy the app code that ships /api/rpc FIRST, then
-- run this. Running it against an older build breaks every dashboard read.
-- Rollback: re-run the older migrations' grant statements.
--
-- Kept PUBLIC on purpose (candidate-facing flows have no Privy session):
--   set_config, register_link_click, company_can_accept_candidate,
--   get_assessment_init_data, submit_assessment,
--   get_invoice_document_public, get_post_public, add_post_comment_public.
--
-- Idempotent & overload-safe (iterates pg_proc). Depends on 0001–0039.
-- ============================================================================

do $$
declare
  fn text;
  r record;
  locked text[] := array[
    -- workspace / CRM core
    'get_my_workspace','list_records','get_record','create_record','update_record',
    'delete_record','import_records','get_pipeline_by_kind','move_pipeline_record',
    'get_finance_summary','get_finance_analytics','get_project','get_roadmap',
    'get_members','set_member_role','get_invoice_document','save_invoice_items',
    'convert_offer_to_invoice','get_transactions_ledger','create_bank_account',
    'get_bank_accounts','delete_bank_account','reconcile_transaction',
    'suggest_transaction_matches','update_transactions_bulk','get_workspace_branding',
    'save_workspace_branding','get_nav_activity','get_treasury_dataset',
    -- marketing sites
    'create_site','delete_site','get_sites','get_site_stats','get_posts','get_post',
    'save_post','add_post_comment','set_post_comment_resolved',
    -- automations + integrations (client-facing)
    'get_automations','get_automation_by_id','save_automation','delete_automation',
    'set_automation_enabled','get_automation_runs','get_event_automations',
    'get_connections','get_connection','save_connection','delete_connection',
    'create_api_key','get_api_keys','revoke_api_key','get_webhook_endpoints',
    'upsert_webhook_endpoint','delete_webhook_endpoint','get_webhook_deliveries',
    -- docs + AI providers
    'get_docs','get_doc','save_doc','delete_doc','get_ai_providers',
    'store_ai_provider','delete_ai_provider','set_ai_provider_meta',
    -- HR / ATS
    'get_message_templates','upsert_message_template','delete_message_template',
    'get_tracking_links','get_source_attribution','create_tracking_link',
    'get_my_team','get_onboarding_tasks','set_onboarding_task','record_pulse',
    'get_candidates_for_recruiter','search_candidates_for_recruiter',
    'get_candidate_details','get_pipeline_board','log_candidate_message',
    -- server-only internals (dispatcher / MCP / cron) — never for browsers
    'claim_automation_events','complete_automation_event','retry_automation_event',
    'enqueue_webhook_event','enqueue_scheduled_automations','log_webhook_delivery',
    'log_automation_run','resolve_api_key','get_ai_secret',
    'automation_create_record','automation_update_record','anonymize_expired_candidates'
  ];
begin
  foreach fn in array locked loop
    for r in
      select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    loop
      execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';
