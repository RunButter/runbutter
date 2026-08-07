-- ============================================================================
-- RunButter — 0094_hr_positions_rpc.sql
-- Gives the HR positions screens a server-side path, which they never had.
--
-- WHAT BROKE AND WHY. 0077 closed the anon read/write hole on the legacy ATS
-- tables, and its final act per table is:
--
--     revoke all on table public.<t> from anon, authenticated
--
-- with `positions` and `companies` both in the target list. That is a GRANT
-- revocation, not an RLS policy — so the browser does not get "zero rows", it
-- gets `permission denied for table companies`. Every HR positions screen still
-- read those tables straight from the browser with the anon key, so the moment
-- 0077 ran:
--
--   • Positions → the list read is denied, the page renders empty, and it looks
--     exactly like the roles were DELETED. They were never touched.
--   • New role → "Could not check your plan: permission denied for table
--     companies", from a direct read of companies.plan.
--   • Edit / careers / sources → same shape.
--
-- 0077's header warns to deploy the client changes first. 0076 did that for
-- login, register, plans and team — the positions screens were missed, and
-- nothing failed until the revoke landed.
--
-- WHY THIS IS A MIGRATION AND NOT A CLIENT PATCH. There was no write RPC for
-- positions at all: `hr_list_positions_min` returns id+title of ACTIVE rows
-- only (built for a dropdown), and nothing anywhere could insert, update or
-- delete one. Restoring the grants instead would reopen precisely the hole
-- 0077 closed — the anon key ships in the browser bundle, so a read grant there
-- is a public read.
--
-- Every function is SECURITY DEFINER, derives its tenant from hr_company_id()
-- (never from an argument), and is service_role only — reachable solely through
-- the /api/rpc proxy, which verifies the Privy JWT. Same shape as 0044/0045.
--
-- Plan limits are deliberately NOT encoded here: lib/plans.ts is the single
-- source for those numbers, and a copy in SQL is how the pricing in CLAUDE.md
-- drifted a whole model behind reality. The client reads its plan from
-- get_my_workspace and its count from hr_list_positions.
-- ============================================================================

-- ── Read ────────────────────────────────────────────────────────────────────

/**
 * The full list for the positions screen, with applicant counts.
 *
 * Counts come from a LATERAL subquery rather than a join + group by: a join
 * would drop positions with no candidates unless it were a LEFT join, and the
 * previous client code learned that lesson the hard way when one embedded
 * PostgREST join emptied the whole list.
 */
create or replace function hr_list_positions(p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc)
    from (
      select p.id, p.company_id, p.title, p.description, p.department, p.location,
             p.employment_type, p.neuro_profile, p.is_active, p.is_published,
             p.created_at, p.updated_at, p.created_by,
             coalesce(c.n, 0) as applicant_count
      from positions p
      left join lateral (
        select count(*)::int as n from candidates cd where cd.position_id = p.id
      ) c on true
      where p.company_id = v_c
    ) x
  ), '[]'::jsonb);
end $$;

