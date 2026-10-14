-- ============================================================================
-- 0135_booking.sql — booking pages: "book a meeting with me", without Calendly.
--
-- A booking page is a link a customer opens to pick a time. Picking one makes
-- the person (People), optionally a deal, a meeting on the company calendar,
-- and emails both sides. It is the front door of a sales process, so it lives
-- in the same database as the pipeline it feeds.
--
-- ── A BOOKING IS A ROW IN `meetings` ────────────────────────────────────────
-- Cal.com bookings have landed in `meetings` since 0056 and the calendar reads
-- that table, so a booking made here appears there with no second feed. The
-- columns added below are all nullable: a Cal.com row simply has none of them.
--
-- ── AVAILABILITY IS WORKING HOURS MINUS WHAT RUNBUTTER KNOWS ────────────────
-- The free slots are computed in lib/booking/slots.ts from the page's weekly
-- hours, minus the host's other bookings (booking_busy below). Google Calendar
-- is deliberately NOT read: lib/google-calendar.ts promises it never reads the
-- rest of a calendar, and the privacy policy says so. A connected Google
-- account is still WRITTEN to — the booking becomes an event with a Meet link.
--
-- ── THE VISITOR HAS NO ACCOUNT ──────────────────────────────────────────────
-- Their key to reschedule or cancel is DERIVED (HMAC of the meeting id with the
-- server key, lib/booking/token.ts) and the database keeps only sha256 of it —
-- the same design as the support widget (0131), for the same reason: the link
-- goes out in an email and nothing secret is stored.
--
-- ── DOUBLE BOOKING IS PREVENTED IN SQL ──────────────────────────────────────
-- Two people picking the same slot at the same second both pass the route's
-- check. booking_book takes a per-host advisory lock and re-checks overlap
-- inside the transaction, so exactly one of them gets SLOT_TAKEN.
-- ============================================================================

