# Legacy ATS schema

These files predate `supabase/migrations/`. They were run by hand in the
Supabase SQL editor while the product was still just the ATS, and two things are
true about them at once:

1. **A fresh self-host still needs them.** The numbered migrations start from
   `0001` assuming the ATS tables already exist — `candidates`, `positions`,
   `company_users`, `assessment_results` and friends come from
   `supabase-schema.sql` and the `add-*.sql` modules, not from `migrations/`.
2. **They are the only written record** of several functions that live in the
   production database but appear in no numbered migration — most importantly
   `search_candidates_for_recruiter` and `get_candidate_details`
   (`add-resume-search.sql`, `fix-assessment-and-visibility.sql`). Verifying one
   of those signatures against a call site and hoping is exactly the trap
   CLAUDE.md warns about; read these instead.

That is why they are filed here rather than deleted.

## Rules

- **Fresh install:** run `supabase-schema.sql` first, then the remaining files
  here, then every file in `supabase/migrations/` in numeric order. The order is
  what keeps you safe — several files here create permissive RLS policies, and
  `0077` is what drops them again at the end.
- **Existing database: do not re-run these.** They are not idempotent, they
  predate the security work in `0040`–`0046` and `0076`–`0077`, and re-running
  one would re-open a policy that `0077` deliberately closed.
- **Never extend them.** New work is a numbered migration in
  `supabase/migrations/` — idempotent, and ending with
  `notify pgrst, 'reload schema';`.

Check what is actually applied with `supabase/verify-migrations.sql`; every row
should read ✅.