create or replace function hr_get_position(p_privy text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_row jsonb;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return null; end if;
  -- The company check is in the WHERE clause, so a guessed id from another
  -- tenant returns null rather than raising — an error message that
  -- distinguishes "not yours" from "does not exist" is an enumeration oracle.
  select row_to_json(p)::jsonb into v_row
  from positions p where p.id = p_id and p.company_id = v_c;
  return v_row;
end $$;

-- ── Write ───────────────────────────────────────────────────────────────────

/**
 * Insert or update. `p_id` null means insert.
 *
 * Keys ABSENT from p_data are left alone on update, matching update_record's
 * semantics (0088) — the bug that one fixed was a partial update blanking every
 * column it did not mention, and the same shape would be just as wrong here.
 */
create or replace function hr_save_position(p_privy text, p_id uuid, p_data jsonb, p_assessment jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_member uuid; v_id uuid; v_title text;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then raise exception 'NO_COMPANY: your account is not linked to a company'; end if;

  v_title := nullif(btrim(coalesce(p_data->>'title', '')), '');

  if p_id is null then
    if v_title is null then raise exception 'TITLE_REQUIRED'; end if;

    -- created_by references company_users(id) and is nullable; a workspace
    -- member with no legacy ATS row still gets to create a position rather
    -- than being blocked by a row they never knew existed.
    select cu.id into v_member
    from company_users cu
    where cu.privy_user_id = p_privy and cu.company_id = v_c
    order by cu.created_at asc limit 1;

    insert into positions (company_id, title, description, department, location,
                           employment_type, neuro_profile, is_active, is_published, created_by)
    values (v_c, v_title,
            nullif(p_data->>'description', ''),
            nullif(p_data->>'department', ''),
            nullif(p_data->>'location', ''),
            nullif(p_data->>'employment_type', ''),
            nullif(p_data->>'neuro_profile', ''),
            coalesce((p_data->>'is_active')::boolean, true),
            coalesce((p_data->>'is_published')::boolean, true),
            v_member)
    returning id into v_id;

    -- The default assessment is created HERE, in the same transaction, because
    -- assessment_templates is in 0077's revoke list too and the client can no
    -- longer insert it. Atomicity is the bonus: the old two-step could leave a
    -- position with no assessment, which breaks the candidate flow silently —
    -- the client even had a comment apologising for that state.
    if p_assessment is not null and jsonb_typeof(p_assessment->'questions') = 'array' then
      insert into assessment_templates (company_id, position_id, name, description, questions, is_default)
      values (v_c, v_id,
              coalesce(nullif(p_assessment->>'name', ''), v_title || ' Assessment'),
              nullif(p_assessment->>'description', ''),
              p_assessment->'questions', true);
    end if;
  else
    update positions p set
      title            = case when p_data ? 'title'           then coalesce(v_title, p.title) else p.title end,
      description      = case when p_data ? 'description'     then nullif(p_data->>'description', '') else p.description end,
      department       = case when p_data ? 'department'      then nullif(p_data->>'department', '') else p.department end,
      location         = case when p_data ? 'location'        then nullif(p_data->>'location', '') else p.location end,
      employment_type  = case when p_data ? 'employment_type' then nullif(p_data->>'employment_type', '') else p.employment_type end,
      neuro_profile    = case when p_data ? 'neuro_profile'   then nullif(p_data->>'neuro_profile', '') else p.neuro_profile end,
      is_active        = case when p_data ? 'is_active'       then (p_data->>'is_active')::boolean else p.is_active end,
      is_published     = case when p_data ? 'is_published'    then (p_data->>'is_published')::boolean else p.is_published end,
      updated_at       = now()
    where p.id = p_id and p.company_id = v_c
    returning p.id into v_id;

    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;

  return hr_get_position(p_privy, v_id);
end $$;

create or replace function hr_delete_position(p_privy text, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_n int;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return false; end if;
  delete from positions where id = p_id and company_id = v_c;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
-- service_role only. Anon EXECUTE was revoked wholesale in 0046, and these
-- reach the browser exclusively through /api/rpc, which verifies the Privy JWT
-- and overwrites p_privy with the verified subject — so a caller cannot pass
-- somebody else's id.
revoke all on function hr_list_positions(text)              from public, anon, authenticated;
revoke all on function hr_get_position(text, uuid)          from public, anon, authenticated;
revoke all on function hr_save_position(text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function hr_delete_position(text, uuid)       from public, anon, authenticated;

grant execute on function hr_list_positions(text)             to service_role;
grant execute on function hr_get_position(text, uuid)         to service_role;
grant execute on function hr_save_position(text, uuid, jsonb, jsonb) to service_role;
grant execute on function hr_delete_position(text, uuid)      to service_role;

-- ── get_my_hr_companies gains two fields ────────────────────────────────────
/**
 * Redefined IN FULL (0076's version), adding `id` and `open_positions`.
 *
 * `id` is company_users.id — the membership id. Its absence is why
 * resolveHrCompany could not stop reading company_users directly: it needs that
 * value for `created_by`. Adding a key to the returned JSON is backward
 * compatible; every existing caller reads by name.
 *
 * `logo_url` and `subdomain` join them so Settings can render the company
 * without its own read of `companies`.
 *
 * `open_positions` lets the company switcher say "6 roles are in your other
 * workspace" instead of rendering an empty list with no explanation — the
 * screens counted that with a cross-company read of `positions`, which 0077
 * also revoked.
 */
create or replace function get_my_hr_companies(p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_privy), '') = '' then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
    select cu.id, cu.company_id, cu.role, cu.full_name, cu.email, cu.created_at,
           c.name as company_name, c.plan, c.subdomain, c.logo_url,
           coalesce(op.n, 0) as open_positions
      from company_users cu
      join companies c on c.id = cu.company_id
      left join lateral (
        select count(*)::int as n from positions p
         where p.company_id = cu.company_id and p.is_active
      ) op on true
     where cu.privy_user_id = p_privy
  ) x), '[]'::jsonb);
