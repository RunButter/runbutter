-- ============================================================================
-- RunButter — 0058_sanctions.sql
-- Sanctions screening: check a customer, vendor or contact against the official
-- OFAC lists before you invoice them or pay them.
--
-- WHY THIS SHAPE:
--   • The lists are US Treasury publications — public domain, freely
--     redistributable, no key and no per-query fee. We ingest the raw CSVs into
--     Postgres (see /api/sanctions/refresh) and match locally with pg_trgm.
--     Screening is therefore a local index lookup, not a metered API call, which
--     is what keeps this free at any volume. Hosted screening APIs charge per
--     query AND require a commercial data licence; that is the thing being
--     avoided here.
--   • sanctions_entities is REFERENCE DATA, deliberately not workspace-scoped —
--     it's the same public list for everyone, and one shared trigram index beats
--     N copies. Only the screening *results* are tenant data.
--   • Fuzzy, not exact. Real names arrive as "Acme Trading Sp. z o.o." against a
--     list entry of "ACME TRADING". sanctions_normalize() strips legal forms and
--     punctuation, and trigram similarity absorbs the rest.
--
-- WHAT THIS IS NOT: a compliance product. It screens against the OFAC lists we
-- have imported, at the freshness of the last refresh, and it cannot tell you
-- that a name match IS the listed party. Every hit needs a human decision —
-- which is why screen_sanctions writes an audit row every time it runs.
-- Depends on 0001 (workspaces) + is_workspace_member/workspace_role.
-- ============================================================================

create extension if not exists pg_trgm;

-- ── Reference data ──────────────────────────────────────────────────────────
create table if not exists sanctions_entities (
  id           bigserial primary key,
  source       text not null,                       -- 'ofac_sdn' | 'ofac_consolidated'
  source_uid   text not null,                       -- OFAC ent_num, stable across refreshes
  name         text not null,
  entity_type  text,                                -- individual | entity | vessel | aircraft
  programs     text[] not null default '{}',        -- e.g. {UKRAINE-EO13662,RUSSIA-EO14024}
  aliases      text[] not null default '{}',
  addresses    text[] not null default '{}',
  countries    text[] not null default '{}',
  remarks      text,
  -- All three are derived by trg_sanctions_search_text. norm_name/norm_aliases
  -- exist so scoring is a plain similarity() over stored text instead of
  -- re-normalising every candidate row on every screening.
  search_text  text not null default '',            -- normalised name + aliases, trigram target
  norm_name    text not null default '',
  norm_aliases text[] not null default '{}',
  updated_at   timestamptz not null default now(),
  unique (source, source_uid)
);
alter table sanctions_entities add column if not exists norm_name    text not null default '';
alter table sanctions_entities add column if not exists norm_aliases text[] not null default '{}';

-- Reference data, but there is no reason for a browser to page through 17k
-- sanctioned parties — reads go through screen_sanctions only.
alter table sanctions_entities enable row level security;
revoke all on table sanctions_entities from anon, authenticated;

create index if not exists idx_sanctions_entities_trgm on sanctions_entities using gin (search_text gin_trgm_ops);
create index if not exists idx_sanctions_entities_source on sanctions_entities(source);

-- Per-source freshness. The UI must be able to say "list last updated 3 days
-- ago" — a screening is only as good as its data, and silently screening
-- against a six-month-old list is worse than not screening.
create table if not exists sanctions_sources (
  source       text primary key,
  label        text not null,
  url          text,
  entity_count int not null default 0,
  synced_at    timestamptz,
  last_error   text
);
alter table sanctions_sources enable row level security;
revoke all on table sanctions_sources from anon, authenticated;

