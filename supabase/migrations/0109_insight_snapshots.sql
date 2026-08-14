-- ============================================================================
-- RunButter — 0109_insight_snapshots.sql
--
-- Publish a chart as a link. The architecture was decided before it was built
-- and it is the whole feature:
--
--   A PUBLISHED LINK SERVES A FROZEN SNAPSHOT, NEVER A LIVE QUERY.
--
-- A link that re-runs a query means any bug in that path is a tenant-wide
-- breach, and the path is reachable by anyone on the internet holding a URL. A
-- link that serves a stored JSON blob computed at publish time has a blast
-- radius of exactly what was published, and nothing downstream of it can be
-- talked into returning more. That is worth more than freshness: a shared chart
-- is a thing somebody put in a deck or a tweet, and it SHOULD say what it said
-- when they shared it.
--
-- So this table holds `data jsonb` — the finished buckets and totals — and the
-- reader never touches organizations, invoices or anything else. There is no
-- code path from the public page to a business table, by construction rather
-- than by filtering.
--
-- THE TOKEN IS 128 BITS from gen_random_bytes, not a uuid. A uuid v4 is 122
-- bits of randomness and, more importantly, LOOKS like an identifier people
-- feel safe pasting; a 32-char opaque token reads like a secret, which is what
-- it is. Unguessable is the entire access control here, which is why it is
-- generated in SQL rather than accepted from the client.
--
-- REVOCABLE AND COUNTED. `revoked_at` beats deletion: somebody who shared a
-- link wants to know it was reached 40 times before they killed it, and a
-- deleted row cannot tell them. The public reader refuses a revoked or expired
-- row.
--
-- NOT INDEXED. The page sets noindex, and this is somebody's revenue by client.
-- ============================================================================

create table if not exists insight_snapshots (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  token        text not null unique,
  title        text not null default 'Untitled',
  -- The finished answer: buckets, total, chart kind, and the human-readable
  -- query. Deliberately NOT the spec-plus-object — storing what to re-run is
  -- the live-query design this migration exists to avoid.
  data         jsonb not null,
  created_by   text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  views        int not null default 0
);

create index if not exists idx_insight_snapshots_ws on insight_snapshots(workspace_id, created_at desc);

alter table insight_snapshots enable row level security;
-- No policies: everything goes through the SECURITY DEFINER functions below,
-- and the public reader is one of them.

create or replace function publish_insight(
  p_privy text, p_workspace uuid, p_title text, p_data jsonb, p_days int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_token text; v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_data is null then raise exception 'NO_DATA'; end if;

  -- 16 bytes, hex. Generated HERE so a client cannot choose a guessable one.
  v_token := encode(gen_random_bytes(16), 'hex');

  insert into insight_snapshots (workspace_id, token, title, data, created_by, expires_at)
  values (p_workspace, v_token, coalesce(nullif(trim(p_title), ''), 'Untitled'), p_data, p_privy,
          case when p_days is not null and p_days > 0 then now() + make_interval(days => p_days) end)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

-- The public read. Takes a token and NOTHING else — no workspace, no user — so
-- there is no argument an attacker could vary to widen it. Returns null rather
-- than raising for a bad, revoked or expired token: all three are "no such
-- page", and telling them apart would confirm a token once existed.
create or replace function get_insight_public(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from insight_snapshots
   where token = p_token and revoked_at is null
     and (expires_at is null or expires_at > now());
  if not found then return null; end if;

  update insight_snapshots set views = views + 1 where id = r.id;

  -- Workspace branding travels so the page looks like the sender's, not ours.
  return jsonb_build_object(
    'title', r.title,
    'data', r.data,
    'created_at', r.created_at,
    'brand', (select jsonb_build_object('name', w.name, 'logo_url', w.logo_url, 'accent', w.accent_color)
                from workspaces w where w.id = r.workspace_id)
  );
end $$;

create or replace function get_insight_snapshots(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'token', token, 'title', title, 'created_at', created_at,
      'expires_at', expires_at, 'revoked_at', revoked_at, 'views', views
    ) order by created_at desc)
    from insight_snapshots where workspace_id = p_workspace
  ), '[]'::jsonb);
end $$;

create or replace function revoke_insight(p_privy text, p_workspace uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update insight_snapshots set revoked_at = now()
   where id = p_id and workspace_id = p_workspace and revoked_at is null;
end $$;

revoke all on function publish_insight(text, uuid, text, jsonb, int) from public, anon, authenticated;
revoke all on function get_insight_snapshots(text, uuid)             from public, anon, authenticated;
revoke all on function revoke_insight(text, uuid, uuid)              from public, anon, authenticated;
grant execute on function publish_insight(text, uuid, text, jsonb, int) to service_role;
grant execute on function get_insight_snapshots(text, uuid)             to service_role;
grant execute on function revoke_insight(text, uuid, uuid)              to service_role;

-- get_insight_public serves people with no Privy session, and ANON STAYS
-- REVOKED anyway.
--
-- The established pattern for a token-gated public RPC is an anon grant plus a
-- keep_public entry — get_post_public and get_invoice_document_public both work
-- that way. This one deliberately does not, for two reasons. /api/rpc rejects a
-- tokenless request outright (verifyPrivyToken returns `invalid` when there is
-- no token), so it could not be reached through the proxy regardless; and
-- check:grants parses keep_public out of the NEWEST migration that declares
-- one, so adding an array here would silently replace 0105's twenty-name list
-- with a one-name list and blind the gate.
--
-- So the reader is a dedicated server route holding the service-role client
-- (app/api/insights/s/[token]). One function, one caller, no anon surface, and
-- 0105's allowlist stays the single description of what anon may execute.
revoke all on function get_insight_public(text) from public, anon, authenticated;
grant execute on function get_insight_public(text) to service_role;

notify pgrst, 'reload schema';
