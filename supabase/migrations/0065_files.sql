-- ============================================================================
-- RunButter — 0065_files.sql
-- Company files that become DATA, not just storage.
--
-- The point is not a file manager — Dropbox exists. The point is that a contract
-- dropped here is extracted to text, indexed with Postgres FTS, and ATTACHED to
-- a record (a company, an invoice, a candidate). Because everything already
-- lives in one Postgres, "find every contract mentioning auto-renewal, for
-- clients who owe us money" becomes a single join. No external file service can
-- answer that, because it cannot see the ledger.
--
-- EXTRACTION IS PLUGGABLE AND OPTIONAL:
--   • PDFs with a text layer are handled locally by pdf-parse — free, no service.
--   • Scans and photos need OCR. That's MinerU (self-hosted, optional) or a
--     vision model on the workspace's own AI key. Neither is required to store
--     a file; `extract_status` records which path ran, or that none did.
-- Nothing here calls a metered API, consistent with the cost rule.
--
-- Text search is a stored tsvector kept by trigger rather than an expression
-- index, because extraction happens AFTER the row is created (upload first,
-- parse second) and a trigger updates the vector on that later write for free.
-- Depends on 0001 (workspaces).
-- ============================================================================

create table if not exists files (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  name           text not null,
  -- Path inside the private storage bucket. Not a public URL: these are
  -- contracts and payroll, so they are served through a signed URL on demand.
  storage_path    text not null,
  mime_type      text,
  size_bytes     bigint,
  -- Optional attachment to any record, kept loose on purpose: the CRUD monolith
  -- spans a dozen tables and a real FK would need one column per object.
  -- Integrity is enforced by the RPCs, which resolve the record first.
  linked_object  text,
  linked_id      uuid,
  -- Extracted plain text / Markdown.
  content        text,
  extract_status text not null default 'pending'
                 check (extract_status in ('pending','text_layer','ocr','vision','failed','skipped')),
  extract_error  text,
  page_count     int,
  search_vector  tsvector,
  uploaded_by    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_files_ws on files(workspace_id, created_at desc);
create index if not exists idx_files_linked on files(workspace_id, linked_object, linked_id)
  where linked_id is not null;
create index if not exists idx_files_search on files using gin (search_vector);

alter table files enable row level security;
revoke all on table files from anon, authenticated;

-- 'simple' rather than 'english': these documents are Polish, German and English
-- in the same workspace, and an English stemmer mangles the others. Exact-ish
-- token matching across languages beats good stemming in one.
create or replace function files_search_vector() returns trigger
language plpgsql set search_path = public as $$
begin
  new.search_vector :=
    setweight(to_tsvector('simple', coalesce(new.name, '')), 'A') ||
    setweight(to_tsvector('simple', left(coalesce(new.content, ''), 900000)), 'B');
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_files_search on files;
create trigger trg_files_search
  before insert or update of name, content on files
  for each row execute function files_search_vector();

-- ── RPCs ────────────────────────────────────────────────────────────────────
create or replace function create_file(
  p_privy text, p_workspace uuid, p_name text, p_path text,
  p_mime text default null, p_size bigint default null,
  p_object text default null, p_linked uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_path), '') = '' then
    raise exception 'NAME_AND_PATH_REQUIRED';
  end if;
  insert into files (workspace_id, name, storage_path, mime_type, size_bytes,
                     linked_object, linked_id, uploaded_by)
  values (p_workspace, p_name, p_path, nullif(p_mime,''), p_size,
          nullif(p_object,''), p_linked, p_privy)
  returning id into v_id;
  return v_id;
end $$;

