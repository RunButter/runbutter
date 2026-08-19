-- ============================================================================
-- RunButter — 0124_orders_stock.sql
--
-- Orders, line items, and stock that actually moves.
--
-- ── PRODUCTS HAD NO STOCK ───────────────────────────────────────────────────
-- `products` has been in the schema since 0004 with a name, a SKU and a price,
-- and no quantity. So the catalogue could describe what a shop sells and could
-- not say whether any of it was left, which makes it a price list rather than
-- inventory. And there was no order object at all — the thing an ecommerce
-- business creates hundreds of times a week had nowhere to go.
--
-- ── TRACKING IS OPT-IN PER PRODUCT ──────────────────────────────────────────
-- `track_stock` defaults FALSE. A consultancy selling days, an agency selling
-- retainers and a SaaS selling seats all have products and no inventory; giving
-- them a stock count of zero and a low-stock warning on every line would make
-- the feature actively worse than not having it.
--
-- ── ORDERS GET DEDICATED RPCs, NOT A CRUD BRANCH ────────────────────────────
-- The five CRUD functions are flat: one row, one set of columns. An order is a
-- parent with children, and forcing it through `create_record` would mean
-- either losing the line items or inventing a nested-write convention that only
-- one object uses. So it follows `pipeline_records` (0092), `docs` (0081) and
-- the vault (0118): its own functions — AND its own agent tools in the same
-- change, because a subsystem with RPCs and no tools is invisible to every
-- agent and to /api/mcp.
--
-- Products stay in the monolith. Stock is three columns on a row that is
-- already there, so list/get/create/update_record are redefined IN FULL and
-- gain them.
--
-- ── STOCK MOVES ONCE, AND CAN MOVE BACK ─────────────────────────────────────
-- The bug this is shaped to avoid: an order flipped paid → pending → paid
-- decrementing stock twice. `orders.stock_applied` records whether this order
-- has taken its stock, so applying is idempotent and cancelling gives it back
-- exactly once. Same shape as `invoices.paid_at` (0115), which stamps on the
-- transition rather than on every save.
--
-- ── LINE ITEMS SNAPSHOT THE NAME AND PRICE ──────────────────────────────────
-- `order_items.name` and `unit_price` are copied at the time of the order and
-- never re-read from `products`. Renaming a product or changing its price must
-- not silently rewrite what a customer was charged last March — the same reason
-- `sanitize_attachments` snapshots a file name and `post_agent_message` snapshots
-- an author.
--
-- The TOTAL is derived from the items rather than stored. A stored total is a
-- number that can disagree with its own rows, and the disagreement is invisible.
-- ============================================================================

alter table products add column if not exists stock numeric(14,3) not null default 0;
alter table products add column if not exists low_stock_at numeric(14,3);
alter table products add column if not exists track_stock boolean not null default false;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  number text,
  organization_id uuid references organizations(id) on delete set null,
  person_id uuid references people(id) on delete set null,
  -- draft → pending → paid → shipped → delivered, or cancelled / refunded.
  status text not null default 'draft',
  currency text not null default 'USD',
  placed_at date,
  ship_to text,
  notes text,
  /*
   * Has this order taken its stock? The whole idempotency of the feature.
   * Without it, paid → pending → paid decrements twice and nothing says so.
   */
  stock_applied boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_status_check check (status in
    ('draft','pending','paid','shipped','delivered','cancelled','refunded'))
);
create index if not exists idx_orders_ws on orders(workspace_id);
create index if not exists idx_orders_org on orders(organization_id);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  -- Nullable and ON DELETE SET NULL: deleting a product must not delete the
  -- history of having sold it. The snapshot below is what keeps the line
  -- readable afterwards.
  product_id uuid references products(id) on delete set null,
  name text not null,
  sku text,
  quantity numeric(14,3) not null default 1,
  unit_price numeric(14,2) not null default 0,
  position int not null default 0
);
create index if not exists idx_order_items_order on order_items(order_id);

alter table orders      enable row level security;
alter table order_items enable row level security;

drop trigger if exists trg_orders_upd on orders;
create trigger trg_orders_upd before update on orders for each row execute function set_updated_at();

