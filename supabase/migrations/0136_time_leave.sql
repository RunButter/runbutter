-- ============================================================================
-- 0136_time_leave.sql — HR → Time & leave: timesheets and time off.
--
-- Two halves of one question, "where did everyone's time go":
--
-- ── TIMESHEETS ──────────────────────────────────────────────────────────────
-- An entry is a person, a day, minutes and what it was for: a project, an
-- issue, a client company. A running timer is an entry whose timer_started_at
-- is set; stopping it adds the elapsed minutes. One running timer per person is
-- a UNIQUE INDEX, not a convention. Billable entries with a rate become an
-- invoice for their client in ONE transaction (invoice_time_entries): the
-- invoice is written through create_record + save_invoice_items — the same
-- path as the composer, so the plan's record limit and the totals rule apply —
-- and the entries are stamped with it, so an hour is never billed twice.
-- Deleting the invoice un-bills them (on delete set null).
--
-- ── TIME OFF ────────────────────────────────────────────────────────────────
-- Leave types with a yearly allowance (or none — sick leave is counted, not
-- capped), per-person overrides, public holidays per workspace, and requests
-- an owner/admin approves. A request's `days` is WORKING days — the work week
-- minus the workspace's public holidays — computed in SQL, so the balance on
-- screen and the one an agent reads cannot disagree. Changing the holidays or
-- the work week recounts every request that is not cancelled.
--
-- ── SICK LEAVE IS HEALTH DATA ───────────────────────────────────────────────
-- Everybody can see WHO is off (that is the point of a team calendar). Only
-- the person and owners/admins see WHY: the type and the note. That rule lives
-- here, in get_time_off and get_calendar, not in a screen that could forget it.
--
-- Approved leave and public holidays also block booking pages (booking_busy,
-- redefined from 0135), and show on the company calendar (get_calendar,
-- redefined IN FULL from 0135).
-- ============================================================================

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists time_entries (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  privy_user_id    text not null,
  day              date not null,
  minutes          int  not null default 0 check (minutes between 0 and 1440),
  timer_started_at timestamptz,
  description      text,
  project_id       uuid references projects(id) on delete set null,
  issue_id         uuid references issues(id) on delete set null,
  company_id       uuid references organizations(id) on delete set null,
  billable         boolean not null default false,
  rate             numeric(12,2) check (rate is null or rate >= 0),
  invoice_id       uuid references invoices(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_time_entries_ws_day on time_entries(workspace_id, day);
create index if not exists idx_time_entries_user on time_entries(workspace_id, privy_user_id, day);
create unique index if not exists uq_time_entries_running on time_entries(workspace_id, privy_user_id) where timer_started_at is not null;
alter table time_entries enable row level security;
revoke all on table time_entries from anon, authenticated;

create table if not exists leave_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  country      text,
  work_days    int[] not null default '{1,2,3,4,5}',   -- ISO weekdays, 1 = Monday
  updated_at   timestamptz not null default now()
);
alter table leave_settings enable row level security;
revoke all on table leave_settings from anon, authenticated;

create table if not exists leave_types (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  name           text not null,
  color          text not null default '#22c55e',
  paid           boolean not null default true,
  -- Days per year; NULL = counted but not capped (sick leave).
  allowance_days numeric(5,1) check (allowance_days is null or allowance_days between 0 and 366),
  needs_approval boolean not null default true,
  position       int not null default 0,
  archived       boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists idx_leave_types_ws on leave_types(workspace_id);
alter table leave_types enable row level security;
revoke all on table leave_types from anon, authenticated;

create table if not exists leave_allowances (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id) on delete cascade,
  privy_user_id text not null,
  year          int  not null check (year between 2000 and 2100),
  days          numeric(5,1) not null check (days between 0 and 366),
  primary key (leave_type_id, privy_user_id, year)
);
alter table leave_allowances enable row level security;
revoke all on table leave_allowances from anon, authenticated;

create table if not exists public_holidays (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  day          date not null,
  name         text not null,
  primary key (workspace_id, day)
);
alter table public_holidays enable row level security;
revoke all on table public_holidays from anon, authenticated;

create table if not exists leave_requests (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  privy_user_id text not null,
  leave_type_id uuid not null references leave_types(id),
  start_date    date not null,
  end_date      date not null,
  half_start    boolean not null default false,
  half_end      boolean not null default false,
  days          numeric(6,1) not null default 0,
  note          text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by    text,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 366)
);
create index if not exists idx_leave_requests_ws on leave_requests(workspace_id, start_date);
create index if not exists idx_leave_requests_user on leave_requests(workspace_id, privy_user_id);
alter table leave_requests enable row level security;
revoke all on table leave_requests from anon, authenticated;

-- ── Helpers ─────────────────────────────────────────────────────────────────

create or replace function time_is_admin(p_privy text, p_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(workspace_role(p_privy, p_workspace), '') in ('owner', 'admin');
$$;

create or replace function time_member_name(p_workspace uuid, p_privy text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(a.full_name, ''), split_part(a.email, '@', 1), 'Someone')
    from accounts a where a.workspace_id = p_workspace and a.privy_user_id = p_privy
   order by a.created_at limit 1;
$$;

create or replace function leave_work_days(p_workspace uuid)
returns int[] language sql stable security definer set search_path = public as $$
  select coalesce((select work_days from leave_settings where workspace_id = p_workspace), '{1,2,3,4,5}'::int[]);
$$;

-- Working days in [start, end]: the work week minus public holidays. A half
-- day at either end takes half off — on a one-day request, half of that day.
create or replace function leave_working_days(p_workspace uuid, p_start date, p_end date, p_half_start boolean, p_half_end boolean)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_wd int[] := leave_work_days(p_workspace); v_n numeric;
        v_start_work boolean; v_end_work boolean;
begin
  if p_end < p_start then return 0; end if;
  select count(*) into v_n
    from generate_series(p_start, p_end, interval '1 day') d
   where extract(isodow from d)::int = any(v_wd)
     and not exists (select 1 from public_holidays h where h.workspace_id = p_workspace and h.day = d::date);
  v_start_work := extract(isodow from p_start)::int = any(v_wd)
                  and not exists (select 1 from public_holidays h where h.workspace_id = p_workspace and h.day = p_start);
  v_end_work := extract(isodow from p_end)::int = any(v_wd)
                and not exists (select 1 from public_holidays h where h.workspace_id = p_workspace and h.day = p_end);
  if p_start = p_end then
    return case when v_start_work and (p_half_start or p_half_end) then 0.5 else v_n end;
  end if;
  if p_half_start and v_start_work then v_n := v_n - 0.5; end if;
  if p_half_end and v_end_work then v_n := v_n - 0.5; end if;
  return greatest(v_n, 0);
end $$;

-- Working days of a request that fall inside one calendar year (a request
-- across New Year counts against both years, each its own part).
create or replace function leave_days_in_year(r leave_requests, p_year int)
returns numeric language sql stable security definer set search_path = public as $$
  select case
    when r.end_date < make_date(p_year, 1, 1) or r.start_date > make_date(p_year, 12, 31) then 0
    when r.start_date >= make_date(p_year, 1, 1) and r.end_date <= make_date(p_year, 12, 31) then r.days
    else leave_working_days(r.workspace_id,
           greatest(r.start_date, make_date(p_year, 1, 1)), least(r.end_date, make_date(p_year, 12, 31)),
           r.half_start and r.start_date >= make_date(p_year, 1, 1),
           r.half_end and r.end_date <= make_date(p_year, 12, 31))
  end;
$$;

-- The default types, once, the first time a workspace opens Time off.
create or replace function leave_seed_types(p_workspace uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from leave_types where workspace_id = p_workspace) then return; end if;
  insert into leave_types (workspace_id, name, color, paid, allowance_days, needs_approval, position) values
    (p_workspace, 'Vacation',     '#22c55e', true,  20,   true,  0),
    (p_workspace, 'Sick leave',   '#f97316', true,  null, false, 1),
    (p_workspace, 'Unpaid leave', '#94a3b8', false, null, true,  2),
    (p_workspace, 'Other',        '#8b5cf6', true,  null, true,  3);
end $$;

create or replace function leave_allowance(p_type leave_types, p_user text, p_year int)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select a.days from leave_allowances a
                    where a.leave_type_id = p_type.id and a.privy_user_id = p_user and a.year = p_year),
                  p_type.allowance_days);
