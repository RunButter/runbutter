-- ============================================================================
-- RunButter Platform Core — 0031_transactions.sql
-- Finance › Transactions: a Midday-style bank cash ledger. Bank accounts +
-- signed transactions (money in/out), categorization, VAT/tags, and rule-based
-- reconciliation ("Magic Inbox"-lite) matching transactions to invoices/expenses
-- entirely in Postgres — no LLM/external API, per the project cost rule.
--
-- Threads `transactions` through the generic CRUD RPCs (full redefinition copied
-- from 0026 — the latest complete definition — with a transactions branch added;
-- delete_record keeps the 0012 owner/admin role gate). import_records (0008)
-- reuses create_record, so CSV import works for free.
--
-- Dedicated RPCs (preferred pattern for new sub-systems): get_bank_accounts,
-- create_bank_account, delete_bank_account, get_transactions_ledger,
-- suggest_transaction_matches, reconcile_transaction, update_transactions_bulk.
--
-- Additive, idempotent & prod-safe. Depends on 0001–0026. Run AFTER them.
-- ============================================================================

-- 1. BANK ACCOUNTS — a cash account transactions belong to (like Midday).
create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  currency text not null default 'USD',
  institution text,
  opening_balance numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_bank_accounts_ws on bank_accounts(workspace_id);
drop trigger if exists trg_bank_accounts_upd on bank_accounts;
create trigger trg_bank_accounts_upd before update on bank_accounts for each row execute function set_updated_at();
alter table bank_accounts enable row level security;

-- 2. TRANSACTIONS — the bank ledger. amount is SIGNED: +inflow, -outflow.
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  bank_account_id uuid references bank_accounts(id) on delete set null,
  txn_date date not null default now()::date,
  description text,                                -- counterparty / memo
  amount numeric(14,2) not null default 0,        -- signed: + money in, - money out
  currency text not null default 'USD',
  category text,
  method text not null default 'transfer',        -- transfer|card|cash|direct_debit|fee|other
  status text not null default 'posted',          -- posted|pending|excluded
  tax_rate numeric(5,2),
  tags text[] not null default '{}',
  matched_invoice_id uuid references invoices(id) on delete set null,
  matched_expense_id uuid references expenses(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_transactions_ws   on transactions(workspace_id);
create index if not exists idx_transactions_date on transactions(workspace_id, txn_date desc);
create index if not exists idx_transactions_acct on transactions(bank_account_id);
drop trigger if exists trg_transactions_upd on transactions;
create trigger trg_transactions_upd before update on transactions for each row execute function set_updated_at();
alter table transactions enable row level security;

-- ============================================================================
-- 3. Generic CRUD — full redefinition from 0026, + transactions branch.
-- ============================================================================

-- list_records — + transactions (joins the account name).
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

  elsif p_object = 'transactions' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'txn_date', t.txn_date, 'description', t.description, 'amount', t.amount, 'currency', t.currency,
      'category', t.category, 'method', t.method, 'status', t.status, 'tax_rate', t.tax_rate,
      'account', ba.name, 'bank_account_id', t.bank_account_id,
      'matched_invoice_id', t.matched_invoice_id, 'matched_expense_id', t.matched_expense_id
    ) order by t.txn_date desc, t.created_at desc)
    from transactions t left join bank_accounts ba on ba.id = t.bank_account_id
    where t.workspace_id=p_workspace), '[]'::jsonb);

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

-- get_record — + transactions.
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
  end if;
  return null;
end $$;
grant execute on function get_record(text, text, uuid) to authenticated, anon;

-- create_record — + transactions. import_records reuses this (CSV import).
-- Amount is cleaned of currency symbols/commas so bank-statement CSVs import cleanly.
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
  else
    raise exception 'UNKNOWN_OBJECT: %', p_object;
  end if;
  return v_id;
end $$;
grant execute on function create_record(text, uuid, text, jsonb) to authenticated, anon;

