-- ============================================================================
-- RunButter — 0083_post_targets.sql
-- One authored post, N accounts it goes out to, and an at-most-once sender.
--
-- SENDING IS AT-MOST-ONCE, ON PURPOSE. This is the newsletter rule (0070/0071)
-- applied to social, for the same reason and with the same shape:
--   · a target moves to 'sending' BEFORE the provider call
--   · a stale claim is swept to 'failed', NEVER back to 'pending'
--   · unique (post_id, account_id) makes a duplicate structurally impossible
-- A post published twice to a company's real audience is a public incident that
-- cannot be taken back; a post that did not go out is a support question. Do
-- not "fix" this into a retry — a retry is the bug.
--
-- WHY A SEPARATE TABLE AND NOT COLUMNS ON `posts`. A post is authored once and
-- fans out to several accounts, each of which succeeds or fails on its own: X
-- rejecting a post is not a reason to mark the LinkedIn one failed. Status per
-- target is the only shape that can say "went out on LinkedIn, failed on X",
-- which is exactly what a person needs to know.
--
-- Depends on 0028 (posts) and 0082 (social_accounts). Idempotent & prod-safe.
-- ============================================================================

-- When the post should go out. Null = "when told to", which is what the manual
-- Publish button uses; the scheduler only ever looks at rows that have one.
alter table posts add column if not exists scheduled_at timestamptz;

create table if not exists post_targets (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  post_id       uuid not null references posts(id) on delete cascade,
  account_id    uuid not null references social_accounts(id) on delete cascade,
  -- pending → sending → sent | failed. 'skipped' exists for a target whose
  -- account was disabled between scheduling and sending: not an error, and not
  -- something to retry either.
  status        text not null default 'pending',
  scheduled_at  timestamptz,
  claimed_at    timestamptz,
  sent_at       timestamptz,
  -- The platform's id for the published post. This is what makes "sent" a
  -- verifiable claim rather than our own assertion.
  provider_post_id text,
  provider_url  text,
  error         text,
  created_at    timestamptz not null default now(),
  -- THE constraint. Everything above is bookkeeping; this is what makes
  -- double-publishing impossible rather than merely unlikely.
  unique (post_id, account_id)
);

do $$ begin
  alter table post_targets add constraint post_targets_status_check
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped'));
exception when duplicate_object then null; end $$;

create index if not exists idx_post_targets_post on post_targets(post_id);
-- The sweep the cron runs: due, unsent, oldest first. Partial, because sent
-- rows are the overwhelming majority after a week and none of them are due.
create index if not exists idx_post_targets_due on post_targets(scheduled_at)
  where status = 'pending';
-- Stale-claim sweep reads this one.
create index if not exists idx_post_targets_claimed on post_targets(claimed_at)
  where status = 'sending';

alter table post_targets enable row level security;
revoke all on table post_targets from anon, authenticated;

-- ── Reads and writes a browser may make ─────────────────────────────────────
create or replace function get_post_targets(p_privy text, p_post uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare my uuid[] := (select array_agg(workspace_id) from accounts where privy_user_id = p_privy);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', t.id, 'account_id', t.account_id, 'provider', a.provider,
    'display_name', a.display_name, 'status', t.status,
    'scheduled_at', t.scheduled_at, 'sent_at', t.sent_at,
    'provider_url', t.provider_url, 'error', t.error
  ) order by a.provider, a.display_name)
    from post_targets t
    join social_accounts a on a.id = t.account_id
   where t.post_id = p_post and t.workspace_id = any(my)), '[]'::jsonb);
end $$;
grant execute on function get_post_targets(text, uuid) to authenticated, anon;

/**
 * Set which accounts a post goes to, and when.
 *
 * Replaces the whole set, but ONLY the parts that are still changeable. A
 * target that is sending or already sent is left exactly as it is: unselecting
 * an account cannot un-publish a post, and pretending otherwise would let the
 * UI show a post as unsent while it is live on someone's feed. Reselecting an
 * already-sent account is a no-op for the same reason — that is what the unique
 * constraint plus this DO NOTHING buys.
 */
