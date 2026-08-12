-- ============================================================================
-- RunButter — 0097_editable_objects.sql
-- The built-in objects become yours: rename them, hide them, move them,
-- rename and reorder their columns, and add your own fields to them.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- 0087 made a workspace able to define its OWN objects, and that was the half
-- of the problem nobody had solved. The other half stayed frozen: eleven
-- built-in objects with names we chose, columns we chose, and no way to add a
-- field to any of them. A recruitment agency calls Companies "Clients". A
-- clinic does not want Campaigns in the sidebar at all. A haulier needs one
-- extra field on Companies — a depot code — and the only route was to abandon
-- Companies and rebuild it as a custom object, losing sanctions screening,
-- invoicing, the careers page and every relation pointing at it.
--
-- So a built-in gets the two things a custom object already had: a per-
-- workspace presentation, and fields.
--
-- ── TWO SEPARATE THINGS, DELIBERATELY ───────────────────────────────────────
-- `object_overrides` is PRESENTATION. Name, icon, nav section, hidden, column
-- order and column labels. It never changes what is stored, so it is safe to
-- reset — and resetting is a delete, which is why it is one row per object
-- rather than a column on eleven tables.
--
-- `custom_fields.builtin_slug` is DATA. It reuses the 0087 field table
-- verbatim: the same eleven types, the same coercion, the same fail-closed
-- rules. A second field vocabulary for built-ins would have drifted from the
-- first inside a month, and the CSV feed and the agents would then have to
-- know which kind of field they were looking at.
--
-- ── VALUES GO IN THE COLUMN THAT WAS ALWAYS THERE ───────────────────────────
-- `custom_fields jsonb` has been on people, organizations, invoices, expenses,
-- assets and pipeline_records since 0001 — declared, indexed by nothing, read
-- by nothing, written by nothing. `object_fields` was created in the same
-- migration to describe them and never got an RPC either. This is that idea
-- finally connected, minus `object_fields`, which only ever covered four object
-- types and used a different type vocabulary from the one 0087 settled on.
-- The five tables that lacked the column get it here.
--
-- ── THE MONOLITH IS EXTENDED, NOT FORKED ────────────────────────────────────
-- list/get/create/update_record are redefined IN FULL, per the convention, and
-- each gains exactly one call: a merge on the way out, a write on the way in.
-- That is what makes an extra field on Companies real everywhere at once — the
-- table, the form, the CSV feed, Excel sync, /api/mcp and every agent tool read
-- those same five functions. A field only the browser could see would be the
-- third time this product learned that lesson.
--
-- Depends on 0001, 0087, 0088, 0089, 0091. Idempotent & prod-safe.
-- ============================================================================

-- ── The column that holds the values ────────────────────────────────────────
-- Six tables had it from 0001; these five did not. Same name, same default, so
-- there is one shape to reason about rather than "which tables support this".
alter table transactions add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table products     add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table campaigns    add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table projects     add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table issues       add column if not exists custom_fields jsonb not null default '{}'::jsonb;

-- ── Fields on a built-in ────────────────────────────────────────────────────
-- `custom_fields` gains an alternative owner. A row belongs to EITHER a custom
-- object or a built-in slug, never both and never neither — the check is what
-- stops a field existing in no object at all, which would be invisible in every
-- screen and still returned by every query that forgets the filter.
alter table custom_fields alter column object_id drop not null;
alter table custom_fields add column if not exists builtin_slug text;

do $$ begin
  alter table custom_fields add constraint custom_fields_owner_check
    check (num_nonnulls(object_id, builtin_slug) = 1);
exception when duplicate_object then null; end $$;

-- `unique (object_id, key)` from 0087 stops enforcing anything once object_id
-- is null (two nulls never conflict in Postgres), so the built-in half needs
-- its own. Partial, so it costs nothing for custom objects.
create unique index if not exists uq_custom_fields_builtin
  on custom_fields (workspace_id, builtin_slug, key) where builtin_slug is not null;