create table if not exists booking_pages (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  owner_privy     text not null,                 -- the host; their bookings block their time
  slug            text not null unique,
  title           text not null,
  description     text,
  duration_min    int  not null default 30 check (duration_min between 5 and 480),
  step_min        int  not null default 30 check (step_min between 5 and 240),
  location        text not null default 'google_meet'
                  check (location in ('google_meet','phone','in_person','link','none')),
  location_detail text,
  timezone        text not null default 'Europe/Warsaw',
  -- {"mon":[["09:00","17:00"]], "tue": [...], ...}; a missing day is closed.
  weekly          jsonb not null default '{"mon":[["09:00","17:00"]],"tue":[["09:00","17:00"]],"wed":[["09:00","17:00"]],"thu":[["09:00","17:00"]],"fri":[["09:00","17:00"]]}'::jsonb,
  buffer_before   int  not null default 0  check (buffer_before between 0 and 240),
  buffer_after    int  not null default 0  check (buffer_after between 0 and 240),
  min_notice_min  int  not null default 240 check (min_notice_min between 0 and 43200),
  horizon_days    int  not null default 30 check (horizon_days between 1 and 365),
  max_per_day     int  check (max_per_day is null or max_per_day between 1 and 50),
  create_deal     boolean not null default false,
  ask_phone       boolean not null default false,
  ask_company     boolean not null default true,
  notify_email    text,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_booking_pages_ws on booking_pages(workspace_id);
alter table booking_pages enable row level security;
revoke all on table booking_pages from anon, authenticated;

alter table meetings add column if not exists booking_page_id uuid references booking_pages(id) on delete set null;
alter table meetings add column if not exists host_privy       text;
alter table meetings add column if not exists status           text not null default 'confirmed';
alter table meetings add column if not exists person_id        uuid;
alter table meetings add column if not exists deal_id          uuid;
alter table meetings add column if not exists token_hash       text;
alter table meetings add column if not exists attendee_phone   text;
alter table meetings add column if not exists attendee_company text;
alter table meetings add column if not exists attendee_tz      text;
alter table meetings add column if not exists notes            text;
alter table meetings add column if not exists google_event_id  text;
alter table meetings add column if not exists reminder_sent_at timestamptz;
alter table meetings add column if not exists cancelled_at     timestamptz;
alter table meetings add column if not exists cancel_reason    text;
alter table meetings add column if not exists updated_at       timestamptz default now();
do $$ begin
  alter table meetings add constraint meetings_status_check check (status in ('confirmed','cancelled'));
exception when duplicate_object then null; end $$;
create index if not exists idx_meetings_host on meetings(workspace_id, host_privy, starts_at) where status = 'confirmed';
create index if not exists idx_meetings_reminder on meetings(starts_at) where status = 'confirmed' and source = 'booking' and reminder_sent_at is null;

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- Slugs that would shadow a route under /book/, or read as ours.
create or replace function booking_reserved_slug(p text)
returns boolean language sql immutable as $$
  select lower(coalesce(p, '')) in ('manage','embed','new','edit','admin','api','book','booking','runbutter','settings','cancel','reschedule','reminders');
$$;

create or replace function booking_clean_email(p text)
returns text language sql immutable as $$
  select case when lower(btrim(coalesce(p, ''))) ~ '^[^@\s]{1,64}@[^@\s]+\.[a-z]{2,}$'
              then left(lower(btrim(p)), 200) end;
$$;

-- A weekly schedule kept to its shape: seven known day keys, each a list of up
-- to six [HH:MM, HH:MM] windows that start before they end. Anything else is
-- dropped rather than stored, because the slot engine trusts this column.
create or replace function booking_clean_weekly(p jsonb)
returns jsonb language plpgsql immutable as $$
declare v jsonb := '{}'::jsonb; d text; w jsonb; out jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return v; end if;
  foreach d in array array['mon','tue','wed','thu','fri','sat','sun'] loop
    if jsonb_typeof(p->d) <> 'array' then continue; end if;
    out := '[]'::jsonb;
    for w in select * from jsonb_array_elements(p->d) limit 6 loop
      if jsonb_typeof(w) = 'array' and jsonb_array_length(w) = 2
         and (w->>0) ~ '^([01]\d|2[0-3]):[0-5]\d$' and (w->>1) ~ '^([01]\d|2[0-3]):[0-5]\d$|^24:00$'
         and (w->>0) < (w->>1) then
        out := out || jsonb_build_array(jsonb_build_array(w->>0, w->>1));
      end if;
    end loop;
    if jsonb_array_length(out) > 0 then v := v || jsonb_build_object(d, out); end if;
  end loop;
  return v;
end $$;

-- What another booking of this host occupies. Its own function so the leave
-- module (time off) can add the host's days off here and every page obeys.
create or replace function booking_busy(p_workspace uuid, p_host text, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_array(m.starts_at, m.ends_at) order by m.starts_at), '[]'::jsonb)
    from meetings m
   where m.workspace_id = p_workspace and m.host_privy = p_host and m.status = 'confirmed'
     and m.starts_at < p_to and m.ends_at > p_from;
$$;

-- A page as the public sees it: no owner id, no notify address.
create or replace function booking_page_public_json(p booking_pages)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'title', p.title, 'description', p.description,
    'duration_min', p.duration_min, 'step_min', p.step_min,
    'location', p.location,
    -- An address or a meeting room link is shown before booking; a phone call
    -- needs nothing from the page.
    'location_detail', case when p.location in ('in_person','link') then p.location_detail end,
    'timezone', p.timezone, 'weekly', p.weekly,
    'buffer_before', p.buffer_before, 'buffer_after', p.buffer_after,
    'min_notice_min', p.min_notice_min, 'horizon_days', p.horizon_days, 'max_per_day', p.max_per_day,
    'ask_phone', p.ask_phone or p.location = 'phone', 'ask_company', p.ask_company,
    'host', (select jsonb_build_object('name', coalesce(nullif(a.full_name,''), split_part(a.email,'@',1)), 'avatar', a.avatar_url)
               from accounts a where a.workspace_id = p.workspace_id and a.privy_user_id = p.owner_privy limit 1),
    'company', (select jsonb_build_object('name', w.name, 'logo', w.logo_url, 'accent', w.accent_color)
                  from workspaces w where w.id = p.workspace_id));
