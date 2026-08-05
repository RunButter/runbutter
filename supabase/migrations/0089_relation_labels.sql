-- 0089 — a link shows the thing it points at, not its uuid.
--
-- A custom object's relation field stores a uuid in `data`, and list_records
-- returned that uuid untouched. Every built-in resolves its links in SQL — an
-- invoice row carries the company NAME, an issue carries its project's — so a
-- Work order sitting next to them showed `fd6b33e9-c2e0-…` under Customer.
-- Custom objects are supposed to be first-class; a column of uuids is the most
-- visible possible way for them not to be.
--
-- WHY IN SQL AND NOT IN THE CLIENT. The table is not the only consumer. The
-- CSV feed, the Excel sync, `/api/mcp` and the agent tools all read these same
-- two functions, and an agent that reads "customer: fd6b33e9" cannot say who
-- the customer is. Resolving it once here fixes every one of them; resolving it
-- in RecordTable would fix the screen and leave the rest wrong.
--
-- The label is added under `<key>_label` and the raw uuid is KEPT, because the
-- form needs the id to edit the link and the label is for reading. Nothing is
-- renamed, so every existing consumer is unaffected.
--
-- Per the convention, list_records and get_record are redefined IN FULL rather
-- than shadowed by a parallel function. Only the custom branches changed.

-- ── The label of one linked record ──────────────────────────────────────────
-- A whitelist CASE, never dynamic SQL — same reasoning as segment_match: a
-- SECURITY DEFINER path that builds EXECUTE from a stored `relation_to` string
-- is one escaping mistake from arbitrary SQL across every tenant.
--
-- An unknown target returns NULL rather than raising, and NULL means "no label"
-- — the reader falls back to showing the raw value, which is exactly today's
-- behaviour. Failing closed here would blank a link that does exist.
--
-- The HR tables (candidates, positions) are deliberately absent: they are
-- tenanted by company_id through a different resolver, and quietly reading them
-- with a workspace id would be a tenancy claim this function cannot check.
create or replace function custom_relation_label(p_workspace uuid, p_target text, p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case p_target
    when 'companies' then (select o.name from organizations o where o.id = p_id and o.workspace_id = p_workspace)
    when 'organizations' then (select o.name from organizations o where o.id = p_id and o.workspace_id = p_workspace)
    when 'people' then (select nullif(trim(coalesce(pe.first_name,'') || ' ' || coalesce(pe.last_name,'')), '')
                          from people pe where pe.id = p_id and pe.workspace_id = p_workspace)
    when 'invoices' then (select i.number from invoices i where i.id = p_id and i.workspace_id = p_workspace)
    when 'offers' then (select i.number from invoices i where i.id = p_id and i.workspace_id = p_workspace)
    when 'expenses' then (select e.vendor from expenses e where e.id = p_id and e.workspace_id = p_workspace)
    when 'transactions' then (select t.description from transactions t where t.id = p_id and t.workspace_id = p_workspace)
    when 'products' then (select pr.name from products pr where pr.id = p_id and pr.workspace_id = p_workspace)
    when 'campaigns' then (select c.name from campaigns c where c.id = p_id and c.workspace_id = p_workspace)
    when 'projects' then (select p.name from projects p where p.id = p_id and p.workspace_id = p_workspace)
    when 'issues' then (select i.title from issues i where i.id = p_id and i.workspace_id = p_workspace)
    when 'assets' then (select a.name from assets a where a.id = p_id and a.workspace_id = p_workspace)
    -- Another custom object, in the same workspace. Its own primary field is
    -- what it is called, so this is the same rule the object itself uses.
    else (select custom_record_label(r.object_id, r.data)
            from custom_records r
            join custom_objects o on o.id = r.object_id
           where r.id = p_id and o.workspace_id = p_workspace and o.slug = p_target)
  end;
$$;
grant execute on function custom_relation_label(uuid, text, uuid) to authenticated, anon;

-- ── Every link on one row ───────────────────────────────────────────────────
create or replace function custom_relation_labels(p_workspace uuid, p_object uuid, p_data jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_out jsonb := '{}'::jsonb; f record; v_id uuid; v_label text;
begin
  for f in select key, relation_to from custom_fields
            where object_id = p_object and type = 'relation'
              and coalesce(relation_to, '') <> ''
  loop
    -- A stored value that is not a uuid is not a broken link, it is not a link
    -- at all: coerce_custom_value only accepts uuids, but data written before a
    -- field's type changed can be anything. Casting without this raises and
    -- takes the whole list down.
    begin
      v_id := nullif(p_data ->> f.key, '')::uuid;
    exception when others then v_id := null;
    end;
    if v_id is null then continue; end if;

    v_label := custom_relation_label(p_workspace, f.relation_to, v_id);
    if v_label is not null then
      v_out := v_out || jsonb_build_object(f.key || '_label', v_label);
    end if;
  end loop;
  return v_out;
end $$;
grant execute on function custom_relation_labels(uuid, uuid, jsonb) to authenticated, anon;

-- ── The CRUD monolith, redefined in full ────────────────────────────────────
create or replace function list_records(p_privy text, p_workspace uuid, p_object text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_obj uuid;
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

  -- ── Custom objects (0087) ──────────────────────────────────────────────────
  -- LAST, after every built-in has matched. That ordering is the safety
  -- property: a custom object can never shadow a built-in one, whatever it is
  -- called. reserved_object_slug refuses the name at creation too, so the
  -- collision is impossible rather than merely lost.
  v_obj := (select id from custom_objects
             where workspace_id = p_workspace and slug = p_object and enabled);
  if v_obj is not null then
    return coalesce((select jsonb_agg(
      -- id and name are spliced on top of the row's own data, so a custom
      -- object presents the same shape as a built-in one and every consumer
      -- (the table, the CSV feed, the agent tools) works unchanged.
      -- Links resolved to names (0089), then id and name spliced on top, so a
      -- custom object presents the same shape as a built-in one and every
      -- consumer (the table, the CSV feed, the agent tools) works unchanged.
      r.data
        || custom_relation_labels(p_workspace, v_obj, r.data)
        || jsonb_build_object('id', r.id, 'name', custom_record_label(v_obj, r.data))
      order by r.created_at desc
    ) from custom_records r where r.object_id = v_obj), '[]'::jsonb);
  end if;

  return '[]'::jsonb;
end $$;
grant execute on function list_records(text, uuid, text) to authenticated, anon;

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

  -- ── Custom objects (0087) ──────────────────────────────────────────────────
  -- Tenancy comes from `my` in SQL, exactly like every branch above: a foreign
  -- record id resolves to no row rather than to someone else's data.
  return (select r.data
                   || custom_relation_labels(o.workspace_id, r.object_id, r.data)
                   || jsonb_build_object('id', r.id,
                        'name', custom_record_label(r.object_id, r.data))
            from custom_records r
            join custom_objects o on o.id = r.object_id
           where r.id = p_id and o.slug = p_object and r.workspace_id = any(my));
end $$;
grant execute on function get_record(text, text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