-- update_record — + transactions.
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
  else
    raise exception 'UNKNOWN_OBJECT: %', p_object;
  end if;
end $$;
grant execute on function update_record(text, text, uuid, jsonb) to authenticated, anon;

-- delete_record — + transactions, keeping the owner/admin role gate (from 0012).
create or replace function delete_record(p_privy text, p_object text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tbl text; v_ws uuid;
begin
  tbl := case p_object
    when 'companies' then 'organizations' when 'organizations' then 'organizations'
    when 'people' then 'people' when 'invoices' then 'invoices' when 'expenses' then 'expenses'
    when 'transactions' then 'transactions'
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

-- ============================================================================
-- 4. Bank accounts — dedicated RPCs (balance = opening + non-excluded txns).
-- ============================================================================
create or replace function get_bank_accounts(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', ba.id, 'name', ba.name, 'currency', ba.currency, 'institution', ba.institution,
    'opening_balance', ba.opening_balance,
    'balance', ba.opening_balance + coalesce((select sum(t.amount) from transactions t where t.bank_account_id=ba.id and t.status <> 'excluded'), 0),
    'txn_count', (select count(*) from transactions t where t.bank_account_id=ba.id)
  ) order by ba.created_at) from bank_accounts ba where ba.workspace_id=p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_bank_accounts(text, uuid) to authenticated, anon;

create or replace function create_bank_account(p_privy text, p_workspace uuid, p_name text, p_currency text, p_opening numeric, p_institution text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  insert into bank_accounts (workspace_id, name, currency, opening_balance, institution)
  values (p_workspace, coalesce(nullif(p_name,''),'Account'), coalesce(nullif(p_currency,''),'USD'), coalesce(p_opening,0), nullif(p_institution,''))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function create_bank_account(text, uuid, text, text, numeric, text) to authenticated, anon;

create or replace function delete_bank_account(p_privy text, p_account uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from bank_accounts where id = p_account;
  if v_ws is null then return; end if;
  if not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if workspace_role(p_privy, v_ws) not in ('owner', 'admin') then raise exception 'FORBIDDEN: delete requires admin'; end if;
  delete from bank_accounts where id = p_account and workspace_id = v_ws;   -- txns keep, bank_account_id → null
end $$;
grant execute on function delete_bank_account(text, uuid) to authenticated, anon;

-- ============================================================================
-- 5. Ledger — rows + summary over a rolling window, optional account filter.
-- ============================================================================
create or replace function get_transactions_ledger(p_privy text, p_workspace uuid, p_account uuid default null, p_months int default 12)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_months int := greatest(1, least(coalesce(p_months, 12), 36));
  v_start  date := (date_trunc('month', now()) - ((v_months - 1) || ' months')::interval)::date;
  v_rows jsonb; v_in numeric; v_out numeric; v_count int; v_unrec int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'txn_date', t.txn_date, 'description', t.description, 'amount', t.amount, 'currency', t.currency,
    'category', t.category, 'method', t.method, 'status', t.status, 'tax_rate', t.tax_rate,
    'account', ba.name, 'bank_account_id', t.bank_account_id,
    'matched_invoice_id', t.matched_invoice_id, 'matched_expense_id', t.matched_expense_id,
    'match', case
      when t.matched_invoice_id is not null then 'Invoice '||coalesce((select nullif(number,'') from invoices where id=t.matched_invoice_id), '#')
      when t.matched_expense_id is not null then coalesce((select nullif(vendor,'') from expenses where id=t.matched_expense_id), 'Expense')
      else null end,
    'match_kind', case when t.matched_invoice_id is not null then 'invoice' when t.matched_expense_id is not null then 'expense' else null end
  ) order by t.txn_date desc, t.created_at desc), '[]'::jsonb)
  into v_rows
  from transactions t left join bank_accounts ba on ba.id = t.bank_account_id
  where t.workspace_id = p_workspace and t.txn_date >= v_start
    and (p_account is null or t.bank_account_id = p_account);

  select
    coalesce(sum(amount) filter (where amount > 0 and status <> 'excluded'), 0),
    coalesce(-sum(amount) filter (where amount < 0 and status <> 'excluded'), 0),
    count(*) filter (where status <> 'excluded'),
    count(*) filter (where status <> 'excluded' and matched_invoice_id is null and matched_expense_id is null)
  into v_in, v_out, v_count, v_unrec
  from transactions
  where workspace_id = p_workspace and txn_date >= v_start
    and (p_account is null or bank_account_id = p_account);

  return jsonb_build_object(
    'months', v_months,
    'summary', jsonb_build_object('inflow', v_in, 'outflow', v_out, 'net', v_in - v_out, 'count', v_count, 'unreconciled', v_unrec),
    'rows', v_rows
  );