$$;

-- ── Team side (signed in, through /api/rpc) ─────────────────────────────────

create or replace function get_booking_pages(p_privy text, p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(p) - 'workspace_id' || jsonb_build_object(
      'mine', p.owner_privy = p_privy,
      'host_name', (select coalesce(nullif(a.full_name,''), a.email) from accounts a
                     where a.workspace_id = p.workspace_id and a.privy_user_id = p.owner_privy limit 1),
      'upcoming', (select count(*) from meetings m where m.booking_page_id = p.id
                    and m.status = 'confirmed' and m.starts_at > now()))
      order by p.created_at)
    from booking_pages p where p.workspace_id = p_workspace
  ), '[]'::jsonb);
end $$;

-- Create (no id) or edit (id). Anyone may make their own page; a page is edited
-- by its host or an owner/admin. Keys absent from p_data are left alone.
create or replace function save_booking_page(p_privy text, p_workspace uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v booking_pages; v_id uuid := nullif(p_data->>'id','')::uuid;
        v_slug text := lower(btrim(coalesce(p_data->>'slug','')));
        v_role text := coalesce(workspace_role(p_privy, p_workspace), '');
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if v_role = 'viewer' then raise exception 'FORBIDDEN'; end if;
  if p_data ? 'slug' then
    if v_slug !~ '^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$' then raise exception 'BAD_SLUG'; end if;
    if booking_reserved_slug(v_slug) then raise exception 'SLUG_RESERVED'; end if;
    if exists (select 1 from booking_pages where slug = v_slug and id is distinct from v_id) then raise exception 'SLUG_TAKEN'; end if;
  end if;
  if p_data ? 'timezone' and not exists (select 1 from pg_timezone_names where name = p_data->>'timezone') then
    raise exception 'BAD_TIMEZONE';
  end if;

  if v_id is null then
    if v_slug = '' then raise exception 'BAD_SLUG'; end if;
    if nullif(btrim(coalesce(p_data->>'title','')), '') is null then raise exception 'TITLE_REQUIRED'; end if;
    insert into booking_pages (workspace_id, owner_privy, slug, title)
    values (p_workspace, p_privy, v_slug, left(btrim(p_data->>'title'), 120))
    returning * into v;
  else
    select * into v from booking_pages where id = v_id and workspace_id = p_workspace;
    if v.id is null then raise exception 'NOT_FOUND'; end if;
    if v.owner_privy <> p_privy and v_role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  end if;

  update booking_pages set
    slug            = case when p_data ? 'slug' then v_slug else slug end,
    title           = case when p_data ? 'title' and nullif(btrim(p_data->>'title'),'') is not null then left(btrim(p_data->>'title'), 120) else title end,
    description     = case when p_data ? 'description' then nullif(left(btrim(coalesce(p_data->>'description','')), 2000), '') else description end,
    duration_min    = case when p_data ? 'duration_min' then greatest(5, least(480, (p_data->>'duration_min')::int)) else duration_min end,
    step_min        = case when p_data ? 'step_min' then greatest(5, least(240, (p_data->>'step_min')::int)) else step_min end,
    location        = case when p_data ? 'location' and p_data->>'location' in ('google_meet','phone','in_person','link','none') then p_data->>'location' else location end,
    location_detail = case when p_data ? 'location_detail' then nullif(left(btrim(coalesce(p_data->>'location_detail','')), 500), '') else location_detail end,
    timezone        = case when p_data ? 'timezone' then p_data->>'timezone' else timezone end,
    weekly          = case when p_data ? 'weekly' then booking_clean_weekly(p_data->'weekly') else weekly end,
    buffer_before   = case when p_data ? 'buffer_before' then greatest(0, least(240, (p_data->>'buffer_before')::int)) else buffer_before end,
    buffer_after    = case when p_data ? 'buffer_after' then greatest(0, least(240, (p_data->>'buffer_after')::int)) else buffer_after end,
    min_notice_min  = case when p_data ? 'min_notice_min' then greatest(0, least(43200, (p_data->>'min_notice_min')::int)) else min_notice_min end,
    horizon_days    = case when p_data ? 'horizon_days' then greatest(1, least(365, (p_data->>'horizon_days')::int)) else horizon_days end,
    max_per_day     = case when p_data ? 'max_per_day' then nullif(greatest(0, least(50, coalesce((p_data->>'max_per_day')::int, 0))), 0) else max_per_day end,
    create_deal     = case when p_data ? 'create_deal' then coalesce((p_data->>'create_deal')::boolean, false) else create_deal end,
    ask_phone       = case when p_data ? 'ask_phone' then coalesce((p_data->>'ask_phone')::boolean, false) else ask_phone end,
    ask_company     = case when p_data ? 'ask_company' then coalesce((p_data->>'ask_company')::boolean, true) else ask_company end,
    notify_email    = case when p_data ? 'notify_email' then booking_clean_email(p_data->>'notify_email') else notify_email end,
    enabled         = case when p_data ? 'enabled' then coalesce((p_data->>'enabled')::boolean, true) else enabled end,
    updated_at      = now()
  where id = v.id
  returning * into v;
  return to_jsonb(v) - 'workspace_id';
end $$;

create or replace function delete_booking_page(p_privy text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v booking_pages;
begin
  select * into v from booking_pages where id = p_id;
  if v.id is null or not is_workspace_member(v.workspace_id, p_privy) then raise exception 'NOT_FOUND'; end if;
  if v.owner_privy <> p_privy and coalesce(workspace_role(p_privy, v.workspace_id), '') not in ('owner','admin') then
    raise exception 'FORBIDDEN';
  end if;
  -- Bookings already made stay on the calendar; they just lose the page link.
  delete from booking_pages where id = p_id;
end $$;

-- Bookings made through pages, newest first, for the Booking pages screen.
create or replace function get_bookings(p_privy text, p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'title', m.title, 'name', m.attendee_name, 'email', m.attendee_email,
      'phone', m.attendee_phone, 'company', m.attendee_company, 'notes', m.notes,
      'starts_at', m.starts_at, 'ends_at', m.ends_at, 'status', m.status, 'join_url', m.join_url,
      'page', bp.title, 'page_slug', bp.slug, 'person_id', m.person_id, 'deal_id', m.deal_id,
      'host_name', (select coalesce(nullif(a.full_name,''), a.email) from accounts a
                     where a.workspace_id = m.workspace_id and a.privy_user_id = m.host_privy limit 1),
      'cancel_reason', m.cancel_reason) order by m.starts_at)
    from meetings m left join booking_pages bp on bp.id = m.booking_page_id
   where m.workspace_id = p_workspace and m.source = 'booking'
     and m.starts_at >= p_from and m.starts_at < p_to
  ), '[]'::jsonb);
