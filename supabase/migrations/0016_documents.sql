-- ============================================================================
-- HireBTR Platform Core — 0016_documents.sql
-- Invoice/offer DOCUMENTS: product/service line items + a kind (invoice|offer)
-- so the same record can be billed or quoted, and a branded PDF can be rendered.
-- Adds invoice_items, invoices.kind, get_invoice_document + save_invoice_items,
-- and threads kind through the CRUD RPCs (extended from 0015). Additive & prod-safe.
-- Depends on 0001–0015. Run AFTER them.
-- ============================================================================

-- 1. kind: an invoice (bill) or an offer (quote/proposal). Existing rows = invoice.
alter table invoices add column if not exists kind text not null default 'invoice';  -- invoice | offer

-- 2. Line items. line_total is generated; invoices.amount is kept in sync by
--    save_invoice_items below.
create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  description text,
  quantity numeric(14,2) not null default 1,
  unit_price numeric(14,2) not null default 0,
  line_total numeric(14,2) generated always as (quantity * unit_price) stored,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_invoice_items_inv on invoice_items(invoice_id);
alter table invoice_items enable row level security;

-- 3. get_invoice_document — everything a printable invoice/offer needs.
create or replace function get_invoice_document(p_privy text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
  v_inv invoices;
  v_seller text;
  v_buyer jsonb;
  v_items jsonb;
begin
  select * into v_inv from invoices where id = p_id and workspace_id = any(my);
  if not found then return null; end if;

  select name into v_seller from workspaces where id = v_inv.workspace_id;
  select to_jsonb(o) into v_buyer from (
    select name, domain, industry from organizations where id = v_inv.organization_id
  ) o;
  select coalesce(jsonb_agg(jsonb_build_object(
    'description', coalesce(nullif(it.description,''), p.name, 'Item'),
    'product', p.name,
    'product_id', it.product_id,
    'quantity', it.quantity,
    'unit_price', it.unit_price,
    'line_total', it.line_total
  ) order by it.position, it.created_at), '[]'::jsonb)
  into v_items
  from invoice_items it left join products p on p.id = it.product_id
  where it.invoice_id = v_inv.id;

  return jsonb_build_object(
    'id', v_inv.id, 'number', v_inv.number, 'kind', v_inv.kind, 'direction', v_inv.direction,
    'status', v_inv.status, 'currency', v_inv.currency, 'amount', v_inv.amount, 'category', v_inv.category,
    'issued_at', v_inv.issued_at, 'due_at', v_inv.due_at, 'notes', v_inv.notes,
    'seller', jsonb_build_object('name', coalesce(v_seller, 'Your company')),
    'buyer', v_buyer,
    'items', v_items
  );
end $$;
grant execute on function get_invoice_document(text, uuid) to authenticated, anon;

-- 4. save_invoice_items — replace the line items and keep invoices.amount in sync.
create or replace function save_invoice_items(p_privy text, p_invoice uuid, p_items jsonb)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
  v_ws uuid;
  v_total numeric;
  v_pos int := 0;
  itm jsonb;
begin
  select workspace_id into v_ws from invoices where id = p_invoice and workspace_id = any(my);
  if v_ws is null then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;

  delete from invoice_items where invoice_id = p_invoice;
  for itm in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into invoice_items (workspace_id, invoice_id, product_id, description, quantity, unit_price, position)
    values (
      v_ws, p_invoice, nullif(itm->>'product_id','')::uuid, nullif(itm->>'description',''),
      coalesce(nullif(itm->>'quantity','')::numeric, 1), coalesce(nullif(itm->>'unit_price','')::numeric, 0), v_pos
    );
    v_pos := v_pos + 1;
  end loop;

  select coalesce(sum(line_total), 0) into v_total from invoice_items where invoice_id = p_invoice;
  update invoices set amount = v_total where id = p_invoice;
  return v_total;
end $$;
grant execute on function save_invoice_items(text, uuid, jsonb) to authenticated, anon;

-- 5. Thread kind through the CRUD RPCs (extended from 0015).
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

create or replace function get_record(p_privy text, p_object text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  if p_object in ('companies','organizations') then
    return (select to_jsonb(t) from (select id, name, domain, industry, employee_count from organizations where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'people' then
    return (select to_jsonb(t) from (select id, first_name, last_name, email, phone, title, source from people where id=p_id and workspace_id = any(my)) t);
  elsif p_object = 'invoices' then
    return (select to_jsonb(t) from (select id, number, organization_id, kind, direction, amount, status, category, issued_at, due_at, notes from invoices where id=p_id and workspace_id = any(my)) t);
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
      kind=coalesce(nullif(p_data->>'kind',''),kind), direction=coalesce(nullif(p_data->>'direction',''),direction),
      amount=coalesce(nullif(p_data->>'amount','')::numeric,amount),
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

-- 6. Demo seed: give the first invoice line items + make one record an offer, so
--    the document view has something to render. Disposable.
do $$
declare w record; inv uuid; off uuid;
begin
  for w in select id from workspaces loop
    select id into inv from invoices where workspace_id = w.id and kind = 'invoice' order by created_at limit 1;
    if inv is not null and not exists (select 1 from invoice_items where invoice_id = inv) then
      insert into invoice_items (workspace_id, invoice_id, product_id, description, quantity, unit_price, position)
      select w.id, inv, p.id, p.name, (array[10,1,2])[1 + (row_number() over (order by p.created_at))::int % 3], p.unit_price,
             (row_number() over (order by p.created_at))::int
      from products p where p.workspace_id = w.id limit 3;
      update invoices set amount = coalesce((select sum(line_total) from invoice_items where invoice_id = inv), amount) where id = inv;
    end if;
    -- turn the most recent sent invoice into an offer example
    select id into off from invoices where workspace_id = w.id and status = 'sent' order by created_at desc limit 1;
    if off is not null then update invoices set kind = 'offer' where id = off; end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
