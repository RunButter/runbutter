-- ============================================================================
-- RunButter — 0071_newsletter_send.sql
-- The send pipeline: batch claiming, delivery marking, and the public
-- token-addressed endpoints (unsubscribe, confirm, open, click).
--
-- AT-MOST-ONCE, ON PURPOSE.
-- A delivery is claimed by moving it to 'sending' BEFORE the provider call. If
-- the process dies between the claim and the result, that row is stranded — and
-- it is deliberately NOT returned to 'pending' by anything automatic.
--
-- This is the at-least-once / at-most-once fork, and for bulk email the answer
-- is not the usual one. Retrying a row that may already have been accepted by
-- Resend sends a duplicate to a real customer; leaving it stranded sends nothing
-- to one person. A missed email is a support question. A duplicate send to a
-- whole list is a public incident and cannot be undone. So stale claims are
-- swept to 'failed' with a reason, and re-sending is an explicit human act.
--
-- The claim itself uses FOR UPDATE SKIP LOCKED: two overlapping cron ticks must
-- never be handed the same delivery row, and SKIP LOCKED is what makes the
-- second tick take different work instead of blocking on the first.
--
-- Everything here is service_role only. These run from /api/newsletters/* which
-- holds the Resend key; none of it is reachable through the /api/rpc proxy.
-- Depends on 0070.
-- ============================================================================

-- 'sending' is the claimed state. Added to the existing check constraint rather
-- than tracked in a second column so a delivery has exactly one status.
alter table newsletter_deliveries drop constraint if exists newsletter_deliveries_status_check;
alter table newsletter_deliveries add constraint newsletter_deliveries_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));

alter table newsletter_deliveries add column if not exists claimed_at timestamptz;
create index if not exists idx_nl_deliveries_stale on newsletter_deliveries(status, claimed_at)
  where status = 'sending';

-- ── What is due ──────────────────────────────────────────────────────────────
create or replace function due_newsletters(p_limit int default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce((select jsonb_agg(to_jsonb(x)) from (
    select n.id, n.workspace_id, n.subject, n.preheader, n.template, n.content,
           n.from_name, n.reply_to, n.status
      from newsletters n
     where (n.status = 'scheduled' and n.scheduled_at <= now())
        or n.status = 'sending'
     order by n.scheduled_at nulls first
     limit greatest(1, least(coalesce(p_limit, 5), 20))
  ) x), '[]'::jsonb);
end $$;
revoke all on function due_newsletters(int) from public, authenticated, anon;
grant execute on function due_newsletters(int) to service_role;

/**
 * Claim up to p_limit pending deliveries for one newsletter and flip the
 * newsletter to 'sending'.
 *
 * SKIP LOCKED is the whole point: without it a second cron tick overlapping the
 * first would block on the same rows and then send them again once the lock
 * cleared. With it, the second tick simply takes the next unclaimed slice.
 */
create or replace function claim_newsletter_batch(p_newsletter uuid, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb;
begin
  update newsletters
     set status = 'sending', started_at = coalesce(started_at, now())
   where id = p_newsletter and status in ('scheduled', 'sending');
  if not found then return '[]'::jsonb; end if;

  -- One statement, three stages. `candidate` takes the lock, `claimed` flips
  -- the rows and RETURNS them, and the final SELECT aggregates.
  --
  -- This was previously `UPDATE ... RETURNING jsonb_build_object(...) INTO
  -- v_rows`, which raises "query returned more than one row" the moment a batch
  -- holds more than one delivery — so every real batch failed and only a
  -- batch of exactly one worked. RETURNING INTO takes a single row; aggregating
  -- in a data-modifying CTE is what actually collects the set.
  with candidate as (
    select d.id
      from newsletter_deliveries d
     where d.newsletter_id = p_newsletter and d.status = 'pending'
     order by d.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  ), claimed as (
    update newsletter_deliveries d
       set status = 'sending', claimed_at = now()
      from candidate c
     where d.id = c.id
    returning d.id, d.email, d.subscriber_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', cl.id, 'email', cl.email, 'subscriber_id', cl.subscriber_id,
           'token', s.token, 'name', s.name, 'attribs', s.attribs)), '[]'::jsonb)
    into v_rows
    from claimed cl
    join newsletter_subscribers s on s.id = cl.subscriber_id;

  return v_rows;
end $$;
revoke all on function claim_newsletter_batch(uuid, int) from public, authenticated, anon;
grant execute on function claim_newsletter_batch(uuid, int) to service_role;

