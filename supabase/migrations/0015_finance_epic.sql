-- ============================================================================
-- HireBTR Platform Core — 0015_finance_epic.sql
-- Finance epic: invoices gain an income/cost DIRECTION and a wired company
-- (organization) picker, and the analytics treat cost-invoices as money-out.
-- Redefines the CRUD RPCs from 0010 (adding the new invoice fields) and the
-- analytics RPC from 0013 (direction-aware). Additive & prod-safe.
-- Depends on 0001–0013. Run AFTER them.
-- ============================================================================

-- 1. New column. Existing rows default to 'income' so current revenue is unchanged.
alter table invoices add column if not exists direction text not null default 'income';  -- income | cost
create index if not exists idx_invoices_direction on invoices(workspace_id, direction);

-- 2. list_records — invoices now expose direction (full redefinition, based on 0010).
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
      'id', o.id, 'name', o.name, 'domain', o.domain, 'industry', o.industry, 'employee_count', o.employee_count
    ) order by o.created_at desc) from organizations o where o.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'invoices' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'number', i.number, 'company', o.name, 'direction', i.direction,
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
      'id', p.id, 'name', p.name, 'sku', p.sku, 'category', p.category, 'unit_price', p.unit_price, 'unit', p.unit
    ) order by p.created_at desc) from products p where p.workspace_id=p_workspace), '[]'::jsonb);

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

