-- ============================================================================
-- HireBTR — 0041_hr_secure_rpcs.sql
-- Phase B of the lockdown: the legacy ATS tables still had RLS policies that
-- resolve the tenant from current_setting('app.current_privy_user_id'), which
-- ANY holder of the public anon key can set to a victim's (non-secret) Privy
-- DID — so set_config(victim) + select * from candidates leaked cross-tenant
-- PII. Same spoof as the old p_privy pattern, via the GUC.
--
-- Fix: every remaining CLIENT read/write of the crown-jewel tables now goes
-- through a SECURITY DEFINER RPC. Recruiter RPCs (hr_*) resolve the company
-- from the caller's privy id and are granted to service_role ONLY — they are
-- reachable exclusively through /api/rpc, which injects the VERIFIED privy id
-- (a direct anon call can't reach them, so the spoof is gone). The public
-- apply flow (candidates have no login) gets two anon-callable DEFINER RPCs
-- that need no anon table privileges, so 0042 can revoke those entirely.
--
-- Additive & idempotent. Depends on 0001–0040. Pairs with 0042 (the revoke),
-- which must run AFTER this + the app deploy.
-- ============================================================================

-- ── helper: resolve legacy company from a privy id ──────────────────────────
create or replace function hr_company_id(p_privy text)
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from company_users where privy_user_id = p_privy limit 1;
$$;

-- ── PUBLIC apply flow (anon; DEFINER so it needs no anon table grants) ───────
create or replace function apply_to_position(
  p_position_id uuid, p_full_name text, p_email text, p_phone text,
  p_linkedin text, p_source text, p_utm_source text, p_utm_medium text,
  p_utm_campaign text, p_referrer text, p_tracking_link_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_company uuid; v_title text; v_id uuid; v_token uuid;
begin
  select company_id, title into v_company, v_title from positions where id = p_position_id;
  if v_company is null then raise exception 'Position not found'; end if;
  -- Honour the plan candidate cap, but fail OPEN (as the old client did) if the
  -- cap function is absent, so infra gaps never block a genuine applicant.
  begin
    if not company_can_accept_candidate(v_company) then
      raise exception 'This position is no longer accepting applications.';
    end if;
  exception
    when undefined_function then null;
  end;

  insert into candidates (
    company_id, position_id, full_name, email, phone, linkedin_url, status,
    source, utm_source, utm_medium, utm_campaign, referrer, tracking_link_id
  ) values (
    v_company, p_position_id, p_full_name, p_email, nullif(p_phone,''), nullif(p_linkedin,''),
    'applied', coalesce(nullif(p_source,''),'direct'), p_utm_source, p_utm_medium,
    p_utm_campaign, p_referrer, p_tracking_link_id
  ) returning id, access_token into v_id, v_token;

  insert into activity_log (company_id, candidate_id, action, details)
  values (v_company, v_id, 'application_submitted',
          jsonb_build_object('position_title', v_title, 'cv_uploaded', true));

  return jsonb_build_object('id', v_id, 'access_token', v_token);
end $$;

-- Applicant attaches their CV url; gated by the access_token just returned, so
-- only the person who created the row can set it (no login required).
create or replace function set_candidate_cv(p_candidate_id uuid, p_access_token uuid, p_cv_url text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update candidates set cv_url = p_cv_url
   where id = p_candidate_id and access_token = p_access_token;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- ── RECRUITER RPCs (service_role only → only reachable via verified /api/rpc) ─

-- Home / HR overview aggregates.
create or replace function hr_overview_data(p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_company jsonb; v_now timestamptz := now();
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return null; end if;
  select to_jsonb(c) into v_company from (select name, plan from companies where id = v_c) c;
  return jsonb_build_object(
    'company', v_company,
    'status_rows', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'applied_at', applied_at))
                             from candidates where company_id = v_c), '[]'::jsonb),
    'active_positions', (select count(*) from positions where company_id = v_c and is_active),
    'upcoming_interviews', (select count(*) from interviews i join candidates ca on ca.id = i.candidate_id
                            where ca.company_id = v_c and i.status = 'scheduled' and i.scheduled_at >= v_now),
    'assessments_completed', (select count(*) from assessment_responses r join candidates ca on ca.id = r.candidate_id
                              where ca.company_id = v_c and r.is_completed),
    'recent', coalesce((select jsonb_agg(row) from (
        select jsonb_build_object('id', ca.id, 'full_name', ca.full_name, 'email', ca.email,
               'status', ca.status, 'applied_at', ca.applied_at,
               'position_title', p.title) as row
        from candidates ca left join positions p on p.id = ca.position_id
        where ca.company_id = v_c order by ca.applied_at desc limit 6) s), '[]'::jsonb)
  );
