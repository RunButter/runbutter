-- ============================================================================
-- RunButter — 0099_oauth_mcp.sql
-- OAuth 2.1 for the MCP server, so runbutter.app can be added to Claude with a
-- URL and a login instead of a config file and a pasted key.
--
-- ── WHY ─────────────────────────────────────────────────────────────────────
-- `/api/mcp` has been a correct MCP server since it shipped, and it authenticates
-- with `Authorization: Bearer hb_…` — the same workspace API keys as /api/v1.
-- That works for Claude Code, Claude Desktop and Cursor, which read a config
-- file and can send arbitrary headers.
--
-- It does NOT work for claude.ai's connector flow, which takes a URL, discovers
-- the authorization server, and sends the human through a login. There is
-- nowhere to paste a static key. So the server was reachable by developers and
-- unreachable by everybody else, and that is a gap in us rather than a
-- limitation of the client.
--
-- ── THE HUMAN IS ALREADY AUTHENTICATED; THIS IS ABOUT DELEGATION ────────────
-- Privy says who the person is. What was missing is a way for that person to
-- hand ONE workspace to ONE client with a scope, and to take it back. So the
-- authorize screen is an ordinary app page behind the ordinary Privy session,
-- and the token it mints is the same shape `resolve_api_key` already returns:
-- a workspace, an owner, a scope. Nothing downstream had to learn a new idea.
--
-- ── EVERY SECRET IS STORED HASHED ───────────────────────────────────────────
-- Authorization codes, access tokens and refresh tokens are all kept as SHA-256
-- hashes, exactly like `api_keys.key_hash` (0078). A database dump is then not a
-- set of live credentials, and this table is more attractive than most: a token
-- here is a standing grant to a whole workspace.
--
-- ── PKCE IS REQUIRED, NOT OPTIONAL ──────────────────────────────────────────
-- OAuth 2.1 removes the implicit flow and requires PKCE for every authorization
-- code. Registered clients are PUBLIC (`token_endpoint_auth_method = 'none'`) —
-- a desktop client or a browser cannot keep a client secret, and pretending
-- otherwise is what made OAuth 2.0's public-client story unsafe. PKCE is what
-- actually binds the code to the client that asked for it.
--
-- Depends on 0001 and 0078. Idempotent & prod-safe.
-- ============================================================================

-- ── Clients, registered dynamically (RFC 7591) ──────────────────────────────
/**
 * A client registers ITSELF. There is no admin screen and no allowlist, which
 * is the point of RFC 7591: claude.ai has never heard of this deployment and
 * this deployment has never heard of claude.ai, and neither should have to.
 *
 * That is safe only because a registered client can do NOTHING on its own. It
 * cannot read a workspace, cannot mint a token, and cannot get past
 * /oauth/authorize without a signed-in human choosing a workspace and pressing
 * a button. Registration buys a client_id and a promise about redirect_uris —
 * nothing else.
 */
create table if not exists oauth_clients (
  id             uuid primary key default gen_random_uuid(),
  client_id      text not null unique,
  client_name    text not null default '',
  client_uri     text,
  logo_uri       text,
  -- Exact-match only, no wildcards, no prefix matching. A redirect_uri that is
  -- compared loosely is how an authorization code ends up at somebody else's
  -- host, and it is the single most exploited weakness in OAuth deployments.
  redirect_uris  text[] not null default '{}',
  -- 'none' — public clients with PKCE. Stored rather than assumed so a future
  -- confidential client is a column change, not a rewrite.
  token_endpoint_auth_method text not null default 'none',
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz
);
alter table oauth_clients enable row level security;
revoke all on table oauth_clients from anon, authenticated;

