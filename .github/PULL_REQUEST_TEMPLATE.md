<!--
Thanks for sending this. Keep it to one concern where you can — a PR that does
two things takes twice as long to review and is twice as hard to revert.
-->

## What this changes

<!-- One or two sentences. -->

## Why

<!--
The part a reader six months from now cannot reconstruct from the diff: what
goes wrong without this change. If it fixes a bug, what did the bug do?
-->

## Schema

<!-- Delete this section if there is no SQL. -->

- Migration: `00NN_name.sql`
- [ ] Idempotent (`create or replace`, `add column if not exists`)
- [ ] Ends with `notify pgrst, 'reload schema';`
- [ ] If it redefines one of the five CRUD functions, it redefines them **in full**
- [ ] If it changes a function signature, it `drop function`s first (adding a
      parameter creates an overload, not a replacement) and says so in the header
- [ ] `npm run bundle:sql` re-run so `supabase/schema.sql` matches
- Destructive? <!-- yes/no — and what it drops -->

## Checks

- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] Looked at it in both light and dark mode, if it touches UI

## Notes for the reviewer

<!-- Anything you are unsure about, or deliberately left out. -->