$$;

-- One person's balance per type for a year.
create or replace function leave_balances(p_workspace uuid, p_user text, p_year int)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'type_id', t.id, 'name', t.name, 'color', t.color,
           'allowance', leave_allowance(t, p_user, p_year),
           'overridden', exists (select 1 from leave_allowances a where a.leave_type_id = t.id and a.privy_user_id = p_user and a.year = p_year),
           'used', coalesce((select sum(leave_days_in_year(r, p_year)) from leave_requests r
                              where r.leave_type_id = t.id and r.privy_user_id = p_user and r.status = 'approved'), 0),
           'pending', coalesce((select sum(leave_days_in_year(r, p_year)) from leave_requests r
                              where r.leave_type_id = t.id and r.privy_user_id = p_user and r.status = 'pending'), 0))
           order by t.position, t.created_at), '[]'::jsonb)
    from leave_types t where t.workspace_id = p_workspace and not t.archived;
$$;

-- Recount `days` on every live request from a date on — after the holidays
-- or the work week change. Bookkeeping, so no automation fires on it.
create or replace function leave_recount(p_workspace uuid, p_from date)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.automation_depth', '1', true);
  update leave_requests r
     set days = leave_working_days(r.workspace_id, r.start_date, r.end_date, r.half_start, r.half_end)
   where r.workspace_id = p_workspace and r.status in ('pending', 'approved') and r.end_date >= p_from;
end $$;

-- A request in the shape a screen or an email needs. `p_full` = may see the
-- type and the note (the person, or an owner/admin).
create or replace function leave_request_json(r leave_requests, p_full boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'user', r.privy_user_id, 'name', time_member_name(r.workspace_id, r.privy_user_id),
    'start_date', r.start_date, 'end_date', r.end_date, 'half_start', r.half_start, 'half_end', r.half_end,
    'days', r.days, 'status', r.status, 'created_at', r.created_at, 'decided_at', r.decided_at,
    'decided_by_name', case when r.decided_by is not null then time_member_name(r.workspace_id, r.decided_by) end)
  || case when p_full then jsonb_build_object(
    'type_id', r.leave_type_id,
    'type', (select t.name from leave_types t where t.id = r.leave_type_id),
    'color', (select t.color from leave_types t where t.id = r.leave_type_id),
    'note', r.note, 'decision_note', r.decision_note) else '{}'::jsonb end;
$$;

-- ── Time off: reads ─────────────────────────────────────────────────────────

-- Everything the Time off screen needs for one year, in one call.
create or replace function get_time_off(p_privy text, p_workspace uuid, p_year int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_admin boolean; v_year int := coalesce(p_year, extract(year from now())::int);
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  v_admin := time_is_admin(p_privy, p_workspace);
  perform leave_seed_types(p_workspace);
  return jsonb_build_object(
    'year', v_year,
    'is_admin', v_admin,
    'me', p_privy,
    'settings', jsonb_build_object(
      'country', (select country from leave_settings where workspace_id = p_workspace),
      'work_days', to_jsonb(leave_work_days(p_workspace))),
    'types', coalesce((select jsonb_agg(to_jsonb(t) - 'workspace_id' order by t.position, t.created_at)
                         from leave_types t where t.workspace_id = p_workspace), '[]'::jsonb),
    'holidays', coalesce((select jsonb_agg(jsonb_build_object('day', h.day, 'name', h.name) order by h.day)
                            from public_holidays h where h.workspace_id = p_workspace
                             and h.day between make_date(v_year, 1, 1) - 31 and make_date(v_year, 12, 31) + 31), '[]'::jsonb),
    'balances', leave_balances(p_workspace, p_privy, v_year),
    'mine', coalesce((select jsonb_agg(leave_request_json(r, true) order by r.start_date desc)
                        from leave_requests r where r.workspace_id = p_workspace and r.privy_user_id = p_privy
                         and r.end_date >= make_date(v_year, 1, 1) - 31 and r.start_date <= make_date(v_year, 12, 31)), '[]'::jsonb),
    -- Who is off: everyone sees who and when; the type only the person and admins.
    'team', coalesce((select jsonb_agg(leave_request_json(r, v_admin or r.privy_user_id = p_privy) order by r.start_date)
                        from leave_requests r where r.workspace_id = p_workspace and r.status in ('approved', 'pending')
                         and (r.status = 'approved' or v_admin or r.privy_user_id = p_privy)
                         and r.end_date >= make_date(v_year, 1, 1) - 31 and r.start_date <= make_date(v_year, 12, 31) + 31), '[]'::jsonb),
    'pending', case when v_admin then coalesce((select jsonb_agg(leave_request_json(r, true) order by r.start_date)
                        from leave_requests r where r.workspace_id = p_workspace and r.status = 'pending'), '[]'::jsonb) end,
    'people', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object(
                        'user', a.privy_user_id, 'name', coalesce(nullif(a.full_name, ''), split_part(a.email, '@', 1)),
                        'role', a.role, 'balances', leave_balances(p_workspace, a.privy_user_id, v_year))
                        order by coalesce(nullif(a.full_name, ''), a.email))
                        from accounts a where a.workspace_id = p_workspace), '[]'::jsonb) end);
end $$;

-- ── Time off: writes ────────────────────────────────────────────────────────

