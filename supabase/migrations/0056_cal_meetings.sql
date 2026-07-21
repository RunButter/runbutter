-- ============================================================================
-- RunButter — 0056_cal_meetings.sql
-- Cal.com connector (connect-not-copy: Cal.com is AGPL, so we integrate over its
-- webhook API rather than embedding any of its code) + a `meetings` table.
--
-- A workspace stores its Cal.com booking link and a webhook signing secret.
-- Cal.com POSTs booking events to /api/integrations/cal/<token>; the route
-- verifies the HMAC signature and calls cal_log_meeting, which records the
-- meeting and — when the attendee email matches a candidate in this workspace —
-- also drops an interview row so it shows on the Interviews page.
--
-- cal_resolve_connection + cal_log_meeting are service_role-only and called by
-- the webhook route (which has already verified the signature). The webhook
-- token identifies the workspace but is NOT the credential — the HMAC secret is.
-- Depends on 0012 + the interviews/candidates tables (base schema).
-- ============================================================================

create table if not exists cal_connections (
  workspace_id   uuid primary key references workspaces(id) on delete cascade,
  booking_url    text,
  webhook_secret text,
  webhook_token  uuid not null default gen_random_uuid(),
  enabled        boolean not null default true,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create unique index if not exists idx_cal_connections_token on cal_connections(webhook_token);
alter table cal_connections enable row level security;
revoke all on table cal_connections from anon, authenticated;

create table if not exists meetings (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  title          text,
  attendee_name  text,
  attendee_email text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  join_url       text,
  source         text default 'cal.com',
  external_id    text,
  candidate_id   uuid,
  raw            jsonb,
  created_at     timestamptz default now()
);
-- Dedupe re-deliveries of the same Cal.com booking.
create unique index if not exists idx_meetings_ext on meetings(workspace_id, external_id) where external_id is not null;
create index if not exists idx_meetings_ws on meetings(workspace_id);
alter table meetings enable row level security;
revoke all on table meetings from anon, authenticated;

-- ── Owner side ──────────────────────────────────────────────────────────────
-- Never returns the secret in plaintext — only whether one is set.
create or replace function get_cal_connection(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select jsonb_build_object('booking_url', c.booking_url, 'webhook_token', c.webhook_token,
           'has_secret', (c.webhook_secret is not null and c.webhook_secret <> ''), 'enabled', c.enabled)
    into v from cal_connections c where c.workspace_id = p_workspace;
  if v is null then
    -- Create a row so the workspace has a stable webhook token to paste into Cal.
    insert into cal_connections (workspace_id) values (p_workspace)
      on conflict (workspace_id) do nothing;
    select jsonb_build_object('booking_url', c.booking_url, 'webhook_token', c.webhook_token,
             'has_secret', false, 'enabled', c.enabled)
      into v from cal_connections c where c.workspace_id = p_workspace;
  end if;
  return v;
end $$;

create or replace function save_cal_connection(p_privy text, p_workspace uuid, p_booking_url text, p_secret text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text; v_token uuid;
begin
  v_role := workspace_role(p_privy, p_workspace);
  if v_role is null or v_role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  insert into cal_connections (workspace_id, booking_url, webhook_secret, enabled, updated_at)
  values (p_workspace, nullif(p_booking_url,''), nullif(p_secret,''), coalesce(p_enabled,true), now())
  on conflict (workspace_id) do update set
    booking_url = nullif(p_booking_url,''),
    -- keep the existing secret when the field is left blank on save
    webhook_secret = coalesce(nullif(p_secret,''), cal_connections.webhook_secret),
    enabled = coalesce(p_enabled,true), updated_at = now()
  returning webhook_token into v_token;
  return jsonb_build_object('webhook_token', v_token);
end $$;

create or replace function get_meetings(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', m.id, 'title', m.title, 'attendee_name', m.attendee_name, 'attendee_email', m.attendee_email,
    'starts_at', m.starts_at, 'join_url', m.join_url, 'source', m.source, 'candidate_id', m.candidate_id
  ) order by m.starts_at desc nulls last) from meetings m
    where m.workspace_id = p_workspace order by 1), '[]'::jsonb);
end $$;

-- ── Webhook side (service_role; route has already verified the HMAC) ─────────
create or replace function cal_resolve_connection(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object('workspace_id', workspace_id, 'secret', webhook_secret, 'enabled', enabled)
    into v from cal_connections where webhook_token = p_token;
  return v;   -- null for an unknown token
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
     order by created_at desc limit 1;
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

-- ── Grants (0046 posture) ───────────────────────────────────────────────────
revoke all on function get_cal_connection(text, uuid)                              from public, anon, authenticated;
revoke all on function save_cal_connection(text, uuid, text, text, boolean)        from public, anon, authenticated;
revoke all on function get_meetings(text, uuid)                                    from public, anon, authenticated;
revoke all on function cal_resolve_connection(uuid)                                from public, anon, authenticated;
revoke all on function cal_log_meeting(uuid, text, text, text, text, timestamptz, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function get_cal_connection(text, uuid)                              to service_role;
grant execute on function save_cal_connection(text, uuid, text, text, boolean)        to service_role;
grant execute on function get_meetings(text, uuid)                                    to service_role;
grant execute on function cal_resolve_connection(uuid)                                to service_role;
grant execute on function cal_log_meeting(uuid, text, text, text, text, timestamptz, timestamptz, text, jsonb) to service_role;

notify pgrst, 'reload schema';
