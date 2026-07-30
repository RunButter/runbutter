-- ============================================================================
-- RunButter — 0064_invoice_reminders.sql
-- Mark invoices overdue, and chase them.
--
-- `overdue` has been a valid invoice status since 0015 and is read by
-- get_finance_summary — but nothing in the product ever SET it, and no reminder
-- was ever sent. An invoice went out and then sat there. This is the feature
-- that turns an invoicing screen into something that actually collects money.
--
-- SENDING EMAIL TO A CUSTOMER'S CUSTOMER IS THE RISK HERE, so the defaults are
-- deliberately timid:
--   • disabled per workspace until someone turns it on — nobody gets chased
--     because they upgraded
--   • every send is logged and the log is UNIQUE per (invoice, stage), so a
--     retried cron or a double-click cannot mail the same person twice
--   • only 'income' invoices are chased. Chasing a bill you owe would be
--     nonsense, and the direction column already distinguishes them
--   • a per-run cap, so a misconfigured schedule can't blast a whole ledger
-- Depends on 0015 (invoices) + 0025 (share links).
-- ============================================================================

-- ── Per-workspace configuration ─────────────────────────────────────────────
create table if not exists invoice_reminder_settings (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  enabled      boolean not null default false,
  -- Days relative to due_at. Negative = before due, positive = after.
  -- Default is one polite nudge before, then escalating chases.
  offsets      int[] not null default '{-3,1,7,14}',
  -- Null = use the built-in copy. Supports {{invoice_number}}, {{amount}},
  -- {{due_date}}, {{days_overdue}}, {{company}}, {{link}}.
  subject      text,
  body         text,
  reply_to     text,
  updated_at   timestamptz not null default now()
);
alter table invoice_reminder_settings enable row level security;
revoke all on table invoice_reminder_settings from anon, authenticated;

-- ── Send log ────────────────────────────────────────────────────────────────
-- The unique constraint is the whole safety mechanism: it makes "send reminder
-- for stage N" idempotent at the database level, so a cron that fires twice or
-- a route that retries cannot double-mail a client.
create table if not exists invoice_reminder_log (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  invoice_id   uuid not null references invoices(id) on delete cascade,
  stage        int not null,                     -- the offset that triggered it
  sent_to      text,
  sent_at      timestamptz not null default now(),
  error        text,
  unique (invoice_id, stage)
);
create index if not exists idx_reminder_log_ws on invoice_reminder_log(workspace_id, sent_at desc);
alter table invoice_reminder_log enable row level security;
revoke all on table invoice_reminder_log from anon, authenticated;

-- ── Overdue marking ─────────────────────────────────────────────────────────
-- Separate from reminders on purpose: a workspace that never enables chasing
-- still wants its dashboard to say "overdue" instead of "sent" forever.
-- Only 'sent' moves to 'overdue' — a draft is not overdue, and paid/cancelled
-- must never be reopened.
create or replace function mark_invoices_overdue(p_workspace uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update invoices
     set status = 'overdue'
   where status = 'sent'
     and due_at is not null
     and due_at < current_date
     and (p_workspace is null or workspace_id = p_workspace);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── Which reminders are due right now ───────────────────────────────────────
/**
 * Returns unpaid income invoices whose due date has reached one of the
 * configured offsets and which have not already been mailed at that stage.
 *
 * The stage chosen is the LARGEST offset already reached, not the smallest, so
 * an invoice that has been sitting for 30 days sends the day-14 chase once —
 * rather than working through -3, 1, 7 and 14 on consecutive runs and looking
 * like a malfunction to the recipient.
 */
create or replace function due_invoice_reminders(p_workspace uuid, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(x) order by x.due_at), '[]'::jsonb) into v_out
  from (
    select i.id, i.number, i.amount, i.due_at, i.status,
           c.name  as company_name,
           c.email as company_email,
           (current_date - i.due_at::date) as days_overdue,
           s.subject, s.body, s.reply_to,
           (select max(o) from unnest(s.offsets) o
             where i.due_at::date + o <= current_date) as stage
    from invoices i
    join invoice_reminder_settings s on s.workspace_id = i.workspace_id
    left join companies c on c.id = i.organization_id
    where i.workspace_id = p_workspace
      and s.enabled
      and i.direction = 'income'
      and i.status in ('sent', 'overdue')
      and i.due_at is not null
      and coalesce(i.kind, 'invoice') <> 'offer'
  ) x
  where x.stage is not null
    -- Idempotence: skip anything already logged at this stage.
    and not exists (
      select 1 from invoice_reminder_log l
      where l.invoice_id = x.id and l.stage = x.stage
    )
    -- No address, no reminder. Returning it would just produce a failed send.
    and nullif(x.company_email, '') is not null
  limit greatest(1, least(coalesce(p_limit, 50), 200));

  return v_out;
