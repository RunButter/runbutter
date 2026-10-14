-- ============================================================================
-- 0138_surveys.sql — customer surveys: NPS and CSAT, tied to the CRM.
--
-- "How likely are you to recommend us?" is worth asking only when the answer
-- lands on the customer it came from. So an invite is to a PERSON (People),
-- the response carries their company, a detractor shows on the company's
-- record as a note, and "answered" is an automation trigger ("a detractor
-- answered → post in chat, make a task").
--
-- ── ONE CLICK FROM THE EMAIL ────────────────────────────────────────────────
-- The email carries the 0–10 (or 1–5) buttons; each is a link that records the
-- score on open and then asks "what's the main reason?". The link's key is
-- DERIVED — HMAC(server key, invite id), lib/surveys/token.ts — and only its
-- sha256 is stored: the same design as the support widget (0131) and booking
-- pages (0135). Clicking another score in the same email changes the answer
-- rather than adding a second one (one response per invite, a unique index).
--
-- ── NOT A SPAM CANNON ───────────────────────────────────────────────────────
-- create_survey_invites skips: people with no email, anyone who opted out of
-- surveys here (survey_opt_outs, the link in every email), addresses the
-- newsletter side knows bounced/complained/unsubscribed, and anyone invited to
-- ANY survey of this workspace in the last 30 days unless the sender forces it.
-- At most 500 per call. The reasons come back counted, so the screen can say
-- what happened instead of a number that does not add up.
-- ============================================================================

create table if not exists surveys (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  name              text not null,
  kind              text not null default 'nps' check (kind in ('nps', 'csat')),
  question          text not null,
  followup_question text,
  thank_you         text,
  enabled           boolean not null default true,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_surveys_ws on surveys(workspace_id);
alter table surveys enable row level security;
revoke all on table surveys from anon, authenticated;

create table if not exists survey_invites (
  id           uuid primary key,
  survey_id    uuid not null references surveys(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  person_id    uuid,
  company_id   uuid,
  email        text not null,
  name         text,
  token_hash   text not null,
  sent_at      timestamptz,
  created_by   text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_survey_invites_survey on survey_invites(survey_id);
create index if not exists idx_survey_invites_email on survey_invites(workspace_id, lower(email), created_at);
alter table survey_invites enable row level security;
revoke all on table survey_invites from anon, authenticated;

create table if not exists survey_responses (
  id           uuid primary key default gen_random_uuid(),
  survey_id    uuid not null references surveys(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  invite_id    uuid references survey_invites(id) on delete set null,
  person_id    uuid,
  company_id   uuid,
  email        text,
  name         text,
  score        int not null check (score between 0 and 10),
  comment      text,
  source       text not null default 'email' check (source in ('email', 'link')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists uq_survey_responses_invite on survey_responses(invite_id) where invite_id is not null;
create index if not exists idx_survey_responses_survey on survey_responses(survey_id, created_at);
alter table survey_responses enable row level security;
revoke all on table survey_responses from anon, authenticated;

create table if not exists survey_opt_outs (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email        text not null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, email)
);
alter table survey_opt_outs enable row level security;
revoke all on table survey_opt_outs from anon, authenticated;

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- NPS: 9–10 promoter, 7–8 passive, 0–6 detractor. CSAT (1–5): 4–5 satisfied.
create or replace function survey_bucket(p_kind text, p_score int)
returns text language sql immutable as $$
  select case when p_kind = 'csat'
              then case when p_score >= 4 then 'promoter' when p_score = 3 then 'passive' else 'detractor' end
              else case when p_score >= 9 then 'promoter' when p_score >= 7 then 'passive' else 'detractor' end end;
$$;

create or replace function survey_public_json(s surveys)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'kind', s.kind, 'question', s.question, 'followup_question', s.followup_question,
    'thank_you', s.thank_you, 'enabled', s.enabled,
    'company', (select jsonb_build_object('name', w.name, 'logo', w.logo_url, 'accent', w.accent_color)
                  from workspaces w where w.id = s.workspace_id));
$$;

-- A response as the people who see it (the team) and the automations read it.
create or replace function survey_response_json(r survey_responses)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'survey_id', r.survey_id, 'score', r.score, 'comment', r.comment, 'source', r.source,
    'bucket', survey_bucket((select kind from surveys where id = r.survey_id), r.score),
    'person_id', r.person_id, 'company_id', r.company_id, 'email', r.email,
    'name', coalesce(r.name, (select nullif(btrim(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')), '') from people p where p.id = r.person_id)),
    'company', (select o.name from organizations o where o.id = r.company_id),
    'created_at', r.created_at, 'updated_at', r.updated_at);
$$;

-- The note on the person's (and company's) record: the score and the words,
-- with the survey as its source — the CRM half of the feature.
create or replace function survey_note_body(r survey_responses, p_company boolean)
returns text language sql stable security definer set search_path = public as $$
  select case when p_company and r.name is not null then r.name || ': ' else '' end
      || case when s.kind = 'nps' then 'NPS ' || r.score || '/10' else 'Satisfaction ' || r.score || '/5' end
      || ' (' || survey_bucket(s.kind, r.score) || ')' || coalesce(' — “' || left(r.comment, 500) || '”', '')
    from surveys s where s.id = r.survey_id;
$$;

create or replace function survey_note(r survey_responses)
returns void language plpgsql security definer set search_path = public as $$
declare v_source text := 'survey: ' || (select name from surveys where id = r.survey_id);
begin
  if r.person_id is not null then
    insert into record_notes (workspace_id, object, record_id, agent_name, kind, body, source, observed_at)
    values (r.workspace_id, 'people', r.person_id, 'Survey', 'observation', survey_note_body(r, false), v_source, now());
  end if;
  if r.company_id is not null then
    insert into record_notes (workspace_id, object, record_id, agent_name, kind, body, source, observed_at)
    values (r.workspace_id, 'companies', r.company_id, 'Survey', 'observation', survey_note_body(r, true), v_source, now());
  end if;
end $$;

-- ── Team side (signed in, through /api/rpc) ─────────────────────────────────

create or replace function get_surveys(p_privy text, p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(s) - 'workspace_id' || jsonb_build_object(
      'invites', (select count(*) from survey_invites i where i.survey_id = s.id),
      'responses', (select count(*) from survey_responses r where r.survey_id = s.id),
      'promoters', (select count(*) from survey_responses r where r.survey_id = s.id and survey_bucket(s.kind, r.score) = 'promoter'),
      'detractors', (select count(*) from survey_responses r where r.survey_id = s.id and survey_bucket(s.kind, r.score) = 'detractor'),
      'average', (select round(avg(r.score)::numeric, 1) from survey_responses r where r.survey_id = s.id))
      order by s.created_at desc)
    from surveys s where s.workspace_id = p_workspace), '[]'::jsonb);
end $$;

create or replace function save_survey(p_privy text, p_workspace uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s surveys; v_id uuid := nullif(p_data->>'id', '')::uuid; v_kind text := coalesce(nullif(p_data->>'kind', ''), 'nps');
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(workspace_role(p_privy, p_workspace), '') = 'viewer' then raise exception 'FORBIDDEN'; end if;
  if v_id is null then
    if v_kind not in ('nps', 'csat') then raise exception 'BAD_KIND'; end if;
    insert into surveys (workspace_id, name, kind, question, created_by)
    values (p_workspace, left(coalesce(nullif(btrim(p_data->>'name'), ''), case when v_kind = 'nps' then 'NPS' else 'Customer satisfaction' end), 120),
            v_kind,
            left(coalesce(nullif(btrim(p_data->>'question'), ''),
              case when v_kind = 'nps'
                   then 'How likely are you to recommend ' || (select name from workspaces where id = p_workspace) || ' to a friend or colleague?'
                   else 'How satisfied are you with ' || (select name from workspaces where id = p_workspace) || '?' end), 300),
            p_privy)
    returning * into s;
  else
    select * into s from surveys where id = v_id and workspace_id = p_workspace;
    if s.id is null then raise exception 'NOT_FOUND'; end if;
  end if;
  -- The kind is fixed once there are answers: a 9 on a 0–10 scale is not a 9 on 1–5.
  update surveys set
    name              = case when p_data ? 'name' and nullif(btrim(p_data->>'name'), '') is not null then left(btrim(p_data->>'name'), 120) else name end,
    kind              = case when p_data ? 'kind' and p_data->>'kind' in ('nps', 'csat')
                              and not exists (select 1 from survey_responses r where r.survey_id = s.id) then p_data->>'kind' else kind end,
    question          = case when p_data ? 'question' and nullif(btrim(p_data->>'question'), '') is not null then left(btrim(p_data->>'question'), 300) else question end,
    followup_question = case when p_data ? 'followup_question' then nullif(left(btrim(coalesce(p_data->>'followup_question', '')), 300), '') else followup_question end,
    thank_you         = case when p_data ? 'thank_you' then nullif(left(btrim(coalesce(p_data->>'thank_you', '')), 500), '') else thank_you end,
    enabled           = case when p_data ? 'enabled' then coalesce((p_data->>'enabled')::boolean, true) else enabled end,
    updated_at        = now()
  where id = s.id returning * into s;
  return to_jsonb(s) - 'workspace_id';
end $$;

create or replace function delete_survey(p_privy text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s surveys;
begin
  select * into s from surveys where id = p_id;
  if s.id is null or not is_workspace_member(s.workspace_id, p_privy) then raise exception 'NOT_FOUND'; end if;
  if coalesce(workspace_role(p_privy, s.workspace_id), '') not in ('owner', 'admin') and s.created_by is distinct from p_privy then
    raise exception 'FORBIDDEN';
  end if;
  delete from surveys where id = p_id;
end $$;

-- Results for one survey over a range: the score, the split, a monthly trend
-- and every answer with who gave it.
create or replace function get_survey_results(p_privy text, p_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s surveys; v_from date := coalesce(p_from, '2000-01-01'); v_to date := coalesce(p_to, current_date);
begin
  select * into s from surveys where id = p_id;
  if s.id is null or not is_workspace_member(s.workspace_id, p_privy) then raise exception 'NOT_FOUND'; end if;
  return jsonb_build_object(
    'survey', to_jsonb(s) - 'workspace_id',
    'invites', (select count(*) from survey_invites i where i.survey_id = s.id and i.created_at::date between v_from and v_to),
    'distribution', (select jsonb_object_agg(sc, coalesce(n, 0)) from (
        select g.sc, (select count(*) from survey_responses r where r.survey_id = s.id and r.score = g.sc
                        and r.created_at::date between v_from and v_to) n
          from generate_series(case when s.kind = 'csat' then 1 else 0 end, case when s.kind = 'csat' then 5 else 10 end) g(sc)) d),
    'trend', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'responses', n, 'promoters', p, 'detractors', d, 'average', a) order by m)
        from (select to_char(date_trunc('month', r.created_at), 'YYYY-MM') m, count(*) n,
                     count(*) filter (where survey_bucket(s.kind, r.score) = 'promoter') p,
                     count(*) filter (where survey_bucket(s.kind, r.score) = 'detractor') d,
                     round(avg(r.score)::numeric, 1) a
                from survey_responses r where r.survey_id = s.id and r.created_at::date between v_from and v_to
               group by 1) t), '[]'::jsonb),
    'responses', coalesce((select jsonb_agg(survey_response_json(r) order by r.created_at desc)
        from (select * from survey_responses r where r.survey_id = s.id and r.created_at::date between v_from and v_to
               order by r.created_at desc limit 500) r), '[]'::jsonb));
end $$;

-- ── Sending (service_role, through /api/surveys/send) ───────────────────────

-- p_invites: [{id, person_id, token_hash}] — ids and hashes minted by the route.
create or replace function create_survey_invites(p_privy text, p_workspace uuid, p_survey uuid, p_invites jsonb, p_force boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s surveys; e jsonb; p people; v_email text; v_out jsonb := '[]'::jsonb;
        v_skip jsonb := '{"no_email":0,"opted_out":0,"suppressed":0,"recent":0,"not_found":0}'::jsonb; v_n int := 0;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(workspace_role(p_privy, p_workspace), '') = 'viewer' then raise exception 'FORBIDDEN'; end if;
  select * into s from surveys where id = p_survey and workspace_id = p_workspace;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  if not s.enabled then raise exception 'SURVEY_OFF'; end if;
  if jsonb_array_length(coalesce(p_invites, '[]'::jsonb)) > 500 then raise exception 'TOO_MANY'; end if;
  for e in select * from jsonb_array_elements(coalesce(p_invites, '[]'::jsonb)) loop
    select * into p from people where id = nullif(e->>'person_id', '')::uuid and workspace_id = p_workspace;
    if p.id is null then v_skip := jsonb_set(v_skip, '{not_found}', to_jsonb((v_skip->>'not_found')::int + 1)); continue; end if;
    v_email := lower(btrim(coalesce(p.email, '')));
    if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then v_skip := jsonb_set(v_skip, '{no_email}', to_jsonb((v_skip->>'no_email')::int + 1)); continue; end if;
    if exists (select 1 from survey_opt_outs o where o.workspace_id = p_workspace and o.email = v_email) then
      v_skip := jsonb_set(v_skip, '{opted_out}', to_jsonb((v_skip->>'opted_out')::int + 1)); continue;
    end if;
    if exists (select 1 from newsletter_subscribers n where n.workspace_id = p_workspace and lower(n.email) = v_email
                and n.status in ('bounced', 'complained', 'unsubscribed')) then
      v_skip := jsonb_set(v_skip, '{suppressed}', to_jsonb((v_skip->>'suppressed')::int + 1)); continue;
    end if;
    if not coalesce(p_force, false) and exists (select 1 from survey_invites i where i.workspace_id = p_workspace
                and lower(i.email) = v_email and i.created_at > now() - interval '30 days') then
      v_skip := jsonb_set(v_skip, '{recent}', to_jsonb((v_skip->>'recent')::int + 1)); continue;
    end if;
    insert into survey_invites (id, survey_id, workspace_id, person_id, company_id, email, name, token_hash, created_by)
    values ((e->>'id')::uuid, s.id, p_workspace, p.id, p.primary_company_id, v_email,
            nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), e->>'token_hash', p_privy);
    v_out := v_out || jsonb_build_object('id', e->>'id', 'email', v_email, 'first_name', p.first_name);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('invites', v_out, 'created', v_n, 'skipped', v_skip,
    'survey', survey_public_json(s),
    'from_name', (select coalesce(nullif(w.email_from_name, ''), w.name) from workspaces w where w.id = p_workspace),
    'reply_to', (select a.email from accounts a where a.workspace_id = p_workspace and a.privy_user_id = p_privy order by a.created_at limit 1));
end $$;

create or replace function mark_survey_sent(p_ids uuid[])
returns void language sql security definer set search_path = public as $$
  update survey_invites set sent_at = now() where id = any(p_ids);
$$;

-- ── Answering (service_role, through /api/surveys/answer) ───────────────────

create or replace function survey_by_invite(p_invite uuid, p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare i survey_invites; s surveys;
begin
  select * into i from survey_invites where id = p_invite and token_hash = p_token_hash;
  if i.id is null then return null; end if;
  select * into s from surveys where id = i.survey_id;
  return survey_public_json(s) || jsonb_build_object(
    'answer', (select jsonb_build_object('score', r.score, 'comment', r.comment) from survey_responses r where r.invite_id = i.id));
end $$;

create or replace function survey_public(p_survey uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select survey_public_json(s) from surveys s where s.id = p_survey and s.enabled;
$$;

-- An answer from an emailed invite: the first click records it, a later
-- click or the comment form changes it. The note on the record is written once.
create or replace function survey_answer_invite(p_invite uuid, p_token_hash text, p_score int, p_comment text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i survey_invites; s surveys; r survey_responses; v_new boolean;
begin
  select * into i from survey_invites where id = p_invite and token_hash = p_token_hash;
  if i.id is null then raise exception 'NOT_FOUND'; end if;
  select * into s from surveys where id = i.survey_id;
  if not s.enabled then raise exception 'SURVEY_OFF'; end if;
  -- (Parenthesised: a bare CASE inside IF ends the condition at its first THEN.)
  if p_score is null or p_score < (case when s.kind = 'csat' then 1 else 0 end) or p_score > (case when s.kind = 'csat' then 5 else 10 end) then
    raise exception 'BAD_SCORE';
  end if;
  v_new := not exists (select 1 from survey_responses where invite_id = i.id);
  insert into survey_responses (survey_id, workspace_id, invite_id, person_id, company_id, email, name, score, comment, source)
  values (s.id, i.workspace_id, i.id, i.person_id, i.company_id, i.email, i.name, p_score,
          nullif(left(btrim(coalesce(p_comment, '')), 2000), ''), 'email')
  on conflict (invite_id) where invite_id is not null do update set
    score = excluded.score,
    comment = coalesce(excluded.comment, survey_responses.comment),
    updated_at = now()
  returning * into r;
  -- One note per answer: written on the first click, rewritten in place when
  -- the score changes or the reason arrives — never a second note.
  if v_new then
    perform survey_note(r);
  else
    update record_notes n set body = survey_note_body(r, n.object = 'companies')
     where n.workspace_id = r.workspace_id and n.agent_name = 'Survey' and n.source = 'survey: ' || s.name
       and ((n.object = 'people' and n.record_id = r.person_id) or (n.object = 'companies' and n.record_id = r.company_id))
       and n.created_at >= r.created_at - interval '1 second';
  end if;
  return survey_response_json(r);
end $$;

-- An answer from the shareable link (no invite): matched to a person by email
-- when one is given and known.
create or replace function survey_answer_link(p_survey uuid, p_score int, p_comment text, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s surveys; r survey_responses; p people; v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select * into s from surveys where id = p_survey and enabled;
  if s.id is null then raise exception 'NOT_FOUND'; end if;
  -- (Parenthesised: a bare CASE inside IF ends the condition at its first THEN.)
  if p_score is null or p_score < (case when s.kind = 'csat' then 1 else 0 end) or p_score > (case when s.kind = 'csat' then 5 else 10 end) then
    raise exception 'BAD_SCORE';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then v_email := null; end if;
  if v_email is not null then
    select * into p from people where workspace_id = s.workspace_id and lower(email) = v_email order by created_at limit 1;
  end if;
  insert into survey_responses (survey_id, workspace_id, person_id, company_id, email, name, score, comment, source)
  values (s.id, s.workspace_id, p.id, p.primary_company_id, v_email,
          nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p_score,
          nullif(left(btrim(coalesce(p_comment, '')), 2000), ''), 'link')
  returning * into r;
  perform survey_note(r);
  return survey_response_json(r);
end $$;

-- The link in every email: stop sending ME surveys from this workspace.
create or replace function survey_opt_out(p_invite uuid, p_token_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare i survey_invites;
begin
  select * into i from survey_invites where id = p_invite and token_hash = p_token_hash;
  if i.id is null then raise exception 'NOT_FOUND'; end if;
  insert into survey_opt_outs (workspace_id, email) values (i.workspace_id, lower(i.email)) on conflict do nothing;
  return true;
end $$;

-- ── Automations: "when a survey is answered" ────────────────────────────────
-- automation_payload and automation_sample_row redefined IN FULL from 0136.
create or replace function automation_payload(p_slug text, p_table text, p_row jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb := coalesce(p_row, '{}'::jsonb) - 'token_hash' - 'access_token' - 'key_hash'
                   - 'secret' - 'webhook_token' - 'resume_tsv' - 'resume_raw_text' - 'search_tsv' - 'fts';
begin
  if p_table = 'custom_records' then
    return coalesce(v->'data', '{}'::jsonb) || jsonb_build_object(
      'id', v->'id', 'created_at', v->'created_at', 'updated_at', v->'updated_at');
  elsif p_table = 'form_submissions' then
    return coalesce(v->'data', '{}'::jsonb) || jsonb_build_object(
      'id', v->'id', 'person_id', v->'person_id', 'created_at', v->'created_at',
      'form', (select f.name from forms f where f.id = (v->>'form_id')::uuid));
  elsif p_table = 'pipeline_records' then
    return v || jsonb_build_object(
      'stage', (select s.name from pipeline_stages s where s.id = (v->>'stage_id')::uuid),
      'company', (select o.name from organizations o where o.id = (v->>'company_id')::uuid),
      'pipeline', (select p.kind from pipelines p where p.id = (v->>'pipeline_id')::uuid));
  elsif p_table = 'support_conversations' then
    return v || jsonb_build_object('message', v->'subject');
  elsif p_table = 'candidates' then
    return v || jsonb_build_object('position',
      (select po.title from positions po where po.id = (v->>'position_id')::uuid));
  elsif p_table = 'meetings' then
    -- The raw Cal.com payload stays out: it is long and holds the attendee's
    -- answers to someone else's form.
    return (v - 'raw') || jsonb_build_object(
      'name', v->'attendee_name', 'email', v->'attendee_email', 'phone', v->'attendee_phone',
      'company', v->'attendee_company', 'start', v->'starts_at', 'end', v->'ends_at',
      'page', (select bp.title from booking_pages bp where bp.id = nullif(v->>'booking_page_id','')::uuid));
  elsif p_table = 'survey_responses' then
    return survey_response_json(jsonb_populate_record(null::survey_responses, v))
      || jsonb_build_object('survey', (select s.name from surveys s where s.id = nullif(v->>'survey_id','')::uuid));
  elsif p_table = 'leave_requests' then
    -- The person's name and the type; the note stays out (it may say why).
    return jsonb_build_object(
      'id', v->'id', 'name', time_member_name((v->>'workspace_id')::uuid, v->>'privy_user_id'),
      'type', (select t.name from leave_types t where t.id = nullif(v->>'leave_type_id','')::uuid),
      'start', v->'start_date', 'end', v->'end_date', 'days', v->'days', 'status', v->'status',
      'created_at', v->'created_at', 'updated_at', v->'updated_at');
  elsif v ? 'organization_id' then
    return v || jsonb_build_object('company',
      coalesce((select o.name from organizations o where o.id = (v->>'organization_id')::uuid), v->>'company'));
  end if;
  return v;
end $$;

create or replace function automation_sample_row(p_workspace uuid, p_object text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_table text;
begin
  case p_object
    when 'companies' then select to_jsonb(t), 'organizations' into v, v_table from organizations t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'people' then select to_jsonb(t), 'people' into v, v_table from people t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'invoices' then select to_jsonb(t), 'invoices' into v, v_table from invoices t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'expenses' then select to_jsonb(t), 'expenses' into v, v_table from expenses t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'transactions' then select to_jsonb(t), 'transactions' into v, v_table from transactions t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'products' then select to_jsonb(t), 'products' into v, v_table from products t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'campaigns' then select to_jsonb(t), 'campaigns' into v, v_table from campaigns t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'projects' then select to_jsonb(t), 'projects' into v, v_table from projects t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'issues' then select to_jsonb(t), 'issues' into v, v_table from issues t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'assets' then select to_jsonb(t), 'assets' into v, v_table from assets t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'deals' then select to_jsonb(t), 'pipeline_records' into v, v_table from pipeline_records t
                       join pipelines p on p.id = t.pipeline_id and p.kind = 'sales'
                      where t.workspace_id = p_workspace order by t.created_at desc limit 1;
    when 'orders' then select to_jsonb(t), 'orders' into v, v_table from orders t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'form_submissions' then select to_jsonb(t), 'form_submissions' into v, v_table from form_submissions t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'conversations' then select to_jsonb(t), 'support_conversations' into v, v_table from support_conversations t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'bookings' then select to_jsonb(t), 'meetings' into v, v_table from meetings t where workspace_id = p_workspace order by created_at desc nulls last limit 1;
    when 'survey_responses' then select to_jsonb(t), 'survey_responses' into v, v_table from survey_responses t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'time_off' then select to_jsonb(t), 'leave_requests' into v, v_table from leave_requests t where workspace_id = p_workspace order by created_at desc limit 1;
    when 'candidates' then select to_jsonb(t), 'candidates' into v, v_table from candidates t where company_id = p_workspace order by applied_at desc limit 1;
    else
      select to_jsonb(t), 'custom_records' into v, v_table from custom_records t
        join custom_objects o on o.id = t.object_id and o.workspace_id = p_workspace and o.slug = p_object
       where t.workspace_id = p_workspace order by t.created_at desc limit 1;
  end case;
  if v is null then return null; end if;
  return automation_payload(p_object, v_table, v);
end $$;

do $$ begin
  drop trigger if exists trg_autoevt_survey_responses on survey_responses;
  create trigger trg_autoevt_survey_responses after insert or update on survey_responses
    for each row execute function emit_automation_event('survey_responses');
end $$;

-- ── Grants (0046 posture) ───────────────────────────────────────────────────
revoke all on function survey_bucket(text, int) from public, anon, authenticated;
revoke all on function survey_public_json(surveys) from public, anon, authenticated;
revoke all on function survey_response_json(survey_responses) from public, anon, authenticated;
revoke all on function survey_note_body(survey_responses, boolean) from public, anon, authenticated;
revoke all on function survey_note(survey_responses) from public, anon, authenticated;
revoke all on function get_surveys(text, uuid) from public, anon, authenticated;
revoke all on function save_survey(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function delete_survey(text, uuid) from public, anon, authenticated;
revoke all on function get_survey_results(text, uuid, date, date) from public, anon, authenticated;
revoke all on function create_survey_invites(text, uuid, uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function mark_survey_sent(uuid[]) from public, anon, authenticated;
revoke all on function survey_by_invite(uuid, text) from public, anon, authenticated;
revoke all on function survey_public(uuid) from public, anon, authenticated;
revoke all on function survey_answer_invite(uuid, text, int, text) from public, anon, authenticated;
revoke all on function survey_answer_link(uuid, int, text, text) from public, anon, authenticated;
revoke all on function survey_opt_out(uuid, text) from public, anon, authenticated;
revoke all on function automation_payload(text, text, jsonb) from public, anon, authenticated;
revoke all on function automation_sample_row(uuid, text) from public, anon, authenticated;
grant execute on function survey_bucket(text, int) to service_role;
grant execute on function survey_public_json(surveys) to service_role;
grant execute on function survey_response_json(survey_responses) to service_role;
grant execute on function survey_note_body(survey_responses, boolean) to service_role;
grant execute on function survey_note(survey_responses) to service_role;
grant execute on function get_surveys(text, uuid) to service_role;
grant execute on function save_survey(text, uuid, jsonb) to service_role;
grant execute on function delete_survey(text, uuid) to service_role;
grant execute on function get_survey_results(text, uuid, date, date) to service_role;
grant execute on function create_survey_invites(text, uuid, uuid, jsonb, boolean) to service_role;
grant execute on function mark_survey_sent(uuid[]) to service_role;
grant execute on function survey_by_invite(uuid, text) to service_role;
grant execute on function survey_public(uuid) to service_role;
grant execute on function survey_answer_invite(uuid, text, int, text) to service_role;
grant execute on function survey_answer_link(uuid, int, text, text) to service_role;
grant execute on function survey_opt_out(uuid, text) to service_role;
grant execute on function automation_payload(text, text, jsonb) to service_role;
grant execute on function automation_sample_row(uuid, text) to service_role;

notify pgrst, 'reload schema';
