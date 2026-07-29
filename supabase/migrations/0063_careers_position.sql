-- ============================================================================
-- RunButter — 0063_careers_position.sql
-- A public page per open role: /careers/<slug>/<positionId>.
--
-- Until now the careers list linked straight into the application form, so a
-- candidate never saw the job description — even though `description`,
-- `department`, `location` and `employment_type` are captured on every position.
-- People were applying blind to fields we already had.
--
-- Giving each role its own URL also makes it indexable, which is what allows
-- JobPosting structured data and therefore Google Jobs. That is free
-- distribution which is impossible while every role shares one page.
--
-- Same visibility contract as get_careers_page (0060/0061): the company must
-- have a careers slug, and the role must be active AND published. A hidden or
-- closed role 404s here rather than being reachable by guessing its id.
-- Depends on 0060 (careers_slug, is_published) + 0061 (branding columns).
-- ============================================================================

create or replace function get_careers_position(p_slug text, p_position uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_out jsonb;
begin
  select id into v_company from companies where lower(careers_slug) = lower(trim(coalesce(p_slug, '')));
  if v_company is null then return null; end if;

  select jsonb_build_object(
    'company', jsonb_build_object(
      'id', c.id,
      'name', coalesce(nullif(w.legal_name, ''), c.name),
      'slug', c.careers_slug,
      'logo_url', coalesce(nullif(w.logo_url, ''), c.logo_url),
      'accent_color', nullif(w.accent_color, ''),
      'website', nullif(w.address, ''),
      'cover_image_url', nullif(w.cover_image_url, ''),
      'favicon_url', nullif(w.favicon_url, ''),
      'og_image_url', nullif(w.og_image_url, ''),
      -- Shown on the apply step; surfaced here so the job page can preview it.
      'apply_intro', nullif(w.apply_intro, '')
    ),
    'position', jsonb_build_object(
      'id', p.id, 'title', p.title, 'description', p.description,
      'department', p.department, 'location', p.location,
      'employment_type', p.employment_type, 'created_at', p.created_at
    ),
    -- Lets the page offer "3 other open roles" without a second round trip.
    'other_positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'title', o.title, 'department', o.department, 'location', o.location
      ) order by o.created_at desc)
      from positions o
      where o.company_id = v_company and o.is_active and o.is_published and o.id <> p.id
      limit 5
    ), '[]'::jsonb)
  ) into v_out
  from positions p
  join companies c on c.id = p.company_id
  left join workspaces w on w.id = c.id
  where p.id = p_position
    and p.company_id = v_company
    and p.is_active
    and p.is_published;

  return v_out;   -- null when hidden, closed, or not this company's role
end $$;

revoke all on function get_careers_position(text, uuid) from public, anon, authenticated;
grant execute on function get_careers_position(text, uuid) to service_role;

notify pgrst, 'reload schema';
