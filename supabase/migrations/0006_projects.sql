-- ============================================================================
-- HireBTR Platform Core — 0006_projects.sql
-- Plane-style Project Management: projects + issues (board reuses the existing
-- kanban engine). Additive & prod-safe. Depends on 0001–0005.
-- ============================================================================

-- 1. PROJECTS
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  identifier text,                       -- short code, e.g. LAUNCH
  description text,
  color text not null default '#6366f1',
  lead_account_id uuid references accounts(id) on delete set null,
  status text not null default 'active', -- active | paused | completed | cancelled
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_projects_ws on projects(workspace_id);
create trigger trg_projects_upd before update on projects for each row execute function set_updated_at();

-- 2. ISSUES (tasks)
create table if not exists issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'backlog',  -- backlog | todo | in_progress | done | cancelled
  priority text not null default 'none',   -- none | low | medium | high | urgent
  assignee_account_id uuid references accounts(id) on delete set null,
  sort_order double precision not null default 0,
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_issues_ws on issues(workspace_id);
create index if not exists idx_issues_project on issues(project_id, status, sort_order);
create trigger trg_issues_upd before update on issues for each row execute function set_updated_at();

-- 3. RLS
do $$ declare t text; begin
  foreach t in array array['projects','issues'] loop
    execute format('alter table %I enable row level security;', t);
  end loop; end $$;

-- 4. move an issue between states (drag-and-drop persistence)
create or replace function move_issue(p_privy text, p_issue uuid, p_status text, p_sort double precision)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  select workspace_id into v_ws from issues where id = p_issue;
  if v_ws is null then raise exception 'ISSUE_NOT_FOUND'; end if;
  if not is_workspace_member(v_ws, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  update issues set status = p_status, sort_order = p_sort where id = p_issue;
end $$;
grant execute on function move_issue(text, uuid, text, double precision) to authenticated, anon;

-- 5. extend list_records for projects + issues (full redefinition)
create or replace function list_records(p_privy text, p_workspace uuid, p_object text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;

  if p_object = 'people' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', pe.id, 'name', trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,'')),
      'title', pe.title, 'company', co.name, 'email', pe.email, 'source', pe.source,
      'synergy', (select ps.overall from psychometrics ps where ps.person_id=pe.id order by ps.assessed_at desc limit 1)
    ) order by pe.created_at desc)
    from people pe left join organizations co on co.id = pe.primary_company_id
    where pe.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object in ('companies','organizations') then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'domain', o.domain, 'industry', o.industry, 'employee_count', o.employee_count
    ) order by o.created_at desc) from organizations o where o.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'invoices' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'number', i.number, 'company', o.name, 'amount', i.amount, 'status', i.status, 'due_at', i.due_at
    ) order by i.created_at desc)
    from invoices i left join organizations o on o.id = i.organization_id
    where i.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'expenses' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'vendor', e.vendor, 'category', e.category, 'amount', e.amount, 'status', e.status, 'spent_at', e.spent_at
    ) order by e.created_at desc) from expenses e where e.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'projects' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', pr.id, 'name', pr.name, 'identifier', pr.identifier, 'status', pr.status,
      'issues', (select count(*) from issues i where i.project_id = pr.id)
    ) order by pr.created_at desc) from projects pr where pr.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'issues' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'name', i.title, 'project', pr.name, 'status', i.status,
      'priority', i.priority, 'due_date', i.due_date,
      'assignee', (select a.full_name from accounts a where a.id = i.assignee_account_id)
    ) order by i.sort_order)
    from issues i left join projects pr on pr.id = i.project_id
    where i.workspace_id=p_workspace), '[]'::jsonb);

  elsif p_object = 'assets' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'name', a.name, 'category', a.category, 'serial_number', a.serial_number, 'status', a.status,
      'assigned_to', (select trim(coalesce(pe.first_name,'')||' '||coalesce(pe.last_name,'')) from people pe where pe.id=a.assigned_to_person_id)
    ) order by a.created_at desc) from assets a where a.workspace_id=p_workspace), '[]'::jsonb);
  end if;
  return '[]'::jsonb;
end $$;
grant execute on function list_records(text, uuid, text) to authenticated, anon;

-- 6. demo seed (single-row RETURNING INTO is fine; only multi-row is not)
do $$
declare w record; v_proj uuid;
begin
  for w in select id from workspaces loop
    if not exists (select 1 from projects where workspace_id = w.id) then
      insert into projects (workspace_id, name, identifier, status)
        values (w.id, 'Platform Launch', 'LAUNCH', 'active')
        returning id into v_proj;
      insert into issues (workspace_id, project_id, title, status, priority, sort_order) values
        (w.id, v_proj, 'Design landing page',      'in_progress', 'high',   0),
        (w.id, v_proj, 'Wire Stripe billing',      'todo',        'urgent', 1),
        (w.id, v_proj, 'Set up CI/CD pipeline',    'done',        'medium', 2),
        (w.id, v_proj, 'Write API documentation',  'backlog',     'low',    3),
        (w.id, v_proj, 'Run customer interviews',  'todo',        'medium', 4),
        (w.id, v_proj, 'Launch on Product Hunt',   'backlog',     'high',   5);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
