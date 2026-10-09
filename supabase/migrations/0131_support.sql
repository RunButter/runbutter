-- ============================================================================
-- 0131_support.sql — a support inbox and a chat widget for your own website.
--
-- What Intercom, Plain and Chatwoot sell: a bubble on your site, an inbox for
-- the team, and the customer remembered as a CONTACT rather than as a ticket
-- number. Built natively, in the same database as the CRM, because that is
-- the whole point — the person who writes in is already in People, their deals
-- and invoices are one join away, and the Copilot can read the thread.
--
-- Chatwoot is MIT (outside its enterprise/ directory) and was read as a FEATURE
-- SPEC; nothing was copied. Running it alongside would mean a Rails app, Redis
-- and Sidekiq per self-hoster — the opposite of one core.
--
-- ── WHO MAY READ A CONVERSATION ─────────────────────────────────────────────
-- A visitor has no account. They hold a secret the SERVER derives —
-- HMAC-SHA256(server key, conversation id), see lib/support/token.ts — and the
-- database stores only its SHA-256, so a read of this table yields nothing
-- that opens a thread. Derived rather than random so a reply email can carry a
-- link back into the conversation without the secret ever being stored. Every
-- visitor function takes (conversation, token_hash) and checks both — an id
-- alone opens nothing. The route mints the conversation id for that reason.
--
-- All visitor functions are service_role only and reached through
-- /api/support/visitor, which rate-limits per IP. Nothing is added to
-- keep_public: fewer anon-reachable DEFINER functions is strictly better.
--
-- Internal notes (author_kind = 'note') are never returned to a visitor. That
-- filter lives in SQL, in the one function a visitor can read through.
-- ============================================================================

