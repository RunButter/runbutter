-- ============================================================================
-- RunButter — 0111_client_portals.sql
--
-- Give one client a link and they see THEIR invoices and THEIR documents, under
-- your brand, without an account.
--
-- This is the thing Notion, ClickUp and Monday structurally cannot ship: it
-- needs invoices, files and an organisation in ONE database. It is also the
-- first surface where a customer's customer sees this product working.
--
-- ── LIVE, NOT FROZEN — AND WHY THAT IS THE OPPOSITE CALL FROM 0109/0110 ─────
-- A published chart is a claim about a moment, so it is frozen. A data room is
-- a set of documents somebody chose, so that set is frozen. But a client portal
-- exists to answer "is my invoice marked paid yet", and a frozen answer to that
-- is worse than no answer.
--
-- So this one reads live, and the safety comes from somewhere else: THE TOKEN
-- IS THE ENTIRE QUERY. get_client_portal takes a token and NOTHING else — no
-- object name, no filter, no id, no pagination cursor. The organisation is read
-- off the stored row, and the shape of what comes back is fixed in SQL. There
-- is no argument an attacker can vary, because there is no argument.
--
-- That is a different property from "the query is filtered correctly", which is
-- the thing that goes wrong in every multi-tenant breach. Here there is no
-- caller-supplied filter to get wrong.
--
-- ── WHAT IS DELIBERATELY NOT SHOWN ──────────────────────────────────────────
--   • `notes` on an invoice. Those are internal — "chase them, they always pay
--     late" is exactly the sort of line that must never reach the client.
--   • Costs. Only `direction = 'income'` rows are returned: an invoice the
--     client owes YOU. A supplier bill is nobody else's business.
--   • Every other object. Files are the ones explicitly attached to the portal,
--     the same fixed-array rule as a data room — never "all files mentioning
--     this company", which would leak whatever somebody filed next.
--
-- Access is logged per open, with no IP and no fingerprint, as in 0110.
-- ============================================================================

create table if not exists client_portals (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  token           text not null unique,
  title           text not null default 'Your account',
  note            text not null default '',
  show_invoices   boolean not null default true,
  -- Explicitly attached, never inferred. Same rule as data_rooms.file_ids.
  file_ids        uuid[] not null default '{}',
  created_by      text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  revoked_at      timestamptz
);

create index if not exists idx_client_portals_ws on client_portals(workspace_id, created_at desc);
create unique index if not exists uq_client_portal_org on client_portals(organization_id) where revoked_at is null;

create table if not exists client_portal_events (
  id        uuid primary key default gen_random_uuid(),
  portal_id uuid not null references client_portals(id) on delete cascade,
  kind      text not null default 'open',
  file_id   uuid,
  at        timestamptz not null default now()
);

create index if not exists idx_client_portal_events on client_portal_events(portal_id, at desc);

alter table client_portals enable row level security;
alter table client_portal_events enable row level security;

