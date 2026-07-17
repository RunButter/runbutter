-- ============================================================================
-- RunButter Platform Core — 0039_nav_activity.sql
-- Sidebar unread badges: "how many NEW records since I last looked at each
-- tab?" One RPC, one round trip. The client keeps a per-tab last-seen
-- timestamp (localStorage) and sends it as jsonb; keys missing from p_since
-- default to now(), so first-time users start clean instead of seeing a
-- badge storm. Covers both tenancy models: workspace objects (new platform)
-- and candidates (legacy ATS via company_users).
--
-- Additive, idempotent & prod-safe. Depends on 0001–0034. Run AFTER them.
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
      'companies',    (select count(*) from organizations  where workspace_id = v_ws and created_at > coalesce(nullif(p_since->>'companies','')::timestamptz, v_now)),
      'invoices',     (select count(*) from invoices       where workspace_id = v_ws and coalesce(kind,'invoice') <> 'offer' and created_at > coalesce(nullif(p_since->>'invoices','')::timestamptz, v_now)),
      'offers',       (select count(*) from invoices       where workspace_id = v_ws and kind = 'offer' and created_at > coalesce(nullif(p_since->>'offers','')::timestamptz, v_now)),
      'expenses',     (select count(*) from expenses       where workspace_id = v_ws and created_at > coalesce(nullif(p_since->>'expenses','')::timestamptz, v_now)),
      'transactions', (select count(*) from transactions   where workspace_id = v_ws and created_at > coalesce(nullif(p_since->>'transactions','')::timestamptz, v_now)),
      'issues',       (select count(*) from issues         where workspace_id = v_ws and created_at > coalesce(nullif(p_since->>'issues','')::timestamptz, v_now)),
      'docs',         (select count(*) from docs           where workspace_id = v_ws and created_at > coalesce(nullif(p_since->>'docs','')::timestamptz, v_now))
    );
  end if;

  if v_company is not null then
    out_j := out_j || jsonb_build_object(
      'candidates',   (select count(*) from candidates     where company_id = v_company and created_at > coalesce(nullif(p_since->>'candidates','')::timestamptz, v_now))
    );
  end if;

  return out_j;
end $$;
grant execute on function get_nav_activity(text, jsonb) to authenticated, anon;

notify pgrst, 'reload schema';