insert into sanctions_sources (source, label, url) values
  ('ofac_sdn',          'OFAC — Specially Designated Nationals', 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV'),
  ('ofac_consolidated', 'OFAC — Consolidated (non-SDN)',         'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/CONS_PRIM.CSV')
on conflict (source) do nothing;

-- ── Tenant data: the audit trail ────────────────────────────────────────────
-- Every screening is recorded. "We checked, on this date, and this is what came
-- back" is the entire evidentiary value of doing this at all.
create table if not exists sanctions_screenings (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  object_type  text,                                 -- 'companies' | 'people' | null for ad-hoc
  record_id    uuid,
  query        text not null,
  match_count  int not null default 0,
  top_score    numeric(4,3),
  status       text not null default 'clear' check (status in ('clear','review','no_data')),
  matches      jsonb not null default '[]',
  screened_by  text,
  screened_at  timestamptz not null default now()
);
create index if not exists idx_sanctions_screenings_ws on sanctions_screenings(workspace_id, screened_at desc);
create index if not exists idx_sanctions_screenings_record on sanctions_screenings(workspace_id, record_id, screened_at desc);
alter table sanctions_screenings enable row level security;
revoke all on table sanctions_screenings from anon, authenticated;

-- ── Name normalisation ──────────────────────────────────────────────────────
-- Uppercase → transliterate → drop punctuation → strip legal forms, so
-- "Acme Trading, LLC", "Åcme Trading Sp. z o.o." and "O.O.O. ACME TRADING" all
-- reduce to "ACME TRADING". Only legal-form tokens are stripped — words like
-- TRADING or GROUP carry real distinguishing meaning, and removing them would
-- collapse unrelated companies onto each other.
--
-- Three details that were wrong in the obvious version and matter a lot:
--   • Transliteration must happen BEFORE the punctuation strip. Otherwise "Å"
--     is not in [A-Z], becomes a space, and "Åcme" screens as "CME" — silently
--     losing the first letter of every accented name.
--   • Periods are DELETED, not turned into spaces, so "O.O.O." collapses to
--     "OOO" (a legal form we can strip) instead of "O O O" (three tokens of
--     noise that wreck the trigram score).
--   • Legal forms appear as prefixes in Russian/Polish/Indonesian naming and as
--     suffixes in Anglo/German naming, so both ends are stripped.
-- unaccent() is deliberately not used: it is STABLE, not IMMUTABLE, so it
-- cannot back a deterministic stored key. translate() can.
-- IMMUTABLE so search_text is reproducible for the index.
create or replace function sanctions_normalize(p text)
returns text language sql immutable parallel safe as $$
  with tr as (
    -- Ligatures expand to two letters, so they can't ride along in translate().
    select translate(
      replace(replace(replace(replace(replace(upper(coalesce(p, '')),
        'Æ', 'AE'), 'Œ', 'OE'), 'ß', 'SS'), 'İ', 'I'), '.', ''),
      'ÀÁÂÃÄÅĀĂĄÇĆČĈĊĎĐÐÈÉÊËĒĔĖĘĚĜĞĠĢÌÍÎÏĨĪĮİŁĹĻĽÑŃŅŇÒÓÔÕÖØŌŎŐŔŖŘŚŜŞŠŢŤŦÙÚÛÜŨŪŬŮŰŲÝŸŶŹŻŽÞ',
      'AAAAAAAAACCCCCDDDEEEEEEEEEGGGGIIIIIIIILLLLNNNNOOOOOOOOORRRSSSSTTTUUUUUUUUUUYYYZZZP'
    ) as v
  ), base as (
    select trim(regexp_replace(regexp_replace(v, '[^A-Z0-9]+', ' ', 'g'), '\s+', ' ', 'g')) as v from tr
  ), no_prefix as (
    select trim(regexp_replace(v,
      '^((OOO|ZAO|OAO|PAO|AO|TOO|JSC|OJSC|PJSC|CJSC|LLC|PT|CV|UAB|SP Z OO|SIA) )+',
      '', 'g')) as v
    from base
  ), stripped as (
    select trim(regexp_replace(v,
      '( (LLC|LLP|LP|LTD|LTDA|LIMITED|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|GMBH|MBH|AG|KG|SA|SAS|SARL|SL|SPA|SRL|BV|NV|PLC|OY|OYJ|AB|AS|ASA|APS|DOO|AD|JSC|OJSC|PJSC|CJSC|OOO|ZAO|PAO|OAO|PTE|PTY|BHD|SDN|SIA|UAB|SP Z OO|SPZOO|SPOLKA Z OGRANICZONA ODPOWIEDZIALNOSCIA|SA DE CV|DE CV))+$',
      '', 'g')) as v
    from no_prefix
  )
  -- A company genuinely named "CO" would normalise to nothing; fall back through
  -- the earlier forms rather than producing an empty search key.
  select coalesce(nullif(stripped.v, ''), nullif(no_prefix.v, ''), base.v)
  from base, no_prefix, stripped;
$$;

-- search_text is derived, never supplied by the caller: the ingest route would
-- otherwise have to reimplement sanctions_normalize in TypeScript, and any
-- drift between the two would silently degrade matching.
create or replace function sanctions_entities_search_text() returns trigger
language plpgsql set search_path = public as $$
begin
  new.norm_name    := sanctions_normalize(new.name);
  new.norm_aliases := coalesce((select array_agg(sanctions_normalize(a)) from unnest(new.aliases) a), '{}');
  new.search_text  := trim(new.norm_name || ' ' || array_to_string(new.norm_aliases, ' '));
  return new;
end $$;

drop trigger if exists trg_sanctions_search_text on sanctions_entities;
create trigger trg_sanctions_search_text
  before insert or update of name, aliases on sanctions_entities
  for each row execute function sanctions_entities_search_text();

-- ── Screening ───────────────────────────────────────────────────────────────
-- Returns the matches AND records the check. Named screen_* rather than get_*
-- on purpose: /lib/rpc only memoises get|list|search|suggest, and an audited
-- write must never be served from cache.
create or replace function screen_sanctions(
  p_privy text, p_workspace uuid, p_query text,
  p_object text default null, p_record uuid default null,
  p_threshold numeric default 0.45
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_q text; v_total bigint; v_matches jsonb; v_count int; v_top numeric; v_status text;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  v_q := sanctions_normalize(p_query);
  if length(v_q) < 3 then raise exception 'QUERY_TOO_SHORT'; end if;

  -- Prefilter with word_similarity (`<%`), NOT plain similarity (`%`).
  -- search_text concatenates a name with up to a dozen aliases, so whole-string
  -- similarity against a short query is tiny — an entity with 7 aliases scored
  -- 0.22 against its OWN name and was filtered out before scoring, i.e. the
  -- exact name of a sanctioned party came back "clear". word_similarity scores
  -- the best matching extent instead, which is the right question here.
  -- The prefilter is set strictly looser than the final score cut so it can
  -- never be the thing that hides a match.
  perform set_config('pg_trgm.word_similarity_threshold',
                     greatest(0.1, p_threshold * 0.8)::text, true);

  select count(*) into v_total from sanctions_entities;

  -- No list imported yet. Reporting "clear" here would be an actively harmful
  -- lie, so it gets its own status and no audit row claiming a clean result.
  if v_total = 0 then
    return jsonb_build_object(
      'status', 'no_data', 'query', p_query, 'normalized', v_q,
      'match_count', 0, 'top_score', null, 'matches', '[]'::jsonb,
      'screened_at', now()
    );
  end if;

  with scored as (
    select e.id, e.name, e.source, e.entity_type, e.programs, e.countries,
           e.aliases, e.addresses, e.remarks,
           greatest(
             similarity(e.norm_name, v_q),
             coalesce((select max(similarity(a, v_q)) from unnest(e.norm_aliases) a), 0)
           ) as score
    from sanctions_entities e
    where v_q <% e.search_text         -- trigram index does the heavy filtering
  )
  select coalesce(jsonb_agg(to_jsonb(s) order by s.score desc), '[]'::jsonb), count(*), max(s.score)
    into v_matches, v_count, v_top
  from (select * from scored where score >= p_threshold order by score desc limit 25) s;

  v_status := case when v_count > 0 then 'review' else 'clear' end;

  insert into sanctions_screenings (workspace_id, object_type, record_id, query, match_count, top_score, status, matches, screened_by)
  values (p_workspace, nullif(p_object, ''), p_record, p_query, v_count, round(coalesce(v_top, 0), 3), v_status, v_matches, p_privy);

  return jsonb_build_object(
    'status', v_status, 'query', p_query, 'normalized', v_q,
    'match_count', v_count, 'top_score', round(coalesce(v_top, 0), 3),
    'matches', v_matches, 'screened_at', now()
  );
end $$;

-- Latest screening per record, so a list can show badges without re-screening.
create or replace function get_sanctions_screenings(p_privy text, p_workspace uuid, p_record uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.screened_at desc) from (
      select distinct on (s.record_id, s.query)
             s.id, s.object_type, s.record_id, s.query, s.match_count,
             s.top_score, s.status, s.matches, s.screened_at
      from sanctions_screenings s
      where s.workspace_id = p_workspace
        and (p_record is null or s.record_id = p_record)
      order by s.record_id, s.query, s.screened_at desc
    ) x
  ), '[]'::jsonb);
