-- ============================================================================
-- RunButter — 0087_custom_objects.sql
-- Workspaces can define their own objects and fields.
--
-- WHY THIS MATTERS MORE THAN ANY FEATURE SO FAR. Every object in this product
-- is hardcoded. A transport company cannot add a Vehicle with a plate number
-- and an MOT date; a clinic cannot add a Patient; a factory cannot add a
-- Machine. "One core across Sales, Finance, Marketing, Projects and HR" is
-- only true for the five verticals we happened to build, and the honest
-- version of a general tool is one that BENDS. This is what lets a vertical be
-- a template rather than a fork.
--
-- ── JSONB, NOT DDL ──────────────────────────────────────────────────────────
-- A custom object could create a real table each. It must not. A SECURITY
-- DEFINER function running CREATE TABLE built from user input is one escaping
-- mistake from arbitrary DDL across every tenant — the same reasoning that
-- keeps segment_match (0072) a whitelist CASE and never dynamic SQL. Rows live
-- in ONE table with a `data jsonb` column: no runtime DDL, no migration per
-- object, no schema explosion, and one GIN index serves every workspace.
--
-- ── THE CRUD MONOLITH IS EXTENDED, NOT FORKED ───────────────────────────────
-- list/get/create/update/delete_record gain ONE branch each, at the END, after
-- every built-in has had its say. That ordering is the safety property: a
-- custom object can never shadow a built-in, whatever it is called.
--
-- Everything downstream — the agent tools, /api/mcp, the CSV feed, Excel sync,
-- imports, the record table — goes through those five functions, so a custom
-- object becomes a first-class citizen everywhere the moment this runs. That is
-- the whole reason for extending the monolith instead of adding a parallel one.
--
-- ── VALUES ARE COERCED, AND FAIL CLOSED ─────────────────────────────────────
-- coerce_custom_value types each value against its field. A number that is not
-- a number, and a select option that is not in the list, are REJECTED rather
-- than silently stored: a field definition nobody enforces is a comment, and
-- every consumer downstream trusts the declared type.
--
-- Depends on 0001 and 0031. Idempotent & prod-safe.
-- ============================================================================

-- ── The object ──────────────────────────────────────────────────────────────
create table if not exists custom_objects (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- URL segment, and the `p_object` value the CRUD functions receive.
  slug         text not null,
  singular     text not null default 'Record',
  plural       text not null default 'Records',
  icon         text not null default 'Table2',
  -- Which nav group it appears under. Free text, so a workspace can invent one.
  group_key    text not null default 'Workspace',
  description  text not null default '',
  position     int  not null default 0,
  enabled      boolean not null default true,
  created_by_privy text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, slug)
);
alter table custom_objects enable row level security;
revoke all on table custom_objects from anon, authenticated;
drop trigger if exists trg_custom_objects_upd on custom_objects;
create trigger trg_custom_objects_upd before update on custom_objects
  for each row execute function set_updated_at();

