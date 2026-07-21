-- ============================================================================
-- RunButter — 0053_sign.sql
-- Lightweight e-signature ("DocSign"). Send a PDF to one or more people, each
-- signs via a single-use tokenised link, and once everyone has signed we stamp
-- a signature certificate onto the document and email the signed copy back.
--
-- Deliberately NOT a clone of Documenso / DocuSeal (both AGPL — incompatible
-- with this MIT repo). The PDF work uses pdf-lib (MIT) server-side and the
-- signature canvas uses signature_pad (MIT); everything else reuses primitives
-- we already have (private storage, Resend, tokenised public pages).
--
-- Not eIDAS "qualified" signatures — it is an advanced e-signature: identity by
-- emailed link, intent captured explicitly, plus an audit trail (who / when /
-- from what IP) and a SHA-256 of the final document for tamper evidence.
--
-- All RPCs SECURITY DEFINER + service_role-only (0046 posture). Recipient-facing
-- ones are gated by an unguessable token, not a session. Depends on 0012.
-- ============================================================================

create table if not exists sign_documents (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title        text not null default 'Document',
  storage_path text not null,                 -- original PDF, private 'documents' bucket
  signed_path  text,                          -- final stamped PDF once complete
  signed_hash  text,                          -- sha256 of the signed PDF (tamper evidence)
  status       text not null default 'sent' check (status in ('draft','sent','signed','declined','voided')),
  source_kind  text default 'upload',         -- upload | invoice | offer (future linking)
  source_id    uuid,
  created_by   text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  completed_at timestamptz
);
create index if not exists idx_sign_documents_ws on sign_documents(workspace_id);
alter table sign_documents enable row level security;
revoke all on table sign_documents from anon, authenticated;

create table if not exists sign_recipients (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references sign_documents(id) on delete cascade,
  name           text not null,
  email          text not null,
  sign_token     uuid not null default gen_random_uuid(),
  status         text not null default 'pending' check (status in ('pending','signed','declined')),
  signature_type text,                         -- drawn | typed
  signature_data text,                         -- PNG data URL (drawn) or the typed name
  signed_at      timestamptz,
  ip             text,
  user_agent     text,
  sort           int default 0
);
create unique index if not exists idx_sign_recipients_token on sign_recipients(sign_token);
create index if not exists idx_sign_recipients_doc on sign_recipients(document_id);
alter table sign_recipients enable row level security;
revoke all on table sign_recipients from anon, authenticated;

-- ── Recruiter/owner side (workspace-scoped) ─────────────────────────────────
create or replace function get_sign_documents(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', d.id, 'title', d.title, 'status', d.status,
    'created_at', d.created_at, 'completed_at', d.completed_at,
    'signed', (select count(*) from sign_recipients r where r.document_id = d.id and r.status = 'signed'),
    'total', (select count(*) from sign_recipients r where r.document_id = d.id),
    'recipients', coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'email', r.email, 'status', r.status) order by r.sort)
                            from sign_recipients r where r.document_id = d.id), '[]'::jsonb)
  ) order by d.created_at desc) from sign_documents d where d.workspace_id = p_workspace), '[]'::jsonb);
end $$;

create or replace function create_sign_document(
  p_privy text, p_workspace uuid, p_title text, p_storage_path text,
  p_source_kind text, p_source_id uuid, p_recipients jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text; v_id uuid; v_rec jsonb; i int := 0; v_out jsonb := '[]'::jsonb; v_token uuid;
begin
  v_role := workspace_role(p_privy, p_workspace);
  if v_role is null or v_role not in ('owner','admin','member','recruiter') then raise exception 'FORBIDDEN'; end if;
  if coalesce(p_storage_path,'') = '' then raise exception 'NO_DOCUMENT'; end if;
  if jsonb_typeof(p_recipients) <> 'array' or jsonb_array_length(p_recipients) = 0 then raise exception 'NO_RECIPIENTS'; end if;

  insert into sign_documents (workspace_id, title, storage_path, source_kind, source_id, created_by, status)
  values (p_workspace, coalesce(nullif(p_title,''),'Document'), p_storage_path,
          coalesce(nullif(p_source_kind,''),'upload'), p_source_id, p_privy, 'sent')
  returning id into v_id;

  for v_rec in select * from jsonb_array_elements(p_recipients) loop
    if coalesce(v_rec->>'email','') = '' then continue; end if;
    v_token := gen_random_uuid();
    insert into sign_recipients (document_id, name, email, sign_token, sort)
    values (v_id, coalesce(nullif(v_rec->>'name',''), v_rec->>'email'),
            lower(trim(v_rec->>'email')), v_token, i);
    v_out := v_out || jsonb_build_object(
      'name', coalesce(nullif(v_rec->>'name',''), v_rec->>'email'),
      'email', lower(trim(v_rec->>'email')), 'token', v_token);
    i := i + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'recipients', v_out);