-- ── Authorization codes ─────────────────────────────────────────────────────
create table if not exists oauth_authorizations (
  id             uuid primary key default gen_random_uuid(),
  code_hash      text not null unique,
  client_id      text not null,
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  owner_privy    text not null,
  redirect_uri   text not null,
  scope          text not null default 'full',
  -- PKCE. S256 only: `plain` is in the spec and is worth nothing, because a
  -- verifier that equals its own challenge protects against nobody who can see
  -- the request.
  code_challenge text not null,
  -- Codes are single-use and short-lived. `used_at` rather than a delete so a
  -- REPLAYED code is distinguishable from an expired one — the spec says a
  -- replayed code should revoke the tokens already issued from it, and that is
  -- only possible if the row is still there.
  used_at        timestamptz,
  expires_at     timestamptz not null default now() + interval '10 minutes',
  created_at     timestamptz not null default now()
);
alter table oauth_authorizations enable row level security;
revoke all on table oauth_authorizations from anon, authenticated;
create index if not exists idx_oauth_auth_expiry on oauth_authorizations(expires_at);

-- ── Tokens ──────────────────────────────────────────────────────────────────
create table if not exists oauth_tokens (
  id             uuid primary key default gen_random_uuid(),
  token_hash     text not null unique,
  refresh_hash   text unique,
  client_id      text not null,
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  owner_privy    text not null,
  scope          text not null default 'full',
  -- Which code minted this, so replaying that code can revoke its descendants.
  authorization_id uuid references oauth_authorizations(id) on delete set null,
  expires_at     timestamptz not null,
  refresh_expires_at timestamptz,
  revoked_at     timestamptz,
  last_used_at   timestamptz,
  created_at     timestamptz not null default now()
);
alter table oauth_tokens enable row level security;
revoke all on table oauth_tokens from anon, authenticated;
create index if not exists idx_oauth_tokens_ws on oauth_tokens(workspace_id, created_at desc);
create index if not exists idx_oauth_tokens_owner on oauth_tokens(owner_privy);

