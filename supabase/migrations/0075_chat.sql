-- ============================================================================
-- RunButter — 0075_chat.sql
-- Team chat: channels, messages, and unread state.
--
-- WHY BUILD THIS RATHER THAN INTEGRATE SLACK. The value is not chat — it is chat
-- ATTACHED TO RECORDS. A thread on an invoice, a candidate, a deal, sitting in
-- the same database as the thing it is about. Slack structurally cannot do that
-- because it does not know what an invoice is. That also bounds the scope: the
-- hard parts of a chat product (presence, infinite history, mobile push,
-- threading depth) are not where the value is, so v1 leaves them out.
--
-- VISIBILITY IS DECIDED IN SQL, ONCE. `can_read_channel` is the single predicate
-- every read and write goes through. A public channel is readable by any
-- workspace member; a private one only by its members. Scattering that rule
-- across a dozen RPCs is how a private channel eventually leaks — so it is one
-- function, and every other function calls it.
--
-- NO REALTIME SUBSCRIPTION IN V1, DELIBERATELY. Supabase Realtime delivers
-- Postgres changes to the BROWSER using the anon key and RLS policies. This
-- project revokes anon/authenticated on everything and routes reads through the
-- verified /api/rpc proxy (0040/0046). Opening RLS policies on messages purely
-- to get a websocket would reintroduce exactly the hole that proxy closed. The
-- client polls instead; the cost is a few seconds of latency, and the honest
-- upgrade path is a server-side SSE endpoint, not loosened RLS.
--
-- Depends on 0001 (workspaces). Additive, idempotent & prod-safe.
-- ============================================================================

create table if not exists channels (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null default 'general',
  topic         text not null default '',
  is_private    boolean not null default false,
  -- The differentiator: a channel that belongs to a record. Free-text object
  -- name rather than a FK, matching how files and automations already reference
  -- objects across a schema where each lives in its own table.
  linked_object text,
  linked_id     uuid,
  created_by_privy text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_channels_ws on channels(workspace_id, updated_at desc);
create index if not exists idx_channels_linked on channels(workspace_id, linked_object, linked_id)
  where linked_object is not null;
drop trigger if exists trg_channels_upd on channels;
create trigger trg_channels_upd before update on channels for each row execute function set_updated_at();
alter table channels enable row level security;
revoke all on table channels from anon, authenticated;

create table if not exists channel_members (
  channel_id   uuid not null references channels(id) on delete cascade,
  privy_user_id text not null,
  -- Where this person has read up to. Nullable = never opened it, which is
  -- distinct from "read nothing since the epoch".
  last_read_at timestamptz,
  joined_at    timestamptz not null default now(),
  primary key (channel_id, privy_user_id)
);
create index if not exists idx_channel_members_user on channel_members(privy_user_id);
alter table channel_members enable row level security;
revoke all on table channel_members from anon, authenticated;

create table if not exists messages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  channel_id   uuid not null references channels(id) on delete cascade,
  author_privy text not null,
  -- Snapshotted. Resolving a display name at read time would mean a join per
  -- message against a directory that may no longer hold the author, and a
  -- message from someone who has left should still say who wrote it.
  author_name  text not null default '',
  -- 'user' | 'agent' | 'system'. Agents post as themselves rather than
  -- impersonating a person; a reader must always be able to tell.
  author_kind  text not null default 'user' check (author_kind in ('user', 'agent', 'system')),
  body         text not null default '',
  -- Soft delete: a hole in a conversation is more confusing than a tombstone,
  -- and replies above and below stop making sense without one.
  deleted_at   timestamptz,
  edited_at    timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_messages_channel on messages(channel_id, created_at desc);
alter table messages enable row level security;
revoke all on table messages from anon, authenticated;

-- ── The one visibility predicate ─────────────────────────────────────────────
create or replace function can_read_channel(p_channel uuid, p_privy text)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from channels c
     where c.id = p_channel
       and is_workspace_member(c.workspace_id, p_privy)
       and (
         not c.is_private
         or exists (select 1 from channel_members m
                     where m.channel_id = c.id and m.privy_user_id = p_privy)
       )
  );
$$;

