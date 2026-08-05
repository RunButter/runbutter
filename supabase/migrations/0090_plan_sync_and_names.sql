-- 0090 — a paid plan reaches the product it was bought for.
--
-- Two defects on the billing path, both invisible until money changes hands.
--
-- 1. THE PLAN NEVER REACHED THE NEW PLATFORM. The Stripe webhook updates
--    `companies.plan`. The CRM reads `workspaces.plan` (get_my_workspace, 0051).
--    The only thing that ever copied one to the other was 0005's trigger, and it
--    fires AFTER INSERT ONLY — it seeds a workspace when a company is created and
--    never looks again. So a customer paid, the ATS half saw the upgrade, and
--    every screen in Sales, Finance, Marketing and Projects stayed on Free. That
--    reads as "I paid and nothing happened", which is the worst bug a billing
--    system can have.
--
-- 2. THE DATABASE DID NOT KNOW THE CURRENT PLAN NAMES. `companies_plan_check`
--    still allowed only ('free','starter','professional','enterprise') from the
--    ATS era, while the product sells free/team/business/enterprise. Setting a
--    plan to 'business' — the documented way to test one, and the obvious thing
--    for an admin to type — was rejected outright.
--
-- The legacy names stay ALLOWED rather than being removed. `normalizePlan()` in
-- lib/plans.ts maps starter→team and professional→business, so old rows are read
-- correctly today; a constraint that rejected them would turn a historical value
-- into an error the next time anything touched that row. They are converted
-- here, and still permitted afterwards, because a rejection is not worth it.

-- ── 1. The names the database accepts ───────────────────────────────────────
alter table companies drop constraint if exists companies_plan_check;
alter table companies add constraint companies_plan_check
  check (plan in ('free', 'team', 'business', 'enterprise',
                  -- pre-pivot values, kept valid so no old row becomes unwritable
                  'starter', 'professional', 'pro'));

-- workspaces.plan has never had a constraint. It is deliberately left without
-- one: it is a copy of the companies value, and a second place to enforce the
-- same rule is a second place for the two to disagree.

-- ── 2. Convert what is already stored ───────────────────────────────────────
update companies  set plan = 'team'     where plan = 'starter';
update companies  set plan = 'business' where plan in ('professional', 'pro');
update workspaces set plan = 'team'     where plan = 'starter';
update workspaces set plan = 'business' where plan in ('professional', 'pro');

-- ── 3. Keep the workspace's plan following the company's ────────────────────
-- Exception-safe like every other sync trigger here: a failure to mirror a plan
-- must never roll back the write that recorded a payment.
create or replace function sync_company_plan_to_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.plan is distinct from old.plan then
      update workspaces
         set plan = case
                      when new.plan = 'starter' then 'team'
                      when new.plan in ('professional', 'pro') then 'business'
                      else coalesce(new.plan, 'free')
                    end,
             updated_at = now()
       where id = new.id;
    end if;
  exception when others then
    null;  -- best-effort; never block a billing update
  end;
  return new;
end $$;

drop trigger if exists trg_company_plan_to_workspace on companies;
create trigger trg_company_plan_to_workspace after update of plan on companies
  for each row execute function sync_company_plan_to_workspace();

-- ── 4. Repair anything that already drifted ─────────────────────────────────
-- Every workspace whose company was upgraded before this migration existed —
-- i.e. every customer who has ever paid.
update workspaces w
   set plan = case
                when c.plan = 'starter' then 'team'
                when c.plan in ('professional', 'pro') then 'business'
                else coalesce(c.plan, 'free')
              end,
       updated_at = now()
  from companies c
 where c.id = w.id
   and w.plan is distinct from case
                                 when c.plan = 'starter' then 'team'
                                 when c.plan in ('professional', 'pro') then 'business'
                                 else coalesce(c.plan, 'free')
                               end;

notify pgrst, 'reload schema';
