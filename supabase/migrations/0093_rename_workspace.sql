-- ============================================================================
-- RunButter — 0093_rename_workspace.sql
-- A workspace can be renamed. Until now it could not, anywhere, ever.
--
-- THE BUG, AND WHY IT LOOKED LIKE A DOZEN SMALL ONES. An organisation's name
-- lives in THREE columns:
--
--   workspaces.name        the sidebar, the workspace switcher, get_my_workspace
--   companies.name         the HR half, and the careers-page fallback
--   workspaces.legal_name  invoices and documents  (branding — already editable)
--
-- 0005's trigger copies companies.name into workspaces.name exactly once, on
-- INSERT, with `on conflict do nothing`. Nothing has ever written either of the
-- first two again. So an owner who renamed their company changed `legal_name`
-- in Branding — the only name with a form attached — watched the invoices and
-- the careers page update, and then kept seeing the OLD name in the sidebar,
-- the switcher and half the HR screens, with nowhere to go and fix it.
--
-- The lesson in the shape of it: adding a fourth editable name would have made
-- this worse. One function writes both display names together.
--
-- legal_name is deliberately NOT touched. "RunButter" and "RunButter Sp. z o.o."
-- are different facts — one is what a colleague calls the place, the other is
-- what goes on an invoice — and collapsing them would silently rewrite a legal
-- document's issuer the next time someone tidied up their sidebar.
--
-- The SLUG is deliberately not touched either. workspaces.slug and the careers
-- address are live public URLs; changing one 404s every link anyone has shared.
-- That is a separate, deliberate act with its own warning, not a side effect of
-- fixing a typo in a display name.
-- ============================================================================

create or replace function rename_workspace(p_privy text, p_workspace uuid, p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Renaming changes what every member sees and what recipients of a document
  -- read, so it sits at the same bar as changing branding: owner or admin.
  if workspace_role(p_privy, p_workspace) not in ('owner','admin') then
    raise exception 'FORBIDDEN: only an owner or admin can rename the workspace';
  end if;

  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then raise exception 'NAME_REQUIRED'; end if;
  if length(v_name) > 80 then raise exception 'NAME_TOO_LONG: 80 characters maximum'; end if;

  update workspaces set name = v_name where id = p_workspace;

  -- The HR half reads companies.name, and get_careers_page falls back to it
  -- when legal_name is blank. Renaming one and not the other is how this
  -- became three disagreeing names in the first place.
  update companies set name = v_name where id = p_workspace;

  return v_name;
end $$;
grant execute on function rename_workspace(text, uuid, text) to authenticated, anon;

-- ── Repair ──────────────────────────────────────────────────────────────────
-- Existing workspaces whose two display names already disagree, because the
-- 0005 trigger only ever ran on insert. companies.name is the authority: it is
-- the one the signup form wrote and the one the HR screens have been showing.
update workspaces w
   set name = c.name
  from companies c
 where c.id = w.id
   and coalesce(nullif(btrim(c.name), ''), '') <> ''
   and w.name is distinct from c.name;

notify pgrst, 'reload schema';
