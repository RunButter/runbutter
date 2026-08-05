-- ============================================================================
-- RunButter — 0088_partial_update_fix.sql
-- A partial update no longer blanks the fields it does not mention.
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────
-- Every branch of `update_record` except `transactions` assigned each column
-- with a bare `nullif(p_data->>'field','')`. An absent key therefore evaluated
-- to NULL and WROTE it. So this:
--
--     update_record(privy, 'invoices', id, '{"organization_id":"…"}')
--
-- linked the invoice to a company and, in the same statement, erased its
-- number, category, dates and notes. Reproduced on a real database: INV-1
-- became an invoice with no number, and a person updated the same way lost
-- their first name and email.
--
-- ── WHY IT SURVIVED THIS LONG ───────────────────────────────────────────────
-- The record form always posts every field, so the UI never triggered it. What
-- does trigger it is anything that updates a SUBSET, and the product has been
-- growing those: the agent `update_record` tool (whose description invites a
-- model to send only what changed), the REST API, Excel sync, and the demo
-- seeder that found this. An agent tidying one field would silently destroy the
-- rest of the row.
--
-- ── THE RULE, NOW UNIFORM ───────────────────────────────────────────────────
--   key absent   → leave the column exactly as it is
--   key present  → write it, including writing NULL to clear it
--
-- `p_data ? 'field'` is the test. It is not a new idea here: the `transactions`
-- branch has always done exactly this, and 0087's custom-object branch and
-- `save_workspace_branding` both follow the same rule. This makes the other
-- nine branches agree with them.
--
-- NOT-NULL columns keep a `coalesce(…, existing)` INSIDE the present-branch, so
-- sending `""` for a name is still "no change" rather than a constraint
-- violation — that is the pre-existing behaviour and forms rely on it.
--
-- Also: `assets` had NO create or update branch at all, while appearing in
-- list_records, in delete_record's table map, and in the nav with its own page.
-- The Add button on Team → Assets raised UNKNOWN_OBJECT. Both branches are
-- added here, which is why create_record is redefined in full below too.
--
-- Also adds two relation columns that were simply missing from the update path,
-- so they could be set at creation and never afterwards:
--   people.primary_company_id, issues.project_id, assets.assigned_to_person_id
--
-- Redefines `update_record` IN FULL per the convention. Depends on 0087.
-- Idempotent & prod-safe.
-- ============================================================================

