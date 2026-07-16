-- ============================================================================
-- HireBTR — 0042_lock_legacy_tables.sql
-- The table-level half of Phase B. Revokes the public/anon/authenticated
-- roles' direct access to the crown-jewel ATS tables (candidate PII, resumes,
-- assessment scores, OAuth tokens). After 0041 routed every remaining client
-- read/write through SECURITY DEFINER RPCs, nothing in the browser touches
-- these tables directly anymore:
--   • recruiter access  → hr_* RPCs, service_role only, via verified /api/rpc
--   • public apply flow → apply_to_position / set_candidate_cv (DEFINER, anon)
--   • server routes     → service_role (bypasses this revoke)
-- so cutting the anon/authenticated key off closes the set_config spoof.
--
-- ⚠️ RUN ORDER: deploy the app (0041 RPCs + client changes) FIRST, then run
-- this. Running it against an older build breaks the HR dashboard reads.
-- Rollback: `grant select, insert, update, delete on <table> to anon, authenticated;`
--
-- NOT locked this pass (documented follow-up): companies, company_users,
-- positions, assessment_templates — lower-stakes metadata (names, titles,
-- member emails) still reachable via the GUC spoof until their client reads
-- are moved behind RPCs too.
--
-- Idempotent. Depends on 0041.
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'candidates', 'assessment_results', 'assessment_responses',
    'interviews', 'activity_log', 'integration_tokens'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on table public.%I from anon, authenticated', t);
      -- keep RLS enabled as belt-and-suspenders; service_role bypasses both
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
