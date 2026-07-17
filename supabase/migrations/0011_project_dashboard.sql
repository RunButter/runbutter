-- ============================================================================
-- RunButter Platform Core — 0011_project_dashboard.sql
-- A project's own dashboard: fetch the project + its issues in one call.
-- Additive & prod-safe. Depends on 0001–0010.
-- ============================================================================

create or replace function get_project(p_privy text, p_project uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from projects where id = p_project;
  if v_ws is null then raise exception 'PROJECT_NOT_FOUND'; end if;
  if not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  return jsonb_build_object(
    'project', (select to_jsonb(t) from (
      select id, name, identifier, status, description from projects where id = p_project
    ) t),
    'issues', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'title', i.title, 'status', i.status, 'priority', i.priority,
        'due_date', i.due_date,
        'assignee', (select a.full_name from accounts a where a.id = i.assignee_account_id)
      ) order by i.sort_order)
      from issues i where i.project_id = p_project), '[]'::jsonb)
  );
end $$;
grant execute on function get_project(text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
