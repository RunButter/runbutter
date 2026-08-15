-- ============================================================================
-- RunButter — 0120_analytics_sessions.sql
--
-- Sessions, custom events, goals and funnels on the built-in pipeline.
--
-- ── LICENCE: PLAUSIBLE IS AGPL-3.0. NOTHING HERE IS COPIED FROM IT ──────────
-- Same wall as listmonk, Mautic and Postiz: taking a file would force this
-- whole product off MIT. Plausible was read as a FEATURE SPEC — the questions
-- its dashboard answers — and everything below is written against Postgres from
-- scratch. The definitions it made standard (a 30-minute inactivity window, a
-- bounce as a one-pageview visit) are conventions, not code, and using the same
-- ones is what makes a number comparable to what somebody already knows.
--
-- ── THIS IS THE MIGRATION THAT REMOVES A DEPENDENCY ─────────────────────────
-- 0059 deployed Umami as a SECOND service with its OWN Postgres, and the
-- documented reason was narrow and explicit: session metrics — bounce rate,
-- visit duration, funnels — which 0062's local pipeline could not compute.
-- Everything else (countries, cities, browsers, OS, UTM) was already here.
--
-- Those metrics are computable from the events we already store. A second app
-- and a second database per self-hoster, to answer four questions Postgres can
-- answer with a window function, was a bad trade the moment somebody wrote it
-- down. Umami stays supported and is now genuinely optional.
--
-- ── SESSIONS ARE DERIVED AT QUERY TIME, NOT STAMPED AT INGEST ───────────────
-- A `lag()` over (site_id, visitor) ordered by ts: a gap over 30 minutes starts
-- a new visit. Two reasons this is the right call here and not a shortcut:
--
--   · It works on EVERY EVENT ALREADY STORED. Stamping a session id at ingest
--     would mean a read-before-write on the hot path and a history that starts
--     the day it shipped, so the bounce rate would be blank for the period
--     anybody wants to compare against.
--   · A pageview row is small and (site_id, ts) is indexed. A busy month is a
--     few hundred thousand rows — a scan, not a problem. If that ever stops
--     being true the upgrade is a materialised daily rollup, which is an
--     addition rather than a rewrite.
--
-- ── THE VISITOR ID ROTATES DAILY, SO A VISIT CANNOT CROSS MIDNIGHT UTC ──────
-- /api/t hashes the day into the visitor id, which is what makes the pipeline
-- cookieless and storable without consent. The cost is real and is stated here
-- rather than discovered: somebody browsing at 23:50 and 00:10 is two visitors
-- and two visits. Plausible's daily-salt rotation has the same property. It is
-- a rounding error on a normal site and it is not nothing on a night-shift one.
--
-- ── A CUSTOM EVENT IS A ROW IN THE SAME TABLE ───────────────────────────────
-- `name` defaults to 'pageview', so every existing row is already correct and
-- no backfill is needed. A separate events table would double every query and
-- split a visitor's story across two scans for no gain.
-- ============================================================================

alter table site_events add column if not exists name text not null default 'pageview';
-- Custom properties, for the "which plan did they pick" question a goal alone
-- cannot answer. Undeclared and unvalidated on purpose: this is telemetry a
-- site owner sends about their own pages, not a record anything reads back.
alter table site_events add column if not exists props jsonb;

create index if not exists idx_site_events_visit on site_events(site_id, visitor, ts);
create index if not exists idx_site_events_name on site_events(site_id, name, ts);

/**
 * Goals: the things worth counting.
 *
 * Two kinds, and the distinction is the same one every analytics product makes
 * because it matches how sites are built: `event` matches a custom event by
 * name, `path` matches a pageview URL and supports `*`.
 */
create table if not exists site_goals (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  name text not null,
  kind text not null default 'event',      -- event | path
  match text not null,                     -- event name, or a path pattern
  created_at timestamptz not null default now(),
  constraint site_goals_kind_check check (kind in ('event', 'path'))
);
create unique index if not exists idx_site_goals_uq on site_goals(site_id, kind, match);
create index if not exists idx_site_goals_site on site_goals(site_id);

