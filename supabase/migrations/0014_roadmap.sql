-- ============================================================================
-- HireBTR Platform Core — 0014_roadmap.sql
-- Project roadmap: every project with its issues (incl. due_date) so the
-- timeline view can lay out a Gantt-lite. Additive & prod-safe.
-- Depends on 0001–0006 (projects/issues). Run AFTER them.
-- ============================================================================

create or replace function get_roadmap(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pr.id,
      'name', pr.name,
      'identifier', pr.identifier,
      'status', pr.status,
      'issues', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', i.id, 'title', i.title, 'status', i.status, 'priority', i.priority, 'due_date', i.due_date
        ) order by i.due_date nulls last, i.sort_order)
        from issues i where i.project_id = pr.id
      ), '[]'::jsonb)
    ) order by pr.created_at)
    from projects pr where pr.workspace_id = p_workspace
  ), '[]'::jsonb);
end $$;
grant execute on function get_roadmap(text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
