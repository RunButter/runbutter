-- 0103: a skill the copilot wrote should say so
--
-- `skills.source` has been `local | github` since 0068 — written by hand, or
-- imported from a public SKILL.md. The copilot can now write one (it has
-- `save_skill`), and it is neither: `local` claims a person typed it.
--
-- WHY THIS IS A MIGRATION AND NOT A COMMENT. The client passed `'copilot'`
-- and `save_skill` quietly mapped it back to `'local'` — the CHECK constraint
-- would have rejected the row, so 0068's `case when p_source in (...)` fell
-- through to the default. Nothing failed, nothing warned, and the code carried
-- a comment explaining an attribution the database was discarding. That is the
-- same shape as every silent bug in this schema's history, and the fix is to
-- make the database able to store the truth rather than to delete the comment.
--
-- It matters for the same reason `record_notes.source` is NOT NULL: a claim you
-- cannot trace is a claim you cannot check. Somebody reviewing a skill that is
-- teaching every agent how this company chases money should be able to see, a
-- year later, whether a person wrote it.

alter table skills drop constraint if exists skills_source_check;
alter table skills add constraint skills_source_check
  check (source in ('local', 'github', 'copilot'));

-- Redefined IN FULL rather than patched: the whitelist lives inside the
-- function body as well as in the constraint, and leaving the two disagreeing
-- is how the value gets silently rewritten a second time.
create or replace function save_skill(
  p_privy text, p_workspace uuid, p_id uuid, p_name text, p_description text,
  p_instructions text, p_suggested_tools text[], p_source text, p_source_url text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- A skill body becomes part of a system prompt; an unbounded one would blow
  -- the context window of every agent carrying it, so it is capped here rather
  -- than only in the UI (the RPC is reachable without the UI).
  if length(coalesce(p_instructions, '')) > 20000 then raise exception 'SKILL_TOO_LARGE'; end if;
  if p_id is null then
    insert into skills (workspace_id, name, description, instructions, suggested_tools,
                        source, source_url, created_by_privy)
    values (p_workspace, coalesce(nullif(p_name, ''), 'New skill'), coalesce(p_description, ''),
            coalesce(p_instructions, ''), coalesce(p_suggested_tools, '{}'),
            case when p_source in ('local', 'github', 'copilot') then p_source else 'local' end,
            coalesce(p_source_url, ''), p_privy)
    returning id into v_id;
  else
    -- `source` is deliberately NOT updatable. Editing a skill the copilot wrote
    -- does not make it hand-written, and letting an update relabel it would
    -- make the field worth nothing the first time somebody fixed a typo.
    update skills set
      name = coalesce(nullif(p_name, ''), name),
      description = coalesce(p_description, description),
      instructions = coalesce(p_instructions, instructions),
      suggested_tools = coalesce(p_suggested_tools, suggested_tools)
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_skill(text, uuid, uuid, text, text, text, text[], text, text) to authenticated, anon;

notify pgrst, 'reload schema';
