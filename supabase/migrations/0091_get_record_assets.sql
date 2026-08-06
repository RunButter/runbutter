-- 0091 — opening an asset shows the asset.
--
-- The fifth function. 0088 gave `assets` its missing create and update branches
-- after the Add button raised UNKNOWN_OBJECT; `get_record` was the one nobody
-- checked, so clicking an asset row called it, fell through every branch to the
-- custom-object lookup, found no custom object called `assets`, and returned
-- NULL. The list showed the row, the detail panel showed nothing.
--
-- Found by asking the database rather than the code: for every object in the
-- nav registry, does a branch for it exist in ALL FIVE CRUD functions? That
-- check is worth re-running whenever an object is added — it is the third time
-- this exact shape of bug has surfaced.
--
-- Redefined in full, per the convention.

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
    return (select to_jsonb(t) from (select id, name, category, serial_number, status, assigned_to_person_id, purchased_at, notes from assets where id=p_id and workspace_id = any(my)) t);
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