create table if not exists site_funnels (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  name text not null,
  -- Ordered. A funnel IS its order, so this is an array rather than a join
  -- table with a position column that something would eventually fail to sort.
  goal_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_site_funnels_site on site_funnels(site_id);

alter table site_goals   enable row level security;
alter table site_funnels enable row level security;

/**
 * A path pattern to a LIKE pattern.
 *
 * `%` and `_` are escaped FIRST, then `*` becomes `%`. In the other order a
 * literal `%` in a URL (they appear in encoded paths constantly) would become a
 * wildcard, and a goal for `/checkout%20done` would quietly match the whole
 * site. IMMUTABLE so it can be used in an index expression later.
 */
create or replace function analytics_like_pattern(p text)
returns text language sql immutable as $$
  select replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_')
$$;

create or replace function analytics_path_match(p_path text, p_pattern text)
returns boolean language sql immutable as $$
  select p_path like replace(analytics_like_pattern(p_pattern), '*', '%') escape '\'
$$;

/**
 * Is this Privy user allowed to see this site?
 *
 * One predicate, called by every function below, for the reason
 * `can_read_channel` gives: scattering a visibility rule is how one of the
 * copies eventually disagrees with the others.
 */
create or replace function site_readable(p_site uuid, p_privy text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sites s
     join accounts a on a.workspace_id = s.workspace_id
    where s.id = p_site and a.privy_user_id = p_privy
  )
$$;

/**
 * Visits, bounce rate, visit duration, entry and exit pages — the four things
 * Umami was installed for.
 *
 * A visit is a run of events by one visitor with no gap over 30 minutes. A
 * BOUNCE is a visit with exactly one pageview, and duration is last minus first
 * — so a bounce is always zero seconds, which is why the average is reported
 * over ALL visits and the bounce rate beside it. Reporting a duration that
 * excluded bounces would make a site with a 90% bounce rate look engaging.
 */
create or replace function get_site_sessions(p_privy text, p_site uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := p_from::timestamptz;
        v_to   timestamptz := (p_to + 1)::timestamptz;
        v_res jsonb;
begin
  if not site_readable(p_site, p_privy) then raise exception 'NOT_ALLOWED'; end if;
  if p_to < p_from or (p_to - p_from) > 400 then raise exception 'BAD_RANGE'; end if;

  with ev as (
    select visitor, ts, path, name,
           -- A gap of more than 30 minutes starts a new visit. `lag` is null
           -- for a visitor's first event in the window, and null > interval is
           -- null — so coalesce makes that first row start a visit rather than
           -- silently joining the previous one.
           case when coalesce(ts - lag(ts) over w > interval '30 minutes', true)
                then 1 else 0 end as starts
      from site_events
     where site_id = p_site and ts >= v_from and ts < v_to
    window w as (partition by visitor order by ts)
  ),
  marked as (
    select *, sum(starts) over (partition by visitor order by ts
                                rows between unbounded preceding and current row) as visit_no
      from ev
  ),
  visits as (
    select visitor, visit_no,
           min(ts) as started, max(ts) as ended,
           count(*) filter (where name = 'pageview') as pageviews,
           (array_agg(path order by ts) filter (where name = 'pageview'))[1] as entry,
           (array_agg(path order by ts desc) filter (where name = 'pageview'))[1] as exit
      from marked group by visitor, visit_no
  )
  select jsonb_build_object(
    'visits', (select count(*) from visits),
    'visitors', (select count(distinct visitor) from visits),
    'pageviews', (select coalesce(sum(pageviews), 0) from visits),
    'views_per_visit', (select case when count(*) > 0
                                    then round(sum(pageviews)::numeric / count(*), 2) end from visits),
    -- NULL, not 0, with nothing to measure. A bounce rate of 0% on an empty
    -- site is a claim; "no data" is the truth.
    'bounce_rate', (select case when count(*) > 0
                                then round(100.0 * count(*) filter (where pageviews <= 1) / count(*), 1) end
                      from visits),
    'avg_seconds', (select case when count(*) > 0
                                then round(avg(extract(epoch from (ended - started)))::numeric, 0) end
                      from visits),
    'entry_pages', coalesce((select jsonb_agg(jsonb_build_object('label', entry, 'value', n) order by n desc)
                               from (select entry, count(*) n from visits
                                      where entry is not null group by 1 order by 2 desc limit 10) e), '[]'::jsonb),
    'exit_pages',  coalesce((select jsonb_agg(jsonb_build_object('label', exit, 'value', n) order by n desc)
                               from (select exit, count(*) n from visits
                                      where exit is not null group by 1 order by 2 desc limit 10) x), '[]'::jsonb)
  ) into v_res;

  return v_res;
end $$;

/**
 * Who is on the site right now.
 *
 * Five minutes, which is the window every analytics product uses for this and
 * is short enough that the number moves while you watch it — which is the only
 * reason anybody looks at it.
 */
create or replace function get_site_realtime(p_privy text, p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not site_readable(p_site, p_privy) then raise exception 'NOT_ALLOWED'; end if;
  return jsonb_build_object(
    'current', (select count(distinct visitor) from site_events
                 where site_id = p_site and ts > now() - interval '5 minutes'),
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object('label', path, 'value', n) order by n desc)
        from (select path, count(*) n from site_events
               where site_id = p_site and ts > now() - interval '5 minutes'
                 and name = 'pageview' group by 1 order by 2 desc limit 8) p), '[]'::jsonb)
  );
