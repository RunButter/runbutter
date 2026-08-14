-- ============================================================================
-- RunButter — 0106_webhook_endpoints.sql
--
-- Settings → Integrations has called three functions that do not exist on
-- production since the day it was written.
--
-- `webhook_endpoints`, get_webhook_endpoints, upsert_webhook_endpoint and
-- delete_webhook_endpoint live in supabase/legacy/add-webhooks.sql, and
-- scripts/migrate.mjs runs supabase/legacy/* ONLY on a genuinely empty
-- database. Production predates the numbered migrations and was never empty, so
-- that file never ran there: the table is absent and so are all three RPCs.
--
-- HOW IT STAYED INVISIBLE. app/dashboard/settings/page.tsx reads the list with
--     const { data } = await rpc('get_webhook_endpoints', …)
-- and never looks at `error` — the recurring bug this codebase names in its own
-- conventions. So the call fails, `data` is null, and the panel renders "no
-- integrations" rather than a fault. Adding one does surface the PostgREST
-- error, which is why the feature reads as broken-on-save rather than missing.
-- lib/webhooks.ts logs its load error and returns, so nothing was ever
-- delivered either.
--
-- THE LEGACY DEFINITION IS NOT COPIED VERBATIM — it resolves the company with
--     select company_id into v_company_id from company_users
--      where privy_user_id = p_privy_user_id limit 1;
-- three times. A bare LIMIT 1 with no ORDER BY returns an ARBITRARY row for
-- anyone who belongs to two companies, which is the defect this repo already
-- paid for once ("my positions disappeared" while the careers page still showed
-- them). hr_company_id() is the resolver that mirrors it correctly — active
-- workspace first, else the OLDEST membership — so all three use it.
--
-- GRANTS ARE service_role ONLY. These are reached from the browser through
-- /api/rpc, which is where the Privy token is verified; they are not a public
-- surface. Granting anon here is what 0105 exists to undo.
--
-- AND GRANTING service_role IS NOT ENOUGH ON ITS OWN — the REVOKE is the half
-- that does the work. Postgres grants EXECUTE to PUBLIC on every new function,
-- and anon/authenticated inherit through PUBLIC, so a function that merely
-- omits the `to authenticated, anon` line is still anon-callable the moment it
-- is created. This migration shipped that way for one run and CI's own
-- check:grants gate caught all three functions; the fix is to revoke first,
-- every time, which is why each one below is a revoke/grant pair.
-- ============================================================================

create table if not exists webhook_endpoints (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  label      text not null default '',
  type       text not null default 'generic',   -- slack | discord | generic
  url        text not null,
  events     text[] not null default array['application.created','candidate.stage_changed','candidate.hired'],
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_webhook_endpoints_company on webhook_endpoints(company_id);

alter table webhook_endpoints enable row level security;
-- No policies, deliberately. Every read and write goes through the SECURITY
-- DEFINER functions below; the legacy file's anon-readable SELECT policy is the
-- shape 0077 spent a migration removing.

-- Adding a parameter to a Postgres function creates an OVERLOAD rather than
-- replacing it, and PostgREST answers an ambiguous call with a 400 it cannot
-- explain. Drop every existing signature first so a re-run cannot leave two.
do $$
declare r record;
begin
  for r in
    select 'drop function if exists ' || oid::regprocedure || ' cascade;' as stmt
      from pg_proc
     where pronamespace = 'public'::regnamespace
       and proname in ('get_webhook_endpoints', 'upsert_webhook_endpoint', 'delete_webhook_endpoint')
  loop
    execute r.stmt;
  end loop;
end $$;

create or replace function get_webhook_endpoints(p_privy_user_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_company_id uuid := hr_company_id(p_privy_user_id);
begin
  if v_company_id is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'label', t.label, 'type', t.type,
             'url', t.url, 'events', t.events, 'is_active', t.is_active
           ) order by t.created_at)
      from webhook_endpoints t
     where t.company_id = v_company_id
  ), '[]'::jsonb);
end $$;
revoke all on function get_webhook_endpoints(text) from public, anon, authenticated;
grant execute on function get_webhook_endpoints(text) to service_role;

create or replace function upsert_webhook_endpoint(
  p_privy_user_id text, p_id uuid, p_label text, p_type text, p_url text,
  p_events text[], p_is_active boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_company_id uuid := hr_company_id(p_privy_user_id); v_row webhook_endpoints;
begin
  if v_company_id is null then raise exception 'RECRUITER_NOT_FOUND'; end if;
  if coalesce(trim(p_url), '') = '' then raise exception 'URL_REQUIRED'; end if;

  if p_id is null then
    insert into webhook_endpoints (company_id, label, type, url, events, is_active)
    values (
      v_company_id, coalesce(p_label, ''), coalesce(nullif(p_type, ''), 'generic'), p_url,
      coalesce(p_events, array['application.created','candidate.stage_changed','candidate.hired']),
      coalesce(p_is_active, true)
    )
    returning * into v_row;
  else
    update webhook_endpoints
       set label     = coalesce(p_label, ''),
           type      = coalesce(nullif(p_type, ''), 'generic'),
           url       = p_url,
           events    = coalesce(p_events, events),
           is_active = coalesce(p_is_active, is_active)
     where id = p_id and company_id = v_company_id
    returning * into v_row;
    -- Scoped to the caller's company, so a missing row means "not yours" just
    -- as much as "not there". Both are NOT_FOUND on purpose: telling them apart
    -- would confirm the id exists in some other tenant.
    if v_row.id is null then raise exception 'ENDPOINT_NOT_FOUND'; end if;
  end if;
  return to_jsonb(v_row);
end $$;
revoke all on function upsert_webhook_endpoint(text, uuid, text, text, text, text[], boolean) from public, anon, authenticated;
grant execute on function upsert_webhook_endpoint(text, uuid, text, text, text, text[], boolean) to service_role;

create or replace function delete_webhook_endpoint(p_privy_user_id text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_company_id uuid := hr_company_id(p_privy_user_id);
begin
  if v_company_id is null then raise exception 'RECRUITER_NOT_FOUND'; end if;
  delete from webhook_endpoints where id = p_id and company_id = v_company_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function delete_webhook_endpoint(text, uuid) from public, anon, authenticated;
grant execute on function delete_webhook_endpoint(text, uuid) to service_role;

notify pgrst, 'reload schema';