end $$;

revoke all on function get_my_hr_companies(text) from public, anon, authenticated;
grant execute on function get_my_hr_companies(text) to service_role;

notify pgrst, 'reload schema';

-- ── The default assessment, for the edit screen ─────────────────────────────
/**
 * assessment_templates is in 0077's revoke list too, so the edit screen could
 * neither read its questions back nor save them. Both are scoped through the
 * POSITION's company, never through a company id passed in — the old client
 * insert took `company_id` from resolveHrCompanyId and would happily have
 * written a template into whichever company that returned.
 */
create or replace function hr_get_assessment(p_privy text, p_position uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_row jsonb;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then return null; end if;
  select to_jsonb(a) into v_row
  from assessment_templates a
  join positions p on p.id = a.position_id
  where a.position_id = p_position and a.is_default and p.company_id = v_c
  limit 1;
  return v_row;
end $$;

/** Upsert the default template for a position. Returns it. */
create or replace function hr_save_assessment(p_privy text, p_position uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_c uuid; v_existing uuid;
begin
  v_c := hr_company_id(p_privy);
  if v_c is null then raise exception 'NO_COMPANY'; end if;
  -- The position must be ours before anything is written against it.
  if not exists (select 1 from positions where id = p_position and company_id = v_c) then
    raise exception 'NOT_FOUND';
  end if;
  if jsonb_typeof(p_data->'questions') <> 'array' then raise exception 'QUESTIONS_REQUIRED'; end if;

  select id into v_existing from assessment_templates
   where position_id = p_position and is_default limit 1;

  if v_existing is null then
    insert into assessment_templates (company_id, position_id, name, description, questions, is_default)
    values (v_c, p_position,
            coalesce(nullif(p_data->>'name', ''), 'Assessment'),
            nullif(p_data->>'description', ''),
            p_data->'questions', true);
  else
    update assessment_templates
       set questions = p_data->'questions',
           name = coalesce(nullif(p_data->>'name', ''), name),
           updated_at = now()
     where id = v_existing;
  end if;

  return hr_get_assessment(p_privy, p_position);
end $$;

revoke all on function hr_get_assessment(text, uuid)         from public, anon, authenticated;
revoke all on function hr_save_assessment(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function hr_get_assessment(text, uuid)         to service_role;
grant execute on function hr_save_assessment(text, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';

-- ── get_apply_branding gains neuro_profile ──────────────────────────────────
/**
 * Redefined IN FULL (0064's version), adding `neuro_profile`.
 *
 * The assessment page read that column straight off `positions` to choose which
 * benchmark to score an applicant against. Anon lost that grant in 0077, and
 * the read DISCARDED its error, so it silently fell back to 'hard-tech' — every
 * applicant to every role scored against one profile, with nothing on screen or
 * in the logs to say so. A wrong number reported confidently is worse than an
 * error, so this closes it rather than leaving the fallback to do the work.
 *
 * This is the only anon-reachable function that already resolves a position, so
 * it is the right place: no new public surface, and it keeps the same
 * active-AND-published visibility rule, which means a hidden role still cannot
 * be probed by id.
 */
create or replace function get_apply_branding(p_position_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object(
           'title', p.title,
           'neuro_profile', p.neuro_profile,
           'company_name', coalesce(nullif(w.legal_name, ''), c.name),
           'logo_url', coalesce(nullif(w.logo_url, ''), c.logo_url),
           'accent_color', nullif(w.accent_color, ''),
           'apply_intro', nullif(w.apply_intro, '')
         )
    into v
    from positions p
    join companies c on c.id = p.company_id
    left join workspaces w on w.id = c.id
   where p.id = p_position_id
     and p.is_active and p.is_published;

  return v;   -- null when the position is missing or not public
end $$;

grant execute on function get_apply_branding(uuid) to authenticated, anon, service_role;

notify pgrst, 'reload schema';