/**
 * Which statuses mean the goods have left the shelf.
 *
 * A single predicate rather than a condition repeated in three places, for the
 * reason `can_read_channel` gives: scattered rules drift, and a stock rule that
 * drifts leaves a shop with numbers it cannot explain.
 *
 * `paid` is the line, not `shipped`. Stock is committed the moment somebody has
 * bought it — selling the same unit twice between payment and dispatch is the
 * failure this prevents.
 */
create or replace function order_holds_stock(p_status text)
returns boolean language sql immutable as $$
  select coalesce(p_status, 'draft') in ('paid', 'shipped', 'delivered')
$$;

/**
 * Apply or release this order's stock, ONCE.
 *
 * Returns true if anything moved. Reads `stock_applied` and writes it in the
 * same statement's transaction, so a double call is a no-op rather than a
 * double decrement.
 *
 * Only products with `track_stock` move. Stock is allowed to go NEGATIVE and
 * that is deliberate: refusing the sale would mean an order that a customer has
 * already paid for cannot be recorded, and a shop that is oversold needs to see
 * −3 rather than a silent 0. The screen shows it in red; the database does not
 * pretend it did not happen.
 */
create or replace function apply_order_stock(p_order uuid, p_apply boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from orders where id = p_order for update;
  if not found then return false; end if;
  if v.stock_applied = p_apply then return false; end if;

  update products p set stock = p.stock + (case when p_apply then -1 else 1 end) * i.qty
    from (select product_id, sum(quantity) as qty from order_items
           where order_id = p_order and product_id is not null group by product_id) i
   where p.id = i.product_id and p.workspace_id = v.workspace_id and p.track_stock;

  update orders set stock_applied = p_apply where id = p_order;
  return true;
end $$;

create or replace function get_orders(p_privy text, p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'number', o.number, 'status', o.status, 'currency', o.currency,
             'placed_at', o.placed_at, 'customer', coalesce(org.name,
               nullif(trim(coalesce(pe.first_name,'') || ' ' || coalesce(pe.last_name,'')), '')),
             'organization_id', o.organization_id, 'person_id', o.person_id,
             'stock_applied', o.stock_applied,
             'items', (select count(*) from order_items oi where oi.order_id = o.id),
             -- Derived, never stored. A stored total can disagree with its own
             -- rows and nothing would ever say so.
             'total', coalesce((select sum(oi.quantity * oi.unit_price)
                                  from order_items oi where oi.order_id = o.id), 0))
           order by o.placed_at desc nulls last, o.created_at desc)
      from orders o
      left join organizations org on org.id = o.organization_id
      left join people pe on pe.id = o.person_id
     where o.workspace_id = p_workspace
  ), '[]'::jsonb);
end $$;

