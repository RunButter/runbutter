-- ============================================================================
-- RunButter — 0073_sequences.sql
-- Drip sequences: an ordered list of steps with WAITS, run per subscriber.
--
-- This is the actual gap between "automations" (0032/0033) and marketing
-- automation. Our automations fire once, on an event. A sequence has a CURSOR
-- per person — which step they are on and when the next one is due — so "day 0
-- welcome, day 3 case study, day 7 ask for a call" is expressible at all.
--
-- SEQUENCE EMAILS REUSE THE NEWSLETTER MACHINERY, deliberately. A step points at
-- a `newsletters` row that is never queued; sending creates an ordinary
-- newsletter_deliveries row for that (newsletter, subscriber). Four things come
-- free and correct as a result:
--   • the unique (newsletter_id, subscriber_id) index means a re-enrolled
--     subscriber CANNOT receive the same step twice — the single worst bug a
--     drip tool can have;
--   • open and click tracking already key off a delivery id;
--   • one-click unsubscribe already works, because the token is the
--     subscriber's, not the campaign's;
--   • per-step stats roll up through the existing newsletter counters.
-- Writing a parallel delivery table would have meant reimplementing all four,
-- each with its own chance of being subtly wrong.
--
-- Depends on 0070/0071/0072. Additive, idempotent & prod-safe.
-- ============================================================================

create table if not exists sequences (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null default 'New sequence',
  description  text not null default '',
  enabled      boolean not null default false,   -- off until someone turns it on
  -- Who enters. Exactly one of these; a segment is re-evaluated on every
  -- enrolment sweep, which is the point of segments existing.
  entry_list    uuid references newsletter_lists(id) on delete set null,
  entry_segment uuid references segments(id) on delete set null,
  -- [{ kind:'wait', days:N } | { kind:'email', newsletter_id:'uuid' }]
  steps        jsonb not null default '[]'::jsonb,
  created_by_privy text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_sequences_ws on sequences(workspace_id, updated_at desc);
create index if not exists idx_sequences_enabled on sequences(enabled) where enabled;
drop trigger if exists trg_sequences_upd on sequences;
create trigger trg_sequences_upd before update on sequences for each row execute function set_updated_at();
alter table sequences enable row level security;
revoke all on table sequences from anon, authenticated;

-- One cursor per (sequence, subscriber). The unique constraint is what makes
-- enrolment idempotent: an enrolment sweep runs repeatedly and must never
-- restart someone who is already partway through.
create table if not exists sequence_enrollments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  sequence_id   uuid not null references sequences(id) on delete cascade,
  subscriber_id uuid not null references newsletter_subscribers(id) on delete cascade,
  step_index    int  not null default 0,
  due_at        timestamptz not null default now(),
  status        text not null default 'active'
                check (status in ('active', 'running', 'completed', 'cancelled', 'failed')),
  last_error    text,
  enrolled_at   timestamptz not null default now(),
  finished_at   timestamptz
);
create unique index if not exists uq_seq_enroll on sequence_enrollments(sequence_id, subscriber_id);
-- The dispatcher's lookup: what is due right now.
create index if not exists idx_seq_enroll_due on sequence_enrollments(status, due_at)
  where status = 'active';
alter table sequence_enrollments enable row level security;
revoke all on table sequence_enrollments from anon, authenticated;

-- ── CRUD ─────────────────────────────────────────────────────────────────────
create or replace function get_sequences(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
    select s.id, s.name, s.description, s.enabled, s.entry_list, s.entry_segment,
           s.steps, s.updated_at,
           (select count(*) from sequence_enrollments e
             where e.sequence_id = s.id and e.status = 'active')    as active_count,
           (select count(*) from sequence_enrollments e
             where e.sequence_id = s.id and e.status = 'completed') as completed_count
      from sequences s where s.workspace_id = p_workspace
  ) x), '[]'::jsonb);
end $$;
grant execute on function get_sequences(text, uuid) to authenticated, anon;

/**
 * Save a sequence. Steps are shape-checked here rather than trusted, because
 * the dispatcher reads them as instructions: an email step naming a newsletter
 * from another workspace would otherwise send that workspace's content.
 */