create index if not exists idx_custom_fields_builtin
  on custom_fields (workspace_id, builtin_slug, position) where builtin_slug is not null;

-- ── Presentation ────────────────────────────────────────────────────────────
create table if not exists object_overrides (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- A BUILT-IN slug. Custom objects carry their own name and icon on
  -- custom_objects, so a row here for one would be a second source of truth.
  slug         text not null,
  -- NULL means "keep what ships". Not '' — an empty string is a name somebody
  -- chose, and a workspace that clears the field wants the default back, not a
  -- blank sidebar entry.
  singular     text,
  plural       text,
  icon         text,
  group_key    text,
  hidden       boolean not null default false,
  /**
   * Column presentation: [{ "key": "domain", "label": "Website", "hidden": true }]
   *
   * ORDER IS THE ARRAY ORDER, and keys not listed keep their shipped position
   * after the ones that are. That rule is what makes this survive a release:
   * when we add a column to Companies next year, a workspace that reordered
   * three columns gets the new one appended instead of losing it.
   */
  columns      jsonb not null default '[]'::jsonb,
  position     int,
  updated_at   timestamptz not null default now(),
  unique (workspace_id, slug)
);
alter table object_overrides enable row level security;
revoke all on table object_overrides from anon, authenticated;
drop trigger if exists trg_object_overrides_upd on object_overrides;
create trigger trg_object_overrides_upd before update on object_overrides
  for each row execute function set_updated_at();

-- ── Which built-ins can carry fields, and where the values live ─────────────
/**
 * Canonical slug for a built-in object.
 *
 * `companies` and `organizations` are one table under two names, and so are
 * `invoices` and `offers` (an offer is an invoice with kind='offer'). Field
 * definitions are stored under the canonical name so the same physical column
 * cannot end up with two different declarations of the same key — which would
 * make one of them silently unreadable.
 */
create or replace function builtin_object_slug(p_object text)
returns text language sql immutable as $$
  select case lower(coalesce(p_object, ''))
    when 'organizations' then 'companies'
    when 'offers'        then 'invoices'
    else lower(coalesce(p_object, ''))
  end;
$$;

/**
 * Canonical slug for a SCREEN, which is not the same question.
 *
 * `organizations` is a pure alias of `companies` — one nav entry, one page —
 * so the two must share a name and an icon. `offers` is not: it is its own
 * screen with its own nav entry, and a workspace renaming Offers to "Quotes"
 * must not rename Invoices too. Fields are the opposite case, because both
 * screens write the same physical column, which is why the two functions exist
 * and why `builtin_object_slug` above is the one used for fields.
 */
create or replace function builtin_view_slug(p_object text)
returns text language sql immutable as $$
  select case lower(coalesce(p_object, ''))
    when 'organizations' then 'companies'
    else lower(coalesce(p_object, ''))
  end;
$$;

/**
 * Built-in slug → the table its rows live in, or NULL if it is not a built-in.
 *
 * A WHITELIST CASE returning a constant, exactly like `delete_record`'s table
 * map (0087) and `custom_relation_label` (0089). The identifier that reaches
 * `format('%I')` below can only ever be one of these eleven literals, which is
 * the whole reason dynamic SQL is acceptable here and is not acceptable
 * anywhere a user string could reach.
 */
create or replace function builtin_extras_table(p_object text)
returns text language sql immutable as $$
  select case builtin_object_slug(p_object)
    when 'companies'    then 'organizations'
    when 'people'       then 'people'
    when 'invoices'     then 'invoices'
    when 'expenses'     then 'expenses'
    when 'transactions' then 'transactions'
    when 'products'     then 'products'
    when 'campaigns'    then 'campaigns'
    when 'projects'     then 'projects'
    when 'issues'       then 'issues'
    when 'assets'       then 'assets'
  end;
$$;

