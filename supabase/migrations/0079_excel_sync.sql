-- ============================================================================
-- RunButter — 0079_excel_sync.sql
-- Two-way Excel sync over Microsoft Graph: someone edits the workbook, the
-- workspace sees it; someone edits the workspace, the workbook sees it.
--
-- WHY THIS EXISTS ALONGSIDE 0078.
-- 0078's feed is a URL you paste into Excel: zero setup, works for anyone, and
-- strictly one-way (Excel reads, never writes). That covers "I want these
-- numbers in my sheet". It does NOT cover "my team works IN the sheet" — the
-- actual situation in most companies, where the spreadsheet is where the edits
-- happen and the app is downstream. That needs write access to the workbook,
-- which needs OAuth, which is what this migration stores.
--
-- The two are complementary and both stay: the feed for people who just want
-- data, this for people whose workbook is the source of truth.
--
-- THE HARD PART IS NOT THE API, IT IS THE CONFLICT RULE.
-- Graph gives no per-cell change timestamps, so a real three-way merge is not
-- available at any price. Rather than fake one, the rule is stated plainly and
-- enforced in one place (lib/excel/sync.ts):
--
--   • inbound runs FIRST — a person editing a cell is the most recent intent
--   • then outbound rewrites the sheet from the database, so both agree
--   • a sheet row with no id is a NEW record
--   • a row DELETED from the sheet never deletes the record
--
-- That last rule is the one that matters. A filtered view, a sort that pushed
-- rows below the table range, or someone clearing a few lines all look exactly
-- like deletion over the API, and a sync that honoured them would silently
-- destroy data with no undo. Deleting is done in the app, on purpose.
--
-- TOKENS ARE ENCRYPTED AT REST (lib/crypto/secrets.ts), unlike the older
-- integration_tokens rows. A Files.ReadWrite token opens every workbook the
-- person can open, including ones that have nothing to do with us, so a leaked
-- database dump must not be a leaked OneDrive.
--
-- Depends on 0001 (workspaces, is_workspace_member).
-- Idempotent & prod-safe.
-- ============================================================================

-- ── The OAuth connection ─────────────────────────────────────────────────────
-- Per (workspace, person): the grant is personal — it is that person's OneDrive
-- or SharePoint access — but it is used on behalf of a workspace, and both have
-- to match before any sync runs.
create table if not exists ms_connections (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  privy_user_id  text not null,
  account_email  text,
  -- Sealed with SECRETS_MASTER_KEY (AES-256-GCM). Never selected by the RPCs
  -- below — only the service-role sync path reads them.
  access_cipher  text, access_iv text, access_tag text,
  refresh_cipher text, refresh_iv text, refresh_tag text,
  expires_at     timestamptz,
  scope          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, privy_user_id)
);

alter table ms_connections enable row level security;
revoke all on table ms_connections from anon, authenticated;

-- ── A linked table inside a workbook ─────────────────────────────────────────
create table if not exists excel_links (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  connection_id  uuid not null references ms_connections(id) on delete cascade,
  -- Which RunButter object this sheet mirrors ('people', 'invoices', …).
  object         text not null,
  -- Graph coordinates. drive_id + item_id identify the workbook wherever it
  -- lives (personal OneDrive or a SharePoint document library).
  drive_id       text not null,
  item_id        text not null,
  file_name      text,
  worksheet      text not null default 'RunButter',
  -- Graph's *table* name, not the sheet name. Rows are read and written through
  -- a real Excel table so a user can sort, filter and add columns beside it
  -- without the sync overwriting their work.
  table_name     text,
  direction      text not null default 'out',
  enabled        boolean not null default true,
  last_sync_at   timestamptz,
  last_status    text,
  last_error     text,
  last_rows_out  int not null default 0,
  last_rows_in   int not null default 0,
  created_by_privy text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- One link per sheet. Two links writing the same worksheet would each undo
  -- the other on every run.
  unique (workspace_id, item_id, worksheet)
);

do $$ begin
  alter table excel_links add constraint excel_links_direction_check
    check (direction in ('out', 'in', 'both'));
exception when duplicate_object then null; end $$;

create index if not exists idx_excel_links_ws on excel_links(workspace_id);
-- The sweep the cron runs: enabled links, oldest sync first.
create index if not exists idx_excel_links_due on excel_links(enabled, last_sync_at);

alter table excel_links enable row level security;
revoke all on table excel_links from anon, authenticated;

-- ── Reads ────────────────────────────────────────────────────────────────────
create or replace function get_ms_connection(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Deliberately no token columns: this answers "is it connected, and as whom",
  -- which is all the UI needs. Nothing that returns to a browser can widen.
  select jsonb_build_object(
    'id', c.id, 'account_email', c.account_email,
    'expires_at', c.expires_at, 'created_at', c.created_at,
    'connected_by_me', (c.privy_user_id = p_privy)
  ) into v
  from ms_connections c
  where c.workspace_id = p_workspace
  order by (c.privy_user_id = p_privy) desc, c.created_at
  limit 1;
  return v;   -- null when nothing is connected
end $$;
grant execute on function get_ms_connection(text, uuid) to authenticated, anon;

create or replace function get_excel_links(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', l.id, 'object', l.object, 'file_name', l.file_name,
    'worksheet', l.worksheet, 'table_name', l.table_name,
    'direction', l.direction, 'enabled', l.enabled,
    'last_sync_at', l.last_sync_at, 'last_status', l.last_status, 'last_error', l.last_error,
    'last_rows_out', l.last_rows_out, 'last_rows_in', l.last_rows_in,
    'created_at', l.created_at
  ) order by l.created_at desc) from excel_links l where l.workspace_id = p_workspace), '[]'::jsonb);