create or replace function save_sequence(
  p_privy text, p_workspace uuid, p_id uuid, p_name text, p_description text,
  p_entry_list uuid, p_entry_segment uuid, p_steps jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_step jsonb; v_kind text; v_days int; v_nl uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if jsonb_typeof(coalesce(p_steps, '[]'::jsonb)) <> 'array' then raise exception 'BAD_STEPS'; end if;
  if jsonb_array_length(coalesce(p_steps, '[]'::jsonb)) > 30 then raise exception 'TOO_MANY_STEPS'; end if;

  for v_step in select * from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) loop
    v_kind := v_step->>'kind';
    if v_kind = 'wait' then
      -- Strict whole-string match, not trim-then-cast. Casting "abc" raises a
      -- raw "invalid input syntax for type integer" instead of BAD_WAIT, which
      -- reaches the user as a database error rather than a validation message —
      -- and a 4-digit-plus value would overflow before the range check ran.
      v_days := case when coalesce(v_step->>'days', '') ~ '^\d{1,3}$'
                     then (v_step->>'days')::int else null end;
      if v_days is null or v_days > 365 then raise exception 'BAD_WAIT'; end if;
    elsif v_kind = 'email' then
      begin v_nl := (v_step->>'newsletter_id')::uuid; exception when others then raise exception 'BAD_EMAIL_STEP'; end;
      -- Same-workspace only. This is the check that stops a crafted step from
      -- mailing another tenant's newsletter to this tenant's subscribers.
      if not exists (select 1 from newsletters n where n.id = v_nl and n.workspace_id = p_workspace) then
        raise exception 'BAD_EMAIL_STEP';
      end if;
    else
      raise exception 'BAD_STEP_KIND';
    end if;
  end loop;

  -- Entry references are validated the same way.
  if p_entry_list is not null and not exists (
      select 1 from newsletter_lists where id = p_entry_list and workspace_id = p_workspace) then
    raise exception 'BAD_ENTRY';
  end if;
  if p_entry_segment is not null and not exists (
      select 1 from segments where id = p_entry_segment and workspace_id = p_workspace) then
    raise exception 'BAD_ENTRY';
  end if;

  if p_id is null then
    insert into sequences (workspace_id, name, description, entry_list, entry_segment, steps, created_by_privy)
    values (p_workspace, coalesce(nullif(p_name,''),'New sequence'), coalesce(p_description,''),
            p_entry_list, p_entry_segment, coalesce(p_steps,'[]'::jsonb), p_privy)
    returning id into v_id;
  else
    update sequences set
      name = coalesce(nullif(p_name,''), name), description = coalesce(p_description, description),
      entry_list = p_entry_list, entry_segment = p_entry_segment,
      steps = coalesce(p_steps, steps)
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_sequence(text, uuid, uuid, text, text, uuid, uuid, jsonb) to authenticated, anon;

create or replace function set_sequence_enabled(p_privy text, p_workspace uuid, p_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update sequences set enabled = p_enabled where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function set_sequence_enabled(text, uuid, uuid, boolean) to authenticated, anon;

create or replace function delete_sequence(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  delete from sequences where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function delete_sequence(text, uuid, uuid) to authenticated, anon;

-- ── Enrolment ────────────────────────────────────────────────────────────────
/**
 * Enrol everyone who currently qualifies and is not already enrolled.
 *
 * Idempotent by the unique (sequence, subscriber) index — this runs on every
 * sweep, and restarting someone who is halfway through would re-send steps they
 * have already had.
 *
 * ONLY 'enabled' SUBSCRIBERS. Unconfirmed (double opt-in pending), unsubscribed,
 * bounced and complained are excluded at enrolment rather than filtered later,
 * so an enrolment IS a commitment to mail that person.
 *
 * ONCE ENROLLED, ALWAYS ENROLLED — leaving the segment does NOT eject someone
 * mid-drip. A welcome series that stops halfway because a contact's score
 * changed is worse than one that finishes.
 */
create or replace function enroll_sequence(p_sequence uuid, p_limit int default 500)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_list uuid; v_seg uuid; v_filters jsonb; v_n int;
begin
  select workspace_id, entry_list, entry_segment into v_ws, v_list, v_seg
    from sequences where id = p_sequence and enabled;
  if v_ws is null then return jsonb_build_object('enrolled', 0, 'skipped', 'not enabled'); end if;
  if v_list is null and v_seg is null then return jsonb_build_object('enrolled', 0, 'skipped', 'no entry'); end if;

  if v_seg is not null then
    select filters into v_filters from segments where id = v_seg and workspace_id = v_ws;
  end if;

  insert into sequence_enrollments (workspace_id, sequence_id, subscriber_id)
  select v_ws, p_sequence, s.id
    from newsletter_subscribers s
   where s.workspace_id = v_ws
     and s.status = 'enabled'
     and (v_list is null or exists (
           select 1 from newsletter_list_subscribers ls
            where ls.subscriber_id = s.id and ls.list_id = v_list))
     and (v_filters is null or coalesce(
           (select bool_and(segment_match(s, c)) from jsonb_array_elements(v_filters) c), true))
   limit greatest(1, least(coalesce(p_limit, 500), 5000))
  on conflict (sequence_id, subscriber_id) do nothing;
  get diagnostics v_n = row_count;

  return jsonb_build_object('enrolled', v_n);
end $$;
revoke all on function enroll_sequence(uuid, int) from public, authenticated, anon;
grant execute on function enroll_sequence(uuid, int) to service_role;

-- ── Dispatch ─────────────────────────────────────────────────────────────────
create or replace function enabled_sequences()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'workspace_id', s.workspace_id))
                     from sequences s where s.enabled), '[]'::jsonb);
