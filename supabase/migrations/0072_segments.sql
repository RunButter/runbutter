-- ============================================================================
-- RunButter — 0072_segments.sql
-- Segments: a saved, LIVE filter over subscribers.
--
-- Mautic's real lesson is that segments, not campaigns, are the primitive. A
-- list is who you added; a segment is who currently matches — "opened nothing in
-- 90 days", "joined via the pricing form", "on the newsletter but never
-- clicked". Sequences and scoring both build on this, which is why it comes
-- first.
--
-- NO DYNAMIC SQL. The obvious way to build a filter engine is format() +
-- quote_literal into an EXECUTE. Inside a SECURITY DEFINER function that runs as
-- service_role, that is one escaping mistake away from arbitrary SQL against
-- every tenant's data. Instead `segment_match` is an ordinary STABLE function
-- with a CASE over a WHITELIST of fields — an unknown field or operator returns
-- false rather than being interpolated anywhere. The cost is that we support a
-- bounded predicate set instead of arbitrary expressions, which is the correct
-- trade for a filter builder driven by a UI.
--
-- PERFORMANCE, HONESTLY: the engagement predicates run an EXISTS per row, so
-- this is linear in list size and is not meant for millions of subscribers.
-- Results are capped and paged. If a workspace outgrows it, the fix is a
-- materialised engagement summary per subscriber, not dynamic SQL.
--
-- Depends on 0070/0071. Additive, idempotent & prod-safe.
-- ============================================================================

create table if not exists segments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null default 'New segment',
  description  text not null default '',
  -- [{ field, op, value }] — ALL must match (AND). Deliberately not a nested
  -- boolean tree: an AND list covers the segments people actually build, and a
  -- tree needs a query builder UI that nobody uses correctly.
  filters      jsonb not null default '[]'::jsonb,
  created_by_privy text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_segments_ws on segments(workspace_id, updated_at desc);
drop trigger if exists trg_segments_upd on segments;
create trigger trg_segments_upd before update on segments for each row execute function set_updated_at();
alter table segments enable row level security;
revoke all on table segments from anon, authenticated;

/**
 * Does one subscriber match one condition?
 *
 * STABLE, not IMMUTABLE: the engagement predicates read newsletter_events and
 * the date predicates read now(), so the planner must not cache results across
 * statements.
 *
 * An unrecognised field or operator returns FALSE. Returning true would make a
 * typo in a saved filter silently widen the audience of a send — the failure
 * mode that mails people who should never have received it.
 */
create or replace function segment_match(p_sub newsletter_subscribers, p_cond jsonb)
returns boolean language plpgsql stable set search_path = public as $$
declare
  f text := p_cond->>'field';
  o text := coalesce(p_cond->>'op', 'eq');
  v text := p_cond->>'value';
  -- The numeric operand for the day/count predicates. It must be parsed
  -- STRICTLY, not by stripping non-digits: the value for on_list is a UUID, and
  -- stripping its dashes leaves a 32-digit number that overflows int and raises
  -- — crashing the whole evaluation instead of failing closed. A whole-string
  -- match of at most six digits is non-numeric-safe and cannot overflow.
  n int  := case when coalesce(v, '') ~ '^\d{1,6}$' then v::int else null end;
