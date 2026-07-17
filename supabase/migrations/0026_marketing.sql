-- ============================================================================
-- RunButter Platform Core — 0026_marketing.sql
-- Marketing pillar: campaigns (channel, budget/spend, leads, dates), threaded
-- through the generic CRUD RPCs (extended from 0021; delete_record keeps the
-- role gate from 0012). import_records reuses create_record so CSV import
-- works automatically. Additive & prod-safe. Depends on 0001–0025. Run AFTER.
-- ============================================================================

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  channel text not null default 'email',      -- email | social | ads | event | content | other
  status text not null default 'planned',     -- planned | active | paused | completed
  budget numeric(14,2) not null default 0,
  spend numeric(14,2) not null default 0,
  leads int not null default 0,
  starts_on date,
  ends_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_campaigns_ws on campaigns(workspace_id);
drop trigger if exists trg_campaigns_upd on campaigns;
create trigger trg_campaigns_upd before update on campaigns for each row execute function set_updated_at();
alter table campaigns enable row level security;

-- list_records — + campaigns (full redefinition, from 0021).
create or replace function list_records(p_privy text, p_workspace uuid, p_object text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  if p_object = 'people' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', pe.id, 'name', trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,'')),
      'title', pe.title, 'company', co.name, 'email', pe.email, 'source', pe.source,
      'synergy', (select ps.overall from psychometrics ps where ps.person_id=pe.id order by ps.assessed_at desc limit 1)
    ) order by pe.created_at desc)
    from people pe left join organizations co on co.id = pe.primary_company_id
    where pe.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object in ('companies','organizations') then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'domain', o.domain, 'industry', o.industry, 'employee_count', o.employee_count,
      'tax_id', o.tax_id, 'address', o.address, 'country', o.country
    ) order by o.created_at desc) from organizations o where o.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'invoices' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'number', i.number, 'company', o.name, 'kind', i.kind, 'direction', i.direction,
      'category', i.category, 'amount', i.amount, 'status', i.status, 'due_at', i.due_at
    ) order by i.created_at desc)
    from invoices i left join organizations o on o.id = i.organization_id
    where i.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'expenses' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'vendor', e.vendor, 'category', e.category, 'amount', e.amount, 'status', e.status, 'spent_at', e.spent_at
    ) order by e.created_at desc) from expenses e where e.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'products' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'image', p.image_url, 'sku', p.sku, 'category', p.category, 'unit_price', p.unit_price, 'unit', p.unit
    ) order by p.created_at desc) from products p where p.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'campaigns' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'channel', c.channel, 'status', c.status,
      'budget', c.budget, 'spend', c.spend, 'leads', c.leads, 'starts_on', c.starts_on, 'ends_on', c.ends_on
    ) order by c.created_at desc) from campaigns c where c.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'projects' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', pr.id, 'name', pr.name, 'identifier', pr.identifier, 'status', pr.status,
      'issues', (select count(*) from issues i where i.project_id = pr.id)
    ) order by pr.created_at desc) from projects pr where pr.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'issues' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.title, 'project', pr.name, 'status', i.status,
      'priority', i.priority, 'due_date', i.due_date,
      'assignee', (select a.full_name from accounts a where a.id = i.assignee_account_id)
    ) order by i.sort_order)
    from issues i left join projects pr on pr.id = i.project_id
    where i.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'assets' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'category', a.category, 'serial_number', a.serial_number, 'status', a.status,
      'assigned_to', (select trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,'')) from people pe where pe.id=a.assigned_to_person_id)
    ) order by a.created_at desc) from assets a where a.workspace_id=p_workspace), '[]'::jsonb);
  end if;
  return '[]'::jsonb;
end $$;
grant execute on function list_records(text, uuid, text) to authenticated, anon;

-- get_record — + campaigns (from 0021).
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
  elsif p_object = 'products' then
    return (select to_jsonb(t) from (select id, name, sku, description, unit_price, unit, category, image_url from products where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'campaigns' then
    return (select to_jsonb(t) from (select id, name, channel, status, budget, spend, leads, starts_on, ends_on, notes from campaigns where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'projects' then
    return (select to_jsonb(t) from (select id, name, identifier, status, description from projects where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'issues' then
    return (select to_jsonb(t) from (select id, title, status, priority, due_date, description from issues where id=p_id and workspace_id = any(my)) t);
  end if;
  return null;
end $$;
grant execute on function get_record(text, text, uuid) to authenticated, anon;

-- create_record — + campaigns (from 0021). import_records reuses this.
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
  else
    raise exception 'UNKNOWN_OBJECT: %', p_object;
  end if;
  return v_id;
end $$;
grant execute on function create_record(text, uuid, text, jsonb) to authenticated, anon;

-- update_record — + campaigns (from 0021).
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
  else
    raise exception 'UNKNOWN_OBJECT: %', p_object;
  end if;
end $$;
grant execute on function update_record(text, text, uuid, jsonb) to authenticated, anon;

-- delete_record — + campaigns, keeping the owner/admin role gate (from 0012).
create or replace function delete_record(p_privy text, p_object text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tbl text; v_ws uuid;
begin
  tbl := case p_object
    when 'companies' then 'organizations' when 'organizations' then 'organizations'
    when 'people' then 'people' when 'invoices' then 'invoices' when 'expenses' then 'expenses'
    when 'products' then 'products' when 'campaigns' then 'campaigns'
    when 'projects' then 'projects' when 'issues' then 'issues' when 'assets' then 'assets'
    else null end;
  if tbl is null then raise exception 'UNKNOWN_OBJECT: %', p_object; end if;
  execute format('select workspace_id from %I where id = $1', tbl) into v_ws using p_id;
  if v_ws is null then return; end if;
  if not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if workspace_role(p_privy, v_ws) not in ('owner', 'admin') then raise exception 'FORBIDDEN: delete requires admin'; end if;
  execute format('delete from %I where id = $1 and workspace_id = $2', tbl) using p_id, v_ws;
end $$;
grant execute on function delete_record(text, text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
