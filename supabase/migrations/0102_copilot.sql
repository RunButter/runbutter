-- 0102: the Copilot — a conversation that can act on the workspace
--
-- WHY THIS IS A THREAD TABLE AND NOT A NEW AGENT SYSTEM. Everything a copilot
-- needs in order to DO things already exists and is already tenancy-safe: 27
-- tools behind one executor (`lib/agents/tools.ts`), suggest/auto autonomy,
-- proposal-and-approval, a per-run audit log (0043), live steps (0095) and
-- token accounting (0096/0101). The only thing missing was memory — `runAgent`
-- takes one task string and returns, so every question started from nothing.
-- So this adds the conversation and nothing else: each assistant turn is still
-- an ordinary `agent_runs` row, which is what makes approvals, the transcript
-- and the cost report work here for free rather than needing a second copy.
--
-- A THREAD BELONGS TO A PERSON, NOT TO THE WORKSPACE. Every other object here
-- is workspace-scoped, and this one deliberately is not: a copilot thread
-- contains whatever someone typed into it — half-formed plans, salary
-- questions, a draft of a message about a colleague. Making those readable by
-- every member because they share a workspace is a surprise nobody consented
-- to. Membership is still required (the workspace is where the data lives), but
-- ownership is the row's own `privy_user_id`.

create table if not exists copilot_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  privy_user_id text not null,
  -- Derived from the first message rather than asked for. A "name this chat"
  -- box is a question nobody wants at the moment they have just thought of
  -- something.
  title text not null default '',
  -- Per THREAD, not per workspace. "Draft me a plan" and "clean up these
  -- invoices" want different answers to "should this execute", and a single
  -- global switch means the honest choice is always the restrictive one.
  autonomy text not null default 'suggest' check (autonomy in ('suggest','auto')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_copilot_threads_owner
  on copilot_threads (workspace_id, privy_user_id, updated_at desc);

create table if not exists copilot_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references copilot_threads(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null default '',
  -- The run that produced an assistant turn. `set null` rather than cascade:
  -- losing the run must not delete the reply the person actually read, and the
  -- reply is the part of the record that matters afterwards.
  run_id uuid references agent_runs(id) on delete set null,
  -- What the person was looking at when they asked. Stored because "add her to
  -- the list" is only answerable with it, and because a transcript that cannot
  -- explain why the copilot picked an object is a transcript nobody can audit.
  page_path text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists idx_copilot_messages_thread
  on copilot_messages (thread_id, created_at);

alter table copilot_threads enable row level security;
alter table copilot_messages enable row level security;
-- No policies: everything below is SECURITY DEFINER and re-checks both
-- membership AND ownership. Anon reaches these only through /api/rpc, which
-- overwrites p_privy from the verified token.

-- ── Ownership, in one place ─────────────────────────────────────────────────
--
-- Every function below calls this. Scattering the rule is how the private half
-- of a private thread eventually leaks — the same reasoning as
-- `can_read_channel` in 0075.
create or replace function copilot_thread_owned(p_thread uuid, p_privy text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from copilot_threads t
    where t.id = p_thread
      and t.privy_user_id = p_privy
      and is_workspace_member(t.workspace_id, p_privy)
  );
$$;

create or replace function get_copilot_threads(p_privy text, p_workspace uuid, p_limit int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'autonomy', t.autonomy, 'updated_at', t.updated_at
    ) order by t.updated_at desc)
    from (
      select * from copilot_threads
      where workspace_id = p_workspace and privy_user_id = p_privy
      order by updated_at desc limit v_limit
    ) t
  ), '[]'::jsonb);
end $$;
grant execute on function get_copilot_threads(text, uuid, int) to authenticated, anon;

-- One thread, with its messages and whatever each assistant turn actually did.
--
-- The run is joined here rather than fetched per message by the client: a
-- twenty-turn thread would otherwise be twenty round trips, and the steps are
-- what make the reply believable.
create or replace function get_copilot_thread(p_privy text, p_thread uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not copilot_thread_owned(p_thread, p_privy) then raise exception 'NOT_FOUND'; end if;
  return (
    select jsonb_build_object(
      'id', t.id, 'title', t.title, 'autonomy', t.autonomy,
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'role', m.role, 'content', m.content,
          'page_path', m.page_path, 'created_at', m.created_at,
          'run_id', m.run_id,
          'status', r.status, 'steps', r.steps, 'proposed', r.proposed
        ) order by m.created_at)
        from copilot_messages m
        left join agent_runs r on r.id = m.run_id
        where m.thread_id = t.id
      ), '[]'::jsonb)
    )
    from copilot_threads t where t.id = p_thread
  );
