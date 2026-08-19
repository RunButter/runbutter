-- ============================================================================
-- RunButter — 0125_design_tokens.sql
--
-- A workspace's DESIGN SPEC: the brand in a shape a machine can apply exactly.
--
-- ── WHY THIS IS NOT `workspaces.accent_color` ───────────────────────────────
-- Branding (0024, 0061) answers "what goes on our invoice" — a logo, an accent,
-- a legal name, a footer. It is deliberately narrow because every one of those
-- columns is read by a specific renderer.
--
-- A design spec answers a different question: "make something that looks like
-- us". That is a palette with roles, a type scale, a spacing rhythm, a voice,
-- and an explicit list of things never to do. It has no fixed column set —
-- one workspace names four colours and another names twenty — and every part of
-- it is read by an AI agent rather than by a renderer we control.
--
-- So: ONE jsonb column, not thirty. The shape lives in lib/design/tokens.ts,
-- which is also what writes it, and the file is generated from the column
-- rather than stored beside it. A DESIGN.md kept as text next to the values it
-- describes is two brands within a month.
--
-- Branding is NOT duplicated here. The studio seeds itself from `accent_color`
-- and `logo_url` on first open; after that they are separate, because renaming
-- a colour role must not repaint every invoice this workspace has ever issued.
--
-- ── WHY A MEMBER MAY WRITE IT ───────────────────────────────────────────────
-- Same rule as `save_workspace_branding`, which this sits beside. It is a
-- document, not a permission: getting it wrong is visible and reversible, and
-- gating it to owners means the designer cannot use the tool built for them.
-- ============================================================================

alter table workspaces add column if not exists design_tokens jsonb;

/**
 * The spec, or null when nobody has written one.
 *
 * Null is meaningfully different from an empty object here: the studio seeds
 * itself from branding on null and leaves a deliberately-emptied spec alone.
 */
create or replace function get_design_tokens(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select design_tokens into v from workspaces where id = p_workspace;
  return v;
end $$;

/**
 * Write it whole.
 *
 * ── WHOLE, NOT MERGED, AND THAT IS THE EXCEPTION ────────────────────────────
 * Every other save in this schema follows the `p_data ? 'key'` rule so a
 * partial update cannot blank what it does not mention (0088). This one
 * deliberately does not, because the arrays ARE the document: deleting the
 * third colour or the last "never" rule is a normal edit, and a merge that
 * treated an absent element as "leave it alone" would make deletion impossible.
 * The editor always holds the complete spec, so it always sends one.
 *
 * Guarded on two things only. It must be a JSON OBJECT — an array or a bare
 * string would break every reader, and `jsonb` alone does not say which it is.
 * And it is capped: this column is read into an agent's context on every run,
 * so a 5 MB paste would be an expensive way to break every agent in the
 * workspace at once. 256 KB is roughly eighty pages of brand guidance.
 */
create or replace function save_design_tokens(p_privy text, p_workspace uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_data is not null then
    if jsonb_typeof(p_data) <> 'object' then raise exception 'NOT_AN_OBJECT'; end if;
    if length(p_data::text) > 262144 then raise exception 'TOO_LARGE'; end if;
  end if;
  update workspaces set design_tokens = p_data where id = p_workspace;
end $$;

revoke all on function get_design_tokens(text, uuid)           from public, anon, authenticated;
revoke all on function save_design_tokens(text, uuid, jsonb)   from public, anon, authenticated;
grant execute on function get_design_tokens(text, uuid)         to service_role;
grant execute on function save_design_tokens(text, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
