-- ============================================================================
-- RunButter — 0100_oauth_refresh_grace.sql
-- A refresh retry must not destroy the connection.
--
-- ── THE BUG ─────────────────────────────────────────────────────────────────
-- 0099 rotates refresh tokens and detects reuse: presenting an already-rotated
-- token revokes the whole family, per OAuth 2.1 §4.14.2. That rule is right and
-- it is what the tests asserted.
--
-- What the tests did not cover is the ordinary case it also catches. A client
-- refreshes; the response is lost to a timeout, a dropped connection, or two
-- concurrent requests from the same client. The client retries with the same
-- refresh token — because it never received the replacement — and 0099 treats
-- that as theft and burns the grant. Permanently. The user sees
-- "requires re-authorization (token expired)" and reconnecting is the only fix,
-- until it happens again.
--
-- Observed for real against claude.ai, which is what makes this worth a
-- migration of its own rather than a note: the connector authorised
-- successfully, listed all 27 tools, and then died on the first refresh.
--
-- ── THE FIX, AND WHY IT IS NOT A WEAKENING ──────────────────────────────────
-- A GRACE WINDOW. Re-presenting a refresh token within 30 seconds of its
-- rotation is treated as a retry: fresh tokens are issued and the successor
-- that was minted in that window is revoked, so the chain does not fork.
-- Outside the window it is still theft and the family still burns.
--
-- The security question is what an attacker gains. To use a stolen refresh
-- token inside the window they must steal it and replay it within 30 seconds of
-- the legitimate client rotating it — and the legitimate client's next refresh
-- then lands outside ITS window and burns everything, so the theft is still
-- detected, just one cycle later. Weighed against a connection that breaks on
-- any dropped packet, this is the trade every serious implementation makes.
--
-- Depends on 0099. Idempotent & prod-safe.
-- ============================================================================

/**
 * Redefined IN FULL from 0099. The only change is the grace branch.
 */
create or replace function oauth_refresh_token(
  p_refresh_hash text, p_client_id text, p_token_hash text, p_new_refresh_hash text,
  p_ttl_seconds int default 3600
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old oauth_tokens; v_ttl int; v_grace constant interval := interval '30 seconds';
begin
  v_ttl := greatest(60, least(coalesce(p_ttl_seconds, 3600), 86400));

  select * into v_old from oauth_tokens where refresh_hash = p_refresh_hash;
  if v_old.id is null then return jsonb_build_object('error', 'unknown refresh token'); end if;
  if v_old.client_id <> p_client_id then return jsonb_build_object('error', 'wrong client'); end if;

  if v_old.revoked_at is not null then
    if v_old.revoked_at > now() - v_grace then
      -- A RETRY, not a theft. The client never got the last response, so it is
      -- asking again with the only token it has. Revoke the successor minted in
      -- this window — otherwise every retry forks the chain and leaves live
      -- tokens nobody holds — and fall through to issue a fresh pair.
      update oauth_tokens set revoked_at = now()
       where authorization_id is not distinct from v_old.authorization_id
         and client_id = v_old.client_id
         and revoked_at is null
         and created_at >= v_old.revoked_at - v_grace;
    else
      -- Outside the window: treat as compromise and burn the family.
      update oauth_tokens set revoked_at = now()
       where authorization_id is not distinct from v_old.authorization_id
         and client_id = v_old.client_id and revoked_at is null;
      return jsonb_build_object('error', 'refresh token already used');
    end if;
  end if;

  if v_old.refresh_expires_at is not null and v_old.refresh_expires_at < now() then
    return jsonb_build_object('error', 'refresh token expired');
  end if;

  update oauth_tokens set revoked_at = now() where id = v_old.id and revoked_at is null;

  insert into oauth_tokens (token_hash, refresh_hash, client_id, workspace_id, owner_privy,
                            scope, authorization_id, expires_at, refresh_expires_at)
  values (p_token_hash, p_new_refresh_hash, v_old.client_id, v_old.workspace_id, v_old.owner_privy,
          v_old.scope, v_old.authorization_id,
          now() + make_interval(secs => v_ttl),
          -- The window does NOT extend with use; it keeps the original
          -- deadline, so a grant nobody re-consents to does eventually expire.
          v_old.refresh_expires_at);

  return jsonb_build_object('scope', v_old.scope, 'workspace_id', v_old.workspace_id, 'expires_in', v_ttl);
end $$;
revoke all on function oauth_refresh_token(text, text, text, text, int) from public, anon, authenticated;
grant execute on function oauth_refresh_token(text, text, text, text, int) to service_role;

notify pgrst, 'reload schema';
