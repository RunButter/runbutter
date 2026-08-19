-- ============================================================================
-- RunButter — 0127_design_library.sql
--
-- A PUBLIC LIBRARY OF DESIGN SPECS, published by the people who made them.
--
-- ── A FROZEN SNAPSHOT, NEVER A LIVE READ ────────────────────────────────────
-- `design_styles.tokens` is a COPY of the workspace's spec taken at the moment
-- somebody pressed publish. It is not a pointer to `workspaces.design_tokens`
-- and must never become one. Two reasons, and the second is the important one:
--
--   1. Editing a draft palette on a Tuesday afternoon must not silently rewrite
--      a page strangers have bookmarked. Publishing is a decision with a date.
--   2. A public page that reads a tenant's live row is one query-scoping bug
--      away from serving a workspace's private spec — a brand nobody has
--      launched yet is exactly the kind of thing under NDA. A stored copy has a
--      blast radius of precisely what was published, on purpose.
--
-- This is the same architectural call the shareable-dashboards design makes,
-- for the same reason, and it is the whole feature rather than a detail.
--
-- ── PUBLISHING NEEDS AN ACCOUNT, AND THAT IS THE MODERATION ─────────────────
-- Anonymous publishing to an indexed page on our domain is a spam funnel with
-- our reputation as the payload. A workspace member can publish; the workspace
-- is named on the page; a cap keeps one account from filling the library. That
-- is a real bar, not a captcha.
--
-- Everything rendered is TEXT rendered as text — React escapes it, so this is a
-- spam question rather than an injection one. `author_url` is the exception,
-- because it is the one field that becomes a link, so it is http/https only and
-- carries rel="nofollow ugc" on the page.
--
-- ── SLUGS CANNOT SHADOW A BUILT-IN ──────────────────────────────────────────
-- `/brand/style/<slug>` serves the six curated styles first and the library
-- after, so a published style called "Quiet Product" must not be able to claim
-- that URL. `reserved_design_slug` refuses the name at publish time — the same
-- rule `reserved_object_slug` follows, and for the same reason: a collision
-- that is impossible beats a collision that is merely lost.
-- ============================================================================

