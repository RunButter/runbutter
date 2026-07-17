-- ============================================================================
-- RunButter Platform Core — 0036_assets_crud.sql
-- BUG FIX: assets could not be created/edited. list_records and delete_record
-- knew about assets, but create_record / get_record / update_record had no
-- assets branch (and the UI had no form), so "New asset" was impossible in the
-- app, the REST API, and MCP alike.
--
-- Redefines the generic CRUD monolith IN FULL (copied from 0031, the previous
-- latest) with an assets branch added to create/get/update. Also attaches the
-- automation event trigger to assets so rules can react to them.
--
-- Additive, idempotent & prod-safe. Depends on 0001–0035. Run AFTER them.
-- ============================================================================

-- get_record — + assets (full redefinition, from 0031).
create or replace function get_record(p_privy text, p_object text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  if p_object in ('companies','organizations') then
    return (select to_jsonb(t) from (select id, name, domain, industry, employee_count, tax_id, address, country from organizations where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'people' then
    return (select to_jsonb(t) from (select id, first_name, last_name, email, phone, title, source from people where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'invoices' then
    return (select to_jsonb(t) from (select id, number, organization_id, kind, direction, amount, status, category, issued_at, due_at, notes from invoices where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'expenses' then
    return (select to_jsonb(t) from (select id, vendor, category, amount, status, spent_at, notes from expenses where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'transactions' then
    return (select to_jsonb(t) from (select id, txn_date, description, amount, currency, category, method, status, tax_rate, bank_account_id, notes from transactions where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'products' then
    return (select to_jsonb(t) from (select id, name, sku, description, unit_price, unit, category, image_url from products where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'campaigns' then
    return (select to_jsonb(t) from (select id, name, channel, status, budget, spend, leads, starts_on, ends_on, notes from campaigns where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'projects' then
    return (select to_jsonb(t) from (select id, name, identifier, status, description from projects where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'issues' then
    return (select to_jsonb(t) from (select id, title, status, priority, due_date, description from issues where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'assets' then
    return (select to_jsonb(t) from (select id, name, category, serial_number, status, assigned_to_person_id from assets where id=p_id and workspace_id = any(my)) t);
  end if;
  return null;
end $$;
grant execute on function get_record(text, text, uuid) to authenticated, anon;

-- create_record — + assets (from 0031). import_records reuses this (CSV import).
create or replace function create_record(p_privy text, p_workspace uuid, p_object text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
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
    insert into assets (workspace_id, name, category, serial_number, status, assigned_to_person_id)
    values (p_workspace, p_data->>'name', coalesce(nullif(p_data->>'category',''),'other'), nullif(p_data->>'serial_number',''),
            coalesce(nullif(p_data->>'status',''),'available'), nullif(p_data->>'assigned_to_person_id','')::uuid)
    returning id into v_id;
  else
    raise exception 'UNKNOWN_OBJECT: %', p_object;
  end if;
  return v_id;
end $$;
grant execute on function create_record(text, uuid, text, jsonb) to authenticated, anon;

-- update_record — + assets (from 0031).
create or replace function update_record(p_privy text, p_object text, p_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  if p_object in ('companies','organizations') then
    update organizations set name=coalesce(nullif(p_data->>'name',''),name), domain=nullif(p_data->>'domain',''), industry=nullif(p_data->>'industry',''), employee_count=nullif(p_data->>'employee_count','')::int,
      tax_id=nullif(p_data->>'tax_id',''), address=nullif(p_data->>'address',''), country=nullif(p_data->>'country','')
    where id=p_id and workspace_id = any(my);
  elsif p_object = 'people' then
    update people set first_name=nullif(p_data->>'first_name',''), last_name=nullif(p_data->>'last_name',''), email=nullif(p_data->>'email',''), phone=nullif(p_data->>'phone',''), title=nullif(p_data->>'title',''), source=nullif(p_data->>'source','')
    where id=p_id and workspace_id = any(my);
  elsif p_object = 'invoices' then
    update invoices set number=nullif(p_data->>'number',''), organization_id=nullif(p_data->>'organization_id','')::uuid,
      kind=coalesce(nullif(p_data->>'kind',''),kind), direction=coalesce(nullif(p_data->>'direction',''),direction),
      amount=coalesce(nullif(p_data->>'amount','')::numeric,amount),
      status=coalesce(nullif(p_data->>'status',''),status), category=nullif(p_data->>'category',''),
      issued_at=nullif(p_data->>'issued_at','')::date, due_at=nullif(p_data->>'due_at','')::date, notes=nullif(p_data->>'notes','')
    where id=p_id and workspace_id = any(my);
  elsif p_object = 'expenses' then
    update expenses set vendor=nullif(p_data->>'vendor',''), category=coalesce(nullif(p_data->>'category',''),category), amount=coalesce(nullif(p_data->>'amount','')::numeric,amount), status=coalesce(nullif(p_data->>'status',''),status), spent_at=nullif(p_data->>'spent_at','')::date, notes=nullif(p_data->>'notes','')
    where id=p_id and workspace_id = any(my);
  elsif p_object = 'transactions' then
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
    update products set name=coalesce(nullif(p_data->>'name',''),name), sku=nullif(p_data->>'sku',''), description=nullif(p_data->>'description',''), unit_price=coalesce(nullif(p_data->>'unit_price','')::numeric,unit_price), unit=nullif(p_data->>'unit',''), category=nullif(p_data->>'category',''), image_url=nullif(p_data->>'image_url','')
    where id=p_id and workspace_id = any(my);
  elsif p_object = 'campaigns' then
    update campaigns set name=coalesce(nullif(p_data->>'name',''),name), channel=coalesce(nullif(p_data->>'channel',''),channel), status=coalesce(nullif(p_data->>'status',''),status),
      budget=coalesce(nullif(p_data->>'budget','')::numeric,budget), spend=coalesce(nullif(p_data->>'spend','')::numeric,spend), leads=coalesce(nullif(p_data->>'leads','')::int,leads),
      starts_on=nullif(p_data->>'starts_on','')::date, ends_on=nullif(p_data->>'ends_on','')::date, notes=nullif(p_data->>'notes','')
    where id=p_id and workspace_id = any(my);
  elsif p_object = 'projects' then
    update projects set name=coalesce(nullif(p_data->>'name',''),name), identifier=nullif(p_data->>'identifier',''), status=coalesce(nullif(p_data->>'status',''),status), description=nullif(p_data->>'description','')
    where id=p_id and workspace_id = any(my);
  elsif p_object = 'issues' then
    update issues set title=coalesce(nullif(p_data->>'title',''),title), status=coalesce(nullif(p_data->>'status',''),status), priority=coalesce(nullif(p_data->>'priority',''),priority), due_date=nullif(p_data->>'due_date','')::date, description=nullif(p_data->>'description','')
    where id=p_id and workspace_id = any(my);
  elsif p_object = 'assets' then
    update assets set name=coalesce(nullif(p_data->>'name',''),name), category=coalesce(nullif(p_data->>'category',''),category),
      serial_number = case when p_data ? 'serial_number' then nullif(p_data->>'serial_number','') else serial_number end,
      status=coalesce(nullif(p_data->>'status',''),status),
      assigned_to_person_id = case when p_data ? 'assigned_to_person_id' then nullif(p_data->>'assigned_to_person_id','')::uuid else assigned_to_person_id end
    where id=p_id and workspace_id = any(my);
  else
    raise exception 'UNKNOWN_OBJECT: %', p_object;
  end if;
end $$;
grant execute on function update_record(text, text, uuid, jsonb) to authenticated, anon;

-- Automations can now react to assets too (trigger was missing from 0032).
drop trigger if exists trg_autoevt_assets on assets;
create trigger trg_autoevt_assets after insert or update on assets for each row execute function emit_automation_event('assets');

notify pgrst, 'reload schema';