end $$;

-- Recruitment analytics raw rows.
create or replace function hr_analytics_data(p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return null; end if;
  return jsonb_build_object(
    'company', (select to_jsonb(c) from (select * from companies where id = v_c) c),
    'positions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'status', status))
                           from positions where company_id = v_c), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'status', status,
                            'source', source, 'position_id', position_id))
                            from candidates where company_id = v_c), '[]'::jsonb)
  );
end $$;

-- Activity log for one candidate (tenant-checked).
create or replace function hr_candidate_activity(p_privy text, p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
    from activity_log a
    where a.candidate_id = p_candidate_id and a.company_id = v_c), '[]'::jsonb);
end $$;

-- Move a candidate's stage + audit it (tenant-checked).
create or replace function hr_update_candidate_status(p_privy text, p_candidate_id uuid, p_status text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_old text; v_n int;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return false; end if;
  select status into v_old from candidates where id = p_candidate_id and company_id = v_c;
  update candidates set status = p_status where id = p_candidate_id and company_id = v_c;
  get diagnostics v_n = row_count;
  if v_n = 0 then return false; end if;
  insert into activity_log (company_id, candidate_id, action, details)
  values (v_c, p_candidate_id, 'status_updated',
          jsonb_build_object('old_status', v_old, 'new_status', p_status));
  return true;
end $$;

-- "Generate demo data" helper on the candidate page (tenant-checked insert).
create or replace function hr_seed_demo_result(p_privy text, p_candidate_id uuid, p_results jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_c uuid;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return false; end if;
  if not exists (select 1 from candidates where id = p_candidate_id and company_id = v_c) then
    return false;
  end if;
  insert into assessment_results (candidate_id, overall_score, cognitive_score, personality_score,
    work_style_score, personality_data, work_style_data, cognitive_data, summary)
  values (p_candidate_id,
    (p_results->>'overall_score')::int, (p_results->>'cognitive_score')::int,
    (p_results->>'personality_score')::int, (p_results->>'work_style_score')::int,
    p_results->'personality_data', p_results->'work_style_data', p_results->'cognitive_data',
    p_results->>'summary');
  update candidates set status = 'assessment_completed' where id = p_candidate_id and company_id = v_c;
  return true;
end $$;

-- Is Google Calendar connected for this recruiter's workspace?
create or replace function hr_google_connected(p_privy text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from integration_tokens t
    join company_users cu on cu.id = t.user_id
    where cu.privy_user_id = p_privy and t.provider = 'google');
$$;

-- ── grants ──────────────────────────────────────────────────────────────────
-- Public flow: anon may call these two (DEFINER, no table privileges needed).
grant execute on function apply_to_position(uuid,text,text,text,text,text,text,text,text,text,uuid) to anon, authenticated, service_role;
grant execute on function set_candidate_cv(uuid,uuid,text) to anon, authenticated, service_role;
-- Recruiter RPCs: service_role ONLY. Reached only through the verified proxy;
-- a direct anon call with a spoofed p_privy cannot execute them.
revoke all on function hr_company_id(text) from public, anon, authenticated;
grant execute on function hr_overview_data(text)                     to service_role;
grant execute on function hr_analytics_data(text)                    to service_role;
grant execute on function hr_candidate_activity(text,uuid)           to service_role;
grant execute on function hr_update_candidate_status(text,uuid,text) to service_role;
grant execute on function hr_seed_demo_result(text,uuid,jsonb)       to service_role;
grant execute on function hr_google_connected(text)                  to service_role;

notify pgrst, 'reload schema';
