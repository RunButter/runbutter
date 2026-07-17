-- ============================================================================
-- RunButter Platform Core — 0008_import.sql
-- Bulk import for any object. Reuses create_record per row (so all per-object
-- column mapping/validation is shared). Bad rows are skipped, not fatal.
-- Additive & prod-safe. Depends on 0001–0007.
-- ============================================================================

create or replace function import_records(p_privy text, p_workspace uuid, p_object text, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      perform create_record(p_privy, p_workspace, p_object, r);
      n := n + 1;
    exception when others then
      null;  -- skip a malformed row, keep importing the rest
    end;
  end loop;
  return n;
end $$;
grant execute on function import_records(text, uuid, text, jsonb) to authenticated, anon;

notify pgrst, 'reload schema';
