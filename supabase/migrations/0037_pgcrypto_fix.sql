-- ============================================================================
-- RunButter Platform Core — 0037_pgcrypto_fix.sql
-- BUG FIX: "function gen_random_bytes(integer) does not exist" when saving an
-- automation (webhook trigger) or creating an API key.
--
-- ROOT CAUSE: on Supabase, pgcrypto is installed into the `extensions` schema,
-- but our SECURITY DEFINER functions pin `set search_path = public`, so
-- gen_random_bytes()/digest() are invisible at RUNTIME (the migrations passed
-- because the SQL editor's search path includes `extensions`).
--
-- FIX: remove the pgcrypto dependency entirely, using core pg_catalog
-- functions that are visible under any search path:
--   • gen_random_uuid()  — cryptographically strong (pg_strong_random), PG13+
--   • sha256(bytea)      — core since PG11; same output as Node's sha256 hex,
--                          so resolve_api_key and /api auth keep working.
--
-- Additive, idempotent & prod-safe. Depends on 0032–0033. Run AFTER them.
-- ============================================================================

-- save_automation — full redefinition from 0033, token minting via UUID.
create or replace function save_automation(p_privy text, p_workspace uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_tt text := coalesce(nullif(p_data->>'trigger_type',''),'event');
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_id is null then
    insert into automations (workspace_id, owner_privy, name, enabled, trigger_type, object, event, conditions, actions, schedule, webhook_token)
    values (p_workspace, p_privy, coalesce(nullif(p_data->>'name',''),'Untitled automation'),
            coalesce((p_data->>'enabled')::boolean, true), v_tt,
            coalesce(nullif(p_data->>'object',''),'companies'), coalesce(nullif(p_data->>'event',''),'created'),
            coalesce(p_data->'conditions','[]'::jsonb), coalesce(p_data->'actions','[]'::jsonb),
            case when v_tt = 'schedule' then p_data->'schedule' else null end,
            case when v_tt = 'webhook' then 'hook_' || replace(gen_random_uuid()::text, '-', '') else null end)
    returning id into v_id;
  else
    update automations set
      name = coalesce(nullif(p_data->>'name',''), name),
      enabled = coalesce((p_data->>'enabled')::boolean, enabled),
      trigger_type = v_tt,
      object = coalesce(nullif(p_data->>'object',''), object),
      event = coalesce(nullif(p_data->>'event',''), event),
      conditions = coalesce(p_data->'conditions', conditions),
      actions = coalesce(p_data->'actions', actions),
      schedule = case when v_tt = 'schedule' then p_data->'schedule' else null end,
      webhook_token = case when v_tt = 'webhook' then coalesce(webhook_token, 'hook_' || replace(gen_random_uuid()::text, '-', '')) else null end
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_automation(text, uuid, uuid, jsonb) to authenticated, anon;

-- create_api_key — UUID-based key + core sha256 (from 0032).
create or replace function create_api_key(p_privy text, p_workspace uuid, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare v_key text; v_prefix text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  v_key := 'hb_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_prefix := left(v_key, 11);
  insert into api_keys (workspace_id, name, prefix, key_hash, created_by_privy)
  values (p_workspace, coalesce(nullif(p_name,''),'API key'), v_prefix, encode(sha256(v_key::bytea), 'hex'), p_privy);
  return v_key;   -- shown once, never stored in plaintext
end $$;
grant execute on function create_api_key(text, uuid, text) to authenticated, anon;

-- Defensive backfill: any connection that missed its signing secret in 0033.
update connections set secret = 'whsec_' || replace(gen_random_uuid()::text, '-', '') where secret is null or secret = '';

notify pgrst, 'reload schema';
