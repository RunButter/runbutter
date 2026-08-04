-- ============================================================================
-- RunButter — 0082_social_accounts.sql
-- OAuth grants for publishing to social platforms.
--
-- WHY THIS IS BUILT AND NOT BORROWED. Postiz solves exactly this problem and
-- solves it well, but it is AGPL-3.0 — copying a provider adapter, a schema or
-- a scheduler out of it would relicense this repository. So Postiz is read as a
-- feature specification and nothing else. Concepts are not copyrightable; its
-- source is.
--
-- WHY NATIVE RATHER THAN RUNNING POSTIZ ALONGSIDE. Aggregating it as a separate
-- service is legal and was the obvious shortcut, but it means every self-hoster
-- deploys a second app, a second Postgres and a second set of OAuth apps — the
-- opposite of the one-relational-core pitch. A post is already a row here.
--
-- TOKENS ARE SEALED AT REST, like 0079's `ms_connections` and unlike the older
-- `integration_tokens` rows. The reasoning is the same and it is not paranoia:
-- a leaked posting grant lets someone post AS the company, to that company's
-- real audience, and there is no undo for that.
--
-- THE RPCs BELOW NEVER RETURN A TOKEN. `get_social_accounts` selects the
-- display fields only; the cipher columns are readable exactly once, by
-- `get_social_token`, which is service_role and deliberately absent from
-- /api/rpc's ALLOWED — same rule as `claim_excel_links`. A browser that could
-- read a token could post from anywhere.
--
-- Depends on 0001 (workspaces). Additive, idempotent & prod-safe.
-- ============================================================================

create table if not exists social_accounts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  -- 'linkedin' | 'x'. Free text with a CHECK rather than an enum: adding a
  -- provider should be one migration line, not an ALTER TYPE.
  provider       text not null,
  -- The platform's own id for the page/profile being posted to. Part of the
  -- uniqueness key, because one person may connect a personal profile AND a
  -- company page from the same login.
  external_id    text not null,
  display_name   text not null default '',
  avatar_url     text,

  -- Sealed with SECRETS_MASTER_KEY (AES-256-GCM). Never selected by any RPC a
  -- browser can reach.
  access_cipher  text, access_iv text, access_tag text,
  refresh_cipher text, refresh_iv text, refresh_tag text,
  expires_at     timestamptz,
  scope          text,

  -- Who authorised it. Kept for the audit trail: "who connected this account"
  -- is the first question asked when something unexpected gets posted.
  connected_by_privy text,
  enabled        boolean not null default true,
  -- Set when the platform rejects the token, so the UI can say "reconnect"
  -- rather than failing every scheduled post in silence.
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, provider, external_id)
);

do $$ begin
  alter table social_accounts add constraint social_accounts_provider_check
    check (provider in ('linkedin', 'x'));
exception when duplicate_object then null; end $$;

create index if not exists idx_social_accounts_ws on social_accounts(workspace_id, provider);

drop trigger if exists trg_social_accounts_upd on social_accounts;
create trigger trg_social_accounts_upd before update on social_accounts
  for each row execute function set_updated_at();

alter table social_accounts enable row level security;
revoke all on table social_accounts from anon, authenticated;

-- ── Reads a browser may make ────────────────────────────────────────────────
-- Display fields only. Adding a token column to this SELECT is the single
-- change that would turn a workspace member into someone who can post from
-- anywhere, so it is called out here rather than left to review.
create or replace function get_social_accounts(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'provider', a.provider, 'display_name', a.display_name,
    'avatar_url', a.avatar_url, 'enabled', a.enabled,
    -- An expired token is not an error yet — it is refreshed on use. Surfaced
    -- so the UI can distinguish "needs reconnecting" from "never worked".
    'expired', a.expires_at is not null and a.expires_at < now(),
    'last_error', a.last_error, 'created_at', a.created_at
  ) order by a.provider, a.display_name) from social_accounts a
   where a.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_social_accounts(text, uuid) to authenticated, anon;

