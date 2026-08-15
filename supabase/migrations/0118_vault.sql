-- ============================================================================
-- RunButter — 0118_vault.sql
--
-- A shared credential vault for the team, encrypted so that this database
-- cannot read it.
--
-- Every company has a handful of logins that belong to nobody: the domain
-- registrar, the analytics account, the shared social inbox. They live in a
-- pinned chat message or a spreadsheet called passwords.xlsx, and the reason
-- they do is that adding a fifth SaaS subscription to hold six passwords is a
-- worse trade than the spreadsheet.
--
-- ── THIS SCHEMA IS DELIBERATELY IGNORANT ────────────────────────────────────
-- Look at what `vault_items` holds: a workspace id, an author, two timestamps,
-- and one opaque blob. NO TITLE COLUMN. Not an oversight and not laziness —
-- knowing that a workspace stores "Stripe production admin" is most of what an
-- attacker wants before they start, so the title is inside the ciphertext with
-- everything else, and this database cannot sort or search by it.
--
-- The key is derived in the BROWSER from a passphrase (lib/vault/crypto.ts,
-- PBKDF2-600k → AES-GCM-256) that is never sent anywhere. What is stored here
-- is a salt, an IV and ciphertext, none of which is useful without it.
--
-- That is the opposite call from lib/crypto/secrets.ts, which seals OAuth
-- tokens with a SERVER-held key — correct there, because the server has to USE
-- those tokens to post to LinkedIn at 9am. Nothing on the server ever needs to
-- read a vault item, so nothing on the server can.
--
-- ── THE COST, WRITTEN DOWN ──────────────────────────────────────────────────
-- There is no recovery. Lose the passphrase and the rows are noise. A reset
-- button that worked would prove the server could decrypt, which would mean
-- none of the above was true. `reset_vault` therefore DELETES; it does not
-- recover, and it is owner/admin only.
--
-- ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
-- It is not a replacement for 1Password or Bitwarden: no per-user keys, no
-- browser extension, no autofill, no audit of who read what. One passphrase per
-- workspace, shared out of band, which is exactly the model the spreadsheet
-- already has — with real encryption, an access-controlled home, and the rest
-- of the company's records beside it.
-- ============================================================================

create table if not exists vault_meta (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  -- Public by design. A salt is not a secret; its job is to make one
  -- precomputed table useless against every workspace at once.
  salt text not null,
  -- Stored, not assumed, so raising the count later upgrades new vaults
  -- without locking anybody out of an old one.
  iterations int not null default 600000,
  -- A known string encrypted under the vault key. Without it a wrong
  -- passphrase looks exactly like an empty vault, at the worst possible moment.
  verifier_ct text not null,
  verifier_iv text not null,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists vault_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- Title, username, password, URL and notes — all of it, in here.
  ct text not null,
  iv text not null,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_vault_items_ws on vault_items(workspace_id);

alter table vault_meta  enable row level security;
alter table vault_items enable row level security;

/**
 * Is there a vault, and what does the browser need to derive its key?
 *
 * Returns the salt and iteration count to any MEMBER. Both are public inputs to
 * the KDF, and withholding them would only stop the vault from opening — the
 * secret is the passphrase, which is not here and never was.
 */
create or replace function get_vault_meta(p_privy text, p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select * into r from vault_meta where workspace_id = p_workspace;
  if not found then return jsonb_build_object('exists', false); end if;
  return jsonb_build_object(
    'exists', true, 'salt', r.salt, 'iterations', r.iterations,
    'verifier_ct', r.verifier_ct, 'verifier_iv', r.verifier_iv,
    'created_at', r.created_at
  );
end $$;

/**
 * Create the vault. Once.
 *
 * `on conflict do nothing` rather than an upsert, and the difference is the
 * whole safety of it: overwriting the salt or the verifier would orphan every
 * existing item instantly and irreversibly. Replacing a vault is `reset_vault`,
 * which says what it does.
 */
create or replace function init_vault(p_privy text, p_workspace uuid, p_salt text,
                                      p_iterations int, p_verifier_ct text, p_verifier_iv text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(trim(p_salt),'') = '' or coalesce(trim(p_verifier_ct),'') = '' then
    raise exception 'INVALID_VAULT';
  end if;
  -- A weak iteration count is a weak vault forever, so a caller cannot ask for
  -- one. The floor is deliberately below the app's 600k so an older client
  -- still works, and far above anything worth attacking with.
  if coalesce(p_iterations, 0) < 100000 then raise exception 'WEAK_KDF'; end if;

  insert into vault_meta (workspace_id, salt, iterations, verifier_ct, verifier_iv, created_by)
  values (p_workspace, p_salt, p_iterations, p_verifier_ct, p_verifier_iv, p_privy)
  on conflict (workspace_id) do nothing;

  return get_vault_meta(p_privy, p_workspace);
end $$;

/**
 * Every item, opaque. Newest first — the plaintext order cannot be known here,
 * so recency is the only honest sort this side of the wire.
 */
create or replace function list_vault_items(p_privy text, p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', id, 'ct', ct, 'iv', iv,
             'updated_at', updated_at, 'updated_by', updated_by
           ) order by updated_at desc)
      from vault_items where workspace_id = p_workspace
  ), '[]'::jsonb);
