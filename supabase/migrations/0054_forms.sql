-- ============================================================================
-- RunButter — 0054_forms.sql
-- Custom Forms: a public form builder whose submissions land as CRM People
-- (leads). Generalises the existing public apply flow — same pattern (an anon
-- SECURITY DEFINER RPC writing one row it fully controls), now for arbitrary
-- lead-capture forms rather than only job applications.
--
-- A form's fields are a jsonb array of { key, label, type, required, options?,
-- map? }. `map` names a people column the field feeds (first_name, last_name,
-- email, phone, title, linkedin_url); unmapped answers go into people.custom_fields
-- and the raw submission. Adding a field type later is a UI concern — the schema
-- stores whatever the builder produces.
--
-- Workspace RPCs are SECURITY DEFINER + service_role-only (0046 posture). The
-- two public ones (get_public_form, submit_form) are anon-callable by design,
-- exactly like apply_to_position — they touch only their own rows.
-- Depends on 0001 (people) + 0012 (workspace_role).
-- ============================================================================

create table if not exists forms (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  slug          text not null unique,             -- public id in /f/<slug>
  name          text not null default 'Untitled form',
  title         text not null default 'Get in touch',
  description   text,
  fields        jsonb not null default '[]',
  submit_message text not null default 'Thanks — we''ll be in touch.',
  enabled       boolean not null default true,
  created_by    text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists idx_forms_ws on forms(workspace_id);
alter table forms enable row level security;
revoke all on table forms from anon, authenticated;

create table if not exists form_submissions (
  id           uuid primary key default gen_random_uuid(),
  form_id      uuid not null references forms(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  data         jsonb not null default '{}',
  person_id    uuid,                               -- the lead created from it
  ip           text,
  created_at   timestamptz default now()
);
create index if not exists idx_form_submissions_form on form_submissions(form_id);
alter table form_submissions enable row level security;
revoke all on table form_submissions from anon, authenticated;

-- ── Owner side (workspace-scoped) ───────────────────────────────────────────
create or replace function get_forms(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', f.id, 'slug', f.slug, 'name', f.name, 'title', f.title,
    'enabled', f.enabled, 'fields', f.fields, 'created_at', f.created_at,
    'submissions', (select count(*) from form_submissions s where s.form_id = f.id)
  ) order by f.created_at desc) from forms f where f.workspace_id = p_workspace), '[]'::jsonb);
end $$;

create or replace function get_form(p_privy text, p_workspace uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select jsonb_build_object('id', f.id, 'slug', f.slug, 'name', f.name, 'title', f.title,
           'description', f.description, 'fields', f.fields, 'submit_message', f.submit_message,
           'enabled', f.enabled)
    into v from forms f where f.id = p_id and f.workspace_id = p_workspace;
  return v;
end $$;

create or replace function save_form(
  p_privy text, p_workspace uuid, p_id uuid, p_name text, p_title text,
  p_description text, p_fields jsonb, p_submit_message text, p_enabled boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text; v_id uuid; v_slug text;
begin
  v_role := workspace_role(p_privy, p_workspace);
  if v_role is null or v_role not in ('owner','admin','member','recruiter') then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(p_fields) <> 'array' then raise exception 'INVALID_FIELDS'; end if;

  if p_id is null then
    v_slug := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    insert into forms (workspace_id, slug, name, title, description, fields, submit_message, enabled, created_by)
    values (p_workspace, v_slug, coalesce(nullif(p_name,''),'Untitled form'),
            coalesce(nullif(p_title,''),'Get in touch'), p_description, coalesce(p_fields,'[]'::jsonb),
            coalesce(nullif(p_submit_message,''),'Thanks — we''ll be in touch.'), coalesce(p_enabled,true), p_privy)
    returning id, slug into v_id, v_slug;
  else
    update forms set name = coalesce(nullif(p_name,''),'Untitled form'),
      title = coalesce(nullif(p_title,''),'Get in touch'), description = p_description,
      fields = coalesce(p_fields,'[]'::jsonb),
      submit_message = coalesce(nullif(p_submit_message,''),'Thanks — we''ll be in touch.'),
      enabled = coalesce(p_enabled,true), updated_at = now()
    where id = p_id and workspace_id = p_workspace
    returning id, slug into v_id, v_slug;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return jsonb_build_object('id', v_id, 'slug', v_slug);
end $$;

create or replace function delete_form(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_role text; v_n int;
begin
  v_role := workspace_role(p_privy, p_workspace);
  if v_role is null or v_role not in ('owner','admin','member','recruiter') then raise exception 'FORBIDDEN'; end if;
  delete from forms where id = p_id and workspace_id = p_workspace;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

create or replace function get_form_submissions(p_privy text, p_workspace uuid, p_form_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', s.id, 'data', s.data, 'person_id', s.person_id, 'created_at', s.created_at
  ) order by s.created_at desc) from form_submissions s
    where s.form_id = p_form_id and s.workspace_id = p_workspace), '[]'::jsonb);