create or replace function create_client_portal(
  p_privy text, p_workspace uuid, p_organization uuid, p_title text, p_note text,
  p_show_invoices boolean, p_files uuid[], p_days int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_token text; v_id uuid; v_ok uuid[];
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if not exists (select 1 from organizations where id = p_organization and workspace_id = p_workspace) then
    raise exception 'UNKNOWN_ORGANIZATION';
  end if;

  -- Only files this workspace owns; a crafted id from another tenant is dropped
  -- rather than trusted, exactly as in create_data_room.
  select coalesce(array_agg(f.id), '{}') into v_ok
    from files f where f.workspace_id = p_workspace and f.id = any(coalesce(p_files, '{}'));

  -- One live portal per client, so "send them the link" never means choosing
  -- between three of them. Re-issuing revokes the old one, which is also how
  -- somebody rotates a link they sent to the wrong address.
  update client_portals set revoked_at = now()
   where organization_id = p_organization and revoked_at is null;

  v_token := encode(gen_random_bytes(16), 'hex');
  insert into client_portals (workspace_id, organization_id, token, title, note, show_invoices, file_ids, created_by, expires_at)
  values (p_workspace, p_organization, v_token,
          coalesce(nullif(trim(p_title), ''), 'Your account'), coalesce(p_note, ''),
          coalesce(p_show_invoices, true), v_ok, p_privy,
          case when p_days is not null and p_days > 0 then now() + make_interval(days => p_days) end)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

/**
 * The public read. ONE argument, and it is the token — see the header.
 *
 * Everything returned is scoped by the organisation stored on the row. Nothing
 * about the shape is caller-controlled, so there is no filter to get wrong.
 */
create or replace function get_client_portal(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from client_portals
   where token = p_token and revoked_at is null
     and (expires_at is null or expires_at > now());
  if not found then return null; end if;

  insert into client_portal_events (portal_id, kind) values (r.id, 'open');

  return jsonb_build_object(
    'title', r.title,
    'note', r.note,
    'client', (select name from organizations where id = r.organization_id),
    'invoices', case when r.show_invoices then coalesce((
      -- NO `notes`, and income only. See the header.
      select jsonb_agg(jsonb_build_object(
               'number', i.number, 'kind', coalesce(i.kind, 'invoice'),
               'amount', i.amount, 'currency', i.currency,
               'status', i.status, 'issued_at', i.issued_at, 'due_at', i.due_at
             ) order by coalesce(i.issued_at, i.due_at) desc nulls last)
        from invoices i
       where i.organization_id = r.organization_id
         and i.workspace_id = r.workspace_id
         and coalesce(i.direction, 'income') = 'income'
    ), '[]'::jsonb) else '[]'::jsonb end,
    'files', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'size', f.size_bytes) order by f.name)
        from files f where f.id = any(r.file_ids)
    ), '[]'::jsonb),
    'brand', (select jsonb_build_object('name', w.name, 'logo_url', w.logo_url, 'accent', w.accent_color)
                from workspaces w where w.id = r.workspace_id)
  );
end $$;

-- One document, only if it is attached to this portal.
create or replace function client_portal_file_path(p_token text, p_file uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; f record;
begin
  select * into r from client_portals
   where token = p_token and revoked_at is null
     and (expires_at is null or expires_at > now());
  if not found then return null; end if;
  if not (p_file = any(r.file_ids)) then return null; end if;

  select id, name, storage_path into f from files where id = p_file and workspace_id = r.workspace_id;
  if not found then return null; end if;

  insert into client_portal_events (portal_id, kind, file_id) values (r.id, 'file', f.id);
  return jsonb_build_object('path', f.storage_path, 'name', f.name);
end $$;

create or replace function get_client_portals(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'token', p.token, 'title', p.title,
      'organization_id', p.organization_id,
      'client', (select name from organizations o where o.id = p.organization_id),
      'created_at', p.created_at, 'expires_at', p.expires_at, 'revoked_at', p.revoked_at,
      'file_count', coalesce(array_length(p.file_ids, 1), 0),
      'opens', (select count(*) from client_portal_events e where e.portal_id = p.id and e.kind = 'open'),
      'last_open', (select max(e.at) from client_portal_events e where e.portal_id = p.id)
    ) order by p.created_at desc)
    from client_portals p where p.workspace_id = p_workspace and p.revoked_at is null
  ), '[]'::jsonb);
end $$;

create or replace function revoke_client_portal(p_privy text, p_workspace uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update client_portals set revoked_at = now()
   where id = p_id and workspace_id = p_workspace and revoked_at is null;
end $$;

revoke all on function create_client_portal(text, uuid, uuid, text, text, boolean, uuid[], int) from public, anon, authenticated;
revoke all on function get_client_portal(text)                        from public, anon, authenticated;
revoke all on function client_portal_file_path(text, uuid)            from public, anon, authenticated;
revoke all on function get_client_portals(text, uuid)                 from public, anon, authenticated;
revoke all on function revoke_client_portal(text, uuid, uuid)         from public, anon, authenticated;
grant execute on function create_client_portal(text, uuid, uuid, text, text, boolean, uuid[], int) to service_role;
grant execute on function get_client_portal(text)                        to service_role;
grant execute on function client_portal_file_path(text, uuid)            to service_role;
grant execute on function get_client_portals(text, uuid)                 to service_role;
grant execute on function revoke_client_portal(text, uuid, uuid)         to service_role;

notify pgrst, 'reload schema';
