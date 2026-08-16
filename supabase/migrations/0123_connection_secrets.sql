-- ============================================================================
-- RunButter — 0123_connection_secrets.sql
--
-- Every webhook this product has ever sent from a UI-created connection went
-- out UNSIGNED.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
-- `connections.secret` exists, has no default, and `save_connection` never set
-- it. The dispatcher attaches `X-RunButter-Signature` only when a secret is
-- present, so it never attached one. Meanwhile the Integrations page renders a
-- "Copy signing secret" button conditionally — so the button was simply absent
-- and nobody had a reason to wonder why — and the sentence beneath the list
-- said, in as many words, "Each POST is signed — verify with the connection
-- secret". It was not true for any connection created in the app.
--
-- The consequence is not theoretical. The whole point of signing is that the
-- receiver can tell a real delivery from anybody who learned the URL, and a
-- webhook URL is a bearer secret that ends up in Zapier screenshots, shared
-- Slack channels and support tickets. A receiver following our own
-- documentation would have found no header to verify and, in the worst case,
-- concluded the check was optional.
--
-- ── MINTED ON INSERT, NEVER ROTATED ON UPDATE ───────────────────────────────
-- `coalesce(secret, gen…)` on update, not a fresh value. Rotating a secret
-- because somebody renamed a connection would break every receiver already
-- verifying it, at a moment that looks completely unrelated to the change.
-- Rotation is a deliberate act and belongs behind its own button.
--
-- ── EXISTING ROWS ARE BACKFILLED ────────────────────────────────────────────
-- Anything created before this gets a secret now. That is strictly an
-- improvement — those deliveries carry no header today, so nothing can break by
-- one appearing, and every receiver written against the docs starts working.
-- ============================================================================

-- 32 bytes of hex: the same shape as the token every other secret here uses.
update connections set secret = encode(gen_random_bytes(32), 'hex')
 where secret is null or secret = '';

alter table connections alter column secret set default encode(gen_random_bytes(32), 'hex');

create or replace function save_connection(p_privy text, p_workspace uuid, p_id uuid,
                                           p_label text, p_kind text, p_url text, p_active boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_url is null or p_url = '' then raise exception 'URL_REQUIRED'; end if;

  if p_id is null then
    insert into connections (workspace_id, label, kind, url, is_active, secret)
    values (p_workspace, coalesce(p_label,''), coalesce(nullif(p_kind,''),'generic'), p_url,
            coalesce(p_active, true), encode(gen_random_bytes(32), 'hex'))
    returning id into v_id;
  else
    update connections set
      label = coalesce(p_label, label),
      kind = coalesce(nullif(p_kind,''), kind),
      url = p_url,
      is_active = coalesce(p_active, is_active),
      -- COALESCE, not a new value. Re-minting on every edit would silently
      -- break every receiver verifying the old one, and the break would look
      -- like it had nothing to do with renaming a connection.
      secret = coalesce(nullif(secret, ''), encode(gen_random_bytes(32), 'hex'))
    where id = p_id and workspace_id = p_workspace returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

/**
 * Deliberately rotate a connection's signing secret.
 *
 * Separate from `save_connection` because it BREAKS every receiver until they
 * are given the new value, which is exactly right after a leak and exactly
 * wrong as a side effect of an edit. Returns the new secret so it can be shown
 * once, at the moment the person asked for it.
 */
create or replace function rotate_connection_secret(p_privy text, p_workspace uuid, p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update connections set secret = encode(gen_random_bytes(32), 'hex')
   where id = p_id and workspace_id = p_workspace returning secret into v;
  if v is null then raise exception 'NOT_FOUND'; end if;
  return v;
end $$;

revoke all on function save_connection(text, uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
revoke all on function rotate_connection_secret(text, uuid, uuid)                   from public, anon, authenticated;
grant execute on function save_connection(text, uuid, uuid, text, text, text, boolean) to service_role;
grant execute on function rotate_connection_secret(text, uuid, uuid)                   to service_role;

notify pgrst, 'reload schema';
