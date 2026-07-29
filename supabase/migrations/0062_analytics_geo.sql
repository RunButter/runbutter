-- ============================================================================
-- RunButter — 0062_analytics_geo.sql
-- Countries, browsers, operating systems and campaign attribution on the
-- BUILT-IN analytics pipeline (0027/0029/0030) — no Umami required.
--
-- WHY HERE AND NOT VIA UMAMI: Umami supplies these too, but only once a Node
-- service and a second database are deployed and reachable. This works on the
-- pipeline that is already collecting, costs nothing, and keeps the data in the
-- same Postgres as leads/campaigns/deals — so a pageview can be joined to a
-- campaign, which no external analytics product can do.
--
-- GEO IS FREE OR ABSENT. There is no IP-geolocation call here: country/region/
-- city come from headers the edge already attaches (Cloudflare's cf-ipcountry,
-- Vercel's x-vercel-ip-*). If nothing sits in front of the app, they arrive null
-- and the UI says "Unknown" rather than guessing — a metered lookup API would
-- break the cost rule, and inventing a location would be worse than admitting
-- we don't have one.
--
-- Still cookieless: none of these columns identify a person. Country is
-- coarse-grained by construction, and the visitor id remains the daily-rotating
-- salted hash from /api/t.
-- Depends on 0027 (site_events) + 0029/0030 (get_site_stats).
-- ============================================================================

alter table site_events add column if not exists country      text;   -- ISO-3166 alpha-2
alter table site_events add column if not exists region       text;
alter table site_events add column if not exists city         text;
alter table site_events add column if not exists browser      text;
alter table site_events add column if not exists os           text;
alter table site_events add column if not exists utm_source   text;
alter table site_events add column if not exists utm_medium   text;
alter table site_events add column if not exists utm_campaign text;

-- Breakdown queries all filter site_id + ts and then group by one dimension.
-- The existing (site_id, ts desc) index already serves the filter; these are
-- narrow partial indexes for the group-bys that actually run.
create index if not exists idx_site_events_country on site_events(site_id, country) where country is not null;
create index if not exists idx_site_events_utm on site_events(site_id, utm_source) where utm_source is not null;

-- Redefined IN FULL (from 0029) — same discipline as the CRUD monolith, so the
-- newest migration is the whole truth for this function.
create or replace function get_site_stats(p_privy text, p_site uuid, p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_days int := greatest(1, least(coalesce(p_days, 30), 365));
  v_start timestamptz := date_trunc('day', now()) - ((v_days - 1) || ' days')::interval;
begin
  select workspace_id into v_ws from sites where id = p_site;
  if v_ws is null or not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;

  return jsonb_build_object(
    'pageviews', (select count(*) from site_events where site_id = p_site and ts >= v_start),
    'visitors',  (select count(distinct visitor) from site_events where site_id = p_site and ts >= v_start),
    'live',      (select count(distinct visitor) from site_events where site_id = p_site and ts >= now() - interval '5 minutes'),
    'desktop',   (select count(*) from site_events where site_id = p_site and ts >= v_start and device = 'desktop'),
    'mobile',    (select count(*) from site_events where site_id = p_site and ts >= v_start and device = 'mobile'),
    'series', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', to_char(d.day, 'YYYY-MM-DD'), 'label', to_char(d.day, 'DD Mon'),
        'pageviews', coalesce(e.pv, 0), 'visitors', coalesce(e.uv, 0)
      ) order by d.day)
      from generate_series(date_trunc('day', v_start), date_trunc('day', now()), interval '1 day') d(day)
      left join (
        select date_trunc('day', ts) as day, count(*) as pv, count(distinct visitor) as uv
        from site_events where site_id = p_site and ts >= v_start group by 1
      ) e on e.day = d.day
    ), '[]'::jsonb),
    'top_pages', coalesce((
      select jsonb_agg(jsonb_build_object('path', t.path, 'count', t.c) order by t.c desc)
      from (select path, count(*) c from site_events where site_id = p_site and ts >= v_start
            group by path order by c desc limit 10) t
    ), '[]'::jsonb),
    'top_referrers', coalesce((
      select jsonb_agg(jsonb_build_object('ref', t.ref, 'count', t.c) order by t.c desc)
      from (select coalesce(nullif(referrer, ''), 'direct') as ref, count(*) c
            from site_events where site_id = p_site and ts >= v_start
            group by 1 order by c desc limit 10) t
    ), '[]'::jsonb),
    -- ── 0062 additions ───────────────────────────────────────────────────────
    -- Unknown is kept as its own bucket rather than dropped: "we have no
    -- location for 80% of traffic" is information, and silently omitting it
    -- would make the country list look authoritative when it isn't.
    'countries', coalesce((
      select jsonb_agg(jsonb_build_object('code', t.code, 'count', t.c) order by t.c desc)
      from (select coalesce(nullif(upper(country), ''), 'Unknown') as code, count(*) c
            from site_events where site_id = p_site and ts >= v_start
            group by 1 order by c desc limit 12) t
    ), '[]'::jsonb),
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'count', t.c) order by t.c desc)
      from (select city || case when country is not null then ', ' || upper(country) else '' end as name, count(*) c
            from site_events where site_id = p_site and ts >= v_start and nullif(city,'') is not null
            group by 1 order by c desc limit 10) t
    ), '[]'::jsonb),
    'browsers', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'count', t.c) order by t.c desc)
      from (select coalesce(nullif(browser, ''), 'Unknown') as name, count(*) c
            from site_events where site_id = p_site and ts >= v_start
            group by 1 order by c desc limit 8) t
    ), '[]'::jsonb),
    'operating_systems', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'count', t.c) order by t.c desc)
      from (select coalesce(nullif(os, ''), 'Unknown') as name, count(*) c
            from site_events where site_id = p_site and ts >= v_start
            group by 1 order by c desc limit 8) t
    ), '[]'::jsonb),
    -- Campaign attribution: only rows that actually carried a utm_source, so an
    -- empty list honestly means "no tagged traffic" rather than "all direct".
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', t.src, 'medium', t.med, 'campaign', t.camp, 'count', t.c
      ) order by t.c desc)
      from (select utm_source as src, coalesce(nullif(utm_medium,''), '—') as med,
                   coalesce(nullif(utm_campaign,''), '—') as camp, count(*) c
            from site_events
            where site_id = p_site and ts >= v_start and nullif(utm_source,'') is not null
            group by 1,2,3 order by c desc limit 10) t
    ), '[]'::jsonb),
    -- Lets the UI distinguish "no geo data available" from "no traffic".
    'geo_coverage', (
      select case when count(*) = 0 then 0
             else round(100.0 * count(country) / count(*)) end
      from site_events where site_id = p_site and ts >= v_start
    )
  );
end $$;

-- Matches 0029: the tracker path is anon, and the dashboard reads through the
-- /api/rpc proxy.
grant execute on function get_site_stats(text, uuid, int) to authenticated, anon;

notify pgrst, 'reload schema';