end $$;

-- ── Public side (anon; touches only its own rows) ───────────────────────────
create or replace function get_public_form(p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object('id', f.id, 'title', f.title, 'description', f.description,
           'fields', f.fields, 'enabled', f.enabled, 'workspace_name', w.name)
    into v from forms f join workspaces w on w.id = f.workspace_id
    where f.slug = lower(p_slug);
  return v;  -- null if unknown
end $$;

-- Creates a lead (people row) from a submission and logs the raw answers.
-- Standard fields map onto people columns via each field's `map`; everything
-- else is stashed in custom_fields + the submission.
create or replace function submit_form(p_slug text, p_data jsonb, p_ip text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_form forms; v_field jsonb; v_key text; v_map text; v_val text;
  v_first text; v_last text; v_email text; v_phone text; v_title text; v_linkedin text;
  v_custom jsonb := '{}'::jsonb; v_person uuid;
begin
  select * into v_form from forms where slug = lower(p_slug) and enabled;
  if v_form.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if jsonb_typeof(p_data) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'bad_data'); end if;

  for v_field in select * from jsonb_array_elements(v_form.fields) loop
    v_key := v_field->>'key';
    v_map := v_field->>'map';
    v_val := p_data->>v_key;
    if v_val is null or v_val = '' then continue; end if;
    if    v_map = 'first_name'   then v_first := left(v_val, 200);
    elsif v_map = 'last_name'    then v_last := left(v_val, 200);
    elsif v_map = 'email'        then v_email := left(v_val, 320);
    elsif v_map = 'phone'        then v_phone := left(v_val, 60);
    elsif v_map = 'title'        then v_title := left(v_val, 200);
    elsif v_map = 'linkedin_url' then v_linkedin := left(v_val, 400);
    else  v_custom := v_custom || jsonb_build_object(coalesce(v_field->>'label', v_key), left(v_val, 2000));
    end if;
  end loop;

  insert into people (workspace_id, first_name, last_name, email, phone, title, linkedin_url, source, custom_fields)
  values (v_form.workspace_id, v_first, v_last, v_email, v_phone, v_title, v_linkedin,
          'form:' || v_form.name, v_custom)
  returning id into v_person;

  insert into form_submissions (form_id, workspace_id, data, person_id, ip)
  values (v_form.id, v_form.workspace_id, p_data, v_person, nullif(p_ip,''));

  return jsonb_build_object('ok', true, 'message', v_form.submit_message);
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function get_forms(text, uuid)                                          from public, anon, authenticated;
revoke all on function get_form(text, uuid, uuid)                                     from public, anon, authenticated;
revoke all on function save_form(text, uuid, uuid, text, text, text, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function delete_form(text, uuid, uuid)                                  from public, anon, authenticated;
revoke all on function get_form_submissions(text, uuid, uuid)                         from public, anon, authenticated;
grant execute on function get_forms(text, uuid)                                          to service_role;
grant execute on function get_form(text, uuid, uuid)                                     to service_role;
grant execute on function save_form(text, uuid, uuid, text, text, text, jsonb, text, boolean) to service_role;
grant execute on function delete_form(text, uuid, uuid)                                  to service_role;
grant execute on function get_form_submissions(text, uuid, uuid)                         to service_role;
-- Public flow: anon may call these two (DEFINER; no anon table grants needed).
grant execute on function get_public_form(text)          to anon, authenticated, service_role;
grant execute on function submit_form(text, jsonb, text)  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
