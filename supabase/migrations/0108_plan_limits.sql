-- ============================================================================
-- RunButter — 0108_plan_limits.sql
--
-- The plan matrix has been DISPLAYED AND NOT ENFORCED since it was written.
-- lib/plans-server.ts gates FEATURES (does this plan get agents, the API,
-- e-signatures) and is wired into /api/mcp, /api/v1/records, /api/agents/* and
-- /api/sign/create. It has no notion of HOW MUCH. So `maxRecords` — 500 on
-- Free, 25,000 on Team — had exactly zero call sites, and a Free workspace could
-- hold fifty thousand records and never be asked to upgrade. That is the
-- headline number on the pricing page.
--
-- A REVENUE BOUNDARY, NOT A SECURITY ONE. Tenancy is enforced separately and is
-- untouched by any of this: these functions decide what a workspace has PAID
-- FOR, never which workspace it can reach. That distinction is why every
-- failure path below fails OPEN.
--
-- ── WHY IN create_record RATHER THAN A TRIGGER ──────────────────────────────
-- Every writer reaches a row through the CRUD monolith: the browser via
-- /api/rpc, the REST feed, /api/mcp, every agent tool, the CSV import and the
-- Excel sync. One guard at the top of create_record therefore covers all of
-- them, which is the same property that makes custom objects work everywhere.
--
-- A per-row BEFORE INSERT trigger was the obvious alternative and is worse: it
-- would re-count the entire workspace once per row, turning a 5,000-row import
-- into 5,000 full counts. Quadratic, on the exact operation most likely to
-- cross a limit.
--
-- ── FAILING OPEN, DELIBERATELY, IN THREE PLACES ─────────────────────────────
-- lib/plans-server.ts already argues this and the same reasoning applies here:
-- the cost of a miss is a free user keeping a feature for an hour; the cost of a
-- false block is a support incident with somebody who is paying. So:
--   • an unreadable plan resolves to `business` (unlimited), never to `free`;
--   • an unknown plan name resolves to `business`, not to the cheapest tier;
--   • a limit with no row resolves to unlimited.
-- The PlanGate bug this codebase already paid for once walled an Enterprise
-- customer out of a feature they owned. The two mistakes are not symmetrical.
--
-- ── THE NUMBERS LIVE IN TWO PLACES AND CANNOT DRIFT ─────────────────────────
-- SQL must hold them because SQL enforces them, and lib/plans.ts must hold them
-- because the pricing page renders them. `npm run check:plans` is a CI gate
-- comparing the two, in the same spirit as check:grants — the copy nobody
-- remembers to update is always the one that matters.
--
-- -1 means unlimited. Infinity has no int representation, and NULL would make
-- every comparison silently true.
-- ============================================================================

create table if not exists plan_limits (
  plan                 text primary key,
  max_seats            int not null default -1,
  max_records          int not null default -1,
  max_positions        int not null default -1,
  max_candidates       int not null default -1,
  max_automations      int not null default -1,
  max_esign_per_month  int not null default -1
);

alter table plan_limits enable row level security;
-- No policies: read through the SECURITY DEFINER helpers below.

-- Seeded to match lib/plans.ts exactly. `on conflict do update` so re-running
-- the migration after a price change actually corrects the row.
insert into plan_limits (plan, max_seats, max_records, max_positions, max_candidates, max_automations, max_esign_per_month)
values
  ('free',        2,   500,   1,  25,  0,  0),
  ('team',       -1, 25000,  10,1000, 20, 10),
  ('business',   -1,    -1,  -1,  -1, -1, -1),
  ('enterprise', -1,    -1,  -1,  -1, -1, -1)
on conflict (plan) do update set
  max_seats = excluded.max_seats, max_records = excluded.max_records,
  max_positions = excluded.max_positions, max_candidates = excluded.max_candidates,
  max_automations = excluded.max_automations, max_esign_per_month = excluded.max_esign_per_month;

-- Mirrors normalizePlan() in lib/plans.ts, including the legacy names Stripe may
-- still be writing. An UNKNOWN name is `business`, not `free` — see the
-- fail-open note above; normalizePlan's own `?? 'free'` is right for rendering a
-- pricing page and wrong for deciding whether to block a write.
create or replace function normalize_plan_name(p_plan text)
returns text language sql immutable as $$
  select case lower(coalesce(trim(p_plan), ''))
    when 'free' then 'free'
    when 'team' then 'team'
    when 'business' then 'business'
    when 'enterprise' then 'enterprise'
    when 'starter' then 'team'
    when 'professional' then 'business'
    when 'pro' then 'business'
    else 'business'
  end
$$;

-- The plan a workspace is on. Reads workspaces.plan — what the product reads
-- (get_my_workspace, 0051) — with 0090's trigger bridging Stripe's write to
-- companies.plan. Fails open.
create or replace function workspace_plan_of(p_workspace uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select plan into v from workspaces where id = p_workspace;
  if v is null then return 'business'; end if;
  return normalize_plan_name(v);
end $$;

-- -1 = unlimited. A missing row is unlimited, not zero.
create or replace function plan_limit(p_plan text, p_key text)
returns int language plpgsql stable security definer set search_path = public as $$
declare v int;
begin
  select case p_key
    when 'records'     then max_records
    when 'seats'       then max_seats
    when 'positions'   then max_positions
    when 'candidates'  then max_candidates
    when 'automations' then max_automations
    when 'esign'       then max_esign_per_month
    else -1 end
  into v from plan_limits where plan = normalize_plan_name(p_plan);
  return coalesce(v, -1);
end $$;

-- What counts toward maxRecords: the CRM / finance / project objects, plus a
-- workspace's own custom records. Deliberately EXCLUDES candidates and
-- positions, which have their own limits and belong to the HR module, and
-- excludes docs, files and messages, which are not "records" on the pricing
-- page and would make the number mean something nobody agreed to.
create or replace function workspace_record_count(p_workspace uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select
      (select count(*) from organizations   where workspace_id = p_workspace)
    + (select count(*) from people          where workspace_id = p_workspace)
    + (select count(*) from invoices        where workspace_id = p_workspace)
    + (select count(*) from expenses        where workspace_id = p_workspace)
    + (select count(*) from transactions    where workspace_id = p_workspace)
    + (select count(*) from products        where workspace_id = p_workspace)
    + (select count(*) from campaigns       where workspace_id = p_workspace)
    + (select count(*) from projects        where workspace_id = p_workspace)
    + (select count(*) from issues          where workspace_id = p_workspace)
    + (select count(*) from assets          where workspace_id = p_workspace)
    + (select count(*) from custom_records  where workspace_id = p_workspace)
$$;

-- Raises PLAN_LIMIT_RECORDS when adding p_adding rows would cross the ceiling.
--
-- The unlimited short-circuit is doing real work: Business and Enterprise never
-- run the count at all, so the expensive path belongs only to the plans whose
-- ceilings are small enough for it to be cheap.
create or replace function enforce_record_limit(p_workspace uuid, p_adding int default 1)
returns void language plpgsql security definer set search_path = public as $$
declare v_plan text; v_max int; v_used bigint;
begin
  if p_workspace is null then return; end if;
  v_plan := workspace_plan_of(p_workspace);
  v_max  := plan_limit(v_plan, 'records');
  if v_max < 0 then return; end if;

  v_used := workspace_record_count(p_workspace);
  if v_used + greatest(coalesce(p_adding, 1), 1) > v_max then
    -- The message is read by a person: it names the plan and both numbers, so
    -- the next question ("upgrade to what?") is answerable without a support
    -- ticket. The PLAN_LIMIT_RECORDS prefix is what the client matches on.
    raise exception 'PLAN_LIMIT_RECORDS: the % plan includes % records and this workspace has %. Upgrade to add more.',
      v_plan, v_max, v_used;
  end if;
end $$;

revoke all on function normalize_plan_name(text)       from public, anon, authenticated;
revoke all on function workspace_plan_of(uuid)         from public, anon, authenticated;
revoke all on function plan_limit(text, text)          from public, anon, authenticated;
revoke all on function workspace_record_count(uuid)    from public, anon, authenticated;
revoke all on function enforce_record_limit(uuid, int) from public, anon, authenticated;
grant execute on function normalize_plan_name(text)       to service_role;
grant execute on function workspace_plan_of(uuid)         to service_role;
grant execute on function plan_limit(text, text)          to service_role;
grant execute on function workspace_record_count(uuid)    to service_role;
grant execute on function enforce_record_limit(uuid, int) to service_role;

-- ── create_record, redefined IN FULL per the convention ─────────────────────
-- Copied mechanically from 0097 rather than retyped: this is the most-used
-- function in the product and a transcription slip here would be a data bug in
-- every object at once. The ONLY change is the enforce_record_limit call.
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
    insert into people (workspace_id, first_name, last_name, email, phone, title, source)
    values (p_workspace, p_data->>'first_name', nullif(p_data->>'last_name',''), nullif(p_data->>'email',''), nullif(p_data->>'phone',''), nullif(p_data->>'title',''), nullif(p_data->>'source',''))
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
    insert into issues (workspace_id, title, status, priority, due_date, description)
    values (p_workspace, p_data->>'title', coalesce(nullif(p_data->>'status',''),'backlog'), coalesce(nullif(p_data->>'priority',''),'none'), nullif(p_data->>'due_date','')::date, nullif(p_data->>'description',''))
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

-- ── import_records, redefined for an HONEST partial ─────────────────────────
-- 0008's version calls create_record per row inside `exception when others then
-- null`, so a plan rejection would be swallowed exactly like a malformed row:
-- importing 1,000 rows into a Free workspace with 300 used would insert 200 and
-- report 200, with nothing saying the other 800 were dropped for a reason the
-- person could have fixed.
--
-- So the ceiling is checked ONCE, UP FRONT, for the whole batch. The row-level
-- catch stays for genuinely malformed rows — that behaviour is deliberate and
-- unchanged — but a limit is now a refusal with numbers rather than a silent
-- truncation.
create or replace function import_records(p_privy text, p_workspace uuid, p_object text, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  perform enforce_record_limit(p_workspace, coalesce(jsonb_array_length(coalesce(p_rows, '[]'::jsonb)), 0));
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

revoke all on function import_records(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function import_records(text, uuid, text, jsonb) to service_role;

notify pgrst, 'reload schema';
