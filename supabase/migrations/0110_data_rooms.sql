-- ============================================================================
-- RunButter — 0110_data_rooms.sql
--
-- Share a fixed set of files as one link: a data room. The case is fundraising
-- and due diligence, where the alternative is a Drive folder somebody forgets
-- to un-share three months later.
--
-- ── THE FILE SET IS FROZEN AT PUBLISH TIME ──────────────────────────────────
-- Same decision as 0109's snapshots, for the same reason. A link that resolves
-- to "the files in folder X" hands out whatever ends up in that folder later,
-- and the person who shared it is not thinking about the link when they upload
-- next month's payroll. `file_ids` is a fixed array chosen when the room is
-- made; adding a file is a deliberate act, not a side effect of filing.
--
-- ── THE TOKEN GRANTS EXACTLY THESE FILES AND NOTHING ELSE ───────────────────
-- The public reader takes a token and returns NAMES and SIZES — never a URL. A
-- URL is minted one file at a time, by a function that first checks the file is
-- in that room. So the capability is scoped by construction: possessing a room
-- token cannot be turned into a read of any other file in the workspace, even
-- if the reader knows its id.
--
-- 128 bits from gen_random_bytes, generated in SQL so a client cannot choose a
-- guessable one — as in 0109.
--
-- ── THE ACCESS LOG IS THE FEATURE, NOT TELEMETRY ────────────────────────────
-- "Did they open it, and what did they read" is the question every founder has
-- after sending a deck. Events are per ROOM and per FILE, and deliberately hold
-- no IP address and no fingerprint: this product has no telemetry anywhere else
-- and a data room is a bad place to start. What it records is what the owner
-- could infer anyway — that the link was used, when, and which document was
-- opened.
--
-- Revoked and expired rooms return nothing, and a bad token is indistinguishable
-- from a revoked one.
-- ============================================================================

create table if not exists data_rooms (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  token        text not null unique,
  title        text not null default 'Data room',
  note         text not null default '',
  -- A FIXED set. Not a folder, not a query — see the header.
  file_ids     uuid[] not null default '{}',
  created_by   text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz
);

create index if not exists idx_data_rooms_ws on data_rooms(workspace_id, created_at desc);

create table if not exists data_room_events (
  id        uuid primary key default gen_random_uuid(),
  room_id   uuid not null references data_rooms(id) on delete cascade,
  -- 'open' = the room was loaded. 'file' = one document was fetched.
  kind      text not null default 'open',
  file_id   uuid,
  at        timestamptz not null default now()
);

create index if not exists idx_data_room_events_room on data_room_events(room_id, at desc);

alter table data_rooms enable row level security;
alter table data_room_events enable row level security;
-- No policies: everything goes through the SECURITY DEFINER functions below.

create or replace function create_data_room(
  p_privy text, p_workspace uuid, p_title text, p_note text, p_files uuid[], p_days int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_token text; v_id uuid; v_ok uuid[];
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  -- Only files this workspace owns. Filtering here rather than trusting the
  -- caller is what stops a crafted request stapling another tenant's file id
  -- into a room and then reading it through the public route.
  select coalesce(array_agg(f.id), '{}') into v_ok
    from files f where f.workspace_id = p_workspace and f.id = any(coalesce(p_files, '{}'));

  if array_length(v_ok, 1) is null then raise exception 'NO_FILES'; end if;

  v_token := encode(gen_random_bytes(16), 'hex');
  insert into data_rooms (workspace_id, token, title, note, file_ids, created_by, expires_at)
  values (p_workspace, v_token,
          coalesce(nullif(trim(p_title), ''), 'Data room'), coalesce(p_note, ''), v_ok, p_privy,
          case when p_days is not null and p_days > 0 then now() + make_interval(days => p_days) end)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token, 'files', array_length(v_ok, 1));
end $$;

-- Public: the room's contents as NAMES, never URLs. Logs the open.
create or replace function get_data_room_public(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from data_rooms
   where token = p_token and revoked_at is null
     and (expires_at is null or expires_at > now());
  if not found then return null; end if;

  insert into data_room_events (room_id, kind) values (r.id, 'open');

  return jsonb_build_object(
    'title', r.title,
    'note', r.note,
    'created_at', r.created_at,
    'files', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'size', f.size_bytes, 'mime', f.mime_type)
             order by f.name)
        from files f where f.id = any(r.file_ids)
    ), '[]'::jsonb),
    'brand', (select jsonb_build_object('name', w.name, 'logo_url', w.logo_url)
                from workspaces w where w.id = r.workspace_id)
  );
end $$;

/**
 * Public: resolve ONE file's storage path, but only if it is in this room.
 *
 * Returns the path rather than a URL because signing belongs to the storage
 * client in the route. The membership check is the whole security property —
 * without it a room token would become a read of any file id the caller could
 * name.
 */
create or replace function data_room_file_path(p_token text, p_file uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; f record;
begin
  select * into r from data_rooms
   where token = p_token and revoked_at is null
     and (expires_at is null or expires_at > now());
  if not found then return null; end if;
  if not (p_file = any(r.file_ids)) then return null; end if;

  select id, name, storage_path into f from files where id = p_file and workspace_id = r.workspace_id;
  if not found then return null; end if;

  insert into data_room_events (room_id, kind, file_id) values (r.id, 'file', f.id);
  return jsonb_build_object('path', f.storage_path, 'name', f.name);
end $$;

create or replace function get_data_rooms(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'token', r.token, 'title', r.title, 'created_at', r.created_at,
      'expires_at', r.expires_at, 'revoked_at', r.revoked_at,
      'file_count', coalesce(array_length(r.file_ids, 1), 0),
      'opens', (select count(*) from data_room_events e where e.room_id = r.id and e.kind = 'open'),
      'last_open', (select max(e.at) from data_room_events e where e.room_id = r.id)
    ) order by r.created_at desc)
    from data_rooms r where r.workspace_id = p_workspace
  ), '[]'::jsonb);
end $$;

-- The log for one room: what was opened and when. Owner side only.
create or replace function get_data_room_activity(p_privy text, p_workspace uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('kind', e.kind, 'at', e.at, 'file', f.name) order by e.at desc)
      from data_room_events e
      join data_rooms r on r.id = e.room_id and r.workspace_id = p_workspace
      left join files f on f.id = e.file_id
     where e.room_id = p_id
     limit 200
  ), '[]'::jsonb);
end $$;

create or replace function revoke_data_room(p_privy text, p_workspace uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update data_rooms set revoked_at = now()
   where id = p_id and workspace_id = p_workspace and revoked_at is null;
end $$;

revoke all on function create_data_room(text, uuid, text, text, uuid[], int) from public, anon, authenticated;
revoke all on function get_data_room_public(text)                            from public, anon, authenticated;
revoke all on function data_room_file_path(text, uuid)                       from public, anon, authenticated;
revoke all on function get_data_rooms(text, uuid)                            from public, anon, authenticated;
revoke all on function get_data_room_activity(text, uuid, uuid)              from public, anon, authenticated;
revoke all on function revoke_data_room(text, uuid, uuid)                    from public, anon, authenticated;
grant execute on function create_data_room(text, uuid, text, text, uuid[], int) to service_role;
grant execute on function get_data_room_public(text)                            to service_role;
grant execute on function data_room_file_path(text, uuid)                       to service_role;
grant execute on function get_data_rooms(text, uuid)                            to service_role;
grant execute on function get_data_room_activity(text, uuid, uuid)              to service_role;
grant execute on function revoke_data_room(text, uuid, uuid)                    to service_role;

notify pgrst, 'reload schema';
