-- Which of the recent migrations are actually in this database?
--
-- Paste into the Supabase SQL editor and run. It reads catalogue tables only —
-- it creates nothing, changes nothing, and is safe on production.
--
-- Each row probes for something the migration CREATES, not for a version number,
-- so it tells the truth even when the schema was applied by hand and there is no
-- ledger to consult.
select * from (values
  ('0086 doc cards',
   (select to_regprocedure('public.toggle_doc_item(text,uuid,int,boolean)') is not null)),

  ('0087 custom objects',
   (select to_regclass('public.custom_objects') is not null)),

  ('0088 partial-update fix',
   -- The fix IS the `p_data ? 'key'` test. Probing the function body is the only
   -- way to tell a fixed update_record from the one that blanks columns.
   (select exists (
      select 1 from pg_proc p
       where p.proname = 'update_record'
         and pg_get_functiondef(p.oid) like '%p_data ? ''number''%'))),

  ('0089 relation labels',
   (select to_regprocedure('public.custom_relation_label(uuid,text,uuid)') is not null)),

  ('0090 plan names + sync',
   (select exists (
      select 1 from pg_constraint
       where conname = 'companies_plan_check'
         and pg_get_constraintdef(oid) like '%business%')
     and exists (
      select 1 from pg_trigger where tgname = 'trg_company_plan_to_workspace')))
) as t(migration, applied)
order by migration;

-- Bonus: every workspace whose plan disagrees with its company's. After 0090
-- this should return no rows — before it, it returned every customer who paid.
select c.id, c.name, c.plan as company_plan, w.plan as workspace_plan
  from companies c
  join workspaces w on w.id = c.id
 where coalesce(w.plan, 'free') is distinct from case
         when c.plan = 'starter' then 'team'
         when c.plan in ('professional', 'pro') then 'business'
         else coalesce(c.plan, 'free')
       end;
