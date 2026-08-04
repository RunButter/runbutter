-- ============================================================================
-- RunButter — 0081_doc_kinds_and_attachments.sql
-- Docs get a kind, and both docs and chat get images.
--
-- TWO SMALL SCHEMA CHANGES, ONE IDEA. Everything needed to put a picture in a
-- document or a message already exists — 0065 built a private bucket, an upload
-- route that records a `files` row, a membership-checked signed-URL reader, and
-- full-text indexing over the result. What was missing was a way to REFER to
-- one of those files from somewhere other than the Files screen.
--
-- So nothing here uploads, stores or serves an image. An attachment is a
-- `files.id`, and reading it goes down the same path a contract does. Three
-- consequences fall out for free rather than being built:
--   · an image dropped into a channel is already in FTS-indexed storage
--   · deleting the file deletes the attachment's target, everywhere at once
--   · a private bucket stays private — no public URL is ever minted
--
-- WHY NOT STORE A URL. A signed URL expires, so a document written today would
-- show broken images next week. The id is stable; the URL is minted per render.
--
-- ── docs.kind ───────────────────────────────────────────────────────────────
-- `doc` is the existing rich document. `note` is the light one — a quick note
-- with checkboxes, the thing people currently keep in a text file next to the
-- app. Two values, not four: a kind the editor cannot render is a bug waiting,
-- and `sheet`/`canvas` already exist elsewhere in the product (Excel sync,
-- Maps). The CHECK is what stops a third appearing by accident.
--
-- ── messages.attachments ────────────────────────────────────────────────────
-- A jsonb array of {file_id, name, mime, size}. Denormalised on purpose: the
-- name and size are snapshotted the same way `author_name` is, so a message
-- still reads sensibly after the file is deleted, and rendering a channel does
-- not need a join per message.
--
-- `post_message` is DROPPED and recreated rather than replaced, because adding
-- a parameter creates an overload and every existing 4-argument call then fails
-- as ambiguous. Same reasoning as 0068's `save_agent` and 0078's
-- `create_api_key`. `save_doc` below, for the same reason.
--
-- Depends on 0034 (docs), 0065 (files), 0075 (chat). Idempotent & prod-safe.
-- ============================================================================

-- ── Docs: a kind ────────────────────────────────────────────────────────────
alter table docs add column if not exists kind text not null default 'doc';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'docs_kind_check') then
    alter table docs add constraint docs_kind_check check (kind in ('doc', 'note'));
  end if;
end $$;

-- Listing filters by kind, so it belongs in the index the list already uses.
create index if not exists idx_docs_ws_kind on docs(workspace_id, kind, updated_at desc);

-- Same shape as 0034's, plus `kind`. Signature unchanged, so a plain replace.
create or replace function get_docs(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', d.id, 'title', d.title, 'snippet', left(d.body, 140),
    'kind', d.kind, 'updated_at', d.updated_at
  ) order by d.updated_at desc) from docs d where d.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_docs(text, uuid) to authenticated, anon;