end $$;
grant execute on function get_excel_links(text, uuid) to authenticated, anon;

-- ── Writes ───────────────────────────────────────────────────────────────────
create or replace function save_excel_link(
  p_privy text, p_workspace uuid, p_id uuid,
  p_object text, p_drive_id text, p_item_id text, p_file_name text,
  p_worksheet text, p_direction text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_conn uuid; v_dir text; v_sheet text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  -- A link is worthless without a connection to sync through, and creating one
  -- anyway would leave a row that fails on every cron tick forever.
  select c.id into v_conn from ms_connections c
   where c.workspace_id = p_workspace
   order by (c.privy_user_id = p_privy) desc, c.created_at limit 1;
  if v_conn is null then raise exception 'NOT_CONNECTED'; end if;

  -- Anything unrecognised becomes the read-only direction. As with API key
  -- scopes (0078), a typo must never grant more than was asked for — and here
  -- "more" means writing into someone's workbook.
  v_dir := case when p_direction in ('out', 'in', 'both') then p_direction else 'out' end;
  v_sheet := coalesce(nullif(trim(p_worksheet), ''), 'RunButter');

  if p_id is null then
    insert into excel_links (workspace_id, connection_id, object, drive_id, item_id,
                             file_name, worksheet, direction, created_by_privy)
    values (p_workspace, v_conn, p_object, p_drive_id, p_item_id,
            p_file_name, v_sheet, v_dir, p_privy)
    -- Re-linking a sheet already linked is an update, not a duplicate-key error
    -- the user has no way to interpret.
    on conflict (workspace_id, item_id, worksheet) do update
      set object = excluded.object, direction = excluded.direction,
          file_name = excluded.file_name, connection_id = excluded.connection_id,
          enabled = true, updated_at = now()
    returning id into v_id;
  else
    update excel_links set
      object = p_object, direction = v_dir, worksheet = v_sheet,
      file_name = coalesce(p_file_name, file_name), updated_at = now()
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;

  return v_id;
end $$;
grant execute on function save_excel_link(text, uuid, uuid, text, text, text, text, text, text) to authenticated, anon;

create or replace function set_excel_link_enabled(p_privy text, p_workspace uuid, p_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update excel_links set enabled = p_enabled, updated_at = now()
   where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function set_excel_link_enabled(text, uuid, uuid, boolean) to authenticated, anon;

create or replace function delete_excel_link(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Unlinking never touches the workbook. The user's file is theirs; we stop
  -- syncing, we do not tidy up after ourselves in their document.
  delete from excel_links where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function delete_excel_link(text, uuid, uuid) to authenticated, anon;

create or replace function disconnect_microsoft(p_privy text, p_workspace uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Cascades to excel_links: a link without a token cannot sync, and leaving
  -- the rows behind would show "connected" sheets that silently never run.
  delete from ms_connections where workspace_id = p_workspace;
  return found;
end $$;
grant execute on function disconnect_microsoft(text, uuid) to authenticated, anon;

-- ── Sync bookkeeping (service_role only) ─────────────────────────────────────
-- Called by the sync route after each run. Anon/authenticated are revoked
-- because a client that could write last_status could hide a failing sync.
create or replace function record_excel_sync(
  p_id uuid, p_status text, p_error text, p_out int, p_in int
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  update excel_links set
    last_sync_at = now(),
    last_status = left(coalesce(p_status, 'error'), 40),
    last_error = left(nullif(p_error, ''), 500),
    last_rows_out = coalesce(p_out, 0),
    last_rows_in = coalesce(p_in, 0),
    updated_at = now()
  where id = p_id;
  return found;
end $$;
revoke all on function record_excel_sync(uuid, text, text, int, int) from public, authenticated, anon;
grant execute on function record_excel_sync(uuid, text, text, int, int) to service_role;

-- Claim the links a sweep should run, oldest first. FOR UPDATE SKIP LOCKED so
-- two overlapping cron ticks cannot both pick up the same sheet and race each
-- other's writes into the same workbook.
create or replace function claim_excel_links(p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with candidate as (
    select l.id from excel_links l
     where l.enabled = true
     order by l.last_sync_at nulls first
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  ), claimed as (
    update excel_links l set last_sync_at = now()
      from candidate c where l.id = c.id
    returning l.id, l.workspace_id, l.connection_id, l.object,
              l.drive_id, l.item_id, l.worksheet, l.table_name, l.direction
  )
  select coalesce(jsonb_agg(to_jsonb(cl)), '[]'::jsonb) into v from claimed cl;
  return v;
end $$;
revoke all on function claim_excel_links(int) from public, authenticated, anon;
grant execute on function claim_excel_links(int) to service_role;

-- The sync route learns the table name it created; it has no user session.
create or replace function set_excel_table_name(p_id uuid, p_table text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update excel_links set table_name = p_table, updated_at = now() where id = p_id;
  return found;
end $$;
revoke all on function set_excel_table_name(uuid, text) from public, authenticated, anon;
grant execute on function set_excel_table_name(uuid, text) to service_role;

notify pgrst, 'reload schema';
