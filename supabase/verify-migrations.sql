-- ============================================================================
-- verify-migrations.sql  —  READ ONLY. Paste the whole thing and hit Run.
--
-- ONE query on purpose: the Supabase SQL editor only returns the LAST result
-- set of a multi-statement script, so a split report silently loses half.
--
-- Migrations run via the SQL editor aren't tracked, so this inventories the
-- actual schema to tell you what's applied. Run AFTER 0001–0007 (the base).
--
-- section A — did each migration run at all?      (every row should be ✅)
-- section B — are the re-defined RPCs the LATEST?  (catches out-of-order runs)
--
-- Fix for any ❌: re-run that migration's .sql. Everything is idempotent
-- (create-or-replace / if-not-exists), so re-running — or re-running the whole
-- set in order — is always safe and brings the DB fully up to date.
-- ============================================================================

with applied(ord, section, item, probe, ok) as (
  values
  (8,  'A. migration', '0008 import',            'import_records()',               (select exists(select 1 from pg_proc where proname='import_records'))),
  (9,  'A. migration', '0009 invoice category',  'invoices.category',              (select exists(select 1 from information_schema.columns where table_name='invoices' and column_name='category'))),
  (10, 'A. migration', '0010 products',          'products table',                 (to_regclass('public.products') is not null)),
  (11, 'A. migration', '0011 project dashboard', 'get_project()',                  (select exists(select 1 from pg_proc where proname='get_project'))),
  (12, 'A. migration', '0012 roles',             'get_members()',                  (select exists(select 1 from pg_proc where proname='get_members'))),
  (13, 'A. migration', '0013 finance analytics', 'get_finance_analytics()',        (select exists(select 1 from pg_proc where proname='get_finance_analytics'))),
  (14, 'A. migration', '0014 roadmap',           'get_roadmap()',                  (select exists(select 1 from pg_proc where proname='get_roadmap'))),
  (15, 'A. migration', '0015 finance epic',      'invoices.direction',             (select exists(select 1 from information_schema.columns where table_name='invoices' and column_name='direction'))),
  (16, 'A. migration', '0016 documents',         'invoice_items + invoices.kind',  ((to_regclass('public.invoice_items') is not null) and exists(select 1 from information_schema.columns where table_name='invoices' and column_name='kind'))),
  (17, 'A. migration', '0017 branding',          'workspaces.logo_url + bucket',   (exists(select 1 from information_schema.columns where table_name='workspaces' and column_name='logo_url') and exists(select 1 from storage.buckets where id='branding'))),
  (18, 'A. migration', '0018 quoting',           'invoice_items.discount_pct+tax', (exists(select 1 from information_schema.columns where table_name='invoice_items' and column_name='discount_pct') and exists(select 1 from information_schema.columns where table_name='invoice_items' and column_name='tax_rate'))),
  (31, 'A. migration', '0031 transactions',      'transactions + bank_accounts',   ((to_regclass('public.transactions') is not null) and (to_regclass('public.bank_accounts') is not null) and (select exists(select 1 from pg_proc where proname='get_transactions_ledger')))),
  (32, 'A. migration', '0032 automations',       'automations + connections + api_keys', ((to_regclass('public.automations') is not null) and (to_regclass('public.connections') is not null) and (to_regclass('public.api_keys') is not null) and (select exists(select 1 from pg_proc where proname='claim_automation_events')))),
  (33, 'A. migration', '0033 automations v2',    'webhook triggers + delivery log', ((to_regclass('public.webhook_deliveries') is not null) and exists(select 1 from information_schema.columns where table_name='automations' and column_name='trigger_type') and (select exists(select 1 from pg_proc where proname='enqueue_webhook_event')))),
  (34, 'A. migration', '0034 docs + AI',         'docs + ai_providers',            ((to_regclass('public.docs') is not null) and (to_regclass('public.ai_providers') is not null) and (select exists(select 1 from pg_proc where proname='get_ai_secret')))),
  (35, 'A. migration', '0035 automation hardening','recursion guard + wrapper RPCs', ((select exists(select 1 from pg_proc where proname='automation_create_record')) and (select exists(select 1 from pg_proc where proname='emit_automation_event' and pg_get_functiondef(oid) ilike '%automation_depth%')))),
  (36, 'A. migration', '0036 assets CRUD',       'create_record handles assets',   ((select exists(select 1 from pg_proc where proname='create_record' and pg_get_functiondef(oid) ilike '%assigned_to_person_id%')))),
  (37, 'A. migration', '0037 pgcrypto fix',      'save_automation + create_api_key use core crypto', ((select exists(select 1 from pg_proc where proname='create_api_key' and pg_get_functiondef(oid) ilike '%sha256%')))),
  (38, 'A. migration', '0038 custom AI provider','ai_providers.base_url + updated RPCs', (exists(select 1 from information_schema.columns where table_name='ai_providers' and column_name='base_url') and (select exists(select 1 from pg_proc where proname='store_ai_provider' and pg_get_functiondef(oid) ilike '%p_base_url%')))),
  (39, 'A. migration', '0039 nav activity',      'sidebar unread-badge RPC',       (select exists(select 1 from pg_proc where proname='get_nav_activity'))),
  (40, 'A. migration', '0040 lock rpcs',         'anon can no longer execute list_records', (select coalesce(bool_and(not has_function_privilege('anon', p.oid, 'execute')), false) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('list_records','get_ai_secret'))),
  (41, 'A. migration', '0041 hr secure rpcs',    'apply_to_position + hr_overview_data exist', ((select exists(select 1 from pg_proc where proname='apply_to_position')) and (select exists(select 1 from pg_proc where proname='hr_overview_data')))),
  (42, 'A. migration', '0042 lock legacy tables','anon can no longer SELECT candidates', (not has_table_privilege('anon', 'public.candidates', 'select'))),
  (43, 'A. migration', '0043 agents',            'agents + agent_runs + get_agents RPC', ((to_regclass('public.agents') is not null) and (to_regclass('public.agent_runs') is not null) and (select exists(select 1 from pg_proc where proname='get_agents')))),
  (44, 'A. migration', '0044 hr manage',         'interview + candidate management RPCs', ((select exists(select 1 from pg_proc where proname='hr_schedule_interview')) and (select exists(select 1 from pg_proc where proname='hr_create_candidate')))),
  (45, 'A. migration', '0045 interviews meet',   'schedule w/ meet + update/cancel + contact RPCs', ((select exists(select 1 from pg_proc where proname='hr_update_interview')) and (select exists(select 1 from pg_proc where proname='hr_candidate_contact')) and (select exists(select 1 from pg_proc p where p.proname='hr_schedule_interview' and pg_get_functiondef(p.oid) ilike '%google_meet_link%')))),
  (46, 'A. migration', '0046 revoke public exec','anon can no longer execute hr_overview_data', (select coalesce(bool_and(not has_function_privilege('anon', p.oid, 'execute')), false) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('hr_overview_data','hr_update_candidate_status','get_agents','search_people'))),
  (47, 'A. migration', '0047 finance math',      'summary is direction- and kind-aware', ((select exists(select 1 from pg_proc where proname='get_finance_summary' and pg_get_functiondef(oid) ilike '%direction%')) and (select exists(select 1 from pg_proc where proname='get_finance_summary' and pg_get_functiondef(oid) ilike '%kind%')))),
  (48, 'A. migration', '0048 team invites',      'invite_token + redeem_invite RPC', ((select exists(select 1 from information_schema.columns where table_name='company_users' and column_name='invite_token')) and (select exists(select 1 from pg_proc where proname='redeem_invite')))),
  (49, 'A. migration', '0049 remove members',    'remove_member + pending invites listed', ((select exists(select 1 from pg_proc where proname='remove_member')) and (select exists(select 1 from pg_proc where proname='get_members' and pg_get_functiondef(oid) ilike '%pending%')))),
  (50, 'A. migration', '0050 unify roles',       'company_users accepts member/recruiter', (select exists(select 1 from pg_constraint where conname='company_users_role_check' and pg_get_constraintdef(oid) ilike '%member%' and pg_get_constraintdef(oid) ilike '%recruiter%')))
),
-- Freshness: running an older migration AFTER a newer one silently reverts a
-- function. These check the live body for tokens only the latest version has.
fresh(ord, section, item, probe, ok) as (
  values
  (101, 'B. freshness', 'list_records carries invoice kind',     '0016', (select exists(select 1 from pg_proc where proname='list_records'        and pg_get_functiondef(oid) ilike '%kind%'))),
  (102, 'B. freshness', 'create_record sets invoice direction',  '0015+',(select exists(select 1 from pg_proc where proname='create_record'       and pg_get_functiondef(oid) ilike '%direction%'))),
  (103, 'B. freshness', 'get_invoice_document returns totals',   '0018', (select exists(select 1 from pg_proc where proname='get_invoice_document' and pg_get_functiondef(oid) ilike '%totals%'))),
  (104, 'B. freshness', 'get_invoice_document returns branding', '0017', (select exists(select 1 from pg_proc where proname='get_invoice_document' and pg_get_functiondef(oid) ilike '%logo_url%'))),
  (105, 'B. freshness', 'save_invoice_items applies tax_rate',   '0018', (select exists(select 1 from pg_proc where proname='save_invoice_items'   and pg_get_functiondef(oid) ilike '%tax_rate%'))),
  (106, 'B. freshness', 'create_record handles transactions',    '0031', (select exists(select 1 from pg_proc where proname='create_record'        and pg_get_functiondef(oid) ilike '%bank_account_id%'))),
  (107, 'B. freshness', 'save_automation free of pgcrypto',      '0037', (select exists(select 1 from pg_proc where proname='save_automation'      and pg_get_functiondef(oid) not ilike '%gen_random_bytes%')))
)
select
  section,
  item,
  probe,
  case
    when ok and section = 'A. migration' then '✅ applied'
    when ok                              then '✅ latest'
    when section = 'A. migration'        then '❌ MISSING — run this migration'
    else '❌ STALE — re-run the newer migration'
  end as status
from (select * from applied union all select * from fresh) x
order by ord;