create or replace function get_doc(p_privy text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  return (select to_jsonb(t) from (
    select id, title, body, kind, updated_at from docs where id = p_id and workspace_id = any(my)
  ) t);
end $$;
grant execute on function get_doc(text, uuid) to authenticated, anon;

-- Dropped, not replaced — see the header. The old four-argument form goes with
-- it, so nothing is left to be ambiguous against.
drop function if exists save_doc(text, uuid, uuid, text, text);
create or replace function save_doc(
  p_privy text, p_workspace uuid, p_id uuid, p_title text, p_body text,
  p_kind text default 'doc'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_kind text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Fail to the existing kind rather than to an error: an old client that does
  -- not send one must keep working, and a bad value must never widen the CHECK.
  v_kind := case when p_kind in ('doc', 'note') then p_kind else null end;

  if p_id is null then
    insert into docs (workspace_id, title, body, kind, created_by_privy)
    values (p_workspace, coalesce(nullif(p_title, ''), 'Untitled'), coalesce(p_body, ''),
            coalesce(v_kind, 'doc'), p_privy)
    returning id into v_id;
  else
    update docs
       set title = coalesce(nullif(p_title, ''), title),
           body  = coalesce(p_body, body),
           kind  = coalesce(v_kind, kind)
     where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_doc(text, uuid, uuid, text, text, text) to authenticated, anon;

-- ── Chat: attachments ───────────────────────────────────────────────────────
alter table messages add column if not exists attachments jsonb not null default '[]'::jsonb;

-- A message is now non-empty if it has EITHER text or an attachment. Before
-- this, `post_message` raised EMPTY_MESSAGE on a blank body, which is exactly
-- what "here, look at this picture" looks like.
--
-- Sanitising in SQL rather than trusting the client, because this is the only
-- place both the caller's identity and the file's workspace are known at once.
-- Every attachment must name a file in the SAME workspace as the channel:
-- reading the bytes is separately gated, but a foreign id would still leak that
-- file's NAME and SIZE into a channel that has no business seeing them.
create or replace function sanitize_attachments(p_workspace uuid, p_att jsonb)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'file_id', f.id,
           -- Snapshotted, like author_name: the message should still read
           -- sensibly after the file itself is gone.
           'name',    f.name,
           'mime',    coalesce(f.mime_type, ''),
           'size',    coalesce(f.size_bytes, 0)
         ) order by a.ord), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_att) = 'array' then p_att else '[]'::jsonb end)
           with ordinality as a(el, ord)
    join files f
      on f.id = (a.el ->> 'file_id')::uuid
     and f.workspace_id = p_workspace
   -- Ten is a message, not a folder. An unbounded array is a way to make one
   -- row expensive to render for everyone in the channel, forever.
   where a.ord <= 10
     and (a.el ->> 'file_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;
revoke all on function sanitize_attachments(uuid, jsonb) from public, anon, authenticated;

create or replace function get_messages(
  p_privy text, p_channel uuid, p_before timestamptz default null, p_limit int default 50
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not can_read_channel(p_channel, p_privy) then raise exception 'NO_ACCESS'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at asc) from (
    select m.id, m.author_privy, m.author_name, m.author_kind,
           case when m.deleted_at is null then m.body else '' end as body,
           -- A deleted message drops its attachments with its text. Leaving the
           -- pictures behind is not a deletion either.
           case when m.deleted_at is null then m.attachments else '[]'::jsonb end as attachments,
           m.deleted_at is not null as deleted, m.edited_at, m.created_at
      from messages m
     where m.channel_id = p_channel
       and (p_before is null or m.created_at < p_before)
     order by m.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x), '[]'::jsonb);
end $$;
grant execute on function get_messages(text, uuid, timestamptz, int) to authenticated, anon;

drop function if exists post_message(text, uuid, text, text);
create or replace function post_message(
  p_privy text, p_channel uuid, p_body text, p_author_name text default '',
  p_attachments jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ws uuid; v_body text; v_att jsonb;
begin
  if not can_read_channel(p_channel, p_privy) then raise exception 'NO_ACCESS'; end if;
  select workspace_id into v_ws from channels where id = p_channel;

  v_body := left(trim(coalesce(p_body, '')), 8000);
  v_att  := sanitize_attachments(v_ws, p_attachments);
  -- Either one is enough. An image with no caption is a perfectly ordinary
  -- message; a blank one with no attachment is still nothing.
  if v_body = '' and v_att = '[]'::jsonb then raise exception 'EMPTY_MESSAGE'; end if;

  insert into messages (workspace_id, channel_id, author_privy, author_name, body, attachments)
  values (v_ws, p_channel, p_privy, left(coalesce(p_author_name, ''), 80), v_body, v_att)
  returning id into v_id;

  insert into channel_members (channel_id, privy_user_id, last_read_at)
  values (p_channel, p_privy, now())
  on conflict (channel_id, privy_user_id) do update set last_read_at = now();

  update channels set updated_at = now() where id = p_channel;
  return v_id;
end $$;
grant execute on function post_message(text, uuid, text, text, jsonb) to authenticated, anon;

-- `edit_message` is deliberately untouched: editing text is a different act
-- from re-attaching files, and letting an edit swap the attachments would mean
-- the picture everyone replied to could be changed after the fact.

notify pgrst, 'reload schema';
