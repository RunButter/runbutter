-- ============================================================================
-- RunButter — 0114_open_notices.sql
--
-- "Acme just opened your proposal." The notification that makes 0110 and 0111
-- worth having: you sent a link and you want to know it was read.
--
-- ── THROTTLED IN SQL, NOT IN THE ROUTE ──────────────────────────────────────
-- A client reading a proposal refreshes, opens three documents and comes back
-- after lunch. Pushing on every open turns a delightful notification into the
-- reason somebody switches notifications off — and once they do, every LATER
-- notification this product ever sends is lost too.
--
-- So the decision "is this worth telling anyone about" lives here, next to the
-- events, rather than in whichever route happens to call it. One notice per
-- room per hour: the first open tells you they arrived, and the fourteenth
-- refresh tells you nothing you did not already know.
--
-- The public reader has ALREADY inserted its event by the time this runs, so
-- "worth notifying" is exactly "this is the only open in the window" — count = 1
-- rather than count = 0.
--
-- ── THEY RETURN NULL RATHER THAN A REASON ───────────────────────────────────
-- Both functions answer with a target or nothing. The caller pushes when there
-- is a target and does nothing when there is not, so a route can never invent a
-- notification by misreading a status field.
--
-- Service-role only. These return a workspace id and a person's Privy id, which
-- is exactly what must never travel to the public page holding the token.
-- ============================================================================

create or replace function data_room_open_notice(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n int;
begin
  select * into r from data_rooms
   where token = p_token and revoked_at is null
     and (expires_at is null or expires_at > now());
  if not found then return null; end if;

  select count(*) into n from data_room_events
   where room_id = r.id and kind = 'open' and at > now() - interval '1 hour';

  -- Exactly one: the open that just happened. Anything more means we already
  -- said so within the hour.
  if n <> 1 then return null; end if;

  return jsonb_build_object(
    'workspace_id', r.workspace_id,
    'privy', r.created_by,
    'title', r.title
  );
end $$;

create or replace function client_portal_open_notice(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n int; v_client text;
begin
  select * into r from client_portals
   where token = p_token and revoked_at is null
     and (expires_at is null or expires_at > now());
  if not found then return null; end if;

  select count(*) into n from client_portal_events
   where portal_id = r.id and kind = 'open' and at > now() - interval '1 hour';
  if n <> 1 then return null; end if;

  select name into v_client from organizations where id = r.organization_id;

  return jsonb_build_object(
    'workspace_id', r.workspace_id,
    'privy', r.created_by,
    -- The client's name is the whole point of the notification: "somebody
    -- opened a portal" is not worth a buzz, "Acme opened theirs" is.
    'client', coalesce(v_client, 'A client')
  );
end $$;

revoke all on function data_room_open_notice(text)     from public, anon, authenticated;
revoke all on function client_portal_open_notice(text) from public, anon, authenticated;
grant execute on function data_room_open_notice(text)     to service_role;
grant execute on function client_portal_open_notice(text) to service_role;

notify pgrst, 'reload schema';
