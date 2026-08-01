-- ============================================================================
-- RunButter — 0074_lead_scoring.sql
-- Engagement scoring: points per action, decaying with age, stored per
-- subscriber so segments can filter on it cheaply.
--
-- WHY A STORED COLUMN AND NOT A COMPUTED ONE. Score's whole purpose is to be
-- filtered on ("score above 20"), and 0072's engagement predicates already run
-- an EXISTS per row. Computing a decayed sum per row inside a segment filter
-- would multiply that cost by the number of events each person has. A column
-- refreshed in batches by the cron makes score comparisons a plain integer
-- scan, and the staleness it buys is at most one cron tick — irrelevant for a
-- number whose inputs decay over weeks.
--
-- WHY DECAY AT ALL. Without it, score is a lifetime total: someone who read
-- everything two years ago and nothing since outranks someone reading you now.
-- That inverts the one question the score exists to answer — who is warm TODAY.
-- Half-life is configurable per workspace; at the 30-day default a click is
-- worth half as much after a month and a sixteenth after four.
--
-- SCOPE, STATED: v1 scores newsletter engagement only (opens, clicks, and
-- negative signals). Form submissions and page views are deliberately out —
-- both would need matching an anonymous visitor to a subscriber, which is a
-- guess, and a scoring model built on a guess is worse than a narrower one that
-- is right.
--
-- Depends on 0070-0073. Additive, idempotent & prod-safe.
-- ============================================================================

create table if not exists scoring_settings (
  workspace_id   uuid primary key references workspaces(id) on delete cascade,
  enabled        boolean not null default false,
  -- Days after which a signal is worth half. 0 disables decay entirely.
  half_life_days int not null default 30 check (half_life_days between 0 and 3650),
  updated_at     timestamptz not null default now()
);
alter table scoring_settings enable row level security;
revoke all on table scoring_settings from anon, authenticated;

create table if not exists scoring_rules (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind         text not null check (kind in ('open', 'click', 'unsubscribe', 'bounce', 'complaint')),
  points       int  not null default 0 check (points between -100 and 100),
  primary key (workspace_id, kind)
);
alter table scoring_rules enable row level security;
revoke all on table scoring_rules from anon, authenticated;

alter table newsletter_subscribers add column if not exists score int not null default 0;
alter table newsletter_subscribers add column if not exists score_updated_at timestamptz;
-- Partial index on the mailable population: nobody segments on the score of a
-- bounced address.
create index if not exists idx_nl_subs_score on newsletter_subscribers(workspace_id, score desc)
  where status = 'enabled';