-- ── Registration ────────────────────────────────────────────────────────────
create or replace function oauth_register_client(
  p_client_name text, p_redirect_uris text[], p_client_uri text default null, p_logo_uri text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text; v_uris text[]; u text;
begin
  if p_redirect_uris is null or cardinality(p_redirect_uris) = 0 then
    raise exception 'INVALID_REDIRECT_URI: at least one redirect_uri is required';
  end if;
  if cardinality(p_redirect_uris) > 10 then raise exception 'INVALID_REDIRECT_URI: too many'; end if;

  foreach u in array p_redirect_uris loop
    -- https, or http on loopback. A desktop client legitimately redirects to
    -- 127.0.0.1 on a random port; anything else over plain http would put an
    -- authorization code on the wire in clear.
    -- The third branch is for a private-use scheme (com.example.app:/cb), and
    -- it REQUIRES A DOT IN THE SCHEME. Without that requirement `http` itself
    -- matches `[a-z][a-z0-9+.-]*`, and the branch meant to allow native apps
    -- quietly re-admitted plain http to any host — which the branch above it
    -- exists to forbid. Caught by the test that asserts a plain-http
    -- non-loopback redirect is refused.
    if not (u ~* '^https://[^\s]+$'
            or u ~* '^http://(127\.0\.0\.1|\[::1\]|localhost)(:[0-9]+)?(/[^\s]*)?$'
            or u ~* '^[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+:/[^\s]*$') then
      raise exception 'INVALID_REDIRECT_URI: %', u;
    end if;
    if length(u) > 2000 then raise exception 'INVALID_REDIRECT_URI: too long'; end if;
  end loop;

  v_uris := p_redirect_uris;
  v_id := 'rbc_' || encode(gen_random_bytes(18), 'hex');
  insert into oauth_clients (client_id, client_name, client_uri, logo_uri, redirect_uris)
  values (v_id, left(coalesce(nullif(btrim(p_client_name), ''), 'Unnamed client'), 120),
          nullif(p_client_uri, ''), nullif(p_logo_uri, ''), v_uris);

  return jsonb_build_object(
    'client_id', v_id,
    'client_name', left(coalesce(nullif(btrim(p_client_name), ''), 'Unnamed client'), 120),
    'redirect_uris', to_jsonb(v_uris),
    'token_endpoint_auth_method', 'none',
    'grant_types', jsonb_build_array('authorization_code', 'refresh_token'),
    'response_types', jsonb_build_array('code')
  );
end $$;
revoke all on function oauth_register_client(text, text[], text, text) from public, anon, authenticated;
grant execute on function oauth_register_client(text, text[], text, text) to service_role;

/** What the authorize screen needs to name the client asking, and to check the redirect. */
create or replace function oauth_get_client(p_client_id text, p_redirect_uri text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row oauth_clients;
begin
  select * into v_row from oauth_clients where client_id = p_client_id;
  if v_row.id is null then return null; end if;
  return jsonb_build_object(
    'client_id', v_row.client_id, 'client_name', v_row.client_name,
    'client_uri', v_row.client_uri, 'logo_uri', v_row.logo_uri,
    -- EXACT match against the registered list. Never a prefix, never a
    -- wildcard: a loosely compared redirect_uri is how an authorization code
    -- ends up at an attacker's host.
    'redirect_ok', p_redirect_uri = any(v_row.redirect_uris)
  );
end $$;
revoke all on function oauth_get_client(text, text) from public, anon, authenticated;
grant execute on function oauth_get_client(text, text) to service_role;

-- ── Consent → code ──────────────────────────────────────────────────────────
/**
 * Mint an authorization code for a workspace the caller is actually in.
 *
 * The membership check is the whole security of this function: the client
 * supplies a workspace id in the consent POST, and without this a signed-in
 * person could be walked into granting a workspace they do not belong to.
 */
create or replace function oauth_create_authorization(
  p_privy text, p_client_id text, p_workspace uuid, p_redirect_uri text,
  p_code_hash text, p_code_challenge text, p_scope text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_client oauth_clients;
begin
  select * into v_client from oauth_clients where client_id = p_client_id;
  if v_client.id is null then raise exception 'UNKNOWN_CLIENT'; end if;
  if not (p_redirect_uri = any(v_client.redirect_uris)) then raise exception 'INVALID_REDIRECT_URI'; end if;
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(p_code_challenge, '') = '' then raise exception 'PKCE_REQUIRED'; end if;

  insert into oauth_authorizations (code_hash, client_id, workspace_id, owner_privy,
                                    redirect_uri, scope, code_challenge)
  values (p_code_hash, p_client_id, p_workspace, p_privy, p_redirect_uri,
          case when p_scope = 'read' then 'read' else 'full' end, p_code_challenge)
  returning id into v_id;

  update oauth_clients set last_used_at = now() where client_id = p_client_id;
  return v_id;
end $$;
revoke all on function oauth_create_authorization(text, text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function oauth_create_authorization(text, text, uuid, text, text, text, text) to service_role;

-- ── Code → tokens ───────────────────────────────────────────────────────────
/**
 * Redeem a code, once.
 *
 * The single-use claim is `update … where used_at is null returning`, which is
 * atomic: two simultaneous redemptions of one code cannot both win, whatever
 * the client does. That matters because a stolen code races the legitimate one.
 *
 * A REPLAY revokes everything that code produced. The spec asks for this and
 * the reasoning is worth keeping: if a code is presented twice, one of the two
 * presenters is not the client that asked for it, and there is no way to tell
 * which — so the safe answer is that neither keeps the tokens.
 *
 * The PKCE verifier is compared HERE rather than in the route, so the check
 * cannot be skipped by a caller that forgets it.
 */
create or replace function oauth_redeem_code(
  p_code_hash text, p_client_id text, p_redirect_uri text, p_challenge_from_verifier text,
  p_token_hash text, p_refresh_hash text, p_ttl_seconds int default 3600
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_auth oauth_authorizations; v_id uuid; v_ttl int;
begin
  v_ttl := greatest(60, least(coalesce(p_ttl_seconds, 3600), 86400));

  select * into v_auth from oauth_authorizations where code_hash = p_code_hash;
  if v_auth.id is null then return jsonb_build_object('error', 'unknown code'); end if;

  if v_auth.used_at is not null then
    -- REPLAYED. Burn every token this code produced.
    --
    -- This RETURNS an error rather than raising one, and that is the whole
    -- reason the function has this shape: `raise` aborts the transaction, which
    -- rolls back the UPDATE immediately above it. The first version did exactly
    -- that — it refused the second redemption and left the first redemption's
    -- token live, which is the precise opposite of what replay detection is
    -- for. Caught by the test that asserts the first token is dead afterwards.
    update oauth_tokens set revoked_at = now()
     where authorization_id = v_auth.id and revoked_at is null;
    return jsonb_build_object('error', 'code already used');
  end if;
  if v_auth.expires_at < now() then return jsonb_build_object('error', 'code expired'); end if;
  if v_auth.client_id <> p_client_id then return jsonb_build_object('error', 'wrong client'); end if;
  if v_auth.redirect_uri <> p_redirect_uri then return jsonb_build_object('error', 'redirect_uri mismatch'); end if;
  if v_auth.code_challenge <> p_challenge_from_verifier then
    return jsonb_build_object('error', 'PKCE verification failed');
  end if;

  -- Single-use, claimed atomically: two simultaneous redemptions of one code
  -- cannot both win, whatever the client does. A stolen code races the real one.
  update oauth_authorizations set used_at = now()
   where id = v_auth.id and used_at is null
  returning id into v_id;
  if v_id is null then return jsonb_build_object('error', 'code already used'); end if;

  insert into oauth_tokens (token_hash, refresh_hash, client_id, workspace_id, owner_privy,
                            scope, authorization_id, expires_at, refresh_expires_at)
  values (p_token_hash, p_refresh_hash, v_auth.client_id, v_auth.workspace_id, v_auth.owner_privy,
          v_auth.scope, v_auth.id,
          now() + make_interval(secs => v_ttl), now() + interval '90 days');

  return jsonb_build_object('scope', v_auth.scope, 'workspace_id', v_auth.workspace_id, 'expires_in', v_ttl);
end $$;
revoke all on function oauth_redeem_code(text, text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function oauth_redeem_code(text, text, text, text, text, text, int) to service_role;

/**
 * Refresh, with rotation AND reuse detection.
 *
 * The old refresh token is revoked and a new one issued on every use — the same
 * rule the X integration follows (0082), because a refresh token that never
 * changes is a permanent credential sitting in somebody's config file.
 *
 * Presenting an ALREADY-ROTATED refresh token means one of two things: a client
 * retried, or a stolen token is being used. There is no way to tell which, so
 * the whole grant is revoked — OAuth 2.1 §4.14.2 asks for exactly this. Like
 * the replay case above it RETURNS rather than raises, so the revocation
 * actually commits.
 */
create or replace function oauth_refresh_token(
  p_refresh_hash text, p_client_id text, p_token_hash text, p_new_refresh_hash text,
  p_ttl_seconds int default 3600
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old oauth_tokens; v_ttl int;
begin
  v_ttl := greatest(60, least(coalesce(p_ttl_seconds, 3600), 86400));

  select * into v_old from oauth_tokens where refresh_hash = p_refresh_hash;
  if v_old.id is null then return jsonb_build_object('error', 'unknown refresh token'); end if;
  if v_old.client_id <> p_client_id then return jsonb_build_object('error', 'wrong client'); end if;

  if v_old.revoked_at is not null then
    -- Reused. Burn the whole family this authorization produced.
    update oauth_tokens set revoked_at = now()
     where authorization_id is not distinct from v_old.authorization_id
       and client_id = v_old.client_id and revoked_at is null;
    return jsonb_build_object('error', 'refresh token already used');
  end if;
  if v_old.refresh_expires_at is not null and v_old.refresh_expires_at < now() then
    return jsonb_build_object('error', 'refresh token expired');
  end if;

  update oauth_tokens set revoked_at = now() where id = v_old.id;

  insert into oauth_tokens (token_hash, refresh_hash, client_id, workspace_id, owner_privy,
                            scope, authorization_id, expires_at, refresh_expires_at)
  values (p_token_hash, p_new_refresh_hash, v_old.client_id, v_old.workspace_id, v_old.owner_privy,
          v_old.scope, v_old.authorization_id,
          now() + make_interval(secs => v_ttl),
          -- The window does NOT extend with use; it keeps the original
          -- deadline, so a grant nobody re-consents to does eventually expire.
          v_old.refresh_expires_at);

  return jsonb_build_object('scope', v_old.scope, 'workspace_id', v_old.workspace_id, 'expires_in', v_ttl);
end $$;
revoke all on function oauth_refresh_token(text, text, text, text, int) from public, anon, authenticated;
grant execute on function oauth_refresh_token(text, text, text, text, int) to service_role;

/**
 * Resolve a bearer token to a workspace — the same shape `resolve_api_key`
 * returns, so `/api/mcp` treats an OAuth token and an `hb_` key identically
 * from the moment it is resolved.
 */
create or replace function oauth_resolve_token(p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row oauth_tokens;
begin
  select * into v_row from oauth_tokens where token_hash = p_hash limit 1;
  if v_row.id is null then return null; end if;
  if v_row.revoked_at is not null or v_row.expires_at < now() then return null; end if;
  update oauth_tokens set last_used_at = now() where id = v_row.id;
  return jsonb_build_object(
    'id', v_row.id, 'workspace_id', v_row.workspace_id,
    'owner_privy', v_row.owner_privy,
    'scope', coalesce(v_row.scope, 'full'),
    'client_id', v_row.client_id
  );
end $$;
revoke all on function oauth_resolve_token(text) from public, anon, authenticated;
grant execute on function oauth_resolve_token(text) to service_role;

-- ── Taking it back ──────────────────────────────────────────────────────────
/** RFC 7009. Revoking by either token or refresh token, whichever was sent. */
create or replace function oauth_revoke_token(p_hash text, p_client_id text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update oauth_tokens set revoked_at = now()
   where (token_hash = p_hash or refresh_hash = p_hash)
     and client_id = p_client_id and revoked_at is null;
  -- RFC 7009 says an unknown token is a SUCCESS, so a client cannot use this
  -- endpoint to discover which tokens exist.
  return true;
end $$;
revoke all on function oauth_revoke_token(text, text) from public, anon, authenticated;
grant execute on function oauth_revoke_token(text, text) to service_role;

/**
 * What a person has connected, and how to disconnect it.
 *
 * A grant nobody can see is a grant nobody revokes. Owner/admin scoped because
 * the token acts on the whole workspace, not on the person who created it.
 */
create or replace function oauth_list_grants(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'client_id', t.client_id, 'client_name', coalesce(c.client_name, t.client_id),
      'client_uri', c.client_uri, 'scope', t.scope,
      'created_at', t.created_at, 'last_used_at', t.last_used_at, 'expires_at', t.expires_at)
      order by t.created_at desc)
    from oauth_tokens t left join oauth_clients c on c.client_id = t.client_id
    where t.workspace_id = p_workspace and t.revoked_at is null and t.expires_at > now()
  ), '[]'::jsonb);
end $$;
grant execute on function oauth_list_grants(text, uuid) to authenticated, anon;

create or replace function oauth_revoke_grant(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if workspace_role(p_privy, p_workspace) not in ('owner','admin') then
    raise exception 'FORBIDDEN: only an owner or admin can disconnect an app';
  end if;
  -- The whole grant, not one access token: revoking the row a client is
  -- currently using while leaving its refresh token alive disconnects nothing.
  update oauth_tokens t set revoked_at = now()
   where t.workspace_id = p_workspace and t.revoked_at is null
     and t.client_id = (select client_id from oauth_tokens where id = p_id and workspace_id = p_workspace);
  return found;
end $$;
grant execute on function oauth_revoke_grant(text, uuid, uuid) to authenticated, anon;

/** Housekeeping for the cron: expired codes and long-dead tokens. */
create or replace function oauth_sweep()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from oauth_authorizations where expires_at < now() - interval '1 day';
  get diagnostics n = row_count;
  delete from oauth_tokens
   where (revoked_at is not null and revoked_at < now() - interval '30 days')
      or (refresh_expires_at is not null and refresh_expires_at < now() - interval '30 days');
  return n;
end $$;
revoke all on function oauth_sweep() from public, anon, authenticated;
grant execute on function oauth_sweep() to service_role;

notify pgrst, 'reload schema';
