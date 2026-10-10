-- ============================================================================
-- 0132_automations_v3.sql — automations that fire when they should, and only then.
--
-- An audit of 0032/0033/0035 against what people actually build found five
-- defects, all silent:
--
-- 1. SCHEDULE AND WEBHOOK AUTOMATIONS ALSO RAN ON RECORD EVENTS.
--    get_event_automations matched on object + event and never looked at
--    trigger_type, and save_automation stores object 'companies' / event
--    'created' as defaults for every trigger. So a "daily digest" ALSO fired
--    every time someone added a company, and the shipped "Incoming webhook →
--    new contact" template (object people / created) copied every contact a
--    person added — the new row's own {{first_name}} into a second row.
--
-- 2. "WHEN STATUS IS PAID" FIRED ON EVERY EDIT OF A PAID INVOICE. Conditions
--    saw only the new row, so there was no way to say "changes to". Events now
--    carry `_previous` and the dispatcher understands `changed` /
--    `changed_to`. A write that changed nothing a person would see (only
--    updated_at, or a card's position in its column) is not an event at all.
--
-- 3. ASSETS WERE OFFERED AS A TRIGGER AND NOTHING FIRED: 0032 attached the
--    emitter to nine tables and the builder listed ten. Deals, orders, custom
--    objects, form submissions, support conversations and candidates — the
--    events people ask for first — had no trigger either. They do now.
--
-- 4. "EVERY DAY" IGNORED THE TIME. schedule.at was stored and never read, so a
--    daily automation ran 24h after whenever it last happened to run. Day and
--    week schedules now run at their time, in the timezone the person picked.
--    The loop also takes row locks (SKIP LOCKED), so two app servers ticking
--    at once cannot both enqueue the same schedule.
--
-- 5. ANYONE COULD EDIT ANYONE'S AUTOMATION, AND IT KEPT RUNNING AS THEM.
--    Actions run as owner_privy; editing kept the original owner. A viewer
--    could rewrite an admin's rule and have it act with the admin's rights.
--    Viewers can no longer create, edit, switch or delete automations, and an
--    edit makes the editor the owner — it runs as whoever last saved it.
--
-- Also: test_automation (run one now, against the latest real record), and
-- the list returns each automation's last run so a broken one is visible
-- without opening a log.
-- ============================================================================

-- ── Payload: the row as a person would name its fields ──────────────────────
-- Secrets and search indexes never travel: a payload goes into emails, webhook
-- bodies, AI prompts and the run log. A visitor's token hash or a candidate's
-- portal token in any of those is a leak; a tsvector is just noise.
create or replace function automation_payload(p_slug text, p_table text, p_row jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := coalesce(p_row, '{}'::jsonb) - 'token_hash' - 'access_token' - 'key_hash'
                   - 'secret' - 'webhook_token' - 'resume_tsv' - 'resume_raw_text' - 'search_tsv' - 'fts';
begin
  if p_table = 'custom_records' then
    -- A custom object's fields live in `data`; flatten them so {{vin}} works.
    return coalesce(v->'data', '{}'::jsonb) || jsonb_build_object(
      'id', v->'id', 'created_at', v->'created_at', 'updated_at', v->'updated_at');
  elsif p_table = 'form_submissions' then
    return coalesce(v->'data', '{}'::jsonb) || jsonb_build_object(
      'id', v->'id', 'person_id', v->'person_id', 'created_at', v->'created_at',
      'form', (select f.name from forms f where f.id = (v->>'form_id')::uuid));
  elsif p_table = 'pipeline_records' then
    return v || jsonb_build_object(
      'stage', (select s.name from pipeline_stages s where s.id = (v->>'stage_id')::uuid),
      'company', (select o.name from organizations o where o.id = (v->>'company_id')::uuid),
      'pipeline', (select p.kind from pipelines p where p.id = (v->>'pipeline_id')::uuid));
  elsif p_table = 'support_conversations' then
    return v || jsonb_build_object('message', v->'subject');
  elsif p_table = 'candidates' then
    return v || jsonb_build_object('position',
      (select po.title from positions po where po.id = (v->>'position_id')::uuid));
  elsif v ? 'organization_id' then
    -- Invoices, orders, people…: the company by NAME, so an email can say it.
    return v || jsonb_build_object('company',
      coalesce((select o.name from organizations o where o.id = (v->>'organization_id')::uuid), v->>'company'));
  end if;
  return v;
end $$;

-- ── The emitter, v3 ─────────────────────────────────────────────────────────
create or replace function emit_automation_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_new jsonb := to_jsonb(NEW); v_old jsonb; v_ws uuid; v_slug text := TG_ARGV[0];
        v_event text := case when TG_OP = 'INSERT' then 'created' else 'updated' end;
        v_payload jsonb;
begin
  -- An automation's own writes never fire automations (0035's recursion guard).
  if coalesce(current_setting('app.automation_depth', true), '') = '1' then return NEW; end if;
  -- Candidates are tenanted by company_id, which IS the workspace id (0005).
  v_ws := coalesce(nullif(v_new->>'workspace_id', '')::uuid, nullif(v_new->>'company_id', '')::uuid);
  if v_ws is null then return NEW; end if;
  if v_slug = '__custom__' then
    select o.slug into v_slug from custom_objects o where o.id = (v_new->>'object_id')::uuid;
    if v_slug is null then return NEW; end if;
  end if;
  if not exists (select 1 from automations a
                  where a.workspace_id = v_ws and a.enabled and a.trigger_type = 'event'
                    and a.object = v_slug and a.event = v_event) then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    v_old := to_jsonb(OLD);
    -- Nothing a person would notice changed: not an event.
    if (v_new - 'updated_at' - 'position') = (v_old - 'updated_at' - 'position') then return NEW; end if;
  end if;
  v_payload := automation_payload(v_slug, TG_TABLE_NAME, v_new);
  if v_old is not null then
    v_payload := v_payload || jsonb_build_object('_previous', automation_payload(v_slug, TG_TABLE_NAME, v_old));
  end if;
  insert into automation_events (workspace_id, object, event, record_id, payload)
  values (v_ws, v_slug, v_event, NEW.id, v_payload);
  return NEW;
end $$;

-- The tables 0032 left out. Inserts only where an update means nothing to a
-- person (a form submission is never edited).
do $$
declare r record;
begin
  for r in select * from (values
    ('assets', 'assets', 'insert or update'),
    ('pipeline_records', 'deals', 'insert or update'),
    ('orders', 'orders', 'insert or update'),
    ('custom_records', '__custom__', 'insert or update'),
    ('form_submissions', 'form_submissions', 'insert'),
    ('support_conversations', 'conversations', 'insert or update'),
    ('candidates', 'candidates', 'insert or update')
  ) as x(tbl, slug, ops) loop
    if to_regclass('public.' || r.tbl) is null then continue; end if;
    execute format('drop trigger if exists trg_autoevt_%1$s on %1$s;', r.tbl);
    execute format('create trigger trg_autoevt_%1$s after %3$s on %1$s for each row execute function emit_automation_event(%2$L);',
                   r.tbl, r.slug, r.ops);
  end loop;
end $$;

-- ── Matching: event automations only (defect 1) ─────────────────────────────
create or replace function get_event_automations(p_workspace uuid, p_object text, p_event text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'owner_privy', a.owner_privy, 'enabled', a.enabled,
    'conditions', a.conditions, 'actions', a.actions
  )) from automations a
   where a.workspace_id = p_workspace and a.enabled and a.trigger_type = 'event'
     and a.object = p_object and a.event = p_event), '[]'::jsonb);