end $$;
grant execute on function get_transactions_ledger(text, uuid, uuid, int) to authenticated, anon;

-- ============================================================================
-- 6. Reconciliation ("Magic Inbox"-lite) — pure Postgres, no LLM.
--    Suggests unmatched invoices/expenses by amount closeness + date proximity.
-- ============================================================================
create or replace function suggest_transaction_matches(p_privy text, p_txn uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
  v_ws uuid; v_amt numeric; v_date date; v_res jsonb;
begin
  select workspace_id, amount, txn_date into v_ws, v_amt, v_date
  from transactions where id = p_txn and workspace_id = any(my);
  if v_ws is null then return '[]'::jsonb; end if;

  if v_amt >= 0 then
    -- money in → open income invoices (receivables)
    select coalesce(jsonb_agg(c order by d), '[]'::jsonb) into v_res from (
      select jsonb_build_object(
        'kind', 'invoice', 'id', i.id,
        'label', coalesce(nullif(i.number,''), 'Invoice') || coalesce(' · ' || o.name, ''),
        'amount', i.amount, 'date', coalesce(i.issued_at, i.due_at), 'status', i.status
      ) as c, abs(i.amount - abs(v_amt)) as d
      from invoices i left join organizations o on o.id = i.organization_id
      where i.workspace_id = v_ws and coalesce(i.direction,'income') = 'income'
        and i.status in ('draft','sent','overdue')
        and not exists (select 1 from transactions t2 where t2.matched_invoice_id = i.id)
      order by abs(i.amount - abs(v_amt)), abs(coalesce(i.issued_at, i.due_at, v_date) - v_date)
      limit 6
    ) s;
  else
    -- money out → open expenses (payables) + cost bills
    select coalesce(jsonb_agg(c order by d), '[]'::jsonb) into v_res from (
      (select jsonb_build_object(
        'kind', 'expense', 'id', e.id,
        'label', coalesce(nullif(e.vendor,''), 'Expense') || coalesce(' · ' || e.category, ''),
        'amount', e.amount, 'date', e.spent_at, 'status', e.status
      ) as c, abs(e.amount - abs(v_amt)) as d
      from expenses e
      where e.workspace_id = v_ws and e.status in ('pending','approved')
        and not exists (select 1 from transactions t2 where t2.matched_expense_id = e.id))
      union all
      (select jsonb_build_object(
        'kind', 'invoice', 'id', i.id,
        'label', coalesce(nullif(i.number,''), 'Bill') || coalesce(' · ' || o.name, ''),
        'amount', i.amount, 'date', coalesce(i.issued_at, i.due_at), 'status', i.status
      ) as c, abs(i.amount - abs(v_amt)) as d
      from invoices i left join organizations o on o.id = i.organization_id
      where i.workspace_id = v_ws and i.direction = 'cost' and i.status <> 'paid'
        and not exists (select 1 from transactions t2 where t2.matched_invoice_id = i.id))
      order by d
      limit 6
    ) s;
  end if;
  return coalesce(v_res, '[]'::jsonb);
end $$;
grant execute on function suggest_transaction_matches(text, uuid) to authenticated, anon;

-- reconcile_transaction — link a txn to an invoice/expense (p_kind='invoice'|'expense'),
-- or clear the match (p_kind='none'). Marks the linked document paid; inherits its category.
create or replace function reconcile_transaction(p_privy text, p_txn uuid, p_kind text, p_target uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
declare v_ws uuid;
begin
  select workspace_id into v_ws from transactions where id = p_txn and workspace_id = any(my);
  if v_ws is null then raise exception 'NOT_FOUND'; end if;

  if p_kind = 'invoice' then
    if not exists (select 1 from invoices where id = p_target and workspace_id = v_ws) then raise exception 'BAD_TARGET'; end if;
    update transactions set matched_invoice_id = p_target, matched_expense_id = null,
      category = coalesce(category, (select nullif(category,'') from invoices where id = p_target))
    where id = p_txn;
    update invoices set status = 'paid' where id = p_target and workspace_id = v_ws and status <> 'paid';
  elsif p_kind = 'expense' then
    if not exists (select 1 from expenses where id = p_target and workspace_id = v_ws) then raise exception 'BAD_TARGET'; end if;
    update transactions set matched_expense_id = p_target, matched_invoice_id = null,
      category = coalesce(category, (select nullif(category,'') from expenses where id = p_target))
    where id = p_txn;
    update expenses set status = 'paid' where id = p_target and workspace_id = v_ws and status <> 'paid';
  else
    update transactions set matched_invoice_id = null, matched_expense_id = null where id = p_txn;
  end if;
end $$;
grant execute on function reconcile_transaction(text, uuid, text, uuid) to authenticated, anon;

-- update_transactions_bulk — bulk categorize / set status / set method. Returns rows affected.
create or replace function update_transactions_bulk(p_privy text, p_ids uuid[], p_patch jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
declare n int;
begin
  update transactions set
    category = case when p_patch ? 'category' then nullif(p_patch->>'category','') else category end,
    status   = case when p_patch ? 'status'   then coalesce(nullif(p_patch->>'status',''), status) else status end,
    method   = case when p_patch ? 'method'   then coalesce(nullif(p_patch->>'method',''), method) else method end
  where id = any(p_ids) and workspace_id = any(my);
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function update_transactions_bulk(text, uuid[], jsonb) to authenticated, anon;

-- ============================================================================
-- 7. Light demo seed so the ledger isn't empty on first view (only if none).
--    Clearly disposable sample rows, left un-reconciled to show off matching.
-- ============================================================================
do $$
declare w record; acct uuid;
begin
  for w in select id from workspaces loop
    if not exists (select 1 from bank_accounts where workspace_id = w.id) then
      insert into bank_accounts (workspace_id, name, currency, institution, opening_balance)
      values (w.id, 'Business checking', 'USD', 'Mercury', 12000) returning id into acct;

      insert into transactions (workspace_id, bank_account_id, txn_date, description, amount, category, method, status) values
        (w.id, acct, now()::date - 2,  'Stripe payout',              4200,   'Sales',    'transfer',     'posted'),
        (w.id, acct, now()::date - 3,  'AWS',                        -820,   'Software', 'card',         'posted'),
        (w.id, acct, now()::date - 5,  'Payroll run',                -48000, 'Payroll',  'transfer',     'posted'),
        (w.id, acct, now()::date - 6,  'Northwind Labs — INV-1001',  24000,  'Services', 'transfer',     'posted'),
        (w.id, acct, now()::date - 8,  'WeWork',                     -3200,  'Office',   'direct_debit', 'posted'),
        (w.id, acct, now()::date - 9,  'Google Workspace',           -180,   'Software', 'card',         'posted'),
        (w.id, acct, now()::date - 12, 'Vertex Finance — deposit',   12000,  'Services', 'transfer',     'pending'),
        (w.id, acct, now()::date - 14, 'Bank fee',                   -35,    'Fees',     'fee',          'posted');
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
