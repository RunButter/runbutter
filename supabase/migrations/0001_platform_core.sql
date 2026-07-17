-- ============================================================================
-- RunButter Platform Core — 0001_platform_core.sql
-- Universal relational foundation for the CRM / Business-OS pivot.
--
-- Run on a BRANCH / staging Supabase DB (NOT prod live). Deny-by-default RLS;
-- all access goes through SECURITY DEFINER RPCs that take p_privy_user_id and
-- verify workspace membership (matches the existing Privy auth pattern, and
-- closes the multi-tenant read hole the legacy tables currently have).
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- 1. WORKSPACES — tenant root --------------------------------------------------
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  plan text not null default 'free',
  logo_url text,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_workspaces_upd on workspaces;
create trigger trg_workspaces_upd before update on workspaces for each row execute function set_updated_at();

-- 2. ACCOUNTS — internal user seats (Privy logins) -----------------------------
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  privy_user_id text not null,
  email text, full_name text, avatar_url text,
  role text not null default 'member',          -- owner | admin | member
  created_at timestamptz not null default now(),
  unique (workspace_id, privy_user_id)
);
create index if not exists idx_accounts_privy on accounts(privy_user_id);

create or replace function is_workspace_member(p_workspace uuid, p_privy text)
returns boolean language sql stable as $$
  select exists (select 1 from accounts a
                 where a.workspace_id = p_workspace and a.privy_user_id = p_privy);
$$;

-- 3. CRM ORGANIZATIONS — deferred to the Sales module (0004).
-- The existing prod DB already has a `companies` table (the TENANT), so we must
-- NOT create a colliding CRM `companies` table here. The universal CRM org
-- entity ships with Sales as `organizations`; recruitment needs only
-- people + pipelines + psychometrics, keeping these migrations purely additive.

-- 4. PEOPLE — universal person entity (contacts, candidates, employees) --------
create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  primary_company_id uuid,                 -- FK added with CRM organizations (Sales module)
  first_name text, last_name text, email text, phone text, title text,
  source text, linkedin_url text, avatar_url text,
  resume_raw_text text,                 -- zero-cost FTS source (pdf-parse/mammoth)
  resume_parsed_at timestamptz,
  custom_fields jsonb not null default '{}',
  search_tsv tsvector generated always as (
    to_tsvector('english',
      coalesce(first_name,'')||' '||coalesce(last_name,'')||' '||coalesce(title,'')||' '||
      coalesce(email,'')||' '||coalesce(resume_raw_text,''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_people_ws      on people(workspace_id);
create index if not exists idx_people_company on people(primary_company_id);
create index if not exists idx_people_tsv     on people using gin(search_tsv);   -- <5ms boolean search
drop trigger if exists trg_people_upd on people;
create trigger trg_people_upd before update on people for each row execute function set_updated_at();

-- 5. PIPELINES + STAGES — configurable, multi-purpose workflows ----------------
create table if not exists pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  kind text not null default 'custom',          -- sales | recruitment | hris | custom
  target text not null default 'person',        -- person | company
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_pipelines_ws on pipelines(workspace_id);

create table if not exists pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references pipelines(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,  -- denormalized for RLS
  name text not null,
  color text not null default '#64748b',
  position int not null default 0,
  stage_type text not null default 'open',      -- open | won | lost
  created_at timestamptz not null default now()
);
create index if not exists idx_stages_pipeline on pipeline_stages(pipeline_id, position);

-- 6. PIPELINE_RECORDS — relational connector: one entity → many pipelines ------
create table if not exists pipeline_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  pipeline_id uuid not null references pipelines(id) on delete cascade,
  stage_id uuid not null references pipeline_stages(id) on delete restrict,
  person_id uuid references people(id) on delete cascade,
  company_id uuid,                               -- CRM org link (Sales module)
  owner_account_id uuid references accounts(id) on delete set null,
  title text, amount numeric(14,2), currency text default 'USD',
  status text not null default 'active',         -- active | won | lost
  position double precision not null default 0,  -- cheap drag-reordering
  entered_stage_at timestamptz not null default now(),
  custom_fields jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_record_subject check (person_id is not null or company_id is not null)
);
create index if not exists idx_records_board   on pipeline_records(pipeline_id, stage_id, position);
create index if not exists idx_records_person  on pipeline_records(person_id);
create index if not exists idx_records_company on pipeline_records(company_id);
drop trigger if exists trg_records_upd on pipeline_records;
create trigger trg_records_upd before update on pipeline_records for each row execute function set_updated_at();

create or replace function stamp_stage_change() returns trigger language plpgsql as $$
begin if new.stage_id is distinct from old.stage_id then new.entered_stage_at = now(); end if; return new; end $$;
drop trigger if exists trg_records_stage on pipeline_records;
create trigger trg_records_stage before update on pipeline_records for each row execute function stamp_stage_change();

-- 7. PSYCHOMETRICS — per-person; discrete int columns + raw jsonb --------------
create table if not exists psychometrics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  overall int, logic int, stress_resistance int, empathy int,
  openness int, conscientiousness int, extraversion int, agreeableness int, neuroticism int,
  raw jsonb not null default '{}',
  assessed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_psych_person on psychometrics(person_id, assessed_at desc);

-- 8. ASSETS — IT / equipment inventory (HRIS module) --------------------------
create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  category text not null default 'other',        -- laptop | monitor | phone | license | other
  serial_number text,
  status text not null default 'available',      -- available | assigned | repair | retired
  assigned_to_person_id uuid references people(id) on delete set null,
  purchased_at date, value numeric(12,2), notes text,
  custom_fields jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_assets_ws       on assets(workspace_id);
create index if not exists idx_assets_assignee on assets(assigned_to_person_id);
drop trigger if exists trg_assets_upd on assets;
create trigger trg_assets_upd before update on assets for each row execute function set_updated_at();

-- 9. OBJECT_FIELDS — lightweight extensibility (renders custom_fields jsonb) ---
create table if not exists object_fields (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  object_type text not null,                     -- person | company | pipeline_record | asset
  field_key text not null,
  label text not null,
  data_type text not null default 'text',        -- text|number|select|date|boolean|relation
  options jsonb not null default '{}',
  position int not null default 0,
  unique (workspace_id, object_type, field_key)
);

-- 10. RLS — enable (NOT force) so SECURITY DEFINER RPCs work; no permissive
-- policies ⇒ anon/authenticated get zero direct table access. All I/O via RPCs.
do $$ declare t text; begin
  foreach t in array array['workspaces','accounts','people','pipelines',
    'pipeline_stages','pipeline_records','psychometrics','assets','object_fields'] loop
    execute format('alter table %I enable row level security;', t);
  end loop; end $$;

-- 11. Example RPC — zero-cost boolean resume search (the access pattern) --------
-- websearch_to_tsquery gives `React Node -Junior "node.js"` syntax for free.
create or replace function search_people(p_privy text, p_workspace uuid, p_query text)
returns setof people language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return query
    select * from people p
    where p.workspace_id = p_workspace
      and (coalesce(p_query,'') = '' or p.search_tsv @@ websearch_to_tsquery('english', p_query))
    order by case when coalesce(p_query,'')='' then 0
                  else ts_rank(p.search_tsv, websearch_to_tsquery('english', p_query)) end desc,
             p.created_at desc
    limit 200;
end $$;
grant execute on function search_people(text, uuid, text) to authenticated, anon;

notify pgrst, 'reload schema';
