-- ============================================================================
-- RunButter Platform Core — 0035_automation_hardening.sql
-- Fixes an automation-recursion hazard and adds the wrapper RPCs the
-- dispatcher uses for record actions.
--
-- THE BUG: emit_automation_event() fires on every INSERT/UPDATE. If a rule's
-- action mutates the same object it triggers on (e.g. "invoices updated →
-- update this record", or "X created → create X"), the action's write enqueues
-- a fresh event that matches the same rule → infinite loop, growing the outbox
-- forever.
--
-- THE FIX: dispatcher record-actions run through wrapper RPCs that set a
-- transaction-local flag (set_config(..., is_local => true)); the trigger
-- skips enqueueing when the flag is present in the same transaction. Manual /
-- app / API writes are unaffected.
--
-- Additive, idempotent & prod-safe. Depends on 0032–0033. Run AFTER them.
-- ============================================================================

-- Trigger v2 — skip writes made BY an automation action.
create or replace function emit_automation_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ws uuid := NEW.workspace_id;
begin
  if coalesce(current_setting('app.automation_depth', true), '') = '1' then return NEW; end if;
  if exists (select 1 from automations a where a.workspace_id = v_ws and a.enabled and a.object = TG_ARGV[0]) then
    insert into automation_events (workspace_id, object, event, record_id, payload)
    values (v_ws, TG_ARGV[0], case when TG_OP = 'INSERT' then 'created' else 'updated' end, NEW.id, to_jsonb(NEW));
  end if;
  return NEW;
end $$;

-- Wrapper RPCs (service_role only): same create/update as the app, but flagged
-- so the trigger won't re-enqueue. Same transaction ⇒ the local flag reaches
-- the trigger; it evaporates at commit.
create or replace function automation_create_record(p_privy text, p_workspace uuid, p_object text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.automation_depth', '1', true);
  return create_record(p_privy, p_workspace, p_object, p_data);
end $$;
revoke all on function automation_create_record(text, uuid, text, jsonb) from public, authenticated, anon;
grant execute on function automation_create_record(text, uuid, text, jsonb) to service_role;

create or replace function automation_update_record(p_privy text, p_object text, p_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.automation_depth', '1', true);
  perform update_record(p_privy, p_object, p_id, p_data);
end $$;
revoke all on function automation_update_record(text, text, uuid, jsonb) from public, authenticated, anon;
grant execute on function automation_update_record(text, text, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