end $$;

/**
 * Conversions per goal.
 *
 * Counted by VISITOR, not by event. Somebody who submits a form three times is
 * one conversion; counting events would make a rage-click look like success,
 * and the conversion rate would exceed 100% — a number that has embarrassed
 * more than one dashboard.
 */
create or replace function get_site_goals(p_privy text, p_site uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := p_from::timestamptz;
        v_to   timestamptz := (p_to + 1)::timestamptz;
        v_total int;
begin
  if not site_readable(p_site, p_privy) then raise exception 'NOT_ALLOWED'; end if;
  if p_to < p_from or (p_to - p_from) > 400 then raise exception 'BAD_RANGE'; end if;

  select count(distinct visitor) into v_total from site_events
   where site_id = p_site and ts >= v_from and ts < v_to;

  return jsonb_build_object(
    'visitors', v_total,
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'name', g.name, 'kind', g.kind, 'match', g.match,
               'conversions', c.n,
               'rate', case when v_total > 0 then round(100.0 * c.n / v_total, 1) end)
             order by c.n desc, g.name)
        from site_goals g
        cross join lateral (
          select count(distinct e.visitor) as n
            from site_events e
           where e.site_id = p_site and e.ts >= v_from and e.ts < v_to
             and case when g.kind = 'event'
                      then e.name = g.match
                      else e.name = 'pageview' and analytics_path_match(e.path, g.match) end
        ) c
       where g.site_id = p_site
    ), '[]'::jsonb)
  );
end $$;

/**
 * A funnel: how many visitors reached each step, IN ORDER.
 *
 * "In order" is the whole feature. Counting each step independently is what a
 * goals list already does, and it produces a funnel that can widen — step three
 * with more people than step two — which tells you nothing except that the
 * chart is wrong. Each step here requires a matching event STRICTLY AFTER the
 * visitor's first match of the previous step, so the counts can only fall.
 */