-- Called by the extraction route once text is available. Separate from creation
-- because upload succeeds immediately and parsing may take seconds (or fail).
create or replace function set_file_content(
  p_privy text, p_file uuid, p_content text, p_status text,
  p_pages int default null, p_error text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from files where id = p_file;
  if v_ws is null or not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
  if coalesce(p_status,'') not in ('pending','text_layer','ocr','vision','failed','skipped') then
    raise exception 'BAD_STATUS';
  end if;
  update files set
    content        = case when p_status = 'failed' then content else p_content end,
    extract_status = p_status,
    extract_error  = nullif(p_error, ''),
    page_count     = coalesce(p_pages, page_count)
  where id = p_file;
  return true;
end $$;

create or replace function get_files(
  p_privy text, p_workspace uuid, p_object text default null,
  p_linked uuid default null, p_limit int default 200
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select id, name, storage_path, mime_type, size_bytes, linked_object, linked_id,
           extract_status, extract_error, page_count, created_at,
           -- The body can be megabytes; a list view only needs to know whether
           -- there IS text and roughly how much.
           (content is not null and content <> '') as has_content,
           length(coalesce(content, '')) as content_length
    from files
    where workspace_id = p_workspace
      and (p_object is null or linked_object = p_object)
      and (p_linked is null or linked_id = p_linked)
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) x), '[]'::jsonb);
end $$;

create or replace function get_file(p_privy text, p_file uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_out jsonb;
begin
  select workspace_id into v_ws from files where id = p_file;
  if v_ws is null or not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
  select to_jsonb(f) into v_out from (
    select id, workspace_id, name, storage_path, mime_type, size_bytes,
           linked_object, linked_id, content, extract_status, extract_error,
           page_count, created_at
    from files where id = p_file
  ) f;
  return v_out;
end $$;

/**
 * Full-text search across file contents.
 *
 * websearch_to_tsquery, not plainto_tsquery: it understands quoted phrases and
 * OR, which is what someone typing into a search box actually expects, and it
 * never throws on odd punctuation the way to_tsquery does.
 */
create or replace function search_files(p_privy text, p_workspace uuid, p_query text, p_limit int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_q tsquery;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  if coalesce(trim(p_query), '') = '' then return '[]'::jsonb; end if;
  v_q := websearch_to_tsquery('simple', p_query);

  return coalesce((select jsonb_agg(to_jsonb(x) order by x.rank desc) from (
    select f.id, f.name, f.linked_object, f.linked_id, f.extract_status, f.created_at,
           ts_rank(f.search_vector, v_q) as rank,
           ts_headline('simple', coalesce(f.content, ''), v_q,
                       'MaxFragments=2,MinWords=5,MaxWords=18,StartSel=«,StopSel=»') as snippet
    from files f
    where f.workspace_id = p_workspace and f.search_vector @@ v_q
    order by rank desc
    limit greatest(1, least(coalesce(p_limit, 30), 100))
  ) x), '[]'::jsonb);
end $$;

create or replace function delete_file(p_privy text, p_file uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_path text;
begin
  select workspace_id, storage_path into v_ws, v_path from files where id = p_file;
  if v_ws is null or not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_FOUND_OR_FORBIDDEN'; end if;
  delete from files where id = p_file;
  -- Hand the path back so the caller can remove the object from storage too;
  -- deleting the row alone would orphan the blob and keep billing for it.
  return jsonb_build_object('ok', true, 'storage_path', v_path);
end $$;

revoke all on function create_file(text, uuid, text, text, text, bigint, text, uuid)  from public, anon, authenticated;
revoke all on function set_file_content(text, uuid, text, text, int, text)            from public, anon, authenticated;
revoke all on function get_files(text, uuid, text, uuid, int)                         from public, anon, authenticated;
revoke all on function get_file(text, uuid)                                           from public, anon, authenticated;
revoke all on function search_files(text, uuid, text, int)                            from public, anon, authenticated;
revoke all on function delete_file(text, uuid)                                        from public, anon, authenticated;
grant execute on function create_file(text, uuid, text, text, text, bigint, text, uuid) to service_role;
grant execute on function set_file_content(text, uuid, text, text, int, text)           to service_role;
grant execute on function get_files(text, uuid, text, uuid, int)                        to service_role;
grant execute on function get_file(text, uuid)                                          to service_role;
grant execute on function search_files(text, uuid, text, int)                           to service_role;
grant execute on function delete_file(text, uuid)                                       to service_role;

notify pgrst, 'reload schema';