end $$;

create or replace function void_sign_document(p_privy text, p_workspace uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_role text; v_n int;
begin
  v_role := workspace_role(p_privy, p_workspace);
  if v_role is null or v_role not in ('owner','admin','member','recruiter') then raise exception 'FORBIDDEN'; end if;
  update sign_documents set status = 'voided', updated_at = now()
   where id = p_id and workspace_id = p_workspace and status <> 'signed';
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- Paths for the authenticated download route.
create or replace function get_sign_document_file(p_privy text, p_workspace uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  select jsonb_build_object('title', d.title, 'status', d.status,
           'storage_path', d.storage_path, 'signed_path', d.signed_path)
    into v from sign_documents d where d.id = p_id and d.workspace_id = p_workspace;
  return v;
end $$;

-- ── Signer side (token-gated, no session) ───────────────────────────────────
create or replace function get_sign_request(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if p_token is null then return null; end if;
  select jsonb_build_object(
    'document_id', d.id, 'title', d.title, 'storage_path', d.storage_path,
    'doc_status', d.status, 'signer_name', r.name, 'signer_email', r.email,
    'already_signed', (r.status = 'signed')
  ) into v
  from sign_recipients r join sign_documents d on d.id = r.document_id
  where r.sign_token = p_token;
  return v;  -- null for an unknown token
end $$;

-- Records one signature. When it completes the document, returns everything the
-- route needs to build the certificate page + notify everyone.
create or replace function record_signature(
  p_token uuid, p_type text, p_data text, p_ip text, p_ua text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_doc uuid; v_status text; v_rid uuid; v_pending int;
begin
  select r.id, r.document_id, d.status into v_rid, v_doc, v_status
  from sign_recipients r join sign_documents d on d.id = r.document_id
  where r.sign_token = p_token and r.status = 'pending'
  for update;

  if v_rid is null then return jsonb_build_object('ok', false, 'reason', 'invalid_or_signed'); end if;
  if v_status in ('voided','declined') then return jsonb_build_object('ok', false, 'reason', 'no_longer_active'); end if;

  update sign_recipients
     set status = 'signed', signature_type = nullif(p_type,''), signature_data = p_data,
         signed_at = now(), ip = nullif(p_ip,''), user_agent = left(coalesce(p_ua,''), 400)
   where id = v_rid;

  select count(*) into v_pending from sign_recipients where document_id = v_doc and status = 'pending';

  if v_pending > 0 then
    return jsonb_build_object('ok', true, 'complete', false);
  end if;

  -- Everyone has signed: hand the route the full signature set + the original.
  return jsonb_build_object(
    'ok', true, 'complete', true, 'document_id', v_doc,
    'title', (select title from sign_documents where id = v_doc),
    'storage_path', (select storage_path from sign_documents where id = v_doc),
    'signers', (select jsonb_agg(jsonb_build_object(
        'name', name, 'email', email, 'type', signature_type,
        'data', signature_data, 'signed_at', signed_at, 'ip', ip) order by sort)
      from sign_recipients where document_id = v_doc)
  );
end $$;

-- Called by the route after it builds + stores the stamped PDF.
create or replace function finalize_sign_document(p_document_id uuid, p_signed_path text, p_signed_hash text)
returns void language sql security definer set search_path = public as $$
  update sign_documents
     set status = 'signed', signed_path = p_signed_path, signed_hash = p_signed_hash,
         completed_at = now(), updated_at = now()
   where id = p_document_id;
$$;

-- ── Grants (0046 posture) ───────────────────────────────────────────────────
revoke all on function get_sign_documents(text, uuid)                                   from public, anon, authenticated;
revoke all on function create_sign_document(text, uuid, text, text, text, uuid, jsonb)  from public, anon, authenticated;
revoke all on function void_sign_document(text, uuid, uuid)                             from public, anon, authenticated;
revoke all on function get_sign_document_file(text, uuid, uuid)                         from public, anon, authenticated;
revoke all on function get_sign_request(uuid)                                           from public, anon, authenticated;
revoke all on function record_signature(uuid, text, text, text, text)                   from public, anon, authenticated;
revoke all on function finalize_sign_document(uuid, text, text)                         from public, anon, authenticated;
grant execute on function get_sign_documents(text, uuid)                                   to service_role;
grant execute on function create_sign_document(text, uuid, text, text, text, uuid, jsonb)  to service_role;
grant execute on function void_sign_document(text, uuid, uuid)                             to service_role;
grant execute on function get_sign_document_file(text, uuid, uuid)                         to service_role;
grant execute on function get_sign_request(uuid)                                           to service_role;
grant execute on function record_signature(uuid, text, text, text, text)                   to service_role;
grant execute on function finalize_sign_document(uuid, text, text)                         to service_role;

notify pgrst, 'reload schema';