end $$;

-- Called by the send route after each attempt. Records failures too, so a
-- permanently bouncing address is visible rather than retried forever.
create or replace function log_invoice_reminder(
  p_workspace uuid, p_invoice uuid, p_stage int, p_to text, p_error text default null
) returns void language sql security definer set search_path = public as $$
  insert into invoice_reminder_log (workspace_id, invoice_id, stage, sent_to, error)
  values (p_workspace, p_invoice, p_stage, nullif(p_to, ''), nullif(p_error, ''))
  on conflict (invoice_id, stage) do nothing;
$$;

-- ── Owner side ──────────────────────────────────────────────────────────────
create or replace function get_invoice_reminder_settings(p_privy text, p_workspace uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_build_object(
    'enabled', enabled, 'offsets', offsets, 'subject', subject,
    'body', body, 'reply_to', reply_to
  ) from invoice_reminder_settings where workspace_id = p_workspace),
  -- Reflect the table defaults so the UI shows the same thing before first save.
  jsonb_build_object('enabled', false, 'offsets', jsonb_build_array(-3, 1, 7, 14),
                     'subject', null, 'body', null, 'reply_to', null));
end $$;

create or replace function save_invoice_reminder_settings(
  p_privy text, p_workspace uuid, p_enabled boolean, p_offsets int[],
  p_subject text default null, p_body text default null, p_reply_to text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_role text; v_offsets int[];
begin
  v_role := workspace_role(p_privy, p_workspace);
  if v_role is null or v_role not in ('owner','admin') then raise exception 'FORBIDDEN'; end if;

  -- Clamp to a sane window and de-duplicate. Without this, a typo like 3650
  -- schedules a reminder ten years out, and duplicates would fight the
  -- unique(invoice, stage) constraint rather than being caught here.
  select coalesce(array_agg(distinct o order by o), '{}') into v_offsets
  from unnest(coalesce(p_offsets, '{-3,1,7,14}')) o
  where o between -60 and 365;

  if array_length(v_offsets, 1) is null then raise exception 'NO_VALID_OFFSETS'; end if;
  if array_length(v_offsets, 1) > 8 then raise exception 'TOO_MANY_OFFSETS'; end if;

  insert into invoice_reminder_settings (workspace_id, enabled, offsets, subject, body, reply_to, updated_at)
  values (p_workspace, coalesce(p_enabled, false), v_offsets,
          nullif(p_subject,''), nullif(p_body,''), nullif(p_reply_to,''), now())
  on conflict (workspace_id) do update set
    enabled = excluded.enabled, offsets = excluded.offsets,
    subject = excluded.subject, body = excluded.body,
    reply_to = excluded.reply_to, updated_at = now();

  return jsonb_build_object('enabled', coalesce(p_enabled,false), 'offsets', v_offsets);
end $$;

-- What was chased, and when — so "did we already hassle them?" is answerable.
create or replace function get_invoice_reminder_log(p_privy text, p_workspace uuid, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_workspace_member(p_workspace, p_privy) then raise exception 'NOT_A_MEMBER'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.sent_at desc) from (
    select l.id, l.invoice_id, i.number as invoice_number, l.stage,
           l.sent_to, l.sent_at, l.error
    from invoice_reminder_log l
    left join invoices i on i.id = l.invoice_id
    where l.workspace_id = p_workspace
    order by l.sent_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) x), '[]'::jsonb);
end $$;

revoke all on function mark_invoices_overdue(uuid)                                      from public, anon, authenticated;
revoke all on function due_invoice_reminders(uuid, int)                                 from public, anon, authenticated;
revoke all on function log_invoice_reminder(uuid, uuid, int, text, text)                from public, anon, authenticated;
revoke all on function get_invoice_reminder_settings(text, uuid)                        from public, anon, authenticated;
revoke all on function save_invoice_reminder_settings(text, uuid, boolean, int[], text, text, text) from public, anon, authenticated;
revoke all on function get_invoice_reminder_log(text, uuid, int)                         from public, anon, authenticated;
grant execute on function mark_invoices_overdue(uuid)                                    to service_role;
grant execute on function due_invoice_reminders(uuid, int)                               to service_role;
grant execute on function log_invoice_reminder(uuid, uuid, int, text, text)              to service_role;
grant execute on function get_invoice_reminder_settings(text, uuid)                      to service_role;
grant execute on function save_invoice_reminder_settings(text, uuid, boolean, int[], text, text, text) to service_role;
grant execute on function get_invoice_reminder_log(text, uuid, int)                      to service_role;

notify pgrst, 'reload schema';