create table if not exists support_widgets (
  -- The PUBLIC id: it goes in the embed snippet on somebody's website, so it
  -- must reveal nothing and open nothing on its own.
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references workspaces(id) on delete cascade,
  enabled boolean not null default true,
  title text not null default 'Talk to us',
  greeting text not null default 'Ask us anything — we usually reply within a few hours.',
  color text not null default '#18181b',
  ask_email boolean not null default true,
  -- Where a new conversation is announced. Optional: the inbox is the record.
  notify_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists support_conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  widget_id uuid references support_widgets(id) on delete set null,
  token_hash text not null,
  person_id uuid references people(id) on delete set null,
  name text,
  email text,
  -- open = needs a reply · pending = waiting on the customer · closed = done.
  -- A visitor writing moves it to open; a team reply moves it to pending.
  status text not null default 'open' check (status in ('open', 'pending', 'closed')),
  assignee_privy text,
  subject text,
  page_url text,
  last_message_at timestamptz not null default now(),
  last_visitor_at timestamptz,
  last_team_at timestamptz,
  team_read_at timestamptz,
  visitor_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_support_conv_inbox on support_conversations(workspace_id, status, last_message_at desc);
create index if not exists idx_support_conv_person on support_conversations(person_id);

create table if not exists support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support_conversations(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  author_kind text not null check (author_kind in ('visitor', 'team', 'agent', 'note')),
  author_name text,
  author_privy text,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_support_msg_conv on support_messages(conversation_id, created_at);

-- No policies: every read goes through a DEFINER function. RLS on with none
-- means the anon key reading these tables over PostgREST gets zero rows.
alter table support_widgets       enable row level security;
alter table support_conversations enable row level security;
alter table support_messages      enable row level security;

-- ── Helpers ─────────────────────────────────────────────────────────────────

/** A message body: trimmed, 1–4000 characters, control characters dropped. */
create or replace function support_clean_body(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(left(btrim(regexp_replace(coalesce(p, ''), '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), 4000), '');
$$;

create or replace function support_clean_email(p text)
returns text language sql immutable set search_path = public as $$
  select case when lower(btrim(coalesce(p, ''))) ~ '^[^@\s]{1,64}@[^@\s]{1,253}\.[a-z]{2,}$'
              then lower(btrim(p)) end;
$$;

/** The conversation, if this token opens it. NULL otherwise — never which part failed. */
create or replace function support_visitor_conv(p_conversation uuid, p_token_hash text)
returns support_conversations language sql stable security definer set search_path = public as $$
  select * from support_conversations
   where id = p_conversation and token_hash = p_token_hash and coalesce(p_token_hash, '') <> '';
$$;

/**
 * Find the person this email belongs to, or add them — the same promise a
 * public form makes ("every submission becomes a person in your CRM"). The
 * plan's record limit is honoured: over it, the conversation still happens and
 * simply is not linked, because refusing a customer's message over a billing
 * limit is the wrong failure.
 */
create or replace function support_link_person(p_workspace uuid, p_name text, p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_first text; v_last text;
begin
  if p_email is null then return null; end if;
  select id into v from people where workspace_id = p_workspace and lower(email) = p_email
   order by created_at limit 1;
  if v is not null then return v; end if;
  v_first := nullif(split_part(btrim(coalesce(p_name, '')), ' ', 1), '');
  v_last  := nullif(btrim(substr(btrim(coalesce(p_name, '')), length(coalesce(v_first, '')) + 1)), '');
  begin
    perform enforce_record_limit(p_workspace, 1);
    insert into people (workspace_id, first_name, last_name, email, source)
    values (p_workspace, coalesce(v_first, split_part(p_email, '@', 1)), v_last, p_email, 'chat')
    returning id into v;
  exception when others then
    v := null;
  end;
  return v;
end $$;

-- ── Visitor side (service_role, via /api/support/visitor) ──────────────────

create or replace function support_widget_public(p_widget uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', w.id, 'title', w.title, 'greeting', w.greeting, 'color', w.color,
    'ask_email', w.ask_email, 'company', ws.name, 'logo', ws.logo_url)
    from support_widgets w join workspaces ws on ws.id = w.workspace_id
   where w.id = p_widget and w.enabled;
$$;

create or replace function support_start(
  p_id uuid, p_widget uuid, p_token_hash text, p_name text, p_email text, p_body text, p_page text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare w support_widgets; v_body text := support_clean_body(p_body);
        v_email text := support_clean_email(p_email); v_id uuid; v_person uuid;
        v_name text := nullif(left(btrim(coalesce(p_name, '')), 120), '');
begin
  select * into w from support_widgets where id = p_widget and enabled;
  if w.id is null then raise exception 'WIDGET_NOT_FOUND'; end if;
  if v_body is null then raise exception 'EMPTY_MESSAGE'; end if;
  if coalesce(length(p_token_hash), 0) <> 64 then raise exception 'BAD_TOKEN'; end if;
  if w.ask_email and v_email is null then raise exception 'EMAIL_REQUIRED'; end if;

  v_person := support_link_person(w.workspace_id, v_name, v_email);
  if p_id is null then raise exception 'BAD_ID'; end if;
  insert into support_conversations (id, workspace_id, widget_id, token_hash, person_id, name, email,
                                     subject, page_url, last_visitor_at)
  values (p_id, w.workspace_id, w.id, p_token_hash, v_person, v_name, v_email,
          left(v_body, 140), nullif(left(coalesce(p_page, ''), 500), ''), now())
  returning id into v_id;
  insert into support_messages (conversation_id, workspace_id, author_kind, author_name, body)
  values (v_id, w.workspace_id, 'visitor', v_name, v_body);

  return jsonb_build_object('conversation', v_id, 'workspace', w.workspace_id,
    'notify_email', w.notify_email, 'company',
    (select name from workspaces where id = w.workspace_id));
end $$;

create or replace function support_send(p_conversation uuid, p_token_hash text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c support_conversations; v_body text := support_clean_body(p_body); v_prev text;
begin
  c := support_visitor_conv(p_conversation, p_token_hash);
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  if v_body is null then raise exception 'EMPTY_MESSAGE'; end if;
  -- A conversation is a conversation, not a mailbox to fill.
  if (select count(*) from support_messages where conversation_id = c.id and author_kind = 'visitor') >= 500 then
    raise exception 'TOO_MANY_MESSAGES';
  end if;
  v_prev := c.status;
  insert into support_messages (conversation_id, workspace_id, author_kind, author_name, body)
  values (c.id, c.workspace_id, 'visitor', c.name, v_body);
  update support_conversations
     set status = 'open', last_message_at = now(), last_visitor_at = now(), visitor_seen_at = now()
   where id = c.id;
  -- The route announces a reply to something the team thought was handled.
  return jsonb_build_object('ok', true, 'was', v_prev, 'workspace', c.workspace_id);
end $$;

create or replace function support_identify(p_conversation uuid, p_token_hash text, p_name text, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c support_conversations; v_email text := support_clean_email(p_email);
        v_name text := nullif(left(btrim(coalesce(p_name, '')), 120), '');
begin
  c := support_visitor_conv(p_conversation, p_token_hash);
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  if v_email is null then raise exception 'BAD_EMAIL'; end if;
  update support_conversations
     set email = v_email, name = coalesce(v_name, name),
         person_id = coalesce(person_id, support_link_person(c.workspace_id, coalesce(v_name, c.name), v_email))
   where id = c.id;
  return jsonb_build_object('ok', true);
end $$;

/** Messages after `p_after` (ISO), without internal notes. Marks the thread seen. */
create or replace function support_poll(p_conversation uuid, p_token_hash text, p_after timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c support_conversations;
begin
  c := support_visitor_conv(p_conversation, p_token_hash);
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  update support_conversations set visitor_seen_at = now() where id = c.id;
  return jsonb_build_object(
    'status', c.status, 'email', c.email, 'name', c.name,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'from', case when m.author_kind = 'visitor' then 'visitor' else 'team' end,
        'name', case when m.author_kind = 'visitor' then null else m.author_name end,
        'body', m.body, 'at', m.created_at) order by m.created_at)
        from support_messages m
       where m.conversation_id = c.id and m.author_kind <> 'note'
         and (p_after is null or m.created_at > p_after)), '[]'::jsonb));
end $$;

-- ── Team side (through /api/rpc, Privy-verified) ────────────────────────────

create or replace function get_support_widget(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w support_widgets;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select * into w from support_widgets where workspace_id = p_workspace;
  if w.id is null then
    -- One widget per workspace, made on first look so the embed snippet is
    -- ready the moment somebody opens the screen. Starts DISABLED: nothing
    -- appears on anyone's website until a person switches it on.
    insert into support_widgets (workspace_id, enabled) values (p_workspace, false)
    on conflict (workspace_id) do nothing;
    select * into w from support_widgets where workspace_id = p_workspace;
  end if;
  return to_jsonb(w) || jsonb_build_object(
    'can_edit', coalesce(workspace_role(p_privy, p_workspace) in ('owner', 'admin'), false));
end $$;

create or replace function save_support_widget(p_privy text, p_workspace uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(workspace_role(p_privy, p_workspace), '') not in ('owner', 'admin') then
    raise exception 'FORBIDDEN: only an owner or admin can change the chat widget';
  end if;
  perform get_support_widget(p_privy, p_workspace);
  -- Key present = write it; absent = leave it (0088's rule).
  update support_widgets set
    enabled  = case when p_data ? 'enabled'  then coalesce((p_data->>'enabled')::boolean, enabled) else enabled end,
    title    = case when p_data ? 'title'    then coalesce(nullif(left(btrim(p_data->>'title'), 60), ''), title) else title end,
    greeting = case when p_data ? 'greeting' then left(btrim(coalesce(p_data->>'greeting', '')), 300) else greeting end,
    color    = case when p_data ? 'color' and p_data->>'color' ~ '^#[0-9a-fA-F]{6}$' then p_data->>'color' else color end,
    ask_email = case when p_data ? 'ask_email' then coalesce((p_data->>'ask_email')::boolean, ask_email) else ask_email end,
    notify_email = case when p_data ? 'notify_email' then support_clean_email(p_data->>'notify_email') else notify_email end,
    updated_at = now()
  where workspace_id = p_workspace;
  return get_support_widget(p_privy, p_workspace);
end $$;

create or replace function get_support_inbox(p_privy text, p_workspace uuid, p_view text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object(
    'counts', (select jsonb_build_object(
        'open', count(*) filter (where status = 'open'),
        'pending', count(*) filter (where status = 'pending'),
        'closed', count(*) filter (where status = 'closed'),
        'mine', count(*) filter (where status <> 'closed' and assignee_privy = p_privy),
        'unread', count(*) filter (where status <> 'closed' and last_visitor_at > coalesce(team_read_at, '-infinity')))
      from support_conversations where workspace_id = p_workspace),
    'rows', coalesce((
      select jsonb_agg(r order by (r->>'last_message_at') desc) from (
        select jsonb_build_object(
          'id', c.id, 'name', c.name, 'email', c.email, 'status', c.status,
          'assignee_privy', c.assignee_privy, 'subject', c.subject,
          'last_message_at', c.last_message_at,
          'unread', c.last_visitor_at > coalesce(c.team_read_at, '-infinity'),
          'preview', (select left(m.body, 140) from support_messages m
                       where m.conversation_id = c.id and m.author_kind <> 'note'
                       order by m.created_at desc limit 1)) as r
          from support_conversations c
         where c.workspace_id = p_workspace
           and case coalesce(p_view, 'open')
                 when 'all' then true
                 when 'mine' then c.status <> 'closed' and c.assignee_privy = p_privy
                 else c.status = p_view end
         order by c.last_message_at desc
         limit 300) x), '[]'::jsonb));
end $$;

create or replace function get_support_thread(p_privy text, p_workspace uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c support_conversations;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select * into c from support_conversations where id = p_id and workspace_id = p_workspace;
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  update support_conversations set team_read_at = now() where id = c.id;
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'email', c.email, 'status', c.status,
    'assignee_privy', c.assignee_privy, 'page_url', c.page_url, 'person_id', c.person_id,
    'created_at', c.created_at, 'visitor_seen_at', c.visitor_seen_at,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.author_kind, 'name', m.author_name,
        'mine', m.author_privy = p_privy, 'body', m.body, 'at', m.created_at) order by m.created_at)
        from support_messages m where m.conversation_id = c.id), '[]'::jsonb));
end $$;

/**
 * A reply or an internal note. `p_kind` is 'team' (a person), 'agent' (the
 * Copilot or an agent, so a reader can always tell) or 'note' (never shown to
 * the visitor). Returns what the route needs to decide on an email.
 */
create or replace function reply_support(p_privy text, p_workspace uuid, p_id uuid, p_body text, p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c support_conversations; v_body text := support_clean_body(p_body);
        v_kind text := case when p_kind in ('team', 'agent', 'note') then p_kind else 'team' end;
        v_name text; v_msg uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select * into c from support_conversations where id = p_id and workspace_id = p_workspace;
  if c.id is null then raise exception 'NOT_FOUND'; end if;
  if v_body is null then raise exception 'EMPTY_MESSAGE'; end if;
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_name
    from accounts where workspace_id = p_workspace and privy_user_id = p_privy order by created_at limit 1;

  insert into support_messages (conversation_id, workspace_id, author_kind, author_name, author_privy, body)
  values (c.id, p_workspace, v_kind, coalesce(v_name, 'Team'), p_privy, v_body)
  returning id into v_msg;

  if v_kind <> 'note' then
    update support_conversations
       set status = case when status = 'closed' then 'closed' else 'pending' end,
           last_message_at = now(), last_team_at = now(), team_read_at = now(),
           assignee_privy = coalesce(assignee_privy, p_privy)
     where id = c.id;
  end if;

  return jsonb_build_object('id', v_msg, 'kind', v_kind, 'email', c.email, 'name', c.name,
    'widget', c.widget_id, 'visitor_seen_at', c.visitor_seen_at,
    'company', (select name from workspaces where id = p_workspace), 'author', coalesce(v_name, 'Team'));
end $$;

create or replace function set_support_conversation(p_privy text, p_workspace uuid, p_id uuid, p_status text, p_assignee text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_assignee is not null and p_assignee <> '' and not is_workspace_member(p_workspace, p_assignee) then
    raise exception 'ASSIGNEE_NOT_A_MEMBER';
  end if;
  update support_conversations set
    status = case when p_status in ('open', 'pending', 'closed') then p_status else status end,
    -- NULL = leave it, '' = unassign.
    assignee_privy = case when p_assignee is null then assignee_privy else nullif(p_assignee, '') end
  where id = p_id and workspace_id = p_workspace;
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

-- ── Grants: service_role only, the 0105 pair ───────────────────────────────
revoke all on function support_clean_body(text)                                   from public, anon, authenticated;
revoke all on function support_clean_email(text)                                  from public, anon, authenticated;
revoke all on function support_visitor_conv(uuid, text)                           from public, anon, authenticated;
revoke all on function support_link_person(uuid, text, text)                      from public, anon, authenticated;
revoke all on function support_widget_public(uuid)                                from public, anon, authenticated;
revoke all on function support_start(uuid, uuid, text, text, text, text, text)          from public, anon, authenticated;
revoke all on function support_send(uuid, text, text)                             from public, anon, authenticated;
revoke all on function support_identify(uuid, text, text, text)                   from public, anon, authenticated;
revoke all on function support_poll(uuid, text, timestamptz)                      from public, anon, authenticated;
revoke all on function get_support_widget(text, uuid)                             from public, anon, authenticated;
revoke all on function save_support_widget(text, uuid, jsonb)                     from public, anon, authenticated;
revoke all on function get_support_inbox(text, uuid, text)                        from public, anon, authenticated;
revoke all on function get_support_thread(text, uuid, uuid)                       from public, anon, authenticated;
revoke all on function reply_support(text, uuid, uuid, text, text)                from public, anon, authenticated;
revoke all on function set_support_conversation(text, uuid, uuid, text, text)     from public, anon, authenticated;
grant execute on function support_clean_body(text)                                to service_role;
grant execute on function support_clean_email(text)                               to service_role;
grant execute on function support_visitor_conv(uuid, text)                        to service_role;
grant execute on function support_link_person(uuid, text, text)                   to service_role;
grant execute on function support_widget_public(uuid)                             to service_role;
grant execute on function support_start(uuid, uuid, text, text, text, text, text)       to service_role;
grant execute on function support_send(uuid, text, text)                          to service_role;
grant execute on function support_identify(uuid, text, text, text)                to service_role;
grant execute on function support_poll(uuid, text, timestamptz)                   to service_role;
grant execute on function get_support_widget(text, uuid)                          to service_role;
grant execute on function save_support_widget(text, uuid, jsonb)                  to service_role;
grant execute on function get_support_inbox(text, uuid, text)                     to service_role;
grant execute on function get_support_thread(text, uuid, uuid)                    to service_role;
grant execute on function reply_support(text, uuid, uuid, text, text)             to service_role;
grant execute on function set_support_conversation(text, uuid, uuid, text, text)  to service_role;

notify pgrst, 'reload schema';