end $$;

-- What an email about one booking needs, in one shape for every path.
create or replace function booking_mail_json(m meetings)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'title', coalesce(bp.title, m.title), 'name', m.attendee_name, 'email', m.attendee_email,
    'phone', m.attendee_phone, 'company', m.attendee_company, 'notes', m.notes,
    'starts_at', m.starts_at, 'ends_at', m.ends_at, 'status', m.status,
    'join_url', m.join_url, 'attendee_tz', m.attendee_tz, 'google_event_id', m.google_event_id,
    'host_privy', m.host_privy, 'person_id', m.person_id, 'deal_id', m.deal_id,
    'page_id', bp.id, 'slug', bp.slug, 'location', bp.location, 'location_detail', bp.location_detail,
    'timezone', coalesce(bp.timezone, 'UTC'),
    'host_name', (select coalesce(nullif(a.full_name,''), split_part(a.email,'@',1)) from accounts a
                   where a.workspace_id = m.workspace_id and a.privy_user_id = m.host_privy limit 1),
    'host_email', coalesce(bp.notify_email, (select a.email from accounts a
                   where a.workspace_id = m.workspace_id and a.privy_user_id = m.host_privy limit 1)),
    'company_name', (select w.name from workspaces w where w.id = m.workspace_id),
    'from_name', (select coalesce(nullif(w.email_from_name,''), w.name) from workspaces w where w.id = m.workspace_id))
  from (select 1) _ left join booking_pages bp on bp.id = m.booking_page_id;
