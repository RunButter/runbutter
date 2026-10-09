-- ============================================================================
-- 0130_deal_close_date.sql — when a deal is expected to close.
--
-- A deal had an amount and a stage and no date, so the pipeline could answer
-- "how much" and never "when" — the question a forecast is made of. 0130 adds
-- `close_date`, puts it on the board, gives the pipeline a Calendar view, and
-- puts open deals on the company Calendar beside invoices and interviews.
--
-- Its own setter rather than a new parameter on update_pipeline_record: adding
-- a parameter makes an OVERLOAD (see CLAUDE.md), and update_pipeline_record
-- treats NULL as "not mentioned", which would make a date impossible to clear.
-- Here NULL means clear.
-- ============================================================================

alter table pipeline_records add column if not exists close_date date;
create index if not exists idx_records_close on pipeline_records(workspace_id, close_date) where close_date is not null;

create or replace function set_deal_close_date(p_privy text, p_record uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare v_workspace uuid;
begin
  select workspace_id into v_workspace from pipeline_records where id = p_record;
  if v_workspace is null then raise exception 'RECORD_NOT_FOUND'; end if;
  if not is_workspace_member(v_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update pipeline_records set close_date = p_date where id = p_record;
end $$;

-- ── Board, redefined IN FULL (0092's definition + close_date) ───────────────
create or replace function get_pipeline_board(p_privy text, p_pipeline uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_workspace uuid;
begin
  select workspace_id into v_workspace from pipelines where id = p_pipeline;
  if v_workspace is null then raise exception 'PIPELINE_NOT_FOUND'; end if;
  if not is_workspace_member(v_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  return jsonb_build_object(
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'color', s.color, 'stage_type', s.stage_type
      ) order by s.position)
      from pipeline_stages s where s.pipeline_id = p_pipeline), '[]'::jsonb),
    'records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'stage_id', r.stage_id, 'title', r.title, 'amount', r.amount,
        'status', r.status, 'position', r.position, 'close_date', r.close_date,
        'person', case when pe.id is null then null else jsonb_build_object(
          'id', pe.id, 'name', trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,'')),
          'title', pe.title, 'avatar_url', pe.avatar_url) end,
        'company', case when co.id is null then null else jsonb_build_object(
          'id', co.id, 'name', co.name, 'domain', co.domain) end
      ) order by r.position)
      from pipeline_records r
      left join people pe on pe.id = r.person_id
      left join organizations co on co.id = r.company_id and co.workspace_id = v_workspace
      where r.pipeline_id = p_pipeline), '[]'::jsonb)
  );
end $$;

-- ── Company calendar, redefined IN FULL (0119's definition + deals) ──────────
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

      union all
      /*
       * Deals by expected close date (0130). Only OPEN deals in a SALES
       * pipeline: a won deal is no longer a date anybody acts on, and a
       * recruitment card is a candidate, not revenue.
       */
      select jsonb_build_object(
               'kind', 'deal', 'id', r.id,
               'title', coalesce(nullif(r.title,''), o.name, 'Deal') ||
                        case when nullif(r.title,'') is not null and o.name is not null then ' · ' || o.name else '' end,
               'at', r.close_date, 'all_day', true,
               'amount', r.amount, 'status', r.status,
               'href', '/pipelines/sales/board?view=calendar')
        from pipeline_records r
        join pipelines pl on pl.id = r.pipeline_id and pl.kind = 'sales'
        left join organizations o on o.id = r.company_id and o.workspace_id = p_workspace
       where r.workspace_id = p_workspace
         and r.status = 'active'
         and r.close_date >= p_from and r.close_date <= p_to
    ) x
  ), '[]'::jsonb);
end $$;

revoke all on function set_deal_close_date(text, uuid, date)       from public, anon, authenticated;
revoke all on function get_pipeline_board(text, uuid)               from public, anon, authenticated;
revoke all on function get_calendar(text, uuid, date, date)         from public, anon, authenticated;
grant execute on function set_deal_close_date(text, uuid, date)    to service_role;
grant execute on function get_pipeline_board(text, uuid)            to service_role;
grant execute on function get_calendar(text, uuid, date, date)      to service_role;

notify pgrst, 'reload schema';
