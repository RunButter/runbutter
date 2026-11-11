-- ============================================================================
-- 0139_fix_dead_columns.sql — three functions that referenced columns which do
-- not exist, found by calling every function in a fresh database.
--
-- plpgsql does not plan a function body when it is CREATED, only when it RUNS,
-- so each of these applied cleanly, passed CI from empty, and then failed the
-- first time anything called it. All three were confirmed live in production
-- (prosrc read through the connector, 2026-11-11). Same class as 0107.
--
-- 1. hr_analytics_data (0041) selected `positions.status`. Positions have never
--    had one — they carry `is_active` — so HR → Analytics raised
--    `column "status" does not exist` on EVERY load and the screen showed
--    nothing. It now reports status derived from is_active.
--
-- 2. cal_log_meeting (0056) matched an attendee to a candidate ordering by
--    `candidates.created_at`, which does not exist (it is `applied_at` — the same
--    mistake 0107 fixed in get_nav_activity). Every Cal.com booking that carried
--    an email failed, so the webhook logged no meeting at all.
--
-- 3. due_invoice_reminders (0064) joined `companies` — the HR tenant table, which
--    has no email — to `invoices.organization_id`, whose foreign key points at
--    `organizations`. It raised `column c.email does not exist`, so overdue
--    reminders could never be sent. It now joins organizations, checked against
--    the invoice's own workspace. Its `limit` also sat on the aggregate (one
--    row), so it capped nothing; it is applied to the rows now.
-- ============================================================================

create or replace function hr_analytics_data(p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return null; end if;
  return jsonb_build_object(
    'company', (select to_jsonb(c) from (select * from companies where id = v_c) c),
    'positions', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', id, 'title', title,
                             'status', case when is_active then 'active' else 'closed' end))
                           from positions where company_id = v_c), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'status', status,
                            'source', source, 'position_id', position_id))
                            from candidates where company_id = v_c), '[]'::jsonb)
  );
end $$;

create or replace function cal_log_meeting(
  p_workspace uuid, p_external_id text, p_title text, p_name text, p_email text,
  p_starts timestamptz, p_ends timestamptz, p_join_url text, p_raw jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_candidate uuid; v_meeting uuid;
begin
  -- Attendee → existing candidate in this workspace's company (same uuid).
  if p_email is not null and p_email <> '' then
    select id into v_candidate from candidates
     where company_id = p_workspace and lower(email) = lower(p_email)
     order by applied_at desc nulls last limit 1;
  end if;

  insert into meetings (workspace_id, title, attendee_name, attendee_email, starts_at, ends_at,
                        join_url, source, external_id, candidate_id, raw)
  values (p_workspace, p_title, p_name, lower(nullif(p_email,'')), p_starts, p_ends,
          p_join_url, 'cal.com', nullif(p_external_id,''), v_candidate, p_raw)
  on conflict (workspace_id, external_id) where external_id is not null
    do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at,
                  join_url = excluded.join_url, title = excluded.title, raw = excluded.raw
  returning id into v_meeting;

  -- If it matched a candidate, also log an interview so it shows in HR.
  if v_candidate is not null and p_starts is not null then
    insert into interviews (candidate_id, scheduled_at, duration_minutes, status, notes,
                            google_meet_link, google_calendar_event_id)
    values (v_candidate, p_starts,
            greatest(1, coalesce(extract(epoch from (p_ends - p_starts))/60, 30))::int,
            'scheduled', 'Booked via Cal.com', p_join_url, 'cal:' || coalesce(p_external_id,''))
    on conflict do nothing;
    update candidates set status = 'interview_scheduled'
     where id = v_candidate and status not in ('hired','rejected','interview_scheduled');
  end if;

  return jsonb_build_object('ok', true, 'meeting_id', v_meeting, 'matched_candidate', v_candidate is not null);
end $$;

create or replace function due_invoice_reminders(p_workspace uuid, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(y) order by y.due_at), '[]'::jsonb) into v_out
  from (
    select x.* from (
      select i.id, i.number, i.amount, i.due_at, i.status,
             c.name  as company_name,
             c.email as company_email,
             (current_date - i.due_at::date) as days_overdue,
             s.subject, s.body, s.reply_to,
             (select max(o) from unnest(s.offsets) o
               where i.due_at::date + o <= current_date) as stage
      from invoices i
      join invoice_reminder_settings s on s.workspace_id = i.workspace_id
      left join organizations c on c.id = i.organization_id and c.workspace_id = i.workspace_id
      where i.workspace_id = p_workspace
        and s.enabled
        and i.direction = 'income'
        and i.status in ('sent', 'overdue')
        and i.due_at is not null
        and coalesce(i.kind, 'invoice') <> 'offer'
    ) x
    where x.stage is not null
      -- Idempotence: skip anything already logged at this stage.
      and not exists (
        select 1 from invoice_reminder_log l
        where l.invoice_id = x.id and l.stage = x.stage
      )
      -- No address, no reminder. Returning it would just produce a failed send.
      and nullif(x.company_email, '') is not null
    order by x.due_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) y;

  return v_out;
end $$;

revoke all on function hr_analytics_data(text) from public, anon, authenticated;
grant execute on function hr_analytics_data(text) to service_role;
revoke all on function cal_log_meeting(uuid, text, text, text, text, timestamptz, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function cal_log_meeting(uuid, text, text, text, text, timestamptz, timestamptz, text, jsonb) to service_role;
revoke all on function due_invoice_reminders(uuid, int) from public, anon, authenticated;
grant execute on function due_invoice_reminders(uuid, int) to service_role;

notify pgrst, 'reload schema';