create table if not exists design_styles (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  slug          text not null unique,
  name          text not null,
  -- The metaphor. One sentence somebody remembers a week later, and the line
  -- that makes a gallery scannable.
  essence       text,
  blurb         text,
  group_key     text not null default 'Product',
  -- THE SNAPSHOT. Never a reference.
  tokens        jsonb not null,
  author        text,
  author_url    text,
  published_by  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_design_styles_ws      on design_styles(workspace_id);
create index if not exists idx_design_styles_created on design_styles(created_at desc);

alter table design_styles enable row level security;
-- No policies. Reads go through the SECURITY DEFINER functions below, called
-- server-side with the service role — so nothing here is anon-callable and
-- check:grants stays clean.
revoke all on table design_styles from anon, authenticated;

/**
 * Slugs the library may not claim.
 *
 * The six curated styles, plus the route words that sit beside them. A
 * published style that captured `/brand/style/quiet-product` would replace a
 * page we link to from the gallery, the sitemap and the docs.
 */
create or replace function reserved_design_slug(p_slug text)
returns boolean language sql immutable as $$
  select p_slug = any(array[
    'quiet-product','ink-and-paper','hard-edge','warm-studio','midnight-console','soft-pop',
    'new','all','library','community','style','styles','index','api','admin'
  ]);
$$;

-- `unaccent` is an extension not every self-hosted Postgres has enabled, and a
-- migration that fails on a stranger's database is worse than one that
-- transliterates less well. Falls back to the raw string.
create or replace function unaccent_or_self(p_text text)
returns text language plpgsql immutable as $$
begin
  return public.unaccent(p_text);
exception when others then
  return p_text;
end $$;

/** URL-safe, ASCII, collapsed separators. Mirrors `fileSlug` in lib/design. */
create or replace function design_slugify(p_text text)
returns text language sql immutable as $$
  select coalesce(nullif(
    regexp_replace(
      regexp_replace(lower(unaccent_or_self(coalesce(p_text, ''))), '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)', '', 'g'
    ), ''), 'style');
$$;

/**
 * Publish, or re-publish over your own entry.
 *
 * `p_id` null creates; a non-null id updates a row THIS workspace owns. The
 * slug is minted once and then held: a published URL is somebody's bookmark and
 * renaming a style must not break it. Returns the row so the caller can show
 * the link straight away.
 */
create or replace function publish_design_style(
  p_privy text, p_workspace uuid, p_id uuid, p_data jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_slug text; v_base text; v_n int := 2; v_count int;
  v_name text; v_url text; v_group text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  v_name := nullif(btrim(coalesce(p_data->>'name','')), '');
  if v_name is null then raise exception 'NAME_REQUIRED'; end if;
  if jsonb_typeof(p_data->'tokens') is distinct from 'object' then raise exception 'TOKENS_REQUIRED'; end if;
  -- The same ceiling `save_design_tokens` uses: this lands in a page and in an
  -- agent's context, and a five-megabyte paste is an expensive way to break
  -- both at once.
  if length((p_data->'tokens')::text) > 262144 then raise exception 'TOO_LARGE'; end if;

  -- One field becomes a LINK, so it is the one field with a scheme check.
  v_url := nullif(btrim(coalesce(p_data->>'author_url','')), '');
  if v_url is not null and v_url !~* '^https?://' then raise exception 'BAD_URL'; end if;

  v_group := coalesce(nullif(p_data->>'group_key',''), 'Product');
  if v_group not in ('Product','Marketing','Editorial','Studio','Other') then v_group := 'Other'; end if;

  if p_id is null then
    -- A cap, not a paywall. It stops one account filling the library without
    -- stopping anybody with something to share.
    select count(*) into v_count from design_styles where workspace_id = p_workspace;
    if v_count >= 10 then raise exception 'LIBRARY_LIMIT: a workspace may publish 10 styles. Remove one first.'; end if;

    v_base := design_slugify(v_name);
    if reserved_design_slug(v_base) then v_base := v_base || '-style'; end if;
    v_slug := v_base;
    -- Suffix until it is free. Two people naming a style the same thing is
    -- normal, and losing the second one is not.
    while exists (select 1 from design_styles where slug = v_slug) loop
      v_slug := v_base || '-' || v_n; v_n := v_n + 1;
    end loop;

    insert into design_styles (workspace_id, slug, name, essence, blurb, group_key, tokens, author, author_url, published_by)
    values (p_workspace, v_slug, v_name,
            nullif(btrim(coalesce(p_data->>'essence','')), ''),
            nullif(btrim(coalesce(p_data->>'blurb','')), ''),
            v_group, p_data->'tokens',
            nullif(btrim(coalesce(p_data->>'author','')), ''), v_url, p_privy)
    returning id, slug into v_id, v_slug;
  else
    update design_styles set
      name = v_name,
      essence = nullif(btrim(coalesce(p_data->>'essence','')), ''),
      blurb = nullif(btrim(coalesce(p_data->>'blurb','')), ''),
      group_key = v_group,
      tokens = p_data->'tokens',
      author = nullif(btrim(coalesce(p_data->>'author','')), ''),
      author_url = v_url,
      updated_at = now()
      -- slug deliberately untouched: a published URL is somebody's bookmark.
    where id = p_id and workspace_id = p_workspace
    returning id, slug into v_id, v_slug;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;

  return jsonb_build_object('id', v_id, 'slug', v_slug);
end $$;

create or replace function unpublish_design_style(p_privy text, p_workspace uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- DELETED, not flagged. A style withdrawn from a public library should 404
  -- rather than sit in a table quietly reachable by anyone who kept the id, and
  -- there is nothing here worth keeping after somebody asked for it to go.
  delete from design_styles where id = p_id and workspace_id = p_workspace returning id into v;
  if v is null then raise exception 'NOT_FOUND'; end if;
end $$;

/** What this workspace has published, for the studio's own panel. */
create or replace function list_my_design_styles(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', s.id, 'slug', s.slug, 'name', s.name, 'essence', s.essence,
    'group_key', s.group_key, 'created_at', s.created_at, 'updated_at', s.updated_at
  ) order by s.created_at desc) from design_styles s where s.workspace_id = p_workspace), '[]'::jsonb);
end $$;

/**
 * The public gallery.
 *
 * Returns a CARD, never the whole spec — enough to draw the tile and decide,
 * and nothing else. A list endpoint that returned every token would mean a
 * single request walks off with the entire library, and the detail page exists
 * precisely so that costs one request each.
 */
create or replace function list_design_styles(p_limit int default 60, p_offset int default 0)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'slug', s.slug, 'name', s.name, 'essence', s.essence, 'blurb', s.blurb,
      'group_key', s.group_key, 'author', s.author, 'created_at', s.created_at,
      'heading', s.tokens->'type'->>'heading',
      'body', s.tokens->'type'->>'body',
      -- Just the swatches the card draws. Not the palette's meaning, not the
      -- type levels, not the rules.
      'colors', coalesce((
        select jsonb_agg(jsonb_build_object('name', c->>'name', 'hex', c->>'hex'))
        from jsonb_array_elements(coalesce(s.tokens->'colors', '[]'::jsonb)) c
      ), '[]'::jsonb)
    ) as x
    from design_styles s
    order by s.created_at desc
    limit greatest(1, least(coalesce(p_limit, 60), 200))
    offset greatest(0, coalesce(p_offset, 0))
  ) t;
$$;

/** One published style, whole. This is the page that hands the file over. */
create or replace function get_design_style(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'slug', s.slug, 'name', s.name, 'essence', s.essence, 'blurb', s.blurb,
    'group_key', s.group_key, 'tokens', s.tokens, 'author', s.author, 'author_url', s.author_url,
    'created_at', s.created_at, 'updated_at', s.updated_at
  )
  from design_styles s where s.slug = p_slug;
$$;

revoke all on function reserved_design_slug(text)                                   from public, anon, authenticated;
revoke all on function design_slugify(text)                                         from public, anon, authenticated;
revoke all on function unaccent_or_self(text)                                       from public, anon, authenticated;
revoke all on function publish_design_style(text, uuid, uuid, jsonb)                from public, anon, authenticated;
revoke all on function unpublish_design_style(text, uuid, uuid)                     from public, anon, authenticated;
revoke all on function list_my_design_styles(text, uuid)                            from public, anon, authenticated;
revoke all on function list_design_styles(int, int)                                 from public, anon, authenticated;
revoke all on function get_design_style(text)                                       from public, anon, authenticated;
grant execute on function reserved_design_slug(text)                                 to service_role;
grant execute on function design_slugify(text)                                       to service_role;
grant execute on function unaccent_or_self(text)                                     to service_role;
grant execute on function publish_design_style(text, uuid, uuid, jsonb)              to service_role;
grant execute on function unpublish_design_style(text, uuid, uuid)                   to service_role;
grant execute on function list_my_design_styles(text, uuid)                          to service_role;
grant execute on function list_design_styles(int, int)                               to service_role;
grant execute on function get_design_style(text)                                     to service_role;

notify pgrst, 'reload schema';