$$;

-- A team member cancels. Returns the booking for the route to email and to
-- remove from Google.
create or replace function cancel_booking(p_privy text, p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m meetings;
begin
  select * into m from meetings where id = p_id and source = 'booking';
  if m.id is null or not is_workspace_member(m.workspace_id, p_privy) then raise exception 'NOT_FOUND'; end if;
  if coalesce(workspace_role(p_privy, m.workspace_id), '') = 'viewer' then raise exception 'FORBIDDEN'; end if;
  if m.status = 'cancelled' then raise exception 'ALREADY_CANCELLED'; end if;
  update meetings set status = 'cancelled', cancelled_at = now(), updated_at = now(),
         cancel_reason = nullif(left(btrim(coalesce(p_reason,'')), 500), '')
   where id = p_id returning * into m;
  return booking_mail_json(m) || jsonb_build_object('cancelled_by', 'host');
end $$;

-- ── Visitor side (service_role, through /api/booking/*) ─────────────────────

create or replace function booking_public(p_slug text, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p booking_pages;
begin
  select * into p from booking_pages where slug = lower(p_slug) and enabled;
  if p.id is null then return null; end if;
  if p_to < p_from or p_to - p_from > interval '100 days' then raise exception 'BAD_RANGE'; end if;
  return booking_page_public_json(p) || jsonb_build_object(
    'busy', booking_busy(p.workspace_id, p.owner_privy, p_from, p_to));
end $$;

create or replace function booking_book(
  p_id uuid, p_slug text, p_start timestamptz, p_token_hash text,
  p_name text, p_email text, p_phone text, p_company text, p_notes text, p_tz text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare p booking_pages; m meetings; v_end timestamptz; v_email text := booking_clean_email(p_email);
        v_name text := nullif(left(btrim(coalesce(p_name,'')), 120), ''); v_person uuid; v_deal uuid;
        v_pipeline uuid; v_day date; v_first text; v_last text;
begin
  select * into p from booking_pages where slug = lower(p_slug) and enabled;
  if p.id is null then raise exception 'PAGE_NOT_FOUND'; end if;
  if v_email is null then raise exception 'BAD_EMAIL'; end if;
  if v_name is null then raise exception 'NAME_REQUIRED'; end if;
  if (p.ask_phone or p.location = 'phone') and nullif(btrim(coalesce(p_phone,'')), '') is null then raise exception 'PHONE_REQUIRED'; end if;
  v_end := p_start + make_interval(mins => p.duration_min);
  -- A minute of grace for the time the form took to submit.
  if p_start < now() + make_interval(mins => p.min_notice_min) - interval '1 minute' then raise exception 'TOO_SOON'; end if;
  if p_start > now() + make_interval(days => p.horizon_days) then raise exception 'TOO_FAR'; end if;

  -- One host, one booking at a time: the second of two simultaneous requests
  -- for the same slot waits here and then sees the first one's row.
  perform pg_advisory_xact_lock(hashtext('booking:' || p.workspace_id || ':' || p.owner_privy));
  if exists (select 1 from meetings x
              where x.workspace_id = p.workspace_id and x.host_privy = p.owner_privy and x.status = 'confirmed'
                and x.starts_at < v_end + make_interval(mins => p.buffer_after)
                and x.ends_at   > p_start - make_interval(mins => p.buffer_before)) then
    raise exception 'SLOT_TAKEN';
  end if;
  if p.max_per_day is not null then
    v_day := (p_start at time zone p.timezone)::date;
    if (select count(*) from meetings x
         where x.workspace_id = p.workspace_id and x.host_privy = p.owner_privy and x.status = 'confirmed'
           and (x.starts_at at time zone p.timezone)::date = v_day) >= p.max_per_day then
      raise exception 'DAY_FULL';
    end if;
  end if;

  -- The person: the same promise a form and the chat widget make. Over the
  -- plan's record limit the booking still happens, unlinked — refusing a
  -- customer's meeting over a billing limit is the wrong failure.
  select id into v_person from people where workspace_id = p.workspace_id and lower(email) = v_email
   order by created_at limit 1;
  if v_person is null then
    v_first := split_part(v_name, ' ', 1);
    v_last := nullif(btrim(substr(v_name, length(v_first) + 1)), '');
    begin
      perform enforce_record_limit(p.workspace_id, 1);
      insert into people (workspace_id, first_name, last_name, email, phone, source)
      values (p.workspace_id, v_first, v_last, v_email, nullif(left(btrim(coalesce(p_phone,'')), 40), ''), 'booking')
      returning id into v_person;
    exception when others then v_person := null;
    end;
  end if;

  if p.create_deal then
    begin
      select id into v_pipeline from pipelines where workspace_id = p.workspace_id and kind = 'sales'
       order by created_at limit 1;
      if v_pipeline is not null then
        v_deal := create_pipeline_record(p.owner_privy, p.workspace_id, v_pipeline, null,
                    left(p.title || ' — ' || coalesce(nullif(btrim(coalesce(p_company,'')), ''), v_name), 200),
                    null, null, v_person);
      end if;
    exception when others then v_deal := null;
    end;
  end if;

  insert into meetings (id, workspace_id, title, attendee_name, attendee_email, starts_at, ends_at,
                        join_url, source, booking_page_id, host_privy, status, person_id, deal_id, token_hash,
                        attendee_phone, attendee_company, attendee_tz, notes)
  values (p_id, p.workspace_id, left(p.title || ' · ' || v_name, 200), v_name, v_email, p_start, v_end,
          case when p.location = 'link' then p.location_detail end, 'booking', p.id, p.owner_privy, 'confirmed',
          v_person, v_deal, p_token_hash,
          nullif(left(btrim(coalesce(p_phone,'')), 40), ''), nullif(left(btrim(coalesce(p_company,'')), 160), ''),
          case when exists (select 1 from pg_timezone_names where name = p_tz) then p_tz end,
          nullif(left(btrim(coalesce(p_notes,'')), 2000), ''))
  returning * into m;
  return booking_mail_json(m);
end $$;

-- After the route created the Google event: its id and Meet link.
-- Bookkeeping, not an event: the automation recursion guard (0035) is set for
-- this transaction so "a booking is updated" does not fire on it.
create or replace function booking_set_google(p_id uuid, p_event text, p_join_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.automation_depth', '1', true);
  update meetings set google_event_id = nullif(p_event,''),
         join_url = coalesce(nullif(p_join_url,''), join_url), updated_at = now()
   where id = p_id;
end $$;

create or replace function booking_by_token(p_id uuid, p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m meetings; p booking_pages;
begin
  select * into m from meetings where id = p_id and source = 'booking' and token_hash = p_token_hash;
  if m.id is null then return null; end if;
  select * into p from booking_pages where id = m.booking_page_id;
  return booking_mail_json(m) - 'host_privy' - 'host_email' - 'google_event_id' - 'person_id' - 'deal_id'
         || jsonb_build_object('page', case when p.id is not null and p.enabled then booking_page_public_json(p) end);
end $$;

create or replace function booking_cancel_visitor(p_id uuid, p_token_hash text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m meetings;
begin
  select * into m from meetings where id = p_id and source = 'booking' and token_hash = p_token_hash;
  if m.id is null then raise exception 'NOT_FOUND'; end if;
  if m.status = 'cancelled' then raise exception 'ALREADY_CANCELLED'; end if;
  if m.starts_at < now() then raise exception 'ALREADY_HAPPENED'; end if;
  update meetings set status = 'cancelled', cancelled_at = now(), updated_at = now(),
         cancel_reason = nullif(left(btrim(coalesce(p_reason,'')), 500), '')
   where id = p_id returning * into m;
  return booking_mail_json(m) || jsonb_build_object('cancelled_by', 'visitor');
end $$;

create or replace function booking_reschedule(p_id uuid, p_token_hash text, p_start timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m meetings; p booking_pages; v_end timestamptz;
begin
  select * into m from meetings where id = p_id and source = 'booking' and token_hash = p_token_hash;
  if m.id is null then raise exception 'NOT_FOUND'; end if;
  if m.status = 'cancelled' then raise exception 'ALREADY_CANCELLED'; end if;
  if m.starts_at < now() then raise exception 'ALREADY_HAPPENED'; end if;
  select * into p from booking_pages where id = m.booking_page_id and enabled;
  if p.id is null then raise exception 'PAGE_NOT_FOUND'; end if;
  v_end := p_start + make_interval(mins => p.duration_min);
  if p_start < now() + make_interval(mins => p.min_notice_min) - interval '1 minute' then raise exception 'TOO_SOON'; end if;
  if p_start > now() + make_interval(days => p.horizon_days) then raise exception 'TOO_FAR'; end if;
  perform pg_advisory_xact_lock(hashtext('booking:' || p.workspace_id || ':' || p.owner_privy));
  if exists (select 1 from meetings x
              where x.workspace_id = p.workspace_id and x.host_privy = p.owner_privy and x.status = 'confirmed'
                and x.id <> m.id
                and x.starts_at < v_end + make_interval(mins => p.buffer_after)
                and x.ends_at   > p_start - make_interval(mins => p.buffer_before)) then
    raise exception 'SLOT_TAKEN';
  end if;
  update meetings set starts_at = p_start, ends_at = v_end, reminder_sent_at = null, updated_at = now()
   where id = p_id returning * into m;
  return booking_mail_json(m) || jsonb_build_object('rescheduled', true);
end $$;

-- Reminders: claimed (stamped) BEFORE sending, like every other sender here —
-- a crash after the claim skips one reminder rather than sending two. A
-- booking made less than a day ahead already got its confirmation; no reminder.
create or replace function booking_due_reminders(p_limit int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  -- Stamping a reminder is bookkeeping: no "booking updated" automations.
  perform set_config('app.automation_depth', '1', true);
  with due as (
    select id from meetings
     where source = 'booking' and status = 'confirmed' and reminder_sent_at is null
       and starts_at > now() + interval '1 hour' and starts_at <= now() + interval '24 hours'
       and coalesce(created_at, now()) <= starts_at - interval '20 hours'
     order by starts_at limit greatest(1, least(p_limit, 100))
     for update skip locked
  ), claimed as (
    update meetings m set reminder_sent_at = now() from due where m.id = due.id returning m.*
  )
  select coalesce(jsonb_agg(booking_mail_json(c)), '[]'::jsonb) into v from claimed c;
  return v;
end $$;

-- ── The calendar: a cancelled booking is not an event ───────────────────────
-- get_calendar redefined IN FULL from 0130; the only change is the status
-- filter on meetings.
create or replace function get_calendar(p_privy text, p_workspace uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := p_from::timestamptz;
        v_to   timestamptz := (p_to + 1)::timestamptz;   -- inclusive of p_to
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_to < p_from or (p_to - p_from) > 400 then raise exception 'BAD_RANGE'; end if;

  return coalesce((
    select jsonb_agg(e order by e->>'at')
    from (
      select jsonb_build_object(
               'kind', 'invoice', 'id', i.id,
               'title', coalesce(nullif(i.number,''), 'Invoice') ||
                        coalesce(' · ' || o.name, ''),
               'at', i.due_at, 'all_day', true,
               'amount', i.amount, 'status', i.status,
               'href', '/objects/invoices?ref=' || i.id) as e
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
      -- Meetings: Cal.com bookings and this module's booking pages. A
      -- cancelled booking keeps its row (the history) but is not an event.
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
    ) x
  ), '[]'::jsonb);
end $$;

-- ── Automations: "a booking is made / cancelled" ────────────────────────────
-- automation_payload redefined IN FULL from 0132 with one more branch: a
-- meeting by the names a person would use ({{name}}, {{email}}, {{start}}).
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
  elsif v ? 'organization_id' then
    return v || jsonb_build_object('company',
      coalesce((select o.name from organizations o where o.id = (v->>'organization_id')::uuid), v->>'company'));
  end if;
  return v;
end $$;

-- "Test" on an automation runs it against the newest real record of its
-- object; redefined IN FULL from 0132 with one branch for bookings.
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
  drop trigger if exists trg_autoevt_meetings on meetings;
  create trigger trg_autoevt_meetings after insert or update on meetings
    for each row execute function emit_automation_event('bookings');
end $$;

-- ── Grants (0046 posture: service_role only, /api/rpc and the routes) ───────
revoke all on function booking_reserved_slug(text)                         from public, anon, authenticated;
revoke all on function booking_clean_email(text)                           from public, anon, authenticated;
revoke all on function booking_clean_weekly(jsonb)                         from public, anon, authenticated;
revoke all on function booking_busy(uuid, text, timestamptz, timestamptz)  from public, anon, authenticated;
revoke all on function booking_page_public_json(booking_pages)             from public, anon, authenticated;
revoke all on function get_booking_pages(text, uuid)                       from public, anon, authenticated;
revoke all on function save_booking_page(text, uuid, jsonb)                from public, anon, authenticated;
revoke all on function delete_booking_page(text, uuid)                     from public, anon, authenticated;
revoke all on function get_bookings(text, uuid, timestamptz, timestamptz)  from public, anon, authenticated;
revoke all on function booking_mail_json(meetings)                         from public, anon, authenticated;
revoke all on function cancel_booking(text, uuid, text)                    from public, anon, authenticated;
revoke all on function booking_public(text, timestamptz, timestamptz)      from public, anon, authenticated;
revoke all on function booking_book(uuid, text, timestamptz, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function booking_set_google(uuid, text, text)                from public, anon, authenticated;
revoke all on function booking_by_token(uuid, text)                        from public, anon, authenticated;
revoke all on function booking_cancel_visitor(uuid, text, text)            from public, anon, authenticated;
revoke all on function booking_reschedule(uuid, text, timestamptz)         from public, anon, authenticated;
revoke all on function booking_due_reminders(int)                          from public, anon, authenticated;
revoke all on function get_calendar(text, uuid, date, date)                from public, anon, authenticated;
revoke all on function automation_payload(text, text, jsonb)               from public, anon, authenticated;
revoke all on function automation_sample_row(uuid, text)                   from public, anon, authenticated;
grant execute on function booking_reserved_slug(text)                         to service_role;
grant execute on function booking_clean_email(text)                           to service_role;
grant execute on function booking_clean_weekly(jsonb)                         to service_role;
grant execute on function booking_busy(uuid, text, timestamptz, timestamptz)  to service_role;
grant execute on function booking_page_public_json(booking_pages)             to service_role;
grant execute on function get_booking_pages(text, uuid)                       to service_role;
grant execute on function save_booking_page(text, uuid, jsonb)                to service_role;
grant execute on function delete_booking_page(text, uuid)                     to service_role;
grant execute on function get_bookings(text, uuid, timestamptz, timestamptz)  to service_role;
grant execute on function booking_mail_json(meetings)                         to service_role;
grant execute on function cancel_booking(text, uuid, text)                    to service_role;
grant execute on function booking_public(text, timestamptz, timestamptz)      to service_role;
grant execute on function booking_book(uuid, text, timestamptz, text, text, text, text, text, text, text) to service_role;
grant execute on function booking_set_google(uuid, text, text)                to service_role;
grant execute on function booking_by_token(uuid, text)                        to service_role;
grant execute on function booking_cancel_visitor(uuid, text, text)            to service_role;
grant execute on function booking_reschedule(uuid, text, timestamptz)         to service_role;
grant execute on function booking_due_reminders(int)                          to service_role;
grant execute on function get_calendar(text, uuid, date, date)                to service_role;
grant execute on function automation_payload(text, text, jsonb)               to service_role;
grant execute on function automation_sample_row(uuid, text)                   to service_role;

notify pgrst, 'reload schema';
