-- ============================================================================
-- HireBTR Platform Core — 0002_pipeline_templates_and_rpcs.sql
-- Default pipeline templates (Sales / Recruitment / HRIS) + core board RPCs.
-- Depends on 0001_platform_core.sql.
-- ============================================================================

-- Seed the three default pipelines + stages for a workspace (idempotent per kind).
create or replace function seed_default_pipelines(p_workspace uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pipeline uuid;
begin
  -- SALES (CRM) --------------------------------------------------------------
  if not exists (select 1 from pipelines where workspace_id = p_workspace and kind = 'sales') then
    insert into pipelines (workspace_id, name, kind, target, position)
      values (p_workspace, 'Sales', 'sales', 'company', 0) returning id into v_pipeline;
    insert into pipeline_stages (pipeline_id, workspace_id, name, color, position, stage_type) values
      (v_pipeline, p_workspace, 'Lead',        '#94a3b8', 0, 'open'),
      (v_pipeline, p_workspace, 'Discovery',   '#60a5fa', 1, 'open'),
      (v_pipeline, p_workspace, 'Proposal',    '#a78bfa', 2, 'open'),
      (v_pipeline, p_workspace, 'Closed Won',  '#34d399', 3, 'won'),
      (v_pipeline, p_workspace, 'Closed Lost', '#f87171', 4, 'lost');
  end if;

  -- RECRUITMENT (ATS) --------------------------------------------------------
  if not exists (select 1 from pipelines where workspace_id = p_workspace and kind = 'recruitment') then
    insert into pipelines (workspace_id, name, kind, target, position)
      values (p_workspace, 'Recruitment', 'recruitment', 'person', 1) returning id into v_pipeline;
    insert into pipeline_stages (pipeline_id, workspace_id, name, color, position, stage_type) values
      (v_pipeline, p_workspace, 'Applicant',  '#94a3b8', 0, 'open'),
      (v_pipeline, p_workspace, 'Assessment', '#60a5fa', 1, 'open'),
      (v_pipeline, p_workspace, 'Interview',  '#a78bfa', 2, 'open'),
      (v_pipeline, p_workspace, 'Offered',    '#fbbf24', 3, 'open'),
      (v_pipeline, p_workspace, 'Hired',      '#34d399', 4, 'won'),
      (v_pipeline, p_workspace, 'Rejected',   '#f87171', 5, 'lost');
  end if;

  -- HRIS (Onboarding / Team) -------------------------------------------------
  if not exists (select 1 from pipelines where workspace_id = p_workspace and kind = 'hris') then
    insert into pipelines (workspace_id, name, kind, target, position)
      values (p_workspace, 'Onboarding', 'hris', 'person', 2) returning id into v_pipeline;
    insert into pipeline_stages (pipeline_id, workspace_id, name, color, position, stage_type) values
      (v_pipeline, p_workspace, 'Pre-boarding', '#94a3b8', 0, 'open'),
      (v_pipeline, p_workspace, 'Onboarding',   '#60a5fa', 1, 'open'),
      (v_pipeline, p_workspace, 'Active',       '#34d399', 2, 'won'),
      (v_pipeline, p_workspace, 'Offboarding',  '#f87171', 3, 'lost');
  end if;
end $$;
grant execute on function seed_default_pipelines(uuid) to authenticated, anon;

-- Return a full board (stages + records joined to their person/company) as jsonb.
create or replace function get_pipeline_board(p_privy text, p_pipeline uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_workspace uuid;
begin
  select workspace_id into v_workspace from pipelines where id = p_pipeline;
  if v_workspace is null then raise exception 'PIPELINE_NOT_FOUND'; end if;
  if not is_workspace_member(v_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  return jsonb_build_object(
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'color', s.color, 'stage_type', s.stage_type
      ) order by s.position)
      from pipeline_stages s where s.pipeline_id = p_pipeline), '[]'::jsonb),
    'records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'stage_id', r.stage_id, 'title', r.title, 'amount', r.amount,
        'status', r.status, 'position', r.position,
        'person', case when pe.id is null then null else jsonb_build_object(
          'id', pe.id, 'name', trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,'')),
          'title', pe.title, 'avatar_url', pe.avatar_url) end,
        'company', case when co.id is null then null else jsonb_build_object(
          'id', co.id, 'name', co.name, 'domain', co.domain) end
      ) order by r.position)
      from pipeline_records r
      left join people pe on pe.id = r.person_id
      left join companies co on co.id = r.company_id
      where r.pipeline_id = p_pipeline), '[]'::jsonb)
  );
end $$;
grant execute on function get_pipeline_board(text, uuid) to authenticated, anon;

-- Move a record to a stage / reorder (drag-and-drop persistence).
create or replace function move_pipeline_record(p_privy text, p_record uuid, p_stage uuid, p_position double precision)
returns void language plpgsql security definer set search_path = public as $$
declare v_workspace uuid;
begin
  select workspace_id into v_workspace from pipeline_records where id = p_record;
  if v_workspace is null then raise exception 'RECORD_NOT_FOUND'; end if;
  if not is_workspace_member(v_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  update pipeline_records
     set stage_id = p_stage,
         position = p_position,
         status   = coalesce((select case when s.stage_type = 'open' then 'active' else s.stage_type end
                              from pipeline_stages s where s.id = p_stage), status)
   where id = p_record;
end $$;
grant execute on function move_pipeline_record(text, uuid, uuid, double precision) to authenticated, anon;

notify pgrst, 'reload schema';
