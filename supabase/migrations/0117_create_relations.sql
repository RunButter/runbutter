-- ============================================================================
-- RunButter — 0117_create_relations.sql
--
-- Two relations that could be EDITED and never CREATED.
--
-- `update_record` has accepted `people.primary_company_id` and
-- `issues.project_id` since 0088. `create_record` has never named either, and
-- it ignores any key it does not name — so both were dropped in silence on the
-- way in. There was no error, no warning and no clue: the record appeared, and
-- the link was simply not there.
--
-- ── WHY THIS MATTERED MORE THAN IT LOOKS ────────────────────────────────────
-- These are not two optional columns. A person attached to their company is
-- the relation a CRM exists to hold, and an issue attached to its project is
-- what the project board, the project page and the roadmap all read. An issue
-- created anywhere in the product was orphaned the moment it was made: it
-- showed up in the Issues table and was missing from every project view, and
-- the symptom was an ABSENCE — the same shape as the nav badges that had never
-- appeared (0107) and the assets Add button that always failed (0088).
--
-- Neither field was in the registry form either, so not even editing could set
-- them from the UI. The forms gain a relation picker in the same change.
--
-- ── THE ID IS CHECKED, NOT TRUSTED ──────────────────────────────────────────
-- Both columns are loose — `issues.project_id` has no foreign key at all, and
-- an id belonging to another workspace would be stored happily and then render
-- as a permanently blank name. So each is resolved through a SELECT constrained
-- to `p_workspace`, exactly as `create_pipeline_record` (0092) does for its
-- company and person. A foreign id becomes NULL rather than a stored lie.
--
-- create_record is redefined IN FULL from its newest definition (0108), per the
-- monolith rule: extend the latest, never add a parallel one.
-- ============================================================================

