-- ============================================================================
-- RunButter — 0085_doc_kinds_wider.sql
-- Two more document kinds: a checklist and a table.
--
-- 0081 shipped `doc | note` and said so out loud: a kind the editor cannot
-- render is a bug waiting. Both of these now have an editor, so the CHECK
-- widens to match — which is the whole reason it was a CHECK and not a free
-- text column.
--
--   todo  — a real checklist. Not "a note that happens to contain checkboxes":
--           it has its own editor, its own progress count, and reordering.
--   sheet — a small table. NOT a spreadsheet: no formulas, no cell references,
--           no recalculation. Anyone who needs those already has the Excel
--           feed (0078) and two-way sync (0079) pointing at real records, and
--           reimplementing a formula engine here would be a worse version of
--           a thing this product already integrates with properly.
--
-- BOTH STORE MARKDOWN, in the same `body` column as everything else. A todo is
-- `- [ ] …` lines; a sheet is a markdown table. That is what keeps every kind
-- openable in every editor, exportable by one code path, and searchable by the
-- same query — and it is why adding a kind is a CHECK change rather than a
-- schema change.
--
-- Depends on 0081. Idempotent & prod-safe.
-- ============================================================================

-- `drop constraint if exists` then re-add: a CHECK cannot be widened in place,
-- and dropping first is what makes re-running this safe.
alter table docs drop constraint if exists docs_kind_check;
alter table docs add constraint docs_kind_check
  check (kind in ('doc', 'note', 'todo', 'sheet'));

-- The validator in save_doc has to widen with it, or a `todo` would be silently
-- stored as whatever the row already was — which is exactly the fallback's job
-- for BAD values, and the wrong answer for good ones. Full redefinition rather
-- than a parallel function; the signature is unchanged from 0081, so this is a
-- plain replace and no overload appears.
create or replace function save_doc(
  p_privy text, p_workspace uuid, p_id uuid, p_title text, p_body text,
  p_kind text default 'doc'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_kind text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Unknown → null → keep the existing kind. An old client that sends nothing
  -- must keep working, and a bad value must never widen the CHECK by the back
  -- door.
  v_kind := case when p_kind in ('doc', 'note', 'todo', 'sheet') then p_kind else null end;

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

notify pgrst, 'reload schema';