-- ── Settings + rules ─────────────────────────────────────────────────────────
create or replace function get_scoring_config(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select jsonb_build_object(
    'enabled', coalesce(s.enabled, false),
    'half_life_days', coalesce(s.half_life_days, 30),
    'rules', coalesce((select jsonb_object_agg(r.kind, r.points)
                         from scoring_rules r where r.workspace_id = p_workspace), '{}'::jsonb)
  ) into v from (select 1) z
  left join scoring_settings s on s.workspace_id = p_workspace;
  return v;
end $$;
grant execute on function get_scoring_config(text, uuid) to authenticated, anon;

create or replace function save_scoring_config(
  p_privy text, p_workspace uuid, p_enabled boolean, p_half_life int, p_rules jsonb
) returns boolean language plpgsql security definer set search_path = public as $$
declare k text; v int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if p_half_life is null or p_half_life < 0 or p_half_life > 3650 then raise exception 'BAD_HALF_LIFE'; end if;
  if jsonb_typeof(coalesce(p_rules, '{}'::jsonb)) <> 'object' then raise exception 'BAD_RULES'; end if;

  insert into scoring_settings (workspace_id, enabled, half_life_days, updated_at)
  values (p_workspace, coalesce(p_enabled, false), p_half_life, now())
  on conflict (workspace_id) do update
    set enabled = excluded.enabled, half_life_days = excluded.half_life_days, updated_at = now();

  for k, v in select key, value::text::int from jsonb_each(coalesce(p_rules, '{}'::jsonb)) loop
    if k not in ('open', 'click', 'unsubscribe', 'bounce', 'complaint') then raise exception 'BAD_RULE_KIND'; end if;
    if v < -100 or v > 100 then raise exception 'BAD_POINTS'; end if;
    insert into scoring_rules (workspace_id, kind, points) values (p_workspace, k, v)
    on conflict (workspace_id, kind) do update set points = excluded.points;
  end loop;
  return true;
end $$;
grant execute on function save_scoring_config(text, uuid, boolean, int, jsonb) to authenticated, anon;

-- ── Recompute ────────────────────────────────────────────────────────────────
/**
 * Recompute scores for one workspace, oldest-first, in batches.
 *
 * decay = 0.5 ^ (age_days / half_life). At half_life = 0 there is no decay and
 * the score is a lifetime total — offered because some workspaces genuinely
 * want that, but not the default, for the reason in the header.
 *
 * Events older than ten half-lives contribute under 0.1% and are excluded, so a
 * subscriber with years of history does not cost proportionally more to score.
 *
 * Oldest-first by score_updated_at means the batch always advances: with a
 * fixed limit and a nulls-first ordering, everyone gets scored before anyone is
 * scored twice.
 */
create or replace function recompute_subscriber_scores(p_workspace uuid, p_limit int default 500)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hl int; v_enabled boolean; v_n int; v_cutoff interval;
begin
  select enabled, half_life_days into v_enabled, v_hl
    from scoring_settings where workspace_id = p_workspace;
  if not coalesce(v_enabled, false) then return jsonb_build_object('scored', 0, 'skipped', 'disabled'); end if;
  v_hl := coalesce(v_hl, 30);
  v_cutoff := make_interval(days => case when v_hl = 0 then 36500 else least(v_hl * 10, 36500) end);

  with target as (
    select s.id from newsletter_subscribers s
     where s.workspace_id = p_workspace
     order by s.score_updated_at asc nulls first
     limit greatest(1, least(coalesce(p_limit, 500), 5000))
  ), scored as (
    select t.id,
           coalesce(round(sum(
             r.points * case when v_hl = 0 then 1.0
                             else power(0.5, extract(epoch from (now() - e.created_at)) / 86400.0 / v_hl)
                        end
           )), 0)::int as score
      from target t
      left join newsletter_events e
             on e.subscriber_id = t.id
            and e.created_at >= now() - v_cutoff
      left join scoring_rules r
             on r.workspace_id = p_workspace and r.kind = e.kind
     group by t.id
  )
  update newsletter_subscribers s
     set score = sc.score, score_updated_at = now()
    from scored sc where s.id = sc.id;
  get diagnostics v_n = row_count;

  return jsonb_build_object('scored', v_n, 'half_life_days', v_hl);
end $$;
revoke all on function recompute_subscriber_scores(uuid, int) from public, authenticated, anon;
grant execute on function recompute_subscriber_scores(uuid, int) to service_role;

create or replace function scoring_workspaces()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return coalesce((select jsonb_agg(workspace_id) from scoring_settings where enabled), '[]'::jsonb);
end $$;
revoke all on function scoring_workspaces() from public, authenticated, anon;
grant execute on function scoring_workspaces() to service_role;

-- ── segment_match, redefined IN FULL with the score field ────────────────────
-- Per the project convention: extend the latest definition rather than adding a
-- parallel one. Only the new `score` branch differs from 0072.
create or replace function segment_match(p_sub newsletter_subscribers, p_cond jsonb)
returns boolean language plpgsql stable set search_path = public as $$
declare
  f text := p_cond->>'field';
  o text := coalesce(p_cond->>'op', 'eq');
  v text := p_cond->>'value';
  n int  := case when coalesce(v, '') ~ '^-?\d{1,6}$' then v::int else null end;
begin
  if f is null then return false; end if;

  case f
    when 'status' then
      return case o when 'eq' then p_sub.status = v when 'neq' then p_sub.status <> v else false end;

    when 'email' then
      return case o
        when 'contains'     then p_sub.email ilike '%'||coalesce(v,'')||'%'
        when 'not_contains' then p_sub.email not ilike '%'||coalesce(v,'')||'%'
        when 'ends_with'    then p_sub.email ilike '%'||coalesce(v,'')
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
        when 'within_days' then n is not null and n >= 0 and p_sub.created_at >= now() - make_interval(days => n)
        when 'before_days' then n is not null and n >= 0 and p_sub.created_at <  now() - make_interval(days => n)
        else false end;

    -- NEW in 0074. A plain integer comparison, which is exactly why score is a
    -- stored column rather than computed per row inside this function.
    when 'score' then
      return case o
        when 'gte' then n is not null and p_sub.score >= n
        when 'lte' then n is not null and p_sub.score <= n
        else false end;

    when 'on_list' then
      return case o
        when 'eq' then exists (
          select 1 from newsletter_list_subscribers ls join newsletter_lists l on l.id = ls.list_id
           where ls.subscriber_id = p_sub.id and l.workspace_id = p_sub.workspace_id and l.id::text = v)
        when 'neq' then not exists (
          select 1 from newsletter_list_subscribers ls join newsletter_lists l on l.id = ls.list_id
           where ls.subscriber_id = p_sub.id and l.workspace_id = p_sub.workspace_id and l.id::text = v)
        else false end;

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

-- Score is shown in the subscriber list, so it must be selected there.
create or replace function get_newsletter_subscribers(
  p_privy text, p_workspace uuid, p_list uuid default null,
  p_query text default null, p_limit int default 50, p_offset int default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rows jsonb; v_total bigint; v_lim int; v_off int;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  v_lim := greatest(1, least(coalesce(p_limit, 50), 200));
  v_off := greatest(0, coalesce(p_offset, 0));

  select count(*) into v_total
    from newsletter_subscribers s
   where s.workspace_id = p_workspace
     and (p_list is null or exists (select 1 from newsletter_list_subscribers ls
                                     where ls.subscriber_id = s.id and ls.list_id = p_list))
     and (p_query is null or p_query = '' or s.email ilike '%'||p_query||'%' or s.name ilike '%'||p_query||'%');

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb) into v_rows from (
    select s.id, s.email, s.name, s.status, s.person_id, s.consent_source, s.consent_at,
           s.score, s.created_at
      from newsletter_subscribers s
     where s.workspace_id = p_workspace
       and (p_list is null or exists (select 1 from newsletter_list_subscribers ls
                                       where ls.subscriber_id = s.id and ls.list_id = p_list))
       and (p_query is null or p_query = '' or s.email ilike '%'||p_query||'%' or s.name ilike '%'||p_query||'%')
     order by s.created_at desc
     limit v_lim offset v_off
  ) x;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end $$;
grant execute on function get_newsletter_subscribers(text, uuid, uuid, text, int, int) to authenticated, anon;

notify pgrst, 'reload schema';
