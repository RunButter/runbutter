-- ============================================================================
-- RunButter — 0066_post_schedule.sql
-- Give posts a date, so Post Studio can have a calendar.
--
-- `posts` (0028) has status draft|in_review|approved|published but NO date at
-- all, so "when does this go out" was never answerable and the list could only
-- ever sort by updated_at. A social calendar is the view people actually plan
-- in — you need to see the month, not a list ordered by whoever edited last.
--
-- scheduled_at is nullable ON PURPOSE. A post with no date is a draft sitting in
-- the backlog, which is a real and common state; forcing a date at creation
-- would make every rough idea require a decision it isn't ready for. The
-- calendar shows dated posts, and an "Unscheduled" tray holds the rest.
--
-- Redefines get_posts / save_post IN FULL per the CRUD convention, plus a
-- dedicated set_post_schedule for drag-to-reschedule: dragging a card should not
-- have to round-trip the whole post body (which can carry an image URL and a
-- few kB of copy) just to move it one day.
-- Depends on 0028 (posts).
-- ============================================================================

alter table posts add column if not exists scheduled_at timestamptz;

-- Partial: most rows are dated once the workspace starts planning, but the
-- backlog never is, and there is no reason to index nulls.
create index if not exists idx_posts_scheduled on posts(workspace_id, scheduled_at)
  where scheduled_at is not null;

-- ── Payload ─────────────────────────────────────────────────────────────────
create or replace function post_payload(p posts)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'platform', p.platform, 'handle', p.handle, 'content', p.content,
    'image_url', p.image_url, 'status', p.status, 'share_token', p.share_token,
    'campaign_id', p.campaign_id, 'updated_at', p.updated_at,
    'scheduled_at', p.scheduled_at,
    'comments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'author', c.author, 'body', c.body, 'x', c.x, 'y', c.y,
      'resolved', c.resolved, 'created_at', c.created_at
    ) order by c.created_at) from post_comments c where c.post_id = p.id), '[]'::jsonb)
  );
$$;

-- ── List ────────────────────────────────────────────────────────────────────
-- Ordered by schedule, nulls last: the calendar wants chronological order, and
-- the undated backlog belongs at the end rather than interleaved.
create or replace function get_posts(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', p.id, 'platform', p.platform, 'handle', p.handle, 'content', p.content,
    'image_url', p.image_url, 'status', p.status, 'updated_at', p.updated_at,
    'scheduled_at', p.scheduled_at, 'campaign_id', p.campaign_id,
    'comment_count', (select count(*) from post_comments c where c.post_id = p.id and not c.resolved)
  ) order by p.scheduled_at asc nulls last, p.updated_at desc)
  from posts p where p.workspace_id = p_workspace), '[]'::jsonb);
end $$;

-- ── Save ────────────────────────────────────────────────────────────────────
-- scheduled_at follows the branded-save convention from 0061: written only when
-- the key is PRESENT in the payload, so an editor saving copy cannot silently
-- clear a date it never knew about. Passing an explicit null unschedules.
create or replace function save_post(p_privy text, p_workspace uuid, p_id uuid, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if v_id is null then
    insert into posts (workspace_id, platform, handle, content, image_url, status, campaign_id, scheduled_at)
    values (p_workspace,
      coalesce(nullif(p_data->>'platform',''), 'instagram'), nullif(p_data->>'handle',''),
      coalesce(p_data->>'content',''), nullif(p_data->>'image_url',''),
      coalesce(nullif(p_data->>'status',''), 'draft'), nullif(p_data->>'campaign_id','')::uuid,
      nullif(p_data->>'scheduled_at','')::timestamptz)
    returning id into v_id;
  else
    update posts set
      platform  = coalesce(nullif(p_data->>'platform',''), platform),
      handle    = nullif(p_data->>'handle',''),
      content   = coalesce(p_data->>'content', content),
      image_url = nullif(p_data->>'image_url',''),
      status    = coalesce(nullif(p_data->>'status',''), status),
      campaign_id = nullif(p_data->>'campaign_id','')::uuid,
      scheduled_at = case when p_data ? 'scheduled_at'
                          then nullif(p_data->>'scheduled_at','')::timestamptz
                          else scheduled_at end
    where id = v_id and workspace_id = p_workspace;
  end if;
  return v_id;
end $$;

-- ── Reschedule ──────────────────────────────────────────────────────────────
/**
 * Move one post to a date, or back to the backlog with null.
 *
 * Separate from save_post because dragging a card across a calendar should not
 * round-trip the post body — that is a few kB of copy and an image URL travelling
 * both ways per drag, and any concurrent edit in another tab would be clobbered
 * by whatever the dragging client last read.
 */
create or replace function set_post_schedule(p_privy text, p_id uuid, p_at timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from posts where id = p_id;
  if v_ws is null or not is_workspace_member(v_ws, p_privy) then
    raise exception 'NOT_FOUND_OR_FORBIDDEN';
  end if;
  update posts set scheduled_at = p_at where id = p_id;
  return true;
end $$;

revoke all on function set_post_schedule(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function set_post_schedule(text, uuid, timestamptz) to service_role;
-- get_posts/save_post keep the grants 0040 settled on: reachable only through
-- the /api/rpc proxy, which proves identity before calling as service_role.
revoke all on function get_posts(text, uuid) from public, anon, authenticated;
revoke all on function save_post(text, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function get_posts(text, uuid) to service_role;
grant execute on function save_post(text, uuid, uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
