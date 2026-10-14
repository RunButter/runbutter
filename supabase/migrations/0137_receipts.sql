-- ============================================================================
-- 0137_receipts.sql — a receipt becomes an expense, with the receipt attached.
--
-- Finance → Expenses → Scan receipts: a photo or PDF is uploaded to Files
-- (0065), read (text layer, OCR, or the workspace's own AI key), checked by a
-- person, and saved. Saving is ONE function so the expense and the file's link
-- to it cannot come apart: the expense is created through create_record — the
-- same path as the form, so the plan's record limit applies — and the file is
-- linked to it in the same transaction.
--
-- A file already filed as another expense's receipt is refused (a receipt
-- paid twice is the mistake this screen exists to prevent), and a file from
-- another workspace is NOT_FOUND, never linked.
-- ============================================================================

create or replace function save_receipt_expense(p_privy text, p_workspace uuid, p_file uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f files; v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(workspace_role(p_privy, p_workspace), '') = 'viewer' then raise exception 'FORBIDDEN'; end if;
  select * into f from files where id = p_file and workspace_id = p_workspace for update;
  if f.id is null then raise exception 'NOT_FOUND'; end if;
  if f.linked_object = 'expenses' and f.linked_id is not null
     and exists (select 1 from expenses e where e.id = f.linked_id) then
    raise exception 'ALREADY_FILED';
  end if;
  v_id := create_record(p_privy, p_workspace, 'expenses', p_data);
  update files set linked_object = 'expenses', linked_id = v_id where id = p_file;
  return jsonb_build_object('id', v_id, 'file_id', p_file);
end $$;

-- The receipts screen's list: expenses that carry a receipt, newest first.
create or replace function get_receipts(p_privy text, p_workspace uuid, p_limit int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'file_id', f.id, 'name', f.name, 'mime_type', f.mime_type, 'uploaded_at', f.created_at,
      'expense_id', e.id, 'vendor', e.vendor, 'amount', e.amount, 'category', e.category,
      'status', e.status, 'spent_at', e.spent_at) order by f.created_at desc)
    from (select * from files
           where workspace_id = p_workspace and linked_object = 'expenses' and linked_id is not null
           order by created_at desc limit greatest(1, least(coalesce(p_limit, 60), 200))) f
    join expenses e on e.id = f.linked_id and e.workspace_id = p_workspace
  ), '[]'::jsonb);
end $$;

revoke all on function save_receipt_expense(text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function get_receipts(text, uuid, int)                 from public, anon, authenticated;
grant execute on function save_receipt_expense(text, uuid, uuid, jsonb) to service_role;
grant execute on function get_receipts(text, uuid, int)                 to service_role;

notify pgrst, 'reload schema';
