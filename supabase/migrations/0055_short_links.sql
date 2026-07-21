-- ============================================================================
-- RunButter — 0055_short_links.sql
-- URL shortener: workspace-scoped short links with click counting and a public
-- /l/<code> redirect.
--
-- Note: this is intentionally NOT built on the legacy `tracking_links` table.
-- That one is company-scoped (the HR candidate source-attribution feature) and
-- predates the workspace model; reusing it would tangle general link-shortening
-- with recruiting attribution. short_links is workspace-scoped like everything
-- built since the CRM pivot. The two coexist.
--
-- register_short_click is anon SECURITY DEFINER (a public redirect must resolve
-- without a session) and only ever bumps a counter + returns the target of the
-- row matching the code — it cannot read or change anything else. Owner RPCs are
-- service_role-only (0046 posture). Depends on 0012.
-- ============================================================================

create table if not exists short_links (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  code         text not null unique,
  target_url   text not null,
  title        text,
  clicks       bigint not null default 0,
  created_by   text,
  created_at   timestamptz default now()
);
create index if not exists idx_short_links_ws on short_links(workspace_id);
alter table short_links enable row level security;
revoke all on table short_links from anon, authenticated;

create or replace function get_short_links(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', l.id, 'code', l.code, 'target_url', l.target_url, 'title', l.title,
    'clicks', l.clicks, 'created_at', l.created_at
  ) order by l.created_at desc) from short_links l where l.workspace_id = p_workspace), '[]'::jsonb);
end $$;

create or replace function create_short_link(p_privy text, p_workspace uuid, p_target text, p_title text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text; v_code text; v_id uuid; tries int := 0;
begin
  v_role := workspace_role(p_privy, p_workspace);
  if v_role is null or v_role not in ('owner','admin','member','recruiter') then raise exception 'FORBIDDEN'; end if;
  if p_target !~* '^https?://' then raise exception 'INVALID_URL'; end if;

  -- Custom code if given + valid + free; otherwise generate a unique short one.
  if coalesce(p_code,'') <> '' then
    if lower(p_code) !~ '^[a-z0-9-]{3,32}$' then raise exception 'BAD_CODE'; end if;
    v_code := lower(p_code);
    if exists (select 1 from short_links where code = v_code) then raise exception 'CODE_TAKEN'; end if;
  else
    loop
      v_code := lower(substr(replace(gen_random_uuid()::text,'-',''), 1, 7));
      exit when not exists (select 1 from short_links where code = v_code);
      tries := tries + 1; if tries > 5 then raise exception 'CODE_GEN_FAILED'; end if;
    end loop;
  end if;

  insert into short_links (workspace_id, code, target_url, title, created_by)
  values (p_workspace, v_code, p_target, nullif(p_title,''), p_privy)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

create or replace function delete_short_link(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_role text; v_n int;
begin
  v_role := workspace_role(p_privy, p_workspace);
  if v_role is null or v_role not in ('owner','admin','member','recruiter') then raise exception 'FORBIDDEN'; end if;
  delete from short_links where id = p_id and workspace_id = p_workspace;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- Public: resolve a code to its target and count the click. Returns null for an
-- unknown code so the redirect route can 404 cleanly.
create or replace function register_short_click(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare v_target text;
begin
  update short_links set clicks = clicks + 1
   where code = lower(p_code)
  returning target_url into v_target;
  return v_target;
end $$;

revoke all on function get_short_links(text, uuid)                    from public, anon, authenticated;
revoke all on function create_short_link(text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function delete_short_link(text, uuid, uuid)            from public, anon, authenticated;
grant execute on function get_short_links(text, uuid)                    to service_role;
grant execute on function create_short_link(text, uuid, text, text, text) to service_role;
grant execute on function delete_short_link(text, uuid, uuid)            to service_role;
-- Public redirect counter (anon; DEFINER, touches only the matched row).
grant execute on function register_short_click(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