create or replace function mark_newsletter_delivery(
  p_id uuid, p_status text, p_provider_id text default null, p_error text default null
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('sent', 'failed', 'skipped') then raise exception 'BAD_STATUS'; end if;
  update newsletter_deliveries
     set status = p_status,
         provider_id = coalesce(p_provider_id, provider_id),
         error = p_error,
         sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_id and status = 'sending';
  return found;
end $$;
revoke all on function mark_newsletter_delivery(uuid, text, text, text) from public, authenticated, anon;
grant execute on function mark_newsletter_delivery(uuid, text, text, text) to service_role;

/**
 * Close a newsletter once nothing is left to do, and sweep stale claims.
 *
 * A claim older than p_stale_minutes belonged to a process that died. It is
 * marked FAILED, never returned to pending — see the header. The operator sees
 * the count and decides; the system never silently risks a duplicate.
 */
create or replace function finish_newsletter(p_id uuid, p_stale_minutes int default 15)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_stale int; v_left int;
begin
  update newsletter_deliveries
     set status = 'failed',
         error = 'Interrupted mid-send. Not retried automatically: the message may already have been accepted by the provider, and a duplicate to a real subscriber is worse than a miss.'
   where newsletter_id = p_id and status = 'sending'
     and claimed_at < now() - make_interval(mins => greatest(1, coalesce(p_stale_minutes, 15)));
  get diagnostics v_stale = row_count;

  select count(*) into v_left from newsletter_deliveries
   where newsletter_id = p_id and status in ('pending', 'sending');

  if v_left = 0 then
    update newsletters set status = 'sent', finished_at = now()
     where id = p_id and status = 'sending';
  end if;

  return jsonb_build_object('swept', v_stale, 'remaining', v_left);
end $$;
revoke all on function finish_newsletter(uuid, int) from public, authenticated, anon;
grant execute on function finish_newsletter(uuid, int) to service_role;

-- ── Public, token-addressed ──────────────────────────────────────────────────
/**
 * One-click unsubscribe. Addressed by the subscriber's unguessable token, so it
 * works from an email client with no session — which is the requirement, not a
 * shortcut: Gmail and Yahoo demand one-click unsubscribe from bulk senders and
 * deliverability collapses without it.
 *
 * Idempotent. A mail client that pre-fetches the link (several do) and then the
 * human clicking it must not produce an error the second time.
 */
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

  -- Any queued sends for this person stop now. Without this, unsubscribing
  -- during a large send still delivers whatever was already materialised.
  update newsletter_deliveries set status = 'skipped', error = 'unsubscribed'
   where subscriber_id = v_id and status = 'pending';

  return jsonb_build_object('ok', true, 'email', v_email);
end $$;
revoke all on function newsletter_unsubscribe(text, uuid) from public, authenticated, anon;
grant execute on function newsletter_unsubscribe(text, uuid) to service_role;

create or replace function newsletter_confirm(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_email text;
begin
  select id, email into v_id, v_email from newsletter_subscribers where token = p_token;
  if v_id is null then return jsonb_build_object('ok', false); end if;
  -- Only lifts 'unconfirmed'. A confirmation link must never revive someone who
  -- has since unsubscribed or hard-bounced.
  update newsletter_subscribers set status = 'enabled'
   where id = v_id and status = 'unconfirmed';
  return jsonb_build_object('ok', true, 'email', v_email);
end $$;
revoke all on function newsletter_confirm(text) from public, authenticated, anon;
grant execute on function newsletter_confirm(text) to service_role;

/**
 * Record an open or a click, addressed by DELIVERY id — which ties the event to
 * a specific send rather than just to a person, and is unguessable.
 *
 * Opens are deduplicated per (delivery, kind) for the same url: clients prefetch
 * images and some proxy them repeatedly, so counting every pixel hit would
 * report open rates well above 100%.
 */
create or replace function record_newsletter_event(
  p_delivery uuid, p_kind text, p_url text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_nl uuid; v_sub uuid;
begin
  if p_kind not in ('open', 'click') then raise exception 'BAD_KIND'; end if;
  select workspace_id, newsletter_id, subscriber_id into v_ws, v_nl, v_sub
    from newsletter_deliveries where id = p_delivery;
  if v_ws is null then return false; end if;

  if exists (select 1 from newsletter_events e
              where e.newsletter_id = v_nl and e.subscriber_id = v_sub
                and e.kind = p_kind and coalesce(e.url,'') = coalesce(p_url,'')) then
    return true;
  end if;

  insert into newsletter_events (workspace_id, newsletter_id, subscriber_id, kind, url)
  values (v_ws, v_nl, v_sub, p_kind, p_url);
  return true;
end $$;
revoke all on function record_newsletter_event(uuid, text, text) from public, authenticated, anon;
grant execute on function record_newsletter_event(uuid, text, text) to service_role;

/**
 * Provider feedback (Resend webhook). A bounce or complaint is the mail system
 * telling us to stop; it is stored as a permanent status, not a counter, because
 * continuing to mail a hard-bounced address is what destroys a sending domain's
 * reputation.
 */
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
  return true;
end $$;
revoke all on function record_newsletter_feedback(text, uuid, text) from public, authenticated, anon;
grant execute on function record_newsletter_feedback(text, uuid, text) to service_role;

notify pgrst, 'reload schema';
