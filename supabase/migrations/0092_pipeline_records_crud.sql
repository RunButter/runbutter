-- ============================================================================
-- RunButter — 0092_pipeline_records_crud.sql
-- Deals you can actually create, and a board that knows which company they are for.
--
-- WHAT WAS WRONG. `pipeline_records` has existed since 0001 and there has never
-- been a way to put a row in it. `seed_default_pipelines` created the stages,
-- `get_pipeline_board` read them, `move_pipeline_record` moved cards between
-- them — and nothing anywhere, in SQL or in the app, ever inserted one. The
-- Sales → Deals screen is the flagship CRM surface and it was structurally
-- incapable of holding a deal: every workspace saw four empty columns and the
-- sample-data button did not help, because it only writes through
-- `create_record` and pipeline records are not a CRUD object.
--
-- TWO SMALLER THINGS FIXED HERE.
--
-- 1. `get_pipeline_board` returned `'company', null` with the comment "CRM
--    organizations join added with the Sales module". 0004 shipped the Sales
--    module and the join was never added, so a deal attached to a company
--    rendered without it — the card fell back to its title and the logo was an
--    initial of the wrong thing. It is redefined IN FULL below (the convention
--    for this codebase) with the join in place.
--
-- 2. `chk_record_subject` demanded a person or a company. That is right for a
--    recruitment record — an applicant IS a person — and wrong for a deal,
--    where "Q4 renewal" is a perfectly good row that has not been matched to an
--    organization yet. The constraint is widened to accept a title, which keeps
--    the thing it was protecting against (a record about nothing) while
--    allowing the thing people actually type first.
-- ============================================================================

-- A record must still be ABOUT something — it just no longer has to be about a
-- row in another table.
alter table pipeline_records drop constraint if exists chk_record_subject;
alter table pipeline_records add constraint chk_record_subject
  check (
    person_id is not null
    or company_id is not null
    or nullif(btrim(coalesce(title, '')), '') is not null
  );

-- ── Create ──────────────────────────────────────────────────────────────────
-- p_stage is optional: dropping into the first stage is what "New deal" means
-- almost every time, and making the caller resolve a stage id first is how a
-- create button ends up needing two round trips.
--
-- company_id has no foreign key (0001 left it loose so the Sales module could
-- ship later), so the workspace check on it happens HERE. Without that, a uuid
-- from another tenant would be stored happily and then joined on read.
create or replace function create_pipeline_record(
  p_privy text, p_workspace uuid, p_pipeline uuid,
  p_stage uuid default null, p_title text default null,
  p_amount numeric default null, p_company uuid default null, p_person uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_stage uuid; v_id uuid; v_title text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  if not exists (select 1 from pipelines where id = p_pipeline and workspace_id = p_workspace) then
    raise exception 'PIPELINE_NOT_FOUND';
  end if;

  -- A stage from another pipeline would put the card in a column nobody can see.
  v_stage := (select s.id from pipeline_stages s
               where s.id = p_stage and s.pipeline_id = p_pipeline);
  if v_stage is null then
    v_stage := (select s.id from pipeline_stages s
                 where s.pipeline_id = p_pipeline order by s.position limit 1);
  end if;
  if v_stage is null then raise exception 'PIPELINE_HAS_NO_STAGES'; end if;

  if p_company is not null
     and not exists (select 1 from organizations o where o.id = p_company and o.workspace_id = p_workspace) then
    raise exception 'COMPANY_NOT_FOUND';
  end if;
  if p_person is not null
     and not exists (select 1 from people pe where pe.id = p_person and pe.workspace_id = p_workspace) then
    raise exception 'PERSON_NOT_FOUND';
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null and p_company is null and p_person is null then
    raise exception 'NEEDS_A_SUBJECT: give it a name, a company or a person';
  end if;

  insert into pipeline_records (workspace_id, pipeline_id, stage_id, person_id, company_id,
                                title, amount, status, position)
  values (p_workspace, p_pipeline, v_stage, p_person, p_company,
          v_title, p_amount,
          coalesce((select case when s.stage_type = 'open' then 'active' else s.stage_type end
                    from pipeline_stages s where s.id = v_stage), 'active'),
          -- New cards go to the TOP of their column. Appending puts the thing
          -- you just typed below everything you have not looked at in a month.
          coalesce((select min(r.position) from pipeline_records r
                     where r.pipeline_id = p_pipeline and r.stage_id = v_stage), 0) - 1)
  returning id into v_id;

  return v_id;
end $$;
grant execute on function create_pipeline_record(text, uuid, uuid, uuid, text, numeric, uuid, uuid)
  to authenticated, anon;

-- ── Update ──────────────────────────────────────────────────────────────────
-- Only the fields a card shows. Moving between stages stays in
-- move_pipeline_record, which also keeps `status` and `entered_stage_at`
-- honest — two writers for one column is how a board starts disagreeing with
-- the forecast.
create or replace function update_pipeline_record(
  p_privy text, p_record uuid, p_title text default null,
  p_amount numeric default null, p_company uuid default null, p_person uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_workspace uuid;
begin
  select workspace_id into v_workspace from pipeline_records where id = p_record;
  if v_workspace is null then raise exception 'RECORD_NOT_FOUND'; end if;
  if not is_workspace_member(v_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  if p_company is not null
     and not exists (select 1 from organizations o where o.id = p_company and o.workspace_id = v_workspace) then
    raise exception 'COMPANY_NOT_FOUND';
  end if;
  if p_person is not null
     and not exists (select 1 from people pe where pe.id = p_person and pe.workspace_id = v_workspace) then
    raise exception 'PERSON_NOT_FOUND';
  end if;

  -- NULL means "not mentioned", the same rule save_workspace_branding follows:
  -- a partial save must never blank the fields it does not name.
  update pipeline_records
     set title      = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
         amount     = coalesce(p_amount, amount),
         company_id = coalesce(p_company, company_id),
         person_id  = coalesce(p_person, person_id)
   where id = p_record;
end $$;
grant execute on function update_pipeline_record(text, uuid, text, numeric, uuid, uuid) to authenticated, anon;

-- ── Delete ──────────────────────────────────────────────────────────────────
create or replace function delete_pipeline_record(p_privy text, p_record uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_workspace uuid;
begin
  select workspace_id into v_workspace from pipeline_records where id = p_record;
  if v_workspace is null then return; end if;   -- already gone; deleting twice is not an error
  if not is_workspace_member(v_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  delete from pipeline_records where id = p_record;
end $$;
grant execute on function delete_pipeline_record(text, uuid) to authenticated, anon;

-- ── Board, redefined IN FULL with the organizations join ────────────────────
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
        -- The join 0002 promised. Scoped to the same workspace as well as the
        -- id, because company_id carries no foreign key.
        'company', case when co.id is null then null else jsonb_build_object(
          'id', co.id, 'name', co.name, 'domain', co.domain) end
      ) order by r.position)
      from pipeline_records r
      left join people pe on pe.id = r.person_id
      left join organizations co on co.id = r.company_id and co.workspace_id = v_workspace
      where r.pipeline_id = p_pipeline), '[]'::jsonb)
  );
end $$;
grant execute on function get_pipeline_board(text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