-- Ask for time off — for yourself, or (owner/admin) for someone else. An admin
-- adding it, or a type that needs no approval (sick leave), is approved at
-- once. Over the allowance is refused for a member and allowed for an admin
-- who says so (`force`), because the person deciding is the one asking.
create or replace function request_leave(p_privy text, p_workspace uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_admin boolean := time_is_admin(p_privy, p_workspace);
        v_user text := coalesce(nullif(p_data->>'user', ''), p_privy);
        v_type leave_types; r leave_requests; v_days numeric; v_left numeric; v_year int;
        v_start date := nullif(p_data->>'start_date', '')::date;
        v_end date := coalesce(nullif(p_data->>'end_date', '')::date, nullif(p_data->>'start_date', '')::date);
        v_half_s boolean := coalesce((p_data->>'half_start')::boolean, false);
        v_half_e boolean := coalesce((p_data->>'half_end')::boolean, false);
        v_status text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if v_user <> p_privy and not v_admin then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from accounts where workspace_id = p_workspace and privy_user_id = v_user) then raise exception 'NOT_A_MEMBER'; end if;
  perform leave_seed_types(p_workspace);
  select * into v_type from leave_types where id = nullif(p_data->>'type_id', '')::uuid and workspace_id = p_workspace and not archived;
  if v_type.id is null then raise exception 'BAD_TYPE'; end if;
  if v_start is null or v_end < v_start then raise exception 'BAD_DATES'; end if;
  if v_end - v_start > 366 then raise exception 'TOO_LONG'; end if;
  v_days := leave_working_days(p_workspace, v_start, v_end, v_half_s, v_half_e);
  if v_days <= 0 then raise exception 'NO_WORKING_DAYS'; end if;
  if exists (select 1 from leave_requests x where x.workspace_id = p_workspace and x.privy_user_id = v_user
               and x.status in ('pending', 'approved') and x.start_date <= v_end and x.end_date >= v_start) then
    raise exception 'OVERLAPS';
  end if;
  -- The allowance, year by year (a request across New Year draws on both).
  if leave_allowance(v_type, v_user, extract(year from v_start)::int) is not null then
    for v_year in select generate_series(extract(year from v_start)::int, extract(year from v_end)::int) loop
      v_left := leave_allowance(v_type, v_user, v_year)
        - coalesce((select sum(leave_days_in_year(x, v_year)) from leave_requests x
                     where x.leave_type_id = v_type.id and x.privy_user_id = v_user and x.status in ('pending', 'approved')), 0);
      if leave_days_in_year(row(null, p_workspace, v_user, v_type.id, v_start, v_end, v_half_s, v_half_e, v_days,
                                null, 'pending', null, null, null, now(), now())::leave_requests, v_year) > v_left
         and not (v_admin and coalesce((p_data->>'force')::boolean, false)) then
        raise exception 'OVER_ALLOWANCE: % day(s) left in %', greatest(v_left, 0), v_year;
      end if;
    end loop;
  end if;
  v_status := case when v_admin or not v_type.needs_approval then 'approved' else 'pending' end;
  insert into leave_requests (workspace_id, privy_user_id, leave_type_id, start_date, end_date, half_start, half_end, days, note, status,
                              decided_by, decided_at)
  values (p_workspace, v_user, v_type.id, v_start, v_end, v_half_s, v_half_e, v_days,
          nullif(left(btrim(coalesce(p_data->>'note', '')), 1000), ''), v_status,
          -- decided_by names a PERSON who approved; a type that needs no
          -- approval was approved by nobody.
          case when v_status = 'approved' and v_admin then p_privy end, case when v_status = 'approved' then now() end)
  returning * into r;
  return leave_request_json(r, true) || jsonb_build_object(
    'needs_approval', v_status = 'pending',
    'email', (select a.email from accounts a where a.workspace_id = p_workspace and a.privy_user_id = v_user order by a.created_at limit 1),
    'approvers', case when v_status = 'pending' then coalesce((select jsonb_agg(distinct a.email) from accounts a
                   where a.workspace_id = p_workspace and a.role in ('owner', 'admin') and a.email is not null
                     and a.privy_user_id <> v_user), '[]'::jsonb) end,
    'workspace_name', (select w.name from workspaces w where w.id = p_workspace));
end $$;

