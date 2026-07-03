-- ============================================================================
-- HireBTR Platform Core — 0028_posts.sql
-- Social post studio (PreFeed port): pixel-accurate platform previews with
-- Figma-style pinned comments and a tokenized client-review link (no account
-- needed to review — same share-token model as invoice/offer documents).
-- Dedicated RPCs (not the CRUD monolith). Additive & prod-safe.
-- Depends on 0001–0027. Run AFTER them.
-- ============================================================================

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  platform text not null default 'instagram',   -- instagram | facebook | x | linkedin
  handle text,                                   -- shown on the mockup, e.g. @yourbrand
  content text not null default '',
  image_url text,
  status text not null default 'draft',          -- draft | in_review | approved | published
  share_token text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_posts_ws on posts(workspace_id);
drop trigger if exists trg_posts_upd on posts;
create trigger trg_posts_upd before update on posts for each row execute function set_updated_at();
alter table posts enable row level security;

create table if not exists post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  author text not null default 'Reviewer',
  body text not null,
  x numeric(5,2),                                -- pin position, % of canvas (null = general note)
  y numeric(5,2),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_post_comments_post on post_comments(post_id, created_at);
alter table post_comments enable row level security;

-- Shared JSON shape for a post + its comments.
create or replace function post_payload(p posts)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'platform', p.platform, 'handle', p.handle, 'content', p.content,
    'image_url', p.image_url, 'status', p.status, 'share_token', p.share_token,
    'campaign_id', p.campaign_id, 'updated_at', p.updated_at,
    'comments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'author', c.author, 'body', c.body, 'x', c.x, 'y', c.y,
      'resolved', c.resolved, 'created_at', c.created_at
    ) order by c.created_at) from post_comments c where c.post_id = p.id), '[]'::jsonb)
  );
$$;

create or replace function get_posts(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', p.id, 'platform', p.platform, 'handle', p.handle, 'content', p.content,
    'image_url', p.image_url, 'status', p.status, 'updated_at', p.updated_at,
    'comment_count', (select count(*) from post_comments c where c.post_id = p.id and not c.resolved)
  ) order by p.updated_at desc) from posts p where p.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_posts(text, uuid) to authenticated, anon;

create or replace function get_post(p_privy text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
declare v posts;
begin
  select * into v from posts where id = p_id and workspace_id = any(my);
  if not found then return null; end if;
  return post_payload(v);
end $$;
grant execute on function get_post(text, uuid) to authenticated, anon;

-- Create (p_id null) or update a post.
create or replace function save_post(p_privy text, p_workspace uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if v_id is null then
    insert into posts (workspace_id, platform, handle, content, image_url, status, campaign_id)
    values (p_workspace,
      coalesce(nullif(p_data->>'platform',''), 'instagram'), nullif(p_data->>'handle',''),
      coalesce(p_data->>'content',''), nullif(p_data->>'image_url',''),
      coalesce(nullif(p_data->>'status',''), 'draft'), nullif(p_data->>'campaign_id','')::uuid)
    returning id into v_id;
  else
    update posts set
      platform  = coalesce(nullif(p_data->>'platform',''), platform),
      handle    = nullif(p_data->>'handle',''),
      content   = coalesce(p_data->>'content', content),
      image_url = nullif(p_data->>'image_url',''),
      status    = coalesce(nullif(p_data->>'status',''), status),
      campaign_id = nullif(p_data->>'campaign_id','')::uuid
    where id = v_id and workspace_id = p_workspace;
  end if;
  return v_id;
end $$;
grant execute on function save_post(text, uuid, uuid, jsonb) to authenticated, anon;

-- Workspace-side comment (author resolved from the account).
create or replace function add_post_comment(p_privy text, p_post uuid, p_body text, p_x numeric default null, p_y numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_author text; v_id uuid;
begin
  select workspace_id into v_ws from posts where id = p_post;
  if v_ws is null or not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
  select coalesce(nullif(full_name,''), email, 'Team member') into v_author
    from accounts where workspace_id = v_ws and privy_user_id = p_privy limit 1;
  insert into post_comments (post_id, author, body, x, y)
  values (p_post, coalesce(v_author, 'Team member'), p_body, p_x, p_y) returning id into v_id;
  return v_id;
end $$;
grant execute on function add_post_comment(text, uuid, text, numeric, numeric) to authenticated, anon;

create or replace function set_post_comment_resolved(p_privy text, p_comment uuid, p_resolved boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select p.workspace_id into v_ws from post_comments c join posts p on p.id = c.post_id where c.id = p_comment;
  if v_ws is null or not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
  update post_comments set resolved = p_resolved where id = p_comment;
end $$;
grant execute on function set_post_comment_resolved(text, uuid, boolean) to authenticated, anon;

-- ── Client review (token = authorisation; no account) ────────────────────────
create or replace function get_post_public(p_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v posts;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select * into v from posts where id = p_id and share_token = p_token;
  if not found then return null; end if;
  return post_payload(v);
end $$;
grant execute on function get_post_public(uuid, text) to authenticated, anon;

create or replace function add_post_comment_public(p_id uuid, p_token text, p_author text, p_body text, p_x numeric default null, p_y numeric default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from posts where id = p_id and share_token = p_token and p_token is not null and length(p_token) >= 16) then
    raise exception 'NOT_FOUND_OR_FORBIDDEN';
  end if;
  insert into post_comments (post_id, author, body, x, y)
  values (p_id, coalesce(nullif(trim(p_author),''), 'Client'), p_body, p_x, p_y) returning id into v_id;
  -- a fresh client comment puts the post back in review
  update posts set status = 'in_review' where id = p_id and status = 'approved';
  return v_id;
end $$;
grant execute on function add_post_comment_public(uuid, text, text, text, numeric, numeric) to authenticated, anon;

notify pgrst, 'reload schema';