-- ── The fields ──────────────────────────────────────────────────────────────
create table if not exists custom_fields (
  id           uuid primary key default gen_random_uuid(),
  object_id    uuid not null references custom_objects(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  key          text not null,
  label        text not null default '',
  -- Deliberately small. Every type here has a real editor, a real renderer and
  -- real coercion; a type with none of those is a promise the product breaks.
  type         text not null default 'text',
  options      text[] not null default '{}',
  -- For `relation`: which object this points at. A built-in slug or another
  -- custom one — both resolve through the same CRUD functions.
  relation_to  text,
  required     boolean not null default false,
  -- The headline column: what the row is called. Exactly one per object.
  is_primary   boolean not null default false,
  position     int not null default 0,
  created_at   timestamptz not null default now(),
  unique (object_id, key)
);
alter table custom_fields enable row level security;
revoke all on table custom_fields from anon, authenticated;
create index if not exists idx_custom_fields_obj on custom_fields(object_id, position);

do $$ begin
  alter table custom_fields add constraint custom_fields_type_check
    check (type in ('text','long_text','number','currency','date','checkbox',
                    'select','email','url','phone','relation'));
exception when duplicate_object then null; end $$;

-- ── The rows ────────────────────────────────────────────────────────────────
create table if not exists custom_records (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  object_id    uuid not null references custom_objects(id) on delete cascade,
  data         jsonb not null default '{}'::jsonb,
  created_by_privy text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table custom_records enable row level security;
revoke all on table custom_records from anon, authenticated;
create index if not exists idx_custom_records_obj on custom_records(object_id, created_at desc);
-- Filtering and searching inside `data` without a table scan.
create index if not exists idx_custom_records_data on custom_records using gin (data);
drop trigger if exists trg_custom_records_upd on custom_records;
create trigger trg_custom_records_upd before update on custom_records
  for each row execute function set_updated_at();

-- ── Guards ──────────────────────────────────────────────────────────────────
/**
 * Slugs the CRUD monolith already answers to.
 *
 * A custom object named `people` could never win — the built-in branch matches
 * first — so it would silently do nothing, which is worse than being refused.
 * Refusing at creation makes the collision impossible instead of merely lost.
 */
create or replace function reserved_object_slug(p_slug text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_slug, '')) in (
    'people','companies','organizations','invoices','offers','expenses','transactions',
    'products','campaigns','projects','issues','assets','candidates','positions',
    'documents','docs','files','posts','newsletters','forms','sites','agents','skills'
  );
$$;

/**
 * Coerce one value to its field's type, or raise.
 *
 * Fails CLOSED. A number that is not a number and a select option outside the
 * list are refused rather than stored as text — the CSV feed, Excel sync and
 * any agent reading a "number" all trust the declared type, so a field
 * definition nobody enforces would break all three quietly.
 *
 * Null and empty pass through as JSON null unless the field is required, so
 * clearing a value is always possible.
 */
create or replace function coerce_custom_value(p_field custom_fields, p_value jsonb)
returns jsonb language plpgsql immutable as $$
declare v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    if p_field.required then raise exception 'REQUIRED_FIELD: %', p_field.key; end if;
    return 'null'::jsonb;
  end if;

  -- Everything arrives as a JSON scalar; normalise to text once, then branch.
  v_text := btrim(case when jsonb_typeof(p_value) = 'string' then p_value #>> '{}' else p_value::text end);

  if v_text = '' then
    if p_field.required then raise exception 'REQUIRED_FIELD: %', p_field.key; end if;
    return 'null'::jsonb;
  end if;

  case p_field.type
    when 'number', 'currency' then
      if v_text !~ '^-?[0-9]+(\.[0-9]+)?$' then
        raise exception 'NOT_A_NUMBER: % (%)', p_field.key, v_text;
      end if;
      return to_jsonb(v_text::numeric);

    when 'checkbox' then
      return to_jsonb(lower(v_text) in ('true','t','yes','y','1'));

    when 'date' then
      -- An ISO date string, not a timestamp: these are calendar days (a due
      -- date, an MOT expiry), and giving them a timezone invents an hour that
      -- shifts the day for half the world.
      begin
        return to_jsonb(to_char(v_text::date, 'YYYY-MM-DD'));
      exception when others then raise exception 'NOT_A_DATE: % (%)', p_field.key, v_text;
      end;

    when 'select' then
      if cardinality(p_field.options) > 0 and not (v_text = any(p_field.options)) then
        raise exception 'BAD_OPTION: % (%)', p_field.key, v_text;
      end if;
      return to_jsonb(v_text);

    when 'relation' then
      if v_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        raise exception 'NOT_A_RECORD_ID: %', p_field.key;
      end if;
      return to_jsonb(v_text);

    when 'email' then
      if v_text !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
        raise exception 'NOT_AN_EMAIL: %', p_field.key;
      end if;
      return to_jsonb(lower(v_text));

    when 'url' then
      -- http/https only. A `javascript:` value stored here is rendered as a
      -- link somewhere eventually, and that is an XSS with a long fuse.
      if v_text !~* '^https?://' then raise exception 'NOT_A_URL: %', p_field.key; end if;
      return to_jsonb(left(v_text, 2000));

    else
      return to_jsonb(left(v_text, case when p_field.type = 'long_text' then 20000 else 1000 end));
  end case;
end $$;

/**
 * Build a validated `data` object from a client payload.
 *
 * Only DECLARED fields survive. An undeclared key is dropped rather than
 * stored: otherwise the row's shape drifts away from the field list, and every
 * reader — the table, the CSV feed, an agent — is looking at a schema that no
 * longer describes the data.
 */
create or replace function build_custom_data(p_object uuid, p_data jsonb, p_existing jsonb default null)
returns jsonb language plpgsql as $$
declare f custom_fields; v_out jsonb := coalesce(p_existing, '{}'::jsonb);
begin
  for f in select * from custom_fields where object_id = p_object order by position loop
    -- An absent key means "leave it alone" on update, and "empty" on insert
    -- (p_existing is null there). Present-but-null means "clear it".
    if p_data ? f.key then
      v_out := jsonb_set(v_out, array[f.key], coerce_custom_value(f, p_data -> f.key));
    elsif p_existing is null and f.required then
      raise exception 'REQUIRED_FIELD: %', f.key;
    end if;
  end loop;
  return v_out;
end $$;

/** The row's headline, for lists and anything else that shows a name. */
create or replace function custom_record_label(p_object uuid, p_data jsonb)
returns text language sql stable as $$
  select coalesce(
    nullif(p_data ->> (select key from custom_fields
                        where object_id = p_object and is_primary order by position limit 1), ''),
    nullif(p_data ->> (select key from custom_fields
                        where object_id = p_object order by position limit 1), ''),
    'Untitled');
$$;

-- ── Object + field management (browser-reachable) ───────────────────────────
create or replace function get_custom_objects(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', o.id, 'slug', o.slug, 'singular', o.singular, 'plural', o.plural,
    'icon', o.icon, 'group_key', o.group_key, 'description', o.description,
    'position', o.position, 'enabled', o.enabled,
    'record_count', (select count(*) from custom_records r where r.object_id = o.id),
    'fields', coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id, 'key', f.key, 'label', f.label, 'type', f.type, 'options', f.options,
      'relation_to', f.relation_to, 'required', f.required, 'is_primary', f.is_primary,
      'position', f.position
    ) order by f.position) from custom_fields f where f.object_id = o.id), '[]'::jsonb)
  ) order by o.position, o.plural) from custom_objects o where o.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_custom_objects(text, uuid) to authenticated, anon;

