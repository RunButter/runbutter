-- ============================================================================
-- RunButter — 0070_newsletters.sql
-- Newsletters: lists, subscribers, campaigns, and per-recipient delivery.
--
-- A native implementation of ideas listmonk proved out. NOT a port: listmonk is
-- AGPL-3.0, so copying its code would oblige us to relicense this whole product
-- away from MIT. Schema concepts are not copyrightable; the code is.
--
-- FOUR DECISIONS THAT SHAPE EVERYTHING BELOW
--
-- 1. A subscriber is an EMAIL ADDRESS, not a person. `people` holds humans in
--    the CRM; one human can hold two addresses, and a newsletter signup must not
--    silently manufacture a CRM contact. So subscribers key on
--    (workspace_id, email) and carry a nullable person_id to join the two when
--    they really are the same party.
--
-- 2. Consent is a RECORD, not a boolean. Under GDPR the obligation is to
--    demonstrate consent, and `subscribed = true` proves nothing about where it
--    came from. consent_source / consent_at / consent_ip are that proof.
--
-- 3. ONE DELIVERY ROW PER (newsletter, subscriber), UNIQUE. This is the most
--    important constraint in the file. It makes a send resumable after a crash
--    and makes double-sending structurally impossible rather than merely
--    unlikely — the worst failure a mailing tool has, because it is public,
--    irreversible, and lands in every customer's inbox at once.
--
-- 4. Unsubscribe needs no login. An unguessable per-subscriber token, because
--    Gmail and Yahoo require one-click unsubscribe from bulk senders and
--    deliverability collapses without it.
--
-- Additive, idempotent & prod-safe. Depends on 0001 (workspaces) and the
-- `people` table. Run AFTER 0069.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── Lists ────────────────────────────────────────────────────────────────────
create table if not exists newsletter_lists (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null default 'New list',
  description  text not null default '',
  -- 'single' = subscribed on submit. 'double' = must click a confirmation link.
  opt_in       text not null default 'single' check (opt_in in ('single', 'double')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_nl_lists_ws on newsletter_lists(workspace_id, updated_at desc);
drop trigger if exists trg_nl_lists_upd on newsletter_lists;
create trigger trg_nl_lists_upd before update on newsletter_lists for each row execute function set_updated_at();
alter table newsletter_lists enable row level security;
revoke all on table newsletter_lists from anon, authenticated;

-- ── Subscribers ──────────────────────────────────────────────────────────────
create table if not exists newsletter_subscribers (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  email         text not null,
  name          text not null default '',
  -- Nullable on purpose: a subscriber need not be in the CRM. set null on
  -- delete so removing a contact does not silently drop them off a mailing list
  -- they consented to — that would be a compliance problem, not a tidy-up.
  person_id     uuid references people(id) on delete set null,

  -- enabled  → mailable
  -- unconfirmed → double opt-in pending; NEVER mailed a campaign
  -- unsubscribed → they asked to stop
  -- bounced / complained → the provider told us to stop; treated as permanent
  status        text not null default 'enabled'
                check (status in ('enabled', 'unconfirmed', 'unsubscribed', 'bounced', 'complained')),

  -- Proof of consent, not just its existence.
  consent_source text not null default '',      -- 'form:<id>' | 'import' | 'manual' | 'api'
  consent_at     timestamptz,
  consent_ip     text,

  -- Unguessable. Used for one-click unsubscribe and double opt-in confirmation,
  -- so it must never be derivable from the email address.
  token         text not null default replace(gen_random_uuid()::text, '-', '') ,

  attribs       jsonb not null default '{}'::jsonb,   -- merge fields for templates
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Case-insensitive uniqueness per workspace: "A@x.com" and "a@x.com" are the
-- same inbox, and importing a CSV twice with different casing must not create a
-- second subscriber who then receives everything twice.
create unique index if not exists uq_nl_subs_ws_email on newsletter_subscribers(workspace_id, lower(email));
create unique index if not exists uq_nl_subs_token on newsletter_subscribers(token);
create index if not exists idx_nl_subs_ws on newsletter_subscribers(workspace_id, status);
drop trigger if exists trg_nl_subs_upd on newsletter_subscribers;
create trigger trg_nl_subs_upd before update on newsletter_subscribers for each row execute function set_updated_at();
alter table newsletter_subscribers enable row level security;
revoke all on table newsletter_subscribers from anon, authenticated;

-- ── Membership ───────────────────────────────────────────────────────────────
create table if not exists newsletter_list_subscribers (
  list_id       uuid not null references newsletter_lists(id) on delete cascade,
  subscriber_id uuid not null references newsletter_subscribers(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (list_id, subscriber_id)
);
create index if not exists idx_nl_ls_sub on newsletter_list_subscribers(subscriber_id);
alter table newsletter_list_subscribers enable row level security;
revoke all on table newsletter_list_subscribers from anon, authenticated;

-- ── Newsletters (the campaigns) ──────────────────────────────────────────────
create table if not exists newsletters (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  subject      text not null default '',
  -- Shown after the subject in most clients. Its own field because leaving it
  -- unset makes the client scrape the first body line, which is usually
  -- "View in browser".
  preheader    text not null default '',
  template     text not null default 'plain' check (template in ('plain', 'announcement', 'digest')),
  content      jsonb not null default '{}'::jsonb,   -- template-shaped blocks
  from_name    text not null default '',
  reply_to     text not null default '',

  status       text not null default 'draft'
               check (status in ('draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled')),
  scheduled_at timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz,

  created_by_privy text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_newsletters_ws on newsletters(workspace_id, updated_at desc);
-- The send cron's lookup: what is due right now.
create index if not exists idx_newsletters_due on newsletters(status, scheduled_at)
  where status in ('scheduled', 'sending');
drop trigger if exists trg_newsletters_upd on newsletters;
create trigger trg_newsletters_upd before update on newsletters for each row execute function set_updated_at();
alter table newsletters enable row level security;
revoke all on table newsletters from anon, authenticated;

create table if not exists newsletter_targets (
  newsletter_id uuid not null references newsletters(id) on delete cascade,
  list_id       uuid not null references newsletter_lists(id) on delete cascade,
  primary key (newsletter_id, list_id)
);
alter table newsletter_targets enable row level security;
revoke all on table newsletter_targets from anon, authenticated;

-- ── Deliveries — the table that makes sends safe ─────────────────────────────
create table if not exists newsletter_deliveries (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  newsletter_id uuid not null references newsletters(id) on delete cascade,
  subscriber_id uuid not null references newsletter_subscribers(id) on delete cascade,
  -- Snapshotted, not joined. If a subscriber later changes their address, the
  -- record of where this send actually WENT must not change with it.
  email         text not null,
  status        text not null default 'pending'
                check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider_id   text,          -- Resend's id, for reconciling bounces later
  error         text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
-- THE constraint. One row per recipient per newsletter — a retry after a crash
-- can only ever update a row, never create a second send.
create unique index if not exists uq_nl_deliveries on newsletter_deliveries(newsletter_id, subscriber_id);
create index if not exists idx_nl_deliveries_claim on newsletter_deliveries(newsletter_id, status);
alter table newsletter_deliveries enable row level security;
revoke all on table newsletter_deliveries from anon, authenticated;

-- ── Events (opens / clicks / unsubscribes) ───────────────────────────────────
create table if not exists newsletter_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  newsletter_id uuid references newsletters(id) on delete cascade,
  subscriber_id uuid references newsletter_subscribers(id) on delete set null,
  kind          text not null check (kind in ('open', 'click', 'unsubscribe', 'bounce', 'complaint')),
  url           text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_nl_events_nl on newsletter_events(newsletter_id, kind);
create index if not exists idx_nl_events_ws on newsletter_events(workspace_id, created_at desc);
alter table newsletter_events enable row level security;
revoke all on table newsletter_events from anon, authenticated;

-- ============================================================================
-- RPCs (client-facing, through the /api/rpc verified proxy)
-- ============================================================================

create or replace function get_newsletter_lists(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (
    select l.id, l.name, l.description, l.opt_in, l.updated_at,
           -- Only mailable members are counted. Showing a total that includes
           -- unsubscribed and bounced addresses would overstate reach on the
           -- exact screen someone uses to decide whether a send is worth it.
           (select count(*) from newsletter_list_subscribers ls
              join newsletter_subscribers s on s.id = ls.subscriber_id
             where ls.list_id = l.id and s.status = 'enabled') as subscriber_count
    from newsletter_lists l where l.workspace_id = p_workspace
  ) x), '[]'::jsonb);
end $$;
grant execute on function get_newsletter_lists(text, uuid) to authenticated, anon;

create or replace function save_newsletter_list(
  p_privy text, p_workspace uuid, p_id uuid, p_name text, p_description text, p_opt_in text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_id is null then
    insert into newsletter_lists (workspace_id, name, description, opt_in)
    values (p_workspace, coalesce(nullif(p_name,''),'New list'), coalesce(p_description,''),
            case when p_opt_in in ('single','double') then p_opt_in else 'single' end)
    returning id into v_id;
  else
    update newsletter_lists set
      name = coalesce(nullif(p_name,''), name),
      description = coalesce(p_description, description),
      opt_in = case when p_opt_in in ('single','double') then p_opt_in else opt_in end
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_newsletter_list(text, uuid, uuid, text, text, text) to authenticated, anon;

create or replace function delete_newsletter_list(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  delete from newsletter_lists where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function delete_newsletter_list(text, uuid, uuid) to authenticated, anon;

-- Paged: a list can hold six figures of addresses, and get_* returning all of
-- them would build one enormous jsonb per screen render.
create or replace function get_newsletter_subscribers(
  p_privy text, p_workspace uuid, p_list uuid default null,
  p_query text default null, p_limit int default 50, p_offset int default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb; v_total bigint; v_lim int; v_off int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  v_lim := greatest(1, least(coalesce(p_limit, 50), 200));
  v_off := greatest(0, coalesce(p_offset, 0));

  select count(*) into v_total
    from newsletter_subscribers s
   where s.workspace_id = p_workspace
     and (p_list is null or exists (select 1 from newsletter_list_subscribers ls
                                     where ls.subscriber_id = s.id and ls.list_id = p_list))
     and (p_query is null or p_query = '' or s.email ilike '%'||p_query||'%' or s.name ilike '%'||p_query||'%');

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_rows from (
    select s.id, s.email, s.name, s.status, s.person_id, s.consent_source, s.consent_at, s.created_at
      from newsletter_subscribers s
     where s.workspace_id = p_workspace
       and (p_list is null or exists (select 1 from newsletter_list_subscribers ls
                                       where ls.subscriber_id = s.id and ls.list_id = p_list))
       and (p_query is null or p_query = '' or s.email ilike '%'||p_query||'%' or s.name ilike '%'||p_query||'%')
     order by s.created_at desc
     limit v_lim offset v_off
  ) x;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end $$;
grant execute on function get_newsletter_subscribers(text, uuid, uuid, text, int, int) to authenticated, anon;

/**
 * Add or update one subscriber and put them on a list.
 *
 * Idempotent by (workspace, lower(email)), which is what makes a re-imported CSV
 * safe. Two rules that look like edge cases and are not:
 *   • An existing UNSUBSCRIBED/BOUNCED/COMPLAINED subscriber is NEVER silently
 *     re-enabled by an import. Someone who opted out must not be opted back in
 *     by uploading an old spreadsheet — that is the mechanism by which mailing
 *     tools generate complaints and get their domain blocked.
 *   • Consent fields are only written when the row is created, so a later import
 *     cannot overwrite the original proof of where consent came from.
 */
create or replace function upsert_newsletter_subscriber(
  p_privy text, p_workspace uuid, p_email text, p_name text default '',
  p_list uuid default null, p_source text default 'manual', p_ip text default null,
  p_status text default 'enabled'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_existing text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(p_email,'') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'BAD_EMAIL';
  end if;

  select id, status into v_id, v_existing
    from newsletter_subscribers
   where workspace_id = p_workspace and lower(email) = lower(p_email);

  if v_id is null then
    insert into newsletter_subscribers (workspace_id, email, name, status, consent_source, consent_at, consent_ip)
    values (p_workspace, p_email, coalesce(p_name,''),
            case when p_status in ('enabled','unconfirmed') then p_status else 'enabled' end,
            coalesce(p_source,'manual'), now(), p_ip)
    returning id into v_id;
  else
    update newsletter_subscribers
       set name = case when coalesce(p_name,'') <> '' then p_name else name end
     where id = v_id;
    -- deliberately no status change here; see the note above.
  end if;

  if p_list is not null then
    insert into newsletter_list_subscribers (list_id, subscriber_id)
    values (p_list, v_id) on conflict do nothing;
  end if;
  return v_id;
end $$;
grant execute on function upsert_newsletter_subscriber(text, uuid, text, text, uuid, text, text, text) to authenticated, anon;

create or replace function set_newsletter_subscriber_status(
  p_privy text, p_workspace uuid, p_id uuid, p_status text
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_status not in ('enabled','unconfirmed','unsubscribed','bounced','complained') then
    raise exception 'BAD_STATUS';
  end if;
  update newsletter_subscribers set status = p_status
   where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function set_newsletter_subscriber_status(text, uuid, uuid, text) to authenticated, anon;

create or replace function delete_newsletter_subscriber(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  delete from newsletter_subscribers where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function delete_newsletter_subscriber(text, uuid, uuid) to authenticated, anon;

-- ── Newsletters ──────────────────────────────────────────────────────────────
create or replace function get_newsletters(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
    select n.id, n.subject, n.preheader, n.template, n.status, n.scheduled_at,
           n.started_at, n.finished_at, n.updated_at,
           (select count(*) from newsletter_deliveries d where d.newsletter_id = n.id and d.status = 'sent') as sent_count,
           (select count(distinct e.subscriber_id) from newsletter_events e
             where e.newsletter_id = n.id and e.kind = 'open') as open_count,
           (select count(distinct e.subscriber_id) from newsletter_events e
             where e.newsletter_id = n.id and e.kind = 'click') as click_count,
           coalesce((select jsonb_agg(t.list_id) from newsletter_targets t where t.newsletter_id = n.id), '[]'::jsonb) as list_ids
    from newsletters n where n.workspace_id = p_workspace
  ) x), '[]'::jsonb);
end $$;
grant execute on function get_newsletters(text, uuid) to authenticated, anon;

create or replace function get_newsletter(p_privy text, p_workspace uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select to_jsonb(n) || jsonb_build_object(
    'list_ids', coalesce((select jsonb_agg(t.list_id) from newsletter_targets t where t.newsletter_id = n.id), '[]'::jsonb)
  ) into v from newsletters n where n.id = p_id and n.workspace_id = p_workspace;
  return v;
end $$;
grant execute on function get_newsletter(text, uuid, uuid) to authenticated, anon;

/**
 * Save a draft. Refuses to edit a newsletter that is already sending or sent —
 * changing the subject of a half-delivered send would mean two different emails
 * going out under one record, and the audit trail would describe neither.
 */
create or replace function save_newsletter(
  p_privy text, p_workspace uuid, p_id uuid, p_subject text, p_preheader text,
  p_template text, p_content jsonb, p_from_name text, p_reply_to text, p_list_ids uuid[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if pg_column_size(coalesce(p_content, '{}'::jsonb)) > 524288 then raise exception 'CONTENT_TOO_LARGE'; end if;

  if p_id is null then
    insert into newsletters (workspace_id, subject, preheader, template, content, from_name, reply_to, created_by_privy)
    values (p_workspace, coalesce(p_subject,''), coalesce(p_preheader,''),
            case when p_template in ('plain','announcement','digest') then p_template else 'plain' end,
            coalesce(p_content,'{}'::jsonb), coalesce(p_from_name,''), coalesce(p_reply_to,''), p_privy)
    returning id into v_id;
  else
    select status into v_status from newsletters where id = p_id and workspace_id = p_workspace;
    if v_status is null then return null; end if;
    if v_status in ('sending','sent') then raise exception 'ALREADY_SENT'; end if;
    update newsletters set
      subject = coalesce(p_subject, subject), preheader = coalesce(p_preheader, preheader),
      template = case when p_template in ('plain','announcement','digest') then p_template else template end,
      content = coalesce(p_content, content),
      from_name = coalesce(p_from_name, from_name), reply_to = coalesce(p_reply_to, reply_to)
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;

  if p_list_ids is not null then
    delete from newsletter_targets where newsletter_id = v_id;
    -- Only lists in THIS workspace survive, so a foreign list id cannot be
    -- stapled on to make a send reach another tenant's subscribers.
    insert into newsletter_targets (newsletter_id, list_id)
    select v_id, l.id from newsletter_lists l
     where l.workspace_id = p_workspace and l.id = any(p_list_ids)
    on conflict do nothing;
  end if;
  return v_id;
end $$;
grant execute on function save_newsletter(text, uuid, uuid, text, text, text, jsonb, text, text, uuid[]) to authenticated, anon;

create or replace function delete_newsletter(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select status into v_status from newsletters where id = p_id and workspace_id = p_workspace;
  if v_status is null then return false; end if;
  -- A sent newsletter is a record of something that reached real inboxes. It is
  -- kept so the delivery and event history stays explicable.
  if v_status in ('sending','sent') then raise exception 'ALREADY_SENT'; end if;
  delete from newsletters where id = p_id and workspace_id = p_workspace;
  return true;
end $$;
grant execute on function delete_newsletter(text, uuid, uuid) to authenticated, anon;

/**
 * Queue a send: materialise one delivery row per mailable recipient, then mark
 * the newsletter scheduled.
 *
 * Materialising up front rather than resolving recipients at send time is what
 * makes the audience a FACT about this send. If it were resolved per batch, a
 * subscriber added halfway through would get an email from a campaign that had
 * already "finished", and the sent count would never agree with the list count.
 *
 * Only 'enabled' subscribers are queued — unconfirmed (double opt-in pending),
 * unsubscribed, bounced and complained are all excluded here rather than being
 * filtered later, so the queue itself is the audience.
 */
create or replace function queue_newsletter(
  p_privy text, p_workspace uuid, p_id uuid, p_when timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_n int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select status into v_status from newsletters where id = p_id and workspace_id = p_workspace;
  if v_status is null then raise exception 'NOT_FOUND'; end if;
  if v_status in ('sending','sent') then raise exception 'ALREADY_SENT'; end if;
  if not exists (select 1 from newsletter_targets where newsletter_id = p_id) then raise exception 'NO_LISTS'; end if;

  insert into newsletter_deliveries (workspace_id, newsletter_id, subscriber_id, email)
  select distinct p_workspace, p_id, s.id, s.email
    from newsletter_targets t
    join newsletter_list_subscribers ls on ls.list_id = t.list_id
    join newsletter_subscribers s on s.id = ls.subscriber_id
   where t.newsletter_id = p_id
     and s.workspace_id = p_workspace
     and s.status = 'enabled'
  on conflict (newsletter_id, subscriber_id) do nothing;

  get diagnostics v_n = row_count;

  update newsletters
     set status = 'scheduled', scheduled_at = coalesce(p_when, now())
   where id = p_id and workspace_id = p_workspace;

  return jsonb_build_object('queued', v_n);
end $$;
grant execute on function queue_newsletter(text, uuid, uuid, timestamptz) to authenticated, anon;

create or replace function cancel_newsletter(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Cancelling mid-send is allowed and stops future batches; already-delivered
  -- rows stay 'sent' because those emails are in real inboxes and pretending
  -- otherwise would make the stats lie.
  update newsletters set status = 'cancelled'
   where id = p_id and workspace_id = p_workspace and status in ('scheduled','sending','paused');
  if not found then return false; end if;
  delete from newsletter_deliveries where newsletter_id = p_id and status = 'pending';
  return true;
end $$;
grant execute on function cancel_newsletter(text, uuid, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
