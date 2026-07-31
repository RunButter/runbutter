-- ============================================================================
-- RunButter — 0069_post_board.sql
-- Post Studio board: the whole content plan on one canvas, posts you drag and
-- connect. A campaign is a sequence — teaser, launch, follow-up — and neither
-- the calendar nor the grid can show that a post EXISTS BECAUSE of another one.
--
-- WHY POSITIONS, NOT NODES.
-- 0067 stores mind maps as React Flow's whole { nodes, edges } graph, because
-- there a node IS the content. Here a node is a POST — a real row that the
-- calendar, the grid and the share link all read. If the board stored nodes
-- too, every edit would have to be written twice and the two copies would drift
-- the first time someone renamed a post from the calendar.
--
-- So the board stores only what the posts themselves cannot: a position per
-- post id, plus the edges between them. Nodes are derived from the live post
-- list on every open. That makes the board self-healing — a post deleted
-- anywhere simply stops being drawn, and a post created anywhere shows up
-- needing a place — with no cleanup job and no possibility of a stale card.
--
-- One board per workspace: this is the marketing team's shared plan, not a
-- document you make several of.
-- Depends on 0001 (workspaces) and 0028 (posts).
-- ============================================================================

create table if not exists post_boards (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  -- { positions: { "<post_id>": { "x": 0, "y": 0 } }, edges: [ ...React Flow edges ] }
  graph        jsonb not null default '{"positions":{},"edges":[]}'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   text
);

alter table post_boards enable row level security;
revoke all on table post_boards from anon, authenticated;

create or replace function get_post_board(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- A workspace that has never opened the board has no row; an empty graph is
  -- the correct answer, not an error, so the canvas opens with everything
  -- auto-placed instead of showing a failure.
  return coalesce(
    (select b.graph from post_boards b where b.workspace_id = p_workspace),
    '{"positions":{},"edges":[]}'::jsonb
  );
end $$;
grant execute on function get_post_board(text, uuid) to authenticated, anon;

create or replace function save_post_board(p_privy text, p_workspace uuid, p_graph jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  -- Client-authored, so guarded rather than trusted — same reasoning as
  -- save_mind_map (0067). Without the cap one bad client could write a row that
  -- every subsequent open has to download.
  if p_graph is null
     or jsonb_typeof(p_graph) <> 'object'
     or jsonb_typeof(coalesce(p_graph->'positions', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_graph->'edges', '[]'::jsonb)) <> 'array'
  then raise exception 'BAD_GRAPH'; end if;
  if pg_column_size(p_graph) > 1048576 then raise exception 'GRAPH_TOO_LARGE'; end if;

  insert into post_boards (workspace_id, graph, updated_at, updated_by)
  values (p_workspace, p_graph, now(), p_privy)
  on conflict (workspace_id) do update
    set graph = excluded.graph, updated_at = now(), updated_by = excluded.updated_by;
  return true;
end $$;
grant execute on function save_post_board(text, uuid, jsonb) to authenticated, anon;

notify pgrst, 'reload schema';
