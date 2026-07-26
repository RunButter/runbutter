-- ============================================================================
-- RunButter — 0059_umami.sql
-- Point web analytics at a self-hosted Umami instead of the built-in
-- site_events pipeline (0027/0029/0030).
--
-- WHY UMAMI AND NOT PLAUSIBLE: Umami is MIT, so white-labelling it inside an
-- MIT product is unambiguous — Plausible CE is AGPL-3.0, and any modification
-- we made to it would have to be published. Umami also runs on Postgres and a
-- single Node process (~512 MB) rather than Elixir + ClickHouse (~4 GB), which
-- is the difference between one small Render service and a real monthly bill.
--
-- NOTHING IS DELETED. sites/site_events and get_site_stats stay exactly as they
-- are: they hold real historical pageviews that Umami will not have, and the
-- app falls back to them for any site with no umami_website_id. The swap is
-- per-site and reversible — clear the column and that site reads from Postgres
-- again.
-- Depends on 0027 (sites) + 0030.
-- ============================================================================

-- The id Umami assigns its own website record. Text, not uuid: Umami's ids are
-- uuids today but that is its schema's business, not ours, and a format change
-- upstream should not need a migration here.
alter table sites add column if not exists umami_website_id text;
create index if not exists idx_sites_umami on sites(umami_website_id) where umami_website_id is not null;

-- Redefined in full (0027's version did not select the new column).
create or replace function get_sites(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', s.id, 'domain', s.domain, 'name', s.name, 'created_at', s.created_at,
    'umami_website_id', s.umami_website_id
  ) order by s.created_at) from sites s where s.workspace_id = p_workspace), '[]'::jsonb);
end $$;

-- Called by /api/analytics/site after Umami has created its website record.
-- Membership is re-checked here rather than trusted from the route, so a bug in
-- the route cannot relabel another tenant's site.
create or replace function link_site_umami(p_privy text, p_site uuid, p_umami_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from sites where id = p_site;
  if v_ws is null or not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
  update sites set umami_website_id = nullif(p_umami_id, '') where id = p_site;
  return jsonb_build_object('id', p_site, 'umami_website_id', nullif(p_umami_id, ''));
end $$;

-- Resolve a site to its Umami id for the stats route. Returns null rather than
-- raising when unlinked — an unlinked site is a normal state (it still has
-- Postgres analytics), not an error.
create or replace function get_site_umami(p_privy text, p_site uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_umami text; v_domain text;
begin
  select workspace_id, umami_website_id, domain into v_ws, v_umami, v_domain from sites where id = p_site;
  if v_ws is null or not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
  return jsonb_build_object('site_id', p_site, 'domain', v_domain, 'umami_website_id', v_umami);
end $$;

revoke all on function link_site_umami(text, uuid, text) from public, anon, authenticated;
revoke all on function get_site_umami(text, uuid)        from public, anon, authenticated;
grant execute on function link_site_umami(text, uuid, text) to service_role;
grant execute on function get_site_umami(text, uuid)        to service_role;

notify pgrst, 'reload schema';
