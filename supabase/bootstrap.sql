-- ============================================================================
-- RunButter — bootstrap.sql
-- The Supabase-shaped prerequisites, for a database that is not Supabase.
--
-- WHY. The schema was written against a hosted Supabase project, so it assumes
-- three things exist before anything else runs: the `anon` / `authenticated` /
-- `service_role` roles, an `auth` schema with `auth.uid()`, and a `storage`
-- schema with `buckets` and `objects`. On a plain Postgres — a docker
-- container, a local install, a managed instance somewhere else — none of them
-- do, and the very first legacy file fails on `storage.objects`.
--
-- ON A REAL SUPABASE PROJECT THIS IS A NO-OP. Every statement is guarded, so
-- running it against a hosted project changes nothing and overwrites nothing.
-- That is the point: one bootstrap, both worlds, no branching in the runner.
--
-- WHAT THIS IS NOT: an implementation of Supabase. `auth.uid()` returns null
-- and `storage` is a pair of tables with no API behind them. That is enough for
-- the schema to BUILD, which is all a migration needs. Serving files still
-- needs a real storage service — docker-compose.yml runs the actual
-- supabase/storage-api against these tables, which is why the shapes below
-- match its expectations rather than being invented.
--
-- Applied automatically and first by scripts/migrate.mjs. Idempotent.
-- ============================================================================

-- ── Roles ───────────────────────────────────────────────────────────────────
-- Every migration ends with grants to these. Postgres has no `create role if
-- not exists`, hence the DO blocks.
do $$ begin create role anon nologin noinherit;           exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit;  exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end $$;

-- PostgREST switches to these from the connecting user, so it has to be allowed
-- to. Skipped when the current user is not a superuser — on Supabase this is
-- already configured and the grant would fail.
do $$
begin
  if (select usesuper from pg_user where usename = current_user) then
    execute format('grant anon, authenticated, service_role to %I', current_user);
  end if;
exception when others then null;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- ── auth ────────────────────────────────────────────────────────────────────
-- This product authenticates with PRIVY, not Supabase Auth — identity arrives
-- as `p_privy text` through the /api/rpc proxy. `auth.uid()` exists only
-- because older RLS policies reference it; returning null is correct here,
-- since those policies should never be the thing granting access.
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

-- A stub, referenced once by a legacy foreign key. Never populated: people live
-- in `accounts`, keyed by Privy DID.
create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- ── storage ─────────────────────────────────────────────────────────────────
-- Shapes match supabase/storage-api, so the real service can be pointed at
-- these tables unchanged. Only the columns the schema and the API actually
-- touch are here.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets(id),
  name             text,
  owner            uuid,
  metadata         jsonb,
  path_tokens      text[] generated always as (string_to_array(name, '/')) stored,
  version          text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now()
);
create unique index if not exists bucketid_objname on storage.objects(bucket_id, name);
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

-- Used by the legacy storage policies to test the first path segment. Same
-- semantics as Supabase's: everything except the final filename.
create or replace function storage.foldername(name text)
returns text[] language plpgsql immutable as $$
declare parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end $$;

create or replace function storage.filename(name text)
returns text language plpgsql immutable as $$
declare parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[array_length(parts, 1)];
end $$;

create or replace function storage.extension(name text)
returns text language plpgsql immutable as $$
declare parts text[];
begin
  parts := string_to_array(storage.filename(name), '.');
  return parts[array_length(parts, 1)];
end $$;

grant all on all tables in schema storage to service_role;
grant select on all tables in schema storage to anon, authenticated;

-- ── Extensions ──────────────────────────────────────────────────────────────
-- pgcrypto for gen_random_uuid(); pg_trgm for the sanctions matcher (0058);
-- unaccent for the transliteration sanctions_normalize() depends on.
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- PostgREST reloads its schema cache on this. Harmless without it.
do $$ begin notify pgrst, 'reload schema'; exception when others then null; end $$;
