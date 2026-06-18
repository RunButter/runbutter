-- ============================================================================
-- HireBTR Platform Core — 0003_bridge_recruitment.sql
-- Non-destructive bridge: lift the existing ATS data into the universal tables
-- WITHOUT touching or dropping anything. Idempotent (safe to re-run).
-- Depends on 0001 + 0002. Run AFTER them.
--
-- legacy companies(tenant) -> workspaces (same id)   | company_users -> accounts
-- candidates -> people (legacy_candidate_id link)    | assessment_results -> psychometrics
-- candidate.status -> a row in the Recruitment pipeline
-- ============================================================================

-- 0. traceability column for idempotent candidate sync
alter table people add column if not exists legacy_candidate_id uuid;
create unique index if not exists idx_people_legacy on people(legacy_candidate_id) where legacy_candidate_id is not null;

-- 1. workspaces <- companies (the existing TENANT table; preserve the UUID so the
--    existing company_id already equals workspace_id — zero data migration needed).
insert into workspaces (id, name, slug, plan, created_at)
select c.id, c.name,
       coalesce(nullif(c.subdomain,''), 'ws-' || left(c.id::text, 8)),
       coalesce(c.plan, 'free'), coalesce(c.created_at, now())
from companies c
on conflict (id) do nothing;

-- 2. accounts <- company_users
insert into accounts (workspace_id, privy_user_id, email, full_name, role, created_at)
select cu.company_id, cu.privy_user_id, cu.email, cu.full_name, coalesce(cu.role,'member'), coalesce(cu.created_at, now())
from company_users cu
where cu.privy_user_id is not null
  and exists (select 1 from workspaces w where w.id = cu.company_id)
on conflict (workspace_id, privy_user_id) do nothing;

-- 3. seed the default pipelines for every workspace
do $$ declare w record; begin
  for w in select id from workspaces loop perform seed_default_pipelines(w.id); end loop;
end $$;

-- 4. people <- candidates
insert into people (workspace_id, first_name, last_name, email, phone, title, source,
                    resume_raw_text, resume_parsed_at, legacy_candidate_id, created_at)
select c.company_id,
       split_part(coalesce(c.full_name,''), ' ', 1),
       nullif(btrim(regexp_replace(coalesce(c.full_name,''), '^\S+\s*', '')), ''),
       c.email, c.phone, p.title, c.source,
       c.resume_raw_text, c.resume_parsed_at, c.id, coalesce(c.applied_at, now())
from candidates c
left join positions p on p.id = c.position_id
where exists (select 1 from workspaces w where w.id = c.company_id)
  and not exists (select 1 from people pe where pe.legacy_candidate_id = c.id);

-- 5. psychometrics <- assessment_results (discrete int columns + raw jsonb)
--    Assumes Big-5 values in personality_data are numeric.
insert into psychometrics (workspace_id, person_id, overall, logic,
                           openness, conscientiousness, extraversion, agreeableness, neuroticism,
                           raw, assessed_at)
select pe.workspace_id, pe.id,
       ar.overall_score, ar.cognitive_score,
       (ar.personality_data->>'openness')::numeric::int,
       (ar.personality_data->>'conscientiousness')::numeric::int,
       (ar.personality_data->>'extraversion')::numeric::int,
       (ar.personality_data->>'agreeableness')::numeric::int,
       (ar.personality_data->>'neuroticism')::numeric::int,
       to_jsonb(ar), coalesce(ar.completed_at, now())
from assessment_results ar
join people pe on pe.legacy_candidate_id = ar.candidate_id
where not exists (select 1 from psychometrics ps where ps.person_id = pe.id);

-- 6. pipeline_records <- candidate.status (into the Recruitment pipeline)
insert into pipeline_records (workspace_id, pipeline_id, stage_id, person_id, title, status, position, created_at)
select pe.workspace_id, pl.id, st.id, pe.id,
       trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,'')),
       case when st.stage_type='won' then 'won' when st.stage_type='lost' then 'lost' else 'active' end,
       0, coalesce(c.applied_at, now())
from candidates c
join people pe on pe.legacy_candidate_id = c.id
join pipelines pl on pl.workspace_id = pe.workspace_id and pl.kind = 'recruitment'
join pipeline_stages st on st.pipeline_id = pl.id and st.name = (
  case lower(coalesce(c.status,'applied'))
    when 'applied' then 'Applicant'
    when 'screening' then 'Applicant'
    when 'assessment_sent' then 'Assessment'
    when 'assessment_completed' then 'Assessment'
    when 'interview_scheduled' then 'Interview'
    when 'interviewed' then 'Interview'
    when 'offered' then 'Offered'
    when 'hired' then 'Hired'
    when 'rejected' then 'Rejected'
    else 'Applicant' end)
where not exists (select 1 from pipeline_records r where r.person_id = pe.id and r.pipeline_id = pl.id);

-- 7. RPCs the new shell calls (workspace resolve, generic list, pipeline-by-kind)
create or replace function get_my_workspace(p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w workspaces;
begin
  select ws.* into w from accounts a join workspaces ws on ws.id = a.workspace_id
   where a.privy_user_id = p_privy order by a.created_at limit 1;
  if w.id is null then return null; end if;
  return jsonb_build_object('id', w.id, 'name', w.name, 'slug', w.slug, 'plan', w.plan);
end $$;
grant execute on function get_my_workspace(text) to authenticated, anon;

create or replace function get_pipeline_by_kind(p_privy text, p_workspace uuid, p_kind text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select id into v from pipelines where workspace_id = p_workspace and kind = p_kind order by position limit 1;
  return v;
end $$;
grant execute on function get_pipeline_by_kind(text, uuid, text) to authenticated, anon;

create or replace function list_records(p_privy text, p_workspace uuid, p_object text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  if p_object = 'people' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pe.id,
        'name', trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,'')),
        'title', pe.title, 'company', null, 'email', pe.email, 'source', pe.source,
        'synergy', (select ps.overall from psychometrics ps where ps.person_id = pe.id
                    order by ps.assessed_at desc limit 1)
      ) order by pe.created_at desc)
      from people pe
      where pe.workspace_id = p_workspace), '[]'::jsonb);

  elsif p_object = 'companies' then
    return '[]'::jsonb;   -- CRM organizations ship with the Sales module (0004)

  elsif p_object = 'assets' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'category', a.category,
        'serial_number', a.serial_number, 'status', a.status,
        'assigned_to', (select trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,''))
                        from people pe where pe.id = a.assigned_to_person_id)
      ) order by a.created_at desc)
      from assets a where a.workspace_id = p_workspace), '[]'::jsonb);
  end if;
  return '[]'::jsonb;
end $$;
grant execute on function list_records(text, uuid, text) to authenticated, anon;

notify pgrst, 'reload schema';
