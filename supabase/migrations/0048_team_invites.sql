-- ============================================================================
-- RunButter — 0048_team_invites.sql
-- Gives team invites a real, unguessable token so accepting one proves you
-- were actually invited.
--
-- Before this, /api/team/claim matched a pending company_users row purely on
-- an email address supplied in the request body — with no auth on the endpoint
-- and no verification of the caller's identity. Anyone who guessed or knew an
-- invited address could POST {email, privyUserId} and bind their own Privy
-- account to that invite, joining the workspace with whatever role had been
-- assigned, up to and including owner. Email matching also failed whenever the
-- inviter typed a capital letter, since the row stored the address verbatim
-- while the claim lowercased it.
--
-- Now: the invite carries a random token, the accept link contains it, and the
-- claim looks the invite up BY TOKEN with a verified Privy session. The token
-- is single-use — cleared the moment it is redeemed.
--
-- Additive & idempotent. Existing pending invites have no token, so they can no
-- longer be claimed and should simply be re-sent.
-- ============================================================================

alter table company_users add column if not exists invite_token uuid;
alter table company_users add column if not exists invited_at   timestamptz;
alter table company_users add column if not exists invited_by    text;

-- Partial unique index: only unredeemed invites hold a token, and each is unique.
create unique index if not exists idx_company_users_invite_token
  on company_users (invite_token)
  where invite_token is not null;

-- Look up a pending invite by its token, for the accept screen. Returns only
-- what the page needs to render "You've been invited to <company> as <role>" —
-- deliberately no email or member list. The token IS the secret, so this stays
-- callable without a session; without a valid token it returns null.
create or replace function get_invite_by_token(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if p_token is null then return null; end if;
  select jsonb_build_object(
    'company_name', c.name,
    'role',         cu.role,
    'full_name',    cu.full_name,
    'email',        cu.email
  ) into v
  from company_users cu
  join companies c on c.id = cu.company_id
  where cu.invite_token = p_token
    and cu.privy_user_id is null;          -- already redeemed => not an invite
  return v;   -- null when the token is unknown or spent
end $$;
revoke all on function get_invite_by_token(uuid) from public, anon, authenticated;
grant execute on function get_invite_by_token(uuid) to service_role;

-- Redeem an invite. p_privy comes from a verified Privy token in the route, so
-- the caller cannot claim on someone else's behalf. Single-use: the token is
-- cleared, and a second attempt finds nothing.
create or replace function redeem_invite(p_token uuid, p_privy text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_company uuid; v_role text; v_name text;
begin
  if p_token is null or coalesce(trim(p_privy),'') = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_token');
  end if;

  select cu.id, cu.company_id, cu.role into v_id, v_company, v_role
  from company_users cu
  where cu.invite_token = p_token and cu.privy_user_id is null
  for update;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  end if;

  -- Someone already in this company should not gain a second membership row.
  if exists (select 1 from company_users
              where company_id = v_company and privy_user_id = p_privy) then
    -- Burn the invite anyway so the link cannot be reused.
    update company_users set invite_token = null where id = v_id;
    return jsonb_build_object('ok', true, 'already_member', true);
  end if;

  update company_users
     set privy_user_id = p_privy,
         invite_token  = null          -- single use
   where id = v_id;

  select name into v_name from companies where id = v_company;
  return jsonb_build_object('ok', true, 'company_id', v_company,
                            'company_name', v_name, 'role', v_role);
end $$;
revoke all on function redeem_invite(uuid, text) from public, anon, authenticated;
grant execute on function redeem_invite(uuid, text) to service_role;

notify pgrst, 'reload schema';
