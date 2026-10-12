-- ============================================================================
-- 0134_data_source_keys.sql — a workspace's own key for a paid data source.
--
-- Find leads reads OpenStreetMap for free. The source with the most real, live
-- business data is Google's own Places API, which is metered — so, by the same
-- rule as AI (BYO key, never a shared bill), each workspace brings its own key
-- and pays Google directly. Google gives a monthly free allowance per key.
--
-- A key is SEALED by the route before it gets here (lib/crypto/secrets.ts,
-- AES-256-GCM); the database holds ciphertext and a four-character hint, never
-- the key. Setting or removing one is owner/admin only, for the same reason as
-- 0129: a key the whole workspace's searches run on — and are billed to — is
-- not a member's to replace. Any member may see WHETHER one is set (the hint),
-- so the screen can say "connected" instead of asking again.
--
-- get_data_source_secret is the only reader of the ciphertext, service_role
-- only, and checks membership in SQL — so the route cannot forget to, and a
-- workspace id from somebody else's URL gets NOT_A_MEMBER rather than a key.
-- ============================================================================

create table if not exists data_source_keys (
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  source           text not null check (source in ('google_places')),
  key_cipher       text not null,
  key_iv           text not null,
  key_tag          text not null,
  key_hint         text not null default '',
  created_by_privy text,
  updated_at       timestamptz not null default now(),
  primary key (workspace_id, source)
);
alter table data_source_keys enable row level security;
-- No policies: nothing reads this table except through the functions below.

create or replace function data_source_admin(p_privy text, p_workspace uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(workspace_role(p_privy, p_workspace), '') not in ('owner','admin') then
    raise exception 'FORBIDDEN: only an owner or admin can change a data source key';
  end if;
end $$;

create or replace function save_data_source_key(p_privy text, p_workspace uuid, p_source text, p_cipher text, p_iv text, p_tag text, p_hint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform data_source_admin(p_privy, p_workspace);
  if p_source not in ('google_places') then raise exception 'UNKNOWN_SOURCE'; end if;
  if coalesce(p_cipher, '') = '' or coalesce(p_iv, '') = '' or coalesce(p_tag, '') = '' then raise exception 'EMPTY_KEY'; end if;
  insert into data_source_keys (workspace_id, source, key_cipher, key_iv, key_tag, key_hint, created_by_privy, updated_at)
  values (p_workspace, p_source, p_cipher, p_iv, p_tag, left(coalesce(p_hint, ''), 8), p_privy, now())
  on conflict (workspace_id, source) do update set
    key_cipher = excluded.key_cipher, key_iv = excluded.key_iv, key_tag = excluded.key_tag,
    key_hint = excluded.key_hint, created_by_privy = excluded.created_by_privy, updated_at = now();
end $$;

create or replace function delete_data_source_key(p_privy text, p_workspace uuid, p_source text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform data_source_admin(p_privy, p_workspace);
  delete from data_source_keys where workspace_id = p_workspace and source = p_source;
end $$;

-- What a member may know: which sources are connected, and a hint. Never a key.
create or replace function get_data_source_keys(p_privy text, p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('source', source, 'hint', key_hint, 'updated_at', updated_at) order by source)
      from data_source_keys where workspace_id = p_workspace
  ), '[]'::jsonb);
end $$;

-- The ciphertext, for the server route that is about to call the source on the
-- caller's behalf. Membership is checked HERE, not trusted from the route.
create or replace function get_data_source_secret(p_privy text, p_workspace uuid, p_source text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r data_source_keys;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select * into r from data_source_keys where workspace_id = p_workspace and source = p_source;
  if not found then return null; end if;
  return jsonb_build_object('cipher', r.key_cipher, 'iv', r.key_iv, 'tag', r.key_tag);
end $$;

revoke all on table data_source_keys from public, anon, authenticated;

revoke all on function data_source_admin(text, uuid)                                         from public, anon, authenticated;
revoke all on function save_data_source_key(text, uuid, text, text, text, text, text)        from public, anon, authenticated;
revoke all on function delete_data_source_key(text, uuid, text)                              from public, anon, authenticated;
revoke all on function get_data_source_keys(text, uuid)                                      from public, anon, authenticated;
revoke all on function get_data_source_secret(text, uuid, text)                              from public, anon, authenticated;
grant execute on function data_source_admin(text, uuid)                                      to service_role;
grant execute on function save_data_source_key(text, uuid, text, text, text, text, text)     to service_role;
grant execute on function delete_data_source_key(text, uuid, text)                           to service_role;
grant execute on function get_data_source_keys(text, uuid)                                   to service_role;
grant execute on function get_data_source_secret(text, uuid, text)                           to service_role;

notify pgrst, 'reload schema';
