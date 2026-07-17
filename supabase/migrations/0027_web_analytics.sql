-- ============================================================================
-- RunButter Platform Core — 0027_web_analytics.sql
-- First-party web analytics (Plausible-style, cookieless). A workspace adds a
-- site → embeds a one-line snippet → pageviews land in site_events via /api/t.
-- Visitors are a daily-rotating hash (no cookies, no PII stored). Dedicated
-- RPCs (not the CRUD monolith): get_sites / create_site / get_site_stats.
-- Additive & prod-safe. Depends on 0001–0026. Run AFTER them.
-- ============================================================================

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  domain text not null,                   -- e.g. example.com (no protocol)
  name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_sites_ws on sites(workspace_id);
alter table sites enable row level security;

create table if not exists site_events (
  id bigint generated always as identity primary key,
  site_id uuid not null references sites(id) on delete cascade,
  ts timestamptz not null default now(),
  path text not null default '/',
  referrer text,                          -- referrer hostname ('' = direct)
  visitor text not null,                  -- daily-rotating salted hash (no PII)
  device text not null default 'desktop'  -- desktop | mobile
);
create index if not exists idx_site_events_site_ts on site_events(site_id, ts desc);
alter table site_events enable row level security;

-- List a workspace's sites.
create or replace function get_sites(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', s.id, 'domain', s.domain, 'name', s.name, 'created_at', s.created_at
  ) order by s.created_at) from sites s where s.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_sites(text, uuid) to authenticated, anon;

-- Register a site (domain normalised: lowercase, no protocol/path).
create or replace function create_site(p_privy text, p_workspace uuid, p_domain text, p_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_domain text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  v_domain := lower(regexp_replace(coalesce(p_domain,''), '^https?://|/.*$|^www\.', '', 'g'));
  if v_domain = '' then raise exception 'INVALID_DOMAIN'; end if;
  insert into sites (workspace_id, domain, name) values (p_workspace, v_domain, nullif(p_name,''))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function create_site(text, uuid, text, text) to authenticated, anon;

-- Stats for the dashboard: totals + daily series + top pages/referrers + live.
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
    ), '[]'::jsonb)
  );
end $$;
grant execute on function get_site_stats(text, uuid, int) to authenticated, anon;

notify pgrst, 'reload schema';
