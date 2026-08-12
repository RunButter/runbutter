-- ============================================================================
-- RunButter — 0098_email_blocks.sql
-- A fourth newsletter template: the one you build yourself.
--
-- ── WHY A FOURTH RATHER THAN A BUILDER ──────────────────────────────────────
-- 0070 shipped three fixed layouts and a comment explaining why there was no
-- drag-and-drop builder: a canvas produces nested-table HTML that has to be
-- maintained against every client's rendering quirks forever, and the output is
-- reliably worse than a good fixed layout. That argument still holds and this
-- does not contradict it.
--
-- What it adds is a LINEAR LIST OF TYPED BLOCKS. Stack only — no canvas, no
-- absolute positioning, no arbitrary HTML nesting. Every block is rendered by
-- the one renderer we already maintain, into the same 600px table shell with
-- the same inline styles, the same preheader, the same unsubscribe footer and
-- the same tracking pixel. So the composable half is the ORDER and the CHOICE
-- of blocks, and the fragile half — what the HTML actually is — stays ours.
--
-- ── ALL THE VALIDATION THAT MATTERS IS IN THE RENDERER, NOT HERE ────────────
-- `content` has been free-form jsonb since 0070 and stays that way. A CHECK
-- constraint describing a block list would have to be kept in step with
-- TypeScript by hand, and the failure mode is a save that raises at 2am rather
-- than a block that renders as nothing. The renderer drops what it does not
-- recognise, escapes every string and refuses any URL that is not http(s) —
-- which is the boundary that actually protects a recipient's inbox.
--
-- The only thing SQL must change is the CHECK on `template`, which is a closed
-- vocabulary, and `save_newsletter`, which silently rewrites an unknown
-- template to 'plain' — so without this a workspace could build a block email,
-- press save, and get a plain one back with no error at all.
--
-- Depends on 0070. Idempotent & prod-safe.
-- ============================================================================

alter table newsletters drop constraint if exists newsletters_template_check;
alter table newsletters add constraint newsletters_template_check
  check (template in ('plain', 'announcement', 'digest', 'blocks'));

/**
 * Redefined IN FULL from 0070 — the only change is 'blocks' in the two
 * whitelists.
 *
 * Note what those whitelists do on a miss: INSERT falls back to 'plain' and
 * UPDATE keeps the existing value. Both are deliberate and neither raises,
 * because this argument comes from a client that may be a version behind. That
 * is also exactly why this migration exists rather than the app simply sending
 * the new value: the fallback is silent by design, so a missing whitelist entry
 * costs somebody their layout without ever reporting an error.
 */
create or replace function save_newsletter(
  p_privy text, p_workspace uuid, p_id uuid, p_subject text, p_preheader text,
  p_template text, p_content jsonb, p_from_name text, p_reply_to text, p_list_ids uuid[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Unchanged at 512 KB. A block list is bigger than a plain body but not by
  -- an order of magnitude, and the cap is what stops `content` becoming a
  -- place to paste an entire base64 image into every row of the table.
  if pg_column_size(coalesce(p_content, '{}'::jsonb)) > 524288 then raise exception 'CONTENT_TOO_LARGE'; end if;

  if p_id is null then
    insert into newsletters (workspace_id, subject, preheader, template, content, from_name, reply_to, created_by_privy)
    values (p_workspace, coalesce(p_subject,''), coalesce(p_preheader,''),
            case when p_template in ('plain','announcement','digest','blocks') then p_template else 'plain' end,
            coalesce(p_content,'{}'::jsonb), coalesce(p_from_name,''), coalesce(p_reply_to,''), p_privy)
    returning id into v_id;
  else
    select status into v_status from newsletters where id = p_id and workspace_id = p_workspace;
    if v_status is null then return null; end if;
    if v_status in ('sending','sent') then raise exception 'ALREADY_SENT'; end if;
    update newsletters set
      subject = coalesce(p_subject, subject), preheader = coalesce(p_preheader, preheader),
      template = case when p_template in ('plain','announcement','digest','blocks') then p_template else template end,
      content = coalesce(p_content, content),
      from_name = coalesce(p_from_name, from_name), reply_to = coalesce(p_reply_to, reply_to)
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;

  if p_list_ids is not null then
    delete from newsletter_targets where newsletter_id = v_id;
    -- Only lists in THIS workspace survive, so a foreign list id cannot be
    -- stapled on to make a send reach another tenant's subscribers.
    insert into newsletter_targets (newsletter_id, list_id)
    select v_id, l.id from newsletter_lists l
     where l.workspace_id = p_workspace and l.id = any(p_list_ids)
    on conflict do nothing;
  end if;
  return v_id;
end $$;
grant execute on function save_newsletter(text, uuid, uuid, text, text, text, jsonb, text, text, uuid[]) to authenticated, anon;

notify pgrst, 'reload schema';