end $$;
grant execute on function get_copilot_thread(text, uuid) to authenticated, anon;

create or replace function create_copilot_thread(p_privy text, p_workspace uuid, p_autonomy text default 'suggest')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  insert into copilot_threads (workspace_id, privy_user_id, autonomy)
  -- An unrecognised value falls back to the SAFE one, never to 'auto'. A typo
  -- must not be how a thread starts executing writes without being asked.
  values (p_workspace, p_privy, case when p_autonomy = 'auto' then 'auto' else 'suggest' end)
  returning id into v_id;
  return v_id;
end $$;
grant execute on function create_copilot_thread(text, uuid, text) to authenticated, anon;

create or replace function set_copilot_thread(p_privy text, p_thread uuid, p_title text default null, p_autonomy text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not copilot_thread_owned(p_thread, p_privy) then raise exception 'NOT_FOUND'; end if;
  -- NULL means "leave it alone", the same reading `update_record` gives an
  -- absent key (0088) — otherwise renaming a thread would silently reset its
  -- autonomy to whatever the caller happened to not send.
  update copilot_threads set
    title = coalesce(nullif(p_title, ''), title),
    autonomy = case when p_autonomy in ('suggest','auto') then p_autonomy else autonomy end,
    updated_at = now()
  where id = p_thread;
end $$;
grant execute on function set_copilot_thread(text, uuid, text, text) to authenticated, anon;

create or replace function delete_copilot_thread(p_privy text, p_thread uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not copilot_thread_owned(p_thread, p_privy) then raise exception 'NOT_FOUND'; end if;
  delete from copilot_threads where id = p_thread;
end $$;
grant execute on function delete_copilot_thread(text, uuid) to authenticated, anon;

-- ── Writing a turn ──────────────────────────────────────────────────────────
--
-- service_role ONLY, and deliberately absent from /api/rpc's ALLOWED list. The
-- same rule that keeps `append_agent_run_step` server-side: a client that could
-- write assistant messages could forge a transcript of work that never
-- happened, complete with a run id pointing at somebody else's run.
create or replace function append_copilot_message(
  p_thread uuid, p_role text, p_content text,
  p_run uuid default null, p_page text default ''
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_role not in ('user','assistant') then raise exception 'BAD_ROLE'; end if;
  insert into copilot_messages (thread_id, role, content, run_id, page_path)
  values (p_thread, p_role, coalesce(p_content,''), p_run, coalesce(p_page,''))
  returning id into v_id;

  -- The title is the first thing the person said, trimmed. Set once and never
  -- overwritten, so a thread keeps the name its owner recognises even after
  -- twenty turns have moved the subject on.
  update copilot_threads set
    updated_at = now(),
    title = case
      when title <> '' or p_role <> 'user' then title
      else left(regexp_replace(coalesce(p_content,''), '\s+', ' ', 'g'), 60)
    end
  where id = p_thread;
  return v_id;
end $$;
revoke all on function append_copilot_message(uuid, text, text, uuid, text) from public, authenticated, anon;
grant execute on function append_copilot_message(uuid, text, text, uuid, text) to service_role;

-- The conversation so far, as plain turns, for seeding the next run.
--
-- PLAIN TEXT, NOT PROVIDER HISTORY. A Claude turn is content blocks and an
-- OpenAI turn is a message list; storing either would make a thread break the
-- moment somebody changes their model, and tool traffic inside a past run is
-- not context the next run needs. Newest-N then reversed, so a long thread
-- stays affordable rather than growing the prompt without limit.
create or replace function get_copilot_history(p_thread uuid, p_turns int default 12)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_turns int := least(greatest(coalesce(p_turns, 12), 1), 40);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('role', m.role, 'content', m.content) order by m.created_at)
    from (
      select role, content, created_at from copilot_messages
      where thread_id = p_thread and content <> ''
      order by created_at desc limit v_turns
    ) m
  ), '[]'::jsonb);
end $$;
revoke all on function get_copilot_history(uuid, int) from public, authenticated, anon;
grant execute on function get_copilot_history(uuid, int) to service_role;

notify pgrst, 'reload schema';
