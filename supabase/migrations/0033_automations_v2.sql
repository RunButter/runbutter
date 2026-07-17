-- ============================================================================
-- RunButter Platform Core — 0033_automations_v2.sql
-- Automations + integrations, phase 2. Borrows the proven patterns:
--   • Activepieces-style trigger types — record event, INCOMING WEBHOOK, schedule
--   • Svix-style webhook delivery — HMAC signing secret, retries, delivery log
--
-- Extends 0032 (additive ALTERs, redefines a few RPCs). Idempotent & prod-safe.
-- Depends on 0001–0032. Run AFTER them.
-- ============================================================================

create extension if not exists pgcrypto;

-- automations: trigger type + inbound webhook token + schedule + last_run
alter table automations add column if not exists trigger_type text not null default 'event';  -- event | webhook | schedule
alter table automations add column if not exists webhook_token text;
alter table automations add column if not exists schedule jsonb;    -- { every: 'minute'|'hour'|'day', at?: 'HH:MM' }
alter table automations add column if not exists last_run_at timestamptz;
create unique index if not exists idx_automations_webhook_token on automations(webhook_token) where webhook_token is not null;
create index if not exists idx_automations_schedule on automations(trigger_type) where trigger_type = 'schedule';

-- connections: per-endpoint signing secret (Svix style)
alter table connections add column if not exists secret text;
update connections set secret = 'whsec_' || encode(gen_random_bytes(24), 'hex') where secret is null;

-- events: direct-target automation, retry/backoff, source, error
alter table automation_events add column if not exists automation_id uuid;   -- set for webhook/schedule (direct) events
alter table automation_events add column if not exists source text not null default 'trigger';  -- trigger | webhook | schedule
alter table automation_events add column if not exists next_attempt_at timestamptz;
alter table automation_events add column if not exists last_error text;

-- webhook delivery log (Svix-style observability + retry)
create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connection_id uuid,
  automation_id uuid,
  url text,
  status text not null default 'pending',   -- ok | failed
  response_code int,
  attempts int not null default 1,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists idx_webhook_deliveries_ws on webhook_deliveries(workspace_id, created_at desc);
alter table webhook_deliveries enable row level security;

-- ============================================================================
-- Redefined user RPCs — carry the new fields.
-- ============================================================================
create or replace function get_automations(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'enabled', a.enabled, 'trigger_type', a.trigger_type,
    'object', a.object, 'event', a.event, 'conditions', a.conditions, 'actions', a.actions,
    'webhook_token', a.webhook_token, 'schedule', a.schedule, 'updated_at', a.updated_at
  ) order by a.created_at desc) from automations a where a.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_automations(text, uuid) to authenticated, anon;

-- save_automation v2 — trigger_type/schedule; auto-mint a webhook token when needed.
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
            case when v_tt = 'webhook' then 'hook_' || encode(gen_random_bytes(18),'hex') else null end)
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
      -- mint a token the first time a rule becomes a webhook trigger; keep it otherwise
      webhook_token = case when v_tt = 'webhook' then coalesce(webhook_token, 'hook_' || encode(gen_random_bytes(18),'hex')) else null end
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_automation(text, uuid, uuid, jsonb) to authenticated, anon;

-- get_connections v2 — include the signing secret (owner needs it to verify).
create or replace function get_connections(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', c.id, 'label', c.label, 'kind', c.kind, 'url', c.url, 'is_active', c.is_active, 'secret', c.secret
  ) order by c.created_at) from connections c where c.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_connections(text, uuid) to authenticated, anon;

create or replace function get_webhook_deliveries(p_privy text, p_workspace uuid, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', d.id, 'url', d.url, 'status', d.status, 'response_code', d.response_code, 'attempts', d.attempts, 'detail', d.detail, 'created_at', d.created_at
  ) order by d.created_at desc) from (
    select * from webhook_deliveries where workspace_id = p_workspace order by created_at desc limit greatest(1, least(coalesce(p_limit,20), 100))
  ) d), '[]'::jsonb);
end $$;
grant execute on function get_webhook_deliveries(text, uuid, int) to authenticated, anon;

-- ============================================================================
-- System RPCs (service_role only) — dispatcher, inbound webhook, scheduler.
-- ============================================================================