/** Has this workspace actually added anything to this object? */
create or replace function builtin_has_extras(p_workspace uuid, p_object text)
returns boolean language sql stable as $$
  select exists (select 1 from custom_fields
                  where workspace_id = p_workspace
                    and builtin_slug = builtin_object_slug(p_object));
$$;

/**
 * Validate a payload against the fields defined on a built-in object.
 *
 * The built-in twin of `build_custom_data` (0087), and it borrows that
 * function's two rules wholesale because they are the reason a declared type
 * can be trusted downstream: a value that does not match its type is REJECTED
 * rather than stored as text, and a key nobody declared is DROPPED so a payload
 * cannot widen the row.
 *
 * The difference is `p_partial`. Creating a record considers every declared
 * field (so `required` is enforced); updating considers only the keys present,
 * because `update_record` has meant "absent = leave alone" since 0088 and an
 * agent setting one field must not be asked for the other six.
 */
create or replace function builtin_extras_data(p_workspace uuid, p_object text, p_data jsonb, p_partial boolean)
returns jsonb language plpgsql stable as $$
declare f custom_fields; out jsonb := '{}'::jsonb;
begin
  for f in select * from custom_fields
            where workspace_id = p_workspace
              and builtin_slug = builtin_object_slug(p_object)
            order by position, key
  loop
    if p_partial and not (coalesce(p_data, '{}'::jsonb) ? f.key) then continue; end if;
    out := out || jsonb_build_object(f.key, coerce_custom_value(f, coalesce(p_data, '{}'::jsonb) -> f.key));
  end loop;
  return out;
end $$;

/**
 * Write the extras for one row.
 *
 * Merged into whatever is already there, never replacing it, so a partial
 * update leaves the fields it did not mention alone — the same contract the
 * named columns have had since 0088. Deleting a field definition therefore
 * leaves its values in place exactly as it does for a custom object, and
 * re-adding the field brings them back.
 *
 * Silent no-op when the object carries no extra fields, which is every
 * workspace on the day this runs.
 */
create or replace function builtin_extras_write(p_workspace uuid, p_object text, p_id uuid, p_data jsonb, p_partial boolean)
returns void language plpgsql security definer set search_path = public as $$
declare tbl text := builtin_extras_table(p_object); v_new jsonb;
begin
  if tbl is null or p_id is null then return; end if;
  if not builtin_has_extras(p_workspace, p_object) then return; end if;
  v_new := builtin_extras_data(p_workspace, p_object, p_data, p_partial);
  if v_new = '{}'::jsonb then return; end if;
  execute format(
    'update %I set custom_fields = coalesce(custom_fields, ''{}''::jsonb) || $1 where id = $2 and workspace_id = $3', tbl)
    using v_new, p_id, p_workspace;
end $$;

/**
 * The same write, for a caller that has no workspace argument.
 *
 * `update_record` derives tenancy from `p_privy` in SQL rather than taking a
 * `p_workspace` — the asymmetry CLAUDE.md warns against "fixing" — so the
 * workspace has to come from the ROW, and then be checked against the caller's.
 * Reading the workspace off the row and trusting it would let any authenticated
 * user write a field into another tenant's record: the named-column update
 * above would match nothing and the extras write would succeed, which is the
 * quietest possible version of that bug.
 */
