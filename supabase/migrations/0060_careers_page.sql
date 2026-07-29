-- ============================================================================
-- RunButter — 0060_careers_page.sql
-- A public, branded careers page per company: every open role in one place at
-- /careers/<slug>, instead of only the one-role-at-a-time /apply/<positionId>
-- links that exist today.
--
-- The slug is chosen here with SUBDOMAINS in mind. Once wildcard DNS is
-- pointed at the app, acme.runbutter.app rewrites to /careers/acme with no
-- schema change — so the slug has to obey DNS label rules from day one
-- (lowercase, alphanumeric + hyphen, no leading/trailing hyphen, <= 63 chars),
-- and reserved hostnames have to be refused NOW. Letting someone take "www",
-- "api" or "mail" before the DNS flip would silently break the flip.
--
-- Nothing becomes public implicitly: a company has no careers page until an
-- owner/admin sets a slug. Roles are then listed only when active AND
-- published, so an internal req can stay off the public page.
-- Depends on the legacy ATS tables (companies, positions) + workspaces (0024).
-- ============================================================================

alter table companies  add column if not exists careers_slug     text;
alter table companies  add column if not exists careers_headline text;
alter table companies  add column if not exists careers_about    text;
alter table positions  add column if not exists is_published     boolean not null default true;

-- Case-insensitive uniqueness: hostnames are case-insensitive, so "Acme" and
-- "acme" must not be two different careers pages.
create unique index if not exists idx_companies_careers_slug on companies (lower(careers_slug))
  where careers_slug is not null;

-- ── Slug rules ──────────────────────────────────────────────────────────────
-- Names that must never become a tenant subdomain, because they are either
-- already routed, conventionally reserved, or would be used to impersonate us.
create or replace function careers_slug_reserved(p text)
returns boolean language sql immutable parallel safe as $$
  select lower(coalesce(p, '')) = any (array[
    'www','api','app','admin','administrator','auth','login','signup','register',
    'mail','email','smtp','imap','pop','ftp','ns','ns1','ns2','dns','mx',
    'cdn','static','assets','img','images','media','files','download','downloads',
    'blog','docs','doc','help','support','status','dashboard','portal','account',
    'billing','pay','payments','checkout','stripe','webhook','webhooks','hooks',
    'staging','stage','dev','test','demo','sandbox','preview','beta','alpha',
    'runbutter','hirebtr','careers','jobs','apply','security','abuse','postmaster',
    'root','system','internal','private','public','null','undefined','me','my'
  ])
$$;

-- Valid DNS label AND valid URL segment. 2-40 chars keeps it typeable and well
-- inside the 63-char DNS limit.
create or replace function careers_slug_valid(p text)
returns boolean language sql immutable parallel safe as $$
  select coalesce(p, '') ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'
     and length(coalesce(p, '')) between 2 and 40
     and coalesce(p, '') !~ '--'          -- xn-- is the IDN prefix; avoid the whole class
     and not careers_slug_reserved(p)
$$;

-- ── Public read ─────────────────────────────────────────────────────────────
-- Anon-callable BY DESIGN: candidates have no Privy session, exactly like the
-- existing apply flow. It returns only what a careers page shows — never
-- candidate data, never anything about the workspace's internal state.
create or replace function get_careers_page(p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_out jsonb;
begin
  select id into v_company from companies where lower(careers_slug) = lower(trim(coalesce(p_slug, '')));
  if v_company is null then return null; end if;   -- caller renders 404

  select jsonb_build_object(
    'company', jsonb_build_object(
      'id', c.id,
      'name', coalesce(nullif(w.legal_name, ''), c.name),
      'slug', c.careers_slug,
      'headline', c.careers_headline,
      'about', c.careers_about,
      -- workspace_id == company_id (0005 sync trigger), so branding set in
      -- Settings → Branding drives the public page with no second place to edit.
      'logo_url', coalesce(nullif(w.logo_url, ''), c.logo_url),
      'accent_color', nullif(w.accent_color, ''),
      'website', nullif(w.address, '')
    ),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'title', p.title, 'department', p.department,
        'location', p.location, 'employment_type', p.employment_type,
        'created_at', p.created_at
      ) order by p.created_at desc)
      from positions p
      where p.company_id = v_company and p.is_active and p.is_published
    ), '[]'::jsonb)
  ) into v_out
  from companies c left join workspaces w on w.id = c.id
  where c.id = v_company;

  return v_out;
end $$;

-- ── Owner side ──────────────────────────────────────────────────────────────
create or replace function set_careers_page(
  p_privy text, p_company uuid, p_slug text, p_headline text default null, p_about text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_slug text;
begin
  if not is_workspace_member(p_company, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  v_slug := lower(trim(coalesce(p_slug, '')));
  if v_slug = '' then
    -- Empty slug takes the page down. Deliberately allowed: unpublishing must
    -- not require deleting the company.
    update companies set careers_slug = null, careers_headline = p_headline, careers_about = p_about
    where id = p_company;
    return jsonb_build_object('slug', null);
  end if;

  if not careers_slug_valid(v_slug) then
    if careers_slug_reserved(v_slug) then raise exception 'SLUG_RESERVED';
    else raise exception 'SLUG_INVALID'; end if;
  end if;
  if exists (select 1 from companies where lower(careers_slug) = v_slug and id <> p_company) then
    raise exception 'SLUG_TAKEN';
  end if;

  update companies set careers_slug = v_slug, careers_headline = p_headline, careers_about = p_about
  where id = p_company;
  return jsonb_build_object('slug', v_slug);
end $$;

create or replace function get_careers_settings(p_privy text, p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_company, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_build_object(
    'slug', careers_slug, 'headline', careers_headline, 'about', careers_about
  ) from companies where id = p_company), '{}'::jsonb);
end $$;

-- Publish/unpublish a single role without deactivating it internally.
create or replace function set_position_published(p_privy text, p_position uuid, p_published boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from positions where id = p_position;
  if v_company is null or not is_workspace_member(v_company, p_privy) then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
  update positions set is_published = coalesce(p_published, true) where id = p_position;
  return jsonb_build_object('id', p_position, 'is_published', coalesce(p_published, true));
end $$;

revoke all on function get_careers_page(text)                              from public, anon, authenticated;
revoke all on function set_careers_page(text, uuid, text, text, text)      from public, anon, authenticated;
revoke all on function get_careers_settings(text, uuid)                    from public, anon, authenticated;
revoke all on function set_position_published(text, uuid, boolean)         from public, anon, authenticated;
-- The public page is server-rendered through the service_role client, so anon
-- EXECUTE stays revoked here too — consistent with 0046.
grant execute on function get_careers_page(text)                           to service_role;
grant execute on function set_careers_page(text, uuid, text, text, text)   to service_role;
grant execute on function get_careers_settings(text, uuid)                 to service_role;
grant execute on function set_position_published(text, uuid, boolean)      to service_role;

notify pgrst, 'reload schema';
