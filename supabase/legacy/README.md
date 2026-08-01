# Legacy ATS schema

These files predate `supabase/migrations/`. They were run by hand in the
Supabase SQL editor while the product was still just the ATS, and they are the
**only written record** of a set of functions that exist in the live database
but appear in no numbered migration — most importantly
`search_candidates_for_recruiter` and `get_candidate_details`
(`add-resume-search.sql`, `fix-assessment-and-visibility.sql`).

That is why they are filed here rather than deleted. Without them, the only way
to check one of those functions' argument names is to read a call site and hope,
which is exactly the trap CLAUDE.md warns about.

## Rules

- **Do not run these against a live database.** They are not idempotent, they
  predate the security work in 0040–0046 and 0076–0077, and several of them
  create RLS policies that 0077 deliberately drops. Running one would re-open a
  closed hole.
- **Do not extend them.** New work is a numbered migration in
  `supabase/migrations/`, which is idempotent and ends with
  `notify pgrst, 'reload schema';`.
- **Do read them** when you need the real shape of a legacy HR function.

Verify what is actually applied with `supabase/verify-migrations.sql`.