create or replace function set_post_targets(
  p_privy text, p_workspace uuid, p_post uuid, p_accounts uuid[],
  p_scheduled_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select exists (select 1 from posts where id = p_post and workspace_id = p_workspace) into v_ok;
  if not v_ok then raise exception 'NO_SUCH_POST'; end if;

  -- Drop the targets that are still safe to drop.
  delete from post_targets
   where post_id = p_post
     and status in ('pending', 'failed', 'skipped')
     and (p_accounts is null or account_id <> all(p_accounts));

  -- Add the new ones. The join against social_accounts is the tenancy check:
  -- an account id from another workspace simply matches no row, so a forged id
  -- adds nothing rather than posting somewhere it should not.
  insert into post_targets (workspace_id, post_id, account_id, scheduled_at)
  select p_workspace, p_post, a.id, p_scheduled_at
    from unnest(coalesce(p_accounts, '{}'::uuid[])) as sel(id)
    join social_accounts a on a.id = sel.id and a.workspace_id = p_workspace and a.enabled
  on conflict (post_id, account_id) do nothing;

  -- Keep a still-pending target's schedule in step with the post's.
  update post_targets set scheduled_at = p_scheduled_at
   where post_id = p_post and status = 'pending';
  update posts set scheduled_at = p_scheduled_at where id = p_post and workspace_id = p_workspace;

  return get_post_targets(p_privy, p_post);
end $$;
grant execute on function set_post_targets(text, uuid, uuid, uuid[], timestamptz) to authenticated, anon;

/**
 * "Publish now" — mark this post's pending targets due immediately.
 *
 * Deliberately does NOT send. Publishing goes through the same claim path as a
 * scheduled post, so there is exactly one code path that can talk to a
 * provider and exactly one place the at-most-once rule has to hold.
 */
create or replace function publish_post_now(p_privy text, p_workspace uuid, p_post uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update post_targets set scheduled_at = now()
   where post_id = p_post and workspace_id = p_workspace and status = 'pending';
  if not found then raise exception 'NOTHING_TO_PUBLISH'; end if;
  update posts set scheduled_at = now() where id = p_post and workspace_id = p_workspace;
  return get_post_targets(p_privy, p_post);
end $$;
grant execute on function publish_post_now(text, uuid, uuid) to authenticated, anon;

-- ── service_role only: the dispatcher ───────────────────────────────────────
/**
 * Claim up to p_limit due targets.
 *
 * FOR UPDATE SKIP LOCKED for the same reason as the newsletter sender: two
 * overlapping cron ticks must never be handed the same row, or the second sends
 * it again once the first releases its lock.
 *
 * The claim is a data-modifying CTE aggregated by a final SELECT, not
 * `UPDATE … RETURNING … INTO`. That form takes a single row and raises
 * "query returned more than one row" on any batch bigger than one — the exact
 * bug 0071 had to fix, so it is not repeated here.
 *
 * A target whose account was disabled after scheduling is claimed and marked
 * 'skipped' by the caller rather than left pending forever.
 */
create or replace function claim_post_targets(p_limit int default 25)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb;
begin
  with candidate as (
    select t.id
      from post_targets t
      join social_accounts a on a.id = t.account_id
     where t.status = 'pending'
       and t.scheduled_at is not null
       and t.scheduled_at <= now()
     order by t.scheduled_at
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update skip locked
  ), claimed as (
    update post_targets t
       set status = 'sending', claimed_at = now()
      from candidate c
     where t.id = c.id
    returning t.id, t.post_id, t.account_id, t.workspace_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', cl.id, 'post_id', cl.post_id, 'account_id', cl.account_id,
           'workspace_id', cl.workspace_id,
           'provider', a.provider, 'account_enabled', a.enabled,
           'content', p.content, 'image_url', p.image_url
         )), '[]'::jsonb)
    into v_rows
    from claimed cl
    join social_accounts a on a.id = cl.account_id
    join posts p on p.id = cl.post_id;

  return v_rows;
end $$;
revoke all on function claim_post_targets(int) from public, authenticated, anon;
grant execute on function claim_post_targets(int) to service_role;

-- Only a claimed row can be resolved (`status = 'sending'` in the WHERE), which
-- is what stops a late reply from a previous run overwriting a newer attempt.
create or replace function mark_post_target(
  p_id uuid, p_status text, p_provider_post_id text default null,
  p_provider_url text default null, p_error text default null
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('sent', 'failed', 'skipped') then raise exception 'BAD_STATUS'; end if;
  update post_targets
     set status = p_status,
         provider_post_id = coalesce(p_provider_post_id, provider_post_id),
         provider_url = coalesce(p_provider_url, provider_url),
         error = left(p_error, 500),
         sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_id and status = 'sending';
  if not found then return false; end if;

  -- A post counts as published once ANY target lands. Requiring all of them
  -- would leave a post that went out on LinkedIn showing as a draft because X
  -- rejected it.
  if p_status = 'sent' then
    update posts p set status = 'published'
     where p.id = (select post_id from post_targets where id = p_id)
       and p.status <> 'published';
  end if;
  return true;
end $$;
revoke all on function mark_post_target(uuid, text, text, text, text) from public, authenticated, anon;
grant execute on function mark_post_target(uuid, text, text, text, text) to service_role;

/**
 * Sweep claims that never resolved — a crashed dispatcher, a timed-out request.
 *
 * They go to 'failed', NEVER back to 'pending'. A claim that has been sitting
 * in 'sending' for ten minutes may well have reached the platform; we cannot
 * tell, and the one thing worse than a post that did not go out is the same
 * post going out twice. A person can look at the feed and re-publish. The
 * machine must not guess.
 */
create or replace function sweep_stale_post_targets(p_minutes int default 10)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update post_targets
     set status = 'failed',
         error = 'Timed out while sending — check the platform before publishing again.'
   where status = 'sending'
     and claimed_at < now() - make_interval(mins => greatest(1, coalesce(p_minutes, 10)));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function sweep_stale_post_targets(int) from public, authenticated, anon;
grant execute on function sweep_stale_post_targets(int) to service_role;

notify pgrst, 'reload schema';
