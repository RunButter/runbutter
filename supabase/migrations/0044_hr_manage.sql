-- ============================================================================
-- RunButter — 0044_hr_manage.sql
-- HR add/delete management the UI was missing:
--   • Interviews were never actually stored — the schedule route only made a
--     Google Calendar event, so the Interviews page showed dummy data. These
--     RPCs list / create / cancel real rows in the `interviews` table, no
--     Google dependency (works on any plan; the Calendar sync stays a Pro
--     add-on on the candidate page).
--   • Candidates could only arrive via the public apply flow — recruiters had
--     no way to add one manually or delete one. Added both.
--
-- All are SECURITY DEFINER, tenant-checked via hr_company_id (0041), and
-- service_role-only so they are reachable only through the verified /api/rpc
-- proxy. Additive & idempotent. Depends on 0041.
-- ============================================================================

-- ── Interviews ────────────────────────────────────────────────────────────────
create or replace function hr_list_interviews(p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(row order by row->>'scheduled_at') from (
    select jsonb_build_object(
      'id', i.id, 'candidate_id', i.candidate_id, 'candidate_name', c.full_name,
      'candidate_email', c.email, 'position_title', p.title,
      'scheduled_at', i.scheduled_at, 'duration_minutes', i.duration_minutes,
      'status', i.status, 'notes', i.notes, 'meet_link', i.google_meet_link
    ) as row
    from interviews i
    join candidates c on c.id = i.candidate_id
    left join positions p on p.id = c.position_id
    where c.company_id = v_c and i.status = 'scheduled' and i.scheduled_at >= now() - interval '1 day'
  ) s), '[]'::jsonb);
end $$;
revoke all on function hr_list_interviews(text) from public, anon, authenticated;
grant execute on function hr_list_interviews(text) to service_role;

create or replace function hr_schedule_interview(
  p_privy text, p_candidate_id uuid, p_scheduled_at timestamptz, p_duration int, p_notes text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_id uuid;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then raise exception 'NOT_A_MEMBER'; end if;
  if not exists (select 1 from candidates where id = p_candidate_id and company_id = v_c) then
    raise exception 'Candidate not in your workspace';
  end if;
  insert into interviews (candidate_id, scheduled_at, duration_minutes, status, notes)
  values (p_candidate_id, p_scheduled_at, coalesce(p_duration, 30), 'scheduled', nullif(p_notes,''))
  returning id into v_id;
  update candidates set status = 'interview_scheduled' where id = p_candidate_id and company_id = v_c;
  insert into activity_log (company_id, candidate_id, action, details)
  values (v_c, p_candidate_id, 'status_updated', jsonb_build_object('new_status', 'interview_scheduled', 'scheduled_at', p_scheduled_at));
  return v_id;
end $$;
revoke all on function hr_schedule_interview(text, uuid, timestamptz, int, text) from public, anon, authenticated;
grant execute on function hr_schedule_interview(text, uuid, timestamptz, int, text) to service_role;

create or replace function hr_cancel_interview(p_privy text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_n int;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return false; end if;
  delete from interviews i using candidates c
   where i.id = p_id and i.candidate_id = c.id and c.company_id = v_c;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function hr_cancel_interview(text, uuid) from public, anon, authenticated;
grant execute on function hr_cancel_interview(text, uuid) to service_role;

-- ── Candidates (recruiter add / delete) ───────────────────────────────────────
create or replace function hr_create_candidate(
  p_privy text, p_full_name text, p_email text, p_phone text, p_linkedin text, p_position_id uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_id uuid;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(trim(p_full_name),'') = '' or coalesce(trim(p_email),'') = '' then
    raise exception 'Name and email are required';
  end if;
  -- position (if given) must belong to the same company
  if p_position_id is not null and not exists (select 1 from positions where id = p_position_id and company_id = v_c) then
    raise exception 'Position not in your workspace';
  end if;
  insert into candidates (company_id, position_id, full_name, email, phone, linkedin_url, status, source)
  values (v_c, p_position_id, trim(p_full_name), trim(p_email), nullif(p_phone,''), nullif(p_linkedin,''), 'applied', 'manual')
  returning id into v_id;
  insert into activity_log (company_id, candidate_id, action, details)
  values (v_c, v_id, 'candidate_added', jsonb_build_object('source', 'manual'));
  return v_id;
end $$;
revoke all on function hr_create_candidate(text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function hr_create_candidate(text, text, text, text, text, uuid) to service_role;

create or replace function hr_delete_candidate(p_privy text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_n int;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return false; end if;
  delete from candidates where id = p_id and company_id = v_c;  -- cascades to assessments/interviews/activity
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function hr_delete_candidate(text, uuid) from public, anon, authenticated;
grant execute on function hr_delete_candidate(text, uuid) to service_role;

-- also expose a lightweight position list for the "add candidate" picker
create or replace function hr_list_positions_min(p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title) order by created_at desc)
                   from positions where company_id = v_c and is_active), '[]'::jsonb);
end $$;
revoke all on function hr_list_positions_min(text) from public, anon, authenticated;
grant execute on function hr_list_positions_min(text) to service_role;

notify pgrst, 'reload schema';
