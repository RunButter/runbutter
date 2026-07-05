-- ============================================================================
-- verify-migrations.sql  —  READ ONLY. Paste into the Supabase SQL editor.
-- Migrations run via the SQL editor aren't tracked, so this inventories the
-- actual schema to tell you what's applied. Run AFTER 0001–0007 (the base).
--
-- Part A — did each migration run at all?     (every row should be ✅)
-- Part B — are the re-defined RPCs the LATEST? (catches out-of-order runs)
--
-- Fix for any ❌: re-run that migration's .sql. Everything is idempotent
-- (create-or-replace / if-not-exists), so re-running — or re-running the whole
-- 0008→0018 set in order — is always safe and brings the DB fully up to date.
-- ============================================================================

-- ── Part A: presence of each migration's signature object ──────────────────
with checks(ord, step, probe, ok) as (
  values
  (8,  '0008 import',            'import_records()',               (select exists(select 1 from pg_proc where proname='import_records'))),
  (9,  '0009 invoice category',  'invoices.category',              (select exists(select 1 from information_schema.columns where table_name='invoices' and column_name='category'))),
  (10, '0010 products',          'products table',                 (to_regclass('public.products') is not null)),
  (11, '0011 project dashboard', 'get_project()',                  (select exists(select 1 from pg_proc where proname='get_project'))),
  (12, '0012 roles',             'get_members()',                  (select exists(select 1 from pg_proc where proname='get_members'))),
  (13, '0013 finance analytics', 'get_finance_analytics()',        (select exists(select 1 from pg_proc where proname='get_finance_analytics'))),
  (14, '0014 roadmap',           'get_roadmap()',                  (select exists(select 1 from pg_proc where proname='get_roadmap'))),
  (15, '0015 finance epic',      'invoices.direction',             (select exists(select 1 from information_schema.columns where table_name='invoices' and column_name='direction'))),
  (16, '0016 documents',         'invoice_items + invoices.kind',  ((to_regclass('public.invoice_items') is not null) and exists(select 1 from information_schema.columns where table_name='invoices' and column_name='kind'))),
  (17, '0017 branding',          'workspaces.logo_url + bucket',   (exists(select 1 from information_schema.columns where table_name='workspaces' and column_name='logo_url') and exists(select 1 from storage.buckets where id='branding'))),
  (18, '0018 quoting',           'invoice_items.discount_pct+tax', (exists(select 1 from information_schema.columns where table_name='invoice_items' and column_name='discount_pct') and exists(select 1 from information_schema.columns where table_name='invoice_items' and column_name='tax_rate'))),
  (31, '0031 transactions',      'transactions + bank_accounts',   ((to_regclass('public.transactions') is not null) and (to_regclass('public.bank_accounts') is not null) and (select exists(select 1 from pg_proc where proname='get_transactions_ledger')))),
  (32, '0032 automations',       'automations + connections + api_keys', ((to_regclass('public.automations') is not null) and (to_regclass('public.connections') is not null) and (to_regclass('public.api_keys') is not null) and (select exists(select 1 from pg_proc where proname='claim_automation_events'))))
)
select step, probe, case when ok then '✅ applied' else '❌ MISSING — run this migration' end as status
from checks order by ord;

-- ── Part B: freshness — re-defined RPCs must be the LATEST version ──────────
-- (Running an older migration AFTER a newer one silently reverts a function.
--  These check the live function body for tokens only the latest version has.)
with fresh(ord, what, ok) as (
  values
  (1, 'list_records carries invoice kind (0016)',        (select exists(select 1 from pg_proc where proname='list_records'        and pg_get_functiondef(oid) ilike '%kind%'))),
  (2, 'create_record sets invoice direction (0015+)',    (select exists(select 1 from pg_proc where proname='create_record'       and pg_get_functiondef(oid) ilike '%direction%'))),
  (3, 'get_invoice_document returns totals (0018)',      (select exists(select 1 from pg_proc where proname='get_invoice_document' and pg_get_functiondef(oid) ilike '%totals%'))),
  (4, 'get_invoice_document returns branding (0017)',    (select exists(select 1 from pg_proc where proname='get_invoice_document' and pg_get_functiondef(oid) ilike '%logo_url%'))),
  (5, 'save_invoice_items applies tax_rate (0018)',      (select exists(select 1 from pg_proc where proname='save_invoice_items'   and pg_get_functiondef(oid) ilike '%tax_rate%'))),
  (6, 'create_record handles transactions (0031)',       (select exists(select 1 from pg_proc where proname='create_record'        and pg_get_functiondef(oid) ilike '%bank_account_id%')))
)
select what, case when ok then '✅ latest' else '❌ STALE — re-run the newer migration' end as status
from fresh order by ord;