create or replace function get_site_funnel(p_privy text, p_site uuid, p_funnel uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := p_from::timestamptz;
  v_to   timestamptz := (p_to + 1)::timestamptz;
  f record; g record; gid uuid;
  v_steps jsonb := '[]'::jsonb;
  /*
   * The visitors still in the funnel, each with the moment they cleared the
   * last step: [{visitor, at}, …].
   *
   * Held in a jsonb variable rather than a temp table, and that is not a style
   * choice — `create temp table` inside a STABLE function raises "CREATE TABLE
   * is not allowed in a non-volatile function", and the fix of marking the
   * function volatile would give up the planner's right to cache it across a
   * dashboard that calls it once per funnel.
   */
  v_cur jsonb := '[]'::jsonb;
  v_prev int; v_first int := null;
begin
  if not site_readable(p_site, p_privy) then raise exception 'NOT_ALLOWED'; end if;
  if p_to < p_from or (p_to - p_from) > 400 then raise exception 'BAD_RANGE'; end if;

  select * into f from site_funnels where id = p_funnel and site_id = p_site;
  if not found then raise exception 'NOT_FOUND'; end if;

  foreach gid in array f.goal_ids loop
    select * into g from site_goals where id = gid and site_id = p_site;
    if not found then continue; end if;

    if v_first is null then
      select coalesce(jsonb_agg(jsonb_build_object('visitor', s.visitor, 'at', s.at)), '[]'::jsonb)
        into v_cur
        from (select e.visitor, min(e.ts) as at from site_events e
               where e.site_id = p_site and e.ts >= v_from and e.ts < v_to
                 and case when g.kind = 'event' then e.name = g.match
                          else e.name = 'pageview' and analytics_path_match(e.path, g.match) end
               group by e.visitor) s;
    else
      -- Keep only those who matched AFTER clearing the previous step, and move
      -- their cursor forward to the first such event.
      with prev as (select * from jsonb_to_recordset(v_cur) as t(visitor text, at timestamptz)),
           hit as (
             select p.visitor, min(e.ts) as at
               from prev p
               join site_events e on e.visitor = p.visitor and e.site_id = p_site
              where e.ts > p.at and e.ts < v_to
                and case when g.kind = 'event' then e.name = g.match
                         else e.name = 'pageview' and analytics_path_match(e.path, g.match) end
              group by p.visitor
           )
      select coalesce(jsonb_agg(jsonb_build_object('visitor', visitor, 'at', at)), '[]'::jsonb)
        into v_cur from hit;
    end if;

    v_prev := jsonb_array_length(v_cur);
    if v_first is null then v_first := v_prev; end if;

    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'goal_id', g.id, 'name', g.name, 'visitors', v_prev,
      -- Share of the people who entered the funnel, which is the number anybody
      -- means by "how many make it through".
      'rate', case when v_first > 0 then round(100.0 * v_prev / v_first, 1) end
    ));
  end loop;

  return jsonb_build_object('id', f.id, 'name', f.name, 'entered', coalesce(v_first, 0), 'steps', v_steps);
end $$;

-- ── Owner side ──────────────────────────────────────────────────────────────