-- 3. get_record — invoices include organization_id + direction (for the edit form).
create or replace function get_record(p_privy text, p_object text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  if p_object in ('companies','organizations') then
    return (select to_jsonb(t) from (select id, name, domain, industry, employee_count from organizations where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'people' then
    return (select to_jsonb(t) from (select id, first_name, last_name, email, phone, title, source from people where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'invoices' then
    return (select to_jsonb(t) from (select id, number, organization_id, direction, amount, status, category, issued_at, due_at, notes from invoices where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'expenses' then
    return (select to_jsonb(t) from (select id, vendor, category, amount, status, spent_at, notes from expenses where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'products' then
    return (select to_jsonb(t) from (select id, name, sku, description, unit_price, unit, category from products where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'projects' then
    return (select to_jsonb(t) from (select id, name, identifier, status, description from projects where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'issues' then
    return (select to_jsonb(t) from (select id, title, status, priority, due_date, description from issues where id=p_id and workspace_id = any(my)) t);
  end if;
  return null;
end $$;
grant execute on function get_record(text, text, uuid) to authenticated, anon;

-- 4. create_record — invoices set organization_id + direction.
create or replace function create_record(p_privy text, p_workspace uuid, p_object text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_object in ('companies','organizations') then
    insert into organizations (workspace_id, name, domain, industry, employee_count)
    values (p_workspace, p_data->>'name', nullif(p_data->>'domain',''), nullif(p_data->>'industry',''), nullif(p_data->>'employee_count','')::int)
    returning id into v_id;
  elsif p_object = 'people' then
    insert into people (workspace_id, first_name, last_name, email, phone, title, source)
    values (p_workspace, p_data->>'first_name', nullif(p_data->>'last_name',''), nullif(p_data->>'email',''), nullif(p_data->>'phone',''), nullif(p_data->>'title',''), nullif(p_data->>'source',''))
    returning id into v_id;
  elsif p_object = 'invoices' then
    insert into invoices (workspace_id, number, organization_id, direction, amount, status, category, issued_at, due_at, notes)
    values (p_workspace, nullif(p_data->>'number',''), nullif(p_data->>'organization_id','')::uuid, coalesce(nullif(p_data->>'direction',''),'income'),
            coalesce(nullif(p_data->>'amount','')::numeric,0), coalesce(nullif(p_data->>'status',''),'draft'), nullif(p_data->>'category',''),
            nullif(p_data->>'issued_at','')::date, nullif(p_data->>'due_at','')::date, nullif(p_data->>'notes',''))
    returning id into v_id;
  elsif p_object = 'expenses' then
    insert into expenses (workspace_id, vendor, category, amount, status, spent_at, notes)
    values (p_workspace, nullif(p_data->>'vendor',''), coalesce(nullif(p_data->>'category',''),'other'), coalesce(nullif(p_data->>'amount','')::numeric,0), coalesce(nullif(p_data->>'status',''),'pending'), nullif(p_data->>'spent_at','')::date, nullif(p_data->>'notes',''))
    returning id into v_id;
  elsif p_object = 'products' then
    insert into products (workspace_id, name, sku, description, unit_price, unit, category)
    values (p_workspace, p_data->>'name', nullif(p_data->>'sku',''), nullif(p_data->>'description',''), coalesce(nullif(p_data->>'unit_price','')::numeric,0), nullif(p_data->>'unit',''), nullif(p_data->>'category',''))
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

-- 5. update_record — invoices set organization_id + direction.
create or replace function update_record(p_privy text, p_object text, p_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  if p_object in ('companies','organizations') then
    update organizations set name=coalesce(nullif(p_data->>'name',''),name), domain=nullif(p_data->>'domain',''), industry=nullif(p_data->>'industry',''), employee_count=nullif(p_data->>'employee_count','')::int
    where id=p_id and workspace_id = any(my);
  elsif p_object = 'people' then
    update people set first_name=nullif(p_data->>'first_name',''), last_name=nullif(p_data->>'last_name',''), email=nullif(p_data->>'email',''), phone=nullif(p_data->>'phone',''), title=nullif(p_data->>'title',''), source=nullif(p_data->>'source','')
    where id=p_id and workspace_id = any(my);
  elsif p_object = 'invoices' then
    update invoices set number=nullif(p_data->>'number',''), organization_id=nullif(p_data->>'organization_id','')::uuid,
      direction=coalesce(nullif(p_data->>'direction',''),direction), amount=coalesce(nullif(p_data->>'amount','')::numeric,amount),
      status=coalesce(nullif(p_data->>'status',''),status), category=nullif(p_data->>'category',''),
      issued_at=nullif(p_data->>'issued_at','')::date, due_at=nullif(p_data->>'due_at','')::date, notes=nullif(p_data->>'notes','')
    where id=p_id and workspace_id = any(my);
  elsif p_object = 'expenses' then
    update expenses set vendor=nullif(p_data->>'vendor',''), category=coalesce(nullif(p_data->>'category',''),category), amount=coalesce(nullif(p_data->>'amount','')::numeric,amount), status=coalesce(nullif(p_data->>'status',''),status), spent_at=nullif(p_data->>'spent_at','')::date, notes=nullif(p_data->>'notes','')
    where id=p_id and workspace_id = any(my);
  elsif p_object = 'products' then
    update products set name=coalesce(nullif(p_data->>'name',''),name), sku=nullif(p_data->>'sku',''), description=nullif(p_data->>'description',''), unit_price=coalesce(nullif(p_data->>'unit_price','')::numeric,unit_price), unit=nullif(p_data->>'unit',''), category=nullif(p_data->>'category','')
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

-- 6. get_finance_analytics — direction-aware (based on 0013).
--   revenue = paid invoices, direction='income'
--   costs   = approved|paid expenses  +  paid invoices, direction='cost'
--   outstanding = sent|overdue income invoices (owed to you)
--   payable     = sent|overdue cost  invoices (you owe)
create or replace function get_finance_analytics(p_privy text, p_workspace uuid, p_months int default 12)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_months int := greatest(1, least(coalesce(p_months, 12), 36));
  v_start  date := (date_trunc('month', now()) - ((v_months - 1) || ' months')::interval)::date;
  v_series jsonb;
  v_revenue numeric;
  v_costs   numeric;
  v_outstanding numeric;
  v_payable numeric;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  with months as (
    select generate_series(date_trunc('month', v_start), date_trunc('month', now()), interval '1 month') as m
  ),
  rev as (
    select date_trunc('month', coalesce(issued_at, created_at::date)) as m, sum(amount) as total
    from invoices
    where workspace_id = p_workspace and status = 'paid' and direction = 'income'
      and coalesce(issued_at, created_at::date) >= v_start
    group by 1
  ),
  cost as (
    select m, sum(total) as total from (
      select date_trunc('month', coalesce(spent_at, created_at::date)) as m, sum(amount) as total
      from expenses
      where workspace_id = p_workspace and status in ('approved','paid')
        and coalesce(spent_at, created_at::date) >= v_start
      group by 1
      union all
      select date_trunc('month', coalesce(issued_at, created_at::date)) as m, sum(amount) as total
      from invoices
      where workspace_id = p_workspace and status = 'paid' and direction = 'cost'
        and coalesce(issued_at, created_at::date) >= v_start
      group by 1
    ) u group by m
  )
  select jsonb_agg(jsonb_build_object(
    'month',   to_char(months.m, 'YYYY-MM'),
    'label',   to_char(months.m, 'Mon'),
    'revenue', coalesce(rev.total, 0),
    'costs',   coalesce(cost.total, 0)
  ) order by months.m)
  into v_series
  from months
  left join rev  on rev.m  = months.m
  left join cost on cost.m = months.m;

  select coalesce(sum(amount), 0) into v_revenue from invoices
    where workspace_id = p_workspace and status = 'paid' and direction = 'income'
      and coalesce(issued_at, created_at::date) >= v_start;

  select coalesce(sum(amount), 0) into v_costs from (
    select amount from expenses
      where workspace_id = p_workspace and status in ('approved','paid')
        and coalesce(spent_at, created_at::date) >= v_start
    union all
    select amount from invoices
      where workspace_id = p_workspace and status = 'paid' and direction = 'cost'
        and coalesce(issued_at, created_at::date) >= v_start
  ) c;

  select coalesce(sum(amount), 0) into v_outstanding from invoices
    where workspace_id = p_workspace and status in ('sent','overdue') and direction = 'income';
  select coalesce(sum(amount), 0) into v_payable from invoices
    where workspace_id = p_workspace and status in ('sent','overdue') and direction = 'cost';

  return jsonb_build_object(
    'months',      v_months,
    'revenue',     v_revenue,
    'costs',       v_costs,
    'net',         v_revenue - v_costs,
    'outstanding', v_outstanding,
    'payable',     v_payable,
    'margin',      case when v_revenue > 0 then round(((v_revenue - v_costs) / v_revenue) * 100) else 0 end,
    'series',      coalesce(v_series, '[]'::jsonb)
  );
end $$;
grant execute on function get_finance_analytics(text, uuid, int) to authenticated, anon;

notify pgrst, 'reload schema';