create or replace function create_record(p_privy text, p_workspace uuid, p_object text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_obj uuid; v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Plan ceiling (0108). Here rather than in a trigger because every writer —
  -- the browser, /api/v1/records, /api/mcp, agents, CSV import and the Excel
  -- sync — reaches a row through this function, and a per-row trigger would
  -- re-count the whole workspace on every row of a bulk import.
  perform enforce_record_limit(p_workspace, 1);
  if p_object in ('companies','organizations') then
    insert into organizations (workspace_id, name, domain, industry, employee_count, tax_id, address, country)
    values (p_workspace, p_data->>'name', nullif(p_data->>'domain',''), nullif(p_data->>'industry',''), nullif(p_data->>'employee_count','')::int,
            nullif(p_data->>'tax_id',''), nullif(p_data->>'address',''), nullif(p_data->>'country',''))
    returning id into v_id;
  elsif p_object = 'people' then
    -- primary_company_id is NEW here, and it is the same defect as issues below:
    -- update_record has accepted it since 0088 and this branch never did, so a
    -- person added to the CRM was never attached to their company. In a CRM
    -- that is not a missing field, it is the relation the product is FOR — and
    -- it failed silently, because create_record simply ignores a key it does
    -- not name.
    insert into people (workspace_id, first_name, last_name, email, phone, title, source, primary_company_id)
    values (p_workspace, p_data->>'first_name', nullif(p_data->>'last_name',''), nullif(p_data->>'email',''), nullif(p_data->>'phone',''), nullif(p_data->>'title',''), nullif(p_data->>'source',''),
            (select o.id from organizations o
              where o.id = nullif(p_data->>'primary_company_id','')::uuid and o.workspace_id = p_workspace))
    returning id into v_id;
  elsif p_object = 'invoices' then
    insert into invoices (workspace_id, number, organization_id, kind, direction, amount, status, category, issued_at, due_at, notes)
    values (p_workspace, nullif(p_data->>'number',''), nullif(p_data->>'organization_id','')::uuid, coalesce(nullif(p_data->>'kind',''),'invoice'), coalesce(nullif(p_data->>'direction',''),'income'),
            coalesce(nullif(p_data->>'amount','')::numeric,0), coalesce(nullif(p_data->>'status',''),'draft'), nullif(p_data->>'category',''),
            nullif(p_data->>'issued_at','')::date, nullif(p_data->>'due_at','')::date, nullif(p_data->>'notes',''))
    returning id into v_id;
  elsif p_object = 'expenses' then
    insert into expenses (workspace_id, vendor, category, amount, status, spent_at, notes)
    values (p_workspace, nullif(p_data->>'vendor',''), coalesce(nullif(p_data->>'category',''),'other'), coalesce(nullif(p_data->>'amount','')::numeric,0), coalesce(nullif(p_data->>'status',''),'pending'), nullif(p_data->>'spent_at','')::date, nullif(p_data->>'notes',''))
    returning id into v_id;
  elsif p_object = 'transactions' then
    insert into transactions (workspace_id, bank_account_id, txn_date, description, amount, currency, category, method, status, tax_rate, tags, notes)
    values (p_workspace, nullif(p_data->>'bank_account_id','')::uuid,
            coalesce(nullif(p_data->>'txn_date','')::date, now()::date), nullif(p_data->>'description',''),
            coalesce(nullif(regexp_replace(coalesce(p_data->>'amount',''), '[^0-9.-]', '', 'g'),'')::numeric, 0),
            coalesce(nullif(p_data->>'currency',''),'USD'), nullif(p_data->>'category',''),
            coalesce(nullif(p_data->>'method',''),'transfer'), coalesce(nullif(p_data->>'status',''),'posted'),
            nullif(p_data->>'tax_rate','')::numeric,
            case when nullif(p_data->>'tags','') is not null then string_to_array(p_data->>'tags', ',') else '{}'::text[] end,
            nullif(p_data->>'notes',''))
    returning id into v_id;
  elsif p_object = 'products' then
    insert into products (workspace_id, name, sku, description, unit_price, unit, category, image_url)
    values (p_workspace, p_data->>'name', nullif(p_data->>'sku',''), nullif(p_data->>'description',''), coalesce(nullif(p_data->>'unit_price','')::numeric,0), nullif(p_data->>'unit',''), nullif(p_data->>'category',''), nullif(p_data->>'image_url',''))
    returning id into v_id;
  elsif p_object = 'campaigns' then
    insert into campaigns (workspace_id, name, channel, status, budget, spend, leads, starts_on, ends_on, notes)
    values (p_workspace, p_data->>'name', coalesce(nullif(p_data->>'channel',''),'email'), coalesce(nullif(p_data->>'status',''),'planned'),
            coalesce(nullif(p_data->>'budget','')::numeric,0), coalesce(nullif(p_data->>'spend','')::numeric,0), coalesce(nullif(p_data->>'leads','')::int,0),
            nullif(p_data->>'starts_on','')::date, nullif(p_data->>'ends_on','')::date, nullif(p_data->>'notes',''))
    returning id into v_id;
  elsif p_object = 'projects' then
    insert into projects (workspace_id, name, identifier, status, description)
    values (p_workspace, p_data->>'name', nullif(p_data->>'identifier',''), coalesce(nullif(p_data->>'status',''),'active'), nullif(p_data->>'description',''))
    returning id into v_id;
  elsif p_object = 'issues' then
    -- project_id is NEW here. update_record has accepted it since 0088 and this
    -- branch never has, so every issue ever created through the product was
    -- orphaned the moment it was made: it appeared in the Issues table, and it
    -- was absent from the project board, the project page and the roadmap with
    -- nothing anywhere saying why.
    --
    -- Checked against the workspace rather than trusted, for the reason
    -- create_pipeline_record gives about company_id: issues.project_id carries
    -- no foreign key, so an id from another tenant would otherwise be stored
    -- and then render as a blank project forever.
    insert into issues (workspace_id, title, status, priority, due_date, description, project_id)
    values (p_workspace, p_data->>'title', coalesce(nullif(p_data->>'status',''),'backlog'), coalesce(nullif(p_data->>'priority',''),'none'), nullif(p_data->>'due_date','')::date, nullif(p_data->>'description',''),
            (select pr.id from projects pr
              where pr.id = nullif(p_data->>'project_id','')::uuid and pr.workspace_id = p_workspace))
    returning id into v_id;
  elsif p_object = 'assets' then
    -- Entirely new. `assets` appears in list_records and in delete_record's
    -- table map, and it has a nav entry and a page — but it had no create or
    -- update branch, so the Add button on Team → Assets raised UNKNOWN_OBJECT.
    -- The object was readable and deletable and nothing else.
    -- `category` is NOT NULL DEFAULT 'other', and passing an explicit null
    -- OVERRIDES a default rather than falling back to it — so every attempt to
    -- add an asset without picking a category has raised a constraint violation
    -- since 0088 shipped this branch. 0088 fixed the missing branch and the
    -- branch it added was itself broken; the form does not mark category
    -- required, so this is the ordinary path, not an edge case.
    insert into assets (workspace_id, name, category, serial_number, status, notes, assigned_to_person_id)
    values (p_workspace, coalesce(nullif(p_data->>'name',''),'Untitled'), coalesce(nullif(p_data->>'category',''),'other'),
            nullif(p_data->>'serial_number',''), coalesce(nullif(p_data->>'status',''),'available'),
            nullif(p_data->>'notes',''), nullif(p_data->>'assigned_to_person_id','')::uuid)
    returning id into v_id;
  else
    -- ── Custom objects (0087) ────────────────────────────────────────────────
    v_obj := (select id from custom_objects
               where workspace_id = p_workspace and slug = p_object and enabled);
    if v_obj is null then raise exception 'UNKNOWN_OBJECT: %', p_object; end if;
    -- build_custom_data validates every value against its field and drops
    -- anything undeclared, so a payload cannot widen the row's shape.
    insert into custom_records (workspace_id, object_id, data, created_by_privy)
    values (p_workspace, v_obj, build_custom_data(v_obj, coalesce(p_data, '{}'::jsonb)), p_privy)
    returning id into v_id;
  end if;
  -- Fields this workspace added to a built-in object (0097). v_obj is set only
  -- by the custom-object branch, so this runs for built-ins and nothing else —
  -- a custom object's values were already validated by build_custom_data.
  if v_obj is null then
    perform builtin_extras_write(p_workspace, p_object, v_id, coalesce(p_data, '{}'::jsonb), false);
  end if;
  return v_id;
end $$;

revoke all on function create_record(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function create_record(text, uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