create or replace function save_site_goal(p_privy text, p_site uuid, p_id uuid,
                                          p_name text, p_kind text, p_match text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not site_readable(p_site, p_privy) then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(trim(p_name),'') = '' or coalesce(trim(p_match),'') = '' then raise exception 'INVALID_GOAL'; end if;
  if coalesce(p_kind, 'event') not in ('event','path') then raise exception 'INVALID_KIND'; end if;

  if p_id is null then
    insert into site_goals (site_id, name, kind, match)
    values (p_site, trim(p_name), coalesce(p_kind,'event'), trim(p_match))
    -- Re-saving the same goal renames it rather than failing on the unique
    -- index: a duplicate here is somebody adding a goal they already had.
    on conflict (site_id, kind, match) do update set name = excluded.name
    returning id into v_id;
  else
    update site_goals set name = trim(p_name), kind = coalesce(p_kind, kind), match = trim(p_match)
     where id = p_id and site_id = p_site returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

create or replace function delete_site_goal(p_privy text, p_site uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not site_readable(p_site, p_privy) then raise exception 'NOT_ALLOWED'; end if;
  delete from site_goals where id = p_id and site_id = p_site;
  get diagnostics n = row_count;
  -- A deleted goal must not leave a funnel with a hole in it. array_remove
  -- rather than deleting the funnel: losing one step is recoverable, losing the
  -- funnel is not.
  update site_funnels set goal_ids = array_remove(goal_ids, p_id) where site_id = p_site;
  return n > 0;
end $$;

create or replace function save_site_funnel(p_privy text, p_site uuid, p_id uuid,
                                            p_name text, p_goal_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ok uuid[];
begin
  if not site_readable(p_site, p_privy) then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'INVALID_FUNNEL'; end if;

  -- Only this site's goals, and ORDER PRESERVED. `= any()` in a subquery would
  -- return them in whatever order the planner liked, which silently reorders
  -- somebody's funnel — the one thing a funnel cannot survive.
  select array_agg(x order by ord) into v_ok
    from unnest(coalesce(p_goal_ids, '{}')) with ordinality as t(x, ord)
   where exists (select 1 from site_goals g where g.id = t.x and g.site_id = p_site);

  if coalesce(array_length(v_ok, 1), 0) < 2 then raise exception 'FUNNEL_TOO_SHORT'; end if;

  if p_id is null then
    insert into site_funnels (site_id, name, goal_ids) values (p_site, trim(p_name), v_ok) returning id into v_id;
  else
    update site_funnels set name = trim(p_name), goal_ids = v_ok
     where id = p_id and site_id = p_site returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

create or replace function delete_site_funnel(p_privy text, p_site uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not site_readable(p_site, p_privy) then raise exception 'NOT_ALLOWED'; end if;
  delete from site_funnels where id = p_id and site_id = p_site;
  get diagnostics n = row_count;
  return n > 0;
end $$;

create or replace function get_site_config(p_privy text, p_site uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not site_readable(p_site, p_privy) then raise exception 'NOT_ALLOWED'; end if;
  return jsonb_build_object(
    'goals', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'match', match)
                              order by name) from site_goals where site_id = p_site), '[]'::jsonb),
    'funnels', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'goal_ids', goal_ids)
                                order by name) from site_funnels where site_id = p_site), '[]'::jsonb),
    -- The event names actually being received, so adding a goal is a pick from
    -- a list rather than a guess at what the snippet is sending.
    'seen_events', coalesce((select jsonb_agg(jsonb_build_object('label', name, 'value', n) order by n desc)
                             from (select name, count(*) n from site_events
                                    where site_id = p_site and name <> 'pageview'
                                      and ts > now() - interval '90 days'
                                    group by 1 order by 2 desc limit 30) s), '[]'::jsonb)
  );
end $$;

revoke all on function site_readable(uuid, text)                            from public, anon, authenticated;
revoke all on function get_site_sessions(text, uuid, date, date)            from public, anon, authenticated;
revoke all on function get_site_realtime(text, uuid)                        from public, anon, authenticated;
revoke all on function get_site_goals(text, uuid, date, date)               from public, anon, authenticated;
revoke all on function get_site_funnel(text, uuid, uuid, date, date)        from public, anon, authenticated;
revoke all on function save_site_goal(text, uuid, uuid, text, text, text)   from public, anon, authenticated;
revoke all on function delete_site_goal(text, uuid, uuid)                   from public, anon, authenticated;
revoke all on function save_site_funnel(text, uuid, uuid, text, uuid[])     from public, anon, authenticated;
revoke all on function delete_site_funnel(text, uuid, uuid)                 from public, anon, authenticated;
revoke all on function get_site_config(text, uuid)                          from public, anon, authenticated;

grant execute on function site_readable(uuid, text)                          to service_role;
grant execute on function get_site_sessions(text, uuid, date, date)          to service_role;
grant execute on function get_site_realtime(text, uuid)                      to service_role;
grant execute on function get_site_goals(text, uuid, date, date)             to service_role;
grant execute on function get_site_funnel(text, uuid, uuid, date, date)      to service_role;
grant execute on function save_site_goal(text, uuid, uuid, text, text, text) to service_role;
grant execute on function delete_site_goal(text, uuid, uuid)                 to service_role;
grant execute on function save_site_funnel(text, uuid, uuid, text, uuid[])   to service_role;
grant execute on function delete_site_funnel(text, uuid, uuid)               to service_role;
grant execute on function get_site_config(text, uuid)                        to service_role;

notify pgrst, 'reload schema';