create or replace function decide_leave(p_privy text, p_id uuid, p_status text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r leave_requests;
begin
  select * into r from leave_requests where id = p_id;
  if r.id is null or not is_workspace_member(r.workspace_id, p_privy) then raise exception 'NOT_FOUND'; end if;
  if not time_is_admin(p_privy, r.workspace_id) then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'BAD_STATUS'; end if;
  if r.status <> 'pending' then raise exception 'ALREADY_DECIDED'; end if;
  update leave_requests set status = p_status, decided_by = p_privy, decided_at = now(), updated_at = now(),
         decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where id = p_id returning * into r;
  return leave_request_json(r, true) || jsonb_build_object(
    'email', (select a.email from accounts a where a.workspace_id = r.workspace_id and a.privy_user_id = r.privy_user_id order by a.created_at limit 1),
    'workspace_name', (select w.name from workspaces w where w.id = r.workspace_id));
end $$;

-- Withdraw: your own request while it is pending or still ahead; an admin any.
create or replace function cancel_leave(p_privy text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r leave_requests; v_admin boolean;
begin
  select * into r from leave_requests where id = p_id;
  if r.id is null or not is_workspace_member(r.workspace_id, p_privy) then raise exception 'NOT_FOUND'; end if;
  v_admin := time_is_admin(p_privy, r.workspace_id);
  if r.privy_user_id <> p_privy and not v_admin then raise exception 'FORBIDDEN'; end if;
  if r.status not in ('pending', 'approved') then raise exception 'ALREADY_DECIDED'; end if;
  if r.status = 'approved' and r.start_date <= current_date and not v_admin then raise exception 'ALREADY_STARTED'; end if;
  update leave_requests set status = 'cancelled', updated_at = now() where id = p_id returning * into r;
  return leave_request_json(r, true) || jsonb_build_object(
    'cancelled_by_owner', r.privy_user_id = p_privy,
    'email', (select a.email from accounts a where a.workspace_id = r.workspace_id and a.privy_user_id = r.privy_user_id order by a.created_at limit 1),
    'workspace_name', (select w.name from workspaces w where w.id = r.workspace_id));
end $$;

create or replace function save_leave_settings(p_privy text, p_workspace uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days int[];
begin
  if not time_is_admin(p_privy, p_workspace) then raise exception 'FORBIDDEN'; end if;
  if p_data ? 'work_days' then
    select coalesce(array_agg(distinct d order by d), '{}') into v_days
      from (select (jsonb_array_elements_text(p_data->'work_days'))::int d) x where d between 1 and 7;
    if cardinality(v_days) = 0 then raise exception 'NO_WORK_DAYS'; end if;
  end if;
  insert into leave_settings (workspace_id, country, work_days)
  values (p_workspace, case when p_data ? 'country' then nullif(upper(left(p_data->>'country', 2)), '') end, coalesce(v_days, '{1,2,3,4,5}'))
  on conflict (workspace_id) do update set
    country = case when p_data ? 'country' then nullif(upper(left(p_data->>'country', 2)), '') else leave_settings.country end,
    work_days = case when p_data ? 'work_days' then v_days else leave_settings.work_days end,
    updated_at = now();
  if p_data ? 'work_days' then perform leave_recount(p_workspace, current_date - 366); end if;
  return jsonb_build_object('country', (select country from leave_settings where workspace_id = p_workspace),
                            'work_days', to_jsonb(leave_work_days(p_workspace)));
end $$;

create or replace function save_leave_type(p_privy text, p_workspace uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t leave_types; v_id uuid := nullif(p_data->>'id', '')::uuid;
begin
  if not time_is_admin(p_privy, p_workspace) then raise exception 'FORBIDDEN'; end if;
  if v_id is null then
    if nullif(btrim(coalesce(p_data->>'name', '')), '') is null then raise exception 'NAME_REQUIRED'; end if;
    insert into leave_types (workspace_id, name, position)
    values (p_workspace, left(btrim(p_data->>'name'), 60), coalesce((select max(position) + 1 from leave_types where workspace_id = p_workspace), 0))
    returning * into t;
  else
    select * into t from leave_types where id = v_id and workspace_id = p_workspace;
    if t.id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  update leave_types set
    name           = case when p_data ? 'name' and nullif(btrim(p_data->>'name'), '') is not null then left(btrim(p_data->>'name'), 60) else name end,
    color          = case when p_data ? 'color' and p_data->>'color' ~ '^#[0-9a-fA-F]{6}$' then p_data->>'color' else color end,
    paid           = case when p_data ? 'paid' then coalesce((p_data->>'paid')::boolean, true) else paid end,
    allowance_days = case when p_data ? 'allowance_days' then greatest(0, least(366, nullif(p_data->>'allowance_days', '')::numeric)) else allowance_days end,
    needs_approval = case when p_data ? 'needs_approval' then coalesce((p_data->>'needs_approval')::boolean, true) else needs_approval end,
    archived       = case when p_data ? 'archived' then coalesce((p_data->>'archived')::boolean, false) else archived end
  where id = t.id returning * into t;
  return to_jsonb(t) - 'workspace_id';
end $$;

-- Delete a type nobody has used; archive one that has history.
create or replace function delete_leave_type(p_privy text, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare t leave_types;
begin
  select * into t from leave_types where id = p_id;
  if t.id is null or not time_is_admin(p_privy, t.workspace_id) then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from leave_requests where leave_type_id = p_id) then
    update leave_types set archived = true where id = p_id;
    return 'archived';
  end if;
  delete from leave_types where id = p_id;
  return 'deleted';
end $$;

create or replace function set_leave_allowance(p_privy text, p_workspace uuid, p_user text, p_type uuid, p_year int, p_days numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not time_is_admin(p_privy, p_workspace) then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from leave_types where id = p_type and workspace_id = p_workspace) then raise exception 'BAD_TYPE'; end if;
  if not exists (select 1 from accounts where workspace_id = p_workspace and privy_user_id = p_user) then raise exception 'NOT_A_MEMBER'; end if;
  if p_days is null then
    delete from leave_allowances where leave_type_id = p_type and privy_user_id = p_user and year = p_year;
  else
    insert into leave_allowances (workspace_id, leave_type_id, privy_user_id, year, days)
    values (p_workspace, p_type, p_user, p_year, greatest(0, least(366, p_days)))
    on conflict (leave_type_id, privy_user_id, year) do update set days = excluded.days;
  end if;
end $$;

-- Replace one year's public holidays ([{day, name}]), then recount.
create or replace function set_public_holidays(p_privy text, p_workspace uuid, p_year int, p_days jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not time_is_admin(p_privy, p_workspace) then raise exception 'FORBIDDEN'; end if;
  if p_year not between 2000 and 2100 then raise exception 'BAD_YEAR'; end if;
  delete from public_holidays where workspace_id = p_workspace and extract(year from day)::int = p_year;
  insert into public_holidays (workspace_id, day, name)
  select p_workspace, (e->>'day')::date, left(btrim(coalesce(nullif(e->>'name', ''), 'Holiday')), 80)
    from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) e
   where e->>'day' ~ '^\d{4}-\d{2}-\d{2}$' and extract(year from (e->>'day')::date)::int = p_year
  on conflict (workspace_id, day) do update set name = excluded.name;
  get diagnostics v_n = row_count;
  perform leave_recount(p_workspace, make_date(p_year, 1, 1));
  return v_n;
end $$;

-- ── Timesheets ──────────────────────────────────────────────────────────────

create or replace function time_entry_json(e time_entries)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(e) - 'workspace_id' || jsonb_build_object(
    'name', time_member_name(e.workspace_id, e.privy_user_id),
    'project', (select p.name from projects p where p.id = e.project_id),
    'project_color', (select p.color from projects p where p.id = e.project_id),
    'issue', (select i.title from issues i where i.id = e.issue_id),
    'company', (select o.name from organizations o where o.id = e.company_id),
    'invoice_number', (select v.number from invoices v where v.id = e.invoice_id),
    -- What a running timer shows right now, so a screen opened mid-timer is right.
    'running_minutes', case when e.timer_started_at is not null
      then least(1440, e.minutes + round(extract(epoch from now() - e.timer_started_at) / 60)::int) end);
$$;

-- p_user: NULL = mine; '*' = everyone (owner/admin); a privy id = that person (owner/admin).
create or replace function get_time_entries(p_privy text, p_workspace uuid, p_from date, p_to date, p_user text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_user text := nullif(p_user, '');
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if v_user is not null and v_user <> p_privy and not time_is_admin(p_privy, p_workspace) then raise exception 'FORBIDDEN'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'BAD_RANGE'; end if;
  return jsonb_build_object(
    'entries', coalesce((select jsonb_agg(time_entry_json(e) order by e.day, e.created_at)
                           from time_entries e
                          where e.workspace_id = p_workspace and e.day between p_from and p_to
                            and (v_user = '*' or e.privy_user_id = coalesce(v_user, p_privy))), '[]'::jsonb),
    'running', (select time_entry_json(e) from time_entries e
                 where e.workspace_id = p_workspace and e.privy_user_id = p_privy and e.timer_started_at is not null),
    'is_admin', time_is_admin(p_privy, p_workspace),
    'people', case when time_is_admin(p_privy, p_workspace) then coalesce((select jsonb_agg(jsonb_build_object(
                'user', a.privy_user_id, 'name', coalesce(nullif(a.full_name, ''), split_part(a.email, '@', 1)))
                order by coalesce(nullif(a.full_name, ''), a.email))
                from accounts a where a.workspace_id = p_workspace), '[]'::jsonb) end);
end $$;

-- Checks that the project, issue and company named in p_data are this workspace's.
create or replace function time_check_refs(p_workspace uuid, p_data jsonb)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if nullif(p_data->>'project_id', '') is not null and not exists
     (select 1 from projects where id = (p_data->>'project_id')::uuid and workspace_id = p_workspace) then raise exception 'BAD_PROJECT'; end if;
  if nullif(p_data->>'issue_id', '') is not null and not exists
     (select 1 from issues where id = (p_data->>'issue_id')::uuid and workspace_id = p_workspace) then raise exception 'BAD_ISSUE'; end if;
  if nullif(p_data->>'company_id', '') is not null and not exists
     (select 1 from organizations where id = (p_data->>'company_id')::uuid and workspace_id = p_workspace) then raise exception 'BAD_COMPANY'; end if;
end $$;

-- Create (no id) or edit. Keys absent are left alone (0088's rule). Your own
-- entries, or anyone's for an owner/admin; an invoiced entry is locked.
create or replace function save_time_entry(p_privy text, p_workspace uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e time_entries; v_id uuid := nullif(p_data->>'id', '')::uuid;
        v_admin boolean := time_is_admin(p_privy, p_workspace);
        v_user text := coalesce(nullif(p_data->>'user', ''), p_privy);
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(workspace_role(p_privy, p_workspace), '') = 'viewer' then raise exception 'FORBIDDEN'; end if;
  perform time_check_refs(p_workspace, p_data);
  if v_id is null then
    if v_user <> p_privy and not v_admin then raise exception 'FORBIDDEN'; end if;
    if not exists (select 1 from accounts where workspace_id = p_workspace and privy_user_id = v_user) then raise exception 'NOT_A_MEMBER'; end if;
    if nullif(p_data->>'day', '') is null then raise exception 'DAY_REQUIRED'; end if;
    insert into time_entries (workspace_id, privy_user_id, day) values (p_workspace, v_user, (p_data->>'day')::date)
    returning * into e;
  else
    select * into e from time_entries where id = v_id and workspace_id = p_workspace;
    if e.id is null then raise exception 'NOT_FOUND'; end if;
    if e.privy_user_id <> p_privy and not v_admin then raise exception 'FORBIDDEN'; end if;
    if e.invoice_id is not null then raise exception 'INVOICED'; end if;
  end if;
  update time_entries set
    day         = case when p_data ? 'day' and nullif(p_data->>'day', '') is not null then (p_data->>'day')::date else day end,
    minutes     = case when p_data ? 'minutes' then greatest(0, least(1440, coalesce(nullif(p_data->>'minutes', '')::numeric, 0)::int)) else minutes end,
    description = case when p_data ? 'description' then nullif(left(btrim(coalesce(p_data->>'description', '')), 500), '') else description end,
    project_id  = case when p_data ? 'project_id' then nullif(p_data->>'project_id', '')::uuid else project_id end,
    issue_id    = case when p_data ? 'issue_id' then nullif(p_data->>'issue_id', '')::uuid else issue_id end,
    company_id  = case when p_data ? 'company_id' then nullif(p_data->>'company_id', '')::uuid else company_id end,
    billable    = case when p_data ? 'billable' then coalesce((p_data->>'billable')::boolean, false) else billable end,
    rate        = case when p_data ? 'rate' then greatest(0, nullif(p_data->>'rate', '')::numeric) else rate end,
    updated_at  = now()
  where id = e.id returning * into e;
  return time_entry_json(e);
end $$;

create or replace function delete_time_entry(p_privy text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e time_entries;
begin
  select * into e from time_entries where id = p_id;
  if e.id is null or not is_workspace_member(e.workspace_id, p_privy) then raise exception 'NOT_FOUND'; end if;
  if e.privy_user_id <> p_privy and not time_is_admin(p_privy, e.workspace_id) then raise exception 'FORBIDDEN'; end if;
  if e.invoice_id is not null then raise exception 'INVOICED'; end if;
  delete from time_entries where id = p_id;
end $$;

-- Stop my running timer, if any: the elapsed minutes are added to the entry.
create or replace function stop_timer(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e time_entries;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update time_entries
     set minutes = least(1440, minutes + greatest(1, round(extract(epoch from now() - timer_started_at) / 60)::int)),
         timer_started_at = null, updated_at = now()
   where workspace_id = p_workspace and privy_user_id = p_privy and timer_started_at is not null
  returning * into e;
  return case when e.id is null then null else time_entry_json(e) end;
end $$;

-- Start a timer: stops the running one first. With `id`, continues that entry
-- (on today's date it keeps adding to it; on another day a copy for today
-- starts, so yesterday's total is not rewritten). `day` is the caller's date.
create or replace function start_timer(p_privy text, p_workspace uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e time_entries; src time_entries; v_day date := coalesce(nullif(p_data->>'day', '')::date, current_date);
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(workspace_role(p_privy, p_workspace), '') = 'viewer' then raise exception 'FORBIDDEN'; end if;
  perform stop_timer(p_privy, p_workspace);
  if nullif(p_data->>'id', '') is not null then
    select * into src from time_entries where id = (p_data->>'id')::uuid and workspace_id = p_workspace and privy_user_id = p_privy;
    if src.id is null then raise exception 'NOT_FOUND'; end if;
    if src.day = v_day and src.invoice_id is null and src.minutes < 1440 then
      update time_entries set timer_started_at = now(), updated_at = now() where id = src.id returning * into e;
      return time_entry_json(e);
    end if;
    insert into time_entries (workspace_id, privy_user_id, day, timer_started_at, description, project_id, issue_id, company_id, billable, rate)
    values (p_workspace, p_privy, v_day, now(), src.description, src.project_id, src.issue_id, src.company_id, src.billable, src.rate)
    returning * into e;
    return time_entry_json(e);
  end if;
  perform time_check_refs(p_workspace, p_data);
  insert into time_entries (workspace_id, privy_user_id, day, timer_started_at, description, project_id, issue_id, company_id, billable, rate)
  values (p_workspace, p_privy, v_day, now(), nullif(left(btrim(coalesce(p_data->>'description', '')), 500), ''),
          nullif(p_data->>'project_id', '')::uuid, nullif(p_data->>'issue_id', '')::uuid, nullif(p_data->>'company_id', '')::uuid,
          coalesce((p_data->>'billable')::boolean, false), greatest(0, nullif(p_data->>'rate', '')::numeric))
  returning * into e;
  return time_entry_json(e);
end $$;

-- Billable hours → a draft invoice for one client, in one transaction.
-- p_group 'project' = a line per project and rate; 'entry' = a line per entry.
create or replace function invoice_time_entries(p_privy text, p_workspace uuid, p_company uuid, p_ids uuid[], p_rate numeric, p_group text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int; v_inv uuid; v_items jsonb; v_total numeric; v_number text; v_minutes int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(workspace_role(p_privy, p_workspace), '') = 'viewer' then raise exception 'FORBIDDEN'; end if;
  if not exists (select 1 from organizations where id = p_company and workspace_id = p_workspace) then raise exception 'BAD_COMPANY'; end if;
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'NOTHING_TO_BILL'; end if;
  -- Lock the rows: two people pressing the button at once bill once.
  perform 1 from time_entries where id = any(p_ids) for update;
  select count(*) into v_n from time_entries e
   where e.id = any(p_ids) and e.workspace_id = p_workspace and e.company_id = p_company
     and e.billable and e.invoice_id is null and e.timer_started_at is null and e.minutes > 0;
  if v_n <> cardinality(p_ids) then raise exception 'ENTRIES_CHANGED'; end if;
  if exists (select 1 from time_entries e where e.id = any(p_ids) and e.rate is null) and (p_rate is null or p_rate <= 0) then
    raise exception 'RATE_REQUIRED';
  end if;

  if coalesce(p_group, 'project') = 'entry' then
    select jsonb_agg(jsonb_build_object(
             'description', left(to_char(e.day, 'YYYY-MM-DD') || ' · ' ||
               coalesce(nullif(e.description, ''), (select p.name from projects p where p.id = e.project_id), 'Work'), 500),
             'quantity', round(e.minutes / 60.0, 2), 'unit_price', coalesce(e.rate, p_rate))
             order by e.day, e.created_at)
      into v_items from time_entries e where e.id = any(p_ids);
  else
    select jsonb_agg(jsonb_build_object('description', g.label, 'quantity', round(g.minutes / 60.0, 2), 'unit_price', g.rate) order by g.label)
      into v_items
      from (select coalesce((select p.name from projects p where p.id = e.project_id), 'Services') ||
                   ' — ' || to_char(min(e.day), 'DD Mon') ||
                   case when min(e.day) <> max(e.day) then '–' || to_char(max(e.day), 'DD Mon') else '' end as label,
                   sum(e.minutes) as minutes, coalesce(e.rate, p_rate) as rate
              from time_entries e where e.id = any(p_ids)
             group by e.project_id, coalesce(e.rate, p_rate)) g;
  end if;

  -- The next number after the highest INV-like one, the composer's rule.
  select case when m is null then 'INV-0001'
              else regexp_replace(m.number, '\d+$', '') || lpad(((regexp_match(m.number, '(\d+)$'))[1]::bigint + 1)::text,
                     length((regexp_match(m.number, '(\d+)$'))[1]), '0') end
    into v_number
    from (select 1) _ left join lateral (
      select i.number from invoices i
       where i.workspace_id = p_workspace and coalesce(i.direction, 'income') = 'income'
         and coalesce(i.kind, 'invoice') = 'invoice' and i.number ~ '\d+$'
       order by (regexp_match(i.number, '(\d+)$'))[1]::bigint desc limit 1) m on true;

  v_inv := create_record(p_privy, p_workspace, 'invoices', jsonb_build_object(
    'kind', 'invoice', 'direction', 'income', 'status', 'draft', 'number', v_number,
    'organization_id', p_company, 'issued_at', current_date, 'due_at', current_date + 14,
    'notes', 'Time from timesheets.'));
  v_total := save_invoice_items(p_privy, v_inv, v_items);
  perform set_config('app.automation_depth', '1', true);
  update time_entries set invoice_id = v_inv, updated_at = now() where id = any(p_ids);
  select sum(minutes) into v_minutes from time_entries where id = any(p_ids);
  return jsonb_build_object('invoice_id', v_inv, 'number', v_number, 'total', v_total,
                            'hours', round(v_minutes / 60.0, 2), 'entries', v_n);
end $$;

-- ── Booking pages respect time off (booking_busy redefined from 0135) ───────
-- Approved leave and the workspace's public holidays are whole days in the
-- zone of the host's (first) booking page.
create or replace function booking_busy(p_workspace uuid, p_host text, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with tz as (
    select coalesce((select bp.timezone from booking_pages bp where bp.workspace_id = p_workspace and bp.owner_privy = p_host
                      order by bp.created_at limit 1), 'UTC') as z
  ), busy as (
    select m.starts_at as s, m.ends_at as e
      from meetings m
     where m.workspace_id = p_workspace and m.host_privy = p_host and m.status = 'confirmed'
       and m.starts_at < p_to and m.ends_at > p_from
    union all
    select (d::date)::timestamp at time zone tz.z, ((d::date) + 1)::timestamp at time zone tz.z
      from leave_requests r, tz,
           generate_series(greatest(r.start_date, (p_from at time zone tz.z)::date - 1),
                           least(r.end_date, (p_to at time zone tz.z)::date + 1), interval '1 day') d
     where r.workspace_id = p_workspace and r.privy_user_id = p_host and r.status = 'approved'
       and r.start_date <= (p_to at time zone tz.z)::date + 1 and r.end_date >= (p_from at time zone tz.z)::date - 1
    union all
    select h.day::timestamp at time zone tz.z, (h.day + 1)::timestamp at time zone tz.z
      from public_holidays h, tz
     where h.workspace_id = p_workspace
       and h.day between (p_from at time zone tz.z)::date - 1 and (p_to at time zone tz.z)::date + 1
  )
  select coalesce(jsonb_agg(jsonb_build_array(s, e) order by s), '[]'::jsonb) from busy;
$$;

-- ── The calendar shows who is off (get_calendar redefined IN FULL from 0135) ─
create or replace function get_calendar(p_privy text, p_workspace uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := p_from::timestamptz; v_to timestamptz := (p_to + 1)::timestamptz;
        v_admin boolean; v_wd int[];
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_to < p_from or (p_to - p_from) > 400 then raise exception 'BAD_RANGE'; end if;
  v_admin := time_is_admin(p_privy, p_workspace);
  v_wd := leave_work_days(p_workspace);
  return coalesce((
    select jsonb_agg(x.ev order by x.ev->>'at')
    from (
      select jsonb_build_object(
               'kind', 'invoice', 'id', i.id,
               'title', coalesce(nullif(i.number,''), 'Invoice') ||
                        coalesce(' · ' || o.name, ''),
               'at', i.due_at, 'all_day', true,
               'amount', i.amount, 'status', i.status,
               'href', '/objects/invoices?ref=' || i.id) as ev
        from invoices i
        left join organizations o on o.id = i.organization_id
       where i.workspace_id = p_workspace
         and coalesce(i.direction,'income') = 'income'
         and coalesce(i.kind,'invoice') <> 'offer'
         and coalesce(i.status,'') <> 'paid'
         and i.due_at >= p_from and i.due_at <= p_to

      union all
      select jsonb_build_object(
               'kind', 'bill', 'id', i.id,
               'title', coalesce(nullif(i.number,''), 'Bill'),
               'at', i.due_at, 'all_day', true,
               'amount', i.amount, 'status', i.status,
               'href', '/objects/invoices?ref=' || i.id)
        from invoices i
       where i.workspace_id = p_workspace and i.direction = 'cost'
         and coalesce(i.kind,'invoice') <> 'offer'
         and coalesce(i.status,'') <> 'paid'
         and i.due_at >= p_from and i.due_at <= p_to

      union all
      select jsonb_build_object(
               'kind', 'issue', 'id', s.id, 'title', s.title,
               'at', s.due_date, 'all_day', true,
               'status', s.status, 'project', pr.name,
               'href', '/objects/issues?ref=' || s.id)
        from issues s
        left join projects pr on pr.id = s.project_id
       where s.workspace_id = p_workspace
         and coalesce(s.status,'') not in ('done','cancelled')
         and s.due_date >= p_from and s.due_date <= p_to

      union all
      select jsonb_build_object(
               'kind', 'post', 'id', p.id,
               'title', left(coalesce(nullif(p.content,''), 'Post'), 80),
               'at', p.scheduled_at, 'all_day', false,
               'status', p.status, 'platform', p.platform,
               'href', '/marketing/posts')
        from posts p
       where p.workspace_id = p_workspace
         and p.scheduled_at >= v_from and p.scheduled_at < v_to

      union all
      select jsonb_build_object(
               'kind', 'newsletter', 'id', n.id, 'title', coalesce(nullif(n.subject,''), 'Newsletter'),
               'at', n.scheduled_at, 'all_day', false, 'status', n.status,
               'href', '/marketing/newsletters')
        from newsletters n
       where n.workspace_id = p_workspace
         and n.scheduled_at >= v_from and n.scheduled_at < v_to

      union all
      select jsonb_build_object(
               'kind', 'campaign', 'id', c.id, 'title', c.name || ' starts',
               'at', c.starts_on, 'all_day', true,
               'href', '/objects/campaigns?ref=' || c.id)
        from campaigns c
       where c.workspace_id = p_workspace and c.starts_on >= p_from and c.starts_on <= p_to
      union all
      select jsonb_build_object(
               'kind', 'campaign', 'id', c.id, 'title', c.name || ' ends',
               'at', c.ends_on, 'all_day', true,
               'href', '/objects/campaigns?ref=' || c.id)
        from campaigns c
       where c.workspace_id = p_workspace and c.ends_on >= p_from and c.ends_on <= p_to

      union all
      -- Meetings: Cal.com bookings and booking pages (0135). A cancelled
      -- booking keeps its row (the history) but is not an event.
      select jsonb_build_object(
               'kind', 'meeting', 'id', m.id,
               'title', coalesce(nullif(m.title,''), 'Meeting') ||
                        case when m.source = 'booking' then '' else coalesce(' · ' || m.attendee_name, '') end,
               'at', m.starts_at, 'ends_at', m.ends_at, 'all_day', false,
               'join_url', m.join_url,
               'href', case when m.source = 'booking' then '/calendar/booking' else '/calendar' end)
        from meetings m
       where m.workspace_id = p_workspace
         and coalesce(m.status, 'confirmed') <> 'cancelled'
         and m.starts_at >= v_from and m.starts_at < v_to

      union all
      select jsonb_build_object(
               'kind', 'interview', 'id', iv.id,
               'title', 'Interview · ' || coalesce(nullif(ca.full_name,''), 'Candidate'),
               'at', iv.scheduled_at, 'all_day', false,
               'status', iv.status, 'join_url', iv.google_meet_link,
               'href', '/dashboard/interviews')
        from interviews iv
        join candidates ca on ca.id = iv.candidate_id
       where ca.company_id = p_workspace
         and coalesce(iv.status,'') <> 'cancelled'
         and iv.scheduled_at >= v_from and iv.scheduled_at < v_to

      union all
      select jsonb_build_object(
               'kind', 'deal', 'id', r.id,
               'title', coalesce(nullif(r.title,''), o.name, 'Deal') ||
                        case when nullif(r.title,'') is not null and o.name is not null then ' · ' || o.name else '' end,
               'at', r.close_date, 'all_day', true,
               'amount', r.amount, 'status', r.status,
               'href', '/pipelines/sales/board?view=calendar')
        from pipeline_records r
        join pipelines pl on pl.id = r.pipeline_id and pl.kind = 'sales'
        left join organizations o on o.id = r.company_id and o.workspace_id = p_workspace
       where r.workspace_id = p_workspace
         and r.status = 'active'
         and r.close_date >= p_from and r.close_date <= p_to

      union all
      -- Time off (0136): one chip per working day. Everybody sees WHO is off;
      -- the type (sick leave is health data) only the person and admins.
      select jsonb_build_object(
               'kind', 'leave', 'id', lr.id || ':' || d::date,
               'title', time_member_name(p_workspace, lr.privy_user_id) ||
                        case when v_admin or lr.privy_user_id = p_privy
                             then ' · ' || coalesce((select t.name from leave_types t where t.id = lr.leave_type_id), 'Off')
                             else ' · Off' end,
               'at', d::date, 'all_day', true, 'status', lr.status,
               'href', '/time/off')
        from leave_requests lr,
             generate_series(greatest(lr.start_date, p_from), least(lr.end_date, p_to), interval '1 day') d
       where lr.workspace_id = p_workspace and lr.status = 'approved'
         and lr.start_date <= p_to and lr.end_date >= p_from
         and extract(isodow from d)::int = any(v_wd)
         and not exists (select 1 from public_holidays h where h.workspace_id = p_workspace and h.day = d::date)

      union all
      select jsonb_build_object(
               'kind', 'holiday', 'id', 'holiday:' || h.day, 'title', h.name,
               'at', h.day, 'all_day', true, 'href', '/time/off')
        from public_holidays h
       where h.workspace_id = p_workspace and h.day >= p_from and h.day <= p_to
    ) x
  ), '[]'::jsonb);
end $$;

-- ── Automations: "when time off is requested / approved" ────────────────────
-- automation_payload and automation_sample_row redefined IN FULL from 0135.
create or replace function automation_payload(p_slug text, p_table text, p_row jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := coalesce(p_row, '{}'::jsonb) - 'token_hash' - 'access_token' - 'key_hash'
                   - 'secret' - 'webhook_token' - 'resume_tsv' - 'resume_raw_text' - 'search_tsv' - 'fts';
begin
  if p_table = 'custom_records' then
    return coalesce(v->'data', '{}'::jsonb) || jsonb_build_object(
      'id', v->'id', 'created_at', v->'created_at', 'updated_at', v->'updated_at');
  elsif p_table = 'form_submissions' then
    return coalesce(v->'data', '{}'::jsonb) || jsonb_build_object(
      'id', v->'id', 'person_id', v->'person_id', 'created_at', v->'created_at',
      'form', (select f.name from forms f where f.id = (v->>'form_id')::uuid));
  elsif p_table = 'pipeline_records' then
    return v || jsonb_build_object(
      'stage', (select s.name from pipeline_stages s where s.id = (v->>'stage_id')::uuid),
      'company', (select o.name from organizations o where o.id = (v->>'company_id')::uuid),
      'pipeline', (select p.kind from pipelines p where p.id = (v->>'pipeline_id')::uuid));
  elsif p_table = 'support_conversations' then
    return v || jsonb_build_object('message', v->'subject');
  elsif p_table = 'candidates' then
    return v || jsonb_build_object('position',
      (select po.title from positions po where po.id = (v->>'position_id')::uuid));
  elsif p_table = 'meetings' then
    -- The raw Cal.com payload stays out: it is long and holds the attendee's
    -- answers to someone else's form.
    return (v - 'raw') || jsonb_build_object(
      'name', v->'attendee_name', 'email', v->'attendee_email', 'phone', v->'attendee_phone',
      'company', v->'attendee_company', 'start', v->'starts_at', 'end', v->'ends_at',
      'page', (select bp.title from booking_pages bp where bp.id = nullif(v->>'booking_page_id','')::uuid));
  elsif p_table = 'leave_requests' then
    -- The person's name and the type; the note stays out (it may say why).
    return jsonb_build_object(
      'id', v->'id', 'name', time_member_name((v->>'workspace_id')::uuid, v->>'privy_user_id'),
      'type', (select t.name from leave_types t where t.id = nullif(v->>'leave_type_id','')::uuid),
      'start', v->'start_date', 'end', v->'end_date', 'days', v->'days', 'status', v->'status',
      'created_at', v->'created_at', 'updated_at', v->'updated_at');
  elsif v ? 'organization_id' then
    return v || jsonb_build_object('company',
      coalesce((select o.name from organizations o where o.id = (v->>'organization_id')::uuid), v->>'company'));
  end if;
  return v;
end $$;

create or replace function automation_sample_row(p_workspace uuid, p_object text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_table text;
begin
  case p_object
    when 'companies' then select to_jsonb(t), 'organizations' into v, v_table from organizations t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'people' then select to_jsonb(t), 'people' into v, v_table from people t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'invoices' then select to_jsonb(t), 'invoices' into v, v_table from invoices t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'expenses' then select to_jsonb(t), 'expenses' into v, v_table from expenses t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'transactions' then select to_jsonb(t), 'transactions' into v, v_table from transactions t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'products' then select to_jsonb(t), 'products' into v, v_table from products t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'campaigns' then select to_jsonb(t), 'campaigns' into v, v_table from campaigns t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'projects' then select to_jsonb(t), 'projects' into v, v_table from projects t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'issues' then select to_jsonb(t), 'issues' into v, v_table from issues t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'assets' then select to_jsonb(t), 'assets' into v, v_table from assets t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'deals' then select to_jsonb(t), 'pipeline_records' into v, v_table from pipeline_records t
                       join pipelines p on p.id = t.pipeline_id and p.kind = 'sales'
                      where t.workspace_id = p_workspace order by t.created_at desc limit 1;
    when 'orders' then select to_jsonb(t), 'orders' into v, v_table from orders t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'form_submissions' then select to_jsonb(t), 'form_submissions' into v, v_table from form_submissions t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'conversations' then select to_jsonb(t), 'support_conversations' into v, v_table from support_conversations t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'bookings' then select to_jsonb(t), 'meetings' into v, v_table from meetings t where workspace_id = p_workspace order by created_at desc nulls last limit 1;
    when 'time_off' then select to_jsonb(t), 'leave_requests' into v, v_table from leave_requests t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'candidates' then select to_jsonb(t), 'candidates' into v, v_table from candidates t where company_id = p_workspace order by applied_at desc limit 1;
    else
      select to_jsonb(t), 'custom_records' into v, v_table from custom_records t
        join custom_objects o on o.id = t.object_id and o.workspace_id = p_workspace and o.slug = p_object
       where t.workspace_id = p_workspace order by t.created_at desc limit 1;
  end case;
  if v is null then return null; end if;
  return automation_payload(p_object, v_table, v);
end $$;

do $$ begin
  drop trigger if exists trg_autoevt_leave_requests on leave_requests;
  create trigger trg_autoevt_leave_requests after insert or update on leave_requests
    for each row execute function emit_automation_event('time_off');
end $$;

-- ── Grants (0046 posture: service_role only — /api/rpc and /api/time-off) ───
revoke all on function time_is_admin(text, uuid) from public, anon, authenticated;
revoke all on function time_member_name(uuid, text) from public, anon, authenticated;
revoke all on function leave_work_days(uuid) from public, anon, authenticated;
revoke all on function leave_working_days(uuid, date, date, boolean, boolean) from public, anon, authenticated;
revoke all on function leave_days_in_year(leave_requests, int) from public, anon, authenticated;
revoke all on function leave_seed_types(uuid) from public, anon, authenticated;
revoke all on function leave_allowance(leave_types, text, int) from public, anon, authenticated;
revoke all on function leave_balances(uuid, text, int) from public, anon, authenticated;
revoke all on function leave_recount(uuid, date) from public, anon, authenticated;
revoke all on function leave_request_json(leave_requests, boolean) from public, anon, authenticated;
revoke all on function get_time_off(text, uuid, int) from public, anon, authenticated;
revoke all on function request_leave(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function decide_leave(text, uuid, text, text) from public, anon, authenticated;
revoke all on function cancel_leave(text, uuid) from public, anon, authenticated;
revoke all on function save_leave_settings(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function save_leave_type(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function delete_leave_type(text, uuid) from public, anon, authenticated;
revoke all on function set_leave_allowance(text, uuid, text, uuid, int, numeric) from public, anon, authenticated;
revoke all on function set_public_holidays(text, uuid, int, jsonb) from public, anon, authenticated;
revoke all on function time_entry_json(time_entries) from public, anon, authenticated;
revoke all on function get_time_entries(text, uuid, date, date, text) from public, anon, authenticated;
revoke all on function time_check_refs(uuid, jsonb) from public, anon, authenticated;
revoke all on function save_time_entry(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function delete_time_entry(text, uuid) from public, anon, authenticated;
revoke all on function stop_timer(text, uuid) from public, anon, authenticated;
revoke all on function start_timer(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function invoice_time_entries(text, uuid, uuid, uuid[], numeric, text) from public, anon, authenticated;
revoke all on function booking_busy(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function get_calendar(text, uuid, date, date) from public, anon, authenticated;
revoke all on function automation_payload(text, text, jsonb) from public, anon, authenticated;
revoke all on function automation_sample_row(uuid, text) from public, anon, authenticated;
grant execute on function time_is_admin(text, uuid) to service_role;
grant execute on function time_member_name(uuid, text) to service_role;
grant execute on function leave_work_days(uuid) to service_role;
grant execute on function leave_working_days(uuid, date, date, boolean, boolean) to service_role;
grant execute on function leave_days_in_year(leave_requests, int) to service_role;
grant execute on function leave_seed_types(uuid) to service_role;
grant execute on function leave_allowance(leave_types, text, int) to service_role;
grant execute on function leave_balances(uuid, text, int) to service_role;
grant execute on function leave_recount(uuid, date) to service_role;
grant execute on function leave_request_json(leave_requests, boolean) to service_role;
grant execute on function get_time_off(text, uuid, int) to service_role;
grant execute on function request_leave(text, uuid, jsonb) to service_role;
grant execute on function decide_leave(text, uuid, text, text) to service_role;
grant execute on function cancel_leave(text, uuid) to service_role;
grant execute on function save_leave_settings(text, uuid, jsonb) to service_role;
grant execute on function save_leave_type(text, uuid, jsonb) to service_role;
grant execute on function delete_leave_type(text, uuid) to service_role;
grant execute on function set_leave_allowance(text, uuid, text, uuid, int, numeric) to service_role;
grant execute on function set_public_holidays(text, uuid, int, jsonb) to service_role;
grant execute on function time_entry_json(time_entries) to service_role;
grant execute on function get_time_entries(text, uuid, date, date, text) to service_role;
grant execute on function time_check_refs(uuid, jsonb) to service_role;
grant execute on function save_time_entry(text, uuid, jsonb) to service_role;
grant execute on function delete_time_entry(text, uuid) to service_role;
grant execute on function stop_timer(text, uuid) to service_role;
grant execute on function start_timer(text, uuid, jsonb) to service_role;
grant execute on function invoice_time_entries(text, uuid, uuid, uuid[], numeric, text) to service_role;
grant execute on function booking_busy(uuid, text, timestamptz, timestamptz) to service_role;
grant execute on function get_calendar(text, uuid, date, date) to service_role;
grant execute on function automation_payload(text, text, jsonb) to service_role;
grant execute on function automation_sample_row(uuid, text) to service_role;

notify pgrst, 'reload schema';
