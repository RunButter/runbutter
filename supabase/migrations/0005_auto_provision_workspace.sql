-- ============================================================================
-- HireBTR Platform Core — 0005_auto_provision_workspace.sql
-- Make the platform work for NEW customers automatically. The 0003 bridge was a
-- one-time backfill; these triggers keep the platform in sync going forward:
--   new tenant company  -> workspace (+ default pipelines)
--   new company_user    -> account
-- Trigger bodies are exception-safe: a sync failure can NEVER block signup.
-- Depends on 0001–0004. Run AFTER them.
-- ============================================================================

-- tenant company -> workspace (+ seed pipelines)
create or replace function sync_company_to_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into workspaces (id, name, slug, plan, created_at)
    values (new.id, new.name,
            coalesce(nullif(new.subdomain,''), 'ws-' || left(new.id::text, 8)),
            coalesce(new.plan, 'free'), coalesce(new.created_at, now()))
    on conflict (id) do nothing;
    perform seed_default_pipelines(new.id);
  exception when others then
    null;  -- best-effort; never block tenant creation
  end;
  return new;
end $$;

drop trigger if exists trg_company_to_workspace on companies;
create trigger trg_company_to_workspace after insert on companies
  for each row execute function sync_company_to_workspace();

-- company_user -> account (the workspace exists by now: companies trigger ran first)
create or replace function sync_company_user_to_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.privy_user_id is not null then
      insert into accounts (workspace_id, privy_user_id, email, full_name, role, created_at)
      values (new.company_id, new.privy_user_id, new.email, new.full_name,
              coalesce(new.role, 'member'), coalesce(new.created_at, now()))
      on conflict (workspace_id, privy_user_id) do nothing;
    end if;
  exception when others then
    null;  -- best-effort; never block user creation
  end;
  return new;
end $$;

drop trigger if exists trg_company_user_to_account on company_users;
create trigger trg_company_user_to_account after insert on company_users
  for each row execute function sync_company_user_to_account();

notify pgrst, 'reload schema';