create or replace function set_social_account_enabled(
  p_privy text, p_workspace uuid, p_id uuid, p_enabled boolean
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update social_accounts set enabled = coalesce(p_enabled, enabled)
   where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function set_social_account_enabled(text, uuid, uuid, boolean) to authenticated, anon;

-- Disconnecting deletes the grant rather than disabling it. A revoked token
-- kept "just in case" is a credential nobody is watching any more.
create or replace function delete_social_account(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  delete from social_accounts where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function delete_social_account(text, uuid, uuid) to authenticated, anon;

-- ── service_role only: the OAuth callback and the dispatcher ────────────────
-- Upsert on (workspace, provider, external_id): re-authorising the same page
-- must REPLACE the token, not accumulate a second row that then races the
-- first. `last_error` clears on a successful reconnect — that is what makes
-- "reconnect" a fix rather than a second broken row.
create or replace function save_social_account(
  p_workspace uuid, p_provider text, p_external_id text, p_display_name text,
  p_avatar_url text,
  p_access_cipher text, p_access_iv text, p_access_tag text,
  p_refresh_cipher text, p_refresh_iv text, p_refresh_tag text,
  p_expires_at timestamptz, p_scope text, p_privy text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into social_accounts (
    workspace_id, provider, external_id, display_name, avatar_url,
    access_cipher, access_iv, access_tag,
    refresh_cipher, refresh_iv, refresh_tag,
    expires_at, scope, connected_by_privy, enabled, last_error
  ) values (
    p_workspace, p_provider, p_external_id, coalesce(p_display_name, ''), p_avatar_url,
    p_access_cipher, p_access_iv, p_access_tag,
    p_refresh_cipher, p_refresh_iv, p_refresh_tag,
    p_expires_at, p_scope, p_privy, true, null
  )
  on conflict (workspace_id, provider, external_id) do update
     set display_name   = excluded.display_name,
         avatar_url     = excluded.avatar_url,
         access_cipher  = excluded.access_cipher,
         access_iv      = excluded.access_iv,
         access_tag     = excluded.access_tag,
         -- A provider that does not re-issue a refresh token on reconnect must
         -- not blank the one we already hold, or the account silently becomes
         -- unrefreshable at the next expiry.
         refresh_cipher = coalesce(excluded.refresh_cipher, social_accounts.refresh_cipher),
         refresh_iv     = coalesce(excluded.refresh_iv,     social_accounts.refresh_iv),
         refresh_tag    = coalesce(excluded.refresh_tag,    social_accounts.refresh_tag),
         expires_at     = excluded.expires_at,
         scope          = excluded.scope,
         enabled        = true,
         last_error     = null
  returning id into v_id;
  return v_id;
end $$;
revoke all on function save_social_account(uuid, text, text, text, text, text, text, text, text, text, text, timestamptz, text, text)
  from public, authenticated, anon;
grant execute on function save_social_account(uuid, text, text, text, text, text, text, text, text, text, text, timestamptz, text, text)
  to service_role;

create or replace function get_social_token(p_account uuid)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'workspace_id', a.workspace_id, 'provider', a.provider,
    'external_id', a.external_id,
    'access_cipher', a.access_cipher, 'access_iv', a.access_iv, 'access_tag', a.access_tag,
    'refresh_cipher', a.refresh_cipher, 'refresh_iv', a.refresh_iv, 'refresh_tag', a.refresh_tag,
    'expires_at', a.expires_at
  ) from social_accounts a where a.id = p_account and a.enabled;
$$;
revoke all on function get_social_token(uuid) from public, authenticated, anon;
grant execute on function get_social_token(uuid) to service_role;

-- Written by the dispatcher when a platform rejects the grant. Separate from
-- `save_social_account` so a failure never touches the token itself: the fix
-- for "expired" is a reconnect, and clobbering the row here would lose the
-- refresh token that might still work.
create or replace function record_social_account_error(p_account uuid, p_error text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update social_accounts set last_error = left(coalesce(p_error, ''), 500)
   where id = p_account;
  return found;
end $$;
revoke all on function record_social_account_error(uuid, text) from public, authenticated, anon;
grant execute on function record_social_account_error(uuid, text) to service_role;

notify pgrst, 'reload schema';
