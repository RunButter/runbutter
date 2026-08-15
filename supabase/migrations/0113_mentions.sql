-- ============================================================================
-- RunButter — 0113_mentions.sql
--
-- @-mention any record, anywhere. Type @acme in a chat message, a doc or a note
-- on a record and it becomes a live link to that company.
--
-- This is the "one relational core" claim made VISIBLE. The objects have been in
-- one database since 0001 and nothing in the product ever crossed from prose
-- into them: you could write "chase Acme about INV-204" and neither word meant
-- anything. Every competitor selling an all-in-one workspace leads with this,
-- and they have to build the links; here the links already exist and only the
-- text was missing.
--
-- ── THE ID IS STORED, THE LABEL IS RESOLVED ─────────────────────────────────
-- The body holds `rb-ref:<object>:<uuid>`, exactly the shape lib/files/embeds.ts
-- already uses for `rb-file:<uuid>`, and for the same reason: a rendered label
-- goes stale the moment somebody renames the company, and a message from March
-- would keep naming a client who changed their name in April. The text survives
-- markdown round-tripping, exports and agent transcripts; the label is looked up
-- per render.
--
-- ── TWO WHITELIST CASE STATEMENTS, NEVER DYNAMIC SQL ────────────────────────
-- Both functions below switch on a fixed set of object names. That is the same
-- decision `segment_match` and `custom_relation_label` make, and the reason is
-- identical: a SECURITY DEFINER function building EXECUTE from a caller-supplied
-- table name is one escaping mistake from arbitrary reads across every tenant.
-- An unknown object returns nothing rather than being interpolated.
--
-- Custom objects ARE included, through custom_records, because an object a
-- workspace defined for itself is exactly as mentionable as a built-in — and
-- because "if it works for companies and not for job_sites, that is a bug".
-- ============================================================================

/**
 * Labels for a batch of refs. Takes `[{object, id}, …]`, returns the same with
 * `label` filled in — batched because a doc with twenty mentions must not be
 * twenty round trips.
 *
 * Tenancy comes from p_privy in SQL: every branch is constrained to workspaces
 * the caller belongs to, so a crafted uuid from another tenant resolves to
 * nothing rather than leaking a company name. A name IS data — it is how you
 * learn who somebody's clients are.
 */
create or replace function resolve_record_labels(p_privy text, p_refs jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare my uuid[]; r jsonb; out_j jsonb := '[]'::jsonb; v_label text; v_obj text; v_id uuid;
begin
  select coalesce(array_agg(workspace_id), '{}') into my from accounts where privy_user_id = p_privy;
  if array_length(my, 1) is null then return '[]'::jsonb; end if;

  for r in select * from jsonb_array_elements(coalesce(p_refs, '[]'::jsonb)) loop
    v_obj := lower(coalesce(r->>'object', ''));
    begin v_id := (r->>'id')::uuid; exception when others then continue; end;
    v_label := null;

    case v_obj
      when 'companies' then
        select name into v_label from organizations where id = v_id and workspace_id = any(my);
      when 'people' then
        select trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) into v_label
          from people where id = v_id and workspace_id = any(my);
      when 'invoices' then
        select coalesce(nullif(number,''), 'Invoice') into v_label
          from invoices where id = v_id and workspace_id = any(my);
      when 'projects' then
        select name into v_label from projects where id = v_id and workspace_id = any(my);
      when 'issues' then
        select title into v_label from issues where id = v_id and workspace_id = any(my);
      when 'products' then
        select name into v_label from products where id = v_id and workspace_id = any(my);
      when 'docs' then
        select title into v_label from docs where id = v_id and workspace_id = any(my);
      else
        -- A workspace's own object (0087). custom_record_label already knows how
        -- to title one, so this needs no second vocabulary.
        select custom_record_label(cr.object_id, cr.data) into v_label
          from custom_records cr
          join custom_objects co on co.id = cr.object_id
         where cr.id = v_id and cr.workspace_id = any(my) and co.slug = v_obj;
    end case;

    -- A ref that resolves to nothing is RETURNED with a null label rather than
    -- dropped, so the reader can fall back to plain text instead of silently
    -- losing a word out of somebody's sentence.
    out_j := out_j || jsonb_build_array(jsonb_build_object(
      'object', v_obj, 'id', v_id, 'label', nullif(trim(coalesce(v_label, '')), '')
    ));
  end loop;

  return out_j;
end $$;

/**
 * What the @ picker searches. A few objects, by the thing a person would type.
 *
 * Deliberately NOT every object: a picker listing transactions and expenses by
 * amount is noise, and the ones here are the nouns that appear in sentences.
 * Capped hard — an autocomplete is a shortlist, not a report.
 */
create or replace function search_mentionable(p_privy text, p_workspace uuid, p_query text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || lower(trim(coalesce(p_query, ''))) || '%';
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if length(trim(coalesce(p_query, ''))) < 1 then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(x order by x->>'label')
    from (
      (select jsonb_build_object('object','companies','id',id,'label',name,'kind','Company') as x
         from organizations where workspace_id = p_workspace and lower(name) like q limit 5)
      union all
      (select jsonb_build_object('object','people','id',id,
              'label', trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), 'kind','Person')
         from people where workspace_id = p_workspace
          and lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) like q limit 5)
      union all
      (select jsonb_build_object('object','invoices','id',id,'label',coalesce(nullif(number,''),'Invoice'),'kind','Invoice')
         from invoices where workspace_id = p_workspace and lower(coalesce(number,'')) like q limit 5)
      union all
      (select jsonb_build_object('object','projects','id',id,'label',name,'kind','Project') as x
         from projects where workspace_id = p_workspace and lower(name) like q limit 5)
      union all
      (select jsonb_build_object('object','docs','id',id,'label',title,'kind','Doc') as x
         from docs where workspace_id = p_workspace and lower(coalesce(title,'')) like q limit 5)
    ) s
  ), '[]'::jsonb);
end $$;

revoke all on function resolve_record_labels(text, jsonb)          from public, anon, authenticated;
revoke all on function search_mentionable(text, uuid, text)        from public, anon, authenticated;
grant execute on function resolve_record_labels(text, jsonb)       to service_role;
grant execute on function search_mentionable(text, uuid, text)     to service_role;

notify pgrst, 'reload schema';
