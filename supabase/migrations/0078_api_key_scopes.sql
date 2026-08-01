-- ============================================================================
-- RunButter — 0078_api_key_scopes.sql
-- Read-only API keys, so a spreadsheet feed URL cannot write.
--
-- WHY THIS EXISTS. Excel's built-in "Get Data → From Web" (Power Query) cannot
-- send an Authorization header from its basic dialog — custom headers need
-- hand-written M code, and Excel Online cannot do them at all. So a feed a
-- non-technical person can actually use has to carry its key in the URL.
--
-- A key in a URL is a bearer credential that ends up in browser history,
-- forwarded emails, screen shares and server logs. That is acceptable for a
-- read-only credential and NOT acceptable for one that can create records. So:
--
--   • keys gain a scope: 'full' (existing behaviour) or 'read'
--   • the feed route accepts a key from the QUERY STRING only when its scope is
--     'read', and never allows a write with a query-string key at all
--
-- The second rule is the important one, and it lives in the route rather than
-- here: even a 'full' key pasted into a URL cannot write, because the transport
-- itself is treated as untrusted. That bounds URL leakage structurally instead
-- of relying on the user to have picked the right key type.
--
-- Existing keys default to 'full', so nothing changes for current integrations.
-- Additive, idempotent & prod-safe.
-- ============================================================================

alter table api_keys add column if not exists scope text not null default 'full';
do $$ begin
  alter table api_keys add constraint api_keys_scope_check check (scope in ('full', 'read'));
exception when duplicate_object then null; end $$;

-- ── Create, with a scope ─────────────────────────────────────────────────────
-- Adding a parameter would create an OVERLOAD rather than replace the function,
-- so the three-argument version is dropped first. Anon EXECUTE is revoked (0046)
-- and every caller goes through /api/rpc, so nothing is pinned to the old shape.
drop function if exists create_api_key(text, uuid, text);

create or replace function create_api_key(
  p_privy text, p_workspace uuid, p_name text, p_scope text default 'full'
) returns text language plpgsql security definer set search_path = public as $$
declare v_key text; v_prefix text; v_scope text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Anything unrecognised becomes 'read', not 'full'. A typo in a scope must
  -- never widen a credential.
  v_scope := case when p_scope = 'full' then 'full' else 'read' end;
  v_key := 'hb_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_prefix := left(v_key, 11);
  insert into api_keys (workspace_id, name, prefix, key_hash, scope, created_by_privy)
  values (p_workspace, coalesce(nullif(p_name,''),'API key'), v_prefix,
          encode(sha256(v_key::bytea), 'hex'), v_scope, p_privy);
  return v_key;   -- shown once, never stored in plaintext
end $$;
grant execute on function create_api_key(text, uuid, text, text) to authenticated, anon;

-- ── Resolve, returning the scope ─────────────────────────────────────────────
create or replace function resolve_api_key(p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row api_keys;
begin
  select * into v_row from api_keys where key_hash = p_hash and revoked = false limit 1;
  if v_row.id is null then return null; end if;
  update api_keys set last_used_at = now() where id = v_row.id;
  return jsonb_build_object(
    'id', v_row.id, 'workspace_id', v_row.workspace_id,
    'owner_privy', v_row.created_by_privy,
    -- coalesce, not v_row.scope alone: a key created before this migration has
    -- the column default, but being explicit means a future nullable column
    -- cannot silently resolve to an empty scope the route then mis-reads.
    'scope', coalesce(v_row.scope, 'full')
  );
end $$;
revoke all on function resolve_api_key(text) from public, authenticated, anon;
grant execute on function resolve_api_key(text) to service_role;

-- ── List, showing the scope ──────────────────────────────────────────────────
create or replace function get_api_keys(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', k.id, 'name', k.name, 'prefix', k.prefix, 'scope', coalesce(k.scope, 'full'),
    'last_used_at', k.last_used_at, 'revoked', k.revoked, 'created_at', k.created_at
  ) order by k.created_at desc) from api_keys k where k.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_api_keys(text, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