create or replace function update_record(p_privy text, p_object text, p_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_obj uuid; v_existing jsonb; my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  if p_object in ('companies','organizations') then
    update organizations set
      name           = case when p_data ? 'name' then coalesce(nullif(p_data->>'name',''), name) else name end,
      domain         = case when p_data ? 'domain' then nullif(p_data->>'domain','') else domain end,
      industry       = case when p_data ? 'industry' then nullif(p_data->>'industry','') else industry end,
      employee_count = case when p_data ? 'employee_count' then nullif(p_data->>'employee_count','')::int else employee_count end,
      tax_id         = case when p_data ? 'tax_id' then nullif(p_data->>'tax_id','') else tax_id end,
      address        = case when p_data ? 'address' then nullif(p_data->>'address','') else address end,
      country        = case when p_data ? 'country' then nullif(p_data->>'country','') else country end
    where id=p_id and workspace_id = any(my);

  elsif p_object = 'people' then
    update people set
      first_name = case when p_data ? 'first_name' then nullif(p_data->>'first_name','') else first_name end,
      last_name  = case when p_data ? 'last_name' then nullif(p_data->>'last_name','') else last_name end,
      email      = case when p_data ? 'email' then nullif(p_data->>'email','') else email end,
      phone      = case when p_data ? 'phone' then nullif(p_data->>'phone','') else phone end,
      title      = case when p_data ? 'title' then nullif(p_data->>'title','') else title end,
      source     = case when p_data ? 'source' then nullif(p_data->>'source','') else source end,
      -- New here: a person could be attached to a company at creation and never
      -- moved afterwards, because this column was absent from the update path.
      primary_company_id = case when p_data ? 'primary_company_id'
                                then nullif(p_data->>'primary_company_id','')::uuid
                                else primary_company_id end
    where id=p_id and workspace_id = any(my);

  elsif p_object = 'invoices' then
    update invoices set
      number          = case when p_data ? 'number' then nullif(p_data->>'number','') else number end,
      organization_id = case when p_data ? 'organization_id' then nullif(p_data->>'organization_id','')::uuid else organization_id end,
      kind            = case when p_data ? 'kind' then coalesce(nullif(p_data->>'kind',''), kind) else kind end,
      direction       = case when p_data ? 'direction' then coalesce(nullif(p_data->>'direction',''), direction) else direction end,
      amount          = case when p_data ? 'amount' then coalesce(nullif(p_data->>'amount','')::numeric, amount) else amount end,
      status          = case when p_data ? 'status' then coalesce(nullif(p_data->>'status',''), status) else status end,
      category        = case when p_data ? 'category' then nullif(p_data->>'category','') else category end,
      issued_at       = case when p_data ? 'issued_at' then nullif(p_data->>'issued_at','')::date else issued_at end,
      due_at          = case when p_data ? 'due_at' then nullif(p_data->>'due_at','')::date else due_at end,
      notes           = case when p_data ? 'notes' then nullif(p_data->>'notes','') else notes end
    where id=p_id and workspace_id = any(my);

  elsif p_object = 'expenses' then
    update expenses set
      vendor   = case when p_data ? 'vendor' then nullif(p_data->>'vendor','') else vendor end,
      category = case when p_data ? 'category' then coalesce(nullif(p_data->>'category',''), category) else category end,
      amount   = case when p_data ? 'amount' then coalesce(nullif(p_data->>'amount','')::numeric, amount) else amount end,
      status   = case when p_data ? 'status' then coalesce(nullif(p_data->>'status',''), status) else status end,
      spent_at = case when p_data ? 'spent_at' then nullif(p_data->>'spent_at','')::date else spent_at end,
      notes    = case when p_data ? 'notes' then nullif(p_data->>'notes','') else notes end
    where id=p_id and workspace_id = any(my);

  elsif p_object = 'transactions' then
    -- Unchanged. This branch was already correct, and is what the rest of the
    -- function has now been made to match.
    update transactions set
      bank_account_id = case when p_data ? 'bank_account_id' then nullif(p_data->>'bank_account_id','')::uuid else bank_account_id end,
      txn_date = coalesce(nullif(p_data->>'txn_date','')::date, txn_date),
      description = case when p_data ? 'description' then nullif(p_data->>'description','') else description end,
      amount = coalesce(nullif(regexp_replace(coalesce(p_data->>'amount',''), '[^0-9.-]', '', 'g'),'')::numeric, amount),
      category = case when p_data ? 'category' then nullif(p_data->>'category','') else category end,
      method = coalesce(nullif(p_data->>'method',''), method),
      status = coalesce(nullif(p_data->>'status',''), status),
      tax_rate = case when p_data ? 'tax_rate' then nullif(p_data->>'tax_rate','')::numeric else tax_rate end,
      notes = case when p_data ? 'notes' then nullif(p_data->>'notes','') else notes end
    where id=p_id and workspace_id = any(my);

  elsif p_object = 'products' then
    update products set
      name        = case when p_data ? 'name' then coalesce(nullif(p_data->>'name',''), name) else name end,
      sku         = case when p_data ? 'sku' then nullif(p_data->>'sku','') else sku end,
      description = case when p_data ? 'description' then nullif(p_data->>'description','') else description end,
      unit_price  = case when p_data ? 'unit_price' then coalesce(nullif(p_data->>'unit_price','')::numeric, unit_price) else unit_price end,
      unit        = case when p_data ? 'unit' then nullif(p_data->>'unit','') else unit end,
      category    = case when p_data ? 'category' then nullif(p_data->>'category','') else category end,
      image_url   = case when p_data ? 'image_url' then nullif(p_data->>'image_url','') else image_url end
    where id=p_id and workspace_id = any(my);

  elsif p_object = 'campaigns' then
    update campaigns set
      name      = case when p_data ? 'name' then coalesce(nullif(p_data->>'name',''), name) else name end,
      channel   = case when p_data ? 'channel' then coalesce(nullif(p_data->>'channel',''), channel) else channel end,
      status    = case when p_data ? 'status' then coalesce(nullif(p_data->>'status',''), status) else status end,
      budget    = case when p_data ? 'budget' then coalesce(nullif(p_data->>'budget','')::numeric, budget) else budget end,
      spend     = case when p_data ? 'spend' then coalesce(nullif(p_data->>'spend','')::numeric, spend) else spend end,
      leads     = case when p_data ? 'leads' then coalesce(nullif(p_data->>'leads','')::int, leads) else leads end,
      starts_on = case when p_data ? 'starts_on' then nullif(p_data->>'starts_on','')::date else starts_on end,
      ends_on   = case when p_data ? 'ends_on' then nullif(p_data->>'ends_on','')::date else ends_on end,
      notes     = case when p_data ? 'notes' then nullif(p_data->>'notes','') else notes end
    where id=p_id and workspace_id = any(my);

  elsif p_object = 'projects' then
    update projects set
      name        = case when p_data ? 'name' then coalesce(nullif(p_data->>'name',''), name) else name end,
      identifier  = case when p_data ? 'identifier' then nullif(p_data->>'identifier','') else identifier end,
      status      = case when p_data ? 'status' then coalesce(nullif(p_data->>'status',''), status) else status end,
      description = case when p_data ? 'description' then nullif(p_data->>'description','') else description end
    where id=p_id and workspace_id = any(my);

  elsif p_object = 'issues' then
    update issues set
      title       = case when p_data ? 'title' then coalesce(nullif(p_data->>'title',''), title) else title end,
      status      = case when p_data ? 'status' then coalesce(nullif(p_data->>'status',''), status) else status end,
      priority    = case when p_data ? 'priority' then coalesce(nullif(p_data->>'priority',''), priority) else priority end,
      due_date    = case when p_data ? 'due_date' then nullif(p_data->>'due_date','')::date else due_date end,
      description = case when p_data ? 'description' then nullif(p_data->>'description','') else description end,
      -- New here, same reason as people.primary_company_id.
      project_id  = case when p_data ? 'project_id' then nullif(p_data->>'project_id','')::uuid else project_id end
    where id=p_id and workspace_id = any(my);

  elsif p_object = 'assets' then
    -- Entirely new: `assets` had no update branch at all, so it fell through to
    -- the UNKNOWN_OBJECT error and an asset could never be edited.
    update assets set
      name          = case when p_data ? 'name' then coalesce(nullif(p_data->>'name',''), name) else name end,
      category      = case when p_data ? 'category' then nullif(p_data->>'category','') else category end,
      serial_number = case when p_data ? 'serial_number' then nullif(p_data->>'serial_number','') else serial_number end,
      status        = case when p_data ? 'status' then coalesce(nullif(p_data->>'status',''), status) else status end,
      notes         = case when p_data ? 'notes' then nullif(p_data->>'notes','') else notes end,
      assigned_to_person_id = case when p_data ? 'assigned_to_person_id'
                                   then nullif(p_data->>'assigned_to_person_id','')::uuid
                                   else assigned_to_person_id end
    where id=p_id and workspace_id = any(my);

  else
    -- ── Custom objects (0087) ────────────────────────────────────────────────
    select r.id, r.object_id, r.data into v_id, v_obj, v_existing
      from custom_records r join custom_objects o on o.id = r.object_id
     where r.id = p_id and o.slug = p_object and r.workspace_id = any(my);
    if v_id is null then raise exception 'UNKNOWN_OBJECT: %', p_object; end if;
    update custom_records set data = build_custom_data(v_obj, coalesce(p_data, '{}'::jsonb), v_existing)
     where id = v_id;
  end if;
end $$;
grant execute on function update_record(text, text, uuid, jsonb) to authenticated, anon;

-- ── create_record, redefined in full to add the missing `assets` branch ────
create or replace function create_record(p_privy text, p_workspace uuid, p_object text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_obj uuid; v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
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
    insert into assets (workspace_id, name, category, serial_number, status, notes, assigned_to_person_id)
    values (p_workspace, coalesce(nullif(p_data->>'name',''),'Untitled'), nullif(p_data->>'category',''),
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
  return v_id;
end $$;

grant execute on function create_record(text, uuid, text, jsonb) to authenticated, anon;

notify pgrst, 'reload schema';