create or replace function builtin_extras_write_scoped(p_object text, p_id uuid, p_data jsonb, p_partial boolean, p_my uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare tbl text := builtin_extras_table(p_object); v_ws uuid;
begin
  if tbl is null or p_id is null or p_my is null then return; end if;
  execute format('select workspace_id from %I where id = $1', tbl) into v_ws using p_id;
  if v_ws is null or not (v_ws = any(p_my)) then return; end if;
  perform builtin_extras_write(v_ws, p_object, p_id, p_data, p_partial);
end $$;

/**
 * Merge one row's extras into the json a built-in branch just built.
 *
 * Under the named columns, not over them: a workspace cannot add a field called
 * `amount` and have it shadow the real amount in the CSV feed. `save_custom_field`
 * refuses those keys anyway (see `builtin_reserved_field_key`), and this is the
 * belt to that pair of braces.
 */
create or replace function builtin_extras_add(p_object text, p_id uuid, p_row jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tbl text := builtin_extras_table(p_object); v_extra jsonb; v_ws uuid;
begin
  if p_row is null or tbl is null then return p_row; end if;
  execute format('select workspace_id, custom_fields from %I where id = $1', tbl) into v_ws, v_extra using p_id;
  if v_ws is null or v_extra is null or v_extra = '{}'::jsonb then return p_row; end if;
  if not builtin_has_extras(v_ws, p_object) then return p_row; end if;
  return v_extra || p_row;
end $$;

/**
 * The same, for a whole list, in one query rather than one per row.
 *
 * Returns the array untouched when the workspace has defined nothing — which
 * keeps the cost of this feature at one cheap EXISTS for everybody who is not
 * using it.
 */
create or replace function builtin_extras_addmany(p_workspace uuid, p_object text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tbl text := builtin_extras_table(p_object); v_map jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then return p_rows; end if;
  if tbl is null or not builtin_has_extras(p_workspace, p_object) then return p_rows; end if;

  execute format(
    'select coalesce(jsonb_object_agg(id::text, custom_fields), ''{}''::jsonb)
       from %I where workspace_id = $1 and custom_fields <> ''{}''::jsonb', tbl)
    into v_map using p_workspace;
  if v_map = '{}'::jsonb then return p_rows; end if;

  return (select coalesce(jsonb_agg(
            coalesce(v_map -> (r ->> 'id'), '{}'::jsonb) || r
            order by ord), '[]'::jsonb)
          from jsonb_array_elements(p_rows) with ordinality as t(r, ord));
end $$;

/**
 * Keys a workspace may not claim on a built-in.
 *
 * A field whose key collides with a real column would be written into the jsonb
 * and then shadowed by the column on the way out — stored, never shown, and
 * impossible to explain. Refusing the key at definition time makes that
 * impossible rather than merely confusing, the same reasoning as
 * `reserved_object_slug`.
 *
 * The list is every key any built-in branch emits, in one set rather than per
 * object: a workspace does not think in terms of which of eleven functions
 * mentions `status`, and a single conservative list costs a few names nobody
 * wanted.
 */
create or replace function builtin_reserved_field_key(p_key text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_key, '')) in (
    'id','created_at','updated_at','workspace_id','custom_fields','name','title',
    'first_name','last_name','email','phone','company','domain','industry',
    'employee_count','tax_id','address','country','source','synergy',
    'number','organization_id','kind','direction','amount','currency','status',
    'category','issued_at','due_at','due_date','notes','vendor','spent_at',
    'txn_date','description','method','tax_rate','bank_account_id','account',
    'matched_invoice_id','matched_expense_id','sku','unit_price','unit','image',
    'image_url','channel','budget','spend','leads','starts_on','ends_on',
    'identifier','issues','project','priority','assignee','serial_number',
    'assigned_to','assigned_to_person_id','purchased_at'
  );
$$;

-- ── Managing it ─────────────────────────────────────────────────────────────
/**
 * Add or change a field on a BUILT-IN object.
 *
 * A sibling of `save_custom_field` rather than a parameter on it: adding one
 * would create an overload (the trap this project has hit four times), and the
 * two differ in what they refuse. There is no `p_primary` here — a built-in
 * already has a headline column in its own table, and letting a workspace point
 * it at a jsonb key would break every join that resolves a record to a name.
 *
 * Both write the same table, with the same types and the same coercion, so
 * there is one field vocabulary and not two.
 */
create or replace function save_builtin_field(
  p_privy text, p_workspace uuid, p_slug text, p_id uuid,
  p_key text, p_label text, p_type text,
  p_options text[] default '{}', p_relation_to text default null,
  p_required boolean default false, p_position int default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text; v_slug text := builtin_object_slug(p_slug);
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if workspace_role(p_privy, p_workspace) not in ('owner','admin') then
    raise exception 'FORBIDDEN: only an owner or admin can change fields';
  end if;
  -- Only objects whose rows have somewhere to put the value. Refusing here
  -- rather than at write time is what stops a field being defined, shown in the
  -- form, filled in by somebody, and dropped on save.
  if builtin_extras_table(v_slug) is null then raise exception 'UNKNOWN_OBJECT: %', p_slug; end if;

  v_key := lower(btrim(coalesce(p_key, '')));
  if v_key !~ '^[a-z][a-z0-9_]{0,30}$' then
    raise exception 'BAD_FIELD_KEY: use lowercase letters, numbers and underscores';
  end if;
  if builtin_reserved_field_key(v_key) then raise exception 'RESERVED_FIELD_KEY: %', v_key; end if;
  if p_type not in ('text','long_text','number','currency','date','checkbox',
                    'select','email','url','phone','relation') then
    raise exception 'BAD_FIELD_TYPE: %', p_type;
  end if;

  if p_id is null then
    insert into custom_fields (builtin_slug, workspace_id, key, label, type, options, relation_to,
                               required, is_primary, position)
    values (v_slug, p_workspace, v_key,
            coalesce(nullif(btrim(p_label), ''), initcap(replace(v_key, '_', ' '))),
            p_type, coalesce(p_options, '{}'), nullif(p_relation_to, ''),
            coalesce(p_required, false), false,
            coalesce(p_position, (select coalesce(max(position), 0) + 1 from custom_fields
                                   where workspace_id = p_workspace and builtin_slug = v_slug)))
    returning id into v_id;
  else
    update custom_fields
       set key = v_key,
           label = coalesce(nullif(btrim(p_label), ''), label),
           type = p_type, options = coalesce(p_options, options),
           relation_to = nullif(p_relation_to, ''),
           required = coalesce(p_required, required),
           position = coalesce(p_position, position)
     where id = p_id and workspace_id = p_workspace and builtin_slug = v_slug
    returning id into v_id;
    if v_id is null then raise exception 'NO_SUCH_FIELD'; end if;
  end if;
  return v_id;
end $$;
grant execute on function save_builtin_field(text, uuid, text, uuid, text, text, text, text[], text, boolean, int) to authenticated, anon;

/**
 * Rename, re-icon, re-file or hide a built-in object; relabel and reorder its
 * columns.
 *
 * `p_data ? key` throughout, so a screen that saves one thing does not blank
 * the rest — the rule 0088 was written to fix, applied here from the start.
 * Passing an explicit null CLEARS an override and restores what ships, which is
 * why the columns are nullable rather than defaulted.
 */
create or replace function save_object_override(p_privy text, p_workspace uuid, p_slug text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_slug text := builtin_view_slug(p_slug); v_row object_overrides;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if workspace_role(p_privy, p_workspace) not in ('owner','admin') then
    raise exception 'FORBIDDEN: only an owner or admin can change objects';
  end if;
  if builtin_extras_table(v_slug) is null then raise exception 'UNKNOWN_OBJECT: %', p_slug; end if;

  insert into object_overrides (workspace_id, slug) values (p_workspace, v_slug)
  on conflict (workspace_id, slug) do nothing;

  update object_overrides set
    singular  = case when p_data ? 'singular'  then nullif(btrim(p_data->>'singular'), '')  else singular end,
    plural    = case when p_data ? 'plural'    then nullif(btrim(p_data->>'plural'), '')    else plural end,
    icon      = case when p_data ? 'icon'      then nullif(btrim(p_data->>'icon'), '')      else icon end,
    group_key = case when p_data ? 'group_key' then nullif(btrim(p_data->>'group_key'), '') else group_key end,
    hidden    = case when p_data ? 'hidden'    then coalesce((p_data->>'hidden')::boolean, false) else hidden end,
    -- Only an array is accepted. A malformed value here would make the column
    -- list unreadable for the object, and falling back to '[]' means "no
    -- overrides", which is the shipped order — the safe answer.
    columns   = case when p_data ? 'columns'
                     then case when jsonb_typeof(p_data->'columns') = 'array' then p_data->'columns' else '[]'::jsonb end
                     else columns end,
    position  = case when p_data ? 'position'  then nullif(p_data->>'position','')::int      else position end
  where workspace_id = p_workspace and slug = v_slug
  returning * into v_row;

  return to_jsonb(v_row);
end $$;
grant execute on function save_object_override(text, uuid, text, jsonb) to authenticated, anon;

/** Back to what ships. A delete, so there is no half-reset state to explain. */
create or replace function reset_object_override(p_privy text, p_workspace uuid, p_slug text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if workspace_role(p_privy, p_workspace) not in ('owner','admin') then
    raise exception 'FORBIDDEN: only an owner or admin can change objects';
  end if;
  delete from object_overrides
   where workspace_id = p_workspace and slug = builtin_view_slug(p_slug);
  -- The FIELDS are deliberately untouched. "Put the name back" and "throw away
  -- a column of data" are different requests, and only one of them is
  -- recoverable by clicking again.
  return found;
end $$;
grant execute on function reset_object_override(text, uuid, text) to authenticated, anon;

/**
 * Everything Settings → Objects and the nav need, in one round trip.
 *
 * One call rather than two because both are read on every page load that draws
 * the sidebar, and a second request there is a second chance for the nav to
 * flash the shipped names before the workspace's own arrive.
 */
create or replace function get_object_settings(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object(
    'overrides', coalesce((select jsonb_agg(to_jsonb(o) order by o.slug)
                             from object_overrides o where o.workspace_id = p_workspace), '[]'::jsonb),
    'fields', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', f.id, 'object', f.builtin_slug, 'key', f.key, 'label', f.label,
                          'type', f.type, 'options', f.options, 'relation_to', f.relation_to,
                          'required', f.required, 'position', f.position)
                        order by f.builtin_slug, f.position, f.key)
                          from custom_fields f
                         where f.workspace_id = p_workspace and f.builtin_slug is not null), '[]'::jsonb)
  );
end $$;
grant execute on function get_object_settings(text, uuid) to authenticated, anon;


-- ── The five, redefined in full ─────────────────────────────────────────────
-- Mechanically identical to 0088/0089/0091 apart from ONE call each: a merge on
-- the way out, a write on the way in. Both are no-ops until a workspace defines
-- a field, so nothing changes for anybody who never opens this screen.
--
-- delete_record is unchanged and deliberately not repeated here — the extras
-- live in a column of the row it already deletes.

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
      'id', p.id, 'name', p.name, 'image', p.image_url, 'sku', p.sku, 'category', p.category, 'unit_price', p.unit_price, 'unit', p.unit
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
grant execute on function list_records(text, uuid, text) to authenticated, anon;

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
    return builtin_extras_add(p_object, p_id, (select to_jsonb(t) from (select id, name, sku, description, unit_price, unit, category, image_url from products where id=p_id and workspace_id = any(my)) t));
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

grant execute on function create_record(text, uuid, text, jsonb) to authenticated, anon;

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

  -- Fields this workspace added to a built-in object (0097). Partial, matching
  -- the named columns above: a key that is absent leaves its value alone.
  if v_obj is null then
    perform builtin_extras_write(
      (select workspace_id from accounts where privy_user_id = p_privy and workspace_id = any(my) limit 1),
      p_object, p_id, coalesce(p_data, '{}'::jsonb), true);
  end if;
end $$;
grant execute on function update_record(text, text, uuid, jsonb) to authenticated, anon;

notify pgrst, 'reload schema';