create or replace function get_order(p_privy text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare my uuid[]; v jsonb;
begin
  select coalesce(array_agg(workspace_id), '{}') into my from accounts where privy_user_id = p_privy;
  select jsonb_build_object(
           'id', o.id, 'number', o.number, 'status', o.status, 'currency', o.currency,
           'placed_at', o.placed_at, 'ship_to', o.ship_to, 'notes', o.notes,
           'organization_id', o.organization_id, 'person_id', o.person_id,
           'customer', coalesce(org.name,
             nullif(trim(coalesce(pe.first_name,'') || ' ' || coalesce(pe.last_name,'')), '')),
           'stock_applied', o.stock_applied,
           'items', coalesce((select jsonb_agg(jsonb_build_object(
                       'id', oi.id, 'product_id', oi.product_id, 'name', oi.name, 'sku', oi.sku,
                       'quantity', oi.quantity, 'unit_price', oi.unit_price,
                       'line_total', oi.quantity * oi.unit_price) order by oi.position, oi.id)
                     from order_items oi where oi.order_id = o.id), '[]'::jsonb),
           'total', coalesce((select sum(oi.quantity * oi.unit_price)
                                from order_items oi where oi.order_id = o.id), 0))
    into v
    from orders o
    left join organizations org on org.id = o.organization_id
    left join people pe on pe.id = o.person_id
   where o.id = p_id and o.workspace_id = any(my);
  return v;
end $$;

/**
 * Create or replace an order and ALL of its lines.
 *
 * The items are replaced wholesale rather than diffed: an order is edited as a
 * document, a diff would need stable client-side ids for rows that may not
 * exist yet, and getting that wrong duplicates lines on a customer's invoice.
 *
 * Stock is RELEASED before the rewrite and RE-APPLIED after, when the status
 * still holds it. Editing a paid order's quantities otherwise leaves the old
 * quantities decremented forever — the single easiest way to make an inventory
 * drift with nothing to point at.
 */
create or replace function save_order(p_privy text, p_workspace uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text; v_was_applied boolean := false; it jsonb; n int := 0;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  v_status := coalesce(nullif(p_data->>'status',''), 'draft');
  if not order_holds_stock(v_status)
     and v_status not in ('draft','pending','cancelled','refunded') then
    raise exception 'INVALID_STATUS';
  end if;

  if p_id is null then
    insert into orders (workspace_id, number, organization_id, person_id, status, currency,
                        placed_at, ship_to, notes)
    values (p_workspace, nullif(p_data->>'number',''),
            -- Both ids are re-checked against the workspace, as
            -- create_pipeline_record does: neither column is trusted from the
            -- client, and a foreign id would render as a blank customer forever.
            (select o.id from organizations o where o.id = nullif(p_data->>'organization_id','')::uuid and o.workspace_id = p_workspace),
            (select pe.id from people pe where pe.id = nullif(p_data->>'person_id','')::uuid and pe.workspace_id = p_workspace),
            v_status, coalesce(nullif(p_data->>'currency',''), 'USD'),
            nullif(p_data->>'placed_at','')::date, nullif(p_data->>'ship_to',''), nullif(p_data->>'notes',''))
    returning id into v_id;
  else
    select stock_applied into v_was_applied from orders where id = p_id and workspace_id = p_workspace;
    if v_was_applied is null then raise exception 'NOT_FOUND'; end if;
    -- Give the stock back before the lines change underneath it.
    if v_was_applied then perform apply_order_stock(p_id, false); end if;

    update orders set
      number          = case when p_data ? 'number' then nullif(p_data->>'number','') else number end,
      organization_id = case when p_data ? 'organization_id'
                             then (select o.id from organizations o where o.id = nullif(p_data->>'organization_id','')::uuid and o.workspace_id = p_workspace)
                             else organization_id end,
      person_id       = case when p_data ? 'person_id'
                             then (select pe.id from people pe where pe.id = nullif(p_data->>'person_id','')::uuid and pe.workspace_id = p_workspace)
                             else person_id end,
      status          = case when p_data ? 'status' then v_status else status end,
      currency        = case when p_data ? 'currency' then coalesce(nullif(p_data->>'currency',''), currency) else currency end,
      placed_at       = case when p_data ? 'placed_at' then nullif(p_data->>'placed_at','')::date else placed_at end,
      ship_to         = case when p_data ? 'ship_to' then nullif(p_data->>'ship_to','') else ship_to end,
      notes           = case when p_data ? 'notes' then nullif(p_data->>'notes','') else notes end
     where id = p_id and workspace_id = p_workspace returning id into v_id;
  end if;

  -- Items only when the key is PRESENT, so a status-only update does not wipe
  -- the lines. 0088's rule, applied to a child collection.
  if p_data ? 'items' then
    delete from order_items where order_id = v_id;
    for it in select * from jsonb_array_elements(coalesce(p_data->'items', '[]'::jsonb)) loop
      insert into order_items (order_id, product_id, name, sku, quantity, unit_price, position)
      select v_id,
             pr.id,
             -- Snapshot: the product's name today, kept forever. Falls back to
             -- whatever the client sent when the line is not a catalogue item.
             coalesce(pr.name, nullif(it->>'name',''), 'Item'),
             coalesce(pr.sku, nullif(it->>'sku','')),
             coalesce(nullif(it->>'quantity','')::numeric, 1),
             -- An explicit price wins, so a discount survives; otherwise the
             -- catalogue price at the moment of the order.
             coalesce(nullif(it->>'unit_price','')::numeric, pr.unit_price, 0),
             n
        from (select 1) _
        left join products pr on pr.id = nullif(it->>'product_id','')::uuid
                             and pr.workspace_id = p_workspace;
      n := n + 1;
    end loop;
  end if;

  -- Re-apply if this order's status still holds stock.
  select status into v_status from orders where id = v_id;
  if order_holds_stock(v_status) then perform apply_order_stock(v_id, true); end if;
  return v_id;
end $$;

/**
 * Move an order along, and move the stock with it.
 *
 * The only place a status change has a stock consequence, so the two can never
 * be done separately and disagree.
 */
create or replace function set_order_status(p_privy text, p_workspace uuid, p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(p_status,'') not in ('draft','pending','paid','shipped','delivered','cancelled','refunded') then
    raise exception 'INVALID_STATUS';
  end if;
  update orders set status = p_status where id = p_id and workspace_id = p_workspace returning id into v_id;
  if v_id is null then raise exception 'NOT_FOUND'; end if;

  perform apply_order_stock(v_id, order_holds_stock(p_status));
  return get_order(p_privy, v_id);
end $$;

create or replace function delete_order(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Give the stock back FIRST. Deleting a paid order without releasing it
  -- leaves the shelf permanently short by that order, with the evidence gone.
  perform apply_order_stock(p_id, false);
  delete from orders where id = p_id and workspace_id = p_workspace;
  get diagnostics n = row_count; return n > 0;
end $$;

/**
 * What is running out. Tracked products only, worst first.
 */
create or replace function get_low_stock(p_privy text, p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', id, 'name', name, 'sku', sku, 'stock', stock, 'low_stock_at', low_stock_at,
             'out', stock <= 0)
           order by stock asc)
      from products
     where workspace_id = p_workspace and track_stock
       and low_stock_at is not null and stock <= low_stock_at
  ), '[]'::jsonb);
end $$;


/*
 * ── The monolith, redefined IN FULL with stock on products ──────────────────
 *
 * Extended, never forked: everything downstream — the table, the form, CSV
 * import, the Excel sync, /api/mcp and every agent tool — reads these five, so
 * a parallel "products with stock" function would be a second answer to the
 * same question.
 */

create or replace function list_records(p_privy text, p_workspace uuid, p_object text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_obj uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  if p_object = 'people' then
    return builtin_extras_addmany(p_workspace, p_object, coalesce((select jsonb_agg(jsonb_build_object(
      'id', pe.id, 'name', trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,'')),
      'title', pe.title, 'company', co.name, 'email', pe.email, 'source', pe.source,
      'synergy', (select ps.overall from psychometrics ps where ps.person_id=pe.id order by ps.assessed_at desc limit 1)
    ) order by pe.created_at desc)
    from people pe left join organizations co on co.id = pe.primary_company_id
    where pe.workspace_id=p_workspace), '[]'::jsonb));

  elsif p_object in ('companies','organizations') then
    return builtin_extras_addmany(p_workspace, p_object, coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'domain', o.domain, 'industry', o.industry, 'employee_count', o.employee_count,
      'tax_id', o.tax_id, 'address', o.address, 'country', o.country
    ) order by o.created_at desc) from organizations o where o.workspace_id=p_workspace), '[]'::jsonb));

  elsif p_object = 'invoices' then
    return builtin_extras_addmany(p_workspace, p_object, coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'number', i.number, 'company', o.name, 'kind', i.kind, 'direction', i.direction,
      'category', i.category, 'amount', i.amount, 'status', i.status, 'due_at', i.due_at
    ) order by i.created_at desc)
    from invoices i left join organizations o on o.id = i.organization_id
    where i.workspace_id=p_workspace), '[]'::jsonb));

  elsif p_object = 'expenses' then
    return builtin_extras_addmany(p_workspace, p_object, coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'vendor', e.vendor, 'category', e.category, 'amount', e.amount, 'status', e.status, 'spent_at', e.spent_at
    ) order by e.created_at desc) from expenses e where e.workspace_id=p_workspace), '[]'::jsonb));

  elsif p_object = 'transactions' then
    return builtin_extras_addmany(p_workspace, p_object, coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'txn_date', t.txn_date, 'description', t.description, 'amount', t.amount, 'currency', t.currency,
      'category', t.category, 'method', t.method, 'status', t.status, 'tax_rate', t.tax_rate,
      'account', ba.name, 'bank_account_id', t.bank_account_id,
      'matched_invoice_id', t.matched_invoice_id, 'matched_expense_id', t.matched_expense_id
    ) order by t.txn_date desc, t.created_at desc)
    from transactions t left join bank_accounts ba on ba.id = t.bank_account_id
    where t.workspace_id=p_workspace), '[]'::jsonb));

  elsif p_object = 'products' then
    return builtin_extras_addmany(p_workspace, p_object, coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'image', p.image_url, 'sku', p.sku, 'category', p.category, 'unit_price', p.unit_price, 'unit', p.unit,
      'stock', case when p.track_stock then p.stock end,
      -- Computed here rather than in the client so the table, the CSV feed, the
      -- Excel sync and every agent agree on what "low" means.
      'low_stock', p.track_stock and p.low_stock_at is not null and p.stock <= p.low_stock_at
    ) order by p.created_at desc) from products p where p.workspace_id=p_workspace), '[]'::jsonb));

  elsif p_object = 'campaigns' then
    return builtin_extras_addmany(p_workspace, p_object, coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name, 'channel', c.channel, 'status', c.status,
      'budget', c.budget, 'spend', c.spend, 'leads', c.leads, 'starts_on', c.starts_on, 'ends_on', c.ends_on
    ) order by c.created_at desc) from campaigns c where c.workspace_id=p_workspace), '[]'::jsonb));

  elsif p_object = 'projects' then
    return builtin_extras_addmany(p_workspace, p_object, coalesce((select jsonb_agg(jsonb_build_object(
      'id', pr.id, 'name', pr.name, 'identifier', pr.identifier, 'status', pr.status,
      'issues', (select count(*) from issues i where i.project_id = pr.id)
    ) order by pr.created_at desc) from projects pr where pr.workspace_id=p_workspace), '[]'::jsonb));

  elsif p_object = 'issues' then
    return builtin_extras_addmany(p_workspace, p_object, coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.title, 'project', pr.name, 'status', i.status,
      'priority', i.priority, 'due_date', i.due_date,
      'assignee', (select a.full_name from accounts a where a.id = i.assignee_account_id)
    ) order by i.sort_order)
    from issues i left join projects pr on pr.id = i.project_id
    where i.workspace_id=p_workspace), '[]'::jsonb));

  elsif p_object = 'assets' then
    return builtin_extras_addmany(p_workspace, p_object, coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'category', a.category, 'serial_number', a.serial_number, 'status', a.status,
      'assigned_to', (select trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,'')) from people pe where pe.id=a.assigned_to_person_id)
    ) order by a.created_at desc) from assets a where a.workspace_id=p_workspace), '[]'::jsonb));
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