end $$;
revoke all on function enabled_sequences() from public, authenticated, anon;
grant execute on function enabled_sequences() to service_role;

/**
 * Claim due enrolments and return what each one needs next.
 *
 * SKIP LOCKED for the same reason as the newsletter sender: two overlapping
 * cron ticks must take different work rather than blocking and then doing it
 * twice.
 *
 * A claimed row goes to 'running'. Like newsletter deliveries this is
 * at-most-once — a crash strands the row for the sweeper rather than risking a
 * duplicate email.
 */
create or replace function claim_sequence_steps(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb;
begin
  with candidate as (
    select e.id from sequence_enrollments e
      join sequences s on s.id = e.sequence_id and s.enabled
     where e.status = 'active' and e.due_at <= now()
     order by e.due_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update of e skip locked
  ), claimed as (
    update sequence_enrollments e set status = 'running'
      from candidate c where e.id = c.id
    returning e.id, e.workspace_id, e.sequence_id, e.subscriber_id, e.step_index
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'enrollment_id', cl.id, 'workspace_id', cl.workspace_id,
           'sequence_id', cl.sequence_id, 'subscriber_id', cl.subscriber_id,
           'step_index', cl.step_index,
           'step', s.steps -> cl.step_index,
           'steps_total', jsonb_array_length(s.steps),
           'email', sub.email, 'name', sub.name, 'token', sub.token,
           'subscriber_status', sub.status)), '[]'::jsonb)
    into v_rows
    from claimed cl
    join sequences s on s.id = cl.sequence_id
    join newsletter_subscribers sub on sub.id = cl.subscriber_id;

  return v_rows;
end $$;
revoke all on function claim_sequence_steps(int) from public, authenticated, anon;
grant execute on function claim_sequence_steps(int) to service_role;

/**
 * Move an enrolment on.
 *
 * p_wait_days null = advance immediately (the step was an email that has been
 * sent). Otherwise the next step is due that many days out.
 *
 * Completing when step_index runs past the end is decided HERE rather than by
 * the caller, so a dispatcher bug cannot leave enrolments active forever
 * re-running a step that does not exist.
 */
