-- ============================================================================
-- RunButter — 0086_doc_cards.sql
-- Notes and to-do lists become live cards: tags, and ticking without opening.
--
-- WHAT CHANGES AND WHY. The Docs index showed a 140-character snippet, which
-- for a checklist is a wall of "- [ ] " and tells you nothing. A list is a
-- thing you glance at and tick — opening a document to check one box off is
-- the whole friction. So the index needs two things it did not have: enough of
-- the body to render the list, and a way to flip one item.
--
-- TICKING GOES THROUGH ITS OWN RPC, not save_doc. Sending the whole body back
-- to toggle one checkbox means the client has to HOLD the whole body — and the
-- index only ever receives a preview, so a save from there would truncate the
-- document to whatever the card happened to be showing. `toggle_doc_item` flips
-- the Nth checklist line in SQL and never transports the body at all.
--
-- TAGS ARE A text[] ON THE ROW, not a table. There is no tag CRUD, no colour
-- picker and no join: a colour is derived from the tag's name in the client, so
-- "Personal" is the same green in every workspace and nobody has to administer
-- a palette. A tags table earns its place when tags need renaming, merging or
-- permissions — none of which is being asked for.
--
-- Depends on 0081 + 0085. Idempotent & prod-safe.
-- ============================================================================

alter table docs add column if not exists tags text[] not null default '{}';

-- Filtering by tag is the point of having them.
create index if not exists idx_docs_tags on docs using gin (tags);

/**
 * Normalise a tag list: trimmed, de-duplicated case-insensitively, capped.
 *
 * Cheap to enforce here and impossible to enforce anywhere else — every caller
 * would otherwise need the same three rules, and "Personal" and "personal"
 * rendering as two different pills is the kind of thing nobody reports and
 * everybody notices.
 */
create or replace function normalize_doc_tags(p_tags text[])
returns text[] language sql immutable as $$
  select coalesce(array_agg(t order by t), '{}')
    from (
      select distinct on (lower(btrim(x))) left(btrim(x), 24) as t
        from unnest(coalesce(p_tags, '{}')) as x
       where btrim(x) <> ''
       order by lower(btrim(x))
       limit 8
    ) s;
$$;

-- ── The index read ──────────────────────────────────────────────────────────
/**
 * Same shape as before plus `tags`, a longer `preview`, and the counts.
 *
 * The counts are computed in SQL rather than by the client parsing `preview`,
 * because the preview is TRUNCATED — counting from it would quietly under-report
 * a long list, and "3/7" that is actually "3/19" is worse than no number.
 */
create or replace function get_docs(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', d.id, 'title', d.title,
    'snippet', left(d.body, 140),
    -- Enough to render a card, nowhere near enough to be a document transfer.
    -- A card caps what it shows anyway, so this is a display budget.
    'preview', left(d.body, 1200),
    'kind', d.kind, 'tags', d.tags,
    'item_count', (select count(*) from regexp_matches(d.body, '^\s*[-*]\s+\[[ xX]\]', 'gn') m),
    'done_count', (select count(*) from regexp_matches(d.body, '^\s*[-*]\s+\[[xX]\]',  'gn') m),
    'updated_at', d.updated_at
  ) order by d.updated_at desc) from docs d where d.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_docs(text, uuid) to authenticated, anon;

create or replace function get_doc(p_privy text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  return (select to_jsonb(t) from (
    select id, title, body, kind, tags, updated_at from docs where id = p_id and workspace_id = any(my)
  ) t);
end $$;
grant execute on function get_doc(text, uuid) to authenticated, anon;

-- ── Writes ──────────────────────────────────────────────────────────────────
-- Dropped and recreated: adding `p_tags` creates an overload, and every
-- six-argument call would then be ambiguous. Same reasoning as 0068 and 0085.
drop function if exists save_doc(text, uuid, uuid, text, text, text);

create or replace function save_doc(
  p_privy text, p_workspace uuid, p_id uuid, p_title text, p_body text,
  p_kind text default null, p_tags text[] default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_kind text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Null = "I am not saying", which is what an omitted argument means. 0081
  -- defaulted this to 'doc' and so silently converted a table back into a
  -- document on any save that did not mention the kind.
  v_kind := case when p_kind in ('doc', 'note', 'todo', 'sheet') then p_kind else null end;

  if p_id is null then
    insert into docs (workspace_id, title, body, kind, tags, created_by_privy)
    values (p_workspace, coalesce(nullif(p_title, ''), 'Untitled'), coalesce(p_body, ''),
            coalesce(v_kind, 'doc'), normalize_doc_tags(p_tags), p_privy)
    returning id into v_id;
  else
    update docs
       set title = coalesce(nullif(p_title, ''), title),
           body  = coalesce(p_body, body),
           kind  = coalesce(v_kind, kind),
           -- Same rule as the kind: null means "leave them", which is what an
           -- older client that knows nothing about tags is saying.
           tags  = case when p_tags is null then tags else normalize_doc_tags(p_tags) end
     where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_doc(text, uuid, uuid, text, text, text, text[]) to authenticated, anon;

/**
 * Flip the Nth checklist item (0-based), in place.
 *
 * The body never leaves the database. That is the point: the index holds a
 * TRUNCATED preview, so a round trip through the client would save whatever the
 * card was showing and throw away the rest of the document.
 *
 * `p_done` is explicit rather than a toggle so a double-tap, a slow network or
 * two people on the same list all converge on the state the person actually
 * chose, instead of racing to the opposite of whatever they last saw.
 *
 * Out-of-range and non-checklist documents return false rather than raising:
 * the caller is a checkbox on a card, and an exception there is a red banner
 * over a list that simply has no such item any more.
 */
create or replace function toggle_doc_item(p_privy text, p_id uuid, p_index int, p_done boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
  v_body text; v_lines text[]; v_out text[] := '{}'; v_n int := 0; v_hit boolean := false;
  v_line text;
begin
  select body into v_body from docs where id = p_id and workspace_id = any(my);
  if v_body is null then return false; end if;

  v_lines := string_to_array(v_body, E'\n');
  foreach v_line in array v_lines loop
    if v_line ~ '^\s*[-*]\s+\[[ xX]\]' then
      if v_n = p_index then
        -- Only the marker is rewritten; the indent, bullet character and text
        -- are left exactly as they were, so a round trip through here is not a
        -- reformat of somebody's list.
        v_line := regexp_replace(v_line, '^(\s*[-*]\s+\[)[ xX](\])',
                                 '\1' || case when p_done then 'x' else ' ' end || '\2');
        v_hit := true;
      end if;
      v_n := v_n + 1;
    end if;
    v_out := v_out || v_line;
  end loop;

  if not v_hit then return false; end if;
  update docs set body = array_to_string(v_out, E'\n') where id = p_id and workspace_id = any(my);
  return true;
end $$;
grant execute on function toggle_doc_item(text, uuid, int, boolean) to authenticated, anon;

notify pgrst, 'reload schema';
