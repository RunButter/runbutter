-- ============================================================================
-- RunButter — 0067_mind_maps.sql
-- Free-form canvases: boxes you move, connected by edges.
--
-- WHY ONE JSONB COLUMN, NOT nodes + edges TABLES.
-- A canvas is always loaded and saved WHOLE — you open a map, drag things, and
-- the client holds the entire graph in memory the whole time. Nothing ever
-- queries "all nodes at x > 400" or joins an edge to another table. Normalising
-- would buy referential integrity we don't need and cost a multi-statement
-- write on every save, where a single jsonb assignment is atomic for free.
--
-- The shape is React Flow's own ({ nodes: [...], edges: [...] }) so the client
-- can hand it straight to the canvas and back without a translation layer that
-- would have to be kept in sync with the library.
--
-- Guarded, not trusted: the graph is client-authored, so save_mind_map checks
-- it is an object with array members and caps its size. Without that, one bad
-- client could write a 40 MB row that every subsequent open has to download.
-- Depends on 0001 (workspaces).
-- ============================================================================

create table if not exists mind_maps (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title        text not null default 'Untitled map',
  -- { nodes: [...], edges: [...] } — React Flow's own shape.
  graph        jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_mind_maps_ws on mind_maps(workspace_id, updated_at desc);

alter table mind_maps enable row level security;
revoke all on table mind_maps from anon, authenticated;

-- ── List ────────────────────────────────────────────────────────────────────
-- Deliberately does NOT return `graph`: a list of ten maps would otherwise ship
-- ten full canvases to render ten titles. Counts come from jsonb_array_length,
-- so the card can say "12 boxes" without the payload.
create or replace function get_mind_maps(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
    select m.id, m.title, m.created_at, m.updated_at,
           coalesce(jsonb_array_length(m.graph->'nodes'), 0) as node_count,
           coalesce(jsonb_array_length(m.graph->'edges'), 0) as edge_count
    from mind_maps m
    where m.workspace_id = p_workspace
    order by m.updated_at desc
  ) x), '[]'::jsonb);
end $$;

create or replace function get_mind_map(p_privy text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_out jsonb;
begin
  select workspace_id into v_ws from mind_maps where id = p_id;
  if v_ws is null or not is_workspace_member(v_ws, p_privy) then
    raise exception 'NOT_FOUND_OR_FORBIDDEN';
  end if;
  select jsonb_build_object('id', m.id, 'title', m.title, 'graph', m.graph,
                            'updated_at', m.updated_at)
    into v_out from mind_maps m where m.id = p_id;
  return v_out;
end $$;

create or replace function create_mind_map(p_privy text, p_workspace uuid, p_title text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  insert into mind_maps (workspace_id, title, created_by)
  values (p_workspace, coalesce(nullif(trim(p_title), ''), 'Untitled map'), p_privy)
  returning id into v_id;
  return v_id;
end $$;

-- ── Save ────────────────────────────────────────────────────────────────────
/**
 * Persist the canvas.
 *
 * Title and graph are BOTH optional and each is written only when supplied, so
 * renaming a map does not have to send the graph and an autosaving canvas does
 * not have to send the title.
 *
 * The size cap is the real guard here. `graph` is written by the browser, so
 * without a ceiling a runaway client (or a paste of something enormous) writes a
 * row that every later open has to download. 2 MB is far beyond any hand-drawn
 * map and far below a problem.
 */
create or replace function save_mind_map(
  p_privy text, p_id uuid, p_graph jsonb default null, p_title text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from mind_maps where id = p_id;
  if v_ws is null or not is_workspace_member(v_ws, p_privy) then
    raise exception 'NOT_FOUND_OR_FORBIDDEN';
  end if;

  if p_graph is not null then
    -- Shape check: the canvas reads graph.nodes / graph.edges and would break on
    -- anything else, so refuse it here rather than store a row that cannot open.
    if jsonb_typeof(p_graph) <> 'object'
       or jsonb_typeof(p_graph->'nodes') <> 'array'
       or jsonb_typeof(p_graph->'edges') <> 'array' then
      raise exception 'BAD_GRAPH';
    end if;
    if pg_column_size(p_graph) > 2 * 1024 * 1024 then raise exception 'GRAPH_TOO_LARGE'; end if;
  end if;

  update mind_maps set
    graph      = coalesce(p_graph, graph),
    title      = coalesce(nullif(trim(p_title), ''), title),
    updated_at = now()
  where id = p_id;
  return true;
end $$;

create or replace function delete_mind_map(p_privy text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from mind_maps where id = p_id;
  if v_ws is null or not is_workspace_member(v_ws, p_privy) then
    raise exception 'NOT_FOUND_OR_FORBIDDEN';
  end if;
  delete from mind_maps where id = p_id;
  return true;
end $$;

revoke all on function get_mind_maps(text, uuid)                       from public, anon, authenticated;
revoke all on function get_mind_map(text, uuid)                        from public, anon, authenticated;
revoke all on function create_mind_map(text, uuid, text)               from public, anon, authenticated;
revoke all on function save_mind_map(text, uuid, jsonb, text)          from public, anon, authenticated;
revoke all on function delete_mind_map(text, uuid)                     from public, anon, authenticated;
grant execute on function get_mind_maps(text, uuid)                    to service_role;
grant execute on function get_mind_map(text, uuid)                     to service_role;
grant execute on function create_mind_map(text, uuid, text)            to service_role;
grant execute on function save_mind_map(text, uuid, jsonb, text)       to service_role;
grant execute on function delete_mind_map(text, uuid)                  to service_role;

notify pgrst, 'reload schema';