create or replace function advance_enrollment(
  p_id uuid, p_wait_days int default null, p_error text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_next int; v_total int;
begin
  if p_error is not null then
    update sequence_enrollments
       set status = 'failed', last_error = left(p_error, 500), finished_at = now()
     where id = p_id and status = 'running';
    return found;
  end if;

  select e.step_index + 1, jsonb_array_length(s.steps) into v_next, v_total
    from sequence_enrollments e join sequences s on s.id = e.sequence_id
   where e.id = p_id;
  if v_next is null then return false; end if;

  if v_next >= coalesce(v_total, 0) then
    update sequence_enrollments
       set status = 'completed', step_index = v_next, finished_at = now()
     where id = p_id and status = 'running';
  else
    update sequence_enrollments
       set status = 'active', step_index = v_next,
           due_at = now() + make_interval(days => greatest(0, coalesce(p_wait_days, 0)))
     where id = p_id and status = 'running';
  end if;
  return found;
end $$;
revoke all on function advance_enrollment(uuid, int, text) from public, authenticated, anon;
grant execute on function advance_enrollment(uuid, int, text) to service_role;

/**
 * Stop mailing someone the moment they opt out.
 *
 * Called by the dispatcher before each step and after unsubscribes. Without it,
 * unsubscribing during a drip keeps delivering the remaining steps — which is
 * both the most annoying possible bug and a compliance problem.
 */
create or replace function cancel_enrollments_for_subscriber(p_subscriber uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update sequence_enrollments
     set status = 'cancelled', finished_at = now()
   where subscriber_id = p_subscriber and status in ('active', 'running');
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function cancel_enrollments_for_subscriber(uuid) from public, authenticated, anon;
grant execute on function cancel_enrollments_for_subscriber(uuid) to service_role;

/** Sweep claims left by a dead process. Failed, never retried — see 0071. */
create or replace function sweep_stale_enrollments(p_minutes int default 15)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update sequence_enrollments
     set status = 'failed',
         last_error = 'Interrupted mid-step. Not retried automatically: the email may already have been accepted by the provider.',
         finished_at = now()
   where status = 'running'
     and enrolled_at < now() - make_interval(mins => greatest(1, coalesce(p_minutes, 15)));
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function sweep_stale_enrollments(int) from public, authenticated, anon;
grant execute on function sweep_stale_enrollments(int) to service_role;

/**
 * Record a sequence email as an ordinary newsletter delivery.
 *
 * Returns the delivery id, or NULL when one already exists — which is how a
 * re-enrolled or double-claimed subscriber is prevented from receiving the same
 * step twice. The caller must treat NULL as "already sent, skip".
 */
create or replace function create_sequence_delivery(
  p_workspace uuid, p_newsletter uuid, p_subscriber uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_email text;
begin
  select email into v_email from newsletter_subscribers
   where id = p_subscriber and workspace_id = p_workspace and status = 'enabled';
  if v_email is null then return null; end if;
  if not exists (select 1 from newsletters where id = p_newsletter and workspace_id = p_workspace) then
    return null;
  end if;

  insert into newsletter_deliveries (workspace_id, newsletter_id, subscriber_id, email, status, claimed_at)
  values (p_workspace, p_newsletter, p_subscriber, v_email, 'sending', now())
  on conflict (newsletter_id, subscriber_id) do nothing
  returning id into v_id;

  return v_id;   -- null when the row already existed
end $$;
revoke all on function create_sequence_delivery(uuid, uuid, uuid) from public, authenticated, anon;
grant execute on function create_sequence_delivery(uuid, uuid, uuid) to service_role;

-- Enrolment counts for one sequence, for the UI.
create or replace function get_sequence_stats(p_privy text, p_workspace uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_object_agg(status, n) from (
    select status, count(*) as n from sequence_enrollments
     where sequence_id = p_id and workspace_id = p_workspace group by status
  ) x), '{}'::jsonb);
end $$;
grant execute on function get_sequence_stats(text, uuid, uuid) to authenticated, anon;

-- ── Unsubscribe must also stop the drip ──────────────────────────────────────
-- 0071 predates sequences, so its newsletter_unsubscribe stops queued NEWSLETTER
-- deliveries but leaves sequence enrolments running — someone who unsubscribed
-- would keep receiving the rest of a drip. Redefined here IN FULL (rather than
-- patched from the dispatcher) so the guarantee lives at the point of
-- unsubscribing and cannot be missed by a future caller.
create or replace function newsletter_unsubscribe(p_token text, p_newsletter uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ws uuid; v_email text;
begin
  select id, workspace_id, email into v_id, v_ws, v_email
    from newsletter_subscribers where token = p_token;
  if v_id is null then return jsonb_build_object('ok', false); end if;

  update newsletter_subscribers set status = 'unsubscribed'
   where id = v_id and status <> 'unsubscribed';

  if found then
    insert into newsletter_events (workspace_id, newsletter_id, subscriber_id, kind)
    values (v_ws, p_newsletter, v_id, 'unsubscribe');
  end if;

  update newsletter_deliveries set status = 'skipped', error = 'unsubscribed'
   where subscriber_id = v_id and status = 'pending';

  -- The addition: stop every drip this person is partway through.
  update sequence_enrollments set status = 'cancelled', finished_at = now()
   where subscriber_id = v_id and status in ('active', 'running');

  return jsonb_build_object('ok', true, 'email', v_email);
end $$;
revoke all on function newsletter_unsubscribe(text, uuid) from public, authenticated, anon;
grant execute on function newsletter_unsubscribe(text, uuid) to service_role;

-- Same for a bounce or complaint: the mail system said stop, so the drip stops.
create or replace function record_newsletter_feedback(p_email text, p_workspace uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_kind not in ('bounce', 'complaint') then raise exception 'BAD_KIND'; end if;
  select id into v_id from newsletter_subscribers
   where workspace_id = p_workspace and lower(email) = lower(p_email);
  if v_id is null then return false; end if;

  update newsletter_subscribers
     set status = case when p_kind = 'bounce' then 'bounced' else 'complained' end
   where id = v_id;

  insert into newsletter_events (workspace_id, subscriber_id, kind)
  values (p_workspace, v_id, p_kind);

  update newsletter_deliveries set status = 'skipped', error = p_kind
   where subscriber_id = v_id and status = 'pending';

  update sequence_enrollments set status = 'cancelled', finished_at = now()
   where subscriber_id = v_id and status in ('active', 'running');
  return true;
end $$;
revoke all on function record_newsletter_feedback(text, uuid, text) from public, authenticated, anon;
grant execute on function record_newsletter_feedback(text, uuid, text) to service_role;

notify pgrst, 'reload schema';
