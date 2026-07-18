-- ============================================================================
-- RunButter — 0045_interviews_manage.sql
-- Makes interview scheduling actually work end-to-end.
--
-- Background: two half-built flows existed. The Interviews page stored a bare
-- `interviews` row but created no Google Meet link and sent no email; the
-- candidate page created a Meet event but stored no row (so it never appeared
-- in the list). This migration reworks the RPCs so a single server route
-- (/api/hr/interviews) can: create the row WITH the Meet link + event id,
-- reschedule it, and cancel it — while the route handles the Google Calendar
-- call and the candidate email around them.
--
-- The `interviews` table itself ships in supabase-schema.sql (base setup). We
-- guard its existence + the columns we touch so this is safe on any live DB.
-- All RPCs are SECURITY DEFINER, tenant-checked via hr_company_id (0041), and
-- service_role-only (reached only through the verified server). Depends on 0041.
-- ============================================================================

-- ── Schema guard (no-op if base schema already created it) ────────────────────
create table if not exists interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references candidates(id) on delete cascade,
  interviewer_id uuid references company_users(id),
  scheduled_at timestamptz not null,
  duration_minutes integer default 60,
  google_calendar_event_id text,
  google_meet_link text,
  status text default 'scheduled',
  notes text,
  feedback jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table interviews add column if not exists google_calendar_event_id text;
alter table interviews add column if not exists google_meet_link text;
alter table interviews add column if not exists duration_minutes integer default 60;
alter table interviews add column if not exists notes text;
alter table interviews add column if not exists status text default 'scheduled';
alter table interviews add column if not exists updated_at timestamptz default now();

-- ── Candidate contact card (for building the Meet event + the email) ──────────
create or replace function hr_candidate_contact(p_privy text, p_candidate_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_row jsonb;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then raise exception 'NOT_A_MEMBER'; end if;
  select jsonb_build_object(
    'full_name', c.full_name, 'email', c.email,
    'position_title', p.title,
    'company_name', co.name, 'brand_color', co.brand_color
  ) into v_row
  from candidates c
  left join positions p on p.id = c.position_id
  left join companies co on co.id = c.company_id
  where c.id = p_candidate_id and c.company_id = v_c;
  if v_row is null then raise exception 'Candidate not in your workspace'; end if;
  return v_row;
end $$;
revoke all on function hr_candidate_contact(text, uuid) from public, anon, authenticated;
grant execute on function hr_candidate_contact(text, uuid) to service_role;

-- ── Schedule (now stores the Meet link + calendar event id) ───────────────────
-- Signature changed (added p_meet_link / p_event_id), so drop the 0044 version.
drop function if exists hr_schedule_interview(text, uuid, timestamptz, int, text);
create or replace function hr_schedule_interview(
  p_privy text, p_candidate_id uuid, p_scheduled_at timestamptz, p_duration int,
  p_notes text, p_meet_link text default null, p_event_id text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_id uuid; v_interviewer uuid;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then raise exception 'NOT_A_MEMBER'; end if;
  if not exists (select 1 from candidates where id = p_candidate_id and company_id = v_c) then
    raise exception 'Candidate not in your workspace';
  end if;
  select id into v_interviewer from company_users
   where privy_user_id = p_privy and company_id = v_c limit 1;
  insert into interviews (candidate_id, interviewer_id, scheduled_at, duration_minutes,
                          status, notes, google_meet_link, google_calendar_event_id)
  values (p_candidate_id, v_interviewer, p_scheduled_at, coalesce(p_duration, 30),
          'scheduled', nullif(p_notes,''), nullif(p_meet_link,''), nullif(p_event_id,''))
  returning id into v_id;
  update candidates set status = 'interview_scheduled' where id = p_candidate_id and company_id = v_c;
  insert into activity_log (company_id, candidate_id, action, details)
  values (v_c, p_candidate_id, 'status_updated',
          jsonb_build_object('new_status', 'interview_scheduled', 'scheduled_at', p_scheduled_at,
                             'meet_link', nullif(p_meet_link,'')));
  return v_id;
end $$;
revoke all on function hr_schedule_interview(text, uuid, timestamptz, int, text, text, text) from public, anon, authenticated;
grant execute on function hr_schedule_interview(text, uuid, timestamptz, int, text, text, text) to service_role;

-- ── Reschedule / edit ─────────────────────────────────────────────────────────
create or replace function hr_update_interview(
  p_privy text, p_id uuid, p_scheduled_at timestamptz, p_duration int, p_notes text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_row jsonb;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then raise exception 'NOT_A_MEMBER'; end if;
  update interviews i
     set scheduled_at = p_scheduled_at,
         duration_minutes = coalesce(p_duration, i.duration_minutes),
         notes = nullif(p_notes,''),
         updated_at = now()
   from candidates c
   where i.id = p_id and i.candidate_id = c.id and c.company_id = v_c;
  if not found then raise exception 'Interview not in your workspace'; end if;
  select jsonb_build_object(
    'id', i.id, 'candidate_name', c.full_name, 'candidate_email', c.email,
    'position_title', p.title, 'company_name', co.name, 'brand_color', co.brand_color,
    'google_calendar_event_id', i.google_calendar_event_id, 'meet_link', i.google_meet_link,
    'scheduled_at', i.scheduled_at, 'duration_minutes', i.duration_minutes
  ) into v_row
  from interviews i
  join candidates c on c.id = i.candidate_id
  left join positions p on p.id = c.position_id
  left join companies co on co.id = c.company_id
  where i.id = p_id;
  return v_row;
end $$;
revoke all on function hr_update_interview(text, uuid, timestamptz, int, text) from public, anon, authenticated;
grant execute on function hr_update_interview(text, uuid, timestamptz, int, text) to service_role;

-- ── Cancel (returns the event id + contact so the route can clean up Google) ──
-- Return type changed boolean → jsonb, so drop the 0044 version first.
drop function if exists hr_cancel_interview(text, uuid);
create or replace function hr_cancel_interview(p_privy text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_event text; v_email text; v_name text; v_pos text;
        v_color text; v_company text; v_when timestamptz; v_dur int;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return jsonb_build_object('ok', false); end if;
  select i.google_calendar_event_id, c.email, c.full_name, p.title,
         co.brand_color, co.name, i.scheduled_at, i.duration_minutes
    into v_event, v_email, v_name, v_pos, v_color, v_company, v_when, v_dur
  from interviews i
  join candidates c on c.id = i.candidate_id
  left join positions p on p.id = c.position_id
  left join companies co on co.id = c.company_id
  where i.id = p_id and c.company_id = v_c;
  if not found then return jsonb_build_object('ok', false); end if;
  delete from interviews where id = p_id;
  return jsonb_build_object(
    'ok', true, 'google_calendar_event_id', v_event,
    'candidate_email', v_email, 'candidate_name', v_name, 'position_title', v_pos,
    'brand_color', v_color, 'company_name', v_company,
    'scheduled_at', v_when, 'duration_minutes', v_dur
  );
end $$;
revoke all on function hr_cancel_interview(text, uuid) from public, anon, authenticated;
grant execute on function hr_cancel_interview(text, uuid) to service_role;

notify pgrst, 'reload schema';