end $$;

/**
 * Insert or replace one blob.
 *
 * The update re-checks `workspace_id` as well as the id. update_record's own
 * comment explains why: an id is not a capability, and matching on it alone
 * would let a member of one workspace overwrite another's row.
 */
create or replace function save_vault_item(p_privy text, p_workspace uuid, p_id uuid, p_ct text, p_iv text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(trim(p_ct),'') = '' or coalesce(trim(p_iv),'') = '' then raise exception 'EMPTY_ITEM'; end if;

  if p_id is null then
    insert into vault_items (workspace_id, ct, iv, created_by, updated_by)
    values (p_workspace, p_ct, p_iv, p_privy, p_privy) returning id into v_id;
  else
    update vault_items set ct = p_ct, iv = p_iv, updated_by = p_privy, updated_at = now()
     where id = p_id and workspace_id = p_workspace returning id into v_id;
    if v_id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  return v_id;
end $$;

create or replace function delete_vault_item(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  delete from vault_items where id = p_id and workspace_id = p_workspace;
  get diagnostics n = row_count;
  return n > 0;
end $$;

/**
 * Change the passphrase: new meta AND every re-encrypted item, in ONE
 * transaction.
 *
 * This is the only operation that can destroy a vault by half-finishing. The
 * client decrypts everything under the old key, re-encrypts under the new one
 * and sends the lot; if writing the items failed after the salt was replaced,
 * every remaining row would be permanently unreadable. A function is what makes
 * it atomic — a sequence of calls from the browser is not, and a dropped
 * connection mid-way would be unrecoverable.
 *
 * The count is checked against what is stored, so a client that read a stale
 * list and would silently drop somebody's newly added item is refused.
 */
create or replace function rotate_vault(p_privy text, p_workspace uuid, p_salt text,
                                        p_iterations int, p_verifier_ct text, p_verifier_iv text,
                                        p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it jsonb; n int; sent int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(p_iterations, 0) < 100000 then raise exception 'WEAK_KDF'; end if;

  select count(*) into n from vault_items where workspace_id = p_workspace;
  sent := jsonb_array_length(coalesce(p_items, '[]'::jsonb));
  if sent <> n then raise exception 'STALE_VAULT'; end if;

  update vault_meta set salt = p_salt, iterations = p_iterations,
         verifier_ct = p_verifier_ct, verifier_iv = p_verifier_iv
   where workspace_id = p_workspace;
  if not found then raise exception 'NO_VAULT'; end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    update vault_items set ct = it->>'ct', iv = it->>'iv', updated_at = now()
     where id = (it->>'id')::uuid and workspace_id = p_workspace;
  end loop;

  return get_vault_meta(p_privy, p_workspace);
end $$;

/**
 * Delete the vault and everything in it. Owner/admin only.
 *
 * The honest form of "I forgot the passphrase". It cannot recover anything —
 * a recovery path would mean the server could decrypt, and then none of this
 * was worth doing.
 */
create or replace function reset_vault(p_privy text, p_workspace uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from accounts a
     where a.privy_user_id = p_privy and a.workspace_id = p_workspace
       and coalesce(a.role, 'member') in ('owner', 'admin')
  ) then raise exception 'NOT_ALLOWED'; end if;

  delete from vault_items where workspace_id = p_workspace;
  delete from vault_meta  where workspace_id = p_workspace;
  return true;
end $$;

revoke all on function get_vault_meta(text, uuid)                              from public, anon, authenticated;
revoke all on function init_vault(text, uuid, text, int, text, text)           from public, anon, authenticated;
revoke all on function list_vault_items(text, uuid)                            from public, anon, authenticated;
revoke all on function save_vault_item(text, uuid, uuid, text, text)           from public, anon, authenticated;
revoke all on function delete_vault_item(text, uuid, uuid)                     from public, anon, authenticated;
revoke all on function rotate_vault(text, uuid, text, int, text, text, jsonb)  from public, anon, authenticated;
revoke all on function reset_vault(text, uuid)                                 from public, anon, authenticated;

grant execute on function get_vault_meta(text, uuid)                             to service_role;
grant execute on function init_vault(text, uuid, text, int, text, text)          to service_role;
grant execute on function list_vault_items(text, uuid)                           to service_role;
grant execute on function save_vault_item(text, uuid, uuid, text, text)          to service_role;
grant execute on function delete_vault_item(text, uuid, uuid)                    to service_role;
grant execute on function rotate_vault(text, uuid, text, int, text, text, jsonb) to service_role;
grant execute on function reset_vault(text, uuid)                                to service_role;

notify pgrst, 'reload schema';
