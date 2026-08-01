-- ============================================================================
-- RunButter — 0080_brand_the_funnel.sql
-- Carry the company's brand colour through the whole hiring funnel.
--
-- THE BUG THIS FIXES. The careers page is brand-coloured (0060 hands it
-- `accent_color`), but the apply form and the assessment are not — they render
-- RunButter's emerald. So a candidate crosses from the company's colours into
-- ours halfway through applying, on the two screens where they are doing actual
-- work and most need to feel they are still dealing with that employer.
--
-- The cause is small: `accent_color` lives on `workspaces`, and neither of
-- those screens ever reads it. `get_assessment_init_data` selects only
-- name + logo_url, and the apply form queries `companies` straight from the
-- browser, where `workspaces` is not readable at all.
--
-- So this does two things:
--   1. redefines `get_assessment_init_data` to include the brand colour
--   2. adds `get_apply_branding(position_id)` — one public, minimal read for
--      the apply form, instead of widening anon access to `workspaces`
--
-- WHY 1 IS A FULL REDEFINITION. That function lives in supabase/legacy/ and in
-- no numbered migration. Redefining it here brings it under version control;
-- the body below is the original plus the colour, so re-running the legacy file
-- afterwards would silently REMOVE branding again. Treat this as the current
-- definition (see the freshness probe in verify-migrations.sql).
--
-- `workspace_id == company_id` (same uuid, 0005 sync trigger), which is why the
-- join below is on `w.id = <company id>` and not through a foreign key.
--
-- Idempotent & prod-safe.
-- ============================================================================

-- ── Assessment: same payload, plus the brand colour ──────────────────────────
create or replace function get_assessment_init_data(p_candidate_id uuid, p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_candidate_rec record;
  v_company_rec   record;
  v_template_rec  record;
begin
  -- 1. Candidate, gated on the single-use access token exactly as before.
  select * into v_candidate_rec
    from candidates
   where id = p_candidate_id and access_token = p_token;
  if v_candidate_rec.id is null then return null; end if;

  -- 2. Company + brand, with the SAME precedence as get_careers_position (0063)
  --    and get_apply_branding below: workspace branding wins over the legacy
  --    company row. Selecting c.name/c.logo_url plainly here is what made the
  --    logo and company name change between the apply form and the assessment
  --    — the same inconsistency this migration exists to remove, one screen
  --    further along.
  --
  --    LEFT JOIN, so a company whose workspace row is missing still loads the
  --    assessment with the default accent rather than failing: a candidate must
  --    never be blocked by our branding data.
  select coalesce(nullif(w.legal_name, ''), c.name)      as name,
         coalesce(nullif(w.logo_url, ''),   c.logo_url)  as logo_url,
         nullif(w.accent_color, '')                      as accent_color
    into v_company_rec
    from companies c
    left join workspaces w on w.id = c.id
   where c.id = v_candidate_rec.company_id;

  -- 3. Template
  select * into v_template_rec
    from assessment_templates
   where position_id = v_candidate_rec.position_id and is_default = true
   limit 1;

  return jsonb_build_object(
    'candidate', row_to_json(v_candidate_rec),
    'company',   row_to_json(v_company_rec),
    'template',  row_to_json(v_template_rec)
  );
end $$;

-- Same grants the legacy definition carried: this is reached by a candidate who
-- has no account, holding a token. Anon EXECUTE is intentional here, unlike the
-- recruiter-side RPCs 0046 revoked.
grant execute on function get_assessment_init_data(uuid, uuid) to authenticated, anon;

-- ── Apply form: the minimum needed to render it in the company's colours ─────
-- A dedicated function rather than opening `workspaces` to anon. It returns
-- the public-facing fields and nothing else — no counts, no contact details,
-- no position list — so it cannot become a workspace enumeration tool.
--
-- `apply_intro` is included because Settings → Branding offers a field labelled
-- "Apply form intro" ("One line candidates see above the application form")
-- that the apply form never rendered. An owner could write it, save it, and see
-- it nowhere. It reaches the form now.
create or replace function get_apply_branding(p_position_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object(
           'title', p.title,
           -- Same precedence as get_careers_position (0063): the workspace's
           -- branding wins over the legacy company row. Anything else and the
           -- logo can change between the careers page and the apply form,
           -- which is the very inconsistency this migration exists to remove.
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
     -- Same visibility rule as the careers index and get_careers_position: a
     -- role that is closed or unpublished must not be reachable by guessing an
     -- id. Branding is harmless on its own, but an endpoint that confirms a
     -- hidden role exists is not.
     and p.is_active and p.is_published;

  return v;   -- null when the position is missing or not public
end $$;

revoke all on function get_apply_branding(uuid) from public;
grant execute on function get_apply_branding(uuid) to authenticated, anon;

notify pgrst, 'reload schema';