end $$;

-- List freshness + size, for the "last updated" line next to the button.
create or replace function get_sanctions_status(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return jsonb_build_object(
    'total', (select count(*) from sanctions_entities),
    'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.source) from (
        select source, label, url, entity_count, synced_at, last_error from sanctions_sources
      ) s), '[]'::jsonb)
  );
end $$;

-- Called by /api/sanctions/refresh (service_role) after a successful ingest.
create or replace function record_sanctions_sync(p_source text, p_count int, p_error text default null)
returns void language sql security definer set search_path = public as $$
  insert into sanctions_sources (source, label, entity_count, synced_at, last_error)
  values (p_source, p_source, coalesce(p_count, 0), now(), nullif(p_error, ''))
  on conflict (source) do update set
    entity_count = excluded.entity_count,
    synced_at    = excluded.synced_at,
    last_error   = excluded.last_error;
$$;

revoke all on function sanctions_normalize(text)                                   from public, anon, authenticated;
revoke all on function screen_sanctions(text, uuid, text, text, uuid, numeric)     from public, anon, authenticated;
revoke all on function get_sanctions_screenings(text, uuid, uuid)                  from public, anon, authenticated;
revoke all on function get_sanctions_status(text, uuid)                            from public, anon, authenticated;
revoke all on function record_sanctions_sync(text, int, text)                      from public, anon, authenticated;
grant execute on function sanctions_normalize(text)                                to service_role;
grant execute on function screen_sanctions(text, uuid, text, text, uuid, numeric)  to service_role;
grant execute on function get_sanctions_screenings(text, uuid, uuid)               to service_role;
grant execute on function get_sanctions_status(text, uuid)                         to service_role;
grant execute on function record_sanctions_sync(text, int, text)                   to service_role;

notify pgrst, 'reload schema';
