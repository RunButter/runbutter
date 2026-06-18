-- ============================================================================
-- HireBTR Platform Core — 0004_crm_finance.sql
-- Sales/CRM organizations + Finance (invoices, expenses). Additive & prod-safe.
-- Depends on 0001–0003. Run AFTER them.
-- ============================================================================

-- 1. ORGANIZATIONS — the CRM "company" entity (named to avoid the tenant clash)
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null, domain text, industry text, employee_count int,
  custom_fields jsonb not null default '{}',
  search_tsv tsvector generated always as (
    to_tsvector('english', coalesce(name,'')||' '||coalesce(domain,'')||' '||coalesce(industry,''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_orgs_ws  on organizations(workspace_id);
create index if not exists idx_orgs_tsv on organizations using gin(search_tsv);
create trigger trg_orgs_upd before update on organizations for each row execute function set_updated_at();

-- 2. INVOICES (accounts receivable)
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  number text, organization_id uuid references organizations(id) on delete set null,
  amount numeric(14,2) not null default 0, currency text not null default 'USD',
  status text not null default 'draft',   -- draft | sent | paid | overdue
  issued_at date, due_at date, notes text,
  custom_fields jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_invoices_ws on invoices(workspace_id);
create trigger trg_invoices_upd before update on invoices for each row execute function set_updated_at();

-- 3. EXPENSES (accounts payable)
create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  vendor text, category text not null default 'other',  -- payroll|software|office|travel|other
  amount numeric(14,2) not null default 0, currency text not null default 'USD',
  status text not null default 'pending', -- pending | approved | paid
  spent_at date, notes text,
  custom_fields jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_expenses_ws on expenses(workspace_id);
create trigger trg_expenses_upd before update on expenses for each row execute function set_updated_at();

-- 4. RLS (enable only; access via SECURITY DEFINER RPCs)
do $$ declare t text; begin
  foreach t in array array['organizations','invoices','expenses'] loop
    execute format('alter table %I enable row level security;', t);
  end loop; end $$;

-- 5. Finance summary RPC
create or replace function get_finance_summary(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object(
    'revenue',     coalesce((select sum(amount) from invoices where workspace_id=p_workspace and status='paid'),0),
    'outstanding', coalesce((select sum(amount) from invoices where workspace_id=p_workspace and status in ('sent','overdue')),0),
    'expenses',    coalesce((select sum(amount) from expenses where workspace_id=p_workspace and status in ('approved','paid')),0),
    'invoices',    coalesce((select count(*) from invoices where workspace_id=p_workspace),0)
  );
end $$;
grant execute on function get_finance_summary(text, uuid) to authenticated, anon;

-- 6. Extend list_records for the new objects (companies->organizations, invoices, expenses)
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
    ) order by o.created_at desc)
    from organizations o where o.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'invoices' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'number', i.number, 'company', o.name, 'amount', i.amount,
      'status', i.status, 'due_at', i.due_at
    ) order by i.created_at desc)
    from invoices i left join organizations o on o.id = i.organization_id
    where i.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'expenses' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'vendor', e.vendor, 'category', e.category, 'amount', e.amount,
      'status', e.status, 'spent_at', e.spent_at
    ) order by e.created_at desc)
    from expenses e where e.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'assets' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'category', a.category, 'serial_number', a.serial_number,
      'status', a.status,
      'assigned_to', (select trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,'')) from people pe where pe.id=a.assigned_to_person_id)
    ) order by a.created_at desc)
    from assets a where a.workspace_id=p_workspace), '[]'::jsonb);
  end if;
  return '[]'::jsonb;
end $$;
grant execute on function list_records(text, uuid, text) to authenticated, anon;

-- 7. Light demo seed so Sales/Finance aren't empty on first view (only if none).
--    Clearly disposable sample rows — delete anytime.
do $$
declare w record; v_org uuid;
begin
  for w in select id from workspaces loop
    if not exists (select 1 from organizations where workspace_id = w.id) then
      insert into organizations (workspace_id, name, domain, industry, employee_count) values
        (w.id, 'Northwind Labs', 'northwind.io', 'SaaS', 120),
        (w.id, 'Lumen Devtools', 'lumen.dev', 'Developer Tools', 45),
        (w.id, 'Vertex Finance', 'vertex.co', 'Fintech', 80)
      returning id into v_org;
    end if;
    if not exists (select 1 from invoices where workspace_id = w.id) then
      insert into invoices (workspace_id, number, organization_id, amount, status, issued_at, due_at)
      select w.id, 'INV-100'||gs, (select id from organizations o where o.workspace_id=w.id order by random() limit 1),
             (array[24000,12000,36000])[gs], (array['paid','sent','overdue'])[gs],
             now()::date - (gs*14), now()::date + (30-gs*14)
      from generate_series(1,3) gs;
    end if;
    if not exists (select 1 from expenses where workspace_id = w.id) then
      insert into expenses (workspace_id, vendor, category, amount, status, spent_at) values
        (w.id, 'AWS', 'software', 2400, 'paid', now()::date - 5),
        (w.id, 'WeWork', 'office', 3200, 'approved', now()::date - 12),
        (w.id, 'Payroll', 'payroll', 48000, 'paid', now()::date - 1);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
