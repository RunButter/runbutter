-- ============================================================================
-- RunButter — 0057_assistant.sql
-- Chat assistant channels: connect a Telegram / Slack / WhatsApp bot and talk to
-- your workspace in natural language ("make an offer for Acme at 12k and show me
-- a preview"). Each inbound message runs the shared agent loop (lib/agents,
-- migration 0043) on the workspace's own AI key, and the reply goes back to the
-- chat. This migration is the channel storage + resolver; the per-platform
-- webhook routes live in /api/assistant/*.
--
-- Security model:
--   • allowed_senders is a strict allowlist of chat ids — an unlisted sender is
--     refused and told their id so the owner can add them. Without this, anyone
--     who found the bot could operate the workspace.
--   • bot_token / webhook_secret live in a service_role-only, RLS-denied table;
--     the webhook token in the URL only names the channel, it is not the secret.
--   • the agent acts as `acting_privy` (whoever connected the bot) and inherits
--     their autonomy setting — 'auto' executes writes, 'suggest' only proposes.
-- Depends on 0012 + 0043 (agents) + get_ai_secret (0034/0038).
-- ============================================================================

create table if not exists assistant_channels (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  platform       text not null default 'telegram' check (platform in ('telegram','slack','whatsapp')),
  bot_token      text,                                                   -- secret
  webhook_token  uuid not null default gen_random_uuid(),               -- inbound URL id
  webhook_secret text not null default replace(gen_random_uuid()::text,'-',''),  -- Telegram secret_token header
  allowed_senders text[] not null default '{}',
  autonomy       text not null default 'auto' check (autonomy in ('suggest','auto')),
  acting_privy   text,                                                   -- whose AI key + identity the agent uses
  enabled        boolean not null default true,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create unique index if not exists idx_assistant_channels_token on assistant_channels(webhook_token);
create index if not exists idx_assistant_channels_ws on assistant_channels(workspace_id);
alter table assistant_channels enable row level security;
revoke all on table assistant_channels from anon, authenticated;

-- ── Owner side ──────────────────────────────────────────────────────────────
create or replace function get_assistant_channels(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', c.id, 'platform', c.platform, 'webhook_token', c.webhook_token,
    'has_token', (c.bot_token is not null and c.bot_token <> ''),
    'allowed_senders', c.allowed_senders, 'autonomy', c.autonomy, 'enabled', c.enabled
  ) order by c.created_at) from assistant_channels c where c.workspace_id = p_workspace), '[]'::jsonb);
end $$;

create or replace function save_assistant_channel(
  p_privy text, p_workspace uuid, p_id uuid, p_platform text, p_bot_token text,
  p_allowed_senders text[], p_autonomy text, p_enabled boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text; v_id uuid; v_token uuid; v_secret text;
begin
  v_role := workspace_role(p_privy, p_workspace);
  if v_role is null or v_role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  if coalesce(p_platform,'telegram') not in ('telegram','slack','whatsapp') then raise exception 'BAD_PLATFORM'; end if;
  if coalesce(p_autonomy,'auto') not in ('suggest','auto') then raise exception 'BAD_AUTONOMY'; end if;

  if p_id is null then
    insert into assistant_channels (workspace_id, platform, bot_token, allowed_senders, autonomy, enabled, acting_privy)
    values (p_workspace, coalesce(p_platform,'telegram'), nullif(p_bot_token,''),
            coalesce(p_allowed_senders,'{}'), coalesce(p_autonomy,'auto'), coalesce(p_enabled,true), p_privy)
    returning id, webhook_token, webhook_secret into v_id, v_token, v_secret;
  else
    update assistant_channels set
      platform = coalesce(p_platform, platform),
      bot_token = coalesce(nullif(p_bot_token,''), bot_token),   -- keep when left blank
      allowed_senders = coalesce(p_allowed_senders, allowed_senders),
      autonomy = coalesce(p_autonomy, autonomy),
      enabled = coalesce(p_enabled, enabled),
      acting_privy = coalesce(acting_privy, p_privy),
      updated_at = now()
    where id = p_id and workspace_id = p_workspace
    returning id, webhook_token, webhook_secret into v_id, v_token, v_secret;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return jsonb_build_object('id', v_id, 'webhook_token', v_token, 'webhook_secret', v_secret);
end $$;

create or replace function delete_assistant_channel(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_role text; v_n int;
begin
  v_role := workspace_role(p_privy, p_workspace);
  if v_role is null or v_role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;
  delete from assistant_channels where id = p_id and workspace_id = p_workspace;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- ── Webhook side (service_role; the routes have vetted the request) ─────────
create or replace function resolve_assistant_channel(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'id', id, 'workspace_id', workspace_id, 'platform', platform, 'bot_token', bot_token,
    'webhook_secret', webhook_secret, 'allowed_senders', allowed_senders,
    'autonomy', autonomy, 'acting_privy', acting_privy, 'enabled', enabled
  ) into v from assistant_channels where webhook_token = p_token;
  return v;   -- null for an unknown token
end $$;

revoke all on function get_assistant_channels(text, uuid)                                       from public, anon, authenticated;
revoke all on function save_assistant_channel(text, uuid, uuid, text, text, text[], text, boolean) from public, anon, authenticated;
revoke all on function delete_assistant_channel(text, uuid, uuid)                               from public, anon, authenticated;
revoke all on function resolve_assistant_channel(uuid)                                          from public, anon, authenticated;
grant execute on function get_assistant_channels(text, uuid)                                       to service_role;
grant execute on function save_assistant_channel(text, uuid, uuid, text, text, text[], text, boolean) to service_role;
grant execute on function delete_assistant_channel(text, uuid, uuid)                               to service_role;
grant execute on function resolve_assistant_channel(uuid)                                          to service_role;

notify pgrst, 'reload schema';