begin
  if f is null then return false; end if;

  case f
    when 'status' then
      return case o
        when 'eq'  then p_sub.status = v
        when 'neq' then p_sub.status <> v
        else false end;

    when 'email' then
      return case o
        when 'contains'    then p_sub.email ilike '%'||coalesce(v,'')||'%'
        when 'not_contains'then p_sub.email not ilike '%'||coalesce(v,'')||'%'
        when 'ends_with'   then p_sub.email ilike '%'||coalesce(v,'')
        else false end;

    when 'name' then
      return case o
        when 'contains' then p_sub.name ilike '%'||coalesce(v,'')||'%'
        when 'is_set'   then coalesce(p_sub.name,'') <> ''
        when 'is_empty' then coalesce(p_sub.name,'') = ''
        else false end;

    when 'consent_source' then
      return case o
        when 'eq'       then p_sub.consent_source = v
        when 'contains' then p_sub.consent_source ilike '%'||coalesce(v,'')||'%'
        else false end;

    when 'created_at' then
      return case o
        when 'within_days' then n is not null and p_sub.created_at >= now() - make_interval(days => n)
        when 'before_days' then n is not null and p_sub.created_at <  now() - make_interval(days => n)
        else false end;

    -- Membership. Only lists in the SAME workspace are considered, so a foreign
    -- list id in a saved filter matches nothing rather than reaching across.
    when 'on_list' then
      return case o
        when 'eq' then exists (
          select 1 from newsletter_list_subscribers ls
            join newsletter_lists l on l.id = ls.list_id
           where ls.subscriber_id = p_sub.id and l.workspace_id = p_sub.workspace_id
             and l.id::text = v)
        when 'neq' then not exists (
          select 1 from newsletter_list_subscribers ls
            join newsletter_lists l on l.id = ls.list_id
           where ls.subscriber_id = p_sub.id and l.workspace_id = p_sub.workspace_id
             and l.id::text = v)
        else false end;

    -- Engagement. This is the reason segments exist at all: "opened nothing in
    -- 90 days" is not expressible as a column comparison.
    when 'opened' then
      return case o
        when 'within_days' then n is not null and exists (
          select 1 from newsletter_events e where e.subscriber_id = p_sub.id
            and e.kind = 'open' and e.created_at >= now() - make_interval(days => n))
        when 'not_within_days' then n is not null and not exists (
          select 1 from newsletter_events e where e.subscriber_id = p_sub.id
            and e.kind = 'open' and e.created_at >= now() - make_interval(days => n))
        when 'never' then not exists (
          select 1 from newsletter_events e where e.subscriber_id = p_sub.id and e.kind = 'open')
        else false end;

    when 'clicked' then
      return case o
        when 'within_days' then n is not null and exists (
          select 1 from newsletter_events e where e.subscriber_id = p_sub.id
            and e.kind = 'click' and e.created_at >= now() - make_interval(days => n))
        when 'not_within_days' then n is not null and not exists (
          select 1 from newsletter_events e where e.subscriber_id = p_sub.id
            and e.kind = 'click' and e.created_at >= now() - make_interval(days => n))
        when 'never' then not exists (
          select 1 from newsletter_events e where e.subscriber_id = p_sub.id and e.kind = 'click')
        else false end;

    when 'received' then
      return case o
        when 'never' then not exists (
          select 1 from newsletter_deliveries d where d.subscriber_id = p_sub.id and d.status = 'sent')
        when 'at_least' then n is not null and (
          select count(*) from newsletter_deliveries d
           where d.subscriber_id = p_sub.id and d.status = 'sent') >= n
        else false end;

    else return false;
  end case;
end $$;

/**
 * Evaluate a filter set live.
 *
 * bool_and over an EMPTY condition array returns NULL, which would make an empty
 * segment match nobody. coalesce(..., true) makes it match everyone instead —
 * "no filters" means "all subscribers", which is what someone building a segment
 * sees before they add their first condition.
 */