-- ── Channels ─────────────────────────────────────────────────────────────────
create or replace function get_channels(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (
    select c.id, c.name, c.topic, c.is_private, c.linked_object, c.linked_id, c.updated_at,
           exists (select 1 from channel_members m
                    where m.channel_id = c.id and m.privy_user_id = p_privy) as joined,
           -- Unread count. A channel never opened counts everything, which is
           -- why last_read_at is nullable rather than defaulted to now().
           (select count(*) from messages msg
             where msg.channel_id = c.id and msg.deleted_at is null
               and msg.author_privy <> p_privy
               and (msg.created_at > (select m.last_read_at from channel_members m
                                       where m.channel_id = c.id and m.privy_user_id = p_privy)
                    or (select m.last_read_at from channel_members m
                         where m.channel_id = c.id and m.privy_user_id = p_privy) is null)
           ) as unread
      from channels c
     where c.workspace_id = p_workspace
       and (not c.is_private
            or exists (select 1 from channel_members m
                        where m.channel_id = c.id and m.privy_user_id = p_privy))
  ) x), '[]'::jsonb);
end $$;
grant execute on function get_channels(text, uuid) to authenticated, anon;

create or replace function create_channel(
  p_privy text, p_workspace uuid, p_name text, p_topic text default '',
  p_private boolean default false, p_object text default null, p_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Slack-ish normalisation, so #Sales and #sales are not two channels.
  v_name := lower(trim(regexp_replace(coalesce(nullif(p_name,''),'general'), '[^a-zA-Z0-9 _-]', '', 'g')));
  v_name := regexp_replace(v_name, '\s+', '-', 'g');
  if v_name = '' then v_name := 'general'; end if;
  if length(v_name) > 60 then v_name := left(v_name, 60); end if;

  insert into channels (workspace_id, name, topic, is_private, linked_object, linked_id, created_by_privy)
  values (p_workspace, v_name, coalesce(p_topic,''), coalesce(p_private,false), p_object, p_id, p_privy)
  returning id into v_id;

  -- The creator is always a member, private or not — otherwise creating a
  -- private channel would immediately lock its author out of it.
  insert into channel_members (channel_id, privy_user_id) values (v_id, p_privy)
  on conflict do nothing;
  return v_id;
end $$;
grant execute on function create_channel(text, uuid, text, text, boolean, text, uuid) to authenticated, anon;

create or replace function delete_channel(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if not can_read_channel(p_id, p_privy) then raise exception 'NO_ACCESS'; end if;
  delete from channels where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function delete_channel(text, uuid, uuid) to authenticated, anon;

create or replace function join_channel(p_privy text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  -- can_read_channel already excludes a private channel you are not in, so this
  -- cannot be used to add yourself to one.
  if not can_read_channel(p_id, p_privy) then raise exception 'NO_ACCESS'; end if;
  insert into channel_members (channel_id, privy_user_id) values (p_id, p_privy)
  on conflict do nothing;
  return true;
end $$;
grant execute on function join_channel(text, uuid) to authenticated, anon;

create or replace function add_channel_member(p_privy text, p_id uuid, p_member text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  if not can_read_channel(p_id, p_privy) then raise exception 'NO_ACCESS'; end if;
  select workspace_id into v_ws from channels where id = p_id;
  -- The invitee must already be in the workspace. Without this check a private
  -- channel becomes a way to expose workspace data to an arbitrary Privy id.
  if not is_workspace_member(v_ws, p_member) then raise exception 'NOT_A_MEMBER'; end if;
  insert into channel_members (channel_id, privy_user_id) values (p_id, p_member)
  on conflict do nothing;
  return true;
end $$;
grant execute on function add_channel_member(text, uuid, text) to authenticated, anon;

create or replace function leave_channel(p_privy text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  delete from channel_members where channel_id = p_id and privy_user_id = p_privy;
  return found;
end $$;
grant execute on function leave_channel(text, uuid) to authenticated, anon;

-- ── Messages ─────────────────────────────────────────────────────────────────
/**
 * Newest-first with a `before` cursor, not offset paging. A conversation grows
 * at the end someone is reading, so offsets shift under the reader and produce
 * duplicated or skipped messages while they scroll.
 */
create or replace function get_messages(
  p_privy text, p_channel uuid, p_before timestamptz default null, p_limit int default 50
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not can_read_channel(p_channel, p_privy) then raise exception 'NO_ACCESS'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at asc) from (
    select m.id, m.author_privy, m.author_name, m.author_kind,
           -- The body of a deleted message is never returned, not even to the
           -- author: a tombstone that still carries its text is not a deletion.
           case when m.deleted_at is null then m.body else '' end as body,
           m.deleted_at is not null as deleted, m.edited_at, m.created_at
      from messages m
     where m.channel_id = p_channel
       and (p_before is null or m.created_at < p_before)
     order by m.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x), '[]'::jsonb);
end $$;
grant execute on function get_messages(text, uuid, timestamptz, int) to authenticated, anon;

create or replace function post_message(
  p_privy text, p_channel uuid, p_body text, p_author_name text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ws uuid; v_body text;
begin
  if not can_read_channel(p_channel, p_privy) then raise exception 'NO_ACCESS'; end if;
  v_body := left(trim(coalesce(p_body, '')), 8000);
  if v_body = '' then raise exception 'EMPTY_MESSAGE'; end if;
  select workspace_id into v_ws from channels where id = p_channel;

  insert into messages (workspace_id, channel_id, author_privy, author_name, body)
  values (v_ws, p_channel, p_privy, left(coalesce(p_author_name,''), 80), v_body)
  returning id into v_id;

  -- Posting implies membership and implies you have read up to now — otherwise
  -- your own message shows as unread to you.
  insert into channel_members (channel_id, privy_user_id, last_read_at)
  values (p_channel, p_privy, now())
  on conflict (channel_id, privy_user_id) do update set last_read_at = now();

  update channels set updated_at = now() where id = p_channel;
  return v_id;
end $$;
grant execute on function post_message(text, uuid, text, text) to authenticated, anon;

create or replace function edit_message(p_privy text, p_id uuid, p_body text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_body text;
begin
  v_body := left(trim(coalesce(p_body, '')), 8000);
  if v_body = '' then raise exception 'EMPTY_MESSAGE'; end if;
  -- Author only. Channel access is not enough to rewrite someone else's words.
  update messages set body = v_body, edited_at = now()
   where id = p_id and author_privy = p_privy and deleted_at is null;
  return found;
end $$;
grant execute on function edit_message(text, uuid, text) to authenticated, anon;

create or replace function delete_message(p_privy text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update messages set deleted_at = now(), body = ''
   where id = p_id and author_privy = p_privy and deleted_at is null;
  return found;
end $$;
grant execute on function delete_message(text, uuid) to authenticated, anon;

create or replace function mark_channel_read(p_privy text, p_channel uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not can_read_channel(p_channel, p_privy) then raise exception 'NO_ACCESS'; end if;
  insert into channel_members (channel_id, privy_user_id, last_read_at)
  values (p_channel, p_privy, now())
  on conflict (channel_id, privy_user_id) do update set last_read_at = now();
  return true;
end $$;
grant execute on function mark_channel_read(text, uuid) to authenticated, anon;

-- ── Agents post here ─────────────────────────────────────────────────────────
/**
 * Service-role only, so an agent's run summary can land in a channel instead of
 * a runs table nobody opens. author_kind is forced to 'agent' — an agent must
 * never be able to post as a person, and the reader must always be able to
 * tell which is which.
 */
create or replace function post_agent_message(
  p_workspace uuid, p_channel uuid, p_agent_name text, p_body text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from channels where id = p_channel and workspace_id = p_workspace) then
    return null;
  end if;
  insert into messages (workspace_id, channel_id, author_privy, author_name, author_kind, body)
  values (p_workspace, p_channel, 'agent', left(coalesce(p_agent_name,'Agent'), 80), 'agent',
          left(trim(coalesce(p_body,'')), 8000))
  returning id into v_id;
  update channels set updated_at = now() where id = p_channel;
  return v_id;
end $$;
revoke all on function post_agent_message(uuid, uuid, text, text) from public, authenticated, anon;
grant execute on function post_agent_message(uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