-- Inbound webhook trigger: external tools POST to /api/hooks/<token>.
create or replace function enqueue_webhook_event(p_token text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a automations;
begin
  select * into a from automations where webhook_token = p_token and enabled limit 1;
  if a.id is null then return null; end if;
  insert into automation_events (workspace_id, object, event, record_id, payload, source, automation_id)
  values (a.workspace_id, coalesce(a.object,'webhook'), 'webhook', null, coalesce(p_payload,'{}'::jsonb), 'webhook', a.id);
  return jsonb_build_object('ok', true, 'automation', a.name);
end $$;
revoke all on function enqueue_webhook_event(text, jsonb) from public, authenticated, anon;
grant execute on function enqueue_webhook_event(text, jsonb) to service_role;

-- Scheduler: enqueue due schedule automations. Cron calls this then the dispatcher.
create or replace function enqueue_scheduled_automations()
returns int language plpgsql security definer set search_path = public as $$
declare a automations; n int := 0; v_due boolean;
begin
  for a in select * from automations where trigger_type = 'schedule' and enabled loop
    v_due := case coalesce(a.schedule->>'every','day')
      when 'minute' then a.last_run_at is null or a.last_run_at < now() - interval '1 minute'
      when 'hour'   then a.last_run_at is null or a.last_run_at < now() - interval '1 hour'
      else a.last_run_at is null or a.last_run_at < now() - interval '1 day'
    end;
    if v_due then
      insert into automation_events (workspace_id, object, event, payload, source, automation_id)
      values (a.workspace_id, coalesce(a.object,'schedule'), 'schedule', jsonb_build_object('now', now()), 'schedule', a.id);
      update automations set last_run_at = now() where id = a.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function enqueue_scheduled_automations() from public, authenticated, anon;
grant execute on function enqueue_scheduled_automations() to service_role;

-- claim v2 — respect retry backoff (next_attempt_at).
create or replace function claim_automation_events(p_max int default 25)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with picked as (
    select id from automation_events
    where status = 'pending' and (next_attempt_at is null or next_attempt_at <= now())
    order by created_at limit greatest(1, least(coalesce(p_max,25), 100)) for update skip locked
  ), upd as (
    update automation_events e set status = 'processing', attempts = e.attempts + 1
    from picked where e.id = picked.id returning e.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'workspace_id', workspace_id, 'object', object, 'event', event, 'record_id', record_id,
    'payload', payload, 'source', source, 'automation_id', automation_id, 'attempts', attempts
  )), '[]'::jsonb) into v from upd;
  return v;
end $$;
revoke all on function claim_automation_events(int) from public, authenticated, anon;
grant execute on function claim_automation_events(int) to service_role;

-- Requeue a failed event with backoff (dispatcher decides max attempts).
create or replace function retry_automation_event(p_id uuid, p_backoff_seconds int, p_err text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update automation_events set status = 'pending', next_attempt_at = now() + (p_backoff_seconds || ' seconds')::interval, last_error = p_err where id = p_id;
end $$;
revoke all on function retry_automation_event(uuid, int, text) from public, authenticated, anon;
grant execute on function retry_automation_event(uuid, int, text) to service_role;

-- Fetch a single automation (for webhook/schedule direct-target events).
create or replace function get_automation_by_id(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return (select jsonb_build_object('id', a.id, 'name', a.name, 'owner_privy', a.owner_privy, 'workspace_id', a.workspace_id, 'conditions', a.conditions, 'actions', a.actions)
          from automations a where a.id = p_id and a.enabled);
end $$;
revoke all on function get_automation_by_id(uuid) from public, authenticated, anon;
grant execute on function get_automation_by_id(uuid) to service_role;

-- Connection with its signing secret (supersedes get_connection_url).
create or replace function get_connection(p_workspace uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return (select jsonb_build_object('id', id, 'label', label, 'url', url, 'secret', secret)
          from connections where id = p_id and workspace_id = p_workspace and is_active);
end $$;
revoke all on function get_connection(uuid, uuid) from public, authenticated, anon;
grant execute on function get_connection(uuid, uuid) to service_role;

create or replace function log_webhook_delivery(p_workspace uuid, p_connection uuid, p_automation uuid, p_url text, p_status text, p_code int, p_attempts int, p_detail text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into webhook_deliveries (workspace_id, connection_id, automation_id, url, status, response_code, attempts, detail)
  values (p_workspace, p_connection, p_automation, p_url, coalesce(nullif(p_status,''),'ok'), p_code, coalesce(p_attempts,1), p_detail);
end $$;
revoke all on function log_webhook_delivery(uuid, uuid, uuid, text, text, int, int, text) from public, authenticated, anon;
grant execute on function log_webhook_delivery(uuid, uuid, uuid, text, text, int, int, text) to service_role;

notify pgrst, 'reload schema';