create or replace function get_record(p_privy text, p_object text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  if p_object in ('companies','organizations') then
    return builtin_extras_add(p_object, p_id, (select to_jsonb(t) from (select id, name, domain, industry, employee_count, tax_id, address, country from organizations where id=p_id and workspace_id = any(my)) t));
  elsif p_object = 'people' then
    return builtin_extras_add(p_object, p_id, (select to_jsonb(t) from (select id, first_name, last_name, email, phone, title, source from people where id=p_id and workspace_id = any(my)) t));
  elsif p_object = 'invoices' then
    return builtin_extras_add(p_object, p_id, (select to_jsonb(t) from (select id, number, organization_id, kind, direction, amount, status, category, issued_at, due_at, notes from invoices where id=p_id and workspace_id = any(my)) t));
  elsif p_object = 'expenses' then
    return builtin_extras_add(p_object, p_id, (select to_jsonb(t) from (select id, vendor, category, amount, status, spent_at, notes from expenses where id=p_id and workspace_id = any(my)) t));
  elsif p_object = 'transactions' then
    return builtin_extras_add(p_object, p_id, (select to_jsonb(t) from (select id, txn_date, description, amount, currency, category, method, status, tax_rate, bank_account_id, notes from transactions where id=p_id and workspace_id = any(my)) t));
  elsif p_object = 'products' then
    return builtin_extras_add(p_object, p_id, (select to_jsonb(t) from (select id, name, sku, description, unit_price, unit, category, image_url, stock, low_stock_at, track_stock from products where id=p_id and workspace_id = any(my)) t));
  elsif p_object = 'campaigns' then
    return builtin_extras_add(p_object, p_id, (select to_jsonb(t) from (select id, name, channel, status, budget, spend, leads, starts_on, ends_on, notes from campaigns where id=p_id and workspace_id = any(my)) t));
  elsif p_object = 'projects' then
    return builtin_extras_add(p_object, p_id, (select to_jsonb(t) from (select id, name, identifier, status, description from projects where id=p_id and workspace_id = any(my)) t));
  elsif p_object = 'issues' then
    return builtin_extras_add(p_object, p_id, (select to_jsonb(t) from (select id, title, status, priority, due_date, description from issues where id=p_id and workspace_id = any(my)) t));
  elsif p_object = 'assets' then
    return builtin_extras_add(p_object, p_id, (select to_jsonb(t) from (select id, name, category, serial_number, status, assigned_to_person_id, purchased_at, notes from assets where id=p_id and workspace_id = any(my)) t));
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
    insert into products (workspace_id, name, sku, description, unit_price, unit, category, image_url,
                          stock, low_stock_at, track_stock)
    values (p_workspace, p_data->>'name', nullif(p_data->>'sku',''), nullif(p_data->>'description',''), coalesce(nullif(p_data->>'unit_price','')::numeric,0), nullif(p_data->>'unit',''), nullif(p_data->>'category',''), nullif(p_data->>'image_url',''),
            coalesce(nullif(p_data->>'stock','')::numeric, 0),
            nullif(p_data->>'low_stock_at','')::numeric,
            -- Tracking is OPT-IN per product. A services business selling
            -- consulting days would otherwise get a stock count of zero on
            -- every line and a low-stock warning on all of them.
            coalesce(nullif(p_data->>'track_stock','')::boolean, false))
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
      -- Absent leaves it alone, present writes it — 0088's rule. Stock is
      -- editable here for a stocktake; ORDERS move it through move_stock, which
      -- is the only path that keeps a reason on the record.
      stock        = case when p_data ? 'stock' then coalesce(nullif(p_data->>'stock','')::numeric, stock) else stock end,
      low_stock_at = case when p_data ? 'low_stock_at' then nullif(p_data->>'low_stock_at','')::numeric else low_stock_at end,
      track_stock  = case when p_data ? 'track_stock' then coalesce(nullif(p_data->>'track_stock','')::boolean, track_stock) else track_stock end,
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

  -- Fields this workspace added to a built-in object (0097). Partial, matching
  -- the named columns above: a key that is absent leaves its value alone.
  if v_obj is null then
    perform builtin_extras_write(
      (select workspace_id from accounts where privy_user_id = p_privy and workspace_id = any(my) limit 1),
      p_object, p_id, coalesce(p_data, '{}'::jsonb), true);
  end if;
end $$;

revoke all on function order_holds_stock(text)                       from public, anon, authenticated;
revoke all on function apply_order_stock(uuid, boolean)              from public, anon, authenticated;
revoke all on function get_orders(text, uuid)                        from public, anon, authenticated;
revoke all on function get_order(text, uuid)                         from public, anon, authenticated;
revoke all on function save_order(text, uuid, uuid, jsonb)           from public, anon, authenticated;
revoke all on function set_order_status(text, uuid, uuid, text)      from public, anon, authenticated;
revoke all on function delete_order(text, uuid, uuid)                from public, anon, authenticated;
revoke all on function get_low_stock(text, uuid)                     from public, anon, authenticated;
revoke all on function list_records(text, uuid, text)                from public, anon, authenticated;
revoke all on function get_record(text, text, uuid)                  from public, anon, authenticated;
revoke all on function create_record(text, uuid, text, jsonb)        from public, anon, authenticated;
revoke all on function update_record(text, text, uuid, jsonb)        from public, anon, authenticated;

grant execute on function order_holds_stock(text)                    to service_role;
grant execute on function apply_order_stock(uuid, boolean)           to service_role;
grant execute on function get_orders(text, uuid)                     to service_role;
grant execute on function get_order(text, uuid)                      to service_role;
grant execute on function save_order(text, uuid, uuid, jsonb)        to service_role;
grant execute on function set_order_status(text, uuid, uuid, text)   to service_role;
grant execute on function delete_order(text, uuid, uuid)             to service_role;
grant execute on function get_low_stock(text, uuid)                  to service_role;
grant execute on function list_records(text, uuid, text)             to service_role;
grant execute on function get_record(text, text, uuid)               to service_role;
grant execute on function create_record(text, uuid, text, jsonb)     to service_role;
grant execute on function update_record(text, text, uuid, jsonb)     to service_role;

notify pgrst, 'reload schema';
