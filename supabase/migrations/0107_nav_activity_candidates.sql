-- ============================================================================
-- RunButter — 0107_nav_activity_candidates.sql
--
-- get_nav_activity has never worked for anyone in an HR company, and 0039
-- shipped it broken.
--
--   select count(*) from candidates where company_id = v_company
--     and created_at > …
--
-- `candidates` has no created_at. It never has: it is the legacy ATS table, and
-- supabase/legacy/supabase-schema.sql gives it applied_at and updated_at. So the
-- second half of this function raises 42703 "column created_at does not exist"
-- for every caller who belongs to a company — which is every HR user, on every
-- page, because the nav rail polls it.
--
-- WHY IT SURVIVED SIXTY-SEVEN MIGRATIONS. Two layers of politeness. In SQL a
-- plpgsql body is not planned when the function is created, so `create function`
-- succeeded and CI's migrate-from-empty has always passed. In the client,
-- loadNavActivity catches the error and returns {} "so the nav never breaks" —
-- which is a reasonable thing for a badge count to do, and which meant the
-- symptom was not an error but an absence: the little "new since you last
-- looked" counts never appeared, and nobody can report a number they have never
-- seen.
--
-- It surfaced only when a banner started announcing failed reads out loud.
--
-- applied_at is the right column, not a substitute for one: it is when the
-- candidate applied, which is when the row was created. `anonymized_at` and
-- `consent_at` describe later events and would undercount.
--
-- The workspace half is unchanged and correct — people, organizations, invoices,
-- expenses, transactions, issues and docs all genuinely have created_at.
-- ============================================================================

create or replace function get_nav_activity(p_privy text, p_since jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_company uuid;
  v_now timestamptz := now();
  out_j jsonb := '{}'::jsonb;
begin
  select workspace_id into v_ws from accounts where privy_user_id = p_privy limit 1;
  select company_id into v_company from company_users where privy_user_id = p_privy limit 1;

  if v_ws is not null then
    out_j := out_j || jsonb_build_object(
      'people',       (select count(*) from people        where workspace_id = v_ws and created_at > coalesce(nullif(p_since->>'people','')::timestamptz, v_now)),
      'companies',    (select count(*) from organizations where workspace_id = v_ws and created_at > coalesce(nullif(p_since->>'companies','')::timestamptz, v_now)),
      'invoices',     (select count(*) from invoices      where workspace_id = v_ws and coalesce(kind,'invoice') <> 'offer' and created_at > coalesce(nullif(p_since->>'invoices','')::timestamptz, v_now)),
      'offers',       (select count(*) from invoices      where workspace_id = v_ws and kind = 'offer' and created_at > coalesce(nullif(p_since->>'offers','')::timestamptz, v_now)),
      'expenses',     (select count(*) from expenses      where workspace_id = v_ws and created_at > coalesce(nullif(p_since->>'expenses','')::timestamptz, v_now)),
      'transactions', (select count(*) from transactions  where workspace_id = v_ws and created_at > coalesce(nullif(p_since->>'transactions','')::timestamptz, v_now)),
      'issues',       (select count(*) from issues        where workspace_id = v_ws and created_at > coalesce(nullif(p_since->>'issues','')::timestamptz, v_now)),
      'docs',         (select count(*) from docs          where workspace_id = v_ws and created_at > coalesce(nullif(p_since->>'docs','')::timestamptz, v_now))
    );
  end if;

  if v_company is not null then
    out_j := out_j || jsonb_build_object(
      -- applied_at, not created_at. This is the whole fix.
      'candidates',   (select count(*) from candidates    where company_id = v_company and applied_at > coalesce(nullif(p_since->>'candidates','')::timestamptz, v_now))
    );
  end if;

  return out_j;
end $$;

-- The pair, per the convention 0105 re-established: granting service_role alone
-- leaves the PUBLIC default in place and the function stays anon-callable.
revoke all on function get_nav_activity(text, jsonb) from public, anon, authenticated;
grant execute on function get_nav_activity(text, jsonb) to service_role;

notify pgrst, 'reload schema';
