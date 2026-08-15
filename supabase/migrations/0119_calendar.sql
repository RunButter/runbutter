-- ============================================================================
-- RunButter — 0119_calendar.sql
--
-- One calendar over the whole company.
--
-- ── WHY THIS IS THE FEATURE AND NOT "A CALENDAR TAB" ────────────────────────
-- The dates were already here and scattered across six tables that nothing
-- joined: an invoice due next Tuesday, an interview on Thursday, a post going
-- out Friday, a newsletter on the 1st, an issue due at the end of the sprint,
-- and a Cal.com booking somebody made without telling anyone.
--
-- Every competitor selling an all-in-one workspace has to BUILD those links.
-- Here they are one query, because the records were in one database from 0001 —
-- which is the entire pitch of this product, and until now nothing on screen
-- demonstrated it. This is the same argument @-mentions (0113) makes: the
-- relation existed and only the surface was missing.
--
-- ── `meetings` HAS BEEN COLLECTED SINCE 0056 AND SHOWN NOWHERE ──────────────
-- 0056 built the whole Cal.com connector — table, webhook, signature check,
-- dedupe — and `get_meetings` was never called by anything. Bookings have been
-- landing in a table nobody could look at. That is the biggest single thing
-- this screen fixes and it needed no new plumbing at all.
--
-- ── ONE QUERY, NOT SIX ROUND TRIPS ──────────────────────────────────────────
-- A union in SQL rather than six client calls, because a month view needs all
-- of them before it can render one cell, and six sequential fetches is a
-- visibly slow screen for data that is a single scan each.
--
-- Every branch is constrained to `p_workspace` (or, for the HR tables, to the
-- same workspace's company id — `workspace_id == company_id` since 0005). The
-- HR half is joined through `candidates.company_id`, NOT through a workspace
-- column, because `interviews` has none: it predates the pivot and is tenanted
-- one hop away. Getting that wrong would put another company's interviews on
-- this calendar, so it is a join and not an assumption.
--
-- ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────────────
-- Expenses. `spent_at` is a record of something that already happened, and a
-- calendar full of last month's receipts buries the four things this week that
-- somebody has to act on. A calendar is for what is coming.
--
-- No writes either. This RPC READS; creating an interview still goes through
-- /api/hr/interviews (which orchestrates Google Meet and the candidate email),
-- scheduling a post still goes through save_post. A second write path into any
-- of these would be a second place for the rules to drift.
-- ============================================================================

/**
 * Everything happening between two dates, as one flat list.
 *
 * `kind` is what the UI colours and filters by; `href` is where clicking goes.
 * Building the href HERE rather than in the client keeps the six routes in one
 * place — a screen that renamed itself would otherwise leave a dead link in a
 * component nobody thought to look at.
 */
create or replace function get_calendar(p_privy text, p_workspace uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := p_from::timestamptz;
        v_to   timestamptz := (p_to + 1)::timestamptz;   -- inclusive of p_to
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- A wide range is a slow query, not a security problem, but there is no
  -- reason to allow one: no view asks for more than a year.
  if p_to < p_from or (p_to - p_from) > 400 then raise exception 'BAD_RANGE'; end if;

  return coalesce((
    select jsonb_agg(e order by e->>'at')
    from (
      -- Money in. Only what is still owed: a paid invoice is not an event.
      select jsonb_build_object(
               'kind', 'invoice', 'id', i.id,
               'title', coalesce(nullif(i.number,''), 'Invoice') ||
                        coalesce(' · ' || o.name, ''),
               'at', i.due_at, 'all_day', true,
               'amount', i.amount, 'status', i.status,
               'href', '/objects/invoices?ref=' || i.id) as e
        from invoices i
        left join organizations o on o.id = i.organization_id
       where i.workspace_id = p_workspace
         and coalesce(i.direction,'income') = 'income'
         and coalesce(i.kind,'invoice') <> 'offer'
         and coalesce(i.status,'') <> 'paid'
         and i.due_at >= p_from and i.due_at <= p_to

      union all
      -- Money out, kept as its own kind. "We owe this on Friday" and "they owe
      -- us this on Friday" are opposite facts and must never share a colour.
      select jsonb_build_object(
               'kind', 'bill', 'id', i.id,
               'title', coalesce(nullif(i.number,''), 'Bill'),
               'at', i.due_at, 'all_day', true,
               'amount', i.amount, 'status', i.status,
               'href', '/objects/invoices?ref=' || i.id)
        from invoices i
       where i.workspace_id = p_workspace and i.direction = 'cost'
         and coalesce(i.kind,'invoice') <> 'offer'
         and coalesce(i.status,'') <> 'paid'
         and i.due_at >= p_from and i.due_at <= p_to

      union all
      select jsonb_build_object(
               'kind', 'issue', 'id', s.id, 'title', s.title,
               'at', s.due_date, 'all_day', true,
               'status', s.status, 'project', pr.name,
               'href', '/objects/issues?ref=' || s.id)
        from issues s
        left join projects pr on pr.id = s.project_id
       where s.workspace_id = p_workspace
         and coalesce(s.status,'') not in ('done','cancelled')
         and s.due_date >= p_from and s.due_date <= p_to

      union all
      select jsonb_build_object(
               'kind', 'post', 'id', p.id,
               'title', left(coalesce(nullif(p.content,''), 'Post'), 80),
               'at', p.scheduled_at, 'all_day', false,
               'status', p.status, 'platform', p.platform,
               'href', '/marketing/posts')
        from posts p
       where p.workspace_id = p_workspace
         and p.scheduled_at >= v_from and p.scheduled_at < v_to

      union all
      select jsonb_build_object(
               'kind', 'newsletter', 'id', n.id, 'title', coalesce(nullif(n.subject,''), 'Newsletter'),
               'at', n.scheduled_at, 'all_day', false, 'status', n.status,
               'href', '/marketing/newsletters')
        from newsletters n
       where n.workspace_id = p_workspace
         and n.scheduled_at >= v_from and n.scheduled_at < v_to

      union all
      -- Campaign windows. Two events rather than a span: a month grid cannot
      -- draw a bar across weeks without becoming a Gantt chart, and the two
      -- dates anybody acts on are the day it starts and the day it stops.
      select jsonb_build_object(
               'kind', 'campaign', 'id', c.id, 'title', c.name || ' starts',
               'at', c.starts_on, 'all_day', true,
               'href', '/objects/campaigns?ref=' || c.id)
        from campaigns c
       where c.workspace_id = p_workspace and c.starts_on >= p_from and c.starts_on <= p_to
      union all
      select jsonb_build_object(
               'kind', 'campaign', 'id', c.id, 'title', c.name || ' ends',
               'at', c.ends_on, 'all_day', true,
               'href', '/objects/campaigns?ref=' || c.id)
        from campaigns c
       where c.workspace_id = p_workspace and c.ends_on >= p_from and c.ends_on <= p_to

      union all
      -- Cal.com bookings. Collected since 0056 and displayed nowhere until now.
      select jsonb_build_object(
               'kind', 'meeting', 'id', m.id,
               'title', coalesce(nullif(m.title,''), 'Meeting') ||
                        coalesce(' · ' || m.attendee_name, ''),
               'at', m.starts_at, 'ends_at', m.ends_at, 'all_day', false,
               'join_url', m.join_url,
               'href', '/calendar')
        from meetings m
       where m.workspace_id = p_workspace
         and m.starts_at >= v_from and m.starts_at < v_to

      union all
      /*
       * Interviews. `interviews` has NO workspace column — it predates the
       * pivot and is tenanted through candidates.company_id, which equals the
       * workspace id (0005's sync trigger). Joined rather than assumed: reading
       * it any other way would put another company's interviews on this screen.
       */
      select jsonb_build_object(
               'kind', 'interview', 'id', iv.id,
               'title', 'Interview · ' || coalesce(nullif(ca.full_name,''), 'Candidate'),
               'at', iv.scheduled_at, 'all_day', false,
               'status', iv.status, 'join_url', iv.google_meet_link,
               'href', '/dashboard/interviews')
        from interviews iv
        join candidates ca on ca.id = iv.candidate_id
       where ca.company_id = p_workspace
         and coalesce(iv.status,'') <> 'cancelled'
         and iv.scheduled_at >= v_from and iv.scheduled_at < v_to
    ) x
  ), '[]'::jsonb);
end $$;

revoke all on function get_calendar(text, uuid, date, date) from public, anon, authenticated;
grant execute on function get_calendar(text, uuid, date, date) to service_role;

notify pgrst, 'reload schema';
