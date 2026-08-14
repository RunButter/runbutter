-- ============================================================================
-- RunButter — 0112_push_subscriptions.sql
--
-- Web push, so the product can reach somebody who is not looking at it.
--
-- ── WHY THIS RATHER THAN A NATIVE APP ───────────────────────────────────────
-- Push notifications were the one thing that genuinely required shipping to two
-- app stores, and they stopped being that: web push works on Android Chrome and,
-- since iOS 16.4, on iPhone from an INSTALLED home-screen app. So the same
-- Next.js build reaches both home screens, with one codebase and no review
-- queue. If a native shell is ever wanted, it wraps this rather than replacing
-- it.
--
-- ── A SUBSCRIPTION BELONGS TO A DEVICE, NOT A PERSON ────────────────────────
-- One human has a laptop, a phone and a work machine, and each browser mints its
-- own endpoint. The primary key is the endpoint for that reason, and re-granting
-- permission on the same browser upserts rather than accumulating duplicates —
-- otherwise a person who clears data twice gets every notification three times.
--
-- ── ENDPOINTS DIE SILENTLY AND MUST BE REAPED ───────────────────────────────
-- Uninstalling the app, clearing site data or simply not opening it for months
-- makes a push service answer 404/410 forever. `disable_push_subscription` is
-- what the sender calls on that, because a table that only ever grows means
-- every send gets slower and noisier for the rest of the product's life.
--
-- The workspace is stored so a send can be scoped to one tenant, and the privy
-- id so it can be scoped to one person. Both are needed: "your invoice is
-- overdue" goes to a person, "someone opened the data room" goes to whoever
-- owns it.
-- ============================================================================

create table if not exists push_subscriptions (
  -- The endpoint IS the identity of a browser install. Not a generated id.
  endpoint     text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  privy_user_id text not null,
  p256dh       text not null,
  auth         text not null,
  -- Free-text, for the person's own "which device is this" list. Never trusted.
  label        text not null default '',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when a push service says the endpoint is gone. Kept rather than deleted
  -- so a re-subscribe on the same browser is an update, not a new row.
  disabled_at  timestamptz
);

create index if not exists idx_push_subs_ws on push_subscriptions(workspace_id) where disabled_at is null;
create index if not exists idx_push_subs_privy on push_subscriptions(privy_user_id) where disabled_at is null;

alter table push_subscriptions enable row level security;
-- No policies: everything goes through the SECURITY DEFINER functions below.

create or replace function save_push_subscription(
  p_privy text, p_workspace uuid, p_endpoint text, p_p256dh text, p_auth text, p_label text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(trim(p_endpoint), '') = '' then raise exception 'NO_ENDPOINT'; end if;

  insert into push_subscriptions (endpoint, workspace_id, privy_user_id, p256dh, auth, label)
  values (p_endpoint, p_workspace, p_privy, p_p256dh, p_auth, coalesce(p_label, ''))
  on conflict (endpoint) do update set
    -- Re-granting on a browser that has changed hands must move the row to its
    -- new owner rather than keep notifying the previous one.
    workspace_id = excluded.workspace_id,
    privy_user_id = excluded.privy_user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    label = excluded.label,
    last_seen_at = now(),
    disabled_at = null;
end $$;

create or replace function delete_push_subscription(p_privy text, p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Scoped to the caller: turning off notifications on YOUR phone must not be
  -- able to turn them off on a colleague's.
  delete from push_subscriptions where endpoint = p_endpoint and privy_user_id = p_privy;
end $$;

create or replace function get_push_subscriptions(p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'endpoint', endpoint, 'label', label, 'created_at', created_at, 'disabled', disabled_at is not null
    ) order by created_at)
    from push_subscriptions where privy_user_id = p_privy
  ), '[]'::jsonb);
end $$;

-- Service-role only: the sender's read. Returns the keys, so it must never be
-- reachable from a browser — a p256dh/auth pair is what lets you encrypt to
-- somebody's device.
create or replace function push_targets(p_workspace uuid, p_privy text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth))
      from push_subscriptions
     where workspace_id = p_workspace
       and disabled_at is null
       and (p_privy is null or privy_user_id = p_privy)
  ), '[]'::jsonb);
end $$;

-- Called when a push service reports the endpoint is gone (404/410).
create or replace function disable_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update push_subscriptions set disabled_at = now() where endpoint = p_endpoint and disabled_at is null;
end $$;

revoke all on function save_push_subscription(text, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function delete_push_subscription(text, text)                       from public, anon, authenticated;
revoke all on function get_push_subscriptions(text)                               from public, anon, authenticated;
revoke all on function push_targets(uuid, text)                                   from public, anon, authenticated;
revoke all on function disable_push_subscription(text)                            from public, anon, authenticated;
grant execute on function save_push_subscription(text, uuid, text, text, text, text) to service_role;
grant execute on function delete_push_subscription(text, text)                       to service_role;
grant execute on function get_push_subscriptions(text)                               to service_role;
grant execute on function push_targets(uuid, text)                                   to service_role;
grant execute on function disable_push_subscription(text)                            to service_role;

notify pgrst, 'reload schema';
