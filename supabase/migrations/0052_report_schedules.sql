-- ============================================================================
-- RunButter — 0052_report_schedules.sql
-- Scheduled PDF reports: pick a cadence, a time, recipients and which sections.
--
-- The section list is stored as plain text ids matching lib/reports/registry.ts.
-- Deliberately not a foreign key or an enum: the whole point is that adding a
-- report section later means appending one registry entry in code, with no
-- migration. Unknown ids are skipped at render time rather than rejected here,
-- so a schedule keeps working if a section is renamed or retired.
--
-- Times are stored as a plain hour plus an IANA timezone rather than a
-- timestamp, because "every Monday at 08:00 in Europe/Warsaw" has to survive
-- daylight saving. due_report_schedules() resolves that at dispatch time.
--
-- Additive & idempotent. Depends on 0051 (workspaces/accounts).
-- ============================================================================

create table if not exists report_schedules (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null default 'Business report',
  frequency    text not null default 'weekly' check (frequency in ('weekly','monthly')),
  day_of_week  int  not null default 1 check (day_of_week between 0 and 6),   -- 0=Sun, weekly only
  day_of_month int  not null default 1 check (day_of_month between 1 and 28), -- monthly only; 28 keeps every month valid
  hour         int  not null default 8 check (hour between 0 and 23),
  timezone     text not null default 'UTC',
  recipients   text[] not null default '{}',
  sections     text[] not null default '{}',
  enabled      boolean not null default true,
  last_sent_at timestamptz,
  created_by   text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists idx_report_schedules_ws on report_schedules(workspace_id);
alter table report_schedules enable row level security;
revoke all on table report_schedules from anon, authenticated;

-- ── Read / write, workspace-scoped ──────────────────────────────────────────
create or replace function get_report_schedules(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', r.id, 'name', r.name, 'frequency', r.frequency,
    'day_of_week', r.day_of_week, 'day_of_month', r.day_of_month,
    'hour', r.hour, 'timezone', r.timezone,
    'recipients', r.recipients, 'sections', r.sections,
    'enabled', r.enabled, 'last_sent_at', r.last_sent_at
  ) order by r.created_at) from report_schedules r where r.workspace_id = p_workspace), '[]'::jsonb);
end $$;

create or replace function save_report_schedule(
  p_privy text, p_workspace uuid, p_id uuid, p_name text, p_frequency text,
  p_day_of_week int, p_day_of_month int, p_hour int, p_timezone text,
  p_recipients text[], p_sections text[], p_enabled boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_role text; v_id uuid;
begin
  v_role := workspace_role(p_privy, p_workspace);
  if v_role is null or v_role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  if p_frequency not in ('weekly','monthly') then raise exception 'INVALID_FREQUENCY'; end if;
  if coalesce(array_length(p_recipients, 1), 0) = 0 then raise exception 'NO_RECIPIENTS'; end if;
  if coalesce(array_length(p_sections, 1), 0) = 0 then raise exception 'NO_SECTIONS'; end if;

  if p_id is null then
    insert into report_schedules (workspace_id, name, frequency, day_of_week, day_of_month,
                                  hour, timezone, recipients, sections, enabled, created_by)
    values (p_workspace, coalesce(nullif(p_name,''),'Business report'), p_frequency,
            coalesce(p_day_of_week,1), coalesce(p_day_of_month,1), coalesce(p_hour,8),
            coalesce(nullif(p_timezone,''),'UTC'), p_recipients, p_sections,
            coalesce(p_enabled, true), p_privy)
    returning id into v_id;
  else
    update report_schedules set
      name = coalesce(nullif(p_name,''),'Business report'), frequency = p_frequency,
      day_of_week = coalesce(p_day_of_week,1), day_of_month = coalesce(p_day_of_month,1),
      hour = coalesce(p_hour,8), timezone = coalesce(nullif(p_timezone,''),'UTC'),
      recipients = p_recipients, sections = p_sections,
      enabled = coalesce(p_enabled, true), updated_at = now()
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

create or replace function delete_report_schedule(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_role text; v_n int;
begin
  v_role := workspace_role(p_privy, p_workspace);
  if v_role is null or v_role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  delete from report_schedules where id = p_id and workspace_id = p_workspace;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- ── Dispatcher support ──────────────────────────────────────────────────────
-- Which schedules are due right now, in their own timezone? A schedule fires
-- when local time has reached its hour on the right day and it has not already
-- gone out this period — so a cron ticking every 15 minutes, or one that missed
-- a few beats, still sends exactly once.
create or replace function due_report_schedules()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'workspace_id', r.workspace_id, 'workspace_name', w.name,
      'name', r.name, 'frequency', r.frequency, 'sections', r.sections,
      'recipients', r.recipients,
      -- any member's DID: the report RPCs resolve tenancy from it
      'privy', (select a.privy_user_id from accounts a
                 where a.workspace_id = r.workspace_id
                 order by case a.role when 'owner' then 0 when 'admin' then 1 else 2 end
                 limit 1)
    ))
    from report_schedules r
    join workspaces w on w.id = r.workspace_id
    where r.enabled
      and extract(hour from (now() at time zone r.timezone)) >= r.hour
      and (
        (r.frequency = 'weekly'
          and extract(dow from (now() at time zone r.timezone)) = r.day_of_week
          and (r.last_sent_at is null or r.last_sent_at < now() - interval '6 days'))
        or
        (r.frequency = 'monthly'
          and extract(day from (now() at time zone r.timezone)) = r.day_of_month
          and (r.last_sent_at is null or r.last_sent_at < now() - interval '27 days'))
      )
  ), '[]'::jsonb);
end $$;

create or replace function mark_report_sent(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update report_schedules set last_sent_at = now() where id = p_id;
$$;

-- ── Grants (0046 posture) ───────────────────────────────────────────────────
revoke all on function get_report_schedules(text, uuid)                                            from public, anon, authenticated;
revoke all on function save_report_schedule(text, uuid, uuid, text, text, int, int, int, text, text[], text[], boolean) from public, anon, authenticated;
revoke all on function delete_report_schedule(text, uuid, uuid)                                    from public, anon, authenticated;
revoke all on function due_report_schedules()                                                      from public, anon, authenticated;
revoke all on function mark_report_sent(uuid)                                                      from public, anon, authenticated;
grant execute on function get_report_schedules(text, uuid)                                            to service_role;
grant execute on function save_report_schedule(text, uuid, uuid, text, text, int, int, int, text, text[], text[], boolean) to service_role;
grant execute on function delete_report_schedule(text, uuid, uuid)                                    to service_role;
grant execute on function due_report_schedules()                                                      to service_role;
grant execute on function mark_report_sent(uuid)                                                      to service_role;

notify pgrst, 'reload schema';