create or replace function evaluate_segment_filters(
  p_privy text, p_workspace uuid, p_filters jsonb,
  p_limit int default 25, p_offset int default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb; v_total bigint; v_lim int; v_off int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if jsonb_typeof(coalesce(p_filters, '[]'::jsonb)) <> 'array' then raise exception 'BAD_FILTERS'; end if;
  v_lim := greatest(1, least(coalesce(p_limit, 25), 200));
  v_off := greatest(0, coalesce(p_offset, 0));

  select count(*) into v_total
    from newsletter_subscribers s
   where s.workspace_id = p_workspace
     and coalesce((select bool_and(segment_match(s, c))
                     from jsonb_array_elements(coalesce(p_filters,'[]'::jsonb)) c), true);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_rows from (
    select s.id, s.email, s.name, s.status, s.consent_source, s.created_at
      from newsletter_subscribers s
     where s.workspace_id = p_workspace
       and coalesce((select bool_and(segment_match(s, c))
                       from jsonb_array_elements(coalesce(p_filters,'[]'::jsonb)) c), true)
     order by s.created_at desc
     limit v_lim offset v_off
  ) x;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end $$;
grant execute on function evaluate_segment_filters(text, uuid, jsonb, int, int) to authenticated, anon;

-- ── CRUD ─────────────────────────────────────────────────────────────────────
create or replace function get_segments(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  -- Deliberately does NOT compute each segment's size: that would run the full
  -- predicate set for every segment on every page load. The count is fetched
  -- when a segment is opened.
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
    select g.id, g.name, g.description, g.filters, g.updated_at
      from segments g where g.workspace_id = p_workspace
  ) x), '[]'::jsonb);
end $$;
grant execute on function get_segments(text, uuid) to authenticated, anon;

create or replace function save_segment(
  p_privy text, p_workspace uuid, p_id uuid, p_name text, p_description text, p_filters jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if jsonb_typeof(coalesce(p_filters, '[]'::jsonb)) <> 'array' then raise exception 'BAD_FILTERS'; end if;
  if jsonb_array_length(coalesce(p_filters, '[]'::jsonb)) > 20 then raise exception 'TOO_MANY_FILTERS'; end if;

  if p_id is null then
    insert into segments (workspace_id, name, description, filters, created_by_privy)
    values (p_workspace, coalesce(nullif(p_name,''),'New segment'), coalesce(p_description,''),
            coalesce(p_filters,'[]'::jsonb), p_privy)
    returning id into v_id;
  else
    update segments set
      name = coalesce(nullif(p_name,''), name),
      description = coalesce(p_description, description),
      filters = coalesce(p_filters, filters)
    where id = p_id and workspace_id = p_workspace
    returning id into v_id;
  end if;
  return v_id;
end $$;
grant execute on function save_segment(text, uuid, uuid, text, text, jsonb) to authenticated, anon;

create or replace function delete_segment(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  delete from segments where id = p_id and workspace_id = p_workspace;
  return found;
end $$;
grant execute on function delete_segment(text, uuid, uuid) to authenticated, anon;

/**
 * Materialise a segment onto a list, so a newsletter can target it.
 *
 * A COPY, not a live link, and that is the honest behaviour: a send's audience
 * is fixed when it is queued (0070), so pretending a segment stays live inside a
 * send would be a lie. The user syncs, sees the number, then sends.
 *
 * Only ADDS. It never removes anyone the segment no longer matches, because
 * someone may have been added to that list by other means and silently dropping
 * them is not something a "sync" button should do.
 */
create or replace function sync_segment_to_list(
  p_privy text, p_workspace uuid, p_segment uuid, p_list uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_filters jsonb; v_added int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select filters into v_filters from segments where id = p_segment and workspace_id = p_workspace;
  if v_filters is null then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from newsletter_lists where id = p_list and workspace_id = p_workspace) then
    raise exception 'NOT_FOUND';
  end if;

  insert into newsletter_list_subscribers (list_id, subscriber_id)
  select p_list, s.id
    from newsletter_subscribers s
   where s.workspace_id = p_workspace
     and coalesce((select bool_and(segment_match(s, c))
                     from jsonb_array_elements(v_filters) c), true)
  on conflict do nothing;
  get diagnostics v_added = row_count;

  return jsonb_build_object('added', v_added);
end $$;
grant execute on function sync_segment_to_list(text, uuid, uuid, uuid) to authenticated, anon;

notify pgrst, 'reload schema';
