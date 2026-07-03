-- ============================================================================
-- HireBTR Platform Core — 0029_analytics_v2.sql
-- Web analytics v2: get_site_stats (from 0027) additionally returns the
-- desktop/mobile device split. Additive & prod-safe. Depends on 0027. Run AFTER.
-- ============================================================================

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
    ), '[]'::jsonb)
  );
end $$;
grant execute on function get_site_stats(text, uuid, int) to authenticated, anon;

notify pgrst, 'reload schema';