end $$;

-- Returned whether or not it is enabled: a TEST of a switched-off automation
-- must still run. The dispatcher skips a disabled rule for every other source.
create or replace function get_automation_by_id(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return (select jsonb_build_object('id', a.id, 'name', a.name, 'owner_privy', a.owner_privy,
            'workspace_id', a.workspace_id, 'enabled', a.enabled, 'trigger_type', a.trigger_type,
            'object', a.object, 'conditions', a.conditions, 'actions', a.actions)
          from automations a where a.id = p_id);
end $$;

-- ── Schedules that keep their time (defect 4) ───────────────────────────────
create or replace function automation_schedule_due(p_schedule jsonb, p_last timestamptz)
returns boolean language plpgsql stable set search_path = public as $$
declare v_every text := coalesce(p_schedule->>'every', 'day');
        v_tz text := coalesce(nullif(p_schedule->>'tz', ''), 'UTC');
        v_at time; v_local timestamp; v_target timestamp; v_last_local timestamp;
begin
  if not exists (select 1 from pg_timezone_names where name = v_tz) then v_tz := 'UTC'; end if;
  if v_every = 'minute' then return p_last is null or p_last <= now() - interval '55 seconds'; end if;
  if v_every = 'hour'   then return p_last is null or p_last <= now() - interval '59 minutes'; end if;

  -- day / week without a time: the old "24h since last" behaviour, kept so
  -- automations saved before 0132 keep their rhythm.
  if coalesce(p_schedule->>'at', '') !~ '^\d{1,2}:\d{2}$' then
    return p_last is null or p_last <= now() - case when v_every = 'week' then interval '7 days' else interval '1 day' end + interval '1 minute';
  end if;
  v_at := (p_schedule->>'at')::time;
  v_local := now() at time zone v_tz;
  v_target := date_trunc('day', v_local) + v_at;
  if v_every = 'week' and extract(dow from v_local)::int <> coalesce((p_schedule->>'day')::int, 1) then return false; end if;
  if v_local < v_target then return false; end if;
  v_last_local := p_last at time zone v_tz;
  return p_last is null or v_last_local < v_target;
end $$;

create or replace function enqueue_scheduled_automations()
returns int language plpgsql security definer set search_path = public as $$
declare a automations; n int := 0;
begin
  -- SKIP LOCKED: two app servers ticking in the same second must not both
  -- enqueue the same schedule.
  for a in select * from automations where trigger_type = 'schedule' and enabled for update skip locked loop
    if automation_schedule_due(coalesce(a.schedule, '{}'::jsonb), a.last_run_at) then
      insert into automation_events (workspace_id, object, event, payload, source, automation_id)
      values (a.workspace_id, 'schedule', 'schedule', jsonb_build_object('now', now()), 'schedule', a.id);
      update automations set last_run_at = now() where id = a.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ── Who may change an automation (defect 5) ─────────────────────────────────
create or replace function automation_editor(p_privy text, p_workspace uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(workspace_role(p_privy, p_workspace), 'member') = 'viewer' then
    raise exception 'FORBIDDEN: viewers cannot change automations';
  end if;
end $$;

create or replace function automation_clean_schedule(p jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'every', case when p->>'every' in ('minute','hour','day','week') then p->>'every' else 'day' end,
    'at',    case when p->>'at' ~ '^\d{1,2}:\d{2}$' then p->>'at' end,
    'day',   case when p->>'day' ~ '^[0-6]$' then (p->>'day')::int end,
    'tz',    case when length(coalesce(p->>'tz','')) between 1 and 64 then p->>'tz' end));
$$;

create or replace function save_automation(p_privy text, p_workspace uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
        v_tt text := case when p_data->>'trigger_type' in ('event','webhook','schedule') then p_data->>'trigger_type' else 'event' end;
        v_event text := case when p_data->>'event' in ('created','updated') then p_data->>'event' else 'created' end;
begin
  perform automation_editor(p_privy, p_workspace);
  if jsonb_typeof(coalesce(p_data->'actions', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_data->'actions', '[]'::jsonb)) > 10 then
    raise exception 'BAD_ACTIONS: up to 10 actions';
  end if;
  if jsonb_typeof(coalesce(p_data->'conditions', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_data->'conditions', '[]'::jsonb)) > 10 then
    raise exception 'BAD_CONDITIONS: up to 10 conditions';
  end if;
  if p_id is null then
    -- Create only — an existing automation stays editable and switchable off
    -- whatever the plan says (0126).
    perform enforce_plan_limit(p_workspace, 'automations',
      (select count(*) from automations where workspace_id = p_workspace), 1);
    insert into automations (workspace_id, owner_privy, name, enabled, trigger_type, object, event, conditions, actions, schedule, webhook_token)
    values (p_workspace, p_privy, coalesce(nullif(left(btrim(p_data->>'name'), 120), ''), 'Untitled automation'),
            coalesce((p_data->>'enabled')::boolean, true), v_tt,
            -- Object and event mean something only for an event trigger; the
            -- others store a neutral value so nothing can match them by accident.
            case when v_tt = 'event' then coalesce(nullif(p_data->>'object', ''), 'companies') else v_tt end,
            case when v_tt = 'event' then v_event else v_tt end,
            coalesce(p_data->'conditions', '[]'::jsonb), coalesce(p_data->'actions', '[]'::jsonb),
            case when v_tt = 'schedule' then automation_clean_schedule(coalesce(p_data->'schedule', '{}'::jsonb)) end,
            case when v_tt = 'webhook' then 'hook_' || replace(gen_random_uuid()::text, '-', '') end)
    returning id into v_id;
  else
    update automations set
      -- It runs as whoever last saved it. Keeping the original owner let an
      -- edit borrow somebody else's rights.
      owner_privy = p_privy,
      name = coalesce(nullif(left(btrim(p_data->>'name'), 120), ''), name),
      enabled = coalesce((p_data->>'enabled')::boolean, enabled),
      trigger_type = v_tt,
      object = case when v_tt = 'event' then coalesce(nullif(p_data->>'object', ''), object) else v_tt end,
      event = case when v_tt = 'event' then v_event else v_tt end,
      conditions = coalesce(p_data->'conditions', conditions),
      actions = coalesce(p_data->'actions', actions),
      schedule = case when v_tt = 'schedule' then automation_clean_schedule(coalesce(p_data->'schedule', schedule, '{}'::jsonb)) end,
      webhook_token = case when v_tt = 'webhook' then coalesce(webhook_token, 'hook_' || replace(gen_random_uuid()::text, '-', '')) end
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

create or replace function set_automation_enabled(p_privy text, p_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from automations where id = p_id;
  if v_ws is null then raise exception 'NOT_FOUND'; end if;
  perform automation_editor(p_privy, v_ws);
  update automations set enabled = p_enabled where id = p_id;
end $$;

create or replace function delete_automation(p_privy text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from automations where id = p_id;
  if v_ws is null then return; end if;
  perform automation_editor(p_privy, v_ws);
  delete from automations where id = p_id;
end $$;

-- Existing rows saved with the old defaults: neutralise object/event on
-- non-event triggers so they can never match a record event again.
update automations set object = trigger_type, event = trigger_type
 where trigger_type in ('webhook', 'schedule') and (object <> trigger_type or event <> trigger_type);

-- ── Test: run one now (against the latest real record) ─────────────────────
-- A whitelist CASE, never dynamic SQL from a slug — same rule as segment_match.
create or replace function automation_sample_row(p_workspace uuid, p_object text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_table text;
begin
  case p_object
    when 'companies' then select to_jsonb(t), 'organizations' into v, v_table from organizations t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'people' then select to_jsonb(t), 'people' into v, v_table from people t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'invoices' then select to_jsonb(t), 'invoices' into v, v_table from invoices t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'expenses' then select to_jsonb(t), 'expenses' into v, v_table from expenses t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'transactions' then select to_jsonb(t), 'transactions' into v, v_table from transactions t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'products' then select to_jsonb(t), 'products' into v, v_table from products t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'campaigns' then select to_jsonb(t), 'campaigns' into v, v_table from campaigns t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'projects' then select to_jsonb(t), 'projects' into v, v_table from projects t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'issues' then select to_jsonb(t), 'issues' into v, v_table from issues t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'assets' then select to_jsonb(t), 'assets' into v, v_table from assets t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'deals' then select to_jsonb(t), 'pipeline_records' into v, v_table from pipeline_records t
                       join pipelines p on p.id = t.pipeline_id and p.kind = 'sales'
                      where t.workspace_id = p_workspace order by t.created_at desc limit 1;
    when 'orders' then select to_jsonb(t), 'orders' into v, v_table from orders t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'form_submissions' then select to_jsonb(t), 'form_submissions' into v, v_table from form_submissions t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'conversations' then select to_jsonb(t), 'support_conversations' into v, v_table from support_conversations t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'candidates' then select to_jsonb(t), 'candidates' into v, v_table from candidates t where company_id = p_workspace order by applied_at desc limit 1;
    else
      select to_jsonb(t), 'custom_records' into v, v_table from custom_records t
        join custom_objects o on o.id = t.object_id and o.workspace_id = p_workspace and o.slug = p_object
       where t.workspace_id = p_workspace order by t.created_at desc limit 1;
  end case;
  if v is null then return null; end if;
  return automation_payload(p_object, v_table, v);
end $$;

create or replace function test_automation(p_privy text, p_workspace uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a automations; v_payload jsonb; v_event uuid;
begin
  perform automation_editor(p_privy, p_workspace);
  select * into a from automations where id = p_id and workspace_id = p_workspace;
  if a.id is null then raise exception 'NOT_FOUND'; end if;
  if a.trigger_type = 'event' then
    v_payload := automation_sample_row(p_workspace, a.object);
  end if;
  insert into automation_events (workspace_id, object, event, record_id, payload, source, automation_id)
  values (p_workspace, a.object, coalesce(a.event, 'test'),
          case when v_payload ? 'id' then (v_payload->>'id')::uuid end,
          coalesce(v_payload, jsonb_build_object('now', now(), 'test', true)), 'test', a.id)
  returning id into v_event;
  return jsonb_build_object('event', v_event, 'sample', v_payload is not null,
                            'record', v_payload->>'id', 'started_at', now());
end $$;

-- Claim ONE event by id — what a test run uses, so pressing Test runs THAT
-- event now instead of whatever happened to be oldest in the queue.
create or replace function claim_automation_event(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with upd as (
    update automation_events e set status = 'processing', attempts = e.attempts + 1
     where e.id = (select id from automation_events where id = p_id and status = 'pending' for update skip locked)
    returning e.*
  )
  select jsonb_build_object('id', id, 'workspace_id', workspace_id, 'object', object, 'event', event,
    'record_id', record_id, 'payload', payload, 'source', source, 'automation_id', automation_id, 'attempts', attempts)
    into v from upd;
  return v;
end $$;

-- ── Reads, with each automation's last run ──────────────────────────────────
create or replace function get_automations(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'enabled', a.enabled, 'trigger_type', a.trigger_type,
    'object', a.object, 'event', a.event, 'conditions', a.conditions, 'actions', a.actions,
    'webhook_token', a.webhook_token, 'schedule', a.schedule, 'updated_at', a.updated_at,
    'last_run_at', a.last_run_at, 'owner_privy', a.owner_privy,
    'last_run', (select jsonb_build_object('status', r.status, 'detail', r.detail, 'at', r.created_at)
                   from automation_runs r where r.automation_id = a.id order by r.created_at desc limit 1),
    'runs_7d', (select count(*) from automation_runs r where r.automation_id = a.id and r.created_at > now() - interval '7 days'),
    'errors_7d', (select count(*) from automation_runs r where r.automation_id = a.id and r.status = 'error' and r.created_at > now() - interval '7 days')
  ) order by a.created_at desc) from automations a where a.workspace_id = p_workspace), '[]'::jsonb);
end $$;

create or replace function get_automation_runs(p_privy text, p_workspace uuid, p_limit int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', r.id, 'automation_id', r.automation_id, 'automation_name', r.automation_name, 'action_type', r.action_type,
    'status', r.status, 'detail', r.detail, 'created_at', r.created_at
  ) order by r.created_at desc) from (
    select * from automation_runs where workspace_id = p_workspace order by created_at desc limit greatest(1, least(coalesce(p_limit, 30), 200))
  ) r), '[]'::jsonb);
end $$;

-- ── Grants: the 0105 pair, for everything defined or redefined here ────────
revoke all on function automation_payload(text, text, jsonb)           from public, anon, authenticated;
revoke all on function emit_automation_event()                         from public, anon, authenticated;
revoke all on function get_event_automations(uuid, text, text)          from public, anon, authenticated;
revoke all on function get_automation_by_id(uuid)                       from public, anon, authenticated;
revoke all on function automation_schedule_due(jsonb, timestamptz)      from public, anon, authenticated;
revoke all on function enqueue_scheduled_automations()                  from public, anon, authenticated;
revoke all on function automation_editor(text, uuid)                    from public, anon, authenticated;
revoke all on function automation_clean_schedule(jsonb)                 from public, anon, authenticated;
revoke all on function save_automation(text, uuid, uuid, jsonb)         from public, anon, authenticated;
revoke all on function set_automation_enabled(text, uuid, boolean)      from public, anon, authenticated;
revoke all on function delete_automation(text, uuid)                    from public, anon, authenticated;
revoke all on function automation_sample_row(uuid, text)                from public, anon, authenticated;
revoke all on function test_automation(text, uuid, uuid)                from public, anon, authenticated;
revoke all on function claim_automation_event(uuid)                     from public, anon, authenticated;
revoke all on function get_automations(text, uuid)                      from public, anon, authenticated;
revoke all on function get_automation_runs(text, uuid, int)             from public, anon, authenticated;
grant execute on function automation_payload(text, text, jsonb)         to service_role;
grant execute on function get_event_automations(uuid, text, text)        to service_role;
grant execute on function get_automation_by_id(uuid)                     to service_role;
grant execute on function automation_schedule_due(jsonb, timestamptz)    to service_role;
grant execute on function enqueue_scheduled_automations()                to service_role;
grant execute on function automation_editor(text, uuid)                  to service_role;
grant execute on function automation_clean_schedule(jsonb)               to service_role;
grant execute on function save_automation(text, uuid, uuid, jsonb)       to service_role;
grant execute on function set_automation_enabled(text, uuid, boolean)    to service_role;
grant execute on function delete_automation(text, uuid)                  to service_role;
grant execute on function automation_sample_row(uuid, text)              to service_role;
grant execute on function test_automation(text, uuid, uuid)              to service_role;
grant execute on function claim_automation_event(uuid)                   to service_role;
grant execute on function get_automations(text, uuid)                    to service_role;
grant execute on function get_automation_runs(text, uuid, int)           to service_role;

notify pgrst, 'reload schema';