create or replace function save_custom_object(
  p_privy text, p_workspace uuid, p_id uuid, p_slug text, p_singular text, p_plural text,
  p_icon text default 'Table2', p_group text default 'Workspace', p_description text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_slug text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Defining an object is a schema change, so it is an owner/admin act — the
  -- same bar delete_record already sets for destroying one row.
  if workspace_role(p_privy, p_workspace) not in ('owner','admin') then
    raise exception 'FORBIDDEN: only an owner or admin can change objects';
  end if;

  v_slug := lower(btrim(coalesce(p_slug, '')));
  if v_slug !~ '^[a-z][a-z0-9_]{1,30}$' then
    raise exception 'BAD_SLUG: use lowercase letters, numbers and underscores';
  end if;
  if reserved_object_slug(v_slug) then raise exception 'RESERVED_SLUG: % is a built-in object', v_slug; end if;

  if p_id is null then
    insert into custom_objects (workspace_id, slug, singular, plural, icon, group_key, description,
                                position, created_by_privy)
    values (p_workspace, v_slug,
            coalesce(nullif(btrim(p_singular), ''), 'Record'),
            coalesce(nullif(btrim(p_plural), ''), 'Records'),
            coalesce(nullif(p_icon, ''), 'Table2'),
            coalesce(nullif(btrim(p_group), ''), 'Workspace'),
            coalesce(p_description, ''),
            (select coalesce(max(position), 0) + 1 from custom_objects where workspace_id = p_workspace),
            p_privy)
    returning id into v_id;
  else
    update custom_objects
       set slug = v_slug,
           singular = coalesce(nullif(btrim(p_singular), ''), singular),
           plural = coalesce(nullif(btrim(p_plural), ''), plural),
           icon = coalesce(nullif(p_icon, ''), icon),
           group_key = coalesce(nullif(btrim(p_group), ''), group_key),
           description = coalesce(p_description, description)
     where id = p_id and workspace_id = p_workspace
    returning id into v_id;
    if v_id is null then raise exception 'NO_SUCH_OBJECT'; end if;
  end if;
  return v_id;
end $$;
grant execute on function save_custom_object(text, uuid, uuid, text, text, text, text, text, text) to authenticated, anon;

create or replace function save_custom_field(
  p_privy text, p_workspace uuid, p_object uuid, p_id uuid,
  p_key text, p_label text, p_type text,
  p_options text[] default '{}', p_relation_to text default null,
  p_required boolean default false, p_primary boolean default false, p_position int default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if workspace_role(p_privy, p_workspace) not in ('owner','admin') then
    raise exception 'FORBIDDEN: only an owner or admin can change fields';
  end if;
  if not exists (select 1 from custom_objects where id = p_object and workspace_id = p_workspace) then
    raise exception 'NO_SUCH_OBJECT';
  end if;

  v_key := lower(btrim(coalesce(p_key, '')));
  if v_key !~ '^[a-z][a-z0-9_]{0,30}$' then
    raise exception 'BAD_FIELD_KEY: use lowercase letters, numbers and underscores';
  end if;
  -- `id` is the row's own column, not a field. Declaring one would shadow the
  -- record id in every payload the CRUD functions return.
  if v_key in ('id', 'created_at', 'updated_at') then raise exception 'RESERVED_FIELD_KEY: %', v_key; end if;
  if p_type not in ('text','long_text','number','currency','date','checkbox',
                    'select','email','url','phone','relation') then
    raise exception 'BAD_FIELD_TYPE: %', p_type;
  end if;

  if p_id is null then
    insert into custom_fields (object_id, workspace_id, key, label, type, options, relation_to,
                               required, is_primary, position)
    values (p_object, p_workspace, v_key,
            coalesce(nullif(btrim(p_label), ''), initcap(replace(v_key, '_', ' '))),
            p_type, coalesce(p_options, '{}'), nullif(p_relation_to, ''),
            coalesce(p_required, false), coalesce(p_primary, false),
            coalesce(p_position, (select coalesce(max(position), 0) + 1 from custom_fields where object_id = p_object)))
    returning id into v_id;
  else
    update custom_fields
       set key = v_key,
           label = coalesce(nullif(btrim(p_label), ''), label),
           type = p_type, options = coalesce(p_options, options),
           relation_to = nullif(p_relation_to, ''),
           required = coalesce(p_required, required),
           is_primary = coalesce(p_primary, is_primary),
           position = coalesce(p_position, position)
     where id = p_id and object_id = p_object
    returning id into v_id;
    if v_id is null then raise exception 'NO_SUCH_FIELD'; end if;
  end if;

  -- Exactly one primary, enforced by demoting the others rather than by a
  -- constraint — so setting a new primary is one call and never a failed one.
  if coalesce(p_primary, false) then
    update custom_fields set is_primary = false where object_id = p_object and id <> v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_custom_field(text, uuid, uuid, uuid, text, text, text, text[], text, boolean, boolean, int) to authenticated, anon;

create or replace function delete_custom_field(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if workspace_role(p_privy, p_workspace) not in ('owner','admin') then
    raise exception 'FORBIDDEN: only an owner or admin can change fields';
  end if;
  delete from custom_fields where id = p_id and workspace_id = p_workspace;
  -- The VALUES stay in `data`. Dropping a field changes the shape, and quietly
  -- deleting the contents of a column across every row is not a click-sized
  -- act — re-adding the field brings the data back.
  return found;
end $$;
grant execute on function delete_custom_field(text, uuid, uuid) to authenticated, anon;

create or replace function delete_custom_object(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if workspace_role(p_privy, p_workspace) not in ('owner','admin') then
    raise exception 'FORBIDDEN: only an owner or admin can delete an object';
  end if;
  -- Cascades to its fields AND its rows. That is a real deletion of real data,
  -- which is why it is admin-only and why the UI asks for the name back.
  delete from custom_objects where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function delete_custom_object(text, uuid, uuid) to authenticated, anon;

-- ── The CRUD monolith, extended ─────────────────────────────────────────────
-- Reproduced IN FULL from 0031 — the convention is to extend the latest
-- definition, never to add a parallel one — with exactly one branch added to
-- each, at the END so no built-in can be shadowed.

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
      r.data || jsonb_build_object('id', r.id, 'name', custom_record_label(v_obj, r.data))
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
  return (select r.data || jsonb_build_object('id', r.id,
                   'name', custom_record_label(r.object_id, r.data))
            from custom_records r
            join custom_objects o on o.id = r.object_id
           where r.id = p_id and o.slug = p_object and r.workspace_id = any(my));
end $$;
grant execute on function get_record(text, text, uuid) to authenticated, anon;

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

create or replace function update_record(p_privy text, p_object text, p_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_obj uuid; v_existing jsonb; my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
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
    -- ── Custom objects (0087) ────────────────────────────────────────────────
    select r.id, r.object_id, r.data into v_id, v_obj, v_existing
      from custom_records r join custom_objects o on o.id = r.object_id
     where r.id = p_id and o.slug = p_object and r.workspace_id = any(my);
    if v_id is null then raise exception 'UNKNOWN_OBJECT: %', p_object; end if;
    -- Merged onto the EXISTING data, so an absent key means "leave it alone"
    -- and a partial save never blanks the fields it does not mention — the
    -- same rule save_workspace_branding follows.
    update custom_records set data = build_custom_data(v_obj, coalesce(p_data, '{}'::jsonb), v_existing)
     where id = v_id;
  end if;
end $$;
grant execute on function update_record(text, text, uuid, jsonb) to authenticated, anon;

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
  -- ── Custom objects (0087) ────────────────────────────────────────────────
  -- Same admin bar and the same membership check as a built-in, just against
  -- custom_records instead of a named table.
  if tbl is null then
    select r.workspace_id into v_ws
      from custom_records r join custom_objects o on o.id = r.object_id
     where r.id = p_id and o.slug = p_object;
    if v_ws is null then return; end if;
    if not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
    if workspace_role(p_privy, v_ws) not in ('owner', 'admin') then
      raise exception 'FORBIDDEN: delete requires admin';
    end if;
    delete from custom_records where id = p_id and workspace_id = v_ws;
    return;
  end if;
  execute format('select workspace_id from %I where id = $1', tbl) into v_ws using p_id;
  if v_ws is null then return; end if;
  if not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if workspace_role(p_privy, v_ws) not in ('owner', 'admin') then raise exception 'FORBIDDEN: delete requires admin'; end if;
  execute format('delete from %I where id = $1 and workspace_id = $2', tbl) using p_id, v_ws;
end $$;
grant execute on function delete_record(text, text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
